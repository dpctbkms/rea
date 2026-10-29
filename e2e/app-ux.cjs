// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
// 앱다운 사용감: 화면 확대·글자 선택 막기, 관심 목록 편집(밀어서 삭제·별로 추가), 값 반짝임,
// 시트를 끌어 내려 닫기, 가로 화면, 컴퓨터의 × 버튼
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
  const cdp = await ctx.newCDPSession(m);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const drag = async (x, y, dx, dy) => {
    await touch('touchStart', x, y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', x + (dx * i) / 8, y + (dy * i) / 8); await m.waitForTimeout(16); }
    await touch('touchEnd'); await m.waitForTimeout(400);
  };
  const stored = () => m.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')));

  console.log('page zoom off:', (await m.getAttribute('meta[name=viewport]', 'content')).includes('user-scalable=no'),
    '| touch-action', await m.evaluate(() => getComputedStyle(document.documentElement).touchAction),
    '| text select', await m.evaluate(() => getComputedStyle(document.body).userSelect));

  // 시트: 손잡이를 아래로 끌면 닫힘
  await m.tap('#interval-btn');
  await m.waitForTimeout(300);
  const g = await m.locator('#popover .sheet-grip').boundingBox();
  console.log('sheet grip:', !!g);
  if (g) await drag(g.x + g.width / 2, g.y + 10, 0, 160);
  console.log('sheet closed by dragging down:', !(await m.isVisible('#popover')), '| backdrop gone', !(await m.isVisible('#sheet-backdrop')));
  // 조금만 끌면 안 닫힘
  await m.tap('#more-btn');
  await m.waitForTimeout(300);
  const g2 = await m.locator('#popover .sheet-grip').boundingBox();
  await drag(g2.x + g2.width / 2, g2.y + 10, 0, 30);
  console.log('small drag keeps sheet open:', await m.isVisible('#popover'));
  await m.tap('#sheet-backdrop', { position: { x: 200, y: 80 } });

  // 관심 목록: 밀어서 삭제
  await m.tap('.tabbar [data-tab=watch]');
  await m.waitForTimeout(300);
  const rows = async () => m.$$eval('#watch-list li[data-coin]', (e) => e.map((x) => x.dataset.coin));
  const before = await rows();
  const r = await m.locator('#watch-list li[data-coin="ETH"]').boundingBox();
  await drag(r.x + r.width - 40, r.y + r.height / 2, -150, 0);
  console.log('swiped open:', await m.$eval('#watch-list li[data-coin="ETH"]', (e) => e.classList.contains('open')), '| delete visible', await m.isVisible('#watch-list li[data-coin="ETH"] .row-del'));
  await m.tap('#watch-list li[data-coin="ETH"] .row-del');
  await m.waitForTimeout(300);
  const after = await rows();
  console.log('deleted ETH:', before.includes('ETH') && !after.includes('ETH'), '| saved', !(await stored()).watchlists.demo.includes('ETH'));
  // 세로로 넘기는 동작은 삭제 버튼을 열지 않음
  const r2 = await m.locator('#watch-list li[data-coin="SOL"]').boundingBox();
  await drag(r2.x + r2.width / 2, r2.y + r2.height / 2, 4, -60);
  console.log('vertical move does not open:', !(await m.$eval('#watch-list li[data-coin="SOL"]', (e) => e.classList.contains('open'))));
  // 값이 바뀌면 반짝임
  await m.waitForTimeout(2600);
  console.log('price flash seen:', await m.evaluate(() => document.querySelectorAll('#watch-list .flash-up, #watch-list .flash-down').length > 0));
  await m.screenshot({ path: OUT + '/ux-watch.png' });

  // + 로 검색 → 별로 다시 넣기, 검색 창은 손잡이로 닫기
  await m.tap('#watch-search');
  await m.fill('#search-input', 'ETH');
  await m.waitForTimeout(200);
  await m.tap('#search-results [data-star="ETH"]');
  console.log('star added ETH:', (await rows()).includes('ETH'), '| star on', await m.$eval('#search-results [data-star="ETH"]', (e) => e.classList.contains('on')), '| search still open', await m.isVisible('#search-dialog'));
  await m.screenshot({ path: OUT + '/ux-search.png' });
  const g3 = await m.locator('#search-dialog .sheet-grip').boundingBox();
  await drag(g3.x + g3.width / 2, g3.y + 10, 0, 200);
  console.log('search sheet closed by dragging:', !(await m.isVisible('#search-dialog')));
  await ctx.close();

  // 가로 화면: 아래 탭 없이 차트
  const land = await b.newContext({ ...devices['iPhone 13 landscape'] });
  const l = await land.newPage();
  l.on('pageerror', (e) => errs.push('landscape ' + e.message));
  await l.addInitScript(() => localStorage.setItem('rea-chart-settings', JSON.stringify({ tab: 'watch' })));
  await l.goto(BASE + '/?feed=demo');
  await l.waitForTimeout(1500);
  console.log('landscape: tabbar hidden', !(await l.isVisible('.tabbar')), '| chart shown', await l.isVisible('#chart'), '| app header', await l.isVisible('#interval-btn'),
    '| chart height', Math.round((await l.locator('#chart').boundingBox()).height));
  await l.screenshot({ path: OUT + '/ux-landscape.png' });
  await land.close();

  // 컴퓨터: 줄에 마우스를 올리면 ×, + 버튼
  const d = await b.newPage({ viewport: { width: 1300, height: 800 } });
  d.on('pageerror', (e) => errs.push('desktop ' + e.message));
  await d.goto(BASE + '/?feed=demo');
  await d.waitForTimeout(1200);
  console.log('desktop + button:', await d.isVisible('#watch-search'), '| × hidden before hover', !(await d.isVisible('#watch-list li[data-coin="XRP"] .row-del')));
  await d.hover('#watch-list li[data-coin="XRP"]');
  await d.click('#watch-list li[data-coin="XRP"] .row-del');
  console.log('desktop removed XRP:', !(await d.$$eval('#watch-list li[data-coin]', (e) => e.map((x) => x.dataset.coin))).includes('XRP'),
    '| symbol unchanged', (await d.textContent('#symbol-label')).trim());
  console.log('errors:', errs);
  await b.close();
})();
