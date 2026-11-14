// Inkwell Learning — interactive lesson widgets. Everything is drawn live in code (no
// AI-generated pictures, no downloads): real 3D projection for perspective, real Lambert
// lighting for the colour lessons, real per-pixel grading, real timing curves for animation.
// Each demo is (host, opts) => cleanup.
import { h } from '../util.js';

// ───────── shared helpers ─────────
function stage(host, W, H, { cls = '' } = {}) {
  const c = h('canvas', { class: 'lx-canvas ' + cls });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = W * dpr; c.height = H * dpr;
  c.style.aspectRatio = `${W} / ${H}`;
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  host.append(c);
  const pos = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  return { c, x, W, H, dpr, pos };
}
const controls = (host) => { const el = h('div', { class: 'lx-controls' }); host.append(el); return el; };
function slider(box, label, min, max, step, value, onInput, fmt = (v) => v) {
  const out = h('output', {}, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value: String(value) });
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); onInput(v); });
  const el = h('label', { class: 'lx-slider' }, h('span', {}, label), inp, out);
  el.set = (v) => { inp.value = v; out.textContent = fmt(v); };
  box.append(el);
  return el;
}
function toggle(box, label, on, onChange) {
  const b = h('button', { class: 'lx-toggle' + (on ? ' on' : '') }, label);
  b.onclick = () => { b.classList.toggle('on'); onChange(b.classList.contains('on')); };
  box.append(b);
  return b;
}
function chips(box, options, value, onPick) {
  const el = h('div', { class: 'lx-chips' });
  const set = (v) => { for (const b of el.children) b.classList.toggle('on', b.dataset.v === v); };
  for (const [v, label] of options) el.append(h('button', { 'data-v': v, onclick: () => { set(v); onPick(v); } }, label));
  set(value);
  el.set = set;
  box.append(el);
  return el;
}
const button = (box, label, fn, cls = '') => { const b = h('button', { class: 'lx-btn ' + cls, onclick: fn }, label); box.append(b); return b; };
const note = (box, text = '') => { const el = h('div', { class: 'lx-note' }, text); box.append(el); return el; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const rgb = (s) => { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function hsv(hh, s, v) {
  const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
function loop(fn) {
  let id = 0, last = performance.now(), alive = true;
  const step = (t) => { if (!alive) return; const dt = Math.min(0.1, (t - last) / 1000); last = t; fn(dt, t / 1000); id = requestAnimationFrame(step); };
  id = requestAnimationFrame(step);
  return () => { alive = false; cancelAnimationFrame(id); };
}
// drag helper on a stage: handles = () => [{x,y,r,onDrag(p)}], plus optional free drag
function drags(S, handles, onFree) {
  let cur = null;
  S.c.addEventListener('pointerdown', (e) => {
    const p = S.pos(e);
    cur = null;
    for (const hd of handles()) if (Math.hypot(hd.x - p.x, hd.y - p.y) < (hd.r || 16)) { cur = hd; break; }
    if (!cur && onFree) cur = { onDrag: onFree, free: true, start: p };
    if (cur) { S.c.setPointerCapture(e.pointerId); cur.onDrag(p, true); e.preventDefault(); }
  });
  S.c.addEventListener('pointermove', (e) => { if (cur) { cur.onDrag(S.pos(e), false); e.preventDefault(); } });
  const end = () => { if (cur && cur.onEnd) cur.onEnd(); cur = null; };
  S.c.addEventListener('pointerup', end); S.c.addEventListener('pointercancel', end);
  S.c.style.touchAction = 'none';
}
// seeded value noise for landscapes
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function ridge(seed, W, base, amp, rough = 0.5) {
  const r = rng(seed), n = 9, pts = [];
  const oct = [[1, 1], [2.3, rough], [5.1, rough * rough]];
  const ph = oct.map(() => [r() * 6.28, r() * 6.28]);
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    let y = 0; oct.forEach(([f, a], k) => { y += a * Math.sin(t * f * n * 0.5 + ph[k][0]) * Math.cos(t * f * 2.1 + ph[k][1]); });
    pts.push([t * W, base - amp * (0.5 + 0.5 * y)]);
  }
  return pts;
}
function fillRidge(x, pts, H, col) {
  x.beginPath(); x.moveTo(0, H); for (const [px, py] of pts) x.lineTo(px, py); x.lineTo(pts[pts.length - 1][0], H); x.closePath();
  x.fillStyle = col; x.fill();
}

// ───────── 3D camera for the perspective lab ─────────
function camera(W, H, { h: ch = 1.6, pitch = 0, F = 420 } = {}) {
  const cx = W / 2, cy = H / 2, cp = Math.cos(pitch), sp = Math.sin(pitch);
  const toCam = (X, Y, Z, dir = false) => {
    const y = dir ? Y : Y - ch, z = Z;
    return [X, y * cp + z * sp, -y * sp + z * cp];
  };
  const proj = (X, Y, Z) => { const [x, y, z] = toCam(X, Y, Z); if (z <= 0.05) return null; return [cx + F * x / z, cy - F * y / z, z]; };
  // a line's vanishing point: where its direction (taken pointing away from the viewer) meets the picture
  const vp = (dx, dy, dz) => { let [x, y, z] = toCam(dx, dy, dz, true); if (z < 0) { x = -x; y = -y; z = -z; } if (z < 1e-6) return null; return [cx + F * x / z, cy - F * y / z, true]; };
  // screen → point on ground (Y = gy)
  const ground = (sx, sy, gy = 0) => {
    const x = (sx - cx) / F, y = -(sy - cy) / F;
    // camera basis in world: right (1,0,0), up (0,cp,sp)… invert toCam for a direction (x, y, 1)
    const dX = x, dY = y * cp - sp, dZ = y * sp + cp;
    if (dY >= -1e-4) return null;
    const t = (gy - ch) / dY;
    return [dX * t, gy, dZ * t];
  };
  return { proj, vp, ground, horizonY: cy - F * Math.tan(pitch), cx, cy, F, h: ch };
}
function boxVerts(b) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), out = [];
  for (const [i, j, k] of [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) {
    const lx = i * b.w / 2, lz = k * b.d / 2;
    out.push([b.x + lx * c + lz * s, b.y + j * b.hgt, b.z - lx * s + lz * c]);
  }
  return out;
}
const BOX_EDGES = [[0, 1, 0], [3, 2, 0], [4, 5, 0], [7, 6, 0], [0, 3, 1], [1, 2, 1], [4, 7, 1], [5, 6, 1], [0, 4, 2], [1, 5, 2], [2, 6, 2], [3, 7, 2]];
const VPC = ['#ff5a5f', '#2fbf71', '#3d8bff'];

function drawFigure(x, cam, X, Z, color = '#e9e2ff', height = 1.7) {
  const feet = cam.proj(X, 0, Z), head = cam.proj(X, height, Z);
  if (!feet || !head) return;
  const hgt = feet[1] - head[1], w = hgt * 0.26;
  x.save(); x.fillStyle = color; x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1;
  x.beginPath(); x.arc(head[0], head[1] + hgt * 0.07, hgt * 0.07, 0, 7); x.fill();
  x.beginPath(); x.moveTo(head[0] - w / 2, head[1] + hgt * 0.16); x.lineTo(head[0] + w / 2, head[1] + hgt * 0.16);
  x.lineTo(head[0] + w * 0.32, feet[1] - hgt * 0.45); x.lineTo(head[0] + w * 0.25, feet[1]); x.lineTo(head[0] + w * 0.04, feet[1]);
  x.lineTo(head[0], feet[1] - hgt * 0.42); x.lineTo(head[0] - w * 0.04, feet[1]); x.lineTo(head[0] - w * 0.25, feet[1]); x.lineTo(head[0] - w * 0.32, feet[1] - hgt * 0.45); x.closePath(); x.fill();
  x.restore();
}

// mode: 'horizon' | '1pt' | '2pt' | '3pt' | 'ellipse' | 'figures'
function perspectiveLab(host, { mode = '2pt' } = {}) {
  const S = stage(host, 720, 420), x = S.x, W = S.W, H = S.H;
  const st = {
    camH: mode === 'figures' ? 1.6 : mode === 'horizon' ? 1.6 : 1.6, pitch: mode === '3pt' ? -0.45 : 0, lines: true, grid: true,
    boxes: mode === 'figures' ? [] : mode === 'ellipse' ? [] : [{ x: mode === 'horizon' ? -2.4 : 0, y: 0, z: 9, w: 2.2, hgt: 2.2, d: 2.2, yaw: mode === '1pt' ? 0 : 0.6 }],
    cyl: 1.1, F: mode === '3pt' ? 300 : 420,
  };
  if (mode === 'horizon') st.boxes.push({ x: 2.6, y: 0, z: 13, w: 2, hgt: 1, d: 2, yaw: 0.35 }, { x: 0.2, y: 2.6, z: 11, w: 1.2, hgt: 1.2, d: 1.2, yaw: 0.9 });
  if (mode === '3pt') { st.boxes = [{ x: 0, y: 0, z: 10, w: 3, hgt: 9, d: 3, yaw: 0.6 }]; st.camH = 1.6; }
  const figs = [[-3, 6], [-1.2, 9], [1.5, 13], [3.6, 20], [0.4, 28], [-5, 16]];
  const draw = () => {
    const cam = camera(W, H, { h: st.camH, pitch: st.pitch, F: st.F });
    // sky and ground split by the horizon
    const hy = cam.horizonY;
    const sky = x.createLinearGradient(0, 0, 0, Math.max(1, hy));
    sky.addColorStop(0, '#1d2340'); sky.addColorStop(1, '#3a4a78');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.fillStyle = '#2a2b31'; x.fillRect(0, clamp(hy, 0, H), W, H);
    // ground grid (1 m squares) — shows how equal spaces shrink with distance
    if (st.grid && st.camH > 0.05) {
      x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 1; x.beginPath();
      for (let gx = -30; gx <= 30; gx += 2) { const a = cam.proj(gx, 0, 0.6), b = cam.proj(gx, 0, 200); if (a && b) { x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); } }
      for (let gz = 1; gz <= 80; gz += gz < 20 ? 1 : 4) { const a = cam.proj(-60, 0, gz), b = cam.proj(60, 0, gz); if (a && b) { x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); } }
      x.stroke();
    }
    // vanishing points of the box's three edge directions
    const vps = [];
    const b0 = st.boxes[0];
    if (b0) {
      const c = Math.cos(b0.yaw), s = Math.sin(b0.yaw);
      vps.push(cam.vp(c, 0, -s), cam.vp(s, 0, c), cam.vp(0, 1, 0));
    }
    // construction lines from each corner to its vanishing point
    if (st.lines) for (const b of st.boxes) {
      const v = boxVerts(b), P = v.map((q) => cam.proj(...q));
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const bv = [cam.vp(c, 0, -s), cam.vp(s, 0, c), cam.vp(0, 1, 0)];
      x.lineWidth = 1;
      for (const [i, j, axis] of BOX_EDGES) {
        const V = bv[axis]; if (!V || !P[i] || !P[j]) continue;
        // parallel edge (no VP on screen): skip extension
        if (Math.hypot(V[0] - W / 2, V[1] - H / 2) > 6000) continue;
        const target = V[2] ? V : null; if (!target) continue;
        x.strokeStyle = VPC[axis] + '88'; x.setLineDash([4, 4]);
        const near = Math.hypot(P[i][0] - V[0], P[i][1] - V[1]) > Math.hypot(P[j][0] - V[0], P[j][1] - V[1]) ? P[i] : P[j];
        x.beginPath(); x.moveTo(near[0], near[1]); x.lineTo(V[0], V[1]); x.stroke();
      }
      x.setLineDash([]);
    }
    // horizon line
    x.strokeStyle = '#ffb020'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, hy); x.lineTo(W, hy); x.stroke();
    x.fillStyle = '#ffb020'; x.font = '600 13px -apple-system, sans-serif'; x.textAlign = 'left';
    x.fillText('HORIZON = EYE LEVEL (' + st.camH.toFixed(1) + ' m)', 26, clamp(hy + 17, 14, H - 6));
    // ellipses (cylinder) lesson: circles above, on and below eye level
    if (mode === 'ellipse') {
      for (const [cxw, base, hgt] of [[-3.2, 0, 0.6], [0, 0, st.cyl * 2.4], [3.2, 0, 3.2]]) {
        const ring = (yy) => { const pts = []; for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2; const p = cam.proj(cxw + Math.cos(a) * 1, yy, 9 + Math.sin(a) * 1); if (p) pts.push(p); } return pts; };
        const top = ring(base + hgt), bot = ring(base);
        x.fillStyle = 'rgba(160,190,255,0.16)'; x.strokeStyle = '#cfe0ff'; x.lineWidth = 2;
        const L = cam.proj(cxw - 1, base, 9), R = cam.proj(cxw + 1, base, 9), LT = cam.proj(cxw - 1, base + hgt, 9), RT = cam.proj(cxw + 1, base + hgt, 9);
        if (L && R && LT && RT) { x.beginPath(); x.moveTo(L[0], L[1]); x.lineTo(LT[0], LT[1]); x.moveTo(R[0], R[1]); x.lineTo(RT[0], RT[1]); x.stroke(); }
        for (const ringPts of [bot, top]) { x.beginPath(); ringPts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill(); x.stroke(); }
        // minor axis (points straight at the eye → vertical here)
        const c0 = cam.proj(cxw, base + hgt, 9);
        if (c0) { x.strokeStyle = '#ff5a5f'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(c0[0], c0[1] - 40); x.lineTo(c0[0], c0[1] + 40); x.stroke(); x.setLineDash([]); }
      }
    }
    // boxes
    for (const b of [...st.boxes].sort((p, q) => q.z - p.z)) {
      const P = boxVerts(b).map((q) => cam.proj(...q));
      if (P.some((p) => !p)) continue;
      const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      const shade = ['#3b3f52', '#9aa6d6', '#6c77a8', '#57608c', '#6c77a8', '#57608c'];
      // painter's order by depth
      faces.map((f, i) => ({ f, i, z: f.reduce((a, k) => a + P[k][2], 0) })).sort((a, b2) => b2.z - a.z).forEach(({ f, i }) => {
        x.beginPath(); f.forEach((k, n) => (n ? x.lineTo(P[k][0], P[k][1]) : x.moveTo(P[k][0], P[k][1]))); x.closePath();
        x.fillStyle = shade[i]; x.globalAlpha = 0.9; x.fill(); x.globalAlpha = 1;
        x.strokeStyle = '#eef1ff'; x.lineWidth = 1.6; x.stroke();
      });
    }
    // figures (same height → eye level crosses them at the same body point)
    if (mode === 'figures' || mode === 'horizon') {
      const list = mode === 'figures' ? figs : [[-0.8, 7], [4.6, 18]];
      list.sort((a, b) => b[1] - a[1]).forEach(([fx, fz]) => drawFigure(x, cam, fx, fz));
    }
    // vanishing point markers
    vps.forEach((v, i) => {
      if (!v || !v[2]) return;
      if (mode === '1pt' && i !== 1) return; // only the depth VP matters in 1-point
      if (mode !== '3pt' && i === 2) return;
      const onScreen = v[0] > -40 && v[0] < W + 40 && v[1] > -40 && v[1] < H + 40;
      const px = clamp(v[0], 12, W - 12), py = clamp(v[1], 12, H - 12);
      x.fillStyle = VPC[i]; x.beginPath(); x.arc(px, py, onScreen ? 7 : 5, 0, 7); x.fill();
      x.font = '700 12px -apple-system, sans-serif'; x.textAlign = px > W - 60 ? 'right' : 'left';
      x.fillText((onScreen ? '' : '→ ') + 'VP' + (mode === '1pt' ? '' : i + 1) + (onScreen ? '' : ' (off canvas)'), px + (px > W - 60 ? -10 : 10), py - 8);
    });
    st.cam = cam;
  };
  // drag a box on the ground
  let dragBox = null, grabOff = null;
  drags(S, () => [], (p, first) => {
    const cam = st.cam; if (!cam) return;
    const g = cam.ground(p.x, p.y, 0);
    if (first) {
      dragBox = null;
      if (g) for (const b of st.boxes) if (Math.hypot(g[0] - b.x, g[2] - b.z) < Math.max(b.w, b.d) * 0.9 + 0.6 && b.y === 0) { dragBox = b; grabOff = [b.x - g[0], b.z - g[2]]; break; }
      if (!dragBox && st.boxes[0]) { dragBox = st.boxes[0]; grabOff = g ? [0, 0] : null; }
    }
    if (!dragBox || !g || !grabOff) return;
    dragBox.x = clamp(g[0] + grabOff[0], -12, 12); dragBox.z = clamp(g[2] + grabOff[1], 3, 60);
    draw();
  });
  const box = controls(host);
  slider(box, 'Eye level (camera height)', 0.2, 6, 0.1, st.camH, (v) => { st.camH = v; draw(); }, (v) => v.toFixed(1) + ' m');
  if (mode === '2pt' || mode === '3pt' || mode === 'horizon') slider(box, 'Turn the box', 0, 1.5, 0.01, st.boxes[0].yaw, (v) => { st.boxes[0].yaw = v; draw(); }, (v) => Math.round(v * 57.3) + '°');
  if (mode === '3pt') slider(box, 'Look up / down', -0.8, 0.8, 0.01, st.pitch, (v) => { st.pitch = v; draw(); }, (v) => (v < 0 ? 'up ' : v > 0 ? 'down ' : '') + Math.abs(Math.round(v * 57.3)) + '°');
  if (mode === 'ellipse') slider(box, 'Middle cylinder height', 0.2, 2.2, 0.01, st.cyl, (v) => { st.cyl = v; draw(); }, (v) => (v * 2.4).toFixed(1) + ' m');
  if (mode === 'horizon' || mode === '2pt') slider(box, 'Lens (focal length)', 200, 900, 10, st.F, (v) => { st.F = v; draw(); }, (v) => (v < 330 ? 'wide ' : v > 600 ? 'tele ' : 'normal ') + Math.round(v / 12) + ' mm');
  toggle(box, 'Construction lines', st.lines, (v) => { st.lines = v; draw(); });
  toggle(box, 'Ground grid', st.grid, (v) => { st.grid = v; draw(); });
  note(box, mode === 'figures' ? 'Every person here is the same height. Wherever they stand, the horizon cuts them at the same place (here, near the eyes, because the camera is at 1.6 m). Change the eye level and watch.' : mode === 'ellipse' ? 'Circles become ellipses. The nearer a circle is to eye level, the thinner it gets; at eye level it is a straight line. The minor axis (red) lines up with the cylinder\'s central axis.' : 'Drag on the ground to move the box. Its parallel edges all meet at their vanishing point, and every vanishing point for level edges sits on the horizon.');
  draw();
  return () => {};
}

