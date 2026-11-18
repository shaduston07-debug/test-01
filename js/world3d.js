// Weapons (sculpted, can be held by a figure), dystopian cities and landscapes for the 3D library.
import * as S from './sculpt.js';
import { kit3d, buildCar } from './models3d.js';

let T = null;
export function setThree(t) { T = t; S.setThree(t); }
const K = () => kit3d;

// ───────── weapons ─────────
// Authored with the grip at the origin and the business end along +Y (metres). Each part list is
// one material; parts are meshed in workers like the bodies.
const steel = () => K().stdMat('#b9bec4', { metalness: 0.8, roughness: 0.28 });
const darkSteel = () => K().stdMat('#4a4e55', { metalness: 0.6, roughness: 0.4 });
const leather = () => K().stdMat('#4b3121', { roughness: 0.85 });
const wood = () => K().stdMat('#6e4a2c', { roughness: 0.8 });
const gold = () => K().stdMat('#c8a24a', { metalness: 0.85, roughness: 0.3 });
const polymer = () => K().stdMat('#2a2c30', { roughness: 0.6 });
const glow = (c) => new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.3 });
const B = 'w'; // weapons have no bones
const flatBlade = (y0, y1, w0, w1, th, o = {}) => S.cone(B, [0, y0, 0], [0, y1, 0], w0, w1, { sx: th / Math.max(w0, w1), up: [0, 0, 1], ...o });
const rings = (y0, y1, n, r) => Array.from({ length: n }, (_, i) => S.ell(B, [0, y0 + (y1 - y0) * (i + 0.5) / n, 0], [r, (y1 - y0) / n * 0.42, r]));
// a curve of tapered capsules through points (katana blade, bow limbs, magazines)
function curve(pts, r0, r1, o = {}) { return pts.slice(1).map((p, i) => S.cone(B, pts[i], p, r0 + (r1 - r0) * i / (pts.length - 1), r0 + (r1 - r0) * (i + 1) / (pts.length - 1), o)); }

