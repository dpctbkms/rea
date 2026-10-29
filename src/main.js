import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries, HistogramSeries,
  CrosshairMode, ColorType, LineStyle, PriceScaleMode,
} from 'lightweight-charts';
import { FEEDS, INTERVALS } from './feeds/index.js';
import { coinName } from './feeds/common.js';
import { heikinAshi } from './indicators.js';
import { STUDIES, CATEGORIES, studyDef, newStudy, studyTitle, migrateStudies, DEFAULT_STUDIES } from './studies.js';
import { DrawingManager, TOOLS, COLORS, LINE_STYLES, VISIBILITY_GROUPS, FIB_LEVELS, canAngleLock } from './drawings.js';
import { BarCountdown } from './countdown.js';

const $ = (sel) => document.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- 설정 저장 ----------
const STORAGE_KEY = 'rea-chart-settings';
const settings = Object.assign(
  {
    source: 'upbit',
    coin: 'BTC',
    interval: '1h',
    chartType: 'candles',
    theme: 'dark',
    indicators: null, // 지표 목록 (studies.js 형식)
    drawings: {}, // { ['거래소:코인']: 도형[] }
    keys: {}, // { [피드 id]: API 키 } 이 브라우저에만 저장된다
    favorites: ['1m', '15m', '1h', '4h', '1d'], // 툴바에 바로 보이는 타임프레임
    toolGroups: {}, // 도구 묶음별 마지막으로 고른 도구
    cursorMode: 'cross',
    scaleMode: 'normal', // normal | log | percent
    autoScale: true,
    panelOpen: true,
    toolsOpen: false, // 휴대폰: 왼쪽 그리기 도구 막대를 펼쳤는지 (연필 버튼)
    tab: 'chart', // 휴대폰 아래 탭: watch | chart | menu
    legendCollapsed: false, // 지표 범례 접기
    chart: {}, // 차트 설정 (CHART_DEFAULTS 참고)
  },
  load(),
);
const CHART_DEFAULTS = {
  upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645',
  priceLine: true, countdown: true, bgColor: '', vertGrid: true, horzGrid: true, legendOhlc: true, legendValues: true,
};
settings.chart = { ...CHART_DEFAULTS, ...settings.chart };
// 예전 자석 설정(true/false)을 약한·강한 자석 방식으로
if (typeof settings.magnet === 'boolean') settings.magnet = settings.magnet ? 'weak' : 'off';
settings.magnet ??= 'off';
settings.magnetMode ??= 'weak'; // 자석 버튼을 켤 때 쓸 방식
// 예전 버전의 수평선(lines: 가격 배열)을 도형으로 옮긴다.
if (settings.lines) {
  for (const [key, prices] of Object.entries(settings.lines)) {
    settings.drawings[key] = prices.map((price, i) => ({ id: `line${i}`, type: 'hline', points: [{ time: 0, price }], color: COLORS[0] }));
  }
  delete settings.lines;
}
settings.indicators = migrateStudies(settings.indicators) ?? DEFAULT_STUDIES();
// 예전 버전 설정(symbol: 'BTCUSDT') 이어받기.
if (settings.symbol) {
  settings.coin = settings.symbol.replace(/USDT$/, '');
  delete settings.symbol;
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* 저장 불가 환경 */ }
}

// ---------- 상태 ----------
const params = new URLSearchParams(location.search);
const forceDemo = params.get('feed') === 'demo' || window.REA_FEED === 'demo';
const feedById = (id) => FEEDS.find((f) => f.id === id) ?? FEEDS[0];
let feed = feedById(forceDemo ? 'demo' : settings.source);
let feedError = null; // 선택한 거래소에 연결하지 못한 이유
let markets = null; // 현재 피드의 상장 종목 전체 [{id, name}]
for (const f of FEEDS) if (f.needsKey) f.apiKey = settings.keys[f.id] ?? '';
const marketLabel = () => (feed.quote ? `${settings.coin}/${feed.quote}` : settings.coin);
const lineKey = () => `${feed.id}:${settings.coin}`;
let bars = [];
let mainSeries = null;
let active = new Map(); // 지표 id -> { study, def, series: {plot key: 시리즈}, values: {plot key: Map(time -> 값)} }
let unsubscribeBars = () => {};
let unsubscribeTickers = () => {};
let loadId = 0;

// ---------- 차트 ----------
document.documentElement.dataset.theme = settings.theme;
const chart = createChart($('#chart'), {
  autoSize: true,
  // 차트 라이브러리 출처 표시는 차트 위 로고 대신 메뉴 > 정보와 차트 설정 창 아래에 둔다 (라이선스 조건)
  layout: { attributionLogo: false },
  crosshair: { mode: CrosshairMode.Normal },
  timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, borderVisible: false },
  rightPriceScale: { borderVisible: false },
  localization: { locale: 'ko-KR' },
});
applyTheme();

function applyTheme() {
  const text = css('--text'), grid = css('--grid'), border = css('--border'), c = settings.chart;
  const lines = settings.cursorMode === 'cross' || settings.cursorMode === 'eraser';
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: c.bgColor || css('--bg') },
      textColor: text,
      fontSize: 12,
      panes: { separatorColor: border, separatorHoverColor: css('--hover') },
    },
    grid: { vertLines: { color: grid, visible: c.vertGrid }, horzLines: { color: grid, visible: c.horzGrid } },
    crosshair: {
      vertLine: { labelBackgroundColor: '#363a45', visible: lines, labelVisible: settings.cursorMode !== 'arrow' },
      horzLine: { labelBackgroundColor: '#363a45', visible: lines, labelVisible: settings.cursorMode !== 'arrow' },
    },
  });
  // 휴대폰 상단 상태 표시줄 색 (앱으로 설치했을 때)
  $('meta[name="theme-color"]').content = css('--panel');
  $('.chart-wrap').classList.toggle('arrow-cursor', settings.cursorMode === 'arrow');
  $('.chart-wrap').classList.toggle('eraser-cursor', settings.cursorMode === 'eraser');
}

function applyScale() {
  const mode = { normal: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, percent: PriceScaleMode.Percentage }[settings.scaleMode];
  chart.priceScale('right').applyOptions({ mode, autoScale: settings.autoScale });
  $('#scale-percent').classList.toggle('active', settings.scaleMode === 'percent');
  $('#scale-log').classList.toggle('active', settings.scaleMode === 'log');
  $('#scale-auto').classList.toggle('active', settings.autoScale);
}

function priceFormatFor(price) {
  const precision = feed.quote === 'KRW'
    ? (price >= 100 ? 0 : price >= 1 ? 2 : 4)
    : (price >= 1000 ? 2 : price >= 10 ? 3 : price >= 1 ? 4 : price >= 0.01 ? 5 : 8);
  return { type: 'price', precision, minMove: 1 / 10 ** precision };
}

const countdown = new BarCountdown({
  getBars: () => bars,
  getStep: () => stepSeconds(),
  getColor: () => (bars.length && bars[bars.length - 1].close < bars[bars.length - 1].open ? settings.chart.downColor : settings.chart.upColor),
  isEnabled: () => settings.chart.countdown,
});

function createMainSeries() {
  if (mainSeries) {
    mainSeries.detachPrimitive(countdown);
    chart.removeSeries(mainSeries);
  }
  const c = settings.chart;
  const common = { priceLineVisible: c.priceLine };
  const candle = { upColor: c.upColor, downColor: c.downColor, borderVisible: c.borderVisible, borderUpColor: c.upColor, borderDownColor: c.downColor, wickUpColor: c.wickUpColor, wickDownColor: c.wickDownColor };
  switch (settings.chartType) {
    case 'bars':
      mainSeries = chart.addSeries(BarSeries, { ...common, upColor: c.upColor, downColor: c.downColor, thinBars: false });
      break;
    case 'hollow':
      mainSeries = chart.addSeries(CandlestickSeries, { ...common, ...candle, upColor: 'rgba(0, 0, 0, 0)', borderVisible: true });
      break;
    case 'line':
      mainSeries = chart.addSeries(LineSeries, { ...common, color: css('--accent'), lineWidth: 2 });
      break;
    case 'area':
      mainSeries = chart.addSeries(AreaSeries, { ...common, lineColor: css('--accent'), topColor: 'rgba(41, 98, 255, 0.35)', bottomColor: 'rgba(41, 98, 255, 0)', lineWidth: 2 });
      break;
    case 'baseline':
      mainSeries = chart.addSeries(BaselineSeries, {
        ...common,
        topLineColor: c.upColor, topFillColor1: `${c.upColor}50`, topFillColor2: `${c.upColor}08`,
        bottomLineColor: c.downColor, bottomFillColor1: `${c.downColor}08`, bottomFillColor2: `${c.downColor}50`,
      });
      break;
    default: // candles, heikin
      mainSeries = chart.addSeries(CandlestickSeries, { ...common, ...candle });
  }
  mainSeries.attachPrimitive(countdown);
  drawings.handleFill = c.bgColor || css('--bg'); // 손잡이 안쪽은 차트 배경색
  drawings.attach(mainSeries);
}

// 차트 종류에 맞게 봉 데이터를 변환.
function mainData(source) {
  const type = settings.chartType;
  if (type === 'heikin') return heikinAshi(source);
  if (type === 'line' || type === 'area' || type === 'baseline') return source.map((b) => ({ time: b.time, value: b.close }));
  return source;
}

function setMainData() {
  if (bars.length) mainSeries.applyOptions({ priceFormat: priceFormatFor(bars[bars.length - 1].close) });
  // 기준선 차트: 최근 구간 평균을 기준값으로 (트레이딩뷰처럼 위는 초록, 아래는 빨강)
  if (settings.chartType === 'baseline' && bars.length) {
    const recent = bars.slice(-150);
    mainSeries.applyOptions({ baseValue: { type: 'price', price: recent.reduce((a, b) => a + b.close, 0) / recent.length } });
  }
  mainSeries.setData(mainData(bars));
}

// ---------- 지표 ----------
const PANE_HEIGHT = 120;
const stepSeconds = () => INTERVALS.find((i) => i.id === settings.interval).seconds;

function buildIndicators() {
  for (const { series } of active.values()) Object.values(series).forEach((sr) => chart.removeSeries(sr));
  active = new Map();
  let subPane = 0;
  for (const study of settings.indicators) {
    const def = studyDef(study.type);
    // 숨긴 지표는 시리즈를 만들지 않는다 (빈 아래 창이 남지 않도록).
    const series = study.hidden ? {} : createStudySeries(study, def, def.pane === 'sub' ? ++subPane : 0);
    active.set(study.id, { study, def, series, values: {} });
  }
  chart.panes().forEach((pane, i) => { if (i > 0) pane.setHeight(PANE_HEIGHT); });
  refreshIndicators();
  renderLegend();
}

