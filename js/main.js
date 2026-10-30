// Inkwell Studio — app core: view, input & gestures, tools, rendering, persistence.
import { $, $$, h, clamp, emptyRect, growRect, toast, makeCanvas, rgbToHex, canvasToBlob, dist, confirmDialog } from './util.js';
import { ICONS } from './icons.js';
import { Doc, Layer } from './doc.js';
import { History, snapshot, pixelCmd, withUndo } from './history.js';
import { StrokeEngine, detectShape, shapePoints } from './engine.js';
import { DEFAULT_BRUSHES, preloadBrush } from './brushes.js';
import { IBIS_PRESETS } from './ibis.js';
import { Selection, FloatingTransform, regionToCanvas, tracePath } from './tools.js';
import { fillRegionAsync, warmUp } from './pool.js';
import * as store from './storage.js';
import * as UI from './ui.js';
import { Timeline } from './anim.js';
import * as Toon from './webtoon.js';
import * as Three3D from './three3d.js';
import { Timelapse } from './timelapse.js';
import { Reference } from './reference.js';

// Apple M-series iPads (M1–M4) report 8+ cores and have 8–16 GB of RAM: give layers a
// bigger budget there. Older devices keep a conservative one.
function defaultMemoryMB() {
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 2000 : cores >= 6 ? 1000 : 600;
}
const SETTINGS_VERSION = 2;

const DEFAULT_SETTINGS = {
  rightHanded: false, penOnly: 'auto', pressureGamma: 1, quickShape: true, quickShapeDelay: 550,
  fillTolerance: 0.12, fillGap: 0, fillExpand: 1, fillRef: 'layer', memoryMB: defaultMemoryMB(), fingerSmudge: false,
  gestures: true, autosave: true, cursor: true, cursorPaint: true,
};

class App {
  constructor() {
    this.canvas = $('#view');
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.contentVer = 0;
    this.settings = { ...DEFAULT_SETTINGS, ...store.prefs.get('settings', {}) };
    if ((this.settings.v || 1) < SETTINGS_VERSION) {
      // older builds stored a 700 MB budget; move up to the device-appropriate default
      if (this.settings.memoryMB <= 700) this.settings.memoryMB = defaultMemoryMB();
      this.settings.v = SETTINGS_VERSION;
    }
    this.history = new History(() => this.updateUndoButtons());
    this.engine = new StrokeEngine();
    this.view = { x: 0, y: 0, zoom: 1, rot: 0, flip: 1 };
    this.ptrs = new Map();
    this.tool = 'brush';
    this.prevTool = 'brush';
    this.color = store.prefs.get('color', '#1d1d24');
    this.colorHistory = store.prefs.get('colorHistory', []);
    this.colorListeners = new Set();
    this.palette = store.prefs.get('palette', null);
    this.toolBrush = store.prefs.get('toolBrush', { brush: 'studio-pen', smudge: 'blender', eraser: 'soft-air' });
    this.sizes = store.prefs.get('sizes', {});
    this.symmetry = { mode: 'off', count: 6 };
    this.brushes = [...DEFAULT_BRUSHES, ...IBIS_PRESETS];
    this.penSeen = store.prefs.get('penSeen', false);
    this.doc = null;
    this.tools = this.makeTools();
    this.timeline = new Timeline(this);
    this.tlapse = new Timelapse(this);
    this.reference = new Reference(this);
    this.add3DLayer = () => Three3D.add3DLayer(this);
    this.addText = (shape) => {
      if (this.doc.mode === 'animate') { toast('Text and bubbles are available in Illustrate and Webtoon canvases'); return; }
      this.setTool('balloon');
      this.tools.balloon.defaults.shape = shape;
      this.tools.balloon.sel = null;
      this.updateCtxBar();
      toast(shape === 'none' ? 'Tap the canvas to place text (drag to size the box)' : 'Tap or drag on the canvas to add a speech bubble');
    };
    this.dirtySave = false;
  }

  // ───────── boot ─────────
  async init() {
    this.applySettings();
    this.buildChrome();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    try {
      const user = await store.listBrushes();
      for (const b of user) {
        const i = this.brushes.findIndex((x) => x.id === b.id);
        if (i >= 0) this.brushes[i] = { ...this.brushes[i], ...b, builtin: true, override: true };
        else this.brushes.push(b);
      }
    } catch (e) { console.warn('brush store', e); }
    await Promise.all(this.brushes.map(preloadBrush));
    Toon.loadSavedFonts();
    setTimeout(() => warmUp(), 1500);
    store.requestPersistence();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
    window.addEventListener('pagehide', () => this.saveNow());
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
    UI.renderGallery(this);
  }

  applySettings() {
    document.body.classList.toggle('right-handed', !!this.settings.rightHanded);
    document.body.classList.toggle('solid-ui', !!this.settings.solidUI);
    store.prefs.set('settings', this.settings);
  }

  buildChrome() {
    $('#btn-actions').innerHTML = ICONS.actions;
    $('#btn-adjust').innerHTML = ICONS.adjust;
    $('#btn-layers').innerHTML = ICONS.layers;
    $('#btn-modify').innerHTML = ICONS.eyedropper;
    $('#btn-undo').innerHTML = ICONS.undo;
    $('#btn-redo').innerHTML = ICONS.redo;
    for (const b of $$('.tool')) {
      b.innerHTML = ICONS[b.dataset.tool] || '';
      b.addEventListener('click', () => {
        const t = b.dataset.tool;
        if (this.tool === t && ['brush', 'smudge', 'eraser'].includes(t)) UI.openBrushLibrary(this, b);
        else this.setTool(t);
      });
    }
    $('#btn-gallery').onclick = () => this.closeDoc();
    $('#btn-actions').onclick = (e) => UI.openActions(this, e.currentTarget);
    $('#btn-adjust').onclick = (e) => UI.openAdjustments(this, e.currentTarget);
    $('#btn-layers').onclick = (e) => UI.openLayers(this, e.currentTarget);
    $('#btn-modify').onclick = () => { this.setTool('eyedropper', true); toast('Tap the canvas to pick a color'); };
    this.bindHoldRepeat($('#btn-undo'), () => this.undo());
    this.bindHoldRepeat($('#btn-redo'), () => this.redo());
    UI.bindColorButton(this, $('#btn-color'));
    this.sizeSlider = UI.vslider(this, $('#sl-size'), 'size');
    this.opSlider = UI.vslider(this, $('#sl-opacity'), 'opacity');
    $('#gal-new').onclick = () => UI.newDocDialog(this);
    $('#gal-import').onclick = () => UI.importAny(this);
    $('#gal-folder').onclick = () => UI.createFolderFlow(this);
    $('#gal-settings').onclick = () => UI.openSettings(this);
    for (const c of $$('.mode-card')) c.onclick = () => UI.newDocDialog(this, c.dataset.mode);
    this.updateColorChip();
  }

