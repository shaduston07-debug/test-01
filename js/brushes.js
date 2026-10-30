// Brush presets, procedural tip shapes and grain textures.
import { makeCanvas, loadImage, clamp, uid } from './util.js';

const TIP_RES = 256;

export const BRUSH_DEFAULTS = {
  tip: 'round', tipImage: null, invertTip: false, hardness: 1, roundness: 1, rotation: 0, follow: false,
  angleJitter: 0, size: 18, maxSize: 200, minSize: 0, opacity: 1, flow: 1, spacing: 0.08, streamline: 0.3,
  sizePressure: 0.8, opacityPressure: 0, flowPressure: 0, sizeJitter: 0, scatter: 0, count: 1,
  tiltSize: 0, tiltOpacity: 0, taper: 0.25, grain: null, grainImage: null, grainScale: 1, grainDepth: 0.7,
  hueJitter: 0, smudgeStrength: 0.7, category: 'Inking',
};

const B = (o) => ({ ...BRUSH_DEFAULTS, builtin: true, ...o });
export const DEFAULT_BRUSHES = [
  // Sketching
  B({ id: 'pencil-6b', name: '6B Pencil', category: 'Sketching', tip: 'pencil', size: 10, maxSize: 60, spacing: 0.12, streamline: 0.1, sizePressure: 0.5, opacityPressure: 0.8, tiltSize: 2.5, tiltOpacity: 0.4, grain: 'paper', grainDepth: 0.85, angleJitter: 1 }),
  B({ id: 'pencil-hb', name: 'HB Pencil', category: 'Sketching', tip: 'pencil', size: 5, maxSize: 30, spacing: 0.15, streamline: 0.15, sizePressure: 0.3, opacityPressure: 0.7, tiltSize: 1.5, grain: 'paper', grainDepth: 0.6, angleJitter: 1, opacity: 0.85 }),
  B({ id: 'mech-pencil', name: 'Mechanical Pencil', category: 'Sketching', tip: 'round', hardness: 0.85, size: 3, maxSize: 15, sizePressure: 0.25, opacityPressure: 0.7, grain: 'paper', grainDepth: 0.4, streamline: 0.2 }),
  B({ id: 'charcoal', name: 'Charcoal', category: 'Sketching', tip: 'chalk', size: 36, maxSize: 200, spacing: 0.1, sizePressure: 0.4, opacityPressure: 0.6, grain: 'grit', grainDepth: 0.9, angleJitter: 1, streamline: 0.05 }),
  B({ id: 'blue-pencil', name: 'Col. Pencil (sketch)', category: 'Sketching', tip: 'pencil', size: 8, maxSize: 40, sizePressure: 0.4, opacityPressure: 0.9, grain: 'paper', grainDepth: 0.7, angleJitter: 1, spacing: 0.12 }),
  // Inking
  B({ id: 'studio-pen', name: 'Studio Pen', category: 'Inking', size: 8, maxSize: 80, sizePressure: 0.9, streamline: 0.5, spacing: 0.05, taper: 0.3 }),
  B({ id: 'g-pen', name: 'G-Pen', category: 'Inking', size: 9, maxSize: 60, sizePressure: 1, minSize: 0.04, streamline: 0.4, spacing: 0.04, taper: 0.5 }),
  B({ id: 'mapping-pen', name: 'Mapping Pen', category: 'Inking', size: 3, maxSize: 20, sizePressure: 1, streamline: 0.35, spacing: 0.04, taper: 0.4 }),
  B({ id: 'tech-pen', name: 'Technical Pen', category: 'Inking', size: 6, maxSize: 60, sizePressure: 0, streamline: 0.5, spacing: 0.04, taper: 0 }),
  B({ id: 'brush-pen', name: 'Brush Pen', category: 'Inking', size: 16, maxSize: 120, roundness: 0.55, rotation: 45, sizePressure: 1, streamline: 0.4, spacing: 0.03, taper: 0.5 }),
  B({ id: 'dry-ink', name: 'Dry Ink', category: 'Inking', tip: 'chalk', size: 12, maxSize: 80, sizePressure: 0.8, streamline: 0.3, grain: 'grit', grainDepth: 0.35, spacing: 0.05, angleJitter: 1 }),
  B({ id: 'fill-pen', name: 'Fill Pen (solid)', category: 'Inking', size: 60, maxSize: 400, sizePressure: 0, streamline: 0.2, spacing: 0.04, taper: 0 }),
  // Painting
  B({ id: 'round-brush', name: 'Round Brush', category: 'Painting', hardness: 0.7, size: 40, maxSize: 300, sizePressure: 0.6, opacityPressure: 0.4, flow: 0.9, streamline: 0.2 }),
  B({ id: 'gouache', name: 'Gouache', category: 'Painting', hardness: 0.9, size: 50, maxSize: 300, sizePressure: 0.5, flowPressure: 0.5, flow: 0.8, grain: 'canvas', grainDepth: 0.5, streamline: 0.15 }),
  B({ id: 'flat-brush', name: 'Flat Brush', category: 'Painting', hardness: 0.9, roundness: 0.22, follow: true, rotation: 90, size: 50, maxSize: 300, sizePressure: 0.3, flowPressure: 0.6, flow: 0.85, grain: 'canvas', grainDepth: 0.3, spacing: 0.03 }),
  B({ id: 'bristle', name: 'Dry Bristle', category: 'Painting', tip: 'bristle', follow: true, size: 60, maxSize: 300, sizePressure: 0.3, flowPressure: 0.6, flow: 0.7, spacing: 0.03, streamline: 0.2 }),
  B({ id: 'watercolor', name: 'Watercolor Wash', category: 'Painting', hardness: 0.2, size: 90, maxSize: 500, sizePressure: 0.4, flow: 0.12, opacity: 0.8, grain: 'paper', grainDepth: 0.6, grainScale: 1.5, streamline: 0.2, spacing: 0.06 }),
  B({ id: 'marker', name: 'Marker', category: 'Painting', hardness: 0.92, roundness: 0.7, rotation: 30, size: 24, maxSize: 150, sizePressure: 0.15, flow: 1, opacity: 0.55, streamline: 0.3, spacing: 0.03, taper: 0 }),
  B({ id: 'blender', name: 'Soft Blender', category: 'Painting', hardness: 0.3, size: 60, maxSize: 400, sizePressure: 0.4, flowPressure: 0.6, smudgeStrength: 0.85 }),
  // Airbrush
  B({ id: 'soft-air', name: 'Soft Airbrush', category: 'Airbrush', hardness: 0, size: 160, maxSize: 800, sizePressure: 0.2, flowPressure: 0.8, flow: 0.08, spacing: 0.05, streamline: 0.1, taper: 0 }),
  B({ id: 'med-air', name: 'Medium Airbrush', category: 'Airbrush', hardness: 0.5, size: 80, maxSize: 600, sizePressure: 0.2, flowPressure: 0.8, flow: 0.12, spacing: 0.05, taper: 0 }),
  B({ id: 'hard-air', name: 'Hard Airbrush', category: 'Airbrush', hardness: 0.92, size: 60, maxSize: 600, sizePressure: 0.2, flowPressure: 0.7, flow: 0.35, spacing: 0.04, taper: 0 }),
  B({ id: 'spray', name: 'Spray Paint', category: 'Airbrush', tip: 'splatter', size: 70, maxSize: 400, scatter: 0.4, sizeJitter: 0.3, angleJitter: 1, flow: 0.25, sizePressure: 0.3, flowPressure: 0.8, spacing: 0.15, taper: 0 }),
  // Comic / texture
  B({ id: 'halftone', name: 'Halftone Tone', category: 'Comic & Tone', hardness: 0.6, size: 90, maxSize: 600, sizePressure: 0.2, grain: 'halftone', grainDepth: 1, flow: 1, streamline: 0.1, taper: 0 }),
  B({ id: 'halftone-lg', name: 'Halftone (coarse)', category: 'Comic & Tone', hardness: 0.6, size: 120, maxSize: 600, sizePressure: 0.2, grain: 'halftone', grainScale: 2.2, grainDepth: 1, taper: 0 }),
  B({ id: 'hatch', name: 'Crosshatch Tone', category: 'Comic & Tone', hardness: 0.6, size: 90, maxSize: 600, sizePressure: 0.2, grain: 'hatch', grainDepth: 1, taper: 0 }),
  B({ id: 'speedlines', name: 'Speed Line Pen', category: 'Comic & Tone', size: 6, maxSize: 40, sizePressure: 1, minSize: 0, streamline: 0.8, spacing: 0.04, taper: 1 }),
  B({ id: 'splatter', name: 'Splatter', category: 'Comic & Tone', tip: 'splatter', size: 80, maxSize: 400, scatter: 1.2, sizeJitter: 0.7, angleJitter: 1, spacing: 0.6, sizePressure: 0.4, taper: 0 }),
  B({ id: 'sparkle', name: 'Sparkle', category: 'Comic & Tone', tip: 'star', size: 40, maxSize: 200, scatter: 2, sizeJitter: 0.8, angleJitter: 0.2, spacing: 1.2, sizePressure: 0.5, taper: 0 }),
];

