// 지표 목록과 설정. 화면 쪽(main.js)은 이 정의만 보고 시리즈를 만들고 설정 창을 그린다.
//
// 정의 형식:
//   type, name(목록에 보이는 이름), short(범례 이름), category, pane('overlay' 가격 위 | 'sub' 아래 창)
//   inputs   [{key, label, default, min, max, step} | {key, label, default, options:[[값, 이름]]}]
//   plots    [{key, label, color, kind: 'line' | 'histogram' | 'dots', width}]
//   levels   [{key, label, default}]  아래 창의 기준선(과매수·과매도 등). 값은 params에 같이 저장된다.
//   range    [최소, 최대]  세로 눈금 고정 (RSI 0~100 등)
//   compute(bars, params, {step, colors}) -> { [plot key]: 점[] }
import {
  SOURCES, src, toPoints, MA, bollinger, rsi, macd, vwap, keltner, donchian, envelope, ichimoku, psar, supertrend,
  stochastic, stochRsi, cci, williamsR, atr, adx, obv, mfi, roc, momentum, cmf, smaArr,
} from './indicators.js';

const SOURCE_OPTIONS = Object.keys(SOURCES).map((k) => [k, { close: '종가', open: '시가', high: '고가', low: '저가', hl2: '(고+저)/2', hlc3: '(고+저+종)/3', ohlc4: '(시+고+저+종)/4' }[k]]);
const period = (d, label = '기간') => ({ key: 'period', label, default: d, min: 1, max: 1000, step: 1 });
const source = { key: 'source', label: '기준 가격', default: 'close', options: SOURCE_OPTIONS };
const line = (key, label, color, width = 2) => ({ key, label, color, kind: 'line', width });

const maStudy = (type, name, color) => ({
  type, name, short: type.toUpperCase(), category: '이동평균', pane: 'overlay',
  inputs: [period(20), source],
  plots: [line('value', type.toUpperCase(), color)],
  compute: (bars, p) => ({ value: toPoints(bars, MA[type](src(bars, p.source), p.period)) }),
});

const bandPlots = (color, midColor = '#ff9800') => [line('upper', '위', color, 1), line('middle', '가운데', midColor, 1), line('lower', '아래', color, 1)];

