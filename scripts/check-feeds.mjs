// 각 거래소에 실제로 접속해 보고 결과를 표로 출력한다.
//   - 종목 목록, 과거 봉(REST): 개수, 시간 순서, 값 검사
//   - 브라우저 접근(CORS): 피드가 보낸 모든 요청이 다른 사이트(GitHub Pages)에서 허용되는지
//   - 실시간 봉/시세(WebSocket 또는 주기 조회): 정해진 시간 안에 데이터가 오는지, 어떤 종목이 빠졌는지
// 이 스크립트는 실패해도 0으로 끝난다. 결과는 표로만 알린다.
//   node scripts/check-feeds.mjs [피드 id,...]
import { FEEDS } from '../src/feeds/index.js';

const ORIGIN = 'https://dpctbkms.github.io';
const WAIT_MS = 25000;
const only = process.argv[2]?.split(',');
const feeds = FEEDS.filter((f) => f.id !== 'demo' && (!only || only.includes(f.id)));

// 모든 요청에 Origin을 붙이고, 브라우저라면 막혔을 응답을 기록한다.
let corsLog = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const res = await realFetch(url, { ...opts, headers: { ...opts.headers, Origin: ORIGIN } });
  const allow = res.headers.get('access-control-allow-origin');
  if (corsLog && allow !== '*' && allow !== ORIGIN) {
    const u = new URL(url);
    corsLog.add(`${u.host}${u.pathname} (${res.status}, ${allow ?? '헤더 없음'})`);
  }
  return res;
};

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과')), ms))]);
const run = (fn) => fn().then((v) => `✅ ${v}`, (e) => `❌ ${e.message ?? e}`);

async function checkMarkets(feed) {
  const list = await withTimeout(feed.loadMarkets(), 30000);
  if (list.length < (feed.allowCustom ? 5 : 20)) throw new Error(`${list.length}개뿐`);
  const missing = feed.coins.filter((c) => !list.some((m) => m.id === c));
  return `${list.length}개${missing.length ? ` (관심 목록 중 없음: ${missing.join(' ')})` : ''}`;
}

async function checkBars(feed, symbol) {
  const bars = await withTimeout(feed.getBars(symbol, '1h'), 30000);
  if (bars.length < 100) throw new Error(`봉 ${bars.length}개뿐`);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i && b.time <= bars[i - 1].time) throw new Error(`시간 순서 오류 @${i}`);
    if (!(b.high >= b.low && b.high >= Math.min(b.open, b.close) && Number.isFinite(b.volume))) throw new Error(`값 오류 @${i} ${JSON.stringify(b)}`);
  }
  const ageHours = (Date.now() / 1000 - bars[bars.length - 1].time) / 3600;
  if (ageHours > (feed.check?.maxAgeHours ?? 2)) throw new Error(`마지막 봉이 ${ageHours.toFixed(1)}시간 전`);
  const weekly = await withTimeout(feed.getBars(symbol, '1w'), 30000);
  return `${bars.length}개 (주봉 ${weekly.length}개), 종가 ${bars[bars.length - 1].close}`;
}

function checkStream(feed, kind, symbol) {
  return new Promise((resolve, reject) => {
    const wanted = feed.check?.tickers ?? feed.coins;
    const seen = new Set();
    let count = 0;
    let stop;
    const finish = (fn) => { clearTimeout(timer); stop?.(); fn(); };
    const timer = setTimeout(() => finish(() => {
      if (kind === 'bars') return count ? resolve(`${count}건`) : reject(new Error('수신 없음'));
      const missing = wanted.filter((c) => !seen.has(c));
      if (!seen.size) return reject(new Error('수신 없음'));
      resolve(missing.length ? `${seen.size}/${wanted.length} (빠짐: ${missing.join(' ')})` : `${seen.size}/${wanted.length} 전부`);
    }), WAIT_MS);
    if (kind === 'bars' && feed.check?.skipLiveBars) return finish(() => resolve('주기 조회(2분)라 건너뜀'));
    if (kind === 'bars') {
      stop = feed.subscribeBars(symbol, '1m', (bar) => {
        if (!(bar.high >= bar.low && bar.time > 0)) return finish(() => reject(new Error(`값 오류 ${JSON.stringify(bar)}`)));
        count++;
      }, null);
    } else {
      stop = feed.subscribeTickers(wanted, (t) => {
        if (!(t.price > 0 && Number.isFinite(t.changePct))) return finish(() => reject(new Error(`값 오류 ${JSON.stringify(t)}`)));
        seen.add(t.coin);
      });
    }
  });
}

// REST 점검은 CORS 기록을 피드별로 나누려고 하나씩, 실시간 점검은 한꺼번에.
const rows = new Map();
for (const feed of feeds) {
  if (feed.check?.apiKey) feed.apiKey = feed.check.apiKey;
  const symbol = feed.check?.symbol ?? 'BTC';
  corsLog = new Set();
  const markets = await run(() => checkMarkets(feed));
  const bars = await run(() => checkBars(feed, symbol));
  const cors = corsLog.size ? `❌ ${[...corsLog].join(', ')}` : '✅';
  rows.set(feed, [feed.name, markets, bars, cors]);
}
corsLog = null;
await Promise.all(feeds.map(async (feed) => {
  const symbol = feed.check?.symbol ?? 'BTC';
  const [bars, tickers] = await Promise.all([run(() => checkStream(feed, 'bars', symbol)), run(() => checkStream(feed, 'tickers'))]);
  rows.get(feed).push(bars, tickers);
}));

const table = [
  '| 거래소 | 종목 목록 | 과거 봉 | 브라우저 접근(CORS) | 실시간 봉 | 관심 목록 시세 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...[...rows.values()].map((r) => `| ${r.join(' | ')} |`),
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 시세 연결 점검\n\n${table}\n`);
}
process.exit(0);
