// Monsters and creatures for the 3D library — each one continuous sculpted, skinned and posable
// (sculpt.js), with its own skeleton, poses and a rest pose. Authored in metres in the bind pose:
// facing +Z, up +Y, the creature's left = +X. Joints are tapped & bent like the human figures.
import * as S from './sculpt.js';
import { makeJoints, stdMat } from './models3d.js';

let T = null;
export function setThree(t) { T = t; S.setThree(t); }

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mx = (p, x) => [p[0] * x, p[1], p[2]]; // mirror a left-side point to side x (1 = left, -1 = right)
const SIDES = [[1, 'L'], [-1, 'R']];

// a chain of joints through points: names prefix1..n
function chain(spec, prefix, parent, pts) {
  pts.forEach((p, i) => spec.push([prefix + (i + 1), i ? prefix + i : parent, p]));
  return pts.map((_, i) => prefix + (i + 1));
}
// tapered capsules along a joint chain (each segment on its own joint)
function limb(P, names, W, radii, o = {}) {
  for (let i = 0; i + 1 < names.length; i++) P.push(S.cone(names[i], W(names[i]), W(names[i + 1]), radii[i], radii[i + 1], o));
}
// a claw / horn: a cone that ends in a point, curving through 3 points
function hook(P, bone, a, b, c, r) {
  P.push(S.cone(bone, a, b, r, r * 0.6), S.cone(bone, b, c, r * 0.6, r * 0.12));
}

// ───────── creature definitions ─────────
// each returns { spec, prims(W) → tree, h (mesh grid), color, rest, poses, info }
const DEFS = {};

// ── Werewolf: hunched, digitigrade legs, wolf head, clawed hands, tail, fur tufts ──
DEFS.werewolf = () => {
  const spec = [
    ['hips', null, [0, 1.06, -0.02]], ['spine', 'hips', [0, 1.3, 0.04]], ['chest', 'spine', [0, 1.54, 0.12]],
    ['neck', 'chest', [0, 1.74, 0.24]], ['head', 'neck', [0, 1.86, 0.34]], ['jaw', 'head', [0, 1.84, 0.4]],
  ];
  for (const [x, s] of SIDES) {
    spec.push(['clav' + s, 'chest', [x * 0.08, 1.66, 0.14]], ['shoulder' + s, 'clav' + s, [x * 0.3, 1.64, 0.1]], ['elbow' + s, 'shoulder' + s, [x * 0.42, 1.3, 0.06]],
      ['hand' + s, 'elbow' + s, [x * 0.5, 0.98, 0.14]]);
    for (const [f, dx, dz] of [['f1', 0.03, 0.05], ['f2', 0.0, 0.0], ['f3', -0.03, -0.045]]) chain(spec, f + s, 'hand' + s, [[x * (0.52 + dx * 0.3), 0.88, 0.16 + dz], [x * (0.53 + dx * 0.3), 0.8, 0.2 + dz]]);
    spec.push(['hip' + s, 'hips', [x * 0.15, 1.0, -0.02]], ['knee' + s, 'hip' + s, [x * 0.18, 0.66, 0.2]], ['hock' + s, 'knee' + s, [x * 0.18, 0.3, -0.12]],
      ['foot' + s, 'hock' + s, [x * 0.18, 0.07, 0.0]], ['toe' + s, 'foot' + s, [x * 0.18, 0.03, 0.14]]);
  }
  chain(spec, 'tail', 'hips', [[0, 1.02, -0.18], [0, 0.94, -0.36], [0, 0.82, -0.52], [0, 0.68, -0.64]]);
  const prims = (W) => {
    const body = [
      S.ell('hips', [0, 1.06, -0.04], [0.17, 0.13, 0.14]),
      S.cone('spine', [0, 1.08, -0.02], [0, 1.44, 0.1], 0.15, 0.2, { sx: 0.82, up: [0, 0, 1] }),  // flank: hips → ribcage
      S.ell('chest', [0, 1.52, 0.12], [0.24, 0.2, 0.2], { rot: [-20, 0, 0] }),
      S.ell('chest', [0, 1.47, 0.24], [0.17, 0.12, 0.07]),                       // pectorals
      S.ell('chest', [0, 1.68, 0.04], [0.21, 0.12, 0.14], { rot: [-25, 0, 0] }), // hunched back
      S.cone('neck', [0, 1.62, 0.16], W('head'), 0.14, 0.11),
      S.ell('neck', [0, 1.74, 0.18], [0.19, 0.15, 0.17]),                       // mane
    ];
    const head = [
      S.ell('head', [0, 1.92, 0.34], [0.11, 0.1, 0.12]),
      S.cone('head', [0, 1.9, 0.4], [0, 1.86, 0.62], 0.075, 0.042, { sx: 0.85, up: [0, 1, 0] }), // snout
      S.ell('head', [0, 1.875, 0.64], [0.03, 0.026, 0.026]),                                     // nose
      S.cone('jaw', [0, 1.83, 0.38], [0, 1.81, 0.58], 0.05, 0.03, { sx: 0.7, up: [0, 1, 0] }),
      S.ell('head', [0, 1.95, 0.42], [0.09, 0.03, 0.05]),                                         // brow
    ];
    for (const [x] of SIDES) {
      head.push(S.cone('head', [x * 0.07, 1.98, 0.3], [x * 0.11, 2.12, 0.26], 0.04, 0.008, { sz: 0.45 })); // ears
      for (const k of [0, 1, 2]) body.push(S.cone('neck', [x * 0.15, 1.78 - k * 0.07, 0.12 + k * 0.03], [x * 0.24, 1.72 - k * 0.08, 0.06 + k * 0.03], 0.05, 0.006)); // mane tufts
    }
    const arms = [], legs = [];
    for (const [x, s] of SIDES) {
      arms.push(
        S.ell('shoulder' + s, add(W('shoulder' + s), [x * 0.02, 0.0, 0]), [0.1, 0.11, 0.1]),
        S.cone('shoulder' + s, W('shoulder' + s), W('elbow' + s), 0.085, 0.06),
        S.ell('shoulder' + s, lerp3(W('shoulder' + s), W('elbow' + s), 0.45), [0.08, 0.13, 0.08]),
        S.cone('elbow' + s, W('elbow' + s), W('hand' + s), 0.07, 0.045),
        S.ell('elbow' + s, lerp3(W('elbow' + s), W('hand' + s), 0.3), [0.07, 0.1, 0.07]),
        S.cone('elbow' + s, add(W('elbow' + s), [0, 0, -0.05]), add(W('elbow' + s), [x * 0.03, -0.02, -0.16]), 0.04, 0.005), // elbow tuft
        S.ell('hand' + s, add(W('hand' + s), [x * 0.02, -0.05, 0.03]), [0.06, 0.07, 0.05]),
      );
      for (const f of ['f1', 'f2', 'f3']) { limb(arms, [f + s + 1, f + s + 2], W, [0.022, 0.018]); hook(arms, f + s + 2, W(f + s + 2), add(W(f + s + 2), [0, -0.05, 0.03]), add(W(f + s + 2), [0, -0.09, 0.0]), 0.014); }
      legs.push(
        S.ell('hip' + s, lerp3(W('hip' + s), W('knee' + s), 0.4), [0.12, 0.2, 0.13], { rot: [-30, 0, 0] }),
        S.cone('hip' + s, W('hip' + s), W('knee' + s), 0.1, 0.07),
        S.cone('knee' + s, W('knee' + s), W('hock' + s), 0.07, 0.04),
        S.ell('knee' + s, lerp3(W('knee' + s), W('hock' + s), 0.3), [0.07, 0.11, 0.08], { rot: [45, 0, 0] }),
        S.cone('hock' + s, W('hock' + s), W('foot' + s), 0.042, 0.035),
        S.ell('foot' + s, add(W('foot' + s), [0, -0.02, 0.06]), [0.065, 0.04, 0.1]),
      );
      for (const dx of [-0.035, 0, 0.035]) hook(legs, 'toe' + s, add(W('toe' + s), [dx, 0, -0.02]), add(W('toe' + s), [dx, -0.005, 0.05]), add(W('toe' + s), [dx, -0.03, 0.08]), 0.014);
    }
    const tail = [];
    limb(tail, ['tail1', 'tail2', 'tail3', 'tail4'], W, [0.06, 0.09, 0.085, 0.03]);
    tail.push(S.ell('tail2', lerp3(W('tail2'), W('tail3'), 0.5), [0.1, 0.1, 0.16], { rot: [-30, 0, 0] }));
    return S.smooth(0.05, S.smooth(0.1, body), S.smooth(0.025, head), S.union(S.smooth(0.04, arms.filter((p) => /L/.test(p.bone))), S.smooth(0.04, arms.filter((p) => /R/.test(p.bone)))),
      S.union(S.smooth(0.05, legs.filter((p) => /L$/.test(p.bone))), S.smooth(0.05, legs.filter((p) => /R$/.test(p.bone)))), S.smooth(0.04, tail));
  };
  return { spec, prims, h: 0.009, color: '#6b625a', rest: { tail1: [-10, 0, 0], tail2: [10, 0, 0], tail3: [10, 0, 0] },
    poses: {
      'Standing': {},
      'Howling': { chest: [-14, 0, 0], neck: [-40, 0, 0], head: [-35, 0, 0], jaw: [25, 0, 0], shoulderL: [0, 0, 25], shoulderR: [0, 0, -25], tail2: [-20, 0, 0] },
      'Prowling': { hips: [30, 0, 0], spine: [20, 0, 0], chest: [20, 0, 0], neck: [-30, 0, 0], head: [-25, 0, 0], shoulderL: [-60, 0, 0], shoulderR: [-60, 0, 0], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0], hipL: [-30, 0, 0], hipR: [-30, 0, 0], kneeL: [30, 0, 0], kneeR: [30, 0, 0], $root: [0, -0.25, 0] },
      'Lunging': { hips: [20, 0, 0], spine: [15, 0, 0], chest: [10, 0, 0], neck: [-25, 0, 0], head: [-15, 0, 0], jaw: [35, 0, 0], shoulderL: [-90, 0, -20], shoulderR: [-70, 0, 30], elbowL: [-10, 0, 0], hipL: [-60, 0, 0], kneeL: [50, 0, 0], hipR: [30, 0, 0], kneeR: [-10, 0, 0], tail1: [20, 0, 0], $root: [0, -0.12, 0.1] },
      'Snarling': { chest: [10, 0, 0], neck: [-10, 0, 0], head: [5, 10, 0], jaw: [30, 0, 0], shoulderL: [-30, 0, -10], shoulderR: [-30, 0, 10], elbowL: [-50, 0, 0], elbowR: [-50, 0, 0] },
    },
    info: 'Werewolf' };
};

