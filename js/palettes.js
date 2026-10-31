// Color palettes: any number of named palettes, one of them the default (shown under every
// color mode). Create blank, from the current history, from a photo, or import Procreate
// .swatches, Photoshop .aco / .ase, GIMP .gpl and plain hex lists. Export as .swatches.
import { uid, clamp, rgbToHex, hexToRgb, rgbToHsv, hsvToRgb, loadScript, loadImage, makeCanvas } from './util.js';
import * as store from './storage.js';

const BUILTIN = [
  { name: 'Default', colors: ['#000000', '#1d1d24', '#4a4a55', '#8a8a96', '#c8c8d0', '#ffffff', '#f2d6c4', '#e0ac8a', '#b5714b', '#6b3b24',
    '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#32ade6', '#007aff', '#5856d6', '#af52de', '#ff2d55'] },
  { name: 'Skin tones', colors: ['#fbe3d3', '#f6d0b8', '#efbf9f', '#e6a987', '#d99572', '#c98160', '#b56d4f', '#9c5a40', '#7e4632', '#5f3526',
    '#f4c7b8', '#e8a798', '#d98c7f', '#c36f66', '#ffd9c7', '#f2b5a0'] },
  { name: 'Manga greys', colors: ['#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080', '#999999', '#b3b3b3', '#cccccc', '#e6e6e6', '#ffffff'] },
  { name: 'Pastel', colors: ['#ffd1dc', '#ffb7b2', '#ffdac1', '#fff1b6', '#e2f0cb', '#b5ead7', '#c7ceea', '#d5c6e0', '#a0ced9', '#f3c4fb'] },
];

export function loadPalettes() {
  let list = store.prefs.get('palettes', null);
  if (!Array.isArray(list) || !list.length) {
    list = BUILTIN.map((p) => ({ id: uid(), name: p.name, colors: [...p.colors] }));
    const old = store.prefs.get('palette', null); // single palette from earlier versions
    if (Array.isArray(old) && old.length) list[0].colors = old;
    store.prefs.set('palettes', list);
    store.prefs.set('paletteDefault', list[0].id);
  }
  return list;
}
export const savePalettes = (list) => store.prefs.set('palettes', list);
export const defaultPaletteId = (list) => { const id = store.prefs.get('paletteDefault', null); return list.some((p) => p.id === id) ? id : list[0] && list[0].id; };
export const setDefaultPalette = (id) => store.prefs.set('paletteDefault', id);

const norm = (cs) => [...new Set(cs.filter(Boolean).map((c) => c.toLowerCase()))].slice(0, 300);

// ───────── palette from a photo (median cut) ─────────
export async function paletteFromImage(file, count = 20) {
  const u = URL.createObjectURL(file);
  try {
    const img = await loadImage(u);
    const k = Math.min(1, 200 / Math.max(img.width, img.height));
    const c = makeCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
    let boxes = [px];
    while (boxes.length < count) {
      // split the box with the widest channel range
      let bi = -1, bestR = 0, bestC = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let lo = 255, hi = 0; for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
          if (hi - lo > bestR) { bestR = hi - lo; bi = i; bestC = ch; }
        }
      });
      if (bi < 0 || bestR < 8) break;
      const b = boxes[bi].sort((p, q) => p[bestC] - q[bestC]), m = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
    }
    const cols = boxes.filter((b) => b.length).map((b) => {
      let r = 0, g = 0, bl = 0; for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
      return [r / b.length, g / b.length, bl / b.length];
    });
    // order by hue, darks first
    cols.sort((a, b) => { const A = rgbToHsv(...a), B = rgbToHsv(...b); return (A[2] < 0.15) - (B[2] < 0.15) || A[0] - B[0] || A[2] - B[2]; });
    return norm(cols.map((c) => rgbToHex(...c)));
  } finally { URL.revokeObjectURL(u); }
}

// ───────── file import ─────────
async function zipLib() { await loadScript('vendor/jszip.min.js'); return window.JSZip; }

