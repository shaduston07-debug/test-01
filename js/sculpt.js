// Sculpting engine for natural-looking, posable bodies (people, monsters).
//
// A body is described as smooth primitives (tapered capsules, ellipsoids, rounded boxes) attached
// to bones, combined in a blend tree (smooth union / union / smooth subtraction / half-space cut).
// That signed-distance field is meshed with surface nets on a fine grid (only in a narrow band
// around the surface, found from a coarse pass), each vertex is projected exactly onto the
// surface and gets the field gradient as its normal. Skin weights come from how close every
// vertex is to each bone's primitives, so the single continuous mesh bends smoothly at joints
// like a rigged character (three.js SkinnedMesh on the existing joint objects).
let T = null;
export function setThree(t) { T = t; }

const D = Math.PI / 180;

// ───────── primitives (authored in bind-pose world coordinates) ─────────
// opts: sx/sz squash the cross-section of a capsule, up = hint for its cross-section axes,
// rot = euler degrees (ellipsoid / box), w = false → not used for skin weights (e.g. eyes)
export function cone(bone, a, b, r1, r2, o = {}) { return { t: 0, bone, a, b, r1, r2, sx: o.sx || 1, sz: o.sz || 1, up: o.up || null, w: o.w !== false, tag: o.tag }; }
export function ell(bone, c, r, o = {}) { return { t: 1, bone, c, r, rot: o.rot || [0, 0, 0], w: o.w !== false, tag: o.tag }; }
// thin rounded triangle (wing membranes, fins): corners a, b, c, half thickness th
export function tri(bone, a, b, c, th, o = {}) { return { t: 3, bone, a, b, c, th, w: o.w !== false, tag: o.tag }; }
export function rbox(bone, c, half, round = 0.005, o = {}) { return { t: 2, bone, c, half, round, rot: o.rot || [0, 0, 0], w: o.w !== false, tag: o.tag }; }
// blend tree nodes
export const smooth = (k, ...ch) => ({ op: 'smin', k, ch: ch.flat().filter(Boolean) });
export const union = (...ch) => ({ op: 'min', k: 0, ch: ch.flat().filter(Boolean) });
export const carve = (k, base, ...cut) => ({ op: 'sub', k, ch: [base, ...cut.flat().filter(Boolean)] });
// keep the part of `node` on the side of the plane the normal points to (p·n ≥ p0·n)
export const clip = (node, p0, n, bone = null) => ({ op: 'clip', k: 0, ch: [node], p0, n, bone });
// inflate `node` by g0 at the plane (p0, n) growing to g1 at distance len along n — used for the
// overlapping stub where a finer-meshed part (hand, head) meets the body without a visible ridge
export const grow = (node, p0, n, len, g0, g1, bone = null) => ({ op: 'grow', k: 0, ch: [node], p0, n, len, g0, g1, bone });

// ───────── math helpers (no three.js: this file also runs in workers) ─────────
// rotation for euler degrees, XYZ order (same as three.js); returns the three local axes in world
function eulerMat(r) {
  const x = r[0] * D, y = r[1] * D, z = r[2] * D;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [c * e, af + be * d, bf - ae * d, -c * f, ae - bf * d, be + af * d, d, -b * c, a * c];
}
// M: 16 numbers, column-major (three.js Matrix4.elements) or null
const mPoint = (M, a) => (M ? [M[0] * a[0] + M[4] * a[1] + M[8] * a[2] + M[12], M[1] * a[0] + M[5] * a[1] + M[9] * a[2] + M[13], M[2] * a[0] + M[6] * a[1] + M[10] * a[2] + M[14]] : a.slice());
const mDir = (M, a) => {
  if (!M) return a.slice();
  const v = [M[0] * a[0] + M[4] * a[1] + M[8] * a[2], M[1] * a[0] + M[5] * a[1] + M[9] * a[2], M[2] * a[0] + M[6] * a[1] + M[10] * a[2]];
  const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l];
};
function perp(u, up) {
  let h = up || (Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1]);
  if (Math.abs(h[0] * u[0] + h[1] * u[1] + h[2] * u[2]) > 0.98) h = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  // w = u × h, v = w × u
  let w = [u[1] * h[2] - u[2] * h[1], u[2] * h[0] - u[0] * h[2], u[0] * h[1] - u[1] * h[0]];
  const wl = Math.hypot(...w); w = w.map((x) => x / wl);
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  return [v, w];
}

