// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
// 휴대폰에서 그려 둔 도형 다루기 (트레이딩뷰 앱처럼):
// 탭하면 선택, 선택된 도형은 끌어서 옮기기, 선택 안 된 도형 위를 끌면 차트가 움직임, 꾹 누르면 잡아서 옮기기,
// 살짝 떨려도 안 밀림, 점을 옮기는 동안 떠 있는 막대 숨김
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errs.push(e.message));
  await m.goto(BASE + '/?feed=demo');
  await m.waitForTimeout(1800);
  const box = await m.locator('#chart').boundingBox();
  const cdp = await ctx.newCDPSession(m);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + x, y: box.y + y }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); await m.waitForTimeout(400); };
  const drag = async (x, y, dx, dy, { hold = 0, mid } = {}) => {
    await touch('touchStart', x, y);
    if (hold) await m.waitForTimeout(hold);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', x + (dx * i) / 10, y + (dy * i) / 10);
      await m.waitForTimeout(16);
      if (i === 5 && mid) await mid();
    }
    await touch('touchEnd'); await m.waitForTimeout(400);
  };
  // 도형 두 개를 미리 놓는다: 추세선, 넓은 사각형
  await m.evaluate(() => {
    const D = window.__rea.drawings, bars = D.getBars(), n = bars.length;
    const at = (i) => bars[n - i];
    D.load([
      { id: 'box', type: 'rect', color: '#9c27b0', width: 2, lineStyle: 'solid', points: [{ time: at(420).time, price: at(420).close * 1.02 }, { time: at(300).time, price: at(300).close * 0.98 }] },
      { id: 'tl', type: 'trend', color: '#2962ff', width: 2, lineStyle: 'solid', points: [{ time: at(240).time, price: at(240).low }, { time: at(60).time, price: at(60).high }] },
    ]);
  });
  await m.waitForTimeout(300);
  const st = () => m.evaluate(() => {
    const D = window.__rea.drawings;
    return {
      sel: D.selected?.id ?? null,
      px: Object.fromEntries(D.drawings.map((d) => [d.id, d.points.map((p) => D.pointToPixel(p))])),
      pts: Object.fromEntries(D.drawings.map((d) => [d.id, d.points.map((p) => [p.time, +p.price.toFixed(4)])])),
      range: window.__rea.chart.timeScale().getVisibleLogicalRange(),
    };
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let s0 = await st();
  const boxMid = { x: (s0.px.box[0].x + s0.px.box[1].x) / 2, y: (s0.px.box[0].y + s0.px.box[1].y) / 2 };

  // 1) 선택 안 된 사각형 안에서 끌기 -> 사각형은 그대로, 차트가 움직인다
  await drag(boxMid.x, boxMid.y, -60, 0);
  let s1 = await st();
  console.log('drag over unselected box: box kept', same(s0.pts.box, s1.pts.box), '| chart panned', Math.abs(s1.range.from - s0.range.from) > 2, '| not selected', s1.sel === null);

  // 2) 선에서 조금 떨어진 곳(12px)을 탭 -> 선택
  s0 = s1;
  const tl = s0.px.tl;
  const mid = { x: (tl[0].x + tl[1].x) / 2, y: (tl[0].y + tl[1].y) / 2 };
  await tap(mid.x, mid.y + 12);
  s1 = await st();
  console.log('tap near line selects:', s1.sel === 'tl', '| draw bar', await m.isVisible('#draw-bar'));

  // 3) 손잡이를 누르며 살짝(4px) 떨려도 안 움직임
  await drag(tl[1].x, tl[1].y, 4, 3);
  let s2 = await st();
  console.log('jitter does not move:', same(s1.pts.tl, s2.pts.tl));

  // 4) 선택된 선의 몸통을 끌기 -> 두 점이 같이 이동
  let barHidden = null;
  await drag(mid.x, mid.y, 60, -50, { mid: async () => { barHidden = await m.$eval('.chart-wrap', (e) => e.classList.contains('dragging-drawing')); } });
  let s3 = await st();
  const d0 = s3.px.tl[0].x - s2.px.tl[0].x, d1 = s3.px.tl[1].x - s2.px.tl[1].x;
  console.log('body drag moves both points:', d0 > 40 && Math.abs(d0 - d1) < 8 && s3.pts.tl[0][0] - s2.pts.tl[0][0] === s3.pts.tl[1][0] - s2.pts.tl[1][0], '| bar hidden while dragging', barHidden, '| bar back after', await m.isVisible('#draw-bar'));

  // 5) 손잡이(끝점) 끌기 -> 그 점만, 손가락 밑으로 튀지 않고 움직인 만큼
  const h = s3.px.tl[1];
  await drag(h.x + 6, h.y + 6, -40, 70);
  let s4 = await st();
  console.log('handle drag moves only that point:', same(s3.pts.tl[0], s4.pts.tl[0]) && !same(s3.pts.tl[1], s4.pts.tl[1]),
    '| moved by finger delta', Math.abs((s4.px.tl[1].y - h.y) - 70) < 12);
  await m.screenshot({ path: OUT + '/touch-edit-selected.png' });

  // 6) 선택 안 된 사각형을 꾹(0.6초) 누른 뒤 끌기 -> 잡혀서 이동, 선택됨
  const b0 = s4.px.box;
  const bm = { x: (b0[0].x + b0[1].x) / 2, y: (b0[0].y + b0[1].y) / 2 };
  await drag(bm.x, bm.y, 0, 60, { hold: 600 });
  let s5 = await st();
  console.log('long-press grabs box:', s5.sel === 'box', '| box moved down', s5.px.box[0].y - b0[0].y > 40, '| chart not panned', Math.abs(s5.range.to - s4.range.to) < 0.5);

  // 7) 빈 곳 탭 -> 선택 풀림
  await tap(20, 30 + (await m.evaluate(() => window.__rea.chart.panes()[0].getHeight())) - 120);
  console.log('tap empty deselects:', (await st()).sel === null, '| bar hidden', !(await m.isVisible('#draw-bar')));
  await ctx.close();

  // 컴퓨터: 마우스는 선택 안 해도 바로 끌어 옮김 (트레이딩뷰 웹), 2px 떨림은 무시
  const d = await b.newPage({ viewport: { width: 1300, height: 800 } });
  d.on('pageerror', (e) => errs.push('desktop ' + e.message));
  await d.goto(BASE + '/?feed=demo');
  await d.waitForTimeout(1500);
  const dbox = await d.locator('#chart').boundingBox();
  await d.evaluate(() => {
    const D = window.__rea.drawings, bars = D.getBars(), n = bars.length;
    D.load([{ id: 'tl', type: 'trend', color: '#2962ff', width: 2, lineStyle: 'solid', points: [{ time: bars[n - 50].time, price: bars[n - 50].low }, { time: bars[n - 15].time, price: bars[n - 15].high }] }]);
  });
  await d.waitForTimeout(200);
  const dp = () => d.evaluate(() => { const D = window.__rea.drawings; return D.drawings[0].points.map((p) => D.pointToPixel(p)); });
  const dpts = () => d.evaluate(() => JSON.stringify(window.__rea.drawings.drawings[0].points));
  let p0 = await dp();
  const t0 = await dpts();
  const w0 = await d.evaluate(() => window.__rea.chart.timeScale().width());
  const dm = { x: dbox.x + (p0[0].x + p0[1].x) / 2, y: dbox.y + (p0[0].y + p0[1].y) / 2 };
  await d.mouse.move(dm.x, dm.y); await d.mouse.down(); await d.mouse.move(dm.x + 2, dm.y + 1); await d.mouse.up();
  let p1 = await dp();
  console.log('desktop click jitter does not move:', t0 === (await dpts()), '| chart did not shift on select', w0 === (await d.evaluate(() => window.__rea.chart.timeScale().width())));
  await d.mouse.move(dm.x, dm.y); await d.mouse.down(); await d.mouse.move(dm.x + 80, dm.y - 40, { steps: 8 }); await d.mouse.up();
  let p2 = await dp();
  console.log('desktop drag moves unselected line:', p2[0].x - p1[0].x > 60);
  console.log('errors:', errs);
  await b.close();
})();
