// ibis Paint brushes.
// ibis Paint shares custom brushes as QR-code images. The data inside those QR codes is
// not publicly documented, so import works in two layers:
//   1. Scan the QR code (photo, screenshot or downloaded QR image) and read every setting
//      that can be recognised (URL parameters, JSON, key=value text, base64 / compressed
//      payloads). The raw code is kept with the brush so it can be re-read later.
//   2. Open an editor that uses ibis Paint's own setting names, pre-filled with whatever
//      was recognised, so any ibis brush can be matched exactly by copying its values.
import { h, toast, dialog, field, switchRow, seg, pickFile, loadScript, loadImage, makeCanvas, clamp } from './util.js';
import { BRUSH_DEFAULTS, newBrushFrom, preloadBrush, rawImageToMaskCanvas } from './brushes.js';
import * as store from './storage.js';

// ───────── QR scanning ─────────
async function decodeQR(img) {
  await loadScript('vendor/jsQR.js');
  const tries = [];
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  for (const target of [Math.min(1400, Math.max(w0, h0)), 900, 600, 1800]) {
    const k = Math.min(1, target / Math.max(w0, h0)) || 1;
    tries.push(k);
  }
  for (const k of [...new Set(tries)]) {
    const c = makeCanvas(w0 * k, h0 * k), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    const id = x.getImageData(0, 0, c.width, c.height);
    const r = window.jsQR(id.data, id.width, id.height, { inversionAttempts: 'attemptBoth' });
    if (r) return r;
  }
  return null;
}

// ───────── payload analysis ─────────
const b64re = /^[A-Za-z0-9+/_-]+={0,2}$/;
function b64bytes(s) {
  try {
    let t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const bin = atob(t), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  } catch { return null; }
}
async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  for (const fmt of ['deflate', 'gzip', 'deflate-raw']) {
    try {
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer();
      if (out.byteLength) return new Uint8Array(out);
    } catch { /* not this format */ }
  }
  return null;
}
const printable = (u8) => { let n = 0; for (const b of u8) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) n++; return u8.length && n / u8.length > 0.9; };

// Collect key → value pairs from any text-like structure.
function pairsFromText(text, out) {
  const t = text.trim();
  try { const j = JSON.parse(t); walk(j, '', out); return true; } catch { /* not JSON */ }
  try {
    const u = new URL(t);
    for (const [k, v] of u.searchParams) out.push([k, v]);
    if (u.hash.length > 1) for (const [k, v] of new URLSearchParams(u.hash.slice(1))) out.push([k, v]);
    if (u.pathname) out.push(['_path', u.pathname]);
    return true;
  } catch { /* not a URL */ }
  let any = false;
  for (const m of t.matchAll(/([A-Za-z_][\w.\- ]{0,40})\s*[=:]\s*("?)([^,;&\n"]+)\2/g)) { out.push([m[1].trim(), m[3].trim()]); any = true; }
  return any;
}
function walk(v, path, out) {
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k, out); }
  else out.push([path, v]);
}

// Map recognised keys onto engine settings. Values may be 0–1, 0–100 or pixels.
const RULES = [
  [/name|title/i, 'name'],
  [/(press|pressure).*(thick|size|width)|(thick|size|width).*(press)/i, 'sizePressure', 'pct'],
  [/(press|pressure).*(opac|alpha)|(opac|alpha).*(press)/i, 'opacityPressure', 'pct'],
  [/(speed|veloc).*(thick|size|width)|(thick|size|width).*(speed|veloc)/i, 'speedSize', 'pct'],
  [/(speed|veloc).*(opac|alpha)|(opac|alpha).*(speed|veloc)/i, 'opacityPressure_speed', 'pct'],
  [/start.*(thick|size)|(fade|taper).*(in|start)|^taper/i, 'taper', 'pct'],
  [/interval|spacing|step/i, 'spacing', 'pct'],
  [/random.*(angle|rot)|(angle|rot).*random/i, 'angleJitter', 'pct'],
  [/random.*(thick|size)|(thick|size).*random/i, 'sizeJitter', 'pct'],
  [/scatter|jitter/i, 'scatter', 'pct'],
  [/stabil|smooth|correction/i, 'streamline', 'pct'],
  [/angle|rotation|rot$/i, 'rotation', 'raw'],
  [/anti.?alias/i, 'antialias', 'bool'],
  [/hard/i, 'hardness', 'pct'],
  [/opac|alpha|transparen/i, 'opacity', 'pct'],
  [/thick|size|width|diameter|radius/i, 'size', 'px'],
  [/type|kind|category/i, 'ibisType', 'raw'],
];
function mapPairs(pairs) {
  const s = {}, used = [];
  for (const [k0, v0] of pairs) {
    if (k0 == null || k0 === '_path') continue;
    const k = String(k0), num = typeof v0 === 'number' ? v0 : parseFloat(v0);
    for (const [re, key, kind] of RULES) {
      if (!re.test(k.split('.').pop())) continue;
      if (key in s) break;
      if (kind === undefined) { if (typeof v0 === 'string' && v0.length < 60) { s[key] = v0; used.push(k); } }
      else if (kind === 'bool') { s[key] = v0 === true || v0 === 1 || /^(1|true|on|yes)$/i.test(String(v0)); used.push(k); }
      else if (Number.isFinite(num)) {
        s[key] = kind === 'pct' ? (num > 1 ? num / 100 : num) : num;
        used.push(k);
      }
      break;
    }
  }
  if ('opacityPressure_speed' in s) { s.speedOpacity = s.opacityPressure_speed; delete s.opacityPressure_speed; }
  return { settings: s, used };
}

