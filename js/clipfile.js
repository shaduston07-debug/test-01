// Clip Studio Paint .clip reader for the 3D panel.
//
// A .clip file is a chunk container ("CSFCHUNK"): external data blocks plus a SQLite database
// that describes the canvas. Clip Studio encrypts the 3D model and scene data itself
// (CLIP_STUDIO_3D_DATA2 blocks), so the meshes, the pose and the body shape cannot be read and
// Inkwell does not try to. Everything else in the file is plain data:
//   · the canvas preview (a PNG of the finished picture, 3D render included)
//   · each 3D layer: its camera (position, aim, lens), and its object list: drawing figures,
//     small objects / downloaded models (with their names and Clip Studio Assets ids), lights
// That is enough to rebuild the scene from Inkwell's own models and keep the Clip Studio
// render on a reference layer to match the look and pose against.
import { getSql } from './importers.js';

const u64 = (dv, p) => Number(dv.getBigUint64(p, false));

export function isClip(u8) {
  return u8.length > 24 && String.fromCharCode(...u8.subarray(0, 8)) === 'CSFCHUNK';
}

function chunks(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
  let p = 24;
  while (p + 16 <= u8.length) {
    const tag = String.fromCharCode(...u8.subarray(p, p + 8)), len = u64(dv, p + 8);
    out.push({ tag, body: u8.subarray(p + 16, p + 16 + len) });
    p += 16 + len;
  }
  return out;
}

function rows(db, sql) {
  try {
    const r = db.exec(sql)[0];
    if (!r) return [];
    return r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]])));
  } catch { return []; }
}

// what a Clip Studio object name most likely is, among Inkwell's built-in models
export function matchBuiltin(name) {
  const n = (name || '').toLowerCase();
  if (/plan(e|ar)s?\s*(of\s*the\s*)?head|asaro|head\s*plan/.test(n)) return 'planarhead';
  if (/mannequin|manikin/.test(n)) return /female|woman|girl|♀/.test(n) ? 'mannequin-female' : 'mannequin-male';
  if (/\b(male|man|boy|guy)\b|♂/.test(n) && !/female|woman/.test(n)) return 'figure-male';
  return null;
}

export async function readClip(u8) {
  if (!isClip(u8)) throw new Error('not a Clip Studio .clip file');
  const sqlChunk = chunks(u8).find((c) => c.tag === 'CHNKSQLi');
  if (!sqlChunk) throw new Error('no canvas data in this .clip');
  const SQL = await getSql();
  const db = new SQL.Database(sqlChunk.body);
  try {
    const canvas = rows(db, 'select CanvasWidth w, CanvasHeight h from Canvas')[0] || {};
    const pv = rows(db, 'select ImageData from CanvasPreview')[0];
    const preview = pv && pv.ImageData ? new Blob([pv.ImageData], { type: 'image/png' }) : null;
    const layers = rows(db, 'select MainId, LayerName, LayerVisibility from Layer where Manager3DOd is not null and Manager3DOd > 0');
    const scenes = [];
    for (const L of layers) {
      const cam = rows(db, `select * from CameraInfo where LayerId = ${L.MainId}`)[0];
      const objs = rows(db, `select * from LayerObject where LayerId = ${L.MainId} order by MainId`);
      const small = rows(db, `select * from SmallObjectInfo where LayerId = ${L.MainId}`);
      const objects = [];
      for (const o of objs) {
        const type = o.Camera ? 'camera' : o.Light ? 'light' : o.Dessindoll ? 'figure' : o.SmallObject ? 'model' : 'other';
        if (type === 'camera') continue;
        const info = small.find((s) => s.LayerObjectId === o.MainId) || {};
        objects.push({ type, name: o.ObjectName || '', visible: o.ObjectVisibility !== 0,
          assetsId: info.CanvasItemSourceMaterialAssetsContentId || null });
      }
      let camera = null;
      if (cam && cam.CameraPositionX != null) {
        // Clip Studio works in centimetres with Y up, like Inkwell (which uses metres)
        const k = 0.01;
        const fov = cam.FrustumTop && cam.FrustumNear ? (2 * Math.atan(Math.abs(cam.FrustumTop) / cam.FrustumNear) * 180) / Math.PI : 35;
        camera = {
          pos: [cam.CameraPositionX * k, cam.CameraPositionY * k, cam.CameraPositionZ * k],
          target: [cam.CameraTargetX * k, cam.CameraTargetY * k, cam.CameraTargetZ * k],
          fov: Math.max(5, Math.min(100, Math.round(fov * 10) / 10)),
          ortho: !!cam.FrustumOrtho,
        };
      }
      scenes.push({ name: L.LayerName || '3D', visible: L.LayerVisibility !== 0, camera, objects });
    }
    return { width: canvas.w || 0, height: canvas.h || 0, preview, scenes };
  } finally { db.close(); }
}