export const WEAPONS = {
  longsword: { label: 'Longsword', grip: 'one', h: 0.003, parts: () => [
    [steel, [S.carve(0.002, S.smooth(0.004, flatBlade(0.16, 1.02, 0.025, 0.004, 0.0045)), S.rbox(B, [0, 0.5, 0], [0.004, 0.3, 0.02], 0.002)),
      S.smooth(0.006, S.cone(B, [-0.11, 0.15, 0], [0.11, 0.15, 0], 0.011, 0.011), S.ell(B, [0.115, 0.155, 0], [0.016, 0.02, 0.014]), S.ell(B, [-0.115, 0.155, 0], [0.016, 0.02, 0.014]), S.ell(B, [0, 0.15, 0], [0.03, 0.02, 0.016])),
      S.ell(B, [0, -0.13, 0], [0.028, 0.024, 0.018])]],
    [leather, [S.smooth(0.004, S.cone(B, [0, -0.11, 0], [0, 0.14, 0], 0.016, 0.015), rings(-0.1, 0.13, 7, 0.0175))]],
  ] },
  katana: { label: 'Katana', grip: 'two', h: 0.0028, parts: () => {
    const pts = Array.from({ length: 7 }, (_, i) => { const t = i / 6; return [0, 0.06 + t * 0.72, -0.04 * t * t]; });
    return [
      [steel, [S.smooth(0.003, curve(pts, 0.016, 0.003, { sx: 0.24, up: [0, 0, 1] }))]],
      [gold, [S.rbox(B, [0, 0.04, -0.002], [0.042, 0.004, 0.036], 0.003), S.ell(B, [0, -0.25, 0], [0.017, 0.012, 0.014])]],
      [leather, [S.smooth(0.003, S.cone(B, [0, -0.25, 0], [0, 0.035, 0], 0.016, 0.015, { sz: 0.8 }), rings(-0.24, 0.03, 9, 0.0168))]],
    ];
  } },
  dagger: { label: 'Dagger', grip: 'one', h: 0.002, parts: () => [
    [steel, [S.carve(0.0015, flatBlade(0.07, 0.32, 0.02, 0.002, 0.004), S.rbox(B, [0, 0.17, 0], [0.003, 0.08, 0.015], 0.0015)), S.cone(B, [-0.05, 0.065, 0], [0.05, 0.065, 0], 0.007, 0.007), S.ell(B, [0, -0.07, 0], [0.016, 0.014, 0.012])]],
    [leather, [S.cone(B, [0, -0.06, 0], [0, 0.06, 0], 0.013, 0.012)]],
  ] },
  axe: { label: 'Battle axe', grip: 'two', h: 0.0045, parts: () => [
    [wood, [S.cone(B, [0, -0.35, 0], [0, 0.55, 0], 0.017, 0.019)]],
    [steel, [S.carve(0.006, S.smooth(0.01, S.ell(B, [0.11, 0.45, 0], [0.12, 0.14, 0.008]), S.rbox(B, [0.03, 0.45, 0], [0.05, 0.05, 0.02], 0.01)), S.ell(B, [0.17, 0.45, 0], [0.07, 0.09, 0.05]), S.ell(B, [0.24, 0.45, 0], [0.04, 0.2, 0.05])),
      S.cone(B, [-0.02, 0.45, 0], [-0.13, 0.43, 0], 0.022, 0.003), S.ell(B, [0, 0.58, 0], [0.022, 0.03, 0.022]), S.ell(B, [0, -0.36, 0], [0.024, 0.02, 0.024])]],
  ] },
  hammer: { label: 'War hammer', grip: 'two', h: 0.0045, parts: () => [
    [wood, [S.cone(B, [0, -0.35, 0], [0, 0.5, 0], 0.017, 0.018)]],
    [darkSteel, [S.rbox(B, [0.02, 0.52, 0], [0.09, 0.055, 0.055], 0.012), S.cone(B, [-0.06, 0.52, 0], [-0.17, 0.5, 0], 0.03, 0.004), S.cone(B, [0, 0.57, 0], [0, 0.66, 0], 0.016, 0.003), S.ell(B, [0, -0.36, 0], [0.024, 0.02, 0.024])]],
  ] },
  spear: { label: 'Spear', grip: 'two', h: 0.0055, parts: () => [
    [wood, [S.cone(B, [0, -0.9, 0], [0, 1.0, 0], 0.016, 0.015)]],
    [steel, [S.smooth(0.004, S.cone(B, [0, 0.98, 0], [0, 1.06, 0], 0.017, 0.014), flatBlade(1.06, 1.32, 0.03, 0.002, 0.006)), S.ell(B, [0, -0.9, 0], [0.018, 0.03, 0.018])]],
  ] },
  shield: { label: 'Kite shield', grip: 'shield', h: 0.007, parts: () => [
    [steel, [S.smooth(0.03, S.ell(B, [0, 0.18, 0.06], [0.26, 0.2, 0.025]), S.tri(B, [-0.24, 0.16, 0.06], [0.24, 0.16, 0.06], [0, -0.42, 0.06], 0.018))]],
    [gold, [S.ell(B, [0, 0.1, 0.085], [0.05, 0.05, 0.02]), S.cone(B, [0, 0.36, 0.08], [0, -0.38, 0.08], 0.01, 0.006), S.cone(B, [-0.2, 0.22, 0.08], [0.2, 0.22, 0.08], 0.01, 0.01)]],
  ] },
  roundshield: { label: 'Round shield', grip: 'shield', h: 0.005, parts: () => [
    [wood, [S.ell(B, [0, 0, 0.06], [0.36, 0.36, 0.02])]],
    [darkSteel, [S.ell(B, [0, 0, 0.08], [0.07, 0.07, 0.04]), S.carve(0.006, S.ell(B, [0, 0, 0.06], [0.385, 0.385, 0.034]), S.ell(B, [0, 0, 0.06], [0.35, 0.35, 0.08]))]],
  ] },
  bow: { label: 'Longbow', grip: 'one', h: 0.0045, parts: () => {
    const limb = (s) => Array.from({ length: 6 }, (_, i) => { const t = i / 5; return [0, s * (0.05 + t * 0.78), -0.12 * t * t + 0.02 * t]; });
    return [
      [wood, [S.smooth(0.004, curve(limb(1), 0.018, 0.007, { sx: 0.6 }), curve(limb(-1), 0.018, 0.007, { sx: 0.6 }), S.cone(B, [0, -0.07, 0.01], [0, 0.07, 0.01], 0.02, 0.02))]],
      [leather, [S.cone(B, [0, -0.06, 0.012], [0, 0.06, 0.012], 0.022, 0.022)]],
      [() => K().stdMat('#e8e2d0', { roughness: 0.6 }), [S.cone(B, [0, 0.82, -0.08], [0, -0.82, -0.08], 0.0018, 0.0018)]],
    ];
  } },
  pistol: { label: 'Pistol', grip: 'one', h: 0.0019, parts: () => [
    [darkSteel, [S.carve(0.001, S.rbox(B, [0, 0.07, 0.07], [0.014, 0.016, 0.095], 0.004), S.cone(B, [0, 0.075, 0.16], [0, 0.075, 0.2], 0.0045, 0.0045)), S.rbox(B, [0, 0.045, 0.06], [0.012, 0.01, 0.08], 0.003)]],
    [polymer, [S.carve(0.002, S.smooth(0.006, S.rbox(B, [0, -0.01, 0.0], [0.015, 0.055, 0.022], 0.007, { rot: [-14, 0, 0] }), S.rbox(B, [0, 0.03, 0.045], [0.012, 0.012, 0.04], 0.006)), S.ell(B, [0, 0.025, 0.045], [0.02, 0.013, 0.017]))]],
  ] },
  rifle: { label: 'Assault rifle', grip: 'rifle', h: 0.0032, parts: () => {
    const mag = Array.from({ length: 5 }, (_, i) => { const t = i / 4; return [0, -0.02 - t * 0.17, 0.12 + t * 0.06 + t * t * 0.02]; });
    return [
      [darkSteel, [S.cone(B, [0, 0.07, 0.3], [0, 0.07, 0.62], 0.008, 0.008), S.cone(B, [0, 0.07, 0.6], [0, 0.07, 0.66], 0.013, 0.013), S.rbox(B, [0, 0.105, 0.12], [0.01, 0.006, 0.12], 0.003)]],
      [polymer, [S.rbox(B, [0, 0.06, 0.12], [0.021, 0.035, 0.17], 0.008), S.smooth(0.008, S.rbox(B, [0, 0.06, 0.38], [0.024, 0.026, 0.1], 0.01), S.rbox(B, [0, 0.03, 0.4], [0.018, 0.012, 0.09], 0.006)),
        S.rbox(B, [0, -0.01, 0.0], [0.015, 0.05, 0.02], 0.007, { rot: [-16, 0, 0] }), S.smooth(0.01, S.rbox(B, [0, 0.05, -0.17], [0.018, 0.04, 0.13], 0.012, { rot: [6, 0, 0] })), S.smooth(0.004, curve(mag, 0.016, 0.016, { sx: 0.6, sz: 1.6 })),
        S.cone(B, [0, 0.135, 0.06], [0, 0.135, 0.2], 0.018, 0.018), S.cone(B, [0, 0.135, 0.04], [0, 0.135, 0.06], 0.022, 0.018)]],
    ];
  } },
  plasma: { label: 'Plasma rifle (sci-fi)', grip: 'rifle', h: 0.0035, parts: () => [
    [() => K().stdMat('#d9dce1', { roughness: 0.35, metalness: 0.15 }), [S.smooth(0.03, S.ell(B, [0, 0.07, 0.15], [0.04, 0.05, 0.22]), S.ell(B, [0, 0.06, 0.42], [0.03, 0.035, 0.12]), S.ell(B, [0, 0.05, -0.14], [0.025, 0.05, 0.12], { rot: [10, 0, 0] })),
      S.rbox(B, [0, -0.01, 0], [0.014, 0.05, 0.02], 0.008, { rot: [-16, 0, 0] })]],
    [() => glow('#38e1ff'), [S.cone(B, [0.033, 0.075, 0.02], [0.03, 0.07, 0.35], 0.004, 0.004), S.cone(B, [-0.033, 0.075, 0.02], [-0.03, 0.07, 0.35], 0.004, 0.004), S.ell(B, [0, 0.06, 0.54], [0.018, 0.018, 0.006])]],
  ] },
  energysword: { label: 'Energy sword', grip: 'one', h: 0.003, parts: () => [
    [() => K().stdMat('#9aa1aa', { metalness: 0.7, roughness: 0.3 }), [S.smooth(0.004, S.cone(B, [0, -0.13, 0], [0, 0.13, 0], 0.018, 0.019), S.ell(B, [0, 0.14, 0], [0.03, 0.012, 0.022])), ...rings(-0.11, 0.1, 6, 0.0195)]],
    [() => glow('#ff3b5c'), [flatBlade(0.15, 1.0, 0.02, 0.006, 0.012)]],
  ] },
};
export async function buildWeapon(kind) {
  const def = WEAPONS[kind]; if (!def) throw new Error('Unknown weapon ' + kind);
  // Blender-finished version (PBR materials) when available, else sculpt it
  const fin = await K().propOr('w-' + kind, () => null);
  if (fin) return { root: fin.root, grip: def.grip };
  const root = new T.Group();
  const list = def.parts();
  const geos = await Promise.all(list.map(([, prims], i) => S.sculptStatic({ key: 'weapon|' + kind + '|' + i, parts: [{ tree: S.union(prims), h: def.h }] })));
  list.forEach(([mat], i) => root.add(new T.Mesh(geos[i], mat())));
  return { root, grip: def.grip };
}
// how a held weapon sits in the hand: local offset in the hand joint (palm down, fingers along ±X
// in the T-pose; a closed fist wraps around an axis along Z)
export function gripTransform(side, grip, handLen) {
  const x = side === 'L' ? 1 : -1;
  const pos = [x * handLen * 0.42, -handLen * 0.1, 0];
  // weapon +Y (blade) → hand +Z (forward out of the fist), its +Z (front) → −Y
  const q = new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0));
  if (grip === 'shield') {
    // strapped to the back of the forearm: top towards the elbow, face outwards (back of the hand)
    // across the forearm like real arm straps: the shield's long axis runs the thumb way
    pos[0] = -x * handLen * 0.85; pos[1] = -0.035; pos[2] = -0.1;
    q.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(-1, 0, 0), new T.Vector3(0, 0, 1), new T.Vector3(0, 1, 0)));
  }
  if (grip === 'rifle') q.setFromEuler(new T.Euler(0, 0, 0));
  return { pos, quat: q.toArray() };
}

