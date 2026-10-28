import { cached, fetchJson, intervalSeconds, normalizeBars, socket, sortMarkets, tradeBarBuilder } from './common.js';

// 업비트와 빗썸은 같은 형식의 API를 제공한다.
// 캔들 스트림 대신 체결(trade) 스트림으로 현재 봉을 만든다.
const PAGES = 5; // 요청당 최대 200개
const PAGE_GAP_MS = 150; // 초당 요청 제한(약 10회)에 걸리지 않도록
const PING = { every: 60000, message: 'PING' };

const candlePath = (interval) => ({
  '1m': 'minutes/1', '5m': 'minutes/5', '15m': 'minutes/15', '1h': 'minutes/60', '4h': 'minutes/240',
  '1d': 'days', '1w': 'weeks',
})[interval];

function upbitStyleFeed({ id, name, rest, ws, coins, pageCursor }) {
  const request = (type, codes) => (sock) => sock.send(JSON.stringify([
    { ticket: `rea-${Math.random().toString(36).slice(2)}` },
    { type, codes },
    { format: 'DEFAULT' },
  ]));

  return {
    id,
    name,
    quote: 'KRW',
    coins,
    market: (coin) => `KRW-${coin}`,
    loadMarkets: cached(async () => {
      const rows = await fetchJson(`${rest}/market/all`);
      return sortMarkets(rows
        .filter((m) => m.market.startsWith('KRW-'))
        .map((m) => ({ id: m.market.slice(4), name: m.korean_name })));
    }),
    probeUrl: `${rest}/candles/minutes/60?market=KRW-BTC&count=1`,

    async getBars(coin, interval) {
      const rows = [];
      let to = '';
      for (let page = 0; page < PAGES; page++) {
        const data = await fetchJson(`${rest}/candles/${candlePath(interval)}?market=KRW-${coin}&count=200${to}`);
        if (!Array.isArray(data) || !data.length) break;
        rows.push(...data);
        to = `&to=${encodeURIComponent(pageCursor(data[data.length - 1]))}`;
        if (data.length < 200) break;
        await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
      }
      return normalizeBars(rows.map((r) => ({
        time: Date.parse(r.candle_date_time_utc + 'Z') / 1000,
        open: r.opening_price,
        high: r.high_price,
        low: r.low_price,
        close: r.trade_price,
        volume: r.candle_acc_trade_volume,
      })));
    },

    subscribeBars(coin, interval, onBar, lastBar) {
      const onTrade = tradeBarBuilder(intervalSeconds(interval), lastBar, onBar);
      return socket(ws, {
        ping: PING,
        onOpen: request('trade', [`KRW-${coin}`]),
        onMessage: (t) => {
          if (t.type === 'trade') onTrade(t.trade_price, t.trade_volume, t.trade_timestamp / 1000);
        },
      });
    },

    subscribeTickers(coinList, onTicker) {
      return socket(ws, {
        ping: PING,
        onOpen: request('ticker', coinList.map((c) => `KRW-${c}`)),
        onMessage: (t) => {
          if (t.type === 'ticker') onTicker({ coin: t.code.replace('KRW-', ''), price: t.trade_price, changePct: t.signed_change_rate * 100 });
        },
      });
    },
  };
}

export const upbit = upbitStyleFeed({
  id: 'upbit',
  name: '업비트',
  rest: 'https://api.upbit.com/v1',
  ws: 'wss://api.upbit.com/websocket/v1',
  pageCursor: (oldest) => `${oldest.candle_date_time_utc}Z`,
  coins: ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'],
});

export const bithumb = upbitStyleFeed({
  id: 'bithumb',
  name: '빗썸',
  rest: 'https://api.bithumb.com/v1',
  ws: 'wss://ws-api.bithumb.com/websocket/v1',
  // 빗썸은 'Z'가 붙은 시각을 거부하고, 시간대 없는 시각을 한국 시간으로 읽는다.
  pageCursor: (oldest) => oldest.candle_date_time_kst,
  coins: ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'],
});
