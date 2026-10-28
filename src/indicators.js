// 기술적 지표 계산. 모든 함수는 bars([{time, open, high, low, close, volume}])를 받아
// 차트 시리즈에 바로 넣을 수 있는 [{time, value}] 배열을 돌려준다.
// 값을 계산할 수 없는 초기 구간(워밍업)은 결과에서 제외한다.

export function sma(bars, period, source = 'close') {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i][source];
    if (i >= period) sum -= bars[i - period][source];
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

export function ema(bars, period, source = 'close') {
  return emaOfValues(bars.map((b) => ({ time: b.time, value: b[source] })), period);
}

// 첫 값은 SMA로 시드하고 이후 지수 가중 평균.
function emaOfValues(points, period) {
  const out = [];
  if (points.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += points[i].value;
  prev /= period;
  out.push({ time: points[period - 1].time, value: prev });
  for (let i = period; i < points.length; i++) {
    prev = points[i].value * k + prev * (1 - k);
    out.push({ time: points[i].time, value: prev });
  }
  return out;
}

export function bollinger(bars, period = 20, mult = 2) {
  const middle = [], upper = [], lower = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (bars[j].close - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    const time = bars[i].time;
    middle.push({ time, value: mean });
    upper.push({ time, value: mean + mult * sd });
    lower.push({ time, value: mean - mult * sd });
  }
  return { middle, upper, lower };
}

// Wilder 평활 RSI (TradingView ta.rsi와 동일한 방식).
export function rsi(bars, period = 14) {
  const out = [];
  if (bars.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  out.push({ time: bars[period].time, value: toRsi(gain, loss) });
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out.push({ time: bars[i].time, value: toRsi(gain, loss) });
  }
  return out;
}

function toRsi(gain, loss) {
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export function macd(bars, fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = ema(bars, fast);
  const slowEma = ema(bars, slow);
  const fastByTime = new Map(fastEma.map((p) => [p.time, p.value]));
  const line = slowEma.map((p) => ({ time: p.time, value: fastByTime.get(p.time) - p.value }));
  const signal = emaOfValues(line, signalPeriod);
  const lineByTime = new Map(line.map((p) => [p.time, p.value]));
  const histogram = signal.map((p) => ({ time: p.time, value: lineByTime.get(p.time) - p.value }));
  return { macd: line, signal, histogram };
}

// 하루 단위로 리셋되는 VWAP (UTC 기준 세션).
export function vwap(bars) {
  const out = [];
  let day = null, pv = 0, vol = 0;
  for (const b of bars) {
    const d = Math.floor(b.time / 86400);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume;
    vol += b.volume;
    out.push({ time: b.time, value: vol ? pv / vol : typical });
  }
  return out;
}

export function heikinAshi(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      time: b.time,
      open,
      high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close),
      close,
      volume: b.volume,
    });
  }
  return out;
}

// ======================================================================
// 배열 기반 계산. 모든 배열은 bars와 길이가 같고, 값이 없는 칸은 NaN이다.
// ======================================================================

export const SOURCES = {
  close: (b) => b.close,
  open: (b) => b.open,
  high: (b) => b.high,
  low: (b) => b.low,
  hl2: (b) => (b.high + b.low) / 2,
  hlc3: (b) => (b.high + b.low + b.close) / 3,
  ohlc4: (b) => (b.open + b.high + b.low + b.close) / 4,
};

export const src = (bars, source = 'close') => bars.map(SOURCES[source] ?? SOURCES.close);

// 배열 -> 차트 점. 값이 없는 칸은 건너뛰거나(기본) 빈 점으로 남긴다(선을 끊을 때).
export function toPoints(bars, values, keepGaps = false) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(values[i])) out.push({ time: bars[i].time, value: values[i] });
    else if (keepGaps && out.length) out.push({ time: bars[i].time });
  }
  return out;
}

function windowed(values, n, fn) {
  const out = new Array(values.length).fill(NaN);
  for (let i = n - 1; i < values.length; i++) {
    const w = values.slice(i - n + 1, i + 1);
    if (w.every(Number.isFinite)) out[i] = fn(w);
  }
  return out;
}