// ───────── tip masks (white rgb, shape in alpha) ─────────
const tipCache = new Map();
const imgCache = new Map();

function maskFromFn(res, fn) {
  const c = makeCanvas(res, res), x = c.getContext('2d');
  const id = x.createImageData(res, res), d = id.data;
  for (let y = 0; y < res; y++) for (let i = 0; i < res; i++) {
    const nx = (i + 0.5) / res * 2 - 1, ny = (y + 0.5) / res * 2 - 1;
    const a = clamp(fn(nx, ny), 0, 1), k = (y * res + i) * 4;
    d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = a * 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function roundTip(hardness) {
  const hq = Math.round(hardness * 20) / 20;
  const edge = 2 / TIP_RES;
  return maskFromFn(TIP_RES, (x, y) => {
    const d = Math.hypot(x, y);
    if (hq >= 0.99) return (1 - d) / edge;
    const inner = hq * (1 - edge);
    if (d <= inner) return 1;
    const t = clamp((d - inner) / (1 - inner), 0, 1);
    return (1 - t) * (1 - t) * (1 + 2 * t) * (1 - t * 0.0); // cubic falloff
  });
}

function pencilTip() {
  const rnd = seeded(7);
  const c = makeCanvas(TIP_RES, TIP_RES), x = c.getContext('2d');
  x.fillStyle = '#fff';
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * TIP_RES * 0.46;
    x.globalAlpha = 0.25 + rnd() * 0.6;
    x.fillRect(TIP_RES / 2 + Math.cos(a) * r, TIP_RES / 2 + Math.sin(a) * r, 3 + rnd() * 5, 3 + rnd() * 5);
  }
  return c;
}
function chalkTip() {
  const rnd = seeded(11);
  const c = makeCanvas(TIP_RES, TIP_RES), x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.beginPath();
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, r = TIP_RES * (0.36 + rnd() * 0.12);
    const px = TIP_RES / 2 + Math.cos(a) * r, py = TIP_RES / 2 + Math.sin(a) * r;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.fill();
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) { x.globalAlpha = rnd() * 0.8; x.fillRect(rnd() * TIP_RES, rnd() * TIP_RES, 2 + rnd() * 6, 2 + rnd() * 6); }
  return c;
}
function splatterTip() {
  const rnd = seeded(23);
  const c = makeCanvas(TIP_RES, TIP_RES), x = c.getContext('2d');
  x.fillStyle = '#fff';
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.8) * TIP_RES * 0.4;
    const s = (1 - r / (TIP_RES * 0.45)) * 14 + 2;
    x.beginPath(); x.arc(TIP_RES / 2 + Math.cos(a) * r, TIP_RES / 2 + Math.sin(a) * r, s, 0, Math.PI * 2); x.fill();
  }
  return c;
}
function bristleTip() {
  const rnd = seeded(5);
  const c = makeCanvas(TIP_RES, TIP_RES), x = c.getContext('2d');
  x.fillStyle = '#fff';
  for (let i = 0; i < 60; i++) {
    const px = TIP_RES * (0.08 + rnd() * 0.84), py = TIP_RES / 2 + (rnd() - 0.5) * TIP_RES * 0.22;
    x.globalAlpha = 0.4 + rnd() * 0.6;
    x.beginPath(); x.arc(px, py, 3 + rnd() * 7, 0, Math.PI * 2); x.fill();
  }
  return c;
}
function starTip() {
  return maskFromFn(TIP_RES, (x, y) => {
    const a = Math.abs(x) * Math.abs(y);
    const d = Math.hypot(x, y);
    return (0.03 / (a + 0.012) - 0.6) * (1 - d) + (d < 0.12 ? 1 : 0);
  });
}

