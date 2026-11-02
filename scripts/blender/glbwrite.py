# Minimal glTF 2.0 binary writer used by the Blender build scripts (numpy arrays in, .glb out).
# Supports one skinned or static primitive per mesh, morph targets, vertex colours, UVs,
# embedded textures and node hierarchies — just what the Inkwell built-in models need.
import json, struct
import numpy as np

FLOAT, UBYTE, USHORT, UINT, BYTE, SHORT = 5126, 5121, 5123, 5125, 5120, 5122
TYPES = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'}


class GLB:
    def __init__(self):
        self.j = {'asset': {'version': '2.0', 'generator': 'Inkwell Studio Blender build'}, 'scenes': [{'nodes': []}], 'scene': 0,
                  'nodes': [], 'meshes': [], 'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}], 'materials': []}
        self.bin = bytearray()
        self.morph_scales = []

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, arr, comp, ncomp, normalized=False, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        dt = {FLOAT: np.float32, UBYTE: np.uint8, USHORT: np.uint16, UINT: np.uint32, BYTE: np.int8, SHORT: np.int16}[comp]
        arr = arr.astype(dt)
        bv = self._view(arr.tobytes(), target)
        a = {'bufferView': bv, 'componentType': comp, 'count': int(arr.size // ncomp), 'type': TYPES[ncomp]}
        if normalized:
            a['normalized'] = True
        if minmax:
            r = arr.reshape(-1, ncomp)
            a['min'] = [float(x) for x in r.min(0)]
            a['max'] = [float(x) for x in r.max(0)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def image(self, data, mime='image/jpeg'):
        bv = self._view(data)
        self.j.setdefault('images', []).append({'bufferView': bv, 'mimeType': mime})
        self.j.setdefault('samplers', [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}])
        self.j.setdefault('textures', []).append({'sampler': 0, 'source': len(self.j['images']) - 1})
        return len(self.j['textures']) - 1

    def material(self, name, color=(0.8, 0.8, 0.8, 1), rough=0.6, metal=0.0, base_tex=None, normal_tex=None, orm_tex=None, double=False,
                 emissive=None, emissive_tex=None, clearcoat=None, occlusion=True, blend=False):
        pbr = {'baseColorFactor': list(color), 'roughnessFactor': rough, 'metallicFactor': metal}
        if base_tex is not None:
            pbr['baseColorTexture'] = {'index': base_tex}
        if orm_tex is not None:
            pbr['metallicRoughnessTexture'] = {'index': orm_tex}
        m = {'name': name, 'pbrMetallicRoughness': pbr}
        if normal_tex is not None:
            m['normalTexture'] = {'index': normal_tex}
        if orm_tex is not None and occlusion:
            m['occlusionTexture'] = {'index': orm_tex}
        if emissive is not None:
            m['emissiveFactor'] = list(emissive)
        if emissive_tex is not None:
            m['emissiveTexture'] = {'index': emissive_tex}
        if clearcoat is not None:
            m['extensions'] = {'KHR_materials_clearcoat': {'clearcoatFactor': clearcoat[0], 'clearcoatRoughnessFactor': clearcoat[1]}}
            self.j.setdefault('extensionsUsed', [])
            if 'KHR_materials_clearcoat' not in self.j['extensionsUsed']:
                self.j['extensionsUsed'].append('KHR_materials_clearcoat')
        if blend:
            m['alphaMode'] = 'BLEND'
        if double:
            m['doubleSided'] = True
        self.j['materials'].append(m)
        return len(self.j['materials']) - 1

    def node(self, name, translation=None, children=None, mesh=None, skin=None, extras=None):
        n = {'name': name}
        if translation is not None:
            n['translation'] = [float(x) for x in translation]
        if children:
            n['children'] = children
        if mesh is not None:
            n['mesh'] = mesh
        if skin is not None:
            n['skin'] = skin
        if extras:
            n['extras'] = extras
        self.j['nodes'].append(n)
        return len(self.j['nodes']) - 1

    def primitive(self, pos, idx, material=None, normal=None, uv=None, color=None, joints=None, weights=None, targets=None, tangent=None):
        nv = len(pos)
        at = {'POSITION': self.accessor(pos, FLOAT, 3, target=34962, minmax=True)}
        if normal is not None:
            at['NORMAL'] = self.accessor(normal, FLOAT, 3, target=34962)
        if tangent is not None:
            at['TANGENT'] = self.accessor(tangent, FLOAT, 4, target=34962)
        if uv is not None:
            at['TEXCOORD_0'] = self.accessor(uv, FLOAT, 2, target=34962)
        if color is not None:
            at['COLOR_0'] = self.accessor(np.clip(np.round(color * 255), 0, 255), UBYTE, color.shape[1], normalized=True, target=34962)
        if joints is not None:
            at['JOINTS_0'] = self.accessor(joints, UBYTE, 4, target=34962)
            at['WEIGHTS_0'] = self.accessor(weights, UBYTE, 4, normalized=True, target=34962)
        p = {'attributes': at, 'indices': self.accessor(idx, USHORT if nv < 65536 else UINT, 1, target=34963)}
        if material is not None:
            p['material'] = material
        if targets:
            p['targets'] = [{'POSITION': self.morph(t)} for t in targets]
        return p

    def morph(self, t):
        """morph deltas as normalized int16 (KHR_mesh_quantization); the scale goes in self.morph_scales"""
        s = float(np.abs(t).max()) or 1.0
        q = np.round(t / s * 32767).astype(np.int16)
        a = self.accessor(q, SHORT, 3, normalized=True, target=34962, minmax=True)
        self.morph_scales.append(s)
        for k in ('extensionsUsed', 'extensionsRequired'):
            self.j.setdefault(k, [])
            if 'KHR_mesh_quantization' not in self.j[k]:
                self.j[k].append('KHR_mesh_quantization')
        return a

    def mesh(self, name, prims, target_names=None):
        m = {'name': name, 'primitives': prims}
        if target_names:
            m['weights'] = [0.0] * len(target_names)
            m['extras'] = {'targetNames': target_names}
        self.j['meshes'].append(m)
        return len(self.j['meshes']) - 1

    def skin(self, joint_nodes, inv_bind, skeleton=None):
        s = {'joints': joint_nodes, 'inverseBindMatrices': self.accessor(inv_bind, FLOAT, 16)}
        if skeleton is not None:
            s['skeleton'] = skeleton
        self.j.setdefault('skins', []).append(s)
        return len(self.j['skins']) - 1

    def save(self, path, extras=None, roots=None):
        if extras:
            self.j['scenes'][0]['extras'] = extras
        self.j['scenes'][0]['nodes'] = roots or [0]
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j['buffers'][0]['byteLength'] = len(self.bin)
        for k in ['materials', 'meshes']:
            if not self.j[k]:
                del self.j[k]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<4sII', b'glTF', 2, total))
            f.write(struct.pack('<I4s', len(js), b'JSON'))
            f.write(js)
            f.write(struct.pack('<I4s', len(self.bin), b'BIN\x00'))
            f.write(self.bin)
        return total


def top4(idx, w):
    """(n, k) bone indices / weights → the 4 strongest, renormalised, as uint8 arrays"""
    order = np.argsort(-w, axis=1)[:, :4]
    r = np.arange(len(w))[:, None]
    ji, ww = idx[r, order], w[r, order]
    if ji.shape[1] < 4:
        pad = 4 - ji.shape[1]
        ji = np.pad(ji, ((0, 0), (0, pad)))
        ww = np.pad(ww, ((0, 0), (0, pad)))
    s = ww.sum(1, keepdims=True)
    s[s == 0] = 1
    ww = ww / s
    q = np.round(ww * 255).astype(np.int32)
    q[:, 0] += 255 - q.sum(1)  # exact sum after rounding
    q[ww.sum(1) == 0] = 0
    return ji.astype(np.uint8), np.clip(q, 0, 255).astype(np.uint8)