// ───────── a small drawing pad with snapping to a 2-point guide (mirrors the Studio tool) ─────────
function snapPad(host) {
  const S = stage(host, 720, 420, { cls: 'paper' }), x = S.x, W = S.W, H = S.H;
  const st = { vps: [{ x: 40, y: 170 }, { x: 680, y: 170 }], snap: true, strokes: [], cur: null, type: '2pt' };
  const ink = h('canvas'); ink.width = W; ink.height = H; const ix = ink.getContext('2d');
  const draw = () => {
    x.fillStyle = '#fbfaf7'; x.fillRect(0, 0, W, H);
    x.lineWidth = 1;
    st.vps.slice(0, st.type === '1pt' ? 1 : 2).forEach((v, i) => {
      x.strokeStyle = VPC[i] + '55'; x.beginPath();
      for (let k = 0; k < 28; k++) { const a = (k / 28) * Math.PI * 2; x.moveTo(v.x, v.y); x.lineTo(v.x + Math.cos(a) * 1200, v.y + Math.sin(a) * 1200); }
      x.stroke();
    });
    x.strokeStyle = '#ffb020'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, st.vps[0].y); x.lineTo(W, st.type === '1pt' ? st.vps[0].y : st.vps[0].y + (st.vps[1].y - st.vps[0].y) * (W / (st.vps[1].x - st.vps[0].x || 1)) - (st.vps[1].y - st.vps[0].y) * (st.vps[0].x / (st.vps[1].x - st.vps[0].x || 1))); x.stroke();
    x.drawImage(ink, 0, 0, W, H);
    st.vps.slice(0, st.type === '1pt' ? 1 : 2).forEach((v, i) => { x.fillStyle = VPC[i]; x.beginPath(); x.arc(v.x, v.y, 9, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = '700 10px sans-serif'; x.textAlign = 'center'; x.fillText(st.type === '1pt' ? 'VP' : 'VP' + (i + 1), v.x, v.y + 3.5); });
  };
  const dirs = (s) => {
    const out = [];
    for (const v of st.vps.slice(0, st.type === '1pt' ? 1 : 2)) { const L = Math.hypot(v.x - s.x, v.y - s.y); if (L > 2) out.push([(v.x - s.x) / L, (v.y - s.y) / L]); }
    out.push([0, 1]); if (st.type === '1pt') out.push([1, 0]);
    return out;
  };
  let mode = null;
  S.c.style.touchAction = 'none';
  S.c.addEventListener('pointerdown', (e) => {
    const p = S.pos(e); S.c.setPointerCapture(e.pointerId);
    const hit = st.vps.slice(0, st.type === '1pt' ? 1 : 2).findIndex((v) => Math.hypot(v.x - p.x, v.y - p.y) < 16);
    if (hit >= 0) { mode = { vp: hit }; return; }
    mode = { draw: true, start: p, last: p, dir: null };
  });
  S.c.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const p = S.pos(e);
    if (mode.vp != null) { const v = st.vps[mode.vp]; v.x = p.x; v.y = p.y; if (st.type === '2pt') st.vps[1 - mode.vp].y = p.y; draw(); return; }
    let q = p;
    if (st.snap) {
      if (!mode.dir) {
        (mode.pend ||= []).push(p);
        if (Math.hypot(p.x - mode.start.x, p.y - mode.start.y) < 22) return;
        let mx = 0, my = 0; for (const q of mode.pend) { mx += q.x - mode.start.x; my += q.y - mode.start.y; }
        const L = Math.hypot(mx, my) || 1;
        let best = null, bs = 9; for (const d of dirs(mode.start)) { const sn = Math.abs((mx * d[1] - my * d[0]) / L); if (sn < bs) { bs = sn; best = d; } }
        mode.dir = best;
      }
      const t = (p.x - mode.start.x) * mode.dir[0] + (p.y - mode.start.y) * mode.dir[1];
      q = { x: mode.start.x + mode.dir[0] * t, y: mode.start.y + mode.dir[1] * t };
    }
    ix.strokeStyle = '#1d1d24'; ix.lineWidth = 2.2; ix.lineCap = 'round';
    ix.beginPath(); ix.moveTo(mode.last.x, mode.last.y); ix.lineTo(q.x, q.y); ix.stroke();
    mode.last = q; draw();
  });
  const end = () => { mode = null; };
  S.c.addEventListener('pointerup', end); S.c.addEventListener('pointercancel', end);
  const box = controls(host);
  chips(box, [['1pt', '1-point'], ['2pt', '2-point']], st.type, (v) => { st.type = v; if (v === '1pt') st.vps[0] = { x: W / 2, y: 170 }; else st.vps = [{ x: 40, y: st.vps[0].y }, { x: 680, y: st.vps[0].y }]; draw(); });
  toggle(box, 'Snap strokes to the guide', st.snap, (v) => { st.snap = v; });
  button(box, 'Clear drawing', () => { ix.clearRect(0, 0, W, H); draw(); });
  note(box, 'Draw here with your pen or finger. Each stroke follows the guide line closest to the direction you start in: towards a vanishing point or straight up and down. Drag the coloured points to move them. This is exactly how the Perspective tool works in the Studio.');
  draw();
  return () => {};
}