export const smaArr = (v, n) => windowed(v, n, (w) => w.reduce((a, b) => a + b, 0) / n);
export const highestArr = (v, n) => windowed(v, n, (w) => Math.max(...w));
export const lowestArr = (v, n) => windowed(v, n, (w) => Math.min(...w));
export const sumArr = (v, n) => windowed(v, n, (w) => w.reduce((a, b) => a + b, 0));
export const stdevArr = (v, n) => windowed(v, n, (w) => {
  const m = w.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
});
export const wmaArr = (v, n) => windowed(v, n, (w) => {
  let num = 0;
  w.forEach((x, i) => { num += x * (i + 1); });
  return num / ((n * (n + 1)) / 2);
});

// 지수 평균. alpha를 주면 Wilder 방식(RMA) 등도 만들 수 있다. 첫 값은 SMA로 시작.
export function emaArr(v, n, alpha = 2 / (n + 1)) {
  const out = new Array(v.length).fill(NaN);
  const start = v.findIndex(Number.isFinite);
  if (start < 0 || start + n > v.length) return out;
  let prev = 0;
  for (let i = start; i < start + n; i++) prev += v[i];
  prev /= n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < v.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    prev = v[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}
export const rmaArr = (v, n) => emaArr(v, n, 1 / n);

export function hmaArr(v, n) {
  const half = wmaArr(v, Math.max(1, Math.floor(n / 2)));
  const full = wmaArr(v, n);
  return wmaArr(half.map((h, i) => 2 * h - full[i]), Math.max(1, Math.round(Math.sqrt(n))));
}

export const MA = { sma: smaArr, ema: emaArr, wma: wmaArr, hma: hmaArr, rma: rmaArr };

export const trArr = (bars) => bars.map((b, i) => (i === 0 ? b.high - b.low
  : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
export const atrArr = (bars, n) => rmaArr(trArr(bars), n);

export function rsiArr(v, n) {
  const gains = v.map((x, i) => (i ? Math.max(x - v[i - 1], 0) : NaN));
  const losses = v.map((x, i) => (i ? Math.max(v[i - 1] - x, 0) : NaN));
  const g = rmaArr(gains, n), l = rmaArr(losses, n);
  return g.map((gi, i) => (!Number.isFinite(gi) ? NaN : l[i] === 0 ? (gi === 0 ? 50 : 100) : 100 - 100 / (1 + gi / l[i])));
}

// 0~100 사이 위치 (스토캐스틱 계열)
const stochOf = (v, hi, lo) => v.map((x, i) => (hi[i] === lo[i] ? 50 : (100 * (x - lo[i])) / (hi[i] - lo[i])));

export function keltner(bars, n = 20, mult = 2, atrN = 10) {
  const mid = emaArr(src(bars), n), atr = atrArr(bars, atrN);
  return {
    upper: toPoints(bars, mid.map((m, i) => m + mult * atr[i])),
    middle: toPoints(bars, mid),
    lower: toPoints(bars, mid.map((m, i) => m - mult * atr[i])),
  };
}

export function donchian(bars, n = 20) {
  const hi = highestArr(bars.map((b) => b.high), n), lo = lowestArr(bars.map((b) => b.low), n);
  return { upper: toPoints(bars, hi), middle: toPoints(bars, hi.map((h, i) => (h + lo[i]) / 2)), lower: toPoints(bars, lo) };
}

export function envelope(bars, n = 20, pct = 2.5) {
  const mid = smaArr(src(bars), n);
  return {
    upper: toPoints(bars, mid.map((m) => m * (1 + pct / 100))),
    middle: toPoints(bars, mid),
    lower: toPoints(bars, mid.map((m) => m * (1 - pct / 100))),
  };
}

// 일목균형표. 선행스팬은 (기준 - 1)칸 앞으로, 후행스팬은 뒤로 민다. 미래 칸 시간은 봉 간격으로 늘린다.
export function ichimoku(bars, conv = 9, base = 26, spanBN = 52, disp = 26, step = 60) {
  const highs = bars.map((b) => b.high), lows = bars.map((b) => b.low);
  const mid = (n) => { const h = highestArr(highs, n), l = lowestArr(lows, n); return h.map((x, i) => (x + l[i]) / 2); };
  const tenkan = mid(conv), kijun = mid(base), spanB = mid(spanBN);
  const spanA = tenkan.map((t, i) => (t + kijun[i]) / 2);
  const last = bars.length - 1;
  const timeAt = (j) => (j <= last ? bars[j].time : bars[last].time + (j - last) * step);
  const shift = (values, offset) => {
    const out = [];
    values.forEach((v, i) => {
      const j = i + offset;
      if (Number.isFinite(v) && j >= 0) out.push({ time: timeAt(j), value: v });
    });
    return out;
  };
  return {
    tenkan: toPoints(bars, tenkan),
    kijun: toPoints(bars, kijun),
    spanA: shift(spanA, disp - 1),
    spanB: shift(spanB, disp - 1),
    chikou: shift(bars.map((b) => b.close), -(disp - 1)),
  };
}

export function psar(bars, start = 0.02, inc = 0.02, max = 0.2) {
  const out = new Array(bars.length).fill(NaN);
  if (bars.length < 3) return { value: [] };
  let up = bars[1].close >= bars[0].close;
  let sar = up ? bars[0].low : bars[0].high;
  let ep = up ? bars[0].high : bars[0].low;
  let af = start;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p1 = bars[i - 1], p2 = bars[Math.max(0, i - 2)];
    sar += af * (ep - sar);
    if (up) {
      sar = Math.min(sar, p1.low, p2.low);
      if (b.low < sar) { up = false; sar = ep; ep = b.low; af = start; }
      else if (b.high > ep) { ep = b.high; af = Math.min(af + inc, max); }
    } else {
      sar = Math.max(sar, p1.high, p2.high);
      if (b.high > sar) { up = true; sar = ep; ep = b.high; af = start; }
      else if (b.low < ep) { ep = b.low; af = Math.min(af + inc, max); }
    }
    out[i] = sar;
  }
  return { value: toPoints(bars, out) };
}

// 슈퍼트렌드. 상승 구간과 하락 구간을 따로 돌려줘서 색을 다르게 그린다.
export function supertrend(bars, n = 10, mult = 3) {
  const atr = atrArr(bars, n);
  const upLine = new Array(bars.length).fill(NaN), downLine = new Array(bars.length).fill(NaN);
  let finalUp = NaN, finalDn = NaN, trend = 1;
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isFinite(atr[i])) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const basicUp = hl2 - mult * atr[i], basicDn = hl2 + mult * atr[i];
    const prevClose = i ? bars[i - 1].close : bars[i].close;
    const prevUp = finalUp, prevDn = finalDn;
    finalUp = Number.isFinite(prevUp) && prevClose > prevUp ? Math.max(basicUp, prevUp) : basicUp;
    finalDn = Number.isFinite(prevDn) && prevClose < prevDn ? Math.min(basicDn, prevDn) : basicDn;
    if (trend === -1 && Number.isFinite(prevDn) && bars[i].close > prevDn) trend = 1;
    else if (trend === 1 && Number.isFinite(prevUp) && bars[i].close < prevUp) trend = -1;
    if (trend === 1) upLine[i] = finalUp; else downLine[i] = finalDn;
  }
  return { up: toPoints(bars, upLine, true), down: toPoints(bars, downLine, true) };
}