function createStudySeries(study, def, pane) {
  const series = {};
  for (const plot of def.plots) {
    const color = study.colors[plot.key];
    const common = { priceLineVisible: false, crosshairMarkerVisible: false, ...(def.format === 'volume' ? { priceFormat: { type: 'volume' } } : {}) };
    if (plot.kind === 'color') continue;
    if (plot.kind === 'histogram') {
      series[plot.key] = chart.addSeries(HistogramSeries, { ...common, color, lastValueVisible: false, ...(plot.scale ? { priceScaleId: plot.scale } : {}) }, pane);
    } else if (plot.kind === 'dots') {
      series[plot.key] = chart.addSeries(LineSeries, { ...common, color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5, lastValueVisible: false }, pane);
    } else {
      series[plot.key] = chart.addSeries(LineSeries, { ...common, color, lineWidth: plot.width ?? 2, lastValueVisible: !plot.scale, ...(plot.scale ? { priceScaleId: plot.scale } : {}) }, pane);
    }
    if (plot.scale === 'volume') series[plot.key].priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    if (def.range) series[plot.key].applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: def.range[0], maxValue: def.range[1] } }) });
  }
  const first = Object.values(series)[0];
  for (const level of def.levels ?? []) {
    first?.createPriceLine({ price: +study.params[level.key], color: css('--muted'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
  }
  return series;
}

function computeStudy({ study, def }) {
  try {
    return def.compute(bars, study.params, { step: stepSeconds(), colors: study.colors });
  } catch (err) {
    console.warn(`${studyTitle(study)} 계산 실패`, err);
    return {};
  }
}

function refreshIndicators(liveOnly = false) {
  for (const inst of active.values()) {
    if (!Object.keys(inst.series).length) continue;
    const data = computeStudy(inst);
    for (const [key, sr] of Object.entries(inst.series)) {
      const d = data[key] ?? [];
      if (liveOnly && d.length) {
        const last = d[d.length - 1];
        sr.update(last);
        inst.values[key]?.set(last.time, last.value);
      } else {
        sr.setData(d);
        inst.values[key] = new Map(d.filter((x) => 'value' in x).map((x) => [x.time, x.value]));
      }
    }
  }
}

// ---------- 데이터 로딩 ----------
async function loadSymbol() {
  const id = ++loadId;
  unsubscribeBars();
  $('#loading').hidden = false;
  await loadMarkets();
  if (id !== loadId) return;
  const custom = feed.allowCustom && settings.customFor === feed.id;
  if (markets && !custom && !markets.some((m) => m.id === settings.coin)) settings.coin = feed.coins[0];
  renderSymbolBtn();
  document.title = `${marketLabel()} · Rea Chart`;
  try {
    bars = await feed.getBars(settings.coin, settings.interval);
    if (!bars.length) throw new Error('빈 응답');
    feedError = null;
  } catch (err) {
    if (id !== loadId) return;
    if (feed.id === 'demo') throw err;
    console.warn(`${feed.name} 연결 실패, 데모 데이터로 전환합니다.`, err);
    feedError = err.code === 'NO_KEY' ? `${feed.name}: API 키를 넣어 주세요`
      : err.code === 'BAD_KEY' ? `${feed.name}: API 키가 맞지 않습니다`
      : `${feed.name}에 연결하지 못했습니다`;
    if (err.code === 'NO_KEY' || err.code === 'BAD_KEY') openKeyDialog();
    feed = feedById('demo');
    markets = null;
    loadMarkets();
    renderSymbolBtn();
    startTickers();
    bars = await feed.getBars(settings.coin, settings.interval);
  }
  if (id !== loadId) return;
  setMainData();
  drawings.load(settings.drawings[lineKey()]);
  renderTools();
  refreshIndicators();
  chart.timeScale().setVisibleLogicalRange({ from: bars.length - 150, to: bars.length + 8 });
  $('#loading').hidden = true;
  updateLegend();
  updateStatus();
  renderDetails();
  unsubscribeBars = feed.subscribeBars(settings.coin, settings.interval, (bar) => {
    if (id !== loadId) return;
    onBar(bar);
  }, bars[bars.length - 1]);
  return true;
}

function onBar(bar) {
  const last = bars[bars.length - 1];
  if (last && bar.time < last.time) return;
  if (last && bar.time === last.time) bars[bars.length - 1] = bar;
  else bars.push(bar);
  const data = mainData(settings.chartType === 'heikin' ? bars.slice(-2) : [bar]);
  mainSeries.update(data[data.length - 1]);
  refreshIndicators(true);
  updateLegend();
  detailsRender ||= requestAnimationFrame(() => { detailsRender = 0; renderDetails(); });
}
let detailsRender = 0;

// ---------- 범례 ----------
const fmt = (v, digits) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtVol = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(0));

let hoverTime = null;
chart.subscribeCrosshairMove((p) => {
  hoverTime = p.time ?? null;
  crosshairPoint = p.point ?? null;
  updateLegend();
});

const LEGEND_ICONS = {
  eye: '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/>',
  eyeOff: '<path d="M3 3l14 14M8.3 5A8 8 0 0110 4.5c5 0 8 5.5 8 5.5a14 14 0 01-2.4 3M5.2 6.6A14 14 0 002 10s3 5.5 8 5.5a7.6 7.6 0 003.4-.8"/>',
  gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
};
const smallIcon = (name) => `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LEGEND_ICONS[name]}</svg>`;

// 범례 틀: 지표가 바뀔 때만 다시 만들고, 값은 updateLegend()가 채운다.
function renderLegend() {
  const rows = settings.indicators.map((study) => {
    const def = studyDef(study.type);
    const vals = def.plots.filter((p) => p.kind !== 'color')
      .map((p) => `<span class="v" data-plot="${p.key}" style="color:${study.colors[p.key]}"></span>`).join('');
    return `<div class="row study ${study.hidden ? 'is-hidden' : ''}" data-id="${study.id}">
      <span class="k">${studyTitle(study)}</span>${vals}
      <span class="ind-actions">
        <button data-act="toggle" title="${study.hidden ? '보이기' : '숨기기'}" aria-label="${study.hidden ? '보이기' : '숨기기'}">${smallIcon(study.hidden ? 'eyeOff' : 'eye')}</button>
        <button data-act="settings" title="설정" aria-label="설정">${smallIcon('gear')}</button>
        <button data-act="remove" title="삭제" aria-label="삭제">${smallIcon('x')}</button>
      </span>
    </div>`;
  }).join('');
  // 트레이딩뷰처럼 지표 범례 아래의 작은 화살표로 접고 펼친다
  const n = settings.indicators.length;
  const folded = settings.legendCollapsed;
  const toggle = n ? `<button class="legend-toggle" data-act="collapse" aria-expanded="${!folded}" title="${folded ? '지표 범례 펼치기' : '지표 범례 접기'}">${folded ? `<span>지표 ${n}개</span>` : ''}<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${folded ? 'M6 8l4 4 4-4' : 'M6 12l4-4 4 4'}"/></svg></button>` : '';
  $('#legend').innerHTML = `<div class="row head"></div><div class="study-rows" ${folded ? 'hidden' : ''}>${rows}</div>${toggle}`;
  updateLegend();
}

function updateLegend() {
  if (!bars.length) return;
  const idx = hoverTime == null ? bars.length - 1 : bars.findIndex((b) => b.time === hoverTime);
  const bar = bars[idx] ?? bars[bars.length - 1];
  const prev = bars[bars.indexOf(bar) - 1] ?? bar;
  const digits = priceFormatFor(bar.close).precision;
  const change = bar.close - prev.close;
  const cls = change >= 0 ? 'up' : 'down';
  const interval = INTERVALS.find((i) => i.id === settings.interval).label;
  // 휴대폰: 트레이딩뷰처럼 시가·고가·저가와 지표 값은 길게 눌러 십자선을 띄웠을 때만 보인다
  const brief = usingTouch() && isApp() && !crosshairPoint;
  $('#legend').classList.toggle('values-hidden', brief);

  const head = $('#legend .head');
  if (head && brief) {
    head.innerHTML = `<span class="title">${marketLabel()} · ${interval} · ${feed.name}</span>
      <span class="${cls}">${fmt(bar.close, digits)}</span>
      <span class="${cls}">${change >= 0 ? '+' : ''}${fmt(change, digits)} (${change >= 0 ? '+' : ''}${((change / prev.close) * 100).toFixed(2)}%)</span>`;
  } else if (head) {
    head.innerHTML = `<span class="title">${marketLabel()} · ${interval} · ${feed.name}</span>`
      + (settings.chart.legendOhlc ? `
      <span><span class="k">시</span><span class="${cls}">${fmt(bar.open, digits)}</span></span>
      <span><span class="k">고</span><span class="${cls}">${fmt(bar.high, digits)}</span></span>
      <span><span class="k">저</span><span class="${cls}">${fmt(bar.low, digits)}</span></span>
      <span><span class="k">종</span><span class="${cls}">${fmt(bar.close, digits)}</span></span>
      <span class="${cls}">${change >= 0 ? '+' : ''}${fmt(change, digits)} (${change >= 0 ? '+' : ''}${((change / prev.close) * 100).toFixed(2)}%)</span>` : '');
  }
  if (!settings.chart.legendValues) return;
  for (const [id, inst] of active) {
    const row = $(`#legend .study[data-id="${id}"]`);
    if (!row) continue;
    for (const el of row.querySelectorAll('.v')) {
      const v = inst.values[el.dataset.plot]?.get(bar.time);
      el.textContent = v == null ? '' : inst.def.format === 'volume' ? fmtVol(v) : fmt(v, inst.def.pane === 'sub' ? 2 : digits);
    }
  }
}

$('#legend').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  const row = e.target.closest('.study');
  // 휴대폰: 지표 줄을 누르면 그 줄의 버튼(숨기기·설정·삭제)이 나타난다
  if (!btn && row && usingTouch()) {
    for (const r of $('#legend').querySelectorAll('.study.open')) if (r !== row) r.classList.remove('open');
    row.classList.toggle('open');
    return;
  }
  if (!btn) return;
  if (btn.dataset.act === 'collapse') {
    settings.legendCollapsed = !settings.legendCollapsed;
    save();
    return renderLegend();
  }
  const id = btn.closest('.study').dataset.id;
  const study = settings.indicators.find((x) => x.id === id);
  if (btn.dataset.act === 'toggle') { study.hidden = !study.hidden; saveStudies(); }
  if (btn.dataset.act === 'remove') removeStudy(id);
  if (btn.dataset.act === 'settings') openStudySettings(id);
});

// ---------- 아이콘 ----------
const ICONS = {
  cross: '<path d="M10 2v16M2 10h16"/>',
  dot: '<circle cx="10" cy="10" r="2.2" fill="currentColor"/>',
  arrow: '<path d="M5 3l11 6.5-5 1.2L8.8 16z"/>',
  trend: '<path d="M4 15L15 4"/><circle cx="4" cy="15" r="1.6"/><circle cx="15" cy="4" r="1.6"/>',
  ray: '<path d="M4 15L16 3"/><circle cx="4" cy="15" r="1.6"/><path d="M12 3h4v4"/>',
  hline: '<path d="M2 10h16"/><circle cx="10" cy="10" r="1.6"/>',
  hray: '<path d="M6 10h12"/><circle cx="5" cy="10" r="1.6"/><path d="M15 7l3 3-3 3"/>',
  vline: '<path d="M10 2v16"/><circle cx="10" cy="10" r="1.6"/>',
  crossline: '<path d="M10 2v16M2 10h16"/><circle cx="10" cy="10" r="1.6"/>',
  channel: '<path d="M3 13L13 5M7 17L17 9"/>',
  rect: '<rect x="3.5" y="5.5" width="13" height="9" rx="1"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5"/>',
  fib: '<path d="M3 4h14M3 8h14M3 11h14M3 16h14"/>',
  measure: '<path d="M10 3v14M6 7l4-4 4 4M6 13l4 4 4-4"/>',
  long: '<rect x="3" y="3" width="14" height="7" rx="1"/><path d="M3 13h14M3 17h14" stroke-dasharray="2 2"/>',
  short: '<path d="M3 3h14M3 7h14" stroke-dasharray="2 2"/><rect x="3" y="10" width="14" height="7" rx="1"/>',
  text: '<path d="M4 5V3h12v2M10 3v14M7 17h6"/>',
  eraser: '<path d="M8 17h9M3.5 12.5l7-7a1.5 1.5 0 012 0l3 3a1.5 1.5 0 010 2L10 16H7z"/><path d="M7 9l5 5"/>',
  infoline: '<path d="M3 16L13 6"/><circle cx="3" cy="16" r="1.5"/><circle cx="13" cy="6" r="1.5"/><rect x="11" y="11" width="7" height="6" rx="1"/>',
  extended: '<path d="M1 18L19 2"/><circle cx="7" cy="12.7" r="1.5"/><circle cx="13" cy="7.3" r="1.5"/>',
  trendangle: '<path d="M3 16L16 5M3 16h14"/><path d="M10 16a7 7 0 00-1.6-4.4"/>',
  regression: '<path d="M2 14L18 6"/><path d="M2 10l16-8M2 18l16-8" stroke-dasharray="2 2"/>',
  fibext: '<path d="M3 4h14M3 9h14M3 14h14"/><path d="M3 18l4-6 4 3" stroke-dasharray="2 2"/>',
  fibtime: '<path d="M3 3v14M6 3v14M9 3v14M14 3v14"/>',
  daterange: '<path d="M3 3v14M17 3v14M5 10h10M12 7l3 3-3 3"/>',
  pricerange: '<path d="M3 3h14M3 17h14M10 5v10M7 12l3 3 3-3"/>',
  brush: '<path d="M3 15c3 0 3-4 6-4s2 4 5 4 3-3 3-3"/>',
  highlighter: '<path d="M4 16l2-6 7-7 3 3-7 7z"/><path d="M3 18h7" stroke-width="3"/>',
  circle: '<circle cx="10" cy="10" r="7"/>',
  triangle: '<path d="M10 3l7 13H3z"/>',
  path: '<path d="M3 16l4-8 5 5 4-9"/><path d="M13 4h3v3"/>',
  polyline: '<path d="M3 15l3-10 6 3 5 8z"/>',
  pricelabel: '<rect x="3" y="4" width="14" height="8" rx="2"/><path d="M8 12l2 4 2-4"/>',
  arrowmark: '<path d="M4 16L16 4M10 4h6v6"/>',
  arrowup: '<path d="M10 3l6 7h-4v7H8v-7H4z"/>',
  arrowdown: '<path d="M10 17l6-7h-4V3H8v7H4z"/>',
  more: '<circle cx="5" cy="10" r="1.3" fill="currentColor"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="10" r="1.3" fill="currentColor"/>',
  grip: '<circle cx="8" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="10" r="1.2" fill="currentColor"/><circle cx="8" cy="15" r="1.2" fill="currentColor"/><circle cx="12" cy="15" r="1.2" fill="currentColor"/>',
  magnet: '<path d="M5 3v7a5 5 0 0010 0V3"/><path d="M5 6h3M12 6h3"/>',
  off: '<path d="M5 3v7a5 5 0 0010 0V3"/><path d="M5 6h3M12 6h3M3 17L17 3"/>',
  weak: '<path d="M5 3v7a5 5 0 0010 0V3"/><path d="M5 6h3M12 6h3"/>',
  strong: '<path d="M5 3v7a5 5 0 0010 0V3"/><path d="M5 6h3M12 6h3"/><path d="M8 11h4" stroke-width="2.4"/>',
  lock: '<rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 016 0V9"/>',
  unlock: '<rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 015.8-1"/>',
  eye: '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/>',
  eyeOff: '<path d="M3 3l14 14M8.3 5A8 8 0 0110 4.5c5 0 8 5.5 8 5.5a14 14 0 01-2.4 3M5.2 6.6A14 14 0 002 10s3 5.5 8 5.5a7.6 7.6 0 003.4-.8"/>',
  undo: '<path d="M7 5L3 9l4 4"/><path d="M3 9h9a5 5 0 010 10H9"/>',
  redo: '<path d="M13 5l4 4-4 4"/><path d="M17 9H8a5 5 0 000 10h3"/>',
  clear: '<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>',
  stay: '<path d="M4 16l1-4 8-8 3 3-8 8z"/><path d="M11 6l3 3"/><rect x="12.5" y="13" width="5" height="4" rx="1"/><path d="M13.5 13v-1a1.5 1.5 0 013 0v1"/>',
  copy: '<rect x="6" y="6" width="10" height="11" rx="1.5"/><path d="M4 13V4.5A1.5 1.5 0 015.5 3H13"/>',
  gear: '<path d="M8.7 2.5h2.6l.4 2 1.5.7 1.7-1.1 1.8 1.8-1.1 1.7.7 1.5 2 .4v2.6l-2 .4-.7 1.5 1.1 1.7-1.8 1.8-1.7-1.1-1.5.7-.4 2H8.7l-.4-2-1.5-.7-1.7 1.1-1.8-1.8 1.1-1.7-.7-1.5-2-.4V8.7l2-.4.7-1.5-1.1-1.7 1.8-1.8 1.7 1.1 1.5-.7z"/><circle cx="10" cy="10" r="2.4"/>',
  fullscreen: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>',
  camera: '<path d="M3 7h3l1.5-2h5L14 7h3v9H3z"/><circle cx="10" cy="11.5" r="3"/>',
  sun: '<circle cx="10" cy="10" r="3.5"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4"/>',
  moon: '<path d="M16 12.5A7 7 0 017.5 4 7 7 0 1016 12.5z"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
  search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/>',
  list: '<path d="M7 5h10M7 10h10M7 15h10"/><circle cx="3.5" cy="5" r=".9" fill="currentColor"/><circle cx="3.5" cy="10" r=".9" fill="currentColor"/><circle cx="3.5" cy="15" r=".9" fill="currentColor"/>',
  menu: '<path d="M3 5h14M3 10h14M3 15h14"/>',
  chevron: '<path d="M8 5l5 5-5 5"/>',
  pencil: '<path d="M4 16l1-4 8.3-8.3a2 2 0 012.8 2.8L7.8 15z"/><path d="M12 5.5l2.5 2.5"/>',
  panel: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M12 3v14M14 7h1M14 10h1M14 13h1"/>',
  star: '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  bars: '<path d="M6 3v14M3 6h3M6 13h3M14 4v12M11 8h3M14 12h3"/>',
  candles: '<path d="M6 2v3M6 15v3M14 4v3M14 14v3"/><rect x="4" y="5" width="4" height="10" fill="currentColor"/><rect x="12" y="7" width="4" height="7"/>',
  hollow: '<path d="M6 2v3M6 15v3M14 4v3M14 14v3"/><rect x="4" y="5" width="4" height="10"/><rect x="12" y="7" width="4" height="7"/>',
  heikin: '<path d="M6 3v2M6 14v3M14 5v2M14 15v2"/><rect x="4" y="5" width="4" height="9" rx="1" fill="currentColor"/><rect x="12" y="7" width="4" height="8" rx="1" fill="currentColor"/>',
  line: '<path d="M2 15l5-6 4 3 7-8"/>',
  area: '<path d="M2 15l5-6 4 3 7-8v14H2z" fill="currentColor" fill-opacity="0.25"/><path d="M2 15l5-6 4 3 7-8"/>',
  baseline: '<path d="M2 10h16" stroke-dasharray="2 2"/><path d="M2 13l4-6 4 5 4-8 4 6"/>',
};
const icon = (name, size = 18) => `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const shortcut = (name) => (navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+') + name;

// ---------- 그리기 도구 (트레이딩뷰처럼 묶음 + 펼침 메뉴) ----------
const CURSORS = [
  { id: 'cross', label: '십자선' },
  { id: 'dot', label: '점' },
  { id: 'arrow', label: '화살표' },
  { id: 'eraser', label: '지우개' },
];
// 트레이딩뷰 왼쪽 도구 막대와 같은 묶음·순서
const TOOL_GROUPS = [
  { id: 'cursor', items: CURSORS.map((c) => c.id) },
  { id: 'lines', label: '추세선 도구', items: ['trend', 'ray', 'infoline', 'extended', 'trendangle', 'hline', 'hray', 'vline', 'crossline', 'channel', 'regression'] },
  { id: 'fib', label: '피보나치 도구', items: ['fib', 'fibext', 'fibtime'] },
  { id: 'forecast', label: '예측·측정 도구', items: ['long', 'short', 'daterange', 'pricerange', 'measure'] },
  { id: 'shapes', label: '기하 도형', items: ['brush', 'highlighter', 'rect', 'circle', 'ellipse', 'triangle', 'path', 'polyline'] },
  { id: 'annotation', label: '주석 도구', items: ['text', 'pricelabel', 'arrow', 'arrowup', 'arrowdown'] },
];
// 그리기 도구 'arrow'와 커서 'arrow'가 같은 이름이라 아이콘을 구분한다
const toolIcon = (groupId, id) => icon(groupId === 'annotation' && id === 'arrow' ? 'arrowmark' : id);
const MAGNETS = { weak: '약한 자석: 가까울 때만 시가·고가·저가·종가에 붙임', strong: '강한 자석: 항상 가장 가까운 시가·고가·저가·종가에 붙임' };
const REMOVE_ITEMS = [
  { id: 'remove-drawings', label: '그림 지우기' },
  { id: 'remove-studies', label: '지표 지우기' },
  { id: 'remove-all', label: '그림과 지표 지우기' },
];
const MAGNET_ITEMS = [{ id: 'weak', label: '약한 자석' }, { id: 'strong', label: '강한 자석' }, { id: 'off', label: '자석 끄기' }];
const toolInfo = (id, groupId) => (groupId === 'cursor' ? CURSORS.find((c) => c.id === id) : null)
  ?? TOOLS.find((t) => t.id === id) ?? CURSORS.find((c) => c.id === id) ?? MAGNET_ITEMS.find((m) => m.id === id) ?? REMOVE_ITEMS.find((m) => m.id === id);
const altKey = (key) => (key ? `Alt+${key}` : '');

// 휴대폰 화면 폭이면 트레이딩뷰 앱 같은 화면 (아래 탭, 아래에서 올라오는 메뉴)
const appMedia = matchMedia('(max-width: 768px), (pointer: coarse) and (max-height: 520px)');
// 휴대폰 가로: 아래 탭 없이 차트만 (style.css와 같은 조건)
const landscapeMedia = matchMedia('(pointer: coarse) and (max-height: 520px) and (orientation: landscape)');
const isApp = () => appMedia.matches;

// 마지막으로 쓴 입력. 손가락이면 트레이딩뷰 모바일처럼 십자선으로 그린다.
let lastPointer = matchMedia('(hover: none)').matches ? 'touch' : 'mouse';
document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
const usingTouch = () => lastPointer !== 'mouse';

const drawings = new DrawingManager({
  chart,
  getBars: () => bars,
  getStep: () => INTERVALS.find((i) => i.id === settings.interval).seconds,
  formatPrice: (p) => fmt(p, priceFormatFor(bars.length ? bars[bars.length - 1].close : Math.abs(p)).precision),
  formatTime: (t) => {
    const d = new Date(t * 1000), two = (n) => String(n).padStart(2, '0');
    const date = `${String(d.getFullYear()).slice(2)}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    return stepSeconds() >= 86400 ? date : `${date} ${two(d.getHours())}:${two(d.getMinutes())}`;
  },
  formatVolume: (v) => fmtVol(v),
  onTextCreated: (d) => openTextEditor(d),
  onChange: (list) => {
    if (list.length) settings.drawings[lineKey()] = list;
    else delete settings.drawings[lineKey()];
    save();
    renderTools();
  },
  onSelect: () => renderSelectionBar(),
  onToolChange: () => { renderTools(); showTouchCursor(); },
  onDraft: () => renderHint(),
});

