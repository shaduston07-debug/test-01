// Perspective rulers (like Clip Studio's perspective ruler / Procreate's perspective guide).
// A guide is stored on the document: 1, 2 or 3 vanishing points, a horizon (eye level) and
// whether strokes snap. With Snap on, a brush / eraser stroke picks the guide direction closest
// to the way it starts moving (towards a vanishing point, or vertical / horizontal) and stays on
// that line — rotated boxes, buildings and streets come out straight and convergent.
// Keep a finger on the screen while drawing to draw freely.
import { h, toast, dialog, field, switchRow } from './util.js';
import * as store from './storage.js';

const COLORS = ['#ff5a5f', '#2fbf71', '#3d8bff'];

export function defaultGuide(d, type = '2pt', keep = null) {
  const W = d.width, H = d.height;
  const hy = keep && keep.vps && keep.vps[0] ? keep.vps[0].y : H * 0.45;
  const g = { type, vps: [], snap: keep ? keep.snap : true, visible: true, lines: keep ? keep.lines : 14, opacity: keep ? keep.opacity : 0.35, grid: keep ? !!keep.grid : false };
  if (type === '1pt') g.vps = [{ x: W * 0.5, y: hy }];
  // vanishing points well apart (off the canvas): close ones distort like an ultra-wide lens
  else if (type === '2pt') g.vps = [{ x: -W * 0.3, y: hy }, { x: W * 1.3, y: hy }];
  else g.vps = [{ x: -W * 0.3, y: hy }, { x: W * 1.3, y: hy }, { x: W * 0.5, y: H * 1.9 }];
  return g;
}

// The horizon is the line through VP1 and VP2 (2/3-point) or horizontal through VP1 (1-point).
function horizon(g) {
  const a = g.vps[0], b = g.type === '1pt' ? { x: a.x + 1, y: a.y } : g.vps[1];
  return { a, b };
}

// Directions a stroke can follow from point s: [{dx, dy, label}]
function candidates(g, s) {
  const out = [];
  const push = (dx, dy, i) => { const L = Math.hypot(dx, dy); if (L > 1e-6) out.push({ dx: dx / L, dy: dy / L, i }); };
  for (let i = 0; i < g.vps.length; i++) {
    const v = g.vps[i];
    if (Math.hypot(v.x - s.x, v.y - s.y) > 2) push(v.x - s.x, v.y - s.y, i);
  }
  if (g.type !== '3pt') push(0, 1, 'v'); // verticals stay vertical in 1- and 2-point
  if (g.type === '1pt') { const { a, b } = horizon(g); push(b.x - a.x, b.y - a.y, 'h'); }
  return out;
}

// Snapper for one stroke. feed(p) returns the (projected) points to hand to the engine.
export function snapper(app, g, start) {
  const pend = [];
  let dir = null;
  const proj = (q) => {
    const t = (q.x - start.x) * dir.dx + (q.y - start.y) * dir.dy;
    const x = start.x + dir.dx * t, y = start.y + dir.dy * t;
    const s = app.docToScreen(x, y);
    return { ...q, x, y, sx: s.x, sy: s.y };
  };
  // The direction is chosen from the overall way the first ~26 screen px of the stroke went
  // (the average of those points, so a wobbly or hooked start doesn't pick the wrong line).
  const decide = () => {
    let mx = 0, my = 0;
    for (const q of pend) { mx += q.x - start.x; my += q.y - start.y; }
    const L = Math.hypot(mx, my);
    if (L < 1e-6) return false;
    let best = null, bs = Infinity;
    for (const c of candidates(g, start)) {
      const sin = Math.abs((mx * c.dy - my * c.dx) / L);
      if (sin < bs) { bs = sin; best = c; }
    }
    dir = best || { dx: mx / L, dy: my / L };
    return true;
  };
  return {
    get dir() { return dir; },
    feed(p) {
      if (dir) return [proj(p)];
      pend.push(p);
      if (Math.hypot(p.sx - start.sx, p.sy - start.sy) < 26) return [];
      decide();
      return pend.splice(0).map(proj);
    },
    // pen lifted before the direction was chosen (a short dash): decide with what there is
    flush() {
      if (dir || !pend.length) return [];
      const far = pend.reduce((m, q) => Math.max(m, Math.hypot(q.sx - start.sx, q.sy - start.sy)), 0);
      if (far < 3 || !decide()) return [];
      return pend.splice(0).map(proj);
    },
  };
}

