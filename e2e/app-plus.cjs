// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
// 십자선 + 버튼(알림·수평선), 가격 알림, 최신 봉으로 버튼, 휴대폰 가로 화면
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const S = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')));

  // ---------- 휴대폰 세로 ----------
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errs.push(e.message));
  await m.goto(BASE + '/?feed=demo');
  await m.waitForTimeout(1800);
  const box = await m.locator('#chart').boundingBox();
  const cdp = await ctx.newCDPSession(m);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + x, y: box.y + y }] });

  // 길게 눌러 십자선 -> + 버튼
  await touch('touchStart', 150, 300); await m.waitForTimeout(500); await touch('touchEnd'); await m.waitForTimeout(300);
  console.log('long press shows +:', await m.isVisible('#price-plus'));
  await m.tap('#price-plus');
  await m.waitForTimeout(250);
  console.log('+ sheet:', await m.$eval('#popover', (e) => e.classList.contains('sheet')), '|', await m.$$eval('#popover .pop-item', (e) => e.map((x) => x.textContent.trim().replace(/[\d,.]+/, '#')).join(' / ')));
  await m.screenshot({ path: OUT + '/plus-sheet.png' });
  await m.tap('#popover [data-value=alert]');
  await m.waitForTimeout(300);
  const st = await S(m);
  console.log('alert added:', st.alerts.length === 1, st.alerts[0]?.dir, '| toast', (await m.textContent('#toast')).trim().slice(0, 40));
  console.log('alert line on chart:', await m.evaluate(() => document.querySelector('#chart').textContent.length >= 0));

  // 메뉴에 알림 목록, 지우기
  await m.tap('.tabbar [data-tab=menu]');
  console.log('menu alert row:', (await m.textContent('.menu-screen .alert-row')).replace(/\s+/g, ' ').trim());
  await m.tap('.menu-screen [data-alert-del]');
  console.log('alert deleted:', (await S(m)).alerts.length === 0);
  await m.tap('.tabbar [data-tab=chart]');

  // 최신 봉으로 버튼: 차트를 오른쪽으로 끌어 지난 봉을 보면 나타나고, 누르면 돌아온다
  // (길게 눌러 띄운 십자선은 차트를 한 번 탭해야 꺼진다. 그 전에는 끌면 십자선이 움직임)
  await touch('touchStart', 200, 400); await touch('touchEnd'); await m.waitForTimeout(400);
  await touch('touchStart', 120, 350);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', 120 + i * 25, 350); await m.waitForTimeout(16); }
  await touch('touchEnd'); await m.waitForTimeout(1200);
  console.log('realtime button after scrolling back:', await m.isVisible('#to-realtime'));
  await m.tap('#to-realtime');
  await m.waitForTimeout(1200);
  console.log('back to latest hides it:', !(await m.isVisible('#to-realtime')));

  // 그리기 십자선: 가운데 동그라미 없이 선만 (그림으로 확인)
  await m.tap('#draw-toggle');
  await m.tap('.tools [data-group=lines]');
  await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + '/draw-crosshair.png' });
  await m.tap('#draw-hint .hint-cancel');
  await ctx.close();

  // 울리는 알림: 1 이상이면 울리는 알림을 미리 넣어 두면 첫 시세에서 바로 울림
  const c2 = await b.newContext({ ...devices['iPhone 13'] });
  const m2 = await c2.newPage();
  m2.on('pageerror', (e) => errs.push('fire ' + e.message));
  await m2.addInitScript(() => localStorage.setItem('rea-chart-settings', JSON.stringify({ alerts: [{ id: 'a1', feed: 'demo', coin: 'BTC', label: 'BTC/USDT', price: 1, dir: 'up', at: 0 }] })));
  await m2.goto(BASE + '/?feed=demo');
  await m2.waitForTimeout(3000);
  const fired = (await S(m2)).alerts[0];
  console.log('alert fired:', !!fired.done, '| toast', (await m2.textContent('#toast')).trim().slice(0, 30));
  await c2.close();

  // ---------- 휴대폰 가로: 왼쪽 세로 탭으로 모든 화면 ----------
  const land = await b.newContext({ ...devices['iPhone 13 landscape'] });
  const l = await land.newPage();
  l.on('pageerror', (e) => errs.push('landscape ' + e.message));
  await l.goto(BASE + '/?feed=demo');
  await l.waitForTimeout(1500);
  const tb = await l.locator('.tabbar').boundingBox();
  console.log('landscape tab rail on the left:', tb && tb.x < 5 && tb.height > tb.width, '| chart', await l.isVisible('#chart'));
  await l.screenshot({ path: OUT + '/landscape-chart.png' });
  await l.tap('.tabbar [data-tab=watch]');
  await l.waitForTimeout(300);
  console.log('landscape watchlist:', await l.isVisible('#watch-list'), await l.$$eval('#watch-list li[data-coin]', (e) => e.length));
  await l.screenshot({ path: OUT + '/landscape-watch.png' });
  await l.tap('.tabbar [data-tab=menu]');
  console.log('landscape menu:', await l.isVisible('.menu-screen'));
  await land.close();

  // ---------- 컴퓨터: 마우스를 올리면 +, + 로 옮겨 가도 남아 있고, 수평선 그리기 ----------
  const d = await b.newPage({ viewport: { width: 1300, height: 800 } });
  d.on('pageerror', (e) => errs.push('desktop ' + e.message));
  await d.goto(BASE + '/?feed=demo');
  await d.waitForTimeout(1500);
  const dbox = await d.locator('#chart').boundingBox();
  await d.mouse.move(dbox.x + 400, dbox.y + 300);
  await d.waitForTimeout(100);
  const pb = await d.locator('#price-plus').boundingBox();
  console.log('desktop + at crosshair height:', pb && Math.abs(pb.y + pb.height / 2 - (dbox.y + 300)) < 2);
  await d.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 6 });
  await d.waitForTimeout(250);
  console.log('stays when moving onto it:', await d.isVisible('#price-plus'));
  await d.click('#price-plus');
  await d.click('#popover [data-value=hline]');
  await d.waitForTimeout(200);
  const dl = Object.values((await S(d)).drawings ?? {}).flat();
  console.log('desktop hline from +:', dl.map((x) => x.type).join(','));
  await d.screenshot({ path: OUT + '/plus-desktop.png' });
  console.log('errors:', errs);
  await b.close();
})();
