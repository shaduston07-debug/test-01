// Stamp-based stroke engine.
// Paint/erase stamps go into a per-stroke buffer that is composited onto the layer with
// the stroke opacity (so overlapping stamps never exceed it, like Procreate's "glaze").
// Smudge works directly on the layer.
import { makeCanvas, emptyRect, growRect, clampRect, clamp } from './util.js';
import { mixDab } from './smudgegl.js';
import { snapshot, getBackup, pixelCmd } from './history.js';
import { getTintedTip, getTipMask, getGrain, isInkBrush, steadyInk } from './brushes.js';

const TAU = Math.PI * 2;
const smooth = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); };
// ibis "Duration" 100% ≈ a stretch of about eight brush widths (min a few pixels)
const fadeLen = (dur, size) => Math.max(4, (dur ?? 1) * 8 * size + 2);

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
    if (o.steadyInk && isInkBrush(brush) && !brush.exact) brush = steadyInk(brush);
    // brushes that keep the original speed response and pressure/speed opacity (Pluma falcon)
    this.classic = !!(brush.classicSpeed || /pluma/i.test(brush.name || '') || brush.id === 'ibis-pluma-falcon');
    if (this.classic && o.solidColor) o = { ...o, solidColor: false };
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
    this.bounds = emptyRect(); this.dirty = emptyRect(); this.frame = emptyRect(); this.vSm = null;
    // end taper: the last stamps are logged so the stroke's end can be re-drawn to a point on lift
    // ibis-style Fade: thickness / opacity ratios at the start and end of every stroke
    // (e.g. 185% = the ink swells into a blob), each over a "duration" of the stroke
    this.fade = brush.fadeStartSize != null || brush.fadeEndSize != null;
    const et = this.kind === 'smudge' ? 0 : (brush.endTaper ?? (brush.taperAlways ? brush.taper || 0 : 0));
    if (this.fade && this.kind !== 'smudge' && ((brush.fadeEndSize ?? 1) !== 1 || (brush.fadeEndAlpha ?? 1) !== 1)) {
      this.endLen = fadeLen(brush.fadeEndLen, this.size) / this.scale; this.endSize = brush.fadeEndSize ?? 1; this.endAlpha = brush.fadeEndAlpha ?? 1;
    } else {
      this.endLen = et > 0 ? (et * this.size * 4 + 1) / this.scale : 0; this.endSize = null; this.endAlpha = 1;
    }
    // post-correction amount (0 = strokes stay exactly as drawn … 1 = the brush's full end effect)
    this.liftK = clamp(o.liftAmount ?? (o.liftEffects ? 1 : 0), 0, 1);
    // ink blobs where strokes start / end (brush fades above 100 %): 0 = clean joins
    this.blobK = clamp(o.blobAmount ?? 0, 0, 1);
    if (!this.liftK) this.endLen = 0;
    this.tail = []; this.tailHead = 0;
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
    // Apple Pencil samples arrive unevenly (timestamps bunch up, positions sometimes only
    // update every other sample, pressure jitters). Brushes whose size / opacity follow
    // speed and pressure turned that into beads, so both are measured over time, not per sample.
    const pr = clamp(p.pressure, 0, 1);
    const hasT = p.time != null && this.lastTime != null;
    const dt = hasT ? clamp(p.time - this.lastTime, 0, 50) : 4;
    const pp = this.lastRaw ? this.lastRaw.p + (pr - this.lastRaw.p) * (1 - Math.exp(-Math.max(dt, 0.5) / 12)) : pr;
    const pt = { x: l.x, y: l.y, p: pp, t: p.tilt || 0, v: 0 };
    if (p.time != null) {
      // speed over a ~30 ms window of recent samples (screen px per ms)
      const H = this.speedHist || (this.speedHist = []);
      if (!this.lastRaw) H.length = 0;
      H.push(p.time, pt.x, pt.y);
      while (H.length > 6 && p.time - H[3] >= 30) H.splice(0, 3);
      const span = p.time - H[0];
      if (span >= 8) {
        const inst = Math.hypot(pt.x - H[1], pt.y - H[2]) * this.scale * (this.o.viewZoom || 1) / span;
        this.speed += (Math.min(inst, 8) - this.speed) * (1 - Math.exp(-Math.max(dt, 0.5) / 25));
      }
      this.lastTime = p.time;
    }
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

  // quadratic segment a → b (control c), flattened into ~2 px pieces; no per-step allocations
  curve(a, c, b) {
    const len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    const P = this._cp || (this._cp = [{ x: 0, y: 0, p: 0, t: 0, v: 0 }, { x: 0, y: 0, p: 0, t: 0, v: 0 }]);
    let prev = P[0], cur = P[1];
    prev.x = a.x; prev.y = a.y; prev.p = a.p; prev.t = a.t; prev.v = a.v || 0;
    const av = a.v || 0, bv = b.v || 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t, k0 = u * u, k1 = 2 * u * t, k2 = t * t;
      cur.x = k0 * a.x + k1 * c.x + k2 * b.x; cur.y = k0 * a.y + k1 * c.y + k2 * b.y;
      cur.p = k0 * a.p + k1 * c.p + k2 * b.p; cur.t = k0 * a.t + k1 * c.t + k2 * b.t; cur.v = av * u + bv * t;
      this.walk(prev, cur);
      const tmp = prev; prev = cur; cur = tmp;
    }
  }

  walk(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    if (len > 0.3) this.dir = Math.atan2(dy, dx);
    const pt = this._wp || (this._wp = { x: 0, y: 0, p: 0, t: 0, v: 0 });
    const av = a.v || 0, dv = (b.v || 0) - av;
    let pos = 0;
    while (pos + this.carry <= len) {
      pos += this.carry;
      const t = pos / len;
      pt.x = a.x + dx * t; pt.y = a.y + dy * t; pt.p = a.p + (b.p - a.p) * t; pt.t = a.t + (b.t - a.t) * t;
      // speed effects change gradually along the line (over ~2 brush widths), so uneven pen
      // sample timing can never show up as beads or dashes
      const vRaw = av + dv * t, step = Math.max(0.5, this.carry || 1);
      this.vSm = this.vSm == null ? vRaw : this.vSm + (vRaw - this.vSm) * Math.min(1, step / (this.classic ? this.size / this.scale * 2 + 6 : this.size / this.scale * 4 + 10));
      pt.v = this.vSm;
      this.travelNow = this.travel + pos;
      // stampAt returns the un-jittered size so spacing needn't recompute it
      this.carry = Math.max(0.4 / this.scale, this.stampAt(pt) * Math.max(this.kind === 'smudge' ? 0.12 : 0.01, this.brush.spacing)); // smudge: fewer, distance-scaled dabs
    }
    this.carry -= len - pos;
    this.travel += len;
  }

  sizeAt(pt) {
    const b = this.brush;
    const pr = b.pressureCurve ? Math.pow(pt.p, b.pressureCurve) : pt.p;
    // pressure can thin a stroke but never make it vanish (≥ 35 % of the size, ≥ 50 % opacity)
    let s = this.size * Math.max(0.35, 1 - b.sizePressure * (1 - pr));
    s = Math.max(s, this.size * (b.minSize || 0));
    s *= 1 + (b.tiltSize || 0) * pt.t;
    // speed can thin a line a little (≤ 35 %), never make long fast lines vanish
    if (b.speedSize) s *= this.classic ? 1 - Math.min(0.35, b.speedSize * 0.6) * Math.min(1, (pt.v || 0) / 5) : 1 - Math.min(0.18, b.speedSize * 0.4) * Math.min(1, (pt.v || 0) / 6);
    if (this.fade) {
      let k = (b.fadeStartSize ?? 1);
      if (k > 1) k = 1 + (k - 1) * this.blobK; // ink blob at the start (0 = none)
      if (k !== 1) s *= k + (1 - k) * smooth((this.travelNow ?? this.travel) * this.scale / fadeLen(b.fadeStartLen, this.size));
    } else if ((this.o.simTaper || b.taperAlways) && b.taper > 0) {
      const L = b.taper * this.size * 4 + 1;
      s *= 0.15 + 0.85 * Math.min(1, (this.travelNow ?? this.travel) * this.scale / L);
    }
    return Math.max(0.3, s / this.scale);
  }
  spacingAt(pt) { return Math.max(0.4 / this.scale, this.sizeAt(pt) * Math.max(this.kind === 'smudge' ? 0.12 : 0.01, this.brush.spacing)); }

  stampAt(pt) {
    const b = this.brush;
    const base = this.sizeAt(pt);
    let size = base;
    if (b.sizeJitter) size *= 1 - b.sizeJitter * Math.random();
    // "opacity" dynamics are converted to per-stamp alpha so their steady state matches
    // Solid colour (default): pressure / tilt / speed change the size only — a stroke is always
    // the full colour, so overlapping strokes of one colour don't darken (like Procreate / CSP pens)
    const solid = this.o.solidColor;
    const o = solid ? 1 : Math.max(0.5, 1 - b.opacityPressure * (1 - pt.p)) * (1 - (b.tiltOpacity || 0) * pt.t) * (this.classic ? 1 - Math.min(0.25, (b.speedOpacity || 0) * 0.45) * Math.min(1, (pt.v || 0) / 5) : 1 - Math.min(0.15, (b.speedOpacity || 0) * 0.35) * Math.min(1, (pt.v || 0) / 6));
    const ao = o >= 0.999 ? 1 : 1 - Math.pow(1 - clamp(o, 0, 0.999), Math.max(0.02, b.spacing));
    let alpha = b.flow * (solid ? 1 : Math.max(0.3, 1 - (b.flowPressure || 0) * (1 - pt.p))) * ao;
    if (this.fade && (b.fadeStartAlpha ?? 1) !== 1) {
      let k = b.fadeStartAlpha;
      if (k > 1) k = 1 + (k - 1) * this.blobK;
      alpha = Math.min(1, alpha * (k + (1 - k) * smooth((this.travelNow ?? this.travel) * this.scale / fadeLen(b.fadeStartLen, this.size))));
    }
    if (this.kind === 'smudge') this.smP = pt.p ?? 1;
    let x = pt.x, y = pt.y;
    if (b.scatter) { x += (Math.random() - 0.5) * 2 * size * b.scatter; y += (Math.random() - 0.5) * 2 * size * b.scatter; }
    let ang = (b.rotation || 0) * Math.PI / 180 + (b.follow ? this.dir : 0) + (Math.random() - 0.5) * TAU * (b.angleJitter || 0);
    if (size < 1) { alpha *= size; size = 1; }
    const pad = size * 0.75 + 2;
    if (this.endLen) this.logStamp(x, y, size, alpha, ang);
    if (!this.sym) {
      // common case: no symmetry — no arrays, no closures
      if (this.kind === 'smudge') this.smudgeStamp(x, y, size, alpha); else this.drawStamp(x, y, size, alpha, ang);
      growRect(this.bounds, x, y, pad); growRect(this.dirty, x, y, pad); growRect(this.frame, x, y, pad);
      return base;
    }
    for (const f of this.sym) {
      const [sx, sy, sa] = f(x, y, ang);
      if (this.kind === 'smudge') this.smudgeStamp(sx, sy, size, alpha);
      else this.drawStamp(sx, sy, size, alpha, sa);
      growRect(this.bounds, sx, sy, pad); growRect(this.dirty, sx, sy, pad); growRect(this.frame, sx, sy, pad);
    }
    return base;
  }

  logStamp(x, y, size, alpha, ang) {
    const d = this.travelNow ?? this.travel, T = this.tail;
    T.push(x, y, size, alpha, ang, d);
    // keep only what a lift could still re-draw (taper length + a couple of stamp widths)
    const keep = d - this.endLen - size * 2 - 4;
    while (this.tailHead < T.length && T[this.tailHead + 5] < keep) this.tailHead += 6;
    if (this.tailHead > 6000) { T.splice(0, this.tailHead); this.tailHead = 0; }
  }
  // Re-draw the end of the stroke narrowing to a point (called on lift, before the stroke is
  // committed). Only the area under the tail's stamps is cleared and repainted, so the rest
  // of the stroke is untouched.
  taperEnd() {
    const T = this.tail, total = this.travel, L = this.endLen;
    if (!L || T.length - this.tailHead < 12) return;
    const grow = this.endSize != null ? Math.max(1, this.endSize) : 1;
    const ctx = this.bctx, rr = (i) => T[i + 2] * grow * Math.max(1, this.brush.roundness || 1) * 0.75 + 1.5;
    let first = -1;
    for (let i = this.tailHead; i < T.length; i += 6) if (total - T[i + 5] < L) { first = i; break; }
    if (first < 0) return;
    const sym = this.sym || [null];
    const path = new Path2D();
    for (let i = first; i < T.length; i += 6) for (const f of sym) {
      const [x, y] = f ? f(T[i], T[i + 1], 0) : [T[i], T[i + 1]];
      path.moveTo(x + rr(i), y); path.arc(x, y, rr(i), 0, TAU);
      growRect(this.bounds, x, y, rr(i) + 2); growRect(this.frame, x, y, rr(i) + 2);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; ctx.fill(path);
    ctx.restore();
    ctx.save(); ctx.clip(path);
    for (let i = this.tailHead; i < T.length; i += 6) {
      const rem = total - T[i + 5];
      let size = T[i + 2], alpha = T[i + 3];
      if (rem < L) {
        const u = Math.max(0, rem / L);
        const k = this.liftK;
        if (this.endSize != null) {
          const bl = (r) => (r > 1 ? 1 + (r - 1) * this.blobK : r);
          const f = smooth(u), es = 1 + (bl(this.endSize) - 1) * k, ea = 1 + (bl(this.endAlpha) - 1) * k;
          size *= es + (1 - es) * f;
          alpha = Math.min(1, alpha * (ea + (1 - ea) * f));
        } else size *= 1 - k * 0.9 * (1 - Math.sqrt(u));
      }
      if (size < 1) { alpha *= size; size = 1; }
      for (const f of sym) {
        if (f) { const [x, y, a] = f(T[i], T[i + 1], T[i + 4]); this.drawStamp(x, y, size, alpha, a); }
        else this.drawStamp(T[i], T[i + 1], size, alpha, T[i + 4]);
      }
    }
    ctx.restore();
    this.markFrame();
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

  // Smudge / blend, like Procreate's smudge and Clip Studio's blend tools.
  // · Strength doesn't depend on how densely dabs are laid down: each dab's share is scaled by
  //   the distance it covers (a fraction of the brush diameter).
  // · Pressure sets how much paint moves (light = gentle), on top of the tool's opacity.
  // · The tip carries the paint it picked up and mixes in fresh paint as it travels
  //   (Smudge strength = how far colour is dragged).
  // · Mixing is a true premultiplied blend, so it also pulls see-through areas into paint and
  //   paint into empty areas (no hard rim, no darkening).
  // · smudgeMode 'blur' softens what is under the tip instead of dragging it.
  smudgeStamp(x, y, size, alpha) {
    const S = this.smS, buf = this.smudgeBuf, bx = buf.getContext('2d');
    const sx = x - size / 2, sy = y - size / 2;
    const tgt = this.target.canvas;
    const blur = this.brush.smudgeMode === 'blur';
    if (!this.smudgeInit) {
      bx.globalCompositeOperation = 'copy'; bx.globalAlpha = 1;
      bx.drawImage(tgt, sx, sy, size, size, 0, 0, S, S);
      bx.globalCompositeOperation = 'source-over';
      this.smudgeInit = true; this.smLast = { x, y };
      if (!blur) return;
    }
    // distance covered since the last dab, as a fraction of the diameter
    const d = this.smLast ? Math.hypot(x - this.smLast.x, y - this.smLast.y) : size * 0.1;
    this.smLast = { x, y };
    const step = clamp(d / Math.max(1, size), 0.02, 1);
    const p = this.smP ?? 1;
    const strength = clamp(this.brush.smudgeStrength ?? 0.7, 0, 1);
    // how much of the canvas under the tip is replaced per brush-diameter of travel
    const perDiam = clamp(alpha * this.opacity, 0, 1) * (0.25 + 0.6 * p) * (blur ? 0.9 : 0.75);
    const a = 1 - Math.pow(1 - clamp(perDiam, 0, 0.98), step);
    if (a <= 0.002) return;
    // work on a whole-pixel box at 1:1, so pixels outside the tip are copied back unchanged
    const ix = Math.floor(sx), iy = Math.floor(sy), W = Math.min(2048, Math.ceil(sx + size) - ix + 1);
    const ox = sx - ix, oy = sy - iy; // where the tip sits inside the box
    if (!this.smW || this.smW.width < W) { this.smW = makeCanvas(W, W); this.smudgeTmp2 = makeCanvas(W, W); this.smudgeTmp3 = makeCanvas(W, W); this.smU = makeCanvas(W, W); }
    const t = this.smW.getContext('2d'), t2 = this.smudgeTmp2.getContext('2d');
    const tipMask = (c) => c.drawImage(this.mask, 0, 0, this.mask.width, this.mask.height, ox, oy, size, size);
    // source: the carried paint, or a softened copy of what is under the tip
    let src = buf;
    if (blur) {
      // a softened copy of the area: shrink and enlarge again (works everywhere, no filters)
      const t3 = this.smudgeTmp3.getContext('2d'), k = Math.max(3, Math.min(W, 6)); // blur radius ≈ 1/3 of the tip
      // (a separate small canvas: drawing a canvas onto itself with 'copy' would clear it first)
      if (!this.smSmall) this.smSmall = makeCanvas(8, 8);
      const sm = this.smSmall.getContext('2d');
      sm.globalCompositeOperation = 'copy'; sm.imageSmoothingQuality = 'high';
      // sample twice the tip's area around it, so the blur reaches past the tip's own box
      sm.drawImage(tgt, ix - W / 2, iy - W / 2, W * 2, W * 2, 0, 0, k, k);
      t3.globalCompositeOperation = 'copy'; t3.globalAlpha = 1; t3.imageSmoothingQuality = 'high';
      t3.drawImage(this.smSmall, 0, 0, k, k, -W / 2, -W / 2, W * 2, W * 2);
      t3.globalCompositeOperation = 'source-over';
    }
    // T1 = source × tip (premultiplied), placed where the tip is in the box
    t.globalCompositeOperation = 'copy'; t.globalAlpha = 1;
    if (blur) t.drawImage(this.smudgeTmp3, 0, 0, W, W, 0, 0, W, W);
    else t.drawImage(buf, 0, 0, S, S, ox, oy, size, size);
    t.globalCompositeOperation = 'destination-in'; tipMask(t);
    // the mix, on a 1:1 copy of the canvas box (T2):
    t2.globalCompositeOperation = 'copy'; t2.globalAlpha = 1;
    t2.drawImage(tgt, ix, iy, W, W, 0, 0, W, W);
    const tc = this.tctx;
    // GPU (float) mix: exact, no colour drift. Inputs as exact W×W canvases.
    if (!this.smGL || this.smGL.d.width !== W) {
      this.smGL = { d: makeCanvas(W, W), s: makeCanvas(W, W), m: makeCanvas(W, W) };
    }
    const G = this.smGL, gd = G.d.getContext('2d'), gs = G.s.getContext('2d'), gm = G.m.getContext('2d');
    gd.globalCompositeOperation = 'copy'; gd.drawImage(tgt, ix, iy, W, W, 0, 0, W, W);
    gs.globalCompositeOperation = 'copy';
    if (blur) gs.drawImage(this.smudgeTmp3, 0, 0, W, W, 0, 0, W, W);
    else { gs.clearRect(0, 0, W, W); gs.globalCompositeOperation = 'source-over'; gs.drawImage(buf, 0, 0, S, S, ox, oy, size, size); }
    gm.globalCompositeOperation = 'copy'; gm.clearRect(0, 0, W, W); gm.globalCompositeOperation = 'source-over'; tipMask(gm);
    const mixed = mixDab(G.d, G.s, G.m, W, a, this.alphaLock);
    if (mixed) {
      tc.save(); tc.beginPath(); tc.rect(ix, iy, W, W); tc.clip();
      tc.globalCompositeOperation = 'copy'; tc.drawImage(mixed, 0, 0, W, W, ix, iy, W, W);
      tc.restore();
    } else {
    tc.save();
    tc.beginPath(); tc.rect(ix, iy, W, W); tc.clip();
    // 1. colour: blend the source in over existing paint, keeping its opacity exactly
    //    (so solid paint stays solid however long you blend — no slow fading from rounding)
    t2.globalCompositeOperation = 'source-atop'; t2.globalAlpha = a;
    t2.drawImage(this.smW, 0, 0, W, W, 0, 0, W, W);
    if (!this.alphaLock) {
      // 2. where the source itself is see-through, thin the paint (smudging empty areas into
      //    paint): tip × (1 − source opacity) — the source's own alpha, not the tip's soft edge
      const u = this.smU.getContext('2d');
      u.globalCompositeOperation = 'copy'; u.globalAlpha = 1; tipMask(u);
      u.globalCompositeOperation = 'destination-out';
      if (blur) u.drawImage(this.smudgeTmp3, 0, 0, W, W, 0, 0, W, W); else u.drawImage(buf, 0, 0, S, S, ox, oy, size, size);
      u.globalCompositeOperation = 'source-over';
      t2.globalCompositeOperation = 'destination-out'; t2.globalAlpha = a;
      t2.drawImage(this.smU, 0, 0, W, W, 0, 0, W, W);
      // 3. where the canvas is empty, lay the source down (smudging paint into empty areas)
      t2.globalCompositeOperation = 'destination-over'; t2.globalAlpha = a;
      t2.drawImage(this.smW, 0, 0, W, W, 0, 0, W, W);
    }
    t2.globalAlpha = 1; t2.globalCompositeOperation = 'source-over';
    tc.globalCompositeOperation = 'copy';
    tc.drawImage(this.smudgeTmp2, 0, 0, W, W, ix, iy, W, W);
    tc.restore();
    }
    t.globalCompositeOperation = 'source-over';
    // the tip mixes in fresh paint from under it as it travels (exact lerp as well)
    if (!blur) {
      const keep = Math.pow(0.12 + 0.83 * strength, step); // colour left on the tip after this dab
      // GPU mix (exact) of the tip's paint with what's under it; canvas fallback otherwise
      if (!this.smPick || this.smPick.s.width !== S) { this.smPick = { s: makeCanvas(S, S), m: makeCanvas(S, S) }; const mm = this.smPick.m.getContext('2d'); mm.fillStyle = '#fff'; mm.fillRect(0, 0, S, S); }
      const ps = this.smPick.s.getContext('2d');
      ps.globalCompositeOperation = 'copy'; ps.drawImage(tgt, sx, sy, size, size, 0, 0, S, S);
      const picked = mixDab(buf, this.smPick.s, this.smPick.m, S, 1 - keep, false, 'pick');
      if (picked) { bx.globalCompositeOperation = 'copy'; bx.drawImage(picked, 0, 0, S, S, 0, 0, S, S); bx.globalCompositeOperation = 'source-over'; }
      else {
        const u = this.smudgeTmp.getContext('2d');
        u.globalCompositeOperation = 'copy'; u.globalAlpha = keep; u.drawImage(buf, 0, 0, S, S, 0, 0, S, S);
        u.globalCompositeOperation = 'lighter'; u.globalAlpha = 1 - keep; u.drawImage(tgt, sx, sy, size, size, 0, 0, S, S);
        u.globalAlpha = 1; u.globalCompositeOperation = 'source-over';
        bx.globalCompositeOperation = 'copy'; bx.drawImage(this.smudgeTmp, 0, 0, S, S, 0, 0, S, S); bx.globalCompositeOperation = 'source-over';
      }
    }
  }

  // QuickShape: replace the stroke with a clean path (local coords, each {x,y,p,t}).
  reshape(points) {
    if (!this.active || this.kind === 'smudge') return;
    this.dirty = { ...this.bounds }; this.markFrame();
    this.bctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bctx.clearRect(0, 0, this.W, this.H);
    // redraw like a real stroke of this pen: start fade from 0, end taper on lift (tail)
    this.carry = 0; this.travel = 0; this.travelNow = 0; this.tail = []; this.tailHead = 0; this.vSm = null;
    for (let i = 1; i < points.length; i++) this.walk(points[i - 1], points[i]);
    this.q = []; this.s = null;
  }
  avgPressure() { return this.lastRaw ? this.lastRaw.p : 1; }

  // Area changed since the last screen frame, in document coordinates (null = nothing).
  // Lets the app repaint just that part of the screen while a stroke is in progress.
  markFrame() { const b = this.bounds, f = this.frame; if (!b || !f) return; f.x0 = Math.min(f.x0, b.x0); f.y0 = Math.min(f.y0, b.y0); f.x1 = Math.max(f.x1, b.x1); f.y1 = Math.max(f.y1, b.y1); }
  takeFrame() {
    const f = this.frame;
    if (!f || !(f.x1 > f.x0 && f.y1 > f.y0)) return null;
    this.frame = emptyRect();
    const m = this.target && this.target.matrix;
    if (!m) return f;
    const out = emptyRect();
    for (const [x, y] of [[f.x0, f.y0], [f.x1, f.y0], [f.x0, f.y1], [f.x1, f.y1]]) { const p = m.transformPoint({ x, y }); growRect(out, p.x, p.y, 1); }
    return out;
  }

  // The stroke buffer is an 8-bit premultiplied canvas: hundreds of faint overlapping dabs drift
  // its colour (rounding), so soft edges / light pressure came out a different shade from the
  // chosen colour ("a second layer" over a fill of the same colour). A paint stroke is one colour,
  // so the buffer's colour is reset to exactly that colour, keeping only its alpha.
  trueColor(r) {
    if (this.kind !== 'paint' || !this.o.color || r.w <= 0 || r.h <= 0) return;
    const b = this.bctx;
    // 'source-in' is unbounded: clip to the rectangle or it would wipe the rest of the stroke
    b.save(); b.setTransform(1, 0, 0, 1, 0, 0); b.beginPath(); b.rect(r.x, r.y, r.w, r.h); b.clip();
    b.globalAlpha = 1; b.globalCompositeOperation = 'source-in';
    b.fillStyle = this.o.color; b.fillRect(r.x, r.y, r.w, r.h);
    b.restore();
  }

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
      // 'destination-in' is an unbounded operator: without the clip it would erase everything
      // outside this rectangle (the rest of the stroke painted in earlier frames)
      b.setTransform(1, 0, 0, 1, 0, 0); // the stroke context may carry a stamp transform
      b.beginPath(); b.rect(x, y, w, h); b.clip();
      b.globalCompositeOperation = 'destination-in'; b.globalAlpha = 1;
      if (this.target.matrix) {
        const m = this.target.matrix.inverse(); b.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        b.drawImage(sel, 0, 0);
      } else b.drawImage(sel, x, y, w, h, x, y, w, h);
      b.restore();
    }
    this.trueColor(r);
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
    if (this.kind !== 'smudge' && this.liftK > 0) this.taperEnd();
    const rect = clampRect(this.bounds, this.W, this.H);
    // the preview is discarded now; only the selection mask still has to be applied
    if (this.kind !== 'smudge' && this.o.selection && rect.w > 0 && rect.h > 0) {
      this.dirty = { ...this.bounds };
      const b = this.bctx;
      b.save(); b.setTransform(1, 0, 0, 1, 0, 0); b.globalAlpha = 1; b.beginPath(); b.rect(rect.x, rect.y, rect.w, rect.h); b.clip(); b.globalCompositeOperation = 'destination-in';
      if (this.target.matrix) {
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
      this.trueColor(rect);
      const t = this.tctx;
      t.save();
      t.globalAlpha = this.opacity; t.globalCompositeOperation = this.op;
      t.drawImage(this.buffer, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      t.restore();
    }
    this.active = false;
    this.markFrame();
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
    this.active = false; this.markFrame();
  }
}

// ── QuickShape detection (doc-space points) ──
// Each candidate shape is fitted and scored; a shape is only used when the stroke really is that
// shape (otherwise the stroke is left alone). zoom = view zoom, so tolerances are in screen terms.
function resample(pts, n) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const tot = L[L.length - 1], out = [];
  for (let k = 0, j = 0; k < n; k++) {
    const d = tot * k / (n - 1);
    while (j < pts.length - 2 && L[j + 1] < d) j++;
    const t = L[j + 1] > L[j] ? (d - L[j]) / (L[j + 1] - L[j]) : 0;
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, y: pts[j].y + (pts[j + 1].y - pts[j].y) * t });
  }
  return { q: out, len: tot };
}
const segDist = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); };
function rdp(q, i0, i1, eps, out) {
  let best = -1, dm = 0;
  for (let i = i0 + 1; i < i1; i++) { const d = segDist(q[i], q[i0], q[i1]); if (d > dm) { dm = d; best = i; } }
  if (dm > eps) { rdp(q, i0, best, eps, out); out.push(best); rdp(q, best, i1, eps, out); }
}
const angleAt = (a, b, c) => { const u = [a.x - b.x, a.y - b.y], v = [c.x - b.x, c.y - b.y]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1)))) * 180 / Math.PI; };
function circle3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}
export function detectShape(pts, zoom = 1) {
  if (pts.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag * zoom < 24) return null; // too small to mean a shape
  const { q, len } = resample(pts, 72);
  const a = q[0], b = q[q.length - 1], gap = Math.hypot(b.x - a.x, b.y - a.y);
  const closed = gap < diag * 0.22 && len > diag * 1.5;
  if (!closed) {
    // straight line: everything close to the chord
    let dev = 0; for (const p of q) dev = Math.max(dev, segDist(p, a, b));
    if (dev < Math.max(gap * 0.045, 3 / zoom)) return { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    // circular arc: one bend direction, points on a circle through start, middle, end
    const m = q[q.length >> 1], c = circle3(a, m, b);
    if (c && c.r < diag * 4) {
      let rms = 0, sgn = 0, same = 0;
      for (let i = 0; i < q.length; i++) {
        rms += ((Math.hypot(q[i].x - c.cx, q[i].y - c.cy) - c.r) / c.r) ** 2;
        if (i > 0 && i < q.length - 1) { const cr = (q[i].x - q[i - 1].x) * (q[i + 1].y - q[i].y) - (q[i].y - q[i - 1].y) * (q[i + 1].x - q[i].x); if (Math.abs(cr) > 1e-9) { sgn += Math.sign(cr); same++; } }
      }
      rms = Math.sqrt(rms / q.length);
      if (rms < 0.045 && Math.abs(sgn) > same * 0.8) return { type: 'arc', x1: a.x, y1: a.y, x2: b.x, y2: b.y, mx: m.x, my: m.y };
    }
    // polyline (e.g. an L or a V): a few straight segments with clear corners
    // (tight tolerance: a smooth S-curve needs many segments to stay this close, so it's rejected)
    const idx = [0]; rdp(q, 0, q.length - 1, Math.max(diag * 0.025, 2.5 / zoom), idx); idx.push(q.length - 1);
    if (idx.length >= 3 && idx.length <= 5) {
      const v = idx.map((i) => q[i]);
      if (v.slice(1, -1).every((p, i) => angleAt(v[i], p, v[i + 2]) < 135)) return { type: 'poly', pts: v, closed: false };
    }
    return null; // a free curve: keep the stroke as drawn
  }
  // closed: polygon with sharp corners, else an (optionally rotated) ellipse that fits well
  const loop = q.slice(0, -1);
  let far = 0; for (let i = 1; i < loop.length; i++) if (Math.hypot(loop[i].x - a.x, loop[i].y - a.y) > Math.hypot(loop[far].x - a.x, loop[far].y - a.y)) far = i;
  const idx = [0]; rdp(loop.concat([loop[0]]), 0, far, diag * 0.06, idx); idx.push(far); rdp(loop.concat([loop[0]]), far, loop.length, diag * 0.06, idx);
  let verts = [...new Set(idx.filter((i) => i < loop.length))].sort((m, n) => m - n).map((i) => loop[i]);
  // the stroke usually starts mid-edge: drop "corners" that are really straight
  for (let changed = true; changed && verts.length > 3;) {
    changed = false;
    for (let i = 0; i < verts.length; i++) { const n = verts.length; if (angleAt(verts[(i + n - 1) % n], verts[i], verts[(i + 1) % n]) > 158) { verts.splice(i, 1); changed = true; break; } }
  }
  if (verts.length >= 3 && verts.length <= 6) {
    const n = verts.length, ang = verts.map((p, i) => angleAt(verts[(i + n - 1) % n], p, verts[(i + 1) % n]));
    if (ang.every((x) => x < 150)) {
      if (n === 4 && ang.every((x) => Math.abs(x - 90) < 18)) return { type: 'poly', pts: verts, closed: true, rect: true };
      return { type: 'poly', pts: verts, closed: true };
    }
  }
  // ellipse from the second moments of the outline, accepted only if the outline really fits
  let cx = 0, cy = 0; for (const p of loop) { cx += p.x; cy += p.y; } cx /= loop.length; cy /= loop.length;
  let sxx = 0, syy = 0, sxy = 0; for (const p of loop) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= loop.length; syy /= loop.length; sxy /= loop.length;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc), rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let rx = Math.sqrt(2 * l1), ry = Math.sqrt(2 * l2);
  let err = 0; const c0 = Math.cos(-rot), s0 = Math.sin(-rot);
  for (const p of loop) { const dx = p.x - cx, dy = p.y - cy, u = dx * c0 - dy * s0, v = dx * s0 + dy * c0; err += Math.abs(Math.hypot(u / rx, v / ry) - 1); }
  err /= loop.length;
  if (err > 0.1) return null;
  // nearly round → a circle; nearly axis-aligned → no tilt
  if (Math.abs(rx - ry) < Math.max(rx, ry) * 0.08) rx = ry = (rx + ry) / 2;
  const deg = ((rot * 180 / Math.PI) % 180 + 180) % 180;
  const r2 = Math.min(deg, 180 - deg) < 6 || Math.abs(deg - 90) < 6 ? (Math.abs(deg - 90) < 6 ? Math.PI / 2 : 0) : rot;
  return { type: 'ellipse', cx, cy, rx, ry, rot: r2 };
}

