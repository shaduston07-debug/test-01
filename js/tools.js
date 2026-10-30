// Fill, selection, transform and pixel adjustments.
import { makeCanvas, hexToRgb, clamp, emptyRect, growRect } from './util.js';

// ───────── flood fill ─────────
// Square max-filter of radius r, limited to box (x0,y0,x1,y1 inclusive) grown by r.
function dilate(mask, w, h, r, box) {
  if (r <= 0) return mask;
  const bx0 = Math.max(0, (box ? box.x0 : 0) - r), bx1 = Math.min(w - 1, (box ? box.x1 : w - 1) + r);
  const by0 = Math.max(0, (box ? box.y0 : 0) - r), by1 = Math.min(h - 1, (box ? box.y1 : h - 1) + r);
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = by0; y <= by1; y++) {
    const row = y * w; let count = 0;
    for (let x = bx0; x < Math.min(bx0 + r, bx1 + 1); x++) count += mask[row + x];
    for (let x = bx0; x <= bx1; x++) {
      if (x + r <= bx1) count += mask[row + x + r];
      if (x - r - 1 >= bx0) count -= mask[row + x - r - 1];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = bx0; x <= bx1; x++) {
    let count = 0;
    for (let y = by0; y < Math.min(by0 + r, by1 + 1); y++) count += tmp[y * w + x];
    for (let y = by0; y <= by1; y++) {
      if (y + r <= by1) count += tmp[(y + r) * w + x];
      if (y - r - 1 >= by0) count -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  out.bbox = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
  return out;
}

// Scanline flood fill. open(i) says whether pixel i may be filled; the bounding box of the
// result is kept on .bbox so later steps only touch that area.
function scanFillWith(open, w, h, sx, sy) {
  const out = new Uint8Array(w * h);
  let x0 = sx, x1 = sx, y0 = sy, y1 = sy;
  if (!open(sy * w + sx)) { out.bbox = null; return out; }
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(); let x = stack.pop();
    let i = y * w + x;
    while (x > 0 && !out[i - 1] && open(i - 1)) { x--; i--; }
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    let up = false, down = false;
    for (; x < w && !out[i] && open(i); x++, i++) {
      out[i] = 1;
      if (y > 0) { const u = !out[i - w] && open(i - w); if (u && !up) { stack.push(x, y - 1); up = true; } else if (!u) up = false; }
      if (y < h - 1) { const d = !out[i + w] && open(i + w); if (d && !down) { stack.push(x, y + 1); down = true; } else if (!d) down = false; }
    }
    if (x - 1 > x1) x1 = x - 1;
  }
  out.bbox = { x0, y0, x1, y1 };
  return out;
}
const scanFill = (open, w, h, sx, sy) => scanFillWith((i) => open[i] === 1, w, h, sx, sy);

// colour-distance test against the seed (premultiplied-ish so transparent pixels match
// regardless of their rgb); evaluated lazily and memoised
function similarity(src, w, h, x, y, tolerance) {
  const k = (y * w + x) * 4, sr = src[k], sg = src[k + 1], sb = src[k + 2], sa = src[k + 3];
  const tol = tolerance * 255, memo = new Uint8Array(w * h);
  return (i) => {
    const m = memo[i]; if (m) return m === 1;
    const j = i * 4, a = src[j + 3];
    const d = Math.max(Math.abs(a - sa), Math.abs(src[j] * a - sr * sa) / 255, Math.abs(src[j + 1] * a - sg * sa) / 255, Math.abs(src[j + 2] * a - sb * sa) / 255);
    memo[i] = d <= tol ? 1 : 2;
    return d <= tol;
  };
}


// refCanvas: what boundaries are read from (doc space). Returns a doc-sized canvas with the fill.
// Pure flood-fill core (runs on the main thread or in a worker): returns the filled region
// as a 0/1 mask, or null when nothing would be filled.
export function fillRegion(src, w, h, x, y, { tolerance = 0.1, gap = 0, expand = 1 } = {}) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const n = w * h, same = similarity(src, w, h, x, y, tolerance);
  let region;
  if (gap > 0) {
    // gap closing needs the whole barrier map
    const open = new Uint8Array(n);
    for (let i = 0; i < n; i++) open[i] = same(i) ? 1 : 0;
    const barrier = new Uint8Array(n);
    for (let i = 0; i < n; i++) barrier[i] = open[i] ? 0 : 1;
    const thick = dilate(barrier, w, h, gap);
    const open2 = new Uint8Array(n);
    for (let i = 0; i < n; i++) open2[i] = thick[i] ? 0 : 1;
    region = open2[y * w + x] ? scanFill(open2, w, h, x, y) : scanFill(open, w, h, x, y);
    if (open2[y * w + x]) {
      // grow back into the original open area that gap-closing shaved off
      const grown = dilate(region, w, h, gap + 1, region.bbox);
      for (let i = 0; i < n; i++) region[i] = grown[i] && open[i] ? 1 : 0;
      region.bbox = grown.bbox;
    }
  } else region = scanFillWith(same, w, h, x, y); // only pixels the fill reaches are tested
  if (!region.bbox) return null;
  if (expand > 0) region = dilate(region, w, h, expand, region.bbox);
  return region;
}

