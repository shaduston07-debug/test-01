# Builds vendor/models/figure-female.glb and figure-male.glb in Blender (headless):
#   blender -b --factory-startup --python scripts/blender/build_figures.py -- <mpfb data dir> <out dir> [female|male …]
# Source: the MakeHuman hm08 base mesh, its macro targets (gender / muscle / weight / proportions)
# and the Mixamo-compatible rig weights, all CC0, read from the MPFB2 data folder (data only).
# The figure is shaped with the real targets, subdivided once (Catmull-Clark) in Blender, gets
# ambient occlusion baked into vertex colours, and is rigged with the app's own joint names.
# Two morph targets ("slim", "strong") carry the Build slider; joint positions for each are in
# the scene extras so the skeleton follows the body.
import bpy, sys, os, math
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbwrite import GLB, top4
from mhkit import MH, APP, PARENT, eyeball

argv = sys.argv[sys.argv.index('--') + 1:]
DATA, OUT = argv[0], argv[1]
SEXES = argv[2:] or ['female', 'male']
RENDER = os.environ.get('INKWELL_RENDER')  # folder for preview renders (optional)
mh = MH(DATA)
NB, BODY, W = mh.NB, mh.BODY, mh.W


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def subdivided(P, with_groups=False):
    me = bpy.data.meshes.new('body')
    me.from_pydata([tuple(p) for p in P[:NB]], [], [tuple(f) for f in BODY])
    me.update()
    ob = bpy.data.objects.new('body', me)
    bpy.context.scene.collection.objects.link(ob)
    if with_groups:
        for j, n in enumerate(APP):
            vg = ob.vertex_groups.new(name=n)
            for vi in np.nonzero(W[:, j] > 1e-4)[0]:
                vg.add([int(vi)], float(W[vi, j]), 'REPLACE')
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = md.render_levels = 1
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier='sub')
    pos = np.zeros(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', pos)
    return ob, pos.reshape(-1, 3)


def quads_to_tris(me):
    out = []
    for p in me.polygons:
        v = list(p.vertices)
        for k in range(1, len(v) - 1):
            out += [v[0], v[k], v[k + 1]]
    return np.array(out, dtype=np.uint32)


def bake_ao(ob, eye_objs, dist=0.12, rays=40):
    """per-vertex ambient occlusion, ray cast against the body and eyes (Blender BVH)"""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    me = ob.data
    verts = [v.co.copy() for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    for e in eye_objs:
        o = len(verts)
        verts += [v.co.copy() for v in e.data.vertices]
        polys += [tuple(i + o for i in p.vertices) for p in e.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    # cosine-weighted hemisphere directions around +Z (Fibonacci spiral), rotated per vertex
    k = np.arange(rays) + 0.5
    r, phi = np.sqrt(k / rays), k * math.pi * (3 - math.sqrt(5))
    H = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - r * r)], 1)
    ao = np.ones(len(me.vertices))
    for v in me.vertices:
        n = np.array(v.normal)
        t = np.cross(n, [0, 1, 0] if abs(n[1]) < 0.9 else [1, 0, 0]); t /= np.linalg.norm(t)
        bt = np.cross(n, t)
        D = H[:, :1] * t + H[:, 1:2] * bt + H[:, 2:] * n
        o = v.co + Vector(n * 0.0015)
        hit = 0.0
        for d in D:
            loc, _, _, dd = tree.ray_cast(o, Vector(d), dist)
            if loc is not None:
                hit += 1 - dd / dist  # nearer occluders count more
        ao[v.index] = 1 - hit / rays
    return ao


