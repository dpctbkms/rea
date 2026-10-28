import { upbit, bithumb } from './upbit.js';
import { coinone } from './coinone.js';
import { korbit } from './korbit.js';
import { binance } from './binance.js';
import { bybit } from './bybit.js';
import { okx } from './okx.js';
import { bitget } from './bitget.js';
import { gate } from './gate.js';
import { kucoin } from './kucoin.js';
import { coinbase } from './coinbase.js';
import { kraken } from './kraken.js';
import { twelvedata } from './twelvedata.js';
import { DemoFeed } from './demo.js';

export { INTERVALS, COINS } from './common.js';
export { DemoFeed };

// 무료 실시간 시세. Twelve Data만 무료 API 키가 필요하다.
export const FEEDS = [
  upbit, bithumb, coinone, korbit,          // 원화
  binance, bybit, okx, bitget, gate, kucoin, // USDT
  coinbase, kraken,                          // 달러
  twelvedata,                                // 주식·환율·지수
  new DemoFeed(),
];
