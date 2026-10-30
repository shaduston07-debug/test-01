// Document model: raster layers, vector layers (comic frames, balloons), animation tracks.
import { makeCanvas, uid, canvasToBlob, blobToCanvas, dataURLToBlob, blobToDataURL } from './util.js';

// PNG-encode a layer only if it changed since the last save (canvas._ver is bumped by history).
async function blobFor(c) {
  const v = c._ver || 0;
  if (c._blob && c._blobVer === v) return c._blob;
  const b = await canvasToBlob(c);
  c._blob = b; c._blobVer = v;
  return b;
}
function seedBlob(c, blob) { if (blob instanceof Blob) { c._blob = blob; c._blobVer = c._ver || 0; } }

export const BLEND_MODES = [
  ['source-over', 'Normal', 'N'], ['multiply', 'Multiply', 'M'], ['screen', 'Screen', 'S'],
  ['overlay', 'Overlay', 'O'], ['darken', 'Darken', 'D'], ['lighten', 'Lighten', 'L'],
  ['color-dodge', 'Color Dodge', 'CD'], ['color-burn', 'Color Burn', 'CB'], ['hard-light', 'Hard Light', 'HL'],
  ['soft-light', 'Soft Light', 'SL'], ['difference', 'Difference', 'Di'], ['exclusion', 'Exclusion', 'E'],
  ['hue', 'Hue', 'H'], ['saturation', 'Saturation', 'Sa'], ['color', 'Color', 'C'], ['luminosity', 'Luminosity', 'Lu'],
  ['lighter', 'Add (Glow)', 'A'],
];
export const blendShort = (b) => (BLEND_MODES.find((m) => m[0] === b) || BLEND_MODES[0])[2];

const LAYER_PROPS = ['id', 'type', 'name', 'visible', 'opacity', 'blend', 'alphaLock', 'clip', 'reference', 'panelMask', 'locked'];

export class Layer {
  constructor(w, h, o = {}) {
    this.id = o.id || uid();
    this.type = o.type || 'raster';
    this.name = o.name || 'Layer';
    this.visible = o.visible ?? true;
    this.opacity = o.opacity ?? 1;
    this.blend = o.blend || 'source-over';
    this.alphaLock = !!o.alphaLock;
    this.clip = !!o.clip;
    this.reference = !!o.reference;
    this.panelMask = !!o.panelMask;
    this.locked = !!o.locked;
    if (this.type === 'raster') this.canvas = makeCanvas(w, h);
    if (this.type === 'frames') {
      this.panels = o.panels || [];
      this.border = o.border ?? 6;
      this.borderColor = o.borderColor || '#111111';
    }
    if (this.type === 'balloons') this.balloons = o.balloons || [];
  }
  get isRaster() { return this.type === 'raster'; }
}

export class Track {
  constructor(o = {}) {
    this.id = o.id || uid();
    this.type = 'track';
    this.name = o.name || 'Track';
    this.visible = o.visible ?? true;
    this.opacity = o.opacity ?? 1;
    this.blend = o.blend || 'source-over';
    this.alphaLock = !!o.alphaLock;
    this.clip = !!o.clip;
    this.reference = !!o.reference;
    this.cels = [];   // {id, start, dur, canvas}
    this.keys = o.keys || [];   // {f, x, y, s, r, o, ease}
  }
  get isRaster() { return true; }
  celAt(f) { return this.cels.find((c) => f >= c.start && f < c.start + c.dur) || null; }
  sortCels() { this.cels.sort((a, b) => a.start - b.start); }
  transformAt(f) {
    const k = this.keys;
    if (!k.length) return { x: 0, y: 0, s: 1, r: 0, o: 1 };
    if (f <= k[0].f) return k[0];
    const last = k[k.length - 1];
    if (f >= last.f) return last;
    let i = 0; while (k[i + 1].f < f) i++;
    const a = k[i], b = k[i + 1];
    let t = (f - a.f) / (b.f - a.f);
    if (a.ease === 'smooth') t = t * t * (3 - 2 * t);
    else if (a.ease === 'hold') t = 0;
    const L = (p, q) => p + (q - p) * t;
    return { x: L(a.x, b.x), y: L(a.y, b.y), s: L(a.s, b.s), r: L(a.r, b.r), o: L(a.o, b.o) };
  }
  setKey(f, t) {
    const i = this.keys.findIndex((k) => k.f === f);
    const key = { f, x: t.x, y: t.y, s: t.s, r: t.r, o: t.o, ease: t.ease || (i >= 0 ? this.keys[i].ease : 'smooth') };
    if (i >= 0) this.keys[i] = key; else { this.keys.push(key); this.keys.sort((a, b) => a.f - b.f); }
  }
}

