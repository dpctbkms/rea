import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, bollinger, rsi, macd, vwap, heikinAshi } from '../src/indicators.js';

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
