# Shared Blender helpers for the Inkwell model builds: mesh in / out, UV unwrap, procedural
# materials baked to texture maps (albedo, tangent-space normal, roughness, AO) and .glb export.
# All data is Y-up (glTF convention) and stays that way inside Blender; nothing is rendered
# through a camera, so the orientation never matters there.
import bpy, math, os, io, tempfile
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
from glbwrite import GLB


def pack_maps(maps, ao_in_albedo=0.45):
    """baked maps → JPEG bytes: albedo (AO folded in a little), normal, ORM (AO, roughness, metal 0)"""
    ao = maps['AO'][:, :, :1]
    albedo = maps['DIFFUSE'] * (1 - ao_in_albedo + ao_in_albedo * ao)
    orm = np.concatenate([ao, maps['ROUGHNESS'][:, :, :1], np.zeros_like(ao)], 2)
    tmp = os.path.join(tempfile.gettempdir(), 'inkwell_enc.jpg')
    out = encode_jpeg(albedo, tmp, 88), encode_jpeg(maps['NORMAL'], tmp, 92), encode_jpeg(orm, tmp, 85)
    os.remove(tmp)
    return out


def write_skinned_glb(path, name, A, ji, wq, spec, maps, extras):
    """one textured skinned mesh; joints from spec [[name, parent, world position], …] with identity bind rotations"""
    jb, jn, jo = pack_maps(maps)
    glb = GLB()
    names = [s[0] for s in spec]
    sp = {s[0]: s for s in spec}
    wp = {n: np.array(sp[n][2], dtype=float) for n in names}
    jnode = {n: glb.node(n, translation=wp[n] - (wp[sp[n][1]] if sp[n][1] else 0)) for n in names}
    for n in names:
        kids = [jnode[c] for c in names if sp[c][1] == n]
        if kids:
            glb.j['nodes'][jnode[n]]['children'] = kids
    # bind pose: the rest skeleton rotated by bindQ (when the mesh was bound in another pose)
    bq = (extras or {}).get('bindQ') or {}
    Wm = {}
    for n in names:
        local = np.eye(4)
        local[:3, 3] = wp[n] - (wp[sp[n][1]] if sp[n][1] else 0)
        if n in bq:
            x, y, z, w = bq[n]
            glb.j['nodes'][jnode[n]]['rotation'] = [x, y, z, w]
            local[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                             [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                             [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        Wm[n] = (Wm[sp[n][1]] if sp[n][1] else np.eye(4)) @ local
    inv = [np.linalg.inv(Wm[n]).T.reshape(-1) for n in names]  # column-major
    roots = [n for n in names if not sp[n][1]]
    skin = glb.skin([jnode[n] for n in names], np.array(inv), skeleton=jnode[roots[0]])
    mat = glb.material(name, color=(1, 1, 1, 1), rough=1.0, metal=0.0, base_tex=glb.image(jb), normal_tex=glb.image(jn), orm_tex=glb.image(jo))
    prim = glb.primitive(A['pos'].astype(np.float32), A['idx'], material=mat, normal=A['normal'].astype(np.float32), uv=A['uv'].astype(np.float32),
                         tangent=A['tangent'].astype(np.float32), joints=ji, weights=wq)
    mnode = glb.node(name, mesh=glb.mesh(name, [prim]), skin=skin)
    root = glb.node(name + '-root', children=[mnode] + [jnode[n] for n in roots])
    return glb.save(path, roots=[root], extras=extras)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.view_settings.view_transform = 'Standard'
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')


def mesh_from(name, P, tris):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in P], [], [tuple(tris[i:i + 3]) for i in range(0, len(tris), 3)])
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def activate(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_mod(ob, kind, **kw):
    activate(ob)
    md = ob.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(md, k, v)
    bpy.ops.object.modifier_apply(modifier=md.name)


def copy_obj(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    return c


def tex(kind, **kw):
    t = bpy.data.textures.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(t, k, v)
    return t


def displace(ob, texture, strength, mid=0.5):
    apply_mod(ob, 'DISPLACE', texture=texture, strength=strength, mid_level=mid, texture_coords='LOCAL')


def positions(ob):
    a = np.zeros(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def transfer_weights(src_pos, src_idx, src_w, dst_pos):
    """nearest source vertex → its (joint, weight) quadruple"""
    kd = KDTree(len(src_pos))
    for i, p in enumerate(src_pos):
        kd.insert(Vector(p), i)
    kd.balance()
    near = np.array([kd.find(Vector(p))[1] for p in dst_pos])
    return src_idx[near], src_w[near]


def unwrap(ob, margin=0.004, angle=66):
    activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=1.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


# ───────── procedural materials (shader nodes) ─────────
class Nodes:
    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.n('ShaderNodeOutputMaterial')
        self.bsdf = self.n('ShaderNodeBsdfPrincipled')
        self.link(self.bsdf, 'BSDF', self.out, 'Surface')
        self.coord = self.n('ShaderNodeTexCoord')
        self.geo = self.n('ShaderNodeNewGeometry')

    def n(self, kind, **kw):
        node = self.nt.nodes.new(kind)
        for k, v in kw.items():
            if k.startswith('in_'):
                node.inputs[k[3:].replace('_', ' ')].default_value = v
            else:
                setattr(node, k, v)
        return node

    def link(self, a, sa, b, sb):
        out = a.outputs[sa] if isinstance(sa, str) else a.outputs[sa]
        inp = b.inputs[sb] if isinstance(sb, str) else b.inputs[sb]
        self.nt.links.new(out, inp)

    def noise(self, scale, detail=6, rough=0.55, coord='Object'):
        t = self.n('ShaderNodeTexNoise', in_Scale=scale, in_Detail=detail, in_Roughness=rough)
        self.link(self.coord, coord, t, 'Vector')
        return t

    def voronoi(self, scale, feature='F1', coord='Object'):
        t = self.n('ShaderNodeTexVoronoi', feature=feature, in_Scale=scale)
        self.link(self.coord, coord, t, 'Vector')
        return t

    def ramp(self, src, sock, stops):
        r = self.n('ShaderNodeValToRGB')
        cr = r.color_ramp
        while len(cr.elements) > len(stops):
            cr.elements.remove(cr.elements[-1])
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for e, (pos, col) in zip(cr.elements, stops):
            e.position = pos
            e.color = tuple(col) + (1,) if len(col) == 3 else col
        self.link(src, sock, r, 'Fac')
        return r

    def mix(self, a, sa, b, sb, fac_node=None, fac_sock=None, fac=0.5, blend='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        m.inputs['Factor'].default_value = fac
        self.link(a, sa, m, 6)
        self.link(b, sb, m, 7)
        if fac_node is not None:
            self.link(fac_node, fac_sock, m, 'Factor')
        return m

    def math(self, op, a, sa, b=None, sb=None, v=None, clamp=True):
        m = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.link(a, sa, m, 0)
        if b is not None:
            self.link(b, sb, m, 1)
        elif v is not None:
            m.inputs[1].default_value = v
        return m

    def vec_component(self, sock_node, sock, axis):
        s = self.n('ShaderNodeSeparateXYZ')
        self.link(sock_node, sock, s, 'Vector')
        return s, axis


def bake_maps(low, high, size=1024, extrusion=0.02, out_dir='.', name='m', ao_dist=0.2, samples_ao=48):
    """bakes (high → low): albedo (diffuse colour), tangent normal, roughness, AO.
    Returns numpy images (h, w, 3|1) in 0…1 as stored (albedo sRGB-encoded)."""
    sc = bpy.context.scene
    bk = sc.render.bake
    bk.use_selected_to_active = high is not None
    bk.cage_extrusion = extrusion
    bk.max_ray_distance = extrusion * 3
    bk.margin = 6
    lm = bpy.data.materials.new(name + '_bake')
    lm.use_nodes = True
    if len(low.data.materials):
        for i in range(len(low.data.materials)):  # keep the slots (face material indices stay valid)
            low.data.materials[i] = lm
    else:
        low.data.materials.append(lm)
    node = lm.node_tree.nodes.new('ShaderNodeTexImage')
    lm.node_tree.nodes.active = node
    res = {}
    for kind, cs, extra in (('DIFFUSE', 'sRGB', {'pass_filter': {'COLOR'}}), ('NORMAL', 'Non-Color', {'normal_space': 'TANGENT'}),
                            ('ROUGHNESS', 'Non-Color', {}), ('AO', 'Non-Color', {})):
        img = bpy.data.images.new(f'{name}_{kind}', size, size, alpha=False, float_buffer=False)
        img.colorspace_settings.name = cs
        node.image = img
        sc.cycles.samples = samples_ao if kind == 'AO' else 1
        if kind == 'AO':
            sc.world.light_settings.distance = ao_dist
        activate(low)
        if high is not None:
            high.select_set(True)
            low.select_set(True)
            bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type=kind, **extra)
        a = np.zeros(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        res[kind] = a.reshape(size, size, 4)[::-1, :, :3]  # top row first
    return res


def encode_jpeg(arr, path, quality=90):
    """(h, w, 3) floats 0…1 → JPEG bytes, through a Blender image"""
    h, w = arr.shape[:2]
    img = bpy.data.images.new('enc', w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'  # write the values as given
    px = np.ones((h, w, 4), dtype=np.float32)
    px[:, :, :3] = np.clip(arr[::-1], 0, 1)
    img.pixels.foreach_set(px.reshape(-1))
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = 'JPEG'
    st.quality = quality
    st.color_mode = 'RGB'
    img.save_render(path, scene=sc)
    bpy.data.images.remove(img)
    with open(path, 'rb') as f:
        return f.read()


def export_arrays(ob, split_normals=False):
    """per-corner unique (vertex, uv[, normal]) → split vertex arrays; returns dict with pos, normal, uv, tangent, idx, src (vertex index)"""
    me = ob.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active
    me.calc_tangents(uvmap=uvl.name)
    nl = len(me.loops)
    vi = np.zeros(nl, dtype=np.int64); me.loops.foreach_get('vertex_index', vi)
    uv = np.zeros(nl * 2); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    nrm = np.zeros(nl * 3); me.loops.foreach_get('normal', nrm); nrm = nrm.reshape(-1, 3)
    tan = np.zeros(nl * 3); me.loops.foreach_get('tangent', tan); tan = tan.reshape(-1, 3)
    bs = np.zeros(nl); me.loops.foreach_get('bitangent_sign', bs)
    key = np.round(uv * 8192).astype(np.int64)
    cols = [vi, key[:, 0], key[:, 1]]
    if split_normals:  # hard edges keep their own normals
        cols += list(np.round(nrm * 64).astype(np.int64).T)
    uniq, first, inv = np.unique(np.stack(cols, 1), axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    lt = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('loops', lt)
    P = positions(ob)
    out = {'src': vi[first], 'pos': P[vi[first]], 'uv': np.stack([uv[first, 0], 1 - uv[first, 1]], 1),
           'tangent': np.concatenate([tan[first], bs[first, None]], 1), 'idx': inv[lt].astype(np.uint32)}
    # average the normals of corners that merged (smooth shading)
    acc = np.zeros((len(uniq), 3))
    np.add.at(acc, inv, nrm)
    out['normal'] = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-9)
    return out


def lin(h):
    """'#rrggbb' (sRGB) → linear rgb for shader inputs"""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)



def skin_material(r):
    """the creature's procedural skin: cavities darker, belly / raised edges lighter, a pattern, roughness"""
    N = Nodes('skin')
    base, dark, light = (lin(c) for c in r['colors'])
    kind, sc = r['pattern']
    pat = N.noise(sc, detail=8) if kind == 'noise' else N.voronoi(sc)
    pr = N.ramp(pat, 'Fac' if kind == 'noise' else 'Distance', [(0.3, dark), (0.62, base)])
    # mostly the base colour, the pattern only breaks it up
    mixp = N.n('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    mixp.inputs['Factor'].default_value = 0.45
    mixp.inputs[6].default_value = base + (1,)
    N.link(pr, 'Color', mixp, 7)
    # belly (normal pointing down, in our Y-up data) lighter, back darker
    sep = N.n('ShaderNodeSeparateXYZ')
    N.link(N.geo, 'Normal', sep, 'Vector')
    belly = N.n('ShaderNodeMapRange', in_From_Min=-0.2, in_From_Max=-0.85, in_To_Min=0.0, in_To_Max=0.75)
    N.link(sep, 'Y', belly, 'Value')
    mb = N.n('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    N.link(belly, 'Result', mb, 'Factor')
    N.link(mixp, 2, mb, 6)
    mb.inputs[7].default_value = light + (1,)
    last = mb
    if r.get('moss'):
        top = N.n('ShaderNodeMapRange', in_From_Min=0.55, in_From_Max=0.9, in_To_Min=0.0, in_To_Max=0.7)
        N.link(sep, 'Y', top, 'Value')
        mn = N.noise(4, detail=4)
        mm = N.math('MULTIPLY', top, 'Result', mn, 'Fac')
        mo = N.n('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
        N.link(mm, 'Value', mo, 'Factor')
        N.link(last, 2, mo, 6)
        mo.inputs[7].default_value = lin(r['moss']) + (1,)
        last = mo
    # curvature: cavities dark, ridges a little lighter
    cav = N.n('ShaderNodeMapRange', in_From_Min=0.42, in_From_Max=0.56, in_To_Min=0.0, in_To_Max=1.0)
    N.link(N.geo, 'Pointiness', cav, 'Value')
    mc = N.n('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    N.link(cav, 'Result', mc, 'Factor')
    mc.inputs[6].default_value = dark + (1,)
    N.link(last, 2, mc, 7)
    edge = N.n('ShaderNodeMapRange', in_From_Min=0.55, in_From_Max=0.7, in_To_Min=0.0, in_To_Max=0.35)
    N.link(N.geo, 'Pointiness', edge, 'Value')
    me_ = N.n('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    N.link(edge, 'Result', me_, 'Factor')
    N.link(mc, 2, me_, 6)
    me_.inputs[7].default_value = light + (1,)
    N.link(me_, 2, N.bsdf, 'Base Color')
    # roughness: pattern-driven between the recipe's range, rougher in cavities
    rn = N.noise(sc * 2.3, detail=4)
    rr = N.n('ShaderNodeMapRange', in_To_Min=r['rough'][0], in_To_Max=r['rough'][1])
    N.link(rn, 'Fac', rr, 'Value')
    N.link(rr, 'Result', N.bsdf, 'Roughness')
    return N.mat