// 휴대폰: 도구를 고르면 트레이딩뷰처럼 십자선이 바로 나타난다 (마지막 자리, 처음이면 차트 가운데).
// 손가락을 끌면 십자선이 그만큼 움직이고, 탭하면 십자선 자리에 점을 찍는다.
function showTouchCursor() {
  if (drawings.tool === 'cursor' || drawings.isFreehandTool || !usingTouch()) {
    if (drawings.touchCursor) drawings.setTouchCursor(null);
    return;
  }
  if (!drawings.touchCursor) moveTouchCursor(drawings.lastTouchCursor ?? { x: chart.timeScale().width() / 2, y: chart.panes()[0].getHeight() / 2 });
}

function groupCurrent(g) {
  return g.id === 'cursor' ? settings.cursorMode : settings.toolGroups[g.id] ?? g.items[0];
}

function renderTools() {
  const tool = drawings.tool;
  $('.tools').innerHTML = [
    ...TOOL_GROUPS.map((g) => {
      const current = groupCurrent(g);
      const info = toolInfo(current, g.id);
      const isActive = g.id === 'cursor' ? tool === 'cursor' : tool === current;
      const caret = g.items.length > 1 ? `<span class="caret" data-flyout="${g.id}" title="${g.label ?? '더 보기'}"></span>` : '';
      const key = altKey(info.key);
      return `<button class="tool ${isActive ? 'active' : ''}" data-group="${g.id}" title="${info.label}${key ? ` (${key})` : ''}" aria-label="${info.label}">${toolIcon(g.id, current)}${caret}</button>`;
    }),
    '<div class="tools-sep"></div>',
    `<button class="tool ${drawings.stay ? 'active' : ''}" data-action="stay" title="드로잉 모드 유지: 다 그려도 같은 도구로 계속 그림" aria-label="드로잉 모드 유지" aria-pressed="${drawings.stay}">${icon('stay')}</button>`,
    `<button class="tool ${drawings.magnet !== 'off' ? 'active' : ''}" data-action="magnet" title="${MAGNETS[settings.magnetMode]} (그리는 중 Ctrl을 누르면 잠깐 반대로)" aria-label="자석" aria-pressed="${drawings.magnet !== 'off'}">${icon(settings.magnetMode)}<span class="caret" data-flyout="magnet" title="자석 방식"></span></button>`,
    `<button class="tool ${drawings.locked ? 'active' : ''}" data-action="lock" title="${drawings.locked ? '그림 잠금 풀기' : '그림 모두 잠그기'}" aria-label="잠금" aria-pressed="${drawings.locked}">${icon(drawings.locked ? 'lock' : 'unlock')}</button>`,
    `<button class="tool ${drawings.hidden ? 'active' : ''}" data-action="hide" title="${drawings.hidden ? '그림 보이기' : '그림 모두 숨기기'}" aria-label="숨기기" aria-pressed="${drawings.hidden}">${icon(drawings.hidden ? 'eyeOff' : 'eye')}</button>`,
    `<button class="tool" data-action="clear" title="그림 지우기" aria-label="지우기" aria-haspopup="menu">${icon('clear')}<span class="caret" data-flyout="remove" title="지우기 메뉴"></span></button>`,
  ].join('');
  for (const b of document.querySelectorAll('.undo-btn')) b.disabled = !drawings.canUndo;
  for (const b of document.querySelectorAll('.redo-btn')) b.disabled = !drawings.canRedo;
  $('.chart-wrap').classList.toggle('drawing', tool !== 'cursor');
  renderHint();
}

// 그리는 동안 화면 아래 안내: 몇 번째 점인지와 다음에 할 일
const ORDINAL = ['첫', '둘째', '셋째', '넷째'];
function renderHint() {
  const hint = $('#draw-hint');
  const t = TOOLS.find((x) => x.id === drawings.tool);
  hint.hidden = !t;
  if (!t) return;
  const placed = drawings.draft?.points.length ?? 0;
  const touch = usingTouch();
  let text;
  if (t.points === 'free') text = touch ? '손가락으로 그으세요' : '누른 채 그으세요 · Esc 취소';
  else if (touch) {
    // 휴대폰은 화면이 좁아 짧게: 십자선을 끌어서 옮기고, 탭하면 십자선 자리에 점
    text = t.points === 'multi' ? `점 ${placed}개 · 끌어서 옮기고 탭${placed >= (t.id === 'polyline' ? 3 : 2) ? ' · 두 번 탭하면 끝' : ''}`
      : t.points === 1 ? '끌어서 옮기고 탭'
      : `${placed + 1}/${t.points} · 끌어서 옮기고 탭해서 ${ORDINAL[placed]} 점`;
  } else {
    text = t.points === 'multi' ? `점 ${placed}개 · 점을 차례로 찍고, 마지막 점을 한 번 더 누르거나 Enter로 끝내기 · Esc 취소`
      : t.points === 1 ? '차트를 누르세요 · Esc 취소'
      : placed ? `${placed + 1}/${t.points} · ${ORDINAL[placed]} 점을 누르세요 · Shift로 각도 고정 · Esc 취소`
      : t.points === 2 ? '누른 채 끌거나 두 곳을 차례로 누르세요 · Shift로 각도 고정 · Esc 취소'
      : `1/${t.points} · 첫 점을 누르세요 · Esc 취소`;
  }
  hint.innerHTML = `<span>${t.label} · ${text}</span>${touch ? '<button type="button" class="hint-cancel">취소</button>' : ''}`;
}
$('#draw-hint').addEventListener('click', (e) => {
  if (!e.target.closest('.hint-cancel')) return;
  drawings.cancelDraft();
  drawings.setTool('cursor');
});

function pickTool(groupId, id) {
  if (groupId === 'cursor') {
    settings.cursorMode = id;
    applyTheme();
    drawings.setTool('cursor');
  } else {
    settings.toolGroups[groupId] = id;
    drawings.setTool(id);
  }
  save();
}

function openFlyout(groupId, anchor) {
  const g = groupId === 'magnet' ? { id: 'magnet', items: MAGNET_ITEMS.map((m) => m.id) }
    : groupId === 'remove' ? { id: 'remove', items: REMOVE_ITEMS.map((m) => m.id) }
    : TOOL_GROUPS.find((x) => x.id === groupId);
  const fly = $('#flyout');
  const current = groupId === 'magnet' ? (drawings.magnet === 'off' ? null : drawings.magnet) : groupCurrent(g);
  fly.innerHTML = (g.label ? `<div class="pop-title">${g.label}</div>` : '') + g.items.map((id) => {
    const info = toolInfo(id, g.id);
    return `<button class="fly-item ${id === current ? 'active' : ''}" data-group="${g.id}" data-pick="${id}" role="menuitem">
      ${g.id === 'remove' ? '' : toolIcon(g.id, id)}<span>${info.label}</span><span class="fly-key">${altKey(info.key)}</span></button>`;
  }).join('');
  const r = anchor.getBoundingClientRect();
  fly.style.top = `${Math.max(8, Math.min(r.top, innerHeight - g.items.length * 36 - 40))}px`;
  fly.style.left = `${r.right + 4}px`;
  fly.hidden = false;
  fly.dataset.group = groupId;
}
const closeFlyout = () => { $('#flyout').hidden = true; };

$('.tools').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  const caret = e.target.closest('.caret');
  if (caret) return $('#flyout').hidden || $('#flyout').dataset.group !== caret.dataset.flyout ? openFlyout(caret.dataset.flyout, btn) : closeFlyout();
  if (btn.dataset.group) {
    const g = TOOL_GROUPS.find((x) => x.id === btn.dataset.group);
    const active = btn.classList.contains('active');
    closeFlyout();
    // 이미 고른 묶음을 다시 누르면 펼침 메뉴를 연다 (휴대폰에서 작은 화살표 대신)
    if (active && g.items.length > 1) return openFlyout(g.id, btn);
    return pickTool(g.id, groupCurrent(g));
  }
  const action = btn.dataset.action;
  if (action === 'magnet') {
    // 휴대폰에서는 작은 삼각형을 누를 수 없으니, 켜진 자석을 누르면 방식 메뉴를 연다
    if (drawings.magnet !== 'off' && matchMedia('(hover: none)').matches) return openFlyout('magnet', btn);
    setMagnet(drawings.magnet === 'off' ? settings.magnetMode : 'off');
  }
  if (action === 'stay') { drawings.stay = !drawings.stay; settings.stayDrawing = drawings.stay; save(); renderTools(); }
  if (action === 'lock') { drawings.locked = !drawings.locked; drawings.select(null); renderTools(); }
  if (action === 'hide') { drawings.hidden = !drawings.hidden; drawings.select(null); drawings.update(); renderTools(); }
  if (action === 'clear') {
    // 휴대폰에서는 삼각형을 누를 수 없으니 메뉴를 연다
    if (matchMedia('(hover: none)').matches) return openFlyout('remove', btn);
    drawings.clear();
  }
});
$('#flyout').addEventListener('click', (e) => {
  const item = e.target.closest('[data-pick]');
  if (!item) return;
  closeFlyout();
  if (item.dataset.group === 'magnet') return setMagnet(item.dataset.pick);
  if (item.dataset.group === 'remove') {
    if (item.dataset.pick !== 'remove-studies') drawings.clear();
    if (item.dataset.pick !== 'remove-drawings') { settings.indicators = []; saveStudies(); }
    return;
  }
  pickTool(item.dataset.group, item.dataset.pick);
});

