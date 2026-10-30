// Fill, selection, transform and pixel adjustments.
import { makeCanvas, hexToRgb, clamp, emptyRect, growRect } from './util.js';

// ───────── flood fill ─────────
function dilate(mask, w, h, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) count += mask[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += mask[row + x + r];
      if (x - r - 1 >= 0) count -= mask[row + x - r - 1];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

function scanFill(open, w, h, sx, sy) {
  const out = new Uint8Array(w * h);
  if (!open[sy * w + sx]) return out;
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(); let x = stack.pop();
    let i = y * w + x;
    while (x > 0 && open[i - 1] && !out[i - 1]) { x--; i--; }
    let up = false, down = false;
    for (; x < w && open[i] && !out[i]; x++, i++) {
      out[i] = 1;
      if (y > 0) { const u = open[i - w] && !out[i - w]; if (u && !up) { stack.push(x, y - 1); up = true; } else if (!u) up = false; }
      if (y < h - 1) { const d = open[i + w] && !out[i + w]; if (d && !down) { stack.push(x, y + 1); down = true; } else if (!d) down = false; }
    }
  }
  return out;
}

// refCanvas: what boundaries are read from (doc space). Returns a doc-sized canvas with the fill.
export function computeFill(refCanvas, x, y, color, { tolerance = 0.1, gap = 0, expand = 1, selection = null } = {}) {
  const w = refCanvas.width, h = refCanvas.height;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const src = refCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const k = (y * w + x) * 4;
  const sr = src[k], sg = src[k + 1], sb = src[k + 2], sa = src[k + 3];
  const tol = tolerance * 255;
  const n = w * h;
  let open = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = src[j + 3];
    // compare premultiplied-ish so transparent pixels match regardless of rgb
    const d = Math.max(Math.abs(a - sa), Math.abs(src[j] * a - sr * sa) / 255, Math.abs(src[j + 1] * a - sg * sa) / 255, Math.abs(src[j + 2] * a - sb * sa) / 255);
    open[i] = d <= tol ? 1 : 0;
  }
  let region;
  if (gap > 0) {
    const barrier = new Uint8Array(n);
    for (let i = 0; i < n; i++) barrier[i] = open[i] ? 0 : 1;
    const thick = dilate(barrier, w, h, gap);
    const open2 = new Uint8Array(n);
    for (let i = 0; i < n; i++) open2[i] = thick[i] ? 0 : 1;
    region = open2[y * w + x] ? scanFill(open2, w, h, x, y) : scanFill(open, w, h, x, y);
    if (open2[y * w + x]) {
      // grow back into the original open area that gap-closing shaved off
      const grown = dilate(region, w, h, gap + 1);
      for (let i = 0; i < n; i++) region[i] = grown[i] && open[i] ? 1 : 0;
    }
  } else region = scanFill(open, w, h, x, y);
  if (expand > 0) region = dilate(region, w, h, expand);
  const [r, g, b] = hexToRgb(color);
  const out = makeCanvas(w, h), ox = out.getContext('2d');
  const id = ox.createImageData(w, h), d = id.data;
  let any = false;
  for (let i = 0, j = 0; i < n; i++, j += 4) if (region[i]) { d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255; any = true; }
  if (!any) return null;
  ox.putImageData(id, 0, 0);
  if (selection) { ox.globalCompositeOperation = 'destination-in'; ox.drawImage(selection, 0, 0); }
  return out;
}

