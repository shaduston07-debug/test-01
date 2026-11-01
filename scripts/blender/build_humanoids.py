# Builds the humanoid creatures (orc, ghoul) on real anatomy, in Blender (headless):
#   blender -b --factory-startup --python scripts/blender/build_humanoids.py -- <mpfb data dir> <dump dir> <out dir> [kind …]
# The MakeHuman body (CC0) is shaped with its own targets (muscle, weight, proportions, face, ears,
# limb lengths), posed into the creature's rest stance with the artist-made weights (two-bone
# aiming along the creature skeleton from creatures.js, read from the browser dump), scaled to
# its size, given eyes, tusks / claws, and the baked procedural skin (see bakekit). The joint
# names and hierarchy are the creature's own; their positions come from this body and travel in
# the file (scene extras "spec"), so poses and creatureRest keep working.
import bpy, sys, os, json, math
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakekit as K
from bakekit import lin, skin_material
from glbwrite import top4
from mhkit import MH, APP, PARENT, eyeball

argv = sys.argv[sys.argv.index('--') + 1:]
DATA, DUMP, OUT = argv[0], argv[1], argv[2]
KINDS = argv[3:] or ['orc', 'ghoul']
mh = MH(DATA)
NB = mh.NB

SIDE = lambda d, s: {k.replace('#', s.lower() if k.startswith(('ears/', 'eyes/', 'hands/', 'arms/', 'legs/', 'cheek/')) else s):
                     (v.replace('#', s) if isinstance(v, str) else v) for k, v in d.items()}
