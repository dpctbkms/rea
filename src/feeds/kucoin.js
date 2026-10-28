import { cached, coinName, fetchJson, POPULAR, socket, sortMarkets } from './common.js';

const REST = 'https://api.kucoin.com/api';
const TYPE = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1hour', '4h': '4hour', '1d': '1day', '1w': '1week' };
const PING = { every: 15000, get message() { return JSON.stringify({ id: String(Date.now()), type: 'ping' }); } };

// 쿠코인 웹소켓은 접속할 때마다 공개 토큰을 받아야 한다.
async function wsUrl() {
  const res = await fetch(`${REST}/v1/bullet-public`, { method: 'POST' });
  const { data } = await res.json();
  return `${data.instanceServers[0].endpoint}?token=${data.token}`;
}

const subscribe = (topic) => (ws) => ws.send(JSON.stringify({ id: String(Date.now()), type: 'subscribe', topic, response: true }));
// [time, open, close, high, low, volume, turnover]
const toBar = (r) => ({ time: +r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5] });

export const kucoin = {
  id: 'kucoin',
  name: '쿠코인',
  quote: 'USDT',
  coins: POPULAR,
  market: (coin) => `${coin}-USDT`,
  loadMarkets: cached(async () => {
    const json = await fetchJson(`${REST}/v2/symbols`);
    return sortMarkets(json.data
      .filter((m) => m.quoteCurrency === 'USDT' && m.enableTrading)
      .map((m) => ({ id: m.baseCurrency, name: coinName(m.baseCurrency) })));
  }),
  probeUrl: `${REST}/v1/market/candles?type=1hour&symbol=BTC-USDT`,

  async getBars(coin, interval) {
    const json = await fetchJson(`${REST}/v1/market/candles?type=${TYPE[interval]}&symbol=${coin}-USDT`);
    if (json.code !== '200000') throw new Error(`쿠코인 ${json.msg}`);
    return json.data.map(toBar).reverse();
  },

  subscribeBars(coin, interval, onBar) {
    return socket(wsUrl, {
      ping: PING,
      onOpen: subscribe(`/market/candles:${coin}-USDT_${TYPE[interval]}`),
      onMessage: (m) => {
        if (m.type === 'message' && m.data?.candles) onBar(toBar(m.data.candles));
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(wsUrl, {
      ping: PING,
      onOpen: subscribe(`/market/snapshot:${coins.map((c) => `${c}-USDT`).join(',')}`),
      onMessage: (m) => {
        const t = m.type === 'message' && m.data?.data;
        if (t) onTicker({ coin: t.baseCurrency, price: +t.lastTradedPrice, changePct: +t.changeRate * 100 });
      },
    });
  },
};
