// Liquify (Procreate / Clip Studio style): Push, Twirl, Pinch, Expand, Reconstruct, Smooth.
// A displacement field on a coarse grid (one node every G px) says, for each output pixel,
// where in the original image to read from. Brush dabs edit the field; only the dab's area of
// the layer is re-sampled (bilinear, premultiplied alpha), so it stays fast on big canvases and
// strokes can be undone piecewise or reconstructed later in the same session.
import { h, toast, field, clamp } from './util.js';
import * as store from './storage.js';
import { snapshot, pixelCmd } from './history.js';

const G = 4;
const MODES = [
  ['push', 'Push'], ['twirlR', 'Twirl ↻'], ['twirlL', 'Twirl ↺'], ['pinch', 'Pinch'],
  ['expand', 'Expand'], ['reconstruct', 'Reconstruct'], ['smooth', 'Smooth'],
];

class Field {
  constructor(canvas) {
    this.canvas = canvas;
    const W = (this.W = canvas.width), H = (this.H = canvas.height);
    this.src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    this.gw = Math.ceil(W / G) + 1; this.gh = Math.ceil(H / G) + 1;
    this.dx = new Float32Array(this.gw * this.gh); this.dy = new Float32Array(this.gw * this.gh);
  }
  // displacement at a layer position (bilinear on the grid)
  disp(x, y) {
    const gx = clamp(x / G, 0, this.gw - 1.001), gy = clamp(y / G, 0, this.gh - 1.001);
    const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * this.gw + i, w = this.gw;
    const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
    return [this.dx[k] * a + this.dx[k + 1] * b + this.dx[k + w] * c + this.dx[k + w + 1] * d,
      this.dy[k] * a + this.dy[k + 1] * b + this.dy[k + w] * c + this.dy[k + w + 1] * d];
  }
  // apply one dab: fn(X, Y, weight) → [sampleX, sampleY] (semi-Lagrangian: the new field at a
  // node = where the old result had that content) or null to edit the field directly
  dab(cx, cy, r, op) {
    const i0 = Math.max(0, Math.floor((cx - r) / G)), i1 = Math.min(this.gw - 1, Math.ceil((cx + r) / G));
    const j0 = Math.max(0, Math.floor((cy - r) / G)), j1 = Math.min(this.gh - 1, Math.ceil((cy + r) / G));
    if (i1 < i0 || j1 < j0) return null;
    const nw = i1 - i0 + 1, nx = new Float32Array(nw * (j1 - j0 + 1)), ny = new Float32Array(nx.length), r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const X = i * G, Y = j * G, d2 = (X - cx) ** 2 + (Y - cy) ** 2, k = (j - j0) * nw + (i - i0), g = j * this.gw + i;
      if (d2 >= r2) { nx[k] = this.dx[g]; ny[k] = this.dy[g]; continue; }
      const t = 1 - d2 / r2, w = t * t;
      const res = op(X, Y, w, g);
      if (res.direct) { nx[k] = res.x; ny[k] = res.y; continue; }
      const [ddx, ddy] = this.disp(res.x, res.y);
      nx[k] = res.x - X + ddx; ny[k] = res.y - Y + ddy;
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = (j - j0) * nw + (i - i0), g = j * this.gw + i; this.dx[g] = nx[k]; this.dy[g] = ny[k]; }
    return { x: Math.max(0, i0 * G - G), y: Math.max(0, j0 * G - G), w: Math.min(this.W, i1 * G + G) - Math.max(0, i0 * G - G), h: Math.min(this.H, j1 * G + G) - Math.max(0, j0 * G - G) };
  }
  // re-sample a rect of the layer from the original through the field
  render(r) {
    const x0 = Math.max(0, r.x | 0), y0 = Math.max(0, r.y | 0), x1 = Math.min(this.W, Math.ceil(r.x + r.w)), y1 = Math.min(this.H, Math.ceil(r.y + r.h));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, hh = y1 - y0, out = new ImageData(w, hh), o = out.data, s = this.src, W = this.W, H = this.H;
    const DX = this.dx, DY = this.dy, gw = this.gw, gmx = this.gw - 1.001, gmy = this.gh - 1.001;
    for (let y = y0; y < y1; y++) {
      const gy = Math.min(y / G, gmy), j = gy | 0, gfy = gy - j;
      for (let x = x0; x < x1; x++) {
      const gx = Math.min(x / G, gmx), i = gx | 0, fx0 = gx - i, k = j * gw + i;
      const wa = (1 - fx0) * (1 - gfy), wb = fx0 * (1 - gfy), wc = (1 - fx0) * gfy, wd = fx0 * gfy;
      const ddx = DX[k] * wa + DX[k + 1] * wb + DX[k + gw] * wc + DX[k + gw + 1] * wd;
      const ddy = DY[k] * wa + DY[k + 1] * wb + DY[k + gw] * wc + DY[k + gw + 1] * wd;
      const sx = clamp(x + ddx, 0, W - 1.001), sy = clamp(y + ddy, 0, H - 1.001);
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const p00 = (iy * W + ix) * 4, p10 = p00 + (ix + 1 < W ? 4 : 0), p01 = p00 + (iy + 1 < H ? W * 4 : 0), p11 = p01 + (ix + 1 < W ? 4 : 0);
      const w00 = (1 - fx) * (1 - fy) * s[p00 + 3], w10 = fx * (1 - fy) * s[p10 + 3], w01 = (1 - fx) * fy * s[p01 + 3], w11 = fx * fy * s[p11 + 3];
      const a = w00 + w10 + w01 + w11, q = ((y - y0) * w + (x - x0)) * 4;
      if (a < 0.5) { o[q + 3] = 0; continue; }
      o[q] = (s[p00] * w00 + s[p10] * w10 + s[p01] * w01 + s[p11] * w11) / a;
      o[q + 1] = (s[p00 + 1] * w00 + s[p10 + 1] * w10 + s[p01 + 1] * w01 + s[p11 + 1] * w11) / a;
      o[q + 2] = (s[p00 + 2] * w00 + s[p10 + 2] * w10 + s[p01 + 2] * w01 + s[p11 + 2] * w11) / a;
      o[q + 3] = a;
      }
    }
    this.canvas.getContext('2d').putImageData(out, x0, y0);
  }
}