// Region mask → canvas (coloured fill, or alpha-only when color is null), optionally clipped.
export function regionToCanvas(region, w, h, color, selection) {
  const out = makeCanvas(w, h), ox = out.getContext('2d');
  const b = region.bbox || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  const id = ox.createImageData(bw, bh), d = id.data;
  const [r, g, bl] = color ? hexToRgb(color) : [0, 0, 0];
  for (let y = 0; y < bh; y++) {
    const ri = (y + b.y0) * w + b.x0;
    for (let x = 0, j = y * bw * 4; x < bw; x++, j += 4) if (region[ri + x]) { d[j] = r; d[j + 1] = g; d[j + 2] = bl; d[j + 3] = 255; }
  }
  ox.putImageData(id, b.x0, b.y0);
  if (selection) { ox.globalCompositeOperation = 'destination-in'; ox.drawImage(selection, 0, 0); }
  out.bbox = { x: b.x0, y: b.y0, w: bw, h: bh };
  return out;
}

export function computeFill(refCanvas, x, y, color, opts = {}) {
  const w = refCanvas.width, h = refCanvas.height;
  const src = refCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const region = fillRegion(src, w, h, x, y, opts);
  return region ? regionToCanvas(region, w, h, color, opts.selection) : null;
}

// ───────── selection ─────────
// The selection is an alpha mask. Vector shapes also keep their outlines for crisp
// marching ants; mask-only results (magic wand, feather, intersect) show computed edges.
export class Selection {
  constructor(w, h) { this.w = w; this.h = h; this.mask = null; this.paths = []; this.vector = true; this.ver = 0; }
  get active() { return !!this.mask; }
  clear() { this.mask = null; this.paths = []; this.vector = true; this.ver++; }
  newMask() { return makeCanvas(this.w, this.h); }
  // op: replace | add | subtract | intersect  (src = full-size mask canvas)
  combine(src, op = 'replace') {
    if (!this.mask || op === 'replace') {
      if (op === 'subtract' || op === 'intersect') { if (!this.mask) return; }
      else { this.mask = src; this.ver++; if (this.isEmpty()) this.clear(); return; }
    }
    const x = this.mask.getContext('2d');
    x.globalCompositeOperation = op === 'add' ? 'source-over' : op === 'subtract' ? 'destination-out' : 'destination-in';
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-over';
    this.ver++;
    if (this.isEmpty()) this.clear();
  }
  apply(shape, op = 'replace') {
    const m = this.newMask(), x = m.getContext('2d');
    x.fillStyle = '#000'; x.beginPath(); tracePath(x, shape); x.fill();
    if (op === 'replace' || !this.mask) { this.paths = []; this.vector = true; }
    if (op === 'intersect') this.vector = false;
    this.combine(m, op);
    if (this.mask && this.vector) this.paths.push({ shape, op });
  }
  applyMask(m, op = 'replace') {
    this.vector = false; this.paths = [];
    this.combine(m, op);
  }
  isEmpty() {
    const d = this.mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.w, this.h).data;
    for (let i = 3; i < d.length; i += 32) if (d[i]) return false;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
    return true;
  }
  invert() {
    if (!this.mask) { this.selectAll(); return; }
    const m = this.newMask(), t = m.getContext('2d');
    t.fillRect(0, 0, this.w, this.h);
    t.globalCompositeOperation = 'destination-out'; t.drawImage(this.mask, 0, 0);
    this.mask = m; this.vector = false; this.paths = []; this.ver++;
  }
  selectAll() { this.clear(); this.apply({ type: 'rect', x: 0, y: 0, w: this.w, h: this.h }); }
  fromAlpha(canvas) { const m = this.newMask(); m.getContext('2d').drawImage(canvas, 0, 0); this.mask = null; this.applyMask(m, 'replace'); }
  feather(r) {
    if (!this.mask || r <= 0) return;
    const x = this.mask.getContext('2d', { willReadFrequently: true });
    const id = x.getImageData(0, 0, this.w, this.h);
    gaussian(id.data, this.w, this.h, r);
    x.putImageData(id, 0, 0);
    this.vector = false; this.paths = []; this.ver++;
  }
  snapshot() {
    const c = this.mask ? this.newMask() : null;
    if (c) c.getContext('2d').drawImage(this.mask, 0, 0);
    return { mask: c, paths: [...this.paths], vector: this.vector };
  }
  restore(s) {
    if (s.mask) { const c = this.newMask(); c.getContext('2d').drawImage(s.mask, 0, 0); this.mask = c; } else this.mask = null;
    this.paths = [...s.paths]; this.vector = s.vector; this.ver++;
  }
  bounds() { return this.mask ? alphaBounds(this.mask) : null; }
  // 1-px dashed edge image for non-vector selections (computed once per change)
  edges() {
    if (this._edgeVer === this.ver && this._edges) return this._edges;
    const w = this.w, h = this.h;
    const src = this.mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const out = this._edges && this._edges.width === w && this._edges.height === h ? this._edges : makeCanvas(w, h);
    const ox = out.getContext('2d'), id = ox.createImageData(w, h), d = id.data;
    const on = (i) => src[i * 4 + 3] >= 128;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!on(i)) continue;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1 && on(i - 1) && on(i + 1) && on(i - w) && on(i + w)) continue;
      const v = ((x + y) >> 2) & 1 ? 255 : 0;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ox.putImageData(id, 0, 0);
    this._edges = out; this._edgeVer = this.ver;
    return out;
  }
}

