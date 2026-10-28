import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  CrosshairMode, ColorType, LineStyle,
} from 'lightweight-charts';
import { FEEDS, INTERVALS } from './feeds/index.js';
import { heikinAshi } from './indicators.js';
import { STUDIES, CATEGORIES, studyDef, newStudy, studyTitle, migrateStudies, DEFAULT_STUDIES } from './studies.js';
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
    indicators: null, // 지표 목록 (studies.js 형식)
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
  $('#legend').innerHTML = `<div class="row head"></div>${rows}`;
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

  const head = $('#legend .head');
  if (head) {
    head.innerHTML = `<span class="title">${marketLabel()}</span><span class="k">${interval} · ${feed.name}</span>
      <span><span class="k">시</span> <span class="${cls}">${fmt(bar.open, digits)}</span></span>
      <span><span class="k">고</span> <span class="${cls}">${fmt(bar.high, digits)}</span></span>
      <span><span class="k">저</span> <span class="${cls}">${fmt(bar.low, digits)}</span></span>
      <span><span class="k">종</span> <span class="${cls}">${fmt(bar.close, digits)}</span></span>
      <span class="${cls}">${change >= 0 ? '+' : ''}${fmt(change, digits)} (${((change / prev.close) * 100).toFixed(2)}%)</span>`;
  }
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
  if (!btn) return;
  const id = btn.closest('.study').dataset.id;
  const study = settings.indicators.find((x) => x.id === id);
  if (btn.dataset.act === 'toggle') { study.hidden = !study.hidden; saveStudies(); }
  if (btn.dataset.act === 'remove') removeStudy(id);
  if (btn.dataset.act === 'settings') openStudySettings(id);
});

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
let press = null; // 누른 위치·시각 (탭 판정용)
chartEl.addEventListener('pointerdown', (e) => {
  press = { point: localPoint(e), at: performance.now(), id: e.pointerId, touch: e.pointerType !== 'mouse' };
  if (e.button !== 0 || !drawings.beginDrag(press.point, press.touch)) return;
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

// 점 찍기는 누름·뗌(포인터 이벤트)으로 직접 판정한다.
// - 차트 라이브러리의 클릭 알림은 0.5초 안에 다른 곳을 누르면 빠뜨린다.
// - 휴대폰에서는 차트가 터치를 막아서 브라우저의 click 이벤트가 아예 오지 않는다.
// 끌어서 차트를 옮긴 경우, 오래 누른 경우, 가격·시간 눈금 위를 누른 경우는 제외한다.
const TAP_MAX_MS = 600;
chartEl.addEventListener('pointerup', (e) => {
  const start = press;
  press = null;
  if (!start || start.id !== e.pointerId || performance.now() - start.at > TAP_MAX_MS) return;
  const pt = localPoint(e);
  if (Math.hypot(pt.x - start.point.x, pt.y - start.point.y) > (start.touch ? 10 : 5)) return;
  if (pt.x > chart.timeScale().width() || pt.y > chart.panes()[0].getHeight()) return;
  drawings.handleClick(pt);
}, { capture: true });
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
drawings.magnet = !!settings.magnet;
renderTools();
createMainSeries();
buildIndicators();
startTickers();
loadSymbol();