export function liquifyTool(app) {
  const pref = (k, d) => store.prefs.get(k, d), setPref = (k, v) => store.prefs.set(k, v);
  const t = {
    get mode() { return pref('lq.mode', 'push'); },
    get size() { return pref('lq.size', 140); },
    get strength() { return pref('lq.strength', 0.6); },
    sess: null, hover: null,
    exit() { this.stop(); this.sess = null; },
    target() {
      const tg = app.doc.getTarget(false);
      if (!tg || app.doc.isLocked(app.doc.activeItem)) { toast(tg ? 'This layer is locked' : 'Pick a raster layer to liquify'); return null; }
      return tg;
    },
    down(p) {
      const tg = this.target(); if (!tg) return false;
      const s = this.sess;
      // a new session when the layer changed in any other way (undo, painting…)
      if (!s || s.f.canvas !== tg.canvas || s.f.W !== tg.canvas.width || s.hist !== app.history.u.length) this.sess = { f: new Field(tg.canvas), tg, hist: app.history.u.length };
      snapshot(tg.canvas);
      const l = tg.toLocal(p.x, p.y);
      this.drag = { last: l, cur: l, pr: p.pressure || 1, dirty: null };
      this.hover = p;
      this.apply(l, { x: 0, y: 0 });
      // twirl / pinch / expand / reconstruct keep working while the pen rests
      if (this.mode !== 'push') this.timer = setInterval(() => { if (this.drag) this.apply(this.drag.cur, { x: 0, y: 0 }); }, 33);
    },
    move(p) {
      this.hover = p;
      const g = this.drag; if (!g || !this.sess) { app.requestRender('view'); return; }
      const l = this.sess.tg.toLocal(p.x, p.y);
      g.pr = p.pressure || 1;
      const r = this.radius(), step = Math.max(2, r * 0.12);
      const dx = l.x - g.last.x, dy = l.y - g.last.y, L = Math.hypot(dx, dy);
      const n = Math.floor(L / step);
      for (let k = 1; k <= n; k++) {
        const q = { x: g.last.x + (dx * k) / Math.max(n, 1), y: g.last.y + (dy * k) / Math.max(n, 1) };
        this.apply(q, { x: dx / Math.max(n, 1), y: dy / Math.max(n, 1) });
      }
      if (n) g.last = { x: g.last.x + dx, y: g.last.y + dy };
      g.cur = l;
    },
    up() {
      this.stop();
      const g = this.drag; this.drag = null;
      if (!g || !g.dirty || !this.sess) return;
      const r = g.dirty;
      const cmd = pixelCmd(this.sess.f.canvas, { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 }, 'Liquify', () => app.requestRender());
      if (cmd) app.history.push(cmd);
      this.sess.hist = app.history.u.length;
      app.changed('patched');
    },
    stop() { clearInterval(this.timer); this.timer = 0; },
    radius() { return this.size / 2; },
    apply(c, v) {
      const s = this.sess; if (!s) return;
      const f = s.f, r = this.radius(), k = this.strength * (0.35 + 0.65 * clamp(this.drag ? this.drag.pr : 1, 0, 1)), m = this.mode;
      let op;
      if (m === 'push') op = (X, Y, w) => ({ x: X - v.x * w * k * 1.6, y: Y - v.y * w * k * 1.6 });
      else if (m === 'twirlR' || m === 'twirlL') {
        op = (X, Y, w) => { const a = (m === 'twirlR' ? -1 : 1) * w * k * 0.09, cs = Math.cos(a), sn = Math.sin(a), ux = X - c.x, uy = Y - c.y; return { x: c.x + ux * cs - uy * sn, y: c.y + ux * sn + uy * cs }; };
      } else if (m === 'pinch' || m === 'expand') {
        op = (X, Y, w) => { const s2 = 1 + (m === 'pinch' ? 1 : -1) * w * k * 0.06; return { x: c.x + (X - c.x) * s2, y: c.y + (Y - c.y) * s2 }; };
      } else if (m === 'reconstruct') {
        op = (X, Y, w, gi) => { const d = 1 - Math.min(1, w * k * 0.25); return { direct: true, x: f.dx[gi] * d, y: f.dy[gi] * d }; };
      } else {
        op = (X, Y, w, gi) => {
          const gw = f.gw, nb = [gi - 1, gi + 1, gi - gw, gi + gw].filter((q) => q >= 0 && q < f.dx.length);
          let ax = 0, ay = 0; for (const q of nb) { ax += f.dx[q]; ay += f.dy[q]; }
          const a = Math.min(1, w * k * 0.5); return { direct: true, x: f.dx[gi] + (ax / nb.length - f.dx[gi]) * a, y: f.dy[gi] + (ay / nb.length - f.dy[gi]) * a };
        };
      }
      const rect = f.dab(c.x, c.y, r, op);
      if (!rect) return;
      f.render(rect);
      const g = this.drag;
      if (g) { const d = g.dirty || (g.dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }); d.x0 = Math.min(d.x0, rect.x); d.y0 = Math.min(d.y0, rect.y); d.x1 = Math.max(d.x1, rect.x + rect.w); d.y1 = Math.max(d.y1, rect.y + rect.h); }
      // patch only this area of the cached scene
      const tg = s.tg, M = tg.matrix;
      let dr = rect;
      if (M) { const pts = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].map(([x, y]) => M.transformPoint({ x, y })); const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); dr = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
      app.markDirty(dr);
    },
    overlayScreen(ctx) {
      const hv = app.hover || (this.drag && this.hover); if (!hv) return;
      const r = this.radius() * app.view.zoom;
      ctx.save(); ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(hv.sx, hv.sy, r + 1, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(hv.sx, hv.sy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    },
    resetAll() {
      const s = this.sess;
      if (!s) { toast('Nothing liquified yet'); return; }
      const f = s.f; snapshot(f.canvas);
      f.dx.fill(0); f.dy.fill(0); f.render({ x: 0, y: 0, w: f.W, h: f.H });
      const cmd = pixelCmd(f.canvas, null, 'Liquify reset', () => app.requestRender());
      if (cmd) app.history.push(cmd);
      s.hist = app.history.u.length;
      app.changed();
    },
    bar() {
      const m = this.mode;
      const btn = (label, fn, on, cls) => h('button', { class: 'cb-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
      const settings = h('div', { class: 'lq-set' },
        field('Size', { min: 10, max: 800, step: 2, value: this.size, fmt: (v) => v + ' px', onInput: (v) => { setPref('lq.size', v); app.requestRender('view'); } }),
        field('Pressure', { min: 0.05, max: 1, step: 0.01, value: this.strength, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => setPref('lq.strength', v) }));
      return [
        ...MODES.map(([k, label]) => btn(label, () => { setPref('lq.mode', k); app.updateCtxBar(); }, m === k)),
        h('span', { class: 'cb-sep' }), settings,
        btn('Reset', () => this.resetAll()),
        btn('Done', () => app.setTool(app.prevTool && app.prevTool !== 'liquify' ? app.prevTool : 'brush'), false, 'primary'),
      ];
    },
  };
  return t;
}
