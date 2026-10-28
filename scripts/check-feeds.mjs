// 각 거래소에 실제로 접속해 보고 결과를 표로 출력한다.
//   - 과거 봉(REST): 개수, 시간 순서, 값 검사
//   - 브라우저 접근(CORS): 다른 사이트(GitHub Pages)에서 불러올 수 있는지
//   - 실시간 봉/시세(WebSocket): 정해진 시간 안에 데이터가 오는지, 어떤 코인이 빠졌는지
// 이 스크립트는 실패해도 0으로 끝난다. 결과는 표로만 알린다.
import { FEEDS } from '../src/feeds/index.js';

const ORIGIN = 'https://dpctbkms.github.io';
const WAIT_MS = 25000;
const feeds = FEEDS.filter((f) => f.id !== 'demo' && (!process.argv[2] || process.argv[2].split(',').includes(f.id)));

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과')), ms))]);

async function checkBars(feed) {
  const bars = await withTimeout(feed.getBars('BTC', '1h'), 30000);
  if (bars.length < 100) throw new Error(`봉 ${bars.length}개뿐`);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i && b.time <= bars[i - 1].time) throw new Error(`시간 순서 오류 @${i}`);
    if (!(b.high >= b.low && b.high >= Math.min(b.open, b.close) && Number.isFinite(b.volume))) throw new Error(`값 오류 @${i}`);
  }
  const age = Date.now() / 1000 - bars[bars.length - 1].time;
  if (age > 7200) throw new Error(`마지막 봉이 ${Math.round(age / 60)}분 전`);
  const weekly = await withTimeout(feed.getBars('BTC', '1w'), 30000);
  return `${bars.length}개 (주봉 ${weekly.length}개), 종가 ${bars[bars.length - 1].close}`;
}

async function checkCors(feed) {
  const res = await withTimeout(fetch(feed.probeUrl, { headers: { Origin: ORIGIN } }), 15000);
  const allow = res.headers.get('access-control-allow-origin');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (allow !== '*' && allow !== ORIGIN) throw new Error(`허용 안 함 (${allow ?? '헤더 없음'})`);
  return allow;
}

function checkStream(feed, kind) {
  return new Promise((resolve, reject) => {
    const seen = new Set();
    let count = 0;
    let stop;
    const finish = (fn) => { clearTimeout(timer); stop?.(); fn(); };
    const timer = setTimeout(() => {
      if (kind === 'bars') finish(() => (count ? resolve(`${count}건`) : reject(new Error('수신 없음'))));
      else finish(() => {
        const missing = feed.coins.filter((c) => !seen.has(c));
        if (!seen.size) reject(new Error('수신 없음'));
        else resolve(missing.length ? `${seen.size}/${feed.coins.length} (빠짐: ${missing.join(' ')})` : `${seen.size}/${feed.coins.length} 전부`);
      });
    }, WAIT_MS);
    if (kind === 'bars') {
      stop = feed.subscribeBars('BTC', '1m', (bar) => {
        if (!(bar.high >= bar.low && bar.time > 0)) finish(() => reject(new Error('값 오류')));
        count++;
      }, null);
    } else {
      stop = feed.subscribeTickers(feed.coins, (t) => {
        if (!(t.price > 0 && Number.isFinite(t.changePct))) return finish(() => reject(new Error(`값 오류 ${JSON.stringify(t)}`)));
        seen.add(t.coin);
      });
    }
  });
}

const run = (fn) => fn().then((v) => `✅ ${v}`, (e) => `❌ ${e.message ?? e}`);

const rows = await Promise.all(feeds.map(async (feed) => [
  feed.name,
  await run(() => checkBars(feed)),
  await run(() => checkCors(feed)),
  await run(() => checkStream(feed, 'bars')),
  await run(() => checkStream(feed, 'tickers')),
]));

const table = [
  '| 거래소 | 과거 봉 | 브라우저 접근(CORS) | 실시간 봉 | 관심 목록 시세 |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 시세 연결 점검\n\n${table}\n`);
}
process.exit(0);
