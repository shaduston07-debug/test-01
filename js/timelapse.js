// Time-lapse: after every change a small frame of the canvas (without private layers) is
// captured in the background, JPEG-encoded on a worker and stored in IndexedDB in chunks.
// Replay it in the app, or export full length / 30 seconds as MP4.
import { h, toast, dialog, makeCanvas, download, clamp, seg } from './util.js';
import { encodeImage } from './pool.js';
import { encodeVideo } from './video.js';
import * as store from './storage.js';

const CHUNK = 40;
export const QUALITIES = { '720p': 1280, '1080p': 1920, '2K': 2560 };

export class Timelapse {
  constructor(app) { this.app = app; this.doc = null; this.buf = []; this.bufChunk = 0; this.cache = new Map(); }
  info() { const d = this.doc; return d ? (d.timelapse ||= { on: true, count: 0, quality: '1080p' }) : null; }

  async attach(doc) {
    await this.flush();
    this.doc = doc; this.cache.clear();
    const i = this.info();
    this.bufChunk = Math.floor(i.count / CHUNK);
    const rec = i.count % CHUNK ? await store.getTimelapse(doc.id + ':' + this.bufChunk).catch(() => null) : null;
    this.buf = rec ? rec.frames.slice(0, i.count % CHUNK) : [];
    if (i.count === 0) this.schedule(0);
  }
  detach() { const p = this.flush(); this.doc = null; return p; }

  // called after every change; captures once things settle (never during a stroke)
  schedule(delay = 350) {
    const i = this.info();
    if (!i || !i.on) return;
    clearTimeout(this.t);
    this.t = setTimeout(() => this.capture(), delay);
  }
  async capture() {
    const app = this.app, d = this.doc, i = this.info();
    if (!d || !i.on) return;
    if (app.engine.active || app.transform || this.busy) { this.schedule(250); return; }
    this.busy = true;
    try {
      const max = QUALITIES[i.quality] || 1920, k = Math.min(1, max / Math.max(d.width, d.height));
      const c = makeCanvas(Math.max(2, Math.round(d.width * k)), Math.max(2, Math.round(d.height * k)));
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
      x.scale(k, k);
      d.composite(x, { frame: d.playhead, bg: d.bgVisible, filter: (it) => !it.private });
      // which layers have been in the recording (so making one private later knows it's in there)
      const seen = new Set(i.seen || []); for (const it of d.items) if (!it.private && it.visible !== false && it.id) seen.add(it.id);
      i.seen = [...seen];
      const blob = await encodeImage(c, 'image/jpeg', 0.82);
      if (d !== this.doc) return;
      this.buf.push(blob); i.count++;
      i.w = c.width; i.h = c.height;
      if (this.buf.length >= CHUNK) await this.flush(true);
    } catch (e) { console.warn('time-lapse frame', e); }
    finally { this.busy = false; }
  }
  async flush(full = false) {
    const d = this.doc; if (!d || !this.buf.length) return;
    const id = d.id + ':' + this.bufChunk, frames = this.buf.slice();
    this.cache.set(this.bufChunk, frames);
    if (full || frames.length >= CHUNK) { this.bufChunk++; this.buf = []; }
    try { await store.putTimelapse({ id, frames }); } catch (e) { console.warn('time-lapse save', e); }
  }
  // parts: a new part starts when a layer that's already in the recording is made private (the
  // frames already made are pictures — the layer can't be taken out of them afterwards)
  parts() {
    const i = this.info(), ps = (i.parts && i.parts.length ? i.parts : [{ start: 0 }]).filter((p) => p.start < Math.max(1, i.count));
    return ps.map((p, k) => ({ ...p, end: k + 1 < ps.length ? ps[k + 1].start : i.count, n: k + 1 }));
  }
  privatized(it) {
    const i = this.info(); if (!i || !i.on || !i.count || !it) return;
    if (!(i.seen || []).includes(it.id)) return; // never recorded: nothing to hide
    if (it.canvas && it.type === 'raster') { try { const c = it.canvas, x = c.getContext('2d'), dd = x.getImageData(0, 0, c.width, c.height).data; let any = false; for (let k = 3; k < dd.length; k += 64) if (dd[k]) { any = true; break; } if (!any) return; } catch { /* keep going */ } }
    const parts = i.parts && i.parts.length ? i.parts : [{ start: 0 }];
    if (parts[parts.length - 1].start === i.count) { parts[parts.length - 1].note = `after “${it.name}” was made private`; i.parts = parts; return; }
    i.parts = [...parts, { start: i.count, note: `after “${it.name}” was made private`, at: Date.now() }];
    i.seen = (i.seen || []).filter((x) => x !== it.id);
    this.app.dirtySave = true;
    toast(`New time-lapse part started without “${it.name}”. The earlier part still shows it (recorded frames can't be changed); pick the part when you replay or export.`, 6000);
  }
  async frame(n) {
    const c = Math.floor(n / CHUNK);
    if (!this.cache.has(c)) {
      const rec = c === this.bufChunk ? { frames: this.buf } : await store.getTimelapse(this.doc.id + ':' + c);
      this.cache.set(c, rec ? rec.frames : []);
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    }
    return (this.cache.get(c) || [])[n % CHUNK] || null;
  }
  async reset() {
    const d = this.doc; if (!d) return;
    await store.deleteTimelapse(d.id);
    Object.assign(this.info(), { count: 0, parts: [], seen: [] }); this.buf = []; this.bufChunk = 0; this.cache.clear();
    this.app.dirtySave = true; this.schedule(0);
  }

