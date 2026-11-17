// Painterly look for a rasterized 3D picture: a Kuwahara filter (each pixel takes the calmest of
// its four neighbouring patches, so shading breaks into soft brush-like patches while edges stay),
// softly stepped tones and a light canvas grain. Fast: integral images, worked at ≤1400 px.
import { makeCanvas } from './util.js';

export function painterly(src, { strength = 1 } = {}) {
  const W = src.width, H = src.height, k = Math.min(1, 1400 / Math.max(W, H));
  const w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k));
  const small = makeCanvas(w, h), sx = small.getContext('2d', { willReadFrequently: true });
  sx.drawImage(src, 0, 0, w, h);
  const img = sx.getImageData(0, 0, w, h), d = img.data, n = w * h;
  // integral images (alpha-weighted colour, alpha, luminance and its square)
  const W1 = w + 1, I = (arr) => arr;
  const sR = new Float64Array(W1 * (h + 1)), sG = new Float64Array(W1 * (h + 1)), sB = new Float64Array(W1 * (h + 1)), sA = new Float64Array(W1 * (h + 1)), sL = new Float64Array(W1 * (h + 1)), sL2 = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0, a = 0, l = 0, l2 = 0;
    for (let x = 0; x < w; x++) {
      const q = (y * w + x) * 4, al = d[q + 3] / 255, lum = (0.3 * d[q] + 0.59 * d[q + 1] + 0.11 * d[q + 2]) * al;
      r += d[q] * al; g += d[q + 1] * al; b += d[q + 2] * al; a += al; l += lum; l2 += lum * lum;
      const o = (y + 1) * W1 + x + 1, u = y * W1 + x + 1;
      sR[o] = sR[u] + r; sG[o] = sG[u] + g; sB[o] = sB[u] + b; sA[o] = sA[u] + a; sL[o] = sL[u] + l; sL2[o] = sL2[u] + l2;
    }
  }
  const box = (S, x0, y0, x1, y1) => S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
  const R = Math.max(2, Math.round(Math.max(w, h) / 380 * strength));
  const out = sx.createImageData(w, h), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = (y * w + x) * 4; if (!d[q + 3]) continue;
    let best = Infinity, br = 0, bg = 0, bb = 0;
    for (let k2 = 0; k2 < 4; k2++) {
      const x0 = k2 & 1 ? x : Math.max(0, x - R), x1 = k2 & 1 ? Math.min(w, x + R + 1) : x + 1;
      const y0 = k2 & 2 ? y : Math.max(0, y - R), y1 = k2 & 2 ? Math.min(h, y + R + 1) : y + 1;
      const A = box(sA, x0, y0, x1, y1); if (A < 0.5) continue;
      const m = box(sL, x0, y0, x1, y1) / A, v = box(sL2, x0, y0, x1, y1) / A - m * m;
      if (v < best) { best = v; br = box(sR, x0, y0, x1, y1) / A; bg = box(sG, x0, y0, x1, y1) / A; bb = box(sB, x0, y0, x1, y1) / A; }
    }
    if (best === Infinity) { br = d[q]; bg = d[q + 1]; bb = d[q + 2]; }
    // softly stepped tones (5 steps, blended so it isn't hard cel shading)
    const lum = 0.3 * br + 0.59 * bg + 0.11 * bb, steps = 5, t = lum / 255 * steps, fl = Math.floor(t), fr = t - fl;
    const st = (fl + (fr < 0.5 ? 0.5 * Math.pow(2 * fr, 3) : 1 - 0.5 * Math.pow(2 * (1 - fr), 3))) / steps * 255;
    const kk = lum > 1 ? (lum * 0.45 + st * 0.55) / lum : 1;
    // light canvas grain
    const gr = 1 + 0.035 * (grain(x * 0.9, y * 0.9) - 0.5) + 0.02 * (grain(x * 0.23 + 7, y * 0.23 + 3) - 0.5);
    o[q] = Math.min(255, br * kk * gr); o[q + 1] = Math.min(255, bg * kk * gr); o[q + 2] = Math.min(255, bb * kk * gr); o[q + 3] = d[q + 3];
  }
  sx.putImageData(out, 0, 0);
  // brushwork: short strokes that pick up the colour under them and run along the form (across
  // the shading's gradient), laid in a shuffled order over the softened picture
  const pc = makeCanvas(w, h), px = pc.getContext('2d');
  px.filter = 'blur(' + Math.max(1, R * 0.6) + 'px)'; px.drawImage(small, 0, 0); px.filter = 'none';
  const lumAt = (x, y) => { const q = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4; return 0.3 * o[q] + 0.59 * o[q + 1] + 0.11 * o[q + 2]; };
  const r = Math.max(1.5, Math.max(w, h) / 240 * strength), step = r * 0.85, dabs = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const xi = Math.round(x + (hash(x, y) - 0.5) * step), yi = Math.round(y + (hash(y, x) - 0.5) * step);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h || o[(yi * w + xi) * 4 + 3] < 40) continue;
    dabs.push([xi, yi]);
  }
  for (let i = dabs.length - 1; i > 0; i--) { const j = Math.floor(hash(i, 3.7) * (i + 1)); [dabs[i], dabs[j]] = [dabs[j], dabs[i]]; }
  for (const [x, y] of dabs) {
    const q = (y * w + x) * 4, gx = lumAt(x + 2, y) - lumAt(x - 2, y), gy = lumAt(x, y + 2) - lumAt(x, y - 2);
    const ang = Math.atan2(gy, gx) + Math.PI / 2 + (hash(x, y * 1.3) - 0.5) * 0.5;
    const jit = 1 + (hash(x * 1.7, y) - 0.5) * 0.05, len = r * (1.6 + hash(y, x * 0.7) * 1.4);
    px.save(); px.translate(x, y); px.rotate(ang);
    px.fillStyle = `rgba(${Math.min(255, o[q] * jit) | 0},${Math.min(255, o[q + 1] * jit) | 0},${Math.min(255, o[q + 2] * jit) | 0},0.55)`;
    px.beginPath(); px.ellipse(0, 0, len, r * 0.7, 0, 0, Math.PI * 2); px.fill(); px.restore();
  }
  // the figure's own outline (softened a touch), so strokes don't spill past it
  const mask = makeCanvas(w, h), mx = mask.getContext('2d');
  mx.filter = 'blur(0.8px)'; mx.drawImage(small, 0, 0); mx.filter = 'none';
  px.globalCompositeOperation = 'destination-in'; px.drawImage(mask, 0, 0); px.globalCompositeOperation = 'source-over';
  const res = makeCanvas(W, H), rx = res.getContext('2d');
  rx.imageSmoothingQuality = 'high'; rx.drawImage(pc, 0, 0, W, H);
  return res;
}
// smooth value noise 0…1
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function grain(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), dd = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + dd) * u * v;
}
