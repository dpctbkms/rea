import { ALL_COINS, bucketStart, intervalSeconds } from './common.js';

// 네트워크 없이 동작하는 결정적 랜덤워크 피드.
const BASE = { BTC: 67000, ETH: 3400, XRP: 0.55, SOL: 150, DOGE: 0.13, ADA: 0.45, AVAX: 30, LINK: 14, DOT: 6.5, BNB: 580 };

export class DemoFeed {
  id = 'demo';
  name = '데모';
  quote = 'USDT';
  coins = ALL_COINS;
  market = (coin) => `${coin}USDT`;
  #last = new Map();

  async getBars(coin, interval, limit = 1000) {
    const step = intervalSeconds(interval);
    const now = bucketStart(Date.now() / 1000, step);
    const rand = mulberry32(hash(coin + interval));
    const base = BASE[coin] ?? 100;
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
    // 마지막 종가가 기준가에 오도록 전체를 스케일해 관심 목록 가격과 맞춘다.
    const scale = base / bars[bars.length - 1].close;
    for (const b of bars) for (const k of ['open', 'high', 'low', 'close']) b[k] *= scale;
    this.#last.set(`${coin}:${interval}`, { ...bars[bars.length - 1] });
    return bars;
  }

  subscribeBars(coin, interval, onBar) {
    const step = intervalSeconds(interval);
    const key = `${coin}:${interval}`;
    const id = setInterval(() => {
      let bar = this.#last.get(key);
      if (!bar) return;
      const t = bucketStart(Date.now() / 1000, step);
      if (t > bar.time) bar = { time: t, open: bar.close, high: bar.close, low: bar.close, close: bar.close, volume: 0 };
      const close = bar.close * (1 + (Math.random() - 0.5) * 0.0015);
      bar = { ...bar, close, high: Math.max(bar.high, close), low: Math.min(bar.low, close), volume: bar.volume + Math.round(Math.random() * 20) };
      this.#last.set(key, bar);
      onBar({ ...bar });
    }, 1000);
    return () => clearInterval(id);
  }

  subscribeTickers(coins, onTicker) {
    const state = new Map(coins.map((s) => {
      const base = BASE[s] ?? 100;
      return [s, { open: base, price: base * (1 + (Math.random() - 0.5) * 0.06) }];
    }));
    const emit = () => {
      for (const [coin, s] of state) {
        s.price *= 1 + (Math.random() - 0.5) * 0.002;
        onTicker({ coin, price: s.price, changePct: ((s.price - s.open) / s.open) * 100 });
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
