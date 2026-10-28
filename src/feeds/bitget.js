import { cached, coinName, fetchJson, POPULAR, socket, sortMarkets } from './common.js';

const REST = 'https://api.bitget.com/api/v2/spot';
const WS = 'wss://ws.bitget.com/v2/ws/public';
const GRANULARITY = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1day', '1w': '1week' };
const CHANNEL = { '1m': 'candle1m', '5m': 'candle5m', '15m': 'candle15m', '1h': 'candle1H', '4h': 'candle4H', '1d': 'candle1D', '1w': 'candle1W' };
const PING = { every: 25000, message: 'ping' };

const subscribe = (args) => (ws) => ws.send(JSON.stringify({ op: 'subscribe', args }));
const toBar = (r) => ({ time: +r[0] / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] });

export const bitget = {
  id: 'bitget',
  name: '비트겟',
  quote: 'USDT',
  coins: POPULAR,
  market: (coin) => `${coin}USDT`,
  loadMarkets: cached(async () => {
    const json = await fetchJson(`${REST}/public/symbols`);
    return sortMarkets(json.data
      .filter((m) => m.quoteCoin === 'USDT' && m.status === 'online')
      .map((m) => ({ id: m.baseCoin, name: coinName(m.baseCoin) })));
  }),
  probeUrl: `${REST}/market/candles?symbol=BTCUSDT&granularity=1h&limit=1`,

  async getBars(coin, interval) {
    const json = await fetchJson(`${REST}/market/candles?symbol=${coin}USDT&granularity=${GRANULARITY[interval]}&limit=1000`);
    if (json.code !== '00000') throw new Error(`비트겟 ${json.msg}`);
    return json.data.map(toBar).sort((a, b) => a.time - b.time);
  },

  subscribeBars(coin, interval, onBar) {
    return socket(WS, {
      ping: PING,
      onOpen: subscribe([{ instType: 'SPOT', channel: CHANNEL[interval], instId: `${coin}USDT` }]),
      onMessage: (m) => {
        if (m.arg?.channel?.startsWith('candle') && m.data) m.data.forEach((r) => onBar(toBar(r)));
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS, {
      ping: PING,
      onOpen: subscribe(coins.map((c) => ({ instType: 'SPOT', channel: 'ticker', instId: `${c}USDT` }))),
      onMessage: (m) => {
        if (m.arg?.channel !== 'ticker' || !m.data) return;
        for (const t of m.data) onTicker({ coin: t.instId.replace(/USDT$/, ''), price: +t.lastPr, changePct: +t.change24h * 100 });
      },
    });
  },
};
