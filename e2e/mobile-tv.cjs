// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
// 휴대폰에서 트레이딩뷰 앱 방식: 연필 버튼, 고르자마자 나타나는 십자선, 단계 안내, 45° 버튼, 범례
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const m = await ctx.newPage();
  const errs = [];
  m.on('pageerror', (e) => errs.push(e.message));
  await m.goto(BASE + '/?feed=demo');
  await m.waitForTimeout(1800);
  let box = await m.locator('#chart').boundingBox();
  const cdp = await ctx.newCDPSession(m);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); await m.waitForTimeout(80); };
  const drag = async (x1, y1, dx, dy) => {
    await touch('touchStart', x1, y1);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', x1 + (dx * i) / 8, y1 + (dy * i) / 8); await m.waitForTimeout(15); }
    await touch('touchEnd'); await m.waitForTimeout(80);
  };
  const cursor = () => m.evaluate(() => window.__rea.drawings.touchCursor);
  const stored = async () => Object.values((await m.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')))).drawings ?? {}).flat();
  const hint = async () => (await m.textContent('#draw-hint')).trim();
  // 손가락은 차트 아래쪽에서 끌어 십자선을 (x, y)로 옮긴 뒤 탭한다 (손가락과 십자선은 다른 곳)
  const placeAt = async (x, y) => {
    const c = await cursor();
    await drag(box.x + box.width / 2, box.y + box.height * 0.7, x - c.x, y - c.y);
    await tap(box.x + box.width / 2, box.y + box.height * 0.7);
  };

  console.log('toolbar hidden at start:', !(await m.isVisible('.tools')), '| pencil visible:', await m.isVisible('#draw-toggle'));
  console.log('legend brief (no O/H/L):', !(await m.textContent('#legend .head')).includes('고'), '| values hidden:', await m.$eval('#legend', (e) => e.classList.contains('values-hidden')));
  await m.screenshot({ path: OUT + '/m-start.png' });

  await m.tap('#draw-toggle');
  console.log('toolbar open after pencil:', await m.isVisible('.tools'));
  await m.waitForTimeout(200);
  box = await m.locator('#chart').boundingBox(); // 도구 막대가 펼쳐지면 차트가 오른쪽으로 밀린다
  await m.tap('.tools [data-group=lines]');
  const c0 = await cursor();
  const w = await m.evaluate(() => window.__rea.chart.timeScale().width());
  console.log('crosshair right after picking tool:', !!c0, '| near center:', c0 && Math.abs(c0.x - w / 2) < 2);
  console.log('hint 1:', await hint());
  await placeAt(60, 300);
  console.log('hint 2:', await hint());
  await drag(box.x + box.width / 2, box.y + box.height * 0.7, 120, -110);
  await m.screenshot({ path: OUT + '/m-drawing.png' });
  await drag(box.x + box.width / 2, box.y + box.height * 0.7, -120, 110);
  // 두 번 탭해도 십자선을 안 옮겼으면 길이 0 선은 생기지 않는다
  await tap(box.x + 200, box.y + 500);
  console.log('no zero-length line:', (await stored()).length === 0);
  await placeAt(220, 160);
  const t = (await stored()).at(-1);
  console.log('trend drawn:', t?.type, '| tool back to cursor:', !(await m.isVisible('#draw-hint')), '| crosshair gone:', !(await cursor()));
  console.log('2nd point higher:', t && t.points[1].price > t.points[0].price);
  await m.screenshot({ path: OUT + '/m-trend.png' });

  // 45° 버튼: 켜고 손잡이를 끌면 각도가 45° 단위로
  const angleBtn = await m.isVisible('#draw-bar [data-action=angle]');
  console.log('45° button on selected trend:', angleBtn);
  if (angleBtn) {
    await m.tap('#draw-bar [data-action=angle]');
    const px = await m.evaluate(() => { const d = window.__rea.drawings.selected; return d.points.map((p) => window.__rea.drawings.pointToPixel(p)); });
    await drag(box.x + px[1].x, box.y + px[1].y, 37, 61);
    const q = await m.evaluate(() => { const d = window.__rea.drawings.selected; return d.points.map((p) => window.__rea.drawings.pointToPixel(p)); });
    const deg = Math.abs((Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180) / Math.PI);
    console.log('angle after handle drag:', deg.toFixed(1), '| multiple of 45:', Math.abs(deg / 45 - Math.round(deg / 45)) < 0.02);
    await m.tap('#draw-bar [data-action=angle]');
  }

  // 손잡이는 손가락이 움직인 만큼만 (누른 순간 튀지 않음)
  const before = await m.evaluate(() => window.__rea.drawings.pointToPixel(window.__rea.drawings.selected.points[0]));
  await touch('touchStart', box.x + before.x + 8, box.y + before.y + 6);
  await touch('touchMove', box.x + before.x + 9, box.y + before.y + 6);
  await touch('touchEnd'); await m.waitForTimeout(80);
  const after = await m.evaluate(() => window.__rea.drawings.pointToPixel(window.__rea.drawings.selected.points[0]));
  console.log('handle did not jump to finger:', Math.abs(after.y - before.y) < 3);

  // 경로: 탭해서 점을 찍고 두 번 탭해서 끝
  await m.tap('.tools [data-group=shapes]');
  await m.tap('.tools [data-group=shapes]');
  await m.tap('#flyout [data-pick=path]');
  await placeAt(80, 400); await placeAt(160, 330); await placeAt(240, 380);
  console.log('path hint:', await hint());
  await tap(box.x + 150, box.y + 500);
  const path = (await stored()).at(-1);
  console.log('path finished by double tap:', path?.type, path?.points.length);

  // 취소 버튼
  await m.tap('.tools [data-group=lines]');
  await placeAt(100, 200);
  await m.tap('#draw-hint .hint-cancel');
  console.log('cancel: tool off', !(await m.isVisible('#draw-hint')), '| no draft', await m.evaluate(() => !window.__rea.drawings.draft));

  // 범례: 지표 줄을 누르면 버튼, 다른 곳을 누르면 닫힘. 화살표로 접기
  const row = m.locator('#legend .study').first();
  console.log('legend buttons hidden before tap:', !(await row.locator('.ind-actions').isVisible()));
  await row.tap();
  console.log('legend buttons after tap:', await row.locator('.ind-actions').isVisible());
  await tap(box.x + 200, box.y + 450);
  console.log('legend buttons closed by tapping chart:', !(await row.locator('.ind-actions').isVisible()));
  await m.tap('#legend .legend-toggle');
  console.log('legend collapsed:', (await m.textContent('#legend .legend-toggle')).trim(), '| rows hidden:', !(await row.isVisible()));
  await m.tap('#legend .legend-toggle');
  await m.screenshot({ path: OUT + '/m-end.png' });
  console.log('errors:', errs);
  await b.close();
})();
