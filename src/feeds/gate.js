import { cached, coinName, fetchJson, POPULAR, socket, sortMarkets } from './common.js';

const REST = 'https://api.gateio.ws/api/v4/spot';
const WS = 'wss://api.gateio.ws/ws/v4/';
const INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '7d' };

const now = () => Math.floor(Date.now() / 1000);
const subscribe = (channel, payload) => (ws) => ws.send(JSON.stringify({ time: now(), channel, event: 'subscribe', payload }));
const PING = { every: 20000, get message() { return JSON.stringify({ time: now(), channel: 'spot.ping' }); } };

export const gate = {
  id: 'gate',
  name: '게이트',
  quote: 'USDT',
  coins: POPULAR,
  market: (coin) => `${coin}_USDT`,
  loadMarkets: cached(async () => {
    const rows = await fetchJson(`${REST}/currency_pairs`);
    return sortMarkets(rows
      .filter((m) => m.quote === 'USDT' && m.trade_status === 'tradable')
      .map((m) => ({ id: m.base, name: coinName(m.base) })));
  }),
  probeUrl: `${REST}/candlesticks?currency_pair=BTC_USDT&interval=1h&limit=1`,

  async getBars(coin, interval) {
    const rows = await fetchJson(`${REST}/candlesticks?currency_pair=${coin}_USDT&interval=${INTERVAL[interval]}&limit=1000`);
    // [time, quote_volume, close, high, low, open, base_volume, closed]
    return rows.map((r) => ({ time: +r[0], open: +r[5], high: +r[3], low: +r[4], close: +r[2], volume: +r[6] }));
  },

  subscribeBars(coin, interval, onBar) {
    return socket(WS, {
      ping: PING,
      onOpen: subscribe('spot.candlesticks', [INTERVAL[interval], `${coin}_USDT`]),
      onMessage: (m) => {
        if (m.channel !== 'spot.candlesticks' || m.event !== 'update') return;
        const k = m.result;
        onBar({ time: +k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.a });
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS, {
      ping: PING,
      onOpen: subscribe('spot.tickers', coins.map((c) => `${c}_USDT`)),
      onMessage: (m) => {
        if (m.channel !== 'spot.tickers' || m.event !== 'update') return;
        const t = m.result;
        onTicker({ coin: t.currency_pair.split('_')[0], price: +t.last, changePct: +t.change_percentage });
      },
    });
  },
};
