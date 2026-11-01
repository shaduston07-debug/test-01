# Builds vendor/models/creature-<kind>.glb in Blender (headless):
#   blender -b --factory-startup --python scripts/blender/build_creatures.py -- <dump dir> <out dir> [kind …]
# Input per creature: its skinned base mesh as the app sculpts it (dumped from the browser as
# cr-<kind>.json + .bin: positions, triangles, joint indices / weights, the joint spec), so the
# skeleton and joint names are exactly the app's (creatureRest / poses keep working).
# Blender then: smooths it, adds organic low-frequency shape variation, decimates it to a light
# runtime mesh with UVs, and bakes a displaced high-resolution copy carrying the creature's
# procedural skin (fur, scales, leather, chitin, rock, wet skin) into albedo / normal /
# roughness / AO maps. Weights are carried over from the base mesh.
import bpy, sys, os, json, math
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakekit as K
from bakekit import lin, skin_material
from glbwrite import GLB, top4

argv = sys.argv[sys.argv.index('--') + 1:]
DUMP, OUT = argv[0], argv[1]
KINDS = argv[2:]


V1 = dict(weight_1=1.0, weight_2=0.0, weight_3=0.0, weight_4=0.0)        # cells (bumps)
V21 = dict(weight_1=-1.0, weight_2=1.0, weight_3=0.0, weight_4=0.0)      # cell borders (plates / cracks)

# tris = runtime triangle budget; detail = displacement on the high-res copy (baked to normals);
# skin colours: base, dark (cavities / back / pattern), light (belly / raised edges)
RECIPES = {
    'werewolf': dict(tris=36000, size=1024, ext=0.012, colors=('#5b4c40', '#1d1814', '#9a8a76'), pattern=('noise', 9), rough=(0.78, 0.95),
                     detail=[('STUCCI', dict(stucci_type='WALL_OUT', noise_scale=0.012, turbulence=8.0), 0.007), ('DISTORTED_NOISE', dict(noise_scale=0.02, distortion=3.0), 0.004)]),
    'orc': dict(tris=36000, size=1024, ext=0.012, colors=('#5d7a3a', '#1b2610', '#93a865'), pattern=('noise', 6), rough=(0.48, 0.7),
                detail=[('CLOUDS', dict(noise_scale=0.006, noise_depth=2), 0.0022), ('VORONOI', dict(noise_scale=0.035, noise_intensity=1.0, **V1), 0.004), ('STUCCI', dict(stucci_type='WALL_IN', noise_scale=0.05, turbulence=4.0), 0.003)]),
    'demon': dict(tris=40000, size=1024, ext=0.012, colors=('#7a1d12', '#1c0503', '#c0502a'), pattern=('voronoi', 14), rough=(0.4, 0.62),
                  detail=[('VORONOI', dict(noise_scale=0.022, noise_intensity=1.0, **V21), 0.004), ('CLOUDS', dict(noise_scale=0.008, noise_depth=2), 0.0018)]),
    'ghoul': dict(tris=30000, size=1024, ext=0.01, colors=('#8b917c', '#2a2b22', '#c3c4ad'), pattern=('noise', 7), rough=(0.6, 0.82),
                  detail=[('STUCCI', dict(stucci_type='WALL_IN', noise_scale=0.018, turbulence=6.0), 0.004), ('CLOUDS', dict(noise_scale=0.005, noise_depth=2), 0.0014)]),
    'xeno': dict(tris=36000, size=1024, ext=0.012, colors=('#14171c', '#030405', '#4a5260'), pattern=('voronoi', 10), rough=(0.16, 0.34),
                 detail=[('VORONOI', dict(noise_scale=0.045, noise_intensity=1.0, **V21), 0.006), ('CLOUDS', dict(noise_scale=0.01, noise_depth=2), 0.0015)]),
    'spider': dict(tris=36000, size=1024, ext=0.008, colors=('#2b2019', '#0b0806', '#7a4a22'), pattern=('noise', 12), rough=(0.32, 0.6),
                   detail=[('CLOUDS', dict(noise_scale=0.0035, noise_depth=1), 0.0012), ('VORONOI', dict(noise_scale=0.018, noise_intensity=1.0, **V1), 0.0018)]),
    'golem': dict(tris=36000, size=1024, ext=0.03, colors=('#7d776c', '#25221e', '#a9a291'), pattern=('noise', 3), rough=(0.82, 0.96), moss='#4f6a2a',
                  shape=[('VORONOI', dict(noise_scale=0.14, noise_intensity=1.0, **V21), 0.035), ('CLOUDS', dict(noise_scale=0.08, noise_depth=3), 0.03)],
                  detail=[('CLOUDS', dict(noise_scale=0.012, noise_depth=4), 0.01), ('VORONOI', dict(noise_scale=0.035, noise_intensity=1.0, **V21), 0.008)]),
    'kraken': dict(tris=40000, size=1024, ext=0.02, colors=('#6e2236', '#1e0610', '#d99a8e'), pattern=('voronoi', 6), rough=(0.12, 0.32),
                   detail=[('CLOUDS', dict(noise_scale=0.014, noise_depth=2), 0.004), ('VORONOI', dict(noise_scale=0.02, noise_intensity=1.0, **V1), 0.003)]),
    'dragon': dict(tris=56000, size=1536, ext=0.05, colors=('#2f5a43', '#0a1610', '#b9a774'), pattern=('noise', 1.5), rough=(0.32, 0.55),
                   detail=[('VORONOI', dict(noise_scale=0.055, noise_intensity=1.0, **V21), 0.014), ('VORONOI', dict(noise_scale=0.055, noise_intensity=1.0, **V1), 0.01), ('CLOUDS', dict(noise_scale=0.02, noise_depth=2), 0.004)]),
}


