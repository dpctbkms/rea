import { cached, coinName, fetchJson, POPULAR, socket, sortMarkets } from './common.js';

const REST = 'https://api.kraken.com/0/public';
const WS = 'wss://ws.kraken.com/v2';
const MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 };
// 크라켄 REST는 옛 코드명을 쓴다 (XBT = BTC, XDG = DOGE).
const LEGACY = { XBT: 'BTC', XDG: 'DOGE' };

const subscribe = (params) => (ws) => ws.send(JSON.stringify({ method: 'subscribe', params }));

// 코인 -> REST 페어 이름 (예: BTC -> XBTUSD)
const pairs = cached(async () => {
  const json = await fetchJson(`${REST}/AssetPairs`);
  const map = new Map();
  for (const p of Object.values(json.result)) {
    const [base, quote] = p.wsname?.split('/') ?? [];
    if (quote === 'USD' && p.status === 'online') map.set(LEGACY[base] ?? base, p.altname);
  }
  return map;
});

export const kraken = {
  id: 'kraken',
  name: '크라켄',
  quote: 'USD',
  coins: POPULAR.filter((c) => c !== 'BNB'),
  market: (coin) => `${coin}/USD`,
  loadMarkets: async () => sortMarkets([...(await pairs()).keys()].map((id) => ({ id, name: coinName(id) }))),
  probeUrl: `${REST}/OHLC?pair=XBTUSD&interval=60`,

  async getBars(coin, interval) {
    const pair = (await pairs()).get(coin);
    if (!pair) throw new Error(`크라켄에 ${coin}/USD 없음`);
    const json = await fetchJson(`${REST}/OHLC?pair=${pair}&interval=${MINUTES[interval]}`);
    if (json.error?.length) throw new Error(`크라켄 ${json.error.join(', ')}`);
    const rows = Object.entries(json.result).find(([key]) => key !== 'last')[1];
    // [time, open, high, low, close, vwap, volume, count]
    return rows.map((r) => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[6] }));
  },

  subscribeBars(coin, interval, onBar) {
    return socket(WS, {
      onOpen: subscribe({ channel: 'ohlc', symbol: [`${coin}/USD`], interval: MINUTES[interval] }),
      onMessage: (m) => {
        if (m.channel !== 'ohlc' || !m.data) return;
        for (const k of m.data) {
          onBar({ time: Date.parse(k.interval_begin) / 1000, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume });
        }
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS, {
      onOpen: subscribe({ channel: 'ticker', symbol: coins.map((c) => `${c}/USD`) }),
      onMessage: (m) => {
        if (m.channel !== 'ticker' || !m.data) return;
        for (const t of m.data) onTicker({ coin: t.symbol.split('/')[0], price: t.last, changePct: t.change_pct });
      },
    });
  },
};
