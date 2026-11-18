// Webtoon / comic features: panel (frame) tool, balloon & text tool, auto layout,
// canvas extension, phone scroll preview, smart slicing export.
import { h, toast, dialog, clamp, makeCanvas, canvasToBlob, download, field, seg, switchRow, uid } from './util.js';
import { Layer, FONT_LABELS, panelShape, panelCorners } from './doc.js';
import * as store from './storage.js';
import * as UI from './ui.js';

function vecCmd(app, label, obj, key, before) {
  const after = JSON.stringify(obj[key]);
  if (after === before) return;
  app.history.push({ label, undo() { obj[key] = JSON.parse(before); app.changed(); }, redo() { obj[key] = JSON.parse(after); app.changed(); } });
}

function ensureLayer(app, type, name) {
  const d = app.doc;
  const act = d.activeItem;
  if (act && act.type === type) return act;
  let l = d.layers.find((x) => x.type === type);
  if (!l) { l = new Layer(d.width, d.height, { type, name }); UI.insertLayer(app, l, d.layers.length); }
  // make it the active layer so dragging only redraws this layer (the rest stays cached)
  d.active = d.layers.indexOf(l);
  return l;
}

const cb = (label, fn, on = false, cls = '') => h('button', { class: 'cb-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
const sep = () => h('span', { class: 'cb-sep' });

export function drawGuides(app, ctx, px) {
  const d = app.doc, sh = d.webtoon.sliceHeight;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,80,90,0.55)'; ctx.lineWidth = 1 * px; ctx.setLineDash([10 * px, 8 * px]);
  ctx.beginPath();
  for (let y = sh; y < d.height; y += sh) { ctx.moveTo(-30 * px, y); ctx.lineTo(d.width + 30 * px, y); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,80,90,0.8)'; ctx.font = `${11 * px}px -apple-system, sans-serif`;
  let i = 1;
  for (let y = 0; y < d.height; y += sh) ctx.fillText(String(i++), -24 * px, y + 14 * px);
  ctx.restore();
}

// ───────── panel tool ─────────
// ── panel geometry helpers ──
const ptsOf = (p) => (p.pts ? p.pts.map((q) => [...q]) : panelCorners(p).map((q) => [...q]));
function setPts(p, pts) {
  p.pts = pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  delete p.sk;
  const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
  p.x = Math.min(...xs); p.y = Math.min(...ys); p.w = Math.max(...xs) - p.x; p.h = Math.max(...ys) - p.y;
  return p;
}
function inPanel(p, x, y) {
  if (!p.pts && !p.sk) return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
  const c = ptsOf(p); let inside = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xi, yi] = c[i], [xj, yj] = c[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const area = (c) => { let a = 0; for (let i = 0; i < c.length; i++) { const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % c.length]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; };
// keep the part of polygon c where side(pt) >= 0 (Sutherland–Hodgman against one half-plane)
function clipHalf(c, side) {
  const out = [];
  for (let i = 0; i < c.length; i++) {
    const A = c[i], B = c[(i + 1) % c.length], da = side(A), db = side(B);
    if (da >= 0) out.push(A);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
  }
  return out;
}
// simplify a freehand outline (Ramer–Douglas–Peucker)
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let md = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L; if (d > md) { md = d; mi = i; } }
  return md > eps ? [...rdp(pts.slice(0, mi + 1), eps).slice(0, -1), ...rdp(pts.slice(mi), eps)] : [a, b];
}
// snap a segment's direction to 0 / 45 / 90° when it's close (straight frame lines)
function snapDir(from, to, deg = 4) {
  const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy); if (!len) return to;
  const a = Math.atan2(dy, dx), s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  return Math.abs(a - s) < deg * Math.PI / 180 ? [from[0] + Math.cos(s) * len, from[1] + Math.sin(s) * len] : to;
}

