// 3D layers: a posable drawing figure, imported models (glTF/GLB/VRM, FBX, OBJ — the open
// formats Clip Studio Paint itself imports), primitives, camera orbit / pan / zoom, object
// move / rotate / scale, per-joint posing, lighting and outlines. The scene is rendered with
// WebGL into the layer's canvas, so it composites like any other layer (and can be clipped
// to or rasterized). three.js is loaded only when a 3D layer is first edited.
import { h, toast, dialog, field, switchRow, uid, clamp, pickFile, makeCanvas, canvasToBlob } from './util.js';
import { Layer } from './doc.js';
import { touch } from './history.js';
import { insertLayer, structCmd } from './layers.js';

let T = null;
async function three() {
  if (!T) T = await import('../vendor/three.bundle.js');
  return T;
}

export const defaultScene = () => ({
  v: 1,
  camera: { pos: [0, 1.15, 4.4], target: [0, 0.92, 0], fov: 35 },
  light: { az: 35, el: 50, intensity: 2.4, ambient: 1.1 },
  outline: true, outlineWidth: 0.008,
  objects: [],
});
const figureObject = (x = 0) => ({ id: uid(), kind: 'figure', name: 'Drawing figure', pos: [x, 0, 0], quat: [0, 0, 0, 1], scale: 1, pose: {}, color: '#d8d2c8' });

export function create3DLayer(doc) {
  const l = new Layer(doc.width, doc.height, { type: '3d', name: '3D' });
  l.scene3d = defaultScene();
  l.scene3d.objects.push(figureObject());
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
  rt = { scene: new T.Scene(), camera: new T.PerspectiveCamera(35, 1, 0.02, 200), objs: new Map(), outlineW: { value: 0.008 } };
  rt.hemi = new T.HemisphereLight(0xffffff, 0x8a8478, 1);
  rt.sun = new T.DirectionalLight(0xffffff, 2.4);
  rt.scene.add(rt.hemi, rt.sun);
  runtimes.set(layer, rt);
  for (const o of layer.scene3d.objects) await buildObject(layer, rt, o);
  return rt;
}

