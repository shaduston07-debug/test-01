// 3D layers: a posable drawing figure, imported models (glTF/GLB/VRM, FBX, OBJ — the open
// formats Clip Studio Paint itself imports), primitives, camera orbit / pan / zoom, object
// move / rotate / scale, per-joint posing, lighting and outlines. The scene is rendered with
// WebGL into the layer's canvas, so it composites like any other layer (and can be clipped
// to or rasterized). three.js is loaded only when a 3D layer is first edited.
import { h, toast, dialog, field, switchRow, seg, uid, clamp, pickFile, makeCanvas, canvasToBlob, promptDialog } from './util.js';
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
import { openFloating, closeFloat, isFloating, openPopover, closePopover } from './ui.js';

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
const figureObject2 = (x = 0, sex = 'female') => ({ id: uid(), kind: 'figure', rig: 2, name: sex === 'male' ? 'Drawing figure (male)' : 'Drawing figure (female)', pos: [x, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: '#c9c6c1', outfit: 'none',
  body: sex === 'male' ? { sex: 'male', height: 1.75, heads: 7.5, build: 0.55, muscle: 0.65, fat: 0.42 } : { sex: 'female', height: 1.62, heads: 7.2, build: 0.4, muscle: 0.45, fat: 0.45 } });
// the drawing figures: planar study figures (rig 3), each on its own, shaped by the Body settings
const figureObject = (x = 0, sex = 'female') => ({ id: uid(), kind: 'figure', rig: 3, name: sex === 'male' ? 'Planar figure (male)' : 'Planar figure (female)', pos: [x, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: '#ecebe8',
  body: { sex, height: sex === 'male' ? 1.75 : 1.62, ...MH.PLANAR_DEFAULT } });
// built-in library models (generated, no download)
export const LIBRARY = [
  ['Figures', [['figure-female', 'Planar figure (female)'], ['figure-male', 'Planar figure (male)'], ['knight', 'Knight (medieval armour)'], ['scifi', 'Sci-fi armour'], ['planarhead', 'Planar head (study)']]],
  ['Creatures', [['dragon', 'Dragon'], ['werewolf', 'Werewolf'], ['orc', 'Orc brute'], ['demon', 'Winged demon'], ['ghoul', 'Ghoul'], ['xeno', 'Alien'], ['spider', 'Giant spider'], ['golem', 'Stone golem'], ['kraken', 'Kraken']]],
  ['Weapons', Object.entries(WD.WEAPONS).map(([k, w]) => ['w:' + k, w.label])],
  ['Vehicles', [['car', 'Car'], ['sports', 'Sports car'], ['moto', 'Motorcycle']]],
  ['Places', [['castle', 'Castle'], ['street', 'City street'], ['district', 'City district'], ['cyber', 'Cyberpunk street'], ['ruins', 'Ruined city'], ['mountains', 'Mountains & lake'], ['forest', 'Forest hills'], ['desert', 'Desert dunes']]],
];
const SHAPES = [['cube', 'Cube'], ['sphere', 'Sphere'], ['cylinder', 'Cylinder'], ['cone', 'Cone'], ['floor', 'Floor plane']];
// camera presets (PoseManiacs-style dynamic angles): [label, direction, lens, distance ×, aim up]
const CAM_ANGLES = [['Front', [0, 0.05, 1], 35], ['Three-quarter', [0.7, 0.12, 1], 35], ['Side', [1, 0.05, 0], 35], ['Back', [-0.4, 0.1, -1], 35],
  ['High angle', [0.45, 1.3, 1], 40], ['Low angle', [0.4, -0.55, 1], 45, 0.85, 0.3], ['Dramatic', [0.8, -0.35, 0.9], 70, 0.55, 0.25], ['Top down', [0.01, 1, 0.02], 40, 1.2]];
const procObject = (gen, x = 0) => ({ id: uid(), kind: 'proc', gen, name: LIBRARY.flatMap((c) => c[1]).find((i) => i[0] === gen)?.[1] || gen, pos: [x, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: { car: '#3d6fd6', sports: '#e8b21a', moto: '#c72c2c', planarhead: '#bdbdbd' }[gen] || (C.CREATURES.includes(gen) && C.creatureDef(gen).color) || '#cfcac2' });

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
    if (!o.matrixAutoUpdate) { c.matrixAutoUpdate = false; c.matrix.copy(o.matrix); }
    add.push([o.parent, c]);
  });
  for (const [p, c] of add) p.add(c);
}

// ───────── Clip Studio-style manipulator ─────────
// Rings rotate about X (red), Y (green), Z (blue); arrows move along an axis; the yellow square
// slides the object on the floor, the white ball moves it in the screen plane. Drawn on top of
// everything at a constant on-screen size; a selected joint gets the rings only.
const GIZMO_COL = { x: 0xe5484d, y: 0x46b85a, z: 0x3f7fe8, f: 0xf2c230, v: 0xffffff, c: 0xff9f1a };
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
  // scale: orange cubes out on the diagonals with a thin stem — drag away from the centre to enlarge
  const d = 1.32 / Math.SQRT2;
  const cube = (x, y, z) => [new T.BoxGeometry(0.13, 0.13, 0.13).translate(x, y, z)];
  for (const [x, y, z] of [[d, d, 0], [-d, -d, 0]]) {
    const geo = cube(x, y, z); const st = new T.CylinderGeometry(0.01, 0.01, 0.36, 6).rotateZ(-Math.PI / 4).translate(x * 0.86, y * 0.86, z);
    add('sc', [...geo, st], new T.BoxGeometry(0.3, 0.3, 0.3).translate(x, y, z));
  }
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
  // a joint's rings follow the bone, like Clip Studio: one twists along it, two bend it
  const j = tg.joint && e.joints && e.joints[tg.joint];
  if (j) j.getWorldQuaternion(g.quaternion); else g.quaternion.identity();
}

const mannequinBlobs = {};
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

