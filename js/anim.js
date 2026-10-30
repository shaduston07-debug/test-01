// Animation studio: multi-track timeline (each track = flipbook drawings + keyframed motion),
// live "performance" motion capture, onion skinning, and GIF / video / PNG export.
import { $, h, clamp, toast, dialog, field, switchRow, seg, makeCanvas, canvasToBlob, download } from './util.js';
import { ICONS } from './icons.js';
import { encodeGif } from './gif.js';
import * as UI from './ui.js';
import { Track } from './doc.js';

const CELL = 28;

export class Timeline {
  constructor(app) {
    this.app = app;
    this.el = $('#timeline');
    this.playing = false;
    this.recording = false;
    this.thumbs = new Map();
  }
  get doc() { return this.app.doc; }

  mount(show) {
    this.stop();
    this.el.hidden = !show;
    this.thumbs.clear();
    if (show) this.build();
  }

  build() {
    const a = this.doc.anim;
    this.el.innerHTML = '';
    const btn = (label, fn, cls = '', title = '') => h('button', { class: 'cb-btn ' + cls, onclick: fn, title }, label);
    this.playBtn = h('button', { class: 'cb-btn', html: ICONS.play, style: { width: '44px', display: 'grid', placeItems: 'center' }, onclick: () => this.toggle() });
    this.playBtn.firstChild.style.width = '20px';
    this.loopBtn = btn('', () => { a.loop = { loop: 'pingpong', pingpong: 'once', once: 'loop' }[a.loop]; this.syncHead(); this.app.changed(); });
    this.fpsSel = h('select', { style: { width: 'auto', minHeight: '36px' } }, ...[4, 6, 8, 10, 12, 15, 24, 30, 60].map((f) => h('option', { value: f, selected: f === a.fps }, f + ' fps')));
    this.fpsSel.onchange = () => { a.fps = parseInt(this.fpsSel.value); this.app.changed(); };
    this.lenIn = h('input', { class: 'text-in', type: 'number', value: a.length, style: { width: '74px', minHeight: '36px' }, title: 'Length (frames)' });
    this.lenIn.onchange = () => { a.length = clamp(parseInt(this.lenIn.value) || a.length, 1, 5000); this.lenIn.value = a.length; this.refresh(); this.app.changed(); };
    this.onionBtn = btn('Onion', () => { a.onion.on = !a.onion.on; this.syncHead(); this.app.requestRender(); });
    this.recBtn = btn('● Perform', () => this.toggleRecord(), 'rec', 'Arm, then drag the canvas with the Move tool while playing to record motion live');
    this.frameLbl = h('span', { class: 'tl-frame' });
    this.collapseBtn = btn('▾', () => {
      const c = this.el.classList.toggle('collapsed');
      document.body.classList.toggle('tl-collapsed', c);
      this.collapseBtn.textContent = c ? '▴' : '▾';
    });
    const head = h('div', { class: 'tl-head' },
      this.playBtn, this.loopBtn, this.fpsSel, this.lenIn, this.onionBtn,
      btn('⚙︎', () => this.onionDialog(), '', 'Onion skin settings'), this.recBtn,
      h('span', { class: 'cb-sep' }),
      btn('◀', () => this.step(-1)), this.frameLbl, btn('▶', () => this.step(1)),
      h('span', { class: 'cb-sep' }),
      btn('＋ Frame', () => this.addFrame(), 'on', 'New blank drawing on the next frame'),
      btn('Duplicate', () => this.dupFrame()), btn('Hold −', () => this.hold(-1)), btn('Hold +', () => this.hold(1)),
      btn('Delete', () => this.delFrame()),
      h('span', { class: 'cb-sep' }), btn('＋ Track', () => this.addTrack()), btn('Export', (e) => this.exportMenu(e.currentTarget)),
      this.collapseBtn);
    this.names = h('div', { class: 'tl-names' });
    this.grid = h('div', { class: 'tl-grid' });
    this.grid.addEventListener('scroll', () => { this.names.scrollTop = this.grid.scrollTop; });
    this.el.append(head, h('div', { class: 'tl-body' }, this.names, this.grid));
    this.syncHead();
    this.refresh();
  }

