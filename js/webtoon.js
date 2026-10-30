// Webtoon / comic features: panel (frame) tool, balloon & text tool, auto layout,
// canvas extension, phone scroll preview, smart slicing export.
import { h, toast, dialog, clamp, makeCanvas, canvasToBlob, download, field, seg, switchRow, uid } from './util.js';
import { Layer } from './doc.js';
import * as UI from './ui.js';

function vecCmd(app, label, obj, key, before) {
  const after = JSON.stringify(obj[key]);
  if (after === before) return;
  app.history.push({ label, undo() { obj[key] = JSON.parse(before); app.changed(); }, redo() { obj[key] = JSON.parse(after); app.changed(); } });
}

function ensureLayer(app, type, name) {
  const d = app.doc;
  const act = d.activeItem;
  if (act && act.type === type) return act;
  let l = d.layers.find((x) => x.type === type);
  if (!l) { l = new Layer(d.width, d.height, { type, name }); UI.insertLayer(app, l, d.layers.length); }
  // make it the active layer so dragging only redraws this layer (the rest stays cached)
  d.active = d.layers.indexOf(l);
  return l;
}

const cb = (label, fn, on = false, cls = '') => h('button', { class: 'cb-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
const sep = () => h('span', { class: 'cb-sep' });

export function drawGuides(app, ctx, px) {
  const d = app.doc, sh = d.webtoon.sliceHeight;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,80,90,0.55)'; ctx.lineWidth = 1 * px; ctx.setLineDash([10 * px, 8 * px]);
  ctx.beginPath();
  for (let y = sh; y < d.height; y += sh) { ctx.moveTo(-30 * px, y); ctx.lineTo(d.width + 30 * px, y); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,80,90,0.8)'; ctx.font = `${11 * px}px -apple-system, sans-serif`;
  let i = 1;
  for (let y = 0; y < d.height; y += sh) ctx.fillText(String(i++), -24 * px, y + 14 * px);
  ctx.restore();
}

// ───────── panel tool ─────────
export function panelTool(app) {
  const t = {
    sel: -1,
    layer() { return ensureLayer(app, 'frames', 'Panels'); },
    panels() { const l = app.doc.layers.find((x) => x.type === 'frames'); return l ? l.panels : []; },
    enter() { this.sel = -1; },
    down(p) {
      const L = this.layer(), P = L.panels, hs = 18 / app.view.zoom;
      this.before = JSON.stringify(P); this.L = L; this.p0 = p;
      const s = P[this.sel];
      if (s) {
        const corners = [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
        const ci = corners.findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < hs);
        if (ci >= 0) { this.drag = { type: 'resize', ci, orig: { ...s } }; return; }
      }
      const hit = P.findIndex((q) => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h);
      if (hit >= 0) { this.sel = hit; this.drag = { type: 'move', orig: { ...P[hit] } }; app.updateCtxBar(); return; }
      this.drag = { type: 'new' };
      this.cur = { x: p.x, y: p.y, w: 0, h: 0 };
    },
    move(p) {
      const g = this.drag; if (!g) return;
      const P = this.L.panels, dx = p.x - this.p0.x, dy = p.y - this.p0.y;
      if (g.type === 'new') {
        this.cur = { x: Math.min(p.x, this.p0.x), y: Math.min(p.y, this.p0.y), w: Math.abs(dx), h: Math.abs(dy) };
      } else if (g.type === 'move') {
        Object.assign(P[this.sel], { x: Math.round(g.orig.x + dx), y: Math.round(g.orig.y + dy) });
      } else if (g.type === 'resize') {
        const o = g.orig; let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (g.ci === 0 || g.ci === 3) x0 += dx; else x1 += dx;
        if (g.ci === 0 || g.ci === 1) y0 += dy; else y1 += dy;
        Object.assign(P[this.sel], { x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(Math.abs(x1 - x0)), h: Math.round(Math.abs(y1 - y0)) });
      }
      app.requestRender('active');
    },
    up() {
      const g = this.drag; this.drag = null;
      if (!g) return;
      if (g.type === 'new') {
        const c = this.cur; this.cur = null;
        if (c.w * app.view.zoom < 12 || c.h * app.view.zoom < 12) { this.sel = -1; app.updateCtxBar(); app.requestRender(); return; }
        const d = app.doc;
        // snap horizontally to page margins when close
        const m = d.webtoon.margin ?? 0, snap = 24 / app.view.zoom;
        if (Math.abs(c.x - m) < snap) { c.w += c.x - m; c.x = m; }
        if (Math.abs(c.x + c.w - (d.width - m)) < snap) c.w = d.width - m - c.x;
        this.L.panels.push({ id: uid(), x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) });
        this.sel = this.L.panels.length - 1;
      }
      vecCmd(app, 'Panel', this.L, 'panels', this.before);
      app.changed(); app.updateCtxBar();
    },
    cancel() { this.drag = null; this.cur = null; },
    onDelete() { this.del(); },
    del() {
      const L = this.layer(); if (this.sel < 0 || !L.panels[this.sel]) return;
      const before = JSON.stringify(L.panels);
      L.panels.splice(this.sel, 1); this.sel = -1;
      vecCmd(app, 'Delete panel', L, 'panels', before); app.changed(); app.updateCtxBar();
    },
    split(dir) {
      const L = this.layer(), s = L.panels[this.sel]; if (!s) return;
      const before = JSON.stringify(L.panels), g = app.doc.webtoon.gutter;
      let a, b;
      if (dir === 'h') { const h1 = Math.round((s.h - g) / 2); a = { ...s, h: h1 }; b = { ...s, id: uid(), y: s.y + h1 + g, h: s.h - h1 - g }; }
      else { const w1 = Math.round((s.w - g / 2) / 2); a = { ...s, w: w1 }; b = { ...s, id: uid(), x: s.x + w1 + Math.round(g / 2), w: s.w - w1 - Math.round(g / 2) }; }
      if (a.w < 10 || a.h < 10 || b.w < 10 || b.h < 10) { toast('Panel too small to split'); return; }
      L.panels.splice(this.sel, 1, a, b);
      vecCmd(app, 'Split panel', L, 'panels', before); app.changed();
    },
    overlay(ctx, px) {
      const P = this.panels();
      ctx.save();
      ctx.lineWidth = 2 * px; ctx.strokeStyle = 'rgba(61,139,255,0.5)'; ctx.setLineDash([6 * px, 6 * px]);
      for (const q of P) ctx.strokeRect(q.x, q.y, q.w, q.h);
      ctx.setLineDash([]);
      const s = P[this.sel];
      if (s) {
        ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2.5 * px; ctx.strokeRect(s.x, s.y, s.w, s.h);
        for (const [x, y] of [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]]) {
          ctx.beginPath(); ctx.arc(x, y, 8 * px, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = '#3d8bff'; ctx.font = `600 ${13 * px}px -apple-system, sans-serif`;
        ctx.fillText(`${s.w} × ${s.h}`, s.x + 6 * px, s.y - 8 * px);
      }
      if (this.cur) { ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2 * px; ctx.strokeRect(this.cur.x, this.cur.y, this.cur.w, this.cur.h); }
      ctx.restore();
    },
    bar() {
      const has = this.sel >= 0 && this.panels()[this.sel];
      return [
        h('span', { class: 'cb-label' }, has ? 'Panel selected' : 'Drag to draw a panel'),
        cb('Auto layout…', () => autoPanelsDialog(app)),
        has && cb('Split ═', () => this.split('h')), has && cb('Split ║', () => this.split('v')), has && cb('Delete', () => this.del()),
        sep(), cb('Extend canvas', () => extendDialog(app)), cb('Phone preview', () => phonePreview(app)), cb('Export', () => exportSlicesDialog(app), false, 'primary'),
      ].filter(Boolean);
    },
  };
  return t;
}

export function autoPanelsDialog(app) {
  const d = app.doc, w = d.webtoon;
  const o = { count: 5, margin: w.margin ?? 40, gutter: w.gutter ?? 120, top: 200, height: 900, replace: true };
  const body = h('div', {},
    field('Panels', { min: 1, max: 20, step: 1, value: o.count, fmt: (v) => v, onInput: (v) => (o.count = v) }),
    field('Panel height', { min: 200, max: 3000, step: 10, value: o.height, fmt: (v) => v + ' px', onInput: (v) => (o.height = v) }),
    field('Gutter (vertical space between panels)', { min: 0, max: 800, step: 10, value: o.gutter, fmt: (v) => v + ' px', onInput: (v) => (o.gutter = v) }),
    field('Side margin', { min: 0, max: 300, step: 2, value: o.margin, fmt: (v) => v + ' px', onInput: (v) => (o.margin = v) }),
    field('Top margin', { min: 0, max: 1500, step: 10, value: o.top, fmt: (v) => v + ' px', onInput: (v) => (o.top = v) }),
    switchRow('Replace existing panels', o.replace, (v) => (o.replace = v)),
    h('p', {}, 'Webtoons read top-to-bottom: generous gutters create pacing. The canvas extends automatically if needed.'),
  );
  dialog({ title: 'Auto panel layout', body, actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: () => {
    w.gutter = o.gutter; w.margin = o.margin;
    const L = ensureLayer(app, 'frames', 'Panels');
    const before = JSON.stringify(L.panels);
    const start = o.replace || !L.panels.length ? o.top : Math.max(...L.panels.map((p) => p.y + p.h)) + o.gutter;
    const need = start + o.count * o.height + (o.count - 1) * o.gutter + o.top;
    if (need > d.height) {
      const ok = extendTo(app, need);
      if (!ok) return false;
    }
    const panels = o.replace ? [] : [...L.panels];
    for (let i = 0; i < o.count; i++) panels.push({ id: uid(), x: o.margin, y: start + i * (o.height + o.gutter), w: d.width - o.margin * 2, h: o.height });
    L.panels = panels;
    vecCmd(app, 'Auto layout', L, 'panels', before);
    app.changed();
  } }] });
}

