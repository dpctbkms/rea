import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  CrosshairMode, ColorType, LineStyle,
} from 'lightweight-charts';
import { FEEDS, INTERVALS } from './feeds/index.js';
import { sma, ema, bollinger, rsi, macd, vwap, heikinAshi } from './indicators.js';
import { DrawingManager, TOOLS, COLORS } from './drawings.js';

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
    indicators: ['volume', 'ema20', 'ema50'],
    drawings: {}, // { ['거래소:코인']: 도형[] }
    keys: {}, // { [피드 id]: API 키 } 이 브라우저에만 저장된다
  },
  load(),
);
// 예전 버전의 수평선(lines: 가격 배열)을 도형으로 옮긴다.
if (settings.lines) {
  for (const [key, prices] of Object.entries(settings.lines)) {
    settings.drawings[key] = prices.map((price, i) => ({ id: `line${i}`, type: 'hline', points: [{ time: 0, price }], color: COLORS[0] }));
  }
  delete settings.lines;
}
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

// ---------- 지표 정의 ----------
// pane: 0이면 가격 차트 위에 겹쳐 그림, 'sub'이면 아래 별도 창.
const INDICATORS = [
  { id: 'volume', label: '거래량', color: '#787b86', pane: 0 },
  { id: 'sma20', label: 'SMA 20', color: '#f7a21b', pane: 0, line: (b) => sma(b, 20) },
  { id: 'ema20', label: 'EMA 20', color: '#2962ff', pane: 0, line: (b) => ema(b, 20) },
  { id: 'ema50', label: 'EMA 50', color: '#ff6d00', pane: 0, line: (b) => ema(b, 50) },
  { id: 'ema200', label: 'EMA 200', color: '#e91e63', pane: 0, line: (b) => ema(b, 200) },
  { id: 'bb', label: '볼린저 밴드 20, 2', color: '#2196f3', pane: 0 },
  { id: 'vwap', label: 'VWAP', color: '#9c27b0', pane: 0, line: vwap },
  { id: 'rsi', label: 'RSI 14', color: '#7e57c2', pane: 'sub' },
  { id: 'macd', label: 'MACD 12, 26, 9', color: '#2962ff', pane: 'sub' },
];

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
let active = new Map(); // indicator id -> { series: {key: ISeriesApi}, compute(bars) -> {key: data[]} }
let unsubscribeBars = () => {};
let unsubscribeTickers = () => {};
let loadId = 0;

// ---------- 차트 ----------
document.documentElement.dataset.theme = settings.theme;
const chart = createChart($('#chart'), {
  autoSize: true,
  crosshair: { mode: CrosshairMode.Normal },
  timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, borderVisible: false },
  rightPriceScale: { borderVisible: false },
  localization: { locale: 'ko-KR' },
});
applyTheme();

function applyTheme() {
  const text = css('--text'), grid = css('--grid'), border = css('--border');
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: css('--bg') },
      textColor: text,
      fontSize: 12,
      panes: { separatorColor: border, separatorHoverColor: css('--hover') },
    },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    crosshair: { vertLine: { labelBackgroundColor: '#363a45' }, horzLine: { labelBackgroundColor: '#363a45' } },
  });
}

function priceFormatFor(price) {
  const precision = feed.quote === 'KRW'
    ? (price >= 100 ? 0 : price >= 1 ? 2 : 4)
    : (price >= 1000 ? 2 : price >= 10 ? 3 : price >= 1 ? 4 : price >= 0.01 ? 5 : 8);
  return { type: 'price', precision, minMove: 1 / 10 ** precision };
}

function createMainSeries() {
  if (mainSeries) chart.removeSeries(mainSeries);
  const up = css('--up'), down = css('--down');
  const type = settings.chartType;
  if (type === 'candles' || type === 'heikin') {
    mainSeries = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
    });
  } else if (type === 'bars') {
    mainSeries = chart.addSeries(BarSeries, { upColor: up, downColor: down, thinBars: false });
  } else if (type === 'line') {
    mainSeries = chart.addSeries(LineSeries, { color: css('--accent'), lineWidth: 2 });
  } else {
    mainSeries = chart.addSeries(AreaSeries, {
      lineColor: css('--accent'), topColor: 'rgba(41, 98, 255, 0.35)', bottomColor: 'rgba(41, 98, 255, 0)', lineWidth: 2,
    });
  }
  drawings.attach(mainSeries);
}