export function stochastic(bars, kN = 14, smooth = 3, dN = 3) {
  const close = src(bars);
  const raw = stochOf(close, highestArr(bars.map((b) => b.high), kN), lowestArr(bars.map((b) => b.low), kN));
  const k = smaArr(raw, smooth), d = smaArr(k, dN);
  return { k: toPoints(bars, k), d: toPoints(bars, d) };
}

export function stochRsi(bars, rsiN = 14, stochN = 14, kN = 3, dN = 3) {
  const r = rsiArr(src(bars), rsiN);
  const k = smaArr(stochOf(r, highestArr(r, stochN), lowestArr(r, stochN)), kN);
  return { k: toPoints(bars, k), d: toPoints(bars, smaArr(k, dN)) };
}

export function cci(bars, n = 20) {
  const tp = src(bars, 'hlc3');
  const mean = smaArr(tp, n);
  const dev = windowed(tp, n, (w) => { const m = w.reduce((a, b) => a + b, 0) / n; return w.reduce((a, b) => a + Math.abs(b - m), 0) / n; });
  return { value: toPoints(bars, tp.map((x, i) => (!Number.isFinite(mean[i]) ? NaN : dev[i] ? (x - mean[i]) / (0.015 * dev[i]) : 0))) };
}

export function williamsR(bars, n = 14) {
  const hi = highestArr(bars.map((b) => b.high), n), lo = lowestArr(bars.map((b) => b.low), n);
  return { value: toPoints(bars, bars.map((b, i) => (hi[i] === lo[i] ? -50 : (-100 * (hi[i] - b.close)) / (hi[i] - lo[i])))) };
}

