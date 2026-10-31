// Built-in 3D models: Clip-Studio-style drawing figures (female / male, with finger joints),
// a posable dragon, wearable medieval / sci-fi armour, vehicles, a castle and city scenes,
// plus the pose library, two-bone IK and BVH pose import / export.
//
// Everything is generated from three.js primitives (no downloads). Parts that move together
// are merged into one mesh per material, so even big scenes stay a handful of draw calls.
let T = null;
export function setThree(t) { T = t; }

const D = Math.PI / 180;

// ───────── geometry helpers ─────────
// merge geometries (position / normal / uv, optional color) into one indexed geometry
function merge(list) {
  let nv = 0, ni = 0;
  const withColor = list.some((g) => g.attributes.color);
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = withColor ? new Float32Array(nv * 3).fill(1) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (c && col) col.set(c.array, vo * 3);
    if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[io + k] = a[k] + vo; io += a.length; }
    else { for (let k = 0; k < p.count; k++) idx[io + k] = vo + k; io += p.count; }
    vo += p.count;
    g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.setIndex(new T.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
// place a geometry: p = position, r = euler degrees, s = scale
function tf(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = new T.Matrix4().compose(new T.Vector3(...p), new T.Quaternion().setFromEuler(new T.Euler(r[0] * D, r[1] * D, r[2] * D)), new T.Vector3(...(Array.isArray(s) ? s : [s, s, s])));
  geo.applyMatrix4(m);
  return geo;
}
function tint(geo, hex) {
  const c = new T.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new T.BufferAttribute(a, 3));
  return geo;
}
const v3 = (a) => new T.Vector3(...a);

// rounded, tapered segment from a to b (lathe), radii r0 → r1, optional muscle bulge and
// elliptical cross-section (sx across, sz depth in the segment's own frame)
function seg(a, b, r0, r1, { bulge = 0, sx = 1, sz = 1, rs = 18, cap = 1 } = {}) {
  const A = v3(a), B = v3(b), dir = B.clone().sub(A), L = dir.length();
  const pts = [], n = 8;
  for (let i = 0; i <= 4; i++) { const t = -Math.PI / 2 + (i / 4) * (Math.PI / 2); pts.push(new T.Vector2(Math.max(1e-4, Math.cos(t) * r0), Math.sin(t) * r0 * cap)); }
  for (let i = 1; i < n; i++) { const t = i / n; pts.push(new T.Vector2((r0 + (r1 - r0) * t) * (1 + bulge * Math.sin(Math.PI * t)), t * L)); }
  for (let i = 0; i <= 4; i++) { const t = (i / 4) * (Math.PI / 2); pts.push(new T.Vector2(Math.max(1e-4, Math.cos(t) * r1), L + Math.sin(t) * r1 * cap)); }
  const g = new T.LatheGeometry(pts, rs);
  g.scale(sx, 1, sz);
  const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q); g.translate(A.x, A.y, A.z);
  return g;
}
// lathe from a profile [[radius, y], …] (around +Y), elliptical scale sx / sz
function lathe(prof, { sx = 1, sz = 1, rs = 24, p = [0, 0, 0] } = {}) {
  const g = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(Math.max(1e-4, r), y)), rs);
  g.scale(sx, 1, sz); g.translate(...p);
  return g;
}
// smooth rounded body part along +Y from y0 to y1: widths [[t, halfWidth], …] (t 0…1),
// domed ends (no flat caps), elliptical depth ratio, optional forward offset
function part(y0, y1, widths, { depth = 0.65, z = 0, rs = 28, n = 22, p = [0, 0, 0] } = {}) {
  const pts = [];
  const w = (t) => { for (let i = 1; i < widths.length; i++) if (t <= widths[i][0]) { const [ta, a] = widths[i - 1], [tb, bb] = widths[i]; const u = (t - ta) / (tb - ta || 1); return a + (bb - a) * (u * u * (3 - 2 * u)); } return widths[widths.length - 1][1]; };
  for (let i = 0; i <= n; i++) { const t = i / n, e = Math.pow(Math.max(0, 1 - Math.pow(2 * t - 1, 6)), 0.5); pts.push([Math.max(1e-4, w(t) * e), y0 + (y1 - y0) * t]); }
  const g = lathe(pts, { sz: depth, rs });
  g.translate(p[0], p[1], p[2] + z);
  return g;
}
const ball = (p, r, s = [1, 1, 1], ws = 16, hs = 12) => tf(new T.SphereGeometry(r, ws, hs), { p, s });
const box = (p, s, r = [0, 0, 0]) => tf(new T.BoxGeometry(1, 1, 1), { p, s, r });
const cyl = (p, rt, rb, h, r = [0, 0, 0], n = 24, open = false) => tf(new T.CylinderGeometry(rt, rb, h, n, 1, open), { p, r });

// Collects geometry per (joint, material) and turns each bin into ONE mesh at the end.
class Kit {
  constructor(joints, mats) { this.joints = joints; this.mats = mats; this.bins = new Map(); }
  add(joint, mat, geo) {
    const k = joint + '|' + mat;
    if (!this.bins.has(k)) this.bins.set(k, { joint, mat, geos: [] });
    this.bins.get(k).geos.push(geo);
  }
  finish() {
    for (const { joint, mat, geos } of this.bins.values()) {
      const m = new T.Mesh(merge(geos), this.mats[mat]);
      m.userData.joint = joint === '_root' ? null : joint;
      (this.joints[joint] || this.joints._root).add(m);
    }
  }
}
// joints from [name, parent, world position] — bind orientation is identity everywhere,
// so a joint's local rotation is simply its rotation relative to its parent
function makeJoints(spec, root) {
  const joints = { _root: root }, world = {};
  for (const [name, parent, wp] of spec) {
    const g = new T.Group(); g.name = name;
    world[name] = v3(wp);
    const pw = parent ? world[parent] : new T.Vector3();
    g.position.copy(world[name].clone().sub(pw));
    (parent ? joints[parent] : root).add(g);
    joints[name] = g;
    g.userData.base = g.position.clone();
  }
  // local coordinates of a world point for a joint
  const L = (name, p) => v3(p).sub(world[name]).toArray();
  return { joints, world, L };
}
function stdMat(color, o = {}) { return new T.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...o }); }

// ───────── drawing figure (female / male) ─────────
// Clip-Studio-like proportions; built in T-pose (arms along ±X, facing +Z), shown in an
// A-pose by default. H = height in metres; heads = head-to-body ratio; build 0 slim … 1 strong.
export const HUMAN_DEFAULT = { sex: 'female', height: 1.62, heads: 7.2, build: 0.4 };
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
export function humanJointNames() {
  const n = ['pelvis', 'spine', 'chest', 'neck', 'head'];
  for (const s of ['L', 'R']) {
    n.push('clav' + s, 'shoulder' + s, 'elbow' + s, 'hand' + s, 'hip' + s, 'knee' + s, 'foot' + s, 'toe' + s);
    for (const f of FINGERS) for (let k = 1; k <= 3; k++) n.push(f + s + k);
  }
  return n;
}

export function buildHuman(body = HUMAN_DEFAULT, color = '#c9c6c1') {
  const b = { ...HUMAN_DEFAULT, ...body };
  const F = b.sex === 'female', H = b.height, hd = H / b.heads, k = 0.85 + b.build * 0.35; // limb thickness
  const root = new T.Group();
  // ── skeleton (world positions in bind / T-pose) ──
  const hipY = H * 0.53, waistY = hipY + H * 0.07, chestY = waistY + H * 0.115, neckY = H - hd * 1.18, headY = neckY + hd * 0.22;
  const shW = F ? H * 0.105 : H * 0.122, hipW = F ? H * 0.062 : H * 0.056;
  const upArm = H * 0.17, foreArm = H * 0.145, handL = H * 0.105 * (F ? 0.93 : 1);
  const thigh = H * 0.245, shin = H * 0.245, ankleY = H * 0.04;
  const kneeY = hipY - thigh * 0.98, footLen = H * 0.15 * (F ? 0.94 : 1);
  const spec = [
    ['pelvis', null, [0, hipY, 0]],
    ['spine', 'pelvis', [0, waistY, 0]],
    ['chest', 'spine', [0, chestY, 0]],
    ['neck', 'chest', [0, neckY, -0.01]],
    ['head', 'neck', [0, headY, 0]],
  ];
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    const shY = neckY - H * 0.035;
    spec.push(
      ['clav' + s, 'chest', [x * H * 0.012, shY - H * 0.01, 0]],
      ['shoulder' + s, 'clav' + s, [x * shW, shY, -0.005]],
      ['elbow' + s, 'shoulder' + s, [x * (shW + upArm), shY, -0.005]],
      ['hand' + s, 'elbow' + s, [x * (shW + upArm + foreArm), shY, 0]],
      ['hip' + s, 'pelvis', [x * hipW, hipY - H * 0.035, 0]],
      ['knee' + s, 'hip' + s, [x * hipW * 0.96, kneeY, 0.008]],
      ['foot' + s, 'knee' + s, [x * hipW * 0.94, ankleY, -0.005]],
      ['toe' + s, 'foot' + s, [x * hipW * 0.98, ankleY * 0.45, footLen * 0.68]],
    );
    // fingers: palm faces down (-Y) in T-pose, fingers point out along ±X
    const hx = x * (shW + upArm + foreArm), palm = handL * 0.48, fl = handL * 0.52;
    const lay = { thumb: [palm * 0.22, 0.42, -0.012, 0.6], index: [palm, 0.32, 0, 0.96], middle: [palm * 1.02, 0.11, 0, 1.04], ring: [palm * 0.97, -0.1, 0, 0.98], pinky: [palm * 0.9, -0.3, 0, 0.8] };
    for (const f of FINGERS) {
      const [px, z, dy, len] = lay[f];
      const base = [hx + x * px, shY + dy - H * 0.004, z * handL * 0.42];
      const L1 = fl * len * (f === 'thumb' ? 0.62 : 0.45), L2 = fl * len * 0.32, dirz = f === 'thumb' ? 0.55 : 0;
      spec.push([f + s + 1, 'hand' + s, base]);
      spec.push([f + s + 2, f + s + 1, [base[0] + x * L1, base[1], base[2] + dirz * L1]]);
      spec.push([f + s + 3, f + s + 2, [base[0] + x * (L1 + L2), base[1], base[2] + dirz * (L1 + L2)]]);
    }
  }
  const { joints, world, L } = makeJoints(spec, root);
  const W = (n) => world[n].toArray();
  const mats = { skin: stdMat(color, { roughness: 0.78 }) };
  const kit = new Kit(joints, mats);

  // ── head: cranium, jaw, nose, ears (egg-shaped like CSP's figure) ──
  const hr = hd * 0.43, hc = [0, headY + hd * 0.47, 0.004];
  kit.add('head', 'skin', ball(L('head', hc), hr, [0.86, 1.08, 1.0], 28, 20));
  kit.add('head', 'skin', ball(L('head', [0, hc[1] - hd * 0.24, hr * 0.14]), hr * 0.7, [0.9 * (F ? 0.92 : 1.02), 0.74, 0.92], 20, 14));
  kit.add('head', 'skin', tf(new T.ConeGeometry(hr * 0.12, hr * 0.32, 10), { p: L('head', [0, hc[1] - hd * 0.07, hr * 0.95]), r: [100, 0, 0], s: [1, 1, 0.75] }));
  for (const x of [1, -1]) kit.add('head', 'skin', ball(L('head', [x * hr * 0.86, hc[1] - hd * 0.05, -hr * 0.05]), hr * 0.17, [0.45, 1, 0.75], 10, 8));
  kit.add('neck', 'skin', seg(L('neck', [0, neckY - hd * 0.12, -0.005]), L('neck', [0, headY + hd * 0.18, 0]), hd * (F ? 0.21 : 0.25), hd * (F ? 0.19 : 0.23), { rs: 16 }));

  // ── torso: ribcage (with bust / pecs), abdomen, pelvis — overlapping domed parts ──
  const Hc = (v) => v * H;
  const rib = F ? [[0, Hc(0.066)], [0.35, Hc(0.077)], [0.72, Hc(0.081)], [0.9, Hc(0.07)], [1, Hc(0.04)]] : [[0, Hc(0.075)], [0.35, Hc(0.092)], [0.72, Hc(0.101)], [0.9, Hc(0.088)], [1, Hc(0.05)]];
  kit.add('chest', 'skin', part(chestY - Hc(0.04), neckY + Hc(0.012), rib, { depth: F ? 0.6 : 0.62, p: L('chest', [0, 0, -Hc(0.004)]) }));
  if (F) for (const x of [1, -1]) kit.add('chest', 'skin', ball(L('chest', [x * Hc(0.036), chestY + Hc(0.062), Hc(0.03)]), Hc(0.036), [1, 0.95, 0.9], 18, 14));
  else for (const x of [1, -1]) kit.add('chest', 'skin', ball(L('chest', [x * Hc(0.04), chestY + Hc(0.083), Hc(0.034)]), Hc(0.046), [1.2, 0.62, 0.36], 16, 12));
  const ab = F ? [[0, Hc(0.07)], [0.45, Hc(0.058)], [1, Hc(0.066)]] : [[0, Hc(0.075)], [0.45, Hc(0.07)], [1, Hc(0.074)]];
  kit.add('spine', 'skin', part(waistY - Hc(0.05), chestY + Hc(0.03), ab, { depth: F ? 0.72 : 0.7, p: L('spine', [0, 0, 0]) }));
  const pv = F ? [[0, Hc(0.05)], [0.3, Hc(0.094)], [0.62, Hc(0.092)], [1, Hc(0.066)]] : [[0, Hc(0.048)], [0.3, Hc(0.084)], [0.62, Hc(0.082)], [1, Hc(0.072)]];
  kit.add('pelvis', 'skin', part(hipY - Hc(0.095), waistY + Hc(0.02), pv, { depth: F ? 0.68 : 0.66, p: L('pelvis', [0, 0, -Hc(0.004)]) }));
  for (const x of [1, -1]) kit.add('pelvis', 'skin', ball(L('pelvis', [x * Hc(0.04), hipY - Hc(0.04), -Hc(0.036)]), Hc(F ? 0.05 : 0.045), [1, 1, 0.85], 14, 10));

  // ── arms ──
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    const sh = W('shoulder' + s), el = W('elbow' + s), ha = W('hand' + s);
    kit.add('clav' + s, 'skin', ball(L('clav' + s, [sh[0] - x * H * 0.01, sh[1] - H * 0.005, sh[2]]), H * (F ? 0.04 : 0.05), [1.25, 0.95, 1.05]));
    kit.add('shoulder' + s, 'skin', seg(L('shoulder' + s, sh), L('shoulder' + s, el), H * 0.032 * k * (F ? 0.92 : 1), H * 0.024 * k, { bulge: 0.12 * k, sx: 1, sz: 1.05 }));
    kit.add('elbow' + s, 'skin', seg(L('elbow' + s, el), L('elbow' + s, ha), H * 0.025 * k, H * 0.018 * k, { bulge: 0.1 * k, sx: 0.85, sz: 1.1 }));
    // palm: rounded slab, palm down
    const pc = [ha[0] + x * handL * 0.23, ha[1] - H * 0.002, 0];
    kit.add('hand' + s, 'skin', tf(new T.SphereGeometry(1, 18, 12), { p: L('hand' + s, pc), s: [handL * 0.3, H * 0.012, handL * 0.22] }));
    for (const f of FINGERS) {
      const r = H * (f === 'thumb' ? 0.0085 : f === 'pinky' ? 0.0062 : 0.0072) * (F ? 0.92 : 1);
      for (let n = 1; n <= 3; n++) {
        const a = W(f + s + n), bb = n < 3 ? W(f + s + (n + 1)) : (() => { const p = v3(W(f + s + 3)), q = v3(W(f + s + 2)); return p.clone().add(p.clone().sub(q).multiplyScalar(0.8)).toArray(); })();
        kit.add(f + s + n, 'skin', seg(L(f + s + n, a), L(f + s + n, bb), r * (1.05 - n * 0.06), r * (0.98 - n * 0.08), { rs: 10 }));
      }
    }
  }
  // ── legs ──
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    const hp = W('hip' + s), kn = W('knee' + s), ft = W('foot' + s), to = W('toe' + s);
    kit.add('hip' + s, 'skin', seg(L('hip' + s, [hp[0] * 1.02, hp[1] + H * 0.01, hp[2]]), L('hip' + s, kn), H * (F ? 0.055 : 0.052) * k, H * 0.032 * k, { bulge: 0.08, sz: 1.05 }));
    kit.add('knee' + s, 'skin', seg(L('knee' + s, kn), L('knee' + s, ft), H * 0.033 * k, H * 0.021 * k, { bulge: 0.14 * k, sz: 1.12 }));
    // foot: heel → ball, toes on their own joint
    const heel = [ft[0], ft[1] - ankleY * 0.45, ft[2] - footLen * 0.17];
    kit.add('foot' + s, 'skin', seg(L('foot' + s, heel), L('foot' + s, [to[0], to[1] - ankleY * 0.05, to[2]]), H * 0.022, H * 0.024, { sx: 1.25, sz: 0.62, rs: 14 }));
    kit.add('foot' + s, 'skin', ball(L('foot' + s, ft), H * 0.022, [1.05, 1, 1.1]));
    kit.add('toe' + s, 'skin', seg(L('toe' + s, to), L('toe' + s, [to[0], to[1] - ankleY * 0.08, to[2] + footLen * 0.27]), H * 0.023, H * 0.017, { sx: 1.3, sz: 0.55, rs: 12 }));
  }
  kit.finish();
  return { root, joints, mat: mats.skin, world, H };
}