# creature joint → our MakeHuman joint (per side with #)
COMMON = {'hips': 'pelvis', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head'}
LIMBS = {'clav#': 'clav#', 'shoulder#': 'shoulder#', 'elbow#': 'elbow#', 'hand#': 'hand#', 'hip#': 'hip#', 'knee#': 'knee#', 'foot#': 'foot#', 'toe#': 'toe#',
         'f1#1': 'index#1', 'f1#2': 'index#2', 'f1#3': 'index#3', 'f2#1': 'middle#1', 'f2#2': 'middle#2', 'f2#3': 'middle#3', 'f3#1': 'ring#1', 'f3#2': 'ring#2', 'f3#3': 'ring#3'}

T2 = lambda side_pairs: {**{k: v for s in 'LR' for k, v in SIDE(side_pairs, s).items()}}

RECIPES = {
    'orc': dict(
        macro=(1.0, 1.0, 0.85, 0.15),
        targets={'chin/chin-prognathism-incr': 1.0, 'chin/chin-width-incr': 1.0, 'chin/chin-bones-incr': 0.8, 'chin/chin-height-incr': 0.4,
                 'nose/nose-scale-horiz-incr': 1.0, 'nose/nose-flaring-incr': 1.0, 'nose/nose-volume-incr': 0.6, 'nose/nose-point-up': 0.7, 'nose/nose-compression-compress': 0.5,
                 'nose/nose-scale-vert-decr': 0.5, 'eyebrows/eyebrows-trans-forward': 1.0, 'eyebrows/eyebrows-angle-down': 0.7, 'forehead/forehead-trans-backward': 0.6,
                 'mouth/mouth-scale-horiz-incr': 0.7, 'mouth/mouth-lowerlip-volume-incr': 0.6, 'mouth/mouth-trans-forward': 0.5,
                 'head/head-scale-horiz-incr': 0.4, 'head/head-square': 0.6, 'neck/neck-scale-horiz-incr': 1.0, 'neck/measure-neck-circ-incr': 1.0,
                 'torso/torso-vshape-incr': 0.6, 'torso/torso-muscle-dorsi-incr': 1.0, 'torso/torso-muscle-pectoral-incr': 0.8,
                 'arms/measure-upperarm-length-incr': 0.5, 'arms/measure-lowerarm-length-incr': 0.6,
                 **T2({'ears/#-ear-shape-pointed': 1.0, 'ears/#-ear-scale-incr': 0.9, 'ears/#-ear-wing-incr': 0.8, 'ears/#-ear-trans-up': 0.4,
                       'eyes/#-eye-scale-decr': 0.5, 'hands/#-hand-scale-incr': 1.0, 'hands/#-hand-fingers-diameter-incr': 1.0,
                       'arms/#-upperarm-muscle-incr': 1.0, 'arms/#-lowerarm-muscle-incr': 1.0, 'legs/#-upperleg-muscle-incr': 0.6,
                       'cheek/#-cheek-bones-incr': 0.6})},
        joints={**COMMON, **T2(LIMBS), **T2({'thumb#1': 'thumb#1', 'thumb#2': 'thumb#2'})},
        merge=T2({'pinky#1': 'f3#1', 'pinky#2': 'f3#2', 'pinky#3': 'f3#3', 'thumb#3': 'thumb#2'}),
        eyes=((0.05, 0.03, 0.02), (0.55, 0.32, 0.05), (0.2, 0.1, 0.02), (0.82, 0.74, 0.5)),
        skin=dict(colors=('#5d7a3a', '#1b2610', '#93a865'), pattern=('noise', 6), rough=(0.42, 0.65),
                  detail=[('CLOUDS', dict(noise_scale=0.004, noise_depth=2), 0.0016), ('STUCCI', dict(stucci_type='WALL_IN', noise_scale=0.03, turbulence=4.0), 0.0022)]),
        addon='tusks', size=1024),
    'ghoul': dict(
        macro=(1.0, 0.0, 0.0, 0.2),
        targets={'head/head-age-incr': 1.0, 'nose/nose-volume-decr': 0.6, 'nose/nose-hump-incr': 0.8, 'nose/nose-point-down': 0.5, 'chin/chin-prominent-incr': 0.8,
                 'mouth/mouth-lowerlip-volume-decr': 0.8, 'mouth/mouth-upperlip-volume-decr': 0.8, 'mouth/mouth-scale-horiz-incr': 0.4,
                 'neck/neck-scale-horiz-decr': 1.0, 'neck/measure-neck-circ-decr': 1.0, 'forehead/forehead-temple-decr': 1.0,
                 'arms/measure-upperarm-length-incr': 1.0, 'arms/measure-lowerarm-length-incr': 1.0, 'legs/measure-upperleg-height-incr': 0.3,
                 **T2({'cheek/#-cheek-volume-decr': 1.0, 'cheek/#-cheek-inner-decr': 1.0, 'cheek/#-cheek-bones-incr': 1.0,
                       'ears/#-ear-shape-pointed': 0.8, 'ears/#-ear-scale-incr': 0.4, 'eyes/#-eye-push1-in': 0.6, 'eyes/#-eye-bag-incr': 0.8,
                       'hands/#-hand-fingers-length-incr': 1.0, 'hands/#-hand-scale-incr': 0.6, 'hands/#-hand-fingers-diameter-decr': 0.8,
                       'arms/#-upperarm-muscle-decr': 1.0, 'arms/#-lowerarm-muscle-decr': 1.0, 'legs/#-upperleg-muscle-decr': 0.8, 'legs/#-lowerleg-muscle-decr': 0.8})},
        joints={**COMMON, **T2(LIMBS)},
        merge=T2({'pinky#1': 'f3#1', 'pinky#2': 'f3#2', 'pinky#3': 'f3#3', 'thumb#1': 'hand#', 'thumb#2': 'hand#', 'thumb#3': 'hand#'}),
        eyes=((0.35, 0.36, 0.34), (0.62, 0.66, 0.66), (0.5, 0.52, 0.5), (0.86, 0.85, 0.78)),
        skin=dict(colors=('#8b917c', '#2a2b22', '#c3c4ad'), pattern=('noise', 7), rough=(0.55, 0.8),
                  detail=[('STUCCI', dict(stucci_type='WALL_IN', noise_scale=0.012, turbulence=6.0), 0.0022), ('CLOUDS', dict(noise_scale=0.004, noise_depth=2), 0.001)]),
        addon='claws', size=1024),
}


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(np.dot(a, b))
    if c < -0.9999:
        return -np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def quat(R):
    """rotation matrix → [x, y, z, w]"""
    from mathutils import Matrix
    q = Matrix([list(row) for row in R]).to_quaternion()
    return [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)]