export function getTipMask(brush) {
  if (brush.tipImage) {
    const key = 'img:' + brush.id + ':' + (brush.invertTip ? 1 : 0) + ':' + brush.tipImage.length;
    if (tipCache.has(key)) return tipCache.get(key);
    const img = imgCache.get(brush.tipImage);
    if (img) { const m = imageToMask(img, brush.invertTip ? 'invert' : 'as-is'); tipCache.set(key, m); return m; }
    return getTipMask({ ...brush, tipImage: null, tip: 'round' });
  }
  const key = brush.tip === 'round' || !brush.tip ? 'round:' + Math.round(brush.hardness * 20) : brush.tip;
  if (!tipCache.has(key)) {
    const gen = { pencil: pencilTip, chalk: chalkTip, splatter: splatterTip, bristle: bristleTip, star: starTip }[brush.tip];
    tipCache.set(key, gen ? gen() : roundTip(brush.hardness));
  }
  return tipCache.get(key);
}

// imported images: stored as mask PNGs already (white + alpha). 'invert' flips alpha.
export function imageToMask(img, mode = 'as-is') {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, 512 / Math.max(w, h));
  const c = makeCanvas(w * s, h * s), x = c.getContext('2d');
  x.drawImage(img, 0, 0, c.width, c.height);
  if (mode === 'invert') {
    const d = x.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = 255 - d.data[i + 3];
    x.putImageData(d, 0, 0);
  }
  return c;
}

