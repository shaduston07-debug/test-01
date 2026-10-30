// Brush importers: Clip Studio Paint (.sut), Procreate (.brush / .brushset), images (.png/.jpg).
import { loadScript, loadImage, clamp } from './util.js';
import { BRUSH_DEFAULTS, rawImageToMaskCanvas, newBrushFrom } from './brushes.js';

let SQLp = null;
async function getSql() {
  if (!SQLp) {
    SQLp = loadScript('vendor/sql-wasm.js').then(() => window.initSqlJs({ locateFile: (f) => 'vendor/' + f }));
  }
  return SQLp;
}
async function getZip() {
  await loadScript('vendor/jszip.min.js');
  return window.JSZip;
}

export async function importBrushFiles(files) {
  const out = [], notes = [];
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'sut') out.push(...(await importSut(f, notes)));
      else if (ext === 'brush' || ext === 'brushset') out.push(...(await importProcreate(f, notes)));
      else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) out.push(await importImageTip(f));
      else if (ext === 'abr') notes.push(`${f.name}: Photoshop .abr isn't supported yet — export the tip as PNG and import that.`);
      else notes.push(`${f.name}: unknown brush format`);
    } catch (e) {
      console.error(e);
      notes.push(`${f.name}: ${e.message || e}`);
    }
  }
  return { brushes: out, notes };
}

const baseName = (n) => n.replace(/\.[^.]+$/, '');

async function blobToImg(bytes, type = 'image/png') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

// ───────── Clip Studio Paint .sut ─────────
// A .sut is a SQLite database. Brush parameters live in the Variant table; tip and texture
// images live in MaterialFile.FileData blobs, which embed PNG streams.
function extractPngs(u8) {
  const out = [];
  if (!u8 || !u8.length) return out;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < u8.length - 8; i++) {
    if (u8[i] !== 0x89) continue;
    let ok = true;
    for (let k = 1; k < 8; k++) if (u8[i + k] !== sig[k]) { ok = false; break; }
    if (!ok) continue;
    // walk chunks until IEND
    let p = i + 8;
    while (p + 8 <= u8.length) {
      const len = (u8[p] << 24 | u8[p + 1] << 16 | u8[p + 2] << 8 | u8[p + 3]) >>> 0;
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      p += 12 + len;
      if (type === 'IEND' || len > u8.length) break;
    }
    if (p <= u8.length) out.push(u8.slice(i, p));
    i = p - 1;
  }
  return out;
}

function rows(db, sql) {
  try {
    const r = db.exec(sql);
    if (!r[0]) return [];
    return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])));
  } catch { return []; }
}
const pick = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === n.toLowerCase());
    if (key != null && row[key] != null) return row[key];
  }
  return undefined;
};
const isBlobOn = (v) => v instanceof Uint8Array ? v.length > 0 : !!v;

