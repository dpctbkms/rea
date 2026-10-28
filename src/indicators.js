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
