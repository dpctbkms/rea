import { cached, coinName, fetchJson, intervalSeconds, normalizeBars, POPULAR, socket, sortMarkets, tradeBarBuilder } from './common.js';

const REST = 'https://api.coinone.co.kr/public/v2';
const WS = 'wss://stream.coinone.co.kr';
const PAGES = 2; // 요청당 최대 500개
const PING = { every: 5 * 60000, message: JSON.stringify({ request_type: 'PING' }) };

const subscribe = (channel, coins) => (ws) => coins.forEach((c) => ws.send(JSON.stringify({
  request_type: 'SUBSCRIBE', channel, topic: { quote_currency: 'KRW', target_currency: c },
})));

export const coinone = {
  id: 'coinone',
  name: '코인원',
  quote: 'KRW',
  coins: POPULAR.filter((c) => c !== 'BNB'),
  market: (coin) => `${coin}-KRW`,
  loadMarkets: cached(async () => {
    const json = await fetchJson(`${REST}/markets/KRW`);
    return sortMarkets(json.markets.map((m) => ({ id: m.target_currency, name: coinName(m.target_currency) })));
  }),
  probeUrl: `${REST}/chart/KRW/BTC?interval=1h&size=1`,

  async getBars(coin, interval) {
    const rows = [];
    let before = '';
    for (let page = 0; page < PAGES; page++) {
      const json = await fetchJson(`${REST}/chart/KRW/${coin}?interval=${interval}&size=500${before}`);
      if (json.result !== 'success') throw new Error(`코인원 ${json.error_code}`);
      if (!json.chart.length) break;
      rows.push(...json.chart);
      before = `&timestamp=${Math.min(...json.chart.map((r) => r.timestamp)) - 1}`;
      if (json.is_last) break;
    }
    return normalizeBars(rows.map((r) => ({
      time: r.timestamp / 1000, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.target_volume,
    })));
  },

  subscribeBars(coin, interval, onBar, lastBar) {
    const onTrade = tradeBarBuilder(intervalSeconds(interval), lastBar, onBar);
    return socket(WS, {
      ping: PING,
      onOpen: subscribe('TRADE', [coin]),
      onMessage: (m) => {
        if (m.channel === 'TRADE' && m.data) onTrade(+m.data.price, +m.data.qty, m.data.timestamp / 1000);
      },
    });
  },

  subscribeTickers(coins, onTicker) {
    return socket(WS, {
      ping: PING,
      onOpen: subscribe('TICKER', coins),
      onMessage: (m) => {
        if (m.channel !== 'TICKER' || !m.data) return;
        const t = m.data;
        onTicker({ coin: t.target_currency.toUpperCase(), price: +t.last, changePct: ((+t.last - +t.yesterday_last) / +t.yesterday_last) * 100 });
      },
    });
  },
};
