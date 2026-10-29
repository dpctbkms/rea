// 그리기 도구. 모든 도형을 가격 시리즈에 붙인 레이어 하나(시리즈 프리미티브)에 그린다.
// 점은 {time, price}로 저장해서 타임프레임을 바꿔도 같은 자리에 남는다.
// 동작은 트레이딩뷰 공개 문서(도움말·단축키)를 기준으로 맞췄다.

// points: 찍는 점 수, 'free' = 누른 채 그리기(브러시), 'multi' = 원하는 만큼 찍고 마지막 점을 다시 눌러 끝내기
// type: 저장되는 도형 종류 (정보선·확장선처럼 추세선에 설정만 다른 도구), preset: 처음 설정
export const TOOLS = [
  { id: 'trend', label: '추세선', points: 2, key: 'T' },
  { id: 'ray', label: '레이', points: 2 },
  { id: 'infoline', label: '정보선', points: 2, type: 'trend', preset: { stats: ['price', 'bars', 'angle'] } },
  { id: 'extended', label: '확장선', points: 2, type: 'trend', preset: { extendLeft: true, extendRight: true } },
  { id: 'trendangle', label: '추세 각도', points: 2, type: 'trend', preset: { stats: ['angle'], angleArc: true } },
  { id: 'hline', label: '수평선', points: 1, key: 'H' },
  { id: 'hray', label: '수평 레이', points: 1, key: 'J' },
  { id: 'vline', label: '수직선', points: 1, key: 'V' },
  { id: 'crossline', label: '십자선', points: 1, key: 'C' },
  { id: 'channel', label: '평행 채널', points: 3 },
  { id: 'regression', label: '회귀 추세', points: 2 },
  { id: 'fib', label: '피보나치 되돌림', points: 2, key: 'F' },
  { id: 'fibext', label: '추세 기반 피보나치 확장', points: 3 },
  { id: 'fibtime', label: '피보나치 시간대', points: 2 },
  { id: 'long', label: '롱 포지션', points: 1 },
  { id: 'short', label: '숏 포지션', points: 1 },
  { id: 'daterange', label: '날짜 범위', points: 2 },
  { id: 'pricerange', label: '가격 범위', points: 2 },
  { id: 'measure', label: '날짜·가격 범위', points: 2 },
  { id: 'brush', label: '브러시', points: 'free' },
  { id: 'highlighter', label: '형광펜', points: 'free' },
  { id: 'rect', label: '사각형', points: 2, key: 'Shift+R' },
  { id: 'circle', label: '원', points: 2 },
  { id: 'ellipse', label: '타원', points: 2 },
  { id: 'triangle', label: '삼각형', points: 3 },
  { id: 'path', label: '경로', points: 'multi' },
  { id: 'polyline', label: '폴리라인', points: 'multi' },
  { id: 'text', label: '텍스트', points: 1 },
  { id: 'pricelabel', label: '가격 라벨', points: 1 },
  { id: 'arrow', label: '화살표', points: 2 },
  { id: 'arrowup', label: '위 화살표 표시', points: 1 },
  { id: 'arrowdown', label: '아래 화살표 표시', points: 1 },
];

export const COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#787b86', '#00bcd4', '#e91e63', '#ffeb3b', '#ffffff', '#4caf50', '#000000'];
export const LINE_STYLES = { solid: [], dashed: [8, 5], dotted: [2, 4] };

// 트레이딩뷰 피보나치 기본 레벨과 색
export const FIB_LEVELS = [
  [0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'], [0.618, '#089981'], [0.786, '#00bcd4'],
  [1, '#787b86'], [1.618, '#2962ff'], [2.618, '#f23645'], [3.618, '#9c27b0'], [4.236, '#e91e63'],
];
const FIB_TIME = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

// 타임프레임 묶음 (도형마다 어느 묶음에서 보일지 정할 수 있다)
export const VISIBILITY_GROUPS = [
  { id: 'min', label: '분', test: (s) => s < 3600 },
  { id: 'hour', label: '시간', test: (s) => s >= 3600 && s < 86400 },
  { id: 'day', label: '일', test: (s) => s >= 86400 && s < 604800 },
  { id: 'week', label: '주', test: (s) => s >= 604800 },
];

const NO_HANDLES = ['hline', 'vline', 'crossline', 'text', 'brush', 'highlighter', 'arrowup', 'arrowdown', 'pricelabel'];
const PRICE_LABEL = ['hline', 'hray', 'crossline'];
const TIME_LABEL = ['vline', 'crossline'];
const ANGLE_SNAP = ['trend', 'ray', 'channel', 'fib', 'fibext', 'measure', 'arrow', 'regression'];
const SQUARE_SNAP = ['rect', 'ellipse'];
// 휴대폰 떠 있는 막대의 45° 버튼을 보여 줄 도형 (Shift 대신)
export const canAngleLock = (type) => ANGLE_SNAP.includes(type);
const CROSSHAIR_LABEL = '#4c525e';
const DEFAULT_COLORS = { measure: '#089981', arrowup: '#089981', arrowdown: '#f23645', highlighter: '#ff9800' };
const HISTORY_LIMIT = 50;
const MAGNET_PX = 30; // 약한 자석: 이 거리 안이면 붙인다
const DRAG_MIN_PX = 6; // 이만큼 끌었으면 "끌어서 그리기"로 본다
const FREEHAND_STEP_PX = 3;

export const toolInfo = (id) => TOOLS.find((t) => t.id === id);
export const typeLabel = (type) => TOOLS.find((t) => t.id === type)?.label ?? type;
const uid = () => Math.random().toString(36).slice(2, 10);

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const nearPolyline = (p, pts, tol, closed = false) => pts.some((a, i) => {
  const b = pts[i + 1] ?? (closed ? pts[0] : null);
  return b && distToSegment(p, a, b) <= tol;
});
function insidePolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > p.y) !== (pts[j].y > p.y) && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}
const inBox = (p, a, b, tol) => p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol && p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol;

// 두 점을 지나는 선을 화면 오른쪽(또는 왼쪽) 끝까지 늘린 끝점.
function extendTo(a, b, width) {
  if (b.x === a.x) return { x: b.x, y: b.y > a.y ? 1e6 : -1e6 };
  const edge = b.x > a.x ? width : 0;
  return { x: edge, y: a.y + ((b.y - a.y) * (edge - a.x)) / (b.x - a.x) };
}

function formatDuration(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.round((sec % 3600) / 60);
  if (d) return h ? `${d}일 ${h}시간` : `${d}일`;
  if (h) return m ? `${h}시간 ${m}분` : `${h}시간`;
  return `${m}분`;
}

