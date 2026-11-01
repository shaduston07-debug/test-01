# Builds the rigid library models (vehicles, castle, city, weapons) in Blender (headless):
#   blender -b --factory-startup --python scripts/blender/build_props.py -- <dump dir> <poly haven dir> <out dir> [name …]
# Input per model: its generated geometry, one part per material role (dumped from the browser as
# pr-<name>.json + .bin). Blender welds and bevels the hard edges (they catch the light like real
# objects), projects UVs at real-world scale and assigns PBR materials: Poly Haven CC0 texture
# sets (stone, slate roof, wood, grass, asphalt, paving, concrete, plaster, leather) or measured
# values (car paint with clear coat, chrome, rubber, glass, lights). Building facades and roads
# get composited texture atlases (plaster + windows; asphalt + lane markings) on their own UVs.
import bpy, sys, os, json, math, random
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakekit as K
from glbwrite import GLB

argv = sys.argv[sys.argv.index('--') + 1:]
DUMP, PH, OUT = argv[0], argv[1], argv[2]
NAMES = argv[3:]

hexc = lambda h: [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
lin = lambda c: [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

# material roles → look. tex = Poly Haven set, tile = metres per texture repeat, bevel = edge radius (m)
LOOK = {
    # vehicles
    'paint': dict(color=None, rough=0.32, metal=0.25, clearcoat=(1.0, 0.04)),
    'glass': dict(color='#18202a', rough=0.04, metal=0.0),
    'tire': dict(color='#171719', rough=0.86),
    'rim': dict(color='#c4c8ce', rough=0.22, metal=1.0),
    'chrome': dict(color='#e4e7eb', rough=0.08, metal=1.0),
    'light': dict(color='#fff6dd', rough=0.1, emissive='#fff0c4'),
    'red': dict(color='#c41f24', rough=0.2, emissive='#7a0000'),
    'trim': dict(color='#1d1f23', rough=0.55),
    'seat': dict(tex='brown_leather', tile=0.35, tint='#5a4a40'),
    # castle
    'stone': dict(tex='castle_wall_slates', tile=3.0, bevel=0.06),
    'roof': dict(tex='grey_roof_tiles', tile=2.5),
    'wood': dict(tex='medieval_wood', tile=1.6, bevel=0.02),
    'dark': dict(color='#1e1b18', rough=0.95, bevel=0.03),
    'flag': dict(color='#93171f', rough=0.8),
    'ground': dict(tex='leafy_grass', tile=4.0),
    # city
    'facade': dict(atlas='facade', bevel=0.08),
    'road': dict(atlas='road'),
    'walk': dict(tex='square_brick_paving', tile=2.4, bevel=0.03),
    'cityroof': dict(tex='concrete', tile=4.0, tint='#9b9892', bevel=0.05),
    'citydark': dict(tex='concrete', tile=3.0, tint='#4a4d52', bevel=0.04),
    'pole': dict(color='#474b52', rough=0.42, metal=0.7),
    'tree': dict(color='#4f7a3c', rough=0.9),
    'trunk': dict(tex='medieval_wood', tile=0.8, tint='#7a5a40'),
    # weapons
    'steel': dict(color='#c6cbd1', rough=0.26, metal=1.0),
    'darkSteel': dict(color='#50555d', rough=0.38, metal=0.95),
    'leather': dict(tex='brown_leather', tile=0.12),
    'weaponwood': dict(tex='fine_grained_wood', tile=0.35),
    'gold': dict(color='#d8b45a', rough=0.24, metal=1.0),
    'polymer': dict(color='#26282c', rough=0.55),
}
CITY = {'roof': 'cityroof', 'dark': 'citydark'}


def role(name, part):
    m = part['mat']
    if name in ('street', 'district') and m in CITY:
        return CITY[m]
    if name.startswith('w-') and m == 'wood':
        return 'weaponwood'
    return m if m in LOOK else None


# ───────── texture helpers (numpy images, top row first, 0…1) ─────────
def load_img(path, size):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'  # raw values
    if img.size[0] != size:
        img.scale(size, size)
    a = np.zeros(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(size, size, 4)[::-1, :, :3]


_tc = {}
def texset(tid, size):
    k = (tid, size)
    if k not in _tc:
        d = os.path.join(PH, tid)
        _tc[k] = {m: load_img(os.path.join(d, m + '.jpg'), size) for m in ('diff', 'nor', 'rough')}
    return _tc[k]


def facade_atlas(size=1024):
    """8 × 8 windows per tile (same layout as the app's generated facade): plaster wall, framed windows
    with sills, glass with a sky reflection, a few lit at night"""
    wall = texset('grey_plaster', size // 2)
    tile2 = lambda a: np.tile(a, (2, 2, 1))
    diff, nor, rough = tile2(wall['diff']) * 1.12, tile2(wall['nor']).copy(), tile2(wall['rough']).copy()
    emi = np.zeros_like(diff)
    rnd = random.Random(7)
    c = size // 8
    for j in range(8):
        for i in range(8):
            x0, y0, w, h = i * c + c * 3 // 16, j * c + c * 7 // 32, c * 10 // 16, c * 19 // 32
            fr = max(2, c // 22)
            lit = rnd.random() < 0.18
            # frame + sill
            diff[y0 - fr:y0 + h + fr, x0 - fr:x0 + w + fr] = hexc('#d4cfc6')
            rough[y0 - fr:y0 + h + fr, x0 - fr:x0 + w + fr] = 0.45
            diff[y0 + h + fr:y0 + h + fr * 2 + 2, x0 - fr * 2:x0 + w + fr * 2] = hexc('#bab3a8')
            nor[y0 + h + fr:y0 + h + fr * 2 + 2, x0 - fr * 2:x0 + w + fr * 2] = [0.5, 0.25, 0.9]
            # glass: darker towards the top (sky reflection fades), slight variation per pane
            g = np.linspace(0, 1, h)[:, None, None]
            base = np.array(hexc('#3b4a58' if rnd.random() < 0.5 else '#4a5a69'))
            glass = base * (0.8 + 0.45 * g)
            if lit:
                glass = np.array(hexc('#f2dca6')) * (0.85 + 0.15 * g)
                emi[y0:y0 + h, x0:x0 + w] = np.array(hexc('#f2d79a')) * 0.9
            diff[y0:y0 + h, x0:x0 + w] = glass
            rough[y0:y0 + h, x0:x0 + w] = 0.06
            nor[y0:y0 + h, x0:x0 + w] = [0.5, 0.5, 1.0]
            # mullion
            mx = x0 + w // 2
            diff[y0:y0 + h, mx - 1:mx + 2] = hexc('#cfc9bf')
            # inset shading on the frame edges (normal tilt)
            nor[y0 - fr:y0, x0 - fr:x0 + w + fr] = [0.5, 0.75, 0.9]
            nor[y0 + h:y0 + h + fr, x0 - fr:x0 + w + fr] = [0.5, 0.25, 0.9]
            nor[y0:y0 + h, x0 - fr:x0] = [0.75, 0.5, 0.9]
            nor[y0:y0 + h, x0 + w:x0 + w + fr] = [0.25, 0.5, 0.9]
    return dict(diff=np.clip(diff, 0, 1), nor=nor, rough=rough, emi=emi)


def road_atlas(size=1024):
    a = texset('asphalt_02', size)
    diff, nor, rough = a['diff'].copy(), a['nor'].copy(), a['rough'].copy()
    # dashed centre line, 4 dashes per tile (as the generated road), worn paint
    x0, x1 = int(size * 0.488), int(size * 0.512)
    for k in range(4):
        y0 = int(size * (k * 0.25 + 0.03)); y1 = y0 + int(size * 0.14)
        wear = 0.75 + 0.25 * a['diff'][y0:y1, x0:x1].mean(2, keepdims=True) / max(1e-3, a['diff'].mean())
        diff[y0:y1, x0:x1] = np.clip(np.array(hexc('#e9e2c6')) * wear, 0, 1)
        rough[y0:y1, x0:x1] = 0.5
    # edge lines
    for xa in (int(size * 0.03), int(size * 0.955)):
        diff[:, xa:xa + int(size * 0.015)] = hexc('#dcd8cc')
    return dict(diff=diff, nor=nor, rough=rough)


def jpeg(arr, q=85):
    tmp = os.path.join(OUT, '_tmp.jpg')
    b = K.encode_jpeg(arr, tmp, q)
    os.remove(tmp)
    return b


def srgb_to_lin_img(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


# ───────── per model ─────────
def build(name):
    meta = json.load(open(os.path.join(DUMP, f'pr-{name}.json')))
    raw = np.fromfile(os.path.join(DUMP, f'pr-{name}.bin'), dtype=np.uint8)
    get = lambda ref, dt, n: np.frombuffer(raw[ref[0]:ref[0] + ref[1] * np.dtype(dt).itemsize].tobytes(), dtype=dt).reshape(-1, n)
    K.reset()
    big = name in ('castle', 'street', 'district')
    small = name.startswith('w-')
    tsize = 1024 if big else 512
    glb = GLB()
    prims, texcache, mats = [], {}, {}
    for pi, part in enumerate(meta['parts']):
        if part['pos'][1] == 0:
            continue
        rk = role(name, part)
        look = LOOK.get(rk, {})
        P = get(part['pos'], np.float32, 3)
        I = get(part['idx'], np.uint32, 1).reshape(-1)
        UV = get(part['uv'], np.float32, 2) if part['uv'] else None
        COL = get(part['col'], np.float32, 3) if part['col'] else None
        ob = K.mesh_from(f'{name}_{pi}', P, I)
        me = ob.data
        keep_uv = look.get('atlas') is not None and UV is not None
        if keep_uv:
            uvl = me.uv_layers.new(name='uv')
            li = np.zeros(len(me.loops), dtype=np.int64); me.loops.foreach_get('vertex_index', li)
            uvl.data.foreach_set('uv', UV[li].reshape(-1))
        if COL is not None:
            ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
            ca.data.foreach_set('color', np.concatenate([COL, np.ones((len(COL), 1))], 1).astype(np.float32).reshape(-1))
        # weld the flat-shaded primitives so edges can be bevelled, then smooth by angle
        K.activate(ob)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.0004 if not small else 0.00005)
        bpy.ops.object.mode_set(mode='OBJECT')
        if small and len(I) // 3 > 12000:
            # sculpted weapons are densely meshed: ~8k triangles per part keeps even thin blades true
            K.apply_mod(ob, 'DECIMATE', ratio=8000 / (len(I) / 3), use_collapse_triangulate=True)
        if look.get('bevel') and not small:
            K.apply_mod(ob, 'BEVEL', width=look['bevel'], segments=2, limit_method='ANGLE', angle_limit=math.radians(40), harden_normals=False)
        if 'tex' in look:
            K.activate(ob)
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.cube_project(cube_size=look['tile'], correct_aspect=False, scale_to_bounds=False)
            bpy.ops.object.mode_set(mode='OBJECT')
        if not ob.data.uv_layers:
            ob.data.uv_layers.new(name='uv')
        for p in ob.data.polygons:
            p.use_smooth = True
        try:
            ob.data.set_sharp_from_angle(angle=math.radians(35 if not small else 50))
        except Exception:
            pass
        K.apply_mod(ob, 'TRIANGULATE', keep_custom_normals=True)
        A = K.export_arrays(ob, split_normals=True)
        col = None
        if ob.data.color_attributes.get('Col'):
            c = np.zeros(len(ob.data.vertices) * 4); ob.data.color_attributes['Col'].data.foreach_get('color', c)
            col = c.reshape(-1, 4)[A['src']]
            col[:, 3] = 1
        # material
        key = rk or ('plain:' + part['color'])
        if key not in mats:
            base = look.get('color') or part['color']
            cf = lin(hexc(look['tint'])) if look.get('tint') else (lin(hexc(base)) if not look.get('tex') and not look.get('atlas') else [1, 1, 1])
            if rk == 'paint':
                cf = [1, 1, 1]  # the app sets the object's colour
            kw = dict(color=cf + [part['opacity']], rough=look.get('rough', part['rough'] if rk is None else 1.0), metal=look.get('metal', part['metal'] if rk is None else 0.0),
                      double=part['double'], clearcoat=look.get('clearcoat'), blend=part['opacity'] < 1)
            if look.get('emissive') or (rk is None and part['emissive'] and part['emissive'] != '#000000'):
                e = lin(hexc(look.get('emissive') or part['emissive']))
                kw['emissive'] = [x * (part['emi'] or 1) for x in e] if rk is None else e
            if 'tex' in look or 'atlas' in look:
                # the main surface of a big model gets 1k maps, everything else 512
                main = rk in ('stone', 'facade')
                tid = look.get('tex') or look['atlas']
                if tid not in texcache:  # materials sharing a texture set share its images
                    ts = texset(tid, 1024 if main else 512) if 'tex' in look else (facade_atlas() if tid == 'facade' else road_atlas(512))
                    r = ts['rough'][:, :, :1]
                    texcache[tid] = (ts, glb.image(jpeg(ts['diff'], 80)), glb.image(jpeg(ts['nor'], 84)),
                                     glb.image(jpeg(np.concatenate([np.ones_like(r), r, np.zeros_like(r)], 2), 78)))
                ts, kw['base_tex'], kw['normal_tex'], kw['orm_tex'] = texcache[tid]
                kw['occlusion'] = False
                kw['rough'], kw['metal'] = 1.0, 0.0
                if 'emi' in ts:
                    kw['emissive_tex'] = glb.image(jpeg(ts['emi'], 85)); kw['emissive'] = [0.7, 0.7, 0.7]
            mats[key] = glb.material(rk or 'plain', **kw)
        textured = 'tex' in look or 'atlas' in look
        prims.append(glb.primitive(A['pos'].astype(np.float32), A['idx'], material=mats[key], normal=A['normal'].astype(np.float32),
                                   uv=A['uv'].astype(np.float32) if textured else None, tangent=A['tangent'].astype(np.float32) if textured else None,
                                   color=None if col is None else col.astype(np.float32)))
        print(f'  {rk or part["mat"]}: {len(A["pos"])} verts, {len(A["idx"]) // 3} tris')
    mesh = glb.mesh(name, prims)
    root = glb.node(name, mesh=mesh)
    size = glb.save(os.path.join(OUT, f'{name}.glb'), roots=[root], extras={'inkwell': 'prop', 'name': name,
                    'source': 'Inkwell generated model, bevelled and given PBR materials in Blender (Poly Haven CC0 textures)'})
    print(f'{name}.glb parts={len(prims)} bytes={size}')


for n in NAMES:
    build(n)