// ───────── ibis Paint's binary brush code ("IPBZ") ─────────
// Brush QR codes carry binary data:  "IPBZ" · u16 version · 2 bytes · raw-deflate stream.
// The inflated record is big-endian: 4 bytes (format) · u32 length · fields (floats, ints and
// length-prefixed 16-byte ids that point at ibis Paint's built-in brush shapes / textures).
// The format isn't published; the field meanings below were worked out from real brush
// codes and are applied as a best match (all raw fields are kept with the brush).
const IPBZ_FIELDS = [
  // [offset, setting, convert(value) → engine value | undefined if implausible]
  // Confirmed against ibis Paint's own brush panel (Basic + Fade tabs):
  [20, 'size', (v) => (v >= 0.1 && v <= 2000 ? v : undefined)],           // Thickness (px)
  [52, 'opacity', (v) => (v > 0 && v <= 1 ? v : undefined)],             // Opacity
  [48, 'spacing', (v) => (v > 0 && v <= 10 ? v : undefined)],            // Interval
  [28, 'fadeStartSize', (v) => (v >= 0 && v <= 2 ? v : undefined)],      // Fade · Start Thickness (0–200%)
  [32, 'fadeEndSize', (v) => (v >= 0 && v <= 2 ? v : undefined)],        // Fade · End Thickness
  [36, 'fadeStartAlpha', (v) => (v >= 0 && v <= 2 ? v : undefined)],     // Fade · Start Opacity
  [40, 'fadeEndAlpha', (v) => (v >= 0 && v <= 2 ? v : undefined)],       // Fade · End Opacity
  // Dynamic tab (pressure / speed, signed −100…100%) — best match, not yet confirmed:
  [296, 'sizePressure', (v) => (v > 0 && v <= 1 ? v : undefined)],       // Thickness ← pressure
  [120, 'speedSize', (v) => (v < 0 && v >= -1 ? -v : undefined)],        // Thickness ← speed (thinner when fast)
  [268, 'speedOpacity', (v) => (v < 0 && v >= -1 ? -v : undefined)],     // Opacity ← speed (lighter when fast)
];
// 16-byte id of ibis Paint's plain (untextured) brush material; anything else is a texture
const PLAIN_MATERIAL = 'a54f0041a9e15b050f25c463f1db7449';
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot decompress (needs iPadOS 16.4+)');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}
export async function decodeIPBZ(bin) {
  const b = Uint8Array.from(bin);
  if (b.length < 12 || String.fromCharCode(...b.slice(0, 4)) !== 'IPBZ') return null;
  const rec = await inflateRaw(b.slice(8));
  const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  const declared = rec.length >= 8 ? dv.getUint32(4) : 0;
  const fields = [];
  for (let o = 8; o + 4 <= rec.length; o += 4) fields.push([o, dv.getFloat32(o), dv.getUint32(o)]);
  const settings = {}, used = [];
  if (declared === rec.length - 12 || declared === rec.length - 8 || rec.length >= 300) {
    for (const [off, key, conv] of IPBZ_FIELDS) {
      if (off + 4 > rec.length) continue;
      const v = conv(dv.getFloat32(off));
      if (v !== undefined) { settings[key] = v; used.push(key); }
    }
    // brush tip id (offset 160): the falcon pen's soft, dry-ink nib
    if (rec.length >= 176 && dv.getUint32(156) === 16) {
      const tip = [...rec.slice(160, 176)].map((x) => x.toString(16).padStart(2, '0')).join('');
      void tip; // brush-shape id; ibis' built-in shapes aren't available, the round tip is used
    }
    // texture id (offset 236): a non-plain material makes a grainy, pencil-like stroke
    if (rec.length >= 252 && dv.getUint32(232) === 16) {
      const id = [...rec.slice(236, 252)].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (id !== PLAIN_MATERIAL) { Object.assign(settings, { tip: 'pencil', grain: 'paper', grainDepth: 0.7, angleJitter: 1 }); used.push('texture'); }
    }
    // flag 0x8000 at offset 56 = "blurring" edges; its amount sits at offset 64
    if (rec.length >= 68 && dv.getUint32(56) & 0x8000) {
      const blur = dv.getFloat32(64);
      settings.hardness = clamp(1 - (blur > 0 && blur <= 1 ? blur : 0.25) * 1.8, 0.3, 1); used.push('blur');
    }
    // ibis spaces solid round pens wider than this engine needs; keep them smooth
    if (settings.spacing > 0.08 && !settings.tip) settings.spacing = 0.06;
    // decoded brushes are drawn exactly as defined (no Steady-ink adjustments)
    settings.exact = true; settings.fadeStartLen = 1; settings.fadeEndLen = 1;
  }
  const hex = [...rec].map((x) => x.toString(16).padStart(2, '0')).join('');
  return { settings, used, version: (b[4] << 8) | b[5], length: rec.length, raw: 'IPBZ v' + ((b[4] << 8) | b[5]) + ' · ' + rec.length + ' bytes · ' + hex, fields };
}