// ── Orc brute: massive shoulders, small head with tusks, long arms, big hands ──
DEFS.orc = () => {
  const spec = [
    ['hips', null, [0, 1.12, 0]], ['spine', 'hips', [0, 1.38, 0.02]], ['chest', 'spine', [0, 1.66, 0.04]],
    ['neck', 'chest', [0, 1.98, 0.08]], ['head', 'neck', [0, 2.08, 0.14]], ['jaw', 'head', [0, 2.06, 0.18]],
  ];
  for (const [x, s] of SIDES) {
    spec.push(['clav' + s, 'chest', [x * 0.1, 1.9, 0.04]], ['shoulder' + s, 'clav' + s, [x * 0.42, 1.88, 0.0]], ['elbow' + s, 'shoulder' + s, [x * 0.56, 1.44, -0.02]],
      ['hand' + s, 'elbow' + s, [x * 0.62, 1.04, 0.04]]);
    for (const [f, dz] of [['f1', 0.06], ['f2', 0.0], ['f3', -0.06]]) chain(spec, f + s, 'hand' + s, [[x * 0.64, 0.9, 0.06 + dz], [x * 0.65, 0.8, 0.07 + dz], [x * 0.65, 0.72, 0.08 + dz]]);
    chain(spec, 'thumb' + s, 'hand' + s, [[x * 0.6, 0.98, 0.12], [x * 0.6, 0.9, 0.18]]);
    spec.push(['hip' + s, 'hips', [x * 0.2, 1.06, 0]], ['knee' + s, 'hip' + s, [x * 0.24, 0.6, 0.06]], ['foot' + s, 'knee' + s, [x * 0.25, 0.12, 0]], ['toe' + s, 'foot' + s, [x * 0.25, 0.05, 0.2]]);
  }
  const prims = (W) => {
    const body = [
      S.ell('hips', [0, 1.12, 0], [0.26, 0.17, 0.2]),
      S.ell('spine', [0, 1.38, 0.06], [0.29, 0.25, 0.25]),                 // gut
      S.cone('spine', [0, 1.14, 0], [0, 1.66, 0.02], 0.25, 0.32, { sx: 0.72, up: [0, 0, 1] }),          // flank
      S.ell('chest', [0, 1.7, 0.02], [0.36, 0.26, 0.24]),
      S.ell('chest', [0, 1.72, 0.16], [0.28, 0.14, 0.12]),                 // pecs
      S.ell('chest', [0, 1.92, -0.04], [0.32, 0.12, 0.16]),                // huge traps
      S.cone('neck', [0, 1.9, 0.0], W('head'), 0.16, 0.12),
    ];
    const head = [
      S.ell('head', [0, 2.14, 0.12], [0.12, 0.13, 0.13]),
      S.ell('head', [0, 2.12, 0.23], [0.12, 0.035, 0.05]),                 // heavy brow
      S.ell('head', [0, 2.06, 0.25], [0.04, 0.045, 0.035]),               // nose
      S.ell('jaw', [0, 2.0, 0.17], [0.13, 0.08, 0.14]),                    // big lower jaw
    ];
    for (const [x] of SIDES) {
      head.push(S.cone('jaw', [x * 0.07, 2.0, 0.26], [x * 0.085, 2.1, 0.28], 0.018, 0.004)); // tusks
      head.push(S.cone('head', [x * 0.11, 2.14, 0.06], [x * 0.2, 2.18, 0.0], 0.035, 0.006, { sz: 0.4 }));  // pointed ears
    }
    const arms = [], legs = [];
    for (const [x, s] of SIDES) {
      const A = [
        S.ell('shoulder' + s, W('shoulder' + s), [0.16, 0.15, 0.15]),
        S.cone('shoulder' + s, W('shoulder' + s), W('elbow' + s), 0.13, 0.09),
        S.ell('shoulder' + s, lerp3(W('shoulder' + s), W('elbow' + s), 0.45), [0.12, 0.17, 0.12]),
        S.cone('elbow' + s, W('elbow' + s), W('hand' + s), 0.1, 0.07),
        S.ell('elbow' + s, lerp3(W('elbow' + s), W('hand' + s), 0.3), [0.11, 0.14, 0.1]),
        S.ell('hand' + s, add(W('hand' + s), [x * 0.02, -0.07, 0.04]), [0.07, 0.1, 0.09]),
      ];
      for (const f of ['f1', 'f2', 'f3']) limb(A, [f + s + 1, f + s + 2, f + s + 3], W, [0.035, 0.03, 0.024]);
      limb(A, ['thumb' + s + 1, 'thumb' + s + 2], W, [0.04, 0.03]);
      arms.push(S.smooth(0.04, A));
      legs.push(S.smooth(0.06, [
        S.cone('hip' + s, W('hip' + s), W('knee' + s), 0.17, 0.11),
        S.ell('hip' + s, lerp3(W('hip' + s), W('knee' + s), 0.45), [0.15, 0.22, 0.15]),
        S.cone('knee' + s, W('knee' + s), W('foot' + s), 0.11, 0.075),
        S.ell('knee' + s, add(lerp3(W('knee' + s), W('foot' + s), 0.3), [0, 0, -0.04]), [0.1, 0.16, 0.1]),
        S.ell('foot' + s, add(W('foot' + s), [0, -0.06, 0.08]), [0.1, 0.06, 0.17]),
        S.ell('toe' + s, add(W('toe' + s), [0, -0.02, 0.04]), [0.09, 0.04, 0.07]),
      ]));
    }
    return S.smooth(0.07, S.smooth(0.14, body), S.smooth(0.03, head), S.union(arms), S.union(legs));
  };
  return { spec, prims, h: 0.011, color: '#6f7d58', rest: { shoulderL: [0, 0, -8], shoulderR: [0, 0, 8], elbowL: [0, -12, 0], elbowR: [0, 12, 0] },
    poses: {
      'Standing': {},
      'Roaring': { chest: [-15, 0, 0], neck: [-10, 0, 0], head: [-25, 0, 0], jaw: [30, 0, 0], shoulderL: [0, 0, 50], shoulderR: [0, 0, -50], elbowL: [0, -40, 0], elbowR: [0, 40, 0] },
      'Smash': { spine: [20, 0, 0], chest: [20, 0, 0], shoulderL: [-150, 0, 10], shoulderR: [-150, 0, -10], elbowL: [0, 0, 0], hipL: [-30, 0, 0], kneeL: [40, 0, 0], hipR: [20, 0, 0], kneeR: [20, 0, 0], $root: [0, -0.15, 0] },
      'Charging': { hips: [25, 0, 0], spine: [20, 0, 0], chest: [10, 0, 0], head: [-30, 0, 0], shoulderL: [-50, 0, -20], shoulderR: [40, 0, 20], elbowL: [0, -60, 0], elbowR: [0, 30, 0], hipL: [-70, 0, 0], kneeL: [80, 0, 0], hipR: [30, 0, 0], kneeR: [40, 0, 0], $root: [0, -0.12, 0] },
    },
    info: 'Orc brute' };
};

