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

export const COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#787b86'];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#2196f3', '#787b86'];
const HISTORY_LIMIT = 50;
const MAGNET_PX = 30;

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
  constructor({ chart, getBars, getStep, formatPrice, onChange, onSelect, onToolChange }) {
    Object.assign(this, { chart, getBars, getStep, formatPrice, onChange, onSelect, onToolChange });
    this.drawings = [];
    this.tool = 'cursor';
    this.magnet = false;
    this.selectedId = null;
    this.locked = false; // 잠금: 도형을 옮기거나 바꿀 수 없음
    this.hidden = false; // 숨기기: 도형을 그리지 않음
    this.draft = null; // 그리는 중인 도형
    this.hover = null; // 그리는 중 마우스 위치 (미리보기)
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
    this.selectedId = id;
    this.onSelect(this.selected);
    this.update();
  }

  get selected() { return this.drawings.find((d) => d.id === this.selectedId) ?? null; }

  removeSelected() {
    if (!this.selected) return;
    this.#snapshot();
    this.drawings = this.drawings.filter((d) => d.id !== this.selectedId);
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

  updateSelected(patch) {
    if (!this.selected) return;
    this.#snapshot();
    Object.assign(this.selected, patch);
    this.onSelect(this.selected);
    this.#commit();
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
  #fromPixel({ x, y }, snapX = true) {
    let logical = this.chart.timeScale().coordinateToLogical(x);
    const price = this.series.coordinateToPrice(y);
    if (logical == null || price == null || !this.getBars().length) return null;
    if (snapX) logical = Math.round(logical);
    const point = { time: this.#logicalToTime(logical), price };
    const bar = this.magnet && this.getBars()[logical];
    if (bar) {
      const nearest = [bar.open, bar.high, bar.low, bar.close]
        .map((p) => ({ p, dy: Math.abs(this.series.priceToCoordinate(p) - y) }))
        .sort((a, b) => a.dy - b.dy)[0];
      if (nearest.dy <= MAGNET_PX) point.price = nearest.p;
    }
    return point;
  }

  // 채널: 기준선(p1-p2) 위 시간 t에서의 가격
  #linePriceAt(p1, p2, time) {
    if (p2.time === p1.time) return p1.price;
    return p1.price + ((p2.price - p1.price) * (time - p1.time)) / (p2.time - p1.time);
  }

  // ---------- 입력 ----------
  handleClick(point) {
    if (!point) return;
    if (this.tool === 'cursor') {
      this.select(this.hitTest(point)?.drawing.id ?? null);
      return;
    }
    const pt = this.#fromPixel(point);
    if (!pt) return;
    // 같은 자리를 두 번 누른 경우(더블클릭 등)는 무시한다.
    const prev = this.draft?.points.at(-1);
    const prevPx = prev && this.#toPixel(prev);
    if (prevPx && Math.hypot(prevPx.x - point.x, prevPx.y - point.y) < 4) return;
    this.draft ??= { id: uid(), type: this.tool, points: [], color: COLORS[0] };
    this.draft.points.push(pt);
    if (this.draft.points.length < toolPoints(this.tool)) return this.update();

    const drawing = this.draft;
    if (drawing.type === 'text') {
      const text = window.prompt('텍스트를 입력하세요');
      if (!text?.trim()) return this.setTool('cursor');
      drawing.text = text.trim();
    }
    if (drawing.type === 'measure') drawing.color = COLORS[2];
    if (drawing.type === 'long' || drawing.type === 'short') {
      const [entry, target] = drawing.points;
      // 목표가가 반대쪽에 찍혔으면 방향에 맞게 뒤집고, 손절가는 목표와 같은 거리로 둔다.
      const dir = drawing.type === 'long' ? 1 : -1;
      const reward = Math.abs(target.price - entry.price) * dir;
      target.price = entry.price + reward;
      drawing.points.push({ time: target.time, price: entry.price - reward });
    }
    this.#snapshot();
    this.drawings.push(drawing);
    this.setTool('cursor');
    this.select(drawing.id);
    this.#commit();
  }

  handleMove(point) {
    if (!this.draft || !point) return;
    this.hover = this.#fromPixel(point);
    this.update();
  }

  // 드래그 시작. 도형(또는 손잡이)을 잡았으면 true를 돌려준다 — 그러면 차트 이동을 막는다.
  beginDrag(point, touch) {
    if (this.tool !== 'cursor' || this.locked || this.hidden) return false;
    const hit = this.hitTest(point, touch ? 14 : 7);
    if (!hit) return false;
    this.select(hit.drawing.id);
    this.drag = { hit, start: this.#fromPixel(point, false), original: structuredClone(hit.drawing.points), moved: false };
    return true;
  }

  dragTo(point) {
    if (!this.drag) return;
    const { hit, start, original } = this.drag;
    const now = this.#fromPixel(point, hit.handle != null ? true : false);
    if (!now || !start) return;
    if (!this.drag.moved) { this.#snapshot(); this.drag.moved = true; }
    if (hit.handle != null) {
      const d = hit.drawing;
      d.points[hit.handle] = now;
      // 포지션 도구: 목표·손절 손잡이는 같은 오른쪽 끝을 쓴다
      if ((d.type === 'long' || d.type === 'short') && hit.handle > 0) {
        d.points[1].time = d.points[2].time = now.time;
      }
    } else {
      const dt = now.time - start.time, dp = now.price - start.price;
      hit.drawing.points = original.map((p) => ({ time: p.time + dt, price: p.price + dp }));
    }
    this.update();
  }

  endDrag() {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.#commit();
  }

  // ---------- 클릭 판정 ----------
  hitTest(point, tolerance = 7) {
    if (this.hidden) return null;
    const width = this.chart.timeScale().width();
    // 선택된 도형의 손잡이가 가장 우선
    const sel = this.selected;
    if (sel) {
      const px = sel.points.map((p) => this.#toPixel(p));
      const handle = px.findIndex((p) => p && Math.hypot(p.x - point.x, p.y - point.y) <= tolerance + 4);
      if (handle >= 0 && !NO_HANDLES.includes(sel.type)) return { drawing: sel, handle };
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (this.#hits(d, point, tolerance, width)) return { drawing: d, handle: null };
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
      case 'trend': return a && b && distToSegment(p, a, b) <= tol;
      case 'ray': return a && b && distToSegment(p, a, extendTo(a, b, width)) <= tol;
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

  // ---------- 그리기 ----------
  #draw(ctx, size) {
    if (!this.series || !this.getBars().length) return;
    const items = this.hidden ? [] : [...this.drawings];
    if (this.draft && this.hover) items.push({ ...this.draft, points: [...this.draft.points, this.hover], draft: true });
    else if (this.draft) items.push({ ...this.draft, draft: true });
    ctx.save();
    ctx.lineCap = 'round';
    for (const d of items) {
      const px = d.points.map((p) => this.#toPixel(p));
      if (px.some((p) => !p)) continue;
      ctx.strokeStyle = ctx.fillStyle = d.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(d.draft ? [6, 4] : []);
      this.#shape(ctx, d, px, size);
      if (d.id === this.selectedId || d.draft) this.#handles(ctx, d, px);
    }
    ctx.restore();
  }

  #shape(ctx, d, px, size) {
    const [a, b, c] = px;
    const line = (p, q) => { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
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
      case 'trend':
        if (b) line(a, b);
        break;
      case 'ray':
        if (b) line(a, extendTo(a, b, size.width));
        break;
      case 'hline':
        line({ x: 0, y: a.y }, { x: size.width, y: a.y });
        label(this.formatPrice(d.points[0].price), size.width - 4, a.y, 'right', d.color);
        break;
      case 'vline':
        line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        break;
      case 'hray':
        line(a, { x: size.width, y: a.y });
        label(this.formatPrice(d.points[0].price), size.width - 4, a.y, 'right', d.color);
        break;
      case 'crossline':
        line({ x: 0, y: a.y }, { x: size.width, y: a.y });
        line({ x: a.x, y: 0 }, { x: a.x, y: size.height });
        label(this.formatPrice(d.points[0].price), size.width - 4, a.y, 'right', d.color);
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
        ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const lines = (d.text ?? '').split('\n');
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
        lines.forEach((l, i) => ctx.fillText(l, a.x, a.y + i * 18));
        this.textBoxes.set(d.id, { x: a.x, y: a.y, w, h: lines.length * 18 });
        break;
      }
    }
  }

  #handles(ctx, d, px) {
    if (NO_HANDLES.includes(d.type) && !d.draft) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
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
