import { cached, coinName, fetchJson, POPULAR, socket, sortMarkets } from './common.js';

const REST = 'https://api.bybit.com/v5/market';
const WS = 'wss://stream.bybit.com/v5/public/spot';
const INTERVAL = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' };
const PING = { every: 20000, message: JSON.stringify({ op: 'ping' }) };

const subscribe = (args) => (ws) => ws.send(JSON.stringify({ op: 'subscribe', args }));

export const bybit = {
  id: 'bybit',
  name: '바이비트',
  quote: 'USDT',
  coins: POPULAR,
  market: (coin) => `${coin}USDT`,
  loadMarkets: cached(async () => {
    const json = await fetchJson(`${REST}/instruments-info?category=spot&limit=1000`);
    return sortMarkets(json.result.list
      .filter((m) => m.quoteCoin === 'USDT' && m.status === 'Trading')
      .map((m) => ({ id: m.baseCoin, name: coinName(m.baseCoin) })));
  }),
  probeUrl: `${REST}/kline?category=spot&symbol=BTCUSDT&interval=60&limit=1`,

  async getBars(coin, interval) {
    const json = await fetchJson(`${REST}/kline?category=spot&symbol=${coin}USDT&interval=${INTERVAL[interval]}&limit=1000`);
    if (json.retCode !== 0) throw new Error(`Bybit ${json.retMsg}`);
    // 최신 봉이 먼저 온다.
    return json.result.list.map((r) => ({
      time: +r[0] / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
    })).reverse();
  },

  subscribeBars(coin, interval, onBar) {
    return socket(WS, {
      ping: PING,
      onOpen: subscribe([`kline.${INTERVAL[interval]}.${coin}USDT`]),
      onMessage: (msg) => {
        if (!msg.topic?.startsWith('kline.')) return;
        for (const k of msg.data) {
          onBar({ time: k.start / 1000, open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume });
        }
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS, {
      ping: PING,
      onOpen: subscribe(coins.map((c) => `tickers.${c}USDT`)),
      onMessage: (msg) => {
        if (!msg.topic?.startsWith('tickers.')) return;
        const t = msg.data;
        onTicker({ coin: t.symbol.replace(/USDT$/, ''), price: +t.lastPrice, changePct: +t.price24hPcnt * 100 });
      },
    });
  },
};