def mesh_obj(name, P, idx):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in P], [], [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# gender, muscle, weight, proportions (0.5 = average, 1 = idealised). The body-shape pad mixes
# the base with four extremes: musculature (muscle-, muscle+) and body fat (fat-, fat+).
MORPHS = ['muscle-', 'muscle+', 'fat-', 'fat+']
SETTINGS = {sex: {'base': (g, 0.5, 0.5, 1.0), 'muscle-': (g, 0.0, 0.5, 1.0), 'muscle+': (g, 1.0, 0.5, 1.0), 'fat-': (g, 0.5, 0.0, 1.0), 'fat+': (g, 0.5, 1.0, 1.0)}
            for sex, g in (('female', 0.0), ('male', 1.0))}

for sex in SEXES:
    clear()
    variants = {}
    for vn, args in SETTINGS[sex].items():
        P = mh.shaped(*args)
        P[:, 1] -= P[:NB, 1].min()  # feet on the floor
        J, tips = mh.joints_of(P)
        ob, pos = subdivided(P, with_groups=(vn == 'base'))
        variants[vn] = dict(P=P, J=J, tips=tips, ob=ob, pos=pos, eyes=mh.eyes_of(P))
    base = variants['base']
    ob = base['ob']
    nbody = len(base['pos'])
    tris = quads_to_tris(ob.data)
    # skin weights after subdivision (Blender interpolates the vertex groups)
    Wsub = np.zeros((nbody, len(APP)))
    gi = {vg.index: APP.index(vg.name) for vg in ob.vertex_groups}
    for v in ob.data.vertices:
        for ge in v.groups:
            Wsub[v.index, gi[ge.group]] = ge.weight
    eye_parts = {s: eyeball(*base['eyes'][s]) for s in 'LR'}
    eye_objs = [mesh_obj('eye' + s, eye_parts[s][0], eye_parts[s][1]) for s in 'LR']
    ao = bake_ao(ob, eye_objs)  # (the ray casts only see the base body and the eyes)
    # soften: drawing figures want shape cues, not grime
    shade = 1 - 0.55 * (1 - np.clip(ao, 0, 1)) ** 1.2
    col = np.stack([shade, shade, shade, np.ones_like(shade)], 1)

    pos, idx, cols = [base['pos']], [tris], [col]
    hi = APP.index('head')
    J4 = [np.argsort(-Wsub, 1)[:, :4]]
    W4 = [np.take_along_axis(Wsub, J4[0], 1)]
    off = nbody
    for s in 'LR':
        ep, ei, ec = eye_parts[s]
        pos.append(ep); idx.append(ei + off); cols.append(ec)
        J4.append(np.full((len(ep), 4), 0)); J4[-1][:, 0] = hi
        W4.append(np.zeros((len(ep), 4))); W4[-1][:, 0] = 1
        off += len(ep)
    POS = np.concatenate(pos).astype(np.float32)
    IDX = np.concatenate(idx)
    COL = np.concatenate(cols).astype(np.float32)
    ji, wq = top4(np.concatenate(J4), np.concatenate(W4))

    def full_pos(vn):
        v = variants[vn]
        return np.concatenate([v['pos']] + [eyeball(*v['eyes'][s])[0] for s in 'LR']).astype(np.float32)
    targets = [full_pos(vn) - POS for vn in MORPHS]

    glb = GLB()
    J = base['J']
    jnode = {n: glb.node(n, translation=J[n] - (J[PARENT[n]] if PARENT[n] else 0)) for n in APP}
    for n in APP:
        kids = [jnode[c] for c in APP if PARENT[c] == n]
        if kids:
            glb.j['nodes'][jnode[n]]['children'] = kids
    inv = []
    for n in APP:
        m = np.eye(4)
        m[:3, 3] = -J[n]
        inv.append(m.T.reshape(-1))  # column-major
    skin = glb.skin([jnode[n] for n in APP], np.array(inv), skeleton=jnode['pelvis'])
    mat = glb.material('mannequin', color=(0.58, 0.56, 0.53, 1), rough=0.62)
    prim = glb.primitive(POS, IDX, material=mat, color=COL, joints=ji, weights=wq, targets=targets)
    mesh = glb.mesh('body', [prim], target_names=MORPHS)
    mnode = glb.node('body', mesh=mesh, skin=skin)
    root = glb.node('figure-' + sex, children=[mnode, jnode['pelvis']])
    r3 = lambda a: [round(float(x), 5) for x in a]
    extras = {
        'inkwell': 'figure', 'sex': sex, 'joints': APP, 'parents': [PARENT[n] for n in APP], 'eyeStart': nbody, 'morphs': MORPHS, 'morphScales': glb.morph_scales,
        'variants': {vn: {'joints': {n: r3(v['J'][n]) for n in APP}, 'tips': {n: r3(p) for n, p in v['tips'].items()},
                          'eyes': {s: r3(v['eyes'][s][0]) for s in 'LR'}, 'top': float(v['pos'][:, 1].max())} for vn, v in variants.items()},
        'source': 'MakeHuman hm08 base mesh, macro targets and Mixamo-compatible rig weights (CC0, via the MPFB2 data folder)',
    }
    os.makedirs(OUT, exist_ok=True)
    size = glb.save(os.path.join(OUT, f'figure-{sex}.glb'), extras=extras, roots=[root])
    print(f'figure-{sex}.glb  verts={len(POS)} tris={len(IDX)//3} bytes={size}')

    if RENDER:
        # quick look: the three variants side by side, Workbench studio light
        for i, vn in enumerate(MORPHS):
            variants[vn]['ob'].location.x = (i - 1.5 + (i >= 2)) * 0.7  # base in the middle
        for o in bpy.context.scene.objects:
            o.rotation_euler.x = math.radians(90)  # our Y-up data → Blender's Z-up
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'STUDIO'
        sc.display.shading.color_type = 'SINGLE'
        sc.display.shading.show_cavity = True
        sc.render.resolution_x, sc.render.resolution_y = 1400, 1000
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        sc.camera = cam
        cam.location = (0, -5.2, 0.95)
        cam.rotation_euler = (math.radians(90), 0, 0)
        sc.render.filepath = os.path.join(RENDER, f'{sex}-front.png')
        bpy.ops.render.render(write_still=True)
