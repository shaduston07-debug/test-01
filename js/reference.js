// Reference companion window (like Procreate's): a floating, resizable window that shows
// either a live overview of the whole canvas or a reference image. Pinch / wheel to zoom,
// drag to pan, double-tap to reset; touch and hold on an image to pick its colour.
import { h, clamp, makeCanvas, pickFile, seg, toast, rgbToHex, loadImage } from './util.js';
import * as store from './storage.js';
import { openFloating, closeFloat, isFloating } from './ui.js';

const KEY = 'reference';
const MAX_IMG = 1800;   // stored reference images are downscaled to this
const MAX_LIVE = 1600;  // live canvas overview resolution

export class Reference {
  constructor(app) {
    this.app = app;
    this.mode = store.prefs.get('refMode', 'canvas');
    this.size = store.prefs.get('refSize', { w: 300, h: 230 });
    this.src = null; // what's shown: live composite canvas or the image
    this.view = { z: 1, x: 0, y: 0 };
    this.ver = -1;
  }
  get open() { return isFloating(KEY); }
  toggle(on = !this.open) {
    store.prefs.set('refOn', on);
    if (on) this.show(); else closeFloat(KEY);
  }
  // reopen with the canvas if it was left on
  restore() { if (store.prefs.get('refOn', false) && !this.open) this.show(); }

  show() {
    if (this.open) return;
    const cv = h('canvas', { class: 'ref-canvas' });
    const hint = h('div', { class: 'ref-hint' });
    const box = h('div', { class: 'ref-body' }, cv, hint, h('div', { class: 'ref-resize', title: 'Resize' }));
    const sw = Math.min(this.size.w, innerWidth - 40), sh = Math.min(this.size.h, innerHeight * 0.6);
    box.style.width = sw + 'px'; box.style.height = sh + 'px';
    const modes = seg([['canvas', 'Canvas'], ['image', 'Image']], this.mode, (m) => this.setMode(m));
    const imgBtn = h('button', { class: 'pill ref-import', onclick: () => this.importImage() }, 'Import');
    this.el = { cv, box, hint, imgBtn };
    openFloating(KEY, 'Reference', { width: sw + 16, head: [modes, imgBtn], body: box, onClose: () => { this.el = null; } });
    this.bindGestures();
    this.setMode(this.mode);
  }

  setMode(m) {
    this.mode = m; store.prefs.set('refMode', m);
    if (!this.el) return;
    this.el.imgBtn.hidden = m !== 'image';
    this.view = { z: 1, x: 0, y: 0 };
    if (m === 'canvas') { this.ver = -1; this.src = null; this.refreshLive(); }
    else this.loadImage();
  }