// Prepare a primitive for fast evaluation; M = optional matrix moving it (bone motion from the
// authoring pose to the bind pose).
function prep(p, M) {
  const tp = (a) => mPoint(M, a);
  const td = (a) => mDir(M, a);
  const q = { t: p.t, bone: p.bone, w: p.w, tag: p.tag, side: null, sub: null };
  if (p.t === 3) {
    const a = tp(p.a), b = tp(p.b), c = tp(p.c), th = p.th;
    const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], cb = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], ac = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
    const nor = [ba[1] * ac[2] - ba[2] * ac[1], ba[2] * ac[0] - ba[0] * ac[2], ba[0] * ac[1] - ba[1] * ac[0]];
    Object.assign(q, { a, b, c, ba, cb, ac, nor, th, nn: nor[0] ** 2 + nor[1] ** 2 + nor[2] ** 2 });
    q.bb = [0, 1, 2].map((i) => Math.min(a[i], b[i], c[i]) - th).concat([0, 1, 2].map((i) => Math.max(a[i], b[i], c[i]) + th));
    q.size = th * 2.5; q.rad = Math.max(Math.hypot(...ba), Math.hypot(...cb), Math.hypot(...ac)) / 2;
    return q;
  }
  if (p.t === 0) {
    const a = tp(p.a), b = tp(p.b);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], h = Math.max(1e-5, Math.hypot(...d)), u = d.map((x) => x / h);
    const [v, w] = perp(u, p.up ? td(p.up) : null);
    let cb = (p.r1 - p.r2) / h; cb = Math.max(-0.999, Math.min(0.999, cb));
    Object.assign(q, { ax: a[0], ay: a[1], az: a[2], ux: u[0], uy: u[1], uz: u[2], vx: v[0], vy: v[1], vz: v[2], wx: w[0], wy: w[1], wz: w[2],
      h, r1: p.r1, r2: p.r2, cb, ca: Math.sqrt(1 - cb * cb), isx: 1 / p.sx, isz: 1 / p.sz, sm: Math.min(p.sx, p.sz), rad: Math.max(p.r1, p.r2) * Math.max(p.sx, p.sz) });
    const R = q.rad;
    q.bb = [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R, Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
    q.size = (p.r1 + p.r2) / 2 * Math.sqrt(p.sx * p.sz);
  } else {
    const c = tp(p.c);
    let R = eulerMat(p.rot);
    if (M) { // rotate the local axes with the bone
      const ax = [td([R[0], R[1], R[2]]), td([R[3], R[4], R[5]]), td([R[6], R[7], R[8]])];
      R = [...ax[0], ...ax[1], ...ax[2]];
    }
    Object.assign(q, { cx: c[0], cy: c[1], cz: c[2], m: R });
    // tight axis-aligned extents of the rotated shape
    const e = [0, 0, 0];
    if (p.t === 1) {
      Object.assign(q, { rx: p.r[0], ry: p.r[1], rz: p.r[2] }); q.size = Math.cbrt(p.r[0] * p.r[1] * p.r[2]); q.rad = Math.max(...p.r);
      for (let i = 0; i < 3; i++) e[i] = Math.sqrt((R[i] * p.r[0]) ** 2 + (R[3 + i] * p.r[1]) ** 2 + (R[6 + i] * p.r[2]) ** 2);
    } else {
      Object.assign(q, { bx: p.half[0], by: p.half[1], bz: p.half[2], rr: p.round }); q.size = Math.min(...p.half); q.rad = Math.hypot(...p.half);
      for (let i = 0; i < 3; i++) e[i] = Math.abs(R[i]) * p.half[0] + Math.abs(R[3 + i]) * p.half[1] + Math.abs(R[6 + i]) * p.half[2];
    }
    q.bb = [c[0] - e[0], c[1] - e[1], c[2] - e[2], c[0] + e[0], c[1] + e[1], c[2] + e[2]];
  }
  return q;
}


const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function segD2(e, px, py, pz) { // squared distance from p (relative to the edge start) to edge e
  const t = Math.max(0, Math.min(1, (e[0] * px + e[1] * py + e[2] * pz) / (e[0] * e[0] + e[1] * e[1] + e[2] * e[2])));
  const dx = e[0] * t - px, dy = e[1] * t - py, dz = e[2] * t - pz; return dx * dx + dy * dy + dz * dz;
}
function evTri(q, x, y, z) {
  const { a, b, c, ba, cb, ac, nor } = q;
  const pa = [x - a[0], y - a[1], z - a[2]], pb = [x - b[0], y - b[1], z - b[2]], pc = [x - c[0], y - c[1], z - c[2]];
  const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const sgn = Math.sign(dot3(cr(ba, nor), pa)) + Math.sign(dot3(cr(cb, nor), pb)) + Math.sign(dot3(cr(ac, nor), pc));
  let d2;
  if (sgn < 2) d2 = Math.min(segD2(ba, pa[0], pa[1], pa[2]), segD2(cb, pb[0], pb[1], pb[2]), segD2(ac, pc[0], pc[1], pc[2]));
  else { const k = dot3(nor, pa); d2 = k * k / q.nn; }
  return Math.sqrt(d2) - q.th;
}
function evPrim(q, x, y, z) {
  if (q.t === 3) return evTri(q, x, y, z);
  if (q.t === 0) {
    const px = x - q.ax, py = y - q.ay, pz = z - q.az;
    const ly = px * q.ux + py * q.uy + pz * q.uz;
    const lx = (px * q.vx + py * q.vy + pz * q.vz) * q.isx, lz = (px * q.wx + py * q.wy + pz * q.wz) * q.isz;
    const r = Math.sqrt(lx * lx + lz * lz);
    const k = -q.cb * r + q.ca * ly;
    let d;
    if (k < 0) d = Math.sqrt(r * r + ly * ly) - q.r1;
    else if (k > q.ca * q.h) { const dy = ly - q.h; d = Math.sqrt(r * r + dy * dy) - q.r2; }
    else d = r * q.ca + ly * q.cb - q.r1;
    return d * q.sm;
  }
  const px = x - q.cx, py = y - q.cy, pz = z - q.cz, m = q.m;
  const lx = px * m[0] + py * m[1] + pz * m[2], ly = px * m[3] + py * m[4] + pz * m[5], lz = px * m[6] + py * m[7] + pz * m[8];
  if (q.t === 1) {
    const ax = lx / q.rx, ay = ly / q.ry, az = lz / q.rz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax / q.rx, by = ay / q.ry, bz = az / q.rz;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 < 1e-9 ? -Math.min(q.rx, q.ry, q.rz) : k0 * (k0 - 1) / k1;
  }
  const qx = Math.abs(lx) - q.bx + q.rr, qy = Math.abs(ly) - q.by + q.rr, qz = Math.abs(lz) - q.bz + q.rr;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - q.rr;
}