def M4(R=None, t=None):
    m = np.eye(4)
    if R is not None:
        m[:3, :3] = R
    if t is not None:
        m[:3, 3] = t
    return m


def ap(m, p):
    return m[:3, :3] @ p + m[:3, 3]


def cone_mesh(pts, radii, seg=10):
    """a tapered tube through points, closed with a tip"""
    V, F = [], []
    for i, (p, r) in enumerate(zip(pts, radii)):
        d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        d /= np.linalg.norm(d)
        u = np.cross(d, [0, 1, 0] if abs(d[1]) < 0.9 else [1, 0, 0]); u /= np.linalg.norm(u)
        w = np.cross(d, u)
        for k in range(seg):
            a = 2 * math.pi * k / seg
            V.append(p + r * (math.cos(a) * u + math.sin(a) * w))
    tip = len(V); V.append(pts[-1] + (pts[-1] - pts[-2]) * 0.15)
    base = len(V); V.append(pts[0])
    for i in range(len(pts) - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            F += [a, b, b + seg, a, b + seg, a + seg]
    last = (len(pts) - 1) * seg
    for k in range(seg):
        F += [last + k, last + (k + 1) % seg, tip]
        F += [(k + 1) % seg, k, base]
    return np.array(V), np.array(F, dtype=np.uint32)


def build(kind):
    r = RECIPES[kind]
    meta = json.load(open(os.path.join(DUMP, f'cr-{kind}.json')))
    cspec = {s[0]: s for s in meta['spec']}
    cw = lambda n: np.array(cspec[n][2], dtype=float)
    P = mh.shaped(*r['macro'], extra=r['targets'])
    P[:, 1] -= P[:NB, 1].min()
    J, tips = mh.joints_of(P)
    jaw0 = mh.cube('joint-mouth', P)  # MakeHuman's jaw hinge
    mouth0 = mh.cube('joint-jaw', P)  # tip of the chin
    eyes0 = mh.eyes_of(P)
    a2c = {a: c for c, a in r['joints'].items()}
    # ── pose: aim each limb / spine bone along the creature's bone ──
    D = {}
    for n in APP:
        Dp = D[PARENT[n]] if PARENT[n] else np.eye(4)
        D[n] = Dp
        c = a2c.get(n)
        kids = [k for k, s in cspec.items() if s[1] == c] if c else []
        aim = {'spine': 'chest', 'chest': 'neck', 'neck': 'head', 'shoulder': 'elbow', 'elbow': 'hand', 'hip': 'knee', 'knee': 'foot'}
        base = n.rstrip('LR')
        if c and base in aim:
            child_c = aim[base] + (n[-1] if n[-1] in 'LR' else '')
            child_a = r['joints'].get(child_c)
            if child_a and child_c in cspec:
                h, ch = ap(Dp, J[n]), ap(Dp, J[child_a])
                R = rot_between(ch - h, cw(child_c) - cw(c))
                D[n] = M4(t=h) @ M4(R) @ M4(t=-h) @ Dp
    Wb = mh.W
    Jp = {n: ap(D[n], J[n]) for n in APP}
    # scale to the creature's size (its head height in that stance), feet on the floor
    s = cw('head')[1] / Jp['head'][1]
    Jp = {n: p * s for n, p in Jp.items()}
    # The mesh stays in its open A-pose (clean armpits, clean bakes); the skeleton's rest is the
    # creature's stance. bindQ = each joint's local rotation from that stance to the A-pose, so the
    # app binds the mesh there and releases the joints into the stance (as the figures do).
    PA = P[:NB] * s
    jawA, mouthA = jaw0 * s, mouth0 * s
    eyes = {k: (c * s, rr * s) for k, (c, rr) in eyes0.items()}
    tipsA = {n: p * s for n, p in tips.items()}
    JA = {n: p * s for n, p in J.items()}
    # ── creature skeleton from this body ──
    spec, bindq = [], {}
    app_of = lambda c: 'head' if c == 'jaw' else r['joints'][c]
    for name, parent, _ in meta['spec']:
        pos = ap(D['head'], jaw0) * s if name == 'jaw' else Jp[r['joints'][name]]
        spec.append([name, parent, [round(float(x), 5) for x in pos]])
        Rn = D[app_of(name)][:3, :3]
        Rp = D[app_of(parent)][:3, :3] if parent else np.eye(3)
        bindq[name] = quat(Rp @ Rn.T)
    names = [x[0] for x in spec]
    ci = {n: i for i, n in enumerate(names)}
    # ── weights: ours → the creature's joints ──
    amap = {**{a: c for c, a in r['joints'].items()}, **r['merge']}
    Wc = np.zeros((NB, len(names)))
    for j, n in enumerate(APP):
        Wc[:, ci[amap.get(n, a2c.get(n, 'head'))]] += Wb[:, j]
    if 'jaw' in ci:
        wj = mh.default_weights('jaw')
        move = Wc[:, ci['head']] * wj
        Wc[:, ci['head']] -= move
        Wc[:, ci['jaw']] += move
    # ── extra geometry: eyes, tusks / claws (rigid on one joint each) ──
    parts = []  # (P, F, joint, material index)
    for k in 'LR':
        ep, ei, ec = eyeball(*eyes[k], colors=r['eyes'])
        parts.append((ep, ei, 'head', 1, ec))
    ivory = 2
    if r['addon'] == 'tusks':
        # lower canines: from inside the lower lip, up past the upper lip, curving out
        y0, y1 = mouthA[1] + 0.012 * s, mouthA[1] + 0.045 * s  # chin tip → lips
        near = PA[(PA[:, 1] > y0) & (PA[:, 1] < y1) & (np.abs(PA[:, 0]) < 0.01 * s) & (PA[:, 2] > mouthA[2] - 0.02 * s)]
        lip = near[np.argmax(near[:, 2])]  # front of the lower lip
        for x in (1, -1):
            b0 = np.array([x * 0.02 * s, lip[1] - 0.008 * s, lip[2] - 0.017 * s])
            pts = [b0, b0 + np.array([x * 0.003, 0.02, 0.012]) * s, b0 + np.array([x * 0.009, 0.04, 0.016]) * s, b0 + np.array([x * 0.017, 0.056, 0.01]) * s]
            V, F = cone_mesh(np.array(pts), [0.0075 * s, 0.0068 * s, 0.0045 * s, 0.0014 * s])
            parts.append((V, F, 'jaw' if 'jaw' in ci else 'head', ivory, None))
    if r['addon'] == 'claws':
        for k in 'LR':
            for f, cj in (('thumb', 'hand' + k), ('index', 'f1' + k + '3'), ('middle', 'f2' + k + '3'), ('ring', 'f3' + k + '3'), ('pinky', 'f3' + k + '3')):
                tip = tipsA[f + k + '3']
                d = tip - JA[f + k + '3']; d /= np.linalg.norm(d)
                down = np.array([0, -1, 0.0]); bend = down - d * np.dot(down, d)
                bend = bend / (np.linalg.norm(bend) + 1e-9)
                L = 0.04 * s
                pts = [tip - d * 0.012 * s, tip + d * 0.012 * s, tip + d * L * 0.6 + bend * L * 0.12, tip + d * L * 0.95 + bend * L * 0.4]
                V, F = cone_mesh(np.array(pts), [0.0052 * s, 0.0048 * s, 0.003 * s, 0.0008 * s], seg=8)
                parts.append((V, F, cj, ivory, None))
    # ── assemble the runtime mesh: body quads + parts ──
    verts = [PA]
    faces = [tuple(f) for f in mh.BODY]
    mats = [0] * len(faces)
    vcol = [np.ones((NB, 4))]
    Wall = [Wc]
    off = NB
    for V, F, j, mi, col in parts:
        verts.append(V)
        faces += [tuple(int(x) + off for x in F[i:i + 3]) for i in range(0, len(F), 3)]
        mats += [mi] * (len(F) // 3)
        vcol.append(col if col is not None else np.ones((len(V), 4)))
        w = np.zeros((len(V), len(names))); w[:, ci[j]] = 1
        Wall.append(w)
        off += len(V)
    PV = np.concatenate(verts)
    WV = np.concatenate(Wall)
    COL = np.concatenate(vcol)
    K.reset()
    me = bpy.data.meshes.new(kind)
    me.from_pydata([tuple(p) for p in PV], [], faces)
    me.validate()
    for i in range(3):  # slots must exist, or the indices get clamped to 0
        me.materials.append(bpy.data.materials.new(f'slot{i}'))
    for p, m in zip(me.polygons, mats):
        p.material_index = m
        p.use_smooth = True
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', COL.astype(np.float32).reshape(-1))
    low = bpy.data.objects.new(kind + '_low', me)
    bpy.context.scene.collection.objects.link(low)
    K.unwrap(low, margin=0.003)
    high = K.copy_obj(low, kind + '_high')
    K.apply_mod(high, 'SUBSURF', levels=2, render_levels=2)
    for tk, kw, st in r['skin']['detail']:
        K.displace(high, K.tex(tk, **kw), st * s)
    # materials on the high-res copy: skin, eyes (vertex colours, glossy), horn / ivory
    eyem = K.Nodes('eye')
    at = eyem.n('ShaderNodeVertexColor', layer_name='Col')
    eyem.link(at, 'Color', eyem.bsdf, 'Base Color')
    eyem.bsdf.inputs['Roughness'].default_value = 0.08
    iv = K.Nodes('ivory')
    nz = iv.noise(60, detail=4)
    ir = iv.ramp(nz, 'Fac', [(0.3, lin('#a89a78')), (0.7, lin('#e3d8bd'))])
    iv.link(ir, 'Color', iv.bsdf, 'Base Color')
    iv.bsdf.inputs['Roughness'].default_value = 0.35
    for i, m in enumerate((skin_material(r['skin']), eyem.mat, iv.mat)):
        high.data.materials[i] = m
    maps = K.bake_maps(low, high, size=r['size'], extrusion=0.004 * s, name=kind, ao_dist=0.12 * s)
    A = K.export_arrays(low)
    ji, wq = top4(np.tile(np.arange(len(names)), (len(A['src']), 1)), WV[A['src']])
    size = K.write_skinned_glb(os.path.join(OUT, f'creature-{kind}.glb'), kind, A, ji, wq, spec, maps,
                               {'inkwell': 'creature', 'kind': kind, 'joints': names, 'spec': spec, 'bindQ': bindq,
                                'source': 'MakeHuman hm08 base mesh, targets and rig weights (CC0, MPFB2 data), shaped, posed and textured in Blender'})
    print(f'creature-{kind}.glb verts={len(A["pos"])} tris={len(A["idx"]) // 3} bytes={size} scale={s:.3f}')
    # check: the stance skeleton rotated by bindQ must land on the A-pose joints
    from mathutils import Quaternion, Vector
    Wq, Wp = {}, {}
    for name, parent, pos in spec:
        q = Quaternion((bindq[name][3], *bindq[name][:3]))
        if parent:
            off = np.array(pos) - np.array(next(p for n, _, p in spec if n == parent))
            Wp[name] = Wp[parent] + np.array(Wq[parent] @ Vector(off))
            Wq[name] = Wq[parent] @ q
        else:
            Wp[name], Wq[name] = np.array(pos), q
    err = max(np.linalg.norm(Wp[n] - (jawA if n == 'jaw' else JA[r['joints'][n]])) for n in names)
    print(f'  bind check: max joint error {err * 1000:.2f} mm')


for k in KINDS:
    build(k)
