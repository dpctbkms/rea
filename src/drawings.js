// 그리기 도구. 모든 도형을 가격 시리즈에 붙인 레이어 하나(시리즈 프리미티브)에 그린다.
// 점은 {time, price}로 저장해서 타임프레임을 바꿔도 같은 자리에 남는다.

export const TOOLS = [
  { id: 'cursor', label: '선택·이동', points: 0 },
  { id: 'trend', label: '추세선', points: 2, key: 'T' },
  { id: 'ray', label: '연장선', points: 2 },
  { id: 'hline', label: '수평선', points: 1, key: 'H' },
  { id: 'hray', label: '수평 광선', points: 1, key: 'J' },
  { id: 'vline', label: '수직선', points: 1, key: 'V' },
  { id: 'crossline', label: '십자선', points: 1, key: 'C' },
  { id: 'channel', label: '평행 채널', points: 3 },
  { id: 'fib', label: '피보나치 되돌림', points: 2, key: 'F' },
  { id: 'rect', label: '사각형', points: 2, key: 'Shift+R' },
  { id: 'ellipse', label: '타원', points: 2 },
  { id: 'text', label: '텍스트', points: 1 },
  { id: 'long', label: '롱 포지션', points: 2 },
  { id: 'short', label: '숏 포지션', points: 2 },
  { id: 'measure', label: '가격·기간 측정', points: 2 },
];

// 손잡이 없이 몸통만 끄는 도형
const NO_HANDLES = ['hline', 'vline', 'crossline', 'text'];

export const COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#787b86', '#00bcd4', '#e91e63', '#ffeb3b', '#ffffff', '#4caf50', '#000000'];
export const LINE_STYLES = { solid: [], dashed: [8, 5], dotted: [2, 4] };

// Shift를 누르고 그리면 각도를 45° 단위로 맞추는 도형 / 정사각형·원으로 맞추는 도형
const ANGLE_SNAP = ['trend', 'ray', 'channel', 'fib', 'measure'];
const SQUARE_SNAP = ['rect', 'ellipse'];

// 타임프레임 묶음 (도형마다 어느 묶음에서 보일지 정할 수 있다)
export const VISIBILITY_GROUPS = [
  { id: 'min', label: '분', test: (s) => s < 3600 },
  { id: 'hour', label: '시간', test: (s) => s >= 3600 && s < 86400 },
  { id: 'day', label: '일', test: (s) => s >= 86400 && s < 604800 },
  { id: 'week', label: '주', test: (s) => s >= 604800 },
];

// 수평선처럼 가격 눈금에 가격을, 수직선처럼 시간 눈금에 시간을 늘 표시하는 도형
const PRICE_LABEL = ['hline', 'hray', 'crossline'];
const TIME_LABEL = ['vline', 'crossline'];
const DRAG_MIN_PX = 6; // 이만큼 끌었으면 "끌어서 그리기"로 본다

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#2196f3', '#787b86'];
const HISTORY_LIMIT = 50;
const MAGNET_PX = 30; // 약한 자석: 이 거리 안이면 붙인다

const toolPoints = (type) => TOOLS.find((t) => t.id === type).points;
const uid = () => Math.random().toString(36).slice(2, 10);

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// 두 점을 지나는 선을 화면 오른쪽(또는 왼쪽) 끝까지 늘린 끝점.
function extendTo(a, b, width) {
  if (b.x === a.x) return { x: b.x, y: b.y > a.y ? 1e6 : -1e6 };
  const edge = b.x > a.x ? width : 0;
  return { x: edge, y: a.y + ((b.y - a.y) * (edge - a.x)) / (b.x - a.x) };
}