export function panelTool(app) {
  const t = {
    sel: -1, mode: 'rect', poly: null, free: null, cut: null,
    layer() { return ensureLayer(app, 'frames', 'Panels'); },
    panels() { const l = app.doc.layers.find((x) => x.type === 'frames'); return l ? l.panels : []; },
    enter() { this.sel = -1; this.poly = null; this.free = null; this.cut = null; },
    exit() { if (this.poly && this.poly.length >= 3) this.finishPoly(); this.poly = null; },
    setMode(m) { if (this.poly && this.poly.length >= 3) this.finishPoly(); this.mode = m; this.poly = null; this.sel = -1; app.updateCtxBar(); app.requestRender(); },
    down(p) {
      const L = this.layer(), P = L.panels, hs = 18 / app.view.zoom;
      this.before = JSON.stringify(P); this.L = L; this.p0 = p;
      if (this.mode === 'cut') { this.drag = { type: 'cut' }; this.cut = [[p.x, p.y], [p.x, p.y]]; return; }
      if (this.mode === 'free') { this.drag = { type: 'free' }; this.free = [[p.x, p.y]]; return; }
      if (this.mode === 'poly') {
        this.drag = { type: 'poly' };
        if (!this.poly) this.poly = [];
        const first = this.poly[0];
        if (first && this.poly.length >= 3 && Math.hypot(p.x - first[0], p.y - first[1]) < hs * 1.4) { this.drag.close = true; return; }
        const last = this.poly[this.poly.length - 1];
        this.poly.push(last ? snapDir(last, [p.x, p.y]) : [p.x, p.y]);
        app.updateCtxBar(); app.requestRender('active');
        return;
      }
      const s = P[this.sel];
      if (s) {
        const corners = ptsOf(s);
        const ci = corners.findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < hs);
        if (ci >= 0) { this.drag = s.pts || s.sk ? { type: 'vertex', ci, orig: corners } : { type: 'resize', ci, orig: { ...s } }; return; }
      }
      let hit = -1;
      for (let i = P.length - 1; i >= 0; i--) if (inPanel(P[i], p.x, p.y)) { hit = i; break; }
      if (hit >= 0) { this.sel = hit; this.drag = { type: 'move', orig: { ...P[hit], pts: P[hit].pts && P[hit].pts.map((q) => [...q]) } }; app.updateCtxBar(); return; }
      this.sel = -1; app.updateCtxBar();
      this.drag = { type: 'new' };
      this.cur = { x: p.x, y: p.y, w: 0, h: 0 };
    },
    move(p) {
      const g = this.drag; if (!g) return;
      const P = this.L.panels, dx = p.x - this.p0.x, dy = p.y - this.p0.y;
      if (g.type === 'cut') { this.cut[1] = snapDir(this.cut[0], [p.x, p.y]); }
      else if (g.type === 'free') { const l = this.free[this.free.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) > 3 / app.view.zoom) this.free.push([p.x, p.y]); }
      else if (g.type === 'poly') { if (!g.close && this.poly.length) { const prev = this.poly[this.poly.length - 2]; this.poly[this.poly.length - 1] = prev ? snapDir(prev, [p.x, p.y]) : [p.x, p.y]; } }
      else if (g.type === 'new') {
        this.cur = { x: Math.min(p.x, this.p0.x), y: Math.min(p.y, this.p0.y), w: Math.abs(dx), h: Math.abs(dy) };
      } else if (g.type === 'move') {
        const o = g.orig, s = P[this.sel];
        if (o.pts) setPts(s, o.pts.map(([x, y]) => [x + dx, y + dy]));
        else Object.assign(s, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
      } else if (g.type === 'vertex') {
        const c = g.orig.map((q) => [...q]); c[g.ci] = [c[g.ci][0] + dx, c[g.ci][1] + dy];
        setPts(P[this.sel], c);
      } else if (g.type === 'resize') {
        const o = g.orig; let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (g.ci === 0 || g.ci === 3) x0 += dx; else x1 += dx;
        if (g.ci === 0 || g.ci === 1) y0 += dy; else y1 += dy;
        Object.assign(P[this.sel], { x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(Math.abs(x1 - x0)), h: Math.round(Math.abs(y1 - y0)) });
      }
      app.requestRender('active');
    },
    up() {
      const g = this.drag; this.drag = null;
      if (!g) return;
      const z = app.view.zoom;
      if (g.type === 'poly') { if (g.close) this.finishPoly(); app.requestRender(); return; }
      if (g.type === 'free') {
        const f = this.free; this.free = null;
        // closed outline: split at the point farthest from the start, simplify both halves
        let fi = 0, fd = 0; f.forEach((q, i) => { const dd = Math.hypot(q[0] - f[0][0], q[1] - f[0][1]); if (dd > fd) { fd = dd; fi = i; } });
        const pts = fi > 0 ? [...rdp(f.slice(0, fi + 1), 4 / z).slice(0, -1), ...rdp(f.slice(fi), 4 / z)] : f;
        if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 8 / z) pts.pop();
        if (pts.length >= 3 && area(pts) * z * z > 400) { this.L.panels.push(setPts({ id: uid(), style: store.prefs.get('panelStyle', 'solid'), free: true }, pts)); this.sel = this.L.panels.length - 1; }
        vecCmd(app, 'Freehand panel', this.L, 'panels', this.before); app.changed(); app.updateCtxBar(); return;
      }
      if (g.type === 'cut') { const c = this.cut; this.cut = null; if (Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) * z > 20) this.divide(c[0], c[1]); app.requestRender(); return; }
      if (g.type === 'new') {
        const c = this.cur; this.cur = null;
        if (c.w * z < 12 || c.h * z < 12) { this.sel = -1; app.updateCtxBar(); app.requestRender(); return; }
        const d = app.doc;
        // snap horizontally to page margins when close
        const m = d.webtoon.margin ?? 0, snap = 24 / z;
        if (Math.abs(c.x - m) < snap) { c.w += c.x - m; c.x = m; }
        if (Math.abs(c.x + c.w - (d.width - m)) < snap) c.w = d.width - m - c.x;
        this.L.panels.push({ id: uid(), x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h), style: store.prefs.get('panelStyle', 'solid') });
        this.sel = this.L.panels.length - 1;
      }
      vecCmd(app, 'Panel', this.L, 'panels', this.before);
      app.changed(); app.updateCtxBar();
    },
    finishPoly() {
      const L = this.layer(), pts = this.poly; this.poly = null;
      if (!pts || pts.length < 3 || area(pts) < 100) { app.updateCtxBar(); return; }
      const before = JSON.stringify(L.panels);
      L.panels.push(setPts({ id: uid(), style: store.prefs.get('panelStyle', 'solid') }, pts));
      this.sel = L.panels.length - 1;
      vecCmd(app, 'Polygon panel', L, 'panels', before); app.changed(); app.updateCtxBar();
    },
    // Clip Studio "Divide frame": a line cuts every panel it crosses in two, leaving a gutter
    divide(A, B) {
      const L = this.layer(), before = JSON.stringify(L.panels), w = app.doc.webtoon;
      const gap = Math.max(4, Math.round((w.cutGap ?? Math.min(40, (w.gutter ?? 120) / 3)))) / 2;
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len;
      const sd = (q) => (q[0] - A[0]) * nx + (q[1] - A[1]) * ny;
      const bb = { x0: Math.min(A[0], B[0]), x1: Math.max(A[0], B[0]), y0: Math.min(A[1], B[1]), y1: Math.max(A[1], B[1]) };
      const out = []; let n = 0;
      for (const p of L.panels) {
        const c = ptsOf(p), ds = c.map(sd);
        const crosses = Math.min(...ds) < -gap && Math.max(...ds) > gap && !(bb.x1 < p.x || bb.x0 > p.x + p.w || bb.y1 < p.y || bb.y0 > p.y + p.h);
        if (!crosses) { out.push(p); continue; }
        const a = clipHalf(c, (q) => sd(q) - gap), b = clipHalf(c, (q) => -sd(q) - gap);
        for (const [part, keepId] of [[a, true], [b, false]]) if (part.length >= 3 && area(part) > 100) out.push(setPts({ ...p, id: keepId ? p.id : uid(), r: p.r, free: undefined }, part));
        n++;
      }
      if (!n) { toast('Draw the cut line across a panel'); return; }
      L.panels = out; this.sel = -1;
      vecCmd(app, 'Divide panel', L, 'panels', before); app.changed(); app.updateCtxBar();
    },
    cancel() { this.drag = null; this.cur = null; this.free = null; this.cut = null; },
    onDelete() { this.del(); },
    del() {
      const L = this.layer(); if (this.sel < 0 || !L.panels[this.sel]) return;
      const before = JSON.stringify(L.panels);
      L.panels.splice(this.sel, 1); this.sel = -1;
      vecCmd(app, 'Delete panel', L, 'panels', before); app.changed(); app.updateCtxBar();
    },
    split(dir) {
      const L = this.layer(), s = L.panels[this.sel]; if (!s) return;
      if (s.pts) { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; this.divide(dir === 'h' ? [s.x - 10, cy] : [cx, s.y - 10], dir === 'h' ? [s.x + s.w + 10, cy] : [cx, s.y + s.h + 10]); return; }
      const before = JSON.stringify(L.panels), g = app.doc.webtoon.gutter;
      let a, b;
      const k = s.sk || [0, 0, 0, 0];
      if (dir === 'h') { const h1 = Math.round((s.h - g) / 2); a = { ...s, h: h1, sk: [k[0], k[1], 0, 0] }; b = { ...s, id: uid(), y: s.y + h1 + g, h: s.h - h1 - g, sk: [0, 0, k[2], k[3]] }; }
      else {
        const w1 = Math.round((s.w - g / 2) / 2), f = w1 / s.w;
        const mt = k[0] + (k[1] - k[0]) * f, mb = k[3] + (k[2] - k[3]) * f;
        a = { ...s, w: w1, sk: [k[0], mt, mb, k[3]] }; b = { ...s, id: uid(), x: s.x + w1 + Math.round(g / 2), w: s.w - w1 - Math.round(g / 2), sk: [mt, k[1], k[2], mb] };
      }
      if (a.w < 10 || a.h < 10 || b.w < 10 || b.h < 10) { toast('Panel too small to split'); return; }
      L.panels.splice(this.sel, 1, a, b);
      vecCmd(app, 'Split panel', L, 'panels', before); app.changed();
    },
    overlay(ctx, px) {
      const P = this.panels();
      ctx.save();
      ctx.lineWidth = 2 * px; ctx.strokeStyle = 'rgba(61,139,255,0.5)'; ctx.setLineDash([6 * px, 6 * px]);
      for (const q of P) { panelShape(ctx, q, 0, true); ctx.stroke(); }
      ctx.setLineDash([]);
      const s = P[this.sel];
      const dot = (x, y, r = 8) => { ctx.beginPath(); ctx.arc(x, y, r * px, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); };
      if (s) {
        ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2.5 * px; panelShape(ctx, s, 0, true); ctx.stroke();
        const c = ptsOf(s);
        if (!s.free || c.length <= 24) for (const [x, y] of c) dot(x, y);
        ctx.fillStyle = '#3d8bff'; ctx.font = `600 ${13 * px}px -apple-system, sans-serif`;
        ctx.fillText(`${s.w} × ${s.h}`, s.x + 6 * px, s.y - 8 * px);
      }
      ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2 * px;
      if (this.cur) ctx.strokeRect(this.cur.x, this.cur.y, this.cur.w, this.cur.h);
      if (this.poly && this.poly.length) {
        ctx.beginPath(); this.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        ctx.setLineDash([5 * px, 5 * px]); ctx.beginPath(); const l = this.poly[this.poly.length - 1]; ctx.moveTo(l[0], l[1]); ctx.lineTo(this.poly[0][0], this.poly[0][1]); ctx.stroke(); ctx.setLineDash([]);
        this.poly.forEach(([x, y], i) => dot(x, y, i ? 5 : 9));
      }
      if (this.free && this.free.length > 1) { ctx.beginPath(); this.free.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      if (this.cut) {
        ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 2.5 * px; ctx.setLineDash([10 * px, 6 * px]);
        ctx.beginPath(); ctx.moveTo(...this.cut[0]); ctx.lineTo(...this.cut[1]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    },
    bar() {
      const has = this.sel >= 0 && this.panels()[this.sel];
      const modeBtn = (m, label) => cb(label, () => this.setMode(m), this.mode === m);
      const hints = { rect: has ? 'Panel selected' : 'Drag to draw a panel', poly: this.poly && this.poly.length ? 'Tap the next corner · tap the first dot to close' : 'Tap the corners of your panel', free: 'Draw the panel’s outline', cut: 'Draw a line across panels to divide them' };
      return [
        modeBtn('rect', '▭ Rectangle'), modeBtn('poly', '⬠ Polygon'), modeBtn('free', '✎ Freehand'), modeBtn('cut', '✂ Cut'),
        sep(),
        h('span', { class: 'cb-label' }, hints[this.mode]),
        this.mode === 'poly' && this.poly && this.poly.length >= 3 && cb('Finish', () => this.finishPoly(), false, 'primary'),
        this.mode === 'poly' && this.poly && this.poly.length && cb('Undo point', () => { this.poly.pop(); if (!this.poly.length) this.poly = null; app.updateCtxBar(); app.requestRender(); }),
        this.mode === 'rect' && cb('Auto layout…', () => autoPanelsDialog(app)),
        has && cb('Style…', () => panelStyleDialog(app, this)),
        has && cb('Split ═', () => this.split('h')), has && cb('Split ║', () => this.split('v')), has && cb('Delete', () => this.del()),
        sep(), cb('Extend canvas', () => extendDialog(app)), cb('Phone preview', () => phonePreview(app)), cb('Export', () => exportSlicesDialog(app), false, 'primary'),
      ].filter(Boolean);
    },
  };
  return t;
}

// ───────── panel layout styles ─────────
export const PANEL_LAYOUTS = [
  ['stack', 'Stacked', 'One full-width panel per beat'],
  ['cinema', 'Cinematic', 'Wide, short letterbox panels'],
  ['pairs', 'Side by side', 'Two panels in each row'],
  ['alt', 'Alternating 1 / 2', 'A wide panel, then two side by side'],
  ['trio', 'Wide + three', 'A wide panel, then a row of three'],
  ['stagger', 'Staggered', 'Narrower panels stepping left and right'],
  ['slant', 'Slanted cuts', 'Diagonal edges between panels for action'],
  ['bleed', 'Borderless bleed', 'Edge-to-edge panels, no frame'],
  ['mixed', 'Dynamic mix', 'A varied rhythm of all of the above'],
];
export const PANEL_STYLES = [['solid', 'Solid'], ['rounded', 'Rounded'], ['double', 'Double'], ['dashed', 'Dashed'], ['rough', 'Hand-drawn'], ['none', 'None']];

// Build panels for one layout from y = start. Returns {panels, end}.
export function layoutPanels(kind, o, W, start) {
  const out = [], m = o.margin, g = o.gutter, iw = W - m * 2, H = o.height, st = o.style;
  const P = (x, y, w, hh, extra = {}) => out.push({ id: uid(), x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh), style: st, ...extra });
  let y = start;
  const vgap = Math.max(16, Math.round(g / 4)); // gap between panels in one row
  const rowOf = (n, hh, kk = null) => { const w = (iw - vgap * (n - 1)) / n; for (let i = 0; i < n; i++) P(m + i * (w + vgap), y, w, hh, kk ? { sk: kk(i, n) } : {}); y += hh + g; };
  const kinds = kind === 'mixed' ? ['stack', 'pairs', 'stagger', 'slant', 'cinema', 'trio', 'stack', 'alt'] : [kind];
  let made = 0, step = 0;
  while (made < o.count) {
    const k = kinds[step++ % kinds.length], left = o.count - made;
    if (k === 'stack') { P(m, y, iw, H); y += H + g; made++; }
    else if (k === 'cinema') { const hh = Math.max(200, Math.round(iw * 0.42)); P(m, y, iw, hh); y += hh + g; made++; }
    else if (k === 'pairs') { const n = Math.min(2, left); rowOf(n, Math.round(H * 0.8)); made += n; }
    else if (k === 'trio') { if (made % 4 === 0 || left === 1) { P(m, y, iw, H); y += H + g; made++; } else { const n = Math.min(3, left); rowOf(n, Math.round(H * 0.6)); made += n; } }
    else if (k === 'alt') { if ((step - 1) % 2 === 0 || left === 1) { P(m, y, iw, H); y += H + g; made++; } else { const n = Math.min(2, left); rowOf(n, Math.round(H * 0.75)); made += n; } }
    else if (k === 'stagger') { const w = iw * 0.72, right = made % 2 === 1; P(right ? m + iw - w : m, y, w, H * 0.85); y += H * 0.85 + g * 0.6; made++; }
    else if (k === 'slant') {
      // consecutive panels share a diagonal cut: this panel's bottom edge matches the next one's top
      const s = Math.round(Math.min(H * 0.35, iw * 0.18)), dir = made % 2 ? -1 : 1;
      const prev = out[out.length - 1];
      const top = prev && prev._slant ? prev._slant : [0, 0];
      const bot = left > 1 && kind !== 'mixed' || (kind === 'mixed' && left > 1) ? [-s / 2 * dir, s / 2 * dir] : [0, 0];
      P(m, y, iw, H, { sk: [top[0], top[1], bot[1], bot[0]], _slant: bot }); y += H + g * 0.5; made++;
    } else if (k === 'bleed') { P(0, y, W, H, { style: 'none' }); y += H + Math.round(g * 0.5); made++; }
  }
  for (const p of out) delete p._slant;
  // a slanted panel followed by a non-slanted one: flatten the dangling cut
  for (let i = 0; i < out.length; i++) { const p = out[i], nx = out[i + 1]; if (p.sk && (!nx || !nx.sk)) { p.sk = [p.sk[0], p.sk[1], 0, 0]; } if (p.sk && p.sk.every((v) => !v)) delete p.sk; }
  return { panels: out, end: y - g };
}