function extendTo(app, newH) {
  const d = app.doc;
  newH = Math.ceil(newH / 100) * 100;
  if (d.width * newH > 16.7e6) { toast(`Max height at this width is ~${Math.floor(16.7e6 / d.width)}px (iPad limit). Split into another episode file.`, 4000); return false; }
  const bytes = d.width * newH * 4 * (d.rasterCount() + 5);
  if (bytes > app.settings.memoryMB * 1e6) { toast('Not enough memory budget for that height with this many layers — merge layers or raise the limit in Settings.', 4000); return false; }
  UI.resizeDoc(app, d.width, newH, 0, 0);
  toast(`Canvas extended to ${newH}px (undo history cleared)`);
  return true;
}

export function extendDialog(app) {
  const d = app.doc;
  let add = 1600;
  dialog({
    title: 'Extend canvas',
    body: h('div', {}, h('p', {}, `Currently ${d.width} × ${d.height}px.`), field('Add to bottom', { min: 200, max: 8000, step: 100, value: add, fmt: (v) => '+' + v + ' px', onInput: (v) => (add = v) })),
    actions: [{ label: 'Cancel' }, { label: 'Extend', primary: true, onClick: () => extendTo(app, d.height + add) || false }],
  });
}

export async function phonePreview(app) {
  const c = app.doc.flatten({ bg: true });
  const url = URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.85));
  dialog({
    title: 'Phone preview', body: h('div', {}, h('div', { class: 'phone-frame' }, h('img', { src: url })), h('p', { class: 'hint', style: { textAlign: 'center' } }, 'Scroll inside the phone to read the episode as readers will.')),
    actions: [{ label: 'Close', primary: true }], onClose: () => URL.revokeObjectURL(url),
  });
}