def build(kind):
    r = RECIPES[kind]
    meta = json.load(open(os.path.join(DUMP, f'cr-{kind}.json')))
    raw = np.fromfile(os.path.join(DUMP, f'cr-{kind}.bin'), dtype=np.uint8)
    nv, ni = meta['nv'], meta['ni']
    o = 0
    P = np.frombuffer(raw[o:o + nv * 12].tobytes(), dtype=np.float32).reshape(-1, 3); o += nv * 12
    I = np.frombuffer(raw[o:o + ni * 4].tobytes(), dtype=np.uint32); o += ni * 4
    SI = np.frombuffer(raw[o:o + nv * 8].tobytes(), dtype=np.uint16).reshape(-1, 4); o += nv * 8
    SW = np.frombuffer(raw[o:o + nv * 16].tobytes(), dtype=np.float32).reshape(-1, 4)
    K.reset()
    base = K.mesh_from(kind, P, I)
    ext = (P.max(0) - P.min(0)).max()
    # clean the sculpt (surface-net steps) and break its perfect smoothness with large, soft forms
    K.apply_mod(base, 'SMOOTH', factor=0.5, iterations=2)
    for tk, kw, s in r.get('shape', [('CLOUDS', dict(noise_scale=ext * 0.05, noise_depth=2), ext * 0.004)]):
        K.displace(base, K.tex(tk, **kw), s)
    Pb = K.positions(base)
    # runtime mesh
    low = K.copy_obj(base, kind + '_low')
    ratio = min(1.0, r['tris'] / (len(I) / 3))
    K.apply_mod(low, 'DECIMATE', ratio=ratio, use_collapse_triangulate=True)
    K.unwrap(low)
    # high-res copy with the skin detail
    high = K.copy_obj(base, kind + '_high')
    K.apply_mod(high, 'SUBSURF', levels=1, render_levels=1)
    for tk, kw, s in r['detail']:
        K.displace(high, K.tex(tk, **kw), s)
    high.data.materials.clear()
    high.data.materials.append(skin_material(r))
    base.hide_render = True
    maps = K.bake_maps(low, high, size=r['size'], extrusion=r['ext'], name=kind, ao_dist=ext * 0.06)
    A = K.export_arrays(low)
    ji, jw = K.transfer_weights(Pb, SI, SW, A['pos'])
    ji, wq = top4(ji, jw)
    size = K.write_skinned_glb(os.path.join(OUT, f'creature-{kind}.glb'), kind, A, ji, wq, meta['spec'], maps,
                               {'inkwell': 'creature', 'kind': kind, 'joints': meta['bones'], 'source': 'Inkwell sculpt, detailed and textured in Blender (procedural materials baked to maps)'})
    print(f'creature-{kind}.glb verts={len(A["pos"])} tris={len(A["idx"]) // 3} bytes={size}')


for k in KINDS or list(RECIPES):
    build(k)