function setMagnet(mode) {
  drawings.magnet = mode;
  settings.magnet = mode;
  if (mode !== 'off') settings.magnetMode = mode;
  save();
  renderTools();
}
document.addEventListener('pointerdown', (e) => {
  if (!$('#flyout').hidden && !e.target.closest('#flyout, .tools')) closeFlyout();
}, true);

// 선택한 도형의 떠 있는 도구 막대: 색, 선 두께, 선 모양, 설정, 잠금, 삭제
const LINE_STYLE_LABELS = { solid: '실선', dashed: '파선', dotted: '점선' };
const HAS_LINE = (d) => !['text', 'measure', 'long', 'short', 'pricelabel', 'arrowup', 'arrowdown', 'daterange', 'pricerange'].includes(d.type);
const lineStyleSvg = (style, width = 2) => `<svg width="28" height="10" aria-hidden="true"><line x1="2" y1="5" x2="26" y2="5" stroke="currentColor" stroke-width="${width}" stroke-dasharray="${(LINE_STYLES[style] ?? []).join(' ')}" stroke-linecap="round"/></svg>`;

function renderSelectionBar() {
  const d = drawings.selected;
  const bar = $('#draw-bar');
  bar.hidden = !d;
  if (!d) return;
  const count = drawings.selection.size;
  const label = count > 1 ? `${count}개 선택` : TOOLS.find((t) => t.id === d.type)?.label ?? '';
  placeDrawBar();
  bar.innerHTML = `<span class="bar-grip" title="끌어서 옮기기" aria-hidden="true">${icon('grip', 16)}</span><span class="draw-bar-label">${label}</span>`
    + (d.type === 'measure' ? '' : `<button class="bar-btn" data-action="color" title="색" aria-label="색"><span class="color-dot" style="--c:${d.color}"></span></button>`)
    + (HAS_LINE(d) ? `<button class="bar-btn" data-action="width" title="선 두께">${lineStyleSvg('solid', d.width ?? 2)}<span>${d.width ?? 2}px</span></button>
      <button class="bar-btn" data-action="style" title="선 모양">${lineStyleSvg(d.lineStyle ?? 'solid')}</button>` : '')
    // 휴대폰에는 Shift가 없으니 트레이딩뷰 모바일처럼 45° 고정 버튼을 둔다
    + (usingTouch() && canAngleLock(d.type) ? `<button class="bar-btn angle ${drawings.angleLock ? 'on' : ''}" data-action="angle" title="45° 단위로 고정" aria-pressed="${drawings.angleLock}">45°</button>` : '')
    + `<button class="bar-btn" data-action="settings" title="설정 (더블클릭)" aria-label="설정">${icon('gear', 16)}</button>
      <button class="bar-btn ${d.locked ? 'on' : ''}" data-action="lock" title="${d.locked ? '잠금 풀기' : '잠그기'}" aria-label="잠금">${icon(d.locked ? 'lock' : 'unlock', 16)}</button>
      <button class="bar-btn danger" data-action="delete" title="삭제 (Delete)" aria-label="삭제">${icon('clear', 16)}</button>
      <button class="bar-btn" data-action="more" title="더 보기" aria-label="더 보기" aria-haspopup="menu">${icon('more', 16)}</button>`;
}

// 떠 있는 막대는 손잡이로 끌어 옮길 수 있고, 위치를 기억한다
function placeDrawBar() {
  const bar = $('#draw-bar');
  const pos = settings.drawBarPos;
  bar.classList.toggle('placed', !!pos);
  bar.style.left = pos ? `${pos.x}px` : '';
  bar.style.top = pos ? `${pos.y}px` : '';
}
$('#draw-bar').addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.bar-grip')) return;
  e.preventDefault();
  const bar = $('#draw-bar'), wrap = $('.chart-wrap').getBoundingClientRect(), r = bar.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  const move = (ev) => {
    settings.drawBarPos = {
      x: Math.max(0, Math.min(ev.clientX - wrap.left - dx, wrap.width - r.width)),
      y: Math.max(0, Math.min(ev.clientY - wrap.top - dy, wrap.height - r.height)),
    };
    placeDrawBar();
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save(); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

$('#draw-bar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const d = drawings.selected;
  if (!btn || !d) return;
  const act = btn.dataset.action;
  if (act === 'color') {
    openPopover(btn, `<div class="palette">${COLORS.map((c) => `<button class="swatch-btn ${c === d.color ? 'active' : ''}" data-value="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>`,
      (c) => drawings.updateSelected({ color: c }));
  }
  if (act === 'width') {
    openPopover(btn, [1, 2, 3, 4].map((w) => `<div class="pop-item ${w === (d.width ?? 2) ? 'active' : ''}" data-value="${w}">${lineStyleSvg('solid', w)}<span>${w}px</span></div>`).join(''),
      (w) => drawings.updateSelected({ width: Number(w) }));
  }
  if (act === 'style') {
    openPopover(btn, Object.keys(LINE_STYLES).map((st) => `<div class="pop-item ${st === (d.lineStyle ?? 'solid') ? 'active' : ''}" data-value="${st}">${lineStyleSvg(st)}<span>${LINE_STYLE_LABELS[st]}</span></div>`).join(''),
      (st) => drawings.updateSelected({ lineStyle: st }));
  }
  if (act === 'settings') openDrawingSettings();
  if (act === 'angle') { drawings.angleLock = !drawings.angleLock; renderSelectionBar(); }
  if (act === 'lock') drawings.updateSelected({ locked: !d.locked });
  if (act === 'delete') drawings.removeSelected();
  if (act === 'more') {
    const items = [['duplicate', '복제'], ['copy', '복사'], ['sep'], ['front', '맨 앞으로'], ['back', '맨 뒤로'], ['sep'], ['settings', '설정…']];
    openPopover(btn, items.map(([v, text]) => (v === 'sep' ? '<div class="pop-sep"></div>' : `<div class="pop-item" data-value="${v}"><span>${text}</span></div>`)).join(''), (v) => {
      if (v === 'duplicate') drawings.duplicateSelected();
      if (v === 'copy') drawings.copySelected();
      if (v === 'front') drawings.reorderSelected(true);
      if (v === 'back') drawings.reorderSelected(false);
      if (v === 'settings') openDrawingSettings();
    });
  }
});

// ---------- 차트 위에서 바로 글자 입력 (텍스트 도구) ----------
const textEditor = $('#text-editor');
let editingText = null;
function openTextEditor(d) {
  const px = drawings.pointToPixel(d.points[0]);
  if (!px) return;
  editingText = d.id;
  d.editing = true;
  const live = drawings.drawings.find((x) => x.id === d.id);
  if (live) live.editing = true;
  drawings.update();
  const fs = d.fontSize ?? 14;
  Object.assign(textEditor.style, { left: `${px.x}px`, top: `${px.y}px`, fontSize: `${fs}px`, color: d.color });
  textEditor.value = d.text ?? '';
  textEditor.hidden = false;
  autosizeText();
  requestAnimationFrame(() => textEditor.focus());
}
function autosizeText() {
  textEditor.style.width = '40px';
  textEditor.style.height = 'auto';
  textEditor.style.width = `${Math.max(60, textEditor.scrollWidth + 8)}px`;
  textEditor.style.height = `${textEditor.scrollHeight}px`;
}
function closeTextEditor(commit) {
  if (!editingText) return;
  const id = editingText;
  editingText = null;
  textEditor.hidden = true;
  const d = drawings.drawings.find((x) => x.id === id);
  if (!d) return;
  delete d.editing;
  const text = textEditor.value.trim();
  drawings.select(id);
  // 빈 글자로 끝내면 트레이딩뷰처럼 지운다
  if (!text || (!commit && !d.text)) return drawings.removeSelected();
  if (commit && text !== d.text) drawings.updateSelected({ text }, true);
  else drawings.update();
}
textEditor.addEventListener('input', autosizeText);
textEditor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeTextEditor(true); }
  if (e.key === 'Escape') { e.preventDefault(); closeTextEditor(false); }
});
textEditor.addEventListener('blur', () => closeTextEditor(true));

// 도형 설정 창 (더블클릭): 스타일 · 텍스트 · 좌표 · 보이기
const drawingDialog = $('#drawing-settings');
const toLocalInput = (t) => {
  const d = new Date(t * 1000), two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};
const POINT_NAMES = {
  long: ['진입', '목표', '손절'], short: ['진입', '목표', '손절'], channel: ['점 1', '점 2', '채널 폭'],
};
const STATS = [['price', '가격 범위'], ['bars', '봉 수·기간'], ['angle', '각도']];

function openDrawingSettings(tab = 'style') {
  const d = drawings.selected;
  if (!d) return;
  const label = TOOLS.find((t) => t.id === d.type).label;
  const isLine = d.type === 'trend' || d.type === 'ray';
  const check = (key, text, on) => `<label class="field check" for="ds-${key}"><input id="ds-${key}" name="${key}" type="checkbox" ${on ? 'checked' : ''} /><span>${text}</span></label>`;
  const tabs = [['style', '스타일'], ...(isLine || d.type === 'text' ? [['text', '텍스트']] : []), ['coords', '좌표'], ['visibility', '보이기']];
  $('#drawing-settings-title').textContent = `${label} 설정`;
  const coordRows = d.points.map((pt, i) => {
    const name = POINT_NAMES[d.type]?.[i] ?? `점 ${i + 1}`;
    const showTime = d.type !== 'hline' && !(['long', 'short'].includes(d.type) && i === 2);
    const showPrice = d.type !== 'vline';
    return `<div class="coord-row"><span class="coord-name">${name}</span>
      ${showPrice ? `<label class="field" for="ds-price${i}"><span>가격</span><input id="ds-price${i}" name="price${i}" type="number" step="any" value="${pt.price}" /></label>` : ''}
      ${showTime ? `<label class="field" for="ds-time${i}"><span>시간</span><input id="ds-time${i}" name="time${i}" type="datetime-local" value="${toLocalInput(pt.time)}" /></label>` : ''}</div>`;
  }).join('');
  $('#drawing-settings-body').innerHTML = `
    <div class="tabs" role="tablist">${tabs.map(([id, text]) => `<button type="button" role="tab" class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${text}</button>`).join('')}</div>
    <section class="tab-panel" data-panel="style" ${tab === 'style' ? '' : 'hidden'}>
      <div class="fields">
        ${d.type === 'measure' ? '' : `<label class="field color" for="ds-color"><span>색</span><input id="ds-color" name="color" type="color" value="${d.color}" /></label>`}
        ${HAS_LINE(d) ? `<label class="field" for="ds-width"><span>선 두께</span><select id="ds-width" name="width">${[1, 2, 3, 4].map((w) => `<option value="${w}" ${w === (d.width ?? 2) ? 'selected' : ''}>${w}px</option>`).join('')}</select></label>
        <label class="field" for="ds-lineStyle"><span>선 모양</span><select id="ds-lineStyle" name="lineStyle">${Object.keys(LINE_STYLES).map((st) => `<option value="${st}" ${st === (d.lineStyle ?? 'solid') ? 'selected' : ''}>${LINE_STYLE_LABELS[st]}</option>`).join('')}</select></label>` : ''}
      </div>
      ${d.type === 'fib' || d.type === 'fibext' ? `<h3>레벨</h3><div class="fields fib-levels">${FIB_LEVELS.map(([l, col]) => check(`lvl-${String(l).replace('.', '_')}`, `<span style="color:${col}">${l}</span>`, (d.levels ?? FIB_LEVELS.map(([x]) => x)).includes(l))).join('')}</div>
      <h3>연장</h3><div class="fields">${check('extendLeft', '왼쪽으로 연장', d.extendLeft)}${check('extendRight', '오른쪽으로 연장', d.extendRight)}</div>` : ''}
      ${isLine ? `<h3>연장·끝 모양</h3><div class="fields">${check('extendLeft', '왼쪽으로 연장', d.extendLeft)}${check('extendRight', '오른쪽으로 연장', d.extendRight ?? d.type === 'ray')}${check('arrowLeft', '시작점 화살표', d.arrowLeft)}${check('arrowRight', '끝점 화살표', d.arrowRight)}</div>
      <h3>통계</h3><div class="fields">${STATS.map(([k, t]) => check(`stat-${k}`, t, d.stats?.includes(k))).join('')}</div>` : ''}
      <h3>기타</h3><div class="fields">${check('locked', '잠금 (옮기지 않기)', d.locked)}</div>
    </section>
    <section class="tab-panel" data-panel="text" ${tab === 'text' ? '' : 'hidden'}>
      <div class="fields one">
        <label class="field" for="ds-text"><span>${isLine ? '선 위에 표시할 글자' : '내용'}</span><textarea id="ds-text" name="text" rows="3">${d.text ?? ''}</textarea></label>
        ${d.type === 'text' ? `<label class="field" for="ds-fontSize"><span>글자 크기</span><select id="ds-fontSize" name="fontSize">${[10, 12, 14, 18, 24, 32].map((f) => `<option value="${f}" ${f === (d.fontSize ?? 14) ? 'selected' : ''}>${f}</option>`).join('')}</select></label>` : ''}
      </div>
    </section>
    <section class="tab-panel" data-panel="coords" ${tab === 'coords' ? '' : 'hidden'}>${coordRows}</section>
    <section class="tab-panel" data-panel="visibility" ${tab === 'visibility' ? '' : 'hidden'}>
      <p class="muted small">선택한 타임프레임에서만 이 도형을 보여 줍니다.</p>
      <div class="fields">${VISIBILITY_GROUPS.map((g) => check(`vis-${g.id}`, g.label, !(d.hiddenOn ?? []).includes(g.id))).join('')}</div>
    </section>`;
  drawingDialog.showModal();
  if (tab === 'text') { const t = $('#ds-text'); t.focus(); t.select(); }
}
$('#drawing-settings-body').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab[data-tab]');
  if (!tab) return;
  for (const b of drawingDialog.querySelectorAll('[data-tab]')) b.classList.toggle('active', b === tab);
  for (const p of drawingDialog.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab.dataset.tab;
});
$('#drawing-settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const d = drawings.selected;
  const f = new FormData(e.currentTarget);
  // 모양: 선택된 모든 도형에
  const style = { locked: f.has('locked'), hiddenOn: VISIBILITY_GROUPS.filter((g) => !f.has(`vis-${g.id}`)).map((g) => g.id) };
  if (f.has('color')) style.color = f.get('color');
  if (f.has('width')) style.width = Number(f.get('width'));
  if (f.has('lineStyle')) style.lineStyle = f.get('lineStyle');
  // 좌표·글자·선 옵션: 이 도형에만
  const own = {};
  if (d.type === 'trend' || d.type === 'ray') {
    Object.assign(own, { extendLeft: f.has('extendLeft'), extendRight: f.has('extendRight'), arrowLeft: f.has('arrowLeft'), arrowRight: f.has('arrowRight') });
    own.stats = STATS.map(([k]) => k).filter((k) => f.has(`stat-${k}`));
    own.text = String(f.get('text') ?? '').trim();
  }
  if (d.type === 'text') { own.text = String(f.get('text')).trim() || d.text; own.fontSize = Number(f.get('fontSize')); }
  if (d.type === 'fib' || d.type === 'fibext') {
    own.levels = FIB_LEVELS.map(([l]) => l).filter((l) => f.has(`lvl-${String(l).replace('.', '_')}`));
    Object.assign(own, { extendLeft: f.has('extendLeft'), extendRight: f.has('extendRight') });
  }
  own.points = d.points.map((pt, i) => ({
    time: f.get(`time${i}`) ? Date.parse(f.get(`time${i}`)) / 1000 : pt.time,
    price: f.get(`price${i}`) !== null && f.get(`price${i}`) !== '' ? Number(f.get(`price${i}`)) : pt.price,
  }));
  if (['long', 'short'].includes(d.type)) own.points[2].time = own.points[1].time;
  drawingDialog.close();
  if (drawings.selection.size > 1) drawings.updateSelected(style);
  drawings.updateSelected(drawings.selection.size > 1 ? own : { ...style, ...own }, true);
});
$('#drawing-settings-cancel').addEventListener('click', () => drawingDialog.close());

