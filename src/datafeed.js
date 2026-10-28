// 데이터 피드. 두 구현이 같은 인터페이스를 가진다:
//   getBars(symbol, interval, limit)  -> Promise<bar[]>   (time은 UTC 초 단위)
//   subscribeBars(symbol, interval, onBar) -> unsubscribe()
//   subscribeTickers(symbols, onTicker)    -> unsubscribe()   ({symbol, price, changePct})

export const INTERVALS = [
  { id: '1m', label: '1분', seconds: 60 },
  { id: '5m', label: '5분', seconds: 300 },
  { id: '15m', label: '15분', seconds: 900 },
  { id: '1h', label: '1시간', seconds: 3600 },
  { id: '4h', label: '4시간', seconds: 14400 },
  { id: '1d', label: '1일', seconds: 86400 },
  { id: '1w', label: '1주', seconds: 604800 },
];

export const SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', base: 67000 },
  { symbol: 'ETHUSDT', name: 'Ethereum', base: 3400 },
  { symbol: 'SOLUSDT', name: 'Solana', base: 150 },
  { symbol: 'BNBUSDT', name: 'BNB', base: 580 },
  { symbol: 'XRPUSDT', name: 'XRP', base: 0.55 },
  { symbol: 'DOGEUSDT', name: 'Dogecoin', base: 0.13 },
  { symbol: 'ADAUSDT', name: 'Cardano', base: 0.45 },
  { symbol: 'AVAXUSDT', name: 'Avalanche', base: 30 },
  { symbol: 'LINKUSDT', name: 'Chainlink', base: 14 },
  { symbol: 'DOTUSDT', name: 'Polkadot', base: 6.5 },
];

const intervalSeconds = (id) => INTERVALS.find((i) => i.id === id).seconds;

export class BinanceFeed {
  name = 'Binance';
  rest = 'https://api.binance.com/api/v3';
  ws = 'wss://stream.binance.com:9443';

  async getBars(symbol, interval, limit = 1000) {
    const res = await fetch(`${this.rest}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const rows = await res.json();
    return rows.map((r) => ({
      time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
    }));
  }

  subscribeBars(symbol, interval, onBar) {
    return this.#stream(`${symbol.toLowerCase()}@kline_${interval}`, (m) => {
      const k = m.k;
      onBar({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    });
  }

  subscribeTickers(symbols, onTicker) {
    const streams = symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
    return this.#stream(streams, (m) => {
      const t = m.data ?? m;
      onTicker({ symbol: t.s, price: +t.c, changePct: ((+t.c - +t.o) / +t.o) * 100 });
    }, true);
  }

  // 끊기면 지수 백오프로 재연결한다.
  #stream(path, onMessage, combined = false) {
    let ws, closed = false, retry = 0, timer;
    const open = () => {
      ws = new WebSocket(combined ? `${this.ws}/stream?streams=${path}` : `${this.ws}/ws/${path}`);
      ws.onopen = () => { retry = 0; };
      ws.onmessage = (e) => onMessage(JSON.parse(e.data));
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws.close(); };
  }
}

// 네트워크 없이 동작하는 결정적 랜덤워크 피드.
export class DemoFeed {
  name = '데모';
  #last = new Map();

  async getBars(symbol, interval, limit = 1000) {
    const step = intervalSeconds(interval);
    const now = Math.floor(Date.now() / 1000 / step) * step;
    const rand = mulberry32(hash(symbol + interval));
    const base = SYMBOLS.find((s) => s.symbol === symbol)?.base ?? 100;
    const vol = 0.0008 * Math.sqrt(step / 60);
    const bars = [];
    let price = base;
    for (let i = limit - 1; i >= 0; i--) {
      const open = price;
      const drift = (rand() - 0.5) * vol * 2;
      const close = open * (1 + drift);
      const high = Math.max(open, close) * (1 + rand() * vol);
      const low = Math.min(open, close) * (1 - rand() * vol);
      bars.push({ time: now - i * step, open, high, low, close, volume: Math.round(50 + rand() * 950 * (1 + Math.abs(drift) * 200)) });
      price = close;
    }
    // 마지막 종가가 기준가 근처에 오도록 전체를 스케일해 관심 목록 가격과 맞춘다.
    const scale = base / bars[bars.length - 1].close;
    for (const b of bars) for (const k of ['open', 'high', 'low', 'close']) b[k] *= scale;
    this.#last.set(`${symbol}:${interval}`, { ...bars[bars.length - 1] });
    return bars;
  }

  subscribeBars(symbol, interval, onBar) {
    const step = intervalSeconds(interval);
    const key = `${symbol}:${interval}`;
    const id = setInterval(() => {
      let bar = this.#last.get(key);
      if (!bar) return;
      const t = Math.floor(Date.now() / 1000 / step) * step;
      if (t > bar.time) bar = { time: t, open: bar.close, high: bar.close, low: bar.close, close: bar.close, volume: 0 };
      const close = bar.close * (1 + (Math.random() - 0.5) * 0.0015);
      bar = { ...bar, close, high: Math.max(bar.high, close), low: Math.min(bar.low, close), volume: bar.volume + Math.round(Math.random() * 20) };
      this.#last.set(key, bar);
      onBar({ ...bar });
    }, 1000);
    return () => clearInterval(id);
  }

  subscribeTickers(symbols, onTicker) {
    const state = new Map(symbols.map((s) => {
      const base = SYMBOLS.find((x) => x.symbol === s)?.base ?? 100;
      return [s, { open: base, price: base * (1 + (Math.random() - 0.5) * 0.06) }];
    }));
    const emit = () => {
      for (const [symbol, s] of state) {
        s.price *= 1 + (Math.random() - 0.5) * 0.002;
        onTicker({ symbol, price: s.price, changePct: ((s.price - s.open) / s.open) * 100 });
      }
    };
    emit();
    const id = setInterval(emit, 2000);
    return () => clearInterval(id);
  }
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