export const STUDIES = [
  {
    type: 'volume', name: '거래량', short: '거래량', category: '거래량', pane: 'overlay', format: 'volume',
    inputs: [{ key: 'maPeriod', label: '이동평균 (0이면 끔)', default: 0, min: 0, max: 500, step: 1 }],
    plots: [
      { key: 'volume', label: '거래량', color: '#787b86', kind: 'histogram', scale: 'volume' },
      { key: 'up', label: '상승 색', color: '#089981', kind: 'color' },
      { key: 'down', label: '하락 색', color: '#f23645', kind: 'color' },
      { key: 'ma', label: '이동평균', color: '#2962ff', kind: 'line', width: 1, scale: 'volume' },
    ],
    compute: (bars, p, { colors }) => ({
      volume: bars.map((b) => ({ time: b.time, value: b.volume, color: `${b.close >= b.open ? colors.up : colors.down}80` })),
      ma: p.maPeriod > 0 ? toPoints(bars, smaArr(bars.map((b) => b.volume), p.maPeriod)) : [],
    }),
  },
  maStudy('sma', '단순 이동평균 (SMA)', '#f7a21b'),
  maStudy('ema', '지수 이동평균 (EMA)', '#2962ff'),
  maStudy('wma', '가중 이동평균 (WMA)', '#00bcd4'),
  maStudy('hma', '헐 이동평균 (HMA)', '#e91e63'),
  {
    type: 'vwap', name: '거래량 가중 평균가 (VWAP)', short: 'VWAP', category: '이동평균', pane: 'overlay',
    inputs: [],
    plots: [line('value', 'VWAP', '#9c27b0')],
    compute: (bars) => ({ value: vwap(bars) }),
  },
  {
    type: 'bb', name: '볼린저 밴드', short: 'BB', category: '추세·채널', pane: 'overlay',
    inputs: [period(20), { key: 'mult', label: '표준편차 배수', default: 2, min: 0.1, max: 10, step: 0.1 }],
    plots: bandPlots('#2196f3'),
    compute: (bars, p) => bollinger(bars, p.period, p.mult),
  },
  {
    type: 'keltner', name: '켈트너 채널', short: 'KC', category: '추세·채널', pane: 'overlay',
    inputs: [period(20), { key: 'mult', label: 'ATR 배수', default: 2, min: 0.1, max: 10, step: 0.1 }, { key: 'atrPeriod', label: 'ATR 기간', default: 10, min: 1, max: 500, step: 1 }],
    plots: bandPlots('#26a69a'),
    compute: (bars, p) => keltner(bars, p.period, p.mult, p.atrPeriod),
  },
  {
    type: 'donchian', name: '돈치안 채널', short: 'DC', category: '추세·채널', pane: 'overlay',
    inputs: [period(20)],
    plots: bandPlots('#5c6bc0', '#ff7043'),
    compute: (bars, p) => donchian(bars, p.period),
  },
  {
    type: 'envelope', name: '엔벨로프', short: 'ENV', category: '추세·채널', pane: 'overlay',
    inputs: [period(20), { key: 'percent', label: '폭 (%)', default: 2.5, min: 0.1, max: 50, step: 0.1 }],
    plots: bandPlots('#8d6e63'),
    compute: (bars, p) => envelope(bars, p.period, p.percent),
  },
  {
    type: 'ichimoku', name: '일목균형표', short: '일목', category: '추세·채널', pane: 'overlay',
    inputs: [
      { key: 'conv', label: '전환선 기간', default: 9, min: 1, max: 500, step: 1 },
      { key: 'base', label: '기준선 기간', default: 26, min: 1, max: 500, step: 1 },
      { key: 'spanB', label: '선행스팬 B 기간', default: 52, min: 1, max: 500, step: 1 },
      { key: 'disp', label: '선행·후행 이동', default: 26, min: 1, max: 500, step: 1 },
    ],
    plots: [
      line('tenkan', '전환선', '#2962ff', 1), line('kijun', '기준선', '#b71c1c', 1),
      line('spanA', '선행스팬 A', '#43a047', 1), line('spanB', '선행스팬 B', '#f44336', 1), line('chikou', '후행스팬', '#9c27b0', 1),
    ],
    compute: (bars, p, { step }) => ichimoku(bars, p.conv, p.base, p.spanB, p.disp, step),
  },
  {
    type: 'psar', name: '파라볼릭 SAR', short: 'SAR', category: '추세·채널', pane: 'overlay',
    inputs: [
      { key: 'start', label: '시작 가속', default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { key: 'inc', label: '가속 증가', default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { key: 'max', label: '최대 가속', default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    plots: [{ key: 'value', label: 'SAR', color: '#2962ff', kind: 'dots' }],
    compute: (bars, p) => psar(bars, p.start, p.inc, p.max),
  },
  {
    type: 'supertrend', name: '슈퍼트렌드', short: 'ST', category: '추세·채널', pane: 'overlay',
    inputs: [{ key: 'period', label: 'ATR 기간', default: 10, min: 1, max: 500, step: 1 }, { key: 'mult', label: '배수', default: 3, min: 0.1, max: 20, step: 0.1 }],
    plots: [line('up', '상승', '#089981'), line('down', '하락', '#f23645')],
    compute: (bars, p) => supertrend(bars, p.period, p.mult),
  },
  {
    type: 'rsi', name: '상대강도지수 (RSI)', short: 'RSI', category: '모멘텀·오실레이터', pane: 'sub', range: [0, 100],
    inputs: [period(14)],
    levels: [{ key: 'upper', label: '과매수', default: 70 }, { key: 'lower', label: '과매도', default: 30 }],
    plots: [line('value', 'RSI', '#7e57c2')],
    compute: (bars, p) => ({ value: rsi(bars, p.period) }),
  },
  {
    type: 'macd', name: 'MACD', short: 'MACD', category: '모멘텀·오실레이터', pane: 'sub',
    inputs: [
      { key: 'fast', label: '빠른 기간', default: 12, min: 1, max: 500, step: 1 },
      { key: 'slow', label: '느린 기간', default: 26, min: 1, max: 500, step: 1 },
      { key: 'signal', label: '시그널 기간', default: 9, min: 1, max: 500, step: 1 },
    ],
    plots: [
      { key: 'histogram', label: '히스토그램', color: '#787b86', kind: 'histogram' },
      { key: 'up', label: '히스토그램 +', color: '#089981', kind: 'color' },
      { key: 'down', label: '히스토그램 −', color: '#f23645', kind: 'color' },
      line('macd', 'MACD', '#2962ff'), line('signal', '시그널', '#ff6d00'),
    ],
    compute: (bars, p, { colors }) => {
      const m = macd(bars, p.fast, p.slow, p.signal);
      m.histogram = m.histogram.map((x) => ({ ...x, color: `${x.value >= 0 ? colors.up : colors.down}a0` }));
      return m;
    },
  },
  {
    type: 'stoch', name: '스토캐스틱', short: 'Stoch', category: '모멘텀·오실레이터', pane: 'sub', range: [0, 100],
    inputs: [period(14, '%K 기간'), { key: 'smooth', label: '%K 평활', default: 3, min: 1, max: 100, step: 1 }, { key: 'd', label: '%D 기간', default: 3, min: 1, max: 100, step: 1 }],
    levels: [{ key: 'upper', label: '과매수', default: 80 }, { key: 'lower', label: '과매도', default: 20 }],
    plots: [line('k', '%K', '#2962ff'), line('d', '%D', '#ff6d00')],
    compute: (bars, p) => stochastic(bars, p.period, p.smooth, p.d),
  },
  {
    type: 'stochrsi', name: '스토캐스틱 RSI', short: 'Stoch RSI', category: '모멘텀·오실레이터', pane: 'sub', range: [0, 100],
    inputs: [
      { key: 'rsi', label: 'RSI 기간', default: 14, min: 1, max: 500, step: 1 },
      { key: 'stoch', label: '스토캐스틱 기간', default: 14, min: 1, max: 500, step: 1 },
      { key: 'k', label: '%K 평활', default: 3, min: 1, max: 100, step: 1 },
      { key: 'd', label: '%D 기간', default: 3, min: 1, max: 100, step: 1 },
    ],
    levels: [{ key: 'upper', label: '과매수', default: 80 }, { key: 'lower', label: '과매도', default: 20 }],
    plots: [line('k', '%K', '#2962ff'), line('d', '%D', '#ff6d00')],
    compute: (bars, p) => stochRsi(bars, p.rsi, p.stoch, p.k, p.d),
  },
  {
    type: 'cci', name: '상품채널지수 (CCI)', short: 'CCI', category: '모멘텀·오실레이터', pane: 'sub',
    inputs: [period(20)],
    levels: [{ key: 'upper', label: '위 기준', default: 100 }, { key: 'lower', label: '아래 기준', default: -100 }],
    plots: [line('value', 'CCI', '#00897b')],
    compute: (bars, p) => cci(bars, p.period),
  },
  {
    type: 'willr', name: '윌리엄스 %R', short: '%R', category: '모멘텀·오실레이터', pane: 'sub', range: [-100, 0],
    inputs: [period(14)],
    levels: [{ key: 'upper', label: '과매수', default: -20 }, { key: 'lower', label: '과매도', default: -80 }],
    plots: [line('value', '%R', '#7e57c2')],
    compute: (bars, p) => williamsR(bars, p.period),
  },
  {
    type: 'adx', name: '평균방향지수 (ADX/DMI)', short: 'ADX', category: '모멘텀·오실레이터', pane: 'sub',
    inputs: [period(14)],
    levels: [{ key: 'trend', label: '추세 기준', default: 25 }],
    plots: [line('adx', 'ADX', '#ff6d00'), line('plus', '+DI', '#089981', 1), line('minus', '−DI', '#f23645', 1)],
    compute: (bars, p) => adx(bars, p.period),
  },
  {
    type: 'roc', name: '변화율 (ROC)', short: 'ROC', category: '모멘텀·오실레이터', pane: 'sub',
    inputs: [period(9)],
    levels: [{ key: 'zero', label: '기준선', default: 0 }],
    plots: [line('value', 'ROC', '#2962ff')],
    compute: (bars, p) => roc(bars, p.period),
  },
  {
    type: 'mom', name: '모멘텀', short: 'MOM', category: '모멘텀·오실레이터', pane: 'sub',
    inputs: [period(10)],
    levels: [{ key: 'zero', label: '기준선', default: 0 }],
    plots: [line('value', '모멘텀', '#2962ff')],
    compute: (bars, p) => momentum(bars, p.period),
  },
  {
    type: 'atr', name: '평균진폭 (ATR)', short: 'ATR', category: '변동성', pane: 'sub',
    inputs: [period(14)],
    plots: [line('value', 'ATR', '#b71c1c')],
    compute: (bars, p) => atr(bars, p.period),
  },
  {
    type: 'obv', name: '누적 거래량 (OBV)', short: 'OBV', category: '거래량', pane: 'sub', format: 'volume',
    inputs: [],
    plots: [line('value', 'OBV', '#2962ff')],
    compute: (bars) => obv(bars),
  },
  {
    type: 'mfi', name: '자금흐름지수 (MFI)', short: 'MFI', category: '거래량', pane: 'sub', range: [0, 100],
    inputs: [period(14)],
    levels: [{ key: 'upper', label: '과매수', default: 80 }, { key: 'lower', label: '과매도', default: 20 }],
    plots: [line('value', 'MFI', '#7e57c2')],
    compute: (bars, p) => mfi(bars, p.period),
  },
  {
    type: 'cmf', name: '차이킨 자금흐름 (CMF)', short: 'CMF', category: '거래량', pane: 'sub',
    inputs: [period(20)],
    levels: [{ key: 'zero', label: '기준선', default: 0 }],
    plots: [line('value', 'CMF', '#43a047')],
    compute: (bars, p) => cmf(bars, p.period),
  },
];

export const CATEGORIES = ['이동평균', '추세·채널', '모멘텀·오실레이터', '변동성', '거래량'];
export const studyDef = (type) => STUDIES.find((s) => s.type === type);

// 새 지표의 기본 설정
export function newStudy(type, overrides = {}) {
  const def = studyDef(type);
  return {
    id: Math.random().toString(36).slice(2, 10),
    type,
    params: Object.fromEntries([...def.inputs, ...(def.levels ?? [])].map((i) => [i.key, i.default])),
    colors: Object.fromEntries(def.plots.map((p) => [p.key, p.color])),
    hidden: false,
    ...overrides,
  };
}

// 저장된 지표를 현재 정의에 맞춘다 (새로 생긴 설정값은 기본값으로 채움).
export function normalizeStudy(s) {
  const def = studyDef(s.type);
  if (!def) return null;
  const base = newStudy(s.type);
  return { ...base, ...s, params: { ...base.params, ...s.params }, colors: { ...base.colors, ...s.colors } };
}

// 범례 이름: "EMA 20", "MACD 12 26 9"
export function studyTitle(s) {
  const def = studyDef(s.type);
  const values = def.inputs.filter((i) => !i.options).map((i) => s.params[i.key]);
  if (s.type === 'volume') return def.short;
  return [def.short, ...values].join(' ');
}

// 예전 버전(지표 id 문자열 배열)에서 옮기기
const LEGACY = {
  volume: ['volume'],
  sma20: ['sma', { period: 20 }],
  ema20: ['ema', { period: 20 }],
  ema50: ['ema', { period: 50 }, '#ff6d00'],
  ema200: ['ema', { period: 200 }, '#e91e63'],
  bb: ['bb'],
  vwap: ['vwap'],
  rsi: ['rsi'],
  macd: ['macd'],
};

export function migrateStudies(list) {
  if (!Array.isArray(list)) return null;
  return list.map((item) => {
    if (typeof item !== 'string') return normalizeStudy(item);
    const [type, params, color] = LEGACY[item] ?? [];
    if (!type) return null;
    const s = newStudy(type);
    Object.assign(s.params, params);
    if (color) s.colors.value = color;
    return s;
  }).filter(Boolean);
}

export const DEFAULT_STUDIES = () => [newStudy('volume'), newStudy('ema', { params: { period: 20, source: 'close' } }), newStudy('ema', { params: { period: 50, source: 'close' }, colors: { value: '#ff6d00' } })];