function layoutThumb(kind, style) {
  const c = makeCanvas(84, 150), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 84, 150);
  // laid out at real webtoon size (800 px wide), drawn scaled down
  const k = 84 / 800, { panels } = layoutPanels(kind, { count: kind === 'mixed' ? 8 : 6, margin: 40, gutter: 110, height: 420, style }, 800, 60);
  x.scale(k, k); x.strokeStyle = '#111'; x.fillStyle = '#e8eaf0';
  for (const p of panels) { if (p.y > 150 / k) break; panelShape(x, p, 0, true); x.fill(); if ((p.style || style) !== 'none') { x.lineWidth = 2 / k; x.setLineDash((p.style || style) === 'dashed' ? [40, 28] : []); x.stroke(); } }
  return c;
}

export function autoPanelsDialog(app) {
  const d = app.doc, w = d.webtoon;
  const o = { count: 5, margin: w.margin ?? 40, gutter: w.gutter ?? 120, top: 200, height: 900, replace: true, kind: store.prefs.get('panelLayout', 'stack'), style: store.prefs.get('panelStyle', 'solid') };
  const grid = h('div', { class: 'layout-grid' });
  const drawGrid = () => {
    grid.innerHTML = '';
    for (const [k, label, tip] of PANEL_LAYOUTS) {
      const b = h('button', { class: 'layout-opt' + (o.kind === k ? ' on' : ''), title: tip, onclick: () => { o.kind = k; drawGrid(); } }, layoutThumb(k, o.style), h('span', {}, label));
      grid.append(b);
    }
  };
  drawGrid();
  const body = h('div', {},
    h('div', { class: 'menu-section' }, 'Layout'), grid,
    h('div', { class: 'menu-section' }, 'Border'),
    seg(PANEL_STYLES, o.style, (v) => { o.style = v; drawGrid(); }),
    field('Panels', { min: 1, max: 20, step: 1, value: o.count, fmt: (v) => v, onInput: (v) => (o.count = v) }),
    field('Panel height', { min: 200, max: 3000, step: 10, value: o.height, fmt: (v) => v + ' px', onInput: (v) => (o.height = v) }),
    field('Gutter (vertical space between panels)', { min: 0, max: 800, step: 10, value: o.gutter, fmt: (v) => v + ' px', onInput: (v) => (o.gutter = v) }),
    field('Side margin', { min: 0, max: 300, step: 2, value: o.margin, fmt: (v) => v + ' px', onInput: (v) => (o.margin = v) }),
    field('Top margin', { min: 0, max: 1500, step: 10, value: o.top, fmt: (v) => v + ' px', onInput: (v) => (o.top = v) }),
    switchRow('Replace existing panels', o.replace, (v) => (o.replace = v)),
    h('p', {}, 'Webtoons read top-to-bottom: generous gutters create pacing. The canvas extends automatically if needed. Tap a panel with the Panel tool, then Style… to change one panel.'),
  );
  dialog({ title: 'Auto panel layout', body, actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: () => {
    w.gutter = o.gutter; w.margin = o.margin;
    store.prefs.set('panelLayout', o.kind); store.prefs.set('panelStyle', o.style);
    const L = ensureLayer(app, 'frames', 'Panels');
    const before = JSON.stringify(L.panels);
    const start = o.replace || !L.panels.length ? o.top : Math.max(...L.panels.map((p) => p.y + p.h)) + o.gutter;
    const lay = layoutPanels(o.kind, o, d.width, start);
    const need = lay.end + o.top;
    if (need > d.height) {
      const ok = extendTo(app, need);
      if (!ok) return false;
    }
    L.panels = o.replace ? lay.panels : [...L.panels, ...lay.panels];
    vecCmd(app, 'Auto layout', L, 'panels', before);
    app.changed();
  } }] });
}