export class DrawingManager {
  constructor({ chart, getBars, getStep, formatPrice, formatTime, formatVolume, onChange, onSelect, onToolChange, onTextCreated, onDraft }) {
    Object.assign(this, { chart, getBars, getStep, formatPrice, formatTime, formatVolume, onChange, onSelect, onToolChange, onTextCreated, onDraft });
    this.drawings = [];
    this.tool = 'cursor';
    this.magnet = 'off'; // off | weak | strong
    this.selectedId = null; // 마지막으로 고른 도형 (떠 있는 막대·설정 창 대상)
    this.selection = new Set(); // 함께 선택된 도형들 (Ctrl+클릭)
    this.locked = false; // 모두 잠금
    this.hidden = false; // 모두 숨기기
    this.stay = false; // 드로잉 모드 유지
    this.draft = null; // 그리는 중인 도형
    this.hover = null; // 그리는 중 미리보기 점
    this.hoverId = null; // 마우스가 올라간 도형
    this.press = null; // 그리는 중 누른 위치
    this.freehand = false; // 브러시로 긋는 중
    this.quick = null; // Shift+클릭 빠른 측정
    this.touchCursor = null; // 휴대폰에서 그릴 때 손가락 대신 점을 찍는 십자선
    this.lastTouchCursor = null; // 다음 도구를 고르면 십자선이 다시 나타날 자리
    this.angleLock = false; // 45° 고정 (휴대폰 떠 있는 막대의 버튼, Shift와 같음)
    this.handleFill = '#131722'; // 손잡이 안쪽 색 (차트 배경)
    this.drag = null;
    this.clipboard = null;
    this.undoStack = [];
    this.redoStack = [];
    this.boxes = new Map(); // 글자·라벨의 화면 영역 (클릭 판정용)
    const mgr = this;
    this.layer = {
      attached({ requestUpdate }) { mgr.requestUpdate = requestUpdate; },
      detached() { mgr.requestUpdate = null; },
      updateAllViews() {},
      paneViews: () => [{
        zOrder: () => 'top',
        renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.#draw(context, mediaSize)) }),
      }],
      priceAxisViews: () => this.#axisViews('price'),
      timeAxisViews: () => this.#axisViews('time'),
    };
  }

  // ---------- 상태 ----------
  attach(series) {
    this.series?.detachPrimitive(this.layer);
    this.series = series;
    series.attachPrimitive(this.layer);
  }

  load(drawings) {
    this.drawings = structuredClone(drawings ?? []);
    this.undoStack = [];
    this.redoStack = [];
    this.draft = null;
    this.quick = null;
    this.select(null);
    this.update();
  }

  update() { this.requestUpdate?.(); }