// ── Demon: athletic body, curled horns, bat wings, spaded tail, hooved digitigrade legs ──
DEFS.demon = () => {
  const spec = [
    ['hips', null, [0, 1.1, 0]], ['spine', 'hips', [0, 1.34, 0.01]], ['chest', 'spine', [0, 1.58, 0.02]],
    ['neck', 'chest', [0, 1.82, 0.03]], ['head', 'neck', [0, 1.92, 0.05]], ['jaw', 'head', [0, 1.9, 0.09]],
  ];
  for (const [x, s] of SIDES) {
    spec.push(['clav' + s, 'chest', [x * 0.06, 1.74, 0.02]], ['shoulder' + s, 'clav' + s, [x * 0.24, 1.74, 0.0]], ['elbow' + s, 'shoulder' + s, [x * 0.5, 1.74, 0.0]],
      ['hand' + s, 'elbow' + s, [x * 0.74, 1.74, 0.0]]);
    for (const [f, dz] of [['f1', 0.03], ['f2', 0.0], ['f3', -0.03]]) chain(spec, f + s, 'hand' + s, [[x * 0.8, 1.74, dz], [x * 0.86, 1.74, dz]]);
    spec.push(['hip' + s, 'hips', [x * 0.12, 1.04, 0]], ['knee' + s, 'hip' + s, [x * 0.14, 0.66, 0.16]], ['hock' + s, 'knee' + s, [x * 0.14, 0.3, -0.1]], ['foot' + s, 'hock' + s, [x * 0.14, 0.06, 0.0]]);
    // wing: arm bone, forearm, three finger spars
    spec.push(['wing' + s, 'chest', [x * 0.1, 1.62, -0.12]], ['wingb' + s, 'wing' + s, [x * 0.5, 1.95, -0.25]], ['wingc' + s, 'wingb' + s, [x * 0.9, 2.05, -0.28]]);
  }
  chain(spec, 'tail', 'hips', [[0, 1.02, -0.12], [0, 0.85, -0.3], [0, 0.6, -0.42], [0, 0.35, -0.48], [0, 0.18, -0.46]]);
  const prims = (W) => {
    const body = [
      S.ell('hips', [0, 1.1, -0.01], [0.15, 0.11, 0.11]),
      S.ell('spine', [0, 1.33, 0.01], [0.13, 0.15, 0.1]),
      S.cone('spine', [0, 1.12, 0], [0, 1.56, 0.0], 0.12, 0.17, { sx: 0.72, up: [0, 0, 1] }),
      S.ell('chest', [0, 1.58, 0.0], [0.19, 0.18, 0.13]),
      S.ell('chest', [0, 1.6, 0.09], [0.15, 0.08, 0.06]),
      S.ell('chest', [0, 1.74, -0.04], [0.17, 0.07, 0.09]),
      S.cone('neck', [0, 1.74, -0.01], W('head'), 0.065, 0.055),
    ];
    for (const [x] of SIDES) body.push(S.ell('spine', [x * 0.04, 1.36, 0.08], [0.035, 0.1, 0.03])); // abs
    const head = [
      S.ell('head', [0, 1.99, 0.03], [0.085, 0.11, 0.1]),
      S.ell('jaw', [0, 1.9, 0.09], [0.07, 0.05, 0.07]),
      S.ell('head', [0, 2.02, 0.11], [0.07, 0.025, 0.035]),
    ];
    for (const [x] of SIDES) { // curled horns
      hook(head, 'head', [x * 0.06, 2.07, 0.06], [x * 0.17, 2.17, -0.02], [x * 0.18, 2.32, 0.08], 0.03);
      head.push(S.cone('head', [x * 0.08, 1.98, 0.0], [x * 0.15, 2.03, -0.04], 0.02, 0.004, { sz: 0.4 })); // ears
    }
    const arms = [], legs = [], wings = [];
    for (const [x, s] of SIDES) {
      const A = [
        S.ell('shoulder' + s, W('shoulder' + s), [0.08, 0.07, 0.07]),
        S.cone('shoulder' + s, W('shoulder' + s), W('elbow' + s), 0.055, 0.04),
        S.ell('shoulder' + s, lerp3(W('shoulder' + s), W('elbow' + s), 0.45), [0.1, 0.05, 0.05]),
        S.cone('elbow' + s, W('elbow' + s), W('hand' + s), 0.045, 0.03),
        S.ell('hand' + s, add(W('hand' + s), [x * 0.035, 0, 0]), [0.045, 0.015, 0.04]),
      ];
      for (const f of ['f1', 'f2', 'f3']) { limb(A, [f + s + 1, f + s + 2], W, [0.012, 0.01]); hook(A, f + s + 2, W(f + s + 2), add(W(f + s + 2), [x * 0.03, -0.005, 0]), add(W(f + s + 2), [x * 0.05, -0.02, 0]), 0.008); }
      arms.push(S.smooth(0.025, A));
      legs.push(S.smooth(0.035, [
        S.cone('hip' + s, W('hip' + s), W('knee' + s), 0.095, 0.06),
        S.ell('hip' + s, lerp3(W('hip' + s), W('knee' + s), 0.4), [0.095, 0.16, 0.1], { rot: [-25, 0, 0] }),
        S.cone('knee' + s, W('knee' + s), W('hock' + s), 0.06, 0.035),
        S.ell('knee' + s, lerp3(W('knee' + s), W('hock' + s), 0.3), [0.05, 0.1, 0.06], { rot: [40, 0, 0] }),
        S.cone('hock' + s, W('hock' + s), W('foot' + s), 0.032, 0.03),
        S.ell('foot' + s, add(W('foot' + s), [0, -0.025, 0.04]), [0.045, 0.035, 0.06]),                 // hoof
      ]));
      // wing: bony spars + membrane panels down to the back
      const r = W('wing' + s), b = W('wingb' + s), c = W('wingc' + s);
      const tips = [[x * 1.25, 1.9, -0.3], [x * 1.1, 1.5, -0.32], [x * 0.75, 1.22, -0.3]];
      const Wg = [S.cone('wing' + s, r, b, 0.035, 0.025), S.cone('wingb' + s, b, c, 0.025, 0.018)];
      hook(Wg, 'wingc' + s, c, add(c, [x * 0.04, 0.06, 0]), add(c, [x * 0.02, 0.12, 0.02]), 0.016); // thumb claw
      for (const t of tips) Wg.push(S.cone('wingc' + s, c, t, 0.016, 0.005));
      const root2 = [x * 0.12, 1.25, -0.16];
      Wg.push(S.tri('wingc' + s, c, tips[0], tips[1], 0.006), S.tri('wingc' + s, c, tips[1], tips[2], 0.006), S.tri('wingb' + s, c, tips[2], b, 0.006), S.tri('wing' + s, b, tips[2], root2, 0.006), S.tri('wing' + s, b, root2, r, 0.006));
      wings.push(S.smooth(0.015, Wg));
    }
    const tail = [];
    limb(tail, ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'], W, [0.04, 0.03, 0.022, 0.016, 0.012]);
    tail.push(S.tri('tail5', add(W('tail5'), [0, 0.02, 0]), add(W('tail5'), [0.07, -0.1, 0.03]), add(W('tail5'), [-0.07, -0.1, 0.03]), 0.012)); // spade
    return S.smooth(0.035, S.smooth(0.07, body), S.smooth(0.02, head), S.union(arms), S.union(legs), S.union(wings), S.smooth(0.02, tail));
  };
  return { spec, prims, h: 0.0075, color: '#8a3a32',
    rest: { shoulderL: [0, 0, -70], shoulderR: [0, 0, 70], elbowL: [0, -15, 0], elbowR: [0, 15, 0], wingL: [0, 30, -10], wingR: [0, -30, 10], wingbL: [0, 30, 0], wingbR: [0, -30, 0], tail2: [15, 0, 0] },
    poses: {
      'Standing': {},
      'Wings spread': { wingL: [0, 0, 10], wingR: [0, 0, -10], wingbL: [0, 0, 0], wingbR: [0, 0, 0], chest: [-8, 0, 0], head: [-10, 0, 0] },
      'Flying': { hips: [60, 0, 0], spine: [10, 0, 0], neck: [-40, 0, 0], head: [-30, 0, 0], wingL: [0, 0, 30], wingR: [0, 0, -30], wingbL: [0, -20, -10], wingbR: [0, 20, 10], hipL: [-20, 0, 0], hipR: [-20, 0, 0], kneeL: [-30, 0, 0], kneeR: [-30, 0, 0], tail1: [-30, 0, 0], $root: [0, 0.6, 0] },
      'Casting': { chest: [-5, -20, 0], head: [-5, -15, 0], shoulderL: [0, 70, -10], elbowL: [0, -20, 0], shoulderR: [0, 30, 40], elbowR: [0, 60, 0], hipL: [-20, 0, 0], kneeL: [25, 0, 0] },
      'Crouching': { hips: [40, 0, 0], spine: [20, 0, 0], chest: [10, 0, 0], neck: [-30, 0, 0], head: [-20, 0, 0], hipL: [-90, 0, 0], hipR: [-90, 0, 0], kneeL: [70, 0, 0], kneeR: [70, 0, 0], wingL: [0, 60, -30], wingR: [0, -60, 30], $root: [0, -0.4, 0] },
    },
    info: 'Demon' };
};

// ── Ghoul: gaunt, hunched, long limbs and claws, ribs, sunken belly, skull-like head ──
DEFS.ghoul = () => {
  const spec = [
    ['hips', null, [0, 0.98, 0]], ['spine', 'hips', [0, 1.2, 0.04]], ['chest', 'spine', [0, 1.42, 0.12]],
    ['neck', 'chest', [0, 1.6, 0.22]], ['head', 'neck', [0, 1.68, 0.3]], ['jaw', 'head', [0, 1.66, 0.33]],
  ];
  for (const [x, s] of SIDES) {
    spec.push(['clav' + s, 'chest', [x * 0.05, 1.54, 0.16]], ['shoulder' + s, 'clav' + s, [x * 0.19, 1.52, 0.14]], ['elbow' + s, 'shoulder' + s, [x * 0.26, 1.18, 0.12]],
      ['hand' + s, 'elbow' + s, [x * 0.3, 0.84, 0.18]]);
    for (const [f, dz] of [['f1', 0.035], ['f2', 0.0], ['f3', -0.035]]) chain(spec, f + s, 'hand' + s, [[x * 0.31, 0.76, 0.2 + dz], [x * 0.32, 0.66, 0.22 + dz], [x * 0.32, 0.57, 0.22 + dz]]);
    spec.push(['hip' + s, 'hips', [x * 0.09, 0.94, 0]], ['knee' + s, 'hip' + s, [x * 0.11, 0.52, 0.06]], ['foot' + s, 'knee' + s, [x * 0.11, 0.07, -0.02]], ['toe' + s, 'foot' + s, [x * 0.11, 0.03, 0.13]]);
  }
  const prims = (W) => {
    const body = [
      S.ell('hips', [0, 0.97, -0.01], [0.12, 0.08, 0.08]),
      S.cone('spine', [0, 1.0, -0.01], [0, 1.32, 0.08], 0.075, 0.095, { sx: 0.72, up: [0, 0, 1] }),   // sunken belly
      S.ell('chest', [0, 1.41, 0.12], [0.14, 0.15, 0.11], { rot: [-25, 0, 0] }),                       // ribcage
      S.ell('chest', [0, 1.5, 0.08], [0.13, 0.06, 0.08], { rot: [-25, 0, 0] }),
      S.cone('neck', [0, 1.5, 0.14], W('head'), 0.042, 0.035),
    ];
    for (const [x, s] of SIDES) body.push(
      S.cone('clav' + s, [x * 0.03, 1.53, 0.2], add(W('shoulder' + s), [0, 0.01, 0]), 0.028, 0.03),        // collar bone / shoulder
      S.ell('shoulder' + s, add(W('shoulder' + s), [x * 0.01, 0, 0]), [0.045, 0.045, 0.042]),
      S.ell('chest', [x * 0.06, 1.48, 0.0], [0.05, 0.06, 0.02], { rot: [-20, 0, x * 10] }));                 // shoulder blades
    const ribCuts = [];
    for (let i = 0; i < 4; i++) for (const [x] of SIDES) // gaps between the ribs
      ribCuts.push(S.ell('chest', [x * 0.12, 1.44 - i * 0.045, 0.17 - i * 0.022], [0.07, 0.007, 0.07], { rot: [-25, 0, x * -18], w: false }));
    const head = [
      S.ell('head', [0, 1.74, 0.3], [0.08, 0.09, 0.1]),
      S.ell('jaw', [0, 1.65, 0.355], [0.062, 0.04, 0.07]),
      S.ell('head', [0, 1.72, 0.385], [0.066, 0.026, 0.03]),
    ];
    const cuts = [];
    for (const [x] of SIDES) { cuts.push(S.ell('head', [x * 0.035, 1.7, 0.4], [0.025, 0.022, 0.03], { w: false })); head.push(S.cone('head', [x * 0.07, 1.72, 0.28], [x * 0.12, 1.78, 0.24], 0.02, 0.004, { sz: 0.4 })); }
    for (const dx of [-0.03, -0.01, 0.01, 0.03]) head.push(S.cone('jaw', [dx, 1.67, 0.41], [dx, 1.69, 0.415], 0.006, 0.002)); // teeth
    const arms = [], legs = [];
    for (const [x, s] of SIDES) {
      const A = [S.cone('shoulder' + s, W('shoulder' + s), W('elbow' + s), 0.035, 0.026), S.ell('elbow' + s, W('elbow' + s), [0.03, 0.03, 0.03]), S.cone('elbow' + s, W('elbow' + s), W('hand' + s), 0.03, 0.02),
        S.ell('hand' + s, add(W('hand' + s), [0, -0.035, 0.01]), [0.03, 0.05, 0.035])];
      for (const f of ['f1', 'f2', 'f3']) { limb(A, [f + s + 1, f + s + 2, f + s + 3], W, [0.011, 0.009, 0.008]); hook(A, f + s + 3, W(f + s + 3), add(W(f + s + 3), [0, -0.04, 0.02]), add(W(f + s + 3), [0, -0.07, -0.01]), 0.007); }
      arms.push(S.smooth(0.018, A));
      legs.push(S.smooth(0.022, [S.cone('hip' + s, W('hip' + s), W('knee' + s), 0.05, 0.035), S.ell('knee' + s, W('knee' + s), [0.035, 0.04, 0.04]), S.cone('knee' + s, W('knee' + s), W('foot' + s), 0.035, 0.022),
        S.ell('foot' + s, add(W('foot' + s), [0, -0.035, 0.06]), [0.035, 0.026, 0.1]), S.ell('toe' + s, add(W('toe' + s), [0, -0.01, 0.0]), [0.04, 0.016, 0.06])]));
    }
    return S.smooth(0.025, S.carve(0.012, S.smooth(0.035, body), ribCuts), S.carve(0.01, S.smooth(0.015, head), cuts), S.union(arms), S.union(legs));
  };
  return { spec, prims, h: 0.006, color: '#9a9a86', rest: { kneeL: [12, 0, 0], kneeR: [12, 0, 0], hipL: [-8, 0, 0], hipR: [-8, 0, 0] },
    poses: {
      'Lurching': {},
      'Reaching': { chest: [10, 0, 0], neck: [-20, 0, 0], shoulderL: [-80, 0, -10], shoulderR: [-70, 0, 10], elbowL: [-10, 0, 0], elbowR: [-20, 0, 0], jaw: [20, 0, 0] },
      'Crawling': { hips: [70, 0, 0], spine: [10, 0, 0], neck: [-50, 0, 0], head: [-30, 0, 0], shoulderL: [-90, 0, 0], shoulderR: [-90, 0, 0], hipL: [-60, 0, 0], hipR: [-60, 0, 0], kneeL: [100, 0, 0], kneeR: [100, 0, 0], $root: [0, -0.55, 0] },
      'Shrieking': { chest: [-15, 0, 0], neck: [-25, 0, 0], head: [-25, 0, 0], jaw: [35, 0, 0], shoulderL: [0, 30, 40], shoulderR: [0, -30, -40], elbowL: [0, -50, 0], elbowR: [0, 50, 0] },
    },
    info: 'Ghoul' };
};

// ── Giant spider: cephalothorax, big abdomen, eight jointed legs, fangs, eyes ──
DEFS.spider = () => {
  const spec = [['body', null, [0, 0.62, 0.15]], ['abdomen', 'body', [0, 0.66, -0.15]], ['fangs', 'body', [0, 0.56, 0.42]]];
  const legAng = [55, 20, -15, -50];
  for (const [x, s] of SIDES) legAng.forEach((a, i) => {
    const r = a * Math.PI / 180, dir = [x * Math.cos(r), 0, Math.sin(r)];
    const base = [x * 0.12, 0.6, 0.15 + Math.sin(r) * 0.08];
    const p1 = add(base, [dir[0] * 0.38, 0.32, dir[2] * 0.38]), p2 = add(base, [dir[0] * 0.78, 0.18, dir[2] * 0.78]), p3 = add(base, [dir[0] * 1.02, -0.6, dir[2] * 1.02]);
    chain(spec, 'leg' + (i + 1) + s, 'body', [base, p1, p2, p3]);
  });
  const prims = (W) => {
    const body = [
      S.ell('body', [0, 0.62, 0.17], [0.2, 0.12, 0.24]),
      S.ell('abdomen', [0, 0.78, -0.42], [0.32, 0.3, 0.4], { rot: [-15, 0, 0] }),
      S.cone('abdomen', [0, 0.64, -0.05], [0, 0.72, -0.15], 0.08, 0.1),
      S.ell('body', [0, 0.66, 0.38], [0.12, 0.09, 0.08]),
    ];
    for (const [x] of SIDES) {
      body.push(S.ell('body', [x * 0.04, 0.72, 0.43], [0.022, 0.022, 0.02]), S.ell('body', [x * 0.08, 0.7, 0.4], [0.016, 0.016, 0.016]), S.ell('body', [x * 0.03, 0.74, 0.38], [0.014, 0.014, 0.014])); // eyes
      hook(body, 'fangs', [x * 0.05, 0.6, 0.44], [x * 0.05, 0.5, 0.5], [x * 0.02, 0.42, 0.46], 0.03);
    }
    const legs = [];
    for (const [x, s] of SIDES) for (let i = 1; i <= 4; i++) {
      const n = ['leg' + i + s + 1, 'leg' + i + s + 2, 'leg' + i + s + 3, 'leg' + i + s + 4], L = [];
      limb(L, n, W, [0.05, 0.04, 0.03, 0.008]);
      L.push(S.ell(n[1], W(n[1]), [0.045, 0.045, 0.045]), S.ell(n[2], W(n[2]), [0.035, 0.035, 0.035]));
      legs.push(S.smooth(0.015, L));
    }
    return S.smooth(0.04, S.smooth(0.06, body), S.union(legs));
  };
  return { spec, prims, h: 0.008, color: '#3b3530', rest: {},
    poses: {
      'Standing': {},
      'Rearing': { body: [-35, 0, 0], abdomen: [35, 0, 0], leg1L1: [-20, 0, 40], leg1R1: [-20, 0, -40], leg2L1: [-10, 0, 20], leg2R1: [-10, 0, -20], fangs: [-20, 0, 0], $root: [0, 0.25, 0] },
      'Crouched': { leg1L1: [0, 0, -20], leg1R1: [0, 0, 20], leg2L1: [0, 0, -20], leg2R1: [0, 0, 20], leg3L1: [0, 0, -20], leg3R1: [0, 0, 20], leg4L1: [0, 0, -20], leg4R1: [0, 0, 20], $root: [0, -0.2, 0] },
    },
    info: 'Giant spider' };
};

// ── Stone golem: blocky boulders, huge fists, glowing-crack style seams ──
DEFS.golem = () => {
  const spec = [['hips', null, [0, 1.25, 0]], ['chest', 'hips', [0, 1.8, 0.05]], ['head', 'chest', [0, 2.35, 0.2]]];
  for (const [x, s] of SIDES) spec.push(['shoulder' + s, 'chest', [x * 0.55, 2.1, 0.05]], ['elbow' + s, 'shoulder' + s, [x * 0.78, 1.55, 0.05]], ['hand' + s, 'elbow' + s, [x * 0.86, 1.0, 0.12]],
    ['hip' + s, 'hips', [x * 0.28, 1.15, 0]], ['knee' + s, 'hip' + s, [x * 0.32, 0.65, 0.04]], ['foot' + s, 'knee' + s, [x * 0.32, 0.14, 0]]);
  const prims = (W) => {
    const rock = [
      S.rbox('hips', [0, 1.25, 0], [0.32, 0.2, 0.24], 0.08, { rot: [0, 4, 3] }),
      S.rbox('chest', [0, 1.85, 0.02], [0.52, 0.36, 0.34], 0.12, { rot: [6, -5, 2] }),
      S.rbox('chest', [0.15, 2.12, -0.1], [0.3, 0.14, 0.24], 0.07, { rot: [10, 20, -8] }),
      S.rbox('chest', [-0.2, 2.1, -0.08], [0.28, 0.16, 0.22], 0.07, { rot: [-8, -15, 10] }),
      S.rbox('head', [0, 2.38, 0.24], [0.15, 0.13, 0.15], 0.05, { rot: [0, 10, 5] }),
      S.rbox('chest', [0, 1.7, 0.3], [0.22, 0.2, 0.1], 0.05, { rot: [-10, 0, 4] }),
    ];
    const cuts = [S.ell('head', [0.06, 2.4, 0.39], [0.03, 0.02, 0.03], { w: false }), S.ell('head', [-0.06, 2.4, 0.39], [0.03, 0.02, 0.03], { w: false })];
    const limbs = [];
    for (const [x, s] of SIDES) limbs.push(S.smooth(0.04, [
      S.rbox('shoulder' + s, add(W('shoulder' + s), [x * 0.05, 0.02, 0]), [0.24, 0.2, 0.22], 0.08, { rot: [5, 0, x * 15] }),
      S.rbox('shoulder' + s, lerp3(W('shoulder' + s), W('elbow' + s), 0.55), [0.15, 0.24, 0.15], 0.06, { rot: [0, 0, x * 20] }),
      S.rbox('elbow' + s, lerp3(W('elbow' + s), W('hand' + s), 0.45), [0.16, 0.26, 0.16], 0.06, { rot: [8, 0, x * 8] }),
      S.rbox('hand' + s, add(W('hand' + s), [0, -0.14, 0.02]), [0.2, 0.17, 0.19], 0.08, { rot: [0, 15, 5] }),
      S.rbox('hip' + s, lerp3(W('hip' + s), W('knee' + s), 0.5), [0.19, 0.27, 0.19], 0.07, { rot: [0, x * 8, 0] }),
      S.rbox('knee' + s, lerp3(W('knee' + s), W('foot' + s), 0.5), [0.17, 0.26, 0.17], 0.06, { rot: [0, -x * 6, 0] }),
      S.rbox('foot' + s, add(W('foot' + s), [0, -0.06, 0.08]), [0.18, 0.09, 0.26], 0.05),
    ]));
    return S.carve(0.02, S.smooth(0.03, S.smooth(0.04, rock), S.union(limbs)), cuts);
  };
  return { spec, prims, h: 0.014, color: '#8d8578', rest: {},
    poses: {
      'Standing': {},
      'Pounding': { chest: [25, 0, 0], shoulderL: [-160, 0, 0], shoulderR: [-160, 0, 0], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0], kneeL: [20, 0, 0], kneeR: [20, 0, 0], hipL: [-20, 0, 0], hipR: [-20, 0, 0], $root: [0, -0.06, 0] },
      'Punching': { chest: [5, -25, 0], shoulderL: [-80, 0, -10], elbowL: [0, 0, 0], shoulderR: [-30, 0, 20], elbowR: [-70, 0, 0], hipL: [-30, 0, 0], kneeL: [25, 0, 0], hipR: [20, 0, 0] },
    },
    info: 'Stone golem' };
};