// 포인터 입력. 차트보다 먼저(캡처 단계에서) 받아서,
// - 그리기 중에는 누름·끌기·뗌으로 점을 찍고 (차트가 같이 움직이지 않게 막음)
// - 커서 모드에서 도형을 잡으면 차트 대신 도형을 옮긴다.
const chartEl = $('#chart');
const localPoint = (e) => {
  const r = chartEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const keysOf = (e) => ({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
const inMainPane = (pt) => pt.x >= 0 && pt.y >= 0 && pt.x <= chart.timeScale().width() && pt.y <= chart.panes()[0].getHeight();
let press = null; // 누른 위치·시각 (탭 판정용)
let lastTap = null; // 더블클릭(더블탭) 판정용
let blockChart = false;
// 휴대폰 그리기: 트레이딩뷰 모바일처럼 손가락을 끌면 십자선이 그만큼 움직이고, 탭하면 십자선 자리에 점을 찍는다
let trackpad = null; // { finger: 누른 손가락 위치, cursor: 그때 십자선 위치 }

function moveTouchCursor(pt) {
  const w = chart.timeScale().width(), h = chart.panes()[0].getHeight();
  const clamped = { x: Math.max(0, Math.min(w - 1, pt.x)), y: Math.max(0, Math.min(h - 1, pt.y)) };
  drawings.setTouchCursor(clamped);
  return clamped;
}

chartEl.addEventListener('pointerdown', (e) => {
  const pt = localPoint(e);
  const touch = e.pointerType !== 'mouse';
  // drawing: 이 누름이 그리기였는지 (점을 찍다가 도형이 완성돼 커서로 돌아가도 탭으로 치지 않도록)
  press = { point: pt, at: performance.now(), id: e.pointerId, touch, drawing: drawings.tool !== 'cursor' };
  if (e.button !== 0) return;
  if (editingText) return;
  if (drawings.tool !== 'cursor') {
    // 휴대폰에서 십자선이 이미 있으면 차트 어디를 끌어도(눈금·아래 창 포함) 십자선을 옮긴다
    if (!inMainPane(pt) && !(touch && drawings.touchCursor)) return;
    blockChart = true;
    lastTap = null;
    if (touch && !drawings.isFreehandTool) {
      // 첫 터치는 그 자리에 십자선을 놓고, 이후로는 손가락이 움직인 만큼 십자선을 옮긴다
      const cursor = drawings.touchCursor ?? moveTouchCursor(pt);
      trackpad = { finger: pt, cursor };
    } else {
      drawings.pressDraw(pt, keysOf(e));
    }
  } else if (!touch && (drawings.quick || (e.shiftKey && !drawings.hitTest(pt)))) {
    // Shift+클릭 빠른 측정 (다음 클릭에 고정, 그다음 클릭에 사라짐)
    if (!inMainPane(pt)) return;
    drawings.quickMeasureClick(pt);
    blockChart = true;
    press.drawing = true;
  } else if (settings.cursorMode === 'eraser') {
    return;
  } else if (drawings.beginDrag(pt, touch, e.ctrlKey || e.metaKey)) {
    blockChart = true;
  } else {
    return;
  }
  e.stopPropagation();
  e.preventDefault();
}, { capture: true });
for (const type of ['mousedown', 'touchstart']) {
  chartEl.addEventListener(type, (e) => { if (blockChart) e.stopPropagation(); }, { capture: true });
}
window.addEventListener('pointermove', (e) => {
  const pt = localPoint(e);
  if (drawings.drag) return drawings.dragTo(pt, keysOf(e));
  if (trackpad && press?.id === e.pointerId) {
    moveTouchCursor({ x: trackpad.cursor.x + pt.x - trackpad.finger.x, y: trackpad.cursor.y + pt.y - trackpad.finger.y });
    return;
  }
  if (drawings.quick) return drawings.handleMove(pt, keysOf(e));
  if (drawings.tool !== 'cursor') return drawings.handleMove(pt, keysOf(e));
  if (e.target.closest?.('#chart') && e.pointerType === 'mouse') {
    const hit = drawings.setHover(pt);
    $('.chart-wrap').classList.toggle('hovering', !!hit && hit.handle == null);
    $('.chart-wrap').classList.toggle('hovering-handle', !!hit && hit.handle != null);
  }
});

// 탭(짧게 누르고 떼기) 판정. 차트 라이브러리의 클릭 알림은 0.5초 안의 두 번째 클릭을 빠뜨리고,
// 휴대폰에서는 브라우저 click이 오지 않아서 직접 판정한다.
const TAP_MAX_MS = 600;
const DOUBLE_TAP_MS = 350;
// 휴대폰: 그리기용 탭 뒤에 브라우저가 보내는 click이, 도형이 완성된 뒤 손가락 밑의 버튼(범례 등)을 누르지 않도록
// 같은 자리의 바로 다음 click 하나만 삼킨다
let swallowClick = null;
chartEl.addEventListener('pointerup', (e) => {
  const start = press;
  if (e.pointerType !== 'mouse' && (blockChart || trackpad || start?.drawing)) {
    swallowClick = { x: e.clientX, y: e.clientY, until: performance.now() + 400 };
  }
  press = null;
  const pt = localPoint(e);
  blockChart = false;
  if (drawings.drag) { drawings.endDrag(); }
  if (trackpad) {
    // 휴대폰: 끌지 않고 뗀 탭이면 십자선 자리에 점을 찍는다
    const tp = trackpad;
    trackpad = null;
    const tapped = start && Math.hypot(pt.x - start.point.x, pt.y - start.point.y) <= 10 && performance.now() - start.at <= TAP_MAX_MS;
    if (tapped && drawings.tool !== 'cursor') {
      drawings.handleClick(drawings.touchCursor ?? tp.cursor, {});
      navigator.vibrate?.(8); // 점을 찍을 때 살짝 진동 (지원하는 휴대폰만)
    }
    return;
  }
  if (start?.drawing) return drawings.releaseDraw(pt, keysOf(e));
  if (!start || start.id !== e.pointerId || performance.now() - start.at > TAP_MAX_MS) return;
  if (Math.hypot(pt.x - start.point.x, pt.y - start.point.y) > (start.touch ? 10 : 5) || !inMainPane(pt)) return;
  if (settings.cursorMode === 'eraser') {
    // 지우개: 누른 도형을 지운다
    const hit = drawings.hitTest(pt, start.touch ? 14 : 7);
    if (hit) drawings.removeById(hit.drawing.id);
    return;
  }
  drawings.handleClick(pt, { touch: start.touch, ctrl: e.ctrlKey || e.metaKey });
  if (e.ctrlKey || e.metaKey) return;
  // 같은 도형을 빠르게 두 번 누르면 설정 창
  const id = drawings.selected?.id;
  const now = performance.now();
  if (id && lastTap && lastTap.id === id && now - lastTap.at < DOUBLE_TAP_MS) {
    lastTap = null;
    // 텍스트는 차트 위에서 바로 고치고, 나머지는 설정 창
    return drawings.selected.type === 'text' ? openTextEditor(drawings.selected) : openDrawingSettings();
  }
  lastTap = id ? { id, at: now } : null;
}, { capture: true });
window.addEventListener('pointerup', () => { blockChart = false; drawings.endDrag(); });

$('.chart-wrap').addEventListener('click', (e) => {
  const s = swallowClick;
  swallowClick = null;
  if (s && performance.now() < s.until && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 20) { e.stopPropagation(); e.preventDefault(); }
}, { capture: true });
window.addEventListener('pointercancel', () => { blockChart = false; trackpad = null; drawings.endDrag(); });

// ---------- 펼침 메뉴 (툴바·오른쪽 클릭 공용) ----------
const popover = $('#popover');
let popoverAnchor = null;

// 휴대폰 시트: 위쪽 손잡이를 아래로 끌어 내리면 닫힌다 (트레이딩뷰 앱처럼)
function sheetGrip(sheet, close) {
  const grip = document.createElement('div');
  grip.className = 'sheet-grip';
  grip.setAttribute('aria-hidden', 'true');
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let dy = 0;
    const move = (ev) => { dy = Math.max(0, ev.clientY - startY); sheet.style.transform = `translateY(${dy}px)`; };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      sheet.style.transform = '';
      if (dy > 70) close();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  return grip;
}
const popoverGrip = sheetGrip(popover, () => closePopover());

function openPopover(anchor, html, onPick, at) {
  if (popoverAnchor && popoverAnchor === anchor && !popover.hidden) return closePopover();
  popover.innerHTML = html;
  popover.hidden = false;
  popoverAnchor = anchor;
  // 휴대폰: 트레이딩뷰 앱처럼 아래에서 올라오는 시트
  const sheet = isApp();
  popover.classList.toggle('sheet', sheet);
  $('#sheet-backdrop').hidden = !sheet;
  if (sheet) {
    popover.style.left = popover.style.top = '';
    popover.prepend(popoverGrip);
  } else {
    const r = at ?? (() => { const b = anchor.getBoundingClientRect(); return { x: b.left, y: b.bottom + 4 }; })();
    const w = popover.offsetWidth, h = popover.offsetHeight;
    popover.style.left = `${Math.max(8, Math.min(r.x, innerWidth - w - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(r.y, innerHeight - h - 8))}px`;
  }
  popover.onclick = (e) => {
    const item = e.target.closest('[data-value]');
    if (!item) return;
    if (onPick(item.dataset.value, e) !== 'keep') closePopover();
  };
}
function closePopover() {
  popover.hidden = true;
  popoverAnchor = null;
  $('#sheet-backdrop').hidden = true;
}
document.addEventListener('pointerdown', (e) => {
  // 시트 뒤 어두운 배경은 click에서 닫는다 (누르자마자 닫으면 손가락 밑 차트가 그 탭을 받는다)
  if (e.target.id === 'sheet-backdrop') return;
  if (!popover.hidden && !popover.contains(e.target) && !(popoverAnchor && popoverAnchor.contains(e.target))) closePopover();
}, true);
$('#sheet-backdrop').addEventListener('click', closePopover);

const intervalLabel = (id) => INTERVALS.find((i) => i.id === id).label;

function renderIntervals() {
  const favs = INTERVALS.filter((i) => settings.favorites.includes(i.id));
  const current = settings.interval;
  $('#intervals').innerHTML = favs.map((i) =>
    `<button data-interval="${i.id}" class="${i.id === current ? 'active' : ''}">${i.label}</button>`).join('')
    + `<button id="interval-more" class="more ${settings.favorites.includes(current) ? '' : 'active'}" aria-haspopup="menu" title="모든 타임프레임">${settings.favorites.includes(current) ? '' : intervalLabel(current)}<span class="chev"></span></button>`;
  // 휴대폰: 트레이딩뷰 앱처럼 지금 타임프레임 하나만 보이고, 누르면 전체 목록
  $('#interval-btn').innerHTML = `${intervalLabel(current)}<span class="chev"></span>`;
}

function changeInterval(id) {
  if (id === settings.interval) return;
  settings.interval = id;
  settings.range = null;
  save();
  renderIntervals();
  renderRanges();
  loadSymbol();
}

$('#intervals').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.interval) return changeInterval(btn.dataset.interval);
  openIntervalMenu(btn);
});
$('#interval-btn').addEventListener('click', (e) => openIntervalMenu(e.currentTarget));

// 전체 목록: 누르면 바꾸고, 별을 누르면 툴바 즐겨찾기에 넣거나 뺀다
function openIntervalMenu(btn) {
  const groups = [['분', ['1m', '5m', '15m']], ['시간', ['1h', '4h']], ['일·주', ['1d', '1w']]];
  openPopover(btn, groups.map(([title, ids]) => `<div class="pop-title">${title}</div>` + ids.map((id) => `
    <div class="pop-item ${id === settings.interval ? 'active' : ''}" data-value="${id}" role="menuitem">
      <span>${intervalLabel(id)}</span>
      <span class="star ${settings.favorites.includes(id) ? 'on' : ''}" data-value="star:${id}" title="즐겨찾기">${icon('star', 15)}</span>
    </div>`).join('')).join(''), (value) => {
    if (value.startsWith('star:')) {
      const id = value.slice(5);
      settings.favorites = settings.favorites.includes(id) ? settings.favorites.filter((x) => x !== id) : [...settings.favorites, id];
      save();
      renderIntervals();
      popover.querySelector(`[data-value="star:${id}"]`).classList.toggle('on', settings.favorites.includes(id));
      return 'keep';
    }
    changeInterval(value);
  });
}

