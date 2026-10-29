// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') errs.push(m.text()); });
  // 예전 형식 설정으로 시작 (이전 버전에서 넘어온 사용자)
  await p.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('rea-chart-settings', JSON.stringify({ indicators: ['volume', 'ema20', 'rsi', 'bb'], interval: '1h' })); } });
  await p.goto(BASE + '/?feed=demo');
  await p.waitForTimeout(1800);
  const legendTitles = () => p.$$eval('#legend .study .k', (els) => els.map((e) => e.textContent.trim()));
  console.log('migrated:', (await legendTitles()).join(' | '));
  // 모든 지표 추가
  await p.click('#indicator-btn');
  const types = await p.$$eval('.study-add', (els) => els.map((e) => e.dataset.type));
  console.log('available:', types.length);
  for (const t of types) await p.click(`.study-add[data-type="${t}"]`);
  console.log('applied count:', await p.textContent('#study-applied h3'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(800);
  console.log('panes:', await p.evaluate(() => document.querySelectorAll('#chart table tr').length));
  await p.screenshot({ path: OUT + '/studies-all.png' });
  // 하나만 남기고 정리: 처음 4개 + 일목, 슈퍼트렌드, 스토캐스틱
  const keep = await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('rea-chart-settings'));
    return s.indicators.length;
  });
  console.log('stored indicators:', keep);
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('rea-chart-settings'));
    const want = ['volume', 'ema', 'bb', 'ichimoku', 'supertrend', 'psar', 'rsi', 'stoch', 'adx'];
    const seen = new Set();
    s.indicators = s.indicators.filter((x) => want.includes(x.type) && !seen.has(x.type) && seen.add(x.type));
    localStorage.setItem('rea-chart-settings', JSON.stringify(s));
  });
  await p.reload();
  await p.waitForTimeout(1800);
  console.log('after reload:', (await legendTitles()).join(' | '));
  // EMA 설정 바꾸기: 기간 20 -> 100, 색 변경
  // 트레이딩뷰처럼 지표 줄 버튼은 마우스를 올려야 보인다
  const act = async (text, a) => { const r = p.locator('#legend .study', { hasText: text }).first(); await r.hover(); await r.locator(`[data-act=${a}]`).click(); };
  const hiddenBefore = !(await p.locator('#legend .study [data-act=settings]').first().isVisible());
  await act('EMA', 'settings');
  console.log('buttons hidden until hover:', hiddenBefore);
  console.log('settings title:', await p.textContent('#study-settings-title'));
  await p.fill('#sp-period', '100');
  await p.selectOption('#sp-source', 'hlc3');
  await p.fill('#sc-value', '#ff00aa');
  await p.click('#study-settings-form button[type=submit]');
  await p.waitForTimeout(300);
  console.log('after edit:', (await legendTitles()).join(' | '));
  const ema = await p.evaluate(() => JSON.parse(localStorage.getItem('rea-chart-settings')).indicators.find((x) => x.type === 'ema'));
  console.log('ema stored:', JSON.stringify(ema.params), ema.colors.value);
  // 숨기기, 삭제
  await act('ADX', 'toggle');
  await p.waitForTimeout(200);
  console.log('adx hidden class:', await p.locator('#legend .study', { hasText: 'ADX' }).getAttribute('class'), '| panes:', await p.evaluate(() => document.querySelectorAll('#chart table tr').length));
  await act('Stoch', 'remove');
  await p.waitForTimeout(200);
  console.log('after remove:', (await legendTitles()).join(' | '));
  await p.mouse.move(700, 400);
  await p.waitForTimeout(200);
  console.log('legend values sample:', (await p.textContent('#legend .study:nth-of-type(3)')).replace(/\s+/g, ' ').trim());
  await p.screenshot({ path: OUT + '/studies.png' });
  // 설정 창 모바일
  await p.setViewportSize({ width: 390, height: 800 });
  await act('BB', 'settings');
  await p.waitForTimeout(200);
  console.log('mobile scrollWidth:', await p.evaluate(() => document.documentElement.scrollWidth));
  await p.screenshot({ path: OUT + '/studies-settings-mobile.png' });
  console.log('errors:', errs.filter((e) => !/WebSocket|ERR_/.test(e)));
  await b.close();
})();
