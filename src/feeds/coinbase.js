import { aggregateBars, fetchJson, intervalSeconds, normalizeBars, socket, tradeBarBuilder } from './common.js';

const REST = 'https://api.exchange.coinbase.com';
const WS = 'wss://ws-feed.exchange.coinbase.com';
const PAGES = 4; // 요청당 최대 300개

// 코인베이스에는 4시간봉·주봉이 없어서 1시간봉·일봉을 받아 합친다.
const SOURCE = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 3600, '1d': 86400, '1w': 86400 };

const subscribe = (productIds) => (ws) => ws.send(JSON.stringify({ type: 'subscribe', product_ids: productIds, channels: ['ticker'] }));

export const coinbase = {
  id: 'coinbase',
  name: '코인베이스',
  quote: 'USD',
  coins: ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'],
  market: (coin) => `${coin}-USD`,
  probeUrl: `${REST}/products/BTC-USD/candles?granularity=3600`,

  async getBars(coin, interval) {
    const granularity = SOURCE[interval];
    const rows = [];
    let end = Math.floor(Date.now() / 1000);
    for (let page = 0; page < PAGES; page++) {
      const start = end - granularity * 300;
      const iso = (t) => new Date(t * 1000).toISOString();
      const data = await fetchJson(`${REST}/products/${coin}-USD/candles?granularity=${granularity}&start=${iso(start)}&end=${iso(end)}`);
      if (!Array.isArray(data) || !data.length) break;
      rows.push(...data);
      end = start - granularity;
    }
    // [time, low, high, open, close, volume]
    const bars = normalizeBars(rows.map((r) => ({ time: r[0], low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] })));
    const step = intervalSeconds(interval);
    return step === granularity ? bars : aggregateBars(bars, step);
  },

  subscribeBars(coin, interval, onBar, lastBar) {
    const onTrade = tradeBarBuilder(intervalSeconds(interval), lastBar, onBar);
    return socket(WS, {
      onOpen: subscribe([`${coin}-USD`]),
      onMessage: (t) => {
        if (t.type === 'ticker') onTrade(+t.price, +t.last_size || 0, Date.parse(t.time) / 1000);
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS, {
      onOpen: subscribe(coins.map((c) => `${c}-USD`)),
      onMessage: (t) => {
        if (t.type === 'ticker') onTicker({ coin: t.product_id.split('-')[0], price: +t.price, changePct: ((+t.price - +t.open_24h) / +t.open_24h) * 100 });
      },
    });
  },
};