// A-pose shown when a joint has no pose value (local euler degrees)
export const HUMAN_REST = (() => {
  const r = { shoulderL: [0, 0, -62], shoulderR: [0, 0, 62], elbowL: [0, -12, 0], elbowR: [0, 12, 0], handL: [0, 0, -6], handR: [0, 0, 6] };
  for (const s of ['L', 'R']) {
    const x = s === 'L' ? 1 : -1;
    for (const f of FINGERS) {
      if (f === 'thumb') { r['thumb' + s + 1] = [0, -x * 10, 0]; r['thumb' + s + 2] = [0, 0, -x * 8]; continue; }
      const c = { index: 8, middle: 12, ring: 15, pinky: 18 }[f];
      r[f + s + 1] = [0, 0, -x * c]; r[f + s + 2] = [0, 0, -x * c * 1.3]; r[f + s + 3] = [0, 0, -x * c];
    }
  }
  return r;
})();

// ───────── poses ─────────
// Local euler angles in degrees (three.js XYZ order) relative to the T-pose bind:
// facing +Z, the figure's left is +X. Left arm: down −Z, up +Z, forward −Y. Right arm mirrored.
// Elbows bend forward with −Y (left) / +Y (right); X at the elbow twists the bend plane.
// Hips: forward −X, out +Z (left) / −Z (right). Knees bend +X. Feet: toes down +X.
// Spine / chest / neck / head: forward +X, turn to the left +Y, lean to the left −Z.
// $root = pelvis offset in units of the figure's height (crouch, sit, jump…).
export function mirrorPose(def) {
  const out = {};
  for (const [k, v] of Object.entries(def)) {
    if (k === '$root') { out[k] = [-v[0], v[1], v[2]]; continue; }
    const m = k.match(/^(.*?)(L|R)(\d?)$/);
    const name = m && /^(clav|shoulder|elbow|hand|hip|knee|foot|toe|thumb|index|middle|ring|pinky)$/.test(m[1]) ? m[1] + (m[2] === 'L' ? 'R' : 'L') + m[3] : k;
    out[name] = [v[0], -v[1], -v[2]];
  }
  return out;
}
const sym = (left, extra = {}) => ({ ...left, ...mirrorPose(Object.fromEntries(Object.entries(left).filter(([k]) => /L\d?$/.test(k)))), ...extra });

// hand shapes (left hand values; the right hand is mirrored)
const curl = (a, b, c) => ({ 1: [0, 0, -a], 2: [0, 0, -b], 3: [0, 0, -c] });
const handShape = (fingers, thumb) => {
  const o = {};
  for (const [f, c] of Object.entries(fingers)) for (const n of [1, 2, 3]) o[f + 'L' + n] = c[n];
  for (const n of [1, 2, 3]) o['thumbL' + n] = thumb[n - 1];
  return o;
};
const FIST = curl(80, 100, 65), STRAIGHT = curl(0, 0, 0), SOFT = curl(10, 14, 10);
export const HAND_SHAPES = {
  Relaxed: null,
  Fist: handShape({ index: FIST, middle: FIST, ring: FIST, pinky: FIST }, [[-35, -10, -20], [0, 0, -35], [0, 0, -30]]),
  Open: handShape({ index: STRAIGHT, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT }, [[0, -25, 0], [0, 0, 0], [0, 0, 0]]),
  Point: handShape({ index: STRAIGHT, middle: FIST, ring: FIST, pinky: FIST }, [[-35, -10, -20], [0, 0, -35], [0, 0, -30]]),
  Peace: handShape({ index: { 1: [0, 10, 0], 2: [0, 0, 0], 3: [0, 0, 0] }, middle: { 1: [0, -8, 0], 2: [0, 0, 0], 3: [0, 0, 0] }, ring: FIST, pinky: FIST }, [[-35, -10, -20], [0, 0, -35], [0, 0, -30]]),
  'Thumbs up': handShape({ index: FIST, middle: FIST, ring: FIST, pinky: FIST }, [[0, -30, 50], [0, 0, 10], [0, 0, 0]]),
  Grip: handShape({ index: curl(60, 70, 40), middle: curl(65, 75, 45), ring: curl(70, 75, 45), pinky: curl(72, 75, 45) }, [[-40, -15, -10], [0, 0, -20], [0, 0, -20]]),
  Claw: handShape({ index: curl(25, 50, 45), middle: curl(25, 50, 45), ring: curl(25, 50, 45), pinky: curl(25, 50, 45) }, [[-10, -20, -10], [0, 0, -25], [0, 0, -25]]),
};
export function handPose(shape, side = 'both') {
  const h = HAND_SHAPES[shape];
  const out = {};
  const keys = h ? h : Object.fromEntries(Object.entries(HUMAN_REST).filter(([k]) => /^(thumb|index|middle|ring|pinky)L/.test(k)));
  if (side !== 'R') Object.assign(out, keys);
  if (side !== 'L') Object.assign(out, mirrorPose(keys));
  return out;
}
const fists = () => handPose('Fist'), grips = () => handPose('Grip');