export function sliceCuts(height, maxH, panels, smart) {
  const cuts = [];
  let y = 0;
  while (y < height) {
    let c = Math.min(height, y + maxH);
    if (c < height && smart) {
      const inside = (yy) => panels.some((p) => yy > p.y + 1 && yy < p.y + p.h - 1);
      let best = -1;
      for (let k = c; k > y + maxH * 0.4; k--) if (!inside(k)) { best = k; break; }
      if (best > 0) {
        // centre the cut in the gutter it landed in
        let top = best; while (top > y + 1 && !inside(top - 1)) top--;
        // only centre when the gutter is bounded by a panel above (otherwise keep the slice full)
        c = top > y + maxH * 0.4 && best < c ? Math.round((best + top) / 2) : best;
      }
    }
    cuts.push([y, c]);
    y = c;
  }
  return cuts;
}

export function exportSlicesDialog(app) {
  const d = app.doc, w = d.webtoon;
  const o = { slice: w.sliceHeight, type: 'jpeg', smart: true, full: false, width: d.width };
  dialog({
    title: 'Export episode',
    body: h('div', {},
      field('Max slice height', { min: 400, max: 5000, step: 10, value: o.slice, fmt: (v) => v + ' px', onInput: (v) => { o.slice = v; w.sliceHeight = v; app.requestRender(); } }),
      field('Output width', { min: 320, max: d.width * 2, step: 10, value: o.width, fmt: (v) => v + ' px', onInput: (v) => (o.width = v) }),
      h('div', { class: 'stack' }, h('label', {}, 'Format'), seg([['jpeg', 'JPEG (smaller)'], ['png', 'PNG (lossless)']], o.type, (v) => (o.type = v))),
      switchRow("Smart cuts (don't slice through panels)", o.smart, (v) => (o.smart = v)),
      switchRow('Also include one full-length image', o.full, (v) => (o.full = v)),
      h('p', {}, 'Most platforms (e.g. WEBTOON CANVAS) accept 800px-wide images up to 1280px tall each.')),
    actions: [{ label: 'Cancel' }, { label: 'Export .zip', primary: true, onClick: async () => {
      toast('Rendering slices…', 10000);
      const full = d.flatten({ bg: true });
      const k = o.width / d.width;
      const cuts = sliceCuts(d.height, Math.floor(o.slice / k), d.panels(), o.smart);
      const JSZip = await UI.loadZip();
      const zip = new JSZip();
      const ext = o.type === 'png' ? 'png' : 'jpg';
      let i = 1;
      for (const [a, b] of cuts) {
        const c = makeCanvas(o.width, Math.round((b - a) * k));
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
        x.drawImage(full, 0, a, d.width, b - a, 0, 0, c.width, c.height);
        zip.file(`${String(i++).padStart(3, '0')}.${ext}`, await canvasToBlob(c, 'image/' + o.type, 0.92));
      }
      if (o.full) {
        const c = makeCanvas(o.width, Math.round(d.height * k));
        c.getContext('2d').drawImage(full, 0, 0, c.width, c.height);
        zip.file(`full.${ext}`, await canvasToBlob(c, 'image/' + o.type, 0.92));
      }
      download(await zip.generateAsync({ type: 'blob' }), (d.name || 'episode') + ' slices.zip');
      toast(`Exported ${cuts.length} slices`);
    } }],
  });
}