export async function analyzePayload(qr) {
  // ibis Paint's own binary brush code
  if (qr.binaryData && qr.binaryData.length > 8 && String.fromCharCode(...qr.binaryData.slice(0, 4)) === 'IPBZ') {
    try {
      const r = await decodeIPBZ(qr.binaryData);
      if (r) return { settings: r.settings, used: r.used, pairs: r.fields.length, notes: ['ibis Paint brush code (IPBZ v' + r.version + ')'], raw: r.raw, ipbz: true };
    } catch (e) { console.warn('IPBZ', e); }
  }
  const text = qr.data || '';
  const pairs = [];
  const notes = [];
  if (/ibis/i.test(text)) notes.push('ibis Paint code');
  pairsFromText(text, pairs);
  // look inside any long base64 blobs (whole payload or URL parameter values)
  const blobs = [text, ...pairs.map(([, v]) => String(v))].filter((v) => v.length > 24 && b64re.test(v));
  for (const b of blobs) {
    const raw = b64bytes(b); if (!raw) continue;
    for (const bytes of [raw, await inflate(raw)]) {
      if (bytes && printable(bytes)) { pairsFromText(new TextDecoder().decode(bytes), pairs); notes.push('decoded data'); }
    }
  }
  // binary QR content (byte mode) may itself be compressed
  if (qr.binaryData && qr.binaryData.length && !printable(Uint8Array.from(qr.binaryData))) {
    const inf = await inflate(Uint8Array.from(qr.binaryData));
    if (inf && printable(inf)) { pairsFromText(new TextDecoder().decode(inf), pairs); notes.push('compressed data'); }
  }
  const { settings, used } = mapPairs(pairs);
  return { settings, used, pairs: pairs.length, notes, raw: text.slice(0, 4000) };
}