export const HUMAN_POSES = {
  Standing: {
    'Relaxed': {},
    'T-pose': { shoulderL: [0, 0, 0], shoulderR: [0, 0, 0], elbowL: [0, 0, 0], elbowR: [0, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], ...handPose('Open') },
    'Contrapposto': { pelvis: [0, 0, 5], spine: [0, 0, -3], chest: [0, 0, -4], neck: [0, 0, 2], head: [3, -10, 4], hipL: [-3, 0, 3], hipR: [-12, 0, -2], kneeR: [16, 0, 0], footR: [-4, 0, 0], shoulderL: [0, 8, -70], shoulderR: [0, -4, 66], elbowL: [0, -10, 0], elbowR: [0, 22, 0], $root: [0, -0.004, 0] },
    'Hands on hips': sym({ shoulderL: [0, 22, -46], elbowL: [0, 0, -105], handL: [0, 0, -15] }, { chest: [-4, 0, 0], head: [-3, 0, 0], ...fists() }),
    'Arms crossed': sym({ shoulderL: [0, -16, -76], elbowL: [72, -112, 0], handL: [0, 0, -4] }, { chest: [-2, 0, 0], head: [4, 0, 0], hipL: [-2, 0, 4], hipR: [-2, 0, -4] }),
    'Thinking': { shoulderR: [0, 22, 64], elbowR: [-20, 142, 0], handR: [0, 0, 30], shoulderL: [0, -26, -72], elbowL: [78, -96, 0], head: [12, 8, -6], neck: [6, 0, 0], ...handPose('Fist', 'R') },
    'Looking back': { spine: [0, 18, 0], chest: [0, 40, 0], neck: [0, 30, 0], head: [-4, 34, 0], shoulderL: [0, 14, -66], shoulderR: [0, -10, 64], elbowR: [0, 18, 0], hipR: [-8, 0, 0], kneeR: [10, 0, 0] },
    'Waving': { shoulderL: [0, -12, 42], elbowL: [0, 0, 72], handL: [0, 0, 5], ...handPose('Open', 'L'), head: [0, 8, -4], chest: [0, 0, -3] },
    'Pointing': { shoulderR: [0, 82, 4], elbowR: [0, 6, 0], ...handPose('Point', 'R'), chest: [0, 14, 0], head: [0, -10, 0] },
    'Hero stance': sym({ shoulderL: [0, 24, -50], elbowL: [0, 0, -100], hipL: [-2, 0, 9], footL: [0, 0, -6] }, { chest: [-8, 0, 0], head: [-6, 0, 0], ...fists() }),
    'Hands behind back': sym({ shoulderL: [0, 26, -76], elbowL: [135, -88, 0], handL: [0, 0, -10] }, { chest: [-6, 0, 0], head: [-2, 0, 0] }),
    'Leaning (legs crossed)': { pelvis: [0, 0, 4], hipR: [-6, 0, 12], kneeR: [8, 0, 0], footR: [20, 0, 0], hipL: [0, 0, 4], ...sym({ shoulderL: [0, -16, -76], elbowL: [72, -112, 0] }), spine: [-4, 0, -2], head: [2, 12, 0] },
  },
  Action: {
    'Walking': { hipL: [-22, 0, 0], kneeL: [6, 0, 0], hipR: [18, 0, 0], kneeR: [26, 0, 0], footR: [-6, 0, 0], shoulderL: [0, 20, -78], elbowL: [0, -14, 0], shoulderR: [0, 22, 78], elbowR: [0, 30, 0], spine: [3, 6, 0], chest: [0, -10, 0] },
    'Running': { pelvis: [8, 0, 0], spine: [8, 8, 0], chest: [4, -14, 0], head: [-14, 4, 0], hipL: [-62, 0, 0], kneeL: [78, 0, 0], footL: [10, 0, 0], hipR: [24, 0, 0], kneeR: [100, 0, 0], footR: [30, 0, 0], shoulderL: [0, 48, -72], elbowL: [0, -95, 0], shoulderR: [0, 58, 72], elbowR: [0, 100, 0], ...fists(), $root: [0, -0.02, 0] },
    'Sprint': { pelvis: [16, 0, 0], spine: [14, 10, 0], chest: [6, -16, 0], head: [-26, 4, 0], hipL: [-80, 0, 0], kneeL: [100, 0, 0], hipR: [30, 0, 0], kneeR: [70, 0, 0], footR: [40, 0, 0], shoulderL: [0, 70, -72], elbowL: [0, -100, 0], shoulderR: [0, 75, 70], elbowR: [0, 105, 0], ...handPose('Open'), $root: [0, -0.035, 0] },
    'Jumping': { shoulderL: [0, -10, 55], shoulderR: [0, 10, -55], elbowL: [0, 0, 15], elbowR: [0, 0, -15], hipL: [-35, 0, 6], kneeL: [70, 0, 0], hipR: [-8, 0, -6], kneeR: [95, 0, 0], footL: [30, 0, 0], footR: [35, 0, 0], head: [-12, 0, 0], chest: [-8, 0, 0], ...handPose('Open'), $root: [0, 0.14, 0] },
    'Hero landing': { pelvis: [14, 0, 0], spine: [30, 0, 0], chest: [16, 0, 0], neck: [-12, 0, 0], head: [-36, 0, 0], hipL: [-100, 0, 10], kneeL: [100, 0, 0], footL: [-14, 0, 0], hipR: [24, 0, -10], kneeR: [72, 0, 0], footR: [52, 0, 0], shoulderR: [0, 30, 82], elbowR: [0, 4, 0], shoulderL: [0, 52, -22], elbowL: [0, -8, 0], ...fists(), $root: [0, -0.245, 0] },
    'Fighting stance': { pelvis: [0, -30, 0], chest: [0, 10, 0], head: [6, 18, 0], hipL: [-28, 0, 10], kneeL: [30, 0, 0], hipR: [12, 0, -12], kneeR: [24, 0, 0], footR: [-8, 0, 0], shoulderL: [0, -48, -66], elbowL: [0, -128, 0], shoulderR: [0, 36, 70], elbowR: [0, 138, 0], ...fists(), $root: [0, -0.035, 0] },
    'Punch': { pelvis: [0, 18, 0], spine: [0, 12, 0], chest: [4, 26, 0], head: [6, -22, 0], hipL: [-30, 0, 8], kneeL: [28, 0, 0], hipR: [16, 0, -8], kneeR: [12, 0, 0], shoulderR: [0, 86, 6], elbowR: [0, 4, 0], shoulderL: [0, -52, -62], elbowL: [0, -128, 0], ...fists(), $root: [0, -0.035, 0] },
    'High kick': { pelvis: [-10, 0, -6], spine: [-14, 0, 6], chest: [-6, 0, 0], head: [16, 0, 0], hipL: [-108, 0, 12], kneeL: [6, 0, 0], footL: [30, 0, 0], hipR: [4, 0, -4], kneeR: [8, 0, 0], shoulderL: [0, 18, -18], shoulderR: [0, -30, 40], elbowL: [0, -40, 0], elbowR: [0, 60, 0], ...fists() },
    'Sword overhead': { chest: [-12, 0, 0], head: [6, 0, 0], shoulderL: [0, -46, 70], elbowL: [0, -36, 0], shoulderR: [0, 46, -70], elbowR: [0, 36, 0], hipL: [-30, 0, 4], kneeL: [26, 0, 0], hipR: [18, 0, -4], kneeR: [14, 0, 0], ...grips(), $root: [0, -0.03, 0] },
    'Sword guard': { ...sym({ shoulderL: [0, -24, -74], elbowL: [58, -76, 0], handL: [0, 0, 10] }), pelvis: [0, -16, 0], chest: [6, 10, 0], head: [8, 6, 0], hipL: [-30, 0, 8], kneeL: [32, 0, 0], hipR: [14, 0, -10], kneeR: [24, 0, 0], ...grips(), $root: [0, -0.04, 0] },
    'Archer': { pelvis: [0, 70, 0], chest: [0, 10, 0], head: [0, 0, 0], neck: [0, 0, 0], shoulderL: [0, -86, 0], elbowL: [0, -4, 0], shoulderR: [0, 92, 4], elbowR: [0, 150, 0], hipL: [0, 0, 14], hipR: [0, 0, -14], ...handPose('Grip', 'L'), ...handPose('Claw', 'R') },
    'Throwing': { pelvis: [0, -24, 0], chest: [-8, -30, 0], head: [0, 26, 0], shoulderR: [0, -40, -62], elbowR: [0, 92, 0], shoulderL: [0, -78, -14], elbowL: [0, -10, 0], hipL: [-32, 0, 10], kneeL: [20, 0, 0], hipR: [14, 0, -10], kneeR: [12, 0, 0], ...handPose('Fist', 'R'), ...handPose('Open', 'L') },
    'Falling': { pelvis: [-18, 0, 0], spine: [-12, 0, 0], head: [20, 0, 0], shoulderL: [0, 10, 108], elbowL: [0, -30, 30], shoulderR: [0, -20, -86], elbowR: [0, 40, -20], hipL: [-50, 0, 10], kneeL: [70, 0, 0], hipR: [-20, 0, -14], kneeR: [30, 0, 0], ...handPose('Open'), $root: [0, 0.18, 0] },
    'Flying': { pelvis: [82, 0, 0], head: [-62, 0, 0], neck: [-12, 0, 0], shoulderR: [0, 0, -168], elbowR: [0, 0, 0], shoulderL: [0, 12, -78], hipL: [-6, 0, 3], hipR: [10, 0, -3], kneeR: [24, 0, 0], footL: [40, 0, 0], footR: [40, 0, 0], ...handPose('Fist', 'R'), $root: [0, 0.32, 0] },
    'Crouching': { spine: [30, 0, 0], chest: [10, 0, 0], head: [-26, 0, 0], ...sym({ hipL: [-112, 0, 14], kneeL: [134, 0, 0], footL: [-22, 0, 0], shoulderL: [0, -50, -58], elbowL: [0, -40, 0] }), $root: [0, -0.28, 0] },
    'Dodge (lean back)': { pelvis: [-12, 0, 0], spine: [-24, 0, 0], chest: [-22, 0, 0], head: [10, 0, 0], hipL: [-30, 0, 8], kneeL: [60, 0, 0], hipR: [-20, 0, -8], kneeR: [70, 0, 0], shoulderL: [0, 30, -30], shoulderR: [0, -30, 30], ...handPose('Open'), $root: [0, -0.07, -0.03] },
  },
  'Sitting & floor': {
    'Sitting (chair)': sym({ hipL: [-90, 0, 3], kneeL: [90, 0, 0], shoulderL: [0, -30, -76], elbowL: [0, -52, 0] }, { spine: [4, 0, 0], $root: [0, -0.268, 0] }),
    'Sitting relaxed': { hipL: [-84, 0, 6], kneeL: [70, 0, 0], hipR: [-96, 0, -4], kneeR: [100, 0, 0], spine: [-6, 0, 0], chest: [-4, 0, 0], head: [6, 10, 0], shoulderL: [0, 20, -70], elbowL: [0, -20, 0], shoulderR: [0, -24, 70], elbowR: [0, 60, 0], $root: [0, -0.268, 0] },
    'Cross-legged (floor)': { hipL: [-72, -38, 42], kneeL: [138, 0, 0], footL: [10, 0, 0], hipR: [-72, 38, -42], kneeR: [138, 0, 0], footR: [10, 0, 0], spine: [10, 0, 0], ...sym({ shoulderL: [0, -32, -70], elbowL: [0, -30, 0] }), $root: [0, -0.44, 0] },
    'Kneeling': sym({ kneeL: [90, 0, 0], footL: [62, 0, 0], shoulderL: [0, -10, -72], elbowL: [0, -20, 0] }, { $root: [0, -0.262, 0] }),
    'One knee down': { hipL: [-90, 0, 4], kneeL: [90, 0, 0], hipR: [2, 0, -2], kneeR: [90, 0, 0], footR: [60, 0, 0], spine: [8, 0, 0], shoulderL: [0, -40, -70], elbowL: [0, -40, 0], shoulderR: [0, 0, 72], $root: [0, -0.262, 0] },
    'Hugging knees': { spine: [34, 0, 0], chest: [16, 0, 0], head: [-10, 0, 0], ...sym({ hipL: [-128, 0, 4], kneeL: [148, 0, 0], footL: [-10, 0, 0], shoulderL: [0, -64, -64], elbowL: [64, -70, 0] }), $root: [0, -0.44, 0] },
    'Lying on back': { pelvis: [-90, 0, 0], head: [6, 0, 0], ...sym({ shoulderL: [0, 0, -78], elbowL: [0, -6, 0] }), hipR: [-12, 0, 0], kneeR: [30, 0, 0], footL: [20, 0, 0], footR: [20, 0, 0], $root: [0, -0.43, 0.02] },
    'Lying on side': { pelvis: [0, 0, -90], head: [0, 0, 20], neck: [0, 0, 10], shoulderR: [0, 30, 0], elbowR: [0, 120, 0], shoulderL: [0, -10, -70], hipL: [-30, 0, 0], kneeL: [40, 0, 0], hipR: [-10, 0, 0], kneeR: [20, 0, 0], $root: [0.0, -0.44, 0] },
  },
  Expressive: {
    'Victory': sym({ shoulderL: [0, -8, 58], elbowL: [0, 0, 10] }, { head: [-12, 0, 0], chest: [-6, 0, 0], ...fists() }),
    'Shrug': sym({ clavL: [0, 0, 12], shoulderL: [0, -22, -66], elbowL: [-60, -84, 0] }, { head: [0, 0, 10], ...handPose('Open') }),
    'Stretching': sym({ shoulderL: [0, 0, 84], elbowL: [0, 0, 6] }, { spine: [-8, 0, 0], chest: [-6, 0, 0], head: [-14, 0, 0], ...handPose('Open') }),
    'Dancing': { pelvis: [0, 0, 9], spine: [0, 0, -6], chest: [0, 10, -6], head: [0, -16, 8], shoulderL: [0, 0, 112], elbowL: [0, 0, 38], shoulderR: [0, 30, 34], elbowR: [0, 60, 0], hipR: [-34, 0, -10], kneeR: [46, 0, 0], footR: [30, 0, 0], ...handPose('Open') },
    'Shy': { head: [16, -14, 6], neck: [6, 0, 0], ...sym({ shoulderL: [0, -18, -78], elbowL: [74, -86, 0] }), hipL: [-6, 0, -6], hipR: [-6, 0, 6], kneeL: [12, 0, 0], kneeR: [12, 0, 0] },
    'Salute': { shoulderR: [0, 40, -24], elbowR: [-60, 130, 0], ...handPose('Open', 'R'), chest: [-4, 0, 0] },
  },
  Other: {
    'Riding (motorcycle)': { hipL: [-62, 0, 14], kneeL: [100, 0, 0], footL: [20, 0, 0], hipR: [-62, 0, -14], kneeR: [100, 0, 0], footR: [20, 0, 0], spine: [34, 0, 0], chest: [10, 0, 0], head: [-36, 0, 0], ...sym({ shoulderL: [0, -62, -42], elbowL: [0, -26, 0] }), ...grips(), $root: [0, -0.16, 0] },
    'Driving (car)': { hipL: [-80, 0, 6], kneeL: [70, 0, 0], footL: [20, 0, 0], hipR: [-80, 0, -6], kneeR: [70, 0, 0], footR: [20, 0, 0], spine: [-10, 0, 0], ...sym({ shoulderL: [0, -58, -40], elbowL: [0, -50, 0] }), ...grips(), $root: [0, -0.3, 0] },
  },
};
// degrees → stored pose (quaternions + $root)
export function poseFromDegrees(def) {
  const out = {};
  for (const [k, v] of Object.entries(def)) {
    if (k === '$root') { out.$root = v.slice(); continue; }
    out[k] = new T.Quaternion().setFromEuler(new T.Euler(v[0] * D, v[1] * D, v[2] * D)).toArray();
  }
  return out;
}
// apply a stored pose to a joint map; joints without a value get the rest pose
export function applyPose(joints, pose, rest = HUMAN_REST, H = 1.7) {
  for (const [name, j] of Object.entries(joints)) {
    if (name === '_root') continue;
    const q = pose[name];
    if (q) j.quaternion.set(q[0], q[1], q[2], q[3]);
    else { const e = rest[name] || [0, 0, 0]; j.quaternion.setFromEuler(new T.Euler(e[0] * D, e[1] * D, e[2] * D)); }
  }
  const root = joints.pelvis || joints.d_hip;
  if (root && root.userData.base) {
    const r = pose.$root || [0, 0, 0];
    root.position.copy(root.userData.base).add(new T.Vector3(r[0] * H, r[1] * H, r[2] * H));
  }
}
// mirror an existing stored pose (left ↔ right)
export function mirrorStored(pose) {
  const out = {};
  for (const [k, q] of Object.entries(pose)) {
    if (k === '$root') { out[k] = [-q[0], q[1], q[2]]; continue; }
    const m = k.match(/^(.*?)(L|R)(\d?)$/);
    const name = m && /^(clav|shoulder|elbow|hand|hip|knee|foot|toe|thumb|index|middle|ring|pinky)$/.test(m[1]) ? m[1] + (m[2] === 'L' ? 'R' : 'L') + m[3] : k;
    out[name] = [q[0], -q[1], -q[2], q[3]]; // reflect across the YZ plane
  }
  return out;
}