// ───────── dystopian cities ─────────
function neonFacadeTex(seed) {
  const { canvasTex, rng } = K();
  const base = canvasTex('cyberFacade' + seed, 256, 256, (x, w, h) => {
    const r = rng(seed); x.fillStyle = '#23262d'; x.fillRect(0, 0, w, h);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) { x.fillStyle = r() < 0.5 ? '#1a1c22' : '#2b2f37'; x.fillRect(i * 32 + 3, j * 16 + 3, 26, 10); }
    x.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 2, h);
  });
  const emi = canvasTex('cyberFacadeE' + seed, 256, 256, (x, w, h) => {
    const r = rng(seed + 9); x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    const cols = ['#7fe9ff', '#ffb36b', '#ff6bd5', '#b7a6ff', '#fff2c4'];
    for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) if (r() < 0.22) { x.fillStyle = cols[Math.floor(r() * cols.length)]; x.globalAlpha = 0.35 + r() * 0.6; x.fillRect(i * 32 + 3, j * 16 + 3, 26, 10); }
    x.globalAlpha = 1;
  });
  return { base, emi };
}
function signTex(seed, color) {
  const { canvasTex, rng } = K();
  return canvasTex('sign' + seed + color, 64, 256, (x, w, h) => {
    const r = rng(seed); x.fillStyle = '#05060a'; x.fillRect(0, 0, w, h);
    x.strokeStyle = color; x.lineWidth = 5; x.shadowColor = color; x.shadowBlur = 8;
    for (let k = 0; k < 4; k++) { // made-up glyphs, stacked vertically
      const cy = 30 + k * 60; x.beginPath();
      for (let s = 0; s < 4; s++) { const a = [10 + r() * 44, cy - 22 + r() * 44], b = [10 + r() * 44, cy - 22 + r() * 44]; x.moveTo(...a); x.lineTo(...b); }
      x.stroke();
    }
    x.strokeRect(4, 4, w - 8, h - 8);
  }, false);
}
const rubbleGeo = (r, p, s, rot) => K().tf(new T.DodecahedronGeometry(1, 0), { p, s: [s[0] * r, s[1] * r, s[2] * r], r: rot });