// cubic smooth min / max
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * h * k / 6; }
function smax(a, b, k) { return -smin(-a, -b, k); }

// Compile a tree: prepare leaves (moved by mats[bone]), compute boxes and culling margins.
// pad: how far outside its box a node must be evaluated exactly. It has to cover the blend
// radius of EVERY smooth ancestor (inh), or a cheap lower bound would change a blend → seams.
function compile(node, mats, leaves, pad, inh = 0) {
  if (node.t != null) {
    const q = prep(node, mats && mats[node.bone]);
    q.leaf = true; q.pad = pad; leaves.push(q);
    return q;
  }
  const n = { op: node.op, k: node.k, ch: [], pad };
  // inflating ('grow') turns a cheap far-away lower bound into a fake surface unless the margin
  // also covers the inflation
  const kk = node.op === 'smin' || node.op === 'sub' ? Math.max(inh, node.k) : node.op === 'grow' ? inh + Math.max(0, node.g0, node.g1) * 1.5 : inh;
  const cpad = Math.max(kk * 1.2, 0.004) + 0.006;
  n.ch = node.ch.map((c) => compile(c, mats, leaves, cpad, kk));
  if (node.op === 'clip' || node.op === 'grow') {
    let p0 = node.p0, nn = node.n;
    if (node.bone && mats && mats[node.bone]) { p0 = mPoint(mats[node.bone], p0); nn = mDir(mats[node.bone], nn); }
    const l = Math.hypot(...nn); n.nx = nn[0] / l; n.ny = nn[1] / l; n.nz = nn[2] / l; n.pd = p0[0] * n.nx + p0[1] * n.ny + p0[2] * n.nz;
  }
  // union box (subtractors don't grow it)
  const src = node.op === 'sub' ? [n.ch[0]] : n.ch;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const c of src) for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], c.bb[i]); bb[i + 3] = Math.max(bb[i + 3], c.bb[i + 3]); }
  if (node.op === 'grow') { n.len = node.len; n.g0 = node.g0; n.g1 = node.g1; }
  const g = node.op === 'smin' ? node.k * 0.5 : node.op === 'grow' ? Math.max(0, node.g0, node.g1) : 0;
  n.bb = [bb[0] - g, bb[1] - g, bb[2] - g, bb[3] + g, bb[4] + g, bb[5] + g];
  // a cut along a main axis also trims the box
  if (node.op === 'clip') {
    const nv = [n.nx, n.ny, n.nz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(nv[i]) < 0.999) continue;
      const c = n.pd / nv[i];
      if (nv[i] > 0) n.bb[i] = Math.max(n.bb[i], c); else n.bb[i + 3] = Math.min(n.bb[i + 3], c);
    }
  }
  return n;
}