const CHART_TYPES = [
  { id: 'bars', label: '바' },
  { id: 'candles', label: '캔들' },
  { id: 'hollow', label: '속이 빈 캔들' },
  { id: 'heikin', label: '하이킨아시' },
  { id: 'line', label: '라인' },
  { id: 'area', label: '영역' },
  { id: 'baseline', label: '기준선' },
];
function renderChartTypeBtn() {
  const t = CHART_TYPES.find((x) => x.id === settings.chartType) ?? CHART_TYPES[1];
  $('#chart-type-btn').innerHTML = icon(t.id);
  $('#chart-type-btn').title = `차트 종류: ${t.label}`;
}
$('#chart-type-btn').addEventListener('click', (e) => {
  openPopover(e.currentTarget, CHART_TYPES.map((t) => `
    <div class="pop-item ${t.id === settings.chartType ? 'active' : ''}" data-value="${t.id}" role="menuitem">${icon(t.id)}<span>${t.label}</span></div>`).join(''), (id) => {
    settings.chartType = id;
    save();
    renderChartTypeBtn();
    createMainSeries();
    setMainData();
  });
});

// 실행 취소·다시 실행: 컴퓨터는 위 막대, 휴대폰은 차트 아래 막대
for (const b of document.querySelectorAll('.undo-btn')) {
  b.innerHTML = icon('undo');
  b.title = `실행 취소 (${shortcut('Z')})`;
  b.addEventListener('click', () => drawings.undo());
}
for (const b of document.querySelectorAll('.redo-btn')) {
  b.innerHTML = icon('redo');
  b.title = `다시 실행 (${shortcut('Y')})`;
  b.addEventListener('click', () => drawings.redo());
}

$('#settings-btn').innerHTML = icon('gear');
$('#fullscreen-btn').innerHTML = icon('fullscreen');
$('#fullscreen-btn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* 전체 화면을 지원하지 않는 환경 */ }
});
if ($('#screenshot-btn')) $('#screenshot-btn').innerHTML = icon('camera');

// ---------- 아래 막대: 기간·눈금·시계 ----------
const RANGES = [
  { id: '1D', label: '1일', interval: '1m', days: 1 },
  { id: '5D', label: '5일', interval: '5m', days: 5 },
  { id: '1M', label: '1개월', interval: '1h', days: 30 },
  { id: '3M', label: '3개월', interval: '4h', days: 91 },
  { id: '6M', label: '6개월', interval: '1d', days: 182 },
  { id: 'YTD', label: '연초 이후', interval: '1d', ytd: true },
  { id: '1Y', label: '1년', interval: '1d', days: 365 },
  { id: '5Y', label: '5년', interval: '1w', days: 1826 },
  { id: 'ALL', label: '전체', interval: '1w', all: true },
];

function renderRanges() {
  $('#ranges').innerHTML = RANGES.map((r) => `<button data-range="${r.id}" class="${settings.range === r.id ? 'active' : ''}">${r.label}</button>`).join('');
}

async function applyRange(r) {
  settings.range = r.id;
  const reload = settings.interval !== r.interval;
  settings.interval = r.interval;
  save();
  renderIntervals();
  renderRanges();
  if (reload && !(await loadSymbol())) return;
  if (r.all) return chart.timeScale().fitContent();
  const last = bars[bars.length - 1].time;
  const from = r.ytd ? Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000 : last - r.days * 86400;
  chart.timeScale().setVisibleRange({ from: Math.max(from, bars[0].time), to: last });
}
$('#ranges').addEventListener('click', (e) => {
  const r = RANGES.find((x) => x.id === e.target.closest('button')?.dataset.range);
  if (r) applyRange(r);
});

$('#scale-percent').addEventListener('click', () => { settings.scaleMode = settings.scaleMode === 'percent' ? 'normal' : 'percent'; save(); applyScale(); });
$('#scale-log').addEventListener('click', () => { settings.scaleMode = settings.scaleMode === 'log' ? 'normal' : 'log'; save(); applyScale(); });
$('#scale-auto').addEventListener('click', () => { settings.autoScale = !settings.autoScale; save(); applyScale(); });

function resetChart() {
  chart.timeScale().setVisibleLogicalRange({ from: bars.length - 150, to: bars.length + 8 });
  settings.autoScale = true;
  save();
  applyScale();
  chart.panes().forEach((pane) => { try { pane.priceScale('right').applyOptions({ autoScale: true }); } catch { /* 눈금 없는 창 */ } });
}

// ---------- 지표 추가 창 ----------
const studyDialog = $('#study-dialog');

function saveStudies() {
  save();
  buildIndicators();
  if (studyDialog.open) renderStudyDialog();
}

function addStudy(type) {
  settings.indicators.push(newStudy(type));
  saveStudies();
}

function removeStudy(id) {
  settings.indicators = settings.indicators.filter((x) => x.id !== id);
  saveStudies();
}

function renderStudyDialog() {
  const q = $('#study-search').value.trim().toLowerCase();
  $('#study-applied').innerHTML = settings.indicators.length
    ? `<h3>적용된 지표 ${settings.indicators.length}개</h3>` + settings.indicators.map((st) => `
      <div class="study-item" data-id="${st.id}">
        <span>${studyTitle(st)}${st.hidden ? ' <span class="muted">(숨김)</span>' : ''}</span>
        <span class="study-item-actions">
          <button class="btn small" data-act="settings">설정</button>
          <button class="btn small danger" data-act="remove">삭제</button>
        </span>
      </div>`).join('')
    : '<p class="muted">적용된 지표가 없습니다. 아래에서 고르세요.</p>';
  $('#study-list').innerHTML = CATEGORIES.map((cat) => {
    const items = STUDIES.filter((d) => d.category === cat && (!q || d.name.toLowerCase().includes(q) || d.short.toLowerCase().includes(q)));
    if (!items.length) return '';
    return `<h3>${cat}</h3>` + items.map((d) => `
      <button class="study-add" data-type="${d.type}"><span>${d.name}</span><span class="muted">${d.pane === 'sub' ? '아래 창' : '가격 위'} · 추가 +</span></button>`).join('');
  }).join('') || '<p class="muted">검색 결과가 없습니다.</p>';
}

$('#indicator-btn').addEventListener('click', () => {
  $('#study-search').value = '';
  renderStudyDialog();
  studyDialog.showModal();
  $('#study-search').focus();
});
$('#study-search').addEventListener('input', renderStudyDialog);
studyDialog.addEventListener('click', (e) => {
  if (e.target === studyDialog || e.target.closest('[data-close]')) return studyDialog.close();
  const add = e.target.closest('.study-add');
  if (add) return addStudy(add.dataset.type);
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.study-item').dataset.id;
  if (btn.dataset.act === 'remove') removeStudy(id);
  if (btn.dataset.act === 'settings') openStudySettings(id);
});

// ---------- 지표 설정 창 ----------
const settingsDialog = $('#study-settings');
let editingId = null;