export class DrawingManager {
  constructor({ chart, getBars, getStep, formatPrice, formatTime, onChange, onSelect, onToolChange, onTextCreated }) {
    Object.assign(this, { chart, getBars, getStep, formatPrice, formatTime, onChange, onSelect, onToolChange, onTextCreated });
    this.drawings = [];
    this.tool = 'cursor';
    this.magnet = 'off'; // off | weak | strong
    this.selectedId = null; // 마지막으로 고른 도형 (떠 있는 막대·설정 창 대상)
    this.selection = new Set(); // 함께 선택된 도형들 (Ctrl+클릭)
    this.locked = false; // 잠금: 도형을 옮기거나 바꿀 수 없음
    this.hidden = false; // 숨기기: 도형을 그리지 않음
    this.stay = false; // 드로잉 모드 유지: 다 그려도 같은 도구로 남는다
    this.draft = null; // 그리는 중인 도형
    this.hover = null; // 그리는 중 마우스 위치 (미리보기)
    this.hoverId = null; // 마우스가 올라가 있는 도형 (강조 표시)
    this.press = null; // 그리는 중 누른 위치 (끌어서 그리기 판정)
    this.clipboard = null;
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.textBoxes = new Map(); // 텍스트 도형의 화면상 영역 (클릭 판정용)
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
    if (tool !== 'cursor') this.select(null);
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

  // Ctrl+클릭: 선택에 넣거나 뺀다
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

  clear() {
    if (!this.drawings.length) return;
    this.#snapshot();
    this.drawings = [];
    this.select(null);
    this.#commit();
  }

  // 모양(색·두께 등)은 선택된 모든 도형에, 좌표·글자는 마지막으로 고른 도형에만 적용
  updateSelected(patch, onlyPrimary = false) {
    if (!this.selected) return;
    this.#snapshot();
    for (const d of onlyPrimary ? [this.selected] : this.selectedAll) Object.assign(d, structuredClone(patch));
    this.onSelect(this.selected);
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

  // 좌표 직접 입력용
  pointToPixel(pt) { return this.#toPixel(pt); }

  // 같은 자리에서 조금 옮긴 복사본
  #copyOf(d, shiftBars = 0) {
    const dt = shiftBars * this.getStep();
    return { ...structuredClone(d), id: uid(), locked: false, points: d.points.map((p) => ({ time: p.time + dt, price: p.price })) };
  }

  duplicateSelected() { if (this.selected) this.#add(this.#copyOf(this.selected, 5)); }
  copySelected() { if (this.selected) this.clipboard = structuredClone(this.selected); }
  paste() { if (this.clipboard) this.#add(this.#copyOf(this.clipboard, 5)); }

  // 마우스 아래의 도형 (손잡이 위면 'handle'도 돌려줘서 커서 모양을 바꾼다)
  setHover(point, touch) {
    const hit = this.tool === 'cursor' && point ? this.hitTest(point, touch ? 14 : 7) : null;
    const id = hit?.drawing.id ?? null;
    if (id !== this.hoverId) { this.hoverId = id; this.update(); }
    return hit;
  }

  // ---------- 좌표 변환 ----------
  // 시간 <-> 논리 인덱스. 데이터 밖(미래·과거)은 봉 간격으로 늘려서 계산한다.
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

  // 화면 좌표 -> 점. 가로는 봉 가운데에 맞추고, 자석이 켜져 있으면 가까운 시가·고가·저가·종가에 붙인다.
  // 자석 모드. Ctrl(⌘)을 누르고 있는 동안은 잠깐 반대로 (꺼져 있으면 켜고, 켜져 있으면 끈다).
  #magnetMode(invert) {
    if (!invert) return this.magnet;
    return this.magnet === 'off' ? 'weak' : 'off';
  }

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
      // 약한 자석은 가까울 때만, 강한 자석은 항상 붙인다
      if (mode === 'strong' || nearest.dy <= MAGNET_PX) point.price = nearest.p;
    }
    return point;
  }

  // 채널: 기준선(p1-p2) 위 시간 t에서의 가격
  #linePriceAt(p1, p2, time) {
    if (p2.time === p1.time) return p1.price;
    return p1.price + ((p2.price - p1.price) * (time - p1.time)) / (p2.time - p1.time);
  }

  // ---------- 입력 ----------
  // 커서 모드에서 누르면 선택, 그리기 모드에서는 점 하나를 찍는다.
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

  // 트레이딩뷰처럼 두 가지로 그린다: 점마다 클릭하거나, 누른 채 끌었다가 떼기.
  pressDraw(point, keys = {}) {
    this.press = point;
    this.#addPoint(point, keys);
  }

  releaseDraw(point, keys = {}) {
    const start = this.press;
    this.press = null;
    if (!start || !this.draft || !point) return;
    if (Math.hypot(point.x - start.x, point.y - start.y) >= DRAG_MIN_PX) this.#addPoint(point, keys);
  }