// ───────── ibis-style brush types (starting points for the editor) ─────────
export const IBIS_TYPES = {
  pen: { label: 'Pen', base: { tip: 'round', hardness: 1, sizePressure: 0.8, spacing: 0.05, streamline: 0.3 } },
  dip: { label: 'Dip Pen', base: { tip: 'round', hardness: 1, sizePressure: 1, speedSize: 0.4, minSize: 0.05, spacing: 0.04, taper: 0.4, taperAlways: true, streamline: 0.35 } },
  felt: { label: 'Felt Tip Pen', base: { tip: 'round', hardness: 0.95, sizePressure: 0.15, spacing: 0.04, streamline: 0.25 } },
  fude: { label: 'Fude (brush pen)', base: { tip: 'round', hardness: 0.95, roundness: 0.6, rotation: 40, sizePressure: 1, speedSize: 0.5, taper: 0.5, taperAlways: true, spacing: 0.03, streamline: 0.35 } },
  pencil: { label: 'Pencil', base: { tip: 'pencil', sizePressure: 0.4, opacityPressure: 0.8, grain: 'paper', grainDepth: 0.75, angleJitter: 1, spacing: 0.12, streamline: 0.1 } },
  air: { label: 'Airbrush', base: { tip: 'round', hardness: 0, flow: 0.1, flowPressure: 0.8, sizePressure: 0.2, spacing: 0.05, streamline: 0.1, taper: 0 } },
  water: { label: 'Watercolor', base: { tip: 'round', hardness: 0.25, flow: 0.15, sizePressure: 0.4, grain: 'paper', grainDepth: 0.5, spacing: 0.06, streamline: 0.2 } },
  stamp: { label: 'Stamp (custom image)', base: { tip: 'image', sizePressure: 0.3, spacing: 1, angleJitter: 0, taper: 0 } },
};

const P = (o) => newBrushFrom(BRUSH_DEFAULTS, { builtin: true, category: 'ibis Paint style', source: 'ibis style', ...o });
export const IBIS_PRESETS = [
  P({ id: 'ibis-dip-hard', name: 'Dip Pen (Hard)', ...IBIS_TYPES.dip.base, size: 10, maxSize: 80 }),
  P({ id: 'ibis-dip-soft', name: 'Dip Pen (Soft)', ...IBIS_TYPES.dip.base, hardness: 0.75, size: 10, maxSize: 80 }),
  P({ id: 'ibis-felt', name: 'Felt Tip Pen', ...IBIS_TYPES.felt.base, size: 14, maxSize: 120 }),
  P({ id: 'ibis-fude', name: 'Fude Pen', ...IBIS_TYPES.fude.base, size: 18, maxSize: 120 }),
  P({ id: 'ibis-pencil', name: 'Pencil', ...IBIS_TYPES.pencil.base, size: 7, maxSize: 40 }),
  P({ id: 'ibis-air', name: 'Airbrush (Soft)', ...IBIS_TYPES.air.base, size: 140, maxSize: 600 }),
  P({ id: 'ibis-water', name: 'Watercolor', ...IBIS_TYPES.water.base, size: 70, maxSize: 400 }),
  // decoded from its ibis Paint QR code (shared publicly by @mtd__art)
  P({ id: 'ibis-pluma-falcon', name: 'Pluma falcon suave (difuminado)', category: 'ibis Paint', source: 'ibis Paint QR', tip: 'round', hardness: 0.85,
    exact: true, size: 1.5, maxSize: 40, opacity: 1, spacing: 0.05, sizePressure: 0.695, speedSize: 0.62, speedOpacity: 0.6, opacityPressure: 0,
    fadeStartSize: 1.85, fadeEndSize: 1.85, fadeStartAlpha: 2, fadeEndAlpha: 2, fadeStartLen: 1, fadeEndLen: 1,
    taper: 0, taperAlways: false, streamline: 0.3, _v: 4 }),
  P({ id: 'ibis-ink-pen', name: 'Ink Pen', category: 'ibis Paint', source: 'ibis Paint QR', tip: 'round', hardness: 1,
    size: 3, maxSize: 60, opacity: 1, spacing: 0.06, sizePressure: 0.8, minSize: 0.1, fadeStartSize: 2, fadeEndSize: 2, fadeStartAlpha: 1, fadeEndAlpha: 1,
    fadeStartLen: 1, fadeEndLen: 1, taper: 0, streamline: 0.35 }),
  P({ id: 'ibis-rough-layout', name: 'Rough Layout Pen (Blurring)', category: 'ibis Paint', source: 'ibis Paint QR', tip: 'pencil', hardness: 0.57,
    size: 3.7, maxSize: 80, opacity: 1, spacing: 0.23, sizePressure: 0.5, opacityPressure: 0.35, grain: 'paper', grainDepth: 0.7, angleJitter: 1,
    sizeJitter: 0.08, taper: 0.2, streamline: 0.2 }),
  P({ id: 'ibis-glow', name: 'Glow Pen', tip: 'round', hardness: 0.35, size: 24, maxSize: 160, sizePressure: 0.5, flow: 0.55, spacing: 0.05, streamline: 0.3 }),
];