function boxDist(bb, x, y, z) {
  const dx = Math.max(bb[0] - x, 0, x - bb[3]), dy = Math.max(bb[1] - y, 0, y - bb[4]), dz = Math.max(bb[2] - z, 0, z - bb[5]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function ev(n, x, y, z) {
  const bd = boxDist(n.bb, x, y, z);
  if (bd > n.pad) return bd;
  if (n.leaf) return evPrim(n, x, y, z);
  const ch = n.ch;
  switch (n.op) {
    case 'min': { let d = Infinity; for (let i = 0; i < ch.length; i++) { const v = ev(ch[i], x, y, z); if (v < d) d = v; } return d; }
    case 'smin': { let d = ev(ch[0], x, y, z); for (let i = 1; i < ch.length; i++) d = smin(d, ev(ch[i], x, y, z), n.k); return d; }
    case 'sub': { let d = ev(ch[0], x, y, z); for (let i = 1; i < ch.length; i++) d = smax(d, -ev(ch[i], x, y, z), n.k); return d; }
    case 'clip': return Math.max(ev(ch[0], x, y, z), n.pd - (x * n.nx + y * n.ny + z * n.nz));
    case 'grow': { const t = Math.max(0, Math.min(1, (x * n.nx + y * n.ny + z * n.nz - n.pd) / n.len)); return ev(ch[0], x, y, z) - (n.g0 + (n.g1 - n.g0) * t); }
  }
  return bd;
}

// The part of a compiled tree that can matter inside box bb (others are farther than their
// culling margin everywhere in it). null = nothing near.
function gap(a, b) {
  const gx = Math.max(a[0] - b[3], b[0] - a[3], 0), gy = Math.max(a[1] - b[4], b[1] - a[4], 0), gz = Math.max(a[2] - b[5], b[2] - a[5], 0);
  return Math.sqrt(gx * gx + gy * gy + gz * gz);
}
function prune(n, bb) {
  if (gap(n.bb, bb) > n.pad) return null;
  if (n.leaf) return n;
  if (n.op === 'min' || n.op === 'smin') {
    const ch = []; for (const c of n.ch) { const p = prune(c, bb); if (p) ch.push(p); }
    if (!ch.length) return null;
    if (ch.length === 1) return ch[0];
    return ch.length === n.ch.length ? n : { ...n, ch };
  }
  if (n.op === 'sub') {
    const base = prune(n.ch[0], bb); if (!base) return null;
    const cuts = []; for (let i = 1; i < n.ch.length; i++) { const p = prune(n.ch[i], bb); if (p) cuts.push(p); }
    if (!cuts.length) return base;
    return { ...n, ch: [base, ...cuts] };
  }
  const c = prune(n.ch[0], bb); if (!c) return null;
  return c === n.ch[0] ? n : { ...n, ch: [c] };
}

// ───────── meshing: narrow-band surface nets ─────────
export function meshSDF(tree, { h = 0.005, mats = null } = {}) {
  const leaves = [];
  const root = compile(tree, mats, leaves, 1e9);
  let nEval = 0;
  const f = (x, y, z) => { nEval++; return ev(root, x, y, z); }, fAll = f;
  const B = 4, m = 3 * h;
  const x0 = root.bb[0] - m, y0 = root.bb[1] - m, z0 = root.bb[2] - m;
  const nbx = Math.ceil((root.bb[3] + m - x0) / (h * B)), nby = Math.ceil((root.bb[4] + m - y0) / (h * B)), nbz = Math.ceil((root.bb[5] + m - z0) / (h * B));
  const nx = nbx * B, ny = nby * B, nz = nbz * B;
  const sx = 1, sy = nx + 1, sz = (nx + 1) * (ny + 1);
  const field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(NaN);
  // coarse pass: one sample at every block centre. A block can only contain surface if its centre
  // is within half a block diagonal of it (the field is close to a true distance).
  const nblk = nbx * nby * nbz;
  const centre = new Float32Array(nblk);
  const thr = B * h * Math.sqrt(3) * 0.5 * 1.12;
  const active = [];
  for (let k = 0; k < nbz; k++) for (let j = 0; j < nby; j++) {
    // only the shapes near this row of blocks
    const cy = y0 + (j + 0.5) * B * h, cz = z0 + (k + 0.5) * B * h, r = B * h;
    const row = prune(root, [x0 - r, cy - r, cz - r, x0 + nx * h + r, cy + r, cz + r]);
    for (let i = 0; i < nbx; i++) {
    const cx = x0 + (i + 0.5) * B * h;
    nEval++;
    const v = row ? ev(row, cx, cy, cz) : 1; // nothing near this row: outside
    centre[i + j * nbx + k * nbx * nby] = v;
    if (Math.abs(v) < thr) active.push(i, j, k);
    }
  }
  // fine samples inside active blocks, each block with only the shapes near it
  const trees = new Array(active.length / 3);
  const mg = 2.5 * h;
  for (let a = 0, bix = 0; a < active.length; a += 3, bix++) {
    const bi = active[a] * B, bj = active[a + 1] * B, bk = active[a + 2] * B;
    const bx0 = x0 + bi * h, by0 = y0 + bj * h, bz0 = z0 + bk * h;
    const pr = trees[bix] = prune(root, [bx0 - mg, by0 - mg, bz0 - mg, bx0 + B * h + mg, by0 + B * h + mg, bz0 + B * h + mg]);
    for (let k = bk; k <= bk + B; k++) for (let j = bj; j <= bj + B; j++) for (let i = bi; i <= bi + B; i++) {
      const id = i + j * sy + k * sz;
      if (field[id] !== field[id]) { nEval++; const x = x0 + i * h, y = y0 + j * h, z = z0 + k * h; field[id] = pr ? ev(pr, x, y, z) : 1; }
    }
  }
  const val = (i, j, k) => {
    const v = field[i + j * sy + k * sz];
    if (v === v) return v;
    // untouched: no surface in any block around it, same sign as its block's centre
    const bi = Math.min(nbx - 1, (i / B) | 0), bj = Math.min(nby - 1, (j / B) | 0), bk = Math.min(nbz - 1, (k / B) | 0);
    return centre[bi + bj * nbx + bk * nbx * nby] < 0 ? -h * 4 : h * 4;
  };
  // one vertex per cell with a sign change
  const cellVert = new Map();
  const P = [];
  const corner = new Float64Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cOff = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const vBlock = [];
  for (let a = 0, bix = 0; a < active.length; a += 3, bix++) {
    const bi = active[a] * B, bj = active[a + 1] * B, bk = active[a + 2] * B;
    for (let k = bk; k < bk + B; k++) for (let j = bj; j < bj + B; j++) for (let i = bi; i < bi + B; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { const v = val(i + cOff[c][0], j + cOff[c][1], k + cOff[c][2]); corner[c] = v; if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let vx = 0, vy = 0, vz = 0, n = 0;
      for (const [e0, e1] of EDGES) {
        const a0 = corner[e0], a1 = corner[e1];
        if ((a0 < 0) === (a1 < 0)) continue;
        const t = a0 / (a0 - a1);
        vx += cOff[e0][0] + (cOff[e1][0] - cOff[e0][0]) * t; vy += cOff[e0][1] + (cOff[e1][1] - cOff[e0][1]) * t; vz += cOff[e0][2] + (cOff[e1][2] - cOff[e0][2]) * t; n++;
      }
      cellVert.set(i + j * nx + k * nx * ny, P.length / 3);
      vBlock.push(bix);
      P.push(x0 + (i + vx / n) * h, y0 + (j + vy / n) * h, z0 + (k + vz / n) * h);
    }
  }
  // quads across every sign-changing grid edge
  const I = [];
  const cv = (i, j, k) => cellVert.get(i + j * nx + k * nx * ny);
  const quad = (a, b, c, d, flip) => {
    if (a == null || b == null || c == null || d == null) return;
    if (flip) { const t = b; b = d; d = t; }
    // split along the shorter diagonal
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (dac <= dbd) I.push(a, b, c, a, c, d); else I.push(a, b, d, b, c, d);
  };
  for (const key of cellVert.keys()) {
    const i = key % nx, j = ((key / nx) | 0) % ny, k = (key / (nx * ny)) | 0;
    const s0 = val(i, j, k) < 0;
    if (j > 0 && k > 0 && (val(i + 1, j, k) < 0) !== s0) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !s0);
    if (i > 0 && k > 0 && (val(i, j + 1, k) < 0) !== s0) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !s0);
    if (i > 0 && j > 0 && (val(i, j, k + 1) < 0) !== s0) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !s0);
  }
  // project onto the exact surface; normals from the field gradient
  const nv = P.length / 3, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const e = h * 0.35;
  for (let v = 0; v < nv; v++) {
    const pr = trees[vBlock[v]];
    const f = pr ? (x, y, z) => { nEval++; return ev(pr, x, y, z); } : fAll;
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 2; it++) {
      const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
      gx = a - b - c + d; gy = -a - b + c + d; gz = -a + b - c + d;
      const g = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= g; gy /= g; gz /= g;
      if (it === 1) break;
      const fv = (a + b + c + d) / 4;
      const step = Math.max(-h, Math.min(h, fv));
      x -= gx * step; y -= gy * step; z -= gz * step;
    }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    nor[v * 3] = gx; nor[v * 3 + 1] = gy; nor[v * 3 + 2] = gz;
  }
  return { pos, nor, index: new Uint32Array(I), leaves, stats: { grid: [nx, ny, nz], active: active.length / 3, evals: nEval } };
}