// Style of the selected panel: border style, corner radius, slanted top / bottom edges.
function panelStyleDialog(app, tool) {
  const L = tool.layer(), p = L.panels[tool.sel]; if (!p) return;
  const before = JSON.stringify(L.panels);
  const sk = p.sk ? [...p.sk] : [0, 0, 0, 0];
  const lim = Math.round(Math.min(p.h * 0.45, 600));
  const live = () => { p.sk = sk.some((v) => v) ? [...sk] : undefined; if (!p.sk) delete p.sk; app.changed(); app.requestRender(); };
  const body = h('div', {},
    h('div', { class: 'menu-section' }, 'Border'),
    seg(PANEL_STYLES, p.style || L.panelStyle || 'solid', (v) => { p.style = v; live(); }),
    field('Corner radius', { min: 0, max: 200, step: 2, value: p.r ?? (p.style === 'rounded' ? 36 : 0), fmt: (v) => v + ' px', onInput: (v) => { p.r = v; live(); } }),
    ...(p.pts ? [h('p', { class: 'hint' }, 'Free-shaped panel: drag its corner dots with the Panel tool to reshape it.')] : [h('div', { class: 'menu-section' }, 'Slant'),
    field('Top edge tilt', { min: -lim, max: lim, step: 2, value: (sk[1] - sk[0]) / 2, fmt: (v) => Math.round(v) + ' px', onInput: (v) => { sk[0] = -v; sk[1] = v; live(); } }),
    field('Bottom edge tilt', { min: -lim, max: lim, step: 2, value: (sk[2] - sk[3]) / 2, fmt: (v) => Math.round(v) + ' px', onInput: (v) => { sk[3] = -v; sk[2] = v; live(); } }),
    h('p', { class: 'hint' }, 'Tip: give a panel a bottom tilt and the panel below the same top tilt for a matching diagonal cut.')]),
  );
  dialog({ title: 'Panel style', body, actions: [
    { label: 'Cancel', onClick: () => { L.panels = JSON.parse(before); app.changed(); } },
    { label: 'Apply to all panels', onClick: () => { for (const q of L.panels) { q.style = p.style; if (p.r != null) q.r = p.r; } vecCmd(app, 'Panel style', L, 'panels', before); app.changed(); } },
    { label: 'Done', primary: true, onClick: () => { vecCmd(app, 'Panel style', L, 'panels', before); app.changed(); } },
  ] });
}