async function importSut(file, notes) {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  const nodes = rows(db, 'SELECT * FROM Node');
  const variants = rows(db, 'SELECT * FROM Variant');
  const materials = rows(db, 'SELECT * FROM MaterialFile');
  db.close();
  if (!variants.length && !materials.length) throw new Error('No CSP brush data found (is this a sub-tool file?)');

  // decode every embedded image once, largest first
  const imgs = [];
  for (const m of materials) {
    for (const png of extractPngs(pick(m, 'FileData'))) {
      try { const img = await blobToImg(png); imgs.push({ img, area: img.naturalWidth * img.naturalHeight, mat: m }); } catch { /* skip */ }
    }
  }
  const brushImgs = imgs.filter((x) => x.area > 16 * 16);

  const variantNodes = nodes.filter((n) => pick(n, 'NodeVariantID') != null);
  const list = variantNodes.length ? variantNodes : [{ NodeName: baseName(file.name), NodeVariantID: pick(variants[0] || {}, 'VariantID') }];
  const out = [];
  for (const node of list) {
    const v = variants.find((x) => pick(x, 'VariantID') === pick(node, 'NodeVariantID')) || variants[0] || {};
    const name = pick(node, 'NodeName') || baseName(file.name);
    const size = Number(pick(v, 'BrushSize') ?? 20);
    const op = Number(pick(v, 'Opacity') ?? 100);
    const hard = Number(pick(v, 'BrushHardness') ?? 100);
    const interval = Number(pick(v, 'BrushInterval') ?? 10);
    const thick = Number(pick(v, 'BrushThickness') ?? 100);
    const rot = Number(pick(v, 'BrushRotation') ?? 0);
    const flow = Number(pick(v, 'BrushFlow', 'BrushDensity') ?? 100);
    const revision = Number(pick(v, 'BrushRevision', 'BrushRevisionBySpeed') ?? 0);
    const usePattern = !!pick(v, 'BrushUsePatternImage');
    const useSpray = !!pick(v, 'BrushUseSpray');
    const texture = pick(v, 'TextureImage', 'BrushTexture');
    const texDensity = Number(pick(v, 'TextureDensity', 'BrushTextureDensity') ?? 100);
    const sizeEff = pick(v, 'BrushSizeEffector');
    const flowEff = pick(v, 'BrushFlowEffector', 'OpacityEffector');

    const brush = newBrushFrom(BRUSH_DEFAULTS, {
      name, category: 'Imported', source: 'Clip Studio',
      size: clamp(size > 0 ? size : 20, 1, 500), maxSize: clamp(Math.max(size * 2.5, 60), 20, 1000),
      opacity: clamp(op > 1 ? op / 100 : op || 1, 0.05, 1),
      flow: clamp(flow > 1 ? flow / 100 : flow || 1, 0.02, 1),
      hardness: clamp(hard > 1 ? hard / 100 : hard, 0, 1),
      spacing: clamp(interval > 2 ? interval / 100 : interval || 0.1, 0.02, 3),
      roundness: clamp(thick > 1 ? thick / 100 : thick || 1, 0.05, 1),
      rotation: rot,
      streamline: clamp(revision / 100, 0, 0.9),
      sizePressure: isBlobOn(sizeEff) ? 0.9 : 0,
      opacityPressure: isBlobOn(flowEff) ? 0.5 : 0,
      scatter: useSpray ? 0.6 : 0,
      sizeJitter: useSpray ? 0.4 : 0,
      taper: 0.2,
    });
    if ((usePattern || brushImgs.length) && brushImgs.length) {
      // the tip is normally the first non-texture image
      const tipCand = brushImgs.find((x) => !texture || brushImgs.length === 1 || x !== brushImgs[brushImgs.length - 1]) || brushImgs[0];
      brush.tipImage = rawImageToMaskCanvas(tipCand.img, 'csp').toDataURL();
      brush.tip = 'image';
      if (texture && brushImgs.length > 1) {
        brush.grainImage = invertedMask(brushImgs[brushImgs.length - 1].img);
        brush.grainDepth = clamp(texDensity > 1 ? texDensity / 100 : texDensity, 0, 1);
      }
    }
    out.push(brush);
  }
  notes.push(`${file.name}: imported ${out.length} brush${out.length === 1 ? '' : 'es'} (${brushImgs.length} image${brushImgs.length === 1 ? '' : 's'} found)`);
  return out;
}

// CSP textures: dark areas hold ink → convert to "light = paint" grain mask
function invertedMask(img) {
  const c = rawImageToMaskCanvas(img, 'csp');
  return c.toDataURL();
}

// ───────── Procreate .brush / .brushset ─────────
export function parseBplist(u8) {
  const head = String.fromCharCode(...u8.slice(0, 6));
  if (head !== 'bplist') return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const T = u8.length - 32;
  const offSize = u8[T + 6], refSize = u8[T + 7];
  const num = Number(dv.getBigUint64(T + 8)), top = Number(dv.getBigUint64(T + 16)), tableOff = Number(dv.getBigUint64(T + 24));
  const readN = (pos, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + u8[pos + i]; return v; };
  const offs = new Array(num);
  for (let i = 0; i < num; i++) offs[i] = readN(tableOff + i * offSize, offSize);
  const cache = new Map();
  const obj = (i, depth = 0) => {
    if (cache.has(i)) return cache.get(i);
    if (depth > 64) return null;
    const pos = offs[i], m = u8[pos], type = m >> 4, info = m & 15;
    const len = () => {
      if (info !== 15) return [info, pos + 1];
      const n = 1 << (u8[pos + 1] & 15);
      return [readN(pos + 2, n), pos + 2 + n];
    };
    let v = null;
    switch (type) {
      case 0: v = info === 8 ? false : info === 9 ? true : null; break;
      case 1: { const n = 1 << info; v = n === 8 ? Number(dv.getBigInt64(pos + 1)) : readN(pos + 1, n); break; }
      case 2: v = info === 2 ? dv.getFloat32(pos + 1) : dv.getFloat64(pos + 1); break;
      case 3: v = dv.getFloat64(pos + 1); break;
      case 4: { const [l, p] = len(); v = u8.slice(p, p + l); break; }
      case 5: { const [l, p] = len(); v = String.fromCharCode(...u8.slice(p, p + l)); break; }
      case 6: { const [l, p] = len(); let s = ''; for (let k = 0; k < l; k++) s += String.fromCharCode(dv.getUint16(p + k * 2)); v = s; break; }
      case 8: v = { UID: readN(pos + 1, info + 1) }; break;
      case 10: { const [l, p] = len(); v = []; cache.set(i, v); for (let k = 0; k < l; k++) v.push(obj(readN(p + k * refSize, refSize), depth + 1)); break; }
      case 13: {
        const [l, p] = len(); v = {}; cache.set(i, v);
        for (let k = 0; k < l; k++) {
          const key = obj(readN(p + k * refSize, refSize), depth + 1);
          v[key] = obj(readN(p + (l + k) * refSize, refSize), depth + 1);
        }
        break;
      }
      default: v = null;
    }
    cache.set(i, v);
    return v;
  };
  return obj(top);
}