function parseACO(buf) {
  const dv = new DataView(buf); let o = 0;
  const read = () => {
    const ver = dv.getUint16(o), n = dv.getUint16(o + 2); o += 4;
    const out = [];
    for (let i = 0; i < n; i++) {
      const space = dv.getUint16(o), w = dv.getUint16(o + 2), x = dv.getUint16(o + 4), y = dv.getUint16(o + 6), z = dv.getUint16(o + 8); o += 10;
      if (ver === 2) { const len = dv.getUint32(o + 2); o += 4 + len * 2; }
      if (space === 0) out.push(rgbToHex(w / 257, x / 257, y / 257));
      else if (space === 1) out.push(rgbToHex(...hsvToRgb((w / 65535) * 360, x / 65535, y / 65535)));
      else if (space === 2) out.push(rgbToHex(255 - w / 257, 255 - x / 257, 255 - y / 257)); // CMYK (approx)
      else if (space === 8) { const g = 255 - (w / 10000) * 255; out.push(rgbToHex(g, g, g)); }
    }
    return { ver, out };
  };
  const v1 = read();
  if (o < buf.byteLength - 4 && dv.getUint16(o) === 2) { try { return read().out; } catch { /* v1 only */ } }
  return v1.out;
}
function parseASE(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0) !== 0x41534546) return [];
  const n = dv.getUint32(8); let o = 12; const out = [];
  for (let i = 0; i < n && o < buf.byteLength; i++) {
    const type = dv.getUint16(o), len = dv.getUint32(o + 2); const start = o + 6; o = start + len;
    if (type !== 1) continue;
    const nameLen = dv.getUint16(start); let p = start + 2 + nameLen * 2;
    const model = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3)); p += 4;
    const f = (k) => dv.getFloat32(p + k * 4);
    if (model === 'RGB ') out.push(rgbToHex(f(0) * 255, f(1) * 255, f(2) * 255));
    else if (model === 'Gray') out.push(rgbToHex(f(0) * 255, f(0) * 255, f(0) * 255));
    else if (model === 'CMYK') { const k = f(3); out.push(rgbToHex(255 * (1 - f(0)) * (1 - k), 255 * (1 - f(1)) * (1 - k), 255 * (1 - f(2)) * (1 - k))); }
  }
  return out;
}
function parseText(t) {
  const out = [];
  if (/^GIMP Palette/m.test(t)) {
    for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/); if (m) out.push(rgbToHex(+m[1], +m[2], +m[3])); }
    return out;
  }
  for (const m of t.matchAll(/#?\b([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) out.push(hexToRgb('#' + m[1]) && rgbToHex(...hexToRgb('#' + m[1])));
  return out;
}

// returns [{name, colors}] — a .swatches file can hold one palette; others hold one each
export async function importPaletteFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  const buf = await file.arrayBuffer();
  if (ext === 'swatches' || ext === 'zip') {
    const zip = await (await zipLib()).loadAsync(buf);
    const ent = zip.file(/swatches\.json$/i)[0];
    if (!ent) throw new Error('No Swatches.json inside');
    let data = JSON.parse(await ent.async('string'));
    if (!Array.isArray(data)) data = [data];
    return data.map((p) => ({
      name: p.name || base,
      colors: norm((p.swatches || []).map((s) => s && rgbToHex(...hsvToRgb((s.hue ?? 0) * 360, s.saturation ?? 0, s.brightness ?? 0)))),
    })).filter((p) => p.colors.length);
  }
  let colors;
  if (ext === 'aco') colors = parseACO(buf);
  else if (ext === 'ase') colors = parseASE(buf);
  else if (ext === 'json') { const j = JSON.parse(new TextDecoder().decode(buf)); colors = parseText(JSON.stringify(j)); }
  else colors = parseText(new TextDecoder().decode(buf));
  colors = norm(colors);
  if (!colors.length) throw new Error('No colors found in that file');
  return [{ name: base, colors }];
}

// Procreate-compatible .swatches (zip containing Swatches.json, HSB 0–1, 30 slots)
export async function exportSwatches(p) {
  const JSZip = await zipLib(), zip = new JSZip();
  const sw = p.colors.slice(0, 30).map((c) => { const [hh, s, v] = rgbToHsv(...hexToRgb(c)); return { hue: hh / 360, saturation: s, brightness: v, alpha: 1, colorSpace: 0 }; });
  while (sw.length < 30) sw.push(null);
  zip.file('Swatches.json', JSON.stringify({ name: p.name, swatches: sw }));
  return zip.generateAsync({ type: 'blob' });
}
export const PALETTE_ACCEPT = '.swatches,.aco,.ase,.gpl,.txt,.hex,.json,.zip';
export { clamp };
