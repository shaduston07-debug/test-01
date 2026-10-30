// Stamp-based stroke engine.
// Paint/erase stamps go into a per-stroke buffer that is composited onto the layer with
// the stroke opacity (so overlapping stamps never exceed it, like Procreate's "glaze").
// Smudge works directly on the layer.
import { makeCanvas, emptyRect, growRect, clampRect, clamp } from './util.js';
import { snapshot, getBackup, pixelCmd } from './history.js';
import { getTintedTip, getTipMask, getGrain } from './brushes.js';

const TAU = Math.PI * 2;

export class StrokeEngine {
  constructor() {
    this.active = false;
    this.stampC = makeCanvas(64, 64);
    this.smudgeTmp = makeCanvas(64, 64);
  }

  ensure(w, h) {
    if (!this.buffer || this.buffer.width !== w || this.buffer.height !== h) {
      this.buffer = makeCanvas(w, h);
      this.preview = makeCanvas(w, h);
    }
  }

  // target: {canvas, layer, scale, matrix, toLocal}
  // o: {kind, color, size, opacity, symmetry, selection, simTaper, onChange}
  begin(target, brush, o) {
    this.target = target; this.brush = brush; this.o = o;
    this.kind = o.kind || 'paint';
    const W = target.canvas.width, H = target.canvas.height;
    this.W = W; this.H = H;
    this.ensure(W, H);
    this.tctx = target.canvas.getContext('2d');
    this.bctx = this.buffer.getContext('2d');
    this.bctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bctx.globalCompositeOperation = 'source-over';
    this.bctx.clearRect(0, 0, W, H);
    this.size = o.size; this.opacity = o.opacity; this.scale = target.scale || 1;
    this.alphaLock = !!target.layer.alphaLock;
    // Fast path: plain painting on a normal 100% layer → the live stroke is drawn as an
    // overlay above the layer (no preview canvas, no per-frame copies).
    const L = target.layer;
    this.fast = !o.noFast && this.kind === 'paint' && !this.alphaLock && !o.selection && (L.opacity ?? 1) === 1 && (L.blend || 'source-over') === 'source-over';
    // Paint/erase don't touch the layer until the end, so only smudge needs a full snapshot.
    if (!o.noUndo && this.kind === 'smudge') snapshot(target.canvas);
    this.op = this.kind === 'erase' ? 'destination-out' : this.alphaLock ? 'source-atop' : 'source-over';
    this.tip = this.kind === 'paint' ? getTintedTip(brush, o.color) : getTintedTip(brush, '#000');
    this.mask = getTipMask(brush);
    this.grain = getGrain(brush);
    if (this.grain) {
      this.pattern = this.bctx.createPattern(this.grain, 'repeat');
    }
    this.bounds = emptyRect(); this.dirty = emptyRect();
    this.q = []; this.s = null; this.carry = 0; this.travel = 0; this.travelNow = 0; this.dir = 0; this.lastRaw = null;
    this.speed = 0; this.lastTime = null;
    this.sym = this.symTransforms(o.symmetry);
    if (this.kind !== 'smudge' && !this.fast) {
      const p = this.preview.getContext('2d');
      p.setTransform(1, 0, 0, 1, 0, 0); p.globalAlpha = 1; p.globalCompositeOperation = 'source-over';
      p.globalCompositeOperation = 'copy'; p.drawImage(target.canvas, 0, 0); p.globalCompositeOperation = 'source-over';
    } else if (this.kind === 'smudge') {
      const S = clamp(Math.ceil(this.size / this.scale), 2, 512);
      this.smS = S;
      this.smudgeBuf = makeCanvas(S, S);
      this.smudgeInit = false;
      if (this.smudgeTmp.width < S) this.smudgeTmp = makeCanvas(S, S);
    }
    this.active = true;
  }

