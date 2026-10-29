// 브라우저 확인 스크립트: 결과를 출력한다 (실패해도 끝까지 진행). npm run test:e2e 로 실행.
const BASE = process.env.E2E_BASE ?? 'http://localhost:4175';
const OUT = process.argv[2] ?? require('os').tmpdir();
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1300, height: 760 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const json = (r, body) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await p.route('https://api.upbit.com/v1/market/all', (r) => json(r, [
    ...['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'].map((c) => ({ market: `KRW-${c}`, korean_name: c + '한글' })),
    ...Array.from({ length: 150 }, (_, i) => ({ market: `KRW-T${i}`, korean_name: `테스트코인${i}` })),
    { market: 'BTC-ETH', korean_name: '이더리움' },
  ]));
  await p.route('https://api.upbit.com/v1/candles/**', (r) => {
    const end = Math.floor(Date.now() / 3600000) * 3600000;
    json(r, Array.from({ length: 200 }, (_, i) => { const t = end - i * 3600000; return { candle_date_time_utc: new Date(t).toISOString().slice(0, 19), opening_price: 1e8, high_price: 1.01e8, low_price: 0.99e8, trade_price: 1e8 + i * 1000, candle_acc_trade_volume: 3 }; }));
  });
  let tdCalls = [];
  await p.route('https://api.twelvedata.com/**', (r) => {
    const u = new URL(r.request().url()); tdCalls.push(u.pathname + ' key=' + u.searchParams.get('apikey'));
    if (u.searchParams.get('apikey') !== 'GOODKEY') return json(r, { status: 'error', code: 401, message: 'bad key' });
    if (u.pathname === '/time_series') {
      const n = +u.searchParams.get('outputsize');
      const end = Math.floor(Date.now() / 3600000) * 3600000;
      return json(r, { status: 'ok', values: Array.from({ length: Math.min(n, 300) }, (_, i) => { const d = new Date(end - i * 3600000).toISOString(); return { datetime: d.slice(0, 10) + ' ' + d.slice(11, 19), open: '1380', high: '1385', low: '1375', close: String(1380 + i % 5), volume: '0' }; }) });
    }
    if (u.pathname === '/quote') {
      const syms = u.searchParams.get('symbol').split(',');
      return json(r, Object.fromEntries(syms.map((s) => [s, { close: '1381.5', percent_change: '-0.42' }])));
    }
  });
  await p.goto(BASE + '/');
  await p.waitForTimeout(2500);
  const txt = async (s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
  console.log('upbit status:', await txt('#feed-status'), '| watch rows:', await p.$$eval('#watch-list li', (l) => l.length));
  await p.click('#symbol-btn');
  console.log('search count:', await txt('#search-count'), '| rows:', await p.$$eval('#search-results li', (l) => l.length));
  await p.fill('#search-input', '테스트코인12');
  console.log('search korean:', await txt('#search-results'));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  console.log('search open after enter:', await p.$eval('#search-dialog', (d) => d.open));
  console.log('symbol now:', await txt('#symbol-label'));
  await p.selectOption('#source', 'twelvedata');
  await p.waitForTimeout(1200);
  console.log('key dialog open:', await p.$eval('#key-dialog', (d) => d.open), '| status:', await txt('#feed-status'), '| key btn visible:', await p.isVisible('#key-btn'));
  console.log('search open before key:', await p.$eval('#search-dialog', (d) => d.open));
  await p.fill('#key-input', 'GOODKEY');
  await p.click('#key-form button[type=submit]');
  await p.waitForTimeout(2500);
  console.log('search open after key:', await p.$eval('#search-dialog', (d) => d.open), await p.$eval('#key-dialog', (d) => d.open));
  console.log('after key -> symbol:', await txt('#symbol-label'), '| status:', await txt('#feed-status'));
  console.log('legend:', (await txt('#legend')).slice(0, 90));
  console.log('watch:', await txt('#watch-list'));
  await p.click('#symbol-btn'); await p.fill('#search-input', 'pltr');
  console.log('custom search:', await txt('#search-results'));
  await p.keyboard.press('Escape');
  await p.screenshot({ path: OUT + '/stocks.png' });
  console.log('twelvedata calls:', tdCalls.length, tdCalls.slice(0, 4));
  console.log('errors:', errs);
  await b.close();
})();
