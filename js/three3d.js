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

let T = null;
async function three() {
  if (!T) { T = await import('../vendor/three.bundle.js'); M.setThree(T); }
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
  body: sex === 'male' ? { sex: 'male', height: 1.75, heads: 7.5, build: 0.55 } : { sex: 'female', height: 1.62, heads: 7.2, build: 0.4 } });
// built-in library models (generated, no download)
export const LIBRARY = [
  ['Figures', [['figure-female', 'Female figure'], ['figure-male', 'Male figure'], ['knight', 'Knight (medieval armour)'], ['scifi', 'Sci-fi armour']]],
  ['Creatures', [['dragon', 'Dragon (posable)']]],
  ['Vehicles', [['car', 'Car'], ['sports', 'Sports car'], ['moto', 'Motorcycle']]],
  ['Places', [['castle', 'Castle'], ['street', 'City street'], ['district', 'City district']]],
];
const procObject = (gen, x = 0) => ({ id: uid(), kind: 'proc', gen, name: LIBRARY.flatMap((c) => c[1]).find((i) => i[0] === gen)?.[1] || gen, pos: [x, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: { dragon: '#7f8a84', car: '#3d6fd6', sports: '#e8b21a', moto: '#c72c2c' }[gen] || '#cfcac2' });

export function create3DLayer(doc) {
  const l = new Layer(doc.width, doc.height, { type: '3d', name: '3D' });
  l.scene3d = defaultScene();
  l.scene3d.objects.push(figureObject(0, 'female'));
  return l;
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
    if (!o.isMesh || o.userData.outline) return;
    const c = o.isSkinnedMesh ? new T.SkinnedMesh(o.geometry, mat) : new T.Mesh(o.geometry, mat);
    if (o.isSkinnedMesh) c.bind(o.skeleton, o.bindMatrix);
    c.userData.outline = true; c.raycast = () => {};
    c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
    add.push([o.parent, c]);
  });
  for (const [p, c] of add) p.add(c);
}

// ───────── runtime scene per layer ─────────
const runtimes = new WeakMap();
let renderer = null;

async function runtimeFor(layer) {
  await three();
  let rt = runtimes.get(layer);
  if (rt) return rt;
  rt = { scene: new T.Scene(), camera: new T.PerspectiveCamera(35, 1, 0.02, 2000), objs: new Map(), outlineW: { value: 0.008 } };
  rt.hemi = new T.HemisphereLight(0xffffff, 0x8a8478, 1);
  rt.sun = new T.DirectionalLight(0xffffff, 2.4);
  rt.scene.add(rt.hemi, rt.sun);
  runtimes.set(layer, rt);
  for (const o of layer.scene3d.objects) await buildObject(layer, rt, o);
  return rt;
}

