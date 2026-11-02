// 3D layers: a posable drawing figure, imported models (glTF/GLB/VRM, FBX, OBJ — the open
// formats Clip Studio Paint itself imports), primitives, camera orbit / pan / zoom, object
// move / rotate / scale, per-joint posing, lighting and outlines. The scene is rendered with
// WebGL into the layer's canvas, so it composites like any other layer (and can be clipped
// to or rasterized). three.js is loaded only when a 3D layer is first edited.
import { h, toast, dialog, field, switchRow, seg, uid, clamp, pickFile, makeCanvas, canvasToBlob } from './util.js';
import { Layer } from './doc.js';
import { touch } from './history.js';
import { insertLayer, structCmd } from './layers.js';
import * as M from './models3d.js';
import * as A from './anatomy.js';
import * as SC from './sculpt.js';
import * as C from './creatures.js';
import * as WD from './world3d.js';
import * as MH from './mhbody.js';
import * as AS from './assets3d.js';
import * as store from './storage.js';
import { openFloating, closeFloat, isFloating } from './ui.js';

let T = null;
async function three() {
  if (!T) { T = await import('../vendor/three.bundle.js'); M.setThree(T); A.setThree(T); MH.setThree(T); M.setSculptor(async (b, c) => {
    try { return await MH.buildHumanGLB(b, c); } catch (e) { console.warn('figure model unavailable, using the base mesh', e); }
    try { return await MH.buildHumanMH(b, c); } catch (e) { console.warn('realistic body unavailable, sculpting one', e); return A.sculptHuman(b, c); }
  }); C.setThree(T); WD.setThree(T); }
  return T;
}

export const defaultScene = () => ({
  v: 1,
  camera: { pos: [0, 1.15, 4.4], target: [0, 0.92, 0], fov: 35 },
  light: { az: 35, el: 50, intensity: 2.4, ambient: 1.1 },
  outline: true, outlineWidth: 0.008,
  objects: [],
});
// drawing figures: rig 2 = the Clip-Studio-style female / male figure with finger joints
// (older documents keep their original simple figure)
const figureObject = (x = 0, sex = 'female') => ({ id: uid(), kind: 'figure', rig: 2, name: sex === 'male' ? 'Drawing figure (male)' : 'Drawing figure (female)', pos: [x, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: '#c9c6c1', outfit: 'none',
  body: sex === 'male' ? { sex: 'male', height: 1.75, heads: 7.5, build: 0.55, muscle: 0.65, fat: 0.42 } : { sex: 'female', height: 1.62, heads: 7.2, build: 0.4, muscle: 0.45, fat: 0.45 } });
// built-in library models (generated, no download)
export const LIBRARY = [
  ['Figures', [['figure-female', 'Female figure'], ['figure-male', 'Male figure'], ['knight', 'Knight (medieval armour)'], ['scifi', 'Sci-fi armour']]],
  ['Creatures', [['dragon', 'Dragon'], ['werewolf', 'Werewolf'], ['orc', 'Orc brute'], ['demon', 'Winged demon'], ['ghoul', 'Ghoul'], ['xeno', 'Alien'], ['spider', 'Giant spider'], ['golem', 'Stone golem'], ['kraken', 'Kraken']]],
  ['Weapons', Object.entries(WD.WEAPONS).map(([k, w]) => ['w:' + k, w.label])],
  ['Vehicles', [['car', 'Car'], ['sports', 'Sports car'], ['moto', 'Motorcycle']]],
  ['Places', [['castle', 'Castle'], ['street', 'City street'], ['district', 'City district'], ['cyber', 'Cyberpunk street'], ['ruins', 'Ruined city'], ['mountains', 'Mountains & lake'], ['forest', 'Forest hills'], ['desert', 'Desert dunes']]],
];
// camera presets (PoseManiacs-style dynamic angles): [label, direction, lens, distance ×, aim up]
const CAM_ANGLES = [['Front', [0, 0.05, 1], 35], ['Three-quarter', [0.7, 0.12, 1], 35], ['Side', [1, 0.05, 0], 35], ['Back', [-0.4, 0.1, -1], 35],
  ['High angle', [0.45, 1.3, 1], 40], ['Low angle', [0.4, -0.55, 1], 45, 0.85, 0.3], ['Dramatic', [0.8, -0.35, 0.9], 70, 0.55, 0.25], ['Top down', [0.01, 1, 0.02], 40, 1.2]];
const procObject = (gen, x = 0) => ({ id: uid(), kind: 'proc', gen, name: LIBRARY.flatMap((c) => c[1]).find((i) => i[0] === gen)?.[1] || gen, pos: [x, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: { car: '#3d6fd6', sports: '#e8b21a', moto: '#c72c2c' }[gen] || (C.CREATURES.includes(gen) && C.creatureDef(gen).color) || '#cfcac2' });

export function create3DLayer(doc) {
  const l = new Layer(doc.width, doc.height, { type: '3d', name: '3D' });
  l.scene3d = defaultScene(); // starts empty: models are chosen from the 3D panel
  return l;
}
function isEmptyCanvas(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let k = 3; k < d.length; k += 4) if (d[k]) return false;
  return true;
}

// ───────── drawing figure (CSP-style mannequin) ─────────
// [name, parent, pivot offset from parent pivot, segment length (down -Y), radius, shape]
const BONES = [
  ['pelvis', null, [0, 0.95, 0], 0.1, 0.13, 'pelvis'],
  ['spine', 'pelvis', [0, 0.08, 0], 0.2, 0.12, 'torso-up'],
  ['chest', 'spine', [0, 0.2, 0], 0.2, 0.15, 'chest'],
  ['neck', 'chest', [0, 0.22, 0], 0.08, 0.045, 'up'],
  ['head', 'neck', [0, 0.08, 0], 0.22, 0.105, 'head'],
  ['shoulderL', 'chest', [0.19, 0.17, 0], 0.27, 0.05, 'down'],
  ['elbowL', 'shoulderL', [0, -0.27, 0], 0.25, 0.042, 'down'],
  ['handL', 'elbowL', [0, -0.25, 0], 0.09, 0.04, 'hand'],
  ['shoulderR', 'chest', [-0.19, 0.17, 0], 0.27, 0.05, 'down'],
  ['elbowR', 'shoulderR', [0, -0.27, 0], 0.25, 0.042, 'down'],
  ['handR', 'elbowR', [0, -0.25, 0], 0.09, 0.04, 'hand'],
  ['hipL', 'pelvis', [0.095, -0.06, 0], 0.43, 0.068, 'down'],
  ['kneeL', 'hipL', [0, -0.43, 0], 0.42, 0.052, 'down'],
  ['footL', 'kneeL', [0, -0.42, 0], 0.18, 0.045, 'foot'],
  ['hipR', 'pelvis', [-0.095, -0.06, 0], 0.43, 0.068, 'down'],
  ['kneeR', 'hipR', [0, -0.43, 0], 0.42, 0.052, 'down'],
  ['footR', 'kneeR', [0, -0.42, 0], 0.18, 0.045, 'foot'],
];
const REST = { shoulderL: [0, 0, 0.12], shoulderR: [0, 0, -0.12] };
const POSES = {
  Relaxed: {},
  Walking: { shoulderL: [0.45, 0, 0.1], elbowL: [-0.4, 0, 0], shoulderR: [-0.45, 0, -0.1], elbowR: [-0.2, 0, 0], hipL: [-0.4, 0, 0], kneeL: [0.25, 0, 0], hipR: [0.35, 0, 0], kneeR: [0.6, 0, 0], footR: [-0.2, 0, 0], spine: [0.05, 0, 0] },
  Sitting: { hipL: [-1.5, 0, 0.05], hipR: [-1.5, 0, -0.05], kneeL: [1.55, 0, 0], kneeR: [1.55, 0, 0], shoulderL: [-0.25, 0, 0.12], shoulderR: [-0.25, 0, -0.12], elbowL: [-0.6, 0, 0], elbowR: [-0.6, 0, 0] },
  'Arms up': { shoulderL: [0, 0, 2.7], shoulderR: [0, 0, -2.7], elbowL: [0, 0, 0.3], elbowR: [0, 0, -0.3] },
  'T-pose': { shoulderL: [0, 0, 1.5708], shoulderR: [0, 0, -1.5708] },
};

function buildFigure(color) {
  const root = new T.Group();
  const mat = new T.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 });
  const joints = {};
  for (const [name, parent, off, len, r, shape] of BONES) {
    const j = new T.Group(); j.name = name;
    j.position.set(...off);
    (parent ? joints[parent] : root).add(j);
    joints[name] = j;
    let geo, y = -len / 2, scale = [1, 1, 1];
    if (shape === 'head') { geo = new T.SphereGeometry(r, 28, 20); y = r * 1.05; scale = [0.92, 1.12, 1]; }
    else if (shape === 'pelvis') { geo = new T.SphereGeometry(r, 24, 16); y = -0.02; scale = [1.1, 0.75, 0.8]; }
    else if (shape === 'chest') { geo = new T.SphereGeometry(r, 24, 18); y = 0.1; scale = [1.15, 1.05, 0.72]; }
    else if (shape === 'torso-up') { geo = new T.CapsuleGeometry(r * 0.85, len * 0.5, 8, 18); y = len / 2; scale = [1.05, 1, 0.75]; }
    else if (shape === 'up') { geo = new T.CapsuleGeometry(r, len, 6, 14); y = len / 2; }
    else if (shape === 'hand') { geo = new T.BoxGeometry(r * 1.6, len, r * 0.8); y = -len / 2; }
    else if (shape === 'foot') { geo = new T.BoxGeometry(r * 2, r * 1.3, len); y = -r * 0.4; }
    else geo = new T.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 8, 16);
    const m = new T.Mesh(geo, mat);
    m.position.y = y;
    if (shape === 'foot') m.position.z = len * 0.32;
    m.scale.set(...scale);
    m.userData.joint = name;
    m.castShadow = true;
    j.add(m);
    // a ball at each joint reads better when posing
    if (!['pelvis', 'head', 'chest', 'spine'].includes(shape)) {
      const ball = new T.Mesh(new T.SphereGeometry(r * 1.02, 14, 10), mat);
      ball.userData.joint = name;
      j.add(ball);
    }
  }
  return { root, joints, mat };
}

function applyPose(rt, obj) {
  for (const [name, j] of Object.entries(rt.joints)) {
    const q = obj.pose[name];
    if (q) j.quaternion.set(...q);
    else { const e = REST[name] || [0, 0, 0]; j.quaternion.setFromEuler(new T.Euler(...e)); }
  }
}

// ───────── outlines (inverted hull) ─────────
function outlineMaterial(widthRef) {
  const m = new T.MeshBasicMaterial({ color: 0x111111, side: T.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.outlineW = widthRef;
    sh.vertexShader = 'uniform float outlineW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineW;');
  };
  return m;
}
function addOutlines(root, widthRef) {
  const mat = outlineMaterial(widthRef), add = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.outline || o.userData.overlay) return;
    const c = o.isSkinnedMesh ? new T.SkinnedMesh(o.geometry, mat) : new T.Mesh(o.geometry, mat);
    if (o.isSkinnedMesh) c.bind(o.skeleton, o.bindMatrix);
    c.userData.outline = true; c.raycast = () => {};
    c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
    add.push([o.parent, c]);
  });
  for (const [p, c] of add) p.add(c);
}