export function shapePoints(sh, p = 1) {
  const out = [];
  if (sh.type === 'line') {
    out.push({ x: sh.x1, y: sh.y1, p, t: 0 }, { x: sh.x2, y: sh.y2, p, t: 0 });
  } else if (sh.type === 'ellipse') {
    const n = Math.max(48, Math.ceil((sh.rx + sh.ry) / 3));
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * TAU, cr = Math.cos(sh.rot || 0), sr = Math.sin(sh.rot || 0), ex = Math.cos(t) * sh.rx, ey = Math.sin(t) * sh.ry;
      out.push({ x: sh.cx + ex * cr - ey * sr, y: sh.cy + ex * sr + ey * cr, p, t: 0 });
    }
  } else if (sh.type === 'arc') {
    // a true circular arc through start, middle and end
    const A = { x: sh.x1, y: sh.y1 }, M = { x: sh.mx, y: sh.my }, Bp = { x: sh.x2, y: sh.y2 }, c = circle3(A, M, Bp);
    if (!c) { out.push({ x: sh.x1, y: sh.y1, p, t: 0 }, { x: sh.x2, y: sh.y2, p, t: 0 }); return out; }
    const a0 = Math.atan2(A.y - c.cy, A.x - c.cx), am = Math.atan2(M.y - c.cy, M.x - c.cx), a1 = Math.atan2(Bp.y - c.cy, Bp.x - c.cx);
    const norm = (x) => ((x % TAU) + TAU) % TAU;
    let sweep = norm(a1 - a0);
    if (norm(am - a0) > sweep) sweep -= TAU; // go the way that passes through the middle point
    const n = Math.max(24, Math.ceil(Math.abs(sweep) * c.r / 3));
    for (let i = 0; i <= n; i++) { const t = a0 + sweep * i / n; out.push({ x: c.cx + Math.cos(t) * c.r, y: c.cy + Math.sin(t) * c.r, p, t: 0 }); }
  } else if (sh.type === 'poly') {
    const v = sh.closed ? sh.pts.concat([sh.pts[0]]) : sh.pts;
    for (let i = 0; i + 1 < v.length; i++) {
      const n = Math.max(2, Math.ceil(Math.hypot(v[i + 1].x - v[i].x, v[i + 1].y - v[i].y) / 4));
      for (let k = i ? 1 : 0; k <= n; k++) out.push({ x: v[i].x + (v[i + 1].x - v[i].x) * k / n, y: v[i].y + (v[i + 1].y - v[i].y) * k / n, p, t: 0 });
    }
  }
  return out;
}