async function buildObject(layer, rt, o) {
  let node, joints = null, figMat = null, rig = null, fig = null;
  if (o.kind === 'figure' && o.rig === 2) {
    fig = M.buildHuman(o.body, o.color); if (o.outfit && o.outfit !== 'none') M.buildArmor(fig, o.outfit);
    node = fig.root; joints = fig.joints; figMat = fig.mat; rig = 'human';
  } else if (o.kind === 'figure') {
    const f = buildFigure(o.color); node = f.root; joints = f.joints; figMat = f.mat;
  } else if (o.kind === 'proc') {
    const g = o.gen;
    const built = g === 'dragon' ? M.buildDragon(o.color) : g === 'car' ? M.buildCar('sedan', o.color) : g === 'sports' ? M.buildCar('sports', o.color) : g === 'moto' ? M.buildMotorcycle(o.color)
      : g === 'castle' ? M.buildCastle() : g === 'street' ? M.buildCity('street') : g === 'district' ? M.buildCity('district') : null;
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
  }
  if (!node) return;
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

function syncObject(e) {
  const o = e.data;
  e.node.position.set(...o.pos);
  e.node.quaternion.set(...o.quat);
  e.node.scale.setScalar(o.scale);
  if (e.rig === 'human') M.applyPose(e.joints, o.pose || {}, M.HUMAN_REST, e.fig.H);
  else if (e.rig === 'dragon') M.applyPose(e.joints, o.pose || {}, M.DRAGON_REST, 1);
  else if (e.joints) applyPose({ joints: e.joints }, o);
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
  // normalise: feet on the ground, ~1.7 units tall, centred
  const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3());
  const k = 1.7 / Math.max(size.y, size.x * 0.6, size.z * 0.6, 1e-6);
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

// Synchronous render once the scene exists (used for live dragging).
function renderNow(layer, doc, rt, scale = 1, live = false) {
  applySceneSettings(layer, rt, doc);
  if (!renderer) {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NoToneMapping;
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
  }
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
    mode: 'orbit', sel: null, joint: null, busy: false, ik: true,
    layer() { const it = app.doc && app.doc.activeItem; return it && it.type === '3d' ? it : null; },
    async enter() {
      const L = this.layer();
      if (!L) { toast('Select a 3D layer (Layers › cube button, or Actions › Add › 3D layer)'); return; }
      try { await this.redraw(1); } catch (e) { console.error(e); toast('3D failed to start: ' + e.message); }
    },
    exit() { this.joint = null; const L = this.layer(); if (L && runtimes.get(L)) { this.highlight(null); this.redraw(1); } },
    async redraw(scale = 1) {
      const L = this.layer(); if (!L) return;
      if (!runtimes.get(L)) { await render3D(L, app.doc, scale); app.requestRender('active'); return; }
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
        renderNow(L, app.doc, rt, sc, sc < 1 && (this.dragging || this.live));
        app.requestRender('active');
      });
    },
    snapshot() { return JSON.stringify(this.layer().scene3d); },
    commit(label, before) {
      const L = this.layer(), after = this.snapshot();
      if (before === after) return;
      const restore = async (json) => { L.scene3d = JSON.parse(json); const rt = runtimes.get(L); if (rt) for (const e of rt.objs.values()) { e.data = L.scene3d.objects.find((o) => o.id === e.data.id) || e.data; syncObject(e); } await render3D(L, app.doc, 1); app.changed('active'); };
      app.history.push({ label, bytes: after.length, undo: () => restore(before), redo: () => restore(after) });
      app.changed('active');
    },
    ndc(p) { return new T.Vector2((p.x / app.doc.width) * 2 - 1, -(p.y / app.doc.height) * 2 + 1); },
    pick(p) {
      const rt = runtimes.get(this.layer()); if (!rt) return null;
      const ray = new T.Raycaster(); ray.setFromCamera(this.ndc(p), rt.camera);
      const hit = ray.intersectObjects(rt.scene.children, true).find((i) => i.object.visible && !i.object.userData.outline);
      return hit ? { objId: hit.object.userData.objId, joint: hit.object.userData.joint || null } : null;
    },
    highlight(jointName) {
      const rt = runtimes.get(this.layer()); if (!rt) return;
      for (const e of rt.objs.values()) if (e.figMat) {
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
      this.p0 = p; this.last = p; this.moved = false; this.before = this.snapshot();
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
      const s = L.scene3d, cam = rt.camera;
      const pos = new T.Vector3(...s.camera.pos), tgt = new T.Vector3(...s.camera.target);
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const unit = (dist) => (2 * Math.tan((cam.fov * Math.PI / 180) / 2) * dist) / app.doc.height;
      if (this.mode === 'orbit') {
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
        } else if (this.mode === 'pose' && this.joint && e.joints && e.rig === 'human' && this.ik && M.IK_CHAINS[this.joint]) {
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
      if (!this.moved && (this.mode === 'move' || this.mode === 'rotate' || this.mode === 'scale') && !this.pick(this.p0)) { this.sel = null; app.updateCtxBar(); }
      this.commit({ orbit: 'Orbit camera', pan: 'Pan camera', zoom: 'Zoom camera', move: 'Move object', rotate: 'Rotate object', scale: 'Scale object', pose: 'Pose' }[this.mode], this.before);
      this.redraw(1);
    },
    cancel() { this.dragging = false; this.redraw(1); },
    bar() {
      const L = this.layer();
      if (!L) return [h('span', { class: 'three-hint' }, 'Select a 3D layer to edit it')];
      const cb = (label, fn, on, cls = '') => h('button', { class: 'cb-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
      const sep = () => h('span', { class: 'cb-sep' });
      const setMode = (m) => { this.mode = m; if (m !== 'pose') { this.joint = null; this.highlight(null); this.redraw(1); } app.updateCtxBar(); };
      const e = this.selEntry();
      const items = [
        ...[['orbit', 'Orbit'], ['pan', 'Pan'], ['zoom', 'Zoom']].map(([m, l]) => cb(l, () => setMode(m), this.mode === m)), cb('Camera…', () => this.cameraMenu()), sep(),
        ...[['move', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale'], ['pose', 'Pose']].map(([m, l]) => cb(l, () => setMode(m), this.mode === m)), sep(),
        cb('＋ Figure', () => this.figureMenu()), cb('＋ Library…', () => this.libraryMenu()), cb('＋ Model…', () => this.importModel()), cb('＋ Shape', () => this.shapeMenu()),
        cb('Light…', () => this.lightDialog()),
      ];
      if (this.mode === 'pose') {
        const ikJoint = this.joint && M.IK_CHAINS[this.joint] && e && e.rig === 'human';
        items.push(sep(), h('span', { class: 'three-hint' }, this.joint ? (ikJoint && this.ik ? `${this.jointLabel(this.joint)} · drag to move the limb` : `${this.jointLabel(this.joint)} · drag to bend`) : 'Tap a body part, then drag'));
        if (e && e.rig === 'human') items.push(cb('IK', () => { this.ik = !this.ik; app.updateCtxBar(); }, this.ik));
        items.push(cb('Poses…', () => this.poseMenu()));
        if (e && e.rig === 'human') items.push(cb('Hands…', () => this.handMenu()), cb('Mirror', () => this.mirrorPose()), cb('Body…', () => this.bodyDialog()), cb('BVH…', () => this.bvhMenu()));
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
      const big = ['castle', 'street', 'district'].includes(gen);
      const o = procObject(gen, big ? 0 : n * 1.2);
      if (gen === 'dragon') o.pos = [n ? 3 : 0, 0, n ? -3 : 0];
      await this.addObject(o, 'Add ' + o.name);
      this.frameObject(o.id, gen);
    },
    // fit the camera to an object (castles, cities and dragons are much bigger than a figure)
    frameObject(id, gen) {
      const L = this.layer(), rt = runtimes.get(L), e = rt && rt.objs.get(id); if (!e) return;
      const b = this.snapshot(), s = L.scene3d;
      const box = new T.Box3().setFromObject(e.node), c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
      if (gen === 'street') { s.camera = { pos: [2, 1.6, -60], target: [0, 4, 0], fov: 40 }; }
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
      const at = e ? e.node.position.clone().add(new T.Vector3(0, (e.rig === 'dragon' ? 1.6 : 0.95) * e.data.scale, 0)) : new T.Vector3(...s.camera.target);
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
      if (!e) { toast('Add a figure or the dragon first'); return; }
      const b = this.snapshot(), lib = e.rig === 'dragon' ? { Dragon: M.DRAGON_POSES } : e.rig === 'human' ? M.HUMAN_POSES : null;
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
      dialog({ title: (e.rig === 'dragon' ? 'Dragon' : 'Figure') + ' poses', wide: true, body, actions: [{ label: 'Done', primary: true }], onClose: () => this.commit('Pose preset', b) });
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
      e.node.traverse((m) => { if (m.isMesh && m.geometry && !m.userData.outline) m.geometry.dispose(); });
      await buildObject(L, rt, e.data);
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
    async addObject(o, label) {
      const L = this.layer(); const b = this.snapshot();
      L.scene3d.objects.push(o);
      const rt = await runtimeFor(L); await buildObject(L, rt, o);
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
      const [f] = await pickFile('.glb,.gltf,.vrm,.fbx,.obj,.cs3c,.cs3o,.cs3s,.cmo,.csmf,.c2fc');
      if (!f) return;
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
      this.redraw(1); app.updateCtxBar();
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
      await this.redraw(1);
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
  const l = create3DLayer(d);
  insertLayer(app, l);
  toast('Loading 3D…', 3000);
  try { await render3D(l, d, 1); } catch (e) { console.error(e); toast('3D failed to start: ' + e.message); return; }
  app.changed();
  app.setTool('3d');
}