// ── drawing the guide (doc space; px = one screen pixel in doc units) ──
export function drawGuide(app, ctx, px) {
  const d = app.doc, g = d && d.persp;
  if (!g || !g.visible) return;
  const editing = app.tool === 'persp';
  const W = d.width, H = d.height;
  ctx.save();
  ctx.lineWidth = 1 * px;
  ctx.globalAlpha = editing ? Math.max(0.45, g.opacity) : g.opacity;
  // rays from each vanishing point, spread over the canvas
  const corners = [[0, 0], [W, 0], [W, H], [0, H]];
  g.vps.forEach((v, i) => {
    let a0 = Infinity, a1 = -Infinity;
    const angs = corners.map(([x, y]) => Math.atan2(y - v.y, x - v.x));
    const inside = v.x > 0 && v.x < W && v.y > 0 && v.y < H;
    if (inside) { a0 = -Math.PI; a1 = Math.PI; }
    else {
      // smallest angle range that covers the canvas as seen from the VP
      const base = angs[0];
      const rel = angs.map((a) => { let r = a - base; while (r > Math.PI) r -= 2 * Math.PI; while (r < -Math.PI) r += 2 * Math.PI; return r; });
      a0 = base + Math.min(...rel); a1 = base + Math.max(...rel);
    }
    const n = Math.max(4, g.lines | 0), R = Math.hypot(W, H) * 3 + Math.hypot(v.x - W / 2, v.y - H / 2);
    ctx.strokeStyle = COLORS[i];
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = a0 + (a1 - a0) * (inside ? k / n : (k + 0.5) / (n + 1));
      ctx.moveTo(v.x, v.y); ctx.lineTo(v.x + Math.cos(a) * R, v.y + Math.sin(a) * R);
    }
    ctx.stroke();
  });
  // 1-point: a light grid of horizontals and verticals; 2-point: verticals
  if (g.grid && g.type !== '3pt') {
    ctx.strokeStyle = '#b07cff'; ctx.beginPath();
    const step = W / Math.max(4, Math.round((g.lines | 0) / 3));
    for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    if (g.type === '1pt') for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }
  // horizon / eye level
  ctx.globalAlpha = 0.9;
  const { a, b } = horizon(g);
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, R = Math.hypot(W, H) * 4;
  ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 2 * px;
  ctx.beginPath(); ctx.moveTo(a.x - dx / L * R, a.y - dy / L * R); ctx.lineTo(a.x + dx / L * R, a.y + dy / L * R); ctx.stroke();
  if (editing) {
    for (let i = 0; i < g.vps.length; i++) handle(ctx, g.vps[i], px, COLORS[i], g.vps.length === 1 ? 'Vanishing point' : 'Point ' + (i + 1));
    handle(ctx, horizonHandle(app, g), px, '#ffb020', 'Eye level');
  }
  ctx.restore();
}

