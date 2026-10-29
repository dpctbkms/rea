// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium, devices } = require('playwright');
const GROUPS = {
  lines: ['trend', 'ray', 'infoline', 'extended', 'trendangle', 'hline', 'hray', 'vline', 'crossline', 'channel', 'regression'],
  fib: ['fib', 'fibext', 'fibtime'],
  forecast: ['long', 'short', 'daterange', 'pricerange', 'measure'],
  shapes: ['brush', 'highlighter', 'rect', 'circle', 'ellipse', 'triangle', 'path', 'polyline'],
  annotation: ['text', 'pricelabel', 'arrow', 'arrowup', 'arrowdown'],
};
const POINTS = { trend: 2, ray: 2, infoline: 2, extended: 2, trendangle: 2, hline: 1, hray: 1, vline: 1, crossline: 1, channel: 3, regression: 2, fib: 2, fibext: 3, fibtime: 2, long: 1, short: 1, daterange: 2, pricerange: 2, measure: 2, brush: 'free', highlighter: 'free', rect: 2, circle: 2, ellipse: 2, triangle: 3, path: 'multi', polyline: 'multi', text: 1, pricelabel: 1, arrow: 2, arrowup: 1, arrowdown: 1 };
const TYPE = { infoline: 'trend', extended: 'trend', trendangle: 'trend' };
(async () => {
  const b = await chromium.launch();
  for (const mode of ['mouse', 'touch']) {
    const ctx = mode === 'touch' ? await b.newContext({ ...devices['iPhone 13'] }) : await b.newContext({ viewport: { width: 1300, height: 820 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/?feed=demo');
    await p.waitForTimeout(1800);
    if (mode === 'touch') { await p.tap('#draw-toggle'); await p.waitForTimeout(200); }
    const box = await p.locator('#chart').boundingBox();
    const cdp = mode === 'touch' ? await ctx.newCDPSession(p) : null;
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const W = Math.min(box.width - 120, 700), H = Math.min(box.height - 160, 500);
    const at = (i, k) => [box.x + 30 + ((i * 53 + k * 37) % W), box.y + 60 + ((i * 71 + k * 43) % H)];
    // 휴대폰: 십자선을 (x, y)로 끌어 옮긴 뒤 탭 (손가락은 차트 아래쪽, 십자선과 다른 곳)
    const placeAt = async (x, y) => {
      const c = await p.evaluate(() => window.__rea.drawings.touchCursor);
      const fx = box.x + box.width / 2, fy = box.y + box.height * 0.75;
      if (c) {
        await touch('touchStart', fx, fy);
        for (let k = 1; k <= 4; k++) await touch('touchMove', fx + ((x - box.x - c.x) * k) / 4, fy + ((y - box.y - c.y) * k) / 4);
        await touch('touchEnd'); await p.waitForTimeout(40);
      }
      await touch('touchStart', fx, fy); await touch('touchEnd'); await p.waitForTimeout(60);
    };
    const select = async (g, id) => {
      if (mode === 'touch') {
        if (!(await p.$eval(`.tools [data-group=${g}]`, (e) => e.classList.contains('active')))) await p.tap(`.tools [data-group=${g}]`);
        if (!(await p.$eval('#flyout', (e) => !e.hidden))) await p.tap(`.tools [data-group=${g}]`);
        await p.tap(`#flyout [data-pick="${id}"]`);
      } else {
        await p.click(`.tools [data-group=${g}] .caret`);
        await p.click(`#flyout [data-pick="${id}"]`);
      }
    };
    let i = 0;
    const expected = [];
    for (const [g, ids] of Object.entries(GROUPS)) {
      for (const id of ids) {
        await select(g, id);
        const n = POINTS[id];
        if (n === 'free') {
          const [x, y] = at(i, 0);
          if (mode === 'mouse') { await p.mouse.move(x, y); await p.mouse.down(); for (let k = 1; k < 10; k++) await p.mouse.move(x + k * 6, y + (k % 3) * 5); await p.mouse.up(); }
          else { await touch('touchStart', x, y); for (let k = 1; k < 10; k++) await touch('touchMove', x + k * 6, y + (k % 3) * 5); await touch('touchEnd'); }
        } else if (n === 'multi') {
          const pts = [at(i, 0), at(i, 1), at(i, 2)];
          if (mode === 'mouse') { for (const [x, y] of pts) await p.mouse.click(x, y); await p.mouse.click(...pts[2]); }
          else { for (const [x, y] of pts) await placeAt(x, y); await placeAt(...pts[2]); } // 같은 자리 한 번 더 = 두 번 탭
        } else if (mode === 'touch') {
          for (let k = 0; k < n; k++) await placeAt(...at(i, k));
        } else {
          for (let k = 0; k < n; k++) await p.mouse.click(...at(i, k));
        }
        await p.waitForTimeout(100);
        if (await p.isVisible('#text-editor')) { await p.keyboard.type('메모'); await p.keyboard.press('Enter'); }
        expected.push(TYPE[id] ?? id);
        i++;
      }
    }
    const types = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('rea-chart-settings')).drawings ?? {}).flat().map((d) => d.type));
    const missing = [...new Set(expected)].filter((t) => types.filter((x) => x === t).length < expected.filter((x) => x === t).length);
    console.log(mode, 'drew', types.length, 'of', expected.length, missing.length ? `missing: ${missing}` : 'all ok', '| errors:', errs);
    if (mode === 'mouse') await p.screenshot({ path: OUT + '/all-tools.png' });
    await ctx.close();
  }
  await b.close();
})();