// ───────── dragon (posable) ─────────
export function buildDragon(color = '#7f8a84') {
  const root = new T.Group();
  const spec = [['d_hip', null, [0, 1.55, -0.6]], ['d_chest', 'd_hip', [0, 1.75, 0.9]]];
  // neck: 5 links rising forward, then head + jaw
  let p = [0, 2.0, 1.55];
  spec.push(['d_neck1', 'd_chest', p]);
  for (let i = 2; i <= 5; i++) { p = [0, p[1] + 0.32, p[2] + 0.3]; spec.push(['d_neck' + i, 'd_neck' + (i - 1), p]); }
  const headP = [0, p[1] + 0.3, p[2] + 0.28];
  spec.push(['d_head', 'd_neck5', headP], ['d_jaw', 'd_head', [0, headP[1] - 0.12, headP[2] + 0.1]]);
  // tail: 8 links tapering back and down
  p = [0, 1.45, -1.5];
  spec.push(['d_tail1', 'd_hip', p]);
  for (let i = 2; i <= 8; i++) { p = [0, p[1] - 0.07, p[2] - 0.55]; spec.push(['d_tail' + i, 'd_tail' + (i - 1), p]); }
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    spec.push(
      ['d_arm' + s, 'd_chest', [x * 0.5, 1.55, 0.95]], ['d_fore' + s, 'd_arm' + s, [x * 0.62, 0.85, 1.15]], ['d_hand' + s, 'd_fore' + s, [x * 0.62, 0.12, 1.2]],
      ['d_thigh' + s, 'd_hip', [x * 0.55, 1.4, -0.6]], ['d_shin' + s, 'd_thigh' + s, [x * 0.66, 0.75, -0.2]], ['d_foot' + s, 'd_shin' + s, [x * 0.62, 0.14, -0.62]],
      ['d_wing' + s, 'd_chest', [x * 0.35, 2.15, 0.65]], ['d_wingb' + s, 'd_wing' + s, [x * 1.9, 2.75, 0.25]], ['d_wingc' + s, 'd_wingb' + s, [x * 3.4, 2.25, -0.5]],
    );
  }
  const { joints, world, L } = makeJoints(spec, root);
  const W = (n) => world[n].toArray();
  const mats = { body: stdMat(color, { roughness: 0.66 }), belly: stdMat(new T.Color(color).lerp(new T.Color('#e9dcc0'), 0.45), { roughness: 0.7 }), horn: stdMat('#d9d2c2', { roughness: 0.5 }), wing: stdMat(new T.Color(color).multiplyScalar(0.8), { roughness: 0.8, side: T.DoubleSide }), eye: stdMat('#ffcf3a', { emissive: '#ff9a00', emissiveIntensity: 0.6 }) };
  const kit = new Kit(joints, mats);
  // body: chest → hips
  kit.add('d_chest', 'body', tf(seg([0, 0, 0], [0, 0, 1], 0.55, 0.62, { bulge: 0.18, sx: 1, sz: 1.05 }), { p: L('d_chest', [0, 1.72, -0.25]), s: [1.05, 1.25, 1] }));
  kit.add('d_hip', 'body', tf(seg([0, 0, 0], [0, 0, 1], 0.42, 0.56, { bulge: 0.1 }), { p: L('d_hip', [0, 1.5, -1.6]), s: [1, 1.15, 1.25] }));
  kit.add('d_chest', 'belly', tf(seg([0, 0, 0], [0, 0, 1], 0.38, 0.46, { bulge: 0.15 }), { p: L('d_chest', [0, 1.42, -0.5]), s: [1.1, 0.8, 1.6] }));
  const chain = (names, r0, r1, spikes) => names.forEach((n, i) => {
    const a = W(n), b = i < names.length - 1 ? W(names[i + 1]) : null;
    const r = r0 + (r1 - r0) * (i / Math.max(1, names.length - 1)), rn = r0 + (r1 - r0) * ((i + 1) / Math.max(1, names.length - 1));
    if (b) kit.add(n, 'body', seg(L(n, a), L(n, b), r, rn, { sx: 1, sz: 0.95 }));
    if (spikes && b) kit.add(n, 'horn', tf(new T.ConeGeometry(r * 0.35, r * 0.9, 6), { p: L(n, [a[0], a[1] + r * 1.05, a[2]]), r: [-20, 0, 0] }));
  });
  chain(['d_neck1', 'd_neck2', 'd_neck3', 'd_neck4', 'd_neck5', 'd_head'], 0.3, 0.2, true);
  chain(['d_tail1', 'd_tail2', 'd_tail3', 'd_tail4', 'd_tail5', 'd_tail6', 'd_tail7', 'd_tail8'], 0.36, 0.06, true);
  const tt = W('d_tail8');
  kit.add('d_tail8', 'horn', tf(new T.ConeGeometry(0.16, 0.55, 4), { p: L('d_tail8', [tt[0], tt[1] - 0.03, tt[2] - 0.3]), r: [-90, 0, 0], s: [1.5, 1, 0.25] }));
  for (let i = 0; i < 5; i++) kit.add('d_chest', 'horn', tf(new T.ConeGeometry(0.1, 0.32, 6), { p: L('d_chest', [0, 2.38 - i * 0.08, 0.8 - i * 0.45]), r: [-25, 0, 0] }));
  for (let i = 0; i < 3; i++) kit.add('d_hip', 'horn', tf(new T.ConeGeometry(0.09, 0.28, 6), { p: L('d_hip', [0, 2.05 - i * 0.06, -0.5 - i * 0.45]), r: [-25, 0, 0] }));
  // head: skull, snout, brow ridges, horns, eyes, nostrils; jaw on its own joint
  const hp = W('d_head');
  kit.add('d_head', 'body', ball(L('d_head', [0, hp[1] + 0.05, hp[2] + 0.05]), 0.3, [0.95, 0.8, 1.1], 20, 14));
  kit.add('d_head', 'body', tf(seg([0, 0, 0], [0, 0, 1], 0.2, 0.13, {}), { p: L('d_head', [0, hp[1], hp[2] + 0.12]), s: [1.05, 0.75, 0.75] }));
  for (const x of [1, -1]) {
    kit.add('d_head', 'body', ball(L('d_head', [x * 0.15, hp[1] + 0.17, hp[2] + 0.25]), 0.08, [1, 0.6, 1.6], 12, 8));
    kit.add('d_head', 'eye', ball(L('d_head', [x * 0.19, hp[1] + 0.11, hp[2] + 0.27]), 0.045, [0.6, 0.8, 1], 10, 8));
    const horn = new T.TubeGeometry(new T.CatmullRomCurve3([v3([x * 0.14, hp[1] + 0.2, hp[2] - 0.1]), v3([x * 0.22, hp[1] + 0.36, hp[2] - 0.38]), v3([x * 0.24, hp[1] + 0.42, hp[2] - 0.72])]), 10, 0.05, 8);
    const pos = horn.attributes.position; // taper the tube to a point
    for (let i = 0; i < pos.count; i++) { const t = Math.floor(i / 9) / 10; const c = new T.Vector3().fromBufferAttribute(pos, i); const axis = new T.Vector3(x * 0.2, hp[1] + 0.33, hp[2] - 0.4); c.lerp(axis.setX(c.x), 0); c.x = x * 0.14 + (c.x - x * 0.14); pos.setXYZ(i, ...c.toArray()); void t; }
    kit.add('d_head', 'horn', tf(horn, { p: L('d_head', [0, 0, 0]) }));
    kit.add('d_head', 'horn', tf(new T.ConeGeometry(0.05, 0.22, 6), { p: L('d_head', [x * 0.24, hp[1] + 0.42, hp[2] - 0.82]), r: [-100, 0, 0] }));
  }
  kit.add('d_jaw', 'belly', tf(seg([0, 0, 0], [0, 0, 1], 0.16, 0.1, {}), { p: L('d_jaw', [0, hp[1] - 0.12, hp[2] + 0.02]), s: [1, 0.55, 0.62] }));
  for (const x of [1, -1]) for (let i = 0; i < 4; i++) kit.add('d_jaw', 'horn', tf(new T.ConeGeometry(0.018, 0.07, 5), { p: L('d_jaw', [x * 0.085, hp[1] - 0.05, hp[2] + 0.24 + i * 0.09]) }));
  // legs + claws
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    kit.add('d_arm' + s, 'body', seg(L('d_arm' + s, W('d_arm' + s)), L('d_arm' + s, W('d_fore' + s)), 0.24, 0.17, { bulge: 0.15 }));
    kit.add('d_fore' + s, 'body', seg(L('d_fore' + s, W('d_fore' + s)), L('d_fore' + s, W('d_hand' + s)), 0.15, 0.11));
    kit.add('d_thigh' + s, 'body', seg(L('d_thigh' + s, W('d_thigh' + s)), L('d_thigh' + s, W('d_shin' + s)), 0.36, 0.22, { bulge: 0.2 }));
    kit.add('d_shin' + s, 'body', seg(L('d_shin' + s, W('d_shin' + s)), L('d_shin' + s, W('d_foot' + s)), 0.19, 0.12));
    for (const [j, sz] of [['d_hand' + s, 0.11], ['d_foot' + s, 0.14]]) {
      const f = W(j);
      kit.add(j, 'body', ball(L(j, [f[0], f[1] - 0.04, f[2] + sz * 0.6]), sz * 1.2, [1, 0.55, 1.4], 12, 8));
      for (const k of [-1, 0, 1]) kit.add(j, 'horn', tf(new T.ConeGeometry(sz * 0.18, sz * 0.75, 6), { p: L(j, [f[0] + k * sz * 0.55, f[1] - 0.06, f[2] + sz * 1.9]), r: [80, 0, 0] }));
    }
    // wings: bones + membrane panels (fan from each bone, so folding still reads)
    const w0 = W('d_wing' + s), w1 = W('d_wingb' + s), w2 = W('d_wingc' + s);
    kit.add('d_wing' + s, 'body', seg(L('d_wing' + s, w0), L('d_wing' + s, w1), 0.12, 0.08));
    kit.add('d_wingb' + s, 'body', seg(L('d_wingb' + s, w1), L('d_wingb' + s, w2), 0.08, 0.05));
    const tips = [[x * 4.6, 1.2, -1.6], [x * 3.6, 0.85, -2.3], [x * 2.3, 0.9, -2.4], [x * 1.0, 1.35, -1.9]];
    for (const tpt of tips) kit.add('d_wingc' + s, 'horn', seg(L('d_wingc' + s, w2), L('d_wingc' + s, tpt), 0.045, 0.015, { rs: 8 }));
    const fan = (joint, pts) => {
      const g = new T.BufferGeometry(), arr = [];
      for (let i = 1; i < pts.length - 1; i++) arr.push(...L(joint, pts[0]), ...L(joint, pts[i]), ...L(joint, pts[i + 1]));
      g.setAttribute('position', new T.Float32BufferAttribute(arr, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(new Array(arr.length / 3 * 2).fill(0), 2));
      g.computeVertexNormals(); return g;
    };
    kit.add('d_wing' + s, 'wing', fan('d_wing' + s, [w0, w1, [x * 1.7, 1.75, -0.7], [x * 0.9, 1.8, -1.25], [x * 0.3, 1.95, -0.6]]));
    kit.add('d_wingc' + s, 'wing', fan('d_wingc' + s, [w2, ...tips, [x * 1.7, 1.75, -0.7], w1]));
  }
  kit.finish();
  return { root, joints, mat: mats.body, world, H: 1 };
}
export const DRAGON_POSES = {
  Standing: {},
  Roaring: { d_chest: [-12, 0, 0], d_neck1: [-15, 0, 0], d_neck2: [-10, 0, 0], d_neck3: [-8, 0, 0], d_neck4: [10, 0, 0], d_neck5: [20, 0, 0], d_head: [-25, 0, 0], d_jaw: [40, 0, 0], d_wingL: [0, 0, 25], d_wingR: [0, 0, -25], d_wingbL: [0, 20, 10], d_wingbR: [0, -20, -10], d_tail2: [0, 10, 0], d_tail4: [0, 15, 0], d_tail6: [0, 15, 0] },
  Flying: { d_wingL: [0, 0, 40], d_wingR: [0, 0, -40], d_wingbL: [0, 10, -20], d_wingbR: [0, -10, 20], d_armL: [40, 0, 0], d_armR: [40, 0, 0], d_foreL: [-70, 0, 0], d_foreR: [-70, 0, 0], d_thighL: [50, 0, 0], d_thighR: [50, 0, 0], d_shinL: [-30, 0, 0], d_shinR: [-30, 0, 0], d_neck1: [10, 0, 0], d_neck2: [10, 0, 0], d_head: [10, 0, 0], d_tail1: [5, 0, 0], $root: [0, 1.6, 0] },
  'Wings folded': { d_wingL: [0, 40, -35], d_wingR: [0, -40, 35], d_wingbL: [0, 70, -40], d_wingbR: [0, -70, 40], d_wingcL: [0, 40, -30], d_wingcR: [0, -40, 30] },
  Perched: { d_hip: [-35, 0, 0], d_chest: [-20, 0, 0], d_neck1: [30, 0, 0], d_neck3: [10, 0, 0], d_head: [25, 0, 0], d_thighL: [-30, 0, 0], d_thighR: [-30, 0, 0], d_shinL: [40, 0, 0], d_shinR: [40, 0, 0], d_armL: [10, 0, 0], d_armR: [10, 0, 0], d_wingL: [0, 30, -20], d_wingR: [0, -30, 20], d_wingbL: [0, 60, -30], d_wingbR: [0, -60, 30], d_tail1: [20, 0, 0], d_tail3: [0, 25, 0], d_tail5: [0, 30, 0], $root: [0, -0.35, 0] },
  Curled: { d_neck1: [10, 40, 0], d_neck2: [5, 30, 0], d_neck3: [5, 30, 0], d_head: [20, 20, 0], d_tail1: [0, -30, 0], d_tail2: [0, -30, 0], d_tail3: [0, -35, 0], d_tail4: [0, -35, 0], d_tail5: [0, -30, 0], d_wingL: [0, 40, -35], d_wingR: [0, -40, 35], d_wingbL: [0, 70, -40], d_wingbR: [0, -70, 40], d_thighL: [-60, 0, 0], d_thighR: [-60, 0, 0], d_shinL: [90, 0, 0], d_shinR: [90, 0, 0], d_armL: [-40, 0, 0], d_armR: [-40, 0, 0], d_foreL: [60, 0, 0], d_foreR: [60, 0, 0], $root: [0, -0.7, 0] },
};
export const DRAGON_REST = { d_neck1: [-18, 0, 0], d_neck2: [-8, 0, 0], d_neck3: [8, 0, 0], d_neck4: [22, 0, 0], d_neck5: [22, 0, 0], d_head: [18, 0, 0], d_tail1: [8, 0, 0], d_tail2: [4, 6, 0], d_tail3: [0, 8, 0], d_tail4: [-4, 10, 0], d_tail5: [-4, 10, 0], d_tail6: [0, 8, 0] };