// ───────── editor (ibis Paint setting names) ─────────
// `init`: engine settings recognised from a QR (may be empty); `meta`: {raw, used, notes}
export function ibisEditor(app, init = {}, meta = null, onSaved) {
  let typeKey = init.ibisType && Object.keys(IBIS_TYPES).find((k) => new RegExp(IBIS_TYPES[k].label.split(' ')[0], 'i').test(init.ibisType)) || (init.tip === 'pencil' ? 'pencil' : 'pen');
  // decoded settings with no slider of their own (texture, blurred edge, minimum thickness)
  const extra = {};
  for (const k of ['minSize', 'hardness', 'grain', 'grainDepth', 'endTaper', 'exact', 'fadeStartSize', 'fadeEndSize', 'fadeStartAlpha', 'fadeEndAlpha', 'fadeStartLen', 'fadeEndLen']) if (init[k] != null) extra[k] = init[k];
  const v = {
    name: init.name || 'ibis brush',
    size: clamp(init.size ?? 12, 1, 1000),
    opacity: clamp(init.opacity ?? 1, 0.01, 1),
    antialias: init.antialias ?? true,
    spacing: clamp(init.spacing ?? 0.05, 0.01, 3),
    taper: clamp(init.taper ?? 0.3, 0, 1),
    sizePressure: clamp(init.sizePressure ?? IBIS_TYPES[typeKey].base.sizePressure ?? 0.8, 0, 1),
    opacityPressure: clamp(init.opacityPressure ?? 0, 0, 1),
    speedSize: clamp(init.speedSize ?? IBIS_TYPES[typeKey].base.speedSize ?? 0, 0, 1),
    speedOpacity: clamp(init.speedOpacity ?? 0, 0, 1),
    rotation: init.rotation ?? 0,
    angleJitter: clamp(init.angleJitter ?? 0, 0, 1),
    follow: false,
    sizeJitter: clamp(init.sizeJitter ?? 0, 0, 1),
    scatter: clamp(init.scatter ?? 0, 0, 3),
    streamline: clamp(init.streamline ?? 0.3, 0, 0.95),
    tipImage: null,
  };
  const pct = (x) => Math.round(x * 100) + '%';
  const F = (label, key, min, max, step, fmt) => field(label, { min, max, step, value: v[key], fmt, onInput: (x) => (v[key] = x) });
  const name = h('input', { class: 'text-in', value: v.name }); name.oninput = () => (v.name = name.value);
  const tipBtn = h('button', { class: 'small-btn', onclick: async () => {
    const [f] = await pickFile('image/*'); if (!f) return;
    const img = await loadImage(URL.createObjectURL(f));
    v.tipImage = rawImageToMaskCanvas(img, 'csp').toDataURL();
    tipBtn.textContent = 'Brush image ✓';
  } }, 'Brush image…');
  const info = meta ? h('div', { class: 'ibis-info' },
    meta.ipbz
      ? h('p', {}, `ibis Paint brush code decoded — ${meta.used.length} settings applied (${meta.used.join(', ')}). ibis Paint's brush shapes and textures are built into ibis Paint itself, so the shape uses the closest Inkwell type below. Give it a name and compare with ibis if you like.`)
      : meta.used.length
      ? h('p', {}, `Read from the QR code: ${meta.used.length} setting${meta.used.length === 1 ? '' : 's'} (${meta.used.slice(0, 6).join(', ')}${meta.used.length > 6 ? '…' : ''}). Check the rest against the brush in ibis Paint.`)
      : h('p', {}, "QR code scanned. ibis Paint's brush code format isn't public, so its settings couldn't be read automatically — copy them from the brush's settings in ibis Paint (same names below). The code is saved with the brush."),
  ) : h('p', { class: 'hint' }, 'Use the same values you see in ibis Paint’s brush settings.');
  const body = h('div', {}, info,
    h('div', { class: 'stack' }, h('label', {}, 'Brush name'), name),
    h('div', { class: 'stack' }, h('label', {}, 'Brush type'), seg(Object.entries(IBIS_TYPES).map(([k, t]) => [k, t.label]), typeKey, (k) => (typeKey = k))),
    h('div', { class: 'studio-tip' }, tipBtn, h('span', { class: 'hint' }, 'For Stamp brushes, or to use a custom brush shape')),
    h('div', { class: 'ibis-grid' },
      F('Thickness', 'size', 1, 400, 1, (x) => Math.round(x) + ' px'),
      F('Opacity', 'opacity', 0.01, 1, 0.01, pct),
      F('Interval', 'spacing', 0.01, 3, 0.01, pct),
      F('Start thickness (fade in)', 'taper', 0, 1, 0.01, pct),
      F('Thickness — pressure', 'sizePressure', 0, 1, 0.01, pct),
      F('Opacity — pressure', 'opacityPressure', 0, 1, 0.01, pct),
      F('Thickness — speed', 'speedSize', 0, 1, 0.01, pct),
      F('Opacity — speed', 'speedOpacity', 0, 1, 0.01, pct),
      F('Angle', 'rotation', -180, 180, 1, (x) => Math.round(x) + '°'),
      F('Angle — random', 'angleJitter', 0, 1, 0.01, pct),
      F('Thickness — random', 'sizeJitter', 0, 1, 0.01, pct),
      F('Scatter', 'scatter', 0, 3, 0.01, pct),
      F('Stabilizer', 'streamline', 0, 0.95, 0.01, pct)),
    switchRow('Anti-aliasing', v.antialias, (x) => (v.antialias = x)),
    switchRow('Angle follows the stroke', v.follow, (x) => (v.follow = x)),
    meta && meta.raw ? h('details', { class: 'ibis-raw' }, h('summary', {}, 'QR code contents'), h('code', {}, meta.raw.slice(0, 600))) : null);
  dialog({ title: meta ? 'ibis Paint brush' : 'New ibis-style brush', wide: true, body, actions: [{ label: 'Cancel' }, { label: 'Save brush', primary: true, onClick: async () => {
    const base = IBIS_TYPES[typeKey].base;
    const b = newBrushFrom(BRUSH_DEFAULTS, {
      ...base, name: v.name || 'ibis brush', category: 'ibis Paint', source: 'ibis Paint',
      size: v.size, maxSize: Math.max(60, v.size * 3), opacity: v.opacity, spacing: v.spacing, taper: v.taper, taperAlways: v.taper > 0,
      sizePressure: v.sizePressure, opacityPressure: v.opacityPressure, speedSize: v.speedSize, speedOpacity: v.speedOpacity,
      rotation: v.rotation, angleJitter: v.angleJitter, follow: v.follow, sizeJitter: v.sizeJitter, scatter: v.scatter, streamline: v.streamline,
      hardness: v.antialias ? (base.hardness ?? 1) : 1, ibisRaw: meta ? meta.raw : null,
      ...extra,
    });
    if (init.tip === 'ink') b.tip = 'ink';
    if (v.tipImage) { b.tipImage = v.tipImage; b.tip = 'image'; }
    else if (typeKey === 'stamp') { toast('Pick a brush image for a Stamp brush'); return false; }
    if (!v.antialias) b.hardness = 1;
    await preloadBrush(b);
    app.brushes.push(b);
    try { await store.saveBrush(b); } catch (e) { console.warn(e); }
    app.setBrush(b.id, 'brush');
    toast(`"${b.name}" added to ibis Paint brushes`);
    onSaved && onSaved(b);
  } }] });
}

// ───────── import flow ─────────
export async function importIbisQR(app, after) {
  const files = await pickFile('image/*', true);
  if (!files.length) return;
  for (const f of files) {
    let img;
    try { img = await loadImage(URL.createObjectURL(f)); } catch { toast(`${f.name}: not an image`); continue; }
    toast('Scanning QR code…', 4000);
    const qr = await decodeQR(img);
    if (!qr) { toast(`No QR code found in ${f.name}. Use the QR image exported from ibis Paint (Brush › menu › Export Brush QR Code).`, 5000); continue; }
    const meta = await analyzePayload(qr);
    toast(meta.used.length ? `QR code read — ${meta.used.length} settings recognised` : 'QR code scanned', 1400);
    await new Promise((res) => { ibisEditor(app, meta.settings, meta, (b) => { after && after(b); res(); }); setTimeout(res, 0); });
  }
}