function field(input, value) {
  const id = `sp-${input.key}`;
  const control = input.options
    ? `<select id="${id}" name="${input.key}">${input.options.map(([v, label]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
    : `<input id="${id}" name="${input.key}" type="number" value="${value}" ${input.min != null ? `min="${input.min}"` : ''} ${input.max != null ? `max="${input.max}"` : ''} step="${input.step ?? 'any'}" required />`;
  return `<label class="field" for="${id}"><span>${input.label}</span>${control}</label>`;
}

function renderStudySettings(study) {
  const def = studyDef(study.type);
  const levels = (def.levels ?? []).map((l) => ({ ...l, step: 'any' }));
  $('#study-settings-title').textContent = `${def.name} 설정`;
  $('#study-settings-body').innerHTML = `
    ${def.inputs.length ? `<h3>입력값</h3><div class="fields">${def.inputs.map((i) => field(i, study.params[i.key])).join('')}</div>` : ''}
    ${levels.length ? `<h3>기준선</h3><div class="fields">${levels.map((l) => field(l, study.params[l.key])).join('')}</div>` : ''}
    <h3>색</h3>
    <div class="fields">${def.plots.map((p) => `
      <label class="field color" for="sc-${p.key}"><span>${p.label}</span><input id="sc-${p.key}" name="color:${p.key}" type="color" value="${study.colors[p.key]}" /></label>`).join('')}
    </div>`;
}

function openStudySettings(id) {
  const study = settings.indicators.find((x) => x.id === id);
  if (!study) return;
  editingId = id;
  renderStudySettings(study);
  settingsDialog.showModal();
}

$('#study-settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const study = settings.indicators.find((x) => x.id === editingId);
  const def = studyDef(study.type);
  const form = new FormData(e.currentTarget);
  for (const input of [...def.inputs, ...(def.levels ?? [])]) {
    const raw = form.get(input.key);
    study.params[input.key] = input.options ? raw : Number(raw);
  }
  for (const plot of def.plots) study.colors[plot.key] = form.get(`color:${plot.key}`);
  settingsDialog.close();
  saveStudies();
});
$('#study-settings-reset').addEventListener('click', () => {
  const study = settings.indicators.find((x) => x.id === editingId);
  renderStudySettings({ ...newStudy(study.type), id: study.id });
});
$('#study-settings-cancel').addEventListener('click', () => settingsDialog.close());

const themeIcon = () => { $('#theme-btn').innerHTML = icon(settings.theme === 'dark' ? 'sun' : 'moon'); };
themeIcon();
$('#theme-btn').addEventListener('click', () => {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = settings.theme;
  themeIcon();
  save();
  applyTheme();
  createMainSeries();
  setMainData();
  buildIndicators();
});

$('#screenshot-btn')?.addEventListener('click', () => {
  chart.takeScreenshot().toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${settings.coin}${feed.quote}_${settings.interval}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
});

// ---------- 심볼 검색 ----------
const dialog = $('#search-dialog');
let searchIndex = 0;

function openSearch(initial = '') {
  $('#search-input').value = initial;
  renderSearch();
  dialog.showModal();
  $('#search-input').focus();
}

const SEARCH_LIMIT = 100;

function searchMatches() {
  const raw = $('#search-input').value.trim();
  const q = raw.toUpperCase();
  const list = (markets ?? feed.coins.map((id) => ({ id, name: '' })))
    .filter((m) => m.id.includes(q) || m.name.includes(raw) || feed.market(m.id).toUpperCase().includes(q))
    .slice(0, SEARCH_LIMIT);
  // 목록에 없는 종목 코드도 직접 열 수 있는 피드 (주식 등)
  if (feed.allowCustom && q && !list.some((m) => m.id === q)) list.push({ id: q, name: '직접 입력' });
  return list;
}

function renderSearch() {
  const list = searchMatches();
  searchIndex = Math.min(searchIndex, Math.max(list.length - 1, 0));
  // 트레이딩뷰처럼 로고·이름과 함께, 오른쪽 별로 관심 목록에 넣고 뺀다
  $('#search-results').innerHTML = list.map((c, i) => {
    const on = inWatch(c.id);
    return `<li data-coin="${c.id}" class="${i === searchIndex ? 'selected' : ''}">${coinLogo(c.id)}
      <span class="s-main"><span>${feed.market(c.id)}</span><small>${c.name || coinName(c.id) || c.id}</small></span>
      <button class="watch-star ${on ? 'on' : ''}" data-star="${c.id}" title="${on ? '관심 목록에서 빼기' : '관심 목록에 넣기'}" aria-label="${on ? '관심 목록에서 빼기' : '관심 목록에 넣기'}" aria-pressed="${on}">${icon('star', 18)}</button></li>`;
  }).join('') || '<li class="empty">검색 결과가 없습니다</li>';
  $('#search-count').textContent = markets ? `${feed.name} · 전체 ${markets.length.toLocaleString()}개 종목` : `${feed.name} · 종목 목록 불러오는 중…`;
}

function selectCoin(coin) {
  dialog.close();
  // 휴대폰 관심 목록에서 고르면 차트 화면으로
  if (isApp() && settings.tab !== 'chart') setTab('chart');
  if (coin === settings.coin) return;
  settings.coin = coin;
  // 목록에 없는 종목을 직접 고른 경우, 이 피드에서는 그대로 둔다.
  if (feed.allowCustom && !markets?.some((m) => m.id === coin)) settings.customFor = feed.id;
  else delete settings.customFor;
  save();
  renderWatchlist();
  loadSymbol();
}

$('#symbol-btn').addEventListener('click', () => openSearch());
$('#search-input').addEventListener('input', () => { searchIndex = 0; renderSearch(); });
$('#search-input').addEventListener('keydown', (e) => {
  const list = searchMatches();
  if (e.key === 'ArrowDown') { searchIndex = Math.min(searchIndex + 1, list.length - 1); renderSearch(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { searchIndex = Math.max(searchIndex - 1, 0); renderSearch(); e.preventDefault(); }
  // 기본 동작을 막지 않으면, 창이 닫힌 뒤 포커스가 돌아간 검색 버튼이 같은 Enter로 다시 눌린다.
  if (e.key === 'Enter' && list[searchIndex]) { e.preventDefault(); selectCoin(list[searchIndex].id); }
});
$('#search-results').addEventListener('click', (e) => {
  const star = e.target.closest('[data-star]');
  if (star) { toggleWatch(star.dataset.star); return renderSearch(); }
  const li = e.target.closest('li');
  if (li?.dataset.coin) selectCoin(li.dataset.coin);
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

// 트레이딩뷰처럼 차트에서 바로 글자를 입력하면 검색창이 열린다.
// 숫자를 치면 타임프레임 입력 (트레이딩뷰처럼 "15" Enter -> 15분, "4H" -> 4시간, "D" -> 1일)
let intervalBuffer = '';
function parseInterval(text) {
  const m = /^(\d*)([MHDW]?)$/i.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const n = Number(m[1] || 1), unit = m[2].toUpperCase();
  const minutes = unit === 'H' ? n * 60 : unit === 'D' ? n * 1440 : unit === 'W' ? n * 10080 : n;
  return INTERVALS.find((i) => i.seconds === minutes * 60)?.id ?? null;
}
function showIntervalInput() {
  const box = $('#interval-input');
  const id = parseInterval(intervalBuffer);
  box.hidden = !intervalBuffer;
  box.innerHTML = `<strong>${intervalBuffer}</strong><span>${id ? intervalLabel(id) : '지원하지 않는 간격'}</span>`;
}

const ALT_TOOLS = { KeyT: 'trend', KeyH: 'hline', KeyJ: 'hray', KeyV: 'vline', KeyC: 'crossline', KeyF: 'fib' };
let crosshairPoint = null;

document.addEventListener('keydown', (e) => {
  if (dialog.open || keyDialog.open || $('dialog[open]') || e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? drawings.redo() : drawings.undo(); }
  if (mod && k === 'y') { e.preventDefault(); return drawings.redo(); }
  if (mod && k === 'c' && drawings.selected) { e.preventDefault(); return drawings.copySelected(); }
  if (mod && k === 'v' && drawings.clipboard) { e.preventDefault(); return drawings.paste(); }
  if (mod) return;
  if (e.altKey) {
    if (e.code === 'KeyR' && e.shiftKey) { e.preventDefault(); return pickTool('shapes', 'rect'); }
    if (e.code === 'KeyR') { e.preventDefault(); return resetChart(); }
    const tool = ALT_TOOLS[e.code];
    if (!tool) return;
    e.preventDefault();
    // 십자선 위치가 있으면 한 점짜리 도구는 바로 그 자리에 그린다
    pickTool(TOOL_GROUPS.find((g) => g.items.includes(tool)).id, tool);
    if (crosshairPoint && toolInfo(tool).points === 1) drawings.handleClick(crosshairPoint);
    return;
  }
  if (intervalBuffer) {
    if (e.key === 'Enter') {
      const id = parseInterval(intervalBuffer);
      intervalBuffer = '';
      showIntervalInput();
      if (id) changeInterval(id);
      return e.preventDefault();
    }
    if (e.key === 'Escape') { intervalBuffer = ''; return showIntervalInput(); }
    if (e.key === 'Backspace') { intervalBuffer = intervalBuffer.slice(0, -1); return showIntervalInput(); }
    if (/^[0-9mhdwMHDW]$/.test(e.key)) { intervalBuffer += e.key.toUpperCase(); return showIntervalInput(); }
  }
  if (/^[0-9]$/.test(e.key)) { intervalBuffer = e.key; return showIntervalInput(); }
  if (e.key === '/') { e.preventDefault(); return $('#indicator-btn').click(); }
  if (e.key === 'Enter' && drawings.finishMulti()) return e.preventDefault();
  if (e.key === 'Escape' && editingText) return closeTextEditor(false);
  if (e.key === 'Escape') {
    // 그리던 도형이 있으면 그것만 취소, 없으면 도구를 끄고 선택을 푼다
    if (!drawings.cancelDraft()) { drawings.setTool('cursor'); drawings.select(null); }
    closePopover();
    closeFlyout();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && drawings.selected) { e.preventDefault(); return drawings.removeSelected(); }
  if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); openSearch(e.key.toUpperCase()); }
});

// ---------- 관심 목록 ----------
const tickers = new Map();

// 관심 목록: 거래소마다 따로 저장한다 (처음엔 거래소 기본 목록). 검색 창의 별, 줄 밀기(휴대폰)·×(컴퓨터)로 넣고 뺀다.
const watchCoins = () => settings.watchlists?.[feed.id] ?? feed.coins;
const inWatch = (coin) => watchCoins().includes(coin);
function toggleWatch(coin) {
  const list = watchCoins();
  settings.watchlists = { ...settings.watchlists, [feed.id]: list.includes(coin) ? list.filter((c) => c !== coin) : [...list, coin] };
  save();
  startTickers();
}

// 줄은 목록이 바뀔 때만 새로 만들고, 시세가 올 때는 값만 바꾼다 (반짝임 효과를 위해)
function renderWatchlist() {
  $('#watch-title').textContent = isApp() ? '관심 목록' : `관심 목록 · ${feed.name}`;
  const listed = markets && new Set(markets.map((m) => m.id));
  const names = markets && new Map(markets.map((m) => [m.id, m.name]));
  const coins = watchCoins().filter((c) => !listed || listed.has(c) || feed.allowCustom);
  const ul = $('#watch-list');
  const key = `${feed.id}|${coins.join(',')}|${markets ? 1 : 0}`;
  if (ul.dataset.key !== key) {
    ul.dataset.key = key;
    ul.innerHTML = coins.map((coin) => {
      const name = names?.get(coin) || coinName(coin) || feed.market(coin);
      return `<li data-coin="${coin}">
        <div class="row-main">
          <span class="sym">${coinLogo(coin)}<span class="sym-text"><b>${coin}</b><small>${name}</small></span></span>
          <span class="last">—</span><span class="chg"></span><span class="pct"></span>
        </div>
        <button class="row-del" data-del="${coin}" title="관심 목록에서 빼기" aria-label="${coin} 관심 목록에서 빼기">${icon('x', 14)}</button></li>`;
    }).join('') || '<li class="empty">관심 종목이 없습니다. + 를 눌러 추가하세요.</li>';
  }
  for (const li of ul.querySelectorAll('li[data-coin]')) updateWatchRow(li);
}

function updateWatchRow(li) {
  const coin = li.dataset.coin;
  const t = tickers.get(coin);
  li.classList.toggle('active', coin === settings.coin);
  if (!t) return;
  const cls = t.changePct >= 0 ? 'up' : 'down';
  const digits = priceFormatFor(t.price).precision;
  const diff = t.price - t.price / (1 + t.changePct / 100);
  const last = li.querySelector('.last');
  const text = fmt(t.price, digits);
  if (last.textContent !== text) {
    const prev = Number(li.dataset.price);
    last.textContent = text;
    if (prev && prev !== t.price) {
      last.classList.remove('flash-up', 'flash-down');
      void last.offsetWidth; // 애니메이션을 처음부터 다시
      last.classList.add(t.price > prev ? 'flash-up' : 'flash-down');
    }
    li.dataset.price = t.price;
  }
  const chg = li.querySelector('.chg'), pct = li.querySelector('.pct');
  chg.className = `chg ${cls}`;
  chg.textContent = `${diff >= 0 ? '+' : ''}${fmt(diff, digits)}`;
  pct.className = `pct ${cls}`;
  pct.textContent = `${t.changePct >= 0 ? '+' : ''}${t.changePct.toFixed(2)}%`;
}

// 휴대폰: 줄을 왼쪽으로 밀면 삭제 버튼이 나온다
const SWIPE_OPEN = -88;
let swipe = null;
let swipedAt = 0;
const closeSwipes = (except) => {
  for (const li of $('#watch-list').querySelectorAll('li.open')) if (li !== except) { li.classList.remove('open'); li.querySelector('.row-main').style.transform = ''; }
};
$('#watch-list').addEventListener('pointerdown', (e) => {
  const li = e.target.closest('li[data-coin]');
  if (!li || e.pointerType === 'mouse' || e.target.closest('.row-del')) return;
  closeSwipes(li);
  swipe = { li, x: e.clientX, y: e.clientY, base: li.classList.contains('open') ? SWIPE_OPEN : 0, dx: 0, active: false };
});
$('#watch-list').addEventListener('pointermove', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10) { swipe = null; return; } // 위아래로 움직이면 목록 넘기기
    if (Math.abs(dx) < 10) return;
    swipe.active = true;
    swipe.li.classList.add('swiping');
  }
  swipe.dx = dx;
  swipe.li.querySelector('.row-main').style.transform = `translateX(${Math.min(0, Math.max(SWIPE_OPEN - 20, swipe.base + dx))}px)`;
});
const endSwipe = () => {
  if (!swipe) return;
  const { li, active, base, dx } = swipe;
  swipe = null;
  if (!active) return;
  li.classList.remove('swiping');
  swipedAt = performance.now();
  const open = base + dx < SWIPE_OPEN / 2;
  li.classList.toggle('open', open);
  li.querySelector('.row-main').style.transform = open ? `translateX(${SWIPE_OPEN}px)` : '';
};
$('#watch-list').addEventListener('pointerup', endSwipe);
$('#watch-list').addEventListener('pointercancel', endSwipe);

// 종목 로고 자리: 트레이딩뷰처럼 동그란 표시 (로고 그림 대신 이름 첫 글자와 종목마다 다른 색)
function coinLogo(coin, cls = '') {
  let h = 0;
  for (const ch of coin) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="coin-logo ${cls}" style="--h:${h}" aria-hidden="true">${coin.replace(/[^A-Z0-9가-힣]/gi, '').slice(0, 1)}</span>`;
}
function renderSymbolBtn() {
  $('#symbol-label').textContent = marketLabel();
  $('#symbol-logo').outerHTML = coinLogo(settings.coin, 'app-only').replace('<span class="coin-logo', '<span id="symbol-logo" class="coin-logo');
}
$('#watch-list').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) return toggleWatch(del.dataset.del);
  // 방금 밀었거나, 삭제 버튼이 열려 있던 줄을 누르면 닫기만
  if (performance.now() - swipedAt < 300) return;
  const li = e.target.closest('li[data-coin]');
  if (!li) return;
  if (li.classList.contains('open')) return closeSwipes();
  closeSwipes();
  selectCoin(li.dataset.coin);
});

let watchRender = 0;
function startTickers() {
  unsubscribeTickers();
  unsubscribeTickers = () => {};
  tickers.clear();
  renderWatchlist();
  const coins = watchCoins();
  if (!coins.length) return;
  unsubscribeTickers = feed.subscribeTickers(coins, (t) => {
    tickers.set(t.coin, t);
    // 틱마다 다시 그리지 않고 프레임당 한 번만.
    watchRender ||= requestAnimationFrame(() => { watchRender = 0; renderWatchlist(); if (t.coin === settings.coin) renderDetails(); });
  });
}

// 오른쪽 아래 종목 정보 (큰 현재가, 등락, 24시간 범위)
function renderDetails() {
  const el = $('#details');
  if (!bars.length || $('#side-panel').hidden) return;
  const lastBar = bars[bars.length - 1];
  const price = lastBar.close;
  const digits = priceFormatFor(price).precision;
  const t = tickers.get(settings.coin);
  const dayAgo = lastBar.time - 86400;
  const window24 = stepSeconds() >= 86400 ? [lastBar] : bars.filter((b) => b.time > dayAgo);
  const ref = stepSeconds() >= 86400 ? bars[bars.length - 2] ?? lastBar : bars.find((b) => b.time > dayAgo) ?? lastBar;
  const pct = t?.changePct ?? ((price - (stepSeconds() >= 86400 ? ref.close : ref.open)) / (stepSeconds() >= 86400 ? ref.close : ref.open)) * 100;
  const diff = price - price / (1 + pct / 100);
  const lo = Math.min(...window24.map((b) => b.low)), hi = Math.max(...window24.map((b) => b.high));
  const vol = window24.reduce((a, b) => a + b.volume, 0);
  const pos = hi > lo ? ((price - lo) / (hi - lo)) * 100 : 50;
  const name = markets?.find((m) => m.id === settings.coin)?.name;
  const cls = pct >= 0 ? 'up' : 'down';
  el.innerHTML = `
    <div class="d-head"><span class="d-sym">${marketLabel()}</span>${name && name !== settings.coin ? `<span class="d-name">${name}</span>` : ''}</div>
    <div class="d-exch">${feed.name}${feed.quote ? ` · ${feed.quote}` : ''}</div>
    <div class="d-price"><span>${fmt(price, digits)}</span><small>${feed.quote}</small></div>
    <div class="d-change ${cls}">${diff >= 0 ? '+' : ''}${fmt(diff, digits)} &nbsp; ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
    <div class="d-range">
      <div class="d-label">${stepSeconds() >= 86400 ? '이번 봉 범위' : '24시간 범위'}</div>
      <div class="d-bar"><span style="left:${pos}%"></span></div>
      <div class="d-ends"><span>${fmt(lo, digits)}</span><span>${fmt(hi, digits)}</span></div>
    </div>
    <div class="d-stat"><span>거래량 (${stepSeconds() >= 86400 ? '이번 봉' : '24시간'})</span><span>${fmtVol(vol)}</span></div>`;
}

function setPanel(open) {
  settings.panelOpen = open;
  save();
  $('#panel-btn').classList.toggle('active', open);
  $('#panel-btn').setAttribute('aria-pressed', open);
  applyPanels();
}
$('#panel-btn').innerHTML = icon('panel');
$('#panel-btn').classList.toggle('active', settings.panelOpen);
$('#panel-btn').addEventListener('click', () => setPanel(!settings.panelOpen));

// ---------- 상태 표시줄 ----------
function updateStatus() {
  $('#feed-status').textContent = window.REA_FEED === 'demo'
    ? '데모 데이터 (웹 공유 버전은 외부 시세에 접속할 수 없음)'
    : feedError
    ? `${feedError}. 데모 데이터로 표시 중`
    : feed.id === 'demo'
    ? '데모 데이터'
    : `실시간 · ${feed.name}${feed.quote ? ` (${feed.quote})` : ''}`;
}

// ---------- 종목 목록 ----------
async function loadMarkets() {
  const current = feed;
  try {
    const list = await current.loadMarkets();
    if (current !== feed) return;
    markets = list;
  } catch (err) {
    console.warn(`${current.name} 종목 목록을 불러오지 못했습니다.`, err);
    if (current === feed) markets = null;
  }
  renderWatchlist();
  if (dialog.open) renderSearch();
}

// ---------- API 키 ----------
const keyDialog = $('#key-dialog');
const keyFeed = () => feedById(settings.source);

function openKeyDialog() {
  const f = keyFeed();
  if (!f.needsKey || keyDialog.open) return;
  $('#key-feed').textContent = f.name;
  $('#key-input').value = settings.keys[f.id] ?? '';
  keyDialog.showModal();
}

$('#key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = keyFeed();
  const key = $('#key-input').value.trim();
  settings.keys[f.id] = key;
  f.apiKey = key;
  save();
  keyDialog.close();
  switchFeed(f.id);
});
$('#key-cancel').addEventListener('click', () => keyDialog.close());
$('#key-btn').addEventListener('click', openKeyDialog);

// ---------- 거래소 선택 ----------
function switchFeed(id) {
  settings.source = id;
  $('#source').value = id;
  $('#watch-source').value = id;
  feed = feedById(id);
  feedError = null;
  markets = null;
  delete settings.customFor;
  $('#key-btn').hidden = !feed.needsKey;
  save();
  startTickers();
  loadSymbol();
}

