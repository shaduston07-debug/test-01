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
  const skinned = [], bones = new Set();
  node.traverse((o) => { if (o.isSkinnedMesh) { skinned.push(o); for (const b of o.skeleton.bones) bones.add(b); } });
  if (!skinned.length) return null;
  const map = mapNames([...bones].map((b) => ({ name: b.userData.name || b.name, bone: b })));
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
  return { root: node, joints, world, H: H || 1.7, rest: MH_REST, drive, imported: true, mapped: Object.keys(map).length };
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