// the earlier drawing figures and mannequins become planar figures (same joints, so the pose
// carries over); armoured figures (knight, sci-fi) keep the body their armour is made for
function toPlanar(o) {
  if (o.outfit && o.outfit !== 'none') return;
  if (!((o.kind === 'figure' && o.rig !== 3) || o.kind === 'mannequin')) return;
  const sex = o.kind === 'mannequin' ? (o.sex === 'female' ? 'female' : 'male') : (o.body && o.body.sex) || 'female';
  const old = o.body || {};
  o.kind = 'figure'; o.rig = 3; delete o.sex;
  o.body = { sex, height: old.height || (sex === 'male' ? 1.75 : 1.62), ...MH.PLANAR_DEFAULT, muscle: old.muscle ?? 0.5, fat: old.fat ?? 0.5 };
  o.color = '#ecebe8'; o.scale = o.scale || 1; o.pose = o.pose || {};
  if (!o.name || /drawing figure|mannequin/i.test(o.name)) o.name = sex === 'male' ? 'Planar figure (male)' : 'Planar figure (female)';
}
async function buildObject(layer, rt, o) {
  toPlanar(o);
  let node, joints = null, figMat = null, rig = null, fig = null;
  if (o.kind === 'figure' && o.rig === 3) {
    fig = await MH.buildPlanar(o.body, o.color);
    node = fig.root; joints = fig.joints; figMat = fig.mat; rig = 'human';
  } else if (o.kind === 'figure' && o.rig === 2) {
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
    const built = g === 'dragon' ? M.buildDragon(o.color) : g === 'planarhead' ? M.buildPlanarHead(o.color) : make ? await M.propOr(g, make, o.color) : null;
    if (!built) return;
    node = built.root;
    if (g === 'dragon') { joints = built.joints; figMat = built.mat; rig = 'dragon'; fig = built; }
  } else if (o.kind === 'prim') {
    const geo = { cube: () => new T.BoxGeometry(0.5, 0.5, 0.5), sphere: () => new T.SphereGeometry(0.3, 40, 28), cylinder: () => new T.CylinderGeometry(0.25, 0.25, 0.6, 40), cone: () => new T.ConeGeometry(0.3, 0.6, 40), floor: () => new T.PlaneGeometry(6, 6) }[o.prim]();
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: o.color || '#cfcac2', roughness: 0.7, side: o.prim === 'floor' ? T.DoubleSide : T.FrontSide }));
    if (o.prim === 'floor') m.rotation.x = -Math.PI / 2; else m.position.y = o.prim === 'sphere' ? 0.3 : o.prim === 'cube' ? 0.25 : 0.3;
    node = new T.Group(); node.add(m);
  } else if (o.kind === 'mannequin') {
    // segmented artist's mannequin (block head, plated torso, ball joints), rigged with our joints
    const sex = o.sex === 'female' ? 'female' : 'male';
    mannequinBlobs[sex] ||= fetch(new URL(`../vendor/models/mannequin-${sex}.glb`, import.meta.url)).then((r) => { if (!r.ok) throw new Error('mannequin model missing'); return r.blob(); });
    node = await loadModel({ ext: 'glb', blob: await mannequinBlobs[sex] });
    const hf = node && MH.rigImported(node, M.mapRigNames);
    if (hf) { fig = hf; joints = hf.joints; rig = 'human'; o.pose ||= {}; }
    if (o.color) node.traverse((m) => { if (m.isMesh && m.material && m.material.color) m.material.color.set(o.color); });
  } else if (o.kind === 'model') {
    node = await loadModel(layer.models.get(o.modelId));
    // a rigged human (Blender, Mixamo, Rigify, VRM…) poses exactly like the drawing figures;
    // an unrigged one gets a skeleton fitted to it when the user asked for it (Make posable)
    let hf = node && MH.rigImported(node, M.mapRigNames);
    // bones with meaningless names: matched by where they sit on the body instead
    if (node && !hf) { try { const gm = MH.geometricRigMap(node); if (gm) hf = MH.rigImported(node, gm); } catch (e) { console.warn('bone matching', e); } }
    if (node && !hf && o.autorig) { try { if (MH.autoRigHumanoid(node)) hf = MH.rigImported(node, M.mapRigNames); } catch (e) { console.warn('auto-rig', e); } }
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
    const host = rt.objs.get(a.to), j = host && host.joints && (host.joints[a.part] || host.joints['hand' + a.side]);
    const parent = j || rt.scene;
    if (e.node.parent !== parent) parent.add(e.node);
  }
}
// after undo / redo: the runtime scene follows the stored one — objects that are gone are
// removed, objects that came back (or whose body, rig or model changed) are built again, the
// rest just move / re-pose
const LIGHT_KEYS = new Set(['pos', 'quat', 'scale', 'pose', 'name']);
async function reconcile(layer, rt) {
  const want = new Map(layer.scene3d.objects.map((o) => [o.id, o]));
  for (const [id, e] of [...rt.objs]) {
    const o = want.get(id);
    const heavy = o && Object.keys({ ...o, ...e.data }).some((k) => !LIGHT_KEYS.has(k) && JSON.stringify(o[k]) !== JSON.stringify(e.data[k]));
    if (!o || heavy) { rt.scene.remove(e.node); rt.objs.delete(id); }
    else { e.data = o; syncObject(e); }
  }
  for (const o of layer.scene3d.objects) if (!rt.objs.has(o.id)) { try { await buildObject(layer, rt, o); } catch (err) { console.warn('rebuild', err); } }
  attachAll(rt); syncAll(rt);
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
  else if (m.ext === 'blend') root = (await import('./blendfile.js')).blendToThree(buf, T); // read directly, no export needed
  if (root instanceof Promise) root = await root;
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

// The camera that sees the scene the way the canvas's perspective guide is drawn: lens from the
// two vanishing points (they are 90° apart in the world), tilt from the eye level, turn so the
// world's X axis runs to the first vanishing point. Keeps the camera's target and distance.
// 1-point: the lens stays, the camera looks down the world's Z to the point. Returns null for
// guides a normal lens can't match (curved, fisheye, isometric).
export function cameraFromGuide(doc, cam) {
  const g = doc.persp; if (!g || !g.vps || !g.vps.length || !['1pt', '2pt', '3pt'].includes(g.type)) return null;
  const W = doc.width, H = doc.height, cx = W / 2, cy = H / 2, v1 = g.vps[0], v2 = g.vps[1];
  let f = (H / 2) / Math.tan(((cam.fov || 35) * Math.PI / 180) / 2);
  if (g.type !== '1pt' && v2) { const d = -((v1.x - cx) * (v2.x - cx) + (v1.y - cy) * (v2.y - cy)); if (d > 1) f = Math.sqrt(d); else return null; }
  const fov = Math.max(5, Math.min(120, (2 * Math.atan((H / 2) / f) * 180) / Math.PI));
  // eye level at the middle column → tilt
  const hy = g.type === '1pt' || !v2 || Math.abs(v2.x - v1.x) < 1e-6 ? v1.y : v1.y + ((cx - v1.x) * (v2.y - v1.y)) / (v2.x - v1.x);
  const pitch = Math.atan((hy - cy) / f); // eye level below the middle = looking up
  const tgt = new T.Vector3(...cam.target), dist = Math.max(0.5, new T.Vector3(...cam.pos).distanceTo(tgt));
  const axis = g.type === '1pt' ? new T.Vector3(0, 0, -1) : new T.Vector3(1, 0, 0);
  const test = new T.PerspectiveCamera(fov, W / H, 0.01, 1e7);
  let best = null;
  const a0 = Math.atan2(v1.x - cx, Math.hypot(f, hy - cy));
  for (const a of [a0, -a0, Math.PI - a0, Math.PI + a0]) {
    // forward: the axis turned by a about the vertical, then tilted
    const fh = axis.clone().applyAxisAngle(new T.Vector3(0, 1, 0), a);
    const fwd = fh.multiplyScalar(Math.cos(pitch)).add(new T.Vector3(0, Math.sin(pitch), 0)).normalize();
    const pos = tgt.clone().sub(fwd.clone().multiplyScalar(dist));
    test.position.copy(pos); test.lookAt(tgt); test.updateMatrixWorld(true);
    const far = pos.clone().add(axis.clone().multiplyScalar(1e5)).project(test);
    if (far.z > 1) continue; // behind the camera
    const err = Math.hypot((far.x + 1) / 2 * W - v1.x, (1 - far.y) / 2 * H - v1.y);
    if (!best || err < best.err) best = { err, pos: pos.toArray() };
  }
  return best ? { pos: best.pos, target: tgt.toArray(), fov: +fov.toFixed(2) } : null;
}
function applySceneSettings(layer, rt, doc) {
  const s = layer.scene3d;
  if (s.followPersp) { const c2 = cameraFromGuide(doc, s.camera); if (c2) s.camera = c2; }
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
// Clip Studio poses / body types kept in the asset store (raw Clip Studio data, so a pose is
// fitted to whichever figure it is put on)
export async function importCspFiles(files, progress) {
  const CF = await import('./clipfile.js');
  const items = await CF.readCspMaterials(files, progress);
  let poses = 0, bodies = 0;
  const have = new Set((await store.listAssets()).filter((a) => a.kind === 'csppose' || a.kind === 'cspbody').map((a) => a.sig));
  for (const it of items) {
    const sig = it.kind + ':' + JSON.stringify(it.data).length + ':' + it.name;
    if (have.has(sig)) continue;
    have.add(sig);
    await store.putAsset({ id: 'csp:' + uid(), kind: it.kind === 'pose' ? 'csppose' : 'cspbody', name: it.name, set: it.set, data: it.data, thumb: it.thumb ? await store.toBytes(it.thumb) : null, credit: it.credit || null, sig, added: Date.now() });
    if (it.kind === 'pose') poses++; else bodies++;
  }
  return { poses, bodies };
}
// a pose pack built into this copy of the app (vendor/csp-bundled.zip, only in personal builds)
// is imported once, the first time the library is opened
let bundledCsp = null;
function importBundledCsp() {
  return (bundledCsp ||= (async () => {
    if (store.prefs.get('cspBundledDone', false)) return;
    let blob = null;
    try { const r = await fetch(new URL('../vendor/csp-bundled.zip', import.meta.url)); if (r.ok) blob = await r.blob(); } catch { /* not in this build */ }
    if (!blob || blob.size < 100) return;
    toast('Adding your Clip Studio poses…', 20000);
    try { const r = await importCspFiles([new File([blob], 'csp-bundled.zip')]); store.prefs.set('cspBundledDone', true); toast(`Added ${r.poses} Clip Studio poses${r.bodies ? ` and ${r.bodies} body type${r.bodies === 1 ? '' : 's'}` : ''}`, 3500); }
    catch (e) { console.warn('bundled poses', e); }
  })());
}
// a model pack built into a personal copy of the app (vendor/models-bundled.zip: manifest.json +
// .glb files + thumbnails) goes into the downloaded-models library once
let bundledModels = null;
function importBundledModels() {
  return (bundledModels ||= (async () => {
    // models shipped with the app (vendor/lookalikes: manifest + .glb + thumbnails), added once
    if (!store.prefs.get('lookalikesDone', false)) {
      try {
        const base = new URL('../vendor/lookalikes/', import.meta.url), r = await fetch(new URL('manifest.json', base));
        if (r.ok) {
          const man = await r.json(), have = new Set((await store.listAssets()).map((a) => a.id));
          let n = 0;
          for (const m of man) {
            if (have.has('sf:model:' + m.uid)) continue;
            const g = await fetch(new URL(m.file, base)); if (!g.ok) continue;
            const bytes = await g.arrayBuffer();
            let thumb = null; try { const t = await fetch(new URL(m.thumb, base)); if (t.ok) thumb = await t.arrayBuffer(); } catch { /* none */ }
            await store.putAsset({ id: 'sf:model:' + m.uid, kind: 'model', src: 'Sketchfab', name: m.name, author: m.author, license: m.license, page: m.page,
              ext: 'glb', bytes, thumb, added: Date.now() + n, size: bytes.byteLength, like: m.like || null, builtin: true });
            n++;
          }
          store.prefs.set('lookalikesDone', true);
          if (n) toast(`Added ${n} models to 3D Assets › Downloaded`, 3500);
        }
      } catch (e) { console.warn('built-in models', e); }
    }
    if (store.prefs.get('modelsBundledDone', false)) return;
    let blob = null;
    try { const r = await fetch(new URL('../vendor/models-bundled.zip', import.meta.url)); if (r.ok) blob = await r.blob(); } catch { /* not in this build */ }
    if (!blob || blob.size < 100) return;
    try {
      const CF = await import('./clipfile.js'), ents = await CF.zipEntries(new File([blob], 'models.zip')), by = new Map(ents.map((x) => [x.name, x]));
      const man = JSON.parse(new TextDecoder().decode(await by.get('manifest.json').read()));
      let n = 0;
      for (const m of man) {
        const f = by.get(m.file); if (!f) continue;
        const bytes = await f.read(), th = m.thumb && by.get(m.thumb);
        const thumb = th ? (await th.read()).slice().buffer : null;
        await store.putAsset({ id: 'sf:model:' + m.uid, kind: 'model', src: 'Sketchfab', name: m.name, author: m.author, license: m.license, page: m.page,
          ext: 'glb', bytes: bytes.slice().buffer, thumb, added: Date.now() + n, size: bytes.length, like: m.like || null });
        n++;
      }
      store.prefs.set('modelsBundledDone', true);
      if (n) toast(`Added ${n} models to 3D Assets › Downloaded`, 3500);
    } catch (e) { console.warn('bundled models', e); }
  })());
}
async function importedCsp(kind) {
  await importBundledCsp();
  return (await store.listAssets()).filter((a) => a.kind === kind).sort((a, b) => (a.set || '').localeCompare(b.set || '') || (a.added - b.added) || a.name.localeCompare(b.name));
}

// a short English gloss for Japanese Clip Studio pack names
const CSP_GLOSS = [['バトル', 'Battle'], ['キック', 'Kick'], ['パンチ', 'Punch'], ['回避', 'Dodge'], ['防御', 'Block'], ['構え', 'Stance'], ['能力', 'Ability'], ['ビースト', 'Beast'], ['美少女', 'Girl'], ['後ろ手', 'Hands behind'], ['振り返る', 'Looking back'], ['アクション', 'Action'], ['座り', 'Sitting'], ['立ち', 'Standing'], ['歩き', 'Walking'], ['走り', 'Running'], ['ジャンプ', 'Jump'], ['手', 'Hands'], ['剣', 'Sword'], ['武器', 'Weapon'], ['日常', 'Everyday'], ['かわいい', 'Cute'], ['格闘', 'Fighting'], ['アイドル', 'Idol'], ['ダンス', 'Dance'], ['寝', 'Lying'], ['男性', 'Male'], ['女性', 'Female']];
export const cspGloss = (t) => { if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(t)) return ''; const w = CSP_GLOSS.filter(([j]) => t.includes(j)).map(([, en]) => en); const n = t.match(/(\d+)\s*種/); return w.length ? w.join(' · ') + (n ? ` (${n[1]})` : '') : ''; };

// a pack's name in English: its official English title from Clip Studio Assets when known,
// else a short translation; the original name is shown under it
const hasCJK = (t) => /[\u3040-\u30ff\u3400-\u9fff]/.test(t || '');
export function cspSetTitle(set, recs = []) {
  const t = (recs.find((r) => r.credit && r.credit.title) || {}).credit?.title;
  if (t && !/^No data$/i.test(t) && !hasCJK(t)) return t;
  if (!hasCJK(set)) return set || 'Poses';
  const g = cspGloss(set); return g ? g.replace(/ · /g, ' ') + ' poses' : set;
}

// ───────── picker windows (poses, models) laid out like Clip Studio's Material panel ─────────
// folders on the left (grouped), search + thumbnail grid on the right. folders:
// [{ key, label, sub?, group, items: [{ key, label, thumb?: url | () => Promise<url> }] }]
function folderBrowser({ title, folders, onPick, onHold, extra = [], startKey, remember, hint }) {
  const all = folders.flatMap((f) => f.items.map((it) => ({ ...it, folder: f })));
  let where = (remember && store.prefs.get(remember, null)) || startKey || (folders[0] && folders[0].key) || 'all', query = '', cur = null;
  if (where !== 'all' && !folders.some((f) => f.key === where)) where = 'all';
  const side = h('div', { class: 'csp-tree' }), grid = h('div', { class: 'lib3d-grid' }), head = h('div', { class: 'csp-head' });
  const search = h('input', { type: 'search', placeholder: 'Search', class: 'csp-search' });
  const main = h('div', { class: 'csp-main' }, search, ...extra, head, grid);
  search.oninput = () => { query = search.value.trim().toLowerCase(); drawGrid(); };
  // thumbnails are made as tiles scroll into view, one at a time
  const queue = []; let busy = false;
  const pump = async () => { if (busy) return; busy = true; while (queue.length) { const [img, fn] = queue.shift(); if (!img.isConnected) continue; try { const u = await fn(); if (u) img.src = u; } catch (e) { console.warn('thumb', e); } await new Promise((r) => setTimeout(r, 0)); } busy = false; };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); const fn = e.target._thumb; if (fn) { queue.push([e.target, fn]); pump(); } } }, { root: main }) : null;
  const node = (key, label, sub, n) => h('button', { class: 'csp-node' + (where === key ? ' on' : ''), style: key === 'all' ? '' : 'padding-left:24px', onclick: () => { where = key; remember && store.prefs.set(remember, key); search.value = ''; query = ''; drawTree(); drawGrid(); } },
    h('span', { class: 'csp-ico' }, key === 'all' ? '▦' : '📁'), h('span', { class: 'csp-name' }, label, sub ? h('small', {}, sub) : null), h('span', { class: 'csp-count' }, String(n)));
  const drawTree = () => {
    side.replaceChildren(node('all', 'All', null, all.length));
    let g = null;
    for (const f of folders) {
      if (f.group !== g) { g = f.group; if (g) side.append(h('div', { class: 'csp-group' }, g)); }
      side.append(node(f.key, f.label, f.sub, f.items.length));
    }
  };
  const drawGrid = () => {
    const list = query ? all.filter((it) => (it.label + ' ' + it.folder.label + ' ' + (it.folder.sub || '')).toLowerCase().includes(query)) : where === 'all' ? all : all.filter((it) => it.folder.key === where);
    const f = folders.find((x) => x.key === where);
    head.replaceChildren(h('b', {}, query ? `Search “${query}”` : f ? f.label : 'All'), h('span', { class: 'hint' }, ` · ${list.length}`));
    grid.replaceChildren(...list.slice(0, 400).map((it) => {
      const img = h('img', { alt: '' });
      if (typeof it.thumb === 'string') img.src = it.thumb; else if (typeof it.thumb === 'function') { img._thumb = it.thumb; io ? io.observe(img) : (queue.push([img, it.thumb]), pump()); }
      const bt = h('button', { class: 'lib3d-item my-model' + (cur === it.key ? ' on' : ''), onclick: () => { if (bt.dataset.held) { delete bt.dataset.held; return; } cur = it.key; grid.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); bt.classList.add('on'); onPick(it); } }, img, h('span', {}, it.label));
      if (onHold) { let t; bt.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; bt.dataset.held = '1'; onHold(it, () => { bt.remove(); }); }, 600); }); const stop = () => clearTimeout(t); bt.addEventListener('pointerup', stop); bt.addEventListener('pointerleave', stop); bt.addEventListener('pointercancel', stop); }
      return bt;
    }));
    if (!list.length) grid.append(h('p', { class: 'hint' }, 'Nothing here.'));
  };
  drawTree(); drawGrid();
  const body = h('div', {}, h('div', { class: 'csp-lib' }, side, main), hint ? h('p', { class: 'hint' }, hint) : null);
  return { body, title, close: () => io && io.disconnect() };
}

// thumbnails of built-in models / poses, rendered off-screen and kept (models: on the device)
let thumbR = null;
const thumbMem = new Map();
function snapNode(node, opts = {}) {
  thumbR ||= new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbR.setSize(176, 176, false); thumbR.setClearColor(0xffffff, 1);
  if (thumbR.outputColorSpace !== undefined) thumbR.outputColorSpace = T.SRGBColorSpace;
  const sc = new T.Scene(); sc.add(new T.HemisphereLight(0xffffff, 0x8a8478, 1.2)); const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); sc.add(sun);
  const parent = node.parent, idx = parent ? parent.children.indexOf(node) : -1;
  sc.add(node); node.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(node), c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
  const cam = new T.PerspectiveCamera(30, 1, 0.01, 10000), r = Math.max(size.length() / 2, 0.01);
  const dir = new T.Vector3(...(opts.dir || [0.45, 0.25, 1])).normalize();
  cam.position.copy(c).add(dir.multiplyScalar(r / Math.sin((15 * Math.PI) / 180) * 1.02)); cam.near = r / 50; cam.far = r * 50; cam.lookAt(c); cam.updateProjectionMatrix();
  thumbR.render(sc, cam);
  const url = thumbR.domElement.toDataURL('image/jpeg', 0.82);
  sc.remove(node); if (parent) { parent.children.splice(idx, 0, node); node.parent = parent; }
  return url;
}
async function modelThumb(layer, gen) {
  const key = 'thumb:model3:' + gen;
  if (thumbMem.has(key)) return thumbMem.get(key);
  try { const a = await store.getAsset(key); if (a && a.url) { thumbMem.set(key, a.url); return a.url; } } catch { /* none */ }
  await three();
  const fake = { scene: new T.Scene(), objs: new Map(), outlineW: { value: 0.008 } };
  const o = gen === 'figure-female' || gen === 'figure-male' ? figureObject(0, gen.endsWith('male') && !gen.endsWith('female') ? 'male' : 'female')
    : gen === 'mannequin-male' || gen === 'mannequin-female' ? { id: uid(), kind: 'mannequin', sex: gen.endsWith('female') ? 'female' : 'male', pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: '#e2e1dd' }
      : gen === 'knight' || gen === 'scifi' ? Object.assign(figureObject2(0, gen === 'knight' ? 'male' : 'female'), { outfit: gen === 'knight' ? 'medieval' : 'scifi' })
        : gen.startsWith('w:') ? { id: uid(), kind: 'weapon', weapon: gen.slice(2), pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1, color: '#cccccc' }
          : gen.startsWith('shape:') ? { id: uid(), kind: 'prim', prim: gen.slice(6), pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1, color: '#cfcac2' } : procObject(gen, 0);
  await buildObject(layer, fake, o);
  const e = fake.objs.get(o.id); if (!e) return null;
  if (e.rig === 'human') { M.applyPose(e.joints, {}, e.fig.rest || M.HUMAN_REST, e.fig.H); if (e.fig.drive) e.fig.drive(); }
  const url = snapNode(e.node);
  e.node.traverse((m) => { if (m.isMesh && m.geometry) m.geometry.dispose(); });
  thumbMem.set(key, url);
  store.putAsset({ id: key, kind: 'thumb', url }).catch(() => {});
  return url;
}