// ───────── Clip Studio-style manipulator ─────────
// Rings rotate about X (red), Y (green), Z (blue); arrows move along an axis; the yellow square
// slides the object on the floor, the white ball moves it in the screen plane. Drawn on top of
// everything at a constant on-screen size; a selected joint gets the rings only.
const GIZMO_COL = { x: 0xe5484d, y: 0x46b85a, z: 0x3f7fe8, f: 0xf2c230, v: 0xffffff };
function buildGizmo() {
  const g = new T.Group(); g.visible = false; g.userData.gizmo = true;
  const vis = (c) => new T.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92, side: T.DoubleSide });
  const pickMat = new T.MeshBasicMaterial({ colorWrite: false, depthTest: false, depthWrite: false, side: T.DoubleSide });
  const add = (handle, geos, pick, rot) => {
    const part = new T.Group(); part.userData.handle = handle;
    if (rot) part.rotation.set(...rot);
    for (const geo of geos) { const m = new T.Mesh(geo, vis(GIZMO_COL[handle[1]])); m.renderOrder = 1000; m.raycast = () => {}; part.add(m); }
    const p = new T.Mesh(pick, pickMat); p.userData.handle = handle; p.renderOrder = 1000; part.add(p);
    g.add(part);
  };
  const ring = () => new T.TorusGeometry(1, 0.014, 8, 96), ringPick = () => new T.TorusGeometry(1, 0.09, 6, 48);
  add('rx', [ring()], ringPick(), [0, Math.PI / 2, 0]);
  add('ry', [ring()], ringPick(), [Math.PI / 2, 0, 0]);
  add('rz', [ring()], ringPick());
  // arrows reach past the rings so the two never share a spot
  const arrow = () => [new T.CylinderGeometry(0.018, 0.018, 1.15, 10).translate(0, 0.775, 0), new T.ConeGeometry(0.07, 0.22, 16).translate(0, 1.45, 0)];
  const arrowPick = () => new T.CylinderGeometry(0.11, 0.11, 0.5, 8).translate(0, 1.36, 0);
  add('mx', arrow(), arrowPick(), [0, 0, -Math.PI / 2]);
  add('my', arrow(), arrowPick());
  add('mz', arrow(), arrowPick(), [Math.PI / 2, 0, 0]);
  add('mf', [new T.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2).translate(0.42, 0, 0.42)], new T.PlaneGeometry(0.42, 0.42).rotateX(-Math.PI / 2).translate(0.42, 0, 0.42));
  add('mv', [new T.SphereGeometry(0.09, 16, 12)], new T.SphereGeometry(0.2, 8, 6));
  return g;
}
// where the manipulator sits: the joint, the figure's hips, else the middle of the object
function gizmoCenter(e, joint) {
  if (joint && e.joints && e.joints[joint]) return e.joints[joint].getWorldPosition(new T.Vector3());
  const root = e.joints && (e.joints.pelvis || e.joints.hips || e.joints.d_hip || e.joints.body || e.joints.mantle);
  if (root) return root.getWorldPosition(new T.Vector3());
  if (!e.center) { e.node.updateMatrixWorld(true); const b = new T.Box3().setFromObject(e.node); e.center = e.node.worldToLocal(b.getCenter(new T.Vector3())); }
  return e.node.localToWorld(e.center.clone());
}
function placeGizmo(rt) {
  const g = rt.gizmo, tg = rt.gizmoTarget, e = tg && rt.objs.get(tg.id);
  if (!g) return;
  g.visible = !!e;
  if (!e) return;
  rt.scene.updateMatrixWorld(true);
  const c = gizmoCenter(e, tg.joint);
  g.position.copy(c);
  g.scale.setScalar(rt.camera.position.distanceTo(c) * Math.tan(rt.camera.fov * Math.PI / 360) * (tg.joint ? 0.14 : 0.3));
  for (const p of g.children) p.visible = !tg.joint || p.userData.handle[0] === 'r';
}

// ───────── runtime scene per layer ─────────
const runtimes = new WeakMap();
let hlMat = null;
let renderer = null;

async function runtimeFor(layer) {
  await three();
  let rt = runtimes.get(layer);
  if (rt) return rt;
  rt = { scene: new T.Scene(), camera: new T.PerspectiveCamera(35, 1, 0.02, 2000), objs: new Map(), outlineW: { value: 0.008 } };
  rt.hemi = new T.HemisphereLight(0xffffff, 0x8a8478, 1);
  rt.sun = new T.DirectionalLight(0xffffff, 2.4);
  rt.scene.add(rt.hemi, rt.sun);
  rt.gizmo = buildGizmo(); rt.scene.add(rt.gizmo);
  runtimes.set(layer, rt);
  // figures and creatures mesh in workers, so build them all at once
  await Promise.all(layer.scene3d.objects.map((o) => buildObject(layer, rt, o)));
  attachAll(rt);
  return rt;
}

async function buildObject(layer, rt, o) {
  let node, joints = null, figMat = null, rig = null, fig = null;
  if (o.kind === 'figure' && o.rig === 2) {
    fig = await M.buildHuman(o.body, o.color); if (o.outfit && o.outfit !== 'none') { if (fig.armor) await fig.armor(o.outfit); else M.buildArmor(fig, o.outfit); }
    node = fig.root; joints = fig.joints; figMat = fig.mat; rig = 'human';
  } else if (o.kind === 'figure') {
    const f = buildFigure(o.color); node = f.root; joints = f.joints; figMat = f.mat;
  } else if (o.kind === 'weapon') {
    node = (await WD.buildWeapon(o.weapon)).root;
  } else if (o.kind === 'proc' && ['cyber', 'ruins'].includes(o.gen)) {
    node = WD.buildDystopia(o.gen).root;
  } else if (o.kind === 'proc' && ['mountains', 'forest', 'desert'].includes(o.gen)) {
    node = WD.buildLandscape(o.gen).root;
  } else if (o.kind === 'proc' && C.CREATURES.includes(o.gen)) {
    // sculpted, skinned creature (the dragon too — old saved dragons keep their joint names)
    const built = await C.buildCreature(o.gen, o.color);
    node = built.root; joints = built.joints; figMat = built.mat; rig = 'creature'; fig = built;
  } else if (o.kind === 'proc') {
    const g = o.gen;
    const make = { car: () => M.buildCar('sedan', o.color), sports: () => M.buildCar('sports', o.color), moto: () => M.buildMotorcycle(o.color),
      castle: () => M.buildCastle(), street: () => M.buildCity('street'), district: () => M.buildCity('district') }[g];
    const built = g === 'dragon' ? M.buildDragon(o.color) : make ? await M.propOr(g, make, o.color) : null;
    if (!built) return;
    node = built.root;
    if (g === 'dragon') { joints = built.joints; figMat = built.mat; rig = 'dragon'; fig = built; }
  } else if (o.kind === 'prim') {
    const geo = { cube: () => new T.BoxGeometry(0.5, 0.5, 0.5), sphere: () => new T.SphereGeometry(0.3, 40, 28), cylinder: () => new T.CylinderGeometry(0.25, 0.25, 0.6, 40), cone: () => new T.ConeGeometry(0.3, 0.6, 40), floor: () => new T.PlaneGeometry(6, 6) }[o.prim]();
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: o.color || '#cfcac2', roughness: 0.7, side: o.prim === 'floor' ? T.DoubleSide : T.FrontSide }));
    if (o.prim === 'floor') m.rotation.x = -Math.PI / 2; else m.position.y = o.prim === 'sphere' ? 0.3 : o.prim === 'cube' ? 0.25 : 0.3;
    node = new T.Group(); node.add(m);
  } else if (o.kind === 'model') {
    node = await loadModel(layer.models.get(o.modelId));
    // a rigged human (Blender, Mixamo, Rigify, VRM…) poses exactly like the drawing figures
    const hf = node && MH.rigImported(node, M.mapRigNames);
    if (hf) { fig = hf; joints = hf.joints; rig = 'human'; o.pose ||= {}; }
  }
  if (!node) return;
  if (o.mat) { try { await applyMaterial(node, o.mat, layer); } catch (e) { console.warn('material', e); } }
  // metals and clear-coated paint need something to reflect, or they render near black
  node.traverse((c) => {
    if (!c.isMesh || c.userData.outline) return;
    for (const m of [].concat(c.material)) if (m && !m.envMap && (m.metalness > 0.3 || m.clearcoat > 0)) { m.envMap = studioEnv(); m.needsUpdate = true; }
  });
  node.userData.objId = o.id;
  node.traverse((c) => { c.userData.objId = o.id; });
  // outlines double the geometry drawn: skip them on very heavy models
  const heavy = (node.userData.tris || 0) > 250000;
  if ((o.kind !== 'prim' || o.prim !== 'floor') && !heavy) addOutlines(node, rt.outlineW);
  if (heavy) toast(`Large model (${Math.round(node.userData.tris / 1000)}k triangles): outlines are off for it to keep things smooth`, 3500);
  rt.scene.add(node);
  const entry = { node, joints, figMat, data: o, rig, fig };
  rt.objs.set(o.id, entry);
  syncObject(entry);
}

// held items (weapons) live inside the holder's hand joint; their pos / quat are relative to it
function syncAll(rt) { for (const e of rt.objs.values()) syncObject(e); }
function attachAll(rt) {
  for (const e of rt.objs.values()) {
    const a = e.data.attach; if (!a) continue;
    const host = rt.objs.get(a.to), j = host && host.joints && host.joints['hand' + a.side];
    const parent = j || rt.scene;
    if (e.node.parent !== parent) parent.add(e.node);
  }
}
function syncObject(e) {
  const o = e.data;
  e.node.position.set(...o.pos);
  e.node.quaternion.set(...o.quat);
  e.node.scale.setScalar(o.scale);
  if (e.rig === 'human') { M.applyPose(e.joints, o.pose || {}, e.fig.rest || M.HUMAN_REST, e.fig.H); if (e.fig.drive) e.fig.drive(); }
  else if (e.rig === 'dragon') M.applyPose(e.joints, o.pose || {}, M.DRAGON_REST, 1);
  else if (e.rig === 'creature') M.applyPose(e.joints, o.pose || {}, C.creatureRest(o.gen), 1);
  else if (e.joints) applyPose({ joints: e.joints }, o);
}