// ───────── selection ─────────
export class Selection {
  constructor(w, h) { this.w = w; this.h = h; this.mask = null; this.paths = []; this.inverted = false; }
  get active() { return !!this.mask; }
  clear() { this.mask = null; this.paths = []; this.inverted = false; }
  ensure() {
    if (!this.mask || this.mask.width !== this.w || this.mask.height !== this.h) this.mask = makeCanvas(this.w, this.h);
    return this.mask.getContext('2d');
  }
  // shape: {type:'poly', pts} | {type:'rect', x,y,w,h} | {type:'ellipse', cx,cy,rx,ry}
  apply(shape, op = 'replace') {
    const wasActive = this.active;
    const x = this.ensure();
    if (op === 'replace' || !wasActive) { x.clearRect(0, 0, this.w, this.h); this.paths = []; this.inverted = false; }
    x.globalCompositeOperation = op === 'subtract' ? 'destination-out' : 'source-over';
    x.fillStyle = '#000';
    x.beginPath(); tracePath(x, shape); x.fill();
    x.globalCompositeOperation = 'source-over';
    this.paths.push({ shape, op });
    if (this.isEmpty()) this.clear();
  }
  isEmpty() {
    const d = this.mask.getContext('2d').getImageData(0, 0, this.w, this.h).data;
    for (let i = 3; i < d.length; i += 64) if (d[i]) return false;
    return true;
  }
  invert() {
    const x = this.ensure();
    const tmp = makeCanvas(this.w, this.h), t = tmp.getContext('2d');
    t.fillRect(0, 0, this.w, this.h);
    t.globalCompositeOperation = 'destination-out'; t.drawImage(this.mask, 0, 0);
    x.clearRect(0, 0, this.w, this.h); x.drawImage(tmp, 0, 0);
    this.inverted = !this.inverted;
  }
  selectAll() { this.clear(); this.apply({ type: 'rect', x: 0, y: 0, w: this.w, h: this.h }); }
  fromAlpha(canvas) {
    const x = this.ensure(); x.clearRect(0, 0, this.w, this.h); x.drawImage(canvas, 0, 0);
    this.paths = []; this.inverted = false;
    this.paths.push({ shape: { type: 'rect', x: 0, y: 0, w: this.w, h: this.h }, op: 'alpha' });
  }
  snapshot() { return { mask: this.mask ? (() => { const c = makeCanvas(this.w, this.h); c.getContext('2d').drawImage(this.mask, 0, 0); return c; })() : null, paths: [...this.paths], inverted: this.inverted }; }
  restore(s) { this.mask = s.mask; this.paths = s.paths; this.inverted = s.inverted; }
  bounds() {
    if (!this.mask) return null;
    return alphaBounds(this.mask);
  }
}

export function tracePath(x, s) {
  if (s.type === 'rect') x.rect(s.x, s.y, s.w, s.h);
  else if (s.type === 'ellipse') x.ellipse(s.cx, s.cy, Math.abs(s.rx), Math.abs(s.ry), 0, 0, Math.PI * 2);
  else if (s.type === 'poly' && s.pts.length) { x.moveTo(s.pts[0].x, s.pts[0].y); for (const p of s.pts) x.lineTo(p.x, p.y); x.closePath(); }
}

export function alphaBounds(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) if (d[row + x * 4 + 3]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ───────── transform (free transform of a layer or the selected pixels) ─────────
export class FloatingTransform {
  constructor(target, selection) {
    const c = target.canvas;
    this.target = target;
    this.float = makeCanvas(c.width, c.height);
    const f = this.float.getContext('2d');
    f.drawImage(c, 0, 0);
    if (selection && selection.active) { f.globalCompositeOperation = 'destination-in'; f.drawImage(selection.mask, 0, 0); }
    this.bbox = alphaBounds(this.float) || { x: 0, y: 0, w: c.width, h: c.height };
    // cut from the layer
    const t = c.getContext('2d');
    this.original = makeCanvas(c.width, c.height);
    this.original.getContext('2d').drawImage(c, 0, 0);
    if (selection && selection.active) { t.save(); t.globalCompositeOperation = 'destination-out'; t.drawImage(selection.mask, 0, 0); t.restore(); }
    else t.clearRect(0, 0, c.width, c.height);
    this.tx = 0; this.ty = 0; this.sx = 1; this.sy = 1; this.rot = 0; this.flipX = 1; this.flipY = 1;
    this.preview = makeCanvas(c.width, c.height);
    this.smooth = true;
    this.update();
  }
  get center() { return { x: this.bbox.x + this.bbox.w / 2, y: this.bbox.y + this.bbox.h / 2 }; }
  matrix() {
    const c = this.center;
    return new DOMMatrix().translate(c.x + this.tx, c.y + this.ty).rotate(this.rot).scale(this.sx * this.flipX, this.sy * this.flipY).translate(-c.x, -c.y);
  }
  corners() {
    const m = this.matrix(), b = this.bbox;
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => m.transformPoint({ x, y }));
  }
  update() {
    const p = this.preview.getContext('2d');
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, this.preview.width, this.preview.height);
    p.drawImage(this.target.canvas, 0, 0);
    const m = this.matrix();
    p.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    p.imageSmoothingEnabled = this.smooth; p.imageSmoothingQuality = 'high';
    p.drawImage(this.float, 0, 0);
    p.setTransform(1, 0, 0, 1, 0, 0);
  }
  commit() {
    const t = this.target.canvas.getContext('2d');
    const m = this.matrix();
    t.save(); t.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    t.imageSmoothingEnabled = this.smooth; t.imageSmoothingQuality = 'high';
    t.drawImage(this.float, 0, 0); t.restore();
  }
  cancel() {
    const t = this.target.canvas.getContext('2d');
    t.clearRect(0, 0, this.target.canvas.width, this.target.canvas.height);
    t.drawImage(this.original, 0, 0);
  }
}

