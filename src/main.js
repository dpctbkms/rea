import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  CrosshairMode, ColorType, LineStyle,
} from 'lightweight-charts';
import { FEEDS, INTERVALS, COINS } from './feeds/index.js';
import { sma, ema, bollinger, rsi, macd, vwap, heikinAshi } from './indicators.js';

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
    lines: {}, // { ['거래소:코인']: number[] } 수평선 가격
  },
  load(),
);
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
if (!feed.coins.includes(settings.coin)) settings.coin = feed.coins[0];
const marketLabel = () => `${settings.coin}/${feed.quote}`;
const lineKey = () => `${feed.id}:${settings.coin}`;
let bars = [];
let mainSeries = null;
let active = new Map(); // indicator id -> { series: {key: ISeriesApi}, compute(bars) -> {key: data[]} }
let priceLines = [];
let unsubscribeBars = () => {};
let unsubscribeTickers = () => {};
let loadId = 0;
let tool = 'cursor';

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
    : (price >= 1000 ? 2 : price >= 1 ? 3 : price >= 0.01 ? 5 : 8);
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
  priceLines = [];
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
  restoreLines();
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
    feedError = `${feed.name}에 연결하지 못했습니다`;
    feed = feedById('demo');
    $('#symbol-label').textContent = marketLabel();
    startTickers();
    bars = await feed.getBars(settings.coin, settings.interval);
  }
  if (id !== loadId) return;
  setMainData();
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
chart.subscribeCrosshairMove((p) => { hoverTime = p.time ?? null; updateLegend(); });

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

// ---------- 수평선 그리기 ----------
function restoreLines() {
  priceLines.forEach((l) => mainSeries.removePriceLine(l));
  priceLines = (settings.lines[lineKey()] ?? []).map(addPriceLine);
}

function addPriceLine(price) {
  return mainSeries.createPriceLine({ price, color: css('--accent'), lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true });
}

chart.subscribeClick((p) => {
  if (tool !== 'hline' || !p.point) return;
  const price = mainSeries.coordinateToPrice(p.point.y);
  if (price == null) return;
  (settings.lines[lineKey()] ??= []).push(price);
  priceLines.push(addPriceLine(price));
  save();
  setTool('cursor');
});

function setTool(next) {
  if (next === 'clear') {
    priceLines.forEach((l) => mainSeries.removePriceLine(l));
    priceLines = [];
    delete settings.lines[lineKey()];
    save();
    next = 'cursor';
  }
  tool = next;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  $('.chart-wrap').classList.toggle('drawing', tool === 'hline');
}
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

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

function searchMatches() {
  const q = $('#search-input').value.trim().toUpperCase();
  return COINS.filter((c) => feed.coins.includes(c.id)
    && (c.id.includes(q) || c.name.includes(q) || feed.market(c.id).includes(q)));
}

function renderSearch() {
  const list = searchMatches();
  searchIndex = Math.min(searchIndex, Math.max(list.length - 1, 0));
  $('#search-results').innerHTML = list.map((c, i) =>
    `<li data-coin="${c.id}" class="${i === searchIndex ? 'selected' : ''}"><span>${feed.market(c.id)}</span><span>${c.name} · ${feed.name}</span></li>`).join('');
}

function selectCoin(coin) {
  dialog.close();
  if (coin === settings.coin) return;
  settings.coin = coin;
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
  if (e.key === 'Enter' && list[searchIndex]) selectCoin(list[searchIndex].id);
});
$('#search-results').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) selectCoin(li.dataset.coin);
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

// 트레이딩뷰처럼 차트에서 바로 글자를 입력하면 검색창이 열린다.
document.addEventListener('keydown', (e) => {
  if (dialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.matches('input, select')) return;
  if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); openSearch(e.key.toUpperCase()); }
  if (e.key === 'Escape') setTool('cursor');
});

// ---------- 관심 목록 ----------
const tickers = new Map();

function renderWatchlist() {
  $('#watch-title').textContent = `관심 목록 · ${feed.name}`;
  $('#watch-list').innerHTML = feed.coins.map((coin) => {
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
    : `실시간 · ${feed.name} (${feed.quote})`;
}

// ---------- 거래소 선택 ----------
$('#source').innerHTML = FEEDS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
$('#source').value = feed.id;
$('#source').hidden = forceDemo;
$('#source').addEventListener('change', (e) => {
  settings.source = e.target.value;
  feed = feedById(settings.source);
  feedError = null;
  if (!feed.coins.includes(settings.coin)) settings.coin = feed.coins[0];
  save();
  startTickers();
  loadSymbol();
});
setInterval(() => {
  $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false }) + ' (로컬)';
}, 1000);

// ---------- 시작 ----------
renderIntervals();
renderIndicatorMenu();
createMainSeries();
buildIndicators();
startTickers();
loadSymbol();