function extendTo(app, newH) {
  const d = app.doc;
  newH = Math.ceil(newH / 100) * 100;
  if (d.width * newH > 16.7e6) { toast(`Max height at this width is ~${Math.floor(16.7e6 / d.width)}px (iPad limit). Split into another episode file.`, 4000); return false; }
  const bytes = d.width * newH * 4 * (d.rasterCount() + 5);
  if (bytes > app.settings.memoryMB * 1e6) { toast('Not enough memory budget for that height with this many layers — merge layers or raise the limit in Settings.', 4000); return false; }
  UI.resizeDoc(app, d.width, newH, 0, 0);
  toast(`Canvas extended to ${newH}px (undo history cleared)`);
  return true;
}

export function extendDialog(app) {
  const d = app.doc;
  let add = 1600;
  dialog({
    title: 'Extend canvas',
    body: h('div', {}, h('p', {}, `Currently ${d.width} × ${d.height}px.`), field('Add to bottom', { min: 200, max: 8000, step: 100, value: add, fmt: (v) => '+' + v + ' px', onInput: (v) => (add = v) })),
    actions: [{ label: 'Cancel' }, { label: 'Extend', primary: true, onClick: () => extendTo(app, d.height + add) || false }],
  });
}

export async function phonePreview(app) {
  const c = app.doc.flatten({ bg: true });
  const url = URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.85));
  dialog({
    title: 'Phone preview', body: h('div', {}, h('div', { class: 'phone-frame' }, h('img', { src: url })), h('p', { class: 'hint', style: { textAlign: 'center' } }, 'Scroll inside the phone to read the episode as readers will.')),
    actions: [{ label: 'Close', primary: true }], onClose: () => URL.revokeObjectURL(url),
  });
}