$('#source').innerHTML = FEEDS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
$('#source').value = feed.id;
$('#watch-source').innerHTML = $('#source').innerHTML;
$('#watch-source').value = feed.id;
$('#watch-source').hidden = forceDemo;
$('#source').hidden = forceDemo;
$('#key-btn').hidden = forceDemo || !feed.needsKey;
$('#source').addEventListener('change', (e) => switchFeed(e.target.value));
const tzOffset = -new Date().getTimezoneOffset() / 60;
const tzLabel = `UTC${tzOffset >= 0 ? '+' : ''}${Number.isInteger(tzOffset) ? tzOffset : tzOffset.toFixed(1)}`;
const tick = () => { $('#clock').textContent = `${new Date().toLocaleTimeString('ko-KR', { hour12: false })} (${tzLabel})`; };
tick();
setInterval(tick, 1000);

// ---------- 오른쪽 클릭 메뉴 ----------
chartEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const pt = localPoint(e);
  const hit = drawings.tool === 'cursor' && drawings.hitTest(pt);
  if (hit) {
    drawings.select(hit.drawing.id);
    const d = hit.drawing;
    const items = [
      ['settings', '설정…', ''],
      ['duplicate', '복제', `${shortcut('드래그')}`],
      ['copy', '복사', shortcut('C')],
      ['lock', d.locked ? '잠금 풀기' : '잠그기', ''],
      ['sep'],
      ['delete', '삭제', 'Delete'],
    ];
    return openPopover(chartEl, items.map(([v, label, key]) => (v === 'sep' ? '<div class="pop-sep"></div>'
      : `<div class="pop-item" data-value="${v}" role="menuitem"><span>${label}</span><span class="fly-key">${key}</span></div>`)).join(''), (v) => {
      if (v === 'settings') openDrawingSettings();
      if (v === 'duplicate') drawings.duplicateSelected();
      if (v === 'copy') drawings.copySelected();
      if (v === 'lock') drawings.updateSelected({ locked: !d.locked });
      if (v === 'delete') drawings.removeSelected();
    }, { x: e.clientX, y: e.clientY });
  }
  const price = pt.y <= chart.panes()[0].getHeight() ? mainSeries.coordinateToPrice(pt.y) : null;
  const digits = bars.length ? priceFormatFor(bars[bars.length - 1].close).precision : 2;
  const items = [
    ['reset', '차트 초기화', 'Alt+R'],
    ...(price != null ? [['hline', `${fmt(price, digits)}에 수평선 그리기`, 'Alt+H']] : []),
    ['sep'],
    ...(drawings.clipboard ? [['paste', '붙여넣기', shortcut('V')]] : []),
    ['clear-drawings', '이 종목 그림 모두 지우기', ''],
    ['clear-studies', '지표 모두 제거', ''],
    ['sep'],
    ['settings', '차트 설정…', ''],
  ];
  openPopover(chartEl, items.map(([v, label, key]) => (v === 'sep' ? '<div class="pop-sep"></div>'
    : `<div class="pop-item" data-value="${v}" role="menuitem"><span>${label}</span><span class="fly-key">${key}</span></div>`)).join(''), (v) => {
    if (v === 'reset') resetChart();
    if (v === 'hline') { pickTool('lines', 'hline'); drawings.handleClick(pt); }
    if (v === 'paste') drawings.paste();
    if (v === 'clear-drawings') drawings.clear();
    if (v === 'clear-studies') { settings.indicators = []; saveStudies(); }
    if (v === 'settings') openChartSettings();
  }, { x: e.clientX, y: e.clientY });
});

// ---------- 차트 설정 창 ----------
const chartSettingsDialog = $('#chart-settings');
function renderChartSettings(c) {
  const color = (key, label) => `<label class="field color" for="cs-${key}"><span>${label}</span><input id="cs-${key}" name="${key}" type="color" value="${c[key]}" /></label>`;
  const check = (key, label) => `<label class="field check" for="cs-${key}"><input id="cs-${key}" name="${key}" type="checkbox" ${c[key] ? 'checked' : ''} /><span>${label}</span></label>`;
  $('#chart-settings-body').innerHTML = `
    <h3>캔들</h3>
    <div class="fields">${color('upColor', '몸통 상승')}${color('downColor', '몸통 하락')}${color('wickUpColor', '꼬리 상승')}${color('wickDownColor', '꼬리 하락')}</div>
    <div class="fields">${check('borderVisible', '테두리 표시')}</div>
    <h3>가격 눈금</h3>
    <div class="fields">${check('priceLine', '현재가 선')}${check('countdown', '봉 마감 카운트다운')}</div>
    <h3>배경</h3>
    <div class="fields">
      ${check('bgDefault', '테마 기본 배경')}
      <label class="field color" for="cs-bgColor"><span>배경색</span><input id="cs-bgColor" name="bgColor" type="color" value="${c.bgColor || css('--bg')}" /></label>
      ${check('vertGrid', '세로 격자')}${check('horzGrid', '가로 격자')}
    </div>
    <h3>상태 줄 (차트 왼쪽 위)</h3>
    <div class="fields">${check('legendOhlc', '시가·고가·저가·종가')}${check('legendValues', '지표 값')}</div>`;
  $('#cs-bgDefault').checked = !c.bgColor;
}
function openChartSettings() {
  renderChartSettings(settings.chart);
  chartSettingsDialog.showModal();
}
$('#settings-btn').addEventListener('click', openChartSettings);
$('#chart-settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const next = { ...settings.chart };
  for (const key of ['upColor', 'downColor', 'wickUpColor', 'wickDownColor']) next[key] = f.get(key);
  for (const key of ['borderVisible', 'priceLine', 'countdown', 'vertGrid', 'horzGrid', 'legendOhlc', 'legendValues']) next[key] = f.has(key);
  next.bgColor = f.has('bgDefault') ? '' : f.get('bgColor');
  settings.chart = next;
  save();
  chartSettingsDialog.close();
  applyTheme();
  createMainSeries();
  setMainData();
  renderLegend();
});
$('#chart-settings-reset').addEventListener('click', () => renderChartSettings(CHART_DEFAULTS));
$('#chart-settings-cancel').addEventListener('click', () => chartSettingsDialog.close());

// 휴대폰: 연필 버튼으로 왼쪽 그리기 도구 막대를 펼치고 접는다 (트레이딩뷰 앱처럼)
function applyToolsOpen() {
  document.body.classList.toggle('tools-open', !!settings.toolsOpen);
  const btn = $('#draw-toggle');
  btn.classList.toggle('active', !!settings.toolsOpen);
  btn.setAttribute('aria-pressed', String(!!settings.toolsOpen));
}
$('#draw-toggle').innerHTML = icon('pencil', 18);
$('#draw-toggle').addEventListener('click', () => {
  settings.toolsOpen = !settings.toolsOpen;
  if (!settings.toolsOpen) closeFlyout();
  save();
  applyToolsOpen();
});
// 지표 줄 버튼은 다른 곳을 누르면 닫는다
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#legend .study')) for (const r of $('#legend').querySelectorAll('.study.open')) r.classList.remove('open');
}, true);

// ---------- 휴대폰 앱 화면 (트레이딩뷰 앱처럼 아래 탭: 관심 목록 · 차트 · 메뉴) ----------
function setTab(tab) {
  settings.tab = tab;
  save();
  document.body.dataset.screen = tab;
  for (const b of document.querySelectorAll('.tabbar [data-tab]')) {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
  }
  closePopover();
  closeFlyout();
  applyPanels();
  if (tab === 'menu') renderMenu();
}
// 오른쪽 관심 목록: 컴퓨터는 패널 버튼으로, 휴대폰은 관심 목록 탭에서만
function applyPanels() {
  $('#side-panel').hidden = isApp() ? settings.tab !== 'watch' : !settings.panelOpen;
  renderWatchlist();
  if (!$('#side-panel').hidden) renderDetails();
}
const TAB_ICONS = { watch: 'list', chart: 'candles', menu: 'menu' };
for (const b of document.querySelectorAll('.tabbar [data-tab]')) {
  b.querySelector('.tab-icon').innerHTML = icon(TAB_ICONS[b.dataset.tab], 22);
  b.addEventListener('click', () => setTab(b.dataset.tab));
}
appMedia.addEventListener('change', () => { applyPanels(); closePopover(); updateLegend(); });

$('#watch-search').innerHTML = icon('plus');
$('#watch-search').addEventListener('click', () => openSearch());
$('#watch-source').addEventListener('change', (e) => switchFeed(e.target.value));

// 휴대폰 위 막대의 ⋯: 컴퓨터에서 위 막대 오른쪽에 있는 버튼들
$('#more-btn').innerHTML = icon('more');
$('#more-btn').addEventListener('click', (e) => {
  const items = [
    ['settings', 'gear', '차트 설정'],
    ['theme', settings.theme === 'dark' ? 'sun' : 'moon', settings.theme === 'dark' ? '밝은 테마' : '어두운 테마'],
    ['screenshot', 'camera', '스크린샷 저장'],
    ['fullscreen', 'fullscreen', '전체 화면'],
  ].filter(([id]) => $(`#${id}-btn`));
  openPopover(e.currentTarget, '<div class="pop-title">차트</div>' + items.map(([id, ic, label]) =>
    `<div class="pop-item" data-value="${id}" role="menuitem">${icon(ic)}<span>${label}</span></div>`).join(''),
  (id) => { $(`#${id}-btn`).click(); });
});

// 메뉴 화면: 설정, 거래소, 앱 설치, 정보(차트 라이브러리 출처)
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (settings.tab === 'menu') renderMenu();
});
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function renderMenu() {
  const row = (label, value, attrs = '') => `<button class="menu-row" ${attrs}><span>${label}</span><span class="menu-value">${value}</span>${icon('chevron', 16)}</button>`;
  $('#menu-screen').innerHTML = `
    <header class="screen-head"><h1>메뉴</h1></header>
    <div class="menu-group">
      <h2>화면</h2>
      <div class="menu-row static"><span>테마</span>
        <span class="seg" role="group" aria-label="테마">${[['dark', '어둡게'], ['light', '밝게']].map(([id, label]) => `<button data-set-theme="${id}" class="${settings.theme === id ? 'active' : ''}">${label}</button>`).join('')}</span></div>
      ${row('차트 설정', '색·격자·범례', 'data-menu="chart-settings"')}
    </div>
    <div class="menu-group">
      <h2>시세</h2>
      <label class="menu-row static" for="menu-source"><span>거래소</span>
        <select id="menu-source" class="select">${FEEDS.filter((f) => f.id !== 'demo' || forceDemo).map((f) => `<option value="${f.id}" ${f.id === settings.source ? 'selected' : ''}>${f.name}</option>`).join('')}</select><span class="chev"></span></label>
      <div class="menu-row static"><span>연결</span><span class="menu-value">${$('#feed-status').textContent}</span></div>
      ${row('주식·환율 API 키', settings.keys.twelvedata ? '저장됨' : '없음', 'data-menu="key"')}
    </div>
    <div class="menu-group">
      <h2>앱</h2>
      ${standalone() ? '<div class="menu-row static"><span>앱으로 실행 중</span></div>' : row('홈 화면에 앱 설치', '', 'data-menu="install"')}
      <p class="menu-note" id="install-help" hidden>
        <b>아이폰</b>: Safari 아래쪽 공유 버튼(네모에 화살표) → <b>홈 화면에 추가</b><br>
        <b>안드로이드</b>: Chrome 오른쪽 위 ⋮ → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b></p>
    </div>
    <div class="menu-group">
      <h2>정보</h2>
      <div class="menu-row static"><span>Rea Chart</span><span class="menu-value">${__BUILD_DATE__} 빌드</span></div>
      <p class="menu-note credit">차트: <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a><br>Copyright (c) 2025 TradingView, Inc.</p>
    </div>`;
}
$('#menu-screen').addEventListener('click', async (e) => {
  const theme = e.target.closest('[data-set-theme]');
  if (theme && theme.dataset.setTheme !== settings.theme) { $('#theme-btn').click(); return renderMenu(); }
  const item = e.target.closest('[data-menu]');
  if (!item) return;
  if (item.dataset.menu === 'chart-settings') openChartSettings();
  if (item.dataset.menu === 'key') {
    // 키 창은 지금 거래소 기준이라, Twelve Data로 바꾼 뒤 연다
    if (!feed.needsKey) switchFeed('twelvedata');
    openKeyDialog();
  }
  if (item.dataset.menu === 'install') {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => {});
      installPrompt = null;
      renderMenu();
    } else {
      $('#install-help').hidden = false;
    }
  }
});
$('#menu-screen').addEventListener('change', (e) => {
  if (e.target.id === 'menu-source') { switchFeed(e.target.value); renderMenu(); }
});

// 앱으로 설치했을 때 오프라인에서도 켜지도록 (웹 공유 한 장짜리 버전은 제외)
if ('serviceWorker' in navigator && import.meta.env.PROD && !window.REA_FEED) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ---------- 시작 ----------
document.body.dataset.screen = settings.tab;
for (const b of document.querySelectorAll('.tabbar [data-tab]')) b.classList.toggle('active', b.dataset.tab === settings.tab);
applyToolsOpen();
renderIntervals();
renderRanges();
renderChartTypeBtn();
applyScale();
applyPanels();
drawings.magnet = settings.magnet;
drawings.stay = !!settings.stayDrawing;
renderTools();
createMainSeries();
buildIndicators();
startTickers();
loadSymbol();

// 대화 창(검색·지표·설정): 휴대폰에서는 손잡이를 끌어 내리거나, 바깥 어두운 곳을 누르면 닫힌다
for (const d of document.querySelectorAll('dialog.search')) {
  d.prepend(sheetGrip(d, () => d.close()));
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
// 아이폰 Safari는 확대 금지 설정을 무시해서, 두 손가락 확대 동작을 직접 막는다 (차트 확대는 차트가 따로 처리)
document.addEventListener('gesturestart', (e) => e.preventDefault());
// 휴대폰 가로: 차트 화면으로
const applyLandscape = () => { if (landscapeMedia.matches && settings.tab !== 'chart') setTab('chart'); };
landscapeMedia.addEventListener('change', applyLandscape);
applyLandscape();

// 브라우저 확인 스크립트(e2e)에서 상태를 읽는 통로
window.__rea = { drawings, chart };