// Magic-wand region (Automatic selection). ref: ImageData of what is sampled.
// Magic-wand (Automatic selection) core: 0/1 region of similar colour connected to (x, y).
export function wandRegion(src, w, h, x, y, tolerance) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) { const e = new Uint8Array(w * h); e.bbox = null; return e; }
  return scanFillWith(similarity(src, w, h, x, y, tolerance), w, h, x, y);
}
export function wandMask(ref, x, y, tolerance) {
  return regionToCanvas(wandRegion(ref.data, ref.width, ref.height, x, y, tolerance), ref.width, ref.height, null, null);
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
    name: 'Gradient Map',
    params: [['mix', 'Strength', 0, 100, 100, 1]],
    // p.stops: [[pos 0–1, '#rrggbb'], …] mapped from dark to light
    run(d, p) {
      const stops = (p.stops && p.stops.length >= 2 ? p.stops : GRADIENT_PRESETS[0].stops).slice().sort((a, b) => a[0] - b[0]);
      const lut = gradientLUT(stops), m = p.mix / 100;
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * 3;
        d[i] += (lut[l] - d[i]) * m; d[i + 1] += (lut[l + 1] - d[i + 1]) * m; d[i + 2] += (lut[l + 2] - d[i + 2]) * m;
      }
    },
  },
};

// 256-entry RGB lookup table for a gradient (stops sorted by position)
export function gradientLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 3), rgb = stops.map(([pos, hex]) => [pos, ...hexToRgb(hex)]);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let k = 0; while (k < rgb.length - 2 && t > rgb[k + 1][0]) k++;
    const a = rgb[k], b = rgb[Math.min(k + 1, rgb.length - 1)];
    const f = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
  }
  return lut;
}
const G = (name, ...cols) => ({ name, stops: cols.map((c, i) => [i / (cols.length - 1), c]) });
export const GRADIENT_PRESETS = [
  G('Noir', '#000000', '#3a3a3a', '#f2f2f2'),
  G('Sepia', '#1e0f05', '#7a4b26', '#e9cfa3', '#fff8ea'),
  G('Golden Hour', '#1b0a2a', '#b5323c', '#f6a03a', '#ffeab0'),
  G('Sunset', '#0d0630', '#6a1b6d', '#e8486a', '#ffb36b', '#fff1c1'),
  G('Ocean', '#020b1a', '#08386b', '#1f8ec2', '#9fe7f2', '#f2ffff'),
  G('Forest', '#06120a', '#1f4a2a', '#6a9a4a', '#dfe9b0'),
  G('Ice', '#05061a', '#2b3d8c', '#7fb8e8', '#ffffff'),
  G('Fire', '#000000', '#5a0a00', '#d43b00', '#ffb000', '#fff7c0'),
  G('Neon City', '#07021a', '#3a0ca3', '#f72585', '#4cc9f0', '#e8fbff'),
  G('Pastel Dream', '#5b5a8f', '#c79bd9', '#ffc4d6', '#fff4c9'),
  G('Mystic', '#0b0014', '#3c096c', '#9d4edd', '#e0aaff'),
  G('Blood Moon', '#050000', '#4a0000', '#b3001b', '#ff8a65'),
  G('Toxic', '#010a01', '#1f4d00', '#7fff00', '#f4ffcc'),
  G('Twilight', '#0f0c29', '#302b63', '#c06c84', '#f8b195'),
  G('Copper', '#120804', '#5e2c12', '#c26a35', '#f5c79a'),
  G('Infrared', '#000000', '#2b00ff', '#ff0055', '#ffee00', '#ffffff'),
  G('Duotone Pink/Blue', '#1a2a6c', '#ff6fb5'),
  G('Duotone Teal/Orange', '#004e5a', '#ff9e57'),
  G('Vintage Film', '#2b1d14', '#6b5a43', '#c2b280', '#f4ecd8'),
  G('Mint Chocolate', '#2a1810', '#5b3a29', '#98d8c8', '#f1fff8'),
];

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