// Converts an arbitrary image into a mask. `source` hints at the convention:
//  'csp'      – dark = ink (or alpha if the image has transparency)
//  'procreate'– light = ink on black
export function rawImageToMaskCanvas(img, source = 'csp') {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, 512 / Math.max(w, h));
  const c = makeCanvas(w * s, h * s), x = c.getContext('2d');
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  let hasAlpha = false;
  for (let i = 3; i < p.length; i += 4) if (p[i] < 250) { hasAlpha = true; break; }
  for (let i = 0; i < p.length; i += 4) {
    const lum = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) / 255;
    let a;
    if (source === 'procreate') a = hasAlpha ? (p[i + 3] / 255) * lum : lum;
    else a = hasAlpha ? (p[i + 3] / 255) * (lum > 0.95 && p[i + 3] === 255 ? 0 : 1) : 1 - lum;
    p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = a * 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}

export async function preloadBrush(brush) {
  for (const src of [brush.tipImage, brush.grainImage]) {
    if (src && !imgCache.has(src)) {
      try { imgCache.set(src, await loadImage(src)); } catch { /* ignore broken image */ }
    }
  }
}

// ───────── tinting ─────────
let tintKey = '', tintCanvas = null;
export function getTintedTip(brush, color) {
  const mask = getTipMask(brush);
  const key = brush.id + '|' + color + '|' + mask.width + '|' + (brush.tipImage ? brush.tipImage.length : brush.hardness) + '|' + brush.invertTip;
  if (key === tintKey && tintCanvas) return tintCanvas;
  const c = makeCanvas(mask.width, mask.height), x = c.getContext('2d');
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  tintKey = key; tintCanvas = c;
  return c;
}