// ───────── backgrounds ─────────
function landscape(x, W, H, o = {}) {
  const haze = o.haze ?? 0.6, hz = rgb(o.hazeColor || '#a9c3e8');
  const sky = x.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, hex(...mix([52, 92, 160], hz, 0.25))); sky.addColorStop(1, hex(...hz));
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  // sun
  if (o.sun !== false) { x.fillStyle = 'rgba(255,240,200,0.9)'; x.beginPath(); x.arc(W * 0.74, H * 0.24, H * 0.06, 0, 7); x.fill(); }
  const layers = [
    { seed: 11, base: 0.52, amp: 0.22, col: [70, 82, 110], d: 1 },
    { seed: 23, base: 0.64, amp: 0.2, col: [58, 74, 72], d: 0.66 },
    { seed: 37, base: 0.78, amp: 0.16, col: [46, 64, 44], d: 0.33 },
    { seed: 51, base: 0.95, amp: 0.14, col: [30, 38, 28], d: 0 },
  ];
  for (const L of layers) {
    const t = o.flat ? 0 : haze * L.d;
    const c = mix(L.col, hz, Math.min(0.92, t * 1.05));
    fillRidge(x, ridge(L.seed, W, H * L.base, H * L.amp, 0.55), H, hex(...c));
  }
  // trees on the nearest ridge
  if (o.trees !== false) {
    const r = rng(5);
    for (let i = 0; i < 14; i++) {
      const tx = r() * W, ty = H * (0.86 + r() * 0.1), s = H * (0.07 + r() * 0.06);
      x.fillStyle = '#1b231a'; x.beginPath(); x.moveTo(tx, ty - s); x.lineTo(tx + s * 0.32, ty); x.lineTo(tx - s * 0.32, ty); x.closePath(); x.fill();
    }
  }
}
function atmosphere(host) {
  const S = stage(host, 720, 400), st = { haze: 0.65, color: '#a9c3e8', flat: false };
  const draw = () => landscape(S.x, S.W, S.H, { haze: st.haze, hazeColor: st.color, flat: st.flat });
  const box = controls(host);
  slider(box, 'Atmosphere (haze)', 0, 1, 0.01, st.haze, (v) => { st.haze = v; draw(); }, (v) => Math.round(v * 100) + '%');
  chips(box, [['#a9c3e8', 'Day'], ['#f2b27a', 'Sunset'], ['#3b4466', 'Night'], ['#cfd3cf', 'Fog'], ['#8a6fa8', 'Fantasy']], st.color, (v) => { st.color = v; draw(); });
  toggle(box, 'Turn off depth (all layers same colour)', false, (v) => { st.flat = v; draw(); });
  note(box, 'Each ridge is the same colour; only the amount of air in front of it changes. Far away: lighter, less contrast, closer to the sky colour. Turn the depth off and the picture goes flat.');
  draw();
  return () => {};
}
function valueGroups(host) {
  const S = stage(host, 720, 400), st = { mode: 'color' };
  const src = h('canvas'); src.width = S.W; src.height = S.H;
  landscape(src.getContext('2d'), S.W, S.H, { haze: 0.7 });
  const draw = () => {
    const x = S.x;
    if (st.mode === 'color') { x.drawImage(src, 0, 0, S.W, S.H); return; }
    const sx = src.getContext('2d'), img = sx.getImageData(0, 0, S.W, S.H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      let v = l;
      if (st.mode === '3') v = l < 70 ? 40 : l < 150 ? 120 : 210;
      if (st.mode === '2') v = l < 110 ? 50 : 200;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    const t = h('canvas'); t.width = S.W; t.height = S.H; t.getContext('2d').putImageData(img, 0, 0);
    x.drawImage(t, 0, 0, S.W, S.H);
  };
  const box = controls(host);
  chips(box, [['color', 'Colour'], ['gray', 'Greyscale'], ['3', '3 values'], ['2', '2 values (notan)']], st.mode, (v) => { st.mode = v; draw(); });
  note(box, 'Squint at the picture. If it still reads as 3 simple shapes of light, middle and dark, the composition works. Plan backgrounds in 3–4 values before adding colour.');
  draw();
  return () => {};
}
function composition(host) {
  const S = stage(host, 720, 405), st = { fx: 0.5, fy: 0.62, grid: true, lines: true };
  const draw = () => {
    const x = S.x, W = S.W, H = S.H;
    landscape(x, W, H, { haze: 0.6, trees: false, sun: false });
    // path / road leading in
    if (st.lines) {
      const tx = st.fx * W, ty = st.fy * H;
      x.fillStyle = 'rgba(214,190,150,0.75)';
      x.beginPath(); x.moveTo(W * 0.38, H); x.lineTo(tx - 5, ty + 14); x.lineTo(tx + 5, ty + 14); x.lineTo(W * 0.72, H); x.closePath(); x.fill();
    }
    // the focal point: a small figure with a red cape (warmest, most contrasty thing)
    const fx = st.fx * W, fy = st.fy * H;
    x.fillStyle = '#c0392b'; x.beginPath(); x.moveTo(fx, fy - 26); x.lineTo(fx + 11, fy + 12); x.lineTo(fx - 11, fy + 12); x.closePath(); x.fill();
    x.fillStyle = '#f2d6b3'; x.beginPath(); x.arc(fx, fy - 30, 6, 0, 7); x.fill();
    if (st.grid) {
      x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 1; x.setLineDash([6, 5]); x.beginPath();
      for (const t of [1 / 3, 2 / 3]) { x.moveTo(W * t, 0); x.lineTo(W * t, H); x.moveTo(0, H * t); x.lineTo(W, H * t); }
      x.stroke(); x.setLineDash([]);
    }
    const d = Math.min(...[1 / 3, 2 / 3].flatMap((a) => [1 / 3, 2 / 3].map((b) => Math.hypot(st.fx - a, (st.fy - b) * H / W))));
    const centered = Math.abs(st.fx - 0.5) < 0.05;
    msg.textContent = d < 0.05 ? '✓ On a thirds intersection: the eye lands here and the picture feels balanced but alive.' : centered ? 'Dead centre: very stable and calm (good for symmetry, formal or confrontational shots), but often static.' : st.fx < 0.08 || st.fx > 0.92 || st.fy < 0.08 || st.fy > 0.92 ? 'Too close to the edge: the eye slides out of the picture.' : 'Try dragging the figure onto one of the four points where the dashed lines cross.';
  };
  drags(S, () => [{ x: st.fx * S.W, y: st.fy * S.H - 10, r: 40, onDrag: (p) => { st.fx = clamp(p.x / S.W, 0.02, 0.98); st.fy = clamp((p.y + 10) / S.H, 0.1, 0.98); draw(); } }]);
  const box = controls(host);
  toggle(box, 'Rule-of-thirds grid', true, (v) => { st.grid = v; draw(); });
  toggle(box, 'Leading line (path)', true, (v) => { st.lines = v; draw(); });
  const msg = note(box, '');
  draw();
  return () => {};
}

// ───────── faces ─────────
export const EXPR = {
  neutral: {},
  joy: { corners: 1, open: 0.25, squint: 0.55, cheeks: 1, browIn: 0.1, browOut: 0.15 },
  sadness: { browIn: 1, browOut: -0.6, knit: 0.4, lid: 0.7, corners: -0.8, chin: 0.6 },
  surprise: { browIn: 1, browOut: 1, lid: 1.35, open: 0.9, width: -0.35 },
  fear: { browIn: 1, browOut: 0.4, knit: 0.9, lid: 1.35, open: 0.35, width: 0.85, corners: -0.2 },
  anger: { browIn: -1, browOut: 0.2, knit: 1, lid: 1.15, squint: 0.4, open: 0, width: -0.15, press: 1, nose: 0.3 },
  disgust: { browIn: -0.5, knit: 0.5, squint: 0.6, nose: 1, upper: 1, corners: -0.4, width: 0.1 },
  contempt: { side: 1, lid: 0.85, browOut: 0.15 },
};
const EXPR_NAMES = { joy: 'Joy', sadness: 'Sadness', surprise: 'Surprise', fear: 'Fear', anger: 'Anger', disgust: 'Disgust', contempt: 'Contempt' };
const EXPR_TELLS = {
  joy: 'Mouth corners pulled up and back; the cheeks push up and the lower lids squint (a real, "Duchenne" smile reaches the eyes).',
  sadness: 'Inner ends of the brows pulled UP and together (the key tell), upper lids droop, mouth corners pulled down, chin may pucker.',
  surprise: 'Whole brows lifted high and curved, eyes wide open (white above the iris), jaw dropped loosely. Short-lived.',
  fear: 'Brows raised AND pulled together (flatter than surprise), eyes wide and tense, lips stretched sideways.',
  anger: 'Brows pulled down and together, a hard glare (upper lids raised, lower lids tense), lips pressed thin or squared-open.',
  disgust: 'Nose wrinkled, upper lip raised, lower lids pushed up, brows lowered.',
  contempt: 'One mouth corner tightened and raised: the only one-sided universal expression.',
};
let faceUid = 0;
export function faceSVG(p, { size = 300, stage = 6, blank = false, transparent = false } = {}) {
  const P = { browIn: 0, browOut: 0, knit: 0, lid: 1, squint: 0, corners: 0, open: 0, width: 0, cheeks: 0, nose: 0, upper: 0, press: 0, side: 0, chin: 0, tilt: 0, gaze: 0, ...p };
  const u = 'f' + (++faceUid);
  const C = { skin: '#f7d9c4', skinSh: '#e6a98f', skinSh2: '#d98f78', hair: '#3b2b47', hairSh: '#241a30', hairHi: '#7a6493', iris: '#6a3f2a', irisLo: '#c98b4f', shirt: '#2f4a7a', shirtSh: '#22365c', line: '#2a1a1c', lip: '#c86a6a', mouth: '#5b1f2a', bg1: '#ffcf9e', bg2: '#8a6ab0' };
  const sketch = stage === 0, lines = stage >= 1, flats = stage >= 2, shade = stage >= 3, light = stage >= 4, bg = stage >= 5, grade = stage >= 6;
  const F = (c) => (flats ? c : stage === 1 && !transparent ? '#ffffff' : 'none');
  const L = (w) => (sketch ? `stroke="#6f97d6" stroke-width="${w * 0.8}" opacity="0.85"` : lines ? `stroke="${C.line}" stroke-width="${w}"` : '');
  const g = [];
  // ── background ──
  if (bg) g.push(`<defs><radialGradient id="${u}bg" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg2}"/></radialGradient></defs><rect width="300" height="360" fill="url(#${u}bg)"/>` +
    [[40, 60, 22], [255, 90, 14], [230, 300, 26], [30, 280, 12], [270, 200, 8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.18"/>`).join(''));
  else if (!transparent) g.push(`<rect width="300" height="360" fill="#ffffff"/>`);
  if (sketch && !blank) g.push(`<g fill="none" stroke="#9db8e6" stroke-width="1.2"><circle cx="150" cy="150" r="92"/><path d="M150,40 V305 M58,168 H242 M80,228 H220 M100,268 L150,303 L200,268"/></g>`);
  const T = `rotate(${P.tilt * 10} 150 200)`;
  g.push(`<g transform="${T}" stroke-linejoin="round" stroke-linecap="round">`);
  // ── back hair (behind everything) ──
  g.push(`<path d="M46,172 C30,58 98,8 152,10 C218,10 276,60 256,174 C264,232 260,280 244,314 C222,294 212,264 210,228 L90,228 C90,264 80,294 56,314 C40,280 36,232 46,172Z" fill="${F(C.hairSh)}" ${L(2.2)}/>`);
  // ── neck + shoulders ──
  g.push(`<path d="M126,268 L128,322 L172,322 L174,268Z" fill="${F(C.skin)}" ${L(2)}/>`);
  if (shade) g.push(`<path d="M126,276 C140,300 160,300 174,276 L174,300 C160,312 140,312 126,300Z" fill="${C.skinSh}" opacity="0.9"/>`);
  g.push(`<path d="M40,362 C46,334 90,318 128,314 C140,330 160,330 172,314 C210,318 254,334 260,362Z" fill="${F(C.shirt)}" ${L(2.2)}/>`);
  if (shade) g.push(`<path d="M172,314 C210,318 254,334 260,362 L196,362 C198,340 190,326 172,314Z" fill="${C.shirtSh}"/>`);
  g.push(`<path d="M128,314 L150,346 L172,314" fill="none" ${L(2)}/>`);
  // ── face ──
  const face = 'M66,150 C64,198 76,234 104,266 C121,286 138,296 150,297 C162,296 179,286 196,266 C224,234 236,198 234,150 C234,78 198,44 150,44 C102,44 66,78 66,150Z';
  g.push(`<defs><clipPath id="${u}face"><path d="${face}"/></clipPath>
    <radialGradient id="${u}blush"><stop offset="0" stop-color="#ff7f8a" stop-opacity="0.55"/><stop offset="1" stop-color="#ff7f8a" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f120c"/><stop offset="0.55" stop-color="${C.iris}"/><stop offset="1" stop-color="${C.irisLo}"/></linearGradient>
    <linearGradient id="${u}hairHi" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.hairHi}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.hairHi}"/><stop offset="1" stop-color="${C.hairHi}" stop-opacity="0"/></linearGradient></defs>`);
  // ears
  for (const s of [-1, 1]) g.push(`<path d="M${150 + s * 86},158 C${150 + s * 102},150 ${150 + s * 104},184 ${150 + s * 84},196" fill="${F(C.skin)}" ${L(2)}/>`);
  g.push(`<path d="${face}" fill="${F(C.skin)}" ${L(2.6)}/>`);
  if (shade) {
    // cel shadows: light from the upper left — right side of the face, under the fringe, under the nose and lip
    g.push(`<g clip-path="url(#${u}face)" fill="${C.skinSh}">
      <path d="M236,120 C214,150 210,200 222,232 C206,262 182,290 150,304 L250,304 L250,120Z"/>
      <path d="M150,226 C156,232 162,232 166,228 C162,236 154,238 150,236Z"/>
      </g>`);
  }
  // blush
  if (flats && (P.cheeks > 0.05 || light)) {
    const o = light ? 0.35 + P.cheeks * 0.65 : P.cheeks;
    g.push(`<ellipse cx="96" cy="216" rx="26" ry="14" fill="url(#${u}blush)" opacity="${o}"/><ellipse cx="204" cy="216" rx="26" ry="14" fill="url(#${u}blush)" opacity="${o}"/>`);
  }
  // ── eyes ──
  const eye = (cx, s) => {
    // s = -1 picture-left eye (inner corner toward +x), +1 picture-right eye
    const cy = 176, ix = cx + (s < 0 ? 22 : -22), ox = cx + (s < 0 ? -25 : 25); // inner / outer corners
    const top = cy - 21 * P.lid, low = cy + 13 * (1 - P.squint * 0.75) - P.cheeks * 4;
    const oy = cy - 2 + P.side * (s > 0 ? -2 : 0), iy = cy + 3;
    const upper = `M${ox},${oy} C${ox + (ix - ox) * 0.15},${top} ${ix - (ix - ox) * 0.25},${top - 2} ${ix},${iy}`;
    const lower = `C${ix - (ix - ox) * 0.3},${low} ${ox + (ix - ox) * 0.25},${low} ${ox},${oy}`;
    const shape = upper + ' ' + lower + 'Z';
    const gx = cx + P.gaze * 8;
    let s1 = `<clipPath id="${u}e${s}"><path d="${shape}"/></clipPath><path d="${shape}" fill="${F('#fffaf6')}"/>`;
    if (flats) s1 += `<g clip-path="url(#${u}e${s})"><ellipse cx="${gx}" cy="${cy + 1}" rx="14" ry="17.5" fill="url(#${u}iris)"/><ellipse cx="${gx}" cy="${cy + 1}" rx="14" ry="17.5" fill="none" stroke="#1f120c" stroke-width="1.6"/><ellipse cx="${gx}" cy="${cy + 2}" rx="5.5" ry="7.5" fill="#140b08"/>` +
      (shade ? `<path d="${upper}" fill="none" stroke="#7a5a6a" stroke-width="9" opacity="0.35"/>` : '') +
      (light ? `<circle cx="${gx + 5}" cy="${cy - 6}" r="4.2" fill="#fff"/><circle cx="${gx - 5}" cy="${cy + 8}" r="1.9" fill="#fff" opacity="0.9"/>` : '') + `</g>`;
    else if (lines) s1 += `<g clip-path="url(#${u}e${s})" fill="none" ${L(1.6)}><ellipse cx="${gx}" cy="${cy + 1}" rx="14" ry="17.5"/><ellipse cx="${gx}" cy="${cy + 2}" rx="5.5" ry="7.5"/></g>`;
    // lash line: heavy, with a flick at the outer corner
    s1 += `<path d="${upper}" fill="none" ${sketch ? L(2) : `stroke="${C.line}" stroke-width="4.2"`}/>`;
    if (!sketch && lines) s1 += `<path d="M${ox},${oy} q${s < 0 ? -7 : 7},-2 ${s < 0 ? -10 : 10},-8" fill="none" stroke="${C.line}" stroke-width="2.6"/>`;
    s1 += `<path d="M${ox + (ix - ox) * 0.1},${oy + 3} Q${ox + (ix - ox) * 0.45},${low + 1} ${ix - (ix - ox) * 0.2},${low - 2}" fill="none" ${L(1.4)}/>`;
    // eyelid crease
    s1 += `<path d="M${ox + (ix - ox) * 0.1},${top + 3} Q${cx},${top - 9} ${ix - (ix - ox) * 0.15},${top + 4}" fill="none" ${sketch ? L(1) : lines ? `stroke="#a8786a" stroke-width="1.5"` : ''}/>`;
    if (P.squint > 0.3 && lines && !sketch) s1 += `<path d="M${ox + (ix - ox) * 0.2},${low + 7} Q${cx},${low + 11} ${ix - (ix - ox) * 0.2},${low + 6}" fill="none" stroke="#c48a7a" stroke-width="1.3" opacity="${P.squint}"/>`;
    return s1;
  };
  if (!blank) g.push(eye(108, -1), eye(192, 1));
  // ── brows: tapered, filled ──
  const brow = (s) => {
    const inX = 150 + s * (20 - P.knit * 7), outX = 150 + s * 74, by = 140;
    const inY = by - 13 * P.browIn + (P.knit > 0 ? 3 * P.knit : 0), outY = by + 6 - 11 * P.browOut - (P.side && s > 0 ? 5 * P.side : 0);
    const mx = (inX + outX) / 2, my = Math.min(inY, outY) - 7 - 3 * Math.max(0, P.browIn + P.browOut) / 2 + (P.browIn < 0 ? 5 : 0);
    const top = [], bot = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, x = (1 - t) * (1 - t) * inX + 2 * (1 - t) * t * mx + t * t * outX, y = (1 - t) * (1 - t) * inY + 2 * (1 - t) * t * my + t * t * outY;
      const dx = 2 * (1 - t) * (mx - inX) + 2 * t * (outX - mx), dy = 2 * (1 - t) * (my - inY) + 2 * t * (outY - my), l = Math.hypot(dx, dy) || 1;
      const w = 4.2 * (1 - t) + 1 * t;
      top.push([x + (dy / l) * w * s, y - (dx / l) * w * s]); bot.push([x - (dy / l) * w * s, y + (dx / l) * w * s]);
    }
    const pts = [...top, ...bot.reverse()].map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ') + 'Z';
    let out = sketch ? `<path d="${pts}" fill="none" ${L(1.4)}/>` : `<path d="${pts}" fill="${flats ? C.hair : C.line}"/>`;
    if (P.knit > 0.5 && s < 0 && lines && !sketch) out += `<path d="M144,${by + 4} l2,-11 M156,${by + 4} l-2,-11" stroke="#b07e6e" stroke-width="1.5" opacity="${P.knit}"/>`;
    if (P.browIn > 0.6 && s < 0 && lines && !sketch) out += `<path d="M130,${by - 20} Q150,${by - 25} 170,${by - 20}" fill="none" stroke="#c49a82" stroke-width="1.2"/>`;
    return out;
  };
  // ── nose ──
  let nose = `<path d="M152,214 Q156,226 148,230" fill="none" ${sketch ? L(1.4) : lines ? `stroke="#b0705c" stroke-width="2"` : ''}/>`;
  if (light) nose += `<ellipse cx="150" cy="221" rx="2" ry="3" fill="#fff" opacity="0.7"/>`;
  if (P.nose > 0.3 && lines && !sketch) nose += `<path d="M136,198 l7,5 M164,198 l-7,5 M138,207 l6,2 M162,207 l-6,2" stroke="#b0705c" stroke-width="1.4" opacity="${P.nose}"/>`;
  // ── mouth ──
  const my = 256, hw = 21 + 9 * P.width - 4 * P.press;
  const cL = P.corners * 9, cR = P.corners * 9 + P.side * 8;
  const lx = 150 - hw, rx = 150 + hw, ly = my - cL, ry = my - cR;
  const upY = my - 2 - P.upper * 7 + Math.max(0, P.corners) * 5;
  const lowY = my + 3 + P.open * 34 + Math.max(0, P.corners) * 10 - P.press * 2;
  const isOpen = P.open > 0.05 || P.corners > 0.55 || P.upper > 0.4;
  const inside = `M${lx},${ly} Q150,${upY} ${rx},${ry} Q150,${lowY} ${lx},${ly}Z`;
  let mouth = '';
  if (isOpen) {
    mouth += `<clipPath id="${u}m"><path d="${inside}"/></clipPath><path d="${inside}" fill="${F(C.mouth)}" ${L(2)}/>`;
    if (flats) mouth += `<g clip-path="url(#${u}m)"><rect x="100" y="${upY - 3}" width="100" height="${6 + P.corners * 3 + P.upper * 3}" fill="#fff"/><ellipse cx="150" cy="${lowY + 3}" rx="${hw * 0.62}" ry="${7 + P.open * 7}" fill="#d9707a"/></g>`;
  } else mouth += `<path d="M${lx},${ly} Q150,${(upY + lowY) / 2 + 1} ${rx},${ry}" fill="none" ${sketch ? L(1.6) : lines ? `stroke="#6b2b33" stroke-width="${2.4 + P.press * 1.4}"` : ''}/>`;
  if (lines && !sketch) mouth += `<path d="M${150 - hw * 0.35},${lowY + 9} Q150,${lowY + 12} ${150 + hw * 0.35},${lowY + 9}" fill="none" stroke="#d9a090" stroke-width="1.6"/>`;
  if ((P.corners < -0.4 || P.chin > 0.3) && lines && !sketch) mouth += `<path d="M138,${my + 32} Q150,${my + 28 + P.chin * 4} 162,${my + 32}" fill="none" stroke="#c49a82" stroke-width="1.3"/>`;
  if (P.upper > 0.3 && lines && !sketch) mouth += `<path d="M118,214 Q108,236 ${lx - 3},${ly + 3} M182,214 Q192,236 ${rx + 3},${ry + 3}" fill="none" stroke="#c99482" stroke-width="1.4"/>`;
  if (!blank) g.push(brow(-1), brow(1), nose, mouth);
  // ── fringe / bangs and side locks (in front of the face) ──
  // side locks
  for (const s of [-1, 1]) g.push(`<path d="M${150 + s * 90},150 C${150 + s * 98},196 ${150 + s * 94},240 ${150 + s * 76},280 C${150 + s * 82},240 ${150 + s * 78},200 ${150 + s * 72},168Z" fill="${F(C.hair)}" ${L(2)}/>`);
  // swept fringe: curved locks between notches, sweeping from left to right
  const locks = [[244, 176], [236, 212, 'tip'], [228, 138], [214, 128, 'tip'], [200, 98], [182, 124, 'tip'], [166, 94], [148, 122, 'tip'], [134, 92], [116, 124, 'tip'], [102, 98], [88, 130, 'tip'], [78, 122], [64, 208, 'tip'], [56, 176]];
  let bang = 'M56,176 C40,60 100,12 152,14 C214,14 268,64 244,176';
  for (let i = 1; i < locks.length; i++) {
    const [x0, y0] = locks[i - 1], [x1, y1, k] = locks[i];
    bang += k === 'tip' ? ` C${x0 - 2},${y0 + (y1 - y0) * 0.6} ${x1 + 7},${y1 - 14} ${x1},${y1}` : ` C${x0 - 3},${y0 - 16} ${x1 + 5},${y1 + (y0 - y1) * 0.45} ${x1},${y1}`;
  }
  bang += 'Z';
  // the fringe casts a soft-edged shadow on the forehead that follows the locks
  if (shade) g.push(`<g clip-path="url(#${u}face)"><path d="${bang}" transform="translate(6 11)" fill="${C.skinSh}"/></g>`);
  if (light) g.push(`<path d="M68,152 C66,196 78,232 104,264" fill="none" stroke="#fff4d8" stroke-width="3" opacity="0.75"/>`);
  g.push(`<path d="${bang}" fill="${F(C.hair)}" ${L(2.4)}/>`);
  if (shade) g.push(`<defs><clipPath id="${u}hr"><rect x="176" y="0" width="140" height="360"/></clipPath></defs><path d="${bang}" fill="${C.hairSh}" opacity="0.7" clip-path="url(#${u}hr)"/>`);
  if (light) g.push(`<path d="M80,64 Q150,30 222,64" fill="none" stroke="url(#${u}hairHi)" stroke-width="8" opacity="0.9"/><path d="M92,78 Q112,62 130,56 M172,56 Q192,62 208,78 M120,92 Q128,74 140,66" fill="none" stroke="${C.hairHi}" stroke-width="2" opacity="0.75"/>`);
  g.push(`</g>`);
  // ── colour grade: warm sunset wash + vignette ──
  if (grade) g.push(`<defs><radialGradient id="${u}vig" cx="50%" cy="45%" r="75%"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1a0c2a" stop-opacity="0.55"/></radialGradient></defs><rect width="300" height="360" fill="#ff9a5a" style="mix-blend-mode:soft-light" opacity="0.55"/><rect width="300" height="360" fill="url(#${u}vig)"/>`);
  return `<svg viewBox="0 0 300 360" width="${size}" style="max-width:100%;display:block" xmlns="http://www.w3.org/2000/svg">${g.join('')}</svg>`;
}

function faceRig(host, { quiz = false } = {}) {
  const st = { ...EXPR.neutral };
  const wrap = h('div', { class: 'lx-face' }); host.append(wrap);
  const view = h('div', { class: 'lx-face-view' }); wrap.append(view);
  const side = h('div', { class: 'lx-face-side' }); wrap.append(side);
  const sliders = {};
  const draw = () => { view.innerHTML = faceSVG(st, { size: 300 }); };
  const setAll = (p) => { for (const k of Object.keys(sliders)) { st[k] = p[k] ?? (k === 'lid' ? 1 : 0); sliders[k].set(st[k]); } draw(); };
  const box = controls(side);
  if (!quiz) {
    const tell = h('div', { class: 'lx-note' }, 'Pick an expression, then move the sliders to see which part of the face does the work.');
    chips(box, [['neutral', 'Neutral'], ...Object.entries(EXPR_NAMES)], 'neutral', (v) => { setAll(EXPR[v]); tell.textContent = v === 'neutral' ? 'Neutral: everything relaxed. Start every expression sheet from this.' : EXPR_NAMES[v] + ': ' + EXPR_TELLS[v]; });
    box.append(tell);
  }
  const defs = [['browIn', 'Inner brows ↑', -1, 1], ['browOut', 'Outer brows ↑', -1, 1], ['knit', 'Brows pulled together', 0, 1], ['lid', 'Upper lids open', 0.2, 1.4], ['squint', 'Lower lids squint', 0, 1], ['cheeks', 'Cheeks raised', 0, 1], ['nose', 'Nose wrinkle', 0, 1], ['upper', 'Upper lip raise', 0, 1], ['corners', 'Mouth corners ↑ / ↓', -1, 1], ['side', 'One corner only (smirk)', 0, 1], ['open', 'Jaw open', 0, 1], ['width', 'Lips stretched wide', -0.5, 1], ['press', 'Lips pressed', 0, 1], ['tilt', 'Head tilt', -1, 1], ['gaze', 'Look left / right', -1, 1]];
  const sl = h('div', { class: 'lx-face-sliders' }); side.append(sl);
  for (const [k, label, a, b] of defs) sliders[k] = slider(sl, label, a, b, 0.01, k === 'lid' ? 1 : 0, (v) => { st[k] = v; draw(); }, (v) => v.toFixed(2));
  setAll(EXPR.neutral);
  if (quiz) {
    const keys = Object.keys(EXPR_NAMES);
    let target = null, score = 0, tries = 0;
    const res = h('div', { class: 'lx-note' });
    const opts = h('div', { class: 'lx-chips' });
    const next = () => {
      target = keys[Math.floor(Math.random() * keys.length)];
      const p = { ...EXPR[target] };
      // a little variation so it isn't always identical
      for (const k of Object.keys(p)) p[k] = p[k] * (0.85 + Math.random() * 0.3);
      p.tilt = (Math.random() - 0.5) * 0.6; p.gaze = (Math.random() - 0.5) * 0.8;
      setAll(p); res.textContent = 'Which emotion is this?';
    };
    for (const k of keys) opts.append(h('button', { onclick: () => {
      tries++;
      if (k === target) { score++; res.textContent = `✓ ${EXPR_NAMES[k]}! ${EXPR_TELLS[k]} (${score}/${tries})`; setTimeout(next, 2600); }
      else res.textContent = `Not quite — look again at the brows and the mouth corners. (${score}/${tries})`;
    } }, EXPR_NAMES[k]));
    box.append(h('b', {}, 'Read the face'), opts, res);
    sl.hidden = true;
    button(box, 'Show the sliders', (e) => { sl.hidden = !sl.hidden; e.target.textContent = sl.hidden ? 'Show the sliders' : 'Hide the sliders'; });
    next();
  }
  return () => {};
}

// Loomis-style head: ball + side plane + face thirds, turnable in 3D
function loomisHead(host) {
  const S = stage(host, 520, 420), st = { yaw: 0.6, pitch: 0.2, roll: 0 };
  const R = 92;
  const draw = () => {
    const x = S.x, W = S.W, H = S.H, cx = W / 2, cy = H * 0.4;
    x.fillStyle = '#1c1d22'; x.fillRect(0, 0, W, H);
    const cyw = Math.cos(st.yaw), syw = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch), cr = Math.cos(st.roll), sr = Math.sin(st.roll);
    const T = ([X, Y, Z]) => {
      let x1 = X * cyw + Z * syw, z1 = -X * syw + Z * cyw, y1 = Y;
      const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
      const x3 = x1 * cr - y2 * sr, y3 = x1 * sr + y2 * cr;
      return [cx + x3 * R, cy - y3 * R, z2];
    };
    // cranium
    x.fillStyle = '#2c2f3a'; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
    x.strokeStyle = '#9aa6d6'; x.lineWidth = 2; x.stroke();
    const curve = (pts, col, w = 2, sphere = true) => {
      for (let i = 1; i < pts.length; i++) {
        const a = T(pts[i - 1]), b = T(pts[i]);
        const front = sphere ? a[2] + b[2] > 0 : true;
        x.strokeStyle = col; x.lineWidth = w; x.globalAlpha = front ? 1 : 0.28; x.setLineDash(front ? [] : [4, 4]);
        x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
      }
      x.globalAlpha = 1; x.setLineDash([]);
    };
    const circ = (f, n = 72) => Array.from({ length: n + 1 }, (_, i) => f((i / n) * Math.PI * 2));
    curve(circ((a) => [0, Math.sin(a), Math.cos(a)]), '#ff5a5f');        // centre line
    curve(circ((a) => [Math.sin(a), 0, Math.cos(a)]), '#ffb020');        // brow line (equator)
    for (const s of [-1, 1]) curve(circ((a) => [s * 0.72, Math.sin(a) * 0.69, Math.cos(a) * 0.69]), '#3d8bff'); // side planes (ear area)
    // face: hairline → brow → nose → chin, equal thirds
    const third = 0.72;
    const face = [[0, third, 0.69], [0, 0, 1], [0, -third, 0.98], [0, -2 * third, 0.78]];
    curve(face, '#ff5a5f', 2.5, false);
    const jaw = (s) => [[s * 0.72, -0.15, -0.05], [s * 0.62, -0.95, 0.15], [s * 0.3, -1.38, 0.62], [0, -2 * third, 0.78]];
    curve(jaw(-1), '#cfd6ff', 2, false); curve(jaw(1), '#cfd6ff', 2, false);
    const nose = [[-0.22, -third, 0.92], [0.22, -third, 0.92]];
    curve(nose, '#2fbf71', 2.5, false);
    curve([[-0.42, -1.12, 0.78], [0.42, -1.12, 0.78]], '#2fbf71', 2, false); // mouth line
    curve([[-0.75, 0, 0.66], [0.75, 0, 0.66]].map(([a, b, c]) => [a, b - 0.02, c]), '#ffb020', 1, false);
    // labels
    x.font = '600 12px -apple-system, sans-serif'; x.textAlign = 'left';
    const lab = (p, t, col) => { const q = T(p); if (q[2] > -0.2) { x.fillStyle = col; x.fillText(t, q[0] + 8, q[1] + 4); } };
    lab([0, third, 0.69], 'hairline', '#ff9da0'); lab([0, 0, 1], 'brow line', '#ffb020'); lab([0.22, -third, 0.92], 'bottom of nose', '#7fe0a8'); lab([0, -2 * third, 0.78], 'chin', '#cfd6ff');
  };
  const box = controls(host);
  slider(box, 'Turn (yaw)', -1.5, 1.5, 0.01, st.yaw, (v) => { st.yaw = v; draw(); }, (v) => Math.round(v * 57.3) + '°');
  slider(box, 'Nod (pitch)', -0.8, 0.8, 0.01, st.pitch, (v) => { st.pitch = v; draw(); }, (v) => Math.round(v * 57.3) + '°');
  slider(box, 'Tilt (roll)', -0.6, 0.6, 0.01, st.roll, (v) => { st.roll = v; draw(); }, (v) => Math.round(v * 57.3) + '°');
  note(box, 'Andrew Loomis\'s method: a ball for the cranium, a slice off each side (blue), a centre line (red) and a brow line (yellow). Hairline → brow → nose → chin are three roughly equal thirds. Turn the head: every feature stays glued to these lines.');
  draw();
  return () => {};
}

// ───────── colour & light ─────────
function lightSphere(host) {
  const S = stage(host, 640, 380), st = { ang: 0.75, elev: 0.6, light: '#ffe2b0', amb: '#5470b8', albedo: '#d9a07a', inten: 1, ambient: 0.35, bounce: 0.25, cel: false, labels: true };
  const N = 220;
  const tile = h('canvas'); tile.width = N; tile.height = N; const tx = tile.getContext('2d'); const img = tx.createImageData(N, N);
  const draw = () => {
    const x = S.x, W = S.W, H = S.H;
    const L = [Math.cos(st.ang) * Math.cos(st.elev), Math.sin(st.elev), Math.sin(st.ang) * Math.cos(st.elev)];
    const lc = rgb(st.light).map((v) => v / 255), ac = rgb(st.amb).map((v) => v / 255), al = rgb(st.albedo).map((v) => v / 255);
    const gc = [0.62, 0.5, 0.36];
    // background: ground and sky tinted by the ambient
    x.fillStyle = hex(...ac.map((v) => v * 140 + 20)); x.fillRect(0, 0, W, H);
    x.fillStyle = hex(...gc.map((v, i) => (v * 0.7 + lc[i] * 0.15) * 200)); x.fillRect(0, H * 0.7, W, H);
    // cast shadow on the ground, opposite the light
    const scx = W / 2 - Math.cos(st.ang) * 70 * (1.2 - st.elev), sy = H * 0.7 + 28;
    x.fillStyle = 'rgba(10,10,30,0.45)'; x.beginPath(); x.ellipse(scx, sy, 120 * (1.4 - st.elev * 0.6), 22, 0, 0, 7); x.fill();
    const d = img.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const nx = (i - N / 2) / (N / 2 - 2), ny = -(j - N / 2) / (N / 2 - 2), r2 = nx * nx + ny * ny, o = (j * N + i) * 4;
      if (r2 > 1) { d[o + 3] = 0; continue; }
      const nz = Math.sqrt(1 - r2);
      // light: x right, y up, z toward viewer; ang 0 = from the right, π/2 = from the front
      let ndl = nx * L[0] + ny * L[1] + nz * L[2];
      let diff = Math.max(0, ndl);
      if (st.cel) diff = ndl > 0.08 ? 1 : 0;
      const sky = st.ambient * (0.6 + 0.4 * ny);                 // fill from the sky (more on top)
      const bnc = st.bounce * Math.max(0, -ny) * (st.cel ? 0 : 1); // warm light bounced from the ground
      const ao = st.cel ? 1 : 0.75 + 0.25 * nz;
      const R = [0, 1, 2].map((k) => al[k] * (lc[k] * diff * st.inten + ac[k] * sky + gc[k] * bnc) * ao);
      // specular highlight
      const hx = L[0], hy = L[1], hz = L[2] + 1, hl = Math.hypot(hx, hy, hz);
      let spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 60) * 0.6 * st.inten;
      if (st.cel) spec = spec > 0.25 ? 0.5 : 0;
      for (let k = 0; k < 3; k++) d[o + k] = clamp((R[k] + spec * lc[k]) * 255, 0, 255);
      d[o + 3] = 255;
    }
    tx.putImageData(img, 0, 0);
    const sx = W / 2 - N / 2, sy0 = H * 0.7 - N + 18;
    x.drawImage(tile, sx, sy0);
    if (st.labels) {
      x.font = '600 12px -apple-system, sans-serif'; x.fillStyle = '#fff'; x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 3;
      const at = (nx, ny, t) => { const px = sx + N / 2 + nx * N / 2, py = sy0 + N / 2 - ny * N / 2; x.beginPath(); x.arc(px, py, 3, 0, 7); x.fill(); x.textAlign = nx > 0 ? 'left' : 'right'; const ox = nx > 0 ? 130 - N / 2 * nx : -130 + N / 2 * -nx; x.beginPath(); x.moveTo(px, py); x.lineTo(px + ox * 0.6, py); x.stroke(); x.strokeText(t, px + ox * 0.62, py + 4); x.fillText(t, px + ox * 0.62, py + 4); };
      // place labels along the light direction in screen space
      const lx = L[0], ly = L[1], ln = Math.hypot(lx, ly) || 1, ux = lx / ln, uy = ly / ln;
      at(ux * 0.55, uy * 0.55, 'highlight / light side');
      const tx2 = -ux * 0.25, ty2 = -uy * 0.25; at(tx2, ty2, 'core shadow (terminator)');
      at(-ux * 0.85, -uy * 0.85 - 0.05, 'reflected light');
      x.textAlign = 'left'; x.strokeText('cast shadow', scx + 90, sy + 30); x.fillText('cast shadow', scx + 90, sy + 30);
    }
  };
  const box = controls(host);
  slider(box, 'Light direction', -1.2, 4.3, 0.01, st.ang, (v) => { st.ang = v; draw(); }, (v) => Math.round(v * 57.3) + '°');
  slider(box, 'Light height', 0, 1.4, 0.01, st.elev, (v) => { st.elev = v; draw(); }, (v) => Math.round(v * 57.3) + '°');
  slider(box, 'Ambient (sky fill)', 0, 1, 0.01, st.ambient, (v) => { st.ambient = v; draw(); }, (v) => Math.round(v * 100) + '%');
  slider(box, 'Bounce from ground', 0, 1, 0.01, st.bounce, (v) => { st.bounce = v; draw(); }, (v) => Math.round(v * 100) + '%');
  const pick = (label, key) => { const i = h('input', { type: 'color', value: st[key] }); i.oninput = () => { st[key] = i.value; draw(); }; box.append(h('label', { class: 'lx-color' }, i, label)); };
  pick('Light colour', 'light'); pick('Shadow / sky colour', 'amb'); pick('Object colour', 'albedo');
  chips(box, [['day', 'Sunny day'], ['gold', 'Golden hour'], ['night', 'Moonlight'], ['neon', 'Neon'], ['over', 'Overcast']], 'day', (v) => {
    const P = { day: ['#fff1d6', '#5f86d8', 1, 0.35], gold: ['#ffb36b', '#5b5fb8', 1.05, 0.3], night: ['#9db8ff', '#1d2550', 0.7, 0.25], neon: ['#ff3fa4', '#18c6ff', 1, 0.5], over: ['#e6e8ee', '#9aa3b5', 0.45, 0.75] }[v];
    [st.light, st.amb, st.inten, st.ambient] = P; draw();
    for (const inp of box.querySelectorAll('input[type=color]')) { const k = inp.parentElement.textContent; inp.value = k.startsWith('Light') ? st.light : k.startsWith('Shadow') ? st.amb : st.albedo; }
  });
  toggle(box, 'Cel shading (2 tones)', false, (v) => { st.cel = v; draw(); });
  toggle(box, 'Labels', true, (v) => { st.labels = v; draw(); });
  note(box, 'The object\'s own colour never changes. What you see is that colour × the light on it. The lit side takes the light\'s colour, the shadow side takes the sky\'s colour, and bounce light from the ground warms the bottom. Warm light gives cool shadows, and cool light gives warm shadows.');
  draw();
  return () => {};
}
function harmony(host) {
  const S = stage(host, 680, 360), st = { hue: 20, scheme: 'comp', sat: 0.75 };
  const wheel = h('canvas'); wheel.width = 300; wheel.height = 300;
  { const w = wheel.getContext('2d'), im = w.createImageData(300, 300);
    for (let j = 0; j < 300; j++) for (let i = 0; i < 300; i++) { const dx = i - 150, dy = j - 150, r = Math.hypot(dx, dy) / 145, o = (j * 300 + i) * 4; if (r > 1) continue; const c = hsv(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360, r, 1); im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255; }
    w.putImageData(im, 0, 0); }
  const schemes = { comp: [0, 180], anal: [-30, 0, 30], split: [0, 150, 210], triad: [0, 120, 240], tetra: [0, 60, 180, 240], mono: [0, 0, 0] };
  const draw = () => {
    const x = S.x; x.fillStyle = '#18191d'; x.fillRect(0, 0, S.W, S.H);
    x.drawImage(wheel, 20, 30, 300, 300);
    const hs = schemes[st.scheme].map((d) => (st.hue + d + 360) % 360);
    const cols = hs.map((hh, i) => hsv(hh, st.scheme === 'mono' ? [0.3, 0.6, 0.9][i] : st.sat, st.scheme === 'mono' ? [0.95, 0.7, 0.4][i] : 0.92));
    hs.forEach((hh, i) => { const a = hh * Math.PI / 180, r = (st.scheme === 'mono' ? [0.3, 0.6, 0.9][i] : st.sat) * 145; const px = 170 + Math.cos(a) * r, py = 180 + Math.sin(a) * r; x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(px, py, 10, 0, 7); x.stroke(); x.fillStyle = hex(...cols[i]); x.fill(); if (i) { x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 1; x.beginPath(); x.moveTo(170 + Math.cos(hs[0] * Math.PI / 180) * st.sat * 145, 180 + Math.sin(hs[0] * Math.PI / 180) * st.sat * 145); x.lineTo(px, py); x.stroke(); } });
    // a tiny scene painted with the palette: 60-30-10 (dominant, secondary, accent)
    const [c0, c1, c2 = c1] = cols, ox = 360, oy = 40, w = 300, hh = 280;
    const dark = (c, k) => c.map((v) => v * k);
    x.fillStyle = hex(...mix(c0, [255, 255, 255], 0.35)); x.fillRect(ox, oy, w, hh * 0.62);
    x.fillStyle = hex(...dark(c0, 0.55)); x.fillRect(ox, oy + hh * 0.62, w, hh * 0.38);
    x.fillStyle = hex(...dark(c1, 0.75)); x.beginPath(); x.moveTo(ox, oy + hh * 0.62); x.lineTo(ox + 90, oy + hh * 0.3); x.lineTo(ox + 170, oy + hh * 0.62); x.fill();
    x.fillStyle = hex(...dark(c1, 0.6)); x.beginPath(); x.moveTo(ox + 120, oy + hh * 0.62); x.lineTo(ox + 220, oy + hh * 0.22); x.lineTo(ox + w, oy + hh * 0.62); x.fill();
    x.fillStyle = hex(...c2); x.beginPath(); x.moveTo(ox + 200, oy + hh * 0.6); x.lineTo(ox + 214, oy + hh * 0.86); x.lineTo(ox + 186, oy + hh * 0.86); x.fill();
    x.beginPath(); x.arc(ox + 200, oy + hh * 0.56, 8, 0, 7); x.fillStyle = '#f2d6b3'; x.fill();
    x.fillStyle = '#fff'; x.font = '600 12px -apple-system, sans-serif'; x.textAlign = 'left';
    x.fillText('60% dominant · 30% secondary · 10% accent', ox, oy + hh + 18);
  };
  drags(S, () => [], (p) => { const dx = p.x - 170, dy = p.y - 180; if (Math.hypot(dx, dy) > 160) return; st.hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; st.sat = clamp(Math.hypot(dx, dy) / 145, 0.15, 1); draw(); });
  const box = controls(host);
  chips(box, [['comp', 'Complementary'], ['anal', 'Analogous'], ['split', 'Split-complementary'], ['triad', 'Triadic'], ['tetra', 'Tetradic'], ['mono', 'Monochrome']], st.scheme, (v) => { st.scheme = v; draw(); });
  note(box, 'Drag on the wheel to choose the main hue. Harmony is about picking a few hues with a relationship, then using them in unequal amounts: one dominant, one supporting, a small accent where you want the eye to go.');
  draw();
  return () => {};
}
function valueVsHue(host) {
  const S = stage(host, 720, 300), st = { gray: false };
  const scene = (x, ox, cols) => {
    x.fillStyle = cols[0]; x.fillRect(ox, 0, 340, 300);
    x.fillStyle = cols[1]; x.beginPath(); x.arc(ox + 170, 150, 90, 0, 7); x.fill();
    x.fillStyle = cols[2]; x.fillRect(ox + 130, 200, 80, 70);
  };
  const draw = () => {
    const x = S.x; x.fillStyle = '#111'; x.fillRect(0, 0, S.W, S.H);
    // same value, different hues (L ≈ 55 %)
    scene(x, 10, ['#b07a8a', '#7c9a68', '#8d8db8']);
    // different values
    scene(x, 370, ['#2c3550', '#f0c070', '#c04040']);
    if (st.gray) {
      const im = x.getImageData(0, 0, S.W * S.dpr, S.H * S.dpr), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = l; }
      x.putImageData(im, 0, 0);
    }
  };
  const box = controls(host);
  toggle(box, 'Check values (greyscale)', false, (v) => { st.gray = v; draw(); });
  note(box, 'Left: three different hues of the same value. Right: real value contrast. Switch to greyscale: the left picture disappears. Value (light and dark) carries the drawing; hue carries the mood.');
  draw();
  return () => {};
}

