import { cached, coinName, fetchJson, intervalSeconds, normalizeBars, POPULAR, socket, sortMarkets, tradeBarBuilder } from './common.js';

const REST = 'https://api.korbit.co.kr/v2';
const WS = 'wss://ws-api.korbit.co.kr/v2/public';
const INTERVAL = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': '1D', '1w': '1W' };
const PAGES = 5; // 요청당 최대 200개

const pair = (coin) => `${coin.toLowerCase()}_krw`;
const subscribe = (type, coins) => (ws) => ws.send(JSON.stringify([{ method: 'subscribe', type, symbols: coins.map(pair) }]));

export const korbit = {
  id: 'korbit',
  name: '코빗',
  quote: 'KRW',
  coins: POPULAR.filter((c) => c !== 'BNB'),
  market: (coin) => pair(coin).toUpperCase(),
  loadMarkets: cached(async () => {
    const json = await fetchJson(`${REST}/currencyPairs`);
    return sortMarkets(json.data
      .filter((m) => m.symbol.endsWith('_krw') && m.status === 'launched')
      .map((m) => { const id = m.symbol.split('_')[0].toUpperCase(); return { id, name: coinName(id) }; }));
  }),
  probeUrl: `${REST}/candles?symbol=btc_krw&interval=60&limit=1`,

  async getBars(coin, interval) {
    const rows = [];
    let end = '';
    for (let page = 0; page < PAGES; page++) {
      const json = await fetchJson(`${REST}/candles?symbol=${pair(coin)}&interval=${INTERVAL[interval]}&limit=200${end}`);
      if (!json.success) throw new Error(`코빗 ${json.error?.message ?? ''}`);
      if (!json.data.length) break;
      rows.push(...json.data);
      end = `&end=${Math.min(...json.data.map((r) => r.timestamp)) - 1}`;
      if (json.data.length < 200) break;
    }
    return normalizeBars(rows.map((r) => ({
      time: r.timestamp / 1000, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume,
    })));
  },

  subscribeBars(coin, interval, onBar, lastBar) {
    const onTrade = tradeBarBuilder(intervalSeconds(interval), lastBar, onBar);
    return socket(WS, {
      onOpen: subscribe('trade', [coin]),
      onMessage: (m) => {
        if (m.type === 'trade' && Array.isArray(m.data)) m.data.forEach((t) => onTrade(+t.price, +t.qty, t.timestamp / 1000));
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS, {
      onOpen: subscribe('ticker', coins),
      onMessage: (m) => {
        if (m.type !== 'ticker' || !m.data) return;
        onTicker({ coin: m.symbol.split('_')[0].toUpperCase(), price: +m.data.close, changePct: +m.data.priceChangePercent });
      },
    });
  },
};