// ───────── skin weights ─────────
// side / finger tags keep e.g. the inner thighs or neighbouring fingers from pulling on each other
function tagsFor(bone) {
  const m = bone.match(/(L|R)(\d*)$/);
  const side = m ? m[1] : null;
  const f = bone.match(/^(thumb|index|middle|ring|pinky|claw\w*|toe\d|tent\d+|leg\d+|f\d+)/);
  return { side, sub: f ? f[1] + (side || '') : null };
}
export function skinWeights(pos, leaves, boneIndex, { falloff = 0.4, maxDist = 0.08, maxS = 0.03 } = {}) {
  const nv = pos.length / 3;
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), dom = new Uint16Array(nv);
  const W = leaves.filter((q) => q.w && boneIndex[q.bone] != null);
  for (const q of W) { const t = tagsFor(q.bone); q.side = q.tag && q.tag.side !== undefined ? q.tag.side : t.side; q.sub = q.tag && q.tag.sub !== undefined ? q.tag.sub : t.sub; q.bi = boneIndex[q.bone]; }
  const nb = Object.keys(boneIndex).length;
  const bd = new Float64Array(nb);
  const touched = [];
  const ds = new Float64Array(W.length);
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let best = -1, bdst = Infinity;
    for (let i = 0; i < W.length; i++) {
      const q = W[i];
      const b = boxDist(q.bb, x, y, z);
      if (b > maxDist) { ds[i] = Infinity; continue; }
      const d = evPrim(q, x, y, z); ds[i] = d;
      if (d < bdst) { bdst = d; best = i; }
    }
    if (best < 0) { si[v * 4] = 0; sw[v * 4] = 1; continue; }
    const q0 = W[best], s = Math.max(0.0025, Math.min(maxS, q0.size * falloff));
    touched.length = 0;
    for (let i = 0; i < W.length; i++) {
      const d = ds[i]; if (d === Infinity) continue;
      const q = W[i];
      if (q0.side && q.side && q.side !== q0.side) continue;
      if (q0.sub && q.sub && q.sub !== q0.sub) continue;
      if (d - bdst > s * 5) continue;
      if (!touched.includes(q.bi)) { touched.push(q.bi); bd[q.bi] = d; } else if (d < bd[q.bi]) bd[q.bi] = d;
    }
    // weights: exponential falloff by extra distance; keep the strongest four
    const list = touched.map((b) => [b, Math.exp(-(bd[b] - bdst) / s)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let tot = 0; for (const [, w] of list) tot += w;
    for (let k = 0; k < list.length; k++) { si[v * 4 + k] = list[k][0]; sw[v * 4 + k] = list[k][1] / tot; }
    dom[v] = list[0][0];
  }
  return { si, sw, dom };
}