export function sliceCuts(height, maxH, panels, smart) {
  const cuts = [];
  let y = 0;
  while (y < height) {
    let c = Math.min(height, y + maxH);
    if (c < height && smart) {
      const inside = (yy) => panels.some((p) => yy > p.y + 1 && yy < p.y + p.h - 1);
      let best = -1;
      for (let k = c; k > y + maxH * 0.4; k--) if (!inside(k)) { best = k; break; }
      if (best > 0) {
        // centre the cut in the gutter it landed in
        let top = best; while (top > y + 1 && !inside(top - 1)) top--;
        // only centre when the gutter is bounded by a panel above (otherwise keep the slice full)
        c = top > y + maxH * 0.4 && best < c ? Math.round((best + top) / 2) : best;
      }
    }
    cuts.push([y, c]);
    y = c;
  }
  return cuts;
}

export function exportSlicesDialog(app) {
  const d = app.doc, w = d.webtoon;
  const o = { slice: w.sliceHeight, type: 'jpeg', smart: true, full: false, width: d.width };
  dialog({
    title: 'Export episode',
    body: h('div', {},
      field('Max slice height', { min: 400, max: 5000, step: 10, value: o.slice, fmt: (v) => v + ' px', onInput: (v) => { o.slice = v; w.sliceHeight = v; app.requestRender(); } }),
      field('Output width', { min: 320, max: d.width * 2, step: 10, value: o.width, fmt: (v) => v + ' px', onInput: (v) => (o.width = v) }),
      h('div', { class: 'stack' }, h('label', {}, 'Format'), seg([['jpeg', 'JPEG (smaller)'], ['png', 'PNG (lossless)']], o.type, (v) => (o.type = v))),
      switchRow("Smart cuts (don't slice through panels)", o.smart, (v) => (o.smart = v)),
      switchRow('Also include one full-length image', o.full, (v) => (o.full = v)),
      h('p', {}, 'Most platforms (e.g. WEBTOON CANVAS) accept 800px-wide images up to 1280px tall each.')),
    actions: [{ label: 'Cancel' }, { label: 'Export .zip', primary: true, onClick: async () => {
      toast('Rendering slices…', 10000);
      const full = d.flatten({ bg: true });
      const k = o.width / d.width;
      const cuts = sliceCuts(d.height, Math.floor(o.slice / k), d.panels(), o.smart);
      const JSZip = await UI.loadZip();
      const zip = new JSZip();
      const ext = o.type === 'png' ? 'png' : 'jpg';
      let i = 1;
      for (const [a, b] of cuts) {
        const c = makeCanvas(o.width, Math.round((b - a) * k));
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
        x.drawImage(full, 0, a, d.width, b - a, 0, 0, c.width, c.height);
        zip.file(`${String(i++).padStart(3, '0')}.${ext}`, await canvasToBlob(c, 'image/' + o.type, 0.92));
      }
      if (o.full) {
        const c = makeCanvas(o.width, Math.round(d.height * k));
        c.getContext('2d').drawImage(full, 0, 0, c.width, c.height);
        zip.file(`full.${ext}`, await canvasToBlob(c, 'image/' + o.type, 0.92));
      }
      download(await zip.generateAsync({ type: 'blob' }), (d.name || 'episode') + ' slices.zip');
      toast(`Exported ${cuts.length} slices`);
    } }],
  });
}

// ───────── balloon / text tool ─────────
const SHAPES = [['none', 'Text'], ['ellipse', 'Speech'], ['cloud', 'Thought'], ['burst', 'Shout'], ['rect', 'Box']];