// ── Kraken: bulbous mantle, big eyes, eight long tentacles ──
DEFS.kraken = () => {
  const spec = [['mantle', null, [0, 1.6, 0]], ['head', 'mantle', [0, 1.1, 0.1]]];
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    const pts = [];
    for (let k = 0; k < 6; k++) { const r = 0.18 + k * 0.32; pts.push([dx * r, 0.85 - Math.min(k, 2) * 0.28 - Math.max(0, k - 2) * 0.04, dz * r]); }
    chain(spec, 'tent' + i + '_', 'head', pts);
  }
  const prims = (W) => {
    const body = [S.ell('mantle', [0, 1.7, -0.15], [0.42, 0.62, 0.45], { rot: [-25, 0, 0] }), S.ell('head', [0, 1.08, 0.08], [0.45, 0.3, 0.42])];
    for (const [x] of SIDES) body.push(S.ell('head', [x * 0.32, 1.18, 0.3], [0.1, 0.11, 0.08]), S.ell('head', [x * 0.35, 1.2, 0.34], [0.07, 0.07, 0.04]));
    const tents = [];
    for (let i = 0; i < 8; i++) {
      const n = Array.from({ length: 6 }, (_, k) => 'tent' + i + '_' + (k + 1)), L = [];
      limb(L, n, W, [0.16, 0.13, 0.1, 0.075, 0.05, 0.015]);
      tents.push(S.smooth(0.03, L));
    }
    return S.smooth(0.12, S.smooth(0.1, body), S.union(tents));
  };
  return { spec, prims, h: 0.013, color: '#7a4a5e',
    rest: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [['tent' + i + '_3', [0, 20, 0]], ['tent' + i + '_4', [0, 25, 0]], ['tent' + i + '_5', [0, 30, 0]]]).flat()),
    poses: {
      'Resting': {},
      'Rising': Object.fromEntries(Array.from({ length: 8 }, (_, i) => [['tent' + i + '_2', [i < 4 ? -40 : -30, 0, 0]], ['tent' + i + '_3', [0, 35, 0]], ['tent' + i + '_4', [0, 40, 0]]]).flat().concat([['$root', [0, 0.4, 0]]])),
      'Attacking': { tent0_1: [-70, 0, 0], tent0_2: [-40, 0, 0], tent7_1: [-70, 0, 0], tent7_2: [-40, 0, 0], tent0_4: [0, -60, 0], tent7_4: [0, 60, 0], mantle: [20, 0, 0] },
    },
    info: 'Kraken' };
};

