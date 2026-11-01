# MakeHuman data for the Blender builds (data only, read from the MPFB2 data folder, all CC0):
# the hm08 base mesh, macro / detail targets, Mixamo-compatible rig + weights merged onto the
# app's joint names, eyeballs. Positions are metres, Y up, facing +Z, the body's left = +X.
import os, gzip, json, math
import numpy as np

FING = ['thumb', 'index', 'middle', 'ring', 'pinky']
APP = ['pelvis', 'spine', 'chest', 'neck', 'head']
for _s in 'LR':
    APP += [n + _s for n in ['clav', 'shoulder', 'elbow', 'hand', 'hip', 'knee', 'foot', 'toe']]
    APP += [f + _s + str(k) for f in FING for k in (1, 2, 3)]
PARENT = {'pelvis': None, 'spine': 'pelvis', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
for _s in 'LR':
    PARENT.update({'clav' + _s: 'chest', 'shoulder' + _s: 'clav' + _s, 'elbow' + _s: 'shoulder' + _s, 'hand' + _s: 'elbow' + _s,
                   'hip' + _s: 'pelvis', 'knee' + _s: 'hip' + _s, 'foot' + _s: 'knee' + _s, 'toe' + _s: 'foot' + _s})
    for _f in FING:
        for _k in (1, 2, 3):
            PARENT[_f + _s + str(_k)] = 'hand' + _s if _k == 1 else _f + _s + str(_k - 1)


def app_name(bone):
    b = bone.split(':')[-1]
    core = {'Hips': 'pelvis', 'Spine': 'spine', 'Spine1': 'chest', 'Spine2': 'chest', 'Neck': 'neck', 'Head': 'head'}
    if b in core:
        return core[b]
    s = 'L' if b.startswith('Left') else 'R'
    b = b[4:] if s == 'L' else b[5:]
    part = {'Shoulder': 'clav', 'Arm': 'shoulder', 'ForeArm': 'elbow', 'Hand': 'hand', 'UpLeg': 'hip', 'Leg': 'knee', 'Foot': 'foot', 'ToeBase': 'toe'}
    if b in part:
        return part[b] + s
    for f, F in zip(FING, ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']):
        if b.startswith('Hand' + F):
            return f + s + b[-1]
    raise KeyError(bone)


def tri(v, names):
    if v < 0.5:
        return {names[0]: 1 - v / 0.5, names[1]: v / 0.5}
    return {names[1]: 1 - (v - 0.5) / 0.5, names[2]: (v - 0.5) / 0.5}


class MH:
    def __init__(self, data):
        self.data = data
        V, faces, groups, g = [], [], {}, None
        for line in open(os.path.join(data, '3dobjs', 'base.obj')):
            if line.startswith('v '):
                V.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('g '):
                g = line.split()[1]
            elif line.startswith('f '):
                f = [int(t.split('/')[0]) - 1 for t in line.split()[1:]]
                faces.append((g, f))
                groups.setdefault(g, set()).update(f)
        self.V = np.array(V) * 0.1  # decimetres → metres
        self.N = len(self.V)
        self.groups = groups
        self.BODY = [f for gg, f in faces if gg == 'body']
        self.NB = max(max(f) for f in self.BODY) + 1
        self._tc = {}
        self.rig = json.load(open(os.path.join(data, 'rigs', 'standard', 'rig.mixamo.json')))['bones']
        wts = json.load(open(os.path.join(data, 'rigs', 'standard', 'weights.mixamo.json')))['weights']
        W = np.zeros((self.NB, len(APP)))
        for bone, lst in wts.items():
            j = APP.index(app_name(bone))
            for vi, w in lst:
                if vi < self.NB:
                    W[vi, j] += w
        s = W.sum(1, keepdims=True)  # some areas (mouth, eyelids) don't add up to 1
        self.W = W / np.where(s > 0, s, 1)

    def target(self, rel):
        if rel not in self._tc:
            d = np.zeros((self.N, 3))
            p = os.path.join(self.data, 'targets', rel if rel.endswith('.gz') else rel + '.target.gz')
            if os.path.exists(p):
                for line in gzip.open(p, 'rt'):
                    s = line.split()
                    if len(s) == 4 and not line.startswith('#'):
                        d[int(s[0])] = [float(s[1]), float(s[2]), float(s[3])]
            else:
                print('missing target', rel)
            self._tc[rel] = d * 0.1
        return self._tc[rel]

    def shaped(self, gender, muscle, weight, prop, extra=None):
        """macro modifiers (gender 0 = female … 1 = male, young adult, mixed ethnicity) + detail targets {path: weight}"""
        D = np.zeros((self.N, 3))
        for gn, a in (('female', 1 - gender), ('male', gender)):
            if a <= 0:
                continue
            for race in ('african', 'asian', 'caucasian'):
                D += a / 3 * self.target(f'macrodetails/{race}-{gn}-young.target.gz')
            for mn, b in tri(muscle, ['minmuscle', 'averagemuscle', 'maxmuscle']).items():
                for wn, c in tri(weight, ['minweight', 'averageweight', 'maxweight']).items():
                    k = a * b * c
                    if k <= 0:
                        continue
                    D += k * self.target(f'macrodetails/universal-{gn}-young-{mn}-{wn}.target.gz')
                    if prop > 0.5:
                        D += k * (prop - 0.5) * 2 * self.target(f'macrodetails/proportions/{gn}-young-{mn}-{wn}-idealproportions.target.gz')
                    elif prop < 0.5:
                        D += k * (0.5 - prop) * 2 * self.target(f'macrodetails/proportions/{gn}-young-{mn}-{wn}-uncommonproportions.target.gz')
        for rel, w in (extra or {}).items():
            D += w * self.target(rel)
        return self.V + D

    def cube(self, name, P):
        return P[sorted(self.groups[name])].mean(0)

    def locate(self, spec, P):
        if 'cube_name' in spec:
            return self.cube(spec['cube_name'], P)
        if 'vertex_indices' in spec:
            return P[spec['vertex_indices']].mean(0)
        if 'vertex_index' in spec:
            return P[spec['vertex_index']]
        x, y, z = spec['default_position']
        return np.array([x, z, -y])

    def joints_of(self, P):
        J, tips = {}, {}
        for bone, b in self.rig.items():
            n = app_name(bone)
            if bone.endswith('Spine2'):
                continue  # merged into the chest; the chest pivots at Spine1
            J[n] = self.locate(b['head'], P)
            if bone.endswith(('Thumb3', 'Index3', 'Middle3', 'Ring3', 'Pinky3', 'ToeBase', 'Head')):
                tips[n] = self.locate(b['tail'], P)
        return J, tips

    def eyes_of(self, P):
        out = {}
        for s, gname in (('L', 'helper-l-eye'), ('R', 'helper-r-eye')):
            idx = sorted(self.groups[gname])
            c = P[idx].mean(0)
            r = np.linalg.norm(P[idx] - c, axis=1).mean()
            out[s] = (c, r * 0.97)
        return out

    def default_weights(self, bone):
        """one bone's weights from the full MakeHuman rig (e.g. 'jaw')"""
        w = json.load(open(os.path.join(self.data, 'rigs', 'standard', 'weights.default.json')))['weights'][bone]
        out = np.zeros(self.NB)
        for vi, x in w:
            if vi < self.NB:
                out[vi] = x
        return out


def eyeball(c, r, nseg=28, nring=16, colors=((0.16,) * 3, (0.42,) * 3, (0.3,) * 3, (0.97,) * 3)):
    """UV sphere with its pole forward (+Z); per-vertex colour: pupil, iris, limbal ring, sclera"""
    pts, col = [], []
    for i in range(nring + 1):
        th = math.pi * i / nring
        for j in range(nseg if 0 < i < nring else 1):
            ph = 2 * math.pi * j / nseg
            d = np.array([math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)])
            pts.append(c + d * r)
            k = 0 if th < 0.2 else 1 if th < 0.42 else 2 if th < 0.47 else 3
            col.append(list(colors[k]) + [1])
    idx = []
    def ring(i):
        if i == 0:
            return [0]
        if i == nring:
            return [len(pts) - 1]
        return [1 + (i - 1) * nseg + j for j in range(nseg)]
    for i in range(nring):
        a, b = ring(i), ring(i + 1)
        for j in range(nseg):
            if len(a) == 1:
                idx += [a[0], b[j], b[(j + 1) % nseg]]
            elif len(b) == 1:
                idx += [a[j], b[0], a[(j + 1) % nseg]]
            else:
                idx += [a[j], b[j], b[(j + 1) % nseg], a[j], b[(j + 1) % nseg], a[(j + 1) % nseg]]
    return np.array(pts), np.array(idx, dtype=np.uint32), np.array(col)