// ───────── armour (fits a drawing figure, moves with its pose) ─────────
export function buildArmor(fig, style = 'medieval') {
  const { joints, world, H } = fig;
  const W = (n) => world[n].toArray();
  const L = (n, p) => v3(p).sub(world[n]).toArray();
  const sci = style === 'scifi';
  const mats = sci
    ? { plate: stdMat('#e9edf1', { roughness: 0.32, metalness: 0.15 }), dark: stdMat('#2b2f36', { roughness: 0.55 }), glow: stdMat('#5ff3ff', { emissive: '#22d8ff', emissiveIntensity: 1.4, roughness: 0.3 }) }
    : { plate: stdMat('#c4c9cf', { roughness: 0.38, metalness: 0.45 }), dark: stdMat('#5b4634', { roughness: 0.85 }), glow: stdMat('#1a1a1a', { roughness: 0.9 }) };
  const kit = new Kit(joints, mats);
  const hc = (v) => v * H;
  const head = W('head'), chest = W('chest'), spine = W('spine'), pel = W('pelvis'), neck = W('neck');
  // helmet
  if (sci) {
    kit.add('head', 'plate', ball(L('head', [0, head[1] + hc(0.068), 0]), hc(0.07), [0.92, 1.05, 1.08], 24, 18));
    kit.add('head', 'glow', tf(new T.CylinderGeometry(hc(0.064), hc(0.06), hc(0.022), 24, 1, true, -1.2, 2.4), { p: L('head', [0, head[1] + hc(0.07), hc(0.006)]), s: [0.98, 1, 1.12] }));
    kit.add('head', 'dark', ball(L('head', [0, head[1] + hc(0.03), hc(0.03)]), hc(0.052), [0.95, 0.7, 0.9], 18, 12));
    for (const x of [1, -1]) kit.add('head', 'plate', box(L('head', [x * hc(0.064), head[1] + hc(0.075), -hc(0.01)]), [hc(0.012), hc(0.05), hc(0.05)], [0, 0, x * 8]));
  } else {
    kit.add('head', 'plate', cyl(L('head', [0, head[1] + hc(0.06), 0]), hc(0.064), hc(0.067), hc(0.11), [0, 0, 0], 28));
    kit.add('head', 'plate', ball(L('head', [0, head[1] + hc(0.113), 0]), hc(0.065), [1, 0.55, 1], 24, 12));
    kit.add('head', 'glow', box(L('head', [0, head[1] + hc(0.075), hc(0.064)]), [hc(0.09), hc(0.011), hc(0.012)]));
    kit.add('head', 'plate', box(L('head', [0, head[1] + hc(0.05), hc(0.066)]), [hc(0.012), hc(0.05), hc(0.01)]));
    kit.add('head', 'dark', tf(new T.ConeGeometry(hc(0.012), hc(0.06), 8), { p: L('head', [0, head[1] + hc(0.16), 0]) }));
  }
  // gorget + breastplate + backplate
  kit.add('neck', 'plate', cyl(L('neck', [0, neck[1] + hc(0.01), -hc(0.004)]), hc(0.036), hc(0.05), hc(0.04), [0, 0, 0], 24));
  const rib = [[0, hc(0.08)], [0.35, hc(0.094)], [0.72, hc(0.1)], [0.9, hc(0.09)], [1, hc(0.055)]];
  kit.add('chest', 'plate', part(chest[1] - hc(0.045), neck[1] + hc(0.008), rib.map(([t, w]) => [t, w * (sci ? 1.06 : 1.1)]), { depth: 0.66, p: L('chest', [0, 0, 0]) }));
  if (sci) {
    kit.add('chest', 'glow', box(L('chest', [0, chest[1] + hc(0.065), hc(0.064)]), [hc(0.025), hc(0.025), hc(0.006)], [0, 0, 45]));
    for (const x of [1, -1]) kit.add('chest', 'dark', box(L('chest', [x * hc(0.045), chest[1] + hc(0.03), hc(0.06)]), [hc(0.04), hc(0.006), hc(0.01)], [0, 0, x * -20]));
  } else for (let i = 0; i < 3; i++) kit.add('chest', 'dark', box(L('chest', [0, chest[1] - hc(0.02) + i * hc(0.004), -hc(0.055)]), [hc(0.16), hc(0.006), hc(0.004)]));
  kit.add('spine', 'plate', part(spine[1] - hc(0.04), chest[1] + hc(0.02), [[0, hc(0.082)], [0.5, hc(0.078)], [1, hc(0.086)]], { depth: 0.72, p: L('spine', [0, 0, 0]) }));
  if (!sci) for (let i = 0; i < 3; i++) kit.add('spine', 'plate', cyl(L('spine', [0, spine[1] - hc(0.03) + i * hc(0.022), 0]), hc(0.087), hc(0.09), hc(0.012), [0, 0, 0], 28));
  kit.add('spine', 'dark', cyl(L('spine', [0, spine[1] - hc(0.05), 0]), hc(0.086), hc(0.086), hc(0.016), [0, 0, 0], 28));
  // tassets / hip plates
  for (const x of [1, -1]) {
    kit.add('pelvis', 'plate', box(L('pelvis', [x * hc(0.06), pel[1] - hc(0.03), hc(0.04)]), [hc(0.07), hc(0.075), hc(0.012)], [10, 0, x * -10]));
    kit.add('pelvis', 'plate', box(L('pelvis', [x * hc(0.088), pel[1] - hc(0.025), 0]), [hc(0.012), hc(0.07), hc(0.09)], [0, 0, x * 10]));
  }
  kit.add('pelvis', 'plate', box(L('pelvis', [0, pel[1] - hc(0.035), -hc(0.055)]), [hc(0.15), hc(0.07), hc(0.012)], [-10, 0, 0]));
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    const sh = W('shoulder' + s), el = W('elbow' + s), ha = W('hand' + s), hp = W('hip' + s), kn = W('knee' + s), ft = W('foot' + s), to = W('toe' + s);
    // pauldrons (layered on the shoulder), rerebrace, couter, vambrace, gauntlet
    if (sci) {
      kit.add('clav' + s, 'plate', tf(new T.SphereGeometry(hc(0.06), 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), { p: L('clav' + s, [sh[0] + x * hc(0.005), sh[1] + hc(0.008), sh[2]]), s: [1.15, 0.9, 1.05], r: [0, 0, -x * 18] }));
      kit.add('clav' + s, 'glow', box(L('clav' + s, [sh[0] + x * hc(0.04), sh[1] + hc(0.02), sh[2]]), [hc(0.03), hc(0.004), hc(0.05)], [0, 0, -x * 35]));
    } else for (let i = 0; i < 3; i++) kit.add('clav' + s, 'plate', tf(new T.SphereGeometry(hc(0.062 - i * 0.004), 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), { p: L('clav' + s, [sh[0] + x * hc(0.012 + i * 0.016), sh[1] + hc(0.006 - i * 0.01), sh[2]]), s: [1.1, 0.75, 1.1], r: [0, 0, -x * (25 + i * 12)] }));
    kit.add('shoulder' + s, 'plate', seg(L('shoulder' + s, [sh[0] + x * hc(0.05), sh[1], sh[2]]), L('shoulder' + s, el), hc(0.036), hc(0.031), { rs: 16 }));
    kit.add('elbow' + s, 'plate', ball(L('elbow' + s, el), hc(0.033), [1, 1, 1.1], 14, 10));
    kit.add('elbow' + s, 'plate', seg(L('elbow' + s, [el[0] + x * hc(0.02), el[1], el[2]]), L('elbow' + s, [ha[0] - x * hc(0.012), ha[1], ha[2]]), hc(0.029), hc(0.025), { rs: 16, sx: 0.9 }));
    if (sci) kit.add('elbow' + s, 'glow', box(L('elbow' + s, [(el[0] + ha[0]) / 2, el[1] + hc(0.027), el[2]]), [hc(0.07), hc(0.004), hc(0.008)]));
    kit.add('hand' + s, sci ? 'dark' : 'plate', tf(new T.SphereGeometry(1, 14, 10), { p: L('hand' + s, [ha[0] + x * hc(0.025), ha[1] + hc(0.004), 0]), s: [hc(0.035), hc(0.015), hc(0.028)] }));
    // cuisse, poleyn, greave, sabaton
    kit.add('hip' + s, 'plate', seg(L('hip' + s, [hp[0], hp[1] - hc(0.02), hp[2]]), L('hip' + s, [kn[0], kn[1] + hc(0.03), kn[2]]), hc(0.06), hc(0.042), { rs: 18, sz: 1.08 }));
    kit.add('knee' + s, 'plate', ball(L('knee' + s, [kn[0], kn[1], kn[2] + hc(0.018)]), hc(0.038), [1, 1.15, 0.8], 14, 10));
    if (!sci) kit.add('knee' + s, 'plate', tf(new T.ConeGeometry(hc(0.012), hc(0.03), 6), { p: L('knee' + s, [kn[0], kn[1], kn[2] + hc(0.05)]), r: [90, 0, 0] }));
    kit.add('knee' + s, 'plate', seg(L('knee' + s, [kn[0], kn[1] - hc(0.03), kn[2]]), L('knee' + s, [ft[0], ft[1] + hc(0.015), ft[2]]), hc(0.04), hc(0.03), { rs: 18, sz: 1.15, bulge: 0.1 }));
    if (sci) kit.add('knee' + s, 'glow', box(L('knee' + s, [kn[0], (kn[1] + ft[1]) / 2, kn[2] + hc(0.04)]), [hc(0.006), hc(0.09), hc(0.004)]));
    kit.add('foot' + s, 'plate', seg(L('foot' + s, [ft[0], ft[1] - hc(0.02), ft[2] - hc(0.03)]), L('foot' + s, [to[0], to[1] - hc(0.005), to[2]]), hc(0.03), hc(0.028), { sx: 1.25, sz: 0.7, rs: 14 }));
    kit.add('toe' + s, 'plate', seg(L('toe' + s, to), L('toe' + s, [to[0], to[1] - hc(0.006), to[2] + hc(0.04)]), hc(0.027), hc(0.02), { sx: 1.3, sz: 0.6, rs: 12 }));
  }
  kit.finish();
}

