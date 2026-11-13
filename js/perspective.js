// Perspective rulers (like Clip Studio's perspective ruler / Procreate's perspective guide).
// A guide is stored on the document: 1, 2 or 3 vanishing points, a horizon (eye level) and
// whether strokes snap. With Snap on, a brush / eraser stroke picks the guide direction closest
// to the way it starts moving (towards a vanishing point, or vertical / horizontal) and stays on
// that line — rotated boxes, buildings and streets come out straight and convergent.
// Keep a finger on the screen while drawing to draw freely.
// Besides 1/2/3-point there are curvilinear guides: "Curved" (4-point: horizontals bend towards
// left/right points, verticals towards top/bottom points on a round lens) and "Fisheye" (5-point:
// the same plus depth lines into the centre), and "Iso" (isometric: three sets of parallels).
// On curved guides a stroke follows the circle through its start and the two points of its family.
import { h, toast, dialog, field, switchRow, seg } from './util.js';
import * as store from './storage.js';

const COLORS = ['#ff5a5f', '#2fbf71', '#3d8bff'];

export const CURVED = (t) => t === 'curv4' || t === 'fish5';
export const TYPES = [['1pt', '1-pt'], ['2pt', '2-pt'], ['3pt', '3-pt'], ['curv4', 'Curved'], ['fish5', 'Fisheye'], ['iso', 'Iso']];
export function defaultGuide(d, type = '2pt', keep = null) {
  const W = d.width, H = d.height;
  const hy = keep && keep.vps && keep.vps[0] ? keep.vps[0].y : keep && keep.c ? keep.c.y : H * 0.45;
  const g = { type, vps: [], snap: keep ? keep.snap : true, visible: true, lines: keep ? keep.lines : 14, opacity: keep ? keep.opacity : 0.35, grid: keep ? !!keep.grid : false, iso: (keep && keep.iso) || 30 };
  if (type === '1pt') g.vps = [{ x: W * 0.5, y: hy }];
  // vanishing points well apart (off the canvas): close ones distort like an ultra-wide lens
  else if (type === '2pt') g.vps = [{ x: -W * 0.3, y: hy }, { x: W * 1.3, y: hy }];
  else if (type === '3pt') g.vps = [{ x: -W * 0.3, y: hy }, { x: W * 1.3, y: hy }, { x: W * 0.5, y: H * 1.9 }];
  else if (CURVED(type)) { g.c = keep && keep.c ? { ...keep.c } : { x: W / 2, y: hy }; g.r = (keep && keep.r) || Math.min(W, H) * 0.5; }
  return g;
}
// the circle through three points, or null when they are (almost) on one line
function circleThrough(p, a, b) {
  const d = 2 * (p.x * (a.y - b.y) + a.x * (b.y - p.y) + b.x * (p.y - a.y));
  if (Math.abs(d) < 1e-6 * Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) ** 2) return null;
  const p2 = p.x * p.x + p.y * p.y, a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y;
  const cx = (p2 * (a.y - b.y) + a2 * (b.y - p.y) + b2 * (p.y - a.y)) / d, cy = (p2 * (b.x - a.x) + a2 * (p.x - b.x) + b2 * (a.x - p.x)) / d;
  return { cx, cy, r: Math.hypot(p.x - cx, p.y - cy) };
}
// the curved guide's two families meet at these points (left/right and top/bottom of the lens)
const lensPoints = (g) => ({ L: { x: g.c.x - g.r, y: g.c.y }, R: { x: g.c.x + g.r, y: g.c.y }, T: { x: g.c.x, y: g.c.y - g.r }, B: { x: g.c.x, y: g.c.y + g.r } });

// The horizon is the line through VP1 and VP2 (2/3-point) or horizontal through VP1 (1-point).
function horizon(g) {
  if (CURVED(g.type)) return { a: g.c, b: { x: g.c.x + 1, y: g.c.y } };
  const a = g.vps[0], b = g.type === '1pt' ? { x: a.x + 1, y: a.y } : g.vps[1];
  return { a, b };
}