  #commit() {
    this.onChange(structuredClone(this.drawings));
    this.update();
  }

  #snapshot() {
    this.undoStack.push(JSON.stringify(this.drawings));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() { this.#restore(this.undoStack, this.redoStack); }
  redo() { this.#restore(this.redoStack, this.undoStack); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  #restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(this.drawings));
    this.drawings = JSON.parse(from.pop());
    if (!this.drawings.some((d) => d.id === this.selectedId)) this.select(null);
    this.#commit();
  }

  setTool(tool) {
    this.tool = tool;
    this.draft = null;
    this.hover = null;
    this.press = null;
    this.freehand = false;
    if (tool === 'cursor') this.touchCursor = null;
    else this.select(null);
    this.onToolChange(tool);
    this.update();
  }

  select(id) {
    if (id === this.selectedId && this.selection.size <= 1) return;
    this.selectedId = id;
    this.selection = new Set(id ? [id] : []);
    this.onSelect(this.selected);
    this.update();
  }

  toggleSelect(id) {
    if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
    this.selectedId = this.selection.has(id) ? id : [...this.selection].at(-1) ?? null;
    this.onSelect(this.selected);
    this.update();
  }

  get selected() { return this.drawings.find((d) => d.id === this.selectedId) ?? null; }
  get selectedAll() { return this.drawings.filter((d) => this.selection.has(d.id)); }

  removeSelected() {
    if (!this.selection.size) return;
    this.#snapshot();
    this.drawings = this.drawings.filter((d) => !this.selection.has(d.id));
    this.select(null);
    this.#commit();
  }

  removeById(id) {
    if (!this.drawings.some((d) => d.id === id)) return;
    this.#snapshot();
    this.drawings = this.drawings.filter((d) => d.id !== id);
    if (this.selection.has(id)) this.select(null);
    this.#commit();
  }

  clear() {
    if (!this.drawings.length) return;
    this.#snapshot();
    this.drawings = [];
    this.select(null);
    this.#commit();
  }

  // 모양은 선택된 모든 도형에, 좌표·글자는 마지막으로 고른 도형에만
  updateSelected(patch, onlyPrimary = false) {
    if (!this.selected) return;
    this.#snapshot();
    for (const d of onlyPrimary ? [this.selected] : this.selectedAll) Object.assign(d, structuredClone(patch));
    this.onSelect(this.selected);
    this.#commit();
  }

  // 앞뒤 순서: 배열 뒤에 있을수록 위에 그려진다
  reorderSelected(toFront) {
    const picked = this.selectedAll;
    if (!picked.length) return;
    this.#snapshot();
    const rest = this.drawings.filter((d) => !this.selection.has(d.id));
    this.drawings = toFront ? [...rest, ...picked] : [...picked, ...rest];
    this.#commit();
  }

  #visible(d) {
    const step = this.getStep();
    return !(d.hiddenOn ?? []).some((g) => VISIBILITY_GROUPS.find((x) => x.id === g)?.test(step));
  }

  #add(drawing) {
    this.#snapshot();
    this.drawings.push(drawing);
    this.selectedId = null;
    this.select(drawing.id);
    this.#commit();
  }

  #copyOf(d, shiftBars = 0) {
    const dt = shiftBars * this.getStep();
    return { ...structuredClone(d), id: uid(), locked: false, points: d.points.map((p) => ({ time: p.time + dt, price: p.price })) };
  }

  duplicateSelected() { if (this.selected) this.#add(this.#copyOf(this.selected, 5)); }
  copySelected() { if (this.selected) this.clipboard = structuredClone(this.selected); }
  paste() { if (this.clipboard) this.#add(this.#copyOf(this.clipboard, 5)); }

  pointToPixel(pt) { return this.#toPixel(pt); }

  setHover(point, touch) {
    const hit = this.tool === 'cursor' && point ? this.hitTest(point, touch ? 14 : 7) : null;
    const id = hit?.drawing.id ?? null;
    if (id !== this.hoverId) { this.hoverId = id; this.update(); }
    return hit;
  }

  // 휴대폰: 그리는 동안 손가락이 움직인 만큼 옮겨지는 십자선
  setTouchCursor(pt) {
    this.touchCursor = pt;
    if (pt) this.lastTouchCursor = pt;
    if (pt && this.draft) this.hover = this.#fromPixel(pt);
    this.update();
  }

  // ---------- 좌표 변환 ----------
  #timeToLogical(time) {
    const bars = this.getBars(), step = this.getStep();
    const last = bars.length - 1;
    if (last < 0) return null;
    if (time <= bars[0].time) return (time - bars[0].time) / step;
    if (time >= bars[last].time) return last + (time - bars[last].time) / step;
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time <= time) lo = mid; else hi = mid;
    }
    return lo + (time - bars[lo].time) / (bars[hi].time - bars[lo].time);
  }

  #logicalToTime(logical) {
    const bars = this.getBars(), step = this.getStep();
    const last = bars.length - 1;
    if (logical <= 0) return bars[0].time + logical * step;
    if (logical >= last) return bars[last].time + (logical - last) * step;
    const i = Math.floor(logical);
    return bars[i].time + (logical - i) * (bars[i + 1].time - bars[i].time);
  }

  #toPixel(pt) {
    const logical = this.#timeToLogical(pt.time);
    const x = logical == null ? null : this.chart.timeScale().logicalToCoordinate(logical);
    const y = this.series.priceToCoordinate(pt.price);
    return x == null || y == null ? null : { x, y };
  }

  // 자석 모드. Ctrl(⌘)을 누르고 있는 동안은 잠깐 반대로 (꺼져 있으면 켜고, 켜져 있으면 끈다).
  #magnetMode(invert) {
    if (!invert) return this.magnet;
    return this.magnet === 'off' ? 'weak' : 'off';
  }

  // 화면 좌표 -> 점. 가로는 봉 가운데에 맞추고, 자석이면 시가·고가·저가·종가에 붙인다.
  #fromPixel({ x, y }, snapX = true, magnetInvert = false) {
    let logical = this.chart.timeScale().coordinateToLogical(x);
    const price = this.series.coordinateToPrice(y);
    if (logical == null || price == null || !this.getBars().length) return null;
    if (snapX) logical = Math.round(logical);
    const point = { time: this.#logicalToTime(logical), price };
    const mode = this.#magnetMode(magnetInvert);
    const bar = mode !== 'off' && snapX && this.getBars()[logical];
    if (bar) {
      const nearest = [bar.open, bar.high, bar.low, bar.close]
        .map((p) => ({ p, dy: Math.abs(this.series.priceToCoordinate(p) - y) }))
        .sort((a, b) => a.dy - b.dy)[0];
      if (mode === 'strong' || nearest.dy <= MAGNET_PX) point.price = nearest.p;
    }
    return point;
  }

  // ---------- 그리기 입력 ----------
  get #toolDef() { return toolInfo(this.tool); }
  get #toolType() { return this.#toolDef?.type ?? this.tool; }
  get isFreehandTool() { return this.#toolDef?.points === 'free'; }

  // keys: { shift, ctrl, touch }
  handleClick(point, keys = {}) {
    if (!point) return;
    if (this.tool === 'cursor') {
      const id = this.hitTest(point, keys.touch ? 14 : 7)?.drawing.id ?? null;
      if (keys.ctrl && id) this.toggleSelect(id); else this.select(id);
      return;
    }
    this.#addPoint(point, keys);
  }

  // 마우스: 점마다 클릭하거나, 누른 채 끌었다가 떼서 그린다. 브러시는 누른 채 긋는다.
  pressDraw(point, keys = {}) {
    this.press = point;
    if (this.isFreehandTool) {
      const pt = this.#fromPixel(point, false);
      if (!pt) return;
      this.freehand = true;
      this.draft = this.#newDraft();
      this.draft.points.push(pt);
      this.update();
      return;
    }
    this.#addPoint(point, keys);
  }

  releaseDraw(point, keys = {}) {
    const start = this.press;
    this.press = null;
    if (this.freehand) {
      this.freehand = false;
      if (this.draft?.points.length >= 2) this.#finishDraft(); else this.cancelDraft();
      return;
    }
    if (!start || !this.draft || !point || this.#toolDef?.points === 'multi') return;
    if (Math.hypot(point.x - start.x, point.y - start.y) >= DRAG_MIN_PX) this.#addPoint(point, keys);
  }

  handleMove(point, keys = {}) {
    if (!point) return;
    if (this.freehand && this.draft) {
      const last = this.#toPixel(this.draft.points.at(-1));
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= FREEHAND_STEP_PX) {
        const pt = this.#fromPixel(point, false);
        if (pt) this.draft.points.push(pt);
        this.update();
      }
      return;
    }
    if (this.quick && !this.quick.fixed) {
      this.quick.hover = this.#fromPixel(point);
      this.update();
      return;
    }
    if (!this.draft) return;
    this.hover = this.#constrain(this.#fromPixel(point, true, keys.ctrl), keys.shift);
    this.update();
  }

  #newDraft() {
    const def = this.#toolDef;
    const type = this.#toolType;
    return {
      id: uid(), type, points: [], color: DEFAULT_COLORS[type] ?? COLORS[0],
      width: type === 'highlighter' ? 14 : type === 'hline' || type === 'vline' || type === 'hray' ? 1 : 2,
      lineStyle: 'solid', ...structuredClone(def?.preset ?? {}),
    };
  }

  #addPoint(point, keys = {}) {
    const def = this.#toolDef;
    if (!def || def.points === 'free') return;
    const pt = this.#constrain(this.#fromPixel(point, true, keys.ctrl), keys.shift);
    if (!pt) return;
    const prev = this.draft?.points.at(-1);
    const prevPx = prev && this.#toPixel(prev);
    const ptPx = this.#toPixel(pt);
    const samePlace = prevPx && ptPx && Math.hypot(prevPx.x - ptPx.x, prevPx.y - ptPx.y) < 6;
    if (def.points === 'multi') {
      // 마지막 점을 다시 누르면(더블클릭) 끝낸다. 폴리라인은 첫 점을 누르면 닫힌다.
      const firstPx = this.draft && this.#toPixel(this.draft.points[0]);
      const closes = def.id === 'polyline' && firstPx && ptPx && this.draft.points.length >= 3 && Math.hypot(firstPx.x - ptPx.x, firstPx.y - ptPx.y) < 8;
      if (samePlace || closes) return void this.finishMulti();
      this.draft ??= this.#newDraft();
      this.draft.points.push(pt);
      this.onDraft?.();
      return this.update();
    }
    if (samePlace) return;
    this.draft ??= this.#newDraft();
    this.draft.points.push(pt);
    if (this.draft.points.length < def.points) { this.onDraft?.(); return this.update(); }
    this.#finishDraft();
  }

  // 경로·폴리라인 끝내기 (Enter 또는 마지막 점 다시 누르기)
  finishMulti() {
    const need = this.tool === 'polyline' ? 3 : 2;
    if (!this.draft || this.draft.points.length < need) return false;
    this.#finishDraft();
    return true;
  }

  #constrain(pt, shift) {
    const anchor = this.draft?.points.at(-1);
    if (!pt || !(shift || this.angleLock) || !anchor) return pt;
    const a = this.#toPixel(anchor), p = this.#toPixel(pt);
    if (!a || !p) return pt;
    const type = this.#toolType;
    if (SQUARE_SNAP.includes(type)) {
      const side = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
      return this.#fromPixel({ x: a.x + Math.sign(p.x - a.x || 1) * side, y: a.y + Math.sign(p.y - a.y || 1) * side }, false) ?? pt;
    }
    if (!ANGLE_SNAP.includes(type)) return pt;
    return this.#snapAngle(anchor, a, p) ?? pt;
  }

  // 화면 기준 45° 단위로 맞춘 점 (수평이면 가격을 정확히 같게)
  #snapAngle(anchor, a, p) {
    const len = Math.hypot(p.x - a.x, p.y - a.y);
    const angle = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
    const snapped = this.#fromPixel({ x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) });
    if (snapped && Math.abs(Math.sin(angle)) < 1e-9) snapped.price = anchor.price;
    return snapped;
  }

  #finishDraft() {
    const drawing = this.draft;
    this.draft = null;
    this.hover = null;
    if (drawing.type === 'text') { drawing.text = ''; drawing.fontSize = 14; }
    if (drawing.type === 'ray') drawing.extendRight = true;
    if (drawing.type === 'long' || drawing.type === 'short') this.#positionDefaults(drawing);
    if (drawing.type === 'regression') this.#fitRegression(drawing);
    if (drawing.type === 'fib' || drawing.type === 'fibext') drawing.levels = FIB_LEVELS.map(([l]) => l);
    this.onDraft?.();
    if (this.stay) {
      this.#snapshot();
      this.drawings.push(drawing);
      this.#commit();
    } else {
      this.setTool('cursor');
      this.#add(drawing);
    }
    // 트레이딩뷰처럼 텍스트는 놓자마자 차트 위에서 바로 입력
    if (drawing.type === 'text') this.onTextCreated?.(drawing);
  }

  // 롱·숏 포지션: 한 번 클릭하면 최근 변동폭(ATR)으로 목표·손절, 30봉 너비의 상자를 만든다
  #positionDefaults(d) {
    const recent = this.getBars().slice(-15);
    const atr = recent.slice(1).reduce((s, b, i) => s + Math.max(b.high - b.low, Math.abs(b.high - recent[i].close), Math.abs(b.low - recent[i].close)), 0) / Math.max(1, recent.length - 1);
    const entry = d.points[0];
    const dir = d.type === 'long' ? 1 : -1;
    const end = entry.time + 30 * this.getStep();
    d.points = [entry, { time: end, price: entry.price + dir * atr * 3 }, { time: end, price: entry.price - dir * atr * 1.5 }];
  }

  // 회귀 추세: 두 점 사이 종가의 선형 회귀선과 ±2 표준편차
  #regression(d) {
    const bars = this.getBars();
    const t1 = Math.min(d.points[0].time, d.points[1].time), t2 = Math.max(d.points[0].time, d.points[1].time);
    const rows = [];
    bars.forEach((b, i) => { if (b.time >= t1 && b.time <= t2) rows.push({ i, c: b.close, t: b.time }); });
    if (rows.length < 2) return null;
    const n = rows.length, mx = rows.reduce((s, r) => s + r.i, 0) / n, my = rows.reduce((s, r) => s + r.c, 0) / n;
    const slope = rows.reduce((s, r) => s + (r.i - mx) * (r.c - my), 0) / rows.reduce((s, r) => s + (r.i - mx) ** 2, 0);
    const at = (i) => my + slope * (i - mx);
    const sd = Math.sqrt(rows.reduce((s, r) => s + (r.c - at(r.i)) ** 2, 0) / n);
    return { from: rows[0], to: rows[n - 1], at, sd };
  }

  // 회귀 추세의 점을 회귀선 위로 맞춘다 (손잡이가 선 위에 오도록)
  #fitRegression(d) {
    const r = this.#regression(d);
    if (r) d.points = [{ time: r.from.t, price: r.at(r.from.i) }, { time: r.to.t, price: r.at(r.to.i) }];
  }

  cancelDraft() {
    if (!this.draft && !this.quick) return false;
    this.draft = null;
    this.quick = null;
    this.hover = null;
    this.press = null;
    this.freehand = false;
    this.onDraft?.();
    this.update();
    return true;
  }

  // ---------- Shift+클릭 빠른 측정 ----------
  // 첫 클릭으로 시작, 두 번째 클릭으로 고정, 그다음 클릭에 사라진다 (저장하지 않음)
  quickMeasureClick(point) {
    if (!this.quick) {
      const pt = this.#fromPixel(point);
      if (pt) this.quick = { points: [pt], hover: pt, fixed: false };
    } else if (!this.quick.fixed) {
      const pt = this.#fromPixel(point);
      if (pt) this.quick = { points: [this.quick.points[0], pt], fixed: true };
    } else {
      this.quick = null;
    }
    this.update();
  }

  // ---------- 끌기 ----------
  // Ctrl을 누른 채 몸통을 끌면 복사본을 끌어 놓고, 끌지 않고 떼면 (탭 처리에서) 선택에 넣거나 뺀다.
  beginDrag(point, touch, ctrl = false) {
    if (this.tool !== 'cursor' || this.locked || this.hidden) return false;
    const hit = this.hitTest(point, touch ? 14 : 7);
    if (!hit) return false;
    if (!ctrl && !this.selection.has(hit.drawing.id)) this.select(hit.drawing.id);
    if (hit.drawing.locked) return false;
    const group = hit.handle == null && this.selection.has(hit.drawing.id) ? this.selectedAll.filter((d) => !d.locked) : [hit.drawing];
    this.drag = {
      hit, startPx: point, start: this.#fromPixel(point, false),
      // 손잡이는 손가락(마우스)이 움직인 만큼만 옮긴다 (누른 순간 손가락 밑으로 튀지 않게)
      handlePx: hit.handle != null ? this.#toPixel(hit.drawing.points[hit.handle]) : null,
      originals: new Map(group.map((d) => [d.id, structuredClone(d.points)])),
      cloneOnMove: ctrl && hit.handle == null, moved: false,
    };
    return true;
  }

  dragTo(point, keys = {}) {
    if (!this.drag) return;
    const { hit, start, startPx } = this.drag;
    // Shift로 몸통을 끌면 가로 또는 세로로만
    if (keys.shift && hit.handle == null) {
      point = Math.abs(point.x - startPx.x) >= Math.abs(point.y - startPx.y) ? { x: point.x, y: startPx.y } : { x: startPx.x, y: point.y };
    }
    const target = this.drag.handlePx ? { x: this.drag.handlePx.x + point.x - startPx.x, y: this.drag.handlePx.y + point.y - startPx.y } : point;
    const now = this.#fromPixel(target, hit.handle != null, hit.handle != null && keys.ctrl);
    if (!now || !start) return;
    if (!this.drag.moved) {
      this.#snapshot();
      this.drag.moved = true;
      if (this.drag.cloneOnMove) {
        const copy = this.#copyOf(hit.drawing);
        this.drawings.push(copy);
        this.select(copy.id);
        this.drag.hit = { drawing: copy, handle: null };
        this.drag.originals = new Map([[copy.id, structuredClone(copy.points)]]);
      }
    }
    const d = this.drag.hit.drawing;
    if (hit.handle != null) {
      d.points[hit.handle] = now;
      if ((keys.shift || this.angleLock) && ANGLE_SNAP.includes(d.type) && d.points.length >= 2) {
        const other = d.points[hit.handle === 0 ? 1 : 0];
        const a = this.#toPixel(other), p = this.#toPixel(now);
        const snapped = a && p && this.#snapAngle(other, a, p);
        if (snapped) d.points[hit.handle] = snapped;
      }
      // 포지션 도구: 목표·손절 손잡이는 같은 오른쪽 끝을 쓴다
      if ((d.type === 'long' || d.type === 'short') && hit.handle > 0) d.points[1].time = d.points[2].time = now.time;
      if (d.type === 'regression') this.#fitRegression(d);
    } else {
      const dt = now.time - start.time, dp = now.price - start.price;
      for (const x of this.drawings) {
        const orig = this.drag.originals.get(x.id);
        if (orig) x.points = orig.map((p) => ({ time: p.time + dt, price: p.price + dp }));
      }
    }
    this.update();
  }

  endDrag() {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.#commit();
    this.onSelect(this.selected);
  }

  // ---------- 클릭 판정 ----------
  hitTest(point, tolerance = 7) {
    if (this.hidden) return null;
    const width = this.chart.timeScale().width();
    // 선택되었거나 마우스가 올라간 도형의 손잡이가 가장 우선
    for (const d of [this.selected, this.drawings.find((x) => x.id === this.hoverId)]) {
      if (!d || NO_HANDLES.includes(d.type) || !this.#visible(d)) continue;
      const px = d.points.map((p) => this.#toPixel(p));
      const handle = px.findIndex((p) => p && Math.hypot(p.x - point.x, p.y - point.y) <= tolerance + 4);
      if (handle >= 0) return { drawing: d, handle };
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (this.#visible(d) && this.#hits(d, point, tolerance, width)) return { drawing: d, handle: null };
    }
    return null;
  }

  #hits(d, p, tol, width) {
    const px = d.points.map((pt) => this.#toPixel(pt));
    if (px.some((x) => !x)) return false;
    const [a, b, c] = px;
    switch (d.type) {
      case 'hline': return Math.abs(p.y - a.y) <= tol;
      case 'hray': return p.x >= a.x - tol && Math.abs(p.y - a.y) <= tol;
      case 'vline': return Math.abs(p.x - a.x) <= tol;
      case 'crossline': return Math.abs(p.y - a.y) <= tol || Math.abs(p.x - a.x) <= tol;
      case 'trend': case 'ray': {
        const right = d.extendRight ?? d.type === 'ray', left = d.extendLeft;
        return distToSegment(p, left ? extendTo(b, a, width) : a, right ? extendTo(a, b, width) : b) <= tol;
      }
      case 'arrow': case 'path': case 'brush': return nearPolyline(p, px, tol);
      case 'highlighter': return nearPolyline(p, px, tol + (d.width ?? 14) / 2);
      case 'polyline': case 'triangle': return nearPolyline(p, px, tol, true) || (px.length > 2 && insidePolygon(p, px));
      case 'channel': {
        if (!c) return false;
        const off = c.y - this.#lineYAt(a, b, c.x);
        return distToSegment(p, a, b) <= tol || distToSegment(p, { x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }) <= tol;
      }
      case 'regression': {
        const g = this.#regressionPx(d);
        return !!g && [g.mid, g.up, g.down].some(([q1, q2]) => distToSegment(p, q1, q2) <= tol);
      }
      case 'circle': return Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(b.x - a.x, b.y - a.y) + tol;
      case 'ellipse': {
        const rx = Math.abs(b.x - a.x) / 2 + tol, ry = Math.abs(b.y - a.y) / 2 + tol;
        return ((p.x - (a.x + b.x) / 2) / rx) ** 2 + ((p.y - (a.y + b.y) / 2) / ry) ** 2 <= 1;
      }
      case 'long': case 'short':
        return p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol && p.y >= Math.min(b.y, c.y) - tol && p.y <= Math.max(b.y, c.y) + tol;
      case 'fibext': {
        const ys = this.#fibLevels(d).map((l) => l.y).filter((y) => y != null);
        const x2 = c.x + Math.max(40, Math.abs(b.x - a.x));
        return inBox(p, { x: Math.min(a.x, c.x), y: Math.min(...ys, a.y, b.y) }, { x: x2, y: Math.max(...ys, a.y, b.y) }, tol);
      }
      case 'fibtime': return this.#fibTimeXs(d).some((x) => Math.abs(p.x - x) <= tol);
      case 'fib': {
        const ys = this.#fibLevels(d).map((l) => l.y).filter((y) => y != null);
        return inBox(p, { x: Math.min(a.x, b.x), y: Math.min(...ys) }, { x: Math.max(a.x, b.x), y: Math.max(...ys) }, tol);
      }
      case 'rect': case 'measure': return inBox(p, a, b, tol);
      case 'daterange': return p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol;
      case 'pricerange': return p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol;
      case 'arrowup': case 'arrowdown': return Math.abs(p.x - a.x) <= 12 + tol && Math.abs(p.y - (a.y + (d.type === 'arrowup' ? 17 : -17))) <= 15 + tol;
      case 'text': case 'pricelabel': {
        const box = this.boxes.get(d.id);
        return !!box && inBox(p, { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, tol);
      }
      default: return false;
    }
  }

  #lineYAt(a, b, x) {
    return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }

  #regressionPx(d) {
    const r = this.#regression(d);
    if (!r) return null;
    const ts = this.chart.timeScale();
    const x1 = ts.logicalToCoordinate(r.from.i), x2 = ts.logicalToCoordinate(r.to.i);
    if (x1 == null || x2 == null) return null;
    const seg = (k) => [{ x: x1, y: this.series.priceToCoordinate(r.at(r.from.i) + k * 2 * r.sd) }, { x: x2, y: this.series.priceToCoordinate(r.at(r.to.i) + k * 2 * r.sd) }];
    return { mid: seg(0), up: seg(1), down: seg(-1) };
  }

  #fibLevels(d) {
    const enabled = d.levels ?? FIB_LEVELS.map(([l]) => l);
    const [p1, p2, p3] = d.points;
    return FIB_LEVELS.filter(([l]) => enabled.includes(l)).map(([level, color]) => {
      const price = d.type === 'fibext' ? p3.price + (p2.price - p1.price) * level : p2.price + (p1.price - p2.price) * level;
      return { level, color, price, y: this.series.priceToCoordinate(price) };
    });
  }

  #fibTimeXs(d) {
    const l1 = this.#timeToLogical(d.points[0].time), l2 = this.#timeToLogical(d.points[1].time);
    const ts = this.chart.timeScale();
    return FIB_TIME.map((n) => ts.logicalToCoordinate(l1 + n * (l2 - l1))).filter((x) => x != null);
  }

  // ---------- 가격·시간 눈금 표시 ----------
  // 수평선류는 가격을, 수직선류는 시간을 늘 표시하고, 선택한 도형은 모든 점의 가격·시간을 표시한다.
  #axisViews(axis) {
    if (this.hidden || !this.series || !this.getBars().length) return [];
    const views = [];
    const add = (coordinate, text, color) => views.push({
      coordinate: () => coordinate, text: () => text, textColor: () => '#ffffff', backColor: () => color, visible: () => true, tickVisible: () => true,
    });
    for (const d of this.drawings) {
      if (!this.#visible(d)) continue;
      const always = axis === 'price' ? PRICE_LABEL.includes(d.type) : TIME_LABEL.includes(d.type);
      const pts = this.selection.has(d.id) && !['brush', 'highlighter'].includes(d.type) ? d.points : always ? d.points.slice(0, 1) : [];
      for (const pt of pts) {
        const px = this.#toPixel(pt);
        if (!px) continue;
        if (axis === 'price') add(px.y, this.formatPrice(pt.price), d.color);
        else add(px.x, this.formatTime(pt.time), d.color);
      }
    }
    // 휴대폰 십자선: 점이 찍힐 가격·시간 (자석 적용)
    const cur = this.#touchCursorPoint();
    if (cur) add(axis === 'price' ? cur.px.y : cur.px.x, axis === 'price' ? this.formatPrice(cur.pt.price) : this.formatTime(cur.pt.time), CROSSHAIR_LABEL);
    return views;
  }

  // ---------- 그리기 ----------
  #draw(ctx, size) {
    if (!this.series || !this.getBars().length) return;
    const items = this.hidden ? [] : this.drawings.filter((d) => this.#visible(d));
    if (this.draft) {
      const pts = this.hover && !this.freehand ? [...this.draft.points, this.hover] : this.draft.points;
      items.push({ ...this.draft, points: pts, draft: true });
    }
    if (this.quick) {
      const pts = this.quick.fixed ? this.quick.points : [this.quick.points[0], this.quick.hover ?? this.quick.points[0]];
      items.push({ id: 'quick', type: 'measure', points: pts, color: DEFAULT_COLORS.measure, quick: true });
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const d of items) {
      const px = d.points.map((p) => this.#toPixel(p));
      if (px.some((p) => !p)) continue;
      const hovered = d.id === this.hoverId && !d.draft;
      ctx.strokeStyle = ctx.fillStyle = d.color;
      ctx.lineWidth = (d.width ?? 2) + (hovered && d.type !== 'highlighter' ? 1 : 0);
      ctx.setLineDash(LINE_STYLES[d.lineStyle] ?? []);
      this.#shape(ctx, d, px, size);
      if (!d.quick && (this.selection.has(d.id) || hovered || (d.draft && !this.freehand))) this.#handles(ctx, d, px);
    }
    if (this.touchCursor) this.#touchCursor(ctx, size);
    ctx.restore();
  }

  // 십자선이 실제로 점을 찍을 자리 (봉 가운데·자석에 맞춘 위치)
  #touchCursorPoint() {
    if (!this.touchCursor || !this.series) return null;
    const pt = this.#fromPixel(this.touchCursor);
    const px = pt && this.#toPixel(pt);
    return px ? { pt, px } : null;
  }

  #touchCursor(ctx, size) {
    const { x, y } = this.#touchCursorPoint()?.px ?? this.touchCursor;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(149, 152, 161, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(size.width, y);
    ctx.moveTo(x, 0); ctx.lineTo(x, size.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2962ff';
    ctx.fillStyle = 'rgba(41, 98, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  #shape(ctx, d, px, size) {
    const [a, b, c] = px;
    const line = (p, q) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
    const poly = (pts, close = false) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (close) ctx.closePath();
    };
    const fillAlpha = (alpha, draw) => { ctx.save(); ctx.globalAlpha = alpha; draw(); ctx.restore(); };
    // tip 쪽에 화살촉 (from -> tip 방향)
    const arrowHead = (tip, from, len = 6 + ctx.lineWidth * 2) => {
      const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tip.x - len * Math.cos(ang - 0.45), tip.y - len * Math.sin(ang - 0.45));
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(tip.x - len * Math.cos(ang + 0.45), tip.y - len * Math.sin(ang + 0.45));
      ctx.stroke();
      ctx.restore();
    };
    // 글자 (bg를 주면 둥근 상자 안에 흰 글자, 여러 줄 가능)
    const label = (text, x, y, align = 'left', bg = null) => {
      ctx.save();
      ctx.setLineDash([]);
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      if (bg) {
        const lines = String(text).split('\n');
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14, h = lines.length * 16 + 6;
        const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(left, y - h / 2, w, h, 3);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        lines.forEach((l, i) => ctx.fillText(l, left + w / 2, y - h / 2 + 11 + i * 16));
      } else {
        ctx.textAlign = align;
        ctx.fillText(text, x, y);
      }
      ctx.restore();
    };

    switch (d.type) {
      case 'trend': case 'ray': {
        if (!b) break;
        const right = d.extendRight ?? d.type === 'ray', left = d.extendLeft;
        line(left ? extendTo(b, a, size.width) : a, right ? extendTo(a, b, size.width) : b);
        if (d.arrowLeft) arrowHead(a, b);
        if (d.arrowRight) arrowHead(b, a);
        if (d.angleArc) {
          // 추세 각도: 시작점에서 수평 기준선과 각도 호
          const r = 40, ang = Math.atan2(b.y - a.y, b.x - a.x);
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          line(a, { x: a.x + r + 20, y: a.y });
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(a.x, a.y, r, Math.min(0, ang), Math.max(0, ang));
          ctx.stroke();
          ctx.restore();
        }
        if (d.text) {
          ctx.save();
          ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
          let ang = Math.atan2(b.y - a.y, b.x - a.x);
          if (Math.abs(ang) > Math.PI / 2) ang += Math.PI;
          ctx.rotate(ang);
          ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(d.text, 0, -5);
          ctx.restore();
        }
        if (d.stats?.length && d.points.length >= 2) {
          const [q1, q2] = d.points;
          const diff = q2.price - q1.price;
          const nBars = Math.round(this.#timeToLogical(q2.time) - this.#timeToLogical(q1.time));
          const angle = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
          const parts = [];
          if (d.stats.includes('price')) parts.push(`${diff >= 0 ? '+' : ''}${this.formatPrice(diff)} (${diff >= 0 ? '+' : ''}${((diff / q1.price) * 100).toFixed(2)}%)`);
          if (d.stats.includes('bars')) parts.push(`${nBars}봉, ${formatDuration(Math.abs(q2.time - q1.time))}`);
          if (d.stats.includes('angle')) parts.push(`${angle.toFixed(2)}°`);
          if (parts.length) label(parts.join('\n'), b.x + 10, b.y + (b.y >= a.y ? 24 : -24), 'left', 'rgba(54, 58, 69, 0.92)');
        }
        break;
      }
      case 'arrow':
        if (!b) break;
        line(a, b);
        arrowHead(b, a, 10 + ctx.lineWidth * 2);
        break;
      case 'hline':
        line({ x: 0, y: a.y }, { x: size.width, y: a.y });
        break;
      case 'hray':
        line(a, { x: size.width, y: a.y });
        break;
      case 'vline':
        line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        break;
      case 'crossline':
        line({ x: 0, y: a.y }, { x: size.width, y: a.y });
        line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        break;
      case 'channel': {
        if (!b) break;
        line(a, b);
        if (!c) break;
        const off = c.y - this.#lineYAt(a, b, c.x);
        const a2 = { x: a.x, y: a.y + off }, b2 = { x: b.x, y: b.y + off };
        line(a2, b2);
        fillAlpha(0.12, () => { poly([a, b, b2, a2], true); ctx.fill(); });
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        line({ x: a.x, y: a.y + off / 2 }, { x: b.x, y: b.y + off / 2 });
        ctx.restore();
        break;
      }
      case 'regression': {
        if (!b) break;
        const g = this.#regressionPx(d);
        if (!g) { line(a, b); break; }
        line(...g.mid);
        ctx.save();
        ctx.setLineDash([6, 4]);
        line(...g.up);
        line(...g.down);
        ctx.restore();
        fillAlpha(0.1, () => { poly([g.up[0], g.up[1], g.down[1], g.down[0]], true); ctx.fill(); });
        break;
      }
      case 'fib': case 'fibext': {
        if (!b || (d.type === 'fibext' && !c)) {
          if (b) { ctx.save(); ctx.setLineDash([4, 4]); line(a, b); ctx.restore(); }
          break;
        }
        const levels = this.#fibLevels(d);
        const x1 = d.type === 'fib' ? Math.min(a.x, b.x) : c.x;
        const x2 = d.extendRight ? size.width : d.type === 'fib' ? Math.max(a.x, b.x) : c.x + Math.max(40, Math.abs(b.x - a.x));
        const left = d.extendLeft ? 0 : x1;
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        let prev = null;
        for (const l of levels) {
          if (l.y == null) continue;
          if (prev) { ctx.fillStyle = l.color; fillAlpha(0.12, () => ctx.fillRect(left, prev.y, x2 - left, l.y - prev.y)); }
          ctx.strokeStyle = ctx.fillStyle = l.color;
          line({ x: left, y: l.y }, { x: x2, y: l.y });
          label(`${l.level} (${this.formatPrice(l.price)})`, left - 6, l.y, 'right');
          prev = l;
        }
        ctx.restore();
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        line(a, b);
        if (c) line(b, c);
        ctx.restore();
        break;
      }
      case 'fibtime': {
        if (!b) break;
        ctx.save();
        ctx.lineWidth = 1;
        this.#fibTimeXs(d).forEach((x, i) => {
          ctx.strokeStyle = ctx.fillStyle = FIB_LEVELS[i % FIB_LEVELS.length][1];
          line({ x, y: 0 }, { x, y: size.height });
          label(String(FIB_TIME[i]), x + 4, 12);
        });
        ctx.restore();
        break;
      }
      case 'long': case 'short': {
        if (!b || !c) break;
        const [entry, target, stop] = d.points;
        const x1 = Math.min(a.x, b.x), w = Math.max(Math.abs(b.x - a.x), 2);
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(8, 153, 129, 0.25)';
        ctx.fillRect(x1, Math.min(a.y, b.y), w, Math.abs(b.y - a.y));
        ctx.fillStyle = 'rgba(242, 54, 69, 0.25)';
        ctx.fillRect(x1, Math.min(a.y, c.y), w, Math.abs(c.y - a.y));
        ctx.strokeStyle = '#787b86';
        ctx.lineWidth = 1;
        line({ x: x1, y: a.y }, { x: x1 + w, y: a.y });
        ctx.restore();
        const pct = (p) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
        const gain = ((target.price - entry.price) / entry.price) * 100, loss = ((stop.price - entry.price) / entry.price) * 100;
        const rr = Math.abs(stop.price - entry.price) ? Math.abs(target.price - entry.price) / Math.abs(stop.price - entry.price) : 0;
        const cx = x1 + w / 2;
        const off = (y) => (y < a.y ? y - 16 : y + 16);
        label(`목표: ${this.formatPrice(target.price)} (${pct(gain)})`, cx, off(b.y), 'center', '#089981');
        label(`손절: ${this.formatPrice(stop.price)} (${pct(loss)})`, cx, off(c.y), 'center', '#f23645');
        label(`${d.type === 'long' ? '롱' : '숏'} ${this.formatPrice(entry.price)} · 손익비 ${rr.toFixed(2)}`, cx, a.y, 'center', '#363a45');
        break;
      }
      case 'measure': case 'daterange': case 'pricerange': {
        if (!b) break;
        const [p1, p2] = d.points;
        const diff = p2.price - p1.price;
        const up = diff >= 0;
        const color = d.type === 'measure' ? (up ? '#089981' : '#f23645') : d.color;
        const nBars = Math.round(this.#timeToLogical(p2.time) - this.#timeToLogical(p1.time));
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        if (d.type === 'daterange') {
          fillAlpha(0.15, () => ctx.fillRect(Math.min(a.x, b.x), 0, Math.abs(b.x - a.x), size.height));
          line({ x: a.x, y: midY }, { x: b.x, y: midY });
          arrowHead({ x: b.x, y: midY }, { x: a.x, y: midY }, 8);
        } else if (d.type === 'pricerange') {
          fillAlpha(0.15, () => ctx.fillRect(0, Math.min(a.y, b.y), size.width, Math.abs(b.y - a.y)));
          line({ x: midX, y: a.y }, { x: midX, y: b.y });
          arrowHead({ x: midX, y: b.y }, { x: midX, y: a.y }, 8);
        } else {
          fillAlpha(0.15, () => ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y));
          line({ x: midX, y: a.y }, { x: midX, y: b.y });
          line({ x: a.x, y: midY }, { x: b.x, y: midY });
          arrowHead({ x: midX, y: b.y }, { x: midX, y: a.y }, 8);
          arrowHead({ x: b.x, y: midY }, { x: a.x, y: midY }, 8);
        }
        ctx.restore();
        const priceText = `${up ? '+' : ''}${this.formatPrice(diff)} (${up ? '+' : ''}${((diff / p1.price) * 100).toFixed(2)}%)`;
        const t1 = Math.min(p1.time, p2.time), t2 = Math.max(p1.time, p2.time);
        const vol = this.getBars().reduce((s, bar) => (bar.time >= t1 && bar.time <= t2 ? s + bar.volume : s), 0);
        const volText = `거래량 ${this.formatVolume ? this.formatVolume(vol) : Math.round(vol)}`;
        const dateText = `${nBars}봉, ${formatDuration(t2 - t1)}`;
        const text = d.type === 'pricerange' ? priceText : d.type === 'daterange' ? `${dateText}\n${volText}` : `${priceText}\n${dateText}\n${volText}`;
        const ly = d.type === 'daterange' ? midY + 32 : up ? Math.min(a.y, b.y) - 34 : Math.max(a.y, b.y) + 34;
        label(text, midX, ly, 'center', color);
        break;
      }
      case 'rect':
        if (!b) break;
        fillAlpha(0.15, () => ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y));
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        break;
      case 'circle':
        if (!b) break;
        ctx.beginPath();
        ctx.arc(a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y), 0, Math.PI * 2);
        fillAlpha(0.15, () => ctx.fill());
        ctx.stroke();
        break;
      case 'ellipse':
        if (!b) break;
        ctx.beginPath();
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        fillAlpha(0.15, () => ctx.fill());
        ctx.stroke();
        break;
      case 'triangle': case 'polyline':
        if (px.length < 2) break;
        poly(px, px.length > 2 && !d.draft);
        if (px.length > 2) fillAlpha(0.15, () => ctx.fill());
        ctx.stroke();
        break;
      case 'path':
        if (px.length < 2) break;
        poly(px);
        ctx.stroke();
        arrowHead(px.at(-1), px.at(-2), 10 + ctx.lineWidth * 2);
        break;
      case 'brush':
        poly(px);
        ctx.stroke();
        break;
      case 'highlighter':
        fillAlpha(0.35, () => { poly(px); ctx.stroke(); });
        break;
      case 'arrowup': case 'arrowdown': {
        // 위 화살표는 점 아래에서 위를, 아래 화살표는 점 위에서 아래를 가리킨다
        const dir = d.type === 'arrowup' ? 1 : -1;
        const tipY = a.y + dir * 4, neckY = tipY + dir * 12, baseY = a.y + dir * 30;
        ctx.save();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(a.x, tipY);
        ctx.lineTo(a.x + 11, neckY);
        ctx.lineTo(a.x + 4, neckY);
        ctx.lineTo(a.x + 4, baseY);
        ctx.lineTo(a.x - 4, baseY);
        ctx.lineTo(a.x - 4, neckY);
        ctx.lineTo(a.x - 11, neckY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (d.text) label(d.text, a.x, baseY + dir * 12, 'center');
        break;
      }
      case 'pricelabel': {
        const text = this.formatPrice(d.points[0].price);
        ctx.save();
        ctx.setLineDash([]);
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const w = ctx.measureText(text).width + 14, h = 22, top = a.y - h - 10;
        ctx.beginPath();
        ctx.roundRect(a.x - w / 2, top, w, h, 4);
        ctx.moveTo(a.x - 5, top + h);
        ctx.lineTo(a.x, a.y - 2);
        ctx.lineTo(a.x + 5, top + h);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, a.x, top + h / 2);
        ctx.restore();
        this.boxes.set(d.id, { x: a.x - w / 2, y: top, w, h: h + 10 });
        break;
      }
      case 'text': {
        const fs = d.fontSize ?? 14, lh = Math.round(fs * 1.3);
        const lines = (d.text || ' ').split('\n');
        ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const w = Math.max(20, ...lines.map((l) => ctx.measureText(l).width));
        if (!d.editing) lines.forEach((l, i) => ctx.fillText(l, a.x, a.y + i * lh));
        this.boxes.set(d.id, { x: a.x, y: a.y, w, h: lines.length * lh });
        if (!d.editing && (this.selection.has(d.id) || d.id === this.hoverId)) {
          ctx.save();
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(a.x - 4, a.y - 4, w + 8, lines.length * lh + 8);
          ctx.restore();
        }
        break;
      }
    }
  }

  // 손잡이: 차트 배경색으로 채운 원에 도형 색 테두리
  #handles(ctx, d, px) {
    if (NO_HANDLES.includes(d.type) && !d.draft) return;
    if (d.type === 'brush' || d.type === 'highlighter') return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    for (const p of px) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = this.handleFill;
      ctx.fill();
      ctx.strokeStyle = d.color === '#000000' ? '#2962ff' : d.color;
      ctx.stroke();
    }
    ctx.restore();
  }
}
