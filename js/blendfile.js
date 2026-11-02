// Blender .blend files, read directly (no export needed): meshes with their object transforms,
// materials (Principled BSDF base colour / roughness / metallic), UVs, smooth / flat shading,
// Mirror modifiers, and armatures with their vertex-group weights (so a rigged human poses like
// the drawing figures). Supports Blender 2.8 – 5.x files, plain, gzip- or zstd-compressed.
//
// A .blend is Blender's memory dump: a header, then blocks (code, struct type, old address,
// size), plus "SDNA" describing every struct's fields. Pointers are old addresses → blocks.

const OB_MESH = 1, OB_ARMATURE = 25;
const MOD_MIRROR = 5, MOD_ARMATURE = 8;

export async function blendToThree(buf, T) {
  const f = new BlendFile(await inflate(new Uint8Array(buf)));
  return buildScene(f, T);
}

async function inflate(u8) {
  if (u8[0] === 0x28 && u8[1] === 0xb5 && u8[2] === 0x2f && u8[3] === 0xfd) { // zstd (Blender 3.0+)
    const { decompress } = await import('../vendor/fzstd.mjs');
    return decompress(u8);
  }
  if (u8[0] === 0x1f && u8[1] === 0x8b) { // gzip (older Blender)
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  return u8;
}

// ───────── file structure ─────────
class BlendFile {
  constructor(u8) {
    const str = (a, b) => String.fromCharCode(...u8.subarray(a, b));
    if (str(0, 7) !== 'BLENDER') throw new Error('Not a Blender file');
    this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off, bhead;
    if (/\d/.test(str(7, 8))) { // Blender 5+: BLENDER17-01v0502 (64-bit sizes)
      off = parseInt(str(7, 9), 10); this.ptr = 8;
      if (str(12, 13) !== 'v') throw new Error('Big-endian .blend files are not supported');
      bhead = 32;
    } else {
      this.ptr = str(7, 8) === '-' ? 8 : 4;
      if (str(8, 9) !== 'v') throw new Error('Big-endian .blend files are not supported');
      off = 12; bhead = this.ptr === 8 ? 24 : 20;
    }
    const big = bhead === 32, dv = this.dv;
    // Blender 5 writes pointer ids that are only unique inside one data-block (ID): a block's
    // pointers resolve among the blocks that follow its ID first, then across the file
    this.blocks = []; this.byAddr = new Map(); this.scoped = new Map();
    let scope = -1;
    while (off + bhead <= u8.length) {
      const code = str(off, off + 4).replace(/\0+$/, ''); // 'ME\0\0' → 'ME'
      let len, sdna, old, nr;
      if (big) { sdna = dv.getInt32(off + 4, true); old = this.addrAt(off + 8, 8); len = Number(dv.getBigInt64(off + 16, true)); nr = Number(dv.getBigInt64(off + 24, true)); }
      else { len = dv.getInt32(off + 4, true); old = this.addrAt(off + 8, this.ptr); sdna = dv.getInt32(off + 8 + this.ptr, true); nr = dv.getInt32(off + 12 + this.ptr, true); }
      if (code === 'ENDB') break;
      if (code !== 'DATA') { scope = this.blocks.length; this.scoped.set(scope, new Map()); }
      const b = { code, sdna, old, len, nr, off: off + bhead, scope };
      this.blocks.push(b);
      if (old) {
        if (scope >= 0) this.scoped.get(scope).set(old, b);
        if (code !== 'DATA' || !this.byAddr.has(old)) this.byAddr.set(old, b); // data-blocks win the global name
      }
      off += bhead + len;
    }
    this.parseSDNA(this.blocks.find((b) => b.code === 'DNA1'));
  }
  // pointers as exact keys (Blender 5 writes 64-bit ids beyond a double's precision); null = 0
  addrAt(o, size = this.ptr) {
    const lo = this.dv.getUint32(o, true), hi = size === 8 ? this.dv.getUint32(o + 4, true) : 0;
    return lo || hi ? hi.toString(16) + ':' + lo.toString(16) : 0;
  }
  parseSDNA(b) {
    const u8 = this.u8, dv = this.dv, base = b.off;
    let p = base + 4; // 'SDNA'
    const align = () => { p = base + ((p - base + 3) & ~3); };
    const strings = (n) => { const out = []; for (let i = 0; i < n; i++) { let e = p; while (u8[e]) e++; out.push(String.fromCharCode(...u8.subarray(p, e))); p = e + 1; } return out; };
    const count = () => { p += 4; const n = dv.getInt32(p, true); p += 4; return n; }; // 'NAME' / 'TYPE' / 'STRC' + count
    const names = strings(count()); align();
    const types = strings(count()); align();
    p += 4; const tlen = []; for (let i = 0; i < types.length; i++) { tlen.push(dv.getInt16(p, true)); p += 2; } align(); // 'TLEN'
    const ns = count();
    this.types = types; this.tlen = tlen; this.structs = []; this.structOf = new Map();
    for (let s = 0; s < ns; s++) {
      const t = dv.getInt16(p, true), nf = dv.getInt16(p + 2, true); p += 4;
      const fields = new Map(); let o = 0;
      for (let k = 0; k < nf; k++) {
        const ft = dv.getInt16(p, true), raw = names[dv.getInt16(p + 2, true)]; p += 4;
        const isPtr = raw.startsWith('*') || raw.startsWith('(*'), dims = [...raw.matchAll(/\[(\d+)\]/g)].map((m) => +m[1]);
        const count = dims.reduce((a, b2) => a * b2, 1), size = (isPtr ? this.ptr : tlen[ft]) * count;
        const name = raw.replace(/^\(?\*+/, '').replace(/\)\(.*$/, '').replace(/\[.*$/, '');
        fields.set(name, { type: types[ft], ptr: isPtr, dims, count, offset: o, size, ptrDepth: (raw.match(/^\**/)[0] || '').length });
        o += size;
      }
      const st = { name: types[t], size: tlen[t], fields };
      this.structs.push(st); this.structOf.set(st.name, st);
    }
  }
  // a struct instance: s(name) reads a field, s.at(name) the nested struct at that field,
  // s.item(name) / s.bytes(name) / s.str(name) follow a pointer field (in this block's scope)
  view(structName, at, scope = this.scopeAt(at)) {
    const st = typeof structName === 'number' ? this.structs[structName] : this.structOf.get(structName);
    if (!st) return null;
    const f = this, dv = this.dv;
    const get = (name) => {
      const fd = st.fields.get(name); if (!fd) return undefined;
      const o = at + fd.offset;
      if (fd.ptr) return fd.count > 1 ? Array.from({ length: fd.count }, (_, i) => f.addrAt(o + i * f.ptr)) : f.addrAt(o);
      const one = (oo) => {
        switch (fd.type) {
          case 'char': case 'int8_t': return dv.getInt8(oo);
          case 'uchar': case 'uint8_t': return dv.getUint8(oo);
          case 'short': case 'int16_t': return dv.getInt16(oo, true);
          case 'ushort': case 'uint16_t': return dv.getUint16(oo, true);
          case 'int': case 'int32_t': return dv.getInt32(oo, true);
          case 'uint': case 'uint32_t': return dv.getUint32(oo, true);
          case 'float': return dv.getFloat32(oo, true);
          case 'double': return dv.getFloat64(oo, true);
          case 'int64_t': case 'uint64_t': return Number(dv.getBigInt64(oo, true));
          default: return null;
        }
      };
      if (fd.type === 'char' && fd.count > 1) { let e = o; while (e < o + fd.count && f.u8[e]) e++; return new TextDecoder().decode(f.u8.subarray(o, e)); }
      if (fd.count > 1) { const sz = fd.size / fd.count; return Array.from({ length: fd.count }, (_, i) => one(o + i * sz)); }
      return one(o);
    };
    get.at = (name) => { const fd = st.fields.get(name); return fd && f.view(fd.type, at + fd.offset, scope); };
    get.has = (name) => st.fields.has(name);
    get.item = (name, i = 0, sn = null) => f.item(get(name), i, sn, scope);
    get.bytes = (name) => f.bytes(get(name), scope);
    get.str = (name) => f.cstr(get(name), scope);
    get.block = (name) => f.block(get(name), scope);
    get.struct = st; get.off = at; get.scope = scope;
    return get;
  }
  scopeAt(at) { // the scope of the block containing a file offset
    let lo = 0, hi = this.blocks.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.blocks[m].off <= at) lo = m; else hi = m - 1; }
    return this.blocks[lo] ? this.blocks[lo].scope : -1;
  }
  block(addr, scope = -1) { return addr ? (scope >= 0 && this.scoped.get(scope).get(addr)) || this.byAddr.get(addr) || null : null; }
  // the struct a block holds (its i-th element)
  item(addr, i = 0, structName = null, scope = -1) {
    const b = this.block(addr, scope); if (!b) return null;
    const st = structName ? this.structOf.get(structName) : this.structs[b.sdna];
    return st ? this.view(st.name, b.off + i * st.size, b.scope) : null;
  }
  bytes(addr, scope = -1) { const b = this.block(addr, scope); return b ? this.u8.subarray(b.off, b.off + b.len) : null; }
  cstr(addr, scope = -1) { const b = this.bytes(addr, scope); if (!b) return ''; let e = 0; while (e < b.length && b[e]) e++; return new TextDecoder().decode(b.subarray(0, e)); }
  // a ListBase: follow `first` → next
  list(lb, structName = null) {
    const out = []; let a = lb('first'), guard = 0;
    while (a && guard++ < 100000) { const v = this.item(a, 0, structName, lb.scope); if (!v) break; out.push(v); a = v('next'); }
    return out;
  }
  ofCode(code) { return this.blocks.filter((b) => b.code === code).map((b) => this.view(b.sdna, b.off, b.scope)); }
}

// typed views of raw data blocks (copied: block offsets need not be aligned)
const f32 = (u8) => u8 && new Float32Array(u8.slice().buffer);
const i32 = (u8) => u8 && new Int32Array(u8.slice(0, u8.length & ~3).buffer);

// ───────── meshes ─────────
// every generic attribute of a mesh by name: { domain, data (Uint8Array), elem (bytes) }
function meshAttributes(f, me, counts) {
  const out = new Map();
  if (me.has('attribute_storage')) { // Blender 5+
    const as = me.at('attribute_storage'), n = as('dna_attributes_num'), first = as('dna_attributes');
    for (let i = 0; i < n; i++) {
      const a = as.item('dna_attributes', i, 'Attribute'); if (!a) continue;
      const name = a.str('name'), domain = a('domain');
      let data = null;
      if (a('storage_type') === 0) { const arr = a.item('data', 0, 'AttributeArray'); data = arr && arr.bytes('data'); }
      else { const one = a.item('data', 0, 'AttributeSingle'); data = one && one.bytes('data'); } // one value for the whole domain
      if (data) out.set(name, { domain, data, single: a('storage_type') !== 0 });
    }
  }
  // CustomData layers (Blender 2.8 – 4.x, and anything not in the attribute storage)
  const doms = [['vdata', 0], ['edata', 1], ['pdata', 2], ['ldata', 3]];
  for (const [field, domain] of doms) {
    if (!me.has(field)) continue;
    const cd = me.at(field), n = cd('totlayer'), first = cd('layers');
    for (let i = 0; i < n; i++) {
      const l = cd.item('layers', i, 'CustomDataLayer'); if (!l) continue;
      const name = l('name'), data = l.bytes('data');
      if (!data) continue;
      const key = name || '#type' + l('type');
      if (!out.has(key)) out.set(key, { domain, data, type: l('type'), block: l.block('data') });
    }
  }
  for (const a of out.values()) { const c = counts[a.domain] || 1; a.elem = a.single ? a.data.length : Math.round(a.data.length / c); }
  return out;
}

function readMesh(f, me) {
  const pick = (...n) => { for (const k of n) if (me.has(k)) return me(k); return 0; };
  const nv = pick('totvert', 'verts_num'), nf = pick('totpoly', 'faces_num'), nl = pick('totloop', 'corners_num');
  const A = meshAttributes(f, me, [nv, pick('totedge', 'edges_num'), nf, nl]);
  // positions
  let pos = A.get('position') ? f32(A.get('position').data) : null;
  if (!pos && me('mvert')) { // ≤ 3.4: MVert { co[3], … }
    const st = f.structOf.get('MVert'), b = me.bytes('mvert'); pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = f.dv.getFloat32(b.byteOffset - f.u8.byteOffset + i * st.size + k * 4, true);
  }
  if (!pos) return null;
  // faces → corners
  let offs = null, mat = null, smooth = null, cv = null;
  const offsKey = ['poly_offset_indices', 'face_offset_indices'].find((k) => me.has(k) && me(k));
  if (offsKey) offs = i32(me.bytes(offsKey));
  if (A.get('.corner_vert')) cv = i32(A.get('.corner_vert').data);
  if ((!offs || !cv) && me('mpoly')) { // ≤ 3.5: MPoly { loopstart, totloop, mat_nr, flag }, MLoop { v, e }
    const ps = f.structOf.get('MPoly'), pb = me.bytes('mpoly'), base = pb.byteOffset - f.u8.byteOffset;
    offs = new Int32Array(nf + 1); mat = new Int32Array(nf); smooth = new Uint8Array(nf);
    const fo = ps.fields;
    for (let i = 0; i < nf; i++) {
      const o = base + i * ps.size;
      offs[i] = f.dv.getInt32(o + fo.get('loopstart').offset, true);
      if (fo.has('mat_nr')) mat[i] = f.dv.getInt16(o + fo.get('mat_nr').offset, true);
      if (fo.has('flag')) smooth[i] = f.dv.getInt8(o + fo.get('flag').offset) & 1;
    }
    offs[nf] = nl;
    if (!cv && me('mloop')) { const ls = f.structOf.get('MLoop'), lb = me.bytes('mloop'), lbase = lb.byteOffset - f.u8.byteOffset; cv = new Int32Array(nl); for (let i = 0; i < nl; i++) cv[i] = f.dv.getInt32(lbase + i * ls.size, true); }
  }
  if (!offs || !cv) return null;
  if (A.get('material_index')) { const a = A.get('material_index'); mat = a.single ? new Int32Array(nf).fill(i32(a.data)[0]) : i32(a.data); }
  if (A.get('sharp_face')) { const a = A.get('sharp_face'); smooth = new Uint8Array(nf); for (let i = 0; i < nf; i++) smooth[i] = (a.single ? a.data[0] : a.data[i]) ? 0 : 1; }
  if (!smooth) smooth = new Uint8Array(nf).fill(1);
  // UVs: the first corner float2 attribute (or the old MLoopUV layer)
  let uv = null;
  for (const [name, a] of A) {
    if (a.domain !== 3 || name.startsWith('.')) continue;
    if (a.elem === 8 && (a.type === undefined || a.type === 49)) { uv = f32(a.data); break; }
    if (a.type === 16) { const st = f.structOf.get('MLoopUV'), s = st ? st.size : 12; uv = new Float32Array(nl * 2); const d = f32(a.data); for (let i = 0; i < nl; i++) { uv[i * 2] = d[i * s / 4]; uv[i * 2 + 1] = d[i * s / 4 + 1]; } break; }
  }
  // vertex groups (for armatures)
  let groups = null;
  if (me.has('vertex_group_names')) groups = f.list(me.at('vertex_group_names'), 'bDeformGroup').map((g) => g('name'));
  let dvert = null;
  // vertex weights: the mesh's dvert array, or (newer files) a CustomData layer of the same structs
  const dvBlock = me('dvert') ? me.block('dvert') : (A.get('#type2') || {}).block;
  if (dvBlock) {
    const ds = f.structOf.get('MDeformVert'), ws = f.structOf.get('MDeformWeight'), b = dvBlock;
    dvert = [];
    for (let i = 0; i < nv; i++) {
      const v = f.view('MDeformVert', b.off + i * ds.size), n = v('totweight'), wb = v.block('dw'), list = [];
      for (let k = 0; wb && k < n; k++) { const w = f.view('MDeformWeight', wb.off + k * ws.size); list.push([w('def_nr'), w('weight')]); }
      dvert.push(list);
    }
  }
  // materials
  const mats = [], ma = me('mat'), nmat = me('totcol');
  if (ma && nmat) { const b = me.block('mat'); for (let i = 0; b && i < nmat; i++) mats.push(f.addrAt(b.off + i * f.ptr)); }
  return { pos, offs, cv, mat, smooth, uv, mats, groups, dvert, nf };
}

// triangulated, per-corner geometry (normals: smooth faces share vertex normals)
function meshGeometry(T, m, mirrorAxes) {
  const { pos, offs, cv, mat, smooth, uv, nf } = m, nv = pos.length / 3;
  const fn = new Float32Array(nf * 3), vn = new Float32Array(nv * 3);
  for (let i = 0; i < nf; i++) {
    const a = offs[i], n = offs[i + 1] - a; let x = 0, y = 0, z = 0;
    for (let k = 0; k < n; k++) { // Newell's method
      const p = cv[a + k] * 3, q = cv[a + (k + 1) % n] * 3;
      x += (pos[p + 1] - pos[q + 1]) * (pos[p + 2] + pos[q + 2]); y += (pos[p + 2] - pos[q + 2]) * (pos[p] + pos[q]); z += (pos[p] - pos[q]) * (pos[p + 1] + pos[q + 1]);
    }
    fn.set([x, y, z], i * 3);
    if (smooth[i]) for (let k = 0; k < n; k++) { const v = cv[a + k] * 3; vn[v] += x; vn[v + 1] += y; vn[v + 2] += z; }
  }
  const P = [], N = [], U = [], V = [], groups = new Map();
  const sides = [[1, 1, 1]];
  for (const ax of mirrorAxes) for (const s of [...sides]) { const t = s.slice(); t[ax] = -1; sides.push(t); }
  for (const sgn of sides) {
    const flip = sgn[0] * sgn[1] * sgn[2] < 0;
    for (let i = 0; i < nf; i++) {
      const a = offs[i], n = offs[i + 1] - a, mi = mat ? mat[i] : 0;
      if (!groups.has(mi)) groups.set(mi, []);
      const list = groups.get(mi);
      for (let k = 1; k + 1 < n; k++) {
        const tri = flip ? [a, a + k + 1, a + k] : [a, a + k, a + k + 1];
        for (const c of tri) {
          const v = cv[c], nn = smooth[i] ? vn.subarray(v * 3, v * 3 + 3) : fn.subarray(i * 3, i * 3 + 3);
          list.push(P.length / 3);
          P.push(pos[v * 3] * sgn[0], pos[v * 3 + 1] * sgn[1], pos[v * 3 + 2] * sgn[2]);
          N.push(nn[0] * sgn[0], nn[1] * sgn[1], nn[2] * sgn[2]);
          if (uv) U.push(uv[c * 2], uv[c * 2 + 1]);
          V.push(v);
        }
      }
    }
  }
  const g = new T.BufferGeometry();
  // corners in material order, one draw group per material slot
  const order = [];
  for (const [mi, list] of [...groups].sort((x, y) => x[0] - y[0])) { g.addGroup(order.length, list.length, Math.max(0, mi)); for (const c of list) order.push(c); }
  const re = (src, k) => { const out = new Float32Array(order.length * k); order.forEach((c, i) => { for (let j = 0; j < k; j++) out[i * k + j] = src[c * k + j]; }); return out; };
  g.setAttribute('position', new T.BufferAttribute(re(P, 3), 3));
  const nrm = re(N, 3);
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  g.setAttribute('normal', new T.BufferAttribute(nrm, 3));
  if (uv) g.setAttribute('uv', new T.BufferAttribute(re(U, 2), 2));
  g.userData.srcVert = Int32Array.from(order, (c) => V[c]);
  return g;
}

// ───────── materials ─────────
function readMaterial(f, addr, T, cache) {
  if (cache.has(addr)) return cache.get(addr);
  const ma = f.item(addr);
  let color = [0.8, 0.8, 0.8], rough = 0.5, metal = 0;
  if (ma) {
    color = [ma('r'), ma('g'), ma('b')]; rough = ma('roughness') ?? 0.5; metal = ma('metallic') ?? 0;
    // the Principled BSDF's own values when the material uses nodes
    const nt = ma.has('nodetree') && ma.item('nodetree');
    if (nt) {
      for (const node of f.list(nt.at('nodes'), 'bNode')) {
        if (!/Principled|BsdfDiffuse/.test(node('idname') || '')) continue;
        for (const s of f.list(node.at('inputs'), 'bNodeSocket')) {
          const id = s('identifier') || s('name');
          if (!s('default_value')) continue;
          if (id === 'Base Color' || id === 'Color') { const v = s.item('default_value', 0, 'bNodeSocketValueRGBA'); if (v) color = v('value').slice(0, 3); }
          else if (id === 'Roughness') { const v = s.item('default_value', 0, 'bNodeSocketValueFloat'); if (v) rough = v('value'); }
          else if (id === 'Metallic') { const v = s.item('default_value', 0, 'bNodeSocketValueFloat'); if (v) metal = v('value'); }
        }
        break;
      }
    }
  }
  const m = new T.MeshStandardMaterial({ color: new T.Color().setRGB(color[0], color[1], color[2], T.LinearSRGBColorSpace), roughness: rough, metalness: metal });
  if (ma) m.name = (ma.at('id')('name') || '').slice(2);
  cache.set(addr, m);
  return m;
}

// ───────── objects ─────────
function localMatrix(T, ob) {
  const loc = ob('loc'), size = ob('size'), mode = ob('rotmode'), q = new T.Quaternion();
  if (mode === 0) { const w = ob('quat'); q.set(w[1], w[2], w[3], w[0]); }
  else if (mode === -1) { const ax = ob('rotAxis'); q.setFromAxisAngle(new T.Vector3(...ax).normalize(), ob('rotAngle')); }
  else {
    const r = ob('rot'); // Blender's euler order names list the axes applied first … last
    const order = { 1: 'ZYX', 2: 'YZX', 3: 'ZXY', 4: 'XZY', 5: 'YXZ', 6: 'XYZ' }[mode] || 'ZYX';
    q.setFromEuler(new T.Euler(r[0], r[1], r[2], order));
  }
  return new T.Matrix4().compose(new T.Vector3(...loc), q, new T.Vector3(...size));
}
function worldMatrix(T, f, ob, memo) {
  if (memo.has(ob.off)) return memo.get(ob.off);
  let m = localMatrix(T, ob);
  const par = ob.item('parent');
  if (par) {
    const pinv = new T.Matrix4().fromArray(ob('parentinv')); // column-major in the file, as three.js expects
    m = worldMatrix(T, f, par, memo).clone().multiply(pinv).multiply(m);
  }
  memo.set(ob.off, m);
  return m;
}

function buildScene(f, T) {
  const root = new T.Group(); // Blender is Z-up: turn the whole scene into Y-up
  root.rotation.x = -Math.PI / 2;
  const memo = new Map(), matCache = new Map(), armatures = new Map();
  const objects = f.ofCode('OB');
  // armatures: bones with their rest matrices (armature space), as three.js bones
  for (const ob of objects) {
    if (ob('type') !== OB_ARMATURE) continue;
    const arm = ob.item('data'); if (!arm) continue;
    const W = worldMatrix(T, f, ob, memo), bones = [], byName = new Map();
    const walk = (lb, parent, parentArm) => {
      for (const b of f.list(lb, 'Bone')) {
        const bone = new T.Bone(); bone.name = b('name');
        const am = new T.Matrix4().fromArray(b('arm_mat'));
        bone.matrix.copy(parentArm ? parentArm.clone().invert().multiply(am) : W.clone().multiply(am));
        bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
        (parent || root).add(bone); bones.push(bone); byName.set(bone.name, bone);
        walk(b.at('childbase'), bone, am);
      }
    };
    walk(arm.at('bonebase'), null, null);
    armatures.set(ob.off, { bones, byName });
  }
  // objects used only as bone display shapes aren't part of the model
  const shapes = new Set();
  for (const ob of objects) {
    const pose = ob('type') === OB_ARMATURE && ob.item('pose');
    if (pose) for (const ch of f.list(pose.at('chanbase'), 'bPoseChannel')) { const c = ch.item('custom'); if (c) shapes.add(c.off); }
  }
  let meshes = 0;
  for (const ob of objects) {
    if (ob('type') !== OB_MESH || shapes.has(ob.off)) continue;
    if ((ob('restrictflag') || 0) & 1) continue; // hidden in the viewport
    const meb = ob.item('data'); if (!meb) continue;
    const m = readMesh(f, meb); if (!m) continue;
    // modifiers: Mirror is applied; an Armature modifier (or armature parent) skins the mesh
    const mirror = [], armObs = [];
    for (const md of f.list(ob.at('modifiers'), 'ModifierData')) {
      if (!(md('mode') & 1)) continue; // off in the viewport
      if (md('type') === MOD_MIRROR) { const mm = f.view('MirrorModifierData', md.off), fl = mm('flag'); [8, 16, 32].forEach((bit, ax) => { if (fl & bit) mirror.push(ax); }); }
      if (md('type') === MOD_ARMATURE) { const am = f.view('ArmatureModifierData', md.off); if (am && am('object')) armObs.push(am.item('object')); }
    }
    if (!armObs.length && ob('parent')) { const p = ob.item('parent'); if (p && p('type') === OB_ARMATURE) armObs.push(p); }
    const geo = meshGeometry(T, m, mirror);
    const mats = m.mats.length ? m.mats.map((a) => readMaterial(f, a, T, matCache)) : [new T.MeshStandardMaterial({ color: '#cfcac2', roughness: 0.6 })];
    const W = worldMatrix(T, f, ob, memo);
    const rig = armObs.length && armatures.get(armObs[0].off);
    let mesh;
    if (rig && m.dvert && m.groups) {
      // skin weights by vertex-group name → bone
      const idx = m.groups.map((n) => rig.bones.indexOf(rig.byName.get(n)));
      const src = geo.userData.srcVert, n = src.length, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const ws = (m.dvert[src[i]] || []).map(([g, w]) => [idx[g], w]).filter(([b]) => b >= 0).sort((x, y) => y[1] - x[1]).slice(0, 4);
        const tot = ws.reduce((s, x) => s + x[1], 0) || 1;
        ws.forEach(([b, w], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = w / tot; });
      }
      geo.setAttribute('skinIndex', new T.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
      geo.applyMatrix4(W); // bind in world (armature) space
      mesh = new T.SkinnedMesh(geo, mats.length > 1 ? mats : mats[0]);
      root.add(mesh);
      root.updateMatrixWorld(true);
      mesh.bind(new T.Skeleton(rig.bones), mesh.matrixWorld);
    } else {
      mesh = new T.Mesh(geo, mats.length > 1 ? mats : mats[0]);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(W);
      root.add(mesh);
    }
    mesh.name = (ob.at('id')('name') || '').slice(2);
    meshes++;
  }
  if (!meshes) throw new Error('No meshes in this Blender file');
  const out = new T.Group(); out.add(root);
  return out;
}