// ───────── vehicles ─────────
function wheel(kit, joint, p, r, w, mats, spokes = 5) {
  kit.add(joint, 'tire', cyl(p, r, r, w, [0, 0, 90], 32));
  kit.add(joint, 'tire', tf(new T.TorusGeometry(r * 0.86, r * 0.16, 10, 32), { p: [p[0] + w / 2 * Math.sign(p[0] || 1), p[1], p[2]], r: [0, 90, 0] }));
  kit.add(joint, 'rim', cyl([p[0] + Math.sign(p[0] || 1) * w * 0.32, p[1], p[2]], r * 0.66, r * 0.66, w * 0.3, [0, 0, 90], 28));
  for (let i = 0; i < spokes; i++) kit.add(joint, 'tire', box([p[0] + Math.sign(p[0] || 1) * w * 0.49, p[1], p[2]], [0.01, r * 1.1, r * 0.12], [i * 180 / spokes, 0, 0]));
}
export function buildCar(style = 'sedan', color = '#3d6fd6') {
  const root = new T.Group(), joints = { _root: root };
  const mats = { paint: stdMat(color, { roughness: 0.28, metalness: 0.35 }), glass: stdMat('#26313d', { roughness: 0.08, metalness: 0.4 }), tire: stdMat('#1b1b1d', { roughness: 0.9 }), rim: stdMat('#c9ccd1', { roughness: 0.3, metalness: 0.7 }), light: stdMat('#fff6d8', { emissive: '#fff1c2', emissiveIntensity: 0.6 }), red: stdMat('#d42a2a', { emissive: '#a00', emissiveIntensity: 0.4 }), trim: stdMat('#2a2c30', { roughness: 0.6 }) };
  const kit = new Kit(joints, mats);
  const sport = style === 'sports';
  const Lh = sport ? 4.4 : 4.7, Wd = sport ? 1.92 : 1.82, wr = sport ? 0.34 : 0.33, hz = Lh / 2, belt = sport ? 0.86 : 0.98;
  const extrudeX = (pts, width, bevel, mat, inset = 0) => {
    const sh = new T.Shape(); sh.moveTo(...pts[0]); for (const q of pts.slice(1)) sh.lineTo(...q); sh.closePath();
    const g = new T.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4, curveSegments: 16 });
    g.rotateY(Math.PI / 2); g.translate(-(width - bevel * 2) / 2 + inset, 0, 0);
    kit.add('_root', mat, g);
  };
  // lower body up to the belt line, with wheel arches cut in
  const lower = new T.Shape();
  const nose = sport ? [[hz, 0.3], [hz + 0.05, 0.52], [hz - 0.35, belt - 0.02]] : [[hz, 0.3], [hz + 0.02, 0.66], [hz - 0.15, belt - 0.04]];
  const tail = sport ? [[-hz + 0.2, belt + 0.02], [-hz, 0.7], [-hz, 0.32]] : [[-hz + 0.1, belt], [-hz, 0.8], [-hz, 0.32]];
  lower.moveTo(-hz, 0.32);
  for (const az of [-hz + 0.85, hz - 0.85]) { lower.lineTo(az - wr * 1.2, 0.3); lower.absarc(az, 0.33, wr * 1.2, Math.PI, 0, true); }
  for (const q of nose) lower.lineTo(...q);
  for (const q of tail) lower.lineTo(...q);
  const lg = new T.ExtrudeGeometry(lower, { depth: Wd - 0.18, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.08, bevelSegments: 5, curveSegments: 20 });
  lg.rotateY(Math.PI / 2); lg.translate(-(Wd - 0.18) / 2, 0, 0);
  kit.add('_root', 'paint', lg);
  // glass cabin + painted roof
  const cab = sport ? [[-0.95, belt], [-0.45, 1.16], [0.3, 1.18], [0.95, belt]] : [[-1.25, belt], [-0.85, 1.4], [0.55, 1.42], [1.15, belt]];
  extrudeX(cab, Wd - 0.22, 0.05, 'glass');
  const roof = [[cab[1][0] - 0.05, cab[1][1] - 0.02], [cab[1][0] + 0.02, cab[1][1] + 0.05], [cab[2][0] - 0.02, cab[2][1] + 0.05], [cab[2][0] + 0.06, cab[2][1] - 0.02]];
  extrudeX(roof, Wd - 0.2, 0.04, 'paint');
  // pillars (A, B, C) on both sides
  for (const x of [1, -1]) {
    const px = x * ((Wd - 0.22) / 2 + 0.005);
    const pill = (a, b2) => { const A = v3([px, ...a.slice().reverse()]), B = v3([px, ...b2.slice().reverse()]); kit.add('_root', 'paint', seg([px, a[1], a[0]], [px, b2[1], b2[0]], 0.035, 0.035, { rs: 8 })); void A; void B; };
    pill(cab[0], cab[1]); pill(cab[3], cab[2]);
    if (!sport) pill([(cab[0][0] + cab[3][0]) / 2 - 0.05, belt], [(cab[1][0] + cab[2][0]) / 2 - 0.05, cab[1][1]]);
    kit.add('_root', 'trim', box([x * (Wd / 2 + 0.06), belt + 0.06, cab[3][0] - 0.12], [0.12, 0.07, 0.16]));
    kit.add('_root', 'light', box([x * (Wd / 2 - 0.32), sport ? 0.6 : 0.78, hz + 0.04], [0.44, 0.1, 0.06]));
    kit.add('_root', 'red', box([x * (Wd / 2 - 0.28), sport ? 0.68 : 0.82, -hz - 0.05], [0.42, 0.09, 0.06]));
    for (const wz of [-hz + 0.85, hz - 0.85]) wheel(kit, '_root', [x * (Wd / 2 - 0.13), wr, wz], wr, 0.24, mats);
  }
  kit.add('_root', 'trim', box([0, sport ? 0.42 : 0.52, hz + 0.08], [Wd * 0.5, sport ? 0.1 : 0.18, 0.05]));
  kit.add('_root', 'trim', box([0, 0.34, hz + 0.07], [Wd - 0.12, 0.1, 0.08]));
  kit.add('_root', 'trim', box([0, 0.34, -hz - 0.07], [Wd - 0.12, 0.1, 0.08]));
  if (sport) { kit.add('_root', 'paint', box([0, 1.0, -hz + 0.22], [Wd - 0.3, 0.035, 0.3], [6, 0, 0])); for (const x of [0.6, -0.6]) kit.add('_root', 'trim', box([x, 0.92, -hz + 0.26], [0.05, 0.14, 0.08])); }
  kit.finish();
  return { root, joints: null, mat: mats.paint };
}
export function buildMotorcycle(color = '#c72c2c') {
  const root = new T.Group(), joints = { _root: root };
  const mats = { paint: stdMat(color, { roughness: 0.25, metalness: 0.3 }), tire: stdMat('#19191b', { roughness: 0.9 }), rim: stdMat('#2d2f33', { roughness: 0.4, metalness: 0.6 }), chrome: stdMat('#dfe3e8', { roughness: 0.15, metalness: 0.9 }), seat: stdMat('#222', { roughness: 0.8 }), light: stdMat('#fff6d8', { emissive: '#fff1c2', emissiveIntensity: 0.7 }), glass: stdMat('#2a3440', { roughness: 0.1, transparent: true, opacity: 0.7 }) };
  const kit = new Kit(joints, mats);
  const wr = 0.31, fz = 0.72, rz = -0.72;
  for (const z of [fz, rz]) {
    kit.add('_root', 'tire', tf(new T.TorusGeometry(wr - 0.06, 0.065, 12, 36), { p: [0, wr, z], r: [0, 90, 0] }));
    kit.add('_root', 'rim', cyl([0, wr, z], wr - 0.11, wr - 0.11, 0.05, [0, 0, 90], 30));
    kit.add('_root', 'chrome', cyl([0.06, wr, z], 0.13, 0.13, 0.012, [0, 0, 90], 24));
  }
  const tube = (pts, r, mat = 'chrome') => kit.add('_root', mat, new T.TubeGeometry(new T.CatmullRomCurve3(pts.map((q) => v3(q))), 24, r, 10));
  for (const x of [0.07, -0.07]) tube([[x, wr, fz], [x, 0.7, fz - 0.2], [x, 0.98, fz - 0.33]], 0.022);
  tube([[0, 0.9, 0.36], [0, 0.6, -0.1], [0, 0.42, rz + 0.2], [0, wr, rz]], 0.03, 'rim');
  tube([[0, 0.9, 0.36], [0, 0.72, 0.1], [0, 0.85, -0.45]], 0.028, 'rim');
  for (const x of [0.07, -0.07]) tube([[x, wr, rz], [x, 0.42, -0.25], [x, 0.38, 0.0]], 0.02, 'rim');
  kit.add('_root', 'paint', ball([0, 0.95, 0.12], 0.24, [0.85, 0.62, 1.45], 22, 14)); // tank
  kit.add('_root', 'seat', tf(seg([0, 0, 0], [0, 0, 1], 0.12, 0.1), { p: [0, 0.88, -0.62], s: [1.25, 0.55, 0.62] }));
  kit.add('_root', 'paint', tf(seg([0, 0, 0], [0, 0, 1], 0.13, 0.05), { p: [0, 0.9, -0.92], s: [1, 0.6, 0.6], r: [-12, 0, 0] }));
  kit.add('_root', 'paint', tf(seg([0, 0, 0], [0, 0, 1], 0.17, 0.05, { rs: 18 }), { p: [0, 0.86, 0.42], s: [0.9, 0.85, 0.48], r: [-8, 0, 0] })); // pointed front fairing
  kit.add('_root', 'glass', tf(new T.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), { p: [0, 0.98, 0.5], s: [0.85, 1, 0.65], r: [-50, 0, 0] }));
  kit.add('_root', 'light', ball([0, 0.84, 0.88], 0.055, [1.5, 0.75, 0.45]));
  kit.add('_root', 'rim', box([0, 0.55, -0.05], [0.26, 0.3, 0.42])); // engine block
  for (let i = 0; i < 4; i++) kit.add('_root', 'chrome', box([0, 0.55 + i * 0.06 - 0.09, 0.17], [0.28, 0.02, 0.06]));
  tube([[0.12, 0.42, 0.05], [0.16, 0.36, -0.35], [0.17, 0.5, -0.9]], 0.04);
  kit.add('_root', 'chrome', cyl([0.17, 0.52, -0.92], 0.055, 0.045, 0.3, [-80, 0, 0], 16));
  tube([[-0.34, 1.02, 0.28], [0, 1.0, 0.32], [0.34, 1.02, 0.28]], 0.016);
  for (const x of [0.34, -0.34]) kit.add('_root', 'seat', cyl([x * 1.05, 1.02, 0.28], 0.022, 0.022, 0.1, [0, 0, 90], 10));
  kit.add('_root', 'paint', tf(new T.TorusGeometry(wr + 0.03, 0.04, 8, 24, Math.PI * 0.55), { p: [0, wr, fz], r: [0, 90, 50], s: [1, 1, 2.2] })); // mudguard
  kit.finish();
  return { root, joints: null, mat: mats.paint };
}