  async loadImage() {
    const url = store.prefs.get('refImage', null);
    this.src = null;
    if (url) { try { this.src = await loadImage(url); } catch { this.src = null; } }
    this.paint();
  }
  async importImage() {
    const [f] = await pickFile('image/*');
    if (!f) return;
    const u = URL.createObjectURL(f);
    try {
      const img = await loadImage(u);
      const k = Math.min(1, MAX_IMG / Math.max(img.width, img.height));
      const c = makeCanvas(Math.round(img.width * k), Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let url = c.toDataURL('image/jpeg', 0.88);
      store.prefs.set('refImage', url);
      if (store.prefs.get('refImage', null) !== url) toast('Image too large to remember after closing — it’s shown for now');
      this.src = c; this.view = { z: 1, x: 0, y: 0 }; this.paint();
    } catch { toast('Couldn’t read that image'); }
    finally { URL.revokeObjectURL(u); }
  }

  // called by the app after every change (debounced so painting is never slowed down)
  changed() {
    if (!this.el || this.mode !== 'canvas') return;
    clearTimeout(this.t);
    this.t = setTimeout(() => this.refreshLive(), 120);
  }
  refreshLive() {
    const d = this.app.doc;
    if (!this.el || this.mode !== 'canvas' || !d) { this.paint(); return; }
    const k = Math.min(1, MAX_LIVE / Math.max(d.width, d.height));
    const w = Math.max(1, Math.round(d.width * k)), hh = Math.max(1, Math.round(d.height * k));
    if (!this.live || this.live.width !== w || this.live.height !== hh) this.live = makeCanvas(w, hh);
    const x = this.live.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, w, hh);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, hh);
    x.scale(k, k);
    d.composite(x, { frame: d.playhead, bg: d.bgVisible });
    this.src = this.live;
    this.paint();
  }

  // fit the source into the window, then apply the user's zoom / pan
  fit() {
    const { box } = this.el, s = this.src;
    const W = box.clientWidth, H = box.clientHeight;
    const f = Math.min(W / s.width, H / s.height);
    const z = f * this.view.z;
    return { z, ox: (W - s.width * z) / 2 + this.view.x, oy: (H - s.height * z) / 2 + this.view.y, W, H };
  }
  paint() {
    if (!this.el) return;
    const { cv, box, hint } = this.el;
    const dpr = Math.min(3, devicePixelRatio || 1);
    const W = box.clientWidth, H = box.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const x = cv.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
    hint.textContent = this.src ? '' : this.mode === 'image' ? 'Tap Import to choose a reference image' : '';
    if (!this.src) return;
    const f = this.fit();
    x.setTransform(dpr * f.z, 0, 0, dpr * f.z, dpr * f.ox, dpr * f.oy);
    x.imageSmoothingQuality = 'high';
    x.drawImage(this.src, 0, 0);
  }

  // colour under a window point (image or canvas overview)
  sample(px, py) {
    if (!this.src) return null;
    const f = this.fit();
    const sx = Math.floor((px - f.ox) / f.z), sy = Math.floor((py - f.oy) / f.z);
    if (sx < 0 || sy < 0 || sx >= this.src.width || sy >= this.src.height) return null;
    const c = makeCanvas(1, 1), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(this.src, sx, sy, 1, 1, 0, 0, 1, 1);
    const p = x.getImageData(0, 0, 1, 1).data;
    return p[3] ? rgbToHex(p[0], p[1], p[2]) : null;
  }

  bindGestures() {
    const { box } = this.el;
    const pts = new Map();
    let start = null, hold = null, lastTap = 0;
    const local = (e) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const snapshot = () => {
      const p = [...pts.values()];
      const c = p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0];
      return { c, d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, v: { ...this.view } };
    };
    const zoomAt = (v, cx, cy, nz) => {
      // keep the point under (cx, cy) fixed while zooming
      const W = box.clientWidth, H = box.clientHeight, k = nz / v.z;
      this.view = { z: nz, x: (cx - W / 2) - ((cx - W / 2) - v.x) * k, y: (cy - H / 2) - ((cy - H / 2) - v.y) * k };
    };
    const pick = (p) => {
      const c = this.sample(p.x, p.y);
      if (c) { this.app.setColor(c); toast('Colour picked', 900); }
    };

    box.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('ref-resize')) return;
      e.preventDefault(); e.stopPropagation();
      box.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      start = snapshot();
      clearTimeout(hold); hold = null;
      if (pts.size === 1) {
        const p = local(e);
        const now = performance.now();
        if (now - lastTap < 300) { this.view = { z: 1, x: 0, y: 0 }; this.paint(); lastTap = 0; return; }
        lastTap = now;
        hold = setTimeout(() => { hold = 'done'; pick(p); }, 450);
      }
    });
    box.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const s = snapshot();
      if (hold && hold !== 'done' && Math.hypot(s.c.x - start.c.x, s.c.y - start.c.y) > 6) { clearTimeout(hold); hold = null; }
      if (hold === 'done') return;
      const v = start.v;
      this.view = { ...v, x: v.x + s.c.x - start.c.x, y: v.y + s.c.y - start.c.y };
      if (pts.size > 1 && start.d > 0) zoomAt(this.view, s.c.x, s.c.y, clamp(v.z * (s.d / start.d), 0.25, 24));
      this.paint();
    });
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      if (hold !== 'done') clearTimeout(hold);
      hold = null;
      if (pts.size) start = snapshot();
    };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    box.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      const p = local(e);
      zoomAt(this.view, p.x, p.y, clamp(this.view.z * Math.exp(-e.deltaY * 0.002), 0.25, 24));
      this.paint();
    }, { passive: false });

    // resize from the bottom-right corner
    const grip = box.querySelector('.ref-resize');
    let rs = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
      rs = { x: e.clientX, y: e.clientY, w: box.clientWidth, h: box.clientHeight };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!rs) return;
      const win = box.closest('.float-win');
      const w = clamp(rs.w + e.clientX - rs.x, 180, innerWidth - win.offsetLeft - 24), hh = clamp(rs.h + e.clientY - rs.y, 120, Math.min(innerHeight * 0.7, innerHeight - win.offsetTop - 70));
      box.style.width = w + 'px'; box.style.height = hh + 'px';
      win.style.width = (w + 16) + 'px';
      this.paint();
    });
    const end = () => { if (!rs) return; rs = null; this.size = { w: box.clientWidth, h: box.clientHeight }; store.prefs.set('refSize', this.size); };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }
}
