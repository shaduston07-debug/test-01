// Natural human bodies for the 3D figures: about 120 anatomical forms (bones that show under the
// skin, muscle bellies, fat pads, face) per body, blended into one continuous skinned surface by
// sculpt.js. Female and male share one description with different proportions and the build
// slider (slim … athletic). Authored in the T-pose of humanSpec() (facing +Z, figure's left = +X,
// palms down, thumbs forward), meshed in a relaxed A-pose so the shoulders deform well.
import * as S from './sculpt.js';
import { humanSpec, makeJoints, stdMat } from './models3d.js';

let T = null;
export function setThree(t) { T = t; S.setThree(t); }

const lerp = (a, b, t) => a + (b - a) * t;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// bind pose for meshing (local euler degrees, same conventions as the pose library)
const BIND = { shoulderL: [0, 0, -45], shoulderR: [0, 0, 45] };

export function sculptHuman(body, color = '#c9c6c1') {
  const { b, F, H, hd, spec, dims } = humanSpec(body);
  const { hipY, waistY, chestY, neckY, headY, shW, hipW, upArm, foreArm, handL, ankleY, footLen } = dims;
  const fe = F ? 1 : 0;                       // female ↔ male blend
  const bd = b.build;                          // 0 slim … 1 strong
  const mu = 0.86 + bd * 0.32;                 // muscle volume
  const fat = F ? 0.95 + bd * 0.12 : 0.9 + bd * 0.1;
  const u = H, s = H / 1.62;                   // body units / small-detail scale
  const G = (fm, mm) => lerp(mm, fm, fe);      // pick by sex

  const root = new T.Group();
  const { joints, world } = makeJoints(spec, root);
  const W = (n) => world[n].toArray();
  const shY = W('shoulderL')[1];

  const torsoP = [], neckP = [], headP = [], headCut = [], earP = [], earCut = [];
  const arms = { L: [], R: [] }, hands = { L: null, R: null }, legs = { L: [], R: [] }, feet = { L: [], R: [] };
  const wristPlane = {};
  const hu = H / 1.7;

  // ── torso: lofted through measured cross-sections (y, half-width, half-depth, z, bone) ──
  // female 88-68-94 cm at 1.62 m; male V-shaped. Sizes in units of the height.
  const lv = F ? [
    [0.496, 0.034, 0.042, -0.004, 'pelvis'],
    [0.535, 0.093, 0.06, -0.012, 'pelvis'],
    [0.578, 0.089, 0.056, -0.01, 'pelvis'],
    [0.622, 0.076, 0.052, -0.004, 'spine'],
    [0.665, 0.081, 0.058, -0.004, 'spine'],
    [0.715, 0.087, 0.064, -0.006, 'chest'],
    [0.762, 0.09, 0.062, -0.008, 'chest'],
    [0.795, 0.072, 0.048, -0.01, 'chest'],
    [0.802, 0.022, 0.02, -0.012, 'chest'],
  ] : [
    [0.498, 0.034, 0.042, -0.004, 'pelvis'],
    [0.538, 0.09, 0.062, -0.006, 'pelvis'],
    [0.58, 0.087, 0.058, -0.002, 'pelvis'],
    [0.622, 0.083, 0.056, 0.002, 'spine'],
    [0.667, 0.091, 0.062, 0.0, 'spine'],
    [0.718, 0.102, 0.07, -0.004, 'chest'],
    [0.765, 0.108, 0.068, -0.006, 'chest'],
    [0.798, 0.088, 0.052, -0.01, 'chest'],
    [0.806, 0.026, 0.022, -0.012, 'chest'],
  ];
  const bw = 0.94 + bd * 0.12;
  for (let i = 0; i + 1 < lv.length; i++) {
    const [y0, w0, d0, z0, bone] = lv[i], [y1, w1, d1, z1] = lv[i + 1];
    const k = i === 0 || i + 2 === lv.length ? 1 : bw;
    torsoP.push(S.cone(bone, [0, y0 * u, z0 * u], [0, y1 * u, z1 * u], w0 * u * (i === 0 ? 1 : k), w1 * u * (i + 2 === lv.length ? 1 : k), { sx: ((d0 + d1) / (w0 + w1)), up: [0, 0, 1] }));
  }
  for (const [x, sd] of [[1, 'L'], [-1, 'R']]) {
    const tag = { side: sd };
    torsoP.push(
      S.ell('pelvis', [x * 0.044 * u, 0.522 * u, -0.04 * u], [0.05 * u * fat, 0.056 * u, G(0.04, 0.034) * u * fat], { rot: [16, 0, x * 8], tag }),    // glutes
      S.ell('chest', [x * 0.054 * u, 0.762 * u, -0.046 * u], [0.038 * u, 0.04 * u, 0.012 * u], { rot: [0, 0, x * 10], tag }),                          // shoulder blades
    );
    if (F) torsoP.push(S.smooth(0.016 * u, S.ell('chest', [x * 0.047 * u, 0.716 * u, 0.04 * u], [0.037 * u * fat, 0.033 * u * fat, 0.03 * u * fat], { rot: [-4, x * 18, 0], tag }),
      S.ell('chest', [x * 0.044 * u, 0.742 * u, 0.034 * u], [0.034 * u, 0.026 * u, 0.02 * u * fat], { rot: [20, x * 14, 0], tag }))); // breasts (fuller below, sloping above)
    else torsoP.push(S.ell('chest', [x * 0.05 * u, 0.748 * u, 0.044 * u], [0.052 * u * mu, 0.036 * u * mu, 0.024 * u * mu], { rot: [0, x * 12, -x * 10], tag })); // pectorals
  }
  if (!F) torsoP.push(S.ell('spine', [0, 0.635 * u, 0.034 * u], [0.05 * u, 0.06 * u, 0.024 * u * mu])); // abdominals
  const backCut = [];
  // spinal muscles either side of the spine make the groove down the back
  for (const [x, sd] of [[1, 'L'], [-1, 'R']]) torsoP.push(
    S.ell('spine', [x * 0.022 * u, 0.6 * u, -0.05 * u], [0.018 * u, 0.06 * u, 0.012 * u], { tag: { side: sd } }),
    S.ell('chest', [x * 0.02 * u, 0.68 * u, -0.062 * u], [0.015 * u, 0.05 * u, 0.01 * u], { tag: { side: sd } }));
  const navel = S.ell('spine', [0, 0.598 * u, 0.058 * u], [0.004 * u, 0.006 * u, 0.008 * u], { w: false });

  // ── neck, collar bones, trapezius ──
  neckP.push(S.cone('neck', [0, neckY - 0.02 * u, -0.006 * u], [0, headY + 0.12 * hd, -0.03 * hd], G(0.03, 0.035) * u, G(0.028, 0.033) * u, { sx: 0.95, up: [0, 0, 1] }));
  for (const x of [1, -1]) {
    const sd = x > 0 ? 'L' : 'R';
    // sternocleidomastoid: from behind the ear (inside the skull) down to the top of the breastbone
    neckP.push(S.cone('neck', [x * 0.2 * hd, headY + 0.3 * hd, -0.1 * hd], [x * 0.012 * u, neckY - 0.014 * u, 0.026 * u], 0.0075 * u * mu, 0.0072 * u, { tag: { side: null } }));
    torsoP.push(
      S.cone('clav' + sd, [x * 0.02 * u, neckY + 0.008 * u, -0.022 * u], [x * (shW - 0.012 * u), shY + 0.008 * u, -0.012 * u], 0.026 * u * mu, 0.016 * u, { sx: 0.55, up: [0, 1, 0] }), // trapezius
      S.cone('clav' + sd, [x * 0.016 * u, shY + 0.0 * u, 0.04 * u], [x * (shW - 0.008 * u), shY + 0.01 * u, 0.008 * u], 0.0058 * u, 0.0064 * u),                                    // collar bone
    );
  }

  // ── head (finer grid): soft planes of the face, eyes in sockets, nose, lips, ears ──
  const top = headY + 0.96 * hd; // = H
  const Y = (k) => top - k * hd;
  headP.push(
    S.ell('head', [0, Y(0.43), -0.05 * hd], [G(0.322, 0.338) * hd, 0.42 * hd, 0.43 * hd]),                         // cranium
    S.ell('head', [0, Y(0.61), 0.08 * hd], [G(0.238, 0.255) * hd, 0.31 * hd, 0.285 * hd]),                         // face
    S.ell('head', [0, Y(0.79), 0.05 * hd], [G(0.212, 0.238) * hd, 0.13 * hd, 0.262 * hd]),                         // jaw
    S.ell('head', [0, Y(0.9), 0.215 * hd], [G(0.085, 0.105) * hd, 0.065 * hd, 0.085 * hd]),                       // chin
    S.ell('head', [0, Y(0.42), 0.29 * hd], [0.16 * hd, 0.05 * hd, G(0.055, 0.066) * hd]),                          // brow
    S.cone('head', [0, Y(0.48), 0.33 * hd], [0, Y(0.645), 0.42 * hd], 0.022 * hd, 0.033 * hd, { sz: 0.9, up: [0, 0, 1] }), // nose bridge
    S.ell('head', [0, Y(0.655), 0.415 * hd], [0.04 * hd, 0.038 * hd, 0.036 * hd]),                                 // nose tip
    S.ell('head', [0, Y(0.748), 0.33 * hd], [0.072 * hd, G(0.022, 0.019) * hd, 0.03 * hd], { rot: [16, 0, 0] }),  // upper lip
    S.ell('head', [0, Y(0.788), 0.32 * hd], [0.062 * hd, G(0.025, 0.021) * hd, 0.028 * hd], { rot: [-12, 0, 0] }), // lower lip
  );
  for (const x of [1, -1]) {
    headP.push(
      S.ell('head', [x * 0.19 * hd, Y(0.6), 0.15 * hd], [0.075 * hd, 0.06 * hd, 0.1 * hd]),                     // cheekbone
      S.ell('head', [x * 0.044 * hd, Y(0.675), 0.375 * hd], [0.03 * hd, 0.028 * hd, 0.03 * hd]),                // nostril wing
      S.ell('head', [x * 0.125 * hd, Y(0.505), 0.3 * hd], [0.05 * hd, 0.05 * hd, 0.05 * hd]),                   // eyeball
      S.ell('head', [x * 0.125 * hd, Y(0.482), 0.312 * hd], [0.052 * hd, 0.02 * hd, 0.04 * hd], { rot: [-20, 0, 0] }), // upper lid
    );
    headCut.push(S.ell('head', [x * 0.125 * hd, Y(0.5), 0.395 * hd], [0.062 * hd, 0.052 * hd, 0.06 * hd], { w: false })); // eye socket
    earP.push(S.ell('head', [x * 0.318 * hd, Y(0.53), -0.045 * hd], [0.028 * hd, 0.12 * hd, 0.072 * hd], { rot: [0, -x * 22, x * 8] }));
    earCut.push(S.ell('head', [x * 0.342 * hd, Y(0.55), -0.035 * hd], [0.014 * hd, 0.05 * hd, 0.03 * hd], { rot: [0, -x * 22, 0], w: false }));
  }
  const mouthCut = S.ell('head', [0, Y(0.769), 0.365 * hd], [0.066 * hd, 0.004 * hd, 0.022 * hd], { w: false });

  // ── arms ──
  for (const [x, sd] of [[1, 'L'], [-1, 'R']]) {
    const Sh = W('shoulder' + sd), El = W('elbow' + sd), Wr = W('hand' + sd);
    const ax = [x, 0, 0], at = (p, d) => add(p, scl(ax, d));
    const A = arms[sd];
    A.push(
      S.ell('shoulder' + sd, add(Sh, [x * 0.016 * u, 0.004 * u, -0.002 * u]), [0.05 * u, G(0.025, 0.03) * u * mu, G(0.028, 0.034) * u * mu]), // deltoid
      S.cone('shoulder' + sd, at(Sh, -0.004 * u), El, G(0.023, 0.026) * u * mu, G(0.0175, 0.0195) * u),
      S.ell('shoulder' + sd, add(at(Sh, upArm * 0.5), [0, 0.002 * u, 0.008 * u]), [upArm * 0.28, G(0.016, 0.019) * u * mu, G(0.017, 0.021) * u * mu]),  // biceps
      S.ell('shoulder' + sd, add(at(Sh, upArm * 0.4), [0, 0.0, -0.009 * u]), [upArm * 0.34, G(0.018, 0.02) * u * mu, G(0.016, 0.019) * u * mu]),        // triceps
      S.ell('elbow' + sd, add(El, [-x * 0.004 * u, 0, -0.015 * u]), [0.011 * u, 0.01 * u, 0.008 * u]),                                               // elbow point
      S.cone('elbow' + sd, at(El, -0.01 * u), at(El, foreArm * 0.55), G(0.0205, 0.0235) * u * mu, 0.0165 * u, { sz: 1.08 }),
      S.ell('elbow' + sd, add(at(El, foreArm * 0.22), [0, 0.004 * u, 0.007 * u]), [foreArm * 0.28, 0.016 * u * mu, 0.017 * u * mu]),               // forearm muscles
    );
    const lower = S.cone('elbow' + sd, at(El, foreArm * 0.5), Wr, 0.0165 * u, G(0.0132, 0.0148) * u, { sx: 0.74, sz: 1.14 });
    A.push(lower);
    wristPlane[sd] = { p: at(Wr, -0.004 * u), n: [-x, 0, 0] };
    // the hand's wrist stub: the same lower forearm, closed off deep inside the arm 5 cm up, then
    // a hair larger than the arm from 3.5 cm up so it covers the arm's tapering end
    const st0 = at(Wr, -0.05 * u), st1 = at(Wr, -0.035 * u);
    const stub = S.clip(S.grow(S.grow(lower, st0, ax, 0.015 * u, -0.012 * u, 0, 'elbow' + sd), st1, ax, 0.02 * u, 0, 0.0004 * u, 'elbow' + sd), at(st0, -0.004 * u), ax, 'elbow' + sd);

    // ── hand: palm, pads, knuckles, fingers ──
    const palmLen = handL * 0.48, hs = s * G(0.93, 1);
    const fingers = [];
    for (const f of FINGERS) {
      const j1 = W(f + sd + 1), j2 = W(f + sd + 2), j3 = W(f + sd + 3);
      const tip = add(j3, scl(sub3(j3, j2), 0.82));
      const r = { thumb: 0.0102, index: 0.0086, middle: 0.0089, ring: 0.0084, pinky: 0.0073 }[f] * hs;
      const o = { sx: 0.86, up: [0, 1, 0] };
      const segs = f === 'thumb'
        ? [S.cone(f + sd + 1, add(j1, scl(nrm(sub3(j2, j1)), -0.01 * hs)), j2, r * 1.22, r * 1.03, o), S.cone(f + sd + 2, j2, j3, r * 1.0, r * 0.94, o), S.cone(f + sd + 3, j3, tip, r * 0.94, r * 0.78, o)]
        : [S.cone(f + sd + 1, add(j1, [-x * 0.012 * hs, 0, 0]), j2, r * 1.03, r * 0.92, o), S.cone(f + sd + 2, j2, j3, r * 0.9, r * 0.84, o), S.cone(f + sd + 3, j3, tip, r * 0.82, r * 0.7, o)];
      segs.push(S.ell(f + sd + 3, add(mix(j3, tip, 0.55), [0, -r * 0.16, 0]), [len3(sub3(tip, j3)) * 0.42, r * 0.6, r * 0.7], { rot: [0, f === 'thumb' ? -x * 29 : 0, 0] })); // finger pad
      fingers.push(S.smooth(0.0032 * hs, segs));
    }
    const pc = add(Wr, [x * palmLen * 0.54, -0.0012 * u, 0.003 * hs]);
    const palm = [
      S.rbox('hand' + sd, pc, [palmLen * 0.5, 0.011 * hs, 0.032 * hs], 0.009 * hs, { rot: [0, -x * 5, 0] }),
      S.ell('hand' + sd, add(Wr, [x * palmLen * 0.32, -0.006 * hs, 0.017 * hs]), [0.02 * hs, 0.0095 * hs, 0.014 * hs], { rot: [0, -x * 30, 0] }),  // thumb pad
      S.ell('hand' + sd, add(Wr, [x * palmLen * 0.5, -0.005 * hs, -0.018 * hs]), [0.025 * hs, 0.008 * hs, 0.011 * hs]),                         // heel of the hand
    ];
    for (const f of ['index', 'middle', 'ring', 'pinky']) palm.push(S.ell('hand' + sd, add(W(f + sd + 1), [-x * 0.003 * hs, 0.0058 * hs, 0]), [0.008 * hs, 0.006 * hs, 0.008 * hs])); // knuckles
    hands[sd] = S.smooth(0.008 * hs, S.smooth(0.011 * hs, palm, stub), S.union(fingers));

    // ── legs ──
    const Hp = W('hip' + sd), Kn = W('knee' + sd), An = W('foot' + sd), To = W('toe' + sd);
    const L = legs[sd], tag = { side: sd };
    L.push(
      S.cone('hip' + sd, add(Hp, [-x * 0.004 * u, 0.02 * u, -0.006 * u]), add(Kn, [0, 0.01 * u, -0.004 * u]), G(0.05, 0.048) * u * fat, G(0.031, 0.032) * u, { sz: 1.02 }),
      S.ell('hip' + sd, add(mix(Hp, Kn, 0.42), [x * 0.003 * u, 0, 0.018 * u]), [0.034 * u * mu, 0.11 * u, 0.03 * u * mu]),             // quadriceps
      S.ell('hip' + sd, add(Kn, [-x * 0.012 * u, 0.05 * u, 0.012 * u]), [0.016 * u * mu, 0.036 * u, 0.016 * u * mu]),                 // inner knee muscle
      S.ell('hip' + sd, add(mix(Hp, Kn, 0.52), [0, 0, -0.02 * u]), [0.032 * u, 0.1 * u, 0.028 * u * mu]),                             // hamstrings
      S.ell('hip' + sd, add(Hp, [x * 0.014 * u, -0.012 * u, -0.006 * u]), [G(0.024, 0.018) * u * fat, 0.055 * u, 0.034 * u], { tag }), // outer hip
      S.ell('knee' + sd, add(Kn, [0, 0.004 * u, 0.02 * u]), [0.016 * u, 0.019 * u, 0.01 * u]),                                        // kneecap
      S.cone('knee' + sd, add(Kn, [0, 0.008 * u, -0.004 * u]), add(An, [0, 0.012 * u, -0.006 * u]), G(0.029, 0.032) * u, G(0.0165, 0.018) * u, { sz: 1.05 }),
      S.ell('knee' + sd, add(Kn, [-x * 0.009 * u, -0.095 * u, -0.019 * u]), [0.021 * u * mu, 0.07 * u, 0.025 * u * mu]),             // calf (inner head)
      S.ell('knee' + sd, add(Kn, [x * 0.011 * u, -0.085 * u, -0.016 * u]), [0.018 * u * mu, 0.06 * u, 0.021 * u * mu]),              // calf (outer head)
      S.ell('knee' + sd, add(Kn, [x * 0.005 * u, -0.13 * u, 0.011 * u]), [0.014 * u, 0.09 * u, 0.015 * u]),                           // shin muscle
      S.ell('knee' + sd, add(An, [x * 0.0135 * u, 0.003 * u, -0.004 * u]), [0.0065 * u, 0.008 * u, 0.0065 * u], { tag }),            // outer ankle bone
      S.ell('knee' + sd, add(An, [-x * 0.0125 * u, 0.01 * u, 0.0]), [0.007 * u, 0.008 * u, 0.007 * u], { tag }),                     // inner ankle bone
    );
    // foot: heel, instep, ball, toes; flat sole
    const Fo = feet[sd];
    const fs = footLen / (0.15 * u);
    Fo.push(
      S.ell('foot' + sd, add(An, [0, -0.019 * u, -0.024 * u]), [0.018 * u, 0.021 * u, 0.026 * u]),                                     // heel
      S.cone('foot' + sd, add(An, [0, -0.004 * u, 0.006 * u]), add(To, [-x * 0.002 * u, 0.003 * u, -0.012 * u]), 0.021 * u, 0.0125 * u, { sx: 0.78, sz: 1.22, up: [0, 1, 0] }), // instep
      S.ell('foot' + sd, add(To, [-x * 0.002 * u, -0.004 * u, -0.006 * u]), [0.026 * u * fs, 0.012 * u, 0.018 * u]),                 // ball of the foot
      S.ell('foot' + sd, add(An, [x * 0.013 * u, -0.022 * u, 0.04 * u]), [0.01 * u, 0.011 * u, 0.042 * u]),                          // outer edge
      S.ell('toe' + sd, add(To, [-x * 0.014 * u, -0.006 * u, 0.025 * u * fs]), [0.0105 * u, 0.009 * u, 0.02 * u * fs]),              // big toe
      S.ell('toe' + sd, add(To, [x * 0.01 * u, -0.008 * u, 0.016 * u * fs]), [0.019 * u, 0.0072 * u, 0.016 * u * fs], { rot: [0, x * 16, 0] }), // small toes
    );
  }

  // ── blend tree ──
  const legTree = (sd) => S.clip(S.smooth(0.016 * hu, S.smooth(0.02 * hu, legs[sd]), S.smooth(0.01 * hu, feet[sd])), [0, 0.0005 * u, 0], [0, 1, 0], 'foot' + sd);
  // the forearm sinks smoothly inside the hand's wrist stub (no cut edge that could show)
  const armTree = (sd) => S.grow(S.smooth(0.014 * hu, arms[sd]), wristPlane[sd].p, wristPlane[sd].n.map((v) => -v), 0.02 * u, 0, -0.012 * u, 'elbow' + sd);
  const torso = S.carve(0.008 * hu, S.smooth(0.022 * hu, torsoP), navel);
  const neckCutY = neckY + 0.1 * hd;
  const upper = S.smooth(0.024 * hu, torso, S.smooth(0.02 * hu, neckP));
  const bodyTree = S.smooth(0.026 * hu, S.grow(upper, [0, neckCutY, 0], [0, 1, 0], 0.02 * u, 0, -0.022 * u, 'neck'), S.union(armTree('L'), armTree('R')), S.union(legTree('L'), legTree('R')));
  // head: face forms with soft eye sockets, the neck stub that tucks into the body, ears, mouth line
  const st0 = [0, neckCutY - 0.045 * u, 0], st1 = [0, neckCutY - 0.03 * u, 0];
  const neckStub = S.clip(S.grow(S.grow(upper, st0, [0, 1, 0], 0.015 * u, -0.02 * u, 0, 'neck'), st1, [0, 1, 0], 0.025 * u, 0, 0.0004 * u, 'neck'), [0, st0[1] - 0.006 * u, 0], [0, 1, 0], 'neck');
  const face = S.carve(0.05 * hd, S.smooth(0.07 * hd, headP), headCut);
  const dbgHead = globalThis.__headVariant;
  const headFinal = dbgHead === 'stub' ? neckStub : dbgHead === 'face' ? face : S.carve(0.004 * hd, S.smooth(0.012 * hd, S.smooth(0.032 * hd, face, neckStub), S.carve(0.006 * hd, S.smooth(0.02 * hd, earP), earCut)), mouthCut);

  // bind pose → bone motion matrices
  const D = Math.PI / 180;
  for (const [n, e] of Object.entries(BIND)) joints[n].quaternion.setFromEuler(new T.Euler(e[0] * D, e[1] * D, e[2] * D));
  root.updateMatrixWorld(true);
  const mats = {};
  for (const [n, j] of Object.entries(joints)) {
    if (n === '_root') continue;
    const w = world[n];
    mats[n] = j.matrixWorld.clone().multiply(new T.Matrix4().makeTranslation(-w.x, -w.y, -w.z));
  }
  const mat = stdMat(color, { roughness: 0.74 });
  const key = ['human', b.sex, b.height, b.heads, b.build].join('|');
  const parts = [
    { tree: bodyTree, h: 0.0066 * hu, skin: { falloff: 0.42 } },
    { tree: headFinal, h: 0.0031 * hu, skin: { falloff: 0.4 } },
    { tree: hands.L, h: 0.0024 * hu, skin: { falloff: 0.32 }, smooth: 1 },
    { tree: hands.R, h: 0.0024 * hu, skin: { falloff: 0.32 }, smooth: 1 },
  ];
  const mesh = S.sculptSkinned({ key, parts, bones: joints, mats, material: mat, root });
  mesh.name = 'body';
  // back to the T-pose reference: poses are applied on top by the caller
  for (const n of Object.keys(BIND)) joints[n].quaternion.identity();
  root.updateMatrixWorld(true);
  return { root, joints, mat, world, H, mesh };
}
