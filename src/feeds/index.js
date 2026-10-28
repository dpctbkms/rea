import { binance } from './binance.js';
import { bybit } from './bybit.js';
import { okx } from './okx.js';
import { upbit, bithumb } from './upbit.js';
import { coinbase } from './coinbase.js';
import { DemoFeed } from './demo.js';

export { INTERVALS, COINS } from './common.js';
export { DemoFeed };

// API 키 없이 쓸 수 있는 무료 실시간 시세.
export const FEEDS = [upbit, bithumb, binance, bybit, okx, coinbase, new DemoFeed()];