// ───────── buildings ─────────
// seeded random so a scene rebuilds identically after reloading
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const texCache = new Map();
function canvasTex(key, w, h, draw, repeat = true) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
  t.anisotropy = 4; texCache.set(key, t); return t;
}
// facade: 8 × 8 windows per tile, a few lit; tile = 8 floors / 8 bays
const facadeTex = () => canvasTex('facade', 256, 256, (x, w, h) => {
  const r = rng(7); x.fillStyle = '#d9d6d0'; x.fillRect(0, 0, w, h);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const lit = r() < 0.18; x.fillStyle = lit ? '#f4e2a4' : r() < 0.5 ? '#4a5866' : '#5d6b78';
    x.fillRect(i * 32 + 6, j * 32 + 7, 20, 19);
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(i * 32 + 6, j * 32 + 24, 20, 2);
  }
});
const stoneTex = () => canvasTex('stone', 256, 256, (x, w, h) => {
  const r = rng(3); x.fillStyle = '#bdb6aa'; x.fillRect(0, 0, w, h);
  for (let j = 0; j < 8; j++) for (let i = -1; i < 5; i++) {
    const off = (j % 2) * 32, g = 170 + Math.floor(r() * 40);
    x.fillStyle = `rgb(${g},${g - 6},${g - 16})`; x.fillRect(i * 64 + off + 2, j * 32 + 2, 60, 28);
  }
});
const roadTex = () => canvasTex('road', 128, 128, (x, w, h) => {
  x.fillStyle = '#4a4c50'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#e8e2c8'; for (let j = 0; j < 4; j++) x.fillRect(w / 2 - 3, j * 32 + 4, 6, 18);
});
// a box whose side UVs tile with its real size (tile = `cell` metres)
function uvBox(p, s, cellX, cellY, roofUV = [0.01, 0.01]) {
  const g = box(p, s), uv = g.attributes.uv;
  const faceW = [s[2], s[2], s[0], s[0], s[0], s[0]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    if (f === 2 || f === 3) { uv.setXY(i, roofUV[0], roofUV[1]); continue; }
    uv.setXY(i, uv.getX(i) * faceW[f] / cellX, uv.getY(i) * s[1] / cellY);
  }
  return g;
}
function uvCyl(p, r, h, cell, n = 28) {
  const g = cyl(p, r, r, h, [0, 0, 0], n), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / cell, uv.getY(i) * h / cell);
  return g;
}

export function buildCastle(seed = 1) {
  const root = new T.Group(), joints = { _root: root };
  const st = stoneTex();
  const mats = { stone: stdMat('#ffffff', { map: st, roughness: 0.9 }), roof: stdMat('#5b3a33', { roughness: 0.75 }), wood: stdMat('#6b4b2f', { roughness: 0.9 }), dark: stdMat('#2a2724', { roughness: 1 }), flag: stdMat('#b8222b', { roughness: 0.8, side: T.DoubleSide }), ground: stdMat('#8e9a77', { roughness: 1 }) };
  const kit = new Kit(joints, mats);
  const S = 26, wallH = 8, wallT = 2.2;
  const crenel = (x0, z0, x1, z1, y) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.6));
    for (let i = 0; i <= n; i += 1) if (i % 2 === 0) { const t = i / n; kit.add('_root', 'stone', uvBox([x0 + (x1 - x0) * t, y + 0.55, z0 + (z1 - z0) * t], [x0 === x1 ? wallT + 0.2 : 0.9, 1.1, z0 === z1 ? wallT + 0.2 : 0.9], 4, 4)); }
  };
  // curtain walls
  for (const [x0, z0, x1, z1] of [[-S / 2, -S / 2, S / 2, -S / 2], [-S / 2, S / 2, -2.6, S / 2], [2.6, S / 2, S / 2, S / 2], [-S / 2, -S / 2, -S / 2, S / 2], [S / 2, -S / 2, S / 2, S / 2]]) {
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = z0 === z1;
    kit.add('_root', 'stone', uvBox([cx, wallH / 2, cz], alongX ? [len, wallH, wallT] : [wallT, wallH, len], 4, 4));
    crenel(x0, z0, x1, z1, wallH);
  }
  // gatehouse with an arched opening
  const gate = new T.Shape(); gate.moveTo(-4.2, 0); gate.lineTo(4.2, 0); gate.lineTo(4.2, wallH + 3); gate.lineTo(-4.2, wallH + 3); gate.lineTo(-4.2, 0);
  const arch = new T.Path(); arch.moveTo(-1.8, 0); arch.lineTo(-1.8, 3.4); arch.absarc(0, 3.4, 1.8, Math.PI, 0, true); arch.lineTo(1.8, 0); gate.holes.push(arch);
  const gg = new T.ExtrudeGeometry(gate, { depth: 3.4, bevelEnabled: false, curveSegments: 14 }); gg.translate(0, 0, S / 2 - 1.7);
  const guv = gg.attributes.uv; for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) / 4, guv.getY(i) / 4);
  kit.add('_root', 'stone', gg);
  kit.add('_root', 'wood', box([0, 2.6, S / 2 + 0.2], [3.4, 5.2, 0.25]));
  crenel(-4.2, S / 2 + 1.7, 4.2, S / 2 + 1.7, wallH + 3);
  // round corner towers with conical roofs
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = x * S / 2, tz = z * S / 2, r = 3.1, h = 13;
    kit.add('_root', 'stone', uvCyl([tx, h / 2, tz], r, h, 4));
    kit.add('_root', 'stone', uvCyl([tx, h + 0.4, tz], r + 0.35, 0.8, 4));
    kit.add('_root', 'roof', tf(new T.ConeGeometry(r + 0.6, 6.5, 24), { p: [tx, h + 0.8 + 3.25, tz] }));
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; kit.add('_root', 'dark', box([tx + Math.cos(a) * (r + 0.02), h * 0.62, tz + Math.sin(a) * (r + 0.02)], [0.35, 1.3, 0.35])); }
    kit.add('_root', 'wood', cyl([tx, h + 7.9, tz], 0.06, 0.06, 2.2, [0, 0, 0], 8));
    kit.add('_root', 'flag', box([tx + 0.6, h + 8.5, tz], [1.2, 0.7, 0.02]));
  }
  // keep: tall square tower with its own turrets
  kit.add('_root', 'stone', uvBox([0, 9, -3], [10, 18, 10], 4, 4));
  crenel(-5, -8, 5, -8, 18); crenel(-5, 2, 5, 2, 18); crenel(-5, -8, -5, 2, 18); crenel(5, -8, 5, 2, 18);
  for (let i = 0; i < 3; i++) for (const x of [-2.6, 0, 2.6]) kit.add('_root', 'dark', box([x, 6 + i * 4.2, 2.02], [0.7, 1.6, 0.1]));
  for (const [x, z] of [[-5, -8], [5, -8], [-5, 2], [5, 2]]) { kit.add('_root', 'stone', uvCyl([x, 20, z], 1.2, 4, 4, 18)); kit.add('_root', 'roof', tf(new T.ConeGeometry(1.5, 3.2, 18), { p: [x, 23.6, z] })); }
  kit.add('_root', 'dark', box([0, 1.6, 2.05], [2.2, 3.2, 0.1]));
  kit.add('_root', 'ground', tf(new T.CircleGeometry(36, 48), { r: [-90, 0, 0], p: [0, 0.01, 0] }));
  kit.finish();
  return { root, joints: null, mat: mats.stone };
}

export function buildCity(kind = 'street', seed = 11) {
  const root = new T.Group(), joints = { _root: root };
  const r = rng(seed);
  const mats = { facade: stdMat('#ffffff', { map: facadeTex(), roughness: 0.85, vertexColors: true }), road: stdMat('#ffffff', { map: roadTex(), roughness: 0.95 }), walk: stdMat('#b9b6ae', { roughness: 0.95 }), roof: stdMat('#8f8c86', { roughness: 0.9 }), dark: stdMat('#3a3d42', { roughness: 0.8 }), pole: stdMat('#5b5f66', { roughness: 0.5, metalness: 0.4 }), tree: stdMat('#5f8a4a', { roughness: 0.9 }), trunk: stdMat('#6a4c34', { roughness: 0.9 }) };
  const kit = new Kit(joints, mats);
  const tints = ['#ffffff', '#efe4d2', '#d8dde3', '#e9d5c3', '#cfd6cc', '#f2e8dc', '#c9c3bb'];
  const building = (x, z, w, d, h) => {
    const g = uvBox([x, h / 2, z], [w, h, d], 3.2 * 8, 3.4 * 8, [0.005, 0.005]);
    tint(g, tints[Math.floor(r() * tints.length)]);
    kit.add('_root', 'facade', g);
    kit.add('_root', 'roof', box([x, h + 0.25, z], [w + 0.3, 0.5, d + 0.3]));
    if (r() < 0.6) kit.add('_root', 'dark', box([x + (r() - 0.5) * w * 0.5, h + 1.1, z + (r() - 0.5) * d * 0.5], [Math.min(3, w * 0.3), 1.4, Math.min(3, d * 0.3)]));
    if (h > 40 && r() < 0.5) kit.add('_root', 'pole', cyl([x, h + 5, z], 0.15, 0.25, 9, [0, 0, 0], 8));
  };
  const road = (x, z, w, len, alongZ = true) => {
    const g = new T.PlaneGeometry(alongZ ? w : len, alongZ ? len : w); g.rotateX(-Math.PI / 2); g.translate(x, 0.02, z);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, alongZ ? uv.getX(i) : uv.getY(i) * len / 8, alongZ ? uv.getY(i) * len / 8 : uv.getX(i));
    kit.add('_root', 'road', g);
  };
  const lamp = (x, z, face) => { kit.add('_root', 'pole', cyl([x, 3, z], 0.07, 0.1, 6, [0, 0, 0], 8)); kit.add('_root', 'pole', box([x + face * 0.6, 6, z], [1.2, 0.1, 0.12])); kit.add('_root', 'dark', box([x + face * 1.15, 5.9, z], [0.4, 0.15, 0.25])); };
  const tree = (x, z) => { kit.add('_root', 'trunk', cyl([x, 1.3, z], 0.12, 0.16, 2.6, [0, 0, 0], 8)); kit.add('_root', 'tree', ball([x, 3.4, z], 1.4 + r() * 0.5, [1, 1.15, 1], 10, 8)); };
  if (kind === 'street') {
    // one long street, buildings on both sides, sidewalks, lamps, trees — eye-level backgrounds
    road(0, 0, 9, 160);
    for (const side of [-1, 1]) {
      kit.add('_root', 'walk', box([side * 7, 0.08, 0], [5, 0.16, 160]));
      let z = -78;
      while (z < 78) {
        const w = 10 + r() * 10, h = 9 + Math.floor(r() * 9) * 3.4;
        building(side * (9.5 + 7), z + w / 2, 14, w - 0.4, h);
        z += w;
      }
      for (let z2 = -70; z2 < 75; z2 += 14) { lamp(side * 5.2, z2, -side); if (r() < 0.7) tree(side * 7.6, z2 + 7); }
    }
  } else {
    // district: a grid of blocks, taller towards the middle
    const N = 5, block = 34, street = 10, span = N * (block + street);
    for (let i = 0; i <= N; i++) { const c = -span / 2 + i * (block + street) - street / 2; road(c, 0, street, span + street); road(0, c, street, span + street, false); }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = -span / 2 + i * (block + street) + block / 2, cz = -span / 2 + j * (block + street) + block / 2;
      kit.add('_root', 'walk', box([cx, 0.08, cz], [block + 3, 0.16, block + 3]));
      const centre = 1 - Math.hypot(i - (N - 1) / 2, j - (N - 1) / 2) / N, k = 2 + Math.floor(r() * 2);
      const sub = block / k;
      for (let a = 0; a < k; a++) for (let b2 = 0; b2 < k; b2++) {
        const h = 12 + r() * 30 + centre * centre * 120 * r();
        building(cx - block / 2 + sub * (a + 0.5), cz - block / 2 + sub * (b2 + 0.5), sub - 1.5, sub - 1.5, Math.round(h / 3.4) * 3.4);
      }
    }
  }
  kit.finish();
  return { root, joints: null, mat: mats.facade };
}

