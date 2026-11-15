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
