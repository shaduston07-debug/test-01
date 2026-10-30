// Document model: raster layers, vector layers (comic frames, balloons), animation tracks.
import { makeCanvas, uid, canvasToBlob, blobToCanvas, dataURLToBlob, blobToDataURL } from './util.js';
import { encodePNG } from './pool.js';

// PNG-encode a layer only if it changed since the last save (canvas._ver is bumped by history).
async function blobFor(c) {
  const v = c._ver || 0;
  if (c._blob && c._blobVer === v) return c._blob;
  const b = await encodePNG(c);
  if ((c._ver || 0) === v) { c._blob = b; c._blobVer = v; }
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

const LAYER_PROPS = ['id', 'type', 'name', 'visible', 'opacity', 'blend', 'alphaLock', 'clip', 'reference', 'panelMask', 'locked', 'groupId', 'collapsed'];

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
    // Groups: a 'group' item sits directly above its members, which carry its id.
    this.groupId = o.groupId || null;
    this.collapsed = !!o.collapsed;
    if (this.type === '3d') { this.scene3d = o.scene3d || null; this.models = o.models || new Map(); }
    if (this.type === 'raster' || this.type === '3d') {
      this.canvas = makeCanvas(w, h);
      // Safari returns no context when its canvas memory is exhausted
      if (!this.canvas.getContext('2d')) { this.canvas.width = this.canvas.height = 0; throw new Error('OUT_OF_MEMORY'); }
    }
    if (this.type === 'frames') {
      this.panels = o.panels || [];
      this.border = o.border ?? 6;
      this.borderColor = o.borderColor || '#111111';
    }
    if (this.type === 'balloons') this.balloons = o.balloons || [];
  }
  get isRaster() { return this.type === 'raster'; }
  get hasPixels() { return this.type === 'raster' || this.type === '3d'; }
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
  get hasPixels() { return true; }
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
    this.folder = o.folder || null;
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
    return this.layers.filter((l) => l.hasPixels).length;
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
  // preview(canvas) may substitute a canvas; overlay(canvas) may add a live stroke on top.
  source(it, frame, preview, overlay) {
    let c, matrix = null, alpha = 1;
    if (it.type === 'track') {
      const cel = it.celAt(frame);
      if (!cel) return null;
      const t = it.transformAt(frame);
      c = cel.canvas; matrix = isIdentity(t) ? null : trackMatrix(t, this.width, this.height); alpha = t.o ?? 1;
    } else if (it.type === '3d' && it._live) {
      return { canvas: it._live, matrix: null, alpha: 1, overlay: null, size: [this.width, this.height] };
    } else if (it.type === 'raster' || it.type === '3d') c = it.canvas;
    else return null;
    return { canvas: (preview && preview(c)) || c, matrix, alpha, overlay: overlay ? overlay(c) : null };
  }

  drawSource(ctx, src) {
    if (src.matrix) { ctx.save(); const m = src.matrix; ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); }
    if (src.size) ctx.drawImage(src.canvas, 0, 0, src.size[0], src.size[1]);
    else ctx.drawImage(src.canvas, 0, 0);
    if (src.overlay) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * src.overlay.alpha;
      const r = src.overlay.rect;
      if (r) { if (r.w > 0 && r.h > 0) ctx.drawImage(src.overlay.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h); }
      else ctx.drawImage(src.overlay.canvas, 0, 0);
      ctx.globalAlpha = a;
    }
    if (src.matrix) ctx.restore();
  }

  panelPath(ctx) {
    ctx.beginPath();
    for (const p of this.panels()) ctx.rect(p.x, p.y, p.w, p.h);
  }

  // Draws the stack into ctx (whose transform maps doc px → target px).
  // o.from / o.to restrict it to a slice of the items (used for render caches).
  composite(ctx, o = {}) {
    const frame = o.frame ?? this.playhead;
    const preview = o.preview || null, overlay = o.overlay || null;
    const items = this.items;
    const from = o.from ?? 0, to = o.to ?? items.length;
    if (o.bg !== false && this.bgVisible) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, this.width, this.height); }
    if (o.underlay) o.underlay(ctx);
    const groups = this.groupMap();
    for (let i = from; i < to; i++) {
      const it = items[i];
      if (it.type === 'group') continue;
      const grp = it.groupId ? groups.get(it.groupId) : null;
      if (grp && !grp.visible) continue;
      const gAlpha = grp ? grp.opacity : 1;
      if (it.clip && this.clipBase(i) >= 0) continue;
      const clips = [];
      if (it.hasPixels) for (let j = i + 1; j < items.length && items[j].clip; j++) clips.push(items[j]);
      if (!it.visible || (o.filter && !o.filter(it))) continue;
      if (it.type === 'frames' || it.type === 'balloons') {
        ctx.save(); ctx.globalAlpha = gAlpha;
        if (it.type === 'frames') this.drawFrames(ctx, it);
        else { ctx.globalAlpha *= it.opacity; drawBalloons(ctx, it.balloons, o.selectedBalloon); }
        ctx.restore(); continue;
      }
      const src = this.source(it, frame, preview, overlay);
      if (!src) continue;
      const visClips = clips.filter((c) => c.visible);
      const masked = it.panelMask && this.panels().length;
      ctx.save();
      // panel masks are a clip path on the destination — no off-screen passes
      if (masked) { this.panelPath(ctx); ctx.clip(); }
      ctx.globalAlpha = it.opacity * src.alpha * gAlpha; ctx.globalCompositeOperation = it.blend;
      if (!visClips.length) {
        this.drawSource(ctx, src);
        ctx.restore();
        continue;
      }
      // Group: base + clipping masks rendered off-screen.
      const G = this.tmp(0), g = G.getContext('2d');
      this.drawSource(g, src);
      for (const c of visClips) {
        const cs = this.source(c, frame, preview, overlay); if (!cs) continue;
        if (c.blend === 'source-over') {
          // normal clipping: paint atop the group — keeps the base's alpha exactly and
          // shows the clip layer's own colour (no base colour bleeding through soft edges)
          g.globalCompositeOperation = 'source-atop';
          g.globalAlpha = c.opacity * cs.alpha;
          this.drawSource(g, cs);
        } else {
          // blend-mode clipping: compute blend(group, clip) off-screen, keep it only where the
          // clip layer has paint, then lay that atop the group (so the group's alpha is exact)
          const T = this.tmp(1), t = T.getContext('2d'), a = c.opacity * cs.alpha;
          t.drawImage(G, 0, 0);
          t.globalCompositeOperation = c.blend; t.globalAlpha = a; this.drawSource(t, cs);
          t.globalCompositeOperation = 'destination-in'; this.drawSource(t, cs);
          g.globalCompositeOperation = 'source-atop'; g.drawImage(T, 0, 0);
        }
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
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
    if (items[s].hasPixels) while (e < items.length && items[e].clip) e++;
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

  groupMap() {
    const m = new Map();
    for (const it of this.layers) if (it.type === 'group') m.set(it.id, it);
    return m;
  }
  // [start, end] indices of a group's block (members + header) or of a single item
  blockOf(i) {
    const items = this.items, it = items[i];
    if (!it || it.type !== 'group') return [i, i];
    let s = i;
    while (s > 0 && items[s - 1].groupId === it.id) s--;
    return [s, i];
  }

  clipBase(i) {
    const items = this.items;
    for (let j = i - 1; j >= 0; j--) {
      if (!items[j].clip) return items[j].hasPixels ? j : -1;
    }
    return -1;
  }

  drawFrames(ctx, layer) {
    ctx.save();
    ctx.globalAlpha *= layer.opacity;
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
      anim: this.anim, webtoon: this.webtoon, created: this.created, folder: this.folder, layers: [], tracks: [],
    };
    for (const l of this.layers) {
      const o = {}; for (const k of LAYER_PROPS) o[k] = l[k];
      if (l.type === 'raster' || l.type === '3d') o.png = blobFor(l.canvas); // encoded in parallel below
      if (l.type === '3d') { o.scene3d = l.scene3d; o.models = [...l.models.values()]; }
      if (l.type === 'frames') Object.assign(o, { panels: l.panels, border: l.border, borderColor: l.borderColor });
      if (l.type === 'balloons') o.balloons = l.balloons;
      out.layers.push(o);
    }
    for (const t of this.tracks) {
      const o = { id: t.id, name: t.name, visible: t.visible, opacity: t.opacity, blend: t.blend, alphaLock: t.alphaLock, clip: t.clip, keys: t.keys, cels: [] };
      for (const c of t.cels) o.cels.push({ start: c.start, dur: c.dur, png: blobFor(c.canvas) });
      out.tracks.push(o);
    }
    // all layer PNGs encode at once across the worker cores
    await Promise.all([...out.layers, ...out.tracks.flatMap((t) => t.cels)].filter((x) => x.png).map(async (x) => { x.png = await x.png; }));
    return out;
  }

  static async deserialize(o) {
    const d = new Doc(o);
    for (const lo of o.layers || []) {
      const l = new Layer(d.width, d.height, lo);
      if (l.type === '3d') {
        l.scene3d = lo.scene3d;
        l.models = new Map();
        for (const m of lo.models || []) l.models.set(m.id, { ...m, blob: await asBlob(m.blob) });
      }
      if ((l.type === 'raster' || l.type === '3d') && lo.png) { l.canvas.getContext('2d').drawImage(await blobToCanvas(await asBlob(lo.png)), 0, 0); seedBlob(l.canvas, lo.png); }
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
    for (const l of s.layers) {
      if (l.png) l.png = await conv(l.png);
      if (l.models) l.models = await Promise.all(l.models.map(async (m) => ({ ...m, blob: await conv(m.blob) })));
    }
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
      if (l.type === 'raster' || l.type === '3d') l.canvas = move(l.canvas);
      if (anchorY && l.type === 'frames') for (const p of l.panels) p.y += anchorY;
      if (anchorY && l.type === 'balloons') for (const b of l.balloons) { b.y += anchorY; if (b.tail) b.tail.y += anchorY; }
    }
    for (const t of this.tracks) for (const c of t.cels) c.canvas = move(c.canvas);
    this.width = newW; this.height = newH; this._tmp = [];
  }
}