// ───────── PBR materials from the asset library ─────────
// Meshes without texture coordinates (the sculpted figures, shapes) get box-projected UVs.
function boxUV(geo, tile) {
  const p = geo.attributes.position, n = geo.attributes.normal; if (!p) return;
  if (!n) geo.computeVertexNormals();
  const N = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    const x = p.getX(i) / tile, y = p.getY(i) / tile, z = p.getZ(i) / tile;
    if (ax >= ay && ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else if (ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
}
const texCache = new Map();
async function texFrom(layer, key, srgb) {
  const m = layer.models.get(key); if (!m || !m.blob) return null;
  let t = texCache.get(m.blob);
  if (!t) {
    const bmp = await createImageBitmap(m.blob, { imageOrientation: 'flipY' }).catch(() => createImageBitmap(m.blob));
    t = new T.Texture(bmp); t.flipY = false; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.needsUpdate = true; capTexture(t); texCache.set(m.blob, t);
  }
  return t;
}
async function applyMaterial(node, mat, layer) {
  const base = mat.asset, tile = mat.tile || 0.5;
  const [map, normal, rough, ao] = await Promise.all([texFrom(layer, base + ':map', true), texFrom(layer, base + ':normal'), texFrom(layer, base + ':rough'), texFrom(layer, base + ':ao')]);
  if (!map) return;
  node.traverse((c) => {
    if (!c.isMesh || c.userData.outline) return;
    if (!c.geometry.attributes.uv || mat.project) { c.geometry = c.geometry.clone(); boxUV(c.geometry, tile); }
    const old = [].concat(c.material)[0] || {};
    const nm = new T.MeshStandardMaterial({ map, normalMap: normal || null, roughnessMap: rough || null, aoMap: ao || null, roughness: 1, metalness: 0, side: old.side ?? T.FrontSide });
    if (mat.tint) nm.color.set(mat.tint);
    c.material = nm;
  });
}

// Big textures cost memory and upload time on every layer; 2048 px is plenty for drawing.
function capTexture(tex, maxPx = 2048) {
  const img = tex && tex.image;
  if (!img || !img.width || Math.max(img.width, img.height) <= maxPx) return;
  const k = maxPx / Math.max(img.width, img.height);
  const c = makeCanvas(img.width * k, img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  tex.image = c; tex.needsUpdate = true;
}

// ───────── finding standard models inside other files (Clip Studio workaround) ─────────
const enc = (str) => new TextEncoder().encode(str);
function indexOf(u8, pat, from = 0) {
  outer: for (let i = from; i <= u8.length - pat.length; i++) {
    for (let k = 0; k < pat.length; k++) if (u8[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}
export async function extractEmbeddedModel(u8, depth = 0) {
  if (depth > 2 || !u8 || u8.length < 16) return null;
  const head = new TextDecoder().decode(u8.slice(0, 16));
  // zip container
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    try {
      const { loadScript } = await import('./util.js');
      await loadScript('vendor/jszip.min.js');
      const zip = await window.JSZip.loadAsync(u8);
      const files = Object.values(zip.files).filter((e) => !e.dir).sort((a, b) => (b._data?.uncompressedSize || 0) - (a._data?.uncompressedSize || 0));
      for (const e of files) {
        const ext = e.name.split('.').pop().toLowerCase();
        if (['glb', 'gltf', 'vrm', 'fbx', 'obj'].includes(ext)) return { ext, bytes: await e.async('uint8array') };
      }
      for (const e of files) { const r = await extractEmbeddedModel(await e.async('uint8array'), depth + 1); if (r) return r; }
    } catch { /* not a readable zip */ }
  }
  // SQLite container: check every blob
  if (head.startsWith('SQLite format 3')) {
    try {
      const { getSql } = await import('./importers.js');
      const SQL = await getSql();
      const db = new SQL.Database(u8);
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0];
      for (const [t] of tables ? tables.values : []) {
        const res = db.exec(`SELECT * FROM "${t}"`)[0];
        for (const row of res ? res.values : []) for (const v of row) {
          if (v instanceof Uint8Array && v.length > 64) { const r = await extractEmbeddedModel(v, depth + 1); if (r) { db.close(); return r; } }
        }
      }
      db.close();
    } catch { /* not readable */ }
  }
  // binary glTF / VRM
  let i = indexOf(u8, enc('glTF'));
  while (i >= 0) {
    const dv = new DataView(u8.buffer, u8.byteOffset + i);
    if (u8.length - i >= 12 && dv.getUint32(4, true) === 2) {
      const len = dv.getUint32(8, true);
      if (len > 20 && i + len <= u8.length) return { ext: 'glb', bytes: u8.slice(i, i + len) };
    }
    i = indexOf(u8, enc('glTF'), i + 4);
  }
  // binary or ASCII FBX
  i = indexOf(u8, enc('Kaydara FBX Binary'));
  if (i >= 0) return { ext: 'fbx', bytes: u8.slice(i) };
  i = indexOf(u8, enc('; FBX '));
  if (i >= 0) return { ext: 'fbx', bytes: u8.slice(i) };
  // plain OBJ text
  if (depth > 0 || /^(#|v |o |g |mtllib)/.test(head) || indexOf(u8.slice(0, 4096), enc('\nv ')) >= 0) {
    const txt = new TextDecoder().decode(u8.slice(0, 200000));
    const m = txt.match(/v\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+/);
    if (m && /^f\s+\d/m.test(txt)) {
      // start at the first vertex record so leading container bytes don't confuse the parser
      const start = new TextEncoder().encode(txt.slice(0, m.index)).length;
      return { ext: 'obj', bytes: u8.slice(start) };
    }
  }
  return null;
}

async function loadModel(m) {
  if (!m) return null;
  const buf = await m.blob.arrayBuffer();
  let root;
  if (m.ext === 'glb' || m.ext === 'gltf' || m.ext === 'vrm') {
    const g = await new Promise((res, rej) => new T.GLTFLoader().parse(buf, '', res, rej));
    root = g.scene;
  } else if (m.ext === 'fbx') root = new T.FBXLoader().parse(buf, '');
  else if (m.ext === 'obj') root = new T.OBJLoader().parse(new TextDecoder().decode(buf));
  if (!root) return null;
  let tris = 0;
  root.traverse((c) => {
    if (c.isMesh && c.geometry) {
      const g = c.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of [].concat(c.material || [])) for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) capTexture(m[key]);
    }
    if (c.isMesh && c.geometry && !c.geometry.attributes.normal) c.geometry.computeVertexNormals();
    // tolerate models with inconsistent face winding
    if (c.isMesh) for (const m of [].concat(c.material || [])) m.side = T.DoubleSide;
    if (c.isMesh && (!c.material || c.material.type === 'MeshPhongMaterial' && m.ext === 'obj')) c.material = new T.MeshStandardMaterial({ color: '#cfcac2', roughness: 0.7 });
  });
  // normalise: feet on the ground, ~1.7 units tall, centred (asset-library models keep their
  // real-world size in metres, so a chair stays chair-sized next to the figures)
  const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  const k = m.real && big > 0.02 && big < 200 ? 1 : 1.7 / Math.max(size.y, size.x * 0.6, size.z * 0.6, 1e-6);
  const wrap = new T.Group();
  root.scale.multiplyScalar(k);
  const c = box.getCenter(new T.Vector3());
  root.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  wrap.add(root);
  wrap.userData.tris = tris;
  return wrap;
}

function applySceneSettings(layer, rt, doc) {
  const s = layer.scene3d;
  const c = rt.camera;
  c.fov = s.camera.fov; c.aspect = doc.width / doc.height; c.updateProjectionMatrix();
  c.position.set(...s.camera.pos); c.lookAt(new T.Vector3(...s.camera.target));
  const az = s.light.az * Math.PI / 180, el = s.light.el * Math.PI / 180;
  rt.sun.position.set(Math.sin(az) * Math.cos(el) * 10, Math.sin(el) * 10, Math.cos(az) * Math.cos(el) * 10);
  rt.sun.intensity = s.light.intensity; rt.hemi.intensity = s.light.ambient;
  rt.outlineW.value = s.outline ? s.outlineWidth : 0;
  rt.scene.traverse((o) => { if (o.userData.outline) o.visible = !!s.outline; });
}

// Renders the layer's 3D scene into its canvas. scale < 1 = quick preview while dragging.
export async function render3D(layer, doc, scale = 1) {
  const rt = await runtimeFor(layer);
  renderNow(layer, doc, rt, scale);
  return rt;
}

function getRenderer() {
  if (!renderer) {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NoToneMapping;
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}
// a soft photo-studio room (big top light, warm key, cool fill, dark floor) as a reflection map
let envTex = null;
function studioEnv() {
  if (envTex) return envTex;
  const pm = new T.PMREMGenerator(getRenderer()), sc = new T.Scene();
  sc.add(new T.Mesh(new T.BoxGeometry(10, 10, 10), new T.MeshBasicMaterial({ color: 0x6f6b66, side: T.BackSide })));
  const panel = (w, h, p, c, k) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(k), side: T.DoubleSide })); m.position.set(...p); m.lookAt(0, 0, 0); sc.add(m); };
  panel(6, 6, [0, 4.9, 0], '#ffffff', 3); panel(4, 3, [4.9, 1.5, 2], '#fff2e0', 2.2); panel(3, 3, [-4.9, 2, -1], '#e3ecff', 1.4);
  const floor = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshBasicMaterial({ color: 0x2a2826 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -4.9; sc.add(floor);
  envTex = pm.fromScene(sc, 0.04).texture;
  pm.dispose();
  return envTex;
}

// Synchronous render once the scene exists (used for live dragging).
function renderNow(layer, doc, rt, scale = 1, live = false) {
  applySceneSettings(layer, rt, doc);
  placeGizmo(rt);
  getRenderer();
  const max = renderer.capabilities.maxRenderbufferSize || 8192;
  let w = Math.max(1, Math.round(doc.width * scale)), hh = Math.max(1, Math.round(doc.height * scale));
  const k = Math.min(1, max / Math.max(w, hh));
  w = Math.round(w * k); hh = Math.round(hh * k);
  const el = renderer.domElement;
  if (el.width !== w || el.height !== hh) renderer.setSize(w, hh, false); // resize only when the size really changes
  renderer.render(rt.scene, rt.camera);
  // while dragging, the compositor draws the WebGL canvas directly (no full-size copy)
  if (live) { layer._live = el; return; }
  layer._live = null;
  const x = layer.canvas.getContext('2d');
  x.clearRect(0, 0, doc.width, doc.height);
  x.imageSmoothingQuality = scale < 1 ? 'low' : 'high';
  x.drawImage(el, 0, 0, doc.width, doc.height);
  touch(layer.canvas);
}

// ───────── tool ─────────
export function tool3d(app) {
  const t = {
    // 'object' works like Clip Studio's Object tool: tap to select a model (tap again on a body part
    // for its joint), drag the manipulator, drag a hand / foot of the selected figure (IK), drag
    // empty space to orbit the camera
    mode: 'object', sel: null, joint: null, busy: false, ik: true, gizmoOn: true, off: true, panelOpen: {},
    layer() { const it = app.doc && app.doc.activeItem; return it && it.type === '3d' ? it : null; },
    async enter() {
      this.off = false;
      const L = this.layer();
      if (!L) { toast('Select a 3D layer (Layers › cube button, or Actions › Add › 3D layer)'); return; }
      try { await this.redraw(1); } catch (e) { console.error(e); toast('3D failed to start: ' + e.message); }
      this.openPanel();
    },
    exit() {
      this.joint = null; this.off = true;
      closeFloat('3d');
      const L = this.layer(); if (L && runtimes.get(L)) { this.highlight(null); this.redraw(1); }
    },
    // the manipulator follows the selection (never drawn once the tool is put away)
    syncGizmo() {
      const L = this.layer(), rt = L && runtimes.get(L); if (!rt) return;
      const show = !this.off && this.gizmoOn && this.sel && rt.objs.has(this.sel) && ['object', 'move', 'rotate', 'scale', 'pose'].includes(this.mode);
      rt.gizmoTarget = show ? { id: this.sel, joint: this.mode === 'object' || this.mode === 'pose' ? this.joint : null } : null;
    },
    async redraw(scale = 1) {
      const L = this.layer(); if (!L) return;
      if (!runtimes.get(L)) { await render3D(L, app.doc, scale); this.syncGizmo(); app.requestRender('active'); return; }
      this.schedule(scale);
    },
    // live preview: one render per display frame, at about the on-screen resolution
    previewScale() { return clamp(app.view.zoom * app.dpr * 0.8, 0.2, 0.65); },
    schedule(scale) {
      this.pending = this.pending == null ? scale : Math.max(this.pending, scale);
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        const L = this.layer(), rt = L && runtimes.get(L), sc = this.pending; this.pending = null;
        if (!rt) return;
        this.syncGizmo();
        renderNow(L, app.doc, rt, sc, sc < 1 && (this.dragging || this.live));
        app.requestRender('active');
      });
    },
    snapshot() { return JSON.stringify(this.layer().scene3d); },
    commit(label, before, refresh = true) {
      const L = this.layer(), after = this.snapshot();
      if (before === after) return;
      const restore = async (json) => { L.scene3d = JSON.parse(json); const rt = runtimes.get(L); if (rt) for (const e of rt.objs.values()) { e.data = L.scene3d.objects.find((o) => o.id === e.data.id) || e.data; syncObject(e); } await render3D(L, app.doc, 1); app.changed('active'); if (this.layer() === L) this.panelRefresh(); };
      app.history.push({ label, bytes: after.length, undo: () => restore(before), redo: () => restore(after) });
      app.changed('active');
      if (refresh) this.panelRefresh();
    },
    // panel controls: one undo step per gesture (committed once the control rests)
    edit(label, fn, rebuild = false) {
      if (!this.editBefore) this.editBefore = this.snapshot();
      fn();
      if (!rebuild) { this.live = true; this.redraw(this.previewScale()); }
      clearTimeout(this.editT);
      this.editT = setTimeout(async () => {
        const b = this.editBefore; this.editBefore = null; this.live = false;
        if (rebuild && this.selEntry()) await this.rebuild(this.selEntry());
        this.commit(label, b, false); this.redraw(1);
      }, rebuild ? 250 : 350);
    },
    ndc(p) { return new T.Vector2((p.x / app.doc.width) * 2 - 1, -(p.y / app.doc.height) * 2 + 1); },
    pick(p) {
      const rt = runtimes.get(this.layer()); if (!rt) return null;
      const ray = new T.Raycaster(); ray.setFromCamera(this.ndc(p), rt.camera);
      const hit = ray.intersectObjects(rt.scene.children, true).find((i) => i.object.visible && !i.object.userData.outline && !i.object.userData.handle && i.object.userData.objId != null);
      if (!hit) return null;
      // one skinned body: the joint is the one that vertex follows most
      const joint = hit.object.userData.joint || (hit.object.userData.boneOf && hit.face ? hit.object.userData.boneOf(hit.face.a) : null);
      return { objId: hit.object.userData.objId, joint };
    },
    highlight(jointName) {
      const rt = runtimes.get(this.layer()); if (!rt) return;
      for (const e of rt.objs.values()) if (e.figMat) {
        // skinned body: a blue overlay on the triangles that follow the selected joint
        const body = e.fig && e.fig.mesh;
        if (body) {
          if (e.hl) { e.hl.parent && e.hl.parent.remove(e.hl); e.hl.geometry.dispose(); e.hl = null; }
          if (jointName && e.data.id === this.sel) {
            hlMat ||= new T.MeshStandardMaterial({ color: '#4d93ff', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
            e.hl = SC.boneOverlay(body, jointName, hlMat);
            if (e.hl) body.parent.add(e.hl);
          }
        }
        e.node.traverse((m) => {
          if (!m.isMesh || m.userData.outline) return;
          const on = jointName && m.userData.joint === jointName && e.data.id === this.sel;
          if (on && !m.userData.hl) { m.userData.base = m.material; m.material = m.material.clone(); m.material.color.set('#4d93ff'); m.userData.hl = true; }
          else if (!on && m.userData.hl) { m.material = m.userData.base; m.userData.hl = false; }
        });
      }
    },
    down(p) {
      const L = this.layer(); if (!L) { toast('Select a 3D layer'); return false; }
      if (!runtimes.get(L)) { this.enter(); return false; }
      this.p0 = p; this.last = p; this.moved = false; this.before = this.snapshot(); this.jointBefore = this.joint; this.dragIK = false;
      const gh = this.gizmoHit(p);
      if (gh && this.startGizmo(gh, p)) { this.dragging = true; return; }
      if (this.mode === 'object') {
        const hit = this.pick(p), e = hit && runtimes.get(L).objs.get(hit.objId);
        this.tapHit = hit;
        // the selected figure: drag a hand / foot (or its fingers / toes) and the arm / leg follows (IK)
        const eff = hit && hit.joint && (hit.joint.replace(/^(thumb|index|middle|ring|pinky)([LR])\d$/, 'hand$2').replace(/^toe([LR])$/, 'foot$1'));
        if (e && hit.objId === this.sel && e.rig === 'human' && this.ik && M.IK_CHAINS[eff]) { this.joint = eff; this.dragIK = true; this.highlight(this.joint); }
        this.dragging = true; return;
      }
      if (this.mode === 'pose' || this.mode === 'move' || this.mode === 'rotate' || this.mode === 'scale') {
        const hit = this.pick(p);
        if (hit) {
          this.sel = hit.objId;
          if (this.mode === 'pose') { const e = runtimes.get(L).objs.get(hit.objId); this.joint = e && e.joints && hit.joint ? hit.joint : null; this.highlight(this.joint); }
          this.dragging = true;
        } else this.dragging = !!this.sel && this.mode !== 'pose';
        app.updateCtxBar();
      } else this.dragging = true;
    },
    move(p) {
      if (!this.dragging) return;
      const L = this.layer(), rt = runtimes.get(L); if (!rt) return;
      const dx = p.x - this.last.x, dy = p.y - this.last.y; this.last = p;
      if (Math.hypot(p.x - this.p0.x, p.y - this.p0.y) > 3) this.moved = true;
      if (this.gz) { this.gizmoMove(p, dx, dy); this.redraw(this.previewScale()); return; }
      const s = L.scene3d, cam = rt.camera;
      const pos = new T.Vector3(...s.camera.pos), tgt = new T.Vector3(...s.camera.target);
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const unit = (dist) => (2 * Math.tan((cam.fov * Math.PI / 180) / 2) * dist) / app.doc.height;
      if (this.mode === 'orbit' || (this.mode === 'object' && !this.dragIK)) {
        if (this.mode === 'object' && !this.moved) return; // a tap selects (on release)
        const off = pos.clone().sub(tgt), sph = new T.Spherical().setFromVector3(off);
        sph.theta -= dx * 0.006; sph.phi = clamp(sph.phi - dy * 0.006, 0.05, Math.PI - 0.05);
        off.setFromSpherical(sph); s.camera.pos = tgt.clone().add(off).toArray();
      } else if (this.mode === 'pan') {
        const k = unit(pos.distanceTo(tgt)), d = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k));
        s.camera.pos = pos.add(d).toArray(); s.camera.target = tgt.add(d).toArray();
      } else if (this.mode === 'zoom') {
        const off = pos.clone().sub(tgt).multiplyScalar(Math.exp(dy * 0.004));
        if (off.length() > 0.2 && off.length() < 80) s.camera.pos = tgt.clone().add(off).toArray();
      } else {
        const e = rt.objs.get(this.sel); if (!e) return;
        const o = e.data;
        const qd = new T.Quaternion().setFromAxisAngle(up, dx * 0.01).multiply(new T.Quaternion().setFromAxisAngle(right, dy * 0.01));
        if (this.mode === 'move') {
          const k = unit(cam.position.distanceTo(e.node.position));
          o.pos = e.node.position.clone().add(right.clone().multiplyScalar(dx * k)).add(up.clone().multiplyScalar(-dy * k)).toArray();
        } else if (this.mode === 'rotate') {
          o.quat = qd.multiply(e.node.quaternion).toArray();
        } else if (this.mode === 'scale') {
          o.scale = clamp(o.scale * Math.exp(-dy * 0.005), 0.05, 50);
        } else if ((this.mode === 'pose' || this.dragIK) && this.joint && e.joints && e.rig === 'human' && this.ik && M.IK_CHAINS[this.joint]) {
          // drag a hand / foot: the arm / leg follows (two-bone IK), like Clip Studio
          const j = e.joints[this.joint], at = j.getWorldPosition(new T.Vector3());
          const k = unit(cam.position.distanceTo(at));
          const target = at.add(right.clone().multiplyScalar(dx * k)).add(up.clone().multiplyScalar(-dy * k));
          for (const n of M.solveIK(e.joints, this.joint, target)) o.pose[n] = e.joints[n].quaternion.toArray();
        } else if (this.mode === 'pose' && this.joint && e.joints) {
          const j = e.joints[this.joint];
          const pq = j.parent.getWorldQuaternion(new T.Quaternion());
          const local = pq.clone().invert().multiply(qd).multiply(pq).multiply(j.quaternion);
          o.pose[this.joint] = local.toArray();
        }
        syncObject(e);
      }
      this.redraw(this.previewScale());
    },
    up() {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.gz) {
        const g = this.gz; this.gz = null;
        this.commit(g.joint ? 'Pose' : g.handle[0] === 'r' ? 'Rotate object' : 'Move object', this.before);
        this.redraw(1); return;
      }
      if (this.mode === 'object') {
        if (!this.moved) this.tapSelect(this.tapHit);
        this.commit(this.dragIK ? 'Pose' : 'Orbit camera', this.before);
        this.dragIK = false; this.redraw(1); return;
      }
      if (!this.moved && (this.mode === 'move' || this.mode === 'rotate' || this.mode === 'scale') && !this.pick(this.p0)) { this.sel = null; app.updateCtxBar(); }
      this.commit({ orbit: 'Orbit camera', pan: 'Pan camera', zoom: 'Zoom camera', move: 'Move object', rotate: 'Rotate object', scale: 'Scale object', pose: 'Pose' }[this.mode], this.before);
      this.redraw(1);
    },
    cancel() { this.dragging = false; this.gz = null; this.redraw(1); },
    // ── manipulator ──
    rayAt(p, cam) { const r = new T.Raycaster(); r.setFromCamera(this.ndc(p), cam); return r; },
    gizmoHit(p) {
      const rt = runtimes.get(this.layer()); if (!rt || !rt.gizmo || !rt.gizmo.visible) return null;
      rt.gizmo.updateMatrixWorld(true);
      const picks = [], view = rt.camera.getWorldDirection(new T.Vector3());
      rt.gizmo.traverse((o) => {
        if (!o.isMesh || !o.userData.handle || !o.parent.visible) return;
        const hd = o.userData.handle;
        // a ring seen edge-on is just a line: it can't be turned sensibly and would cover the arrows
        if (hd[0] === 'r' && Math.abs(view.dot(new T.Vector3(...{ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[hd[1]]))) < 0.15) return;
        picks.push(o);
      });
      const hits = this.rayAt(p, rt.camera).intersectObjects(picks, false);
      // arrows, the floor square and the ball win over the rings they cross
      const hit = hits.find((x) => x.object.userData.handle[0] === 'm') || hits[0];
      return hit ? hit.object.userData.handle : null;
    },
    startGizmo(handle, p) {
      const rt = runtimes.get(this.layer()), e = this.selEntry(); if (!e || !rt.gizmoTarget) return false;
      const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[handle[1]];
      this.gz = { handle, e, rt, c: rt.gizmo.position.clone(), axis: ax && new T.Vector3(...ax), joint: rt.gizmoTarget.joint };
      this.gz.last = this.gizmoParam(p);
      return true;
    },
    // ring: the pointer's direction around the axis; arrow: its position along the axis;
    // square / ball: its point on the floor plane / the screen plane through the centre
    gizmoParam(p) {
      const { handle, c, axis, rt } = this.gz, ray = this.rayAt(p, rt.camera).ray;
      if (handle[0] === 'r') {
        if (Math.abs(ray.direction.dot(axis)) < 0.12) return null; // seen edge-on: use the drag distance
        const hit = ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(axis, c), new T.Vector3());
        return hit && hit.sub(c);
      }
      if (axis) {
        const w = c.clone().sub(ray.origin), b = axis.dot(ray.direction), den = 1 - b * b;
        return den < 1e-3 ? null : (b * ray.direction.dot(w) - axis.dot(w)) / den;
      }
      const n = handle === 'mf' ? new T.Vector3(0, 1, 0) : rt.camera.getWorldDirection(new T.Vector3());
      return ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(n, c), new T.Vector3());
    },
    gizmoMove(p, dx, dy) {
      const g = this.gz, now = this.gizmoParam(p), o = g.e.data, node = g.e.node;
      if (g.handle[0] === 'r') {
        const ang = now && g.last ? Math.atan2(new T.Vector3().crossVectors(g.last, now).dot(g.axis), g.last.dot(now)) : (dx - dy) * 0.01;
        g.last = now;
        const q = new T.Quaternion().setFromAxisAngle(g.axis, ang);
        if (g.joint) {
          const j = g.e.joints[g.joint], pq = j.parent.getWorldQuaternion(new T.Quaternion());
          o.pose = { ...(o.pose || {}), [g.joint]: pq.clone().invert().multiply(q).multiply(pq).multiply(j.quaternion).toArray() };
        } else {
          const pq = node.parent.getWorldQuaternion(new T.Quaternion());
          o.quat = pq.clone().invert().multiply(q).multiply(pq).multiply(node.quaternion).toArray();
          // turn about the manipulator's centre, not the object's origin
          const wp = node.getWorldPosition(new T.Vector3()).sub(g.c).applyQuaternion(q).add(g.c);
          o.pos = node.parent.worldToLocal(wp).toArray();
        }
      } else {
        if (now == null || g.last == null) { g.last = now; return; }
        const d = typeof now === 'number' ? g.axis.clone().multiplyScalar(now - g.last) : now.clone().sub(g.last);
        g.last = now;
        o.pos = node.parent.worldToLocal(node.getWorldPosition(new T.Vector3()).add(d)).toArray();
      }
      syncObject(g.e);
    },
    // tap: select a model; tap the selected one again on a body part for that joint's rings
    tapSelect(hit) {
      const rt = runtimes.get(this.layer());
      if (!hit) { this.sel = null; this.joint = null; }
      else if (hit.objId === this.sel) { const e = rt.objs.get(hit.objId); this.joint = e && e.joints && hit.joint && hit.joint !== this.jointBefore ? hit.joint : null; }
      else { this.sel = hit.objId; this.joint = null; }
      this.highlight(this.joint); app.updateCtxBar(); this.panelRefresh();
    },
    // ── property panel (like Clip Studio's tool property / sub tool detail for 3D) ──
    openPanel() {
      if (isFloating('3d')) { this.panelRefresh(); return; }
      this.panelEl = h('div', { class: 'pop-body p3d' });
      openFloating('3d', '3D', { width: 330, body: this.panelEl, onClose: () => { this.panelEl = null; } });
      this.panelRefresh();
    },
    panelRefresh() {
      if (!this.panelEl) return;
      const keep = this.panelEl.scrollTop;
      this.panelEl.replaceChildren(...this.panelBuild());
      this.panelEl.scrollTop = keep;
    },
    panelBuild() {
      const L = this.layer();
      if (!L) return [h('p', { class: 'hint' }, 'Select a 3D layer to edit it.')];
      const s = L.scene3d, e = this.selEntry();
      const sec = (title, ...kids) => {
        const d = h('details', { class: 'p3d-sec' }, h('summary', {}, title), ...kids);
        d.open = this.panelOpen[title] !== false;
        d.addEventListener('toggle', () => { this.panelOpen[title] = d.open; });
        return d;
      };
      const btn = (label, fn) => h('button', { class: 'lib3d-item', onclick: fn }, label);
      const grid = (...b) => h('div', { class: 'lib3d-grid' }, ...b.filter(Boolean));
      const out = [];
      // add (Clip Studio's 3D materials)
      const lib = h('details', { class: 'p3d-sub' }, h('summary', {}, 'Library'));
      for (const [cat, items] of LIBRARY) lib.append(h('div', { class: 'menu-section' }, cat), grid(...items.map(([gen, label]) => btn(label, () => this.addLibrary(gen)))));
      out.push(sec('Add model', grid(btn('Female figure', () => this.addFigure('female')), btn('Male figure', () => this.addFigure('male')), btn('Shape…', () => this.shapeMenu()), btn('Import file…', () => this.importModel()), btn('Free assets…', () => this.assetMenu())), lib));
      // objects in the layer
      out.push(sec('Objects', ...(s.objects.length ? s.objects.map((o) => h('div', { class: 'p3d-row' + (o.id === this.sel ? ' on' : '') },
        h('button', { class: 'p3d-name', onclick: () => { this.sel = o.id; this.joint = null; this.highlight(null); this.redraw(1); app.updateCtxBar(); this.panelRefresh(); } }, o.name || o.kind),
        h('button', { class: 'p3d-x', title: 'Delete', onclick: () => { this.sel = o.id; this.deleteSel(); this.panelRefresh(); } }, '×'))) : [h('p', { class: 'hint' }, 'Nothing here yet — add a model above.')])));
      if (e) out.push(...this.panelObject(e, sec, btn, grid));
      // light source
      out.push(sec('Light source', h('p', { class: 'hint' }, 'Drag the dot: the middle is light from above, the edge is light from the side. Bottom = from the front.'), this.lightPad(),
        field('Strength', { min: 0, max: 6, step: 0.05, value: s.light.intensity, fmt: (v) => v.toFixed(1), onInput: (v) => this.edit('Light', () => { s.light.intensity = v; }) }),
        field('Ambient', { min: 0, max: 3, step: 0.05, value: s.light.ambient, fmt: (v) => v.toFixed(1), onInput: (v) => this.edit('Light', () => { s.light.ambient = v; }) })));
      // lines
      out.push(sec('Lines', switchRow('Outlines', s.outline, (v) => this.edit('Outlines', () => { s.outline = v; })),
        field('Line width', { min: 0.002, max: 0.03, step: 0.001, value: s.outlineWidth, fmt: (v) => v.toFixed(3), onInput: (v) => this.edit('Line width', () => { s.outlineWidth = v; }) })));
      // camera
      out.push(sec('Camera', grid(...CAM_ANGLES.map(([label, ...a]) => btn(label, () => this.camAngle(...a)))),
        field('Lens (field of view)', { min: 10, max: 90, step: 1, value: s.camera.fov, fmt: (v) => v + '°', onInput: (v) => this.edit('Lens', () => { s.camera.fov = v; }) }),
        grid(btn('Reset camera', () => { const b = this.snapshot(); L.scene3d.camera = defaultScene().camera; this.commit('Reset camera', b); this.redraw(1); }))));
      out.push(h('button', { class: 'pill primary p3d-wide', onclick: () => this.rasterize() }, 'Rasterize (make it paintable)'));
      return out;
    },
    panelObject(e, sec, btn, grid) {
      const o = e.data, human = e.rig === 'human', out = [];
      out.push(h('div', { class: 'p3d-title' }, o.name || o.kind));
      if (o.kind === 'figure' && o.rig === 2) {
        const b = o.body;
        const rebuildBody = (fn) => this.edit('Body', fn, true);
        out.push(sec('Body',
          h('div', { class: 'stack' }, seg([['female', 'Female'], ['male', 'Male']], b.sex, (v) => rebuildBody(() => { b.sex = v; if (v === 'male' && b.height < 1.68) b.height = 1.75; if (v === 'female' && b.height > 1.7) b.height = 1.62; }))),
          h('div', { class: 'p3d-lab' }, 'Body shape'), this.shapePad(o),
          field('Height', { min: 1.2, max: 2.1, step: 0.01, value: b.height, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => rebuildBody(() => { b.height = v; }) }),
          field('Head-to-body ratio', { min: 5, max: 9, step: 0.1, value: b.heads, fmt: (v) => v.toFixed(1) + ' heads', onInput: (v) => rebuildBody(() => { b.heads = v; }) }),
          h('div', { class: 'stack' }, h('label', {}, 'Armour'), seg([['none', 'None'], ['medieval', 'Medieval'], ['scifi', 'Sci-fi']], o.outfit || 'none', (v) => rebuildBody(() => { o.outfit = v; }))),
          switchRow('Guide lines (face & body centre, eye line)', b.guides !== false, (v) => { const m = e.fig && e.fig.mesh; this.edit('Guide lines', () => { b.guides = v; if (m && m.userData.setGuides) m.userData.setGuides(v); }); })));
      }
      if (e.joints) {
        out.push(sec('Pose', grid(btn('Poses…', () => this.poseMenu()), human && btn('Hands…', () => this.handMenu()), human && btn('Mirror', () => this.mirrorPose()), human && btn('BVH…', () => this.bvhMenu()), btn('Reset pose', () => this.resetPose())),
          human && switchRow('IK (drag a hand / foot to move the limb)', this.ik, (v) => { this.ik = v; app.updateCtxBar(); }),
          h('p', { class: 'hint' }, this.joint ? `${this.jointLabel(this.joint)}: drag the rings to turn it. Tap it again to go back to the whole model.` : 'Tap a body part of the selected model to turn that joint with the rings.')));
      }
      const color = h('input', { type: 'color', value: o.color || '#cfcac2' });
      color.oninput = () => this.edit('Colour', () => { o.color = color.value; e.node.traverse((m) => { if (m.isMesh && !m.userData.outline && m.material && m.material.color && !m.userData.handle) m.material.color.set(color.value); }); });
      out.push(sec('Object',
        field('Size', { min: 0.05, max: 10, step: 0.01, value: o.scale, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => this.edit('Scale object', () => { o.scale = v; syncObject(e); }) }),
        grid(btn('Stand on floor', () => { const b = this.snapshot(); o.pos = [o.pos[0], 0, o.pos[2]]; syncObject(e); this.commit('Move object', b); this.redraw(1); }),
          btn('Reset rotation', () => { const b = this.snapshot(); o.quat = [0, 0, 0, 1]; syncObject(e); this.commit('Rotate object', b); this.redraw(1); }),
          btn('Frame in view', () => this.frameObject(o.id, o.gen)), o.kind === 'weapon' && btn('Hold…', () => this.holdMenu()), btn('Material…', () => this.materialDialog())),
        h('div', { class: 'toggle-row' }, h('span', {}, 'Colour'), color)));
      return out;
    },
    // Clip Studio's body-shape pad: across = body fat (lean → heavy), up = musculature
    shapePad(o) {
      const W = 290, Hh = 150, c = h('canvas', { class: 'p3d-pad', width: W * 2, height: Hh * 2 });
      const { muscle, fat } = MH.bodyShape(o.body);
      let st = { muscle, fat };
      const draw = () => {
        const x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, W, Hh);
        x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, 0, W, Hh);
        x.strokeStyle = 'rgba(255,255,255,0.12)'; for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(W * k / 4, 0); x.lineTo(W * k / 4, Hh); x.moveTo(0, Hh * k / 4); x.lineTo(W, Hh * k / 4); x.stroke(); }
        x.fillStyle = 'rgba(255,255,255,0.55)'; x.font = '11px system-ui';
        x.fillText('muscular', 6, 13); x.fillText('soft', 6, Hh - 6); x.textAlign = 'right'; x.fillText('heavy', W - 6, Hh / 2 + 4); x.textAlign = 'left'; x.fillText('lean', 6, Hh / 2 + 4);
        const px = st.fat * W, py = (1 - st.muscle) * Hh;
        x.fillStyle = '#2f7dff'; x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, 8, 0, Math.PI * 2); x.fill(); x.stroke();
      };
      const set = (ev) => {
        const r = c.getBoundingClientRect();
        st = { fat: clamp((ev.clientX - r.left) / r.width, 0, 1), muscle: clamp(1 - (ev.clientY - r.top) / r.height, 0, 1) };
        draw();
        this.edit('Body shape', () => { o.body.muscle = +st.muscle.toFixed(3); o.body.fat = +st.fat.toFixed(3); o.body.build = o.body.muscle; }, true);
      };
      c.addEventListener('pointerdown', (ev) => { c.setPointerCapture(ev.pointerId); set(ev); });
      c.addEventListener('pointermove', (ev) => { if (c.hasPointerCapture(ev.pointerId)) set(ev); });
      draw();
      return c;
    },
    // light direction: seen from above, the figure facing down the pad
    lightPad() {
      const S = 150, R = S / 2 - 10, c = h('canvas', { class: 'p3d-pad p3d-light', width: S * 2, height: S * 2 }), sc = this.layer().scene3d;
      const draw = () => {
        const x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, S, S);
        const g = x.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, R); g.addColorStop(0, '#5a5a62'); g.addColorStop(1, '#202024');
        x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, R, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.5)'; x.font = '10px system-ui'; x.textAlign = 'center'; x.fillText('front', S / 2, S - 2); x.fillText('back', S / 2, 9);
        const az = sc.light.az * Math.PI / 180, r = (1 - sc.light.el / 90) * R;
        x.fillStyle = '#ffd34d'; x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(S / 2 + Math.sin(az) * r, S / 2 + Math.cos(az) * r, 8, 0, Math.PI * 2); x.fill(); x.stroke();
      };
      const set = (ev) => {
        const b = c.getBoundingClientRect(), dx = (ev.clientX - b.left) / b.width * S - S / 2, dy = (ev.clientY - b.top) / b.height * S - S / 2;
        const r = Math.min(1, Math.hypot(dx, dy) / R);
        this.edit('Light', () => { sc.light.az = Math.round(Math.atan2(dx, dy) * 180 / Math.PI); sc.light.el = Math.round((1 - r) * 90); });
        draw();
      };
      c.addEventListener('pointerdown', (ev) => { c.setPointerCapture(ev.pointerId); set(ev); });
      c.addEventListener('pointermove', (ev) => { if (c.hasPointerCapture(ev.pointerId)) set(ev); });
      draw();
      return c;
    },
    camAngle(dirv, fov, dk = 1, dy = 0) {
      const L = this.layer(), s = L.scene3d, e = this.poseTarget();
      const at = e ? gizmoCenter(e, null) : new T.Vector3(...s.camera.target);
      const dist = Math.max(1.2, new T.Vector3(...s.camera.pos).distanceTo(new T.Vector3(...s.camera.target)));
      const b = this.snapshot(), d = new T.Vector3(...dirv).normalize().multiplyScalar(dist * dk);
      s.camera = { pos: at.clone().add(d).toArray(), target: [at.x, at.y + dy, at.z], fov };
      this.commit('Camera angle', b); this.redraw(1);
    },
    bar() {
      const L = this.layer();
      if (!L) return [h('span', { class: 'three-hint' }, 'Select a 3D layer to edit it')];
      const cb = (label, fn, on, cls = '') => h('button', { class: 'cb-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
      const sep = () => h('span', { class: 'cb-sep' });
      const setMode = (m) => { this.mode = m; if (m !== 'pose' && m !== 'object') { this.joint = null; this.highlight(null); } this.redraw(1); app.updateCtxBar(); };
      const e = this.selEntry();
      const items = [
        cb('Object', () => setMode('object'), this.mode === 'object'), sep(),
        ...[['orbit', 'Orbit'], ['pan', 'Pan'], ['zoom', 'Zoom']].map(([m, l]) => cb(l, () => setMode(m), this.mode === m)), cb('Camera…', () => this.cameraMenu()), sep(),
        ...[['move', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale'], ['pose', 'Pose']].map(([m, l]) => cb(l, () => setMode(m), this.mode === m)), sep(),
        cb('Panel', () => (isFloating('3d') ? closeFloat('3d') : this.openPanel()), isFloating('3d')), cb('Manipulator', () => { this.gizmoOn = !this.gizmoOn; this.redraw(1); app.updateCtxBar(); }, this.gizmoOn), sep(),
        cb('＋ Figure', () => this.figureMenu()), cb('＋ Library…', () => this.libraryMenu()), cb('＋ Model…', () => this.importModel()), cb('＋ Assets…', () => this.assetMenu()), cb('＋ Shape', () => this.shapeMenu()),
        cb('Light…', () => this.lightDialog()),
      ];
      if (e && e.data.kind === 'weapon') items.push(sep(), cb('Hold…', () => this.holdMenu()));
      if (e) items.push(cb('Material…', () => this.materialDialog()));
      if (this.mode === 'object') items.push(sep(), h('span', { class: 'three-hint' }, !e ? 'Tap a model to select it · drag empty space to orbit' : this.joint ? `${this.jointLabel(this.joint)} · drag the rings` : 'Drag the rings / arrows · tap a body part for its joint'));
      if (this.mode === 'pose' || (this.mode === 'object' && e && e.joints)) {
        const ikJoint = this.joint && M.IK_CHAINS[this.joint] && e && e.rig === 'human';
        items.push(sep(), h('span', { class: 'three-hint' }, this.joint ? (ikJoint && this.ik ? `${this.jointLabel(this.joint)} · drag to move the limb` : `${this.jointLabel(this.joint)} · drag to bend`) : 'Tap a body part, then drag'));
        if (e && e.rig === 'human') items.push(cb('IK', () => { this.ik = !this.ik; app.updateCtxBar(); }, this.ik));
        items.push(cb('Poses…', () => this.poseMenu()));
        if (e && e.rig === 'human') items.push(cb('Hands…', () => this.handMenu()), cb('Mirror', () => this.mirrorPose()), e.data.kind === 'figure' && cb('Body…', () => this.bodyDialog()), cb('BVH…', () => this.bvhMenu()));
        if (e && e.joints) items.push(cb('Reset pose', () => this.resetPose()));
      }
      if (this.sel) items.push(sep(), cb('Delete object', () => this.deleteSel()));
      items.push(sep(), cb('Reset camera', () => { const b = this.snapshot(); L.scene3d.camera = defaultScene().camera; this.commit('Reset camera', b); this.redraw(1); }), cb('Rasterize', () => this.rasterize(), false, 'primary'));
      return items;
    },
    selEntry() { const L = this.layer(), rt = L && runtimes.get(L); return rt && this.sel ? rt.objs.get(this.sel) : null; },
    jointLabel(j) {
      const side = /L\d?$/.test(j) ? 'left ' : /R\d?$/.test(j) ? 'right ' : '';
      const base = j.replace(/^d_/, '').replace(/(L|R)(\d?)$/, '$2').replace(/(\d)$/, ' $1');
      return side + base;
    },
    // the figure / dragon to pose: the selection, else the first posable object
    poseTarget() {
      const L = this.layer(), rt = L && runtimes.get(L); if (!rt) return null;
      const e = this.selEntry();
      if (e && e.joints) return e;
      for (const x of rt.objs.values()) if (x.joints) { this.sel = x.data.id; return x; }
      return null;
    },
    figureMenu() {
      dialog({ title: 'Add drawing figure', body: h('p', { class: 'hint' }, 'Clip Studio-style mannequins with finger joints. Pose: tap a part, drag (hands / feet move the whole arm / leg). Body… changes height, head ratio, build and armour.'), actions: [
        { label: 'Female', onClick: () => this.addFigure('female') }, { label: 'Male', onClick: () => this.addFigure('male') }, { label: 'Cancel', primary: true },
      ] });
    },
    libraryMenu() {
      const body = h('div', { class: 'lib3d' });
      let dlg = null;
      for (const [cat, items] of LIBRARY) {
        body.append(h('div', { class: 'menu-section' }, cat));
        const grid = h('div', { class: 'lib3d-grid' });
        for (const [gen, label] of items) grid.append(h('button', { class: 'lib3d-item', onclick: () => { dlg && dlg.close(); this.addLibrary(gen); } }, label));
        body.append(grid);
      }
      dlg = dialog({ title: '3D model library', wide: true, body, actions: [{ label: 'Close', primary: true }] });
    },
    async addLibrary(gen) {
      const L = this.layer(), n = L.scene3d.objects.length;
      if (gen === 'figure-female' || gen === 'figure-male') return this.addFigure(gen === 'figure-male' ? 'male' : 'female');
      if (gen === 'knight' || gen === 'scifi') { const o = figureObject(n * 0.7, gen === 'knight' ? 'male' : 'female'); o.outfit = gen === 'knight' ? 'medieval' : 'scifi'; o.name = gen === 'knight' ? 'Knight' : 'Sci-fi armour'; return this.addObject(o, 'Add ' + o.name); }
      if (gen.startsWith('w:')) return this.addWeapon(gen.slice(2));
      const big = ['castle', 'street', 'district', 'cyber', 'ruins', 'mountains', 'forest', 'desert'].includes(gen);
      const o = procObject(gen, big ? 0 : n * 1.2);
      if (gen === 'dragon' || gen === 'kraken') o.pos = [n ? 4 : 0, 0, n ? -4 : 0];
      await this.addObject(o, 'Add ' + o.name);
      this.frameObject(o.id, gen);
    },
    // fit the camera to an object (castles, cities and dragons are much bigger than a figure)
    frameObject(id, gen) {
      const L = this.layer(), rt = runtimes.get(L), e = rt && rt.objs.get(id); if (!e) return;
      const b = this.snapshot(), s = L.scene3d;
      // skinned meshes refresh their inverse bind matrix only in updateMatrixWorld — without it
      // the box would count the object's position twice
      e.node.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(e.node), c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
      if (gen === 'street' || gen === 'ruins') { s.camera = { pos: [2, 1.6, -60], target: [0, 4, 0], fov: 40 }; }
      else if (gen === 'cyber') { s.camera = { pos: [1.5, 1.7, -70], target: [0, 9, 0], fov: 50 }; }
      else if (['mountains', 'forest', 'desert'].includes(gen)) { s.camera = { pos: [-40, gen === 'mountains' ? 22 : 12, 120], target: [0, gen === 'mountains' ? 22 : 4, 0], fov: 45 }; }
      else if (gen === 'district') { s.camera = { pos: [-110, 70, 150], target: [0, 15, 0], fov: 40 }; }
      else {
        const r = size.length() / 2, dist = r / Math.sin((s.camera.fov * Math.PI / 180) / 2) * 0.9;
        const dir = new T.Vector3(0.55, 0.32, 1).normalize();
        s.camera = { ...s.camera, target: [c.x, c.y * 0.8, c.z], pos: c.clone().add(dir.multiplyScalar(dist)).toArray() };
      }
      this.commit('Frame model', b); this.redraw(1);
    },
    cameraMenu() {
      const L = this.layer(), s = L.scene3d, e = this.poseTarget();
      const at = e ? e.node.position.clone().add(new T.Vector3(0, (e.rig === 'dragon' || (e.rig === 'creature' && e.data.gen === 'dragon') ? 1.8 : e.rig === 'creature' ? 1.0 : 0.95) * e.data.scale, 0)) : new T.Vector3(...s.camera.target);
      const dist = Math.max(1.2, new T.Vector3(...s.camera.pos).distanceTo(new T.Vector3(...s.camera.target)));
      const set = (dirv, fov, dk = 1, dy = 0) => { const b = this.snapshot(); const d = new T.Vector3(...dirv).normalize().multiplyScalar(dist * dk); s.camera = { pos: at.clone().add(d).toArray(), target: [at.x, at.y + dy, at.z], fov }; this.commit('Camera angle', b); this.redraw(1); };
      dialog({ title: 'Camera angle', body: h('p', { class: 'hint' }, 'Dynamic angles like PoseManiacs. Aims at the selected figure.'), actions: [
        { label: 'Front', onClick: () => set([0, 0.05, 1], 35) }, { label: 'Three-quarter', onClick: () => set([0.7, 0.12, 1], 35) }, { label: 'Side', onClick: () => set([1, 0.05, 0], 35) }, { label: 'Back', onClick: () => set([-0.4, 0.1, -1], 35) },
        { label: 'High angle', onClick: () => set([0.45, 1.3, 1], 40) }, { label: 'Low angle', onClick: () => set([0.4, -0.55, 1], 45, 0.85, 0.3) }, { label: 'Dramatic (wide, low)', onClick: () => set([0.8, -0.35, 0.9], 70, 0.55, 0.25) }, { label: 'Top down', onClick: () => set([0.01, 1, 0.02], 40, 1.2) },
        { label: 'Cancel', primary: true },
      ] });
    },
    poseMenu() {
      const e = this.poseTarget();
      if (!e) { toast('Add a figure or a creature first'); return; }
      const cname = e.rig === 'creature' ? e.data.name : 'Dragon';
      const b = this.snapshot(), lib = e.rig === 'dragon' ? { Dragon: M.DRAGON_POSES } : e.rig === 'creature' ? { [cname]: C.creaturePoses(e.data.gen) } : e.rig === 'human' ? M.HUMAN_POSES : null;
      if (!lib) { toast('This older figure has no pose library — add a new figure'); return; }
      const body = h('div', { class: 'lib3d' });
      let cur = null;
      for (const [cat, poses] of Object.entries(lib)) {
        body.append(h('div', { class: 'menu-section' }, cat));
        const grid = h('div', { class: 'lib3d-grid' });
        for (const [name, def] of Object.entries(poses)) {
          const btn = h('button', { class: 'lib3d-item', onclick: () => {
            // keep the current hand shapes unless the pose sets its own
            const keepHands = Object.fromEntries(Object.entries(e.data.pose || {}).filter(([k]) => /^(thumb|index|middle|ring|pinky)[LR]\d$/.test(k)));
            e.data.pose = { ...keepHands, ...M.poseFromDegrees(def) };
            syncObject(e); this.redraw(1);
            if (cur) cur.classList.remove('on'); btn.classList.add('on'); cur = btn;
          } }, name);
          grid.append(btn);
        }
        body.append(grid);
      }
      dialog({ title: (e.rig === 'human' ? 'Figure' : cname) + ' poses', wide: true, body, actions: [{ label: 'Done', primary: true }], onClose: () => this.commit('Pose preset', b) });
    },
    handMenu() {
      const e = this.poseTarget(); if (!e || e.rig !== 'human') return;
      const b = this.snapshot();
      let side = 'both';
      const sideSeg = h('div', { class: 'seg' }, ...[['both', 'Both'], ['L', 'Left'], ['R', 'Right']].map(([v, l]) => { const bt = h('button', { class: v === side ? 'on' : '', onclick: () => { side = v; for (const x of sideSeg.children) x.classList.remove('on'); bt.classList.add('on'); } }, l); return bt; }));
      const grid = h('div', { class: 'lib3d-grid' });
      for (const name of Object.keys(M.HAND_SHAPES)) grid.append(h('button', { class: 'lib3d-item', onclick: () => {
        const hp = M.handPose(name, side), q = M.poseFromDegrees(hp);
        const pose = { ...e.data.pose };
        for (const k of Object.keys(pose)) if (/^(thumb|index|middle|ring|pinky)[LR]\d$/.test(k) && (side === 'both' || k.includes(side))) delete pose[k];
        e.data.pose = name === 'Relaxed' ? pose : { ...pose, ...q };
        syncObject(e); this.redraw(1);
      } }, name));
      dialog({ title: 'Hands', body: h('div', {}, sideSeg, grid, h('p', { class: 'hint' }, 'Fingers can also be posed one joint at a time: zoom in and tap a finger in Pose mode.')), actions: [{ label: 'Done', primary: true }], onClose: () => this.commit('Hand shape', b) });
    },
    mirrorPose() { const e = this.poseTarget(); if (!e || e.rig !== 'human') return; const b = this.snapshot(); e.data.pose = M.mirrorStored(e.data.pose || {}); syncObject(e); this.commit('Mirror pose', b); this.redraw(1); },
    resetPose() { const e = this.poseTarget(); if (!e) return; const b = this.snapshot(); e.data.pose = {}; syncObject(e); this.commit('Reset pose', b); this.redraw(1); },
    async rebuild(e) {
      const L = this.layer(), rt = runtimes.get(L);
      rt.scene.remove(e.node);
      e.node.traverse((m) => { if (m.isMesh && m.geometry && !m.userData.outline && m.userData.objId === e.data.id) m.geometry.dispose(); });
      await buildObject(L, rt, e.data);
      attachAll(rt);
      this.highlight(null);
    },
    bodyDialog() {
      const e = this.poseTarget(); if (!e || e.rig !== 'human') return;
      const o = e.data, b = this.snapshot(), body = { ...o.body };
      let t = null;
      const apply = () => { clearTimeout(t); t = setTimeout(async () => { o.body = { ...body }; await this.rebuild(this.selEntry() || e); this.redraw(1); }, 120); };
      const color = h('input', { type: 'color', value: o.color || '#c9c6c1' });
      color.oninput = () => { o.color = color.value; apply(); };
      dialog({ title: 'Body', body: h('div', {},
        h('div', { class: 'stack' }, h('label', {}, 'Body'), seg([['female', 'Female'], ['male', 'Male']], body.sex, (v) => { body.sex = v; if (v === 'male' && body.height < 1.68) body.height = 1.75; if (v === 'female' && body.height > 1.7) body.height = 1.62; apply(); })),
        field('Height', { min: 1.2, max: 2.1, step: 0.01, value: body.height, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => { body.height = v; apply(); } }),
        field('Head-to-body ratio', { min: 5, max: 9, step: 0.1, value: body.heads, fmt: (v) => v.toFixed(1) + ' heads', onInput: (v) => { body.heads = v; apply(); } }),
        field('Build', { min: 0, max: 1, step: 0.05, value: body.build, fmt: (v) => (v < 0.3 ? 'slim' : v < 0.7 ? 'average' : 'strong'), onInput: (v) => { body.build = v; apply(); } }),
        h('div', { class: 'stack' }, h('label', {}, 'Armour'), seg([['none', 'None'], ['medieval', 'Medieval'], ['scifi', 'Sci-fi']], o.outfit || 'none', (v) => { o.outfit = v; apply(); })),
        switchRow('Guide lines (face & body centre, eye line)', body.guides !== false, (v) => { body.guides = v; o.body = { ...o.body, guides: v }; const m = e.fig && e.fig.mesh; if (m && m.userData.setGuides) { m.userData.setGuides(v); this.redraw(1); } }),
        h('div', { class: 'toggle-row' }, h('span', {}, 'Colour'), color)),
        actions: [{ label: 'Done', primary: true }], onClose: () => { clearTimeout(t); o.body = { ...body }; this.rebuild(this.selEntry() || e).then(() => { this.commit('Body', b); this.redraw(1); }); } });
    },
    bvhMenu() {
      const e = this.poseTarget(); if (!e || e.rig !== 'human') return;
      dialog({ title: 'BVH poses', body: h('p', { class: 'hint' }, 'BVH is the open pose format Clip Studio Paint imports (File › Import › 3D data), and Mixamo, Blender and most pose libraries export. Multi-frame files become numbered poses to choose from.'), actions: [
        { label: 'Cancel' },
        { label: 'Export pose (.bvh)', onClick: async () => { const { download } = await import('./util.js'); download(new Blob([M.exportBVH(e.fig, e.data.pose || {})], { type: 'text/plain' }), (e.data.name || 'pose').replace(/[^\w -]+/g, '') + '.bvh'); } },
        { label: 'Import BVH…', primary: true, onClick: () => this.importBVH(e) },
      ] });
    },
    async importBVH(e) {
      const [f] = await pickFile('.bvh,text/plain');
      if (!f) return;
      let bvh;
      try { bvh = M.parseBVH(await f.text()); } catch (err) { toast('Could not read this BVH: ' + err.message, 4000); return; }
      const info = M.bvhInfo(bvh);
      if (!info.hasBody) { toast(`Only ${info.mapped} joints matched a human skeleton — this BVH may use unusual joint names`, 5000); if (!info.mapped) return; }
      const b = this.snapshot();
      const show = (k) => { try { e.data.pose = M.retargetBVH(bvh, k, e.fig); syncObject(e); this.redraw(this.previewScale()); } catch (err) { toast(err.message, 4000); } };
      show(0);
      if (bvh.frames.length === 1) { this.commit('Import BVH pose', b); this.redraw(1); toast(`Pose imported (${info.mapped} joints matched)`); return; }
      let k = 0;
      const label = h('span', { class: 'hint' }, `Pose 1 of ${bvh.frames.length}`);
      const slider = h('input', { type: 'range', min: 0, max: bvh.frames.length - 1, step: 1, value: '0' });
      slider.oninput = () => { k = +slider.value; label.textContent = `Pose ${k + 1} of ${bvh.frames.length}`; show(k); };
      dialog({ title: f.name, body: h('div', {}, h('p', { class: 'hint' }, `${bvh.frames.length} poses · ${info.mapped} joints matched. Scrub to pick one.`), slider, label), actions: [{ label: 'Cancel', onClick: () => { const s0 = JSON.parse(b); e.data.pose = s0.objects.find((x) => x.id === e.data.id)?.pose || {}; syncObject(e); this.redraw(1); } }, { label: 'Use this pose', primary: true, onClick: () => { this.commit('Import BVH pose', b); this.redraw(1); } }] });
    },
    // weapons go into a figure's hand (shields on the left) with a closed grip; else stand alone
    async addWeapon(kind) {
      const L = this.layer(), rt = await runtimeFor(L), def = WD.WEAPONS[kind];
      const sel = this.selEntry(), host = sel && sel.rig === 'human' ? sel : [...rt.objs.values()].find((x) => x.rig === 'human');
      const o = { id: uid(), kind: 'weapon', weapon: kind, name: def.label, pos: [L.scene3d.objects.length * 0.5, 0.9, 0], quat: [0, 0, 0, 1], scale: 1, color: '#cccccc' };
      if (host) {
        const side = def.grip === 'shield' ? 'L' : 'R';
        Object.assign(o, { attach: { to: host.data.id, side } }, WD.gripTransform(side, def.grip, host.fig.H * 0.105));
        host.data.pose = { ...host.data.pose, ...M.poseFromDegrees(M.handPose('Grip', side)) };
      }
      await this.addObject(o, 'Add ' + def.label);
    },
    holdMenu() {
      const e = this.selEntry(); if (!e || e.data.kind !== 'weapon') return;
      const L = this.layer(), rt = runtimes.get(L), def = WD.WEAPONS[e.data.weapon];
      const fig = (e.data.attach && rt.objs.get(e.data.attach.to)) || [...rt.objs.values()].find((x) => x.rig === 'human');
      const hold = (side) => {
        const b = this.snapshot();
        if (!side || !fig) { const wp = e.node.getWorldPosition(new T.Vector3()); delete e.data.attach; e.data.pos = [wp.x, wp.y, wp.z]; e.data.quat = [0, 0, 0, 1]; }
        else { Object.assign(e.data, { attach: { to: fig.data.id, side } }, WD.gripTransform(side, def.grip, fig.fig.H * 0.105)); fig.data.pose = { ...fig.data.pose, ...M.poseFromDegrees(M.handPose('Grip', side)) }; }
        attachAll(rt); syncAll(rt); this.commit('Hold weapon', b); this.redraw(1);
      };
      dialog({ title: def.label, body: h('p', { class: 'hint' }, fig ? 'Put it in a hand of ' + (fig.data.name || 'the figure') + ' — it follows every pose. Move / Rotate adjust how it sits.' : 'Add a figure to hold it.'), actions: [
        ...(fig ? [{ label: 'Right hand', onClick: () => hold('R') }, { label: 'Left hand', onClick: () => hold('L') }] : []), { label: 'Not held', onClick: () => hold(null) }, { label: 'Cancel', primary: true },
      ] });
    },
    async addObject(o, label) {
      const L = this.layer(); const b = this.snapshot();
      L.scene3d.objects.push(o);
      const rt = await runtimeFor(L); await buildObject(L, rt, o); attachAll(rt); syncAll(rt);
      this.sel = o.id; this.commit(label, b); this.redraw(1); app.updateCtxBar();
    },
    addFigure(sex = 'female') { const n = this.layer().scene3d.objects.filter((o) => o.kind === 'figure').length; this.addObject(figureObject(n * 0.7, sex), 'Add figure'); },
    shapeMenu() {
      dialog({ title: 'Add shape', body: '', actions: [
        ...[['cube', 'Cube'], ['sphere', 'Sphere'], ['cylinder', 'Cylinder'], ['cone', 'Cone'], ['floor', 'Floor plane']].map(([k, l]) => ({ label: l, onClick: () => this.addObject({ id: uid(), kind: 'prim', prim: k, name: l, pos: [0.8, 0, 0], quat: [0, 0, 0, 1], scale: 1, color: '#cfcac2' }, 'Add ' + l) })),
        { label: 'Cancel', primary: true },
      ] });
    },
    async importModel() {
      const picked = await pickFile('.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.zip,.blend,.vrm,.fbx,.obj,.cs3c,.cs3o,.cs3s,.cmo,.csmf,.c2fc', true);
      if (!picked.length) return;
      // Blender exports: .glb, .gltf with its .bin / textures, or a .zip of the export folder
      let f = picked[0];
      if (picked.length > 1 || /\.(gltf|zip|blend\d*)$/i.test(f.name)) {
        try {
          const r = await AS.modelFromFiles(picked);
          if (!r) { toast('No 3D model among those files', 4000); return; }
          f = new File([r.blob], r.name);
        } catch (e) {
          if (e.message === 'BLEND') dialog({ title: 'Blender file', body: h('p', {}, AS.BLEND_HELP), actions: [{ label: 'OK', primary: true }] });
          else toast('Could not read that model: ' + e.message, 6000);
          return;
        }
      }
      let ext = f.name.split('.').pop().toLowerCase(), blob = f, note = '';
      if (!['glb', 'gltf', 'vrm', 'fbx', 'obj'].includes(ext)) {
        // Clip Studio (or unknown) file: look for a standard model embedded inside it
        toast('Looking inside ' + f.name + '…', 6000);
        const found = await extractEmbeddedModel(new Uint8Array(await f.arrayBuffer()));
        if (!found) {
          toast("No standard 3D data inside this Clip Studio file (its format is closed). Get the model as FBX / OBJ / glTF / VRM — most CSP Assets creators also publish those — or pose it in CSP and import a render as an image.", 8000);
          return;
        }
        ext = found.ext; blob = new Blob([found.bytes]); note = ` (${found.ext.toUpperCase()} found inside ${f.name})`;
      }
      const L = this.layer();
      const id = uid();
      L.models.set(id, { id, ext, name: f.name, blob });
      toast('Loading ' + f.name + '…', 6000);
      try { await this.addObject({ id: uid(), kind: 'model', modelId: id, name: f.name, pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1 }, 'Import model'); toast('Model added' + note + ' — use Move / Rotate / Scale', 4000); }
      catch (e) { console.error(e); L.models.delete(id); toast('Could not read that model: ' + e.message, 4500); }
    },
    assetMenu() {
      AS.openAssetBrowser({
        onModel: (rec) => this.addAssetModel(rec),
        onMaterial: (rec) => { if (!this.sel) return false; this.setMaterial(rec); return true; },
      });
    },
    async addAssetModel(rec) {
      const L = this.layer(); if (!L) return;
      const id = uid();
      L.models.set(id, { id, ext: rec.ext || 'glb', name: rec.name, real: true, blob: new Blob([rec.bytes]) });
      toast('Adding ' + rec.name + '…', 5000);
      try { await this.addObject({ id: uid(), kind: 'model', modelId: id, name: rec.name, pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1 }, 'Add asset'); toast(rec.name + ' added — use Move / Rotate / Scale', 3500); }
      catch (e) { console.error(e); L.models.delete(id); toast('Could not load that model: ' + e.message, 4500); }
    },
    async setMaterial(rec, tile) {
      const L = this.layer(), rt = runtimes.get(L), e = rt && rt.objs.get(this.sel); if (!e) return;
      const b = this.snapshot();
      // the maps travel with the document (so it opens anywhere, offline)
      for (const [k, bytes] of Object.entries(rec.maps || {})) if (!L.models.has(rec.id + ':' + k)) L.models.set(rec.id + ':' + k, { id: rec.id + ':' + k, ext: 'tex', name: rec.name + ' ' + k, blob: new Blob([bytes], { type: 'image/jpeg' }) });
      e.data.mat = { asset: rec.id, name: rec.name, tile: tile || (e.data.mat && e.data.mat.tile) || 0.5 };
      await this.rebuildSel();
      this.commit('Material', b); toast(rec.name + ' applied — Material… to change tile size or remove', 3500);
    },
    async rebuildSel() {
      const L = this.layer(), rt = runtimes.get(L), e = rt && rt.objs.get(this.sel); if (!e) return;
      rt.scene.remove(e.node); rt.objs.delete(this.sel);
      await buildObject(L, rt, e.data);
      attachAll(rt); this.redraw(1);
    },
    materialDialog() {
      const e = this.selEntry(); if (!e) return;
      const m = e.data.mat;
      const body = h('div', {}, h('p', { class: 'hint' }, m ? `Material: ${m.name}` : 'No material yet — pick one from the asset library (wood, metal, fabric, stone, brick…).'));
      if (m) body.append(field('Tile size', { min: 0.05, max: 4, step: 0.05, value: m.tile || 0.5, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => { m.tile = v; clearTimeout(this._mt); this._mt = setTimeout(() => this.rebuildSel(), 200); } }));
      dialog({ title: 'Material', body, actions: [
        { label: 'Browse materials…', onClick: () => { store.prefs.set('assetTab', 'textures'); this.assetMenu(); } },
        m && { label: 'Remove material', onClick: async () => { const b = this.snapshot(); delete e.data.mat; await this.rebuildSel(); this.commit('Remove material', b); } },
        { label: 'Done', primary: true },
      ].filter(Boolean) });
    },
    deleteSel() {
      const L = this.layer(), rt = runtimes.get(L), e = rt && rt.objs.get(this.sel);
      if (!e) return;
      const b = this.snapshot();
      rt.scene.remove(e.node); rt.objs.delete(this.sel);
      L.scene3d.objects = L.scene3d.objects.filter((o) => o.id !== this.sel);
      this.sel = null; this.joint = null;
      // the undo snapshot restores data only, so rebuild the runtime on undo
      const after = this.snapshot();
      app.history.push({ label: 'Delete object', undo: async () => { L.scene3d = JSON.parse(b); runtimes.delete(L); await render3D(L, app.doc, 1); app.changed('active'); }, redo: async () => { L.scene3d = JSON.parse(after); runtimes.delete(L); await render3D(L, app.doc, 1); app.changed('active'); } });
      this.redraw(1); app.updateCtxBar(); this.panelRefresh();
    },
    lightDialog() {
      const L = this.layer(), s = L.scene3d, b = this.snapshot(), r = () => { this.live = true; this.redraw(this.previewScale()); };
      const e = this.sel && runtimes.get(L).objs.get(this.sel);
      const color = h('input', { type: 'color', value: (e && e.data.color) || '#d8d2c8' });
      color.oninput = () => { if (!e) return; e.data.color = color.value; e.node.traverse((m) => { if (m.isMesh && !m.userData.outline && m.material.color) m.material.color.set(color.value); }); r(); };
      dialog({ title: '3D lighting & style', body: h('div', {},
        field('Light direction', { min: -180, max: 180, step: 1, value: s.light.az, fmt: (v) => v + '°', onInput: (v) => { s.light.az = v; r(); } }),
        field('Light height', { min: 0, max: 90, step: 1, value: s.light.el, fmt: (v) => v + '°', onInput: (v) => { s.light.el = v; r(); } }),
        field('Light strength', { min: 0, max: 6, step: 0.05, value: s.light.intensity, fmt: (v) => v.toFixed(1), onInput: (v) => { s.light.intensity = v; r(); } }),
        field('Ambient', { min: 0, max: 3, step: 0.05, value: s.light.ambient, fmt: (v) => v.toFixed(1), onInput: (v) => { s.light.ambient = v; r(); } }),
        field('Lens (field of view)', { min: 10, max: 90, step: 1, value: s.camera.fov, fmt: (v) => v + '°', onInput: (v) => { s.camera.fov = v; r(); } }),
        switchRow('Outlines', s.outline, (v) => { s.outline = v; r(); }),
        field('Outline width', { min: 0.002, max: 0.03, step: 0.001, value: s.outlineWidth, fmt: (v) => v.toFixed(3), onInput: (v) => { s.outlineWidth = v; r(); } }),
        e ? h('div', { class: 'toggle-row' }, h('span', {}, 'Selected object colour'), color) : h('p', { class: 'hint' }, 'Select an object (Move / Rotate / Scale, then tap it) to change its colour.')),
        actions: [{ label: 'Done', primary: true }], onClose: () => { this.live = false; if (e) { const o = s.objects.find((x) => x.id === e.data.id); if (o) o.color = e.data.color; } this.commit('3D style', b); this.redraw(1); } });
    },
    async rasterize() {
      const L = this.layer();
      // a clean render: no manipulator, no joint highlight
      this.joint = null; this.highlight(null); this.off = true; this.syncGizmo();
      await render3D(L, app.doc, 1);
      structCmd(app, 'Rasterize 3D', () => { L.type = 'raster'; });
      toast('Converted to a normal layer — draw over it');
      app.setTool('brush');
    },
  };
  return t;
}

export async function add3DLayer(app) {
  const d = app.doc;
  if (d.mode === 'animate') { toast('3D layers are available in Illustrate and Webtoon canvases'); return; }
  if (!app.canAddRaster()) return;
  const l = create3DLayer(d), cur = d.activeItem, i = d.active;
  // an empty paint layer becomes the 3D layer (undo brings the original back); otherwise a new one
  if (cur && cur.type === 'raster' && !cur.locked && isEmptyCanvas(cur.canvas)) {
    Object.assign(l, { name: cur.name, opacity: cur.opacity, blend: cur.blend, groupId: cur.groupId });
    structCmd(app, 'Make 3D layer', () => { d.layers.splice(i, 1, l); d.active = i; });
  } else insertLayer(app, l);
  toast('Loading 3D…', 3000);
  try { await render3D(l, d, 1); } catch (e) { console.error(e); toast('3D failed to start: ' + e.message); return; }
  app.changed();
  app.setTool('3d');
}