export function tool3d(app) {
  const t = {
    // 'object' works like Clip Studio's Object tool: tap to select a model (tap again on a body part
    // for its joint), drag the manipulator, drag a hand / foot of the selected figure (IK), drag
    // empty space to orbit the camera
    mode: 'object', sel: null, joint: null, busy: false, ik: true, gizmoOn: true, off: true, panelOpen: {},
    fineRot: store.prefs.get('fineRot', false),
    layer() { const it = app.doc && app.doc.activeItem; return it && it.type === '3d' ? it : null; },
    async enter() {
      this.off = false;
      importBundledModels();
      let L = this.layer();
      // no 3D layer selected: go back to the canvas's 3D layer (the last one used, else the top
      // one); only a canvas without any gets a new one
      if (!L) {
        const d = app.doc, list = d.items.map((it, i) => [it, i]).filter(([it]) => it.type === '3d');
        const pickIt = list.find(([it]) => it.id === d.last3D) || list.filter(([it]) => it.visible).pop() || list.pop();
        if (pickIt) { this.activate(pickIt[0]); L = pickIt[0]; }
        else { if (!this._adding) { this._adding = true; try { await add3DLayer(app); } finally { this._adding = false; } } return; }
      }
      app.doc.last3D = L.id;
      try { await this.redraw(1); } catch (e) { console.error(e); toast('3D failed to start: ' + e.message); }
      this.openPanel();
    },
    exit() {
      this.joint = null; this.off = true;
      closeFloat('3d'); this.showModelsButton(false);
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
    // several steps (add, fit to size, frame the camera…) recorded as one undo step
    async group(label, fn) {
      if (this.grouping) return fn();
      const b = this.snapshot(); this.grouping = true;
      try { return await fn(); } finally { this.grouping = false; this.commit(label, b); }
    },
    commit(label, before, refresh = true) {
      if (this.grouping) { if (refresh) this.panelRefresh(); return; }
      const L = this.layer(), after = this.snapshot();
      if (before === after) return;
      const restore = async (json) => {
        L.scene3d = JSON.parse(json);
        const rt = runtimes.get(L);
        if (rt) await reconcile(L, rt);
        if (this.sel && !L.scene3d.objects.some((o) => o.id === this.sel)) { this.sel = null; this.joint = null; }
        await render3D(L, app.doc, 1); app.changed('active'); app.updateCtxBar && app.updateCtxBar();
        if (this.layer() === L) this.panelRefresh();
      };
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
    down(p, ev) {
      const L = this.layer(); if (!L) { toast('Select a 3D layer'); return false; }
      if (!runtimes.get(L)) { this.enter(); return false; }
      this.p0 = p; this.last = p; this.moved = false; this.before = this.snapshot(); this.jointBefore = this.joint; this.dragIK = false; this.dragPose = false;
      // the camera hand (Settings › 3D camera): fingers (or the pencil) always turn the camera,
      // in any mode; a tap still selects
      const camWith = app.settings.cam3d || 'touch', pt = ev && ev.pointerType;
      this.camDrag = camWith !== 'none' && ((camWith === 'touch' && pt === 'touch') || (camWith === 'pen' && (pt === 'pen' || pt === 'mouse')));
      if (this.camDrag) { this.tapHit = this.pick(p); this.dragging = true; return; }
      const gh = this.gizmoHit(p);
      if (gh && this.startGizmo(gh, p)) { this.dragging = true; return; }
      if (this.mode === 'object') {
        const hit = this.pick(p), e = hit && runtimes.get(L).objs.get(hit.objId);
        this.tapHit = hit;
        // the selected figure: drag a hand / foot (or its fingers / toes) and the arm / leg follows (IK)
        const eff = hit && hit.joint && (hit.joint.replace(/^(thumb|index|middle|ring|pinky)([LR])\d$/, 'hand$2').replace(/^toe([LR])$/, 'foot$1'));
        const grab = e && e.joints && app.settings.dragPose3d !== false;
        if (grab && hit.joint && this.sel !== hit.objId) { this.sel = hit.objId; app.updateCtxBar(); } // any figure: no need to select it first
        if (e && hit.objId === this.sel && e.rig === 'human' && this.ik && M.IK_CHAINS[eff]) { this.joint = eff; this.dragIK = true; this.highlight(this.joint); }
        // any other part of the selected figure: drag it to pose it (no need to switch to Pose);
        // the hips / root and empty space turn the camera
        else if (e && hit.objId === this.sel && e.joints && hit.joint && !/^(hips|root|pelvis)$/i.test(hit.joint) && app.settings.dragPose3d !== false) { this.joint = hit.joint; this.dragPose = true; this.highlight(this.joint); }
        this.dragging = true; return;
      }
      if (this.mode === 'pose' || this.mode === 'move' || this.mode === 'rotate' || this.mode === 'scale') {
        const hit = this.pick(p);
        if (hit) {
          this.sel = hit.objId;
          if (this.mode === 'pose') { const e = runtimes.get(L).objs.get(hit.objId); this.joint = e && e.joints && hit.joint ? hit.joint : null; this.highlight(this.joint); }
          this.dragging = true;
        } else if (this.mode === 'pose') { this.tapHit = null; this.camDrag = true; this.dragging = true; return; } // empty space turns the camera
        else this.dragging = !!this.sel;
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
      if (this.camDrag) {
        if (!this.moved) return;
        const pos = new T.Vector3(...s.camera.pos), tgt = new T.Vector3(...s.camera.target);
        const off = pos.clone().sub(tgt), sph = new T.Spherical().setFromVector3(off);
        const ka = 0.006 * this.gain(); sph.theta -= this.scr(dx) * ka; sph.phi = clamp(sph.phi - this.scr(dy) * ka, 0.05, Math.PI - 0.05);
        off.setFromSpherical(sph); s.camera.pos = tgt.clone().add(off).toArray();
        this.redraw(this.previewScale()); return;
      }
      const pos = new T.Vector3(...s.camera.pos), tgt = new T.Vector3(...s.camera.target);
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const unit = (dist) => (2 * Math.tan((cam.fov * Math.PI / 180) / 2) * dist) / app.doc.height;
      if (this.mode === 'orbit' || (this.mode === 'object' && !this.dragIK && !this.dragPose)) {
        if (this.mode === 'object' && !this.moved) return; // a tap selects (on release)
        const off = pos.clone().sub(tgt), sph = new T.Spherical().setFromVector3(off);
        const ka = 0.006 * this.gain(); sph.theta -= this.scr(dx) * ka; sph.phi = clamp(sph.phi - this.scr(dy) * ka, 0.05, Math.PI - 0.05);
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
        const ka = 0.008 * this.gain(), qd = new T.Quaternion().setFromAxisAngle(up, this.scr(dx) * ka).multiply(new T.Quaternion().setFromAxisAngle(right, this.scr(dy) * ka));
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
          const g = this.pg(); const target = at.add(right.clone().multiplyScalar(dx * k * g)).add(up.clone().multiplyScalar(-dy * k * g));
          for (const n of M.solveIK(e.joints, this.joint, target)) o.pose[n] = e.joints[n].quaternion.toArray();
        } else if ((this.mode === 'pose' || this.dragPose) && this.joint && e.joints) {
          // Clip Studio-style: the dragged part follows the pencil — the joint turns so the end of
          // its bone (the next joint along) stays under the pencil, 1:1 at any zoom / distance
          const j = e.joints[this.joint];
          const tip = this.poseTip(e, this.joint);
          const pq = j.parent.getWorldQuaternion(new T.Quaternion());
          let local = null;
          if (tip) {
            // relative: the bone's end moves by how far the pencil moved (no jump to the pencil),
            // scaled by the sensitivity
            const at = j.getWorldPosition(new T.Vector3());
            const plane = new T.Plane().setFromNormalAndCoplanarPoint(cam.getWorldDirection(new T.Vector3()), tip);
            const h1 = this.rayAt(p, cam).ray.intersectPlane(plane, new T.Vector3());
            const h0 = this.rayAt({ x: p.x - dx, y: p.y - dy }, cam).ray.intersectPlane(plane, new T.Vector3());
            if (h1 && h0 && tip.distanceTo(at) > 1e-4) {
              const to = tip.clone().add(h1.sub(h0).multiplyScalar(this.pg()));
              if (to.distanceTo(at) > 1e-4) {
                const w = new T.Quaternion().setFromUnitVectors(tip.clone().sub(at).normalize(), to.sub(at).normalize());
                local = pq.clone().invert().multiply(w).multiply(pq).multiply(j.quaternion);
              }
            }
          }
          if (!local) local = pq.clone().invert().multiply(qd).multiply(pq).multiply(j.quaternion);
          o.pose[this.joint] = local.toArray();
        }
        syncObject(e);
      }
      this.redraw(this.previewScale());
    },
    up() {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.camDrag) {
        this.camDrag = false;
        if (!this.moved) {
          // a tap: select (in Pose mode, the body part too)
          const hit = this.tapHit;
          if (!hit && this.p0) { const p0 = this.p0; this.tapOtherLayer(p0).then((ok) => { if (!ok) this.tapSelect(null); }); }
          else if (this.mode === 'pose' && hit) { const e = runtimes.get(this.layer()).objs.get(hit.objId); this.sel = hit.objId; this.joint = e && e.joints && hit.joint ? hit.joint : null; this.highlight(this.joint); app.updateCtxBar(); this.panelRefresh(); }
          else this.tapSelect(hit);
        }
        this.commit('Orbit camera', this.before); this.redraw(1); return;
      }
      if (this.gz) {
        const g = this.gz; this.gz = null;
        this.commit(g.joint ? 'Pose' : g.handle === 'sc' ? 'Scale object' : g.handle[0] === 'r' ? 'Rotate object' : 'Move object', this.before);
        this.redraw(1); return;
      }
      if (this.mode === 'object') {
        if (!this.moved && !this.tapHit && this.p0) { const p0 = this.p0; this.tapOtherLayer(p0).then((ok) => { if (!ok) this.tapSelect(null); }); this.commit('Orbit camera', this.before); this.redraw(1); return; }
        if (!this.moved) this.tapSelect(this.tapHit);
        this.commit(this.dragIK || this.dragPose ? 'Pose' : 'Orbit camera', this.before);
        this.dragIK = false; this.dragPose = false; this.redraw(1); return;
      }
      if (!this.moved && (this.mode === 'move' || this.mode === 'rotate' || this.mode === 'scale') && !this.pick(this.p0)) { this.sel = null; app.updateCtxBar(); }
      this.commit({ orbit: 'Orbit camera', pan: 'Pan camera', zoom: 'Zoom camera', move: 'Move object', rotate: 'Rotate object', scale: 'Scale object', pose: 'Pose' }[this.mode], this.before);
      this.redraw(1);
    },
    cancel() { this.dragging = false; this.gz = null; this.redraw(1); },
    // ── manipulator ──
    // page coordinates of a manipulator handle (used by tests / tutorials)
    _handleScreen(handle) {
      const rt = runtimes.get(this.layer()); if (!rt || !rt.gizmo || !rt.gizmo.visible) return null;
      rt.gizmo.updateMatrixWorld(true);
      let m = null; rt.gizmo.traverse((o) => { if (!m && o.isMesh && o.userData.handle === handle && o.material.colorWrite === false) m = o; });
      if (!m) return null;
      m.geometry.computeBoundingBox();
      const local = handle[0] === 'r' ? new T.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0) : m.geometry.boundingBox.getCenter(new T.Vector3());
      const w = m.localToWorld(local).project(rt.camera);
      const d = app.docToScreen((w.x + 1) / 2 * app.doc.width, (1 - w.y) / 2 * app.doc.height), r = app.canvas.getBoundingClientRect();
      return [r.left + d.x, r.top + d.y];
    },
    rayAt(p, cam) { const r = new T.Raycaster(); r.setFromCamera(this.ndc(p), cam); return r; },
    gizmoHit(p) {
      const rt = runtimes.get(this.layer()); if (!rt || !rt.gizmo || !rt.gizmo.visible) return null;
      rt.gizmo.updateMatrixWorld(true);
      const picks = [], view = rt.camera.getWorldDirection(new T.Vector3());
      rt.gizmo.traverse((o) => {
        if (!o.isMesh || !o.userData.handle || !o.parent.visible) return;
        const hd = o.userData.handle;
        // a ring seen edge-on is just a line: it can't be turned sensibly and would cover the arrows
        if (hd[0] === 'r' && Math.abs(view.dot(new T.Vector3(...{ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[hd[1]]).applyQuaternion(rt.gizmo.quaternion))) < 0.15) return;
        picks.push(o);
      });
      const hits = this.rayAt(p, rt.camera).intersectObjects(picks, false);
      // arrows, the floor square and the ball win over the rings they cross
      const hit = hits.find((x) => x.object.userData.handle[0] === 'm' || x.object.userData.handle === 'sc') || hits[0];
      return hit ? hit.object.userData.handle : null;
    },
    startGizmo(handle, p) {
      const rt = runtimes.get(this.layer()), e = this.selEntry(); if (!e || !rt.gizmoTarget) return false;
      const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[handle[1]];
      const axis = handle !== 'sc' && ax && new T.Vector3(...ax).applyQuaternion(handle[0] === 'r' ? rt.gizmo.quaternion : new T.Quaternion());
      this.gz = { handle, e, rt, c: rt.gizmo.position.clone(), axis, joint: rt.gizmoTarget.joint, total: 0 };
      this.gz.last = this.gizmoParam(p);
      // rings turn by how far the pencil moves along the ring where it was grabbed (Clip Studio
      // style): steady and 1:1 under the pencil, however close to the centre it is
      if (handle[0] === 'r' && this.gz.last) {
        const toDoc = (v) => { const q = v.clone().project(rt.camera); return new T.Vector2((q.x + 1) / 2 * app.doc.width, (1 - q.y) / 2 * app.doc.height); };
        const p0 = this.gz.c.clone().add(this.gz.last), p1 = this.gz.c.clone().add(this.gz.last.clone().applyAxisAngle(axis, 0.01));
        const ts = toDoc(p1).sub(toDoc(p0)).multiplyScalar(100);
        if (ts.length() > 1) { this.gz.ts = ts.setLength(Math.max(ts.length(), 60)); this.gz.pp = new T.Vector2(p.x, p.y); }
      }
      if (handle === 'sc') { this.gz.d0 = this.gz.last; this.gz.s0 = e.data.scale || 1; this.gz.p0 = e.node.getWorldPosition(new T.Vector3()); }
      return true;
    },
    // ring: the pointer's direction around the axis; arrow: its position along the axis;
    // square / ball: its point on the floor plane / the screen plane through the centre
    gizmoParam(p) {
      const { handle, c, axis, rt } = this.gz, ray = this.rayAt(p, rt.camera).ray;
      if (handle === 'sc') {
        // distance from the centre, measured in the screen plane through it
        const hit = ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(rt.camera.getWorldDirection(new T.Vector3()), c), new T.Vector3());
        return hit ? Math.max(1e-4, hit.distanceTo(c)) : null;
      }
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
      if (g.handle === 'sc') {
        if (!now || !g.d0) return;
        // grows from its base, so anything standing on the floor stays on it
        o.scale = clamp(g.s0 * now / g.d0, 0.02, 100);
        syncObject(g.e); app.showHud && app.showHud(Math.round(o.scale * 100) + '%');
        return;
      }
      if (g.handle[0] === 'r') {
        let ang;
        if (g.ts) { const d = new T.Vector2(p.x, p.y).sub(g.pp); g.pp = new T.Vector2(p.x, p.y); ang = d.dot(g.ts) / g.ts.lengthSq() * this.pg(); }
        else ang = (now && g.last ? Math.atan2(new T.Vector3().crossVectors(g.last, now).dot(g.axis), g.last.dot(now)) : (dx - dy) * 0.01) * this.pg();
        g.last = now;
        g.total += ang; app.showHud && app.showHud(`${g.total >= 0 ? '+' : ''}${Math.round(g.total * 180 / Math.PI)}°`, 900);
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
    // another layer picked while a 3D layer showed its manipulator / selection: that layer is
    // drawn again clean (no rings and arrows left in its picture), and the selection resets
    watchLayer() {
      const L = this.layer();
      if (this.shownL && this.shownL !== L) {
        const old = this.shownL; this.shownL = null;
        this.sel = null; this.joint = null;
        const rt = runtimes.get(old);
        if (rt) { rt.gizmoTarget = null; if (rt.gizmo) rt.gizmo.visible = false; this.highlightOn(old, null); render3D(old, app.doc, 1).then(() => app.requestRender('view')).catch(() => {}); }
        this.panelRefresh();
      }
      if (L && !this.off) this.shownL = L;
    },
    highlightOn(L, j) { const keep = this.layer; this.layer = () => L; try { this.highlight(j); } finally { this.layer = keep; } },
    // where a joint's bone ends (the point that follows the pencil when it's dragged): the next
    // joint along the body (spine → chest → neck → head, shoulder → elbow → hand…), or for an
    // end joint (head, hand without fingers, toe) a point along its own axis
    // how strongly a drag turns / poses things (Settings › 3D › Sensitivity, Fine rotation)
    gain() { const g = app.settings.sens3d ?? 0.6; return g * (this.fineRot ? 0.25 : 1); },
    // posing / rings: ¾ of the pencil's movement at the default sensitivity
    pg() { return Math.min(1.25, this.gain() / 0.8); },
    // a drag of doc px in screen px (so turning the model feels the same at any canvas zoom)
    scr(v) { return v * ((app.view && app.view.zoom) || 1); },
    poseTip(e, name) {
      const j = e.joints[name]; if (!j) return null;
      const kids = j.children.filter((c) => c.name && e.joints[c.name] === c);
      const prefer = ['spine', 'chest', 'neck', 'head', 'elbowL', 'elbowR', 'handL', 'handR', 'kneeL', 'kneeR', 'footL', 'footR', 'toeL', 'toeR', 'middleL1', 'middleR1'];
      const next = kids.find((c) => prefer.includes(c.name) && !/^clav/.test(c.name)) || kids.find((c) => !/^(clav|hip)/.test(c.name)) || kids[0];
      if (next) return next.getWorldPosition(new T.Vector3());
      const at = j.getWorldPosition(new T.Vector3()), q = j.getWorldQuaternion(new T.Quaternion());
      const len = 0.1 * (e.fig && e.fig.H ? e.fig.H : 1) * (e.node.scale.x || 1);
      const p = j.parent && j.parent.getWorldPosition ? j.parent.getWorldPosition(new T.Vector3()) : null;
      // continue the bone the joint hangs from (finger tips, toes), else its own up axis (head)
      const dir = p && p.distanceTo(at) > 1e-4 && !/^head|^neck/.test(name) ? at.clone().sub(p).normalize() : new T.Vector3(0, 1, 0).applyQuaternion(q);
      return at.clone().add(dir.multiplyScalar(len));
    },
    // 3D layers set to follow the perspective guide are drawn again when the guide moved
    followGuide() { for (const it of app.doc.items) if (it.type === '3d' && it.scene3d && it.scene3d.followPersp) render3D(it, app.doc, 1).then(() => app.requestRender()).catch(() => {}); },
    matchPersp(quiet) {
      const L = this.layer(), d = app.doc;
      if (!d.persp) { toast('Add a perspective guide first (the perspective tool in the top bar)', 4000); return false; }
      const c = cameraFromGuide(d, L.scene3d.camera);
      if (!c) { toast(['1pt', '2pt', '3pt'].includes(d.persp.type) ? 'These vanishing points can’t come from one lens (put the canvas centre between them)' : 'Use a 1-, 2- or 3-point guide: curved, fisheye and isometric guides have no matching 3D lens', 5000); return false; }
      if (!quiet) { const b = this.snapshot(); L.scene3d.camera = c; this.commit('Match perspective', b); this.redraw(1); this.panelRefresh(); toast('Camera matched to the perspective guide'); }
      return true;
    },
    // make another 3D layer the one being edited
    activate(L) {
      const d = app.doc, i = d.items.indexOf(L); if (i < 0) return;
      d.active = i; d.last3D = L.id; this.sel = null; this.joint = null;
      app.changed('layers'); app.updateCtxBar(); this.panelRefresh();
    },
    // a tap on a model of another 3D layer: that layer becomes the one being edited, with the
    // model selected (the layer's own picture says which layer has something there)
    async tapOtherLayer(p) {
      const d = app.doc, cur = this.layer();
      const others = d.items.filter((it) => it.type === '3d' && it !== cur && it.visible).reverse();
      for (const L of others) {
        const x = Math.floor(p.x), y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= L.canvas.width || y >= L.canvas.height) continue;
        if (!L.canvas.getContext('2d').getImageData(x, y, 1, 1).data[3]) continue;
        if (!runtimes.get(L)) await render3D(L, d, 1);
        this.activate(L);
        // the exact point may be the outline (not pickable): look a few pixels around it
        let hit = this.pick(p);
        for (let r = 4; !hit && r <= 16; r += 4) for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) { hit = this.pick({ x: p.x + ox, y: p.y + oy }); if (hit) break; }
        if (hit) { this.sel = hit.objId; this.joint = null; }
        this.highlight(null); app.updateCtxBar(); this.panelRefresh(); this.redraw(1);
        toast('Editing ' + (L.name || '3D layer'), 1500);
        return true;
      }
      return false;
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
      // objects in the layer (adding them: the ＋ Models button above the bar)
      out.push(sec('Objects', ...(s.objects.length ? s.objects.map((o) => h('div', { class: 'p3d-row' + (o.id === this.sel ? ' on' : '') },
        h('button', { class: 'p3d-name', onclick: () => { this.sel = o.id; this.joint = null; this.highlight(null); this.redraw(1); app.updateCtxBar(); this.panelRefresh(); } }, o.name || o.kind),
        h('button', { class: 'p3d-x', title: 'Delete', onclick: () => { this.sel = o.id; this.deleteSel(); this.panelRefresh(); } }, '×'))) : [h('p', { class: 'hint' }, 'Nothing here yet: tap ＋ Models above the bar.')])));
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
        grid(btn('Reset camera', () => { const b = this.snapshot(); L.scene3d.camera = defaultScene().camera; s.followPersp = false; this.commit('Reset camera', b); this.redraw(1); this.panelRefresh(); }),
          btn('Match perspective guide', () => this.matchPersp())),
        switchRow('Follow the perspective guide', !!s.followPersp, (v) => { if (v && !this.matchPersp(true)) { this.panelRefresh(); return; } const b = this.snapshot(); s.followPersp = v; this.commit('Follow perspective', b); this.redraw(1); }),
        h('p', { class: 'hint' }, 'The 3D camera takes the lens, eye level and direction of the canvas’s 1-, 2- or 3-point perspective guide, so models sit in the same space as your drawing. With Follow on, moving the guide moves the camera.')));
      out.push(h('button', { class: 'pill primary p3d-wide', onclick: () => this.rasterize() }, 'Rasterize (make it paintable)'));
      return out;
    },
    panelObject(e, sec, btn, grid) {
      const o = e.data, human = e.rig === 'human', out = [];
      out.push(h('div', { class: 'p3d-title' }, o.name || o.kind));
      if (o.kind === 'figure' && o.rig === 3) {
        const b = o.body, re = (fn) => this.edit('Body', fn, true);
        const sl = (label, key) => field(label, { min: 0, max: 100, step: 1, value: Math.round((b[key] ?? 0.5) * 100), fmt: (v) => (v === 50 ? 'standard' : (v > 50 ? '+' : '−') + Math.abs(v - 50) * 2 + '%'), onInput: (v) => re(() => { b[key] = v / 100; }) });
        out.push(sec('Body',
          h('div', { class: 'stack' }, seg([['female', 'Female'], ['male', 'Male']], b.sex, (v) => re(() => { b.sex = v; b.height = v === 'male' ? 1.75 : 1.62; o.name = o.name.replace(/\((fe)?male\)/, '(' + v + ')'); }))),
          h('div', { class: 'p3d-lab' }, 'Physique — tap or drag'), this.shapePad(o),
          field('Height', { min: 1.2, max: 2.1, step: 0.01, value: b.height, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => re(() => { b.height = v; }) }),
          sl('Musculature', 'muscle'), sl('Chest', 'chest'), sl(b.sex === 'male' ? 'Pec volume' : 'Breast volume', 'breast'), sl(b.sex === 'male' ? 'Pec size' : 'Breast size', 'breastSize'), sl('Waist', 'waist'), sl('Hip volume', 'hips'), sl('Hip size', 'hipSize'), sl('Thigh volume', 'thighs'), sl('Thigh size', 'thighSize'), sl('Butt volume', 'butt'), sl('Butt size', 'buttSize'),
          grid(btn('More…', () => this.bodyMore(o)), btn('Reset body', () => re(() => { Object.assign(b, MH.PLANAR_DEFAULT, { height: b.sex === 'male' ? 1.75 : 1.62 }); setTimeout(() => this.panelRefresh(), 400); })))));
      }
      if (o.kind === 'figure' && o.rig === 2) {
        const b = o.body;
        const rebuildBody = (fn) => this.edit('Body', fn, true);
        out.push(sec('Body',
          h('div', { class: 'stack' }, seg([['female', 'Female'], ['male', 'Male']], b.sex, (v) => rebuildBody(() => { b.sex = v; if (v === 'male' && b.height < 1.68) b.height = 1.75; if (v === 'female' && b.height > 1.7) b.height = 1.62; }))),
          h('div', { class: 'p3d-lab' }, 'Body shape'), this.shapePad(o),
          field('Height', { min: 1.2, max: 2.1, step: 0.01, value: b.height, fmt: (v) => v.toFixed(2) + ' m', onInput: (v) => rebuildBody(() => { b.height = v; }) }),
          field('Head-to-body ratio', { min: 3, max: 9, step: 0.1, value: b.heads, fmt: (v) => v.toFixed(1) + ' heads', onInput: (v) => rebuildBody(() => { b.heads = v; }) }),
          h('div', { class: 'p3d-lab' }, 'Proportions — pick a part, then drag: across = width, up = length'), this.partsEditor(o),
          grid(btn('Body presets…', () => this.bodyPresets(o)), btn('Reset body', () => rebuildBody(() => { delete b.parts; b.muscle = 0.5; b.fat = 0.5; b.heads = b.sex === 'male' ? 7.5 : 7.2; b.height = b.sex === 'male' ? 1.75 : 1.62; }))),
          h('div', { class: 'stack' }, h('label', {}, 'Armour'), seg([['none', 'None'], ['medieval', 'Medieval'], ['scifi', 'Sci-fi']], o.outfit || 'none', (v) => rebuildBody(() => { o.outfit = v; }))),
          switchRow('Guide lines (face & body centre, eye line)', b.guides !== false, (v) => { const m = e.fig && e.fig.mesh; this.edit('Guide lines', () => { b.guides = v; if (m && m.userData.setGuides) m.userData.setGuides(v); }); })));
      }
      if (e.joints) {
        out.push(sec('Pose', grid(btn('Poses…', () => this.poseMenu()), human && btn('Hands…', () => this.handMenu()), human && btn('Mirror', () => this.mirrorPose()), human && btn('BVH…', () => this.bvhMenu()), btn('Reset pose', () => this.resetPose())),
          human && switchRow('IK (drag a hand / foot to move the limb)', this.ik, (v) => { this.ik = v; app.updateCtxBar(); }),
          field('Sensitivity', { min: 0.2, max: 1.5, step: 0.05, value: app.settings.sens3d ?? 0.6, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { app.settings.sens3d = v; app.applySettings(); } }),
          switchRow('Fine rotation (¼ speed)', !!this.fineRot, (v) => { this.fineRot = v; store.prefs.set('fineRot', v); }),
          h('p', { class: 'hint' }, this.joint ? `${this.jointLabel(this.joint)}: drag it or its rings to turn it. Drag empty space to turn the camera.` : 'Drag a body part of the selected model to pose it, empty space to turn the camera. Tap a part for its rings.')));
      }
      if (o.kind === 'model' && !e.joints) {
        out.push(sec('Pose', h('p', { class: 'hint' }, o.autorig ? 'Auto-rig couldn’t fit a skeleton to this model.' : 'This model has no skeleton. If it’s one standing person (arms out or down, like a base mesh), Inkwell can fit one so it poses like the drawing figure: poses, Clip Studio poses, IK. Works best on plain bodies; capes and very wide clothes may stretch in big poses.'),
          !o.autorig && grid(btn('Make posable (auto-rig)', async () => { const b = this.snapshot(); o.autorig = true; await this.rebuild(e); const ne = this.selEntry(); this.commit('Make posable', b); this.redraw(1); this.panelRefresh(); toast(ne && ne.joints ? 'Posable — tap a body part in Pose mode, or use Poses… / Clip Studio poses…' : 'Couldn’t find a person shape in this model', 4500); }))));
      }
      const color = h('input', { type: 'color', value: o.color || '#cfcac2' });
      color.oninput = () => this.edit('Colour', () => { o.color = color.value; e.node.traverse((m) => { if (m.isMesh && !m.userData.outline && m.material && m.material.color && !m.userData.handle) m.material.color.set(color.value); }); });
      out.push(sec('Object',
        field('Size', { min: 0.05, max: 10, step: 0.01, value: o.scale, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => this.edit('Scale object', () => { o.scale = v; syncObject(e); }) }),
        grid(btn('Stand on floor', () => { const b = this.snapshot(); o.pos = [o.pos[0], 0, o.pos[2]]; syncObject(e); this.commit('Move object', b); this.redraw(1); }),
          btn('Reset rotation', () => { const b = this.snapshot(); o.quat = [0, 0, 0, 1]; syncObject(e); this.commit('Rotate object', b); this.redraw(1); }),
          btn('Frame in view', () => this.frameObject(o.id, o.gen)), btn('Save as my model…', () => this.savePreset(e)), !e.joints && o.kind !== 'figure' && btn(o.attach ? 'Attached…' : 'Attach to body…', () => this.holdMenu()), btn('Material…', () => this.materialDialog())),
        h('div', { class: 'toggle-row' }, h('span', {}, 'Colour'), color)));
      return out;
    },
    // Clip Studio-style part editing: choose a body part, then a pad sets its width (across) and
    // length (up). Left and right change together.
    partsEditor(o) {
      const box = h('div', { class: 'p3d-parts' });
      const chips = h('div', { class: 'p3d-chips' });
      const W = 290, Hh = 150, c = h('canvas', { class: 'p3d-pad', width: W * 2, height: Hh * 2 });
      const val = h('div', { class: 'hint p3d-partval' });
      let cur = this.partSel || 'shoulders';
      const WMIN = 0.5, WMAX = 1.8, LMIN = 0.6, LMAX = 1.6;
      const get = () => (o.body.parts && o.body.parts[cur]) || [1, 1];
      const draw = () => {
        const x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, W, Hh);
        x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, 0, W, Hh);
        const cx = (1 - WMIN) / (WMAX - WMIN) * W, cy = (1 - (1 - LMIN) / (LMAX - LMIN)) * Hh;
        x.strokeStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.moveTo(cx, 0); x.lineTo(cx, Hh); x.moveTo(0, cy); x.lineTo(W, cy); x.stroke();
        x.fillStyle = 'rgba(255,255,255,0.55)'; x.font = '11px system-ui';
        x.fillText('longer', 6, 13); x.fillText('shorter', 6, Hh - 6); x.textAlign = 'right'; x.fillText('wider', W - 6, cy - 5); x.textAlign = 'left'; x.fillText('narrower', 6, cy - 5);
        const [w, l] = get(), px = (w - WMIN) / (WMAX - WMIN) * W, py = (1 - (l - LMIN) / (LMAX - LMIN)) * Hh;
        x.fillStyle = '#2f7dff'; x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, 8, 0, Math.PI * 2); x.fill(); x.stroke();
        val.textContent = `${MH.BODY_PARTS.find((p) => p[0] === cur)[1]}: width ${Math.round(w * 100)}% · length ${Math.round(l * 100)}%`;
      };
      const drawChips = () => {
        chips.innerHTML = '';
        for (const [k, label] of MH.BODY_PARTS) {
          const v = o.body.parts && o.body.parts[k], changed = v && (v[0] !== 1 || v[1] !== 1);
          chips.append(h('button', { class: (k === cur ? 'on' : '') + (changed ? ' changed' : ''), onclick: () => { cur = this.partSel = k; drawChips(); draw(); } }, label));
        }
      };
      const setPart = (w, l) => {
        this.edit('Body proportions', () => {
          const parts = o.body.parts = { ...(o.body.parts || {}) };
          if (Math.abs(w - 1) < 0.02 && Math.abs(l - 1) < 0.02) delete parts[cur]; else parts[cur] = [+w.toFixed(3), +l.toFixed(3)];
          if (!Object.keys(parts).length) delete o.body.parts;
        }, true);
        draw(); drawChips();
      };
      const set = (ev) => {
        const r = c.getBoundingClientRect();
        let w = WMIN + clamp((ev.clientX - r.left) / r.width, 0, 1) * (WMAX - WMIN), l = LMIN + clamp(1 - (ev.clientY - r.top) / r.height, 0, 1) * (LMAX - LMIN);
        if (Math.abs(w - 1) < 0.04) w = 1; if (Math.abs(l - 1) < 0.04) l = 1; // snap back to normal
        setPart(w, l);
      };
      c.addEventListener('pointerdown', (ev) => { c.setPointerCapture(ev.pointerId); set(ev); });
      c.addEventListener('pointermove', (ev) => { if (c.hasPointerCapture(ev.pointerId)) set(ev); });
      c.addEventListener('dblclick', () => setPart(1, 1));
      box.append(chips, c, h('div', { class: 'p3d-partrow' }, val, h('button', { class: 'pill', onclick: () => setPart(1, 1) }, 'Reset part')));
      drawChips(); draw();
      return box;
    },
    // body shape presets: built-in types plus your own saved shapes (like registering a body as a material)
    bodyPresets(o) {
      const BUILTIN = [
        ['Chibi', { heads: 3.2, parts: { head: [1.05, 1], neck: [0.9, 0.6], upperArms: [0.95, 0.75], forearms: [0.95, 0.75], thighs: [1.05, 0.7], calves: [1.05, 0.7], hands: [1.1, 0.9], feet: [1.1, 0.9] }, muscle: 0.4, fat: 0.6 }],
        ['Child', { heads: 5.2, height: 1.25, parts: { shoulders: [0.95, 0.85], hips: [0.92, 1] }, muscle: 0.35, fat: 0.55 }],
        ['Fashion model', { heads: 8.5, parts: { thighs: [0.92, 1.1], calves: [0.92, 1.12], waist: [0.85, 1.05], neck: [0.9, 1.15] }, muscle: 0.4, fat: 0.25 }],
        ['Heroic', { heads: 8.2, parts: { shoulders: [1.1, 1.25], chest: [1.15, 1], waist: [0.9, 1], upperArms: [1.2, 1], forearms: [1.15, 1], thighs: [1.1, 1.05], neck: [1.25, 1] }, muscle: 0.95, fat: 0.35 }],
        ['Stocky', { heads: 6.4, parts: { shoulders: [1.15, 1.1], chest: [1.15, 1], waist: [1.15, 1], hips: [1.1, 1], thighs: [1.15, 0.9], calves: [1.1, 0.9] }, muscle: 0.6, fat: 0.75 }],
        ['Curvy', { parts: { hips: [1.2, 1], thighs: [1.12, 1], waist: [0.88, 1], chest: [1.08, 1] }, muscle: 0.4, fat: 0.6 }],
      ];
      const mine = store.prefs.get('bodyPresets', []);
      const apply = (p) => this.edit('Body preset', () => { const b = o.body; Object.assign(b, { muscle: 0.5, fat: 0.5 }, JSON.parse(JSON.stringify(p))); if (!p.parts) delete b.parts; b.build = b.muscle; }, true);
      const body = h('div', {}, h('div', { class: 'menu-section' }, 'Body types'),
        h('div', { class: 'p3d-chips' }, ...BUILTIN.map(([n, p]) => h('button', { onclick: () => { apply(p); dlg.close(); } }, n))));
      importedCsp('cspbody').then((list) => {
        const sec = h('div', {}, h('div', { class: 'menu-section' }, 'From Clip Studio'));
        const chips = h('div', { class: 'p3d-chips' }, ...list.map((r) => h('button', { onclick: () => { this.edit('Clip Studio body type', () => { Object.assign(o.body, M.bodyFromCSP(r.data, o.body)); o.body.build = o.body.muscle; }, true); dlg.close(); toast('Body type “' + r.name + '” applied'); } }, r.name)),
          h('button', { onclick: async () => { dlg.close(); await this.importCsp(); this.bodyPresets(o); } }, '＋ Import .bodyproportion / Material zip…'));
        sec.append(chips); body.insertBefore(sec, body.children[2] || null);
      });
      if (mine.length) body.append(h('div', { class: 'menu-section' }, 'Saved'), h('div', { class: 'p3d-chips' }, ...mine.map((m, i) => {
        const bt = h('button', { onclick: () => { apply(m.body); dlg.close(); } }, m.name);
        let t; bt.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; mine.splice(i, 1); store.prefs.set('bodyPresets', mine); dlg.close(); toast('Removed ' + m.name); }, 700); });
        bt.addEventListener('pointerup', () => clearTimeout(t)); bt.addEventListener('pointerleave', () => clearTimeout(t));
        return bt;
      })), h('p', { class: 'hint' }, 'Hold a saved shape to delete it.'));
      const dlg = dialog({ title: 'Body presets', body, actions: [
        { label: 'Save this body…', onClick: async () => {
          const name = await promptDialog('Name for this body shape', 'My body'); if (!name) return;
          const b = o.body, keep = { sex: b.sex, height: b.height, heads: b.heads, muscle: b.muscle, fat: b.fat, parts: b.parts ? { ...b.parts } : undefined };
          store.prefs.set('bodyPresets', [...store.prefs.get('bodyPresets', []), { name, body: keep }]); toast('Saved "' + name + '"');
        } },
        { label: 'Close', primary: true },
      ] });
    },
    // Clip Studio's body-shape pad: across = body fat (lean → heavy), up = musculature
    // every body setting of a planar figure, grouped (the panel shows the main ones)
    bodyMore(o) {
      const b = o.body, re = (fn) => this.edit('Body', fn, true);
      const sl = (label, key) => field(label, { min: 0, max: 100, step: 1, value: Math.round((b[key] ?? 0.5) * 100), fmt: (v) => (v === 50 ? 'standard' : (v > 50 ? '+' : '−') + Math.abs(v - 50) * 2 + '%'), onInput: (v) => re(() => { b[key] = v / 100; }) });
      const group = (t, ...kids) => h('div', {}, h('div', { class: 'menu-section' }, t), ...kids);
      const body = h('div', { class: 'p3d' },
        group('Build', sl('Musculature', 'muscle'), sl('Body fat', 'fat')),
        group('Torso', sl('Shoulders', 'shoulders'), sl('Chest', 'chest'), sl(b.sex === 'male' ? 'Pec volume' : 'Breast volume', 'breast'), sl(b.sex === 'male' ? 'Pec size' : 'Breast size', 'breastSize'), sl('Waist', 'waist'), sl('Hip volume', 'hips'), sl('Hip size', 'hipSize'), sl('Butt volume', 'butt'), sl('Butt size', 'buttSize')),
        group('Head & neck', sl('Head size', 'head'), sl('Neck', 'neck')),
        group('Arms', sl('Upper arms', 'arms'), sl('Forearms', 'forearms'), sl('Hands', 'hands')),
        group('Legs', sl('Thigh volume', 'thighs'), sl('Thigh size', 'thighSize'), sl('Lower legs', 'calves'), sl('Feet', 'feet')));
      dialog({ title: 'Body — all settings', body, actions: [{ label: 'Done', primary: true }], onClose: () => this.panelRefresh() });
    },
    shapePad(o) {
      const W = 290, Hh = 150, c = h('canvas', { class: 'p3d-pad', width: W * 2, height: Hh * 2 });
      const { muscle, fat } = MH.bodyShape(o.body);
      let st = { muscle, fat };
      const draw = () => {
        const x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, W, Hh);
        x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, 0, W, Hh);
        x.strokeStyle = 'rgba(255,255,255,0.12)'; for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(W * k / 4, 0); x.lineTo(W * k / 4, Hh); x.moveTo(0, Hh * k / 4); x.lineTo(W, Hh * k / 4); x.stroke(); }
        // little figures show what each side of the pad means (up = muscular, right = heavy)
        const icon = (cx, cy, mu, ft) => {
          const hh = 34, sh = 5 + 5 * mu + 2 * ft, wa = 3 + 6 * ft + 1.5 * mu, hp = 4.5 + 4 * ft, lg = 2 + 1.6 * ft + 1.2 * mu, ar = 1.4 + 1.6 * mu + 1 * ft, top = cy - hh / 2;
          x.fillStyle = 'rgba(255,255,255,0.5)';
          x.beginPath(); x.arc(cx, top + 3.4, 3.4, 0, Math.PI * 2); x.fill();
          x.beginPath(); x.moveTo(cx - sh, top + 8); x.lineTo(cx + sh, top + 8); x.lineTo(cx + wa, top + 15); x.lineTo(cx + hp, top + 20); x.lineTo(cx - hp, top + 20); x.lineTo(cx - wa, top + 15); x.closePath(); x.fill();
          for (const d of [-1, 1]) { x.fillRect(cx + d * (hp - lg) - lg, top + 20, lg * 2, 14); x.save(); x.translate(cx + d * (sh + ar * 0.6), top + 8.5); x.rotate(d * -0.12); x.fillRect(-ar, 0, ar * 2, 12); x.restore(); }
        };
        for (const [u, w] of [[0.1, 0.12], [0.5, 0.12], [0.9, 0.12], [0.1, 0.88], [0.5, 0.88], [0.9, 0.88]]) icon(u * W, w * Hh + (w < 0.5 ? 8 : -8), 1 - w, u);
        x.fillStyle = 'rgba(255,255,255,0.55)'; x.font = '10px system-ui';
        x.textAlign = 'center'; x.fillText('muscular', W / 2, Hh / 2 - 14); x.fillText('soft', W / 2, Hh / 2 + 22); x.textAlign = 'right'; x.fillText('heavy', W - 6, Hh / 2 + 4); x.textAlign = 'left'; x.fillText('lean', 6, Hh / 2 + 4);
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
      if (!L) { this.showModelsButton(false); return [h('span', { class: 'three-hint' }, 'Select a 3D layer to edit it')]; }
      const cb = (label, fn, on, cls = '') => h('button', { class: 'cb-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
      const sep = () => h('span', { class: 'cb-sep' });
      const setMode = (m) => { this.mode = m; if (m !== 'pose' && m !== 'object') { this.joint = null; this.highlight(null); } this.redraw(1); app.updateCtxBar(); };
      this.showModelsButton(true);
      // short enough to fit without scrolling: adding models lives in the ＋ Models pop-up above the
      // bar, everything about the selected model in the 3D panel
      // one everyday mode: drag a body part to pose it, a model's rings / arrows to move it, empty
      // space to turn the camera (fingers or pencil, Settings › 3D). The rest sits under ⋯
      if (this.mode === 'pose') this.mode = 'object';
      const rt = runtimes.get(L), posable = rt && [...rt.objs.values()].some((x) => x.joints);
      const items = [];
      if (this.mode !== 'object') items.push(cb(this.mode[0].toUpperCase() + this.mode.slice(1) + ' ✕', () => setMode('object'), true), sep());
      if (posable) items.push(cb('Poses', () => this.poseMenu()));
      items.push(cb('Camera', () => this.cameraMenu()), cb('Panel', () => (isFloating('3d') ? closeFloat('3d') : this.openPanel()), isFloating('3d')),
        cb('⋯', (ev) => this.modesMenu(ev.currentTarget, setMode)));
      return items;
    },
    // a pop-up that opens upwards from a button at the bottom of the screen
    popAbove(anchor, opts) {
      const pop = openPopover(anchor, opts);
      if (!pop) return null;
      const r = anchor.getBoundingClientRect(), el = pop.el;
      el.querySelector('.pop-arrow')?.remove();
      el.style.maxHeight = Math.max(200, r.top - 20) + 'px';
      el.style.top = Math.max(8, r.top - el.offsetHeight - 10) + 'px';
      return pop;
    },
    showModelsButton(on) {
      let b = document.getElementById('btn-3d-models');
      if (!b && on) {
        b = h('button', { id: 'btn-3d-models', class: 'glass', onclick: () => this.modelsMenu(b) }, '＋ Models');
        document.getElementById('overlay-ui').append(b);
      }
      if (b) b.hidden = !on;
    },
    // everything you can add: figures, the model library, shapes, your own files, free assets
    modelsMenu() { return this.libraryMenu(); },
    modesMenu(anchor, setMode) {
      const row = (m, label, hint) => h('button', { class: 'lib3d-item' + (this.mode === m ? ' on' : ''), onclick: () => { closePopover(); setMode(m); } }, h('b', {}, label), h('div', { class: 'hint' }, hint));
      const act = (label, fn, cls = '') => h('button', { class: 'pill' + (cls ? ' ' + cls : ''), onclick: () => { closePopover(); fn(); } }, label);
      const body = h('div', { class: 'lib3d' },
        h('div', { class: 'row-btns', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } },
          this.sel ? act('Delete model', () => this.deleteSel()) : null, act('Rasterize layer', () => this.rasterize())),
        h('div', { class: 'hint' }, 'Single-purpose drags (tap ✕ on the bar to go back to normal):'),
        h('div', { class: 'lib3d-grid' },
          row('object', 'Normal', 'Drag a body part to pose, empty space to turn the camera'),
          row('orbit', 'Orbit', 'Drag to turn the camera'), row('pan', 'Pan', 'Drag to slide the camera'), row('zoom', 'Zoom', 'Drag up / down'),
          row('move', 'Move', 'Drag a model'), row('rotate', 'Rotate', 'Drag to turn a model'), row('scale', 'Scale', 'Drag up / down')),
        switchRow('Manipulator (rings & arrows)', this.gizmoOn, (v) => { this.gizmoOn = v; this.redraw(1); }));
      this.popAbove(anchor, { title: '3D', body, width: 420, key: '3d-modes' });
    },
    addShape(k, l) { this.addObject({ id: uid(), kind: 'prim', prim: k, name: l, pos: [0.8, 0, 0], quat: [0, 0, 0, 1], scale: 1, color: '#cfcac2' }, 'Add ' + l); },
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
    async libraryMenu() {
      const L = this.layer(); if (!L) return;
      let dlg = null;
      const folders = LIBRARY.map(([cat, items]) => ({ key: 'lib:' + cat, label: cat, group: 'Built-in', items: items.map(([gen, label]) => ({ key: gen, label, gen, thumb: () => modelThumb(L, gen) })) }));
      folders.push({ key: 'shapes', label: 'Shapes', group: 'Built-in', items: SHAPES.map(([k, l]) => ({ key: 'shape:' + k, label: l, shape: k, thumb: () => modelThumb(L, 'shape:' + k) })) });
      const all = await store.listAssets().catch(() => []);
      const presets = all.filter((a) => a.kind === 'preset').sort((a, b) => b.added - a.added);
      if (presets.length) folders.unshift({ key: 'mine', label: 'My models', group: 'Mine', items: presets.map((rec) => ({ key: rec.id, label: rec.name, preset: rec, thumb: rec.thumb ? URL.createObjectURL(new Blob([rec.thumb], { type: 'image/png' })) : undefined })) });
      const mine = all.filter((a) => a.kind === 'model' && a.bytes).sort((a, b) => b.added - a.added);
      const posable = mine.filter((a) => AS.modelRigged(a)), stat = mine.filter((a) => !AS.modelRigged(a));
      const dl = (list) => list.map((a) => ({ key: a.id, label: a.name, rec: a, thumb: AS.assetThumb(a) || undefined }));
      if (posable.length) folders.push({ key: 'dl-pose', label: 'Posable', sub: 'rigged', group: 'Downloaded', items: dl(posable) });
      if (stat.length) folders.push({ key: 'dl-static', label: 'Not posable', sub: 'Make posable in the panel', group: 'Downloaded', items: dl(stat) });
      const fb = folderBrowser({ title: '3D models', folders, remember: 'libFolder', hint: 'Tap a model to add it to the scene.',
        onPick: (it) => { dlg && dlg.close(); if (it.rec) this.addAssetModel(it.rec); else if (it.preset) this.addPreset(it.preset); else if (it.shape) this.addShape(it.shape, it.label); else this.addLibrary(it.gen); },
        onHold: (it, gone) => { if (!it.preset) return; dialog({ title: it.label, body: h('p', {}, 'Delete this saved model?'), actions: [{ label: 'Cancel' }, { label: 'Delete', primary: true, onClick: async () => { await store.deleteAsset(it.preset.id); gone(); } }] }); } });
      dlg = dialog({ title: '3D models', wide: true, body: fb.body, actions: [
        { label: 'Open a file…', onClick: () => { this.importModel(); } },
        { label: 'Sketchfab & Poly Haven…', onClick: () => { this.assetMenu(); } },
        { label: 'Close', primary: true }], onClose: fb.close });
    },
    async addLibrary(gen) { return this.group('Add model', () => this._addLibrary(gen)); },
    async _addLibrary(gen) {
      const L = this.layer(), n = L.scene3d.objects.length;
      if (gen === 'figure-female' || gen === 'figure-male') return this.addFigure(gen === 'figure-male' ? 'male' : 'female');
      if (gen === 'mannequin-male' || gen === 'mannequin-female') {
        const sex = gen.endsWith('female') ? 'female' : 'male';
        return this.addObject({ id: uid(), kind: 'mannequin', sex, name: sex === 'female' ? 'Mannequin (female)' : 'Mannequin', pos: [n * 0.7, 0, 0], quat: [0, 0, 0, 1], scale: sex === 'female' ? 0.95 : 1, pose: {}, color: '#e2e1dd' }, 'Add mannequin');
      }
      if (gen === 'knight' || gen === 'scifi') { const o = figureObject2(n * 0.7, gen === 'knight' ? 'male' : 'female'); o.outfit = gen === 'knight' ? 'medieval' : 'scifi'; o.name = gen === 'knight' ? 'Knight' : 'Sci-fi armour'; return this.addObject(o, 'Add ' + o.name); }
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
    async poseMenu() {
      const e = this.poseTarget();
      if (!e) { toast('Add a figure or a creature first'); return; }
      const cname = e.rig === 'creature' ? e.data.name : 'Dragon';
      const lib = e.rig === 'dragon' ? { Dragon: M.DRAGON_POSES } : e.rig === 'creature' ? { [cname]: C.creaturePoses(e.data.gen) } : e.rig === 'human' ? M.HUMAN_POSES : null;
      if (!lib) { toast('This older figure has no pose library — add a new figure'); return; }
      const snap = this.snapshot(), rigKey = e.rig === 'creature' ? 'creature:' + e.data.gen : e.rig;
      const rest = e.rig === 'dragon' ? M.DRAGON_REST : e.rig === 'creature' ? C.creatureRest(e.data.gen) : e.fig.rest || M.HUMAN_REST, H = e.rig === 'human' ? e.fig.H : 1;
      let mirror = !!store.prefs.get('cspMirror', false), last = null;
      const keepHands = () => Object.fromEntries(Object.entries(e.data.pose || {}).filter(([k]) => /^(thumb|index|middle|ring|pinky)[LR]\d$/.test(k)));
      // each item knows how to make its pose; thumbnails show it on this very figure
      const make = (it) => (it.def ? { ...(e.rig === 'human' ? keepHands() : {}), ...M.poseFromDegrees(it.def) } : it.pose ? JSON.parse(JSON.stringify(it.pose)) : it.csp ? M.retargetCSP(it.csp, e.fig) : {});
      const put = (it) => { try { const ps = make(it); e.data.pose = mirror && e.rig === 'human' ? M.mirrorStored(ps) : ps; syncObject(e); this.redraw(this.previewScale()); last = it; } catch (err) { console.error(err); toast('Could not apply that pose: ' + err.message, 4000); } };
      const thumbOf = (key, it) => () => {
        const k = 'pose:' + e.data.id + ':' + key; if (thumbMem.has(k)) return thumbMem.get(k);
        try { M.applyPose(e.joints, make(it), rest, H); if (e.fig && e.fig.drive) e.fig.drive(); const url = snapNode(e.node, { dir: [0.3, 0.12, 1] }); thumbMem.set(k, url); return url; }
        finally { syncObject(e); }
      };
      const folders = [];
      const saved = store.prefs.get('savedPoses', []).filter((x) => x.rig === rigKey);
      folders.push({ key: 'mine', label: 'My poses', group: 'Mine', items: saved.map((sp, i) => ({ key: 'my' + i + sp.name, label: sp.name, pose: sp.pose, sp })) });
      for (const [cat, poses] of Object.entries(lib)) folders.push({ key: 'b:' + cat, label: cat, group: 'Built-in', items: Object.entries(poses).map(([name, def]) => ({ key: cat + name, label: name, def })) });
      if (e.rig === 'human') {
        const csp = await importedCsp('csppose'), sets = new Map();
        for (const r of csp) { const k = r.folder ? 'my:' + r.folder : r.set || 'Poses'; if (!sets.has(k)) sets.set(k, []); sets.get(k).push(r); }
        for (const [k, rs] of sets) folders.push({ key: 'csp:' + k, label: k.startsWith('my:') ? k.slice(3) : cspSetTitle(k, rs), sub: !k.startsWith('my:') && cspSetTitle(k, rs) !== k ? k : undefined, group: 'Clip Studio', items: rs.map((r) => ({ key: r.id, label: r.set && r.name.startsWith(r.set + ' · ') ? 'Pose ' + r.name.slice(r.set.length + 3) : r.name, csp: r.data, thumb: r.thumb ? URL.createObjectURL(store.toBlob(r.thumb)) : undefined })) });
      }
      for (const f of folders) for (const it of f.items) if (!it.thumb) it.thumb = thumbOf(it.key, it);
      const extra = e.rig === 'human' ? [switchRow('Mirror (flip left ↔ right)', mirror, (v) => { mirror = v; store.prefs.set('cspMirror', v); if (last) put(last); })] : [];
      const fb = folderBrowser({ title: 'Poses', folders, extra, remember: 'poseFolder:' + rigKey, startKey: folders[1] && folders[1].key, onPick: put,
        hint: 'Tap a pose to put it on the figure. Hold one of your saved poses to delete it.',
        onHold: (it, gone) => { if (!it.sp) return; store.prefs.set('savedPoses', store.prefs.get('savedPoses', []).filter((x) => !(x.name === it.sp.name && x.rig === it.sp.rig))); gone(); toast('Removed ' + it.sp.name); } });
      dialog({ title: (e.rig === 'human' ? 'Figure' : cname) + ' poses', wide: true, body: fb.body, actions: [
        { label: 'Save current pose…', onClick: async () => {
          const name = await promptDialog('Name for this pose', 'My pose'); if (!name) return false;
          store.prefs.set('savedPoses', [...store.prefs.get('savedPoses', []), { name, rig: rigKey, pose: JSON.parse(JSON.stringify(e.data.pose || {})) }]);
          toast('Saved pose "' + name + '"'); return false;
        } },
        ...(e.rig === 'human' ? [{ label: 'Import Clip Studio…', onClick: async () => { if (await this.importCsp()) { this.poseMenu(); } } }] : []),
        { label: 'Done', primary: true }], onClose: () => { fb.close(); this.commit('Pose preset', snap); this.redraw(1); } });
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
    // Clip Studio poses: the pose materials of a Material folder zip (or loose .pose files),
    // fitted joint by joint onto the selected figure
    async importCsp() {
      const files = await pickFile('.zip,.pose,.bodyproportion', true);
      if (!files.length) return 0;
      toast('Reading Clip Studio materials…', 60000);
      try {
        const r = await importCspFiles(files, (n, total) => { if (n % 10 === 0 || n === total) toast(`Reading Clip Studio materials… ${n} / ${total}`, 60000); });
        toast(r.poses || r.bodies ? `Imported ${r.poses} pose${r.poses === 1 ? '' : 's'}${r.bodies ? ` and ${r.bodies} body type${r.bodies === 1 ? '' : 's'}` : ''}` : 'No Clip Studio poses or body types found in that file', 4500);
        return r.poses + r.bodies;
      } catch (e) { console.error(e); toast('Could not read that: ' + e.message, 5000); return 0; }
    },
    // the Clip Studio pose library, laid out like Clip Studio's Material panel: a folder tree
    // (All poses · your folders · Download › one folder per downloaded set) beside the poses
    async cspPoseMenu() {
      const e = this.poseTarget();
      if (!e || e.rig !== 'human') {
        const sel = this.selEntry();
        toast(sel && sel.data.kind === 'model' && !sel.joints ? 'This model has no skeleton yet: 3D panel › Pose › Make posable (auto-rig), then try again' : 'Select a figure or a posable model first (＋ Models › Female / Male figure)', 5000);
        return;
      }
      const list = await importedCsp('csppose');
      const snap = this.snapshot(), urls = [], thumbs = new Map();
      const thumbUrl = (r) => { if (!r.thumb) return null; if (!thumbs.has(r.id)) { const u = URL.createObjectURL(store.toBlob(r.thumb)); urls.push(u); thumbs.set(r.id, u); } return thumbs.get(r.id); };
      let mirror = !!store.prefs.get('cspMirror', false), curRec = null, query = '';
      let where = store.prefs.get('cspFolder', 'all');
      const myFolders = () => [...new Set([...store.prefs.get('cspFolders', []), ...list.map((r) => r.folder).filter(Boolean)])];
      const setOf = (r) => r.set || 'Poses';
      const inFolder = (r, f) => f === 'all' || (f.startsWith('my:') ? r.folder === f.slice(3) : !r.folder && 'dl:' + setOf(r) === f);
      // a short English gloss for Japanese pack names (Clip Studio Assets packs are often Japanese)
      const gloss = cspGloss;
      const label = (r) => (r.set && r.name.startsWith(r.set + ' · ') ? 'Pose ' + r.name.slice(r.set.length + 3) : r.name);
      const put = (r) => {
        try { const ps = M.retargetCSP(r.data, e.fig); e.data.pose = mirror ? M.mirrorStored(ps) : ps; syncObject(e); this.redraw(this.previewScale()); return true; }
        catch (err) { console.error(err); toast('Could not apply that pose: ' + err.message, 4000); return false; }
      };
      const save = (r) => store.putAsset(r);
      const side = h('div', { class: 'csp-tree' }), main = h('div', { class: 'csp-main' }), grid = h('div', { class: 'lib3d-grid' });
      const head = h('div', { class: 'csp-head' });
      const search = h('input', { type: 'search', placeholder: 'Search all poses', class: 'csp-search' });
      search.oninput = () => { query = search.value.trim().toLowerCase(); drawGrid(); };
      main.append(search, switchRow('Mirror (flip left ↔ right)', mirror, (v) => { mirror = v; store.prefs.set('cspMirror', v); if (curRec) put(curRec); }), head, grid);
      const choose = (f) => { where = f; store.prefs.set('cspFolder', f); search.value = ''; query = ''; drawTree(); drawGrid(); };
      const holdable = (el, fn) => { let t; el.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; el.dataset.held = '1'; fn(); }, 600); }); const stop = () => clearTimeout(t); el.addEventListener('pointerup', stop); el.addEventListener('pointerleave', stop); el.addEventListener('pointercancel', stop); };
      const node = (f, text, n, depth = 0, hold, orig) => {
        const bt = h('button', { class: 'csp-node' + (where === f ? ' on' : ''), style: `padding-left:${10 + depth * 14}px`, onclick: () => { if (bt.dataset.held) { delete bt.dataset.held; return; } choose(f); } },
          h('span', { class: 'csp-ico' }, f === 'all' ? '▦' : '📁'), h('span', { class: 'csp-name', title: orig || text }, text, orig && orig !== text ? h('small', {}, orig) : null), h('span', { class: 'csp-count' }, String(n)));
        if (hold) holdable(bt, hold);
        return bt;
      };
      const drawTree = () => {
        side.replaceChildren(node('all', 'All poses', list.length));
        const mine = myFolders();
        side.append(h('div', { class: 'csp-group' }, 'My folders'));
        for (const name of mine) side.append(node('my:' + name, name, list.filter((r) => r.folder === name).length, 1, () => folderMenu(name)));
        side.append(h('button', { class: 'csp-node csp-add', style: 'padding-left:24px', onclick: () => newFolder() }, '＋ New folder'));
        const sets = [...new Set(list.filter((r) => !r.folder).map(setOf))];
        if (sets.length) {
          side.append(h('div', { class: 'csp-group' }, 'Download'));
          for (const st of sets) { const rs = list.filter((r) => !r.folder && setOf(r) === st); side.append(node('dl:' + st, cspSetTitle(st, rs), rs.length, 1, null, st)); }
        }
      };
      const drawGrid = () => {
        const rs = query ? list.filter((r) => (r.name + ' ' + (r.set || '') + ' ' + gloss(r.set || '') + ' ' + (r.folder || '')).toLowerCase().includes(query)) : list.filter((r) => inFolder(r, where));
        const title = query ? `Search “${query}”` : where === 'all' ? 'All poses' : where.startsWith('dl:') ? cspSetTitle(where.slice(3), list.filter((r) => !r.folder && 'dl:' + setOf(r) === where)) : where.slice(3);
        head.replaceChildren(h('b', {}, title), h('span', { class: 'hint' }, `${gloss(title) ? ' · ' + gloss(title) : ''} · ${rs.length} pose${rs.length === 1 ? '' : 's'}`));
        grid.replaceChildren(...rs.map((r) => {
          const u = thumbUrl(r);
          const bt = h('button', { class: 'lib3d-item my-model' + (curRec === r ? ' on' : ''), onclick: () => {
            if (bt.dataset.held) { delete bt.dataset.held; return; }
            if (!put(r)) return; curRec = r; grid.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); bt.classList.add('on');
          } }, u ? h('img', { src: u, alt: '' }) : null, h('span', {}, where === 'all' || query || r.folder ? r.name : label(r)));
          holdable(bt, () => poseMenu(r));
          return bt;
        }));
        if (!rs.length) grid.append(h('p', { class: 'hint' }, query ? 'No pose matches.' : where.startsWith('my:') ? 'Empty folder. Hold a pose anywhere and choose “Move to folder…”.' : 'Nothing here.'));
      };
      const newFolder = async (then) => {
        const name = (await promptDialog('New folder', 'My poses') || '').trim(); if (!name) return null;
        store.prefs.set('cspFolders', [...new Set([...store.prefs.get('cspFolders', []), name])]);
        if (then) await then(name); drawTree(); return name;
      };
      const moveTo = async (r, name) => { r.folder = name || null; await save(r); drawTree(); drawGrid(); toast(name ? `Moved to “${name}”` : `Back in “${setOf(r)}”`); };
      const poseMenu = (r) => {
        const mine = myFolders().filter((f) => f !== r.folder);
        const d = dialog({ title: r.name, body: h('div', { class: 'stack' },
          h('div', { class: 'menu-section' }, 'Move to folder'),
          h('div', { class: 'p3d-chips' }, ...mine.map((f) => h('button', { onclick: () => { d.close(); moveTo(r, f); } }, '📁 ' + f)),
            r.folder ? h('button', { onclick: () => { d.close(); moveTo(r, null); } }, '↩ Back to ' + setOf(r)) : null,
            h('button', { onclick: async () => { d.close(); await newFolder((n) => moveTo(r, n)); } }, '＋ New folder…'))),
          actions: [
            { label: 'Rename…', onClick: async () => { const n = (await promptDialog('Rename pose', r.name) || '').trim(); if (n) { r.name = n; await save(r); drawGrid(); } } },
            { label: 'Delete', danger: true, onClick: async () => { await store.deleteAsset(r.id); list.splice(list.indexOf(r), 1); drawTree(); drawGrid(); toast('Removed ' + r.name); } },
            { label: 'Cancel', primary: true }] });
      };
      const folderMenu = (name) => {
        dialog({ title: '📁 ' + name, body: h('p', { class: 'hint' }, 'Deleting a folder keeps its poses: they go back to their Download folders.'), actions: [
          { label: 'Rename…', onClick: async () => {
            const n = (await promptDialog('Rename folder', name) || '').trim(); if (!n || n === name) return;
            store.prefs.set('cspFolders', [...new Set(store.prefs.get('cspFolders', []).map((f) => (f === name ? n : f)))]);
            for (const r of list.filter((x) => x.folder === name)) { r.folder = n; await save(r); }
            if (where === 'my:' + name) where = 'my:' + n; drawTree(); drawGrid();
          } },
          { label: 'Delete folder', danger: true, onClick: async () => {
            store.prefs.set('cspFolders', store.prefs.get('cspFolders', []).filter((f) => f !== name));
            for (const r of list.filter((x) => x.folder === name)) { r.folder = null; await save(r); }
            if (where === 'my:' + name) where = 'all'; drawTree(); drawGrid();
          } },
          { label: 'Cancel', primary: true }] });
      };
      // a folder that no longer exists (deleted, or a fresh library) falls back to All poses
      const valid = where === 'all' || (where.startsWith('my:') && myFolders().includes(where.slice(3))) || (where.startsWith('dl:') && list.some((r) => !r.folder && 'dl:' + setOf(r) === where));
      if (!valid) where = 'all';
      const body = h('div', {});
      if (!list.length) body.append(h('p', {}, 'No Clip Studio poses yet. Import your Clip Studio Material folder as a .zip (or single .pose files): every pose in it is added here with its thumbnail, one folder per set, like Clip Studio’s Material panel.'),
        h('p', { class: 'hint' }, 'On a PC the folder is %APPDATA%\\CELSYSUserData\\CELSYS\\CLIPStudioCommon\\Material (right-click › Send to › Compressed folder). Downloaded 3D models stay encrypted by Clip Studio, but poses and body types are read exactly.'));
      else { drawTree(); drawGrid(); body.append(h('div', { class: 'csp-lib' }, side, main), h('p', { class: 'hint' }, 'Tap a pose to put it on the figure. Hold a pose to move, rename or delete it; hold one of your folders to rename or delete it.')); }
      dialog({ title: `Clip Studio poses (${list.length})`, wide: true, body, actions: [
        { label: 'Credits', onClick: async () => { const L = await import('./learn/learn.js'); L.creditsDialog(); return false; } },
        { label: 'Import…', onClick: async () => { if (await this.importCsp()) this.cspPoseMenu(); } },
        { label: 'Done', primary: true }], onClose: () => { urls.forEach((u) => URL.revokeObjectURL(u)); this.commit('Clip Studio pose', snap); this.redraw(1); } });
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
    // lock an object (weapon, prop, any model) onto a body part of a figure: it then follows that
    // part through every pose, pointing the way the part points. Hands grip weapons properly.
    holdMenu() {
      const e = this.selEntry(); if (!e || e.joints) return;
      const L = this.layer(), rt = runtimes.get(L), def = e.data.kind === 'weapon' ? WD.WEAPONS[e.data.weapon] : null;
      const figs = [...rt.objs.values()].filter((x) => x.rig === 'human' && x.joints);
      let fig = (e.data.attach && rt.objs.get(e.data.attach.to)) || figs[0];
      const PARTS = [['handR', 'Right hand'], ['handL', 'Left hand'], ['elbowR', 'Right forearm'], ['elbowL', 'Left forearm'], ['shoulderR', 'Right upper arm'], ['shoulderL', 'Left upper arm'],
        ['head', 'Head'], ['neck', 'Neck'], ['chest', 'Chest / back'], ['spine', 'Waist'], ['pelvis', 'Hips'], ['hipR', 'Right thigh'], ['hipL', 'Left thigh'], ['kneeR', 'Right lower leg'], ['kneeL', 'Left lower leg'], ['footR', 'Right foot'], ['footL', 'Left foot']];
      let dlg = null;
      const put = (part) => {
        const b = this.snapshot();
        if (!part || !fig) {
          // let go: stays where it is in the scene
          const wp = e.node.getWorldPosition(new T.Vector3()), wq = e.node.getWorldQuaternion(new T.Quaternion());
          delete e.data.attach; e.data.pos = wp.toArray(); e.data.quat = wq.toArray();
        } else {
          const m = /^hand([LR])$/.exec(part), j = fig.joints[part];
          if (!j) { toast('This figure has no such part'); return; }
          e.data.attach = { to: fig.data.id, part, side: m ? m[1] : undefined };
          if (m && def) { Object.assign(e.data, WD.gripTransform(m[1], def.grip, fig.fig.H * 0.105)); fig.data.pose = { ...fig.data.pose, ...M.poseFromDegrees(M.handPose('Grip', m[1])) }; }
          else if (m) { e.data.pos = [(m[1] === 'L' ? 1 : -1) * fig.fig.H * 0.045, 0, 0]; e.data.quat = [0, 0, 0, 1]; } // in the palm, pointing with the hand
          else {
            // on the part, a little outside it, keeping the way it is turned in the scene
            const wq = e.node.getWorldQuaternion(new T.Quaternion()), jq = j.getWorldQuaternion(new T.Quaternion());
            e.data.pos = part === 'chest' ? [0, fig.fig.H * 0.08, -fig.fig.H * 0.08] : part === 'head' ? [0, fig.fig.H * 0.07, 0] : part === 'pelvis' ? [fig.fig.H * 0.09, 0, 0] : [0, 0, 0];
            e.data.quat = jq.invert().multiply(wq).toArray();
          }
          e.data.scale = (e.data.scale || 1) / (e.node.parent && e.node.parent !== rt.scene ? 1 : (fig.node.scale.x || 1));
        }
        attachAll(rt); syncAll(rt); this.commit(part ? 'Attach to body' : 'Detach', b); this.redraw(1); this.panelRefresh();
        dlg && dlg.close();
        if (part) toast('Locked to ' + PARTS.find((x) => x[0] === part)[1].toLowerCase() + ' — Move / Rotate adjust how it sits', 3500);
      };
      const body = h('div', {});
      if (!figs.length) body.append(h('p', { class: 'hint' }, 'Add a figure first: the object locks onto one of its body parts.'));
      else {
        if (figs.length > 1) body.append(h('div', { class: 'stack' }, h('label', {}, 'Figure'), seg(figs.map((f) => [f.data.id, (f.data.name || 'Figure').slice(0, 18)]), fig.data.id, (v) => { fig = rt.objs.get(v); })));
        body.append(h('p', { class: 'hint' }, 'Pick the body part. The object follows it through every pose and turns with it.'),
          h('div', { class: 'p3d-chips' }, ...PARTS.filter(([k]) => fig.joints[k]).map(([k, l]) => h('button', { class: e.data.attach && (e.data.attach.part || 'hand' + e.data.attach.side) === k ? 'on' : '', onclick: () => put(k) }, l))));
      }
      dlg = dialog({ title: 'Attach ' + (e.data.name || 'object'), body, actions: [...(e.data.attach ? [{ label: 'Detach', onClick: () => put(null) }] : []), { label: 'Cancel', primary: true }] });
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
        ...SHAPES.map(([k, l]) => ({ label: l, onClick: () => this.addShape(k, l) })),
        { label: 'Cancel', primary: true },
      ] });
    },
    async importModel() {
      const picked = await pickFile('.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.zip,.blend,.vrm,.fbx,.obj,.clip,.cs3c,.cs3o,.cs3s,.cmo,.csmf,.c2fc', true);
      if (!picked.length) return;
      // Blender's own .blend, or an export: .glb, .gltf with its .bin / textures, a .zip of the folder
      let f = picked[0];
      if (/\.clip$/i.test(f.name)) return this.importClip(f);
      if (picked.length > 1 || /\.(gltf|zip)$/i.test(f.name)) {
        try {
          const r = await AS.modelFromFiles(picked);
          if (!r) { toast('No 3D model among those files', 4000); return; }
          f = new File([r.blob], r.name);
        } catch (e) { toast('Could not read that model: ' + e.message, 6000); return; }
      }
      let ext = f.name.split('.').pop().toLowerCase().replace(/^blend\d+$/, 'blend'), blob = f, note = '';
      if (!['glb', 'gltf', 'vrm', 'fbx', 'obj', 'blend'].includes(ext)) {
        // Clip Studio (or unknown) file: look for a standard model embedded inside it
        toast('Looking inside ' + f.name + '…', 6000);
        const found = await extractEmbeddedModel(new Uint8Array(await f.arrayBuffer()));
        if (!found) {
          // Clip Studio's own 3D formats are closed: offer the same model from an open source instead
          const guess = f.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').replace(/\b(ver|v)\s*\d+(\.\d+)*\b/ig, '').trim();
          dialog({ title: 'Clip Studio 3D file', body: h('div', {},
            h('p', {}, `“${f.name}” is in Clip Studio’s own 3D format, which only Clip Studio can open (there is no standard 3D data inside it).`),
            h('p', {}, 'What works instead: many CSP Assets creators also share their models as FBX, OBJ, glTF or VRM (check the asset’s page or the creator’s BOOTH / website), and Sketchfab has a large free library of downloadable models.')),
            actions: [{ label: 'Close' }, { label: 'Download from a link…', onClick: () => this.assetMenu() }, { label: `Search Sketchfab for “${guess.slice(0, 24)}”`, primary: true, onClick: () => this.assetMenu(guess) }] });
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
    // Clip Studio .clip: rebuild its 3D layer from what the file keeps readable. The models, pose
    // and body shape are encrypted by Clip Studio, so each object is matched to Inkwell's own
    // models by type and name, the camera is copied exactly, and the Clip Studio render goes on
    // a reference layer above to match the look and pose against.
    async importClip(f) { return this.group('Import from Clip Studio', () => this._importClip(f)); },
    async _importClip(f) {
      toast('Reading ' + f.name + '…', 6000);
      let info;
      try { const CF = await import('./clipfile.js'); info = await CF.readClip(new Uint8Array(await f.arrayBuffer())); this._CF = CF; }
      catch (e) { console.error(e); toast('Could not read that .clip: ' + e.message, 6000); return; }
      const sc = info.scenes[0];
      if (!sc) { toast('That .clip has no 3D layer', 4000); return; }
      const L = this.layer(), s = L.scene3d, b = this.snapshot(), added = [], missing = [];
      let nFig = 0, nSmall = 0;
      for (const ob of sc.objects) {
        if (ob.type === 'light' || ob.type === 'other') continue;
        const gen = this._CF.matchBuiltin(ob.name);
        let o = null;
        if (ob.type === 'figure' || gen === 'figure-male') {
          o = figureObject(nFig * 0.7, gen === 'figure-male' ? 'male' : 'female'); nFig++;
        } else if (gen === 'mannequin-male' || gen === 'mannequin-female') {
          const sex = gen.endsWith('female') ? 'female' : 'male';
          o = { id: uid(), kind: 'mannequin', sex, pos: [-0.8 - nSmall * 0.5, 0, 0], quat: [0, 0, 0, 1], scale: sex === 'female' ? 0.95 : 1, pose: {}, color: '#e2e1dd' }; nSmall++;
        } else if (gen === 'planarhead') {
          o = procObject('planarhead', -1 - nSmall * 0.6); o.pos[1] = 0.88; o.scale = 1.2; nSmall++;
        } else { missing.push(ob); continue; }
        o.name = ob.name || o.name;
        added.push(o);
      }
      if (sc.camera) s.camera = { pos: sc.camera.pos, target: sc.camera.target, fov: sc.camera.fov };
      s.objects.push(...added);
      const rt = await runtimeFor(L);
      for (const o of added) { try { await buildObject(L, rt, o); } catch (e) { console.warn(o.name, e); } }
      attachAll(rt); syncAll(rt);
      if (added[0]) this.sel = added[0].id;
      this.commit('Import from Clip Studio', b); this.redraw(1); app.updateCtxBar(); this.panelRefresh && this.panelRefresh();
      // the picture as Clip Studio rendered it, to line the pose and body up against
      if (info.preview) {
        try {
          const img = await createImageBitmap(info.preview), d = app.doc;
          const ref = new Layer(d.width, d.height, { name: 'Clip Studio render (' + f.name.replace(/\.clip$/i, '') + ')', opacity: 0.45, reference: true });
          const k = Math.min(d.width / img.width, d.height / img.height), w = img.width * k, hh = img.height * k;
          ref.canvas.getContext('2d').drawImage(img, (d.width - w) / 2, (d.height - hh) / 2, w, hh);
          insertLayer(app, ref, Math.min(d.items.indexOf(L) + 1, d.items.length));
        } catch (e) { console.warn('preview', e); }
      }
      const names = added.map((o) => o.name).join(', ');
      dialog({ title: 'Imported from Clip Studio', body: h('div', {},
        h('p', {}, added.length ? `Rebuilt with Inkwell’s models: ${names}. The camera matches Clip Studio’s.` : 'No object in that 3D layer has an Inkwell match.'),
        h('p', {}, 'Clip Studio encrypts the 3D data in its files, so the exact mesh, pose and body shape can’t be read. The Clip Studio render is on a see-through reference layer above: match the pose with Pose mode and the shape with Body presets… (Curvy, Heroic…) and the proportion sliders, then hide or delete that layer.'),
        missing.length ? h('p', {}, 'Not built in: ' + missing.map((m) => '“' + m.name + '”').join(', ') + '. Search Sketchfab for a free downloadable version, or import the creator’s FBX / OBJ / VRM if they share one.') : null),
        actions: [{ label: 'OK', primary: !missing.length }, ...missing.slice(0, 2).map((m) => ({ label: `Search “${m.name.slice(0, 20)}”`, primary: true, onClick: () => this.assetMenu(m.name) }))] });
    },
    // save the selected model as it is now (body shape, proportions, outfit, colour, material,
    // pose, size) to reuse in any document
    async savePreset(e) {
      e = e || this.selEntry(); if (!e) { toast('Select a model first'); return; }
      const name = await promptDialog('Name for this model', e.data.name || 'My model'); if (!name) return;
      const L = this.layer(), o = JSON.parse(JSON.stringify(e.data));
      delete o.id; delete o.attach; o.pos = [0, 0, 0]; o.name = name;
      const files = {};
      const keep = (k) => { const m = L.models.get(k); if (m && m.blob) files[k] = m; };
      if (o.modelId) keep(o.modelId);
      if (o.mat) for (const k of L.models.keys()) if (k.startsWith(o.mat.asset + ':')) keep(k);
      const packed = {};
      for (const [k, m] of Object.entries(files)) packed[k] = { ext: m.ext, name: m.name, real: m.real, type: m.blob.type, bytes: await m.blob.arrayBuffer() };
      // thumbnail: the layer's current render, cropped around the model
      let thumb = null;
      try {
        // render once without the manipulator / joint highlight for a clean picture
        const wasOff = this.off; this.off = true; this.highlight(null); this.syncGizmo(); await render3D(L, app.doc, 1);
        const snap = makeCanvas(L.canvas.width, L.canvas.height); snap.getContext('2d').drawImage(L.canvas, 0, 0);
        this.off = wasOff; this.syncGizmo(); this.highlight(this.joint); this.redraw(1);
        const rt = runtimes.get(L), c = snap, box = new T.Box3().setFromObject(e.node);
        const pts = [box.min, box.max, new T.Vector3(box.min.x, box.max.y, box.min.z), new T.Vector3(box.max.x, box.min.y, box.max.z)].map((v) => v.clone().project(rt.camera));
        const xs = pts.map((p) => (p.x + 1) / 2 * c.width), ys = pts.map((p) => (1 - p.y) / 2 * c.height);
        let x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(c.width, Math.max(...xs)), y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(c.height, Math.max(...ys));
        const side = Math.max(x1 - x0, y1 - y0, 20) * 1.1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const t = makeCanvas(160, 160), tx = t.getContext('2d');
        tx.fillStyle = '#e9e9ee'; tx.fillRect(0, 0, 160, 160); tx.drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, 160, 160);
        thumb = await (await canvasToBlob(t, 'image/png')).arrayBuffer();
      } catch (err) { console.warn('preset thumbnail', err); }
      await store.putAsset({ id: 'my:' + uid(), kind: 'preset', name, obj: o, files: packed, thumb, added: Date.now() });
      toast(`Saved "${name}" — find it under ＋ Models › My models`, 3500);
    },
    async addPreset(rec) {
      const L = this.layer(); if (!L) { toast('Select a 3D layer'); return; }
      const o = JSON.parse(JSON.stringify(rec.obj));
      const idMap = {};
      for (const [k, f] of Object.entries(rec.files || {})) {
        // material maps keep their key (shared by name); a model file gets a fresh id
        const nk = o.modelId === k ? uid() : k; idMap[k] = nk;
        if (!L.models.has(nk)) L.models.set(nk, { id: nk, ext: f.ext, name: f.name, real: f.real, blob: new Blob([f.bytes], { type: f.type || '' }) });
      }
      if (o.modelId) o.modelId = idMap[o.modelId] || o.modelId;
      o.id = uid();
      toast('Adding ' + rec.name + '…', 3000);
      try { await this.addObject(o, 'Add ' + rec.name); }
      catch (err) { console.error(err); toast('Could not add that model: ' + err.message, 4500); }
    },
    async assetMenu(query) {
      await importBundledModels();
      AS.openAssetBrowser({
        query: typeof query === 'string' ? query : undefined,
        onModel: (rec) => this.addAssetModel(rec),
        onMaterial: (rec) => { if (!this.sel) return false; this.setMaterial(rec); return true; },
      });
    },
    async addAssetModel(rec) { return this.group('Add ' + (rec.name || 'model'), () => this._addAssetModel(rec)); },
    async _addAssetModel(rec) {
      const L = this.layer(); if (!L) return;
      const id = uid();
      L.models.set(id, { id, ext: rec.ext || 'glb', name: rec.name, real: true, blob: new Blob([rec.bytes]) });
      toast('Adding ' + rec.name + '…', 5000);
      const oid = uid();
      try {
        await this.addObject({ id: oid, kind: 'model', modelId: id, name: rec.name, pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1 }, 'Add asset');
        this.fitImported(oid);
        toast(rec.name + ' added' + (rec.author ? ` · by ${rec.author}` : '') + ' — use Move / Rotate / Scale', 3500);
      }
      catch (e) { console.error(e); L.models.delete(id); toast('Could not load that model: ' + e.message, 4500); }
    },
    // Downloaded models come in at whatever size and position their author used (centimetres,
    // kilometres, floating in space…). Bring them to a person-sized scale, standing on the
    // floor at the centre, and frame them.
    fitImported(oid) {
      const L = this.layer(), rt = runtimes.get(L), e = rt && rt.objs.get(oid); if (!e) return;
      e.node.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(e.node);
      if (box.isEmpty()) return;
      const size = box.getSize(new T.Vector3()), big = Math.max(size.x, size.y, size.z);
      const o = e.data;
      if (big > 0 && (big > 6 || big < 0.25)) o.scale = +(1.8 / big * o.scale).toPrecision(4);
      const k = o.scale, c = box.getCenter(new T.Vector3());
      o.pos = [o.pos[0] - c.x * k + c.x * 0, o.pos[1] - box.min.y * k, o.pos[2] - c.z * k];
      syncObject(e);
      this.redraw(1);
      this.frameObject(oid);
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