  symTransforms(sym) {
    if (!sym || sym.mode === 'off') return null;
    const cx = this.W / 2, cy = this.H / 2;
    const id = (x, y, a) => [x, y, a];
    const v = (x, y, a) => [2 * cx - x, y, Math.PI - a];
    const hz = (x, y, a) => [x, 2 * cy - y, -a];
    const both = (x, y, a) => [2 * cx - x, 2 * cy - y, a + Math.PI];
    if (sym.mode === 'vertical') return [id, v];
    if (sym.mode === 'horizontal') return [id, hz];
    if (sym.mode === 'quad') return [id, v, hz, both];
    if (sym.mode === 'radial') {
      const n = sym.count || 6, out = [];
      for (let k = 0; k < n; k++) {
        const t = (k / n) * TAU, c = Math.cos(t), s = Math.sin(t);
        out.push((x, y, a) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c, a + t]);
      }
      return out;
    }
    return null;
  }

  // p: doc-space {x, y, pressure, tilt}
  add(p) {
    if (!this.active) return;
    const l = this.target.toLocal(p.x, p.y);
    const pt = { x: l.x, y: l.y, p: clamp(p.pressure, 0, 1), t: p.tilt || 0, v: 0 };
    // pointer speed in screen px per ms, smoothed (drives speed dynamics)
    if (this.lastRaw && p.time != null && this.lastTime != null) {
      const dt = Math.max(1, p.time - this.lastTime);
      const inst = Math.hypot(pt.x - this.lastRaw.x, pt.y - this.lastRaw.y) * this.scale * (this.o.viewZoom || 1) / dt;
      this.speed = this.speed * 0.75 + Math.min(inst, 8) * 0.25;
    }
    if (p.time != null) this.lastTime = p.time;
    pt.v = this.speed || 0;
    this.lastRaw = pt;
    if (!this.s) {
      this.s = { ...pt };
      this.q.push(this.s);
      this.stampAt(this.s);
      this.carry = this.spacingAt(this.s);
      return;
    }
    const k = 1 - clamp(this.brush.streamline, 0, 1) * 0.9;
    const s = {
      x: this.s.x + (pt.x - this.s.x) * k,
      y: this.s.y + (pt.y - this.s.y) * k,
      p: this.s.p + (pt.p - this.s.p) * Math.min(1, k * 1.6),
      t: pt.t, v: pt.v,
    };
    if (Math.hypot(s.x - this.s.x, s.y - this.s.y) < 0.35 / this.scale && Math.abs(s.p - this.s.p) < 0.02) return;
    this.s = s;
    this.pushPoint(s);
  }

  pushPoint(s) {
    const q = this.q; q.push(s);
    const n = q.length;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2, t: (a.t + b.t) / 2, v: ((a.v || 0) + (b.v || 0)) / 2 });
    if (n === 2) { this.walk(q[0], mid(q[0], q[1])); return; }
    const a = mid(q[n - 3], q[n - 2]), c = q[n - 2], b = mid(q[n - 2], q[n - 1]);
    this.curve(a, c, b);
    if (q.length > 4) q.shift();
  }

  curve(a, c, b) {
    const len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    let prev = a;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const q = (k) => u * u * a[k] + 2 * u * t * c[k] + t * t * b[k];
      const cur = { x: q('x'), y: q('y'), p: q('p'), t: q('t'), v: (a.v || 0) * u + (b.v || 0) * t };
      this.walk(prev, cur);
      prev = cur;
    }
  }

  walk(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    if (len > 0.3) this.dir = Math.atan2(dy, dx);
    let pos = 0;
    while (pos + this.carry <= len) {
      pos += this.carry;
      const t = pos / len;
      const pt = { x: a.x + dx * t, y: a.y + dy * t, p: a.p + (b.p - a.p) * t, t: a.t + (b.t - a.t) * t, v: (a.v || 0) + ((b.v || 0) - (a.v || 0)) * t };
      this.travelNow = this.travel + pos;
      this.stampAt(pt);
      this.carry = this.spacingAt(pt);
    }
    this.carry -= len - pos;
    this.travel += len;
  }

  sizeAt(pt) {
    const b = this.brush;
    let s = this.size * (1 - b.sizePressure * (1 - pt.p));
    s = Math.max(s, this.size * (b.minSize || 0));
    s *= 1 + (b.tiltSize || 0) * pt.t;
    if (b.speedSize) s *= 1 - b.speedSize * 0.85 * Math.min(1, (pt.v || 0) / 3);
    if ((this.o.simTaper || b.taperAlways) && b.taper > 0) {
      const L = b.taper * this.size * 4 + 1;
      s *= 0.15 + 0.85 * Math.min(1, (this.travelNow ?? this.travel) * this.scale / L);
    }
    return Math.max(0.3, s / this.scale);
  }
  spacingAt(pt) { return Math.max(0.4 / this.scale, this.sizeAt(pt) * Math.max(0.01, this.brush.spacing)); }

  stampAt(pt) {
    const b = this.brush;
    let size = this.sizeAt(pt);
    if (b.sizeJitter) size *= 1 - b.sizeJitter * Math.random();
    // "opacity" dynamics are converted to per-stamp alpha so their steady state matches
    const o = (1 - b.opacityPressure * (1 - pt.p)) * (1 - (b.tiltOpacity || 0) * pt.t) * (1 - (b.speedOpacity || 0) * 0.85 * Math.min(1, (pt.v || 0) / 3));
    const ao = o >= 0.999 ? 1 : 1 - Math.pow(1 - clamp(o, 0, 0.999), Math.max(0.02, b.spacing));
    let alpha = b.flow * (1 - (b.flowPressure || 0) * (1 - pt.p)) * ao;
    let x = pt.x, y = pt.y;
    if (b.scatter) { x += (Math.random() - 0.5) * 2 * size * b.scatter; y += (Math.random() - 0.5) * 2 * size * b.scatter; }
    let ang = (b.rotation || 0) * Math.PI / 180 + (b.follow ? this.dir : 0) + (Math.random() - 0.5) * TAU * (b.angleJitter || 0);
    if (size < 1) { alpha *= size; size = 1; }
    const list = this.sym || [null];
    for (const f of list) {
      const [sx, sy, sa] = f ? f(x, y, ang) : [x, y, ang];
      if (this.kind === 'smudge') this.smudgeStamp(sx, sy, size, alpha);
      else this.drawStamp(sx, sy, size, alpha, sa);
      const pad = size * 0.75 + 2;
      growRect(this.bounds, sx, sy, pad); growRect(this.dirty, sx, sy, pad);
    }
  }

  drawStamp(x, y, size, alpha, ang) {
    const ctx = this.bctx, b = this.brush;
    const w = size, h = size * (b.roundness || 1);
    const c = Math.cos(ang), s = Math.sin(ang);
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (!this.grain) {
      ctx.setTransform(c, s, -s, c, x, y);
      ctx.drawImage(this.tip, -w / 2, -h / 2, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    // grain: stamp into a scratch canvas, multiply by the canvas-anchored texture, then deposit
    const r = Math.ceil(Math.hypot(w, h) / 2) + 1, S = 2 * r;
    if (this.stampC.width < S) this.stampC = makeCanvas(S * 1.5, S * 1.5);
    const sc = this.stampC.getContext('2d');
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, S, S);
    sc.setTransform(c, s, -s, c, r, r);
    sc.drawImage(this.tip, -w / 2, -h / 2, w, h);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'destination-in';
    const gs = this.brush.grainScale || 1;
    const pat = this.pattern;
    if (pat.setTransform) pat.setTransform(new DOMMatrix().translate(-(x - r), -(y - r)).scale(gs));
    sc.fillStyle = pat;
    sc.fillRect(0, 0, S, S);
    sc.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.stampC, 0, 0, S, S, x - r, y - r, S, S);
  }

  smudgeStamp(x, y, size, alpha) {
    const S = this.smS, buf = this.smudgeBuf, bx = buf.getContext('2d');
    const sx = x - size / 2, sy = y - size / 2;
    if (!this.smudgeInit) {
      bx.clearRect(0, 0, S, S);
      bx.drawImage(this.target.canvas, sx, sy, size, size, 0, 0, S, S);
      this.smudgeInit = true;
      return;
    }
    const strength = clamp(this.brush.smudgeStrength ?? 0.7, 0, 1);
    const t = this.smudgeTmp.getContext('2d');
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, S, S);
    t.drawImage(buf, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(this.mask, 0, 0, S, S);
    t.globalCompositeOperation = 'source-over';
    const tc = this.tctx;
    tc.save();
    tc.globalAlpha = clamp(alpha * this.opacity, 0, 1);
    tc.globalCompositeOperation = this.alphaLock ? 'source-atop' : 'source-over';
    tc.drawImage(this.smudgeTmp, 0, 0, S, S, sx, sy, size, size);
    tc.restore();
    // pick up colour from the canvas under the tip
    bx.globalAlpha = 1 - strength;
    bx.drawImage(this.target.canvas, sx, sy, size, size, 0, 0, S, S);
    bx.globalAlpha = 1;
  }

  // QuickShape: replace the stroke with a clean path (local coords, each {x,y,p,t}).
  reshape(points) {
    if (!this.active || this.kind === 'smudge') return;
    this.dirty = { ...this.bounds };
    this.bctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bctx.clearRect(0, 0, this.W, this.H);
    this.carry = 0; this.travel = 1e9; this.travelNow = 1e9;
    for (let i = 1; i < points.length; i++) this.walk(points[i - 1], points[i]);
    this.q = []; this.s = null;
  }
  avgPressure() { return this.lastRaw ? this.lastRaw.p : 1; }

  updatePreview() {
    if (!this.active || this.kind === 'smudge') return;
    if (this.fast) { this.dirty = emptyRect(); return; }
    const r = clampRect(this.dirty, this.W, this.H);
    this.dirty = emptyRect();
    if (r.w <= 0 || r.h <= 0) return;
    const sel = this.o.selection;
    const { x, y, w, h } = r;
    if (sel) {
      const b = this.bctx;
      b.save();
      b.globalCompositeOperation = 'destination-in'; b.globalAlpha = 1;
      if (this.target.matrix) {
        b.beginPath(); b.rect(x, y, w, h); b.clip();
        const m = this.target.matrix.inverse(); b.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        b.drawImage(sel, 0, 0);
      } else b.drawImage(sel, x, y, w, h, x, y, w, h);
      b.restore();
    }
    // only the changed rectangle is recomposited (source-rect copies, no full-canvas clip draws)
    const p = this.preview.getContext('2d');
    p.globalAlpha = 1; p.globalCompositeOperation = 'source-over';
    p.clearRect(x, y, w, h);
    p.drawImage(this.target.canvas, x, y, w, h, x, y, w, h);
    p.globalAlpha = this.opacity; p.globalCompositeOperation = this.op;
    p.drawImage(this.buffer, x, y, w, h, x, y, w, h);
    p.globalAlpha = 1; p.globalCompositeOperation = 'source-over';
  }

  previewFor(canvas) {
    return this.active && !this.fast && this.kind !== 'smudge' && this.target && canvas === this.target.canvas ? this.preview : null;
  }
  overlayFor(canvas) {
    if (!(this.active && this.fast && this.target && canvas === this.target.canvas)) return null;
    return { canvas: this.buffer, alpha: this.opacity, rect: clampRect(this.bounds, this.W, this.H) };
  }

  end(label) {
    if (!this.active) return null;
    if (this.kind !== 'smudge' && this.lastRaw && this.s) this.pushPoint({ ...this.lastRaw });
    if (this.kind !== 'smudge' && this.q.length >= 2) {
      const q = this.q, n = q.length;
      this.walk({ x: (q[n - 2].x + q[n - 1].x) / 2, y: (q[n - 2].y + q[n - 1].y) / 2, p: (q[n - 2].p + q[n - 1].p) / 2, t: q[n - 1].t }, q[n - 1]);
    }
    const rect = clampRect(this.bounds, this.W, this.H);
    // the preview is discarded now; only the selection mask still has to be applied
    if (this.kind !== 'smudge' && this.o.selection && rect.w > 0 && rect.h > 0) {
      this.dirty = { ...this.bounds };
      const b = this.bctx;
      b.save(); b.globalCompositeOperation = 'destination-in';
      if (this.target.matrix) {
        b.beginPath(); b.rect(rect.x, rect.y, rect.w, rect.h); b.clip();
        const m = this.target.matrix.inverse(); b.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        b.drawImage(this.o.selection, 0, 0);
      } else b.drawImage(this.o.selection, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      b.restore();
    }
    let before = null;
    if (this.kind !== 'smudge' && rect.w > 0 && rect.h > 0 && !this.o.noUndo) {
      before = makeCanvas(rect.w, rect.h);
      before.getContext('2d').drawImage(this.target.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    }
    if (this.kind !== 'smudge' && rect.w > 0 && rect.h > 0) {
      const t = this.tctx;
      t.save();
      t.globalAlpha = this.opacity; t.globalCompositeOperation = this.op;
      t.drawImage(this.buffer, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      t.restore();
    }
    this.active = false;
    return this.o.noUndo ? null : pixelCmd(this.target.canvas, rect, label || this.kind, this.o.onChange, before);
  }

  cancel() {
    if (!this.active) return;
    if (this.kind === 'smudge') {
      const r = clampRect(this.bounds, this.W, this.H);
      if (r.w > 0 && r.h > 0) {
        this.tctx.clearRect(r.x, r.y, r.w, r.h);
        this.tctx.drawImage(getBackup(), r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      }
    }
    this.active = false;
  }
}

// ── QuickShape detection (doc-space points) ──
export function detectShape(pts) {
  if (pts.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, L = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    if (i) L += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  }
  const a = pts[0], b = pts[pts.length - 1];
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 8) return null;
  const gap = Math.hypot(b.x - a.x, b.y - a.y);
  if (gap < diag * 0.28 && L > diag * 1.6) {
    // closed: ellipse fitted to the bounding box (good enough & predictable)
    return { type: 'ellipse', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 };
  }
  // open: decide line vs. arc by max deviation from the chord
  let dev = 0, devPt = null;
  const cl = gap || 1;
  for (const p of pts) {
    const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / cl;
    if (d > dev) { dev = d; devPt = p; }
  }
  if (dev > cl * 0.12 && devPt) return { type: 'arc', x1: a.x, y1: a.y, x2: b.x, y2: b.y, mx: devPt.x, my: devPt.y };
  return { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

export function shapePoints(sh, p = 1) {
  const out = [];
  if (sh.type === 'line') {
    out.push({ x: sh.x1, y: sh.y1, p, t: 0 }, { x: sh.x2, y: sh.y2, p, t: 0 });
  } else if (sh.type === 'ellipse') {
    const n = Math.max(48, Math.ceil((sh.rx + sh.ry) / 3));
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * TAU + (sh.rot || 0);
      out.push({ x: sh.cx + Math.cos(t) * sh.rx, y: sh.cy + Math.sin(t) * sh.ry, p, t: 0 });
    }
  } else if (sh.type === 'arc') {
    // quadratic bezier through the mid point
    const cx = 2 * sh.mx - (sh.x1 + sh.x2) / 2, cy = 2 * sh.my - (sh.y1 + sh.y2) / 2;
    const n = 64;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push({ x: u * u * sh.x1 + 2 * u * t * cx + t * t * sh.x2, y: u * u * sh.y1 + 2 * u * t * cy + t * t * sh.y2, p, t: 0 });
    }
  }
  return out;
}