// ───────── grains (white = paint shows) ─────────
const grainCache = new Map();
function genGrain(kind) {
  const S = 256, c = makeCanvas(S, S), x = c.getContext('2d');
  const id = x.createImageData(S, S), d = id.data, rnd = seeded(kind.length * 97);
  const set = (i, v) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = clamp(v, 0, 1) * 255; };
  if (kind === 'halftone' || kind === 'hatch') {
    for (let y = 0; y < S; y++) for (let i = 0; i < S; i++) {
      let v;
      if (kind === 'halftone') { const cx = (i % 8) - 3.5, cy = (y % 8) - 3.5; v = clamp(2.8 - Math.hypot(cx, cy), 0, 1); }
      else { const a = (i + y) % 10, b = (i - y + S * 10) % 10; v = (a < 2 || b < 2) ? 1 : 0; }
      set(y * S + i, v);
    }
  } else {
    // value noise, octaves
    const N = new Float32Array(S * S);
    const oct = kind === 'canvas' ? [] : [[4, 0.45], [16, 0.3], [64, 0.25]];
    for (const [cells, amp] of oct) {
      const g = new Float32Array((cells + 1) * (cells + 1)).map(() => rnd());
      for (let wrap = 0; wrap <= cells; wrap++) { g[cells * (cells + 1) + wrap] = g[wrap]; g[wrap * (cells + 1) + cells] = g[wrap * (cells + 1)]; }
      for (let y = 0; y < S; y++) for (let i = 0; i < S; i++) {
        const fx = i / S * cells, fy = y / S * cells, x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), W = cells + 1;
        const v = (g[y0 * W + x0] * (1 - sx) + g[y0 * W + x0 + 1] * sx) * (1 - sy) + (g[(y0 + 1) * W + x0] * (1 - sx) + g[(y0 + 1) * W + x0 + 1] * sx) * sy;
        N[y * S + i] += v * amp;
      }
    }
    for (let k = 0; k < S * S; k++) {
      const i = k % S, y = (k / S) | 0;
      let v;
      if (kind === 'paper') v = (N[k] - 0.25) * 1.7 + (rnd() - 0.5) * 0.25;
      else if (kind === 'grit') v = N[k] * 0.9 + (rnd() > 0.72 ? -0.6 : 0.25);
      else /* canvas weave */ v = 0.55 + 0.3 * Math.sin(i * 0.8) * Math.sin(y * 0.8) + (rnd() - 0.5) * 0.3;
      set(k, v);
    }
  }
  x.putImageData(id, 0, 0);
  return c;
}

export const GRAINS = [['paper', 'Paper'], ['canvas', 'Canvas'], ['grit', 'Grit'], ['halftone', 'Halftone'], ['hatch', 'Crosshatch']];

export function getGrain(brush) {
  let base;
  if (brush.grainImage) {
    const img = imgCache.get(brush.grainImage);
    if (!img) return null;
    base = grainCache.get(brush.grainImage) || grainCache.set(brush.grainImage, rawImageToMaskCanvas(img, 'procreate')).get(brush.grainImage);
  } else if (brush.grain) {
    base = grainCache.get(brush.grain) || grainCache.set(brush.grain, genGrain(brush.grain)).get(brush.grain);
  } else return null;
  // apply depth: alpha' = 1 - depth*(1-alpha)
  const depth = clamp(brush.grainDepth, 0, 1);
  const key = (brush.grainImage ? brush.grainImage.length : brush.grain) + '@' + depth.toFixed(2);
  if (grainCache.has(key)) return grainCache.get(key);
  const c = makeCanvas(base.width, base.height), x = c.getContext('2d');
  x.fillStyle = `rgba(255,255,255,${1 - depth})`; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(base, 0, 0);
  grainCache.set(key, c);
  return c;
}

export function newBrushFrom(base, o = {}) {
  return { ...BRUSH_DEFAULTS, ...base, builtin: false, id: uid(), ...o };
}

// Renders a short S-stroke preview of a brush (used by the library + studio).
export function strokePreviewPoints(w, h, n = 60) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: w * (0.06 + t * 0.88), y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.22, pressure: Math.sin(t * Math.PI) * 0.9 + 0.1, tilt: 0 });
  }
  return pts;
}
