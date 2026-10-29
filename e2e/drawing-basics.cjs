// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/?feed=demo');
  await p.waitForTimeout(1800);
  const box = await p.locator('#chart').boundingBox();
  const A = (x, y) => [box.x + x, box.y + y];
  const D = async () => Object.values((await p.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')))).drawings ?? {}).flat();
  const drag = async (x1, y1, x2, y2, opts = {}) => {
    if (opts.shift) await p.keyboard.down('Shift');
    if (opts.ctrl) await p.keyboard.down('Control');
    await p.mouse.move(...A(x1, y1)); await p.mouse.down(); await p.mouse.move(...A(x2, y2), { steps: 8 }); await p.mouse.up();
    if (opts.shift) await p.keyboard.up('Shift');
    if (opts.ctrl) await p.keyboard.up('Control');
    await p.waitForTimeout(150);
  };
  // 1) 끌어서 추세선
  await p.click('.tools [data-group=lines]');
  await drag(200, 400, 450, 250);
  let d = await D();
  console.log('drag-to-draw trend:', d.length === 1 && d[0].type === 'trend', '| tool back to cursor:', await p.$eval('.tools [data-group=cursor]', (e) => e.classList.contains('active')));
  // 2) Shift로 수평 고정
  await p.click('.tools [data-group=lines]');
  await drag(200, 500, 420, 470, { shift: true });
  d = await D();
  const t2 = d[1];
  console.log('shift snaps horizontal:', t2.points[0].price === t2.points[1].price);
  // 3) 선택 → 떠 있는 막대: 두께 3, 점선, 색
  await p.mouse.click(...A(325, 325));
  console.log('bar:', (await p.textContent('#draw-bar')).replace(/\s+/g, ' ').trim());
  await p.click('#draw-bar [data-action=width]'); await p.click('#popover [data-value="3"]');
  await p.click('#draw-bar [data-action=style]'); await p.click('#popover [data-value="dashed"]');
  await p.click('#draw-bar [data-action=color]'); await p.click('#popover [data-value="#e91e63"]');
  d = await D();
  console.log('styled:', d[0].width, d[0].lineStyle, d[0].color);
  // 4) 더블클릭 → 설정 창: 오른쪽 연장
  await p.mouse.click(...A(325, 325)); await p.mouse.click(...A(325, 325));
  await p.waitForTimeout(200);
  console.log('settings open:', await p.$eval('#drawing-settings', (e) => e.open), await p.textContent('#drawing-settings-title'));
  await p.check('#ds-extendRight');
  await p.click('#drawing-settings-form button[type=submit]');
  d = await D();
  console.log('extendRight:', d[0].extendRight);
  // 5) Ctrl+끌기 복제
  await drag(325, 325, 380, 360, { ctrl: true });
  d = await D();
  console.log('ctrl-drag clone count:', d.length);
  // 6) Ctrl+C / Ctrl+V
  await p.keyboard.press('Control+c'); await p.keyboard.press('Control+v');
  console.log('after paste:', (await D()).length);
  // 7) 오른쪽 클릭 도형 메뉴
  await p.mouse.click(...A(325, 325), { button: 'right' });
  console.log('drawing menu:', await p.$$eval('#popover .pop-item', (e) => e.map((x) => x.textContent.trim().replace(/\s+/g, ' ')).join(' / ')));
  await p.click('#popover [data-value=lock]');
  // 잠긴 도형은 끌어도 안 움직임
  const before = JSON.stringify((await D())[0].points);
  await drag(325, 325, 360, 300);
  console.log('locked not moved:', before === JSON.stringify((await D())[0].points));
  // 8) 드로잉 모드 유지: 수평선 3개 연속
  await p.click('.tools [data-action=stay]');
  await p.click('.tools [data-group=lines] .caret'); await p.click('#flyout [data-pick=hline]');
  for (const y of [150, 180, 210]) await p.mouse.click(...A(600, y));
  d = await D();
  console.log('stay mode hlines:', d.filter((x) => x.type === 'hline').length, '| still drawing:', await p.$eval('.chart-wrap', (e) => e.classList.contains('drawing')));
  await p.keyboard.press('Escape');
  await p.click('.tools [data-action=stay]');
  // 9) Esc로 그리던 것 취소
  await p.click('.tools [data-group=fib]');
  await p.mouse.click(...A(700, 300));
  await p.keyboard.press('Escape');
  console.log('esc cancels draft, tool kept:', (await D()).filter((x) => x.type === 'fib').length === 0, await p.$eval('.chart-wrap', (e) => e.classList.contains('drawing')));
  await p.keyboard.press('Escape');
  await p.mouse.move(...A(325, 325));
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/draw-tv.png' });
  console.log('errors:', errs);

  // 휴대폰: 연필 버튼 → 도구 → 십자선을 끌어 옮기고 탭 (자세한 확인은 mobile-tv.cjs)
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errs.push('mobile ' + e.message));
  await m.goto(BASE + '/?feed=demo');
  await m.waitForTimeout(1800);
  await m.tap('#draw-toggle');
  await m.waitForTimeout(200);
  const mb = await m.locator('#chart').boundingBox();
  const cdp = await ctx.newCDPSession(m);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const placeAt = async (x, y) => {
    const c = await m.evaluate(() => window.__rea.drawings.touchCursor);
    const fx = mb.x + mb.width / 2, fy = mb.y + mb.height * 0.7;
    await touch('touchStart', fx, fy);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', fx + ((x - c.x) * i) / 6, fy + ((y - c.y) * i) / 6); await m.waitForTimeout(15); }
    await touch('touchEnd'); await m.waitForTimeout(60);
    await touch('touchStart', fx, fy); await touch('touchEnd'); await m.waitForTimeout(80);
  };
  await m.tap('.tools [data-group=lines]');
  await placeAt(60, 350); await placeAt(220, 200);
  const md = Object.values((await m.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')))).drawings ?? {}).flat();
  console.log('touch crosshair drawing:', md.map((x) => x.type).join(','));
  console.log('errors:', errs);
  await b.close();
})();
