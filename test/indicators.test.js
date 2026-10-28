import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sma, ema, bollinger, rsi, macd, vwap, heikinAshi,
  rsiArr, src, emaArr, wmaArr, keltner, donchian, ichimoku, psar, supertrend, stochastic, stochRsi,
  cci, williamsR, atr, adx, obv, mfi, roc, momentum, cmf,
} from '../src/indicators.js';

const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
  45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
const bars = closes.map((c, i) => ({
  time: 1_700_000_000 + i * 3600, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 10 + i,
}));

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('sma averages a sliding window and skips the warm-up', () => {
  const out = sma(bars, 5);
  assert.equal(out.length, bars.length - 4);
  assert.equal(out[0].time, bars[4].time);
  near(out[0].value, (44.34 + 44.09 + 44.15 + 43.61 + 44.33) / 5);
});

test('ema seeds with the sma and then weights recent prices', () => {
  const out = ema(bars, 5);
  near(out[0].value, sma(bars, 5)[0].value);
  const k = 2 / 6;
  near(out[1].value, closes[5] * k + out[0].value * (1 - k));
});

test('rsi matches the classic Wilder example', () => {
  const out = rsi(bars, 14);
  assert.equal(out[0].time, bars[14].time);
  near(out[0].value, 70.464, 0.01);
});

test('rsi of a flat series is neutral', () => {
  const flat = bars.map((b) => ({ ...b, close: 10 }));
  assert.ok(rsi(flat, 14).every((p) => p.value === 50));
});

test('bollinger bands are symmetric around the sma', () => {
  const { middle, upper, lower } = bollinger(bars, 10, 2);
  const s = sma(bars, 10);
  middle.forEach((p, i) => {
    near(p.value, s[i].value);
    near(upper[i].value - p.value, p.value - lower[i].value);
  });
});

test('macd histogram is macd minus signal', () => {
  const long = Array.from({ length: 60 }, (_, i) => ({ ...bars[0], time: bars[0].time + i * 60, close: 100 + Math.sin(i / 4) * 5 }));
  const { macd: line, signal, histogram } = macd(long);
  assert.equal(line.length, 60 - 25);
  assert.equal(signal.length, line.length - 8);
  const lineByTime = new Map(line.map((p) => [p.time, p.value]));
  histogram.forEach((h, i) => near(h.value, lineByTime.get(h.time) - signal[i].value));
});

test('vwap resets at each UTC day', () => {
  const day = 86400 * 20000;
  const v = vwap([
    { time: day + 10, high: 11, low: 9, close: 10, volume: 1 },
    { time: day + 20, high: 21, low: 19, close: 20, volume: 3 },
    { time: day + 86400, high: 6, low: 4, close: 5, volume: 2 },
  ]);
  near(v[1].value, (10 + 60) / 4);
  near(v[2].value, 5);
});

test('heikin ashi keeps highs and lows outside the body', () => {
  heikinAshi(bars).forEach((b) => {
    assert.ok(b.high >= Math.max(b.open, b.close));
    assert.ok(b.low <= Math.min(b.open, b.close));
  });
});

// ---------- 추가 지표 ----------

const wave = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + Math.sin(i / 9) * 8 + i * 0.05;
  return { time: 1_700_000_000 + i * 3600, open: c - 0.4, high: c + 1 + (i % 3) * 0.2, low: c - 1 - (i % 4) * 0.2, close: c, volume: 100 + (i % 7) * 10 };
});
const inRange = (pts, lo, hi) => pts.every((p) => p.value >= lo - 1e-9 && p.value <= hi + 1e-9);

test('rsiArr matches the point-based rsi', () => {
  const a = rsiArr(src(bars), 14).filter(Number.isFinite);
  rsi(bars, 14).forEach((p, i) => near(p.value, a[i]));
});

test('ema and wma arrays agree with hand calculations', () => {
  near(emaArr(closes, 5)[4], (44.34 + 44.09 + 44.15 + 43.61 + 44.33) / 5);
  near(wmaArr([1, 2, 3], 3)[2], (1 + 4 + 9) / 6);
});

test('oscillators stay inside their ranges', () => {
  const { k, d } = stochastic(wave);
  assert.ok(k.length > 250 && inRange(k, 0, 100) && inRange(d, 0, 100));
  assert.ok(inRange(stochRsi(wave).k, 0, 100));
  assert.ok(inRange(williamsR(wave).value, -100, 0));
  assert.ok(inRange(mfi(wave).value, 0, 100));
  const a = adx(wave);
  assert.ok(inRange(a.adx, 0, 100) && inRange(a.plus, 0, 100) && inRange(a.minus, 0, 100));
  assert.ok(inRange(cmf(wave).value, -1, 1));
});

test('channels keep upper >= middle >= lower', () => {
  for (const c of [keltner(wave), donchian(wave)]) {
    c.upper.forEach((u, i) => assert.ok(u.value >= c.middle[i].value && c.middle[i].value >= c.lower[i].value));
  }
});

test('atr is positive and cci/roc/momentum produce values', () => {
  assert.ok(atr(wave).value.every((p) => p.value > 0));
  assert.ok(cci(wave).value.length > 250);
  near(roc(wave, 1).value[0].value, (100 * (wave[1].close - wave[0].close)) / wave[0].close);
  near(momentum(wave, 1).value[0].value, wave[1].close - wave[0].close);
});

test('obv adds volume on up closes and subtracts on down closes', () => {
  const o = obv([
    { time: 1, close: 1, volume: 5 }, { time: 2, close: 2, volume: 3 }, { time: 3, close: 1.5, volume: 2 }, { time: 4, close: 1.5, volume: 9 },
  ]).value.map((p) => p.value);
  assert.deepEqual(o, [0, 3, 1, 1]);
});

test('ichimoku leading spans extend into the future', () => {
  const ich = ichimoku(wave, 9, 26, 52, 26, 3600);
  const last = wave[wave.length - 1].time;
  assert.equal(ich.spanA[ich.spanA.length - 1].time, last + 25 * 3600);
  assert.equal(ich.chikou[ich.chikou.length - 1].time, wave[wave.length - 26].time);
});

test('parabolic sar sits below lows in an uptrend', () => {
  const up = Array.from({ length: 60 }, (_, i) => ({ time: i, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 }));
  psar(up).value.slice(5).forEach((p, i) => assert.ok(p.value <= up[i + 6].low));
});

test('supertrend is either up or down at every bar after warm-up', () => {
  const { up, down } = supertrend(wave);
  const has = (pts) => new Set(pts.filter((p) => 'value' in p).map((p) => p.time));
  const u = has(up), d = has(down);
  wave.slice(20).forEach((b) => assert.ok(u.has(b.time) !== d.has(b.time)));
});
