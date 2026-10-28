import { fetchJson, normalizeBars, poll } from './common.js';

// 주식·환율·지수 (Twelve Data). 무료 키가 필요하다: https://twelvedata.com/register
// 무료 한도(분당 8회, 하루 800회)에 맞춰 웹소켓 대신 주기적으로 조회한다.
const REST = 'https://api.twelvedata.com';
const INTERVAL = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1day', '1w': '1week' };
const BAR_EVERY = 2 * 60000;
const QUOTE_EVERY = 5 * 60000;

export const MARKETS = [
  { id: 'USD/KRW', name: '원·달러 환율' },
  { id: 'AAPL', name: '애플' },
  { id: 'NVDA', name: '엔비디아' },
  { id: 'TSLA', name: '테슬라' },
  { id: 'EUR/USD', name: '유로·달러' },
  { id: 'XAU/USD', name: '금 (온스당 달러)' },
  { id: 'MSFT', name: '마이크로소프트' },
  { id: 'AMZN', name: '아마존' },
  { id: 'GOOGL', name: '알파벳(구글)' },
  { id: 'META', name: '메타' },
  { id: 'SPY', name: 'S&P 500 ETF' },
  { id: 'QQQ', name: '나스닥 100 ETF' },
  { id: 'DIA', name: '다우존스 ETF' },
  { id: 'USD/JPY', name: '달러·엔' },
  { id: 'GBP/USD', name: '파운드·달러' },
  { id: 'USD/CNY', name: '달러·위안' },
  { id: 'XAG/USD', name: '은 (온스당 달러)' },
];

const toBar = (v) => ({
  time: Date.parse(v.datetime.length === 10 ? `${v.datetime}T00:00:00Z` : `${v.datetime.replace(' ', 'T')}Z`) / 1000,
  open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume ?? 0),
});

export const twelvedata = {
  id: 'twelvedata',
  name: '주식·환율 (Twelve Data)',
  quote: '',
  needsKey: true,
  allowCustom: true, // 목록에 없는 종목 코드도 직접 입력 가능
  apiKey: '',
  coins: MARKETS.slice(0, 6).map((m) => m.id), // 관심 목록은 무료 한도 때문에 6개
  market: (symbol) => symbol,
  loadMarkets: async () => MARKETS,
  probeUrl: `${REST}/time_series?symbol=AAPL&interval=1h&outputsize=1&apikey=demo`,
  // 점검 스크립트용: 무료 체험 키(demo)로 받을 수 있는 종목
  check: { apiKey: 'demo', symbol: 'AAPL', tickers: ['AAPL', 'EUR/USD'], maxAgeHours: 24 * 4, skipLiveBars: true },

  async request(path) {
    if (!this.apiKey) throw Object.assign(new Error('API 키가 필요합니다'), { code: 'NO_KEY' });
    const json = await fetchJson(`${REST}/${path}&timezone=UTC&apikey=${encodeURIComponent(this.apiKey)}`);
    if (json.status === 'error') throw Object.assign(new Error(json.message), { code: json.code === 401 ? 'BAD_KEY' : 'API' });
    return json;
  },

  async getBars(symbol, interval, size = 1000) {
    const json = await this.request(`time_series?symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL[interval]}&outputsize=${size}`);
    return normalizeBars(json.values.map(toBar));
  },

  subscribeBars(symbol, interval, onBar) {
    return poll(BAR_EVERY, async () => {
      for (const bar of await this.getBars(symbol, interval, 2)) onBar(bar);
    }, false);
  },

  subscribeTickers(symbols, onTicker) {
    return poll(QUOTE_EVERY, async () => {
      const json = await this.request(`quote?symbol=${symbols.map(encodeURIComponent).join(',')}`);
      // 종목이 하나면 결과가 바로 오고, 여럿이면 종목 코드별로 묶여 온다.
      const quotes = symbols.length === 1 ? { [symbols[0]]: json } : json;
      for (const [symbol, q] of Object.entries(quotes)) {
        if (q?.close) onTicker({ coin: symbol, price: +q.close, changePct: +q.percent_change });
      }
    });
  },
};