  syncHead() {
    const a = this.doc.anim;
    this.loopBtn.textContent = { loop: '⟳ Loop', pingpong: '⇄ Ping-pong', once: '→ Once' }[a.loop];
    this.onionBtn.classList.toggle('on', a.onion.on);
    this.recBtn.classList.toggle('on', this.recording);
    this.playBtn.innerHTML = this.playing ? ICONS.pause : ICONS.play;
    this.playBtn.firstChild.style.width = '20px';
    this.frameLbl.textContent = `${this.doc.playhead + 1} / ${a.length}`;
  }

  refreshSoon() {
    if (this.el.hidden) return;
    clearTimeout(this.rt);
    this.rt = setTimeout(() => {
      // update the thumbnail of the drawing that was just edited
      const tr = this.doc.activeItem;
      const cel = tr && tr.celAt && tr.celAt(this.doc.playhead);
      if (cel) this.thumbs.delete(cel.id);
      this.refresh();
    }, 220);
  }

  thumb(cel) {
    let t = this.thumbs.get(cel.id);
    if (!t) {
      const d = this.doc, hgt = 24, w = Math.max(1, Math.round(hgt * d.width / d.height));
      t = makeCanvas(w * 2, hgt * 2);
      const x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height); x.drawImage(cel.canvas, 0, 0, t.width, t.height);
      this.thumbs.set(cel.id, t);
    }
    const c = makeCanvas(t.width, t.height); c.getContext('2d').drawImage(t, 0, 0);
    c.style.width = t.width / 2 + 'px';
    return c;
  }

  refresh() {
    if (this.el.hidden || !this.doc || !this.grid) return;
    const d = this.doc, a = d.anim;
    const len = Math.max(a.length, ...d.tracks.flatMap((t) => t.cels.map((c) => c.start + c.dur)), 1);
    if (len > a.length) { a.length = len; this.lenIn.value = len; }
    const scrollL = this.grid.scrollLeft, scrollT = this.grid.scrollTop;
    this.names.innerHTML = ''; this.grid.innerHTML = '';
    this.names.append(h('div', { class: 'tl-ruler-pad' }));
    const inner = h('div', { class: 'tl-inner', style: { width: a.length * CELL + 60 + 'px' } });
    const ruler = h('div', { class: 'tl-ruler' });
    for (let f = 0; f < a.length; f++) if (f % 5 === 0 || CELL > 24 && f % 1 === 0 && a.length < 40) ruler.append(h('span', { style: { left: f * CELL + 'px' } }, f + 1));
    const scrub = (e) => { const r = ruler.getBoundingClientRect(); this.setFrame(Math.floor((e.clientX - r.left) / CELL), true); };
    let scrubbing = false;
    ruler.addEventListener('pointerdown', (e) => { scrubbing = true; ruler.setPointerCapture(e.pointerId); scrub(e); });
    ruler.addEventListener('pointermove', (e) => scrubbing && scrub(e));
    ruler.addEventListener('pointerup', () => { scrubbing = false; this.refresh(); this.app.updateCtxBar(); });
    inner.append(ruler);
    for (let i = d.tracks.length - 1; i >= 0; i--) {
      const t = d.tracks[i], on = i === d.active;
      const vis = h('button', { class: 'layer-vis' + (t.visible ? ' on' : ''), onclick: (e) => { e.stopPropagation(); t.visible = !t.visible; this.app.changed(); this.refresh(); } });
      this.names.append(h('div', { class: 'tl-name' + (on ? ' on' : ''), onclick: () => { d.active = i; this.app.updateCtxBar(); this.refresh(); this.app.requestRender(); } }, vis, h('b', {}, t.name)));
      const row = h('div', { class: 'tl-row' + (on ? ' on' : '') });
      row.addEventListener('pointerdown', (e) => {
        if (e.target !== row) return;
        const r = row.getBoundingClientRect();
        d.active = i; this.setFrame(Math.floor((e.clientX - r.left) / CELL));
        this.app.updateCtxBar();
      });
      const cur = t.celAt(d.playhead);
      for (const c of t.cels) {
        const el = h('div', { class: 'tl-cel' + (on && c === cur ? ' on' : ''), style: { left: c.start * CELL + 1 + 'px', width: c.dur * CELL - 2 + 'px' } }, this.thumb(c));
        this.bindCelDrag(el, t, c, i);
        row.append(el);
      }
      for (const k of t.keys) row.append(h('div', { class: 'tl-key', style: { left: k.f * CELL + CELL / 2 + 'px' } }));
      inner.append(row);
    }
    this.playheadEl = h('div', { class: 'tl-playhead', style: { left: d.playhead * CELL + CELL / 2 - 1 + 'px' } });
    inner.append(this.playheadEl);
    this.grid.append(inner);
    this.grid.scrollLeft = scrollL; this.grid.scrollTop = scrollT;
    this.syncHead();
  }

  bindCelDrag(el, track, cel, idx) {
    let st = null;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      st = { x: e.clientX, start: cel.start, moved: false, before: track.cels.map((c) => ({ ...c })) };
    });
    el.addEventListener('pointermove', (e) => {
      if (!st) return;
      const df = Math.round((e.clientX - st.x) / CELL);
      if (df !== 0) st.moved = true;
      if (!st.moved) return;
      const ns = Math.max(0, st.start + df);
      const clash = track.cels.some((c) => c !== cel && ns < c.start + c.dur && c.start < ns + cel.dur);
      if (!clash) { cel.start = ns; el.style.left = ns * CELL + 1 + 'px'; }
    });
    el.addEventListener('pointerup', (e) => {
      if (!st) return;
      const s = st; st = null;
      if (!s.moved) {
        this.doc.active = idx;
        const r = el.parentElement.getBoundingClientRect();
        this.setFrame(Math.floor((e.clientX - r.left) / CELL));
        this.app.updateCtxBar();
        return;
      }
      track.sortCels();
      this.pushCels('Retime', track, s.before);
      this.app.changed(); this.refresh();
    });
  }

  pushCels(label, track, before) {
    const after = track.cels.map((c) => ({ ...c }));
    const app = this.app;
    app.history.push({ label, bytes: 500,
      undo: () => { track.cels = before.map((c) => ({ ...c })); app.changed(); this.refresh(); },
      redo: () => { track.cels = after.map((c) => ({ ...c })); app.changed(); this.refresh(); } });
  }

  setFrame(f, light = false) {
    const d = this.doc;
    if (this.app.engine.active) return;
    this.app.finishTransient();
    d.playhead = clamp(f, 0, d.anim.length - 1);
    if (this.playheadEl) this.playheadEl.style.left = d.playhead * CELL + CELL / 2 - 1 + 'px';
    this.syncHead();
    this.app.requestRender();
    if (!this.playing && !light) { this.refresh(); this.app.updateCtxBar(); this.scrollIntoView(); }
  }
  scrollIntoView() {
    const x = this.doc.playhead * CELL, g = this.grid;
    if (x < g.scrollLeft + 20 || x > g.scrollLeft + g.clientWidth - 40) g.scrollLeft = x - g.clientWidth / 2;
  }
  step(dir) { const L = this.doc.anim.length; this.setFrame((this.doc.playhead + dir + L) % L); }

  // ── frame ops on the active track ──
  track() { const t = this.doc.activeItem; if (!t || t.type !== 'track') { toast('Select a track'); return null; } return t; }
  shiftAfter(t, from, by, except) { for (const c of t.cels) if (c !== except && c.start >= from) c.start += by; }

  addFrame() {
    const t = this.track(); if (!t || !this.app.canAddRaster()) return;
    const d = this.doc, f = d.playhead + (t.celAt(d.playhead) ? 1 : 0);
    const before = t.cels.map((c) => ({ ...c }));
    const hold = t.celAt(f);
    if (hold && hold.start < f) hold.dur = f - hold.start;
    else if (hold) this.shiftAfter(t, f, 1);
    d.addCel(t, f, 1);
    if (f >= d.anim.length) d.anim.length = f + 1;
    this.pushCels('New frame', t, before);
    this.setFrame(f); this.app.changed();
  }
  dupFrame() {
    const t = this.track(); if (!t) return;
    const d = this.doc, cur = t.celAt(d.playhead);
    if (!cur) { toast('No drawing here to duplicate'); return; }
    if (!this.app.canAddRaster()) return;
    const before = t.cels.map((c) => ({ ...c }));
    const f = cur.start + cur.dur;
    this.shiftAfter(t, f, cur.dur);
    const n = d.addCel(t, f, cur.dur);
    n.canvas.getContext('2d').drawImage(cur.canvas, 0, 0);
    d.anim.length = Math.max(d.anim.length, f + cur.dur);
    this.pushCels('Duplicate frame', t, before);
    this.setFrame(f); this.app.changed();
  }
  hold(dir) {
    const t = this.track(); if (!t) return;
    const cur = t.celAt(this.doc.playhead);
    if (!cur) return;
    if (dir < 0 && cur.dur <= 1) return;
    const before = t.cels.map((c) => ({ ...c }));
    const end = cur.start + cur.dur;
    cur.dur += dir;
    this.shiftAfter(t, end, dir, cur);
    if (dir > 0) this.doc.anim.length = Math.max(this.doc.anim.length, ...t.cels.map((c) => c.start + c.dur));
    this.pushCels(dir > 0 ? 'Hold +' : 'Hold −', t, before);
    this.app.changed(); this.refresh();
  }
  delFrame() {
    const t = this.track(); if (!t) return;
    const cur = t.celAt(this.doc.playhead);
    if (!cur) return;
    const before = t.cels.map((c) => ({ ...c }));
    t.cels = t.cels.filter((c) => c !== cur);
    this.shiftAfter(t, cur.start + cur.dur, -cur.dur);
    this.pushCels('Delete frame', t, before);
    this.app.changed(); this.refresh();
  }
  addTrack() {
    const d = this.doc;
    if (!this.app.canAddRaster()) return;
    const t = new Track({ name: 'Track ' + (d.tracks.length + 1) });
    d.addCel(t, d.playhead, 1);
    UI.insertLayer(this.app, t);
    this.refresh();
  }

  // ── playback ──
  toggle() { this.playing ? this.stop() : this.play(); }
  play() {
    if (this.playing || !this.doc) return;
    this.app.finishTransient();
    this.playing = true; this.dir = 1;
    let last = performance.now(), acc = 0;
    const tick = (now) => {
      if (!this.playing) return;
      const d = this.doc, a = d.anim, spf = 1000 / a.fps;
      acc += now - last; last = now;
      while (acc >= spf) {
        acc -= spf;
        let f = d.playhead + this.dir;
        if (f >= a.length || f < 0) {
          if (a.loop === 'loop') f = 0;
          else if (a.loop === 'pingpong') { this.dir *= -1; f = d.playhead + this.dir; f = clamp(f, 0, a.length - 1); }
          else { this.stop(); return; }
        }
        d.playhead = f;
        if (this.recording && this.app.active && this.app.active.tool === 'move') this.app.tools.move.tick();
      }
      if (this.playheadEl) this.playheadEl.style.left = d.playhead * CELL + CELL / 2 - 1 + 'px';
      this.frameLbl.textContent = `${d.playhead + 1} / ${a.length}`;
      this.app.requestRender();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.syncHead();
  }
  stop() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.syncHead(); this.refresh(); this.app.requestRender(); this.app.updateCtxBar();
  }
  toggleRecord() {
    this.recording = !this.recording;
    if (this.recording) {
      if (this.app.tool !== 'move') this.app.setTool('move');
      toast('Perform armed: press play, then drag on the canvas — motion is recorded live');
    }
    this.syncHead();
  }

  // ── onion skin (drawn under the tracks) ──
  drawOnion(ctx) {
    const d = this.doc, o = d.anim.onion;
    if (!o.on || this.playing) return;
    const t = d.activeItem; if (!t || t.type !== 'track' || !t.visible) return;
    const cur = t.celAt(d.playhead), seen = new Set([cur]);
    const draw = (cel, color, alpha, f) => {
      if (!cel || seen.has(cel)) return;
      seen.add(cel);
      if (!this.tint || this.tint.width !== d.width || this.tint.height !== d.height) this.tint = makeCanvas(d.width, d.height);
      const x = this.tint.getContext('2d');
      x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, d.width, d.height);
      x.drawImage(cel.canvas, 0, 0);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, d.width, d.height);
      ctx.save(); ctx.globalAlpha = alpha;
      const tr = t.transformAt(f);
      if (tr.x || tr.y || tr.s !== 1 || tr.r) { const m = new DOMMatrix().translate(tr.x + d.width / 2, tr.y + d.height / 2).rotate(tr.r).scale(tr.s).translate(-d.width / 2, -d.height / 2); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); }
      ctx.drawImage(this.tint, 0, 0); ctx.restore();
    };
    let f = d.playhead, n = 0;
    while (n < o.before && f > 0) { f--; const c = t.celAt(f); if (c && !seen.has(c)) { n++; draw(c, '#e8344a', o.opacity * (1 - (n - 1) / (o.before + 1)), f); } }
    f = d.playhead; n = 0;
    while (n < o.after && f < d.anim.length - 1) { f++; const c = t.celAt(f); if (c && !seen.has(c)) { n++; draw(c, '#1fb36b', o.opacity * (1 - (n - 1) / (o.after + 1)), f); } }
  }

  onionDialog() {
    const o = this.doc.anim.onion, r = () => this.app.requestRender();
    dialog({
      title: 'Onion skin',
      body: h('div', {}, switchRow('Show onion skin', o.on, (v) => { o.on = v; this.syncHead(); r(); }),
        field('Drawings before (red)', { min: 0, max: 8, step: 1, value: o.before, fmt: (v) => v, onInput: (v) => { o.before = v; r(); } }),
        field('Drawings after (green)', { min: 0, max: 8, step: 1, value: o.after, fmt: (v) => v, onInput: (v) => { o.after = v; r(); } }),
        field('Opacity', { min: 0.05, max: 1, step: 0.01, value: o.opacity, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { o.opacity = v; r(); } })),
      actions: [{ label: 'Done', primary: true }],
    });
  }

  // ── export ──
  exportMenu(anchor) {
    const body = h('div', {},
      ...[['GIF (loops everywhere)', () => this.exportGif()], ['Video (MP4 / WebM)', () => this.exportVideo()], ['PNG frames (.zip)', () => this.exportFrames()]]
        .map(([l, fn]) => h('button', { class: 'menu-item', onclick: () => { UI.closePopover(); fn(); } }, l)));
    UI.openPopover(anchor, { title: 'Export animation', body, width: 280 });
  }

  renderFrame(f, w, hgt, bg = true) {
    const c = makeCanvas(w, hgt), x = c.getContext('2d');
    x.scale(w / this.doc.width, hgt / this.doc.height);
    if (bg && !this.doc.bgVisible) { x.fillStyle = '#fff'; x.fillRect(0, 0, this.doc.width, this.doc.height); }
    this.doc.composite(x, { frame: f });
    return c;
  }

  sizeDialog(title, defW, cb, extra) {
    const d = this.doc;
    let w = Math.min(defW, d.width);
    dialog({
      title,
      body: h('div', {}, field('Width', { min: 64, max: d.width, step: 2, value: w, fmt: (v) => `${v} × ${Math.round(v * d.height / d.width)} px`, onInput: (v) => (w = v) }), extra || ''),
      actions: [{ label: 'Cancel' }, { label: 'Export', primary: true, onClick: () => { setTimeout(() => cb(Math.round(w), Math.round(w * d.height / d.width)), 30); } }],
    });
  }

  exportGif() {
    this.stop();
    this.sizeDialog('Export GIF', 640, async (w, hgt) => {
      toast('Encoding GIF…', 20000);
      await new Promise((r) => setTimeout(r, 30));
      const a = this.doc.anim, frames = [];
      for (let f = 0; f < a.length; f++) frames.push(this.renderFrame(f, w, hgt, this.doc.bgVisible).getContext('2d').getImageData(0, 0, w, hgt));
      if (a.loop === 'pingpong') for (let f = a.length - 2; f > 0; f--) frames.push(frames[f]);
      const bytes = encodeGif(frames, Math.max(2, Math.round(100 / a.fps)), a.loop !== 'once');
      download(new Blob([bytes], { type: 'image/gif' }), (this.doc.name || 'animation') + '.gif');
      toast(`GIF exported (${(bytes.length / 1e6).toFixed(1)} MB)`);
    });
  }

  exportFrames() {
    this.stop();
    this.sizeDialog('Export PNG frames', this.doc.width, async (w, hgt) => {
      toast('Rendering frames…', 20000);
      const JSZip = await UI.loadZip(), zip = new JSZip();
      for (let f = 0; f < this.doc.anim.length; f++) zip.file(`frame_${String(f + 1).padStart(4, '0')}.png`, await canvasToBlob(this.renderFrame(f, w, hgt, false)));
      download(await zip.generateAsync({ type: 'blob' }), (this.doc.name || 'animation') + ' frames.zip');
      toast('Frames exported');
    });
  }

  exportVideo() {
    this.stop();
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast('Video export isn’t supported in this browser — use GIF or PNG frames'); return; }
    let loops = 1;
    const extra = field('Repeat', { min: 1, max: 10, step: 1, value: 1, fmt: (v) => v + '×', onInput: (v) => (loops = v) });
    this.sizeDialog('Export video', Math.min(1920, this.doc.width), async (w, hgt) => {
      w -= w % 2; hgt -= hgt % 2;
      const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
      const type = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const c = makeCanvas(w, hgt), x = c.getContext('2d');
      const a = this.doc.anim;
      const stream = c.captureStream(a.fps);
      const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      const seq = [];
      for (let l = 0; l < loops; l++) {
        for (let f = 0; f < a.length; f++) seq.push(f);
        if (a.loop === 'pingpong') for (let f = a.length - 2; f > 0; f--) seq.push(f);
      }
      const frames = seq.map((f) => this.renderFrame(f, w, hgt));
      toast(`Recording video (${(seq.length / a.fps).toFixed(1)} s)…`, seq.length / a.fps * 1000 + 2000);
      x.drawImage(frames[0], 0, 0);
      rec.start();
      const t0 = performance.now();
      await new Promise((resolve) => {
        const step = () => {
          const i = Math.floor((performance.now() - t0) / (1000 / a.fps));
          if (i >= frames.length) { resolve(); return; }
          x.drawImage(frames[i], 0, 0);
          requestAnimationFrame(step);
        };
        step();
      });
      await new Promise((r) => setTimeout(r, 200));
      rec.stop(); await done;
      const mime = rec.mimeType || type || 'video/webm';
      download(new Blob(chunks, { type: mime }), (this.doc.name || 'animation') + (mime.includes('mp4') ? '.mp4' : '.webm'));
      toast('Video exported');
    }, extra);
  }
}