// Doc-space → track-local matrix (track transforms pivot on the canvas centre).
export function trackMatrix(t, w, h) {
  return new DOMMatrix().translate(t.x + w / 2, t.y + h / 2).rotate(t.r).scale(t.s).translate(-w / 2, -h / 2);
}
const isIdentity = (t) => !t || (t.x === 0 && t.y === 0 && t.s === 1 && t.r === 0);

export class Doc {
  constructor(o = {}) {
    this.id = o.id || uid();
    this.name = o.name || 'Untitled';
    this.mode = o.mode || 'paint';
    this.width = o.width || 2048;
    this.height = o.height || 2048;
    this.bg = o.bg || '#ffffff';
    this.bgVisible = o.bgVisible ?? true;
    this.layers = [];
    this.tracks = [];
    this.active = 0;
    this.playhead = 0;
    this.anim = Object.assign({ fps: 12, length: 24, loop: 'loop', onion: { on: true, before: 2, after: 1, opacity: 0.35 } }, o.anim || {});
    this.webtoon = Object.assign({ sliceHeight: 1280, gutter: 60 }, o.webtoon || {});
    this._tmp = [];
    this.created = o.created || Date.now();
  }

  static create({ name, mode, width, height, bg }) {
    const d = new Doc({ name, mode, width, height, bg });
    if (mode === 'animate') {
      const t = new Track({ name: 'Track 1' });
      d.tracks.push(t);
      d.addCel(t, 0, 1);
    } else if (mode === 'webtoon') {
      d.layers.push(new Layer(width, height, { name: 'Colors', panelMask: true }));
      d.layers.push(new Layer(width, height, { name: 'Line art', panelMask: true }));
      d.layers.push(new Layer(width, height, { type: 'frames', name: 'Panels' }));
      d.layers.push(new Layer(width, height, { type: 'balloons', name: 'Balloons & Text' }));
      d.active = 1;
    } else {
      d.layers.push(new Layer(width, height, { name: 'Layer 1' }));
    }
    return d;
  }

  get items() { return this.mode === 'animate' ? this.tracks : this.layers; }
  get activeItem() { return this.items[this.active] || null; }
  get pixelBytes() { return this.width * this.height * 4; }
  rasterCount() {
    if (this.mode === 'animate') return this.tracks.reduce((n, t) => n + t.cels.length, 0);
    return this.layers.filter((l) => l.isRaster).length;
  }
  framesLayer() { return this.layers.find((l) => l.type === 'frames'); }
  panels() { const f = this.framesLayer(); return f && f.visible ? f.panels : []; }

  addCel(track, start, dur = 1) {
    const cel = { id: uid(), start, dur, canvas: makeCanvas(this.width, this.height) };
    track.cels.push(cel); track.sortCels();
    return cel;
  }

  // Where brush strokes land, plus the doc→local mapping.
  getTarget(create = true) {
    const it = this.activeItem;
    if (!it) return null;
    if (this.mode === 'animate') {
      let cel = it.celAt(this.playhead);
      if (!cel) { if (!create) return null; cel = this.addCel(it, this.playhead, 1); }
      const t = it.transformAt(this.playhead);
      const m = trackMatrix(t, this.width, this.height);
      const inv = m.inverse();
      return {
        canvas: cel.canvas, layer: it, cel, scale: t.s || 1, matrix: isIdentity(t) ? null : m,
        toLocal: (x, y) => { const p = inv.transformPoint({ x, y }); return { x: p.x, y: p.y }; },
      };
    }
    if (!it.isRaster) return null;
    return { canvas: it.canvas, layer: it, scale: 1, matrix: null, toLocal: (x, y) => ({ x, y }) };
  }