function handle(ctx, p, px, color, label) {
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(p.x, p.y, 15 * px, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,20,24,0.75)'; ctx.fill();
  ctx.lineWidth = 3 * px; ctx.strokeStyle = color; ctx.stroke();
  ctx.beginPath(); ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.font = `600 ${13 * px}px -apple-system, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(label, p.x, p.y - 22 * px); ctx.fillText(label, p.x, p.y - 22 * px);
}

// horizon handle: on the horizon, at the horizontal middle of the visible canvas area
function horizonHandle(app, g) {
  const d = app.doc, { a, b } = horizon(g);
  const c = app.screenToDoc(app.vw / 2, app.vh / 2);
  let x = Math.max(0, Math.min(d.width, c.x));
  // never on top of a vanishing point handle (1-point: the VP sits on the horizon in view)
  if (g.vps.some((v) => Math.abs(v.x - x) < d.width * 0.12)) x = a.x + (a.x < d.width * 0.6 ? 1 : -1) * d.width * 0.3;
  const t = Math.abs(b.x - a.x) > 1e-6 ? (x - a.x) / (b.x - a.x) : 0;
  return { x, y: a.y + (b.y - a.y) * t };
}

// ── the Perspective tool: drag vanishing points and the horizon ──
export function perspTool(app) {
  const cb = (label, fn, on = false) => h('button', { class: 'cb-btn' + (on ? ' on' : ''), onclick: fn }, label);
  const sep = () => h('span', { class: 'cb-sep' });
  const T = {
    fingers: true,
    enter() {
      const d = app.doc;
      if (d && !d.persp) { d.persp = defaultGuide(d, '2pt'); app.changed(); fitGuide(app); }
      if (!store.prefs.get('persp.intro', false)) { store.prefs.set('persp.intro', true); setTimeout(() => intro(), 200); }
      else if (d && d.persp) d.persp.visible = true;
      app.requestRender('view');
    },
    down(p) {
      const g = app.doc.persp; if (!g) return false;
      const hit = (q) => { const s = app.docToScreen(q.x, q.y); return Math.hypot(s.x - p.sx, s.y - p.sy) < 26; };
      this.drag = null;
      for (let i = 0; i < g.vps.length; i++) if (hit(g.vps[i])) { this.drag = { i, ox: g.vps[i].x - p.x, oy: g.vps[i].y - p.y }; break; }
      if (!this.drag && hit(horizonHandle(app, g))) this.drag = { horizon: true, y0: p.y, ys: g.vps.slice(0, g.type === '1pt' ? 1 : 2).map((v) => v.y) };
      if (!this.drag) { toast('Drag one of the round handles. To draw, tap Done ✓ (or pick a brush).'); return false; }
    },
    move(p) {
      const g = app.doc.persp, D = this.drag; if (!g || !D) return;
      if (D.horizon) {
        const dy = p.y - D.y0;
        D.ys.forEach((y, i) => { g.vps[i].y = y + dy; });
      } else {
        const v = g.vps[D.i];
        v.x = p.x + D.ox; v.y = p.y + D.oy;
        // VP1 / VP2 sit on one horizon: keep it level unless you tilt it on purpose (finger down)
        if (g.type !== '1pt' && D.i < 2 && app.touchesDown() === 0) g.vps[1 - D.i].y = v.y;
      }
      app.requestRender('view');
    },
    up() { if (this.drag) { this.drag = null; app.changed(); } },
    cancel() { this.drag = null; },
    // a short bar: type · snap · hide · more · help · done
    bar() {
      const d = app.doc; if (!d) return null;
      const g = d.persp;
      const setType = (t) => { d.persp = defaultGuide(d, t, g); app.changed(); app.updateCtxBar(); fitGuide(app); };
      if (!g) return [cb('＋ Add a perspective guide', () => setType('2pt'), true)];
      return [
        cb('1-point', () => setType('1pt'), g.type === '1pt'), cb('2-point', () => setType('2pt'), g.type === '2pt'), cb('3-point', () => setType('3pt'), g.type === '3pt'), sep(),
        cb(g.snap ? 'Snap: on' : 'Snap: off', () => { g.snap = !g.snap; app.changed(); app.updateCtxBar(); toast(g.snap ? 'Lines will follow the guide' : 'Free drawing: lines don\'t snap'); }, g.snap),
        cb(g.visible ? 'Hide' : 'Show', () => { g.visible = !g.visible; app.changed(); app.updateCtxBar(); app.requestRender('view'); }),
        cb('More…', () => more(app)), cb('?', intro), sep(),
        cb('Done ✓', () => app.setTool('brush'), true),
      ];
    },
  };
  return T;
}

function intro() {
  dialog({
    title: 'Perspective in 3 steps',
    body: h('div', { class: 'persp-intro' },
      h('div', {}, h('b', {}, '1 · Pick a type'), h('p', {}, '2-point for buildings and rooms seen from a corner, 1-point for looking straight down a street or hallway, 3-point for looking up or down at tall things.')),
      h('div', {}, h('b', {}, '2 · Drag the round handles'), h('p', {}, 'The orange "Eye level" handle moves the horizon up and down. The coloured "Point" handles are where the lines meet. Far apart (even off the page) looks natural.')),
      h('div', {}, h('b', {}, '3 · Tap Done ✓ and draw'), h('p', {}, 'Start each line in the direction you want: it locks straight onto the guide. Keep a finger on the screen while drawing for a free, curvy line.'))),
    actions: [{ label: 'Got it', primary: true }],
  });
}
// guide lines, strength, grid, see all, remove
function more(app) {
  const d = app.doc, g = d.persp; if (!g) return;
  dialog({
    title: 'Perspective guide',
    body: h('div', {},
      field('Number of lines', { min: 6, max: 48, step: 2, value: g.lines, fmt: (v) => v, onInput: (v) => { g.lines = v; app.requestRender('view'); } }),
      field('Line strength', { min: 0.1, max: 1, step: 0.05, value: g.opacity, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { g.opacity = v; app.requestRender('view'); } }),
      switchRow('Square grid (1- and 2-point)', !!g.grid, (v) => { g.grid = v; app.requestRender('view'); })),
    actions: [
      { label: 'Remove guide', danger: true, onClick: () => { d.persp = null; app.changed(); app.updateCtxBar(); app.requestRender('view'); } },
      { label: 'See all points', onClick: () => fitGuide(app) },
      { label: 'Done', primary: true, onClick: () => app.changed() },
    ],
  });
}

// zoom out so the canvas and every vanishing point are on screen
export function fitGuide(app) {
  const d = app.doc, g = d.persp; if (!g) return;
  const xs = [0, d.width, ...g.vps.map((v) => v.x)], ys = [0, d.height, ...g.vps.map((v) => v.y)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const z = Math.min((app.vw - 160) / (x1 - x0), (app.vh - 200) / (y1 - y0));
  app.view = { x: 0, y: 0, zoom: Math.max(0.02, z), rot: 0, flip: app.view.flip || 1 };
  app.setViewAt({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, { x: app.vw / 2, y: app.vh / 2 + 30 });
  app.requestRender('view');
}

// open a document with a ready-made guide (used by Inkwell Learning challenges)
export function presetGuide(d, type, opts = {}) {
  const g = defaultGuide(d, type);
  if (opts.horizon != null) for (const v of g.vps.slice(0, type === '1pt' ? 1 : 2)) v.y = d.height * opts.horizon;
  if (opts.vps) opts.vps.forEach((v, i) => { if (g.vps[i]) { g.vps[i].x = d.width * v[0]; g.vps[i].y = d.height * v[1]; } });
  d.persp = g;
  return g;
}
