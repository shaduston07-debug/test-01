import bpy, bmesh, sys, math
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index('--') + 1:]
OUT, SEX = argv[0], argv[1]
F = SEX == 'female'
bpy.ops.wm.read_factory_settings(use_empty=True)
sh = 0.16 if F else 0.185          # shoulder joint x
hipx = 0.108 if F else 0.103
H = 1.0
# ── skeleton (Z up, facing -Y, T-pose) ──
J = {
 'hips': ((0,0,0.98), (0,0,1.08)), 'spine': ((0,0,1.08), (0,0,1.24)), 'chest': ((0,0,1.24), (0,0,1.45)),
 'neck': ((0,0,1.45), (0,-0.005,1.55)), 'head': ((0,-0.005,1.55), (0,-0.005,1.8)),
}
PAR = {'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
for s, k in (('L', 1), ('R', -1)):
    J['shoulder.'+s] = ((0.03*k,0,1.42), (sh*k,0,1.42)); PAR['shoulder.'+s] = 'chest'
    J['upper_arm.'+s] = ((sh*k,0,1.42), ((sh+0.28)*k,0,1.42)); PAR['upper_arm.'+s] = 'shoulder.'+s
    J['forearm.'+s] = (((sh+0.28)*k,0,1.42), ((sh+0.53)*k,0,1.42)); PAR['forearm.'+s] = 'upper_arm.'+s
    J['hand.'+s] = (((sh+0.53)*k,0,1.42), ((sh+0.62)*k,0,1.42)); PAR['hand.'+s] = 'forearm.'+s
    hx = sh + 0.62
    for f, y, l in (('index', -0.03, 1.0), ('middle', -0.01, 1.08), ('ring', 0.01, 1.0), ('pinky', 0.03, 0.82)):
        x0 = hx
        for i, seg in enumerate((0.04, 0.028, 0.022)):
            seg *= l * (0.92 if F else 1)
            n = f + str(i+1) + '.' + s
            J[n] = ((x0*k, y, 1.42), ((x0+seg)*k, y, 1.42)); PAR[n] = ('hand.'+s) if i == 0 else f + str(i) + '.' + s
            x0 += seg
    # thumb: from the inside of the palm, angled forward
    p = Vector(((sh+0.555)*k, -0.03, 1.41)); d = Vector((0.6*k, -0.75, -0.1)).normalized()
    for i, seg in enumerate((0.04, 0.03, 0.025)):
        n = 'thumb' + str(i+1) + '.' + s; J[n] = (tuple(p), tuple(p + d*seg)); PAR[n] = ('hand.'+s) if i == 0 else 'thumb' + str(i) + '.' + s; p = p + d*seg
    J['thigh.'+s] = ((hipx*k,0,0.97), ((hipx+0.01)*k,0,0.53)); PAR['thigh.'+s] = 'hips'
    J['shin.'+s] = (((hipx+0.01)*k,0,0.53), ((hipx+0.01)*k,0.015,0.09)); PAR['shin.'+s] = 'thigh.'+s
    J['foot.'+s] = (((hipx+0.01)*k,0.015,0.09), ((hipx+0.01)*k,-0.11,0.03)); PAR['foot.'+s] = 'shin.'+s
    J['toe.'+s] = (((hipx+0.01)*k,-0.11,0.03), ((hipx+0.01)*k,-0.17,0.025)); PAR['toe.'+s] = 'foot.'+s
ad = bpy.data.armatures.new('MannequinRig'); rig = bpy.data.objects.new('MannequinRig', ad); bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
for n, (h, t) in J.items(): b = ad.edit_bones.new(n); b.head = h; b.tail = t
for n, p in PAR.items(): ad.edit_bones[n].parent = ad.edit_bones[p]
bpy.ops.object.mode_set(mode='OBJECT')

# ── pieces ──
bm = bmesh.new(); DL = bm.verts.layers.deform.verify(); GI = {}
def tag(verts, bone):
    gi = GI.setdefault(bone, len(GI))
    for v in verts: v[DL][gi] = 1.0
def block(bone, p0, p1, w0, d0, w1=None, d1=None, bevel=0.012, segs=2, up=None):
    """tapered box from p0 to p1 (w = across, d = front-back)"""
    p0, p1 = Vector(p0), Vector(p1); w1 = w0 if w1 is None else w1; d1 = d0 if d1 is None else d1
    ax = (p1 - p0).normalized()
    side = Vector((0, 1, 0)) if abs(ax.y) < 0.9 else Vector((1, 0, 0))
    a = ax.cross(side).normalized() if up is None else Vector(up).normalized()
    b = ax.cross(a).normalized()
    res = bmesh.ops.create_cube(bm, size=1.0)
    vs = res['verts']
    for v in vs:
        t = v.co.z + 0.5; w = w0 + (w1 - w0) * t; d = d0 + (d1 - d0) * t
        v.co = p0 + (p1 - p0) * t + a * (v.co.x * w) + b * (v.co.y * d)
    tag(vs, bone)
    edges = list({e for v in vs for e in v.link_edges})
    bmesh.ops.bevel(bm, geom=vs + edges, offset=bevel, segments=segs, affect='EDGES', profile=0.6)
def ball(bone, c, r):
    res = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=9, radius=r)
    for v in res['verts']: v.co += Vector(c)
    tag(res['verts'], bone)