// Directions a stroke can follow from point s: [{dx, dy, label}]
function candidates(g, s) {
  const out = [];
  const push = (dx, dy, i) => { const L = Math.hypot(dx, dy); if (L > 1e-6) out.push({ dx: dx / L, dy: dy / L, i }); };
  if (CURVED(g.type)) {
    // a curve of each family through the start point; its tangent there is the direction to compare
    const P = lensPoints(g);
    for (const [a, b, i] of [[P.L, P.R, 'h'], [P.T, P.B, 'v']]) {
      const c = circleThrough(s, a, b);
      if (!c) { push(b.x - a.x, b.y - a.y, i); continue; }
      const tx = -(s.y - c.cy), ty = s.x - c.cx, L = Math.hypot(tx, ty) || 1;
      out.push({ dx: tx / L, dy: ty / L, i, circle: c });
    }
    if (g.type === 'fish5' && Math.hypot(g.c.x - s.x, g.c.y - s.y) > 2) push(g.c.x - s.x, g.c.y - s.y, 'c');
    return out;
  }
  if (g.type === 'iso') {
    const a = ((g.iso || 30) * Math.PI) / 180;
    push(Math.cos(a), Math.sin(a), 'r'); push(Math.cos(a), -Math.sin(a), 'l'); push(0, 1, 'v');
    return out;
  }
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
    let x, y;
    if (dir.circle) {
      // onto the curve: the nearest point of its circle
      const c = dir.circle, vx = q.x - c.cx, vy = q.y - c.cy, L = Math.hypot(vx, vy) || 1;
      x = c.cx + (vx / L) * c.r; y = c.cy + (vy / L) * c.r;
    } else {
      const t = (q.x - start.x) * dir.dx + (q.y - start.y) * dir.dy;
      x = start.x + dir.dx * t; y = start.y + dir.dy * t;
    }
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
  if (CURVED(g.type)) { drawCurved(ctx, g, px, editing); ctx.restore(); return; }
  if (g.type === 'iso') { drawIso(ctx, g, W, H); ctx.restore(); return; }
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

// Curved (4-point) / Fisheye (5-point): two families of arcs inside a round lens
function drawCurved(ctx, g, px, editing) {
  const { c, r } = g, n = Math.max(3, Math.round((g.lines | 0) / 2));
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.clip();
  const fam = (horizontal, color) => {
    ctx.strokeStyle = color; ctx.beginPath();
    for (let k = 1; k < n; k++) for (const sgn of [-1, 1]) {
      const t = sgn * r * (k / n), u = (t * t - r * r) / (2 * t), rad = Math.abs(t - u);
      const cx = horizontal ? c.x : c.x + u, cy = horizontal ? c.y + u : c.y;
      ctx.moveTo(cx + rad, cy); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    }
    // the straight middle line of the family
    if (horizontal) { ctx.moveTo(c.x - r, c.y); ctx.lineTo(c.x + r, c.y); } else { ctx.moveTo(c.x, c.y - r); ctx.lineTo(c.x, c.y + r); }
    ctx.stroke();
  };
  fam(true, COLORS[0]); fam(false, COLORS[1]);
  if (g.type === 'fish5') {
    ctx.strokeStyle = COLORS[2]; ctx.beginPath();
    const m = Math.max(8, g.lines | 0);
    for (let k = 0; k < m; k++) { const a = (k / m) * Math.PI * 2; ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r); }
    ctx.stroke();
  }
  ctx.restore();
  // lens outline and the horizon through the middle
  ctx.globalAlpha = 0.9; ctx.lineWidth = 2 * px;
  ctx.strokeStyle = 'rgba(176,124,255,0.9)'; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#ffb020'; ctx.beginPath(); ctx.moveTo(c.x - r, c.y); ctx.lineTo(c.x + r, c.y); ctx.stroke();
  if (editing) { handle(ctx, c, px, '#ffb020', 'Centre (eye level)'); handle(ctx, { x: c.x + r, y: c.y }, px, '#b07cff', 'Lens size'); }
}
// Isometric: three sets of parallel lines (two at the iso angle, one vertical)
function drawIso(ctx, g, W, H) {
  const a = ((g.iso || 30) * Math.PI) / 180, sp = Math.max(W, H) / Math.max(6, g.lines | 0), D = Math.hypot(W, H);
  [[Math.cos(a), Math.sin(a), COLORS[0]], [Math.cos(a), -Math.sin(a), COLORS[1]], [0, 1, COLORS[2]]].forEach(([dx, dy, col]) => {
    const nx = -dy, ny = dx, ps = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => x * nx + y * ny);
    const k0 = Math.floor(Math.min(...ps) / sp), k1 = Math.ceil(Math.max(...ps) / sp);
    ctx.strokeStyle = col; ctx.beginPath();
    for (let k = k0; k <= k1; k++) { const ox = nx * k * sp, oy = ny * k * sp; ctx.moveTo(ox - dx * D * 2, oy - dy * D * 2); ctx.lineTo(ox + dx * D * 2, oy + dy * D * 2); }
    ctx.stroke();
  });
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
      if (CURVED(g.type)) {
        if (hit(g.c)) this.drag = { center: true, ox: g.c.x - p.x, oy: g.c.y - p.y };
        else if (hit({ x: g.c.x + g.r, y: g.c.y })) this.drag = { lens: true };
        if (!this.drag) { toast('Drag the Centre or the Lens size handle. To draw, tap Done ✓.'); return false; }
        return;
      }
      if (g.type === 'iso') { toast('Isometric has nothing to drag: change the angle under More…, then tap Done ✓.'); return false; }
      for (let i = 0; i < g.vps.length; i++) if (hit(g.vps[i])) { this.drag = { i, ox: g.vps[i].x - p.x, oy: g.vps[i].y - p.y }; break; }
      if (!this.drag && hit(horizonHandle(app, g))) this.drag = { horizon: true, y0: p.y, ys: g.vps.slice(0, g.type === '1pt' ? 1 : 2).map((v) => v.y) };
      if (!this.drag) { toast('Drag one of the round handles. To draw, tap Done ✓ (or pick a brush).'); return false; }
    },
    move(p) {
      const g = app.doc.persp, D = this.drag; if (!g || !D) return;
      if (D.center) { g.c.x = p.x + D.ox; g.c.y = p.y + D.oy; app.requestRender('view'); return; }
      if (D.lens) { g.r = Math.max(40, Math.hypot(p.x - g.c.x, p.y - g.c.y)); app.requestRender('view'); return; }
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
        ...TYPES.map(([t, label]) => cb(label, () => setType(t), g.type === t)), sep(),
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
      h('div', {}, h('b', {}, '1 · Pick a type'), h('p', {}, '2-pt for buildings and rooms seen from a corner, 1-pt for looking straight down a street or hallway, 3-pt for looking up or down at tall things. Curved and Fisheye bend every line like a wide-angle or fisheye lens (great for dramatic action shots and rooms that wrap around you). Iso draws in isometric, with no vanishing points (games, maps, diagrams).')),
      h('div', {}, h('b', {}, '2 · Drag the round handles'), h('p', {}, 'The orange "Eye level" handle moves the horizon up and down. The coloured "Point" handles are where the lines meet. Far apart (even off the page) looks natural. On Curved / Fisheye, drag the Centre and the Lens size.')),
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
      g.type === '1pt' || g.type === '2pt' ? switchRow('Square grid (1- and 2-point)', !!g.grid, (v) => { g.grid = v; app.requestRender('view'); }) : null,
      g.type === 'iso' ? h('div', {}, h('label', {}, 'Angle'), seg([['30', '30° (classic isometric)'], ['26.565', '2:1 (pixel art / games)']], String(g.iso || 30), (v) => { g.iso = parseFloat(v); app.changed(); app.requestRender('view'); })) : null),
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
  if (CURVED(g.type)) { xs.push(g.c.x - g.r, g.c.x + g.r); ys.push(g.c.y - g.r, g.c.y + g.r); }
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