async function asBlob(x) { return x instanceof Blob ? x : dataURLToBlob(x); }

// ───────── speech balloons ─────────
// Fonts that ship with iPadOS (with fallbacks elsewhere). 'custom:<family>' = an imported font.
export const BALLOON_FONTS = {
  comic: '"Comic Neue", "Chalkboard SE", "Comic Sans MS", "Marker Felt", sans-serif',
  sans: '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  bold: '"Arial Black", "Helvetica Neue", Impact, sans-serif',
  marker: '"Marker Felt", "Chalkboard SE", fantasy',
  hand: 'Noteworthy, "Bradley Hand", "Segoe Print", cursive',
  typewriter: '"American Typewriter", "Courier New", monospace',
  futura: 'Futura, "Avenir Next", "Century Gothic", sans-serif',
  avenir: '"Avenir Next", Avenir, "Segoe UI", sans-serif',
  script: '"Snell Roundhand", "Savoye LET", "Brush Script MT", cursive',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  gothicJP: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
  minchoJP: '"Hiragino Mincho ProN", "Noto Serif JP", serif',
};
export const FONT_LABELS = [['comic', 'Comic'], ['sans', 'System'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['bold', 'Heavy'], ['marker', 'Marker'], ['hand', 'Handwriting'], ['typewriter', 'Typewriter'], ['futura', 'Futura'], ['avenir', 'Avenir'], ['script', 'Script'], ['mono', 'Mono'], ['gothicJP', 'Manga Gothic (JP)'], ['minchoJP', 'Manga Mincho (JP)']];
export const fontFamily = (key) => (key && key.startsWith('custom:') ? `"${key.slice(7)}", sans-serif` : BALLOON_FONTS[key] || BALLOON_FONTS.comic);

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
    drawBalloonText(ctx, b);
    ctx.restore();
  }
}