// ───────── colour grading ─────────
export const GRADES = {
  neutral: { exp: 0, con: 0, sat: 0, temp: 0, tint: 0, sh: '#808080', hi: '#808080', split: 0, vig: 0, fade: 0 },
  golden: { exp: 0.1, con: 0.15, sat: 0.15, temp: 0.55, tint: 0.05, sh: '#5a3c8a', hi: '#ffb35c', split: 0.35, vig: 0.35, fade: 0 },
  night: { exp: -0.55, con: 0.1, sat: -0.35, temp: -0.6, tint: 0.05, sh: '#10204a', hi: '#9fc0ff', split: 0.45, vig: 0.55, fade: 0 },
  horror: { exp: -0.25, con: 0.45, sat: -0.6, temp: -0.15, tint: -0.35, sh: '#0c2a1c', hi: '#d8e0b0', split: 0.4, vig: 0.75, fade: 0 },
  flashback: { exp: 0.15, con: -0.3, sat: -0.55, temp: 0.35, tint: 0.05, sh: '#5a4632', hi: '#fff0d0', split: 0.4, vig: 0.4, fade: 0.35 },
  teal: { exp: 0, con: 0.25, sat: 0.1, temp: 0, tint: 0, sh: '#0f5a66', hi: '#ffa35c', split: 0.5, vig: 0.25, fade: 0 },
  dream: { exp: 0.25, con: -0.25, sat: -0.05, temp: 0.05, tint: 0.3, sh: '#7c5cc4', hi: '#ffd6f0', split: 0.4, vig: 0.15, fade: 0.25 },
};
export function gradePixels(src, dst, W, H, g) {
  const s = src.data, d = dst.data;
  const sh = rgb(g.sh).map((v) => v / 255 - 0.5), hi = rgb(g.hi).map((v) => v / 255 - 0.5);
  const ex = Math.pow(2, g.exp), cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const o = (j * W + i) * 4;
    let r = s[o] / 255 * ex, gg = s[o + 1] / 255 * ex, b = s[o + 2] / 255 * ex;
    // white balance
    r *= 1 + g.temp * 0.25; b *= 1 - g.temp * 0.25; gg *= 1 - g.tint * 0.18; r *= 1 + g.tint * 0.06; b *= 1 + g.tint * 0.06;
    // contrast around mid grey
    const k = 1 + g.con;
    r = (r - 0.5) * k + 0.5; gg = (gg - 0.5) * k + 0.5; b = (b - 0.5) * k + 0.5;
    // saturation
    let l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const sk = 1 + g.sat;
    r = l + (r - l) * sk; gg = l + (gg - l) * sk; b = l + (b - l) * sk;
    // split toning: shadows one colour, highlights another
    l = clamp(0.2126 * r + 0.7152 * gg + 0.0722 * b, 0, 1);
    const ws = (1 - l) * (1 - l) * g.split, wh = l * l * g.split;
    r += sh[0] * ws + hi[0] * wh; gg += sh[1] * ws + hi[1] * wh; b += sh[2] * ws + hi[2] * wh;
    // fade (lifted blacks)
    r = r * (1 - g.fade * 0.3) + g.fade * 0.15; gg = gg * (1 - g.fade * 0.3) + g.fade * 0.15; b = b * (1 - g.fade * 0.3) + g.fade * 0.15;
    // vignette
    const v = 1 - g.vig * Math.pow(Math.hypot(i - cx, j - cy) / R, 2.2);
    d[o] = clamp(r * v * 255, 0, 255); d[o + 1] = clamp(gg * v * 255, 0, 255); d[o + 2] = clamp(b * v * 255, 0, 255); d[o + 3] = 255;
  }
}
function gradeScene(x, W, H) {
  landscape(x, W, H, { haze: 0.55, trees: true });
  // a little house with a lit window and a character: skin tones are the first thing to check after grading
  x.fillStyle = '#6b4a3a'; x.fillRect(W * 0.16, H * 0.62, W * 0.14, H * 0.16);
  x.fillStyle = '#4a2f26'; x.beginPath(); x.moveTo(W * 0.14, H * 0.63); x.lineTo(W * 0.23, H * 0.5); x.lineTo(W * 0.32, H * 0.63); x.fill();
  x.fillStyle = '#ffd27a'; x.fillRect(W * 0.2, H * 0.66, W * 0.035, H * 0.05);
  const fx = W * 0.6, fy = H * 0.92;
  x.fillStyle = '#c0392b'; x.beginPath(); x.moveTo(fx, fy - H * 0.2); x.lineTo(fx + W * 0.04, fy); x.lineTo(fx - W * 0.04, fy); x.fill();
  x.fillStyle = '#f0c8a8'; x.beginPath(); x.arc(fx, fy - H * 0.22, H * 0.04, 0, 7); x.fill();
  x.fillStyle = '#2f2622'; x.beginPath(); x.arc(fx, fy - H * 0.24, H * 0.04, Math.PI, 0); x.fill();
}
function grading(host, { match = false } = {}) {
  const W = 480, H = 300;
  const S = stage(host, W, H);
  const src = h('canvas'); src.width = W; src.height = H; const sx = src.getContext('2d');
  gradeScene(sx, W, H);
  const base = sx.getImageData(0, 0, W, H);
  const out = new ImageData(W, H), tmp = h('canvas'); tmp.width = W; tmp.height = H; const tx = tmp.getContext('2d');
  const g = { ...GRADES.neutral }, st = { split: match ? 0 : 0.5 };
  let target = null, targetImg = null;
  const draw = () => {
    gradePixels(base, out, W, H, g);
    tx.putImageData(out, 0, 0);
    const x = S.x;
    if (match) {
      x.drawImage(tmp, 0, 0, W / 2, H, 0, 0, W / 2, H);
      x.drawImage(targetImg, W / 2, 0, W / 2, H, W / 2, 0, W / 2, H);
      x.fillStyle = '#fff'; x.fillRect(W / 2 - 1, 0, 2, H);
      x.font = '700 12px -apple-system, sans-serif'; x.fillText('YOU', 10, 18); x.textAlign = 'right'; x.fillText('TARGET', W - 10, 18); x.textAlign = 'left';
      // score: mean colour difference over the full frame
      const t = targetImg.getContext('2d').getImageData(0, 0, W, H).data, o = out.data;
      let e = 0; for (let i = 0; i < o.length; i += 16) e += Math.abs(o[i] - t[i]) + Math.abs(o[i + 1] - t[i + 1]) + Math.abs(o[i + 2] - t[i + 2]);
      const sc = clamp(100 - (e / (o.length / 16)) / 1.6, 0, 100);
      scoreEl.textContent = 'Match: ' + Math.round(sc) + '%' + (sc > 90 ? '  ✓ Great eye!' : sc > 80 ? '  — close' : '');
      return;
    }
    const cut = st.split * W;
    x.drawImage(src, 0, 0, W, H);
    x.drawImage(tmp, cut, 0, W - cut, H, cut, 0, W - cut, H);
    if (cut > 0) { x.fillStyle = '#fff'; x.fillRect(cut - 1, 0, 2, H); x.font = '700 11px -apple-system, sans-serif'; x.fillText('BEFORE', 8, 16); x.textAlign = 'right'; x.fillText('AFTER', W - 8, 16); x.textAlign = 'left'; }
  };
  if (!match) drags(S, () => [], (p) => { st.split = clamp(p.x / W, 0, 1); draw(); });
  const box = controls(host);
  const sl = {};
  let scoreEl = null;
  const setAll = (p) => { Object.assign(g, p); for (const k of Object.keys(sl)) sl[k].set(g[k]); draw(); };
  if (!match) chips(box, [['neutral', 'None'], ['golden', 'Golden hour'], ['night', 'Night'], ['horror', 'Horror'], ['flashback', 'Flashback'], ['teal', 'Teal & orange'], ['dream', 'Dreamy']], 'neutral', (v) => setAll(GRADES[v]));
  const defs = [['exp', 'Exposure', -1, 1], ['con', 'Contrast', -0.6, 0.8], ['sat', 'Saturation', -1, 0.8], ['temp', 'Temperature (cool ↔ warm)', -1, 1], ['tint', 'Tint (green ↔ magenta)', -1, 1]];
  if (!match) defs.push(['split', 'Split-tone strength', 0, 1], ['vig', 'Vignette', 0, 1], ['fade', 'Fade (lifted blacks)', 0, 0.8]);
  for (const [k, label, a, b] of defs) sl[k] = slider(box, label, a, b, 0.01, g[k], (v) => { g[k] = v; draw(); }, (v) => (v > 0 ? '+' : '') + v.toFixed(2));
  if (!match) {
    const pick = (label, key) => { const i = h('input', { type: 'color', value: g[key] }); i.oninput = () => { g[key] = i.value; draw(); }; sl[key] = { set: (v) => { i.value = v; } }; box.append(h('label', { class: 'lx-color' }, i, label)); };
    pick('Shadow tint', 'sh'); pick('Highlight tint', 'hi');
    note(box, 'Drag across the picture to compare before and after. Grade in this order: fix the exposure and white balance, set the contrast, then add the mood (split-tone, colour, vignette). Check that skin still looks like skin.');
  } else {
    scoreEl = h('div', { class: 'lx-score' }); box.append(scoreEl);
    const newTarget = () => {
      const keys = ['golden', 'night', 'horror', 'flashback', 'teal', 'dream'];
      const pre = GRADES[keys[Math.floor(Math.random() * keys.length)]];
      target = { ...GRADES.neutral, exp: pre.exp, con: pre.con, sat: pre.sat, temp: pre.temp, tint: pre.tint };
      gradePixels(base, out, W, H, target);
      targetImg = h('canvas'); targetImg.width = W; targetImg.height = H; targetImg.getContext('2d').putImageData(out, 0, 0);
      setAll({ ...GRADES.neutral });
    };
    button(box, 'New target', newTarget);
    button(box, 'Reveal answer', () => setAll(target), 'ghost');
    note(box, 'Train your eye: change the five basic sliders until your half matches the target. Look at one thing at a time: brightness first, then warm or cool, then how colourful it is.');
    newTarget();
  }
  draw();
  return () => {};
}

