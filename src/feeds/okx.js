import { fetchJson, normalizeBars, socket } from './common.js';

const REST = 'https://www.okx.com/api/v5/market';
const WS_PUBLIC = 'wss://ws.okx.com:8443/ws/v5/public';
const WS_BUSINESS = 'wss://ws.okx.com:8443/ws/v5/business';
// 일봉·주봉은 UTC 기준(…utc)을 써야 다른 거래소와 시간이 맞는다.
const BAR = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1Dutc', '1w': '1Wutc' };
const PING = { every: 25000, message: 'ping' };
const PAGES = 3; // 요청당 최대 300개

const subscribe = (args) => (ws) => ws.send(JSON.stringify({ op: 'subscribe', args }));
const toBar = (r) => ({ time: +r[0] / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] });

export const okx = {
  id: 'okx',
  name: 'OKX',
  quote: 'USDT',
  coins: ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'BNB'],
  market: (coin) => `${coin}-USDT`,
  probeUrl: `${REST}/candles?instId=BTC-USDT&bar=1H&limit=1`,

  async getBars(coin, interval) {
    const rows = [];
    let after = '';
    for (let page = 0; page < PAGES; page++) {
      const json = await fetchJson(`${REST}/candles?instId=${coin}-USDT&bar=${BAR[interval]}&limit=300${after}`);
      if (json.code !== '0') throw new Error(`OKX ${json.msg}`);
      if (!json.data.length) break;
      rows.push(...json.data);
      after = `&after=${json.data[json.data.length - 1][0]}`;
    }
    return normalizeBars(rows.map(toBar));
  },

  subscribeBars(coin, interval, onBar) {
    return socket(WS_BUSINESS, {
      ping: PING,
      onOpen: subscribe([{ channel: `candle${BAR[interval]}`, instId: `${coin}-USDT` }]),
      onMessage: (msg) => {
        if (msg.arg?.channel?.startsWith('candle') && msg.data) msg.data.forEach((r) => onBar(toBar(r)));
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS_PUBLIC, {
      ping: PING,
      onOpen: subscribe(coins.map((c) => ({ channel: 'tickers', instId: `${c}-USDT` }))),
      onMessage: (msg) => {
        if (msg.arg?.channel !== 'tickers' || !msg.data) return;
        for (const t of msg.data) {
          onTicker({ coin: t.instId.split('-')[0], price: +t.last, changePct: ((+t.last - +t.open24h) / +t.open24h) * 100 });
        }
      },
    });
  },
};
