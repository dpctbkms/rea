// 모든 피드가 공유하는 정의와 도우미.
//
// 피드 인터페이스:
//   id, name, quote               식별자, 표시 이름, 호가 통화(USDT, KRW, USD)
//   coins                         기본 관심 목록
//   loadMarkets()                 -> Promise<{id, name}[]>  상장 종목 전체 (검색용)
//   market(coin)                  거래소 마켓 코드 (예: BTCUSDT, KRW-BTC)
//   getBars(coin, interval)       -> Promise<bar[]>  (time은 UTC 초, 오래된 순)
//   subscribeBars(coin, interval, onBar)   -> unsubscribe()
//   subscribeTickers(coins, onTicker)      -> unsubscribe()  ({coin, price, changePct})

export const INTERVALS = [
  { id: '1m', label: '1분', seconds: 60 },
  { id: '5m', label: '5분', seconds: 300 },
  { id: '15m', label: '15분', seconds: 900 },
  { id: '1h', label: '1시간', seconds: 3600 },
  { id: '4h', label: '4시간', seconds: 14400 },
  { id: '1d', label: '1일', seconds: 86400 },
  { id: '1w', label: '1주', seconds: 604800 },
];

export const COINS = [
  { id: 'BTC', name: '비트코인' },
  { id: 'ETH', name: '이더리움' },
  { id: 'XRP', name: '리플' },
  { id: 'SOL', name: '솔라나' },
  { id: 'DOGE', name: '도지코인' },
  { id: 'ADA', name: '에이다' },
  { id: 'AVAX', name: '아발란체' },
  { id: 'LINK', name: '체인링크' },
  { id: 'DOT', name: '폴카닷' },
  { id: 'BNB', name: 'BNB' },
];

export const ALL_COINS = COINS.map((c) => c.id);
export const POPULAR = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'BNB'];

const KOREAN_NAMES = Object.fromEntries(COINS.map((c) => [c.id, c.name]));
export const coinName = (id) => KOREAN_NAMES[id] ?? '';

// 종목 목록을 한 번만 불러오도록 감싼다. 실패하면 다음 호출 때 다시 시도.
export function cached(load) {
  let promise;
  return () => (promise ??= load().catch((err) => { promise = null; throw err; }));
}

// 정렬: 인기 코인 먼저, 나머지는 알파벳 순.
export function sortMarkets(list) {
  const rank = (id) => { const i = POPULAR.indexOf(id); return i < 0 ? 999 : i; };
  return list.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export const intervalSeconds = (id) => INTERVALS.find((i) => i.id === id).seconds;

// 1970-01-01은 목요일이라, 주봉은 월요일(1970-01-05) 00:00 UTC 기준으로 자른다.
const WEEK_ORIGIN = 4 * 86400;

export function bucketStart(timeSec, step) {
  if (step === 604800) return Math.floor((timeSec - WEEK_ORIGIN) / step) * step + WEEK_ORIGIN;
  return Math.floor(timeSec / step) * step;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 여러 주소를 순서대로 시도해 처음 성공한 JSON을 돌려준다(지역 차단 대비).
// 요청이 너무 잦다고 거절(429)되면 잠시 쉬었다가 한 번 더 시도한다. 브라우저에서는 이런 거절이
// CORS 헤더 없이 와서 상태 코드 대신 네트워크 오류로 보이므로, 오류도 같은 방식으로 다룬다.
export async function fetchJson(urls) {
  let lastError;
  for (const url of [urls].flat()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(700);
      try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
        lastError = new Error(`${new URL(url).host} ${res.status}`);
        if (res.status !== 429) break;
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError;
}

// 시간 중복을 없애고 오래된 순으로 정렬.
export function normalizeBars(bars) {
  const byTime = new Map();
  for (const b of bars) {
    if ([b.open, b.high, b.low, b.close].every(Number.isFinite)) byTime.set(b.time, b);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// 작은 봉을 큰 봉으로 합친다 (예: 1시간봉 -> 4시간봉).
export function aggregateBars(bars, step) {
  const out = [];
  for (const b of bars) {
    const time = bucketStart(b.time, step);
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ ...b, time });
    }
  }
  return out;
}

// 체결(가격, 수량) 스트림으로 현재 봉을 만들어 간다. 캔들 스트림이 없는 거래소용.
export function tradeBarBuilder(step, lastBar, onBar) {
  let bar = lastBar ? { ...lastBar } : null;
  return (price, qty, timeSec) => {
    const time = bucketStart(timeSec, step);
    if (bar && time < bar.time) return;
    if (!bar || time > bar.time) {
      bar = { time, open: price, high: price, low: price, close: price, volume: 0 };
    }
    bar.close = price;
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.volume += qty;
    onBar({ ...bar });
  };
}

// 자동 재연결과 핑을 갖춘 웹소켓.
//   url              주소, 또는 주소를 돌려주는 (비동기) 함수 — 접속 토큰이 필요한 거래소용.
//   onOpen(ws)       연결될 때마다 구독 메시지를 보낸다.
//   onMessage(msg)   JSON으로 파싱된 메시지 (파싱 안 되는 pong 등은 무시).
//   ping             { every: ms, message: string } 연결 유지용.
export function socket(url, { onOpen, onMessage, ping }) {
  let ws, closed = false, retry = 0, retryTimer, pingTimer;
  const decoder = new TextDecoder();
  const retryLater = () => {
    if (!closed) retryTimer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
  };
  const open = async () => {
    let target;
    try { target = typeof url === 'function' ? await url() : url; } catch { return retryLater(); }
    if (closed) return;
    ws = new WebSocket(target);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      retry = 0;
      onOpen?.(ws);
      if (ping) pingTimer = setInterval(() => ws.readyState === 1 && ws.send(ping.message), ping.every);
    };
    ws.onmessage = (e) => {
      const text = typeof e.data === 'string' ? e.data : decoder.decode(e.data);
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      onMessage(msg);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      retryLater();
    };
    ws.onerror = () => {};
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    ws?.close();
  };
}

// 웹소켓이 없는 시세용 주기적 조회. 실패는 다음 주기에 다시 시도한다.
// immediate가 false면 첫 조회도 한 주기 뒤에 한다(방금 받은 데이터를 또 받지 않도록).
export function poll(every, fn, immediate = true) {
  let stopped = false;
  const tick = async () => { try { await fn(); } catch { /* 다음 주기에 재시도 */ } };
  if (immediate) tick();
  const id = setInterval(() => !stopped && tick(), every);
  return () => { stopped = true; clearInterval(id); };
}