// ───────── adjustments (operate on ImageData in place) ─────────
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh / 6, s, l];
}
function hsl2rgb(hh, s, l) {
  if (!s) return [l, l, l];
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, hh + 1 / 3), f(p, q, hh), f(p, q, hh - 1 / 3)];
}

export const ADJUSTMENTS = {
  hsb: {
    name: 'Hue, Saturation, Brightness',
    params: [['hue', 'Hue', -180, 180, 0, 1], ['sat', 'Saturation', -100, 100, 0, 1], ['bri', 'Brightness', -100, 100, 0, 1]],
    run(d, p) {
      const dh = p.hue / 360, ds = p.sat / 100, db = p.bri / 100;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        let [hh, s, l] = rgb2hsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
        hh = (hh + dh + 1) % 1;
        s = clamp(ds > 0 ? s + (1 - s) * ds : s * (1 + ds), 0, 1);
        l = clamp(db > 0 ? l + (1 - l) * db : l * (1 + db), 0, 1);
        const [r, g, b] = hsl2rgb(hh, s, l);
        d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
      }
    },
  },
  balance: {
    name: 'Color Balance',
    params: [['r', 'Cyan ↔ Red', -100, 100, 0, 1], ['g', 'Magenta ↔ Green', -100, 100, 0, 1], ['b', 'Yellow ↔ Blue', -100, 100, 0, 1]],
    run(d, p) { for (let i = 0; i < d.length; i += 4) { d[i] = clamp(d[i] + p.r * 1.27, 0, 255); d[i + 1] = clamp(d[i + 1] + p.g * 1.27, 0, 255); d[i + 2] = clamp(d[i + 2] + p.b * 1.27, 0, 255); } },
  },
  curves: {
    name: 'Levels / Contrast',
    params: [['black', 'Black point', 0, 254, 0, 1], ['white', 'White point', 1, 255, 255, 1], ['gamma', 'Gamma', 0.2, 3, 1, 0.01], ['contrast', 'Contrast', -100, 100, 0, 1]],
    run(d, p) {
      const lut = new Uint8ClampedArray(256), c = p.contrast / 100, cf = c >= 0 ? 1 / (1 - c * 0.99) : 1 + c;
      for (let v = 0; v < 256; v++) {
        let x = clamp((v - p.black) / Math.max(1, p.white - p.black), 0, 1);
        x = Math.pow(x, 1 / p.gamma);
        x = (x - 0.5) * cf + 0.5;
        lut[v] = x * 255;
      }
      for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    },
  },
  blur: {
    name: 'Gaussian Blur',
    params: [['radius', 'Radius', 0, 60, 4, 1]],
    run(d, p, w, h) { if (p.radius > 0) gaussian(d, w, h, p.radius); },
  },
  sharpen: {
    name: 'Sharpen',
    params: [['amount', 'Amount', 0, 200, 60, 1], ['radius', 'Radius', 1, 10, 2, 1]],
    run(d, p, w, h) {
      const orig = new Uint8ClampedArray(d); gaussian(orig, w, h, p.radius);
      const a = p.amount / 100;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + (d[i + c] - orig[i + c]) * a, 0, 255);
    },
  },
  noise: {
    name: 'Noise',
    params: [['amount', 'Amount', 0, 100, 15, 1], ['mono', 'Monochrome (0/1)', 0, 1, 1, 1]],
    run(d, p) {
      const a = p.amount * 1.6;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const n = (Math.random() - 0.5) * a;
        d[i] = clamp(d[i] + n, 0, 255);
        d[i + 1] = clamp(d[i + 1] + (p.mono ? n : (Math.random() - 0.5) * a), 0, 255);
        d[i + 2] = clamp(d[i + 2] + (p.mono ? n : (Math.random() - 0.5) * a), 0, 255);
      }
    },
  },
  posterize: {
    name: 'Posterize',
    params: [['levels', 'Levels', 2, 32, 6, 1]],
    run(d, p) { const s = 255 / (p.levels - 1); for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] / s) * s; },
  },
  threshold: {
    name: 'Threshold (B/W)',
    params: [['level', 'Level', 0, 255, 128, 1]],
    run(d, p) { for (let i = 0; i < d.length; i += 4) { const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 >= p.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } },
  },
  invert: {
    name: 'Invert colors', params: [],
    run(d) { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } },
  },
  lumToAlpha: {
    name: 'Brightness → Opacity (scan line art)',
    params: [['cut', 'Paper cut-off', 0, 100, 10, 1]],
    run(d, p) {
      const cut = p.cut / 100;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        const a = clamp((1 - l - cut) / (1 - cut || 1), 0, 1);
        d[i + 3] = d[i + 3] * a; d[i] = d[i + 1] = d[i + 2] = 0;
      }
    },
  },
  lineColor: {
    name: 'Change line color (uses current color)', params: [],
    run(d, p) { const [r, g, b] = hexToRgb(p.color); for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; } },
  },
  gradientMap: {
    name: 'Gradient Map (shadow → current color → white)', params: [['mix', 'Strength', 0, 100, 100, 1]],
    run(d, p) {
      const [r, g, b] = hexToRgb(p.color), m = p.mix / 100;
      const stops = [[20, 16, 40], [r, g, b], [255, 252, 240]];
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        const t = l * 2, k = t < 1 ? 0 : 1, f = t - k;
        for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - m) + (stops[k][c] * (1 - f) + stops[k + 1][c] * f) * m;
      }
    },
  },
};