function unarchive(plist) {
  if (!plist || !plist.$objects) return plist || {};
  const objs = plist.$objects;
  const rootRef = plist.$top && (plist.$top.root || Object.values(plist.$top)[0]);
  const res = (v, d = 0) => {
    if (v && typeof v === 'object' && 'UID' in v) { const o = objs[v.UID]; return o === '$null' ? null : d < 3 ? res(o, d + 1) : o; }
    return v;
  };
  const root = res(rootRef) || {};
  const flat = {};
  for (const [k, v] of Object.entries(root)) flat[k] = res(v);
  return flat;
}

function procreateSettings(archive, name) {
  const g = (k, d) => (typeof archive[k] === 'number' ? archive[k] : d);
  const o = { name: typeof archive.name === 'string' && archive.name ? archive.name : name };
  o.spacing = clamp(g('plotSpacing', 0.1), 0.01, 3);
  o.scatter = clamp(g('plotJitter', 0), 0, 3);
  o.streamline = clamp(g('plotSmoothing', 0.3), 0, 0.95);
  o.sizePressure = clamp(g('dynamicsPressureSize', 0.6), 0, 1);
  o.opacityPressure = clamp(g('dynamicsPressureOpacity', 0), 0, 1);
  o.roundness = clamp(g('shapeRoundness', 1), 0.05, 1);
  o.rotation = g('shapeRotation', 0) * 180;
  o.angleJitter = clamp(g('shapeScatter', 0), 0, 1);
  o.sizeJitter = clamp(g('dynamicsJitterSize', 0), 0, 1);
  o.grainScale = clamp(g('textureScale', 1) || 1, 0.1, 5);
  o.grainDepth = clamp(g('textureDepth', g('grainDepth', 0.7)), 0, 1);
  o.follow = archive.shapeOrientation === 1 || archive.shapeOrientation === 2;
  o.invertTip = !!archive.shapeInverted;
  const max = g('maxSize', 0);
  if (max > 1) o.maxSize = clamp(max, 10, 1000);
  return o;
}

async function importProcreate(file, notes) {
  const JSZip = await getZip();
  const zip = await JSZip.loadAsync(file);
  const folders = new Map();
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const parts = path.split('/');
    const fname = parts.pop();
    const folder = parts.join('/');
    if (!folders.has(folder)) folders.set(folder, {});
    folders.get(folder)[fname] = entry;
  });
  const out = [];
  const setName = baseName(file.name);
  let idx = 0;
  for (const [folder, files] of folders) {
    if (!files['Shape.png'] && !files['Brush.archive']) continue;
    idx++;
    let archive = {};
    if (files['Brush.archive']) {
      try { archive = unarchive(parseBplist(await files['Brush.archive'].async('uint8array'))); } catch (e) { console.warn('archive parse', e); }
    }
    const s = procreateSettings(archive, folder ? `${setName} ${idx}` : setName);
    const brush = newBrushFrom(BRUSH_DEFAULTS, { ...s, category: 'Imported', source: 'Procreate', size: 30, maxSize: s.maxSize || 200, taper: 0.2 });
    if (files['Shape.png']) {
      const img = await blobToImg(await files['Shape.png'].async('uint8array'));
      brush.tipImage = rawImageToMaskCanvas(img, 'procreate').toDataURL();
      brush.tip = 'image';
    }
    if (files['Grain.png']) {
      const img = await blobToImg(await files['Grain.png'].async('uint8array'));
      brush.grainImage = rawImageToMaskCanvas(img, 'procreate').toDataURL();
    }
    out.push(brush);
  }
  if (!out.length) throw new Error('No brushes found inside archive');
  notes.push(`${file.name}: imported ${out.length} brush${out.length === 1 ? '' : 'es'}`);
  return out;
}

async function importImageTip(file) {
  const img = await blobToImg(await file.arrayBuffer(), file.type || 'image/png');
  return newBrushFrom(BRUSH_DEFAULTS, {
    name: baseName(file.name), category: 'Imported', source: 'Image', tip: 'image',
    tipImage: rawImageToMaskCanvas(img, 'csp').toDataURL(), spacing: 0.15, size: 40, maxSize: 300,
  });
}