// Light Laplacian smoothing of skin weights over the mesh (removes faceted creases at joints).
export function smoothWeights(index, nv, si, sw, iters = 2) {
  // vertex neighbours (CSR)
  const deg = new Uint32Array(nv + 1);
  for (let t = 0; t < index.length; t++) deg[index[t] + 1] += 2;
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const nbr = new Uint32Array(deg[nv]), fill = deg.slice(0, nv);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    nbr[fill[a]++] = b; nbr[fill[a]++] = c; nbr[fill[b]++] = a; nbr[fill[b]++] = c; nbr[fill[c]++] = a; nbr[fill[c]++] = b;
  }
  const ids = new Int32Array(64), ws = new Float64Array(64);
  for (let it = 0; it < iters; it++) {
    const ni = new Uint16Array(si.length), nw = new Float32Array(sw.length);
    for (let v = 0; v < nv; v++) {
      let n = 0;
      const addv = (u, k) => {
        for (let j = 0; j < 4; j++) {
          const w = sw[u * 4 + j]; if (w <= 0) continue;
          const b = si[u * 4 + j];
          let q = 0; while (q < n && ids[q] !== b) q++;
          if (q === n) { if (n === 64) continue; ids[n] = b; ws[n] = 0; n++; }
          ws[q] += w * k;
        }
      };
      const d0 = deg[v], d1 = deg[v + 1], cnt = d1 - d0;
      addv(v, 1);
      for (let e = d0; e < d1; e++) addv(nbr[e], 1 / Math.max(1, cnt));
      // keep the strongest four
      let tot = 0;
      for (let j = 0; j < 4; j++) {
        let best = -1, bw = 0;
        for (let q = 0; q < n; q++) if (ws[q] > bw) { bw = ws[q]; best = q; }
        if (best < 0) break;
        ni[v * 4 + j] = ids[best]; nw[v * 4 + j] = bw; tot += bw; ws[best] = -1;
      }
      for (let j = 0; j < 4; j++) nw[v * 4 + j] /= tot || 1;
    }
    si.set(ni); sw.set(nw);
  }
}

// ───────── one part: mesh + skin weights (pure; runs in a worker) ─────────
export function buildPart({ tree, h, mats, boneIndex, skin, smooth }) {
  const t0 = Date.now();
  const r = meshSDF(tree, { h, mats });
  const { si, sw } = skinWeights(r.pos, r.leaves, boneIndex, skin || {});
  smoothWeights(r.index, r.pos.length / 3, si, sw, smooth ?? 2);
  return { pos: r.pos, nor: r.nor, index: r.index, si, sw, ms: Date.now() - t0, stats: r.stats };
}