export const atr = (bars, n = 14) => ({ value: toPoints(bars, atrArr(bars, n)) });

export function adx(bars, n = 14) {
  const plusDM = bars.map((b, i) => { if (!i) return NaN; const u = b.high - bars[i - 1].high, d = bars[i - 1].low - b.low; return u > d && u > 0 ? u : 0; });
  const minusDM = bars.map((b, i) => { if (!i) return NaN; const u = b.high - bars[i - 1].high, d = bars[i - 1].low - b.low; return d > u && d > 0 ? d : 0; });
  const tr = trArr(bars).map((t, i) => (i ? t : NaN));
  const trS = rmaArr(tr, n), plus = rmaArr(plusDM, n).map((v, i) => (100 * v) / trS[i]), minus = rmaArr(minusDM, n).map((v, i) => (100 * v) / trS[i]);
  const dx = plus.map((p, i) => (!Number.isFinite(p) ? NaN : p + minus[i] ? (100 * Math.abs(p - minus[i])) / (p + minus[i]) : 0));
  return { adx: toPoints(bars, rmaArr(dx, n)), plus: toPoints(bars, plus), minus: toPoints(bars, minus) };
}

export function obv(bars) {
  let total = 0;
  return { value: bars.map((b, i) => {
    if (i) total += b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0;
    return { time: b.time, value: total };
  }) };
}

export function mfi(bars, n = 14) {
  const tp = src(bars, 'hlc3');
  const pos = tp.map((x, i) => (i && x > tp[i - 1] ? x * bars[i].volume : i ? 0 : NaN));
  const neg = tp.map((x, i) => (i && x < tp[i - 1] ? x * bars[i].volume : i ? 0 : NaN));
  const p = sumArr(pos, n), q = sumArr(neg, n);
  return { value: toPoints(bars, p.map((x, i) => (q[i] === 0 ? 100 : 100 - 100 / (1 + x / q[i])))) };
}

export function roc(bars, n = 9) {
  return { value: toPoints(bars, bars.map((b, i) => (i >= n ? (100 * (b.close - bars[i - n].close)) / bars[i - n].close : NaN))) };
}

export function momentum(bars, n = 10) {
  return { value: toPoints(bars, bars.map((b, i) => (i >= n ? b.close - bars[i - n].close : NaN))) };
}

export function cmf(bars, n = 20) {
  const mfv = bars.map((b) => (b.high === b.low ? 0 : (((b.close - b.low) - (b.high - b.close)) / (b.high - b.low)) * b.volume));
  const a = sumArr(mfv, n), v = sumArr(bars.map((b) => b.volume), n);
  return { value: toPoints(bars, a.map((x, i) => (!Number.isFinite(x) ? NaN : v[i] ? x / v[i] : 0))) };
}