  // ───────── replay ─────────
  async replay() {
    await this.flush();
    const i = this.info();
    if (!i.count) { toast('Nothing recorded yet — the time-lapse records as you draw'); return; }
    const parts = this.parts(); let part = parts[parts.length - 1];
    const cv = h('canvas', { class: 'tl-player' }); cv.width = i.w || 1280; cv.height = i.h || 720;
    const x = cv.getContext('2d');
    const scrub = h('input', { type: 'range', min: 0, max: part.end - part.start - 1, step: 1, value: '0' });
    const label = h('span', { class: 'hint' });
    const playBtn = h('button', { class: 'pill primary' }, 'Pause');
    let n = 0, playing = true, alive = true;
    const show = async (k) => {
      const b = await this.frame(part.start + k); if (!b || !alive) return;
      const bm = await createImageBitmap(b);
      if (cv.width !== bm.width || cv.height !== bm.height) { cv.width = bm.width; cv.height = bm.height; }
      x.drawImage(bm, 0, 0); bm.close && bm.close();
      label.textContent = `${k + 1} / ${part.end - part.start}`; scrub.value = k;
    };
    scrub.oninput = () => { playing = false; playBtn.textContent = 'Play'; n = +scrub.value; show(n); };
    const len = () => part.end - part.start;
    playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; if (playing && n >= len() - 1) n = 0; loop(); };
    const fps = () => Math.min(60, Math.max(12, len() / 20)); // whole replay ≈ 20 s, 12–60 fps
    const loop = async () => {
      while (alive && playing && n < len()) { const t = performance.now(); await show(n); n++; await new Promise((r) => setTimeout(r, Math.max(0, 1000 / fps() - (performance.now() - t)))); }
      if (n >= len()) { playing = false; playBtn.textContent = 'Replay'; n = len() - 1; }
    };
    const chooser = parts.length > 1 ? h('div', { class: 'stack' }, seg(parts.map((p) => [String(p.n), 'Part ' + p.n]), String(part.n), (v) => { part = parts[+v - 1]; scrub.max = len() - 1; n = 0; playing = true; playBtn.textContent = 'Pause'; loop(); }),
      h('p', { class: 'hint' }, parts.slice(1).map((p) => `Part ${p.n} starts ${p.note || ''}`).join(' · '))) : null;
    dialog({ title: 'Time-lapse Replay', wide: true, body: h('div', {}, chooser, cv, h('div', { class: 'tl-controls' }, playBtn, scrub, label)),
      actions: [{ label: 'Export…', onClick: () => { alive = false; setTimeout(() => this.exportDialog(part.n), 0); } }, { label: 'Done', primary: true }], onClose: () => { alive = false; } });
    loop();
  }

  // ───────── export ─────────
  exportDialog(partN) {
    const i = this.info();
    if (!i.count) { toast('Nothing recorded yet'); return; }
    const parts = this.parts(); let part = parts.find((p) => p.n === partN) || parts[parts.length - 1];
    const info = h('p', {}); const say = () => { info.textContent = `${part.end - part.start} frames at ${i.w}×${i.h}. Private layers are never included.`; }; say();
    const chooser = parts.length > 1 ? h('div', { class: 'stack' }, h('label', {}, 'Part'), seg(parts.map((p) => [String(p.n), 'Part ' + p.n]), String(part.n), (v) => { part = parts[+v - 1]; say(); }),
      h('p', { class: 'hint' }, parts.slice(1).map((p) => `Part ${p.n} starts ${p.note || ''}`).join(' · ') + '. A layer made private after it was recorded is only left out from the part that starts then.')) : null;
    dialog({ title: 'Export Time-lapse', body: h('div', {}, chooser, info),
      actions: [{ label: 'Cancel' }, { label: '30 seconds', onClick: () => this.export(true, part) }, { label: 'Full length', primary: true, onClick: () => this.export(false, part) }] });
  }
  async export(short, part) {
    await this.flush();
    const i = this.info(), fps = 30;
    part ||= { start: 0, end: i.count };
    const total = part.end - part.start;
    let count = total;
    if (short) count = Math.min(total, fps * 30);
    const pick = (k) => part.start + (count === total ? k : Math.round((k * (total - 1)) / Math.max(1, count - 1)));
    const frames = count + fps; // hold the finished artwork for a second
    toast('Exporting time-lapse…', 120000);
    try {
      const blob = await encodeVideo({
        width: i.w, height: i.h, fps, count: frames,
        drawFrame: async (k, x) => {
          const b = await this.frame(pick(Math.min(k, count - 1)));
          if (!b) return;
          const bm = await createImageBitmap(b); x.drawImage(bm, 0, 0, i.w, i.h); bm.close && bm.close();
        },
        onProgress: (p) => toast(`Exporting time-lapse… ${Math.round(p * 100)}%`, 120000),
      });
      download(blob, `${(this.doc.name || 'artwork').replace(/[^\w\- ]+/g, '')} time-lapse${part.n && this.parts().length > 1 ? ' part ' + part.n : ''}${short ? ' 30s' : ''}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
      toast('Time-lapse exported');
    } catch (e) { console.error(e); toast('Time-lapse export failed: ' + e.message, 5000); }
  }
}