  #addPoint(point, keys) {
    const pt = this.#constrain(this.#fromPixel(point, true, keys.ctrl), keys.shift);
    if (!pt) return;
    // 같은 자리를 두 번 누른 경우(더블클릭 등)는 무시한다.
    const prev = this.draft?.points.at(-1);
    const prevPx = prev && this.#toPixel(prev);
    const ptPx = this.#toPixel(pt);
    if (prevPx && ptPx && Math.hypot(prevPx.x - ptPx.x, prevPx.y - ptPx.y) < 4) return;
    this.draft ??= { id: uid(), type: this.tool, points: [], color: COLORS[0], width: 2, lineStyle: 'solid' };
    this.draft.points.push(pt);
    if (this.draft.points.length < toolPoints(this.tool)) return this.update();
    this.#finishDraft();
  }

  // Shift: 직전 점에서 45° 단위 방향으로 (추세선 등), 정사각형·원으로 (사각형·타원). 화면 기준.
  #constrain(pt, shift) {
    const anchor = this.draft?.points.at(-1);
    if (!pt || !shift || !anchor) return pt;
    const a = this.#toPixel(anchor), p = this.#toPixel(pt);
    if (!a || !p) return pt;
    if (SQUARE_SNAP.includes(this.tool)) {
      const side = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
      return this.#fromPixel({ x: a.x + Math.sign(p.x - a.x || 1) * side, y: a.y + Math.sign(p.y - a.y || 1) * side }, false) ?? pt;
    }
    if (!ANGLE_SNAP.includes(this.tool)) return pt;
    const len = Math.hypot(p.x - a.x, p.y - a.y);
    const angle = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
    const snapped = this.#fromPixel({ x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) });
    if (snapped && Math.abs(Math.sin(angle)) < 1e-9) snapped.price = anchor.price; // 수평이면 가격을 정확히 같게
    return snapped ?? pt;
  }

  #finishDraft() {
    const drawing = this.draft;
    this.draft = null;
    this.hover = null;
    if (drawing.type === 'text') {
      // 트레이딩뷰처럼 놓자마자 글자 편집 창을 연다 (빈 채로 닫으면 기본 글자가 남는다)
      drawing.text = '텍스트';
      drawing.fontSize = 14;
    }
    if (drawing.type === 'ray') drawing.extendRight = true;
    if (drawing.type === 'measure') drawing.color = COLORS[2];
    if (drawing.type === 'long' || drawing.type === 'short') {
      const [entry, target] = drawing.points;
      // 목표가가 반대쪽에 찍혔으면 방향에 맞게 뒤집고, 손절가는 목표와 같은 거리로 둔다.
      const dir = drawing.type === 'long' ? 1 : -1;
      const reward = Math.abs(target.price - entry.price) * dir;
      target.price = entry.price + reward;
      drawing.points.push({ time: target.time, price: entry.price - reward });
    }
    if (this.stay) {
      // 드로잉 모드 유지: 같은 도구로 바로 다음 도형을 그린다
      this.#snapshot();
      this.drawings.push(drawing);
      this.#commit();
      return;
    }
    this.setTool('cursor');
    this.#add(drawing);
    if (drawing.type === 'text') this.onTextCreated?.(drawing);
  }

  cancelDraft() {
    if (!this.draft) return false;
    this.draft = null;
    this.hover = null;
    this.press = null;
    this.update();
    return true;
  }

  handleMove(point, keys = {}) {
    if (!this.draft || !point) return;
    this.hover = this.#constrain(this.#fromPixel(point, true, keys.ctrl), keys.shift);
    this.update();
  }

  // 드래그 시작. 도형(또는 손잡이)을 잡았으면 true를 돌려준다 — 그러면 차트 이동을 막는다.
  // clone: Ctrl(⌘)을 누른 채 끌면 복사본을 끌어 놓는다.
  // Ctrl을 누른 채 몸통을 끌면 복사본을 끌어 놓고, 끌지 않고 떼면 (탭 처리에서) 선택에 넣거나 뺀다.
  beginDrag(point, touch, ctrl = false) {
    if (this.tool !== 'cursor' || this.locked || this.hidden) return false;
    const hit = this.hitTest(point, touch ? 14 : 7);
    if (!hit) return false;
    if (!ctrl && !this.selection.has(hit.drawing.id)) this.select(hit.drawing.id);
    if (hit.drawing.locked) return false; // 잠긴 도형은 고르기만 되고 움직이지 않는다
    // 몸통을 끌면 함께 선택된 도형도 같이 움직인다
    const group = hit.handle == null && this.selection.has(hit.drawing.id) ? this.selectedAll.filter((d) => !d.locked) : [hit.drawing];
    this.drag = {
      hit, startPx: point, start: this.#fromPixel(point, false),
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
    const now = this.#fromPixel(point, hit.handle != null, hit.handle != null && keys.ctrl);
    if (!now || !start) return;
    if (!this.drag.moved) {
      this.#snapshot();
      this.drag.moved = true;
      if (this.drag.cloneOnMove) {
        // 처음 움직일 때 복사본을 만들어 그것을 끈다 (원본은 그 자리에)
        const copy = this.#copyOf(hit.drawing);
        this.drawings.push(copy);
        this.select(copy.id);
        this.drag.hit = { drawing: copy, handle: null };
        this.drag.originals = new Map([[copy.id, structuredClone(copy.points)]]);
      }
    }
    const shift = keys.shift;
    if (hit.handle != null) {
      const d = this.drag.hit.drawing;
      d.points[hit.handle] = now;
      if (shift && ANGLE_SNAP.includes(d.type) && d.points.length >= 2) {
        // 손잡이를 Shift와 함께 끌면 반대쪽 점 기준으로 45° 단위
        const other = d.points[hit.handle === 0 ? 1 : 0];
        const a = this.#toPixel(other), p = this.#toPixel(now);
        if (a && p) {
          const len = Math.hypot(p.x - a.x, p.y - a.y);
          const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
          const snapped = this.#fromPixel({ x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) });
          if (snapped) d.points[hit.handle] = Math.abs(Math.sin(ang)) < 1e-9 ? { ...snapped, price: other.price } : snapped;
        }
      }
      // 포지션 도구: 목표·손절 손잡이는 같은 오른쪽 끝을 쓴다
      if ((d.type === 'long' || d.type === 'short') && hit.handle > 0) {
        d.points[1].time = d.points[2].time = now.time;
      }
    } else {
      const dt = now.time - start.time, dp = now.price - start.price;
      for (const d of this.drawings) {
        const orig = this.drag.originals.get(d.id);
        if (orig) d.points = orig.map((p) => ({ time: p.time + dt, price: p.price + dp }));
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
    const [a, b, c] = px;
    switch (d.type) {
      case 'hline': return a && Math.abs(p.y - a.y) <= tol;
      case 'hray': return a && p.x >= a.x - tol && Math.abs(p.y - a.y) <= tol;
      case 'crossline': return a && (Math.abs(p.y - a.y) <= tol || Math.abs(p.x - a.x) <= tol);
      case 'ellipse': {
        if (!a || !b) return false;
        const rx = Math.abs(b.x - a.x) / 2 + tol, ry = Math.abs(b.y - a.y) / 2 + tol;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
      }
      case 'long': case 'short': {
        if (!a || !b || !c) return false;
        const [y1, y2] = [Math.min(b.y, c.y), Math.max(b.y, c.y)];
        return p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol && p.y >= y1 - tol && p.y <= y2 + tol;
      }
      case 'vline': return a && Math.abs(p.x - a.x) <= tol;
      case 'trend': case 'ray': {
        if (!a || !b) return false;
        const right = d.extendRight ?? d.type === 'ray', left = d.extendLeft;
        return distToSegment(p, left ? extendTo(b, a, width) : a, right ? extendTo(a, b, width) : b) <= tol;
      }
      case 'channel': {
        if (!a || !b || !c) return false;
        const off = c.y - this.#lineYAt(a, b, c.x);
        return distToSegment(p, a, b) <= tol || distToSegment(p, { x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }) <= tol;
      }
      case 'rect': case 'fib': case 'measure': {
        if (!a || !b) return false;
        const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        return p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
      }
      case 'text': {
        const box = this.textBoxes.get(d.id);
        return box && p.x >= box.x - tol && p.x <= box.x + box.w + tol && p.y >= box.y - tol && p.y <= box.y + box.h + tol;
      }
      default: return false;
    }
  }

  #lineYAt(a, b, x) {
    return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
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
      const pts = this.selection.has(d.id) ? d.points : always ? d.points.slice(0, 1) : [];
      for (const pt of pts) {
        const px = this.#toPixel(pt);
        if (!px) continue;
        if (axis === 'price') add(px.y, this.formatPrice(pt.price), d.color);
        else add(px.x, this.formatTime(pt.time), d.color);
      }
    }
    return views;
  }

  // ---------- 그리기 ----------
  #draw(ctx, size) {
    if (!this.series || !this.getBars().length) return;
    const items = this.hidden ? [] : this.drawings.filter((d) => this.#visible(d));
    if (this.draft && this.hover) items.push({ ...this.draft, points: [...this.draft.points, this.hover], draft: true });
    else if (this.draft) items.push({ ...this.draft, draft: true });
    ctx.save();
    ctx.lineCap = 'round';
    for (const d of items) {
      const px = d.points.map((p) => this.#toPixel(p));
      if (px.some((p) => !p)) continue;
      const hovered = d.id === this.hoverId && !d.draft;
      ctx.strokeStyle = ctx.fillStyle = d.color;
      ctx.lineWidth = (d.width ?? 2) + (hovered ? 1 : 0);
      ctx.setLineDash(LINE_STYLES[d.lineStyle] ?? []);
      this.#shape(ctx, d, px, size);
      if (this.selection.has(d.id) || d.draft || hovered) this.#handles(ctx, d, px);
    }
    ctx.restore();
  }

  #shape(ctx, d, px, size) {
    const [a, b, c] = px;
    const line = (p, q) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
    // tip 쪽에 화살촉 (from -> tip 방향)
    const arrowHead = (tip, from) => {
      const ang = Math.atan2(tip.y - from.y, tip.x - from.x), len = 6 + ctx.lineWidth * 2;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tip.x - len * Math.cos(ang - 0.45), tip.y - len * Math.sin(ang - 0.45));
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(tip.x - len * Math.cos(ang + 0.45), tip.y - len * Math.sin(ang + 0.45));
      ctx.stroke();
      ctx.restore();
    };
    const label = (text, x, y, align = 'left', bg = null) => {
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      if (bg) {
        const w = ctx.measureText(text).width + 10;
        const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        ctx.save();
        ctx.fillStyle = bg;
        ctx.fillRect(left, y - 10, w, 20);
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, align === 'right' ? x - 5 : align === 'center' ? x : x + 5, y);
        ctx.restore();
      } else {
        ctx.fillText(text, x, y);
      }
    };

    switch (d.type) {
      case 'trend': case 'ray': {
        if (!b) break;
        const right = d.extendRight ?? d.type === 'ray', left = d.extendLeft;
        const p1 = left ? extendTo(b, a, size.width) : a, p2 = right ? extendTo(a, b, size.width) : b;
        line(p1, p2);
        if (d.arrowLeft) arrowHead(a, b);
        if (d.arrowRight) arrowHead(b, a);
        if (d.text) {
          // 선 가운데, 선 기울기를 따라 글자
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
        if (d.stats && d.points.length === 2) {
          const [q1, q2] = d.points;
          const diff = q2.price - q1.price;
          const nBars = Math.round(this.#timeToLogical(q2.time) - this.#timeToLogical(q1.time));
          const angle = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
          const parts = [];
          if (d.stats.includes('price')) parts.push(`${diff >= 0 ? '+' : ''}${this.formatPrice(diff)} (${diff >= 0 ? '+' : ''}${((diff / q1.price) * 100).toFixed(2)}%)`);
          if (d.stats.includes('bars')) parts.push(`${nBars}봉, ${formatDuration(Math.abs(q2.time - q1.time))}`);
          if (d.stats.includes('angle')) parts.push(`${angle.toFixed(1)}°`);
          if (parts.length) label(parts.join(' · '), b.x + 8, b.y + (b.y >= a.y ? 14 : -14), 'left', '#363a45');
        }
        break;
      }
      case 'hline':
        line({ x: 0, y: a.y }, { x: size.width, y: a.y });
        break;
      case 'vline':
        line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        break;
      case 'hray':
        line(a, { x: size.width, y: a.y });
        break;
      case 'crossline':
        line({ x: 0, y: a.y }, { x: size.width, y: a.y });
        line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        break;
      case 'ellipse': {
        if (!b) break;
        ctx.beginPath();
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.restore();
        ctx.stroke();
        break;
      }
      case 'long': case 'short': {
        if (!b) break;
        const [entry, target] = d.points;
        // 그리는 중에는 손절점이 아직 없어서 목표와 대칭으로 미리 보여 준다.
        const stopPrice = d.points[2]?.price ?? 2 * entry.price - target.price;
        const yStop = c?.y ?? this.series.priceToCoordinate(stopPrice);
        if (yStop == null) break;
        const x1 = Math.min(a.x, b.x), w = Math.abs(b.x - a.x);
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(8, 153, 129, 0.22)';
        ctx.fillRect(x1, Math.min(a.y, b.y), w, Math.abs(b.y - a.y));
        ctx.fillStyle = 'rgba(242, 54, 69, 0.22)';
        ctx.fillRect(x1, Math.min(a.y, yStop), w, Math.abs(yStop - a.y));
        ctx.strokeStyle = '#787b86';
        ctx.lineWidth = 1;
        line({ x: x1, y: a.y }, { x: x1 + w, y: a.y });
        ctx.restore();
        const pct = (p) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
        const gain = ((target.price - entry.price) / entry.price) * 100;
        const loss = ((stopPrice - entry.price) / entry.price) * 100;
        const rr = Math.abs(stopPrice - entry.price) ? Math.abs(target.price - entry.price) / Math.abs(stopPrice - entry.price) : 0;
        const cx = x1 + w / 2;
        const below = (y, other) => (y > other ? y + 14 : y - 14);
        label(`목표 ${this.formatPrice(target.price)} (${pct(gain)})`, cx, below(b.y, a.y), 'center', '#089981');
        label(`손절 ${this.formatPrice(stopPrice)} (${pct(loss)})`, cx, below(yStop, a.y), 'center', '#f23645');
        label(`${d.type === 'long' ? '롱' : '숏'} 진입 ${this.formatPrice(entry.price)} · 손익비 ${rr.toFixed(2)}`, cx, a.y, 'center', '#363a45');
        break;
      }
      case 'channel': {
        if (!b) break;
        line(a, b);
        if (!c) break;
        const off = c.y - this.#lineYAt(a, b, c.x);
        const a2 = { x: a.x, y: a.y + off }, b2 = { x: b.x, y: b.y + off };
        line(a2, b2);
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        line({ x: a.x, y: a.y + off / 2 }, { x: b.x, y: b.y + off / 2 });
        ctx.restore();
        break;
      }
      case 'rect': {
        if (!b) break;
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.restore();
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        break;
      }
      case 'fib': {
        if (!b) break;
        const [p1, p2] = d.points;
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        let prevY = null;
        FIB_LEVELS.forEach((level, i) => {
          const price = p2.price + (p1.price - p2.price) * level;
          const y = this.series.priceToCoordinate(price);
          if (y == null) return;
          ctx.strokeStyle = ctx.fillStyle = FIB_COLORS[i];
          if (prevY != null) {
            ctx.save();
            ctx.globalAlpha = 0.08;
            ctx.fillRect(x1, prevY, x2 - x1, y - prevY);
            ctx.restore();
          }
          line({ x: x1, y }, { x: x2, y });
          label(`${level} (${this.formatPrice(price)})`, x1 + 4, y - 8);
          prevY = y;
        });
        ctx.restore();
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        line(a, b);
        ctx.restore();
        break;
      }
      case 'measure': {
        if (!b) break;
        const [p1, p2] = d.points;
        const diff = p2.price - p1.price;
        const up = diff >= 0;
        const color = up ? '#089981' : '#f23645';
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        line({ x: midX, y: a.y }, { x: midX, y: b.y });
        line({ x: a.x, y: midY }, { x: b.x, y: midY });
        ctx.restore();
        const barsCount = Math.round(this.#timeToLogical(p2.time) - this.#timeToLogical(p1.time));
        const text = `${up ? '+' : ''}${this.formatPrice(diff)} (${up ? '+' : ''}${((diff / p1.price) * 100).toFixed(2)}%) · ${barsCount}봉 · ${formatDuration(Math.abs(p2.time - p1.time))}`;
        label(text, midX, (up ? Math.min(a.y, b.y) - 14 : Math.max(a.y, b.y) + 14), 'center', color);
        break;
      }
      case 'text': {
        const fs = d.fontSize ?? 14, lh = Math.round(fs * 1.3);
        ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const lines = (d.text ?? '').split('\n');
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
        lines.forEach((l, i) => ctx.fillText(l, a.x, a.y + i * lh));
        this.textBoxes.set(d.id, { x: a.x, y: a.y, w, h: lines.length * lh });
        if (this.selection.has(d.id) || d.id === this.hoverId) {
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

  #handles(ctx, d, px) {
    if (NO_HANDLES.includes(d.type) && !d.draft) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    for (const p of px) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = d.color;
      ctx.stroke();
    }
    ctx.restore();
  }
}

function formatDuration(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.round((sec % 3600) / 60);
  if (d) return h ? `${d}일 ${h}시간` : `${d}일`;
  if (h) return m ? `${h}시간 ${m}분` : `${h}시간`;
  return `${m}분`;
}
