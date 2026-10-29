// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + '/?feed=demo');
  await p.waitForTimeout(2000);
  const S = () => p.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings') || '{}'));
  await p.screenshot({ path: OUT + '/tv-1.png' });
  // 타임프레임 전체 목록 + 즐겨찾기
  await p.click('#interval-more');
  console.log('interval menu items:', await p.$$eval('#popover .pop-item', (e) => e.length));
  await p.click('#popover [data-value="star:5m"]');
  console.log('favorites now:', (await S()).favorites.join(','));
  await p.click('#popover [data-value="1w"]');
  await p.waitForTimeout(600);
  console.log('interval:', (await S()).interval, '| more label:', (await p.textContent('#interval-more')).trim());
  // 숫자로 타임프레임 입력
  await p.mouse.click(600, 400);
  await p.keyboard.type('15');
  console.log('interval box:', (await p.textContent('#interval-input')).trim());
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  console.log('after typing 15:', (await S()).interval);
  // 차트 종류
  for (const t of ['hollow', 'baseline', 'candles']) { await p.click('#chart-type-btn'); await p.click(`#popover [data-value="${t}"]`); }
  console.log('chart type:', (await S()).chartType);
  // 도구 펼침: 선 묶음에서 수평 광선
  await p.click('.tools [data-group=lines] .caret');
  console.log('flyout items:', await p.$$eval('#flyout .fly-item', (e) => e.map((x) => x.textContent.trim().replace(/\s+/g, ' ')).join(' / ')));
  await p.click('#flyout [data-pick=hray]');
  const box = await p.locator('#chart').boundingBox();
  await p.mouse.click(box.x + 500, box.y + 300);
  // 롱 포지션
  await p.click('.tools [data-group=forecast] .caret');
  await p.click('#flyout [data-pick=long]');
  await p.mouse.click(box.x + 700, box.y + 380);
  await p.mouse.click(box.x + 820, box.y + 300);
  await p.waitForTimeout(200);
  const draws = Object.values((await S()).drawings).flat();
  console.log('drawings:', draws.map((d) => `${d.type}(${d.points.length})`).join(', '));
  const lp = draws.find((d) => d.type === 'long');
  console.log('long: stop below entry & target above:', lp.points[2].price < lp.points[0].price && lp.points[1].price > lp.points[0].price);
  // 기간 버튼
  await p.click('#ranges [data-range="1M"]');
  await p.waitForTimeout(800);
  console.log('range 1M -> interval:', (await S()).interval, '| active:', await p.$eval('#ranges .active', (e) => e.textContent));
  // 로그 눈금
  await p.click('#scale-log');
  console.log('scale:', (await S()).scaleMode, await p.$eval('#scale-log', (e) => e.className));
  await p.click('#scale-log');
  // 오른쪽 클릭 메뉴 -> 수평선
  await p.mouse.click(box.x + 300, box.y + 200, { button: 'right' });
  console.log('context menu:', await p.$$eval('#popover .pop-item', (e) => e.map((x) => x.textContent.trim().replace(/\s+/g, ' ')).join(' / ')));
  await p.click('#popover [data-value=hline]');
  console.log('after context hline:', Object.values((await S()).drawings).flat().map((d) => d.type).join(','));
  // 차트 설정: 상승색 변경, 격자 끄기
  await p.click('#settings-btn');
  await p.fill('#cs-upColor', '#2196f3');
  await p.uncheck('#cs-vertGrid');
  await p.click('#chart-settings-form button[type=submit]');
  console.log('chart settings:', JSON.stringify((await S()).chart));
  // 패널 닫기/열기
  await p.click('#panel-btn');
  console.log('panel hidden:', await p.$eval('#side-panel', (e) => e.hidden));
  await p.click('#panel-btn');
  await p.waitForTimeout(300);
  console.log('details:', (await p.textContent('#details')).replace(/\s+/g, ' ').trim().slice(0, 120));
  await p.mouse.move(box.x + 600, box.y + 350);
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/tv-2.png' });
  await p.setViewportSize({ width: 390, height: 820 });
  await p.waitForTimeout(400);
  console.log('mobile scrollWidth:', await p.evaluate(() => document.documentElement.scrollWidth));
  await p.screenshot({ path: OUT + '/tv-mobile.png' });
  console.log('errors:', errs);
  await b.close();
})();