// ───────── two-bone IK (drag a hand / foot, the arm / leg follows) ─────────
export const IK_CHAINS = { handL: ['shoulderL', 'elbowL', 'handL'], handR: ['shoulderR', 'elbowR', 'handR'], footL: ['hipL', 'kneeL', 'footL'], footR: ['hipR', 'kneeR', 'footR'] };
const POLE = { handL: [0, 0, -1], handR: [0, 0, -1], footL: [0, 0, 1], footR: [0, 0, 1] }; // elbows back, knees forward
function rotateBone(j, fromW, toW, pivotW) {
  const v0 = fromW.clone().sub(pivotW).normalize(), v1 = toW.clone().sub(pivotW).normalize();
  if (v0.distanceToSquared(v1) < 1e-12) return;
  const dq = new T.Quaternion().setFromUnitVectors(v0, v1);
  const parentQ = j.parent.getWorldQuaternion(new T.Quaternion()), jw = j.getWorldQuaternion(new T.Quaternion());
  j.quaternion.copy(parentQ.invert().multiply(dq.multiply(jw)));
  j.updateWorldMatrix(false, true);
}
// moves the chain so the end joint reaches `target` (world); returns the joints it changed
export function solveIK(joints, effector, target) {
  const [u, l, e] = IK_CHAINS[effector].map((n) => joints[n]);
  u.updateWorldMatrix(true, true);
  const P0 = u.getWorldPosition(new T.Vector3()), P1 = l.getWorldPosition(new T.Vector3()), P2 = e.getWorldPosition(new T.Vector3());
  const a = P0.distanceTo(P1), b = P1.distanceTo(P2);
  const toT = target.clone().sub(P0), d = clamp(toT.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4), dir = toT.normalize();
  let pole = P1.clone().sub(P0); pole.sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (pole.lengthSq() < 1e-8) { const root = joints._root; const hint = v3(POLE[effector]).applyQuaternion(root.getWorldQuaternion(new T.Quaternion())); pole = hint.sub(dir.clone().multiplyScalar(hint.dot(dir))); }
  pole.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const E = P0.clone().add(dir.clone().multiplyScalar(cosA * a)).add(pole.multiplyScalar(sinA * a));
  rotateBone(u, P1, E, P0);
  const P1n = l.getWorldPosition(new T.Vector3()), P2n = e.getWorldPosition(new T.Vector3());
  rotateBone(l, P2n, P0.clone().add(dir.clone().multiplyScalar(d)), P1n);
  return IK_CHAINS[effector].slice(0, 2);
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ───────── BVH (Clip Studio, Mixamo, CMU, Daz, VRM-style rigs) ─────────
export function parseBVH(text) {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = tok.indexOf('HIERARCHY');
  if (i < 0) throw new Error('Not a BVH file');
  i++;
  const joints = []; let nch = 0;
  const num = () => parseFloat(tok[i++]);
  const parseJoint = (parent) => {
    const type = tok[i++];
    if (type === 'End') { i += 2; i++; const off = [num(), num(), num()]; i++; if (parent) parent.end = off; return; }
    const j = { name: tok[i++], parent, children: [] }; i++; // {
    i++; j.offset = [num(), num(), num()];
    i++; const n = parseInt(tok[i++], 10); j.channels = tok.slice(i, i + n); i += n; j.start = nch; nch += n;
    joints.push(j); if (parent) parent.children.push(j);
    while (tok[i] !== '}') parseJoint(j);
    i++;
  };
  parseJoint(null);
  const m = tok.indexOf('MOTION', i);
  let frames = [], ft = 1 / 30;
  if (m >= 0) {
    i = m + 1; const fi = tok.indexOf('Frames:', i); const count = parseInt(tok[fi + 1], 10); ft = parseFloat(tok[fi + 4]) || ft;
    i = fi + 5;
    for (let f = 0; f < count && i + nch <= tok.length; f++) { const row = new Float32Array(nch); for (let c = 0; c < nch; c++) row[c] = parseFloat(tok[i++]); frames.push(row); }
  }
  if (!frames.length) frames = [new Float32Array(nch)];
  return { joints, frames, frameTime: ft };
}
// world positions + rotations of every BVH joint for one frame (row = null → rest pose)
function bvhWorld(bvh, row) {
  const out = new Map();
  for (const j of bvh.joints) {
    const pos = v3(j.offset), q = new T.Quaternion();
    j.channels.forEach((c, k) => {
      const v = row ? row[j.start + k] : 0;
      if (c === 'Xposition') pos.x = v; else if (c === 'Yposition') pos.y = v; else if (c === 'Zposition') pos.z = v;
      else { const ax = c[0] === 'X' ? new T.Vector3(1, 0, 0) : c[0] === 'Y' ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1); q.multiply(new T.Quaternion().setFromAxisAngle(ax, v * D)); }
    });
    if (!row || !j.channels.some((c) => c.endsWith('position'))) pos.fromArray(j.offset);
    const p = j.parent ? out.get(j.parent) : { p: new T.Vector3(), q: new T.Quaternion() };
    out.set(j, { p: pos.clone().applyQuaternion(p.q).add(p.p), q: p.q.clone().multiply(q) });
  }
  return out;
}
// map BVH joint names to the drawing figure's joints
function canonical(raw) {
  let n = raw.toLowerCase().replace(/^.*[:|]/, '');
  let side = null;
  const sfx = n.match(/[_.\s-](l|r|left|right)$/); if (sfx) { side = sfx[1][0] === 'l' ? 'L' : 'R'; n = n.slice(0, sfx.index); }
  n = n.replace(/^(mixamorig|bip0?1|cc_base_|def[-_]|j_bip_[clr]_|valvebiped\.bip01_|character\d*_|rig_)/, '').replace(/[\s_.-]/g, '');
  if (!side) {
    if (n.startsWith('left')) { side = 'L'; n = n.slice(4); } else if (n.startsWith('right')) { side = 'R'; n = n.slice(5); }
    else { const m = n.match(/^([lr])(collar|shldr|shoulder|uparm|upperarm|arm|forearm|lowarm|hand|wrist|thigh|upleg|shin|leg|lowleg|foot|toe|humerus|radius|femur|tibia|clavicle|thumb|index|mid|middle|ring|pinky|pinkie|little)/); if (m) { side = m[1].toUpperCase(); n = n.slice(1); } }
  }
  n = n.replace(/^hand(?=(thumb|index|middle|ring|pinky|little))/, '');
  return { side, n };
}
const BODY_ALIAS = [
  ['pelvis', /^(hips?|pelvis|root)$/], ['spine', /^(spine|abdomen|lowerback|spine0?1?|waist)$/], ['chest', /^(upperchest|spine2|chest|thorax|upperback|spine0?3)$/],
  ['neck', /^(neck|neck1|lowerneck|neck0?1)$/], ['head', /^head$/],
];
const SIDE_ALIAS = [
  ['clav', /^(shoulder|collar|clavicle)$/], ['shoulder', /^(arm|uparm|upperarm|shldr|humerus)$/], ['elbow', /^(forearm|lowarm|lowerarm|radius|elbow)$/], ['hand', /^(hand|wrist)$/],
  ['hip', /^(upleg|upperleg|thigh|femur)$/], ['knee', /^(leg|lowleg|lowerleg|shin|tibia|knee|calf)$/], ['foot', /^(foot|ankle)$/], ['toe', /^(toebase|toes?)$/],
];
function mapBVH(bvh) {
  const map = {};
  for (const j of bvh.joints) {
    const { side, n } = canonical(j.name);
    if (!side) { for (const [ours, re] of BODY_ALIAS) if (re.test(n) && !map[ours]) { map[ours] = j; break; } continue; }
    let done = false;
    for (const [ours, re] of SIDE_ALIAS) if (re.test(n)) { if (!map[ours + side]) map[ours + side] = j; done = true; break; }
    if (done) continue;
    const fm = n.match(/^(thumb|index|middle|mid|ring|pinky|pinkie|little)(\d|proximal|intermediate|distal|metacarpal)?$/);
    if (fm) {
      const f = { mid: 'middle', pinkie: 'pinky', little: 'pinky' }[fm[1]] || fm[1];
      const segN = { proximal: 1, intermediate: 2, distal: 3, metacarpal: 1 }[fm[2]] || parseInt(fm[2] || '1', 10);
      if (segN >= 1 && segN <= 3 && !map[f + side + segN]) map[f + side + segN] = j;
    }
  }
  // Mixamo / CMU chains with Spine, Spine1, Spine2: use the top one for the chest
  return map;
}
export function bvhInfo(bvh) { const m = mapBVH(bvh); return { frames: bvh.frames.length, mapped: Object.keys(m).length, hasBody: !!(m.pelvis && m.hipL && m.shoulderL) }; }

// Retarget one BVH frame onto a drawing figure (its bind is a T-pose facing +Z).
// Limbs copy the BVH bone directions (works whatever the BVH's rest pose is);
// the rest copies world rotation changes. Returns a stored pose.
export function retargetBVH(bvh, frameIndex, fig) {
  const map = mapBVH(bvh);
  if (!map.pelvis) throw new Error('No hips / pelvis joint found in this BVH');
  const rest = bvhWorld(bvh, null), cur = bvhWorld(bvh, bvh.frames[Math.min(frameIndex, bvh.frames.length - 1)]);
  // face the BVH skeleton like ours: its left hip must point to +X
  let yaw = new T.Quaternion();
  if (map.hipL && map.hipR) { const rv = rest.get(map.hipL).p.clone().sub(rest.get(map.hipR).p); yaw.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(rv.z, rv.x)); }
  const yawI = yaw.clone().invert();
  const P = (j, w) => w.get(j).p.clone().applyQuaternion(yaw);
  const worldDelta = (j) => yaw.clone().multiply(cur.get(j).q.clone().multiply(rest.get(j).q.clone().invert())).multiply(yawI);
  const LIMB_CHILD = { shoulderL: 'elbowL', elbowL: 'handL', hipL: 'kneeL', kneeL: 'footL', shoulderR: 'elbowR', elbowR: 'handR', hipR: 'kneeR', kneeR: 'footR' };
  const order = humanJointNames(), worldRot = {}, pose = {};
  const parentOf = (n) => fig.joints[n].parent && fig.joints[n].parent.name ? fig.joints[n].parent.name : null;
  for (const n of order) {
    if (!fig.joints[n]) continue;
    const par = parentOf(n), pw = par && worldRot[par] ? worldRot[par] : new T.Quaternion();
    let w = null;
    const child = LIMB_CHILD[n];
    if (child && map[n] && map[child]) {
      const ours = fig.world[child].clone().sub(fig.world[n]).normalize();
      const theirs = P(map[child], cur).sub(P(map[n], cur)).normalize();
      w = new T.Quaternion().setFromUnitVectors(ours, theirs);
    } else if (map[n]) w = worldDelta(map[n]);
    if (w) { worldRot[n] = w; pose[n] = pw.clone().invert().multiply(w).toArray(); }
    else {
      // no source joint: keep its rest bend relative to the parent
      const e = HUMAN_REST[n] || [0, 0, 0], lq = new T.Quaternion().setFromEuler(new T.Euler(e[0] * D, e[1] * D, e[2] * D));
      worldRot[n] = pw.clone().multiply(lq);
    }
  }
  // height: lift / lower the pelvis by the same proportion
  if (map.hipL && map.footL) {
    const legB = rest.get(map.hipL).p.distanceTo(rest.get(map.footL).p), legO = fig.world.hipL.distanceTo(fig.world.footL), k = legO / (legB || 1);
    const dy = (P(map.pelvis, cur).y - P(map.pelvis, rest).y) * k;
    pose.$root = [0, dy / fig.H, 0];
  }
  return pose;
}
// Export the figure's current pose as BVH (Mixamo-style names, centimetres) — Clip Studio,
// Blender and most 3D apps can load it.
const BVH_NAME = { pelvis: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head', clav: 'Shoulder', shoulder: 'Arm', elbow: 'ForeArm', hand: 'Hand', hip: 'UpLeg', knee: 'Leg', foot: 'Foot', toe: 'ToeBase' };
export function exportBVH(fig, pose) {
  const nameOf = (n) => { if (BVH_NAME[n]) return BVH_NAME[n]; const m = n.match(/^([a-z]+)(L|R)(\d)?$/); if (!m) return n; const side = m[2] === 'L' ? 'Left' : 'Right'; return BVH_NAME[m[1]] ? side + BVH_NAME[m[1]] : side + 'Hand' + m[1][0].toUpperCase() + m[1].slice(1) + m[3]; };
  let txt = 'HIERARCHY\n'; const order = [], cm = 100;
  const walk = (g, depth) => {
    const n = g.name, ind = '  '.repeat(depth), w = fig.world[n], pw = depth ? fig.world[g.parent.name] : new T.Vector3();
    const off = depth ? w.clone().sub(pw) : w;
    txt += `${ind}${depth ? 'JOINT' : 'ROOT'} ${nameOf(n)}\n${ind}{\n${ind}  OFFSET ${(off.x * cm).toFixed(3)} ${(off.y * cm).toFixed(3)} ${(off.z * cm).toFixed(3)}\n${ind}  CHANNELS ${depth ? 3 : 6} ${depth ? '' : 'Xposition Yposition Zposition '}Zrotation Xrotation Yrotation\n`;
    order.push(n);
    const kids = g.children.filter((c) => c.isGroup && c.name && fig.world[c.name]);
    if (!kids.length) txt += `${ind}  End Site\n${ind}  {\n${ind}    OFFSET 0 ${(fig.H * 2).toFixed(3)} 0\n${ind}  }\n`;
    for (const c of kids) walk(c, depth + 1);
    txt += `${ind}}\n`;
  };
  walk(fig.joints.pelvis, 0);
  const vals = [];
  for (const n of order) {
    let q = pose[n] ? new T.Quaternion(...pose[n]) : (() => { const e = HUMAN_REST[n] || [0, 0, 0]; return new T.Quaternion().setFromEuler(new T.Euler(e[0] * D, e[1] * D, e[2] * D)); })();
    const e = new T.Euler().setFromQuaternion(q, 'ZXY');
    if (n === 'pelvis') { const r = pose.$root || [0, 0, 0], p = fig.world.pelvis; vals.push(((p.x + r[0] * fig.H) * cm).toFixed(3), ((p.y + r[1] * fig.H) * cm).toFixed(3), ((p.z + r[2] * fig.H) * cm).toFixed(3)); }
    vals.push((e.z / D).toFixed(4), (e.x / D).toFixed(4), (e.y / D).toFixed(4));
  }
  txt += `MOTION\nFrames: 1\nFrame Time: 0.0333333\n${vals.join(' ')}\n`;
  return txt;
}