// ───────── animation ─────────
function bouncingBall(host) {
  const S = stage(host, 720, 360), st = { frames: 12, ease: true, squash: 0.35, onion: true, play: true, frame: 0, decay: 0.72, chart: true };
  let acc = 0;
  const pos = (f) => {
    // a ball dropped from the top, bouncing to the right; each bounce lower and shorter
    let t = f, n = st.frames, hgt = 1, i = 0;
    while (t >= n && i < 8) { t -= n; n = Math.max(3, Math.round(n * Math.sqrt(st.decay))); hgt *= st.decay; i++; }
    const u = t / n; // 0..1 within this bounce (from ground to ground)
    const y = st.ease ? 4 * u * (1 - u) : 1 - Math.abs(2 * u - 1);
    const vy = st.ease ? 4 * (1 - 2 * u) : (u < 0.5 ? 2 : -2);
    return { x: 40 + f * 9, y: hgt * y, vy: vy * hgt / n * 12, contact: t === 0, u, hgt };
  };
  const total = () => { let n = st.frames, s = 0; for (let i = 0; i < 6; i++) { s += n; n = Math.max(3, Math.round(n * Math.sqrt(st.decay))); } return s; };
  const draw = () => {
    const x = S.x, W = S.W, H = S.H, gy = H - 50, top = 50, r = 18;
    x.fillStyle = '#1b1c21'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#2a2b31'; x.fillRect(0, gy + r, W, H);
    const tot = total();
    const ballAt = (f, alpha) => {
      const p = pos(f), cy = gy - p.y * (gy - top);
      let sx = 1, sy = 1;
      if (st.squash > 0) {
        if (p.contact && f > 0) { sx = 1 + st.squash; sy = 1 - st.squash * 0.7; }
        else { const sp = Math.min(1, Math.abs(p.vy) / 3); sy = 1 + st.squash * sp * 0.8; sx = 1 / Math.sqrt(sy); }
      }
      x.globalAlpha = alpha;
      x.save(); x.translate(40 + f * (W - 80) / tot, cy + (p.contact && f > 0 ? r * (1 - sy) : 0)); x.scale(sx, sy);
      x.fillStyle = '#ff6b4a'; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.arc(-r * 0.35, -r * 0.35, r * 0.3, 0, 7); x.fill();
      x.restore(); x.globalAlpha = 1;
    };
    if (st.onion) for (let f = 0; f < tot; f++) ballAt(f, 0.13);
    ballAt(st.frame, 1);
    // spacing chart of the first bounce
    if (st.chart) {
      x.strokeStyle = '#9aa6d6'; x.lineWidth = 1; x.beginPath(); x.moveTo(W - 60, top); x.lineTo(W - 60, gy); x.stroke();
      for (let f = 0; f <= st.frames; f++) { const p = pos(f), y = gy - p.y * (gy - top); x.beginPath(); x.moveTo(W - 70, y); x.lineTo(W - 50, y); x.stroke(); }
      x.fillStyle = '#9aa6d6'; x.font = '600 11px -apple-system, sans-serif'; x.textAlign = 'center'; x.fillText('spacing', W - 60, top - 10);
    }
    x.fillStyle = '#fff'; x.textAlign = 'left'; x.font = '600 12px -apple-system, sans-serif';
    x.fillText(`Frame ${st.frame + 1} / ${tot}  ·  24 fps  ·  ${(st.frames / 24).toFixed(2)} s for the first bounce`, 14, 22);
  };
  const stop = loop((dt) => {
    if (!st.play) return;
    acc += dt;
    if (acc >= 1 / 24) { acc = 0; st.frame = (st.frame + 1) % total(); draw(); }
  });
  const box = controls(host);
  const pb = button(box, '❚❚ Pause', () => { st.play = !st.play; pb.textContent = st.play ? '❚❚ Pause' : '▶ Play'; });
  button(box, '◀ Frame', () => { st.play = false; pb.textContent = '▶ Play'; st.frame = (st.frame - 1 + total()) % total(); draw(); });
  button(box, 'Frame ▶', () => { st.play = false; pb.textContent = '▶ Play'; st.frame = (st.frame + 1) % total(); draw(); });
  slider(box, 'Timing: frames for the first bounce', 4, 30, 1, st.frames, (v) => { st.frames = v; st.frame = 0; draw(); }, (v) => v + ' f');
  slider(box, 'Squash & stretch', 0, 0.6, 0.01, st.squash, (v) => { st.squash = v; draw(); }, (v) => Math.round(v * 100) + '%');
  slider(box, 'Bounciness (rubber ↔ bowling ball)', 0.3, 0.9, 0.01, st.decay, (v) => { st.decay = v; st.frame = 0; draw(); }, (v) => Math.round(v * 100) + '%');
  toggle(box, 'Ease (gravity)', true, (v) => { st.ease = v; draw(); });
  toggle(box, 'Onion skin', true, (v) => { st.onion = v; draw(); });
  toggle(box, 'Spacing chart', true, (v) => { st.chart = v; draw(); });
  note(box, 'Watch the spacing: drawings bunch up at the top (slow, the ball hangs) and spread out near the ground (fast). Turn off Ease and the ball moves like a robot. Fewer frames = a lighter, faster ball.');
  draw();
  return stop;
}
function spacingChart(host) {
  const S = stage(host, 720, 260), st = { n: 9, mode: 'inout', play: true, t: 0, custom: null };
  const curves = { even: (u) => u, in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u), inout: (u) => u * u * (3 - 2 * u) };
  const keys = () => (st.mode === 'custom' && st.custom) ? st.custom : Array.from({ length: st.n }, (_, i) => curves[st.mode](i / (st.n - 1)));
  const draw = () => {
    const x = S.x, W = S.W, H = S.H, x0 = 60, x1 = W - 60, y = 170;
    x.fillStyle = '#1b1c21'; x.fillRect(0, 0, W, H);
    const k = keys();
    // chart
    x.strokeStyle = '#9aa6d6'; x.lineWidth = 2; x.beginPath(); x.moveTo(x0, 60); x.lineTo(x1, 60); x.stroke();
    k.forEach((v, i) => { const px = x0 + v * (x1 - x0); x.beginPath(); x.moveTo(px, i === 0 || i === k.length - 1 ? 44 : 50); x.lineTo(px, 70); x.stroke(); x.fillStyle = '#9aa6d6'; x.font = '10px sans-serif'; x.textAlign = 'center'; x.fillText(String(i + 1), px, 86); });
    x.fillStyle = '#cfd6ff'; x.font = '600 11px -apple-system, sans-serif'; x.fillText('KEY', x0, 36); x.fillText('KEY', x1, 36);
    // ghosts + ball
    k.forEach((v) => { x.globalAlpha = 0.15; x.fillStyle = '#7bd389'; x.beginPath(); x.arc(x0 + v * (x1 - x0), y, 18, 0, 7); x.fill(); });
    x.globalAlpha = 1;
    const fi = Math.floor(st.t) % k.length;
    x.fillStyle = '#7bd389'; x.beginPath(); x.arc(x0 + k[fi] * (x1 - x0), y, 18, 0, 7); x.fill();
  };
  let acc = 0;
  const stop = loop((dt) => { if (!st.play) return; acc += dt; if (acc > 1 / 12) { acc = 0; st.t = (st.t + 1) % (keys().length + 6); if (st.t >= keys().length) { /* hold on the last key */ } draw(); } });
  drags(S, () => keys().map((v, i) => ({ x: 60 + v * (S.W - 120), y: 60, r: 14, onDrag: (p) => { if (i === 0 || i === keys().length - 1) return; const arr = keys().slice(); arr[i] = clamp((p.x - 60) / (S.W - 120), arr[i - 1] + 0.005, arr[i + 1] - 0.005); st.custom = arr; st.mode = 'custom'; md.set('custom'); draw(); } })));
  const box = controls(host);
  const md = chips(box, [['even', 'Even (linear)'], ['in', 'Slow in → fast (ease in)'], ['out', 'Fast → slow out (ease out)'], ['inout', 'Ease in & out'], ['custom', 'Custom (drag the ticks)']], st.mode, (v) => { st.mode = v; if (v === 'custom' && !st.custom) st.custom = Array.from({ length: st.n }, (_, i) => curves.inout(i / (st.n - 1))); draw(); });
  slider(box, 'Number of drawings (timing)', 3, 16, 1, st.n, (v) => { st.n = v; st.custom = null; if (st.mode === 'custom') { st.mode = 'inout'; md.set('inout'); } draw(); }, (v) => v + ' drawings');
  note(box, 'Timing is HOW MANY drawings (how long it takes). Spacing is WHERE you put them (how it speeds up or slows down). Same timing, different spacing = a completely different feeling. Playing at 12 drawings a second ("on twos").');
  draw();
  return stop;
}
function arcs(host) {
  const S = stage(host, 720, 340), st = { arc: true, t: 0, play: true, trail: true };
  const draw = () => {
    const x = S.x, W = S.W, H = S.H, sx = W / 2, sy = 70, L = 210;
    x.fillStyle = '#1b1c21'; x.fillRect(0, 0, W, H);
    const a0 = -1.1, a1 = 1.1;
    const u = 0.5 - 0.5 * Math.cos(st.t * Math.PI); // ease in/out between keys
    const posAt = (u2) => {
      if (st.arc) { const a = lerp(a0, a1, u2); return [sx + Math.sin(a) * L, sy + Math.cos(a) * L]; }
      const p0 = [sx + Math.sin(a0) * L, sy + Math.cos(a0) * L], p1 = [sx + Math.sin(a1) * L, sy + Math.cos(a1) * L];
      return [lerp(p0[0], p1[0], u2), lerp(p0[1], p1[1], u2)];
    };
    if (st.trail) for (let i = 0; i <= 10; i++) { const p = posAt(0.5 - 0.5 * Math.cos(i / 10 * Math.PI)); x.fillStyle = 'rgba(123,211,137,0.25)'; x.beginPath(); x.arc(p[0], p[1], 14, 0, 7); x.fill(); }
    const p = posAt(u);
    const len = Math.hypot(p[0] - sx, p[1] - sy);
    x.strokeStyle = st.arc ? '#cfd6ff' : (len < L - 3 ? '#ff6b6b' : '#cfd6ff'); x.lineWidth = 6; x.lineCap = 'round';
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(p[0], p[1]); x.stroke();
    x.fillStyle = '#7bd389'; x.beginPath(); x.arc(p[0], p[1], 16, 0, 7); x.fill();
    x.fillStyle = '#cfd6ff'; x.beginPath(); x.arc(sx, sy, 8, 0, 7); x.fill();
    x.font = '600 12px -apple-system, sans-serif'; x.fillStyle = '#fff'; x.fillText(st.arc ? 'Inbetweens on an ARC: the arm keeps its length' : 'Straight-line inbetweens: the arm SHRINKS in the middle (red)', 14, 22);
  };
  let dir = 1;
  const stop = loop((dt) => { if (!st.play) return; st.t += dir * dt * 0.8; if (st.t > 1) { st.t = 1; dir = -1; } if (st.t < 0) { st.t = 0; dir = 1; } draw(); });
  const box = controls(host);
  toggle(box, 'Inbetween on an arc', true, (v) => { st.arc = v; draw(); });
  toggle(box, 'Show the path', true, (v) => { st.trail = v; draw(); });
  note(box, 'Almost every natural movement travels on an arc, because limbs rotate around joints. Draw the arc first, then place your inbetweens on it.');
  return stop;
}
// a simple character for anticipation / overlap / walk demos
// the classic animation "flour sack": a half-full sack whose two top corners show weight and drag
function bean(x, cx, gy, sq = 0, lean = 0) {
  const hgt = 96 * (1 - sq), w = 70 * (1 + sq * 0.9), drag = clamp(-lean * 60, -18, 18);
  x.save(); x.translate(cx, gy); x.rotate(lean);
  // ground contact shadow
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.ellipse(0, 2, w * 0.62, 6, 0, 0, 7); x.fill();
  const body = new Path2D();
  body.moveTo(-w * 0.5, -6);
  body.bezierCurveTo(-w * 0.62, -hgt * 0.45, -w * 0.48, -hgt * 0.82, -w * 0.3, -hgt * 0.9);
  body.quadraticCurveTo(-w * 0.42 + drag, -hgt * 1.12, -w * 0.18 + drag * 0.6, -hgt * 1.08); // left corner
  body.quadraticCurveTo(0, -hgt * 0.94, w * 0.18 + drag * 0.6, -hgt * 1.08);
  body.quadraticCurveTo(w * 0.42 + drag, -hgt * 1.12, w * 0.3, -hgt * 0.9); // right corner
  body.bezierCurveTo(w * 0.48, -hgt * 0.82, w * 0.62, -hgt * 0.45, w * 0.5, -6);
  body.quadraticCurveTo(0, 6, -w * 0.5, -6); body.closePath();
  const gr = x.createLinearGradient(-w / 2, 0, w / 2, 0); gr.addColorStop(0, '#f1e3c4'); gr.addColorStop(0.6, '#dcc79c'); gr.addColorStop(1, '#b89a68');
  x.fillStyle = gr; x.fill(body);
  x.save(); x.clip(body);
  x.fillStyle = 'rgba(120,90,50,0.35)'; x.beginPath(); x.ellipse(w * 0.32, -hgt * 0.35, w * 0.3, hgt * 0.55, 0, 0, 7); x.fill(); // form shadow
  x.strokeStyle = 'rgba(120,90,50,0.45)'; x.lineWidth = 1.5;
  for (const f of [-0.2, 0.05, 0.25]) { x.beginPath(); x.moveTo(w * f, -hgt * 0.85); x.quadraticCurveTo(w * (f + 0.08), -hgt * 0.5, w * f, -hgt * 0.12); x.stroke(); } // cloth folds
  x.fillStyle = '#9c3b2f'; x.fillRect(-w, -hgt * 0.8, w * 2, hgt * 0.07); // tie band
  x.restore();
  x.strokeStyle = '#3b2a1a'; x.lineWidth = 2.5; x.stroke(body);
  x.fillStyle = '#3b2a1a'; x.font = `700 ${Math.round(hgt * 0.16)}px Georgia, serif`; x.textAlign = 'center'; x.fillText('FLOUR', 0, -hgt * 0.4);
  x.restore();
  return hgt;
}
function anticipation(host) {
  const S = stage(host, 720, 320), st = { antic: true, follow: true, play: true, t: 0 };
  // timeline (seconds): wait, anticipation crouch, jump, land, settle
  const draw = () => {
    const x = S.x, W = S.W, H = S.H, gy = H - 40;
    x.fillStyle = '#1b1c21'; x.fillRect(0, 0, W, H); x.fillStyle = '#2a2b31'; x.fillRect(0, gy, W, H);
    const T = st.t; let sq = 0, lift = 0, lean = 0, phase = 'hold';
    const A = st.antic ? 0.35 : 0.04, J = 0.55;
    if (T < 0.3) phase = 'hold';
    else if (T < 0.3 + A) { const u = (T - 0.3) / A; sq = st.antic ? 0.3 * Math.sin(u * Math.PI / 2) : 0; lean = st.antic ? -0.12 * u : 0; phase = 'anticipation'; }
    else if (T < 0.3 + A + J) { const u = (T - 0.3 - A) / J; lift = 4 * u * (1 - u) * 160; sq = -0.25 * Math.max(0, 1 - u * 3) + (u > 0.85 ? -0.1 : 0); lean = 0.05; phase = 'action'; }
    else if (T < 0.3 + A + J + 0.5) { const u = (T - 0.3 - A - J) / 0.5; if (st.follow) { sq = 0.35 * Math.exp(-u * 5) * Math.cos(u * 14); lean = 0.15 * Math.exp(-u * 4) * Math.cos(u * 10); } phase = st.follow ? 'follow-through / settle' : 'stop'; }
    else phase = 'hold';
    const xx = W * 0.35 + clamp((T - 0.3 - A) / J, 0, 1) * W * 0.3;
    bean(x, xx, gy - lift, sq, lean);
    x.fillStyle = '#fff'; x.font = '600 13px -apple-system, sans-serif'; x.fillText(phase.toUpperCase(), 14, 24);
  };
  const stop = loop((dt) => { if (!st.play) return; st.t += dt; if (st.t > 2.4) st.t = 0; draw(); });
  const box = controls(host);
  toggle(box, 'Anticipation (crouch first)', true, (v) => { st.antic = v; });
  toggle(box, 'Follow-through (squash and settle on landing)', true, (v) => { st.follow = v; });
  note(box, 'Turn both off: the jump looks weightless and comes out of nowhere. Anticipation prepares the audience ("something is about to happen"); follow-through shows weight when the action stops.');
  return stop;
}
function overlap(host) {
  const S = stage(host, 720, 320), st = { lag: 0.6, on: true, t: 0 };
  const N = 9, chain = Array.from({ length: N }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
  let init = false;
  const draw = () => {
    const x = S.x, W = S.W, H = S.H;
    x.fillStyle = '#1b1c21'; x.fillRect(0, 0, W, H);
    const hx = W / 2 + Math.sin(st.t * 1.6) * 220 * (Math.abs(Math.sin(st.t * 1.6)) > 0.95 ? 1 : 1), hy = 120 + Math.sin(st.t * 3.2) * 10;
    if (!init) { chain.forEach((c, i) => { c.x = hx; c.y = hy + i * 16; }); init = true; }
    chain[0].x = hx; chain[0].y = hy;
    for (let i = 1; i < N; i++) {
      const p = chain[i - 1], c = chain[i];
      if (!st.on) { c.x = p.x; c.y = p.y + 16; continue; }
      // each piece follows the one before it with a delay: drag + gravity + fixed length
      const k = 1 - st.lag * 0.9;
      c.vx = c.vx * 0.86 + (p.x - c.x) * k * 0.3; c.vy = c.vy * 0.86 + (p.y + 16 - c.y) * k * 0.3 + 0.4;
      c.x += c.vx; c.y += c.vy;
      const dx = c.x - p.x, dy = c.y - p.y, L = Math.hypot(dx, dy) || 1;
      c.x = p.x + dx / L * 16; c.y = p.y + dy / L * 16;
    }
    x.strokeStyle = '#ffb020'; x.lineCap = 'round';
    for (let i = 1; i < N; i++) { x.lineWidth = 14 - i; x.beginPath(); x.moveTo(chain[i - 1].x, chain[i - 1].y); x.lineTo(chain[i].x, chain[i].y); x.stroke(); }
    x.fillStyle = '#7aa2ff'; x.beginPath(); x.arc(hx, hy - 4, 34, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = '600 12px -apple-system, sans-serif'; x.fillText('The head leads; the ponytail follows, overlaps and drags behind.', 14, 24);
  };
  const stop = loop((dt) => { st.t += dt; draw(); });
  const box = controls(host);
  toggle(box, 'Overlapping action', true, (v) => { st.on = v; });
  slider(box, 'Drag (how loose the hair / cloth is)', 0, 1, 0.01, st.lag, (v) => { st.lag = v; }, (v) => Math.round(v * 100) + '%');
  note(box, 'Loose parts (hair, ears, tails, cloth, flab) start moving AFTER the main body and keep going after it stops. Without it (toggle off) things look stiff and rigid.');
  return stop;
}
// walk cycle (Richard Williams' contact / down / passing / up)
const WALK_KEYS = [
  // [thighF, kneeF, thighB, kneeB, hip, label]   F = leg that steps forward on this half
  [26, 2, -22, 18, 0, 'CONTACT'],
  [16, 22, -14, 48, -7, 'DOWN'],
  [-2, 6, 12, 70, 0, 'PASSING'],
  [-16, 2, 26, 36, 5, 'UP'],
];
export function walkPose(ph) {
  // ph 0..1 over a full cycle (two steps)
  const half = ph < 0.5 ? 0 : 1, u = (ph % 0.5) / 0.5 * 4;
  const i = Math.floor(u) % 4, f = u - Math.floor(u);
  const a = WALK_KEYS[i], b = i === 3 ? [WALK_KEYS[0][2], WALK_KEYS[0][3], WALK_KEYS[0][0], WALK_KEYS[0][1], WALK_KEYS[0][4]] : WALK_KEYS[i + 1];
  const s = f * f * (3 - 2 * f);
  const v = [0, 1, 2, 3, 4].map((k) => lerp(a[k], b[k], s));
  const [tf, kf, tb, kb, hip] = v;
  return { L: half ? [tb, kb] : [tf, kf], R: half ? [tf, kf] : [tb, kb], hip, label: f < 0.25 ? a[5] : f > 0.75 ? (i === 3 ? 'CONTACT' : WALK_KEYS[i + 1][5]) : '' };
}
function walkCycle(host) {
  const S = stage(host, 720, 380), st = { play: true, frame: 0, n: 24, ground: 0, twos: true, ghosts: false };
  const draw = () => {
    const x = S.x, W = S.W, H = S.H, gy = H - 50, cx = W / 2;
    x.fillStyle = '#1b1c21'; x.fillRect(0, 0, W, H); x.fillStyle = '#2a2b31'; x.fillRect(0, gy, W, H);
    // moving ground marks (the character walks on the spot, the world slides)
    x.strokeStyle = '#3a3b44'; x.lineWidth = 2;
    for (let i = -2; i < 14; i++) { const gx = ((i * 70 - st.ground) % 980 + 980) % 980 - 70; x.beginPath(); x.moveTo(gx, gy + 10); x.lineTo(gx + 30, gy + 10); x.stroke(); }
    const fig = (frame, alpha) => {
      const p = walkPose(frame / st.n), th = 72, sh = 68;
      const hipY = gy - th - sh + 4 - p.hip;
      const limb = (x0, y0, x1, y1, w0, w1, col) => {
        const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
        x.fillStyle = col; x.beginPath();
        x.moveTo(x0 + nx * w0, y0 + ny * w0); x.lineTo(x1 + nx * w1, y1 + ny * w1); x.arc(x1, y1, w1, a + Math.PI / 2, a - Math.PI / 2, true);
        x.lineTo(x0 - nx * w0, y0 - ny * w0); x.arc(x0, y0, w0, a - Math.PI / 2, a + Math.PI / 2, true); x.fill();
        x.strokeStyle = 'rgba(10,12,30,0.55)'; x.lineWidth = 1.5; x.stroke();
      };
      const joint = (jx, jy, r, col) => { x.fillStyle = col; x.beginPath(); x.arc(jx, jy, r, 0, 7); x.fill(); x.strokeStyle = 'rgba(10,12,30,0.55)'; x.lineWidth = 1.2; x.stroke(); };
      const leg = (ang, knee, col, jc) => {
        const a = ang * Math.PI / 180, kx = cx + Math.sin(a) * th, ky = hipY + Math.cos(a) * th;
        const b = (ang - knee) * Math.PI / 180, fx = kx + Math.sin(b) * sh, fy = ky + Math.cos(b) * sh;
        limb(cx, hipY, kx, ky, 11, 8, col); limb(kx, ky, fx, fy, 8, 5.5, col);
        // foot: heel at the ankle, toe forward
        x.fillStyle = col; x.beginPath(); x.moveTo(fx - 6, fy - 4); x.quadraticCurveTo(fx + 26, fy - 7, fx + 24, fy + 4); x.lineTo(fx - 7, fy + 5); x.closePath(); x.fill(); x.strokeStyle = 'rgba(10,12,30,0.55)'; x.stroke();
        joint(kx, ky, 6.5, jc); joint(fx, fy, 4.5, jc);
      };
      const arm = (ang, col, jc) => {
        const a = ang * Math.PI / 180, sx2 = cx + 4, sy2 = hipY - 70;
        const ex = sx2 + Math.sin(a) * 46, ey = sy2 + Math.cos(a) * 46, hx = ex + Math.sin(a + 0.45) * 40, hy = ey + Math.cos(a + 0.45) * 40;
        limb(sx2, sy2, ex, ey, 7, 5.5, col); limb(ex, ey, hx, hy, 5.5, 4, col); joint(ex, ey, 4.8, jc); joint(hx, hy, 6, col);
      };
      x.globalAlpha = alpha;
      const far = '#56608f', farJ = '#3d4570', near = '#c9d1f5', nearJ = '#9aa6d6';
      arm(-p.R[0] * 0.9, far, farJ); leg(p.R[0], p.R[1], far, farJ);
      // pelvis, chest (tilting slightly with the step) and head
      const tilt = p.hip * 0.004;
      x.save(); x.translate(cx, hipY); x.rotate(tilt);
      x.fillStyle = '#aab4e6'; x.beginPath(); x.ellipse(2, -6, 18, 14, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(10,12,30,0.55)'; x.stroke();
      x.fillStyle = '#b8c1ee'; x.beginPath(); x.moveTo(-10, -18); x.lineTo(12, -18); x.quadraticCurveTo(26, -60, 18, -82); x.lineTo(-12, -82); x.quadraticCurveTo(-22, -56, -10, -18); x.fill(); x.stroke();
      x.fillStyle = '#aab4e6'; x.fillRect(-1, -96, 12, 16); x.strokeRect(-1, -96, 12, 16);
      const hg = x.createRadialGradient(0, -122, 4, 6, -116, 26); hg.addColorStop(0, '#eef1ff'); hg.addColorStop(1, '#9aa6d6');
      x.fillStyle = hg; x.beginPath(); x.ellipse(8, -116, 19, 23, 0.15, 0, 7); x.fill(); x.stroke();
      x.strokeStyle = 'rgba(40,50,90,0.5)'; x.beginPath(); x.moveTo(22, -132); x.quadraticCurveTo(28, -116, 20, -98); x.stroke(); // face line
      x.restore();
      leg(p.L[0], p.L[1], near, nearJ); arm(-p.L[0] * 0.9, near, nearJ);
      x.globalAlpha = 1;
      return p;
    };
    if (st.ghosts) for (const k of [0, 3, 6, 9]) fig(k * st.n / 24, 0.18);
    const p = fig(st.frame, 1);
    x.fillStyle = '#fff'; x.font = '700 14px -apple-system, sans-serif'; x.fillText(p.label || ' ', 14, 26);
    x.font = '12px -apple-system, sans-serif'; x.fillStyle = '#9aa6d6';
    x.fillText(`Frame ${Math.floor(st.frame) + 1} / ${st.n}  ·  one step = ${st.n / 2} frames = ${(st.n / 48).toFixed(2)} s at 24 fps`, 14, 46);
    // the hip-height curve: down after contact, up after passing
    x.strokeStyle = '#ffb020'; x.lineWidth = 2; x.beginPath();
    for (let i = 0; i <= 100; i++) { const q = walkPose(i / 100); const px = W - 220 + i * 2, py = 80 - q.hip * 2.4; i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke(); x.fillStyle = '#ffb020'; x.fillText('hip height over the cycle', W - 220, 40);
    const mk = W - 220 + (st.frame / st.n) * 200; x.beginPath(); x.arc(mk, 80 - p.hip * 2.4, 4, 0, 7); x.fill();
  };
  let acc = 0;
  const stop = loop((dt) => {
    if (!st.play) return;
    acc += dt; const step = st.twos ? 2 / 24 : 1 / 24;
    if (acc >= step) { acc = 0; st.frame = (st.frame + (st.twos ? 2 : 1)) % st.n; st.ground += (st.twos ? 2 : 1) * (280 / st.n); draw(); }
  });
  const box = controls(host);
  const pb = button(box, '❚❚ Pause', () => { st.play = !st.play; pb.textContent = st.play ? '❚❚ Pause' : '▶ Play'; });
  button(box, '◀ Frame', () => { st.play = false; pb.textContent = '▶ Play'; st.frame = (st.frame - 1 + st.n) % st.n; draw(); });
  button(box, 'Frame ▶', () => { st.play = false; pb.textContent = '▶ Play'; st.frame = (st.frame + 1) % st.n; draw(); });
  chips(box, [['16', 'Fast (16 f)'], ['24', 'Normal (24 f)'], ['32', 'Slow (32 f)']], '24', (v) => { st.n = +v; st.frame = 0; draw(); });
  toggle(box, 'On twos', true, (v) => { st.twos = v; });
  toggle(box, 'Show the key poses', false, (v) => { st.ghosts = v; draw(); });
  note(box, 'Step through frame by frame. CONTACT (heel hits, legs widest) → DOWN (weight lands, body lowest, knee bends) → PASSING (free leg passes, body rising) → UP (pushing off, body highest) → next CONTACT. Arms swing opposite to the legs.');
  draw();
  return stop;
}
function onesTwos(host) {
  const S = stage(host, 720, 300), st = { t: 0 };
  const draw = () => {
    const x = S.x, W = S.W, H = S.H;
    x.fillStyle = '#1b1c21'; x.fillRect(0, 0, W, H);
    const rows = [['On ones (24 drawings / s)', 1], ['On twos (12 drawings / s)', 2], ['On threes (8 drawings / s)', 3]];
    rows.forEach(([label, k], r) => {
      const y = 60 + r * 90, f = Math.floor(st.t * 24 / k) * k;
      const u = (f % 48) / 48, px = 60 + (0.5 - 0.5 * Math.cos(u * Math.PI * 2)) * (W - 200);
      x.fillStyle = '#fff'; x.font = '600 12px -apple-system, sans-serif'; x.fillText(label, 20, y - 26);
      x.fillStyle = ['#ff6b4a', '#7bd389', '#7aa2ff'][r]; x.beginPath(); x.arc(px, y, 18, 0, 7); x.fill();
    });
  };
  const stop = loop((dt) => { st.t += dt; draw(); });
  const box = controls(host);
  note(box, 'Same movement, same speed. On ones is the smoothest (good for fast action and camera moves). On twos is the classic hand-drawn look and half the work. Most TV animation and anime is mostly on twos and threes, switching to ones for fast moves.');
  return stop;
}

// ───────── webtoon ─────────
function webtoonScroll(host) {
  const st = { gutter: 160 };
  const wrap = h('div', { class: 'lx-phone-wrap' }); host.append(wrap);
  const phone = h('div', { class: 'lx-phone' }); wrap.append(phone);
  const side = h('div', { class: 'lx-phone-side' }); wrap.append(side);
  const strip = h('canvas'); phone.append(strip);
  const draw = () => {
    const W = 320, pan = [[0, 220, 'wide', 'Establishing shot: where are we?'], [1, 180, 'mid', 'Character: "...hello?"'], [2, 120, 'close', 'Close-up: something is wrong'], [3, 260, 'big', 'Reveal!']];
    const gutters = [st.gutter * 0.4, st.gutter, st.gutter * 2.2];
    let H = 40; pan.forEach(([, hh], i) => { H += hh + (gutters[i] || 60); });
    strip.width = W; strip.height = H; const x = strip.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    let y = 30;
    pan.forEach(([i, hh, kind, cap], k) => {
      const px = kind === 'close' ? 40 : 14, pw = kind === 'close' ? W - 80 : W - 28;
      const g = x.createLinearGradient(0, y, 0, y + hh);
      g.addColorStop(0, ['#9cc3ff', '#ffe0b0', '#ffd0d0', '#2b2440'][i]); g.addColorStop(1, ['#4a6aa8', '#d89a6a', '#c05a5a', '#6a3a8a'][i]);
      x.fillStyle = g; x.fillRect(px, y, pw, hh);
      x.strokeStyle = '#111'; x.lineWidth = 3; x.strokeRect(px, y, pw, hh);
      x.fillStyle = '#111'; x.font = '600 12px -apple-system, sans-serif'; x.fillText(cap, px + 10, y + 20);
      y += hh;
      if (k < gutters.length) {
        const gtr = gutters[k];
        x.fillStyle = '#c8c8d0'; x.font = '11px -apple-system, sans-serif'; x.textAlign = 'center';
        x.fillText('↓ gutter ' + Math.round(gtr) + ' px', W / 2, y + gtr / 2 + 4); x.textAlign = 'left';
        y += gtr;
      }
    });
  };
  const box = controls(side);
  slider(box, 'Gutter size (space between panels)', 40, 400, 10, st.gutter, (v) => { st.gutter = v; draw(); }, (v) => v + ' px');
  note(box, 'Scroll inside the phone. In a webtoon the gutter is TIME: a small gap reads as an instant cut, a long gap makes the reader scroll through empty space, a pause, before the reveal. Use the biggest gaps right before the moments that should hit hardest.');
  draw();
  return () => {};
}
function dialogueOrder(host) {
  const S = stage(host, 600, 420);
  const lines = [['A', '"Did you hear that?"'], ['B', '"Hear what?"'], ['A', '"Something\'s in the walls."'], ['B', '"...Great."']];
  const spk = { A: { x: 170, y: 290 }, B: { x: 430, y: 290 } };
  const st = { b: [{ x: 400, y: 60 }, { x: 120, y: 160 }, { x: 420, y: 170 }, { x: 140, y: 60 }] };
  const draw = (result) => {
    const x = S.x, W = S.W, H = S.H;
    x.fillStyle = '#f4efe6'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#111'; x.lineWidth = 4; x.strokeRect(4, 4, W - 8, H - 8);
    for (const [k, p] of Object.entries(spk)) {
      x.fillStyle = k === 'A' ? '#5b7bd5' : '#d5735b'; x.beginPath(); x.arc(p.x, p.y, 34, 0, 7); x.fill();
      x.fillRect(p.x - 40, p.y + 30, 80, 100);
      x.fillStyle = '#fff'; x.font = '700 18px -apple-system, sans-serif'; x.textAlign = 'center'; x.fillText(k, p.x, p.y + 7);
    }
    st.b.forEach((b, i) => {
      const [who, text] = lines[i], s = spk[who];
      x.strokeStyle = '#111'; x.lineWidth = 2; x.fillStyle = '#fff';
      // tail
      x.beginPath(); x.moveTo(b.x - 8, b.y + 22); x.lineTo(s.x + (b.x < s.x ? -10 : 10) * 0, s.y - 40); x.lineTo(b.x + 8, b.y + 22); x.closePath(); x.fill(); x.stroke();
      x.beginPath(); x.ellipse(b.x, b.y, 92, 28, 0, 0, 7); x.fill(); x.stroke();
      x.fillStyle = '#111'; x.font = '13px -apple-system, sans-serif'; x.textAlign = 'center'; x.fillText(text, b.x, b.y + 5);
      x.fillStyle = '#888'; x.font = '10px sans-serif'; x.fillText('line ' + (i + 1), b.x, b.y - 14);
    });
    if (result) { x.fillStyle = result.ok ? 'rgba(47,191,113,0.15)' : 'rgba(255,90,95,0.12)'; x.fillRect(0, 0, W, H); }
  };
  drags(S, () => st.b.map((b) => ({ x: b.x, y: b.y, r: 60, onDrag: (p) => { b.x = clamp(p.x, 90, 510); b.y = clamp(p.y, 30, 240); draw(); } })));
  const box = controls(host);
  const msg = note(box, 'Drag the four balloons so the conversation reads in the right order. Readers go top → bottom, then left → right. Tails should not cross.');
  const cross = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); };
  button(box, 'Check my layout', () => {
    const ord = st.b.map((b, i) => ({ i, b })).sort((p, q) => (Math.abs(p.b.y - q.b.y) < 30 ? p.b.x - q.b.x : p.b.y - q.b.y)).map((o) => o.i);
    const inOrder = ord.every((v, k) => v === k);
    const tails = st.b.map((b, i) => [{ x: b.x, y: b.y + 22 }, { x: spk[lines[i][0]].x, y: spk[lines[i][0]].y - 40 }]);
    let crossing = false; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (cross(tails[i][0], tails[i][1], tails[j][0], tails[j][1])) crossing = true;
    const sideOk = st.b.every((b, i) => (lines[i][0] === 'A' ? b.x < 330 : b.x > 270));
    const ok = inOrder && !crossing && sideOk;
    msg.textContent = ok ? '✓ Reads perfectly: in order, each balloon on its speaker\'s side, no crossed tails. A speaks first, so A goes on the LEFT.' : !inOrder ? '✗ Order: line ' + (ord.indexOf(ord.find((v, k) => v !== k)) + 1) + ' would be read out of order. Put each line lower than (or right of) the one before it.' : crossing ? '✗ Two tails cross: move the balloons so each sits above its own speaker.' : '✗ Keep each balloon on its speaker\'s side of the panel.';
    draw({ ok });
  });
  button(box, 'Shuffle', () => { st.b = st.b.map(() => ({ x: 120 + Math.random() * 360, y: 50 + Math.random() * 180 })); draw(); }, 'ghost');
  draw();
  return () => {};
}
function slicing(host) {
  const S = stage(host, 720, 360), st = { smart: false };
  const panels = [[30, 380], [480, 900], [1000, 1700], [1820, 2300], [2440, 3300], [3420, 3800]];
  const total = 3900, slice = 1280, scale = S.W / total;
  const draw = () => {
    const x = S.x, W = S.W, H = S.H;
    x.fillStyle = '#16171b'; x.fillRect(0, 0, W, H);
    // the strip drawn sideways (left = top of the episode)
    x.fillStyle = '#fff'; x.fillRect(0, 120, W, 120);
    for (const [a, b] of panels) { x.fillStyle = '#8aa4e8'; x.fillRect(a * scale, 132, (b - a) * scale, 96); x.strokeStyle = '#111'; x.lineWidth = 2; x.strokeRect(a * scale, 132, (b - a) * scale, 96); }
    let y = 0, cuts = [];
    while (y + slice < total) {
      let c = y + slice;
      if (st.smart) { const hit = panels.find(([a, b]) => c > a && c < b); if (hit) c = hit[0] - 20 > y + 200 ? hit[0] - 20 : c; }
      cuts.push(c); y = c;
    }
    for (const c of cuts) {
      const bad = panels.some(([a, b]) => c > a && c < b);
      x.strokeStyle = bad ? '#ff5a5f' : '#2fbf71'; x.lineWidth = 3; x.setLineDash([6, 4]); x.beginPath(); x.moveTo(c * scale, 100); x.lineTo(c * scale, 260); x.stroke(); x.setLineDash([]);
      x.fillStyle = x.strokeStyle; x.font = '600 11px -apple-system, sans-serif'; x.textAlign = 'center'; x.fillText(bad ? 'cuts a panel' : 'clean cut', clamp(c * scale, 40, W - 40), 92);
    }
    x.fillStyle = '#cfd6ff'; x.textAlign = 'left'; x.font = '12px -apple-system, sans-serif';
    x.fillText('One episode (shown sideways): 800 px wide × 3 900 px tall. Upload limit per image: 800 × 1280 px.', 14, 24);
    x.fillText(st.smart ? 'Smart slicing moves each cut into the gutter above the panel it would hit.' : 'Plain slicing every 1 280 px can cut straight through panels; on slow connections readers see half a panel.', 14, 300);
  };
  const box = controls(host);
  toggle(box, 'Smart slicing (cut in gutters)', false, (v) => { st.smart = v; draw(); });
  note(box, 'Inkwell Studio does this for you: Actions › Webtoon › Export episode slices. It is also why you leave real gutters between panels.');
  draw();
  return () => {};
}
function coloringPipeline(host) {
  const st = { step: 6 };
  const steps = ['Sketch (construction)', 'Line art', 'Flats', 'Shadows (Multiply, clipped)', 'Light (Add / Overlay, clipped)', 'Background', 'Colour grade'];
  const wrap = h('div', { class: 'lx-face' }); host.append(wrap);
  const view = h('div', { class: 'lx-face-view lx-pipe-view' }); wrap.append(view);
  const side = h('div', { class: 'lx-face-side' }); wrap.append(side);
  const box = controls(side);
  const title = h('b', { class: 'lx-step-title' });
  const draw = () => { view.innerHTML = faceSVG({ ...EXPR.joy, open: 0.15, cheeks: 0.5 }, { size: 300, stage: st.step }); title.textContent = `Step ${st.step + 1} of 7 — ${steps[st.step]}`; };
  box.append(title);
  slider(box, 'Step', 0, 6, 1, st.step, (v) => { st.step = v; draw(); }, (v) => String(v + 1));
  const chipsEl = chips(box, steps.map((s, i) => [String(i), s.split(' (')[0]]), '6', (v) => { st.step = +v; draw(); });
  note(box, 'Each step is its own layer in the Studio: Line art on top (mark it as a Reference layer so Fill reads it), Flats underneath, then a Shadow layer set to Multiply and a Light layer set to Add (Glow) or Overlay, both clipped to the flats. The background and the final grade come last, so the whole mood can change without repainting.');
  draw();
  return () => {};
}

export const DEMOS = {
  'persp-horizon': (el) => perspectiveLab(el, { mode: 'horizon' }),
  'persp-1pt': (el) => perspectiveLab(el, { mode: '1pt' }),
  'persp-2pt': (el) => perspectiveLab(el, { mode: '2pt' }),
  'persp-3pt': (el) => perspectiveLab(el, { mode: '3pt' }),
  'persp-ellipse': (el) => perspectiveLab(el, { mode: 'ellipse' }),
  'persp-figures': (el) => perspectiveLab(el, { mode: 'figures' }),
  'snap-pad': snapPad,
  atmosphere, 'value-groups': valueGroups, composition,
  face: (el) => faceRig(el), 'face-quiz': (el) => faceRig(el, { quiz: true }), 'loomis': loomisHead,
  'light-sphere': lightSphere, harmony, 'value-hue': valueVsHue,
  grading: (el) => grading(el), 'grade-match': (el) => grading(el, { match: true }),
  ball: bouncingBall, spacing: spacingChart, arcs, anticipation, overlap, walk: walkCycle, 'ones-twos': onesTwos,
  'webtoon-scroll': webtoonScroll, 'dialogue-order': dialogueOrder, slicing, pipeline: coloringPipeline,
};