export function gaussian(d, w, h, r) {
  // three box blurs ≈ gaussian, on premultiplied channels so transparent edges don't darken
  if (Math.min(w, h) < 3) return;
  const n = w * h, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255; ch[3][i] = d[i * 4 + 3]; for (let c = 0; c < 3; c++) ch[c][i] = d[i * 4 + c] * a; }
  const box = Math.min(Math.max(1, Math.round(r / 1.7)), ((Math.min(w, h) - 1) / 2) | 0);
  if (box < 1) return;
  const tmp = new Float32Array(n);
  for (const a of ch) for (let pass = 0; pass < 3; pass++) { boxH(a, tmp, w, h, box); boxV(tmp, a, w, h, box); }
  for (let i = 0; i < n; i++) {
    const a = ch[3][i]; d[i * 4 + 3] = a;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = a > 0 ? ch[c][i] / (a / 255) : 0;
  }
}
function boxH(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    let ti = y * w, li = ti, ri = ti + r;
    const fv = src[ti], lv = src[ti + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[ti + Math.min(j, w - 1)];
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri++, y * w + w - 1)] - fv; dst[ti++] = val * iarr; }
    for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr; }
    for (let j = Math.max(w - r, r + 1); j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr; }
  }
}
function boxV(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let ti = x, li = ti, ri = ti + r * w;
    const fv = src[ti], lv = src[ti + w * (h - 1)];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[ti + Math.min(j, h - 1) * w];
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri, x + (h - 1) * w)] - fv; ri += w; dst[ti] = val * iarr; ti += w; }
    for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; ri += w; li += w; dst[ti] = val * iarr; ti += w; }
    for (let j = Math.max(h - r, r + 1); j < h; j++) { val += lv - src[li]; li += w; dst[ti] = val * iarr; ti += w; }
  }
}

export { emptyRect, growRect };