export function balloonTool(app) {
  const t = {
    sel: null, defaults: { shape: 'ellipse', font: 'comic', fontSize: 30 },
    layer() { return ensureLayer(app, 'balloons', app.doc.mode === 'webtoon' ? 'Balloons & Text' : 'Text & Bubbles'); },
    list() { const l = app.doc.layers.find((x) => x.type === 'balloons'); return l ? l.balloons : []; },
    selB() { return this.list().find((b) => b.id === this.sel); },
    enter() { this.sel = null; },
    down(p) {
      const L = this.layer(); this.L = L; this.p0 = p; this.before = JSON.stringify(L.balloons);
      const hs = 18 / app.view.zoom;
      const s = this.selB();
      if (s) {
        if (s.tail && Math.hypot(p.x - s.tail.x, p.y - s.tail.y) < hs) { this.drag = { type: 'tail', orig: { ...s.tail } }; return; }
        if (Math.hypot(p.x - (s.x + s.w), p.y - (s.y + s.h)) < hs) { this.drag = { type: 'resize', orig: { ...s } }; return; }
      }
      const hit = [...L.balloons].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
      if (hit) {
        const now = performance.now();
        if (this.sel === hit.id && now - (this.lastTap || 0) < 350) { this.drag = null; editBalloon(app, this, hit); return; }
        this.lastTap = now;
        this.sel = hit.id; this.drag = { type: 'move', orig: { ...hit, tail: hit.tail && { ...hit.tail } } };
        app.updateCtxBar();
        return;
      }
      this.drag = { type: 'new' }; this.cur = null;
    },
    move(p) {
      const g = this.drag; if (!g) return;
      const dx = p.x - this.p0.x, dy = p.y - this.p0.y, s = this.selB();
      if (g.type === 'new') this.cur = { x: Math.min(p.x, this.p0.x), y: Math.min(p.y, this.p0.y), w: Math.abs(dx), h: Math.abs(dy) };
      else if (g.type === 'move' && s) { s.x = g.orig.x + dx; s.y = g.orig.y + dy; if (s.tail) { s.tail.x = g.orig.tail.x + dx; s.tail.y = g.orig.tail.y + dy; } }
      else if (g.type === 'resize' && s) { s.w = Math.max(40, g.orig.w + dx); s.h = Math.max(30, g.orig.h + dy); }
      else if (g.type === 'tail' && s) { s.tail.x = g.orig.x + dx; s.tail.y = g.orig.y + dy; }
      app.requestRender('active');
    },
    up(p) {
      const g = this.drag; this.drag = null;
      if (!g) return;
      if (g.type === 'new') {
        const c = this.cur; this.cur = null;
        if (this.sel) { this.sel = null; app.updateCtxBar(); app.requestRender(); if (!c || c.w * app.view.zoom < 20) return; }
        // default sizes scale with the canvas (tuned for an ~800–1000 px wide page)
        const k = Math.max(1, Math.min(app.doc.width, app.doc.height) / 1000);
        const shape = this.defaults.shape;
        const bw = c && c.w * app.view.zoom > 20 ? c.w : 320 * k, bh = c && c.h * app.view.zoom > 20 ? c.h : (shape === 'none' ? 120 : 190) * k;
        const bx = c && c.w * app.view.zoom > 20 ? c.x : p.x - bw / 2, by = c && c.h * app.view.zoom > 20 ? c.y : p.y - bh / 2;
        const b = { id: uid(), x: bx, y: by, w: bw, h: bh, shape, text: '', font: this.defaults.font, fontSize: Math.round((shape === 'none' ? Math.max(36, this.defaults.fontSize) : this.defaults.fontSize) * k), fill: '#ffffff', stroke: '#000000', textColor: shape === 'none' ? app.color : '#000000',
          tail: shape === 'none' || shape === 'rect' ? null : { x: bx + bw * 0.3, y: by + bh + Math.min(120 * k, bh * 0.6) }, lineWidth: 4 * Math.min(k, 2.5) };
        this.L.balloons.push(b);
        this.sel = b.id;
        app.changed(); app.updateCtxBar();
        editBalloon(app, this, b, this.before);
        return;
      }
      vecCmd(app, 'Balloon', this.L, 'balloons', this.before);
      app.changed();
    },
    cancel() { this.drag = null; this.cur = null; },
    onDelete() { this.del(); },
    del() {
      const L = this.layer(); const before = JSON.stringify(L.balloons);
      L.balloons = L.balloons.filter((b) => b.id !== this.sel); this.sel = null;
      vecCmd(app, 'Delete balloon', L, 'balloons', before); app.changed(); app.updateCtxBar();
    },
    patch(o) {
      const s = this.selB();
      if (o.shape) this.defaults.shape = o.shape;
      if (o.font) this.defaults.font = o.font;
      if (!s) { app.updateCtxBar(); return; }
      const L = this.layer(), before = JSON.stringify(L.balloons);
      Object.assign(s, o);
      if (o.shape && (o.shape === 'none' || o.shape === 'rect')) { /* keep tail if user had one */ }
      vecCmd(app, 'Balloon style', L, 'balloons', before); app.changed(); app.updateCtxBar();
    },
    overlay(ctx, px) {
      const s = this.selB();
      ctx.save();
      if (this.cur) { ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.strokeRect(this.cur.x, this.cur.y, this.cur.w, this.cur.h); }
      if (s) {
        ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 1.5 * px; ctx.strokeRect(s.x, s.y, s.w, s.h);
        ctx.setLineDash([]);
        const dot = (x, y, fill) => { ctx.beginPath(); ctx.arc(x, y, 9 * px, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2 * px; ctx.stroke(); };
        dot(s.x + s.w, s.y + s.h, '#fff');
        if (s.tail) dot(s.tail.x, s.tail.y, '#ffd23f');
      }
      ctx.restore();
    },
    bar() {
      const s = this.selB();
      const shape = s ? s.shape : this.defaults.shape, font = s ? s.font : this.defaults.font;
      const items = [
        ...SHAPES.map(([v, l]) => cb(l, () => this.patch({ shape: v }), shape === v)), sep(),
        (() => { const sl = fontSelect(font, (k) => this.patch({ font: k })); sl.classList.add('cb-select'); return sl; })(),
      ];
      if (s) items.push(sep(),
        cb('Edit text', () => editBalloon(app, this, s)),
        cb('A−', () => this.patch({ fontSize: Math.max(8, (s.fontSize || 30) - 3) })), cb('A+', () => this.patch({ fontSize: (s.fontSize || 30) + 3 })),
        cb(s.tail ? 'Remove tail' : 'Add tail', () => this.patch({ tail: s.tail ? null : { x: s.x + s.w * 0.3, y: s.y + s.h + 90 } })),
        cb('Delete', () => this.del()));
      else items.push(sep(), h('span', { class: 'cb-label' }, 'Tap or drag on canvas to add · double-tap to edit'));
      return items;
    },
  };
  return t;
}

// ───────── fonts ─────────
// Imported fonts (TTF / OTF / WOFF) are kept in IndexedDB and registered with FontFace.
export async function loadSavedFonts() {
  try { for (const f of await store.listFonts()) await registerFont(f.id, f.blob); } catch (e) { console.warn('fonts', e); }
}
async function registerFont(family, blob) {
  const face = new FontFace(family, await blob.arrayBuffer());
  await face.load(); document.fonts.add(face);
}
export async function importFont() {
  const { pickFile } = await import('./util.js');
  const [f] = await pickFile('.ttf,.otf,.woff,.woff2');
  if (!f) return null;
  const family = f.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, ' ').trim() || 'Custom font';
  try { await registerFont(family, f); } catch (e) { toast('Could not read that font: ' + e.message); return null; }
  await store.saveFont({ id: family, blob: f });
  toast(`Font "${family}" added`);
  return 'custom:' + family;
}
export function fontOptions() {
  const custom = [...document.fonts].map((ff) => ff.family.replace(/"/g, '')).filter((n, i, a) => a.indexOf(n) === i && !FONT_LABELS.some(([k]) => k === n));
  return [...FONT_LABELS, ...custom.map((n) => ['custom:' + n, n + ' (imported)'])];
}
function fontSelect(value, onChange) {
  const sel = h('select', {}, ...fontOptions().map(([k, l]) => h('option', { value: k, selected: k === value }, l)), h('option', { value: '__import' }, '＋ Import font…'));
  sel.onchange = async () => {
    if (sel.value === '__import') {
      const k = await importFont();
      if (k) { sel.prepend(h('option', { value: k }, k.slice(7) + ' (imported)')); sel.value = k; onChange(k); }
      else sel.value = value;
      return;
    }
    value = sel.value; onChange(sel.value);
  };
  return sel;
}

function editBalloon(app, tool, b, beforeOverride) {
  const L = tool.layer();
  const before = beforeOverride || JSON.stringify(L.balloons);
  const r = () => app.requestRender('active');
  const ta = h('textarea', { class: 'text-in', placeholder: b.shape === 'none' ? 'Text…' : 'Dialogue…' }, b.text || '');
  const color = (key, def) => { const i = h('input', { type: 'color', value: b[key] || def }); i.oninput = () => { b[key] = i.value; r(); }; return i; };
  ta.addEventListener('input', () => { b.text = ta.value; r(); });
  const sw = (label, key) => switchRow(label, !!b[key], (v) => { b[key] = v; r(); });
  const isText = b.shape === 'none';
  const body = h('div', {}, ta,
    h('div', { class: 'row2' },
      h('div', {}, h('label', {}, 'Font'), fontSelect(b.font || 'comic', (k) => { b.font = k; tool.defaults.font = k; r(); })),
      h('div', {}, h('label', {}, 'Alignment'), seg([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], b.align || 'center', (v) => { b.align = v; r(); }))),
    field('Size', { min: 8, max: 300, step: 1, value: b.fontSize || 30, fmt: (v) => v + ' px', onInput: (v) => { b.fontSize = v; r(); } }),
    field('Line spacing', { min: 0.8, max: 2.4, step: 0.02, value: b.lineHeight || 1.18, fmt: (v) => v.toFixed(2), onInput: (v) => { b.lineHeight = v; r(); } }),
    h('div', { class: 'row2' }, sw('Bold', 'bold'), sw('Italic', 'italic')),
    sw('Vertical text (manga)', 'vertical'),
    field('Letter outline', { min: 0, max: 30, step: 0.5, value: b.textOutline ?? (isText ? Math.max(3, (b.fontSize || 30) * 0.16) : 0), fmt: (v) => v + ' px', onInput: (v) => { b.textOutline = v; r(); } }),
    h('div', { class: 'toggle-row' }, h('span', {}, 'Text · letter outline'), h('span', { style: { display: 'flex', gap: '8px' } }, color('textColor', '#000000'), color('textOutlineColor', b.fill || '#ffffff'))),
    !isText && field('Bubble line width', { min: 0, max: 16, step: 0.5, value: b.lineWidth ?? 4, fmt: (v) => v + ' px', onInput: (v) => { b.lineWidth = v; r(); } }),
    !isText && h('div', { class: 'toggle-row' }, h('span', {}, 'Bubble fill · line'), h('span', { style: { display: 'flex', gap: '8px' } }, color('fill', '#ffffff'), color('stroke', '#000000'))),
    h('p', { class: 'hint' }, 'Drag the text box to move it, the corner dot to resize, the yellow dot to aim the tail. Double-tap to edit again.'));
  dialog({ title: isText ? 'Text' : 'Speech bubble', wide: true, body, actions: [{ label: 'Done', primary: true }], onClose: () => {
    b.text = ta.value;
    if (!b.text.trim() && b.shape !== 'none') b.text = '…';
    if (!b.text.trim() && b.shape === 'none') { L.balloons = L.balloons.filter((x) => x !== b); tool.sel = null; }
    vecCmd(app, isText ? 'Text' : 'Balloon text', L, 'balloons', before);
    app.changed(); app.updateCtxBar();
  } });
  setTimeout(() => ta.focus(), 60);
}