// ───────── Clip Studio pose (.pose) and body-type (.bodyproportion) materials ─────────
// Both are SQLite databases whose material record holds a plain XML document
// (<celsysdocument>…). The XML can be longer than one database page: SQLite then continues it
// on overflow pages, each starting with the 4-byte number of the next one. The pages are read
// in that order and joined; nothing in these files is encrypted.
function isTxt(b) { return b === 9 || b === 10 || b === 13 || b >= 32; } // UTF-8 names included; the page pointer after the text starts with a 0 byte
export function celsysXml(u8) {
  const sig = [60, 63, 120, 109, 108]; // "<?xml"
  let s = -1;
  outer: for (let i = 0; i < u8.length - 5; i++) { for (let k = 0; k < 5; k++) if (u8[i + k] !== sig[k]) continue outer; s = i; break; }
  if (s < 0) return null;
  let end = s; while (end < u8.length && isTxt(u8[end])) end++;
  const dec = new TextDecoder('utf-8', { fatal: false }), close = '</celsysdocument>';
  let text = dec.decode(u8.subarray(s, end));
  // the cell's last 4 bytes point to the first overflow page; pages are 4096 bytes in Clip Studio
  // materials, counted from wherever the database starts in the file
  for (const P of [4096, 1024, 2048, 8192, 16384]) {
    if (text.includes(close)) break;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (end + 4 > u8.length) break;
    let nxt = dv.getUint32(end, false), base = (end + 4) % P, out = text, guard = 0, ok = true;
    const parts = [];
    while (nxt && guard++ < 50000) {
      const p = base + (nxt - 1) * P;
      if (p < 0 || p + P > u8.length + P) { ok = false; break; }
      nxt = p + 4 <= u8.length ? dv.getUint32(p, false) : 0;
      parts.push(u8.subarray(p + 4, Math.min(u8.length, p + P)));
      const chunk = dec.decode(parts[parts.length - 1]);
      out += chunk;
      if (chunk.includes(close)) break;
    }
    if (ok && out.includes(close)) { text = out; break; }
  }
  const e = text.indexOf(close);
  return e < 0 ? null : text.slice(0, e + close.length);
}

const num3 = (s) => (s || '0 0 0').trim().split(/\s+/).map(Number);
// world position (cm) and rotation [w, x, y, z] of every bone of a Clip Studio pose
export function parseCspPose(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const pose = doc.querySelector('pose');
  if (!pose) return null;
  const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const qrot = (q, v) => qmul(qmul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]).slice(1);
  const out = {};
  const walk = (n, pp, pq) => {
    const q = num3(n.getAttribute('rotquat') || '1 0 0 0'), t = num3(n.getAttribute('trans'));
    const r = qrot(pq, t), p = [pp[0] + r[0], pp[1] + r[1], pp[2] + r[2]], wq = qmul(pq, q);
    out[(n.getAttribute('name') || '').replace(/_bb_$|_$/, '')] = { p, q: wq };
    for (const c of n.children) if (c.tagName === 'node') walk(c, p, wq);
  };
  for (const c of pose.children) if (c.tagName === 'node') walk(c, [0, 0, 0], [1, 0, 0, 0]);
  return out.hips ? out : null;
}
// Clip Studio drawing-figure body type → its own numbers
export function parseCspBody(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const b = doc.querySelector('body_proportion');
  if (!b) return null;
  const o = { name: b.getAttribute('alias_name') || '' };
  for (const a of b.getAttributeNames()) if (/^bone_/.test(a)) o[a.slice(5)] = num3(b.getAttribute(a));
  for (const k of ['tall', 'shape_fat', 'shape_muscle', 'shape_thin', 'shape_child', 'dessindoll_kind_index', 'item_scale']) o[k] = Number(b.getAttribute(k) || 0);
  return o;
}
// the material's display name, from its catalogMaterial.cac (length-prefixed strings)
export function cacName(u8) {
  const f = [], dec = new TextDecoder();
  let p = 0;
  while (p + 2 <= u8.length && f.length < 40) { const n = u8[p] | (u8[p + 1] << 8); if (p + 2 + n > u8.length) break; f.push(dec.decode(u8.subarray(p + 2, p + 2 + n))); p += 2 + n; }
  const k = f.findIndex((x) => x === 'material' || x === 'catalog');
  const name = k >= 0 ? f.slice(k + 1).find((x) => x && !/^\d+$/.test(x)) : null;
  return name || null;
}