// 차트 종류에 맞게 봉 데이터를 변환.
function mainData(source) {
  const type = settings.chartType;
  if (type === 'heikin') return heikinAshi(source);
  if (type === 'line' || type === 'area') return source.map((b) => ({ time: b.time, value: b.close }));
  return source;
}

function setMainData() {
  if (bars.length) mainSeries.applyOptions({ priceFormat: priceFormatFor(bars[bars.length - 1].close) });
  mainSeries.setData(mainData(bars));
}

// ---------- 지표 ----------
function buildIndicators() {
  for (const { series } of active.values()) Object.values(series).forEach((s) => chart.removeSeries(s));
  active = new Map();
  let subPane = 0;
  for (const def of INDICATORS) {
    if (!settings.indicators.includes(def.id)) continue;
    const pane = def.pane === 'sub' ? ++subPane : 0;
    active.set(def.id, createIndicator(def, pane));
  }
  // 하단 지표 창 높이를 일정하게 맞춘다.
  chart.panes().forEach((p, i) => { if (i > 0) p.setHeight(120); });
  refreshIndicators();
}

function createIndicator(def, pane) {
  const line = (color, extra = {}) => chart.addSeries(LineSeries, {
    color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, ...extra,
  }, pane);

  switch (def.id) {
    case 'volume': {
      const s = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false,
      }, pane);
      s.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      const up = css('--up') + '80', down = css('--down') + '80';
      return {
        series: { volume: s },
        compute: (b) => ({ volume: b.map((x) => ({ time: x.time, value: x.volume, color: x.close >= x.open ? up : down })) }),
      };
    }
    case 'bb': {
      const opts = { lineWidth: 1 };
      return {
        series: { upper: line(def.color, opts), middle: line('#ff9800', opts), lower: line(def.color, opts) },
        compute: (b) => bollinger(b, 20, 2),
      };
    }
    case 'rsi': {
      const s = line(def.color, { lineWidth: 2 });
      s.createPriceLine({ price: 70, color: css('--muted'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      s.createPriceLine({ price: 30, color: css('--muted'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      s.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
      return { series: { rsi: s }, compute: (b) => ({ rsi: rsi(b, 14) }) };
    }
    case 'macd': {
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      const up = css('--up'), down = css('--down');
      return {
        series: { histogram: hist, macd: line('#2962ff', { lineWidth: 2 }), signal: line('#ff6d00', { lineWidth: 2 }) },
        compute: (b) => {
          const m = macd(b);
          m.histogram = m.histogram.map((p) => ({ ...p, color: p.value >= 0 ? up + 'a0' : down + 'a0' }));
          return m;
        },
      };
    }
    default:
      return { series: { value: line(def.color, { lineWidth: 2 }) }, compute: (b) => ({ value: def.line(b) }) };
  }
}

function refreshIndicators(liveOnly = false) {
  for (const ind of active.values()) {
    const data = ind.compute(bars);
    for (const [key, s] of Object.entries(ind.series)) {
      const d = data[key];
      if (!d?.length) { if (!liveOnly) s.setData([]); continue; }
      if (liveOnly) s.update(d[d.length - 1]);
      else s.setData(d);
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
  $('#symbol-label').textContent = marketLabel();
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
    $('#symbol-label').textContent = marketLabel();
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
  unsubscribeBars = feed.subscribeBars(settings.coin, settings.interval, (bar) => {
    if (id !== loadId) return;
    onBar(bar);
  }, bars[bars.length - 1]);
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
}

// ---------- 범례 ----------
const fmt = (v, digits) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtVol = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(0));

let hoverTime = null;
chart.subscribeCrosshairMove((p) => {
  hoverTime = p.time ?? null;
  updateLegend();
  drawings.handleMove(p.point);
});

function updateLegend() {
  if (!bars.length) return;
  const idx = hoverTime == null ? bars.length - 1 : bars.findIndex((b) => b.time === hoverTime);
  const bar = bars[idx] ?? bars[bars.length - 1];
  const prev = bars[bars.indexOf(bar) - 1] ?? bar;
  const digits = priceFormatFor(bar.close).precision;
  const change = bar.close - prev.close;
  const cls = change >= 0 ? 'up' : 'down';
  const interval = INTERVALS.find((i) => i.id === settings.interval).label;

  let html = `<div class="row"><span class="title">${marketLabel()}</span><span class="k">${interval} · ${feed.name}</span>
    <span><span class="k">시</span> <span class="${cls}">${fmt(bar.open, digits)}</span></span>
    <span><span class="k">고</span> <span class="${cls}">${fmt(bar.high, digits)}</span></span>
    <span><span class="k">저</span> <span class="${cls}">${fmt(bar.low, digits)}</span></span>
    <span><span class="k">종</span> <span class="${cls}">${fmt(bar.close, digits)}</span></span>
    <span class="${cls}">${change >= 0 ? '+' : ''}${fmt(change, digits)} (${((change / prev.close) * 100).toFixed(2)}%)</span></div>`;

  for (const [id, ind] of active) {
    const def = INDICATORS.find((d) => d.id === id);
    const values = Object.entries(ind.series).map(([, s]) => {
      const point = s.dataByIndex(s.data().findIndex((d) => d.time === bar.time));
      return point && 'value' in point ? point.value : null;
    }).filter((v) => v != null);
    if (!values.length) continue;
    const text = values.map((v) => (id === 'volume' ? fmtVol(v) : fmt(v, id === 'rsi' ? 2 : digits))).join('  ');
    html += `<div class="row"><span class="k">${def.label}</span><span style="color:${def.color}">${text}</span></div>`;
  }
  $('#legend').innerHTML = html;
}

// ---------- 그리기 도구 ----------
const ICONS = {
  cursor: '<path d="M5 3l11 6.5-5 1.2L8.8 16z"/>',
  trend: '<path d="M4 15L15 4"/><circle cx="4" cy="15" r="1.6"/><circle cx="15" cy="4" r="1.6"/>',
  ray: '<path d="M4 15L16 3"/><circle cx="4" cy="15" r="1.6"/><path d="M12 3h4v4"/>',
  hline: '<path d="M2 10h16"/><circle cx="10" cy="10" r="1.6"/>',
  vline: '<path d="M10 2v16"/><circle cx="10" cy="10" r="1.6"/>',
  channel: '<path d="M3 13L13 5M7 17L17 9"/>',
  rect: '<rect x="3.5" y="5.5" width="13" height="9" rx="1"/>',
  fib: '<path d="M3 4h14M3 8h14M3 11h14M3 16h14"/>',
  measure: '<path d="M10 3v14M6 7l4-4 4 4M6 13l4 4 4-4"/>',
  text: '<path d="M4 5V3h12v2M10 3v14M7 17h6"/>',
  magnet: '<path d="M5 3v7a5 5 0 0010 0V3"/><path d="M5 6h3M12 6h3"/>',
  undo: '<path d="M7 5L3 9l4 4"/><path d="M3 9h9a5 5 0 010 10H9"/>',
  redo: '<path d="M13 5l4 4-4 4"/><path d="M17 9H8a5 5 0 000 10h3"/>',
  clear: '<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>',
};
const icon = (name) => `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const shortcut = (name) => (navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+') + name;

const drawings = new DrawingManager({
  chart,
  getBars: () => bars,
  getStep: () => INTERVALS.find((i) => i.id === settings.interval).seconds,
  formatPrice: (p) => fmt(p, priceFormatFor(bars.length ? bars[bars.length - 1].close : Math.abs(p)).precision),
  onChange: (list) => {
    if (list.length) settings.drawings[lineKey()] = list;
    else delete settings.drawings[lineKey()];
    save();
    renderTools();
  },
  onSelect: () => renderSelectionBar(),
  onToolChange: () => renderTools(),
});

function renderTools() {
  const tool = drawings.tool;
  $('.tools').innerHTML = [
    ...TOOLS.map((t) => `<button class="tool ${t.id === tool ? 'active' : ''}" data-tool="${t.id}" title="${t.label}" aria-label="${t.label}">${icon(t.id)}</button>`),
    '<div class="tools-sep"></div>',
    `<button class="tool ${drawings.magnet ? 'active' : ''}" data-action="magnet" title="자석: 점을 가까운 시가·고가·저가·종가에 붙임" aria-label="자석" aria-pressed="${drawings.magnet}">${icon('magnet')}</button>`,
    `<button class="tool" data-action="undo" title="실행 취소 (${shortcut('Z')})" aria-label="실행 취소" ${drawings.canUndo ? '' : 'disabled'}>${icon('undo')}</button>`,
    `<button class="tool" data-action="redo" title="다시 실행 (${shortcut('Y')})" aria-label="다시 실행" ${drawings.canRedo ? '' : 'disabled'}>${icon('redo')}</button>`,
    `<button class="tool" data-action="clear" title="이 종목의 그림 모두 지우기" aria-label="모두 지우기" ${drawings.drawings.length ? '' : 'disabled'}>${icon('clear')}</button>`,
  ].join('');
  $('.chart-wrap').classList.toggle('drawing', tool !== 'cursor');
  const t = TOOLS.find((x) => x.id === tool);
  $('#draw-hint').hidden = tool === 'cursor';
  if (tool !== 'cursor') {
    $('#draw-hint').textContent = `${t.label}: 차트에서 ${t.points === 1 ? '한 곳을' : `${t.points}곳을 차례로`} 누르세요 · Esc로 취소`;
  }
}

$('.tools').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  if (btn.dataset.tool) return drawings.setTool(btn.dataset.tool);
  const action = btn.dataset.action;
  if (action === 'magnet') { drawings.magnet = !drawings.magnet; settings.magnet = drawings.magnet; save(); renderTools(); }
  if (action === 'undo') drawings.undo();
  if (action === 'redo') drawings.redo();
  if (action === 'clear') drawings.clear();
});

// 선택한 도형의 색 바꾸기·글자 고치기·삭제
function renderSelectionBar() {
  const d = drawings.selected;
  const bar = $('#draw-bar');
  bar.hidden = !d;
  if (!d) return;
  const label = TOOLS.find((t) => t.id === d.type).label;
  bar.innerHTML = `<span class="draw-bar-label">${label}</span>`
    + (d.type === 'measure' ? '' : COLORS.map((c) => `<button class="swatch-btn ${c === d.color ? 'active' : ''}" data-color="${c}" style="--c:${c}" title="색 바꾸기" aria-label="색 ${c}"></button>`).join(''))
    + (d.type === 'text' ? '<button class="btn small" data-action="edit">글자 수정</button>' : '')
    + '<button class="btn small danger" data-action="delete" title="삭제 (Delete)">삭제</button>';
}

$('#draw-bar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.color) drawings.updateSelected({ color: btn.dataset.color });
  if (btn.dataset.action === 'delete') drawings.removeSelected();
  if (btn.dataset.action === 'edit') {
    const text = window.prompt('텍스트를 입력하세요', drawings.selected.text);
    if (text?.trim()) drawings.updateSelected({ text: text.trim() });
  }
});


// 도형을 잡고 끌면 차트 대신 도형이 움직이도록, 차트보다 먼저(캡처 단계에서) 이벤트를 가로챈다.
const chartEl = $('#chart');
const localPoint = (e) => {
  const r = chartEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
let pressedAt = null;
chartEl.addEventListener('pointerdown', (e) => {
  pressedAt = localPoint(e);
  if (e.button !== 0 || !drawings.beginDrag(pressedAt, e.pointerType === 'touch')) return;
  e.stopPropagation();
  e.preventDefault();
}, { capture: true });
for (const type of ['mousedown', 'touchstart']) {
  chartEl.addEventListener(type, (e) => { if (drawings.drag) e.stopPropagation(); }, { capture: true });
}
window.addEventListener('pointermove', (e) => {
  if (drawings.drag) return drawings.dragTo(localPoint(e));
  if (drawings.tool === 'cursor' && e.target.closest?.('#chart')) {
    $('.chart-wrap').classList.toggle('hovering', !!drawings.hitTest(localPoint(e), e.pointerType === 'touch' ? 14 : 7));
  }
});
window.addEventListener('pointerup', () => drawings.endDrag());

// 차트 라이브러리의 클릭 알림은 0.5초 안에 다른 곳을 누르면 빠뜨리므로, 클릭을 직접 받는다.
// 끌어서 차트를 옮긴 경우와 가격·시간 눈금 위를 누른 경우는 제외한다.
chartEl.addEventListener('click', (e) => {
  const pt = localPoint(e);
  if (!pressedAt || Math.hypot(pt.x - pressedAt.x, pt.y - pressedAt.y) > 5) return;
  if (pt.x > chart.timeScale().width() || pt.y > chart.panes()[0].getHeight()) return;
  drawings.handleClick(pt);
});
window.addEventListener('pointercancel', () => drawings.endDrag());

// ---------- 툴바 ----------
function renderIntervals() {
  $('#intervals').innerHTML = INTERVALS.map((i) =>
    `<button data-interval="${i.id}" class="${i.id === settings.interval ? 'active' : ''}">${i.label}</button>`).join('');
}
$('#intervals').addEventListener('click', (e) => {
  const id = e.target.dataset?.interval;
  if (!id || id === settings.interval) return;
  settings.interval = id;
  save();
  renderIntervals();
  loadSymbol();
});

$('#chart-type').value = settings.chartType;
$('#chart-type').addEventListener('change', (e) => {
  settings.chartType = e.target.value;
  save();
  createMainSeries();
  setMainData();
});

function renderIndicatorMenu() {
  $('#indicator-menu').innerHTML = INDICATORS.map((d) => `
    <label><input type="checkbox" value="${d.id}" ${settings.indicators.includes(d.id) ? 'checked' : ''} />
    ${d.label}<span class="swatch" style="background:${d.color}"></span></label>`).join('');
}
$('#indicator-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('#indicator-menu');
  const r = e.currentTarget.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.min(r.left, innerWidth - 236)}px`;
  menu.hidden = !menu.hidden;
});
$('#indicator-menu').addEventListener('click', (e) => e.stopPropagation());
$('#indicator-menu').addEventListener('change', (e) => {
  const id = e.target.value;
  settings.indicators = e.target.checked ? [...settings.indicators, id] : settings.indicators.filter((x) => x !== id);
  save();
  buildIndicators();
  updateLegend();
});
document.addEventListener('click', () => { $('#indicator-menu').hidden = true; });

const themeIcon = () => { $('#theme-btn').textContent = settings.theme === 'dark' ? '☀' : '☾'; };
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
  $('#search-results').innerHTML = list.map((c, i) =>
    `<li data-coin="${c.id}" class="${i === searchIndex ? 'selected' : ''}"><span>${feed.market(c.id)}</span><span>${c.name || c.id}</span></li>`).join('')
    || '<li class="empty">검색 결과가 없습니다</li>';
  $('#search-count').textContent = markets ? `${feed.name} · 전체 ${markets.length.toLocaleString()}개 종목` : `${feed.name} · 종목 목록 불러오는 중…`;
}

function selectCoin(coin) {
  dialog.close();
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
  const li = e.target.closest('li');
  if (li?.dataset.coin) selectCoin(li.dataset.coin);
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

// 트레이딩뷰처럼 차트에서 바로 글자를 입력하면 검색창이 열린다.
document.addEventListener('keydown', (e) => {
  if (dialog.open || keyDialog.open || e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? drawings.redo() : drawings.undo(); }
  if (mod && k === 'y') { e.preventDefault(); return drawings.redo(); }
  if (mod || e.altKey) return;
  if (e.key === 'Escape') { drawings.setTool('cursor'); drawings.select(null); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && drawings.selected) { e.preventDefault(); return drawings.removeSelected(); }
  if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); openSearch(e.key.toUpperCase()); }
});

// ---------- 관심 목록 ----------
const tickers = new Map();

function renderWatchlist() {
  $('#watch-title').textContent = `관심 목록 · ${feed.name}`;
  const listed = markets && new Set(markets.map((m) => m.id));
  $('#watch-list').innerHTML = feed.coins.filter((c) => !listed || listed.has(c)).map((coin) => {
    const t = tickers.get(coin);
    const cls = t ? (t.changePct >= 0 ? 'up' : 'down') : '';
    return `<li data-coin="${coin}" class="${coin === settings.coin ? 'active' : ''}">
      <span class="sym">${coin}</span>
      <span>${t ? fmt(t.price, priceFormatFor(t.price).precision) : '—'}</span>
      <span class="${cls}">${t ? `${t.changePct >= 0 ? '+' : ''}${t.changePct.toFixed(2)}%` : ''}</span></li>`;
  }).join('');
}
$('#watch-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) selectCoin(li.dataset.coin);
});

let watchRender = 0;
function startTickers() {
  unsubscribeTickers();
  tickers.clear();
  renderWatchlist();
  unsubscribeTickers = feed.subscribeTickers(feed.coins, (t) => {
    tickers.set(t.coin, t);
    // 틱마다 다시 그리지 않고 프레임당 한 번만.
    watchRender ||= requestAnimationFrame(() => { watchRender = 0; renderWatchlist(); });
  });
}

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
$('#source').hidden = forceDemo;
$('#key-btn').hidden = forceDemo || !feed.needsKey;
$('#source').addEventListener('change', (e) => switchFeed(e.target.value));
setInterval(() => {
  $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false }) + ' (로컬)';
}, 1000);

// ---------- 시작 ----------
renderIntervals();
renderIndicatorMenu();
drawings.magnet = !!settings.magnet;
renderTools();
createMainSeries();
buildIndicators();
startTickers();
loadSymbol();