export function buildDystopia(kind = 'cyber', seed = 21) {
  const { rng, uvBox, box, cyl, tf, Kit, stdMat, canvasTex } = K();
  const root = new T.Group(), joints = { _root: root }, r = rng(seed);
  if (kind === 'cyber') {
    const fac = [0, 1, 2].map((i) => neonFacadeTex(31 + i));
    const mats = {
      ...Object.fromEntries(fac.map((f, i) => ['f' + i, stdMat('#ffffff', { map: f.base, emissiveMap: f.emi, emissive: '#ffffff', emissiveIntensity: 1.1, roughness: 0.6, metalness: 0.2 })])),
      road: stdMat('#1b1d22', { roughness: 0.18, metalness: 0.6 }), walk: stdMat('#30333a', { roughness: 0.6 }), metal: stdMat('#3c4048', { roughness: 0.45, metalness: 0.7 }),
      pipe: stdMat('#595f68', { roughness: 0.4, metalness: 0.7 }), dark: stdMat('#101216', { roughness: 0.8 }),
      pink: new T.MeshStandardMaterial({ color: '#ff2fa8', emissive: '#ff2fa8', emissiveIntensity: 2 }), cyan: new T.MeshStandardMaterial({ color: '#21e6ff', emissive: '#21e6ff', emissiveIntensity: 2 }),
      amber: new T.MeshStandardMaterial({ color: '#ffb02e', emissive: '#ffb02e', emissiveIntensity: 2 }), holo: new T.MeshStandardMaterial({ color: '#7a5cff', emissive: '#5c8bff', emissiveIntensity: 1.4, transparent: true, opacity: 0.75, side: T.DoubleSide }),
    };
    for (const c of ['#ff2fa8', '#21e6ff', '#ffb02e', '#9dff5e']) mats['sign' + c] = new T.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveMap: signTex(Math.floor(r() * 1000), c), emissiveIntensity: 1.6, map: signTex(Math.floor(r() * 1000) + 1, c) });
    const kit = new Kit(joints, mats);
    const L = 180, roadW = 12;
    kit.add('_root', 'road', tf(new T.PlaneGeometry(roadW, L), { r: [-90, 0, 0], p: [0, 0.01, 0] }));
    for (const side of [-1, 1]) {
      kit.add('_root', 'walk', box([side * (roadW / 2 + 2.5), 0.1, 0], [5, 0.2, L]));
      let z = -L / 2;
      while (z < L / 2) {
        const w = 12 + r() * 14, d = 16 + r() * 10, h = 30 + r() * 120, x = side * (roadW / 2 + 5 + d / 2), m = 'f' + Math.floor(r() * 3);
        kit.add('_root', m, uvBox([x, h / 2, z + w / 2], [d, h, w - 0.6], 26, 26));
        // stepped crown, antenna, rooftop gear
        kit.add('_root', 'metal', box([x, h + 2, z + w / 2], [d * 0.6, 4, w * 0.5]));
        if (r() < 0.6) kit.add('_root', 'metal', cyl([x, h + 4 + 8, z + w / 2], 0.2, 0.35, 16, [0, 0, 0], 6));
        // vertical neon signs hanging off the facade, horizontal strips, AC units, pipes
        for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
          const sy = 6 + r() * Math.min(h - 10, 45), sz = z + 1.5 + r() * (w - 3), col = ['#ff2fa8', '#21e6ff', '#ffb02e', '#9dff5e'][Math.floor(r() * 4)];
          const g = box([side * (roadW / 2 + 4.6), sy, sz], [0.4, 6 + r() * 6, 1.6]);
          kit.add('_root', 'sign' + col, g);
          kit.add('_root', 'metal', box([side * (roadW / 2 + 4.95), sy, sz], [0.3, 0.3, 0.3]));
        }
        if (r() < 0.7) kit.add('_root', ['pink', 'cyan', 'amber'][Math.floor(r() * 3)], box([side * (roadW / 2 + 5.05), 4.6 + r() * 2, z + w / 2], [0.15, 0.35, w * 0.8]));
        for (let k = 0; k < 4; k++) kit.add('_root', 'metal', box([side * (roadW / 2 + 5.2), 8 + r() * 30, z + 1 + r() * (w - 2)], [0.9, 0.7, 1.1]));
        kit.add('_root', 'pipe', cyl([side * (roadW / 2 + 5.15), h / 2, z + 0.8], 0.18, 0.18, h, [0, 0, 0], 8));
        z += w;
      }
      // street lamps and steam vents
      for (let z2 = -L / 2 + 6; z2 < L / 2; z2 += 16) {
        kit.add('_root', 'metal', cyl([side * (roadW / 2 + 0.6), 3.5, z2], 0.08, 0.12, 7, [0, 0, 0], 8));
        kit.add('_root', 'metal', box([side * (roadW / 2 - 0.4), 7, z2], [2, 0.12, 0.2]));
        kit.add('_root', 'cyan', box([side * (roadW / 2 - 1.2), 6.9, z2], [0.8, 0.08, 0.3]));
      }
    }
    // skybridges and cables crossing the street, a holographic billboard, hover cars
    for (let i = 0; i < 4; i++) {
      const bz = -60 + i * 38 + r() * 10, by = 18 + r() * 40;
      kit.add('_root', 'metal', box([0, by, bz], [roadW + 12, 2.4, 4]));
      kit.add('_root', ['pink', 'cyan'][i % 2], box([0, by - 1.25, bz + 2.02], [roadW + 12, 0.15, 0.08]));
    }
    for (let i = 0; i < 10; i++) {
      const z0 = -80 + r() * 160, y0 = 9 + r() * 25, sag = 2 + r() * 3;
      const c = new T.QuadraticBezierCurve3(new T.Vector3(-roadW / 2 - 5, y0, z0), new T.Vector3(0, y0 - sag, z0 + (r() - 0.5) * 6), new T.Vector3(roadW / 2 + 5, y0 + (r() - 0.5) * 4, z0 + (r() - 0.5) * 8));
      kit.add('_root', 'dark', new T.TubeGeometry(c, 16, 0.05, 4, false));
    }
    kit.add('_root', 'holo', tf(new T.PlaneGeometry(16, 9), { p: [-roadW / 2 - 4, 34, 20], r: [0, 90, 0] }));
    for (let i = 0; i < 3; i++) {
      const p = [(r() - 0.5) * 6, 14 + r() * 20, -50 + i * 45];
      kit.add('_root', 'metal', tf(new T.CapsuleGeometry(1.1, 3.2, 6, 12), { p, r: [90, 0, 0], s: [1, 1, 0.55] }));
      kit.add('_root', 'amber', box([p[0], p[1] - 0.2, p[2] + 2.5], [1.6, 0.15, 0.1]));
      kit.add('_root', 'pink', box([p[0], p[1] - 0.55, p[2]], [1.4, 0.06, 3]));
    }
    // megastructure at the end of the street
    for (let k = 0; k < 4; k++) kit.add('_root', 'f' + (k % 3), uvBox([0, 60 + k * 70, -L / 2 - 80], [90 - k * 18, 120 + k * 10, 70 - k * 12], 26, 26));
    kit.finish();
    return { root, joints: null };
  }
  // ── ruins: broken towers, exposed rebar, collapsed slabs, rubble, wrecks, dead trees ──
  const crack = canvasTex('ruinRoad', 256, 256, (x, w, h) => {
    const rr = rng(5); x.fillStyle = '#56544f'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) { const g = 70 + rr() * 30; x.fillStyle = `rgb(${g},${g - 2},${g - 6})`; x.fillRect(rr() * w, rr() * h, 2, 2); }
    x.strokeStyle = '#2b2a28'; x.lineWidth = 2;
    for (let k = 0; k < 9; k++) { let px = rr() * w, py = rr() * h; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 8; s++) { px += (rr() - 0.5) * 50; py += (rr() - 0.5) * 50; x.lineTo(px, py); } x.stroke(); }
  });
  const ruinFac = canvasTex('ruinFacade', 256, 256, (x, w, h) => {
    const rr = rng(8); x.fillStyle = '#8f8a80'; x.fillRect(0, 0, w, h);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = rr() < 0.7 ? '#1b1a19' : '#3d3c3a'; x.fillRect(i * 32 + 7, j * 32 + 8, 18, 18); }
    for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(40,35,30,${rr() * 0.3})`; x.fillRect(rr() * w, rr() * h, rr() * 30, rr() * 60); }
  });
  ruinFac.repeat.set(1, 1);
  const mats = { road: stdMat('#ffffff', { map: crack, roughness: 0.95 }), fac: stdMat('#ffffff', { map: ruinFac, roughness: 0.95 }), concrete: stdMat('#8a857c', { roughness: 1 }), rebar: stdMat('#5a3d2c', { roughness: 0.7, metalness: 0.4 }),
    rust: stdMat('#6e4630', { roughness: 0.9, metalness: 0.2 }), dark: stdMat('#2a2826', { roughness: 1 }), deadwood: stdMat('#4a4036', { roughness: 1 }), ground: stdMat('#6d6758', { roughness: 1 }) };
  const kit = new Kit(joints, mats);
  const L = 150, roadW = 11;
  kit.add('_root', 'ground', tf(new T.PlaneGeometry(220, L + 60), { r: [-90, 0, 0], p: [0, -0.01, 0] }));
  kit.add('_root', 'road', tf(new T.PlaneGeometry(roadW, L), { r: [-90, 0, 0], p: [0, 0.02, 0] }));
  const ruin = (x, z, w, d, h) => {
    // floors stacked; the top is broken into ragged columns of different heights
    const keep = h * (0.45 + r() * 0.3);
    kit.add('_root', 'fac', uvBox([x, keep / 2, z], [w, keep, d], 25.6, 27.2));
    const nx = 3 + Math.floor(r() * 3);
    for (let i = 0; i < nx; i++) {
      const cw = w / nx, ch = (h - keep) * r();
      if (ch < 1) continue;
      kit.add('_root', 'fac', uvBox([x - w / 2 + cw * (i + 0.5), keep + ch / 2, z + (r() - 0.5) * d * 0.3], [cw * (0.6 + r() * 0.4), ch, d * (0.4 + r() * 0.6)], 25.6, 27.2));
      for (let k = 0; k < 3; k++) kit.add('_root', 'rebar', cyl([x - w / 2 + cw * (i + r()), keep + ch + 1, z - d / 2 + r() * d], 0.04, 0.04, 2 + r() * 2, [(r() - 0.5) * 30, 0, (r() - 0.5) * 30], 5));
    }
    // a floor slab hanging off, broken edges
    if (r() < 0.6) kit.add('_root', 'concrete', box([x + (r() - 0.5) * w * 0.4, keep + 0.4, z + Math.sign(x) * -d * 0.45], [w * 0.5, 0.35, d * 0.5], [(r() - 0.5) * 40, 0, (r() - 0.5) * 30]));
    for (let k = 0; k < 10; k++) kit.add('_root', 'concrete', rubbleGeo(0.4 + r() * 1.4, [x + (r() - 0.5) * w * 1.2, 0.3, z + (r() - 0.5) * d * 1.2], [1, 0.6, 1], [r() * 90, r() * 90, r() * 90]));
  };
  for (const side of [-1, 1]) {
    let z = -L / 2;
    while (z < L / 2) {
      const w = 12 + r() * 12, d = 14 + r() * 8, h = 15 + r() * 45;
      if (r() < 0.85) ruin(side * (roadW / 2 + 4 + d / 2), z + w / 2, d, w - 1.5, h);
      z += w;
    }
  }
  // rubble heaps across the road, wrecked cars, toppled poles, barriers, dead trees
  for (let i = 0; i < 70; i++) kit.add('_root', 'concrete', rubbleGeo(0.2 + r() * 0.8, [(r() - 0.5) * roadW * 1.4, 0.1, (r() - 0.5) * L], [1, 0.5, 1], [r() * 90, r() * 90, r() * 90]));
  for (let i = 0; i < 6; i++) { // burnt-out cars, skewed
    const car = buildCar(r() < 0.5 ? 'sedan' : 'sports', ['#6e4630', '#4d4a46', '#5b3b2a'][i % 3]).root;
    car.position.set((r() - 0.5) * roadW * 0.7, 0, -60 + i * 24 + r() * 6);
    car.rotation.set((r() - 0.5) * 0.12, r() * Math.PI * 2, (r() - 0.5) * 0.25);
    car.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.roughness = 0.95; m.material.metalness = 0.1; if (m.material.transparent) { m.material.color.set('#151515'); } } });
    root.add(car);
  }
  for (let i = 0; i < 5; i++) kit.add('_root', 'rust', cyl([(r() - 0.5) * roadW, 0.2, -50 + i * 25], 0.1, 0.12, 7, [90, r() * 180, 0], 8));
  for (let i = 0; i < 8; i++) kit.add('_root', 'concrete', box([(i % 2 ? 1 : -1) * (1 + r() * 3), 0.45, -20 + i * 3.2], [2.6, 0.9, 0.6], [0, r() * 40 - 20, 0]));
  for (let i = 0; i < 6; i++) {
    const x = (i % 2 ? 1 : -1) * (roadW / 2 + 1.5), z = -65 + i * 26;
    kit.add('_root', 'deadwood', cyl([x, 2.5, z], 0.12, 0.22, 5, [0, 0, 0], 7));
    for (let b = 0; b < 4; b++) { const a = r() * 360, len = 1.2 + r() * 1.5; kit.add('_root', 'deadwood', cyl([x + Math.cos(a * Math.PI / 180) * len * 0.4, 4 + r() * 1.2, z + Math.sin(a * Math.PI / 180) * len * 0.4], 0.03, 0.07, len, [Math.sin(a) * 50, a, Math.cos(a) * 50], 5)); }
  }
  kit.finish();
  return { root, joints: null };
}

// ───────── landscapes ─────────
function noise2(seed) {
  const { rng } = K(); const r = rng(seed), P = new Float32Array(512);
  for (let i = 0; i < 512; i++) P[i] = r();
  const h = (x, y) => P[((x * 73856093) ^ (y * 19349663)) & 511];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi); const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1); return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; };
}
export function buildLandscape(kind = 'mountains', seed = 4) {
  const { rng, tf, Kit, stdMat } = K();
  const root = new T.Group(), joints = { _root: root }, r = rng(seed), n = noise2(seed);
  const fbm = (x, y, oct = 5) => { let a = 0.5, f = 1, s = 0; for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
  const ridged = (x, y) => { let a = 0.55, f = 1, s = 0; for (let o = 0; o < 5; o++) { s += a * (1 - Math.abs(n(x * f, y * f) * 2 - 1)) ** 2; a *= 0.5; f *= 2.1; } return s; };
  const SIZE = kind === 'desert' ? 360 : 400, SEG = 220;
  const height = (x, z) => {
    const u = x / 60, v = z / 60, centre = Math.min(1, Math.hypot(x, z) / 70);
    if (kind === 'mountains') return (ridged(u * 0.6 + 7, v * 0.6 + 3) * 95 - 18) * (0.12 + centre * 0.88) + fbm(u * 3, v * 3, 3) * 2;
    if (kind === 'forest') return fbm(u * 0.8 + 2, v * 0.8, 5) * 26 - 12 + (centre * 10);
    // desert: long dunes + noise, flatter middle
    return (Math.sin(x * 0.045 + fbm(u, v, 3) * 4) * 0.5 + 0.5) * 9 * (0.3 + centre) + fbm(u * 0.7, v * 0.7, 4) * 10 - 6;
  };
  const g = new T.PlaneGeometry(SIZE, SIZE, SEG, SEG); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const nor = g.attributes.normal, c = new T.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), slope = 1 - nor.getY(i);
    if (kind === 'desert') c.set(slope > 0.25 ? '#b9875a' : '#d9b27c').offsetHSL(0, 0, (n(pos.getX(i) * 0.3, pos.getZ(i) * 0.3) - 0.5) * 0.06);
    else if (kind === 'mountains' && y > 48 - slope * 30) c.set('#f2f4f7');
    else if (slope > 0.3) c.set('#7d776d');
    else c.set(kind === 'forest' ? '#4f6e3a' : '#6c7f48').offsetHSL(0, 0, (n(pos.getX(i) * 0.1, pos.getZ(i) * 0.1) - 0.5) * 0.12);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  const terrain = new T.Mesh(g, stdMat('#ffffff', { vertexColors: true, roughness: 0.95 }));
  root.add(terrain);
  // water in the low ground
  if (kind !== 'desert') root.add(new T.Mesh(tf(new T.PlaneGeometry(SIZE, SIZE), { r: [-90, 0, 0], p: [0, kind === 'mountains' ? -8 : -6, 0] }), new T.MeshStandardMaterial({ color: '#3d6f8f', roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.85 })));
  // trees and rocks, instanced
  const place = (count, ok, make) => {
    const out = [];
    for (let i = 0; i < count * 6 && out.length < count; i++) {
      const x = (r() - 0.5) * SIZE * 0.95, z = (r() - 0.5) * SIZE * 0.95, y = height(x, z);
      const e = 1.5, sl = Math.abs(height(x + e, z) - y) + Math.abs(height(x, z + e) - y);
      if (ok(y, sl / e, x, z)) out.push([x, y, z]);
    }
    make(out);
  };
  const inst = (geo, mat, pts, sc) => {
    const m = new T.InstancedMesh(geo, mat, pts.length), M4 = new T.Matrix4(), q = new T.Quaternion();
    pts.forEach((p, i) => { const s = sc(); q.setFromEuler(new T.Euler(0, r() * Math.PI * 2, 0)); M4.compose(new T.Vector3(...p), q, new T.Vector3(s, s * (0.8 + r() * 0.5), s)); m.setMatrixAt(i, M4); });
    m.computeBoundingSphere(); root.add(m); return m;
  };
  const conifer = (() => { const parts = [tf(new T.CylinderGeometry(0.15, 0.25, 2, 6), { p: [0, 1, 0] })]; for (let k = 0; k < 3; k++) parts.push(tf(new T.ConeGeometry(1.6 - k * 0.4, 2.6, 8), { p: [0, 2.4 + k * 1.4, 0] })); return K().merge(parts.map((p, i) => (p.deleteAttribute('uv'), K().tint(p, i ? '#2f5a35' : '#5a4330')))); })();
  const broadleaf = (() => { const parts = [K().tint(tf(new T.CylinderGeometry(0.18, 0.28, 3, 6), { p: [0, 1.5, 0] }), '#5a4330')]; for (let k = 0; k < 4; k++) parts.push(K().tint(tf(new T.IcosahedronGeometry(1.4, 1), { p: [Math.cos(k * 1.7) * 0.9, 3.6 + (k % 2) * 0.8, Math.sin(k * 1.7) * 0.9] }), '#4f7a36')); parts.forEach((p) => p.deleteAttribute('uv')); return K().merge(parts); })();
  const vmat = stdMat('#ffffff', { vertexColors: true, roughness: 0.9, flatShading: true });
  // lumpy boulder: displace by a noise of the vertex position (shared corners move together)
  const rockGeo = new T.DodecahedronGeometry(1, 1); { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.75 + n(x * 2.3 + 11, z * 2.3 + y * 1.7) * 0.5; p.setXYZ(i, x * k, y * k * 0.65, z * k); } rockGeo.computeVertexNormals(); }
  const rockMat = stdMat(kind === 'desert' ? '#a5734b' : '#807a70', { roughness: 1, flatShading: true });
  if (kind === 'mountains') {
    place(900, (y, sl) => y > -6 && y < 40 && sl < 0.8, (pts) => inst(conifer, vmat, pts, () => 0.9 + r() * 0.9));
    place(160, (y) => y > -7, (pts) => inst(rockGeo, rockMat, pts, () => 0.6 + r() * 2.2));
  } else if (kind === 'forest') {
    place(1400, (y, sl) => y > -5 && sl < 1, (pts) => { inst(conifer, vmat, pts.filter((_, i) => i % 3 === 0), () => 1 + r() * 0.8); inst(broadleaf, vmat, pts.filter((_, i) => i % 3 !== 0), () => 0.9 + r() * 0.7); });
    place(120, (y) => y > -6, (pts) => inst(rockGeo, rockMat, pts, () => 0.5 + r() * 1.4));
  } else {
    place(90, () => true, (pts) => inst(rockGeo, rockMat, pts, () => 0.8 + r() * 2));
    // mesas
    for (let k = 0; k < 5; k++) { const a = r() * Math.PI * 2, d = 80 + r() * 90, x = Math.cos(a) * d, z = Math.sin(a) * d, y = height(x, z); const m = new T.Mesh(tf(new T.CylinderGeometry(10 + r() * 12, 16 + r() * 14, 20 + r() * 30, 9, 3), { p: [x, y + 10, z] }), rockMat); root.add(m); }
    const cactus = K().merge([tf(new T.CapsuleGeometry(0.28, 3, 4, 8), { p: [0, 1.7, 0] }), tf(new T.CapsuleGeometry(0.18, 1.1, 4, 8), { p: [0.55, 2.0, 0] }), tf(new T.CapsuleGeometry(0.18, 0.5, 4, 8), { p: [0.3, 1.45, 0], r: [0, 0, 90] }), tf(new T.CapsuleGeometry(0.16, 0.9, 4, 8), { p: [-0.5, 2.4, 0] }), tf(new T.CapsuleGeometry(0.16, 0.4, 4, 8), { p: [-0.28, 1.95, 0], r: [0, 0, 90] })].map((p) => (p.deleteAttribute('uv'), p)));
    place(140, (y, sl) => sl < 0.5, (pts) => inst(cactus, stdMat('#5f7d3e', { roughness: 0.8 }), pts, () => 0.8 + r() * 0.6));
  }
  return { root, joints: null, height };
}