  tmp(i) {
    let c = this._tmp[i];
    if (!c || c.width !== this.width || c.height !== this.height) c = this._tmp[i] = makeCanvas(this.width, this.height);
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    return c;
  }

  // Source canvas + matrix + opacity for a raster-ish item at a given frame.
  source(it, frame, preview) {
    if (it.type === 'track') {
      const cel = it.celAt(frame);
      if (!cel) return null;
      const t = it.transformAt(frame);
      return { canvas: (preview && preview(cel.canvas)) || cel.canvas, matrix: isIdentity(t) ? null : trackMatrix(t, this.width, this.height), alpha: t.o ?? 1 };
    }
    if (it.type !== 'raster') return null;
    return { canvas: (preview && preview(it.canvas)) || it.canvas, matrix: null, alpha: 1 };
  }

  drawSource(ctx, src) {
    if (src.matrix) { ctx.save(); const m = src.matrix; ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); ctx.drawImage(src.canvas, 0, 0); ctx.restore(); }
    else ctx.drawImage(src.canvas, 0, 0);
  }

  panelPath(ctx) {
    ctx.beginPath();
    for (const p of this.panels()) ctx.rect(p.x, p.y, p.w, p.h);
  }

  // Draws the stack into ctx (whose transform maps doc px → target px).
  // o.from / o.to restrict it to a slice of the items (used for render caches).
  composite(ctx, o = {}) {
    const frame = o.frame ?? this.playhead;
    const preview = o.preview || null;
    const items = this.items;
    const from = o.from ?? 0, to = o.to ?? items.length;
    if (o.bg !== false && this.bgVisible) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, this.width, this.height); }
    if (o.underlay) o.underlay(ctx);
    for (let i = from; i < to; i++) {
      const it = items[i];
      if (it.clip && this.clipBase(i) >= 0) continue;
      const clips = [];
      if (it.isRaster) for (let j = i + 1; j < items.length && items[j].clip; j++) clips.push(items[j]);
      if (!it.visible || (o.filter && !o.filter(it))) continue;
      if (it.type === 'frames') { this.drawFrames(ctx, it); continue; }
      if (it.type === 'balloons') { drawBalloons(ctx, it.balloons, o.selectedBalloon); continue; }
      const src = this.source(it, frame, preview);
      if (!src) continue;
      const visClips = clips.filter((c) => c.visible);
      const masked = it.panelMask && this.panels().length;
      ctx.save();
      // panel masks are a clip path on the destination — no off-screen passes
      if (masked) { this.panelPath(ctx); ctx.clip(); }
      ctx.globalAlpha = it.opacity * src.alpha; ctx.globalCompositeOperation = it.blend;
      if (!visClips.length) {
        this.drawSource(ctx, src);
        ctx.restore();
        continue;
      }
      // Group: base + clipping masks rendered off-screen.
      const G = this.tmp(0), g = G.getContext('2d');
      this.drawSource(g, src);
      for (const c of visClips) {
        const cs = this.source(c, frame, preview); if (!cs) continue;
        const T = this.tmp(1), t = T.getContext('2d');
        t.globalAlpha = c.opacity * cs.alpha; this.drawSource(t, cs); t.globalAlpha = 1;
        t.globalCompositeOperation = 'destination-in'; this.drawSource(t, src);
        g.globalCompositeOperation = c.blend === 'source-over' ? 'source-atop' : c.blend;
        g.drawImage(T, 0, 0);
        g.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(G, 0, 0);
      ctx.restore();
    }
  }

  // [start, end) of the active item's clipping group.
  activeGroup() {
    const items = this.items, a = this.active;
    if (!items[a]) return [0, 0];
    let s = a;
    if (items[a].clip) { const b = this.clipBase(a); if (b >= 0) s = b; }
    let e = s + 1;
    if (items[s].isRaster) while (e < items.length && items[e].clip) e++;
    return [s, Math.max(e, a + 1)];
  }
  // Items above can be pre-flattened only if they all blend normally.
  canFlattenRange(from, to) {
    const items = this.items;
    for (let i = from; i < to; i++) {
      const it = items[i];
      if (it.visible && !it.clip && (it.type === 'raster' || it.type === 'track') && it.blend !== 'source-over') return false;
    }
    return true;
  }

  clipBase(i) {
    const items = this.items;
    for (let j = i - 1; j >= 0; j--) {
      if (!items[j].clip) return items[j].isRaster ? j : -1;
    }
    return -1;
  }

  drawFrames(ctx, layer) {
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.strokeStyle = layer.borderColor; ctx.lineWidth = layer.border; ctx.lineJoin = 'miter';
    for (const p of layer.panels) {
      const b = layer.border / 2;
      ctx.strokeRect(p.x + b, p.y + b, p.w - layer.border, p.h - layer.border);
    }
    ctx.restore();
  }

  // Flattened image (doc size) — used for export, thumbnails, color picking.
  flatten(o = {}) {
    const c = makeCanvas(o.width || this.width, o.height || this.height);
    const x = c.getContext('2d');
    x.scale(c.width / this.width, c.height / this.height);
    this.composite(x, o);
    return c;
  }

  // ── serialization ──
  async serialize() {
    const out = {
      v: 1, id: this.id, name: this.name, mode: this.mode, width: this.width, height: this.height,
      bg: this.bg, bgVisible: this.bgVisible, active: this.active, playhead: this.playhead,
      anim: this.anim, webtoon: this.webtoon, created: this.created, layers: [], tracks: [],
    };
    for (const l of this.layers) {
      const o = {}; for (const k of LAYER_PROPS) o[k] = l[k];
      if (l.type === 'raster') o.png = await blobFor(l.canvas);
      if (l.type === 'frames') Object.assign(o, { panels: l.panels, border: l.border, borderColor: l.borderColor });
      if (l.type === 'balloons') o.balloons = l.balloons;
      out.layers.push(o);
    }
    for (const t of this.tracks) {
      const o = { id: t.id, name: t.name, visible: t.visible, opacity: t.opacity, blend: t.blend, alphaLock: t.alphaLock, clip: t.clip, keys: t.keys, cels: [] };
      for (const c of t.cels) o.cels.push({ start: c.start, dur: c.dur, png: await blobFor(c.canvas) });
      out.tracks.push(o);
    }
    return out;
  }

  static async deserialize(o) {
    const d = new Doc(o);
    for (const lo of o.layers || []) {
      const l = new Layer(d.width, d.height, lo);
      if (l.type === 'raster' && lo.png) { l.canvas.getContext('2d').drawImage(await blobToCanvas(await asBlob(lo.png)), 0, 0); seedBlob(l.canvas, lo.png); }
      d.layers.push(l);
    }
    for (const to of o.tracks || []) {
      const t = new Track(to);
      for (const co of to.cels) {
        const cel = d.addCel(t, co.start, co.dur);
        if (co.png) { cel.canvas.getContext('2d').drawImage(await blobToCanvas(await asBlob(co.png)), 0, 0); seedBlob(cel.canvas, co.png); }
      }
      d.tracks.push(t);
    }
    d.active = Math.min(o.active || 0, Math.max(0, d.items.length - 1));
    d.playhead = o.playhead || 0;
    return d;
  }

  // Portable single-file project (.inkwell = JSON with embedded PNGs)
  async toFile() {
    const s = await this.serialize();
    const conv = async (x) => (x instanceof Blob ? await blobToDataURL(x) : x);
    for (const l of s.layers) if (l.png) l.png = await conv(l.png);
    for (const t of s.tracks) for (const c of t.cels) c.png = await conv(c.png);
    return new Blob([JSON.stringify(s)], { type: 'application/json' });
  }

  resize(newW, newH, anchorY = 0) {
    const move = (c) => {
      const n = makeCanvas(newW, newH);
      n.getContext('2d').drawImage(c, 0, anchorY);
      return n;
    };
    for (const l of this.layers) {
      if (l.type === 'raster') l.canvas = move(l.canvas);
      if (anchorY && l.type === 'frames') for (const p of l.panels) p.y += anchorY;
      if (anchorY && l.type === 'balloons') for (const b of l.balloons) { b.y += anchorY; if (b.tail) b.tail.y += anchorY; }
    }
    for (const t of this.tracks) for (const c of t.cels) c.canvas = move(c.canvas);
    this.width = newW; this.height = newH; this._tmp = [];
  }
}