// small pool of module workers (one per part, up to the core count); falls back to the main thread
let pool = null;
function workers() {
  if (pool !== null) return pool;
  pool = [];
  try {
    const n = Math.max(1, Math.min(4, (globalThis.navigator && navigator.hardwareConcurrency) || 2));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./sculpt-worker.js', import.meta.url), { type: 'module' });
      w.jobs = new Map(); w.busy = 0;
      w.onmessage = (e) => { const j = w.jobs.get(e.data.id); if (!j) return; w.jobs.delete(e.data.id); w.busy--; e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data.result); };
      w.onerror = (e) => { for (const j of w.jobs.values()) j.reject(e); w.jobs.clear(); w.busy = 0; w.dead = true; };
      pool.push(w);
    }
  } catch (e) { pool = []; }
  return pool;
}
let jobId = 0;
function runPart(job) {
  const ws = workers().filter((w) => !w.dead);
  if (!ws.length || globalThis.__sculptInline) return Promise.resolve(buildPart(job));
  const w = ws.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = ++jobId;
  return new Promise((resolve, reject) => { w.jobs.set(id, { resolve, reject }); w.busy++; w.postMessage({ id, job }); })
    .catch((e) => { console.warn('sculpt worker failed, meshing here', e); return buildPart(job); });
}

