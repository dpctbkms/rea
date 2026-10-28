import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBars, bucketStart, normalizeBars, tradeBarBuilder } from '../src/feeds/common.js';

test('weekly buckets start on Monday 00:00 UTC', () => {
  const wed = Date.parse('2026-10-28T15:00:00Z') / 1000;
  assert.equal(new Date(bucketStart(wed, 604800) * 1000).toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(bucketStart(3600 * 5 + 10, 3600), 3600 * 5);
});

test('normalizeBars sorts, de-duplicates and drops broken rows', () => {
  const bars = normalizeBars([
    { time: 3, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time: 3, open: 2, high: 2, low: 2, close: 2, volume: 2 },
    { time: 2, open: NaN, high: 1, low: 1, close: 1, volume: 1 },
  ]);
  assert.deepEqual(bars.map((b) => [b.time, b.close]), [[1, 1], [3, 2]]);
});

test('aggregateBars merges hourly bars into 4h bars', () => {
  const hours = [0, 1, 2, 3, 4].map((h) => ({ time: h * 3600, open: h + 1, high: h + 2, low: h, close: h + 1.5, volume: 1 }));
  const out = aggregateBars(hours, 14400);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { time: 0, open: 1, high: 5, low: 0, close: 4.5, volume: 4 });
  assert.equal(hours[0].high, 2, 'input is not mutated');
});

test('tradeBarBuilder updates the current bar and rolls over', () => {
  const seen = [];
  const onTrade = tradeBarBuilder(60, { time: 120, open: 10, high: 11, low: 9, close: 10, volume: 5 }, (b) => seen.push(b));
  onTrade(12, 1, 150);
  onTrade(8, 2, 170);
  onTrade(9, 1, 100); // 이전 봉 체결은 무시
  onTrade(9.5, 3, 185);
  assert.deepEqual(seen[1], { time: 120, open: 10, high: 12, low: 8, close: 8, volume: 8 });
  assert.deepEqual(seen[2], { time: 180, open: 9.5, high: 9.5, low: 9.5, close: 9.5, volume: 3 });
  assert.equal(seen.length, 3);
});
