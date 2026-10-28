import { fetchJson, socket } from './common.js';

// api.binance.com이 막힌 지역에서는 시세 전용 미러(binance.vision)로 넘어간다.
const REST = ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3'];
const WS = 'wss://data-stream.binance.vision';

export const binance = {
  id: 'binance',
  name: '바이낸스',
  quote: 'USDT',
  coins: ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'BNB'],
  market: (coin) => `${coin}USDT`,
  probeUrl: `${REST[0]}/klines?symbol=BTCUSDT&interval=1h&limit=1`,

  async getBars(coin, interval) {
    const rows = await fetchJson(REST.map((r) => `${r}/klines?symbol=${coin}USDT&interval=${interval}&limit=1000`));
    return rows.map((r) => ({
      time: r[0] / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
    }));
  },

  subscribeBars(coin, interval, onBar) {
    return socket(`${WS}/ws/${coin.toLowerCase()}usdt@kline_${interval}`, {
      onMessage: ({ k }) => {
        if (k) onBar({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    const streams = coins.map((c) => `${c.toLowerCase()}usdt@miniTicker`).join('/');
    return socket(`${WS}/stream?streams=${streams}`, {
      onMessage: ({ data: t }) => {
        if (t) onTicker({ coin: t.s.replace(/USDT$/, ''), price: +t.c, changePct: ((+t.c - +t.o) / +t.o) * 100 });
      },
    });
  },
};