async function asBlob(x) { return x instanceof Blob ? x : dataURLToBlob(x); }

// ───────── speech balloons ─────────
export const BALLOON_FONTS = {
  comic: '"Comic Neue", "Chalkboard SE", "Comic Sans MS", "Marker Felt", sans-serif',
  sans: '-apple-system, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  bold: '"Arial Black", "Helvetica Neue", Impact, sans-serif',
};

function bodyPath(ctx, b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2;
  if (b.shape === 'rect') {
    const r = Math.min(24, rx, ry);
    ctx.roundRect ? ctx.roundRect(b.x, b.y, b.w, b.h, r) : ctx.rect(b.x, b.y, b.w, b.h);
  } else if (b.shape === 'cloud') {
    const n = Math.max(8, Math.round((rx + ry) / 22));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = cx + Math.cos(a) * rx * 0.82, py = cy + Math.sin(a) * ry * 0.82;
      const r = Math.min(rx, ry) * 0.38;
      ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.moveTo(cx + rx * 0.85, cy); ctx.ellipse(cx, cy, rx * 0.85, ry * 0.85, 0, 0, Math.PI * 2);
  } else if (b.shape === 'burst') {
    const n = Math.max(12, Math.round((rx + ry) / 14));
    for (let i = 0; i <= n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const k = i % 2 ? 0.78 : 1.08 + ((i * 7919) % 5) * 0.03;
      const px = cx + Math.cos(a) * rx * k, py = cy + Math.sin(a) * ry * k;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }
}

function tailPath(ctx, b) {
  if (!b.tail || b.shape === 'none') return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = b.tail.x - cx, dy = b.tail.y - cy, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len, half = Math.min(b.w, b.h) * 0.14;
  if (b.shape === 'cloud') {
    // thought bubbles: a trail of shrinking circles
    for (let i = 1; i <= 3; i++) {
      const t = 0.55 + i * 0.15, r = half * (1 - i * 0.24);
      const px = cx + dx * t, py = cy + dy * t;
      ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    return;
  }
  ctx.moveTo(cx + nx * half, cy + ny * half);
  ctx.quadraticCurveTo(cx + dx * 0.6 + nx * half * 0.2, cy + dy * 0.6 + ny * half * 0.2, b.tail.x, b.tail.y);
  ctx.quadraticCurveTo(cx + dx * 0.5 - nx * half * 0.3, cy + dy * 0.5 - ny * half * 0.3, cx - nx * half, cy - ny * half);
  ctx.closePath();
}

export function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function drawBalloons(ctx, balloons, selectedId) {
  for (const b of balloons) {
    ctx.save();
    const lw = b.lineWidth ?? 4;
    if (b.shape !== 'none') {
      // stroke everything twice as wide, then fill: the outline of the union remains
      ctx.beginPath(); bodyPath(ctx, b); tailPath(ctx, b);
      ctx.lineWidth = lw * 2; ctx.strokeStyle = b.stroke || '#000'; ctx.lineJoin = 'round';
      if (lw > 0) ctx.stroke();
      ctx.fillStyle = b.fill || '#fff';
      ctx.beginPath(); bodyPath(ctx, b); ctx.fill();
      ctx.beginPath(); tailPath(ctx, b); ctx.fill();
    }
    const size = b.fontSize || 28;
    ctx.font = `${b.font === 'bold' ? '900' : '600'} ${size}px ${BALLOON_FONTS[b.font] || BALLOON_FONTS.comic}`;
    ctx.fillStyle = b.textColor || '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const pad = b.shape === 'none' ? 1 : b.shape === 'rect' ? 0.86 : 0.72;
    const lines = wrapText(ctx, b.text || '', b.w * pad);
    const lh = size * 1.18, top = b.y + b.h / 2 - ((lines.length - 1) * lh) / 2;
    if (b.shape === 'none' && b.outline !== false) {
      ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = b.fill || '#fff'; ctx.lineJoin = 'round';
      lines.forEach((ln, i) => ctx.strokeText(ln, b.x + b.w / 2, top + i * lh));
    }
    lines.forEach((ln, i) => ctx.fillText(ln, b.x + b.w / 2, top + i * lh));
    ctx.restore();
  }
}