def V(n, i): return Vector(J[n][i])
# head: rounded block with a forward jaw
block('head', (0,-0.01,1.57), (0,-0.01,1.80), 0.15 if F else 0.16, 0.19, 0.16 if F else 0.17, 0.2, bevel=0.045, segs=4, up=(1,0,0))
block('head', (0,-0.035,1.54), (0,-0.03,1.62), 0.1, 0.11, 0.13, 0.15, bevel=0.025, segs=3, up=(1,0,0))
block('neck', (0,0,1.46), (0,-0.005,1.56), 0.075, 0.075, 0.07, 0.07, bevel=0.015, up=(1,0,0))
# torso: chest plate, abdominal plates, pelvis
cw, ww, hw = (0.29, 0.22, 0.31) if F else (0.34, 0.25, 0.29)
block('chest', (0,0,1.27), (0,0,1.47), cw*0.82, 0.19, cw, 0.2 if F else 0.21, bevel=0.03, segs=3, up=(1,0,0))
if F:
    for k in (1, -1):
        res = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.05)
        for v in res['verts']: v.co = Vector((v.co.x * 1.05 + 0.062*k, v.co.y * 0.62 - 0.088, v.co.z * 0.9 + 1.335))
        tag(res['verts'], 'chest')
block('spine', (0,0,1.20), (0,0,1.255), ww*1.04, 0.17, cw*0.8, 0.18, bevel=0.015, up=(1,0,0))
block('spine', (0,0,1.135), (0,0,1.19), ww, 0.165, ww*1.03, 0.17, bevel=0.015, up=(1,0,0))
block('hips', (0,0,1.075), (0,0,1.125), ww*1.02, 0.165, ww, 0.165, bevel=0.015, up=(1,0,0))
block('hips', (0,0.005,0.90), (0,0,1.065), hw*1.02, 0.19, ww*1.08, 0.17, bevel=0.03, segs=3, up=(1,0,0))
for s, k in (('L', 1), ('R', -1)):
    S = '.' + s
    ball('upper_arm'+S, V('upper_arm'+S, 0), 0.055 if F else 0.062)
    block('shoulder'+S, (0.05*k,0,1.43), ((sh-0.02)*k,0,1.43), 0.07, 0.09, 0.08, 0.1, bevel=0.015, up=(0,0,1))
    block('upper_arm'+S, V('upper_arm'+S,0)+Vector((0.04*k,0,0)), V('upper_arm'+S,1)-Vector((0.03*k,0,0)), 0.085 if F else 0.1, 0.085 if F else 0.1, 0.065 if F else 0.075, 0.07 if F else 0.08, bevel=0.018, up=(0,0,1))
    ball('forearm'+S, V('forearm'+S,0), 0.04 if F else 0.045)
    block('forearm'+S, V('forearm'+S,0)+Vector((0.03*k,0,0)), V('forearm'+S,1)-Vector((0.015*k,0,0)), 0.072 if F else 0.082, 0.07 if F else 0.08, 0.05, 0.045, bevel=0.015, up=(0,0,1))
    # palm (palm faces down: thin in z)
    block('hand'+S, V('hand'+S,0)+Vector((0.008*k,0,0)), V('hand'+S,1), 0.03, 0.085, 0.024, 0.09, bevel=0.008, up=(0,0,1))
    for f in ('index', 'middle', 'ring', 'pinky'):
        for i in (1, 2, 3):
            n = f + str(i) + S; w = (0.019 if f != 'pinky' else 0.016) * (0.9 if F else 1)
            block(n, V(n,0)+(V(n,1)-V(n,0))*0.06, V(n,1)-(V(n,1)-V(n,0))*0.06, w, w, w*0.9, w*0.9, bevel=0.004, up=(0,0,1))
    for i in (1, 2, 3):
        n = 'thumb' + str(i) + S; w = 0.024 * (0.9 if F else 1)
        block(n, V(n,0)+(V(n,1)-V(n,0))*0.06, V(n,1)-(V(n,1)-V(n,0))*0.06, w, w, w*0.88, w*0.88, bevel=0.005)
    ball('thigh'+S, V('thigh'+S,0)+Vector((0.012*k,0,-0.035)), 0.068)
    block('thigh'+S, V('thigh'+S,0)+Vector((0,0,-0.06)), V('thigh'+S,1)+Vector((0,0,0.03)), 0.125 if F else 0.12, 0.135, 0.08, 0.088, bevel=0.022, segs=3, up=(1,0,0))
    ball('shin'+S, V('shin'+S,0), 0.055)
    block('shin'+S, V('shin'+S,0)+Vector((0,0,-0.03)), V('shin'+S,1)+Vector((0,0,0.03)), 0.09, 0.1, 0.06, 0.065, bevel=0.02, segs=3, up=(1,0,0))
    ball('foot'+S, V('foot'+S,0), 0.042)
    block('foot'+S, V('foot'+S,0)+Vector((0,0.05,-0.04)), V('foot'+S,1)+Vector((0,0,-0.005)), 0.085, 0.075, 0.08, 0.045, bevel=0.015, up=(1,0,0))
    block('toe'+S, V('toe'+S,0)+Vector((0,-0.005,-0.002)), V('toe'+S,1), 0.08, 0.04, 0.075, 0.03, bevel=0.01, up=(1,0,0))
me = bpy.data.meshes.new('Mannequin')
bm.to_mesh(me)
ob = bpy.data.objects.new('Mannequin', me); bpy.context.scene.collection.objects.link(ob)
bm.free()
for bone, gi in sorted(GI.items(), key=lambda x: x[1]): ob.vertex_groups.new(name=bone)
for p in me.polygons: p.use_smooth = True
mat = bpy.data.materials.new('Mannequin'); mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Base Color'].default_value = (0.86, 0.86, 0.85, 1); bsdf.inputs['Roughness'].default_value = 0.5
me.materials.append(mat)
ob.parent = rig; m = ob.modifiers.new('Armature', 'ARMATURE'); m.object = rig
# smooth by angle keeps the bevelled edges crisp
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
except Exception as e: print('no smooth by angle', e)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True, export_animations=False, export_yup=True, export_apply=True)
print('tris', sum(len(p.vertices) - 2 for p in me.polygons))
