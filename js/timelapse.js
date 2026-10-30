// Time-lapse: after every change a small frame of the canvas (without private layers) is
// captured in the background, JPEG-encoded on a worker and stored in IndexedDB in chunks.
// Replay it in the app, or export full length / 30 seconds as MP4.
import { h, toast, dialog, makeCanvas, download, clamp } from './util.js';
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
    this.info().count = 0; this.buf = []; this.bufChunk = 0; this.cache.clear();
    this.app.dirtySave = true; this.schedule(0);
  }

  // ───────── replay ─────────
  async replay() {
    await this.flush();
    const i = this.info();
    if (!i.count) { toast('Nothing recorded yet — the time-lapse records as you draw'); return; }
    const cv = h('canvas', { class: 'tl-player' }); cv.width = i.w || 1280; cv.height = i.h || 720;
    const x = cv.getContext('2d');
    const scrub = h('input', { type: 'range', min: 0, max: i.count - 1, step: 1, value: '0' });
    const label = h('span', { class: 'hint' });
    const playBtn = h('button', { class: 'pill primary' }, 'Pause');
    let n = 0, playing = true, alive = true;
    const show = async (k) => {
      const b = await this.frame(k); if (!b || !alive) return;
      const bm = await createImageBitmap(b);
      if (cv.width !== bm.width || cv.height !== bm.height) { cv.width = bm.width; cv.height = bm.height; }
      x.drawImage(bm, 0, 0); bm.close && bm.close();
      label.textContent = `${k + 1} / ${i.count}`; scrub.value = k;
    };
    scrub.oninput = () => { playing = false; playBtn.textContent = 'Play'; n = +scrub.value; show(n); };
    playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; if (playing && n >= i.count - 1) n = 0; loop(); };
    const fps = Math.min(60, Math.max(12, i.count / 20)); // whole replay ≈ 20 s, 12–60 fps
    const loop = async () => {
      while (alive && playing && n < i.count) { const t = performance.now(); await show(n); n++; await new Promise((r) => setTimeout(r, Math.max(0, 1000 / fps - (performance.now() - t)))); }
      if (n >= i.count) { playing = false; playBtn.textContent = 'Replay'; n = i.count - 1; }
    };
    dialog({ title: 'Time-lapse Replay', wide: true, body: h('div', {}, cv, h('div', { class: 'tl-controls' }, playBtn, scrub, label)),
      actions: [{ label: 'Export…', onClick: () => { alive = false; setTimeout(() => this.exportDialog(), 0); } }, { label: 'Done', primary: true }], onClose: () => { alive = false; } });
    loop();
  }

  // ───────── export ─────────
  exportDialog() {
    const i = this.info();
    if (!i.count) { toast('Nothing recorded yet'); return; }
    dialog({ title: 'Export Time-lapse', body: h('p', {}, `${i.count} frames recorded at ${i.w}×${i.h}. Private layers are never included.`),
      actions: [{ label: 'Cancel' }, { label: '30 seconds', onClick: () => this.export(true) }, { label: 'Full length', primary: true, onClick: () => this.export(false) }] });
  }
  async export(short) {
    await this.flush();
    const i = this.info(), fps = 30;
    let count = i.count;
    if (short) count = Math.min(i.count, fps * 30);
    const pick = (k) => (count === i.count ? k : Math.round((k * (i.count - 1)) / Math.max(1, count - 1)));
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
      download(blob, `${(this.doc.name || 'artwork').replace(/[^\w\- ]+/g, '')} time-lapse${short ? ' 30s' : ''}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
      toast('Time-lapse exported');
    } catch (e) { console.error(e); toast('Time-lapse export failed: ' + e.message, 5000); }
  }
}
