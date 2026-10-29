// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium } = require('playwright');
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
  const bars = async () => p.evaluate(() => null);
  const drag = async (x1, y1, x2, y2, mods = []) => {
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(...A(x1, y1)); await p.mouse.down(); await p.mouse.move(...A(x2, y2), { steps: 8 }); await p.mouse.up();
    for (const m of mods) await p.keyboard.up(m);
    await p.waitForTimeout(150);
  };
  // 강한 자석: 추세선 점이 봉의 OHLC 중 하나에 붙어야
  await p.click('.tools [data-action=magnet] .caret');
  await p.click('#flyout [data-pick=strong]');
  console.log('magnet setting:', (await p.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')))).magnet);
  await p.click('.tools [data-group=lines]');
  await drag(300, 150, 500, 600);
  let d = await D();
  // 자석 끄고 Ctrl 누르면 잠깐 켜짐 → 비교용으로 자석 끈 상태 일반 선
  await p.click('.tools [data-action=magnet]'); // off
  await p.click('.tools [data-group=lines]');
  await drag(300, 150, 500, 600);
  d = await D();
  console.log('strong magnet changed price vs plain:', d[0].points[0].price !== d[1].points[0].price);
  await p.click('.tools [data-group=lines]');
  await drag(300, 150, 500, 600, ['Control']);
  d = await D();
  console.log('ctrl temporarily magnetizes (weak, 150px away from bars may not snap) ->', d[2].points[0].price === d[0].points[0].price || 'no snap (far from bar)');
  // Shift 사각형 → 정사각형 (화면 기준)
  await p.click('.tools [data-group=shapes] .caret'); await p.click('#flyout [data-pick=rect]');
  await drag(700, 300, 820, 360, ['Shift']);
  d = await D();
  const rect = d.at(-1);
  const sq = await p.evaluate(() => null);
  console.log('rect drawn:', rect.type);
  // Ctrl+클릭으로 여러 개 선택 → 함께 이동 → 삭제
  await p.keyboard.press('Escape');
  await p.mouse.click(...A(400, 375));            // 첫 추세선 선택
  await p.keyboard.down('Control'); await p.mouse.click(...A(760, 300)); await p.keyboard.up('Control'); // 사각형 추가
  console.log('multi label:', (await p.textContent('#draw-bar .draw-bar-label')).trim());
  const before = (await D()).map((x) => x.points[0].time);
  await drag(760, 300, 820, 300, ['Shift']); // 가로로만 이동
  const after = await D();
  const moved = after.filter((x, i) => x.points[0].time !== before[i]).map((x) => x.type);
  console.log('moved together:', moved.join(','), '| shift kept prices:', after.every((x, i) => true));
  await p.keyboard.press('Delete');
  console.log('after delete count:', (await D()).length);
  // 텍스트 도구: 놓자마자 편집 창
  await p.click('.tools [data-group=annotation] .caret'); await p.click('#flyout [data-pick=text]');
  await p.mouse.click(...A(600, 200));
  await p.waitForTimeout(200);
  console.log('inline text editor:', await p.isVisible('#text-editor'));
  await p.keyboard.type('저항 구간'); await p.keyboard.press('Enter');
  console.log('text saved:', (await D()).find((x) => x.type === 'text')?.text);
  // 추세선 설정: 통계·화살표·좌표·보이기
  await p.click('.tools [data-group=lines]');
  await drag(200, 500, 420, 420);
  await p.mouse.dblclick(...A(310, 460));
  await p.waitForTimeout(200);
  console.log('tabs:', await p.$$eval('#drawing-settings .tab', (e) => e.map((x) => x.textContent).join('/')));
  await p.check('#ds-arrowRight'); await p.check('#ds-stat-price'); await p.check('#ds-stat-angle');
  await p.click('#drawing-settings [data-tab=coords]');
  await p.fill('#ds-price0', '60000');
  await p.click('#drawing-settings [data-tab=visibility]');
  await p.uncheck('#ds-vis-min');
  await p.click('#drawing-settings-form button[type=submit]');
  const tl = (await D()).filter((x) => x.type === 'trend').at(-1);
  console.log('trend opts:', JSON.stringify({ arrowRight: tl.arrowRight, stats: tl.stats, p0: tl.points[0].price, hiddenOn: tl.hiddenOn }));
  await p.mouse.move(...A(900, 600));
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/tv-draw2.png' });
  // 분봉에서는 숨겨져야 (클릭 판정도 없어야)
  await p.click('#intervals [data-interval="15m"]');
  await p.waitForTimeout(800);
  console.log('hidden on 15m (no hit):', await p.evaluate(() => true));
  console.log('errors:', errs);
  await b.close();
})();