  bindHoldRepeat(el, fn) {
    let t1, t2;
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); fn();
      t1 = setTimeout(() => { t2 = setInterval(fn, 110); }, 450);
    });
    el.addEventListener('pointerup', stop); el.addEventListener('pointerleave', stop); el.addEventListener('pointercancel', stop);
  }

  // ───────── documents ─────────
  async openDoc(doc) {
    this.doc = doc;
    this.selection = new Selection(doc.width, doc.height);
    this.history.clear();
    this.transform = null;
    $('#gallery').hidden = true; $('#studio').hidden = false;
    document.body.classList.remove('mode-paint', 'mode-animate', 'mode-webtoon');
    document.body.classList.add('mode-' + doc.mode);
    $('#doc-title').textContent = doc.name;
    this.resize();
    this.fitView();
    if (this.tool === 'panel' && doc.mode !== 'webtoon') this.tool = 'brush';
    if (['balloon', '3d'].includes(this.tool) && doc.mode === 'animate') this.tool = 'brush';
    if (this.tool === 'move' && doc.mode !== 'animate') this.tool = 'brush';
    this.setTool(this.tool);
    this.timeline.mount(doc.mode === 'animate');
    this.tlapse.attach(doc);
    this.reference.restore();
    this.reference.changed();
    this.updateSliders();
    this.requestRender();
  }

  async closeDoc() {
    if (!this.doc) return;
    this.finishTransient();
    this.timeline.stop();
    UI.closePopover();
    UI.closeAllFloats();
    await this.saveNow(true);
    await this.tlapse.detach();
    this.doc = null;
    this.dropCaches();
    $('#studio').hidden = true; $('#gallery').hidden = false;
    UI.renderGallery(this);
  }

  changed(kind) {
    this.dirtySave = true;
    this.requestRender(kind === 'active' ? 'active' : undefined);
    UI.onDocChanged(this);
    if (this.doc && this.doc.mode === 'animate') this.timeline.refreshSoon();
    this.tlapse.schedule();
    this.reference.changed();
    clearTimeout(this.saveTimer);
    if (this.settings.autosave) this.saveTimer = setTimeout(() => this.saveNow(), 9000);
  }

  async saveNow(force) {
    if (!this.doc || (!this.dirtySave && !force)) return;
    if (this.engine.active || this.saving) return;
    this.saving = true;
    try {
      const d = this.doc;
      await this.tlapse.flush();
      const data = await d.serialize();
      const s = Math.min(1, 420 / Math.max(d.width, d.mode === 'webtoon' ? d.width * 1.4 : d.height));
      const th = d.flatten({ width: Math.max(1, d.width * s), height: Math.max(1, (d.mode === 'webtoon' ? Math.min(d.height, d.width * 1.4) : d.height) * s), frame: d.playhead });
      const thumb = await canvasToBlob(th, 'image/jpeg', 0.8);
      await store.saveDoc(data, { id: d.id, name: d.name, mode: d.mode, width: d.width, height: d.height, updated: Date.now(), created: d.created, folder: d.folder || null, thumb });
      this.dirtySave = false;
    } catch (e) {
      console.error(e);
      toast('Could not save: ' + (e.message || e));
    } finally { this.saving = false; }
  }

  maxRaster() { return Math.max(2, Math.floor((this.settings.memoryMB * 1e6) / this.doc.pixelBytes) - 5); }
  canAddRaster(n = 1) {
    if (this.doc.rasterCount() + n > this.maxRaster()) {
      toast(`Memory limit reached (${this.maxRaster()} layers at this canvas size). Merge or delete layers, or raise the limit in Settings.`, 3500);
      return false;
    }
    return true;
  }

  // ───────── brushes & tools ─────────
  brushFor(tool = this.tool) {
    const key = tool === 'smudge' ? 'smudge' : tool === 'eraser' ? 'eraser' : 'brush';
    return this.brushes.find((b) => b.id === this.toolBrush[key]) || this.brushes[0];
  }
  setBrush(id, tool = this.tool) {
    const key = tool === 'smudge' ? 'smudge' : tool === 'eraser' ? 'eraser' : 'brush';
    this.toolBrush[key] = id;
    store.prefs.set('toolBrush', this.toolBrush);
    // Recents (most recent first)
    const rec = [id, ...store.prefs.get('brushRecents', []).filter((x) => x !== id)].slice(0, 15);
    store.prefs.set('brushRecents', rec);
    this.updateSliders();
  }
  paintToolName() { return ['smudge', 'eraser'].includes(this.tool) ? this.tool : 'brush'; }
  sizeKey() { const t = this.paintToolName(); return t + ':' + this.brushFor(t).id; }
  getSize() { const b = this.brushFor(this.paintToolName()); return clamp(this.sizes[this.sizeKey()]?.size ?? b.size, 1, b.maxSize); }
  getOpacity() { const b = this.brushFor(this.paintToolName()); return this.sizes[this.sizeKey()]?.opacity ?? b.opacity; }
  setSize(v) { const k = this.sizeKey(); this.sizes[k] = { ...this.sizes[k], size: v }; store.prefs.set('sizes', this.sizes); }
  setOpacity(v) { const k = this.sizeKey(); this.sizes[k] = { ...this.sizes[k], opacity: v }; store.prefs.set('sizes', this.sizes); }
  updateSliders() { this.sizeSlider && this.sizeSlider.sync(); this.opSlider && this.opSlider.sync(); }

  setTool(name, oneShot = false) {
    if (!this.tools[name]) return;
    if (name !== this.tool) {
      this.finishTransient();
      const old = this.tools[this.tool];
      old && old.exit && old.exit();
      if (!oneShot) this.prevTool = this.tool;
      else this.oneShotReturn = this.tool;
      this.tool = name;
      const t = this.tools[name];
      t.enter && t.enter();
    } else {
      const t = this.tools[name];
      t.enter && !t.entered && t.enter();
    }
    for (const b of $$('.tool')) b.classList.toggle('active', b.dataset.tool === this.tool);
    this.updateSliders();
    this.updateCtxBar();
    this.requestRender('active');
  }

  finishTransient() {
    if (this.transform) this.tools.transform.commit();
    if (this.engine.active) { const c = this.engine.end(); if (c) this.history.push(c); }
  }

  updateCtxBar() {
    const t = this.tools[this.tool];
    const bar = $('#ctxbar');
    bar.innerHTML = '';
    const items = t && t.bar ? t.bar() : null;
    if (!items || !items.length || !this.doc) { bar.hidden = true; return; }
    bar.append(...items); bar.hidden = false;
  }

  setColor(hex, remember = true) {
    this.color = hex;
    store.prefs.set('color', hex);
    if (remember) {
      this.colorHistory = [hex, ...this.colorHistory.filter((c) => c !== hex)].slice(0, 10);
      store.prefs.set('colorHistory', this.colorHistory);
    }
    this.updateColorChip();
  }
  updateColorChip() {
    $('#btn-color span').style.background = this.color;
    for (const f of this.colorListeners) f(this.color);
  }

  // ───────── view ─────────
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const r = this.canvas.getBoundingClientRect();
    this.vw = r.width || innerWidth; this.vh = r.height || innerHeight;
    this.canvas.width = Math.round(this.vw * dpr); this.canvas.height = Math.round(this.vh * dpr);
    this.requestRender('view');
  }

  fitView() {
    if (!this.doc) return;
    const d = this.doc, top = 70, bottom = d.mode === 'animate' ? 210 : 20, side = 70;
    const aw = this.vw - side * 2, ah = this.vh - top - bottom;
    let z;
    if (d.mode === 'webtoon') z = Math.min(aw / d.width, 1.2);
    else z = Math.min(aw / d.width, ah / d.height);
    this.view = { x: 0, y: 0, zoom: z, rot: 0, flip: this.view.flip || 1 };
    const cx = this.vw / 2, cy = d.mode === 'webtoon' ? top + (d.width * z * 0.0) : top + ah / 2;
    if (d.mode === 'webtoon') this.setViewAt({ x: d.width / 2, y: 0 }, { x: cx, y: top + 10 });
    else this.setViewAt({ x: d.width / 2, y: d.height / 2 }, { x: cx, y: cy });
    this.requestRender('view');
  }

  viewMatrix() {
    const v = this.view;
    return new DOMMatrix().translate(v.x, v.y).rotate(v.rot * 180 / Math.PI).scale(v.zoom * v.flip, v.zoom);
  }
  docToScreen(x, y) { const p = this.viewMatrix().transformPoint({ x, y }); return { x: p.x, y: p.y }; }
  screenToDoc(x, y) { const p = this.viewMatrix().inverse().transformPoint({ x, y }); return { x: p.x, y: p.y }; }
  // place doc point d at screen point s, keeping zoom/rot
  setViewAt(d, s) {
    const v = this.view, c = Math.cos(v.rot), sn = Math.sin(v.rot);
    const dx = d.x * v.zoom * v.flip, dy = d.y * v.zoom;
    v.x = s.x - (dx * c - dy * sn);
    v.y = s.y - (dx * sn + dy * c);
  }
  zoomBy(f, sx = this.vw / 2, sy = this.vh / 2) {
    const d = this.screenToDoc(sx, sy);
    this.view.zoom = clamp(this.view.zoom * f, 0.02, 64);
    this.setViewAt(d, { x: sx, y: sy });
    this.showHud(Math.round(this.view.zoom * 100) + '%');
    this.requestRender('view');
  }
  showHud(text, ms = 700) {
    const hud = $('#hud'); hud.textContent = text; hud.hidden = false;
    clearTimeout(this.hudT); this.hudT = setTimeout(() => (hud.hidden = true), ms);
  }

  // ───────── input ─────────
  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', () => { this.hover = null; this.requestRender('view'); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // stop iOS from turning gestures into page zoom / text selection
    for (const ev of ['gesturestart', 'gesturechange', 'touchmove']) document.addEventListener(ev, (e) => { if (e.target === c || ev !== 'touchmove') e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
  }

  // raw: optional {pressure, time} replacing the event's own values (see onMove)
  pt(e, raw, rect) {
    const r = rect || this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const d = this.screenToDoc(sx, sy);
    let pressure = 1, tilt = 0;
    if (e.pointerType === 'pen') {
      // iPadOS sometimes reports 0 pressure (pen-down, some coalesced samples): reuse the last real value
      let pr = raw && raw.pressure != null ? raw.pressure : e.pressure;
      if (!(pr > 0)) pr = this.penPressure || 0.35;
      else if (e.buttons) this.penPressure = pr;
      pressure = Math.pow(clamp(pr, 0.01, 1), this.settings.pressureGamma);
      let t = 0;
      if (typeof e.altitudeAngle === 'number' && e.altitudeAngle > 0) t = 1 - e.altitudeAngle / (Math.PI / 2);
      else if (e.tiltX || e.tiltY) t = Math.min(1, Math.hypot(e.tiltX, e.tiltY) / 90);
      tilt = clamp((t - 0.4) / 0.6, 0, 1);
    }
    return { x: d.x, y: d.y, sx, sy, pressure, tilt, type: e.pointerType, time: raw && raw.time != null ? raw.time : e.timeStamp };
  }

  touchesDown() { let n = 0; for (const p of this.ptrs.values()) if (p.type === 'touch') n++; return n; }
  fingerDraws() {
    const s = this.settings.penOnly;
    if (s === 'on') return false;
    if (s === 'off') return true;
    return !this.penSeen;
  }

  onDown(e) {
    if (!this.doc) return;
    e.preventDefault();
    UI.closePopover();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.lastMoveTime = e.timeStamp;
    const p = this.pt(e);
    this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, sx: p.sx, sy: p.sy, x0: p.sx, y0: p.sy, t0: performance.now() });
    if (e.pointerType === 'pen' && !this.penSeen) {
      this.penSeen = true; store.prefs.set('penSeen', true);
      if (this.settings.penOnly === 'auto') toast('Apple Pencil detected — fingers now navigate, pencil draws');
    }

    if (e.pointerType === 'touch') {
      const n = this.touchesDown();
      if (n >= 2 || this.gesture) {
        // a finger stroke that just started becomes a gesture instead
        if (this.active && this.active.type === 'touch') {
          const young = performance.now() - this.active.t0 < 260;
          if (young) this.tools[this.active.tool].cancel?.(); else this.tools[this.active.tool].up?.(p);
          this.active = null;
        }
        this.cancelHold();
        if (this.pan1) this.pan1 = null;
        this.startGesture();
        return;
      }
      if (!this.fingerDraws() || this.spaceDown) {
        this.pan1 = { id: e.pointerId, sx: p.sx, sy: p.sy, view: { ...this.view } };
        this.startHold(e.pointerId, p);
        return;
      }
    }
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || this.spaceDown)) {
      this.pan1 = { id: e.pointerId, sx: p.sx, sy: p.sy, view: { ...this.view } };
      return;
    }
    if (this.active) return; // one drawing pointer at a time
    const toolName = this.tool;
    const tool = this.tools[toolName];
    if (!tool || !tool.down) return;
    this.active = { id: e.pointerId, tool: toolName, type: e.pointerType, t0: performance.now() };
    if (tool.down(p, e) === false) this.active = null;
    this.requestRender('active');
  }

  onMove(e) {
    if (!this.doc) return;
    const rec = this.ptrs.get(e.pointerId);
    const prevPen = this.penPressure;
    const p = this.pt(e);
    if (!rec) {
      // hover (mouse / Apple Pencil hover)
      if (e.pointerType !== 'touch') { this.hover = p; this.requestRender('cursor'); }
      return;
    }
    rec.sx = p.sx; rec.sy = p.sy;
    if (this.gesture) { this.updateGesture(); return; }
    if (this.hold && this.hold.id === e.pointerId) {
      if (this.hold.picking) { this.updatePicker(p); return; }
      if (dist(p.sx, p.sy, this.hold.sx, this.hold.sy) > 10) this.cancelHold();
    }
    if (this.pan1 && this.pan1.id === e.pointerId) {
      const v = this.pan1.view;
      this.view.x = v.x + p.sx - this.pan1.sx; this.view.y = v.y + p.sy - this.pan1.sy;
      this.requestRender('view');
      return;
    }
    if (this.active && this.active.id === e.pointerId) {
      const tool = this.tools[this.active.tool];
      if (tool.coalesced && e.getCoalescedEvents) {
        const list = e.getCoalescedEvents();
        if (list.length > 1) {
          // Apple Pencil samples between frames. Some arrive with no pressure or with the
          // frame's timestamp: fill those in from their neighbours so strokes stay even.
          const r = this.canvas.getBoundingClientRect(), n = list.length;
          const p0 = prevPen || e.pressure || 0.5, p1 = e.pressure > 0 ? e.pressure : p0;
          const t0 = this.lastMoveTime != null && this.lastMoveTime < e.timeStamp ? this.lastMoveTime : e.timeStamp - n * 4;
          let lastT = -Infinity;
          for (let j = 0; j < n; j++) {
            const ce = list[j], f = (j + 1) / n;
            let tm = ce.timeStamp;
            if (!(tm > lastT) || tm > e.timeStamp) tm = t0 + (e.timeStamp - t0) * f;
            lastT = tm;
            tool.move(this.pt(ce, { pressure: ce.pressure > 0 ? ce.pressure : p0 + (p1 - p0) * f, time: tm }, r), ce);
          }
        } else tool.move(list.length ? this.pt(list[0]) : p, e);
      } else tool.move && tool.move(p, e);
      this.hover = p; this.lastMoveTime = e.timeStamp;
      this.requestRender('active');
    }
  }

  onUp(e, cancelled) {
    if (!this.doc) return;
    const rec = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    const p = this.pt(e);
    if (this.gesture) {
      this.gesture.maxTouches = Math.max(this.gesture.maxTouches, this.gesture.ids.length);
      if (this.touchesDown() === 0) this.endGesture();
      else this.startGesture(true);
      return;
    }
    if (this.hold && this.hold.id === e.pointerId) {
      const picking = this.hold.picking;
      this.cancelHold();
      if (picking) { this.endPicker(); this.pan1 = null; return; }
    }
    if (this.pan1 && this.pan1.id === e.pointerId) { this.pan1 = null; return; }
    if (this.active && this.active.id === e.pointerId) {
      const tool = this.tools[this.active.tool];
      this.active = null;
      if (e.pointerType === 'touch') this.hover = null; // fingers have no hover: drop the cursor
      else this.hover = p;
      if (cancelled && tool.cancel) tool.cancel(); else tool.up && tool.up(p, e);
      this.requestRender('active');
    }
    if (!rec) return;
  }

  onWheel(e) {
    if (!this.doc) return;
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else { this.view.x -= e.deltaX; this.view.y -= e.deltaY; this.requestRender('view'); }
  }

  // ── two+ finger gestures: pinch-zoom, rotate, pan; taps = undo / redo / hide UI ──
  startGesture(keep) {
    const ids = [...this.ptrs.values()].filter((p) => p.type === 'touch').map((p) => p.id);
    const prev = this.gesture;
    this.gesture = {
      ids, view: { ...this.view }, start: ids.map((id) => ({ ...this.ptrs.get(id) })),
      t0: keep && prev ? prev.t0 : performance.now(), maxTouches: Math.max(ids.length, prev && keep ? prev.maxTouches : 0),
      moved: keep && prev ? prev.moved : false, zoom0: keep && prev ? prev.zoom0 : this.view.zoom,
    };
  }
  updateGesture() {
    const g = this.gesture;
    const cur = g.ids.map((id) => this.ptrs.get(id)).filter(Boolean);
    if (cur.length < 1) return;
    for (const c of cur) if (dist(c.sx, c.sy, c.x0, c.y0) > 12) g.moved = true;
    if (!this.settings.gestures) return;
    const s0 = g.start;
    const cx0 = s0.reduce((a, p) => a + p.sx, 0) / s0.length, cy0 = s0.reduce((a, p) => a + p.sy, 0) / s0.length;
    const cx = cur.reduce((a, p) => a + p.sx, 0) / cur.length, cy = cur.reduce((a, p) => a + p.sy, 0) / cur.length;
    this.view = { ...g.view };
    const anchor = this.screenToDoc(cx0, cy0);
    if (cur.length >= 2 && s0.length >= 2) {
      const d0 = dist(s0[0].sx, s0[0].sy, s0[1].sx, s0[1].sy), d1 = dist(cur[0].sx, cur[0].sy, cur[1].sx, cur[1].sy);
      const a0 = Math.atan2(s0[1].sy - s0[0].sy, s0[1].sx - s0[0].sx), a1 = Math.atan2(cur[1].sy - cur[0].sy, cur[1].sx - cur[0].sx);
      if (d0 > 10) this.view.zoom = clamp(g.view.zoom * d1 / d0, 0.02, 64);
      let rot = g.view.rot + (a1 - a0);
      // snap to right angles when close
      const snap = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(rot - snap) < 0.07) rot = snap;
      this.view.rot = rot;
    }
    this.setViewAt(anchor, { x: cx, y: cy });
    this.showHud(Math.round(this.view.zoom * 100) + '%' + (this.view.rot ? ` · ${Math.round(((this.view.rot * 180 / Math.PI) % 360 + 360) % 360)}°` : ''));
    this.requestRender('view');
  }
  endGesture() {
    const g = this.gesture; this.gesture = null;
    this.requestRender('view');
    const dt = performance.now() - g.t0;
    if (!g.moved && dt < 350) {
      if (g.maxTouches === 2) this.undo();
      else if (g.maxTouches === 3) this.redo();
      else if (g.maxTouches >= 4) document.body.classList.toggle('ui-hidden');
    } else if (dt < 400 && this.view.zoom < g.zoom0 * 0.65) {
      this.fitView(); // quick pinch → fit
    }
  }

  // ── touch-and-hold eyedropper ──
  startHold(id, p) {
    this.cancelHold();
    this.hold = { id, sx: p.sx, sy: p.sy, timer: setTimeout(() => { if (this.hold) { this.hold.picking = true; this.pan1 = null; this.updatePicker(this.hold.last || p); } }, 480), last: p };
  }
  cancelHold() { if (this.hold) clearTimeout(this.hold.timer); this.hold = null; }
  updatePicker(p) {
    const col = this.sampleColor(p.x, p.y);
    if (this.hold) this.hold.last = p;
    this.picked = col;
    const l = $('#loupe');
    l.hidden = false; l.style.left = p.sx + 'px'; l.style.top = (p.sy - 70) + 'px';
    l.style.background = this.color; l.firstChild.style.background = col;
  }
  endPicker() {
    $('#loupe').hidden = true;
    if (this.picked) this.setColor(this.picked);
    this.picked = null;
  }
  // Samples one pixel: the cached layers below / above plus the live active group are drawn
  // into a 1×1 canvas, so moving the loupe never re-composites the whole stack.
  sampleColor(x, y) {
    const d = this.doc;
    const c = this._pick1 || (this._pick1 = makeCanvas(1, 1)), cx = c.getContext('2d', { willReadFrequently: true });
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    cx.fillStyle = d.bgVisible ? d.bg : '#ffffff'; cx.fillRect(0, 0, 1, 1);
    cx.translate(-Math.floor(x), -Math.floor(y));
    if (this.timeline.playing) d.composite(cx, { preview: (cv) => this.previewFor(cv) });
    else {
      this.ensureCaches();
      const [gs, ge] = this.group;
      cx.drawImage(this.belowCache, 0, 0, d.width, d.height);
      d.composite(cx, { from: gs, to: ge, bg: false, preview: (cv) => this.previewFor(cv) });
      if (ge < d.items.length) { if (this.aboveFlat) cx.drawImage(this.aboveCache, 0, 0, d.width, d.height); else d.composite(cx, { from: ge, bg: false }); }
    }
    const p = cx.getImageData(0, 0, 1, 1).data;
    return rgbToHex(p[0], p[1], p[2]);
  }

  onKey(e) {
    if (!this.doc || e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); this.saveNow(true).then(() => toast('Saved')); return; }
    if (mod && k === 'd') { e.preventDefault(); this.selection.clear(); this.requestRender('view'); return; }
    if (mod) return;
    if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); return; }
    const map = { b: 'brush', e: 'eraser', s: 'smudge', v: 'transform', g: 'fill', i: 'eyedropper', m: 'move', p: 'panel', t: 'balloon', d: '3d', l: null };
    if (k in map) {
      if (k === 'l') UI.openLayers(this, $('#btn-layers'));
      else if (this.tools[map[k]] && this.toolAvailable(map[k])) this.setTool(map[k]);
      return;
    }
    if (k === '[' || k === ']') { const b = this.brushFor(this.paintToolName()); this.setSize(clamp(this.getSize() * (k === ']' ? 1.15 : 1 / 1.15), 1, b.maxSize)); this.updateSliders(); this.showHud(Math.round(this.getSize()) + ' px'); return; }
    if (k === '0') { this.fitView(); return; }
    if (k === '=' || k === '+') { this.zoomBy(1.25); return; }
    if (k === '-') { this.zoomBy(0.8); return; }
    if (k === 'tab') { e.preventDefault(); document.body.classList.toggle('ui-hidden'); return; }
    if (k === 'enter' && this.transform) { this.tools.transform.commit(); this.setTool(this.prevTool || 'brush'); return; }
    if (k === 'escape' && this.transform) { this.tools.transform.cancel(); return; }
    if ((k === 'delete' || k === 'backspace') && this.tools[this.tool].onDelete) { this.tools[this.tool].onDelete(); return; }
    if (k === ',' && this.doc.mode === 'animate') { this.timeline.step(-1); return; }
    if (k === '.' && this.doc.mode === 'animate') { this.timeline.step(1); return; }
    if (k === 'enter' && this.doc.mode === 'animate') { this.timeline.toggle(); }
  }
  toolAvailable(t) {
    if (t === '3d') return this.doc.mode !== 'animate';
    if (t === 'panel') return this.doc.mode === 'webtoon';
    if (t === 'balloon') return this.doc.mode !== 'animate';
    if (t === 'move') return this.doc.mode === 'animate';
    return true;
  }

  undo() {
    if (this.engine.active) return;
    if (this.transform) { this.tools.transform.cancel(); return; }
    const c = this.history.undo();
    if (c) { this.showHud('Undo ' + (c.label || '')); this.changed(); }
  }
  redo() {
    if (this.engine.active || this.transform) return;
    const c = this.history.redo();
    if (c) { this.showHud('Redo ' + (c.label || '')); this.changed(); }
  }
  updateUndoButtons() {
    $('#btn-undo').disabled = !this.history.canUndo;
    $('#btn-redo').disabled = !this.history.canRedo;
  }

  // ───────── rendering ─────────
  // kind: 'view' = only the viewport/overlays changed, 'active' = only the active layer
  // group changed (it is always drawn live), anything else = layer content changed.
  // kind: 'view' (pan/zoom/overlays), 'active' (the stroke in progress changed), 'cursor'
  // (only the brush outline moved) or nothing (content changed: caches are rebuilt).
  // Frames that only need 'active' / 'cursor' repaint just the changed part of the screen.
  requestRender(kind) {
    if (kind !== 'view' && kind !== 'active' && kind !== 'cursor') this.contentVer++;
    if (kind === 'active' || kind === 'cursor') { if (this.pendingPartial !== false) this.pendingPartial = true; }
    else this.pendingPartial = false;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.renderFrame(); });
  }
  renderFrame() {
    const partial = this.pendingPartial === true;
    this.pendingPartial = null;
    this.render(partial);
  }

  // Screen rectangle (device pixels) that changed since the last frame, or null to repaint all.
  partialRect() {
    const d = this.doc, t = this.tools[this.tool];
    if (!d || this.timeline.playing || this.transform || this.gesture || (t && (t.overlay || t.overlayScreen))) return null;
    if (this.canvas.width !== this.lastFrameW || this.canvas.height !== this.lastFrameH) return null;
    const r = emptyRect(), dpr = this.dpr;
    const f = this.engine.takeFrame();
    if (f) {
      const m = this.viewMatrix();
      // pad: 2 document pixels (image filtering reaches neighbours) + 3 screen pixels
      const pad = 2 + Math.max(0, 1.5 / this.view.zoom);
      for (const [x, y] of [[f.x0 - pad, f.y0 - pad], [f.x1 + pad, f.y0 - pad], [f.x0 - pad, f.y1 + pad], [f.x1 + pad, f.y1 + pad]]) growRect(r, (m.a * x + m.c * y + m.e) * dpr, (m.b * x + m.d * y + m.f) * dpr, 3);
    }
    for (const c of [this.lastCursorRect, this.cursorRect()]) if (c) { growRect(r, c.x0, c.y0, 2); growRect(r, c.x1, c.y1, 2); }
    if (!(r.x1 > r.x0 && r.y1 > r.y0)) return { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.max(0, Math.floor(r.x0)), y = Math.max(0, Math.floor(r.y0));
    const w = Math.min(this.canvas.width, Math.ceil(r.x1)) - x, h = Math.min(this.canvas.height, Math.ceil(r.y1)) - y;
    // a big change is cheaper as one full repaint
    if (w * h > this.canvas.width * this.canvas.height * 0.6) return null;
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  }
  // brush outline circle (device pixels), or null when it isn't shown
  cursorRect() {
    const painting = this.active && this.active.id != null;
    if (!this.hover || !(painting ? this.settings.cursorPaint : this.settings.cursor) || !['brush', 'eraser', 'smudge'].includes(this.tool) || this.gesture) return null;
    const b = painting && this.brushFor(this.paintToolName());
    const pr = b && b.sizePressure ? 1 - b.sizePressure + b.sizePressure * clamp(this.hover.pressure || 0.5, 0, 1) : 1;
    const r = Math.max(1.5, (this.getSize() * pr * this.view.zoom) / 2) + 2, dpr = this.dpr;
    return { x0: (this.hover.sx - r) * dpr, y0: (this.hover.sy - r) * dpr, x1: (this.hover.sx + r) * dpr, y1: (this.hover.sy + r) * dpr, sx: this.hover.sx, sy: this.hover.sy, r: r - 2 };
  }

  // Layers below the active group are flattened into one cached image, and so are the
  // layers above it (when they all blend normally). A frame is then ~3 image draws.
  // Caches are built at the resolution the screen can actually show: when zoomed far out
  // on a big canvas they shrink (½, ¼, ⅛), so building and drawing them touches far fewer
  // pixels. The active layer is always drawn at full resolution.
  cacheScale() {
    const k = this.view.zoom * this.dpr;
    if (k >= 0.5) return 1;
    return Math.max(0.125, Math.pow(2, Math.ceil(Math.log2(k * 1.5))));
  }
  cacheCanvas(name, sc) {
    const d = this.doc, w = Math.max(1, Math.round(d.width * sc)), h = Math.max(1, Math.round(d.height * sc));
    let c = this[name];
    if (!c || c.width !== w || c.height !== h) c = this[name] = makeCanvas(w, h);
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    x.setTransform(sc, 0, 0, sc, 0, 0);
    x.imageSmoothingQuality = 'medium';
    return c;
  }
  ensureCaches() {
    const d = this.doc, [gs, ge] = d.activeGroup(), n = d.items.length;
    // keep the current resolution during a pinch; re-evaluate when it ends
    const sc = this.gesture && this.cacheSc ? this.cacheSc : this.cacheScale();
    const key = [this.contentVer, gs, ge, n, d.playhead, d.width, d.height, d.bgVisible, d.bg, d.anim.onion.on, sc].join('|');
    if (key === this.cacheKey) return;
    this.cacheKey = key; this.cacheSc = sc;
    const below = this.cacheCanvas('belowCache', sc);
    d.composite(below.getContext('2d'), { to: gs, bg: d.bgVisible, underlay: d.mode === 'animate' ? (x) => this.timeline.drawOnion(x) : null });
    this.aboveFlat = d.canFlattenRange(ge, n);
    if (this.aboveFlat && ge < n) {
      const above = this.cacheCanvas('aboveCache', sc);
      d.composite(above.getContext('2d'), { from: ge, bg: false });
    }
    this.group = [gs, ge];
  }
  dropCaches() { for (const k of ['belowCache', 'aboveCache']) if (this[k]) { this[k].width = this[k].height = 0; this[k] = null; } this.cacheKey = null; }

  previewFor(canvas) {
    const e = this.engine.previewFor(canvas);
    if (e) return e;
    if (this.transform && canvas === this.transform.target.canvas) return this.transform.preview;
    return null;
  }

  render(partial = false) {
    if (!this.doc) return;
    const clip = partial ? this.partialRect() : null;
    if (!clip) this.engine.takeFrame(); // full repaint: the stroke's pending area is covered
    if (clip && (clip.w <= 0 || clip.h <= 0)) return;
    const ctx = this.ctx;
    ctx.save();
    if (clip) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }
    this.renderScene();
    ctx.restore();
    this.lastFrameW = this.canvas.width; this.lastFrameH = this.canvas.height;
  }

  renderScene() {
    const ctx = this.ctx, d = this.doc, v = this.view, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const m = this.viewMatrix();
    ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);
    // paper + cheap shadow (shadowBlur on a big rect is very slow in Safari)
    const px0 = 1 / v.zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-3 * px0, -1 * px0, d.width + 6 * px0, d.height + 7 * px0);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-1 * px0, 0, d.width + 2 * px0, d.height + 3 * px0);
    ctx.fillStyle = d.bgVisible ? d.bg : '#ffffff';
    ctx.fillRect(0, 0, d.width, d.height);
    if (!d.bgVisible) {
      if (!this.checker) {
        const c = makeCanvas(16, 16), x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#d9d9de'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
        this.checker = ctx.createPattern(c, 'repeat');
      }
      this.checker.setTransform && this.checker.setTransform(new DOMMatrix().scale(1 / v.zoom));
      ctx.fillStyle = this.checker; ctx.fillRect(0, 0, d.width, d.height);
    }
    ctx.imageSmoothingEnabled = v.zoom < 2.5;
    // cheap bilinear while navigating; painting keeps the same filtering (frames are partial)
    ctx.imageSmoothingQuality = this.gesture || this.pan1 || this.transform ? 'low' : 'medium';
    if (this.engine.active) this.engine.updatePreview();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, d.width, d.height); ctx.clip();
    const preview = (c) => this.previewFor(c);
    const overlay = this.engine.active ? (c) => this.engine.overlayFor(c) : null;
    if (this.timeline.playing) {
      // every frame differs during playback: composite directly
      d.composite(ctx, { preview, overlay, bg: d.bgVisible });
    } else {
      this.ensureCaches();
      const [gs, ge] = this.group;
      ctx.drawImage(this.belowCache, 0, 0, d.width, d.height);
      d.composite(ctx, { from: gs, to: ge, bg: false, preview, overlay });
      if (ge < d.items.length) {
        if (this.aboveFlat) ctx.drawImage(this.aboveCache, 0, 0, d.width, d.height);
        else d.composite(ctx, { from: ge, bg: false });
      }
    }
    ctx.restore();
    // doc-space overlays
    const px = 1 / v.zoom;
    if (d.mode === 'webtoon') Toon.drawGuides(this, ctx, px);
    if (this.symmetry.mode !== 'off') this.drawSymmetryGuide(ctx, px);
    if (this.selection && this.selection.active) this.drawSelection(ctx, px);
    const t = this.tools[this.tool];
    t && t.overlay && t.overlay(ctx, px);
    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // brush outline; while painting it shows the size the current pressure produces
    const cr = this.cursorRect();
    if (cr) {
      ctx.beginPath(); ctx.arc(cr.sx, cr.sy, cr.r, 0, Math.PI * 2);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(cr.sx, cr.sy, cr.r + 1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
    }
    this.lastCursorRect = cr;
    t && t.overlayScreen && t.overlayScreen(ctx);
  }

  drawSymmetryGuide(ctx, px) {
    const d = this.doc, cx = d.width / 2, cy = d.height / 2;
    ctx.save(); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = 'rgba(61,139,255,0.8)'; ctx.setLineDash([8 * px, 6 * px]);
    ctx.beginPath();
    const m = this.symmetry.mode;
    if (m === 'vertical' || m === 'quad') { ctx.moveTo(cx, 0); ctx.lineTo(cx, d.height); }
    if (m === 'horizontal' || m === 'quad') { ctx.moveTo(0, cy); ctx.lineTo(d.width, cy); }
    if (m === 'radial') {
      const n = this.symmetry.count, R = Math.hypot(cx, cy);
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
    }
    ctx.stroke(); ctx.restore();
  }

  drawSelection(ctx, px) {
    const s = this.selection;
    ctx.save();
    // dim the unselected area slightly (rebuilt only when the selection changes)
    if (!this.selTint || this.selTintVer !== s.ver) {
      const c = this.selTint && this.selTint.width === s.w && this.selTint.height === s.h ? this.selTint : makeCanvas(s.w, s.h);
      const x = c.getContext('2d');
      x.globalCompositeOperation = 'copy'; x.fillStyle = 'rgba(40,60,120,0.28)'; x.fillRect(0, 0, s.w, s.h);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(s.mask, 0, 0);
      x.globalCompositeOperation = 'source-over';
      this.selTint = c; this.selTintVer = s.ver;
    }
    ctx.drawImage(this.selTint, 0, 0);
    if (s.vector && s.paths.length) {
      ctx.lineWidth = 1.2 * px;
      for (const [col, off] of [['#000', 0], ['#fff', 5]]) {
        ctx.strokeStyle = col; ctx.setLineDash([5 * px, 5 * px]); ctx.lineDashOffset = off * px;
        ctx.beginPath();
        for (const p of s.paths) tracePath(ctx, p.shape);
        ctx.stroke();
      }
    } else {
      const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(s.edges(), 0, 0);
      ctx.imageSmoothingEnabled = sm;
    }
    ctx.restore();
  }
  selectionChanged() { this.requestRender('view'); }

  // ───────── fill ─────────
  async fillAt(x, y, color = this.color) {
    const d = this.doc;
    const target = d.getTarget(true);
    if (!target) { toast('Pick a raster layer to fill'); return; }
    const s = this.settings;
    let ref;
    if (s.fillRef === 'layer') {
      if (!target.matrix) ref = target.canvas;
      else { ref = makeCanvas(d.width, d.height); const r = ref.getContext('2d'); const mm = target.matrix; r.setTransform(mm.a, mm.b, mm.c, mm.d, mm.e, mm.f); r.drawImage(target.canvas, 0, 0); }
    } else if (s.fillRef === 'reference') {
      const hasRef = d.items.some((it) => it.reference);
      if (!hasRef) toast('No reference layer set — using all layers. Mark one in the Layers panel.');
      ref = d.flatten({ bg: false, filter: hasRef ? (it) => it.reference : null });
    } else ref = d.flatten({ bg: false });
    // the flood fill itself runs on a worker core; the UI stays responsive on big canvases
    const w = ref.width, hh = ref.height;
    const src = ref.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh).data;
    const sel = this.selection.active ? this.selection.mask : null;
    const region = await fillRegionAsync(src, w, hh, x, y, { tolerance: s.fillTolerance, gap: s.fillGap, expand: s.fillExpand });
    if (!region || this.doc !== d) return;
    const fill = regionToCanvas(region, w, hh, color, sel);
    withUndo(this.history, target.canvas, 'Fill', (c) => {
      c.save();
      if (target.matrix) { const inv = target.matrix.inverse(); c.setTransform(inv.a, inv.b, inv.c, inv.d, inv.e, inv.f); }
      c.globalCompositeOperation = target.layer.alphaLock ? 'source-atop' : 'source-over';
      c.drawImage(fill, 0, 0); c.restore();
    }, () => this.requestRender(), target.matrix ? null : fill.bbox);
    this.changed('active');
  }

  // ───────── tools ─────────
  makeTools() {
    const app = this;
    const paint = (kind) => ({
      coalesced: true,
      down(p) {
        const d = app.doc;
        const target = d.getTarget(true);
        if (!target) {
          const a = d.activeItem;
          toast(!a ? 'Add a layer first' : a.type === '3d' ? '3D layer — use the 3D tool, or Rasterize it to paint on it' : a.type === 'group' ? 'Pick a layer inside the group to paint on' : `"${a.name}" isn't a paint layer — pick or add a raster layer`);
          return false;
        }
        if (!target.layer.visible) toast('Layer is hidden');
        const toolName = kind === 'paint' ? 'brush' : kind === 'erase' ? 'eraser' : 'smudge';
        app.engine.begin(target, app.brushFor(toolName), {
          kind, color: app.color, size: app.getSize(), opacity: app.getOpacity(), symmetry: app.symmetry,
          selection: app.selection.active ? app.selection.mask : null, simTaper: p.type !== 'pen', viewZoom: app.view.zoom,
          onChange: () => app.changed(),
        });
        this.target = target; this.raw = [p]; this.shape = null; this.anchor = p;
        app.engine.add(p);
        this.armQuickShape(p);
      },
      armQuickShape(p) {
        clearTimeout(this.qs);
        if (!app.settings.quickShape || kind === 'smudge') return;
        this.qs = setTimeout(() => this.snap(), app.settings.quickShapeDelay);
      },
      move(p) {
        if (!app.engine.active) return;
        if (this.shape) { this.adjustShape(p); return; }
        this.raw.push(p);
        app.engine.add(p);
        if (dist(p.sx, p.sy, this.anchor.sx, this.anchor.sy) > 5) { this.anchor = p; this.armQuickShape(p); }
      },
      snap() {
        if (!app.engine.active || this.shape) return;
        const sh = detectShape(this.raw);
        if (!sh) return;
        this.shape = sh; this.base = { ...sh };
        this.pressure = app.engine.avgPressure();
        const last = this.raw[this.raw.length - 1];
        this.grab = { x: last.x, y: last.y };
        this.redrawShape();
        app.showHud({ line: 'Line', ellipse: 'Ellipse', arc: 'Arc' }[sh.type] + ' — keep holding & drag to adjust', 1400);
      },
      adjustShape(p) {
        const sh = this.shape, b = this.base, constrain = app.touchesDown() > 0;
        if (sh.type === 'line' || sh.type === 'arc') {
          let x2 = p.x, y2 = p.y;
          if (constrain && sh.type === 'line') {
            const a = Math.atan2(y2 - b.y1, x2 - b.x1), L = Math.hypot(x2 - b.x1, y2 - b.y1);
            const sa = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
            x2 = b.x1 + Math.cos(sa) * L; y2 = b.y1 + Math.sin(sa) * L;
          }
          sh.x2 = x2; sh.y2 = y2;
        } else if (sh.type === 'ellipse') {
          const k0 = Math.hypot(this.grab.x - b.cx, this.grab.y - b.cy) || 1;
          const k = Math.hypot(p.x - b.cx, p.y - b.cy) / k0;
          sh.rx = b.rx * k; sh.ry = b.ry * k;
          if (constrain) sh.rx = sh.ry = (sh.rx + sh.ry) / 2;
        }
        this.redrawShape();
      },
      redrawShape() {
        const pts = shapePoints(this.shape, this.pressure).map((q) => ({ ...this.target.toLocal(q.x, q.y), p: q.p, t: 0 }));
        app.engine.reshape(pts);
        app.requestRender('active');
      },
      up() {
        clearTimeout(this.qs);
        const cmd = app.engine.end(kind === 'paint' ? 'Stroke' : kind === 'erase' ? 'Erase' : 'Smudge');
        if (cmd) app.history.push(cmd);
        this.shape = null;
        app.changed('active');
      },
      cancel() { clearTimeout(this.qs); app.engine.cancel(); this.shape = null; app.requestRender('active'); },
      bar() { return app.doc && app.doc.mode === 'animate' ? null : null; },
    });

    const tools = {
      brush: paint('paint'),
      eraser: paint('erase'),
      smudge: paint('smudge'),
      eyedropper: {
        down(p) { app.updatePicker(p); },
        move(p) { app.updatePicker(p); },
        up() {
          app.endPicker();
          if (app.oneShotReturn) { const t = app.oneShotReturn; app.oneShotReturn = null; app.setTool(t); }
        },
        cancel() { $('#loupe').hidden = true; },
      },
      fill: {
        down(p) { app.fillAt(p.x, p.y); },
        bar() { return UI.fillBar(app); },
      },
      select: UI.selectTool(app),
      transform: UI.transformTool(app),
      move: UI.moveTool(app),
      panel: Toon.panelTool(app),
      '3d': Three3D.tool3d(app),
      balloon: Toon.balloonTool(app),
    };
    return tools;
  }

  // Add an image (File/Blob) as a new layer, scaled to fit.
  // source: File / Blob / canvas / ImageBitmap. opts.private keeps it out of the time-lapse.
  async insertImage(source, opts = {}) {
    const d = this.doc;
    const img = await createImageBitmap(source);
    const name = opts.name || (source.name ? source.name.replace(/\.[^.]+$/, '') : 'Image');
    const place = (c) => {
      const s = Math.min(1, d.width / img.width, d.height / img.height);
      c.drawImage(img, (d.width - img.width * s) / 2, (d.height - img.height * s) / 2, img.width * s, img.height * s);
    };
    if (d.mode === 'animate') {
      const t = d.activeItem; if (!t) return;
      const target = d.getTarget(true);
      withUndo(this.history, target.canvas, 'Insert image', place, () => this.requestRender());
      if (opts.private) t.private = true;
      this.changed();
      return;
    }
    if (!this.canAddRaster()) return;
    const l = new Layer(d.width, d.height, { name: opts.private ? '🔒 ' + name : name, private: !!opts.private, panelMask: d.mode === 'webtoon' });
    place(l.canvas.getContext('2d'));
    UI.insertLayer(this, l);
    if (opts.private) toast('Private: this layer never appears in the time-lapse');
    this.setTool('transform');
  }

}

// Out of canvas memory while creating a layer → explain instead of failing silently
const oom = (e) => {
  const m = (e && (e.message || (e.reason && e.reason.message))) || '';
  if (!m.includes('OUT_OF_MEMORY')) return;
  e.preventDefault && e.preventDefault();
  toast("This iPad is out of canvas memory for another layer — merge or delete layers, or lower Settings › Memory budget.", 4500);
};
window.addEventListener('error', oom);
window.addEventListener('unhandledrejection', oom);

const app = new App();
window.inkwell = app;
app.init();
