// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  // ---------- 데스크톱 ----------
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/?feed=demo');
  await p.waitForTimeout(1800);
  const box = await p.locator('#chart').boundingBox();
  const A = (x, y) => [box.x + x, box.y + y];
  const D = async () => Object.values((await p.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')))).drawings ?? {}).flat();
  const pick = async (g, id) => { await p.click(`.tools [data-group=${g}] .caret`); await p.click(`#flyout [data-pick="${id}"]`); };
  console.log('groups:', await p.$$eval('.tools [data-group]', (e) => e.map((x) => x.dataset.group).join(',')));
  await p.click('.tools [data-group=lines] .caret');
  console.log('lines flyout:', await p.$$eval('#flyout .fly-item', (e) => e.map((x) => x.textContent.trim().replace(/\s+/g, ' ')).join(' | ')));
  await p.keyboard.press('Escape');
  // 롱 포지션 한 번 클릭
  await pick('forecast', 'long');
  await p.mouse.click(...A(600, 400));
  let d = await D();
  console.log('long one click:', d.at(-1).type, d.at(-1).points.length, d.at(-1).points[1].price > d.at(-1).points[0].price);
  // 브러시
  await pick('shapes', 'brush');
  await p.mouse.move(...A(200, 200)); await p.mouse.down();
  for (let i = 1; i <= 20; i++) await p.mouse.move(...A(200 + i * 8, 200 + Math.sin(i / 3) * 30));
  await p.mouse.up();
  d = await D();
  console.log('brush points:', d.at(-1).type, d.at(-1).points.length);
  // 경로: 3점 + 마지막 다시 클릭
  await pick('shapes', 'path');
  for (const [x, y] of [[300, 500], [380, 450], [460, 520]]) await p.mouse.click(...A(x, y));
  await p.mouse.click(...A(460, 520));
  d = await D();
  console.log('path:', d.at(-1).type, d.at(-1).points.length);
  // 폴리라인: 첫 점 다시 눌러 닫기
  await pick('shapes', 'polyline');
  for (const [x, y] of [[700, 150], [780, 120], [820, 200], [700, 150]]) await p.mouse.click(...A(x, y));
  d = await D();
  console.log('polyline closed:', d.at(-1).type, d.at(-1).points.length);
  // 피보나치 확장 3점, 회귀 추세
  await pick('fib', 'fibext');
  for (const [x, y] of [[100, 600], [200, 450], [260, 550]]) await p.mouse.click(...A(x, y));
  await pick('lines', 'regression');
  await p.mouse.click(...A(150, 300)); await p.mouse.click(...A(450, 300));
  d = await D();
  console.log('fibext/regression:', d.slice(-2).map((x) => `${x.type}(${x.points.length})`).join(','), '| fib levels:', d.at(-2).levels?.length);
  // 텍스트: 차트 위에서 바로 입력
  await pick('annotation', 'text');
  await p.mouse.click(...A(700, 300));
  await p.waitForTimeout(150);
  console.log('inline editor visible:', await p.isVisible('#text-editor'), '| focused:', await p.evaluate(() => document.activeElement?.id));
  await p.keyboard.type('지지 구간');
  await p.keyboard.press('Enter');
  d = await D();
  console.log('text saved:', d.at(-1).type, d.at(-1).text);
  // 빈 텍스트는 지워짐
  await pick('annotation', 'text');
  await p.mouse.click(...A(700, 380));
  await p.keyboard.press('Escape');
  console.log('empty text removed:', (await D()).filter((x) => x.type === 'text').length === 1);
  // Shift+클릭 빠른 측정 (저장 안 됨)
  const before = (await D()).length;
  await p.keyboard.down('Shift'); await p.mouse.click(...A(950, 600)); await p.keyboard.up('Shift');
  await p.mouse.move(...A(1050, 520), { steps: 5 });
  await p.screenshot({ path: OUT + '/tv3-measure.png' });
  await p.mouse.click(...A(1050, 520));
  await p.mouse.click(...A(1050, 520));
  console.log('quick measure not saved:', (await D()).length === before);
  // 지우개
  await p.click('.tools [data-group=cursor] .caret'); await p.click('#flyout [data-pick=eraser]');
  const n = (await D()).length;
  await p.mouse.click(...A(600, 400)); // 롱 포지션 위
  console.log('eraser removed one:', (await D()).length === n - 1);
  await p.click('.tools [data-group=cursor] .caret'); await p.click('#flyout [data-pick=cross]');
  // 떠 있는 막대 끌기 + 더보기
  await p.mouse.click(...A(310, 300)); // 회귀 추세
  console.log('selected:', (await p.textContent('#draw-bar .draw-bar-label')).trim());
  const g = await p.locator('#draw-bar .bar-grip').boundingBox();
  await p.mouse.move(g.x + 5, g.y + 10); await p.mouse.down(); await p.mouse.move(g.x + 205, g.y + 410, { steps: 6 }); await p.mouse.up();
  console.log('bar moved:', JSON.stringify((await p.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')))).drawBarPos));
  await p.click('#draw-bar [data-action=more]');
  console.log('more menu:', await p.$$eval('#popover .pop-item', (e) => e.map((x) => x.textContent.trim()).join('/')));
  await p.keyboard.press('Escape');
  await p.mouse.move(...A(20, 20));
  await p.screenshot({ path: OUT + '/tv3-desktop.png' });
  // 지우기 메뉴
  await p.click('.tools [data-action=clear] .caret');
  console.log('remove menu:', await p.$$eval('#flyout .fly-item', (e) => e.map((x) => x.textContent.trim()).join('/')));
  await p.keyboard.press('Escape');

  // 휴대폰 방식은 mobile-tv.cjs에서 확인한다
  console.log('errors:', errs);
  await b.close();
})();