// ───────── a zip read entry by entry (a whole Material folder can be gigabytes) ─────────
async function sliceBytes(file, a, b) { return new Uint8Array(await file.slice(a, b).arrayBuffer()); }
async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
export async function zipEntries(file) {
  const tailLen = Math.min(file.size, 70000), tail = await sliceBytes(file, file.size - tailLen, file.size);
  const dv = new DataView(tail.buffer);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip file');
  let count = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff) { // zip64
    const l = e - 20; if (l >= 0 && dv.getUint32(l, true) === 0x07064b50) {
      const z = await sliceBytes(file, Number(dv.getBigUint64(l + 8, true)), Number(dv.getBigUint64(l + 8, true)) + 56), zv = new DataView(z.buffer);
      count = Number(zv.getBigUint64(32, true)); cdSize = Number(zv.getBigUint64(40, true)); cdOff = Number(zv.getBigUint64(48, true));
    }
  }
  const cd = await sliceBytes(file, cdOff, cdOff + cdSize), cv = new DataView(cd.buffer), dec = new TextDecoder(), out = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cv.getUint32(p, true) !== 0x02014b50) break;
    const method = cv.getUint16(p + 10, true), nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
    let csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true), off = cv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
    if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) { // zip64 extra field
      let q = p + 46 + nl; const qe = q + xl;
      while (q + 4 <= qe) { const id = cv.getUint16(q, true), sz = cv.getUint16(q + 2, true); if (id === 1) { let r = q + 4; if (usize === 0xffffffff) { usize = Number(cv.getBigUint64(r, true)); r += 8; } if (csize === 0xffffffff) { csize = Number(cv.getBigUint64(r, true)); r += 8; } if (off === 0xffffffff) off = Number(cv.getBigUint64(r, true)); } q += 4 + sz; }
    }
    out.push({ name, method, csize, usize, off,
      async read() {
        const h = await sliceBytes(file, off, off + 30), hv = new DataView(h.buffer);
        const start = off + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
        const raw = await sliceBytes(file, start, start + csize);
        return method === 0 ? raw : method === 8 ? inflateRaw(raw) : Promise.reject(new Error('unsupported compression'));
      } });
    p += 46 + nl + xl + cl;
  }
  return out;
}

// every pose and body type in a Clip Studio Material folder zip, or in loose .pose /
// .bodyproportion files: [{ kind: 'pose' | 'body', name, set, data, thumb }]
export async function readCspMaterials(files, progress = () => {}) {
  const items = [];
  const add = async (kind, bytes, name, set, thumb) => {
    const xml = celsysXml(bytes); if (!xml) return;
    const data = kind === 'pose' ? parseCspPose(xml) : parseCspBody(xml);
    if (data) items.push({ kind, name: name || (kind === 'body' && data.name) || 'Pose', set: set || '', data, thumb: thumb || null });
  };
  for (const f of files) {
    const low = f.name.toLowerCase();
    if (low.endsWith('.pose')) await add('pose', new Uint8Array(await f.arrayBuffer()), f.name.replace(/\.pose$/i, ''));
    else if (low.endsWith('.bodyproportion')) await add('body', new Uint8Array(await f.arrayBuffer()), f.name.replace(/\.bodyproportion$/i, ''));
    else if (low.endsWith('.zip')) {
      const ents = await zipEntries(f), byPath = new Map(ents.map((x) => [x.name, x]));
      const mats = ents.filter((x) => /\/data\/[^/]*\.(pose|bodyproportion)$/i.test(x.name) || /^[^/]*\.(pose|bodyproportion)$/i.test(x.name));
      let n = 0;
      for (const m of mats) {
        progress(++n, mats.length);
        const dir = m.name.replace(/data\/[^/]*$/, ''), cac = byPath.get(dir + 'catalogMaterial.cac'), th = byPath.get(dir + 'thumbnail/thumbnail.png');
        let name = null, thumb = null;
        try { if (cac) name = cacName(await cac.read()); } catch {}
        try { if (th) thumb = new Blob([await th.read()], { type: 'image/png' }); } catch {}
        try { await add(/\.pose$/i.test(m.name) ? 'pose' : 'body', await m.read(), name || m.name.split('/').pop().replace(/\.[^.]+$/, ''), name || '', thumb); } catch (e) { console.warn(m.name, e); }
      }
    }
  }
  // number poses that share a set name ("idol pose 10 set【1】 · 3")
  const cnt = {}, idx = {};
  for (const it of items) cnt[it.kind + it.name] = (cnt[it.kind + it.name] || 0) + 1;
  for (const it of items) if (cnt[it.kind + it.name] > 1) { idx[it.kind + it.name] = (idx[it.kind + it.name] || 0) + 1; it.name = `${it.name} · ${idx[it.kind + it.name]}`; }
  return items;
}
