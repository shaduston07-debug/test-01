// Realistic human figures built on the MakeHuman "hm08" base mesh (CC0, makehumancommunity.org):
// an artist-made neutral body and face. This file rigs it with the app's own skeleton (same joint
// names as humanSpec, so poses, IK, BVH, hand shapes and held weapons all work), shapes it female /
// male, by build, height and head ratio, and skins it automatically (sculpt.js weights).
import * as S from './sculpt.js';
import { makeJoints, stdMat, HUMAN_REST } from './models3d.js';

let T = null;
export function setThree(t) { T = t; S.setThree(t); }

let assetP = null;
function loadAsset() {
  return (assetP ||= fetch(new URL('../vendor/mh-base.bin', import.meta.url)).then((r) => { if (!r.ok) throw new Error('base mesh missing'); return r.arrayBuffer(); }).then((buf) => {
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'MHB1') throw new Error('bad base mesh');
    const nv = dv.getUint32(4, true), nq = dv.getUint32(8, true), nj = dv.getUint32(12, true);
    const pos = new Float32Array(buf.slice(16, 16 + nv * 12));
    const quads = new Uint16Array(buf.slice(16 + nv * 12, 16 + nv * 12 + nq * 8));
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 16 + nv * 12 + nq * 8, nj)));
    return { pos, quads, meta };
  }));
}

// ───────── Blender-built figures (vendor/models/figure-*.glb) ─────────
// The body is shaped with MakeHuman's own female / male, muscle, weight and proportion targets,
// subdivided, rigged with artist-made weights already merged onto our joint names, and carries
// baked ambient occlusion in its vertex colours. Two morph targets (slim, strong) drive Build;
// the scene extras hold the joint positions for each, so the skeleton follows the body.
const glbP = {};
function loadFigureGLB(sex) {
  return (glbP[sex] ||= (async () => {
    const r = await fetch(new URL(`../vendor/models/figure-${sex}.glb`, import.meta.url));
    if (!r.ok) throw new Error('figure model missing');
    const buf = await r.arrayBuffer();
    const gltf = await new Promise((res, rej) => new T.GLTFLoader().parse(buf, '', res, rej));
    const x = gltf.parser.json.scenes[0].extras;
    if (!x || x.inkwell !== 'figure') throw new Error('not a figure model');
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    const g = mesh.geometry, nv = g.attributes.position.count;
    // skin: glTF joint order → our joint order, weights as floats
    const names = mesh.skeleton.bones.map((bn, i) => x.joints[i] || bn.name);
    const ji = g.attributes.skinIndex.array, wi = g.attributes.skinWeight;
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    for (let i = 0; i < nv * 4; i++) { si[i] = ji[i]; sw[i] = wi.normalized ? wi.array[i] / 255 : wi.array[i]; }
    const col = g.attributes.color, colors = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) colors[i * 3 + k] = col ? col.getComponent(i, k) : 1;
    // morph deltas may be stored as normalized int16 (scale in the extras)
    const morph = Object.fromEntries((x.morphs || []).map((n, i) => {
      const a = g.morphAttributes.position[i].array;
      if (a instanceof Float32Array) return [n, a];
      const k = ((x.morphScales && x.morphScales[i]) || 1) / 32767;
      return [n, Float32Array.from(a, (v) => v * k)];
    }));
    return { x, names, base: g.attributes.position.array, idx: g.index.array, si, sw, colors, morph, nv };
  })());
}

// musculature / body fat (0…1); documents from before the 2D pad only have a single build value
export function bodyShape(b) {
  if (b.muscle != null && b.fat != null) return { muscle: b.muscle, fat: b.fat };
  const k = b.build ?? 0.45, c = (v) => Math.max(0, Math.min(1, v));
  return { muscle: c(0.5 + (k - 0.5) * 0.9), fat: c(0.5 + (k - 0.5) * 0.7) };
}

// ───────── per-part proportions (like Clip Studio's body-shape part editing) ─────────
// parts: { key: [width, length] } (1 = unchanged). Each part scales its bones' part of the mesh:
// length along the bone, width across it; everything further out (child joints) follows.
export const BODY_PARTS = [
  ['head', 'Head', ['head']], ['neck', 'Neck', ['neck']], ['shoulders', 'Shoulders', ['clavL', 'clavR']],
  ['chest', 'Chest', ['chest']], ['waist', 'Waist', ['spine']], ['hips', 'Hips', ['pelvis']],
  ['upperArms', 'Upper arms', ['shoulderL', 'shoulderR']], ['forearms', 'Forearms', ['elbowL', 'elbowR']], ['hands', 'Hands', ['handL', 'handR', '*fingers']],
  ['thighs', 'Thighs', ['hipL', 'hipR']], ['calves', 'Lower legs', ['kneeL', 'kneeR']], ['feet', 'Feet', ['footL', 'footR', 'toeL', 'toeR']],
];
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
function parentOf(n) {
  const m = /^(thumb|index|middle|ring|pinky)([LR])(\d)$/.exec(n);
  if (m) return m[3] === '1' ? 'hand' + m[2] : m[1] + m[2] + (+m[3] - 1);
  const side = /([LR])$/.exec(n), s = side ? side[1] : '';
  const base = n.replace(/[LR]$/, '');
  return { pelvis: null, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck', clav: 'chest', shoulder: 'clav' + s, elbow: 'shoulder' + s, hand: 'elbow' + s, hip: 'pelvis', knee: 'hip' + s, foot: 'knee' + s, toe: 'foot' + s }[base];
}
function tailOf(n, J) {
  const m = /^(thumb|index|middle|ring|pinky)([LR])(\d)$/.exec(n);
  if (m) { const nx = m[1] + m[2] + (+m[3] + 1); if (J[nx]) return J[nx]; const p = J[parentOf(n)]; return [2 * J[n][0] - p[0], 2 * J[n][1] - p[1], 2 * J[n][2] - p[2]]; }
  const s = (/([LR])$/.exec(n) || [, ''])[1], base = n.replace(/[LR]$/, '');
  const t = { pelvis: 'spine', spine: 'chest', chest: 'neck', neck: 'head', clav: 'shoulder' + s, shoulder: 'elbow' + s, elbow: 'hand' + s, hand: 'middle' + s + '1', hip: 'knee' + s, knee: 'foot' + s, foot: 'toe' + s }[base];
  if (t && J[t]) return J[t];
  if (base === 'head') return [J[n][0], J[n][1] + 0.2, J[n][2]];
  const p = J[parentOf(n)] || [J[n][0], J[n][1] - 0.1, J[n][2]];
  return [2 * J[n][0] - p[0], 2 * J[n][1] - p[1], 2 * J[n][2] - p[2]];
}
export function applyParts(P, J, extra, names, si, sw, parts) {
  const scale = {};
  for (const [key, , bones] of BODY_PARTS) {
    const v = parts[key]; if (!v || (v[0] === 1 && v[1] === 1)) continue;
    for (const bn of bones) {
      if (bn === '*fingers') { for (const s of ['L', 'R']) for (const f of FINGERS) for (let k = 1; k <= 3; k++) scale[f + s + k] = [v[0], v[1]]; }
      else scale[bn] = v;
    }
  }
  if (!Object.keys(scale).length) return 0;
  const torso = new Set(['pelvis', 'spine', 'chest']);
  // per-bone affine: p' = J'[b] + S_b (p − J[b])
  const order = Object.keys(J).filter((n) => parentOf(n) !== undefined);
  const depth = (n) => { let d = 0; for (let p = parentOf(n); p; p = parentOf(p)) d++; return d; };
  order.sort((a, b) => depth(a) - depth(b));
  const M = {}, J2 = {};
  const mat = (n) => {
    const v = scale[n]; if (!v) return null;
    const [W, L] = v, a = J[n], t = tailOf(n, J);
    let u = [t[0] - a[0], t[1] - a[1], t[2] - a[2]]; const ul = Math.hypot(...u) || 1; u = u.map((c) => c / ul);
    // across-axes: e1 ≈ sideways (x), e2 = u × e1 (front-back)
    let e1 = [1, 0, 0]; const d = e1[0] * u[0]; e1 = [e1[0] - d * u[0], -d * u[1], -d * u[2]];
    let l1 = Math.hypot(...e1); if (l1 < 0.3) { e1 = [0, 0, 1]; const d2 = u[2]; e1 = [-d2 * u[0], -d2 * u[1], 1 - d2 * u[2]]; l1 = Math.hypot(...e1); }
    e1 = e1.map((c) => c / l1);
    const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const f1 = W, f2 = torso.has(n) ? 1 + (W - 1) * 0.6 : W;
    // S = L·uuᵀ + f1·e1e1ᵀ + f2·e2e2ᵀ
    const S = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S.push(L * u[i] * u[j] + f1 * e1[i] * e1[j] + f2 * e2[i] * e2[j]);
    return S;
  };
  const app = (S, v) => (S ? [S[0] * v[0] + S[1] * v[1] + S[2] * v[2], S[3] * v[0] + S[4] * v[1] + S[5] * v[2], S[6] * v[0] + S[7] * v[1] + S[8] * v[2]] : v);
  for (const n of order) {
    const p = parentOf(n);
    if (!p || !J2[p]) J2[n] = J[n].slice();
    else { const r = app(M[p], [J[n][0] - J[p][0], J[n][1] - J[p][1], J[n][2] - J[p][2]]); J2[n] = [J2[p][0] + r[0], J2[p][1] + r[1], J2[p][2] + r[2]]; }
    M[n] = mat(n);
  }
  const fb = (n, x, y, z) => { const a = J[n], b = J2[n]; if (!a || !b) return [x, y, z]; const r = app(M[n], [x - a[0], y - a[1], z - a[2]]); return [b[0] + r[0], b[1] + r[1], b[2] + r[2]]; };
  const nv = P.length / 3;
  let min0 = Infinity; for (let i = 0; i < nv; i++) min0 = Math.min(min0, P[i * 3 + 1]);
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0, wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw[i * 4 + k]; if (!w) continue;
      const q = fb(names[si[i * 4 + k]], x, y, z); ox += q[0] * w; oy += q[1] * w; oz += q[2] * w; wsum += w;
    }
    if (wsum > 0) { P[i * 3] = ox / wsum; P[i * 3 + 1] = oy / wsum; P[i * 3 + 2] = oz / wsum; }
  }
  for (const pt of extra) { const q = fb('head', ...pt.v); pt.set(q); }
  for (const n of Object.keys(J2)) J[n] = J2[n];
  // keep the feet on the floor (longer / shorter legs move the soles)
  let min1 = Infinity; for (let i = 0; i < nv; i++) min1 = Math.min(min1, P[i * 3 + 1]);
  const dy = min0 - min1;
  if (Math.abs(dy) > 1e-5) {
    for (let i = 0; i < nv; i++) P[i * 3 + 1] += dy;
    for (const n of Object.keys(J)) J[n] = [J[n][0], J[n][1] + dy, J[n][2]];
  }
  return dy;
}