// ── Xeno: elongated head, ribbed back tubes, thin limbs, digitigrade legs, bladed tail ──
DEFS.xeno = () => {
  const spec = [
    ['hips', null, [0, 1.08, 0]], ['spine', 'hips', [0, 1.3, 0.04]], ['chest', 'spine', [0, 1.52, 0.1]],
    ['neck', 'chest', [0, 1.72, 0.18]], ['head', 'neck', [0, 1.82, 0.26]], ['jaw', 'head', [0, 1.78, 0.32]],
  ];
  for (const [x, s] of SIDES) {
    spec.push(['shoulder' + s, 'chest', [x * 0.18, 1.62, 0.12]], ['elbow' + s, 'shoulder' + s, [x * 0.28, 1.28, 0.06]], ['hand' + s, 'elbow' + s, [x * 0.32, 0.94, 0.12]]);
    for (const [f, dz] of [['f1', 0.03], ['f2', 0.0], ['f3', -0.03]]) chain(spec, f + s, 'hand' + s, [[x * 0.33, 0.86, 0.13 + dz], [x * 0.34, 0.76, 0.14 + dz]]);
    spec.push(['hip' + s, 'hips', [x * 0.1, 1.02, 0]], ['knee' + s, 'hip' + s, [x * 0.13, 0.66, 0.18]], ['hock' + s, 'knee' + s, [x * 0.13, 0.3, -0.12]], ['foot' + s, 'hock' + s, [x * 0.13, 0.05, 0.0]]);
  }
  chain(spec, 'tail', 'hips', [[0, 1.02, -0.15], [0, 0.88, -0.45], [0, 0.66, -0.75], [0, 0.42, -1.0], [0, 0.22, -1.2]]);
  const prims = (W) => {
    const body = [
      S.ell('hips', [0, 1.06, -0.02], [0.15, 0.11, 0.11]),
      S.cone('spine', [0, 1.1, 0], [0, 1.45, 0.08], 0.1, 0.14, { sx: 0.8, up: [0, 0, 1] }),
      S.ell('chest', [0, 1.52, 0.1], [0.19, 0.17, 0.14], { rot: [-20, 0, 0] }),
      S.cone('neck', [0, 1.58, 0.12], W('head'), 0.05, 0.04),
    ];
    for (let i = 0; i < 6; i++) body.push(S.ell(i < 3 ? 'chest' : 'spine', [0, 1.6 - i * 0.08, 0.0 - i * 0.012], [0.05, 0.03, 0.05], { rot: [-20, 0, 0] })); // ribbed spine
    for (const [x, s] of SIDES) {
      body.push(S.ell('chest', [x * 0.08, 1.56, 0.02], [0.07, 0.09, 0.08], { rot: [-20, 0, x * 15] }));        // shoulder carapace
      body.push(S.ell('shoulder' + s, W('shoulder' + s), [0.05, 0.05, 0.05]));
    }
    const head = [
      S.cone('head', [0, 1.8, 0.3], [0, 1.94, -0.12], 0.085, 0.07, { sz: 0.85 }),    // long domed skull
      S.ell('head', [0, 1.8, 0.33], [0.07, 0.06, 0.09]),
      S.ell('jaw', [0, 1.74, 0.36], [0.055, 0.035, 0.08]),
    ];
    const arms = [], legs = [];
    for (const [x, s] of SIDES) {
      const A = [S.cone('shoulder' + s, W('shoulder' + s), W('elbow' + s), 0.05, 0.034), S.ell('shoulder' + s, W('shoulder' + s), [0.06, 0.06, 0.06]), S.ell('elbow' + s, W('elbow' + s), [0.036, 0.04, 0.04]), S.cone('elbow' + s, W('elbow' + s), W('hand' + s), 0.04, 0.024), S.ell('hand' + s, add(W('hand' + s), [0, -0.03, 0.01]), [0.025, 0.04, 0.03])];
      for (const f of ['f1', 'f2', 'f3']) { limb(A, [f + s + 1, f + s + 2], W, [0.01, 0.008]); hook(A, f + s + 2, W(f + s + 2), add(W(f + s + 2), [0, -0.03, 0.01]), add(W(f + s + 2), [0, -0.05, -0.01]), 0.006); }
      arms.push(S.smooth(0.015, A));
      legs.push(S.smooth(0.025, [S.cone('hip' + s, W('hip' + s), W('knee' + s), 0.09, 0.05), S.ell('hip' + s, lerp3(W('hip' + s), W('knee' + s), 0.4), [0.08, 0.15, 0.09], { rot: [-25, 0, 0] }), S.cone('knee' + s, W('knee' + s), W('hock' + s), 0.05, 0.03),
        S.ell('knee' + s, lerp3(W('knee' + s), W('hock' + s), 0.3), [0.05, 0.1, 0.055], { rot: [40, 0, 0] }), S.cone('hock' + s, W('hock' + s), W('foot' + s), 0.03, 0.026),
        S.ell('foot' + s, add(W('foot' + s), [0, -0.02, 0.04]), [0.03, 0.02, 0.07])]));
    }
    const tail = [];
    limb(tail, ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'], W, [0.05, 0.04, 0.03, 0.02, 0.012]);
    tail.push(S.tri('tail5', add(W('tail5'), [0, 0.03, 0.02]), add(W('tail5'), [0, -0.02, -0.2]), add(W('tail5'), [0, -0.06, 0.02]), 0.006));
    return S.smooth(0.025, S.smooth(0.03, body), S.smooth(0.03, head), S.union(arms), S.union(legs), S.smooth(0.02, tail));
  };
  return { spec, prims, h: 0.006, color: '#2e3136', rest: {},
    poses: {
      'Standing': {},
      'Stalking': { hips: [35, 0, 0], spine: [20, 0, 0], chest: [10, 0, 0], neck: [-35, 0, 0], head: [-25, 0, 0], shoulderL: [-50, 0, 0], shoulderR: [-50, 0, 0], hipL: [-30, 0, 0], hipR: [-30, 0, 0], kneeL: [30, 0, 0], kneeR: [30, 0, 0], tail1: [-20, 0, 0], tail2: [-10, 0, 0], $root: [0, -0.2, 0] },
      'Hissing': { chest: [-10, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0], jaw: [35, 0, 0], shoulderL: [0, 30, 40], shoulderR: [0, -30, -40], elbowL: [0, -60, 0], elbowR: [0, 60, 0], tail2: [0, 30, 0], tail3: [-30, 30, 0] },
    },
    info: 'Alien xeno' };
};

// ── Dragon: sculpted body, long neck and tail, horned head, four legs, membrane wings ──
DEFS.dragon = () => {
  const spec = [['d_hip', null, [0, 1.4, -0.6]], ['d_chest', 'd_hip', [0, 1.55, 0.6]]];
  chain(spec, 'd_neck', 'd_chest', [[0, 1.8, 1.1], [0, 2.1, 1.45], [0, 2.45, 1.7], [0, 2.75, 1.9], [0, 2.95, 2.1]]);
  spec.push(['d_head', 'd_neck5', [0, 3.05, 2.3]], ['d_jaw', 'd_head', [0, 2.98, 2.4]]);
  chain(spec, 'd_tail', 'd_hip', [[0, 1.35, -1.1], [0, 1.2, -1.7], [0, 1.0, -2.3], [0, 0.82, -2.9], [0, 0.65, -3.5], [0, 0.5, -4.05], [0, 0.4, -4.55], [0, 0.32, -5.0]]);
  for (const [x, s] of SIDES) {
    spec.push(['d_arm' + s, 'd_chest', [x * 0.42, 1.35, 0.7]], ['d_fore' + s, 'd_arm' + s, [x * 0.5, 0.75, 0.85]], ['d_hand' + s, 'd_fore' + s, [x * 0.52, 0.12, 0.85]],
      ['d_thigh' + s, 'd_hip', [x * 0.48, 1.25, -0.65]], ['d_shin' + s, 'd_thigh' + s, [x * 0.58, 0.72, -0.25]], ['d_foot' + s, 'd_shin' + s, [x * 0.58, 0.18, -0.55]],
      ['d_wing' + s, 'd_chest', [x * 0.32, 2.0, 0.45]], ['d_wingb' + s, 'd_wing' + s, [x * 1.5, 2.6, 0.2]], ['d_wingc' + s, 'd_wingb' + s, [x * 2.8, 2.9, -0.1]]);
  }
  const prims = (W) => {
    const body = [
      S.ell('d_hip', [0, 1.38, -0.55], [0.55, 0.55, 0.75]),
      S.ell('d_chest', [0, 1.5, 0.55], [0.6, 0.62, 0.7]),
      S.ell('d_chest', [0, 1.15, 0.6], [0.45, 0.35, 0.5]),           // belly
    ];
    const neck = [];
    limb(neck, ['d_chest', 'd_neck1', 'd_neck2', 'd_neck3', 'd_neck4', 'd_neck5', 'd_head'], W, [0.45, 0.32, 0.26, 0.22, 0.19, 0.17, 0.16]);
    for (let i = 1; i <= 5; i++) neck.push(S.cone('d_neck' + i, add(W('d_neck' + i), [0, 0.15, -0.08]), add(W('d_neck' + i), [0, 0.32, -0.2]), 0.06, 0.008)); // dorsal spines
    const head = [
      S.ell('d_head', [0, 3.08, 2.32], [0.2, 0.17, 0.25]),
      S.cone('d_head', [0, 3.07, 2.4], [0, 2.98, 2.95], 0.15, 0.08, { sx: 0.75, up: [0, 1, 0] }),   // snout
      S.cone('d_jaw', [0, 2.95, 2.35], [0, 2.86, 2.85], 0.11, 0.05, { sx: 0.6, up: [0, 1, 0] }),
      S.ell('d_head', [0, 3.14, 2.5], [0.17, 0.05, 0.1]),
    ];
    for (const [x] of SIDES) { hook(head, 'd_head', [x * 0.12, 3.18, 2.2], [x * 0.2, 3.3, 1.9], [x * 0.18, 3.5, 1.65], 0.06); head.push(S.ell('d_head', [x * 0.14, 3.13, 2.5], [0.045, 0.035, 0.05])); }
    const legs = [], wings = [];
    for (const [x, s] of SIDES) {
      const L = [];
      limb(L, ['d_arm' + s, 'd_fore' + s, 'd_hand' + s], W, [0.2, 0.13, 0.1]);
      L.push(S.ell('d_arm' + s, lerp3(W('d_arm' + s), W('d_fore' + s), 0.35), [0.2, 0.3, 0.22]), S.ell('d_hand' + s, add(W('d_hand' + s), [0, -0.05, 0.12]), [0.14, 0.08, 0.2]));
      for (const dx of [-0.09, 0, 0.09]) hook(L, 'd_hand' + s, add(W('d_hand' + s), [dx, -0.05, 0.25]), add(W('d_hand' + s), [dx, -0.06, 0.38]), add(W('d_hand' + s), [dx, -0.12, 0.42]), 0.035);
      limb(L, ['d_thigh' + s, 'd_shin' + s, 'd_foot' + s], W, [0.32, 0.17, 0.12]);
      L.push(S.ell('d_thigh' + s, lerp3(W('d_thigh' + s), W('d_shin' + s), 0.3), [0.3, 0.42, 0.38], { rot: [-30, 0, 0] }), S.ell('d_foot' + s, add(W('d_foot' + s), [0, -0.08, 0.2]), [0.16, 0.09, 0.28]));
      for (const dx of [-0.1, 0, 0.1]) hook(L, 'd_foot' + s, add(W('d_foot' + s), [dx, -0.08, 0.4]), add(W('d_foot' + s), [dx, -0.08, 0.55]), add(W('d_foot' + s), [dx, -0.16, 0.6]), 0.04);
      legs.push(S.smooth(0.06, L));
      const r = W('d_wing' + s), b = W('d_wingb' + s), c = W('d_wingc' + s);
      const tips = [[x * 4.1, 2.6, -0.5], [x * 3.6, 1.6, -0.9], [x * 2.6, 1.15, -1.0], [x * 1.4, 1.35, -0.8]];
      const Wg = [S.cone('d_wing' + s, r, b, 0.12, 0.08), S.cone('d_wingb' + s, b, c, 0.08, 0.05)];
      hook(Wg, 'd_wingc' + s, c, add(c, [x * 0.1, 0.15, 0.05]), add(c, [x * 0.05, 0.28, 0.1]), 0.04);
      for (const t of tips.slice(0, 3)) Wg.push(S.cone('d_wingc' + s, c, t, 0.05, 0.015));
      const th = 0.018;
      Wg.push(S.tri('d_wingc' + s, c, tips[0], tips[1], th), S.tri('d_wingc' + s, c, tips[1], tips[2], th), S.tri('d_wingb' + s, c, tips[2], tips[3], th), S.tri('d_wingb' + s, c, tips[3], b, th), S.tri('d_wing' + s, b, tips[3], [x * 0.4, 1.6, -0.5], th), S.tri('d_wing' + s, b, [x * 0.4, 1.6, -0.5], r, th));
      wings.push(S.smooth(0.03, Wg));
    }
    const tail = [];
    limb(tail, ['d_hip', 'd_tail1', 'd_tail2', 'd_tail3', 'd_tail4', 'd_tail5', 'd_tail6', 'd_tail7', 'd_tail8'], W, [0.5, 0.36, 0.28, 0.21, 0.16, 0.12, 0.09, 0.06, 0.035]);
    for (let i = 1; i <= 7; i++) tail.push(S.cone('d_tail' + i, add(W('d_tail' + i), [0, 0.18 - i * 0.015, 0]), add(W('d_tail' + i), [0, 0.34 - i * 0.03, -0.12]), 0.06 - i * 0.005, 0.008));
    tail.push(S.tri('d_tail8', add(W('d_tail8'), [0, 0.12, 0.1]), add(W('d_tail8'), [0, 0.0, -0.35]), add(W('d_tail8'), [0, -0.1, 0.1]), 0.02));
    return S.smooth(0.08, S.smooth(0.15, body), S.smooth(0.06, neck), S.smooth(0.05, head), S.union(legs), S.union(wings), S.smooth(0.05, tail));
  };
  return { spec, prims, h: 0.022, color: '#5e7366',
    rest: { d_wingL: [0, 40, -20], d_wingR: [0, -40, 20], d_wingbL: [0, 50, 0], d_wingbR: [0, -50, 0], d_tail3: [0, 8, 0], d_tail5: [0, 12, 0], d_tail7: [0, 12, 0] },
    poses: {
      'Standing': {},
      'Roaring': { d_chest: [-12, 0, 0], d_neck1: [-15, 0, 0], d_neck2: [-10, 0, 0], d_neck4: [10, 0, 0], d_neck5: [20, 0, 0], d_head: [-25, 0, 0], d_jaw: [35, 0, 0], d_wingL: [0, 0, 25], d_wingR: [0, 0, -25], d_wingbL: [0, 10, 0], d_wingbR: [0, -10, 0] },
      'Flying': { d_wingL: [0, 0, 20], d_wingR: [0, 0, -20], d_wingbL: [0, 0, -10], d_wingbR: [0, 0, 10], d_armL: [50, 0, 0], d_armR: [50, 0, 0], d_foreL: [-80, 0, 0], d_foreR: [-80, 0, 0], d_thighL: [60, 0, 0], d_thighR: [60, 0, 0], d_shinL: [-40, 0, 0], d_shinR: [-40, 0, 0], d_neck1: [10, 0, 0], d_neck2: [10, 0, 0], d_head: [10, 0, 0], $root: [0, 2.0, 0] },
      'Wings folded': {},
      'Perched': { d_hip: [-30, 0, 0], d_chest: [-20, 0, 0], d_neck1: [30, 0, 0], d_neck3: [10, 0, 0], d_head: [25, 0, 0], d_thighL: [-30, 0, 0], d_thighR: [-30, 0, 0], d_shinL: [40, 0, 0], d_shinR: [40, 0, 0], d_armL: [10, 0, 0], d_armR: [10, 0, 0], d_wingL: [0, 30, -10], d_wingR: [0, -30, 10], d_tail1: [20, 0, 0], d_tail3: [0, 25, 0], d_tail5: [0, 30, 0], $root: [0, -0.3, 0] },
      'Curled': { d_neck1: [10, 40, 0], d_neck2: [5, 30, 0], d_neck3: [5, 30, 0], d_head: [20, 20, 0], d_tail1: [0, -30, 0], d_tail2: [0, -30, 0], d_tail3: [0, -35, 0], d_tail4: [0, -35, 0], d_tail5: [0, -30, 0], d_thighL: [-60, 0, 0], d_thighR: [-60, 0, 0], d_shinL: [90, 0, 0], d_shinR: [90, 0, 0], d_armL: [-40, 0, 0], d_armR: [-40, 0, 0], d_foreL: [60, 0, 0], d_foreR: [60, 0, 0], $root: [0, -0.6, 0] },
    },
    info: 'Dragon' };
};

export const CREATURES = Object.keys(DEFS);
const defCache = {};
export function creatureDef(kind) { return (defCache[kind] ||= DEFS[kind] && DEFS[kind]()); }
export const creaturePoses = (kind) => (creatureDef(kind) || {}).poses || {};
export const creatureRest = (kind) => (creatureDef(kind) || {}).rest || {};

export async function buildCreature(kind, color) {
  const def = creatureDef(kind);
  if (!def) throw new Error('Unknown creature ' + kind);
  const root = new T.Group();
  const { joints, world } = makeJoints(def.spec, root);
  const W = (n) => world[n].toArray();
  const tree = def.prims(W);
  root.updateMatrixWorld(true);
  const boneNames = Object.keys(joints).filter((n) => n !== '_root');
  const geo = await S.sculptGeometry({ key: 'creature|' + kind, parts: [{ tree, h: def.h, skin: { falloff: 0.45, maxDist: def.h * 16, maxS: def.h * 4 } }], mats: null, boneNames });
  const mat = stdMat(color || def.color, { roughness: 0.7 });
  const mesh = S.bindSkinned(geo, joints, mat, root);
  mesh.name = kind;
  return { root, joints, mat, world, H: 1, mesh, kind };
}
