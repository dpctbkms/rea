// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
// 휴대폰 앱 화면: 아래 탭(관심 목록·차트·메뉴), 시트 메뉴, 앱 설치 정보, 차트 위 로고 없음
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
  const vis = (sel) => m.isVisible(sel);

  console.log('tabbar:', await m.$$eval('.tabbar button', (e) => e.map((x) => x.textContent.trim()).join('/')), '| active:', await m.textContent('.tabbar .active'));
  console.log('chart logo link gone:', await m.evaluate(() => !document.querySelector('#chart a[href*="tradingview"]')));
  console.log('header: intervals row hidden', !(await vis('#intervals')), '| interval button', (await m.textContent('#interval-btn')).trim(), '| more', await vis('#more-btn'), '| symbol logo', await vis('#symbol-logo'));
  console.log('bottom bar undo visible:', await vis('.statusbar .undo-btn'));
  await m.screenshot({ path: OUT + '/app-chart.png' });

  // 타임프레임 시트
  await m.tap('#interval-btn');
  console.log('interval sheet:', await m.$eval('#popover', (e) => e.classList.contains('sheet')), '| backdrop', await vis('#sheet-backdrop'));
  await m.screenshot({ path: OUT + '/app-interval-sheet.png' });
  await m.tap('#popover [data-value="4h"]');
  await m.waitForTimeout(500);
  console.log('interval now:', (await m.textContent('#interval-btn')).trim(), '| sheet closed', !(await vis('#popover')), !(await vis('#sheet-backdrop')));

  // ⋯ 메뉴 시트, 바깥(어두운 배경) 탭으로 닫기
  await m.tap('#more-btn');
  console.log('more sheet:', await m.$$eval('#popover .pop-item', (e) => e.map((x) => x.textContent.trim()).join('/')));
  await m.tap('#sheet-backdrop', { position: { x: 200, y: 100 } });
  console.log('backdrop closes:', !(await vis('#popover')));

  // 관심 목록 탭
  await m.tap('.tabbar [data-tab=watch]');
  await m.waitForTimeout(300);
  console.log('watch screen:', await vis('#watch-list'), '| chart hidden', !(await vis('#chart')), '| rows', await m.$$eval('#watch-list li', (e) => e.length));
  console.log('first row:', (await m.textContent('#watch-list li')).replace(/\s+/g, ' ').trim());
  await m.screenshot({ path: OUT + '/app-watch.png' });
  await m.tap('#watch-list li:nth-child(2)');
  await m.waitForTimeout(600);
  console.log('tap row -> chart tab:', (await m.textContent('.tabbar .active')).trim(), '| symbol', (await m.textContent('#symbol-label')).trim());

  // 메뉴 탭
  await m.tap('.tabbar [data-tab=menu]');
  console.log('menu groups:', await m.$$eval('.menu-group h2', (e) => e.map((x) => x.textContent).join('/')));
  console.log('credit link:', await m.$eval('.menu-screen .credit a', (a) => a.href));
  await m.tap('[data-menu=install]');
  console.log('install help shown:', await vis('#install-help'));
  await m.tap('[data-set-theme=light]');
  console.log('theme light:', await m.evaluate(() => document.documentElement.dataset.theme), '| theme-color', await m.$eval('meta[name=theme-color]', (e) => e.content));
  await m.screenshot({ path: OUT + '/app-menu.png' });
  await m.tap('[data-set-theme=dark]');

  // 검색은 아래에서 올라오는 시트
  await m.tap('.tabbar [data-tab=chart]');
  await m.tap('#symbol-btn');
  const box = await m.locator('#search-dialog').boundingBox();
  console.log('search sheet full width:', Math.round(box.width) === 390, '| reaches bottom', Math.round(box.y + box.height) >= 840);
  await m.screenshot({ path: OUT + '/app-search.png' });

  // 앱 설치 파일
  const manifest = await (await m.request.get(BASE + '/manifest.webmanifest')).json();
  console.log('manifest:', manifest.name, manifest.display, manifest.icons.map((i) => i.sizes + (i.purpose === 'maskable' ? 'm' : '')).join(','));
  for (const f of ['sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.svg']) {
    const r = await m.request.get(`${BASE}/${f}`);
    if (!r.ok()) errs.push(`missing ${f}`);
  }
  console.log('service worker:', await m.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())));

  // 컴퓨터 화면은 그대로 (탭·⋯ 없음)
  const d = await b.newPage({ viewport: { width: 1300, height: 800 } });
  await d.goto(BASE + '/?feed=demo');
  await d.waitForTimeout(1200);
  console.log('desktop: tabbar hidden', !(await d.isVisible('.tabbar')), '| intervals', await d.isVisible('#intervals'), '| more hidden', !(await d.isVisible('#more-btn')), '| watchlist', await d.isVisible('#watch-list'));
  await d.click('#settings-btn');
  console.log('desktop credit in chart settings:', await d.isVisible('#chart-settings .credit a'));
  console.log('errors:', errs);
  await b.close();
})();