export async function buildHumanGLB(body, color = '#c9c6c1') {
  const b = { sex: 'female', height: 1.62, heads: 7.2, build: 0.4, ...body };
  const D = await loadFigureGLB(b.sex === 'male' ? 'male' : 'female');
  const { x, nv } = D;
  // body shape (Clip Studio's 2D pad): musculature and body fat, 0.5 = the base body
  const { muscle, fat } = bodyShape(b);
  const w = { 'muscle-': Math.max(0, (0.5 - muscle) * 2), 'muscle+': Math.max(0, (muscle - 0.5) * 2), 'fat-': Math.max(0, (0.5 - fat) * 2), 'fat+': Math.max(0, (fat - 0.5) * 2) };
  const P = new Float32Array(D.base);
  for (const [n, k] of Object.entries(w)) if (k && D.morph[n]) { const d = D.morph[n]; for (let i = 0; i < P.length; i++) P[i] += d[i] * k; }
  const mix = (get) => { const a = get(x.variants.base).slice(); for (const [n, k] of Object.entries(w)) if (k) { const v = get(x.variants[n]), b0 = get(x.variants.base); for (let i = 0; i < 3; i++) a[i] += (v[i] - b0[i]) * k; } return a; };
  const J = Object.fromEntries(x.joints.map((n) => [n, mix((v) => v.joints[n])]));
  const eyes = [mix((v) => v.eyes.L), mix((v) => v.eyes.R)];
  if (b.parts) { const dy = applyParts(P, J, eyes.map((e, i) => ({ v: e, set: (q) => { eyes[i] = q; } })), D.names, D.si, D.sw, b.parts); if (dy) for (const e of eyes) e[1] += dy; }
  // head ratio: measure this body's (top of head → chin), then scale the head about the neck
  let top = 0, chin = Infinity;
  for (let i = 0; i < x.eyeStart; i++) {
    const y = P[i * 3 + 1]; top = Math.max(top, y);
    if (Math.abs(P[i * 3]) < 0.012 && y > J.neck[1] && P[i * 3 + 2] > J.head[2] + 0.06) chin = Math.min(chin, y);
  }
  const heads = top / Math.max(0.12, top - chin);
  const kh = heads / b.heads, nk = J.neck, hy0 = nk[1] + 0.01, hy1 = nk[1] + 0.07;
  const headF = (p) => { const t = sstep(hy0, hy1, p[1]), k = 1 + (kh - 1) * t; return [nk[0] + (p[0] - nk[0]) * k, hy0 + (p[1] - hy0) * k, nk[2] + (p[2] - nk[2]) * k]; };
  for (let i = 0; i < nv; i++) { const q = headF([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
  for (const k of Object.keys(J)) if (J[k][1] > hy0) J[k] = headF(J[k]);
  for (let e = 0; e < 2; e++) eyes[e] = headF(eyes[e]);
  // overall height (feet stay on the floor)
  top = 0; for (let i = 0; i < nv; i++) top = Math.max(top, P[i * 3 + 1]);
  const ks = b.height / top;
  for (let i = 0; i < P.length; i++) P[i] *= ks;
  for (const k of Object.keys(J)) J[k] = J[k].map((v) => v * ks);
  const eyeY = (eyes[0][1] + eyes[1][1]) / 2 * ks;
  // weights are stored for the glTF joint order: re-index them for ours once the joints exist
  const weights = (joints) => {
    const ours = Object.keys(joints).filter((n) => n !== '_root'), map = D.names.map((n) => Math.max(0, ours.indexOf(n)));
    const si = new Uint16Array(D.si.length);
    for (let i = 0; i < si.length; i++) si[i] = map[D.si[i]];
    return { si, sw: D.sw.slice() };
  };
  const idx = D.idx;
  return rigFigure({ P, idx: idx.constructor === Uint32Array ? idx : Uint32Array.from(idx), AP: J, weights, color, colors: new T.BufferAttribute(D.colors, 3), body, H: b.height, ks,
    guides: { eyeY, neckY: J.neck[1], pelvisY: J.pelvis[1] - 0.06 * ks }, eyeStart: x.eyeStart });
}

// MakeHuman joint helpers → our joint names
const MAP = { pelvis: 'pelvis', spine: 'spine-3', chest: 'spine-2', neck: 'neck', head: 'head' };
const SIDE = (s) => ({ clav: `${s}-clavicle`, shoulder: `${s}-shoulder`, elbow: `${s}-elbow`, hand: `${s}-hand`, hip: `${s}-upper-leg`, knee: `${s}-knee`, foot: `${s}-ankle`, toe: `${s}-foot-1` });
const FING = { thumb: 1, index: 2, middle: 3, ring: 4, pinky: 5 };

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function buildHumanMH(body, color = '#c9c6c1') {
  const b = { sex: 'female', height: 1.62, heads: 7.2, build: 0.4, ...body };
  const F = b.sex === 'female';
  const A = await loadAsset();
  const J0 = A.meta.joints, nv = A.pos.length / 3;
  const P = new Float32Array(A.pos);
  const J = Object.fromEntries(Object.entries(J0).map(([k, v]) => [k, v.slice()]));

  // ── shape: female / male, build (positional fields move joints too; normal fields don't) ──
  const nrm = vertexNormals(P, A.quads);
  const jawY = J.jaw[1] - 0.005;
  const chestY = J['spine-1'][1] - 0.1, hipY = J['l-upper-leg'][1], waistY = J['spine-3'][1] + 0.02, shY = J['l-shoulder'][1];
  const mu = (b.build - 0.4);
  const fieldPos = (p) => {
    let [x, y, z] = p;
    const ax = Math.abs(x);
    // hips wider (female) / narrower (male) around the hip joints; waist in; shoulders in / out
    const hipW = Math.exp(-(((y - hipY + 0.02) / 0.11) ** 2)) * sstep(0.03, 0.12, ax) * (ax < 0.26 ? 1 : 0);
    const waistW = Math.exp(-(((y - waistY) / 0.09) ** 2)) * (ax < 0.2 ? 1 : 0);
    const shW = sstep(shY - 0.2, shY - 0.05, y);
    const kx = 1 + (F ? 0.06 : -0.13) * hipW - (F ? 0.07 : -0.05) * waistW + (F ? -0.04 : 0.12) * shW * sstep(0.05, 0.2, ax);
    const kz = 1 - (F ? 0.04 : -0.03) * waistW + (F ? 0.05 : -0.06) * hipW * (z < 0 ? 1 : 0.3) + (F ? 0 : 0.05) * shW * (ax < 0.16 ? 1 : 0);
    // male: wider, squarer jaw angles (not the lips)
    if (!F) { const jw = Math.exp(-(((y - jawY - 0.02) / 0.035) ** 2)) * sstep(0.02, 0.055, ax) * Math.exp(-(((z - 0.02) / 0.06) ** 2)); return [x * kx * (1 + 0.05 * jw), y, z * kz]; }
    return [x * kx, y, z * kz];
  };
  for (let i = 0; i < nv; i++) { const q = fieldPos([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
  for (const k of Object.keys(J)) J[k] = fieldPos(J[k]);
  // bust (female) / pectorals (male), muscle with the build slider: pushes along the surface normal
  // the base mesh has a slight bust: fuller and rounder (female) or flattened into pectorals (male)
  const bust = [[0.088, chestY + 0.045, 0.1], [-0.088, chestY + 0.045, 0.1]];
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let d = 0;
    if (z > 0.02) for (const c of bust) {
      const r = ((x - c[0]) / 0.085) ** 2 + ((y - c[1]) / 0.085) ** 2;
      if (r < 1) d += F ? 0.022 * (1 - r) ** 1.5 : -0.016 * (1 - r) ** 2;
      // male pectorals: a broad, flat shelf above
      if (!F) { const r2 = ((x - c[0] * 0.85) / 0.1) ** 2 + ((y - c[1] - 0.045) / 0.06) ** 2; if (r2 < 1) d += (0.008 + Math.max(0, mu) * 0.012) * (1 - r2) ** 2; }
    }
    // male neck thicker
    if (!F) d += 0.006 * sstep(shY, shY + 0.04, y) * (1 - sstep(J.neck[1] + 0.01, J.neck[1] + 0.05, y)) * (1 - sstep(0.05, 0.09, Math.abs(x)));
    // limbs / shoulders thicker with build
    // every field is smooth (hard cut-offs show up as ridges)
    const limb = 0.5 + 0.5 * Math.max(sstep(0.16, 0.24, Math.abs(x)), 1 - sstep(hipY - 0.1, hipY, y));
    d += mu * 0.012 * limb * sstep(0.05, 0.12, y) * (1 - sstep(J.neck[1], J.neck[1] + 0.04, y));
    if (d) { P[i * 3] += nrm[i * 3] * d; P[i * 3 + 1] += nrm[i * 3 + 1] * d; P[i * 3 + 2] += nrm[i * 3 + 2] * d; }
  }
  // head ratio: scale the head about the neck (smoothly) — base head ≈ 7.3 heads
  const kh = 7.3 / b.heads, nk = J.neck, hy0 = nk[1] + 0.01, hy1 = nk[1] + 0.07;
  const headF = (p) => { const w = sstep(hy0, hy1, p[1]), k = 1 + (kh - 1) * w; return [nk[0] + (p[0] - nk[0]) * k, hy0 + (p[1] - hy0) * k, nk[2] + (p[2] - nk[2]) * k]; };
  for (let i = 0; i < nv; i++) { const q = headF([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
  for (const k of Object.keys(J)) if (J[k][1] > hy0) J[k] = headF(J[k]);
  // overall height (feet stay on the floor)
  let top = 0; for (let i = 0; i < nv; i++) top = Math.max(top, P[i * 3 + 1]);
  const ks = b.height / top;
  for (let i = 0; i < P.length; i++) P[i] *= ks;
  for (const k of Object.keys(J)) J[k] = J[k].map((v) => v * ks);

  const AP = {}; // our joint → A-pose world position
  for (const [ours, mh] of Object.entries(MAP)) AP[ours] = J[mh];
  for (const s of ['L', 'R']) {
    const m = s === 'L' ? 'l' : 'r';
    for (const [ours, mh] of Object.entries(SIDE(m))) AP[ours + s] = J[mh];
    for (const [f, n] of Object.entries(FING)) for (let k = 1; k <= 3; k++) AP[f + s + k] = J[`${m}-finger-${n}-${k}`];
  }
  const idx = new Uint32Array(A.quads.length / 4 * 6);
  for (let q = 0, k = 0; q < A.quads.length; q += 4) { const [a, bb, c, d] = [A.quads[q], A.quads[q + 1], A.quads[q + 2], A.quads[q + 3]]; idx[k++] = a; idx[k++] = bb; idx[k++] = c; idx[k++] = a; idx[k++] = c; idx[k++] = d; }
  // skin weights from distances to bone capsules (in the A-pose)
  const weights = (joints) => {
    const W = (n) => joints[n].getWorldPosition(new T.Vector3()).toArray();
    const u = b.height / 1.7, prims = [];
    const seg = (bone, a, c, r1, r2 = r1) => prims.push(S.cone(bone, a, c, r1, r2));
    seg('pelvis', W('pelvis'), W('spine'), 0.12 * u); prims.push(S.ell('pelvis', [0, W('pelvis')[1] - 0.04 * u, -0.02 * u], [0.15 * u, 0.1 * u, 0.12 * u]));
    seg('spine', W('spine'), W('chest'), 0.12 * u); seg('chest', W('chest'), W('neck'), 0.13 * u, 0.1 * u);
    seg('neck', W('neck'), W('head'), 0.05 * u); prims.push(S.ell('head', add3(W('head'), [0, 0.1 * u, 0.02 * u]), [0.09 * u, 0.12 * u, 0.11 * u]));
    for (const s of ['L', 'R']) {
      seg('clav' + s, W('clav' + s), W('shoulder' + s), 0.05 * u);
      seg('shoulder' + s, W('shoulder' + s), W('elbow' + s), 0.05 * u, 0.04 * u);
      seg('elbow' + s, W('elbow' + s), W('hand' + s), 0.038 * u, 0.028 * u);
      seg('hand' + s, W('hand' + s), W('middle' + s + 1), 0.03 * u);
      seg('hip' + s, W('hip' + s), W('knee' + s), 0.08 * u, 0.055 * u);
      seg('knee' + s, W('knee' + s), W('foot' + s), 0.05 * u, 0.035 * u);
      seg('foot' + s, W('foot' + s), W('toe' + s), 0.04 * u, 0.035 * u);
      const m = s === 'L' ? 'l' : 'r';
      seg('toe' + s, W('toe' + s), J[`${m}-foot-2`], 0.03 * u);
      for (const fn of Object.keys(FING)) {
        const r = (fn === 'thumb' ? 0.011 : 0.0085) * u, n = FING[fn];
        seg(fn + s + 1, W(fn + s + 1), W(fn + s + 2), r * 1.1); seg(fn + s + 2, W(fn + s + 2), W(fn + s + 3), r);
        seg(fn + s + 3, W(fn + s + 3), J[`${m}-finger-${n}-4`], r * 0.9);
      }
    }
    const leaves = [];
    S._test.compile(S.union(prims), null, leaves, 1e9);
    const boneNames = Object.keys(joints).filter((n) => n !== '_root'), boneIndex = Object.fromEntries(boneNames.map((n, i) => [n, i]));
    const { si, sw } = S.skinWeights(P, leaves, boneIndex, { falloff: 0.45, maxDist: 0.35, maxS: 0.03 });
    S.smoothWeights(idx, nv, si, sw, 3);
    // eyes follow the head only
    for (const g of ['helper-l-eye', 'helper-r-eye']) {
      const [start, count] = A.meta.parts[g];
      for (let q = start * 4; q < (start + count) * 4; q++) { const vi = A.quads[q]; si[vi * 4] = boneIndex.head; sw[vi * 4] = 1; for (let k = 1; k < 4; k++) { si[vi * 4 + k] = 0; sw[vi * 4 + k] = 0; } }
    }
    return { si, sw };
  };
  const eyeY = (J['l-eye'][1] + J['r-eye'][1]) / 2;
  return rigFigure({ P, idx, AP, weights, color, body, H: b.height, ks, guides: { eyeY, neckY: J.neck[1], pelvisY: J.pelvis[1] - 0.06 * ks } });
}

// Shared by both bodies: T-pose skeleton with the app's joint names, the mesh bound in its own
// A-pose, skin weights, material with the drawing guide lines, armour.
function rigFigure({ P, idx, AP, weights, color, colors, body, H, ks, guides, eyeStart = 0 }) {
  const { spec, bindQ } = humanSkeleton(AP);
  const root = new T.Group();
  const { joints, world } = makeJoints(spec, root);
  // bind pose = the mesh's own A-pose
  for (const [n, qq] of Object.entries(bindQ)) joints[n].quaternion.copy(qq);
  root.updateMatrixWorld(true);
  return bindFigure({ P, idx, weights, color, colors, body, H, ks, guides, eyeStart, root, joints, world, bindQ });
}

// The app's T-pose skeleton (identity joint rotations, arms along ±X, facing +Z) from joint
// positions in any rest pose (AP), and each arm joint's rotation from that T-pose to the rest pose.
// Fingers, toes, clavicles and spine joints are optional (imported rigs may not have them).
export function humanSkeleton(AP) {
  const v = (a) => new T.Vector3(...a);
  const bindQ = {}, TP = {};
  for (const k of ['pelvis', 'spine', 'chest', 'neck', 'head']) TP[k] = AP[k];
  for (const s of ['L', 'R']) for (const k of ['hip', 'knee', 'foot', 'toe', 'clav', 'shoulder']) TP[k + s] = AP[k + s];
  const frame = (X, Y) => { const x = X.clone().normalize(), z = new T.Vector3().crossVectors(x, Y).normalize(), y = new T.Vector3().crossVectors(z, x); return new T.Matrix4().makeBasis(x, y, z); };
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const Sh = v(AP['shoulder' + s]), El = v(AP['elbow' + s]), Wr = v(AP['hand' + s]);
    const u = El.clone().sub(Sh).normalize(), f = Wr.clone().sub(El).normalize();
    // no finger joints: the hand continues the forearm, palm facing down in the T-pose
    const fakeUp = new T.Vector3(0, 1, 0).sub(f.clone().multiplyScalar(f.y)).normalize();
    const Ib = AP['index' + s + 1] ? v(AP['index' + s + 1]) : Wr.clone().add(f).add(new T.Vector3().crossVectors(f, fakeUp).multiplyScalar(-0.3 * sx));
    const Mb = AP['middle' + s + 1] ? v(AP['middle' + s + 1]) : Wr.clone().add(f);
    const Pb = AP['pinky' + s + 1] ? v(AP['pinky' + s + 1]) : Wr.clone().add(f).add(new T.Vector3().crossVectors(f, fakeUp).multiplyScalar(0.3 * sx));
    let bend = f.clone().sub(u.clone().multiplyScalar(f.dot(u)));
    if (bend.lengthSq() < 1e-4) bend = new T.Vector3(0, 0, 1).sub(u.clone().multiplyScalar(u.z));
    bend.normalize();
    // upper arm: X along the bone (outwards), Z towards the elbow bend (forward)
    const Ru = new T.Matrix4().makeBasis(u.clone().multiplyScalar(sx), new T.Vector3().crossVectors(bend, u.clone().multiplyScalar(sx)), bend);
    // forearm / hand: back of the hand is +Y (palm down in the T-pose reference)
    let back = new T.Vector3().crossVectors(Ib.clone().sub(Wr), Pb.clone().sub(Wr)).normalize().multiplyScalar(sx);
    const Rf = frame(f.clone().multiplyScalar(sx), back);
    const Rh = frame(Mb.clone().sub(Wr).multiplyScalar(sx), back);
    const q = (M4) => new T.Quaternion().setFromRotationMatrix(M4);
    const qu = q(Ru), qf = q(Rf), qh = q(Rh);
    bindQ['shoulder' + s] = qu;
    bindQ['elbow' + s] = qu.clone().invert().multiply(qf);
    bindQ['hand' + s] = qf.clone().invert().multiply(qh);
    const lu = El.distanceTo(Sh), lf = Wr.distanceTo(El);
    TP['elbow' + s] = [Sh.x + sx * lu, Sh.y, Sh.z];
    TP['hand' + s] = [Sh.x + sx * (lu + lf), Sh.y, Sh.z];
    // fingers keep their layout relative to the hand frame
    const inv = qh.clone().invert(), hT = v(TP['hand' + s]);
    for (const fn of Object.keys(FING)) for (let k = 1; k <= 3; k++) {
      if (!AP[fn + s + k]) continue;
      const rel = v(AP[fn + s + k]).sub(Wr).applyQuaternion(inv);
      TP[fn + s + k] = hT.clone().add(rel).toArray();
    }
  }
  const order = ['pelvis', 'spine', 'chest', 'neck', 'head'];
  const spec = order.map((n, i) => [n, i ? order[i - 1] : null, TP[n]]);
  for (const s of ['L', 'R']) {
    spec.push(['clav' + s, 'chest', TP['clav' + s]], ['shoulder' + s, 'clav' + s, TP['shoulder' + s]], ['elbow' + s, 'shoulder' + s, TP['elbow' + s]], ['hand' + s, 'elbow' + s, TP['hand' + s]],
      ['hip' + s, 'pelvis', TP['hip' + s]], ['knee' + s, 'hip' + s, TP['knee' + s]], ['foot' + s, 'knee' + s, TP['foot' + s]], ['toe' + s, 'foot' + s, TP['toe' + s]]);
    for (const fn of Object.keys(FING)) for (let k = 1; k <= 3; k++) if (TP[fn + s + k]) spec.push([fn + s + k, k === 1 ? 'hand' + s : fn + s + (k - 1), TP[fn + s + k]]);
  }
  return { spec, bindQ };
}

function bindFigure({ P, idx, weights, color, colors, body, H, ks, guides, eyeStart, root, joints, world, bindQ }) {
  const { si, sw } = weights(joints);
  const nv = P.length / 3;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(P, 3));
  geo.setIndex(new T.BufferAttribute(nv > 65535 ? idx : new Uint16Array(idx), 1));
  geo.computeVertexNormals();
  geo.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
  if (colors) geo.setAttribute('color', colors);
  geo.computeBoundingSphere();
  const mat = stdMat(color, { roughness: colors ? 0.62 : 0.7, vertexColors: !!colors });
  // drawing guide lines (like Clip Studio's figures): centre line of the face and torso and the eye
  // line around the head. Drawn from the bind-pose position, so they stay on the body in any pose.
  const guide = { value: body.guides === false ? 0 : 1 };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { guideOn: guide, gEyeY: { value: guides.eyeY }, gNeckY: { value: guides.neckY }, gPelvisY: { value: guides.pelvisY }, gW: { value: 0.0016 * ks } });
    sh.vertexShader = 'varying vec3 vBind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    sh.fragmentShader = 'varying vec3 vBind;\nuniform float guideOn, gEyeY, gNeckY, gPelvisY, gW;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (guideOn > 0.5) {
        float aw = fwidth(vBind.x) * 1.2 + 1e-5, ah = fwidth(vBind.y) * 1.2 + 1e-5;
        float centre = (1.0 - smoothstep(gW, gW + aw, abs(vBind.x))) * step(gPelvisY, vBind.y);
        float eye = (1.0 - smoothstep(gW, gW + ah, abs(vBind.y - gEyeY))) * step(gNeckY, vBind.y);
        float g = max(centre, eye);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.16, 0.36, 0.78), g * 0.85);
      }`);
  };
  const mesh = S.bindSkinned(geo, joints, mat, root);
  mesh.userData.setGuides = (on) => { guide.value = on ? 1 : 0; };
  if (eyeStart) mesh.userData.eyeStart = eyeStart;
  mesh.name = 'body';
  for (const n of Object.keys(bindQ)) joints[n].quaternion.identity();
  root.updateMatrixWorld(true);
  return { root, joints, mat, world, H, mesh, rest: MH_REST, armor: (style) => armorMH({ root, joints, mesh, mat, bindQ }, style) };
}
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ───────── imported human models (Blender / Mixamo / Rigify / VRM / Unreal rigs) ─────────
// The model's bones are matched to our joints by name. Our own T-pose skeleton is built at
// those joint positions (invisible), so poses, IK, hand shapes, Mirror and BVH work on it
// exactly as on the drawing figures; drive() then turns every matched bone by the same amount
// its joint has turned since the bind pose. Unmatched bones (twists, extra spine) follow along.
export function rigImported(node, mapNames) {
  node.updateMatrixWorld(true);
  const skinned = [], bones = new Set(), rigid = [], carrying = new Set();
  node.traverse((o) => { if (o.isSkinnedMesh) { skinned.push(o); for (const b of o.skeleton.bones) bones.add(b); } });
  // segmented mannequins: rigid pieces hanging off bones (Blender bone parenting)
  node.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) { let p = o.parent; while (p && !p.isBone) p = p.parent; if (p) { rigid.push([o, p]); carrying.add(p); } } });
  if (!skinned.length && !rigid.length) return null;
  node.traverse((o) => { if (o.isBone) bones.add(o); });
  // bones that really move geometry (deform bones) win over helper / control bones of the same name
  for (const m of skinned) {
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; if (!si || !sw) continue;
    for (let v = 0; v < si.count; v++) for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > 0.05) carrying.add(m.skeleton.bones[si.getComponent(v, k)]);
  }
  const blist = [...bones].sort((a, b) => (carrying.has(b) ? 1 : 0) - (carrying.has(a) ? 1 : 0));
  const map = mapNames(blist.map((b) => ({ name: (b.userData.name || b.name).replace(/^(ORG|DEF|MCH|CTRL|CTL|ctrl)[-_.]/, ''), bone: b, rawName: b.userData.name || b.name })).filter((x) => !/^(MCH|VIS|WGT|IK|FK|tweak|root)$/i.test(x.rawName.split(/[-_.]/)[0]) || carrying.has(x.bone)));
  const need = ['pelvis', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR'];
  if (!need.every((n) => map[n])) return null;
  const inv = new T.Matrix4().copy(node.matrixWorld).invert();
  const at = (b) => b.getWorldPosition(new T.Vector3()).applyMatrix4(inv);
  // face +Z with the left side on +X, like our figures
  const lr = at(map.hipL.bone).sub(at(map.hipR.bone));
  const turn = Math.atan2(-lr.z, lr.x);
  if (Math.abs(turn) > 0.3) {
    const inner = node.children[0] || node;
    inner.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), turn));
    inner.position.applyAxisAngle(new T.Vector3(0, 1, 0), turn);
    node.updateMatrixWorld(true);
  }
  const AP = {};
  for (const [n, m] of Object.entries(map)) AP[n] = at(m.bone).toArray();
  // joints the rig doesn't have get sensible places (they just have no bone to turn)
  const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const neck = AP.neck || lerp(AP.head, lerp(AP.shoulderL, AP.shoulderR, 0.5), 0.5);
  AP.neck ||= neck;
  AP.spine ||= lerp(AP.pelvis, neck, 0.3);
  AP.chest ||= lerp(AP.pelvis, neck, 0.65);
  for (const s of ['L', 'R']) {
    AP['clav' + s] ||= lerp(AP.chest, AP['shoulder' + s], 0.25);
    AP['toe' + s] ||= add3(AP['foot' + s], [0, -0.05, 0.12]);
  }
  let H = 0; node.traverse((o) => { if (o.isMesh) { const b = new T.Box3().setFromObject(o); H = Math.max(H, b.max.applyMatrix4(inv).y); } });
  const { spec, bindQ } = humanSkeleton(AP);
  const jroot = new T.Group();
  const { joints, world } = makeJoints(spec, jroot);
  node.add(jroot);
  // bind: our joints in the model's rest pose; remember both sides' rest rotations
  for (const [n, q] of Object.entries(bindQ)) joints[n].quaternion.copy(q);
  node.updateMatrixWorld(true);
  const nodeQ = node.getWorldQuaternion(new T.Quaternion()), nodeQi = nodeQ.clone().invert();
  const local = (o) => nodeQi.clone().multiply(o.getWorldQuaternion(new T.Quaternion()));
  const driven = Object.entries(map).filter(([n]) => joints[n]).map(([n, m]) => ({ joint: joints[n], bone: m.bone, jBindInv: local(joints[n]).invert(), boneRest: local(m.bone) }));
  const boneRestLocal = new Map([...bones].map((b) => [b, b.quaternion.clone()]));
  const pelvisBone = map.pelvis.bone, pelvisRest = pelvisBone.position.clone(), pelvisBind = joints.pelvis.position.clone();
  for (const n of Object.keys(bindQ)) joints[n].quaternion.identity();
  node.updateMatrixWorld(true);
  const byBone = new Map(driven.map((d) => [d.bone, d]));
  // vertex → our joint: the matched joint of the bone it follows most (or its nearest matched parent)
  const jointOfBone = new Map();
  for (const b of bones) { let p = b; while (p && !byBone.has(p)) p = p.parent; jointOfBone.set(b, p ? byBone.get(p).joint.name : 'pelvis'); }
  for (const [o, b] of rigid) { o.userData.joint = jointOfBone.get(b); o.frustumCulled = false; }
  for (const m of skinned) {
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    m.userData.boneOf = (v) => { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const x = sw.getComponent(v, k); if (x > w) { w = x; b = si.getComponent(v, k); } } return jointOfBone.get(m.skeleton.bones[b]); };
    m.frustumCulled = false;
  }
  const drive = () => {
    node.updateMatrixWorld(true);
    const cur = node.getWorldQuaternion(new T.Quaternion()).invert();
    // in hierarchy order: a bone's parent is final before the bone itself
    const walk = (b, parentQ) => {
      const d = byBone.get(b);
      let q;
      if (d) {
        const jq = cur.clone().multiply(d.joint.getWorldQuaternion(new T.Quaternion()));
        q = jq.multiply(d.jBindInv).multiply(d.boneRest); // node-space world rotation
        b.quaternion.copy(parentQ.clone().invert().multiply(q));
      } else {
        b.quaternion.copy(boneRestLocal.get(b));
        q = parentQ.clone().multiply(b.quaternion);
      }
      for (const c of b.children) if (bones.has(c)) walk(c, q);
    };
    for (const b of bones) if (!bones.has(b.parent)) walk(b, cur.clone().multiply(b.parent.getWorldQuaternion(new T.Quaternion())));
    // the hips carry the figure's height changes (crouch, jump, sit)
    const dp = joints.pelvis.position.clone().sub(pelvisBind);
    const parentScale = pelvisBone.parent.getWorldScale(new T.Vector3()).x / node.getWorldScale(new T.Vector3()).x;
    pelvisBone.position.copy(pelvisRest).add(dp.applyQuaternion(pelvisBone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(node.getWorldQuaternion(new T.Quaternion()))).divideScalar(parentScale || 1));
    node.updateMatrixWorld(true);
  };
  return { root: node, joints, world, H: H || 1.7, rest: MH_REST, drive, imported: true, mapped: Object.keys(map).length, bindQ };
}

// rest pose: arms relaxed down, fingers as sculpted (no extra curl)
export const MH_REST = { ...Object.fromEntries(Object.entries(HUMAN_REST).filter(([k]) => !/^(thumb|index|middle|ring|pinky)/.test(k))), hipL: [0, 0, -4], hipR: [0, 0, 4], footL: [0, 0, 4], footR: [0, 0, -4] };

function vertexNormals(P, quads) {
  const n = new Float32Array(P.length);
  for (let q = 0; q < quads.length; q += 4) {
    const a = quads[q] * 3, b = quads[q + 1] * 3, c = quads[q + 2] * 3, d = quads[q + 3] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[b], vy = P[d + 1] - P[b + 1], vz = P[d + 2] - P[b + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c, d]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

// Armour for the MakeHuman body: plates are offset copies of the body surface, cut by the joint
// they follow (gaps at the joints), so they fit and bend with the figure.
function armorMH(fig, style) {
  const { root, joints, mesh, mat, bindQ } = fig;
  const med = style !== 'scifi';
  const g = mesh.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, idx = g.index.array;
  const names = mesh.userData.boneNames, nv = P.length / 3;
  const dom = (vi) => { let b = 0, w = -1; for (let k = 0; k < 4; k++) if (sw[vi * 4 + k] > w) { w = sw[vi * 4 + k]; b = si[vi * 4 + k]; } return names[b]; };
  const domW = (vi) => { let w = 0; for (let k = 0; k < 4; k++) w = Math.max(w, sw[vi * 4 + k]); return w; };
  // which joints get plates, and how thick (metres)
  const plate = (n) => {
    if (/^(chest|spine)$/.test(n)) return 0.016;
    if (n === 'pelvis') return 0.02;
    if (/^(shoulder|elbow|hip|knee)[LR]$/.test(n)) return 0.011;
    if (/^(foot|toe)[LR]$/.test(n)) return 0.008;
    if (/^hand[LR]$|^(thumb|index|middle|ring|pinky)/.test(n)) return med ? 0.004 : 0.003;
    if (n === 'head') return 0.03;
    if (/^clav/.test(n)) return 0.02;
    return 0;
  };
  const keep = new Uint8Array(nv), off = new Float32Array(nv), body = mesh.userData.eyeStart || nv; // no plates on the eyeballs
  for (let i = 0; i < body; i++) { const n = dom(i), t = plate(n); if (t && domW(i) > (n === 'head' ? 0.55 : 0.62)) { keep[i] = 1; off[i] = t; } }
  const Q = new Float32Array(P);
  for (let i = 0; i < nv; i++) if (keep[i]) { Q[i * 3] += N[i * 3] * off[i]; Q[i * 3 + 1] += N[i * 3 + 1] * off[i]; Q[i * 3 + 2] += N[i * 3 + 2] * off[i]; }
  // helmet: a smooth egg around the head (no nose, lips or ears showing through)
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const helm = (i) => keep[i] && dom(i) === 'head';
  for (let i = 0; i < nv; i++) if (helm(i)) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); }
  const hc = lo.map((v, k) => (v + hi[k]) / 2), hr = lo.map((v, k) => (hi[k] - v) / 2 + 0.012);
  for (let i = 0; i < nv; i++) if (helm(i)) {
    const d = [0, 1, 2].map((k) => (P[i * 3 + k] - hc[k]) / hr[k]), l = Math.hypot(...d) || 1;
    for (let k = 0; k < 3; k++) Q[i * 3 + k] = hc[k] + d[k] / l * hr[k];
  }
  const tri = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!(keep[a] && keep[b] && keep[c])) continue;
    if (dom(a) !== dom(b) || dom(b) !== dom(c)) continue; // gaps between plates at the joints
    tri.push(a, b, c);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(Q, 3));
  geo.setAttribute('skinIndex', g.attributes.skinIndex);
  geo.setAttribute('skinWeight', g.attributes.skinWeight);
  geo.setIndex(new T.BufferAttribute(new Uint32Array(tri), 1));
  geo.computeVertexNormals();
  const am = med ? stdMat('#9ea4ab', { metalness: 0.55, roughness: 0.32, side: T.DoubleSide }) : stdMat('#e9ebef', { metalness: 0.08, roughness: 0.38, side: T.DoubleSide });
  for (const [n, q] of Object.entries(bindQ)) joints[n].quaternion.copy(q);
  root.updateMatrixWorld(true);
  const m = new T.SkinnedMesh(geo, am); root.add(m); root.updateMatrixWorld(true); m.bind(mesh.skeleton, mesh.bindMatrix); m.frustumCulled = false; m.name = 'armor'; m.raycast = () => {}; // taps go to the body underneath
  for (const n of Object.keys(bindQ)) joints[n].quaternion.identity();
  root.updateMatrixWorld(true);
  mat.color.set(med ? '#5d5953' : '#2b2e35');
  return m;
}

// ───────── auto-rig: make an unrigged human model posable ─────────
// For a standing figure (T- or A-pose, facing +Z or -Z): landmarks come from the mesh itself
// (height, where the hands and feet are, the body's centre line), a Mixamo-named skeleton is
// placed on them, and every vertex is skinned to its nearest bones (arms never mix with legs,
// left never with right). rigImported then poses it like any rigged model.
export function autoRigHumanoid(node, opt = {}) {
  node.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(node.matrixWorld).invert();
  const meshes = [];
  node.traverse((o) => { if (o.isMesh && (opt.landmarksOnly || !o.isSkinnedMesh) && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  if (!meshes.length) return false;
  // all vertices in the node's space
  const parts = meshes.map((m) => { const g = m.geometry.index ? m.geometry : m.geometry; const mw = new T.Matrix4().multiplyMatrices(inv, m.matrixWorld); const p = g.attributes.position; const a = new Float32Array(p.count * 3); const v = new T.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mw); a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z; } return { m, mw, a }; });
  let minY = Infinity, maxY = -Infinity, sx = 0, sz = 0, n = 0;
  for (const { a } of parts) for (let i = 0; i < a.length; i += 3) { minY = Math.min(minY, a[i + 1]); maxY = Math.max(maxY, a[i + 1]); sx += a[i]; sz += a[i + 2]; n++; }
  const H0 = maxY - minY; if (!(H0 > 0)) return false;
  const cx = sx / n;
  // shoulders: scanning down from the top, where the body suddenly gets wide (head / neck →
  // shoulders or outstretched arms). Proportions are measured from there, so a model without
  // a head (or with a hat) still gets its joints in the right places
  const SL = 120, wid = new Float32Array(SL);
  for (const { a } of parts) for (let i = 0; i < a.length; i += 3) { const k = Math.min(SL - 1, Math.floor((a[i + 1] - minY) / H0 * SL)); wid[k] = Math.max(wid[k], Math.abs(a[i] - cx)); }
  let topW = 0; for (let k = SL - 1; k >= SL - 4; k--) topW = Math.max(topW, wid[k]);
  let shK = -1;
  for (let k = SL - 2; k > SL * 0.55; k--) if (wid[k] > Math.max(topW * 1.7, H0 * 0.07)) { shK = k; break; }
  const shoulderY = shK > 0 ? minY + (shK + 0.5) / SL * H0 : minY + 0.81 * H0;
  const H = Math.max(H0 * 0.85, (shoulderY - minY) / 0.81);
  const Y = (f) => minY + f * H;
  // facing: the toes stick out in front of the heels (more vertices ahead of the ankle centre)
  let zFront = 0, zBack = 0, zc = 0, nz = 0;
  for (const { a } of parts) for (let i = 0; i < a.length; i += 3) if (a[i + 1] < Y(0.04)) { zc += a[i + 2]; nz++; }
  zc = nz ? zc / nz : sz / n;
  for (const { a } of parts) for (let i = 0; i < a.length; i += 3) if (a[i + 1] < Y(0.04)) { if (a[i + 2] > zc) zFront += a[i + 2] - zc; else zBack += zc - a[i + 2]; }
  const flip = zBack > zFront * 1.15; // facing -Z: mirror the landmark z / left-right
  const L = flip ? -1 : 1; // the figure's left is +X when it faces +Z
  // body centre (x, z) in a height band, from vertices near the middle
  const centre = (y0, y1, wx) => { let x = 0, z = 0, k = 0; for (const { a } of parts) for (let i = 0; i < a.length; i += 3) { const y = a[i + 1]; if (y >= y0 && y <= y1 && Math.abs(a[i] - cx) < wx) { x += a[i]; z += a[i + 2]; k++; } } return k ? [x / k, z / k] : [cx, zc]; };
  const torso = (f) => { const [x, z] = centre(Y(f - 0.03), Y(f + 0.03), H * 0.09); return [x, Y(f), z]; };
  // hands: the vertex farthest out on each side above the hips
  const tip = (s) => { let best = null, bx = -Infinity; for (const { a } of parts) for (let i = 0; i < a.length; i += 3) { if (a[i + 1] < Y(0.3)) continue; const d = s * L * (a[i] - cx); if (d > bx) { bx = d; best = [a[i], a[i + 1], a[i + 2]]; } } return best; };
  const foot = (s) => { let x = 0, z = 0, k = 0; for (const { a } of parts) for (let i = 0; i < a.length; i += 3) if (a[i + 1] < Y(0.06) && s * L * (a[i] - cx) > 0) { x += a[i]; z += a[i + 2]; k++; } return k ? [x / k, z / k] : [cx + s * L * H * 0.06, zc]; };
  const J = {};
  J.pelvis = torso(0.53); J.spine = torso(0.6); J.chest = torso(0.7); J.neck = torso(0.84); J.head = torso(0.875);
  J.headTop = [J.head[0], Math.max(maxY, Y(1)), J.head[2]];
  const lerp = (p, q, t) => p.map((x, i) => x + (q[i] - x) * t);
  for (const [s, S] of [[1, 'L'], [-1, 'R']]) {
    const sh = [J.chest[0] + s * L * H * 0.1, Y(0.81), J.chest[2]];
    const t = tip(s);
    J['clav' + S] = [J.chest[0] + s * L * H * 0.025, Y(0.8), J.chest[2]];
    J['shoulder' + S] = sh;
    const reach = t && Math.abs(t[0] - sh[0]) > H * 0.12 ? t : [sh[0] + s * L * H * 0.08, Y(0.42), sh[2]];
    J['elbow' + S] = lerp(sh, reach, 0.44);
    J['hand' + S] = lerp(sh, reach, 0.83);
    J['handTip' + S] = reach;
    const [fx, fz] = foot(s);
    J['hip' + S] = [J.pelvis[0] + s * L * H * 0.055, Y(0.5), J.pelvis[2]];
    J['foot' + S] = [fx, Y(0.045), fz - L * 0 ];
    J['knee' + S] = lerp(J['hip' + S], J['foot' + S], 0.5);
    J['toe' + S] = [fx, Y(0.012), fz + (flip ? -1 : 1) * H * 0.06];
    J['toeTip' + S] = [fx, Y(0.01), fz + (flip ? -1 : 1) * H * 0.1];
  }
  if (opt.landmarksOnly) return { J, L, H, cx, minY };
  // skeleton (Mixamo names, so rigImported maps it)
  const SPEC = [['pelvis', 'Hips', null], ['spine', 'Spine', 'pelvis'], ['chest', 'Spine2', 'spine'], ['neck', 'Neck', 'chest'], ['head', 'Head', 'neck']];
  for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) SPEC.push(['clav' + S, side + 'Shoulder', 'chest'], ['shoulder' + S, side + 'Arm', 'clav' + S], ['elbow' + S, side + 'ForeArm', 'shoulder' + S], ['hand' + S, side + 'Hand', 'elbow' + S],
    ['hip' + S, side + 'UpLeg', 'pelvis'], ['knee' + S, side + 'Leg', 'hip' + S], ['foot' + S, side + 'Foot', 'knee' + S], ['toe' + S, side + 'ToeBase', 'foot' + S]);
  const bones = [], bi = {};
  for (const [k, name, par] of SPEC) {
    const b = new T.Bone(); b.name = name;
    const p = J[k], pp = par ? J[par] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (par) bones[bi[par]].add(b);
    bi[k] = bones.length; bones.push(b);
  }
  const TAIL = { pelvis: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: 'headTop' };
  for (const S of ['L', 'R']) Object.assign(TAIL, { ['clav' + S]: 'shoulder' + S, ['shoulder' + S]: 'elbow' + S, ['elbow' + S]: 'hand' + S, ['hand' + S]: 'handTip' + S, ['hip' + S]: 'knee' + S, ['knee' + S]: 'foot' + S, ['foot' + S]: 'toe' + S, ['toe' + S]: 'toeTip' + S });
  const segs = SPEC.map(([k]) => ({ k, a: new T.Vector3(...J[k]), b: new T.Vector3(...J[TAIL[k]]), side: /L$/.test(k) ? 'L' : /R$/.test(k) ? 'R' : '', limb: /^(clav|shoulder|elbow|hand)/.test(k) ? 'arm' : /^(hip|knee|foot|toe)/.test(k) ? 'leg' : 'body' }));
  const parentOf = Object.fromEntries(SPEC.map(([k, , p]) => [k, p]));
  const near = (i, j) => { const a = segs[i].k, b = segs[j].k; return parentOf[a] === b || parentOf[b] === a || parentOf[a] === parentOf[b]; };
  const P = new T.Vector3(), ab = new T.Vector3(), ap = new T.Vector3();
  const dist = (s) => { ab.subVectors(s.b, s.a); ap.subVectors(P, s.a); const t = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1))); return P.distanceTo(ab.multiplyScalar(t).add(s.a)); };
  // torso half-width: the median |x| of the vertices at chest and waist height that are within
  // the shoulders (arms hanging at the sides are farther out)
  const xs = [];
  for (const { a } of parts) for (let i = 0; i < a.length; i += 3) { const y = a[i + 1]; if (y > Y(0.6) && y < Y(0.72)) { const dx = Math.abs(a[i] - cx); if (dx < H * 0.14) xs.push(dx); } }
  xs.sort((p, q) => p - q);
  const torsoHalf = xs.length ? Math.min(H * 0.11, xs[Math.floor(xs.length * 0.9)] * 1.02) : H * 0.085;
  // every bone is a capsule with its own thickness (the torso an ellipse: wide, less deep), and a
  // vertex belongs to the bone it is nearest to *in units of that thickness* — so the side of the
  // chest stays with the chest even when an arm hangs right next to it
  const zs = [];
  for (const { a } of parts) for (let i = 0; i < a.length; i += 3) { const y = a[i + 1]; if (y > Y(0.6) && y < Y(0.72) && Math.abs(a[i] - cx) < torsoHalf * 0.6) zs.push(Math.abs(a[i + 2] - J.chest[2])); }
  zs.sort((p, q) => p - q);
  const torsoDepth = zs.length ? Math.max(H * 0.045, Math.min(H * 0.11, zs[Math.floor(zs.length * 0.9)] * 1.02)) : H * 0.065;
  const R0 = { pelvis: 0, spine: 0, chest: 0, neck: 0.035, head: 0.075, clav: 0.04, shoulder: 0.04, elbow: 0.035, hand: 0.03, hip: 0.065, knee: 0.05, foot: 0.04, toe: 0.03 };
  const sst = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  segs.forEach((sg, i) => {
    const base = sg.k.replace(/[LR]$/, '');
    sg.torso = ['pelvis', 'spine', 'chest'].includes(base);
    sg.r = sg.torso ? torsoHalf : R0[base] * H; sg.rz = sg.torso ? torsoDepth : sg.r;
    sg.dir = sg.b.clone().sub(sg.a); sg.len = sg.dir.length() || 1e-6; sg.dir.divideScalar(sg.len);
    sg.par = parentOf[sg.k] ? segs.findIndex((x) => x.k === parentOf[sg.k]) : -1;
  });
  const cp = new T.Vector3();
  const ndist = (sg) => {
    ap.subVectors(P, sg.a); const t = Math.max(0, Math.min(sg.len, ap.dot(sg.dir)));
    cp.copy(sg.dir).multiplyScalar(t).add(sg.a);
    const dx = P.x - cp.x, dy = P.y - cp.y, dz = P.z - cp.z;
    return sg.torso ? Math.sqrt((dx / sg.r) ** 2 + (dy / sg.r) ** 2 + (dz / sg.rz) ** 2) : Math.sqrt(dx * dx + dy * dy + dz * dz) / sg.r;
  };
  const nearest = (out) => {
    const side = L * (P.x - cx) > H * 0.02 ? 'L' : L * (P.x - cx) < -H * 0.02 ? 'R' : '';
    let best = 0, bd = Infinity;
    for (let i = 0; i < segs.length; i++) { let x = ndist(segs[i]); if (segs[i].side && side && segs[i].side !== side) x *= 4; if (out) out[i] = x; if (x < bd) { bd = x; best = i; } }
    return best;
  };
  // the limbs' real thickness (armour, sleeves, a thin or heavy build): the usual distance of
  // the vertices each bone got on a first pass
  {
    const acc = segs.map(() => []);
    for (const { a } of parts) { const step = Math.max(1, Math.floor(a.length / 3 / 60000)); for (let i = 0; i < a.length; i += 3 * step) { P.set(a[i], a[i + 1], a[i + 2]); const bst = nearest(null); if (!segs[bst].torso) acc[bst].push(ndist(segs[bst]) * segs[bst].r); } }
    segs.forEach((sg, i) => { if (sg.torso || acc[i].length < 12) return; acc[i].sort((p, q) => p - q); const med = acc[i][Math.floor(acc[i].length * 0.75)]; sg.r = sg.rz = Math.max(sg.r * 0.6, Math.min(sg.r * 1.8, med)); });
    // left and right alike
    for (const sg of segs) if (sg.side === 'L') { const o = segs.find((x) => x.k === sg.k.replace(/L$/, 'R')); if (o) { const m = (sg.r + o.r) / 2; sg.r = sg.rz = o.r = o.rz = m; } }
  }
  const skeleton = new T.Skeleton(bones);
  // everything goes into one group placed first under the node (rigImported turns that child)
  const holder = new T.Group(); holder.name = 'autorig';
  holder.add(bones[0]);
  for (const { m, a } of parts) {
    const g = m.geometry.clone(), cnt = g.attributes.position.count;
    // geometry baked into the node's space (the skinned mesh sits at the node's origin)
    g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const NB = segs.length, W = new Float32Array(cnt * NB);
    const dn = new Float32Array(NB);
    for (let v = 0; v < cnt; v++) {
      P.set(a[v * 3], a[v * 3 + 1], a[v * 3 + 2]);
      const best = nearest(dn);
      // rigid on its own bone; shared with the bone across a joint only in a band around that joint
      const B = segs[best], zb = B.r;
      let rest = 1;
      for (let i = 0; i < NB; i++) {
        if (i === best) continue;
        const S = segs[i]; let s, z;
        if (B.par === i) { s = -(P.clone().sub(B.a).dot(B.dir)); z = Math.max(zb, S.r); }       // towards the parent: before this bone's start
        else if (S.par === best) { s = P.clone().sub(S.a).dot(S.dir); z = Math.max(zb, S.r); }  // towards a child: past the child's start
        else continue;
        z *= 1.1;
        const along = sst(-z, z, s), close = 1 - sst(1.05, 1.9, dn[i] / Math.max(1e-6, dn[best]));
        const w = along * close;
        if (w > 0.002) { W[v * NB + i] = w; rest *= 1 - w; }
      }
      W[v * NB + best] = Math.max(rest, 0.02);
    }
    // smooth the weights over the surface (shared positions count as one point, so UV seams
    // can't tear), then keep the four strongest
    const key = new Map(), grp = new Int32Array(cnt);
    for (let v = 0; v < cnt; v++) { const k = Math.round(a[v * 3] / H * 2000) + ',' + Math.round(a[v * 3 + 1] / H * 2000) + ',' + Math.round(a[v * 3 + 2] / H * 2000); let gi = key.get(k); if (gi === undefined) { gi = key.size; key.set(k, gi); } grp[v] = gi; }
    const G = key.size, GW = new Float32Array(G * NB), gc = new Float32Array(G);
    const norm = (arr, base) => { let t = 0; for (let i = 0; i < NB; i++) t += arr[base + i]; if (t > 0) for (let i = 0; i < NB; i++) arr[base + i] /= t; };
    for (let v = 0; v < cnt; v++) { norm(W, v * NB); for (let i = 0; i < NB; i++) GW[grp[v] * NB + i] += W[v * NB + i]; gc[grp[v]]++; }
    for (let gi = 0; gi < G; gi++) norm(GW, gi * NB);
    const idx = g.index ? g.index.array : null, tris = idx ? idx.length : cnt;
    const nbr = Array.from({ length: G }, () => new Set());
    for (let t = 0; t + 2 < tris; t += 3) { const p0 = grp[idx ? idx[t] : t], p1 = grp[idx ? idx[t + 1] : t + 1], p2 = grp[idx ? idx[t + 2] : t + 2]; nbr[p0].add(p1).add(p2); nbr[p1].add(p0).add(p2); nbr[p2].add(p0).add(p1); }
    let cur = GW, nxt = new Float32Array(G * NB);
    for (let it = 0; it < 2; it++) {
      for (let gi = 0; gi < G; gi++) {
        const ns = nbr[gi], k = 1 / (ns.size + 1);
        for (let i = 0; i < NB; i++) { let t = cur[gi * NB + i]; for (const n of ns) t += cur[n * NB + i]; nxt[gi * NB + i] = t * k; }
      }
      [cur, nxt] = [nxt, cur];
    }
    const si = new Uint16Array(cnt * 4), sw = new Float32Array(cnt * 4);
    for (let v = 0; v < cnt; v++) {
      const base = grp[v] * NB, top = [];
      for (let i = 0; i < NB; i++) { const w = cur[base + i]; if (w > 0.01) top.push([w, i]); }
      top.sort((x, y) => y[0] - x[0]); top.length = Math.min(4, top.length);
      const t = top.reduce((x, y) => x + y[0], 0) || 1;
      top.forEach(([w, i], k) => { si[v * 4 + k] = i; sw[v * 4 + k] = w / t; });
      if (!top.length) { si[v * 4] = 0; sw[v * 4] = 1; }
    }
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
    const sm = new T.SkinnedMesh(g, m.material);
    sm.name = m.name; sm.castShadow = m.castShadow; sm.frustumCulled = false;
    holder.add(sm);
    m.parent.remove(m);
  }
  node.add(holder); node.children.splice(node.children.indexOf(holder), 1); node.children.unshift(holder);
  node.updateMatrixWorld(true);
  skeleton.calculateInverses(); // the bones are in place only now
  for (const o of holder.children) if (o.isSkinnedMesh) o.bind(skeleton, o.matrixWorld.clone());
  return true;
}

// A rigged model whose bone names mean nothing (joint32_01, Bone.017…): the skeleton's own
// shape says which bone is which. In the bind pose: the feet are the lowest bones of the two
// legs, the hips are where legs and spine split, the hands are where the fingers branch, the
// chest is where the arms split, and elbows / knees sit midway along their limbs. Props held in
// a hand (a sword with its own bones) just follow that hand. Returns a mapNames function for
// rigImported, or null.
export function geometricRigMap(node) {
  const skins = []; node.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  if (!skins.length) return null;
  // the model's own pose, kept for the bones that aren't body joints (a sword in the hand,
  // a gripping hand's fingers): they go back to it once the body bones are matched
  const bones = []; node.traverse((o) => { if (o.isBone) bones.push(o); });
  if (bones.length < 12) return null;
  const own = new Map(bones.map((b) => [b, [b.position.clone(), b.quaternion.clone(), b.scale.clone()]]));
  for (const m of skins) m.skeleton.pose(); // bind pose: usually a T- or A-pose
  node.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(node.matrixWorld).invert();
  const P = new Map(bones.map((b) => [b, b.getWorldPosition(new T.Vector3()).applyMatrix4(inv)]));
  const kids = (b) => b.children.filter((c) => c.isBone);
  const desc = (b) => { const out = []; const w = (x) => { for (const c of kids(x)) { out.push(c); w(c); } }; w(b); return out; };
  const pathTo = (from, to) => { const p = []; for (let q = to; q && q !== from; q = q.parent) p.unshift(q); return p[0] && p[0].parent === from || from === to ? [from, ...p] : [from, ...p]; };
  const anc = (b) => { const a = []; for (let q = b; q; q = q.parent) a.push(q); return a; };
  const lca = (a, b) => { const s = new Set(anc(a)); for (let q = b; q; q = q.parent) if (s.has(q)) return q; return null; };
  let minY = Infinity, maxY = -Infinity; for (const [b, p] of P) { if (kids(b).length > 1 && desc(b).length > bones.length * 0.8) continue; minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const H = maxY - minY; if (!(H > 0)) return null;
  // hands: bones with three or more child chains (fingers) above the knees
  // (finger chains start close to the wrist; a held prop's bones may hang off the hand too)
  const fingers = (b) => kids(b).filter((c) => P.get(c).distanceTo(P.get(b)) < 0.13 * H && desc(c).length <= 5).length;
  const hands = bones.filter((b) => fingers(b) >= 3 && P.get(b).y > minY + 0.3 * H);
  // feet: the lowest leaf-ish bones, one each side of the body's middle
  const low = bones.filter((b) => P.get(b).y < minY + 0.12 * H && desc(b).length <= 6); // feet / toes, not a root bone on the floor
  if (low.length < 2) return null;
  // the body's middle: halfway between the outermost low bones (the two feet); a held prop or a
  // hand full of finger bones can't pull it sideways
  const lx = low.map((b) => P.get(b).x), midX = (Math.min(...lx) + Math.max(...lx)) / 2;
  const lowL = low.filter((b) => P.get(b).x > midX), lowR = low.filter((b) => P.get(b).x <= midX);
  if (!lowL.length || !lowR.length) return null;
  const top = bones.reduce((a, b) => (P.get(b).y > P.get(a).y ? b : a));
  const pelvis = lca(lca(lowL[0], lowR[0]), top); if (!pelvis) return null;
  const spinePath = pathTo(pelvis, top);
  // chest: where the two arms split (or 70% up the spine)
  let handA = null, handB = null;
  if (hands.length >= 2) { const hs = hands.slice().sort((a, b) => P.get(a).x - P.get(b).x); handA = hs[hs.length - 1]; handB = hs[0]; }
  const chest = handA && handB ? lca(handA, handB) : spinePath[Math.round(spinePath.length * 0.7)];
  const along = (path, f) => { // the path bone nearest the point f of the way along it
    const a = P.get(path[0]), b = P.get(path[path.length - 1]), t = a.clone().lerp(b, f);
    return path.reduce((x, y) => (P.get(y).distanceTo(t) < P.get(x).distanceTo(t) ? y : x));
  };
  const map = {};
  const put = (k, b) => { if (b) map[k] = { bone: b, name: b.name }; };
  put('pelvis', pelvis);
  const sp = pathTo(pelvis, chest); put('chest', chest); if (sp.length > 2) put('spine', sp[Math.floor(sp.length / 2)]);
  const up = pathTo(chest, top).slice(1);
  // head: the highest bone that still has a child (the top leaf is usually "head_end"), neck below it
  const head = up.length > 1 && !kids(top).length ? up[up.length - 2] : up[up.length - 1] || top;
  put('head', head); const hi = up.indexOf(head); if (hi > 0) put('neck', up[hi - 1]);
  // facing: toes ahead of ankles → +Z; the figure's left is then +X
  const legPath = (lows) => { const end = lows.reduce((a, b) => (desc(a).length > desc(b).length ? a : b)); const leaf = [end, ...desc(end)].reduce((a, b) => (P.get(b).y < P.get(a).y ? b : a)); return pathTo(pelvis, leaf).slice(1); };
  const legA = legPath(lowL), legB = legPath(lowR);
  const footOf = (leg) => { const yb = minY + 0.035 * H; let f = leg[leg.length - 1]; for (const b of leg) if (P.get(b).y > yb) f = b; return f; };
  const fA = footOf(legA), tA = legA[legA.indexOf(fA) + 1];
  const facePlus = !tA || P.get(tA).z >= P.get(fA).z;
  const leftIsA = facePlus; // A is the +X side
  const sides = [[leftIsA ? 'L' : 'R', legA, handA], [leftIsA ? 'R' : 'L', legB, handB]];
  for (const [S, leg, hand] of sides) {
    const foot = footOf(leg), fi = leg.indexOf(foot);
    put('hip' + S, leg[0]); put('foot' + S, foot); put('toe' + S, leg[fi + 1]);
    const thigh = leg.slice(0, fi + 1); put('knee' + S, thigh.length > 2 ? along(thigh, 0.5) : null);
    if (hand) {
      const arm = pathTo(chest, hand).slice(1); // clavicle? → shoulder → elbow → hand
      if (arm.length >= 3) {
        const first = arm[0], clavLike = P.get(first).distanceTo(P.get(chest)) < 0.12 * H && arm.length >= 4;
        const sh = clavLike ? arm[1] : arm[0]; if (clavLike) put('clav' + S, first);
        put('shoulder' + S, sh); put('hand' + S, hand);
        const seg = arm.slice(arm.indexOf(sh)); put('elbow' + S, seg.length > 2 ? along(seg, 0.5) : null);
      }
    }
  }
  const body = new Set(Object.values(map).map((x) => x.bone));
  for (const b of bones) if (!body.has(b) && !b.children.some((c) => body.has(c)) && !desc(b).some((d) => body.has(d))) { const [p, q, sc] = own.get(b); b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc); }
  node.updateMatrixWorld(true);
  return () => map;
}

// ───────── planar drawing figures ─────────
// "Planar Human Base Rigs" by dacancino (after Alexander Lee's rig), CC Attribution: one file
// with a male and a female planar figure. Each is loaded on its own, shaped by the body
// settings (musculature, fat, chest, breast, waist, hips, butt, limb thickness, head, hands,
// feet) and posed through its own skeleton like every other figure.
let planarBuf = null;
const PLANAR_MAP = { pelvis: 'pelvis_torsoControl', spine: 'lumbar2', chest: 'ribcage', neck: 'neck1', head: 'head',
  clav: 'clavicle', shoulder: 'upperArm', elbow: 'foreArm', hand: 'hand', hip: 'thigh', knee: 'calf', foot: 'footControl', toe: 'footToes' };
export const PLANAR_DEFAULT = { armLen: 0.5, legLen: 0.5, muscle: 0.5, fat: 0.5, chest: 0.5, breast: 0.5, breastSize: 0.5, waist: 0.5, hips: 0.5, butt: 0.5, buttSize: 0.5, shoulders: 0.5, traps: 0.5, neck: 0.5, head: 0.5, arms: 0.5, forearms: 0.5, wrist: 0.5, hands: 0.5, thighs: 0.5, calves: 0.5, feet: 0.5 };
export async function buildPlanar(body = {}, color = '#c9c6c1') {
  planarBuf ||= fetch(new URL('../vendor/models/planar-humans.glb', import.meta.url)).then((r) => { if (!r.ok) throw new Error('figure model missing'); return r.arrayBuffer(); });
  const gltf = await new Promise(async (res, rej) => new T.GLTFLoader().parse((await planarBuf).slice(0), '', res, rej));
  const male = body.sex === 'male';
  const skinned = []; gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  gltf.scene.updateMatrixWorld(true);
  // the male stands at the origin, the female beside it
  skinned.sort((a, b) => Math.abs(new T.Box3().setFromObject(a).getCenter(new T.Vector3()).x) - Math.abs(new T.Box3().setFromObject(b).getCenter(new T.Vector3()).x));
  const mesh = skinned[male ? 0 : 1] || skinned[0];
  if (!mesh) throw new Error('figure model has no body');
  // keep only this figure: its mesh and its skeleton
  const keep = new Set(); for (let o = mesh; o; o = o.parent) keep.add(o);
  for (const b of mesh.skeleton.bones) { for (let o = b; o; o = o.parent) keep.add(o); b.traverse((c) => keep.add(c)); }
  const drop = []; gltf.scene.traverse((o) => { if (!keep.has(o)) drop.push(o); });
  for (const o of drop) if (o.parent) o.parent.remove(o);
  // arm / leg length: the skeleton itself is lengthened (elbows, knees, hands, feet move), so
  // posing still bends in the right places
  const nsk = (x) => { const r = ((x ?? 0.5) - 0.5) * 2; return body.noShrink ? Math.max(0, r) : r; };
  const armK = 1 + 0.3 * nsk(body.armLen), legK = 1 + 0.3 * nsk(body.legLen);
  if (armK !== 1 || legK !== 1) { gltf.scene.updateMatrixWorld(true); try { lengthenLimbs(mesh, armK, legK); } catch (e) { console.warn("limb length", e); } mesh.boundingBox = null; mesh.boundingSphere = null; gltf.scene.updateMatrixWorld(true); }
  // centred on the floor, at the body's height
  const box = new T.Box3().setFromObject(mesh), H0 = box.max.y - box.min.y, cxm = (box.min.x + box.max.x) / 2;
  const height = body.height || (male ? 1.75 : 1.62), k = height / H0;
  const inner = new T.Group(); inner.add(gltf.scene);
  gltf.scene.position.set(-cxm, -box.min.y, 0);
  inner.scale.setScalar(k);
  const node = new T.Group(); node.add(inner); node.updateMatrixWorld(true);
  // the model's own normals carry its planes: no flat shading, no recomputed normals
  const mat = new T.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 });
  mesh.material = mat; mesh.castShadow = true; mesh.frustumCulled = false;
  try { addPlanarFingers(mesh); } catch (e) { console.warn('finger joints', e); }
  try { refineChest(mesh); } catch (e) { console.warn('chest detail', e); }
  mesh.geometry = mesh.geometry.clone();
  const basePos = mesh.geometry.attributes.position.array.slice(), baseNrm = mesh.geometry.attributes.normal.array.slice();
  mesh.geometry.userData.basePos = basePos;
  mesh.geometry.userData.adj = pointGraph(mesh.geometry);
  shapePlanar(mesh, { ...PLANAR_DEFAULT, ...body }, H0, true);
  const base = (n) => (n || '').replace(/_\d+$/, '');
  const mapNames = (list) => {
    const map = {};
    for (const it of list) {
      const raw = base(it.bone.userData.name || it.rawName || it.name), m = /^(.*?)\.([LR])$/.exec(raw);
      const fm = /^(thumb|index|middle|ring|pinky)(\d)\.([LR])$/.exec(raw);
      if (fm) { map[fm[1] + fm[3] + fm[2]] = it; continue; }
      for (const [ours, theirs] of Object.entries(PLANAR_MAP)) {
        if (m && m[1] === theirs && !map[ours + m[2]]) map[ours + m[2]] = it;
        else if (!m && raw === theirs && !map[ours]) map[ours] = it;
      }
    }
    return map;
  };
  const fig = rigImported(node, mapNames);
  if (!fig) throw new Error('figure rig not recognised');
  // the feet hang off the rig's root (old IK controls), not off the legs: they are carried by
  // our foot joints
  node.updateMatrixWorld(true);
  const feet = [];
  for (const S of ['L', 'R']) {
    const bone = mesh.skeleton.bones.find((b) => base(b.userData.name || b.name) === 'footControl.' + S), joint = fig.joints['foot' + S];
    if (bone && joint) feet.push({ bone, joint, off: new T.Matrix4().copy(joint.matrixWorld).invert().multiply(bone.matrixWorld) });
  }
  const drive0 = fig.drive, tmp = new T.Matrix4(), sc = new T.Vector3();
  fig.drive = () => {
    drive0();
    for (const f of feet) {
      tmp.copy(f.bone.parent.matrixWorld).invert().multiply(f.joint.matrixWorld).multiply(f.off);
      tmp.decompose(f.bone.position, f.bone.quaternion, sc);
    }
    node.updateMatrixWorld(true);
  };
  // at rest the figure stands the way it was modelled (arms relaxed, palms in), not in the
  // generic rest pose, which twisted its forearms
  const rest = {};
  const R2D = 180 / Math.PI;
  for (const [n, q] of Object.entries(fig.bindQ || {})) { const e = new T.Euler().setFromQuaternion(q); rest[n] = [e.x * R2D, e.y * R2D, e.z * R2D]; }
  fig.rest = rest;
  fig.mat = mat; fig.planar = true; fig.H = height;
  // live body edits: the shape is worked out again on this same mesh (no reload of the model),
  // height scales the whole figure; only a change of sex needs a new build
  fig.sex = male ? 'male' : 'female'; fig.limbs = (body.armLen ?? 0.5) + '|' + (body.legLen ?? 0.5) + '|' + !!body.noShrink; fig.builtHeight = height; fig.hk = 1;
  fig.reshape = (b) => {
    const g = mesh.geometry; g.attributes.position.array.set(basePos); g.attributes.normal.array.set(baseNrm);
    shapePlanar(mesh, { ...PLANAR_DEFAULT, ...b }, H0, true);
    fig.hk = (b.height || height) / height;
  };
  return fig;
}

// Longer / shorter arms and legs: each limb's two segments are stretched along their own line
// (thickness kept), and everything past them (hand and fingers, foot) moves along. Done on the
// bind pose — the bones and the skin together — before the figure is rigged.
function lengthenLimbs(mesh, armK, legK) {
  const sk = mesh.skeleton, bones = sk.bones, names = bones.map((bn) => (bn.userData.name || bn.name || '').replace(/_\d+$/, ''));
  const bindInv = new T.Matrix4().copy(mesh.bindMatrix).invert();
  const world = bones.map((_, k) => sk.boneInverses[k].clone().invert());
  const head = (k) => new T.Vector3().setFromMatrixPosition(world[k]).applyMatrix4(bindInv);
  const at = (nm) => { const k = names.indexOf(nm); return k < 0 ? null : head(k); };
  const chains = [];
  for (const S of ['L', 'R']) {
    if (armK !== 1) { const A = at('upperArm.' + S), B = at('foreArm.' + S), C = at('hand.' + S); if (A && B && C) chains.push({ k: armK, A, B, C, seg: (n) => n.endsWith('.' + S) ? (/^upperArm/.test(n) ? 1 : /^foreArm/.test(n) ? 2 : /^(hand|thumb|index|middle|ring|pinky)/.test(n) ? 3 : 0) : 0 }); }
    if (legK !== 1) { const A = at('thigh.' + S), B = at('calf.' + S), C = at('footControl.' + S) || at('foot.' + S); if (A && B && C) chains.push({ k: legK, A, B, C, seg: (n) => n.endsWith('.' + S) ? (/^thigh/.test(n) ? 1 : /^calf/.test(n) ? 2 : /^(foot|toe)/.test(n) ? 3 : 0) : 0 }); }
  }
  if (!chains.length) return;
  for (const c of chains) { c.B2 = c.A.clone().add(c.B.clone().sub(c.A).multiplyScalar(c.k)); c.C2 = c.B2.clone().add(c.C.clone().sub(c.B).multiplyScalar(c.k)); }
  // where a point of a segment goes: stretched along the segment, the rest of it kept
  const mapPt = (c, seg, p) => {
    if (seg === 3) return p.clone().add(c.C2).sub(c.C);
    const P0 = seg === 1 ? c.A : c.B, P1 = seg === 1 ? c.B : c.C, Q0 = seg === 1 ? c.A : c.B2;
    const ax = P1.clone().sub(P0), L = ax.length(); ax.divideScalar(L || 1);
    const rel = p.clone().sub(P0), t = rel.dot(ax);
    return Q0.clone().add(ax.clone().multiplyScalar(t * c.k)).add(rel.sub(ax.clone().multiplyScalar(t)));
  };
  const mapBone = (k, p) => { for (const c of chains) { const sg = c.seg(names[k]); if (sg) return mapPt(c, sg, p); } return null; };
  // the skin: each point moved by its bones' share
  const g = mesh.geometry = mesh.geometry.clone(), P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const v = new T.Vector3(), acc = new T.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i); acc.set(0, 0, 0); let wsum = 0, moved = false;
    for (let j = 0; j < 4; j++) {
      const w = SW.getComponent(i, j); if (w <= 0) continue;
      const m = mapBone(SI.getComponent(i, j), v);
      if (m) moved = true;
      acc.addScaledVector(m || v, w); wsum += w;
    }
    if (moved && wsum > 0) { acc.divideScalar(wsum); P.setXYZ(i, acc.x, acc.y, acc.z); }
  }
  P.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
  // the bones: new bind positions, then their own transforms and inverses to match
  const newWorld = world.map((W, k) => {
    const m = mapBone(k, head(k)); if (!m) return W.clone();
    const out = W.clone(); out.setPosition(m.applyMatrix4(mesh.bindMatrix)); return out;
  });
  const order = [...bones].sort((a, b) => { let da = 0, db = 0; for (let o = a; o.parent; o = o.parent) da++; for (let o = b; o.parent; o = o.parent) db++; return da - db; });
  for (const bn of order) {
    const k = bones.indexOf(bn), pw = bn.parent ? bn.parent.matrixWorld : new T.Matrix4();
    const local = new T.Matrix4().copy(pw).invert().multiply(newWorld[k]);
    local.decompose(bn.position, bn.quaternion, bn.scale);
    bn.updateMatrixWorld(true);
  }
  for (let k = 0; k < bones.length; k++) sk.boneInverses[k].copy(newWorld[k]).invert();
}

// Finger joints for a hand that came with a single bone. Cut across at 60 % of its length the
// hand falls into four separate pieces — the fingers — and a lower cut leaves the thumb on its
// own. Each gets three bones along its length (same orientation as the hand bone), and the
// hand's vertices are re-skinned to them: rigid along each segment, blended at the knuckles.
function addPlanarFingers(mesh) {
  const g = mesh.geometry = mesh.geometry.clone(), P = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const sk = mesh.skeleton, base = (n) => (n || '').replace(/_\d+$/, '');
  const names = sk.bones.map((bn) => base(bn.userData.name || bn.name));
  const bindInv = new T.Matrix4().copy(mesh.bindMatrix).invert();
  const bones = sk.bones.slice(), inverses = sk.boneInverses.map((m) => m.clone());
  const idx = g.index ? g.index.array : null, nTri = (idx ? idx.length : P.count) / 3;
  const pos = (i) => new T.Vector3().fromBufferAttribute(P, i);
  const key = (i) => Math.round(P.getX(i) * 5000) + ',' + Math.round(P.getY(i) * 5000) + ',' + Math.round(P.getZ(i) * 5000);
  const sst = (a, c, x) => { const t = Math.max(0, Math.min(1, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
  const newSI = Array.from(si.array), newSW = Array.from(sw.array);
  for (const S of ['L', 'R']) {
    const hi = names.indexOf('hand.' + S); if (hi < 0) continue;
    const hv = []; // vertices that follow this hand
    for (let i = 0; i < P.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k); if (w > 0.5) hv.push(i); }
    if (hv.length < 40) continue;
    const handBind = inverses[hi].clone().invert(), wrist = new T.Vector3().setFromMatrixPosition(handBind).applyMatrix4(bindInv);
    // along the hand: wrist → fingertips
    const far = hv.map((i) => [pos(i).distanceTo(wrist), i]).sort((p, q) => q[0] - p[0]).slice(0, Math.ceil(hv.length * 0.12));
    const tipC = far.reduce((t, [, i]) => t.add(pos(i)), new T.Vector3()).divideScalar(far.length);
    // the hand's long axis: the direction its vertices spread most (power iteration on their
    // covariance), pointing from the wrist to the fingertips
    const mean = hv.reduce((t, i) => t.add(pos(i)), new T.Vector3()).divideScalar(hv.length), C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of hv) { const v = pos(i).sub(mean), a3 = [v.x, v.y, v.z]; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] += a3[r] * a3[c]; }
    let d = tipC.clone().sub(wrist).normalize();
    for (let it = 0; it < 40; it++) d.set(C[0] * d.x + C[1] * d.y + C[2] * d.z, C[3] * d.x + C[4] * d.y + C[5] * d.z, C[6] * d.x + C[7] * d.y + C[8] * d.z).normalize();
    if (d.dot(tipC.clone().sub(wrist)) < 0) d.negate();
    const tOf = (i) => pos(i).sub(wrist).dot(d), ts = hv.map(tOf), t0 = Math.min(...ts), t1 = Math.max(...ts);
    const comps = (cut, tv = ts) => { // connected pieces of the hand beyond a cut
      const lo = Math.min(...tv), hiT = Math.max(...tv);
      const ids = new Set(hv.filter((i, k) => tv[k] > lo + cut * (hiT - lo))), par = new Map(), find = (x) => { while (par.has(x) && par.get(x) !== x) x = par.get(x); return x; }, join = (x, y) => { x = find(x); y = find(y); if (x !== y) par.set(x, y); };
      const byPos = new Map(); for (const i of ids) { par.set(i, i); const k = key(i); if (byPos.has(k)) join(i, byPos.get(k)); else byPos.set(k, i); }
      for (let t = 0; t < nTri; t++) { const tri = [0, 1, 2].map((k) => (idx ? idx[t * 3 + k] : t * 3 + k)).filter((v) => ids.has(v)); for (let k = 1; k < tri.length; k++) join(tri[k], tri[0]); }
      const out = new Map(); for (const i of ids) { const r = find(i); if (!out.has(r)) out.set(r, []); out.get(r).push(i); }
      return [...out.values()].sort((p, q) => q.length - p.length);
    };
    let fingers = null; for (const c of [0.6, 0.65, 0.55, 0.7]) { const cs = comps(c).filter((x) => x.length >= 8); if (cs.length === 4) { fingers = cs; break; } }
    if (!fingers) continue;
    const inFinger = new Set(fingers.flat());
    // the thumb: the piece that stands apart from the fingers at a lower cut (the biggest such piece)
    let thumb = null;
    // (measured along the wrist → fingertips line, then along the wrist → middle-of-the-hand line:
    // a thumb held close to the palm only separates on one of them)
    const cAll = hv.reduce((t, i) => t.add(pos(i)), new T.Vector3()).divideScalar(hv.length), d2 = cAll.sub(wrist).normalize(), ts2 = hv.map((i) => pos(i).sub(wrist).dot(d2));
    search: for (const tv of [ts, ts2]) for (const c of [0.4, 0.35, 0.45, 0.3, 0.5, 0.25, 0.2, 0.15]) { const cs = comps(c, tv).filter((x) => x.length >= 6 && x.length < hv.length * 0.25 && !x.some((i) => inFinger.has(i))); if (cs.length) { thumb = cs[0]; break search; } }
    const cen = (list) => list.reduce((t, i) => t.add(pos(i)), new T.Vector3()).divideScalar(list.length);
    const ref = thumb ? cen(thumb) : null;
    // index is the finger nearest the thumb
    const order = fingers.map((f) => [f, cen(f)]);
    if (ref) order.sort((p, q) => p[1].distanceTo(ref) - q[1].distanceTo(ref));
    const defs = [];
    const axisOf = (list, back) => { // a line through the piece: from its near end to its far end, extended back to the knuckle
      const c = cen(list); let ax = new T.Vector3();
      for (const i of list) { const v = pos(i).sub(c); if (v.dot(d) < 0) v.negate(); ax.add(v); }
      ax.normalize(); const ss = list.map((i) => pos(i).sub(c).dot(ax)), s0 = Math.min(...ss), s1 = Math.max(...ss), len = (s1 - s0) * (1 + back);
      const tip = c.clone().add(ax.clone().multiplyScalar(s1)), root = tip.clone().sub(ax.clone().multiplyScalar(len));
      const rad = list.map((i) => { const v = pos(i).sub(c); return v.sub(ax.clone().multiplyScalar(v.dot(ax))).length(); }).sort((p, q) => p - q)[Math.floor(list.length * 0.7)];
      return { root, ax, len, rad };
    };
    ['index', 'middle', 'ring', 'pinky'].forEach((n, k) => defs.push({ n, ...axisOf(order[k][0], 0.55), split: [0, 0.45, 0.74] }));
    if (thumb) defs.push({ n: 'thumb', ...axisOf(thumb, 0.9), split: [0, 0.42, 0.72] });
    // bones: three per finger, oriented like the hand bone
    for (const f of defs) {
      f.bi = []; let parent = bones[hi], parentInv = inverses[hi];
      for (let k = 0; k < 3; k++) {
        const pg = f.root.clone().add(f.ax.clone().multiplyScalar(f.len * f.split[k])), pb = pg.clone().applyMatrix4(mesh.bindMatrix);
        const world = handBind.clone().setPosition(pb), inv = world.clone().invert();
        const bn = new T.Bone(); bn.name = f.n + (k + 1) + S; bn.userData.name = f.n + (k + 1) + '.' + S;
        bn.position.copy(pb).applyMatrix4(parentInv); parent.add(bn);
        f.bi.push(bones.length); bones.push(bn); inverses.push(inv); parent = bn; parentInv = inv;
      }
    }
    // re-skin: the hand's share of each vertex moves to the finger segment it lies on
    for (const i of hv) {
      const p = pos(i); let best = null;
      for (const f of defs) {
        const v = p.clone().sub(f.root), sAl = v.dot(f.ax), r = v.sub(f.ax.clone().multiplyScalar(sAl)).length();
        if (sAl < -0.12 * f.len || sAl > f.len * 1.25 || r > f.rad * 1.9) continue;
        if (!best || r / f.rad < best.q) best = { f, s: sAl / f.len, q: r / f.rad };
      }
      if (!best) continue;
      const { f, s: u } = best, z = 0.07;
      // weights of [hand, seg1, seg2, seg3] at u (0 = knuckle … 1 = tip)
      const k1 = sst(-z, z, u - f.split[0]), k2 = sst(-z, z, u - f.split[1]), k3 = sst(-z, z, u - f.split[2]);
      const wseg = [1 - k1, k1 * (1 - k2), k2 * (1 - k3), k3];
      const inf = new Map(); let wh = 0;
      for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k), w = sw.getComponent(i, k); if (b === hi) wh += w; else if (w > 0) inf.set(b, (inf.get(b) || 0) + w); }
      inf.set(hi, wh * wseg[0]); f.bi.forEach((b, k) => inf.set(b, wh * wseg[k + 1]));
      const top = [...inf].filter(([, w]) => w > 1e-4).sort((p2, q2) => q2[1] - p2[1]).slice(0, 4), tot = top.reduce((t, [, w]) => t + w, 0) || 1;
      for (let k = 0; k < 4; k++) { newSI[i * 4 + k] = top[k] ? top[k][0] : 0; newSW[i * 4 + k] = top[k] ? top[k][1] / tot : 0; }
    }
  }
  if (bones.length === sk.bones.length) return;
  g.setAttribute('skinIndex', new T.Uint16BufferAttribute(newSI, 4));
  g.setAttribute('skinWeight', new T.Float32BufferAttribute(newSW, 4));
  mesh.bind(new T.Skeleton(bones, inverses), mesh.bindMatrix.clone());
}

// body shape: every change is a function of the vertex position only (around the bones' axes
// and a few landmarks found on the mesh), so shared edges never split
function shapePlanar(mesh, b, H, inPlace = false) {
  const g = inPlace ? mesh.geometry : (mesh.geometry = mesh.geometry.clone()), P = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const bindInv = new T.Matrix4().copy(mesh.bindMatrix).invert(); // (bindMatrixInverse follows the mesh around the scene)
  const base = (n) => (n || '').replace(/_\d+$/, '');
  const names = mesh.skeleton.bones.map((bn) => base(bn.userData.name || bn.name));
  // a bone's place in the mesh's own (bind) space: from its bind matrix, not its place in the scene
  const at = (name) => { const k = names.indexOf(name); return k < 0 ? null : new T.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[k].clone().invert()).applyMatrix4(bindInv); };
  const wOf = (v, test) => { let w = 0; for (let k = 0; k < 4; k++) { const n = names[si.getComponent(v, k)]; if (n && test(n)) w += sw.getComponent(v, k); } return w; };
  // slider 0…1 → −1…1; with "sliders only add" (the default) nothing goes below the model's own shape
  const s = (x) => { const r = (x - 0.5) * 2; return b.noShrink ? Math.max(0, r) : r; };
  const gauss = (d, r) => Math.exp(-(d * d) / (r * r));
  const sst = (a, c, x) => { const t = Math.max(0, Math.min(1, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
  const J = {}; for (const n of ['pelvis_torsoControl', 'lumbar1', 'lumbar2', 'ribcage', 'neck1', 'neck2', 'head', 'thigh.L', 'thigh.R', 'calf.L', 'calf.R', 'footControl.L', 'footControl.R', 'upperArm.L', 'upperArm.R', 'foreArm.L', 'foreArm.R', 'hand.L', 'hand.R', 'clavicle.L', 'clavicle.R']) J[n] = at(n);
  if (!J.ribcage || !J['thigh.L']) return;
  const fwd = 1; // the figures face +Z
  const spineX = J.ribcage.x, spineZ = (y) => J.lumbar1.z + (J.neck1.z - J.lumbar1.z) * Math.max(0, Math.min(1, (y - J.lumbar1.y) / (J.neck1.y - J.lumbar1.y)));
  // landmarks on the mesh: the front-most chest point and the back-most seat point of each side
  const lm = { breastL: null, breastR: null, buttL: null, buttR: null };
  const yB0 = J.ribcage.y + (J.neck1.y - J.ribcage.y) * 0.25, yB1 = J.ribcage.y + (J.neck1.y - J.ribcage.y) * 0.62;
  const v = new T.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i); const sd = v.x > spineX ? 'L' : 'R', ax = Math.abs(v.x - spineX);
    if (v.y > yB0 && v.y < yB1 && ax > 0.03 * H && ax < 0.075 * H) { const k = 'breast' + sd; if (!lm[k] || v.z * fwd > lm[k].z * fwd) lm[k] = v.clone(); }
    if (v.y < J.pelvis_torsoControl.y && v.y > J['thigh.L'].y - 0.07 * H && ax > 0.02 * H && ax < 0.09 * H) { const k = 'butt' + sd; if (!lm[k] || v.z * fwd < lm[k].z * fwd) lm[k] = v.clone(); }
  }
  // the top of the shoulder line, half-way from the neck to each shoulder joint (traps)
  for (const sd of ['L', 'R']) {
    const sj = J['upperArm.' + sd]; if (!sj || !J.neck2) continue;
    const xt = spineX + (sj.x - spineX) * 0.5;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (Math.abs(v.x - xt) > 0.015 * H || v.y > J.neck2.y + 0.03 * H || v.y < sj.y - 0.03 * H) continue;
      const k = 'trap' + sd; if (!lm[k] || v.y > lm[k].y) lm[k] = v.clone();
    }
  }
  // female breasts as semi-round balloons on the chest: per side, a sphere through a base circle
  // on the chest (Size widens it) and an apex in front of it (Volume pushes it out). The body is
  // the union of itself and the sphere: only what is inside the balloon moves out onto it, so the
  // middle of the chest and the skin around the breast don't change.
  const balloons = {};
  if (b.sex !== 'male') for (const sd0 of ['L', 'R']) {
    const br = lm['breast' + sd0]; if (!br) continue;
    const sd = Math.sign(br.x - spineX) || 1, bv = Math.max(0, s(b.breast)), bs = Math.max(0, s(b.breastSize));
    if (!bv && !bs) continue;
    // the chest's depth around this breast (where the model's own breast starts)
    const R0 = 0.055 * H; let zs = 0, nz = 0;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); if ((v.x - spineX) * sd <= 0) continue;
      const d = Math.hypot(v.x - br.x, (v.y - br.y) * 0.9); if (d < R0 * 1.0 || d > R0 * 1.3 || v.z < br.z - 0.12 * H) continue;
      if (wOf(i, (n) => n === 'ribcage') < 0.5) continue;
      zs += v.z; nz++;
    }
    const zc = nz ? zs / nz : br.z - 0.5 * R0, p0 = Math.max(0.2 * R0, br.z - zc);
    const base = Math.min(R0 * (0.95 + 0.3 * bs), Math.abs(br.x - spineX) * 0.95);                       // radius of the base on the chest
    const proj = p0 * 0.9 + (0.038 * bv + 0.008 * bs) * H;      // how far the apex stands out
    const r = (base * base + proj * proj) / (2 * proj);          // sphere through base circle and apex
    const ax = new T.Vector3(sd * 0.28, -0.12, 1).normalize();   // breasts point a little out and down
    const apex = new T.Vector3(br.x + sd * 0.1 * base, br.y - 0.15 * base * (bv + bs) / 2, zc).addScaledVector(ax, proj);
    balloons[sd0] = { sd, r, C: apex.clone().addScaledVector(ax, -r), B0: apex.clone().addScaledVector(ax, -proj), ax, br, base };
  }
  const limb = (a, c) => { const A = J[a], B = J[c]; if (!A || !B) return null; const d = B.clone().sub(A), L = d.length(); return { A, d: d.divideScalar(L || 1), L }; };
  const LIMBS = [];
  for (const S of ['L', 'R']) LIMBS.push(
    { ax: limb('upperArm.' + S, 'foreArm.' + S), test: (n) => n === 'upperArm.' + S || n === 'upperArm_rotate.' + S, k: 1 + 0.3 * s(b.arms) + 0.2 * s(b.muscle) + 0.12 * s(b.fat), bulge: 0.16 * s(b.muscle) },
    { ax: limb('foreArm.' + S, 'hand.' + S), test: (n) => n === 'foreArm.' + S || n === 'foreArm_rotate.' + S, k: 1 + 0.3 * s(b.forearms) + 0.14 * s(b.muscle) + 0.1 * s(b.fat), bulge: 0.08 * s(b.muscle),
      // wrist width: the end of the forearm by the hand gets thicker / thinner (and the heel of the hand with it)
      prof: (u) => 0.45 * s(b.wrist ?? 0.5) * sst(0.5, 1.0, u), wristS: S },
    { ax: limb('thigh.' + S, 'calf.' + S), test: (n) => n === 'thigh.' + S, k: 1 + 0.3 * s(b.thighs) + 0.14 * s(b.muscle) + 0.16 * s(b.fat), bulge: 0.1 * s(b.muscle) },
    { ax: limb('calf.' + S, 'footControl.' + S), test: (n) => n === 'calf.' + S, k: 1 + 0.3 * s(b.calves) + 0.12 * s(b.muscle) + 0.1 * s(b.fat), bulge: 0.12 * s(b.muscle) });
  const hipY = J['thigh.L'].y, waistY = J.lumbar2.y, chestY = (J.ribcage.y + J.neck1.y) / 2, shY = J['upperArm.L'].y;
  const c = new T.Vector3(), q = new T.Vector3(), pec = new T.Vector3(), C = new T.Vector3(), dv = new T.Vector3();
  // swell (amt > 0) or flatten the surface near L on the side facing dir (+1 front, −1 back):
  // points move away from a centre inside the body, so the result is round, not a spike;
  // `drop` moves that centre up, so the bottom fills more than the top
  const pad = (v, L, dir, r, amt, drop, w) => {
    if (!amt || (v.z - L.z) * dir < -0.9 * r) return;
    const dx = v.x - L.x, dy = (v.y - L.y) * 1.1, dz = (v.z - L.z) * 0.6, d2 = (dx * dx + dy * dy + dz * dz) / (r * r);
    if (d2 >= 1) return;
    const f = (1 - d2) * (1 - d2);
    C.set(L.x, L.y + drop * r, L.z - dir * 0.85 * r);
    dv.copy(v).sub(C); const len = dv.length(); if (len < 1e-6) return;
    v.addScaledVector(dv, amt * f * Math.min(1, w) / len);
  };
  // like pad, swelling along any direction N (unit vector)
  const N = new T.Vector3(), bAx = new T.Vector3(), q3 = new T.Vector3();
  const padV = (v, L, n, r, amt, w) => {
    if (!amt || w <= 0) return;
    dv.copy(v).sub(L); const along = dv.dot(n); if (along < -0.9 * r) return;
    const d2 = (dv.lengthSq() - along * along * 0.64) / (r * r); if (d2 >= 1) return;
    const f = (1 - d2) * (1 - d2);
    C.copy(L).addScaledVector(n, -0.85 * r);
    dv.copy(v).sub(C); const len = dv.length(); if (len < 1e-6) return;
    v.addScaledVector(dv, amt * f * Math.min(1, w) / len);
  };
  const roundPts = new Uint8Array(P.count);
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    // limbs: thicker / thinner around their bone, muscles bulge mid-way
    for (const Lm of LIMBS) {
      if (Lm.wristS && Lm.ax) {
        const wH = wOf(i, (n) => n === 'hand.' + Lm.wristS);
        if (wH > 0.01) {
          const t2 = q.copy(v).sub(Lm.ax.A).dot(Lm.ax.d) - Lm.ax.L; // past the wrist, along the forearm's line
          const f = 0.45 * s(b.wrist ?? 0.5) * (1 - sst(0, 0.35 * Lm.ax.L, t2)) * (t2 > -0.1 * Lm.ax.L ? 1 : 0);
          if (f) { c.copy(Lm.ax.d).multiplyScalar(Lm.ax.L + Math.max(0, t2)).add(Lm.ax.A); v.sub(c).multiplyScalar(1 + f * wH).add(c); }
        }
      }
      if (!Lm.ax) continue; const w = wOf(i, Lm.test); if (w < 0.01) continue;
      const t = Math.max(0, Math.min(Lm.ax.L, q.copy(v).sub(Lm.ax.A).dot(Lm.ax.d)));
      c.copy(Lm.ax.d).multiplyScalar(t).add(Lm.ax.A);
      const kk = 1 + (Lm.k - 1 + Lm.bulge * Math.sin(Math.PI * t / Lm.ax.L) + (Lm.prof ? Lm.prof(t / Lm.ax.L) : 0)) * w;
      v.sub(c).multiplyScalar(kk).add(c);
    }
    // torso: around the spine line
    const wT = wOf(i, (n) => /^(pelvis|lumbar|ribcage|clavicle|neck)/.test(n));
    if (wT > 0.01) {
      const y = v.y, sz = spineZ(y);
      let kx = 1, kz = 1;
      const gC = gauss(y - chestY, 0.1 * H), gW = gauss(y - waistY, 0.075 * H), gH = gauss(y - hipY, 0.085 * H), gS = gauss(y - shY, 0.06 * H);
      kx += (0.03 * s(b.chest) + 0.07 * s(b.muscle)) * gC; kz += (0.04 * s(b.chest) + 0.06 * s(b.muscle)) * gC * (v.z > sz ? 1 : 0.3);
      kx += (0.2 * s(b.waist) + 0.16 * s(b.fat) - 0.04 * s(b.muscle)) * gW; kz += (0.2 * s(b.waist) + 0.3 * s(b.fat)) * gW * (v.z > sz ? 1.25 : 0.7);
      kx += (0.22 * s(b.hips) + 0.1 * s(b.fat)) * gH; kz += 0.1 * s(b.fat) * gH;
      kx += 0.06 * s(b.muscle) * gS;
      v.x = spineX + (v.x - spineX) * (1 + (kx - 1) * wT); v.z = sz + (v.z - sz) * (1 + (kz - 1) * wT);
    }
    // breasts, pecs and seat: soft rounded pads that swell from a point inside the body, only
    // where that fat / muscle sits (not the whole torso), and only on the torso / thighs
    // breasts: only the ribcage's own skin (never the shoulders, arms or collar), and only inside
    // the breast's own footprint. Size = how wide the breast is, volume = how far it stands out.
    const wB = wOf(i, (n) => /^(ribcage|lumbar)/.test(n)), wSeat = wOf(i, (n) => /^(pelvis|lumbar1|thigh)/.test(n));
    for (const sd of ['L', 'R']) {
      const br = lm['breast' + sd], bt = lm['butt' + sd];
      const onSide = (x) => sst(-0.004 * H, 0.03 * H, (x - spineX) * (sd === 'L' ? 1 : -1));
      const bal = balloons[sd];
      if (bal && wB > 0.01) {
        // the breast's surface: a round shape a little fuller and lower at the bottom (a soft
        // teardrop, not a ball). Points inside it move out onto it; points just outside are lifted
        // a little too, so it blends into the chest instead of sitting on it with a hard edge.
        if ((v.x - spineX) * bal.sd > Math.abs(bal.br.x - spineX) * 0.12 && q3.copy(v).sub(bal.B0).dot(bal.ax) > -0.6 * bal.base) {
          // worked out in a space squashed a little at the bottom (so the real shape hangs lower)
          const sq = (p3, out) => { out.copy(p3).sub(bal.C); out.y *= out.y < 0 ? 0.82 : 1.08; return out; };
          const ps = sq(v, dv), bs3 = sq(bal.B0, q3);
          // from the base of the breast on the chest, out through this point to the balloon's skin
          const dir = ps.clone().sub(bs3), dist = dir.length();
          if (dist > 1e-6) {
            dir.divideScalar(dist);
            const bb = bs3.dot(dir), cc = bs3.lengthSq() - bal.r * bal.r, disc = bb * bb - cc;
            if (disc > 0) {
              const t = -bb + Math.sqrt(disc), r = bal.r, f = 0.16 * r, d = t - dist;
              if (t > 0 && d > -3 * f) {
                const sp = (x) => 0.5 * (x + Math.sqrt(x * x + f * f)); // smooth max(x, 0)
                const push = sp(d) - sp(-3 * f) * (1 - Math.max(0, Math.min(1, (d + 3 * f) / (6 * f))));
                const W = Math.min(1, wOf(i, (n) => /^(ribcage|lumbar2)/.test(n))) * onSide(v.x);
                ps.addScaledVector(dir, Math.max(0, push) * W);
                ps.y /= ps.y < 0 ? 0.82 : 1.08;
                v.copy(bal.C).add(ps); roundPts[i] = 1;
              }
            }
          }
        }
      } else if (br && wB > 0.01 && v.z > br.z - 0.1 * H && b.sex === 'male') {
        // a breast is swollen like a dome around its own axis (pointing forward, a bit out and
        // down): points move outward from a centre inside the chest, most at the front, fading to
        // nothing at the edge of a cone, so it grows from the front and the side alike. Size =
        // how wide the cone is, Volume = how far it swells. The cone is shallower above the
        // landmark (the upper chest stays) and stops short of the middle (no merging).
        const fem = b.sex !== 'male', R0 = (fem ? 0.06 : 0.065) * H, sd = Math.sign(br.x - spineX) || 1, wR = wOf(i, (n) => n === 'ribcage');
        bAx.set(sd * 0.22, -0.12, 1).normalize();
        C.copy(br).addScaledVector(bAx, -0.95 * R0);
        dv.copy(v).sub(C); const len = dv.length();
        if (len > 1e-6 && len < 2.2 * R0) {
          const cos = dv.dot(bAx) / len, up = v.y > br.y;
          const half = Math.min(1.35, 1.0 * (1 + 0.3 * Math.max(0, s(b.breastSize)))) * (up ? 0.75 : 1.0);
          const w0 = sst(Math.cos(half), 1, cos);
          const inner = (v.x - spineX) * sd < Math.abs(br.x - spineX) * 0.18 ? 0 : 1;
          const bv = Math.max(0, s(b.breast)), bs = Math.max(0, s(b.breastSize)); // the model's own breasts are the smallest
          const amt = (fem ? 0.042 * bv + 0.014 * bs : 0.02 * bv + 0.008 * bs + 0.01 * Math.max(0, s(b.muscle))) * H;
          // nothing below the fold under the breast (the ribs and belly stay), and less toward the middle
          const below = 1 - sst(0.55 * R0, 1.0 * R0, br.y - v.y), mid = sst(0.18, 0.55, ((v.x - spineX) * sd) / Math.max(1e-4, Math.abs(br.x - spineX)));
          const w = w0 * w0 * Math.min(1, wR) * onSide(v.x) * inner * below * (v.y < br.y ? mid : 1) * (1 - sst(1.4 * R0, 2.2 * R0, len));
          if (amt && w > 0) {
            v.addScaledVector(dv, amt * w / len);
            if (fem && amt > 0) v.y -= amt * w * 0.15 * (up ? 0.3 : 1); // weight: fuller underneath
          }
        }
      }
      // pecs / upper chest (the Chest slider): a flatter pad higher up and toward the middle
      if (br && wT > 0.01) { pec.set(spineX + (br.x - spineX) * 0.75, br.y + 0.05 * H, br.z - 0.012 * H); pad(v, pec, 1, 0.085 * H, (0.022 * s(b.chest) + 0.008 * s(b.muscle)) * H, 0, wT * onSide(v.x)); }
      // seat: each cheek only on its own side (fading to nothing at the cleft); size and volume
      if (bt && wSeat > 0.01) {
        const r = 0.08 * H * (1 + 0.4 * s(b.buttSize)), amt = (0.03 * s(b.butt) + 0.008 * s(b.fat) + 0.008 * s(b.buttSize)) * H;
        const m = onSide(v.x) * (1 - sst(bt.y + 0.55 * r, bt.y + 0.9 * r, v.y));
        if (m > 0) pad(v, bt, -1, r, amt, 0.25, wSeat * m);
      }
    }
    // hips and seat carry into the top of the thighs
    const wTh = wOf(i, (n) => /^thigh/.test(n));
    if (wTh > 0.01) {
      const gH = gauss(v.y - hipY, 0.085 * H), sd = v.x > spineX ? 'L' : 'R', bt = lm['butt' + sd], hx = J['thigh.' + sd].x;
      if (Math.abs(v.x - spineX) > Math.abs(hx - spineX)) v.x = hx + (v.x - hx) * (1 + 0.45 * s(b.hips) * gH * wTh);
    }
    // neck thickness; head, hands and feet scale about their own joint
    // shoulder width: the arm (and the outer end of the collarbone) moves outward
    {
      const sd = v.x > spineX ? 1 : -1, S = sd > 0 ? 'L' : 'R', sj = J['upperArm.' + S];
      const amt = (0.045 * s(b.shoulders) + 0.008 * s(b.muscle)) * H;
      if (amt && sj) {
        const wArm = wOf(i, (n) => n.endsWith('.' + S) && /^(upperArm|foreArm|hand|thumb|index|middle|ring|pinky)/.test(n)), wCl = wOf(i, (n) => n === 'clavicle.' + S);
        // the torso around the shoulder follows part-way, fading toward the neck and below the armpit
        const wTo = wOf(i, (n) => /^(ribcage|lumbar2)/.test(n));
        // nothing moves at the neck; the full amount at the shoulder joint and beyond
        const xf = sst(0.035 * H, Math.abs(sj.x - spineX), Math.abs(v.x - spineX));
        const tor = wTo * Math.max(0, 1 - Math.abs(v.y - sj.y) / (0.09 * H));
        v.x += sd * amt * Math.min(1, wArm + (0.8 * wCl + 0.6 * tor) * xf);
      }
      // traps: the slope from the neck to the shoulder rises and thickens toward the back
      const tp = lm['trap' + S], ta = (0.032 * s(b.traps ?? 0.5) + 0.008 * s(b.muscle)) * H;
      if (tp && ta) { N.set(sd * 0.15, 1, -0.45).normalize(); padV(v, tp, N, 0.07 * H, ta, wOf(i, (n) => /^(ribcage|neck1|clavicle)/.test(n))); }
    }
    const wN = wOf(i, (n) => /^neck/.test(n)); if (wN > 0.01) { const kk = 1 + (0.3 * s(b.neck) + 0.12 * s(b.muscle)) * wN, sz = J.neck1.z; v.x = spineX + (v.x - spineX) * kk; v.z = sz + (v.z - sz) * kk; }
    const wHd = wOf(i, (n) => n === 'head'); if (wHd > 0.01 && J.head) { const kk = 1 + 0.25 * s(b.head) * wHd; v.sub(J.head).multiplyScalar(kk).add(J.head); }
    for (const S of ['L', 'R']) {
      const wHa = wOf(i, (n) => n === 'hand.' + S || (/^(thumb|index|middle|ring|pinky)\d\./.test(n) && n.endsWith('.' + S))); if (wHa > 0.01 && J['hand.' + S]) { const kk = 1 + 0.3 * s(b.hands) * wHa; v.sub(J['hand.' + S]).multiplyScalar(kk).add(J['hand.' + S]); }
      const wF = wOf(i, (n) => /^foot/.test(n) && n.endsWith('.' + S)); if (wF > 0.01 && J['footControl.' + S]) { const o = J['footControl.' + S], kk = 1 + 0.3 * s(b.feet) * wF, y0 = v.y; v.sub(o).multiplyScalar(kk).add(o); v.y = y0 * (1 + (kk - 1) * 0.5); }
    }
    P.setXYZ(i, v.x, v.y, v.z);
  }
  // musculature: more defined — the model's own muscle forms (the difference between its
  // surface and a smoothed copy of it) are deepened; the head, hands and feet are left alone
  const def = s(b.muscle);
  if (def && g.userData.adj) {
    const { keyOf, adj, members } = g.userData.adj, K = members.length;
    let detail = g.userData.detail;
    if (!detail) {
      const base = g.userData.basePos, cur = new Float32Array(K * 3);
      for (let k = 0; k < K; k++) { const i = members[k][0]; cur[k * 3] = base[i * 3]; cur[k * 3 + 1] = base[i * 3 + 1]; cur[k * 3 + 2] = base[i * 3 + 2]; }
      let sm = cur.slice();
      for (let it = 0; it < 3; it++) {
        const nx = sm.slice();
        for (let k = 0; k < K; k++) { const nb = adj[k]; if (!nb.length) continue; let ax = 0, ay = 0, az = 0; for (const q2 of nb) { ax += sm[q2 * 3]; ay += sm[q2 * 3 + 1]; az += sm[q2 * 3 + 2]; } const m = nb.length; nx[k * 3] = (sm[k * 3] + ax / m) / 2; nx[k * 3 + 1] = (sm[k * 3 + 1] + ay / m) / 2; nx[k * 3 + 2] = (sm[k * 3 + 2] + az / m) / 2; }
        sm = nx;
      }
      detail = new Float32Array(K * 3); for (let j = 0; j < K * 3; j++) detail[j] = cur[j] - sm[j];
      // only the gentle forms: big jumps (open edges, seams, tips) would turn into spikes
      const cap = 0.006 * H;
      for (let k = 0; k < K; k++) { const l = Math.hypot(detail[k * 3], detail[k * 3 + 1], detail[k * 3 + 2]); const f = l > cap ? Math.max(0, 2 * cap - l) / l : 1; detail[k * 3] *= f; detail[k * 3 + 1] *= f; detail[k * 3 + 2] *= f; }
      g.userData.detail = detail;
    }
    const kD = def > 0 ? 0.65 * def : 0.5 * def; // negative: softer (when shrinking is allowed)
    for (let i = 0; i < P.count; i++) {
      const wSkip = wOf(i, (n) => /^(head|neck|hand|thumb|index|middle|ring|pinky|foot|toe)/.test(n));
      let w = (1 - Math.min(1, wSkip)) * (roundPts[i] ? 0 : 1);
      if (b.sex !== 'male' && w > 0) { v.fromBufferAttribute(P, i); for (const sd2 of ['L', 'R']) { const brp = lm['breast' + sd2]; if (brp) { const dd = Math.hypot(v.x - brp.x, v.y - brp.y); w *= sst(0.06 * H, 0.085 * H, dd); if (dd < 0.075 * H && v.z > brp.z - 0.06 * H) roundPts[i] = 1; } } } // breasts stay smooth
      if (w < 0.01) continue;
      const k = keyOf[i];
      P.setXYZ(i, P.getX(i) + detail[k * 3] * kD * w, P.getY(i) + detail[k * 3 + 1] * kD * w, P.getZ(i) + detail[k * 3 + 2] * kD * w);
    }
  }
  P.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
  smoothMovedNormals(g, roundPts, H);
}
// the mesh as points (copies of a corner merged) and which points are joined by an edge
function pointGraph(g) {
  const P = g.attributes.position, idx = g.index.array, n = P.count, ids = new Map(), keyOf = new Int32Array(n), members = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
    let id = ids.get(k); if (id == null) { id = members.length; ids.set(k, id); members.push([]); }
    keyOf[i] = id; members[id].push(i);
  }
  const sets = members.map(() => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let j = 0; j < 3; j++) { const a = keyOf[idx[t + j]], b = keyOf[idx[t + (j + 1) % 3]]; if (a !== b) { sets[a].add(b); sets[b].add(a); } }
  return { keyOf, members, adj: sets.map((x) => [...x]) };
}

// the model keeps its own (planar) normals; where the shape was changed a lot (bigger breasts…)
// they no longer fit, so there the normals are worked out again from the new surface, smooth
function smoothMovedNormals(g, smw, H) {
  const P = g.attributes.position, Nr = g.attributes.normal, idx = g.index && g.index.array, base = g.userData.basePos;
  if (!idx || !base) return;
  const n = P.count, moved = new Float32Array(n); let any = false;
  for (let i = 0; i < n; i++) { const d = Math.hypot(P.getX(i) - base[i * 3], P.getY(i) - base[i * 3 + 1], P.getZ(i) - base[i * 3 + 2]); moved[i] = d; if (d > 0.0005 * H) any = true; }
  if (!any) return;
  const kOf = g.userData.adj && g.userData.adj.keyOf;
  // rounded breasts: shared across the copies of a corner (smooth); everywhere else per corner
  // copy, so the model's planes and hard edges stay crisp
  const key = (i) => (smw && smw[i] && kOf ? 'k' + kOf[i] : i);
  const acc = new Map(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), fn = new T.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    if (moved[i0] < 0.0003 * H && moved[i1] < 0.0003 * H && moved[i2] < 0.0003 * H) continue;
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    fn.subVectors(c, b).cross(a.sub(b)); // area-weighted
    for (const i of [i0, i1, i2]) { const k = key(i); let s = acc.get(k); if (!s) acc.set(k, s = [0, 0, 0]); s[0] += fn.x; s[1] += fn.y; s[2] += fn.z; }
  }
  const o = new T.Vector3(), m = new T.Vector3();
  for (let i = 0; i < n; i++) {
    if (moved[i] < 0.0005 * H) continue;
    const s = acc.get(key(i)); if (!s) continue;
    m.set(s[0], s[1], s[2]).normalize(); Nr.setXYZ(i, m.x, m.y, m.z);
  }
  Nr.needsUpdate = true;
}

// more triangles on the chest (two levels of splitting, crack-free next to the rest), so bigger
// breasts can be round instead of a few large flat faces. Skin weights are blended.
function refineChest(mesh, levels = 2) {
  const names = mesh.skeleton.bones.map((bn) => (bn.userData.name || bn.name || '').replace(/_\d+$/, ''));
  const bindInv = new T.Matrix4().copy(mesh.bindMatrix).invert();
  const at = (nm) => { const k = names.indexOf(nm); return k < 0 ? null : new T.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[k].clone().invert()).applyMatrix4(bindInv); };
  const rib = at('ribcage'), neck = at('neck1'), lum = at('lumbar1'), sh = at('upperArm.L');
  if (!rib || !neck || !sh) return;
  mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox, H = bb.max.y - bb.min.y;
  const cx = rib.x, half = Math.abs(sh.x - cx) * 1.05, y0 = rib.y - 0.17 * H, y1 = neck.y - 0.01 * H, zc = rib.z - 0.01 * H;
  const inRegion = (x, y, z) => Math.abs(x - cx) < half && y > y0 && y < y1 && z > zc;
  for (let L = 0; L < levels; L++) {
    const g = mesh.geometry, idx = g.index.array, A = g.attributes;
    const P = A.position, Nm = A.normal, UV = A.uv, SI = A.skinIndex, SW = A.skinWeight;
    const pk = (i) => Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
    const ek = (a, b) => { const ka = pk(a), kb = pk(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
    const split = new Set();
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const x = (P.getX(a) + P.getX(b) + P.getX(c)) / 3, y = (P.getY(a) + P.getY(b) + P.getY(c)) / 3, z = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3;
      if (inRegion(x, y, z)) { split.add(ek(a, b)); split.add(ek(b, c)); split.add(ek(c, a)); }
    }
    const pos = Array.from(P.array), nrm = Array.from(Nm.array), uv = UV ? Array.from(UV.array) : null, si = Array.from(SI.array), sw = Array.from(SW.array);
    let count = P.count; const mids = new Map();
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a; let m = mids.get(k); if (m != null) return m;
      m = count++; mids.set(k, m);
      for (let j = 0; j < 3; j++) pos.push((pos[a * 3 + j] + pos[b * 3 + j]) / 2);
      const nx = nrm[a * 3] + nrm[b * 3], ny = nrm[a * 3 + 1] + nrm[b * 3 + 1], nz = nrm[a * 3 + 2] + nrm[b * 3 + 2], nl = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / nl, ny / nl, nz / nl);
      if (uv) uv.push((uv[a * 2] + uv[b * 2]) / 2, (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2);
      const wm = new Map();
      for (const v of [a, b]) for (let j = 0; j < 4; j++) { const w = sw[v * 4 + j]; if (w > 0) wm.set(si[v * 4 + j], (wm.get(si[v * 4 + j]) || 0) + w / 2); }
      const top = [...wm].sort((p, q) => q[1] - p[1]).slice(0, 4), tot = top.reduce((s2, x) => s2 + x[1], 0) || 1;
      for (let j = 0; j < 4; j++) { si.push(top[j] ? top[j][0] : 0); sw.push(top[j] ? top[j][1] / tot : 0); }
      return m;
    };
    const out = [];
    for (let t = 0; t < idx.length; t += 3) {
      let v = [idx[t], idx[t + 1], idx[t + 2]];
      const sp = (k) => split.has(ek(v[k], v[(k + 1) % 3]));
      const n = (sp(0) ? 1 : 0) + (sp(1) ? 1 : 0) + (sp(2) ? 1 : 0);
      if (n === 0) { out.push(...v); continue; }
      if (n === 3) { const [a, b, c] = v, m1 = mid(a, b), m2 = mid(b, c), m3 = mid(c, a); out.push(a, m1, m3, m1, b, m2, m3, m2, c, m1, m2, m3); continue; }
      if (n === 1) { while (!sp(0)) v = [v[1], v[2], v[0]]; const [a, b, c] = v, m = mid(a, b); out.push(a, m, c, m, b, c); continue; }
      // two split edges: turn so that (a,b) and (b,c) are the split ones
      while (!(sp(0) && sp(1))) v = [v[1], v[2], v[0]];
      const [a, b, c] = v, m1 = mid(a, b), m2 = mid(b, c);
      out.push(m1, b, m2, a, m1, m2, a, m2, c);
    }
    const ng = new T.BufferGeometry();
    ng.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    ng.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    if (uv) ng.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    ng.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
    ng.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
    ng.setIndex(out);
    mesh.geometry = ng;
  }
}