// ───────── build a skinned mesh on existing joint objects ─────────
// parts: [{ tree, h }] meshed separately (e.g. body + hands at a finer grid) and merged.
// bones: { name: Object3D } already posed in the bind pose with world matrices up to date;
// mats: { bone: number[16] } moving authoring coordinates to that bind pose (or null).
const meshCache = new Map();
export async function sculptGeometry({ key, parts, mats, boneNames }) {
  const boneIndex = Object.fromEntries(boneNames.map((n, i) => [n, i]));
  if (key && meshCache.has(key)) return meshCache.get(key);
  const t0 = Date.now();
  const use = parts.filter((_, i) => !globalThis.__sculptParts || globalThis.__sculptParts.includes(i));
  const res = await Promise.all(use.map((part) => runPart({ tree: part.tree, h: part.h, mats, boneIndex, skin: part.skin, smooth: part.smooth })));
  if (globalThis.__sculptLog) console.log('LOG sculpt ' + res.map((r) => `${r.pos.length / 3}v/${r.index.length / 3}t ${r.ms}ms`).join(' · ') + ` total ${Date.now() - t0}ms`);
  const cat = (arrs, C) => { const n = arrs.reduce((s, a) => s + a.length, 0), o = new C(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
  const nv = res.reduce((s, r) => s + r.pos.length / 3, 0);
  const I = new (nv > 65535 ? Uint32Array : Uint16Array)(res.reduce((s, r) => s + r.index.length, 0));
  let base = 0, k = 0;
  for (const r of res) { for (let i = 0; i < r.index.length; i++) I[k++] = r.index[i] + base; base += r.pos.length / 3; }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(cat(res.map((r) => r.pos), Float32Array), 3));
  geo.setAttribute('normal', new T.BufferAttribute(cat(res.map((r) => r.nor), Float32Array), 3));
  geo.setAttribute('skinIndex', new T.BufferAttribute(cat(res.map((r) => r.si), Uint16Array), 4));
  geo.setAttribute('skinWeight', new T.BufferAttribute(cat(res.map((r) => r.sw), Float32Array), 4));
  geo.setIndex(new T.BufferAttribute(I, 1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  if (key) { meshCache.set(key, geo); if (meshCache.size > 12) meshCache.delete(meshCache.keys().next().value); }
  return geo;
}
// static (unskinned) sculpted geometry, e.g. weapons; parts: [{ tree, h }]
export async function sculptStatic({ key, parts }) {
  if (key && meshCache.has(key)) return meshCache.get(key);
  const res = await Promise.all(parts.map((part) => runPart({ tree: part.tree, h: part.h, mats: null, boneIndex: {}, skin: {}, smooth: 0 })));
  const nv = res.reduce((s, r) => s + r.pos.length / 3, 0);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const I = new (nv > 65535 ? Uint32Array : Uint16Array)(res.reduce((s, r) => s + r.index.length, 0));
  let base = 0, k = 0;
  for (const r of res) { pos.set(r.pos, base * 3); nor.set(r.nor, base * 3); for (let i = 0; i < r.index.length; i++) I[k++] = r.index[i] + base; base += r.pos.length / 3; }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setIndex(new T.BufferAttribute(I, 1));
  geo.computeBoundingSphere();
  if (key) meshCache.set(key, geo);
  return geo;
}
// bind a (cached) geometry to joint objects that are currently in the bind pose
export function bindSkinned(geo, bones, material, root) {
  const names = Object.keys(bones).filter((n) => n !== '_root');
  geo = geo.clone();
  const mesh = new T.SkinnedMesh(geo, material);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new T.Skeleton(names.map((n) => bones[n])));
  mesh.frustumCulled = false; // posed limbs can leave the bind-pose bounds
  const si = geo.attributes.skinIndex.array, sw = geo.attributes.skinWeight.array;
  mesh.userData.boneOf = (v) => { let b = 0, w = -1; for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > w) { w = sw[v * 4 + k]; b = si[v * 4 + k]; } return names[b]; };
  mesh.userData.boneNames = names;
  mesh.userData.skinned = true;
  mesh.raycast = fastSkinnedRaycast;
  return mesh;
}

// three.js re-skins every triangle on each raycast (~100 ms for a body). Instead: triangles are
// grouped by the joint they follow, each group has a bounding sphere in the bind pose; a ray only
// tests (and skins) the groups whose moved sphere it passes through. ~1–3 ms.
function pickGroups(mesh) {
  const g = mesh.geometry;
  if (g.userData.pick) return g.userData.pick;
  const P = g.attributes.position.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, idx = g.index.array;
  const dom = (v) => { let b = 0, w = -1; for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > w) { w = sw[v * 4 + k]; b = si[v * 4 + k]; } return b; };
  const groups = new Map();
  for (let t = 0; t < idx.length; t += 3) { const b = dom(idx[t]); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(t); }
  const out = [];
  for (const [b, tris] of groups) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const t of tris) for (let k = 0; k < 3; k++) { const v = idx[t + k] * 3; x0 = Math.min(x0, P[v]); x1 = Math.max(x1, P[v]); y0 = Math.min(y0, P[v + 1]); y1 = Math.max(y1, P[v + 1]); z0 = Math.min(z0, P[v + 2]); z1 = Math.max(z1, P[v + 2]); }
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    out.push({ b, tris: Int32Array.from(tris), c, r: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 });
  }
  return (g.userData.pick = out);
}
let _V = null;
function fastSkinnedRaycast(raycaster, intersects) {
  if (!_V) _V = { m: new T.Matrix4(), a: new T.Vector3(), b: new T.Vector3(), c: new T.Vector3(), hit: new T.Vector3(), cen: new T.Vector3() };
  const mesh = this, g = mesh.geometry, P = g.attributes.position.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, idx = g.index.array;
  const bones = mesh.skeleton.bones, inv = mesh.skeleton.boneInverses, ray = raycaster.ray;
  const mats = bones.map((bn, i) => new T.Matrix4().multiplyMatrices(bn.matrixWorld, inv[i]).multiply(mesh.bindMatrix));
  const nv = P.length / 3, done = new Uint8Array(nv), W = new Float32Array(nv * 3);
  const skin = (v) => {
    if (done[v]) return;
    done[v] = 1;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k]; if (!w) continue;
      const e = mats[si[v * 4 + k]].elements;
      ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]); oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]); oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    W[v * 3] = ox; W[v * 3 + 1] = oy; W[v * 3 + 2] = oz;
  };
  let best = null;
  for (const grp of pickGroups(mesh)) {
    const M = mats[grp.b], sc = M.getMaxScaleOnAxis();
    _V.cen.set(...grp.c).applyMatrix4(M);
    const r = grp.r * sc * 1.35 + 0.03 * sc;
    if (ray.distanceSqToPoint(_V.cen) > r * r) continue;
    const tr = grp.tris;
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i], a = idx[t], b = idx[t + 1], c = idx[t + 2];
      skin(a); skin(b); skin(c);
      _V.a.set(W[a * 3], W[a * 3 + 1], W[a * 3 + 2]); _V.b.set(W[b * 3], W[b * 3 + 1], W[b * 3 + 2]); _V.c.set(W[c * 3], W[c * 3 + 1], W[c * 3 + 2]);
      if (!ray.intersectTriangle(_V.a, _V.b, _V.c, false, _V.hit)) continue;
      const d = ray.origin.distanceTo(_V.hit);
      if (d < raycaster.near || d > raycaster.far || (best && d >= best.distance)) continue;
      best = { distance: d, point: _V.hit.clone(), face: { a, b, c, normal: new T.Vector3(), materialIndex: 0 }, faceIndex: t / 3, object: mesh };
    }
  }
  if (best) intersects.push(best);
}

// Triangles mostly driven by one joint, as a separate skinned overlay (selection highlight).
export function boneOverlay(mesh, boneName, material) {
  const names = mesh.userData.boneNames, bi = names.indexOf(boneName);
  if (bi < 0) return null;
  const g = mesh.geometry, idx = g.index.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array;
  const w = (v) => { for (let k = 0; k < 4; k++) if (si[v * 4 + k] === bi) return sw[v * 4 + k]; return 0; };
  const out = [];
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (w(a) + w(b) + w(c) > 1.2) out.push(a, b, c); }
  if (!out.length) return null;
  const sub = new T.BufferGeometry();
  for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) sub.setAttribute(k, g.attributes[k]);
  sub.setIndex(new T.BufferAttribute(idx.constructor === Uint32Array ? new Uint32Array(out) : new Uint16Array(out), 1));
  const m = new T.SkinnedMesh(sub, material);
  m.bind(mesh.skeleton, mesh.bindMatrix);
  m.frustumCulled = false;
  m.raycast = () => {};
  m.userData.overlay = true; // never outlined / picked
  return m;
}
export const _test = { meshSDF, compile, ev };