// ───────── balloon / text tool ─────────
const SHAPES = [['ellipse', 'Speech'], ['cloud', 'Thought'], ['burst', 'Shout'], ['rect', 'Box'], ['none', 'Text / SFX']];

export function balloonTool(app) {
  const t = {
    sel: null, defaults: { shape: 'ellipse', font: 'comic', fontSize: 30 },
    layer() { return ensureLayer(app, 'balloons', 'Balloons & Text'); },
    list() { const l = app.doc.layers.find((x) => x.type === 'balloons'); return l ? l.balloons : []; },
    selB() { return this.list().find((b) => b.id === this.sel); },
    enter() { this.sel = null; },
    down(p) {
      const L = this.layer(); this.L = L; this.p0 = p; this.before = JSON.stringify(L.balloons);
      const hs = 18 / app.view.zoom;
      const s = this.selB();
      if (s) {
        if (s.tail && Math.hypot(p.x - s.tail.x, p.y - s.tail.y) < hs) { this.drag = { type: 'tail', orig: { ...s.tail } }; return; }
        if (Math.hypot(p.x - (s.x + s.w), p.y - (s.y + s.h)) < hs) { this.drag = { type: 'resize', orig: { ...s } }; return; }
      }
      const hit = [...L.balloons].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
      if (hit) {
        const now = performance.now();
        if (this.sel === hit.id && now - (this.lastTap || 0) < 350) { this.drag = null; editBalloon(app, this, hit); return; }
        this.lastTap = now;
        this.sel = hit.id; this.drag = { type: 'move', orig: { ...hit, tail: hit.tail && { ...hit.tail } } };
        app.updateCtxBar();
        return;
      }
      this.drag = { type: 'new' }; this.cur = null;
    },
    move(p) {
      const g = this.drag; if (!g) return;
      const dx = p.x - this.p0.x, dy = p.y - this.p0.y, s = this.selB();
      if (g.type === 'new') this.cur = { x: Math.min(p.x, this.p0.x), y: Math.min(p.y, this.p0.y), w: Math.abs(dx), h: Math.abs(dy) };
      else if (g.type === 'move' && s) { s.x = g.orig.x + dx; s.y = g.orig.y + dy; if (s.tail) { s.tail.x = g.orig.tail.x + dx; s.tail.y = g.orig.tail.y + dy; } }
      else if (g.type === 'resize' && s) { s.w = Math.max(40, g.orig.w + dx); s.h = Math.max(30, g.orig.h + dy); }
      else if (g.type === 'tail' && s) { s.tail.x = g.orig.x + dx; s.tail.y = g.orig.y + dy; }
      app.requestRender('active');
    },
    up(p) {
      const g = this.drag; this.drag = null;
      if (!g) return;
      if (g.type === 'new') {
        const c = this.cur; this.cur = null;
        if (this.sel) { this.sel = null; app.updateCtxBar(); app.requestRender(); if (!c || c.w * app.view.zoom < 20) return; }
        const bw = c && c.w * app.view.zoom > 20 ? c.w : 320, bh = c && c.h * app.view.zoom > 20 ? c.h : 190;
        const bx = c && c.w * app.view.zoom > 20 ? c.x : p.x - bw / 2, by = c && c.h * app.view.zoom > 20 ? c.y : p.y - bh / 2;
        const shape = this.defaults.shape;
        const b = { id: uid(), x: bx, y: by, w: bw, h: bh, shape, text: '', font: this.defaults.font, fontSize: this.defaults.fontSize, fill: '#ffffff', stroke: '#000000', textColor: '#000000', lineWidth: 4,
          tail: shape === 'none' || shape === 'rect' ? null : { x: bx + bw * 0.3, y: by + bh + Math.min(120, bh * 0.6) } };
        this.L.balloons.push(b);
        this.sel = b.id;
        app.changed(); app.updateCtxBar();
        editBalloon(app, this, b, this.before);
        return;
      }
      vecCmd(app, 'Balloon', this.L, 'balloons', this.before);
      app.changed();
    },
    cancel() { this.drag = null; this.cur = null; },
    onDelete() { this.del(); },
    del() {
      const L = this.layer(); const before = JSON.stringify(L.balloons);
      L.balloons = L.balloons.filter((b) => b.id !== this.sel); this.sel = null;
      vecCmd(app, 'Delete balloon', L, 'balloons', before); app.changed(); app.updateCtxBar();
    },
    patch(o) {
      const s = this.selB();
      if (o.shape) this.defaults.shape = o.shape;
      if (o.font) this.defaults.font = o.font;
      if (!s) { app.updateCtxBar(); return; }
      const L = this.layer(), before = JSON.stringify(L.balloons);
      Object.assign(s, o);
      if (o.shape && (o.shape === 'none' || o.shape === 'rect')) { /* keep tail if user had one */ }
      vecCmd(app, 'Balloon style', L, 'balloons', before); app.changed(); app.updateCtxBar();
    },
    overlay(ctx, px) {
      const s = this.selB();
      ctx.save();
      if (this.cur) { ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.strokeRect(this.cur.x, this.cur.y, this.cur.w, this.cur.h); }
      if (s) {
        ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 1.5 * px; ctx.strokeRect(s.x, s.y, s.w, s.h);
        ctx.setLineDash([]);
        const dot = (x, y, fill) => { ctx.beginPath(); ctx.arc(x, y, 9 * px, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2 * px; ctx.stroke(); };
        dot(s.x + s.w, s.y + s.h, '#fff');
        if (s.tail) dot(s.tail.x, s.tail.y, '#ffd23f');
      }
      ctx.restore();
    },
    bar() {
      const s = this.selB();
      const shape = s ? s.shape : this.defaults.shape, font = s ? s.font : this.defaults.font;
      const items = [
        ...SHAPES.map(([v, l]) => cb(l, () => this.patch({ shape: v }), shape === v)), sep(),
        ...[['comic', 'Comic'], ['sans', 'Sans'], ['serif', 'Serif'], ['bold', 'Bold']].map(([v, l]) => cb(l, () => this.patch({ font: v }), font === v)),
      ];
      if (s) items.push(sep(),
        cb('Edit text', () => editBalloon(app, this, s)),
        cb('A−', () => this.patch({ fontSize: Math.max(8, (s.fontSize || 30) - 3) })), cb('A+', () => this.patch({ fontSize: (s.fontSize || 30) + 3 })),
        cb(s.tail ? 'Remove tail' : 'Add tail', () => this.patch({ tail: s.tail ? null : { x: s.x + s.w * 0.3, y: s.y + s.h + 90 } })),
        cb('Delete', () => this.del()));
      else items.push(sep(), h('span', { class: 'cb-label' }, 'Tap or drag on canvas to add · double-tap to edit'));
      return items;
    },
  };
  return t;
}

function editBalloon(app, tool, b, beforeOverride) {
  const L = tool.layer();
  const before = beforeOverride || JSON.stringify(L.balloons);
  const ta = h('textarea', { class: 'text-in', placeholder: 'Dialogue…' }, b.text || '');
  const fill = h('input', { type: 'color', value: b.fill || '#ffffff' });
  const stroke = h('input', { type: 'color', value: b.stroke || '#000000' });
  const tcol = h('input', { type: 'color', value: b.textColor || '#000000' });
  const upd = () => { b.text = ta.value; b.fill = fill.value; b.stroke = stroke.value; b.textColor = tcol.value; app.requestRender(); };
  for (const el of [ta, fill, stroke, tcol]) el.addEventListener('input', upd);
  const body = h('div', {}, ta,
    field('Font size', { min: 8, max: 160, step: 1, value: b.fontSize || 30, fmt: (v) => v + ' px', onInput: (v) => { b.fontSize = v; app.requestRender(); } }),
    field('Outline width', { min: 0, max: 16, step: 0.5, value: b.lineWidth ?? 4, fmt: (v) => v + ' px', onInput: (v) => { b.lineWidth = v; app.requestRender(); } }),
    h('div', { class: 'toggle-row' }, h('span', {}, 'Fill · Outline · Text'), h('span', { style: { display: 'flex', gap: '8px' } }, fill, stroke, tcol)),
    h('p', { class: 'hint' }, 'Tip: use "Text / SFX" shape for narration or sound effects — it gets an outline in the fill color.'));
  dialog({ title: 'Balloon text', body, actions: [{ label: 'Done', primary: true }], onClose: () => {
    upd();
    if (!b.text.trim() && b.shape !== 'none') b.text = '…';
    vecCmd(app, 'Balloon text', L, 'balloons', before);
    app.changed(); app.updateCtxBar();
  } });
  setTimeout(() => ta.focus(), 60);
}