async function buildObject(layer, rt, o) {
  let node, joints = null, figMat = null;
  if (o.kind === 'figure') {
    const f = buildFigure(o.color); node = f.root; joints = f.joints; figMat = f.mat;
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
  if (o.kind !== 'prim' || o.prim !== 'floor') addOutlines(node, rt.outlineW);
  rt.scene.add(node);
  const entry = { node, joints, figMat, data: o };
  rt.objs.set(o.id, entry);
  syncObject(entry);
}

function syncObject(e) {
  const o = e.data;
  e.node.position.set(...o.pos);
  e.node.quaternion.set(...o.quat);
  e.node.scale.setScalar(o.scale);
  if (e.joints) applyPose({ joints: e.joints }, o);
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
  root.traverse((c) => {
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
  applySceneSettings(layer, rt, doc);
  const w = Math.max(1, Math.round(doc.width * scale)), hh = Math.max(1, Math.round(doc.height * scale));
  if (!renderer) {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NoToneMapping;
  }
  const max = renderer.capabilities.maxRenderbufferSize || 8192;
  const k = Math.min(1, max / Math.max(w, hh));
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(w * k), Math.round(hh * k), false);
  renderer.setClearColor(0x000000, 0);
  renderer.render(rt.scene, rt.camera);
  const x = layer.canvas.getContext('2d');
  x.clearRect(0, 0, doc.width, doc.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(renderer.domElement, 0, 0, doc.width, doc.height);
  touch(layer.canvas);
  return rt;
}

// ───────── tool ─────────
export function tool3d(app) {
  const t = {
    mode: 'orbit', sel: null, joint: null, busy: false,
    layer() { const it = app.doc && app.doc.activeItem; return it && it.type === '3d' ? it : null; },
    async enter() {
      const L = this.layer();
      if (!L) { toast('Select a 3D layer (Layers › cube button, or Actions › Add › 3D layer)'); return; }
      try { await this.redraw(1); } catch (e) { console.error(e); toast('3D failed to start: ' + e.message); }
    },
    exit() { this.joint = null; const L = this.layer(); if (L && runtimes.get(L)) { this.highlight(null); this.redraw(1); } },
    async redraw(scale = 1) {
      const L = this.layer(); if (!L) return;
      if (this.busy) { this.again = scale; return; }
      this.busy = true;
      try { await render3D(L, app.doc, scale); } finally { this.busy = false; }
      app.requestRender('active');
      if (this.again != null) { const s = this.again; this.again = null; this.redraw(s); }
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
        } else if (this.mode === 'pose' && this.joint && e.joints) {
          const j = e.joints[this.joint];
          const pq = j.parent.getWorldQuaternion(new T.Quaternion());
          const local = pq.clone().invert().multiply(qd).multiply(pq).multiply(j.quaternion);
          o.pose[this.joint] = local.toArray();
        }
        syncObject(e);
      }
      this.redraw(0.5);
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
      const items = [
        ...[['orbit', 'Orbit'], ['pan', 'Pan'], ['zoom', 'Zoom']].map(([m, l]) => cb(l, () => setMode(m), this.mode === m)), sep(),
        ...[['move', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale'], ['pose', 'Pose']].map(([m, l]) => cb(l, () => setMode(m), this.mode === m)), sep(),
        cb('＋ Figure', () => this.addFigure()), cb('＋ Model…', () => this.importModel()), cb('＋ Shape', () => this.shapeMenu()),
        cb('Light…', () => this.lightDialog()),
      ];
      if (this.mode === 'pose') items.push(sep(), h('span', { class: 'three-hint' }, this.joint ? `Joint: ${this.joint} · drag to bend` : 'Tap a body part, then drag'), cb('Poses…', () => this.poseMenu()));
      if (this.sel) items.push(sep(), cb('Delete object', () => this.deleteSel()));
      items.push(sep(), cb('Reset camera', () => { const b = this.snapshot(); L.scene3d.camera = defaultScene().camera; this.commit('Reset camera', b); this.redraw(1); }), cb('Rasterize', () => this.rasterize(), false, 'primary'));
      return items;
    },
    async addObject(o, label) {
      const L = this.layer(); const b = this.snapshot();
      L.scene3d.objects.push(o);
      const rt = await runtimeFor(L); await buildObject(L, rt, o);
      this.sel = o.id; this.commit(label, b); this.redraw(1); app.updateCtxBar();
    },
    addFigure() { const n = this.layer().scene3d.objects.filter((o) => o.kind === 'figure').length; this.addObject(figureObject(n * 0.7), 'Add figure'); },
    shapeMenu() {
      dialog({ title: 'Add shape', body: '', actions: [
        ...[['cube', 'Cube'], ['sphere', 'Sphere'], ['cylinder', 'Cylinder'], ['cone', 'Cone'], ['floor', 'Floor plane']].map(([k, l]) => ({ label: l, onClick: () => this.addObject({ id: uid(), kind: 'prim', prim: k, name: l, pos: [0.8, 0, 0], quat: [0, 0, 0, 1], scale: 1, color: '#cfcac2' }, 'Add ' + l) })),
        { label: 'Cancel', primary: true },
      ] });
    },
    poseMenu() {
      const e = runtimes.get(this.layer()).objs.get(this.sel);
      if (!e || !e.joints) { toast('Tap a figure first'); return; }
      dialog({ title: 'Pose presets', body: '', actions: [
        ...Object.keys(POSES).map((k) => ({ label: k, onClick: () => {
          const b = this.snapshot();
          e.data.pose = Object.fromEntries(Object.entries(POSES[k]).map(([j, eu]) => [j, new T.Quaternion().setFromEuler(new T.Euler(...eu)).toArray()]));
          syncObject(e); this.commit('Pose preset', b); this.redraw(1);
        } })),
        { label: 'Cancel', primary: true },
      ] });
    },
    async importModel() {
      const [f] = await pickFile('.glb,.gltf,.vrm,.fbx,.obj');
      if (!f) return;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['cmo', 'c2fc', 'csfpose'].includes(ext)) { toast("Clip Studio's own 3D files (.cmo) use a closed format — export or download the model as FBX, OBJ or glTF/VRM instead.", 5000); return; }
      if (!['glb', 'gltf', 'vrm', 'fbx', 'obj'].includes(ext)) { toast('Use a .glb / .gltf / .vrm, .fbx or .obj model'); return; }
      const L = this.layer();
      const id = uid();
      L.models.set(id, { id, ext, name: f.name, blob: f });
      toast('Loading ' + f.name + '…', 6000);
      try { await this.addObject({ id: uid(), kind: 'model', modelId: id, name: f.name, pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1 }, 'Import model'); toast('Model added — use Move / Rotate / Scale'); }
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
      const L = this.layer(), s = L.scene3d, b = this.snapshot(), r = () => this.redraw(0.6);
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
        actions: [{ label: 'Done', primary: true }], onClose: () => { if (e) { const o = s.objects.find((x) => x.id === e.data.id); if (o) o.color = e.data.color; } this.commit('3D style', b); this.redraw(1); } });
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