// Text inside a balloon / text box: font, weight, italic, alignment, vertical (manga) layout,
// and an optional outline around the letters.
function drawBalloonText(ctx, b) {
  const size = b.fontSize || 28;
  const weight = b.bold || b.font === 'bold' ? '800' : (b.weight || '600');
  ctx.font = `${b.italic ? 'italic ' : ''}${weight} ${size}px ${fontFamily(b.font)}`;
  ctx.fillStyle = b.textColor || '#000';
  ctx.textBaseline = 'middle';
  const none = b.shape === 'none';
  const outlineW = b.textOutline ?? (none && b.outline !== false ? Math.max(3, size * 0.16) : 0);
  const outlineCol = b.textOutlineColor || b.fill || '#fff';
  const draw = (str, x, y) => {
    if (outlineW > 0) { ctx.lineWidth = outlineW; ctx.strokeStyle = outlineCol; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillText(str, x, y);
  };
  const pad = none ? 1 : b.shape === 'rect' ? 0.86 : 0.72;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (b.vertical) {
    // columns read right-to-left, characters stacked top-to-bottom
    const step = size * 1.06, perCol = Math.max(1, Math.floor((b.h * pad) / step));
    const cols = [];
    for (const para of String(b.text || '').split('\n')) {
      const chars = [...para];
      if (!chars.length) { cols.push([]); continue; }
      for (let i = 0; i < chars.length; i += perCol) cols.push(chars.slice(i, i + perCol));
    }
    const colW = size * 1.25, total = cols.length * colW;
    ctx.textAlign = 'center';
    cols.forEach((col, ci) => {
      const x = cx + total / 2 - colW / 2 - ci * colW;
      const top = cy - ((col.length - 1) * step) / 2;
      col.forEach((ch, k) => {
        const y = top + k * step;
        if (/[ー〜～—\-–()（）「」『』\[\]…]/.test(ch)) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2); draw(ch, 0, 0); ctx.restore(); }
        else draw(ch, x, y);
      });
    });
    return;
  }
  const lines = wrapText(ctx, b.text || '', b.w * pad);
  const lh = size * (b.lineHeight || 1.18), top = cy - ((lines.length - 1) * lh) / 2;
  const align = b.align || 'center';
  const inner = b.w * pad;
  const x = align === 'left' ? cx - inner / 2 : align === 'right' ? cx + inner / 2 : cx;
  ctx.textAlign = align;
  lines.forEach((ln, i) => draw(ln, x, top + i * lh));
}
