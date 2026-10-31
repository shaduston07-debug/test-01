// UI panels: popovers, sliders, color, brushes (+Brush Studio), layers, actions, adjustments,
// gallery, dialogs, and the selection / transform / move / fill tools' context bars.
import {
  $, h, uid, clamp, toast, dialog, confirmDialog, promptDialog, download, pickFile, makeCanvas, cloneCanvas,
  hsvToRgb, rgbToHsv, rgbToHex, hexToRgb, field, switchRow, seg, pct, canvasToBlob, loadImage,
} from './util.js';
import { ICONS } from './icons.js';
import { Doc, Layer, Track, BLEND_MODES, blendShort } from './doc.js';
import { snapshot, pixelCmd, withUndo, touch } from './history.js';
import { StrokeEngine } from './engine.js';
import { DEFAULT_BRUSHES, GRAINS, getTipMask, preloadBrush, newBrushFrom, strokePreviewPoints, rawImageToMaskCanvas } from './brushes.js';
import { importBrushFiles } from './importers.js';
import * as Ibis from './ibis.js';
import * as Media from './media.js';
import * as Pal from './palettes.js';
import * as Backup from './backup.js';
import * as X from './exporters.js';
import { encodeVideo, hevcSupported } from './video.js';
import { QUALITIES as TL_QUALITIES } from './timelapse.js';
import { ADJUSTMENTS, FloatingTransform, alphaBounds, wandMask, wandRegion, regionToCanvas, GRADIENT_PRESETS } from './tools.js';
import { parallelAdjust, wandRegionAsync } from './pool.js';
import * as store from './storage.js';
import * as Toon from './webtoon.js';
import { insertLayer, structCmd, openLayers, onDocChanged, closeLayerSheet } from './layers.js';
export { insertLayer, structCmd, openLayers, onDocChanged, closeLayerSheet };

// ───────── popover / floating windows ─────────
// Any panel opened with `float: true` gets a pin button that turns it into a floating
// window: draggable by its title bar, stays open while you paint, remembers its position.
let pop = null;
const floats = new Map();
export function openPopover(anchor, { title, body, width = 340, head = [], onClose, key, float = false }) {
  const k = key || title;
  if (floats.has(k)) { const f = floats.get(k).el; f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash'); return null; }
  if (pop && pop.key === k) { closePopover(); return null; }
  closePopover();
  const el = $('#popover');
  el.innerHTML = '';
  el.style.width = width + 'px';
  const headBox = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, ...head);
  if (float) headBox.append(h('button', { class: 'icon-btn', title: 'Float this panel (keeps it open while you draw)', html: PIN_ICON, onclick: () => floatify() }));
  el.append(h('div', { class: 'pop-head' }, h('h3', {}, title), headBox));
  const bodyEl = h('div', { class: 'pop-body' });
  if (body) bodyEl.append(body);
  el.append(bodyEl);
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  const W = Math.min(width, innerWidth - 16);
  const left = clamp(r.left + r.width / 2 - W / 2, 8, innerWidth - W - 8);
  el.style.left = left + 'px';
  el.style.top = (r.bottom + 12) + 'px';
  el.append(h('div', { class: 'pop-arrow', style: { left: clamp(r.left + r.width / 2 - left, 24, W - 24) + 'px' } }));
  pop = { el, anchor, onClose, key: k, body: bodyEl };
  const floatify = () => {
    const rect = el.getBoundingClientRect();
    pop = null; el.hidden = true;
    makeFloat(k, title, width, headBox, bodyEl, onClose, rect);
  };
  return pop;
}
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="13" rx="2"/><path d="M4 10h16M8 3h8"/></svg>';

function makeFloat(key, title, width, headBox, bodyEl, onClose, rect) {
  const saved = store.prefs.get('float:' + key, null);
  for (const b of headBox.querySelectorAll('[title^="Float"]')) b.remove();
  const close = h('button', { class: 'float-close', title: 'Close', onclick: () => closeFloat(key) }, '×');
  const bar = h('div', { class: 'float-head' }, h('span', { class: 'float-grip' }), h('h3', {}, title), headBox, close);
  const win = h('div', { class: 'float-win' }, bar, bodyEl);
  win.style.width = Math.min(width, innerWidth - 16) + 'px';
  const place = (x, y) => {
    const w = win.offsetWidth || width, hh = win.offsetHeight || 200;
    win.style.left = clamp(x, 4, innerWidth - w - 4) + 'px';
    win.style.top = clamp(y, 4, innerHeight - Math.min(hh, 120)) + 'px';
  };
  $('#overlay-ui').append(win);
  place(saved ? saved.x : rect.left, saved ? saved.y : rect.top);
  let st = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select')) return;
    e.preventDefault(); bar.setPointerCapture(e.pointerId);
    st = { x: e.clientX, y: e.clientY, l: win.offsetLeft, t: win.offsetTop };
    bringToFront(win);
  });
  bar.addEventListener('pointermove', (e) => { if (st) place(st.l + e.clientX - st.x, st.t + e.clientY - st.y); });
  const end = () => { if (!st) return; st = null; store.prefs.set('float:' + key, { x: win.offsetLeft, y: win.offsetTop }); };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  win.addEventListener('pointerdown', () => bringToFront(win));
  floats.set(key, { el: win, onClose });
  bringToFront(win);
}
let zTop = 15;
const bringToFront = (w) => { w.style.zIndex = ++zTop; };
export function closeFloat(key) {
  const f = floats.get(key); if (!f) return;
  floats.delete(key); f.el.remove(); f.onClose && f.onClose();
}
// open a panel directly as a floating window (e.g. the Reference companion)
export function openFloating(key, title, { width = 320, head = [], body, onClose }) {
  if (floats.has(key)) return;
  const headBox = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, ...head);
  makeFloat(key, title, width, headBox, body, onClose, { left: innerWidth - width - 90, top: 80 });
}
export const isFloating = (key) => floats.has(key);
export function closeAllFloats() { for (const k of [...floats.keys()]) closeFloat(k); }
export function closePopover() {
  if (!pop) return;
  const p = pop; pop = null;
  $('#popover').hidden = true;
  p.onClose && p.onClose();
}
document.addEventListener('pointerdown', (e) => {
  if (!pop) return;
  if (pop.el.contains(e.target) || pop.anchor.contains(e.target) || e.target.closest('.modal-bg, .side-sheet, .blend-pop, .drag-ghost, .float-win')) return;
  if (e.target.id === 'view') return; // handled by the canvas (closes too)
  closePopover();
}, true);

// ───────── sidebar vertical sliders ─────────
export function vslider(app, el, kind) {
  const knob = el.querySelector('.knob'), fill = el.querySelector('.fill');
  const bubble = $('#slider-bubble');
  const get = () => {
    const b = app.brushFor(app.paintToolName());
    if (kind === 'size') return Math.sqrt((app.getSize() - 1) / Math.max(1, b.maxSize - 1));
    return app.getOpacity();
  };
  const set = (v) => {
    const b = app.brushFor(app.paintToolName());
    if (kind === 'size') app.setSize(Math.max(1, 1 + v * v * (b.maxSize - 1)));
    else app.setOpacity(Math.max(0.01, v));
  };
  // save points of the current brush, drawn as marks on the size slider (same curve as the knob)
  const marks = kind === 'size' ? h('div', { class: 'vs-marks' }) : null;
  if (marks) el.insertBefore(marks, knob);
  let marksKey = '';
  const pointVals = () => {
    const b = app.brushFor(app.paintToolName());
    return (store.prefs.get('brushPoints', {})[app.sizeKey()] || []).map((p) => ({ size: p.size, v: Math.sqrt(Math.max(0, p.size - 1) / Math.max(1, b.maxSize - 1)) }));
  };
  const drawMarks = () => {
    if (!marks) return;
    const pts = pointVals(), key = app.sizeKey() + ':' + pts.map((p) => p.size).join(',');
    if (key === marksKey) return;
    marksKey = key; marks.innerHTML = '';
    for (const p of pts) { const v = clamp(p.v, 0, 1); marks.append(h('i', { style: { bottom: `calc(${v * 100}% - ${v * 14}px)` } })); }
  };
  const sync = () => {
    const v = clamp(get(), 0, 1);
    knob.style.bottom = `calc(${v * 100}% - ${v * 14}px)`;
    fill.style.height = v * 100 + '%';
    drawMarks();
  };
  const show = () => {
    const r = el.getBoundingClientRect();
    bubble.hidden = false;
    bubble.innerHTML = '';
    if (kind === 'size') {
      const s = app.getSize(), c = makeCanvas(108, 108), x = c.getContext('2d');
      const rr = Math.min(50, (s * app.view.zoom) / 2);
      x.fillStyle = app.color; x.beginPath(); x.arc(54, 54, Math.max(1, rr), 0, Math.PI * 2); x.fill();
      bubble.append(c, h('span', {}, Math.round(s) + ' px'));
    } else bubble.append(h('span', {}, pct(app.getOpacity())));
    const right = document.body.classList.contains('right-handed');
    bubble.style.left = right ? '' : r.right + 10 + 'px';
    bubble.style.right = right ? innerWidth - r.left + 10 + 'px' : '';
    bubble.style.top = r.top + r.height * (1 - clamp(get(), 0, 1)) - 30 + 'px';
  };
  let active = false;
  let snapped = null;
  const onPos = (e) => {
    const r = el.getBoundingClientRect();
    const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    // snap onto a save point's mark when the finger is within ~7 px of it
    const fromBottom = r.bottom - e.clientY;
    snapped = marks ? pointVals().find((p) => Math.abs(clamp(p.v, 0, 1) * (r.height - 14) - fromBottom) < 7) : null;
    if (snapped) app.setSize(snapped.size); else set(v);
    sync(); show();
    if (snapped) bubble.append(h('small', { class: 'vs-snap' }, 'Save point'));
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); active = true; el.setPointerCapture(e.pointerId); onPos(e); });
  el.addEventListener('pointermove', (e) => { if (active) onPos(e); });
  const end = () => { active = false; bubble.hidden = true; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  sync();
  return { sync };
}

// ───────── color ─────────
const DEFAULT_PALETTE = ['#000000', '#1d1d24', '#4a4a55', '#8a8a96', '#c8c8d0', '#ffffff', '#f2d6c4', '#e0ac8a', '#b5714b', '#6b3b24',
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#32ade6', '#007aff', '#5856d6', '#af52de', '#ff2d55'];

export function bindColorButton(app, btn) {
  let st = null;
  const dot = h('div', { style: { position: 'fixed', width: '34px', height: '34px', borderRadius: '50%', border: '3px solid #fff', pointerEvents: 'none', zIndex: 40, marginLeft: '-17px', marginTop: '-17px', boxShadow: '0 4px 14px rgba(0,0,0,.5)' } });
  btn.addEventListener('pointerdown', (e) => { st = { x: e.clientX, y: e.clientY, drag: false }; btn.setPointerCapture(e.pointerId); });
  btn.addEventListener('pointermove', (e) => {
    if (!st) return;
    if (!st.drag && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 16) { st.drag = true; dot.style.background = app.color; document.body.append(dot); }
    if (st.drag) { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }
  });
  btn.addEventListener('pointerup', (e) => {
    if (!st) return;
    const s = st; st = null; dot.remove();
    if (!s.drag) { openColor(app, btn); return; }
    // ColorDrop: drop the color onto the canvas to flood-fill
    const r = app.canvas.getBoundingClientRect();
    if (e.clientY > r.top + 56) {
      const p = app.screenToDoc(e.clientX - r.left, e.clientY - r.top);
      if (p.x >= 0 && p.y >= 0 && p.x < app.doc.width && p.y < app.doc.height) app.fillAt(p.x, p.y);
    }
  });
  btn.addEventListener('pointercancel', () => { st = null; dot.remove(); });
}

// Color panel: Triangle (hue ring + SV triangle), Classic square, Values, Palettes —
// with Hue / Saturation / Brightness bars underneath that work in every mode.
export function openColor(app, anchor) {
  let [hh, s, v] = rgbToHsv(...hexToRgb(app.color));
  const prev = app.color;
  let tab = store.prefs.get('colorTab', 'triangle');
  let selfSet = false;
  const body = h('div', { class: 'color-panel' });
  const head = h('div', { class: 'color-chips' });
  const chipCur = h('div', { class: 'chip-cur' }), chipPrev = h('button', { class: 'chip-prev', title: 'Previous color', onclick: () => setFromHex(prev) });
  head.append(chipPrev, chipCur);
  const tabsEl = h('div', { class: 'pop-tabs' });
  const view = h('div', { class: 'color-view' });
  const bars = h('div', { class: 'hsb-bars' });
  body.append(view, bars, tabsEl);

  const hex = () => rgbToHex(...hsvToRgb(hh, s, v));
  const commit = () => { app.setColor(hex(), true); };
  const apply = () => { selfSet = true; app.setColor(hex(), false); selfSet = false; refresh(); };
  const setFromHex = (c) => { [hh, s, v] = rgbToHsv(...hexToRgb(c)); apply(); commit(); renderTab(); };
  const drag = (el, fn) => {
    let on = false;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); on = true; el.setPointerCapture(e.pointerId); fn(e, true); });
    el.addEventListener('pointermove', (e) => on && fn(e, false));
    const end = () => { if (on) { on = false; commit(); renderSw && renderSw(); } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };

  // ── HSB bars (hue left/right, saturation, dark ↔ bright) ──
  const mkBar = (label, get, set, grad) => {
    const track = h('div', { class: 'hsb-track' }), knob = h('div', { class: 'hsb-knob' }), val = h('span', { class: 'hsb-val' });
    track.append(knob);
    drag(track, (e) => { const r = track.getBoundingClientRect(); set(clamp((e.clientX - r.left) / r.width, 0, 1)); apply(); });
    const row = h('div', { class: 'hsb-row' }, h('span', { class: 'hsb-label' }, label), track, val);
    row.sync = () => { const t = get(); knob.style.left = t * 100 + '%'; track.style.background = grad(); val.textContent = Math.round(t * (label === 'H' ? 360 : 100)) + (label === 'H' ? '°' : '%'); };
    return row;
  };
  const barH = mkBar('H', () => hh / 360, (t) => { hh = Math.min(t, 0.9999) * 360; }, () => 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)');
  const barS = mkBar('S', () => s, (t) => { s = t; }, () => `linear-gradient(90deg,${rgbToHex(...hsvToRgb(hh, 0, v))},${rgbToHex(...hsvToRgb(hh, 1, v))})`);
  const barV = mkBar('B', () => v, (t) => { v = t; }, () => `linear-gradient(90deg,#000,${rgbToHex(...hsvToRgb(hh, s, 1))})`);
  bars.append(barH, barS, barV);

  // ── triangle ──
  const TS = 280, R = TS / 2 - 2, RI = R - 24, RT = RI - 5;
  let tri = null;
  const buildTriangle = () => {
    const c = h('canvas', { class: 'color-tri', width: TS * 2, height: TS * 2 });
    const ring = makeCanvas(TS * 2, TS * 2), rx = ring.getContext('2d'), rid = rx.createImageData(TS * 2, TS * 2);
    for (let y = 0; y < TS * 2; y++) for (let x = 0; x < TS * 2; x++) {
      const dx = x / 2 - TS / 2, dy = y / 2 - TS / 2, d = Math.hypot(dx, dy);
      if (d > R + 0.5 || d < RI - 0.5) continue;
      const hue = ((Math.atan2(dy, dx) * 180 / Math.PI + 90) % 360 + 360) % 360;
      const [r, g, b] = hsvToRgb(hue, 1, 1), k = (y * TS * 2 + x) * 4;
      rid.data[k] = r; rid.data[k + 1] = g; rid.data[k + 2] = b;
      rid.data[k + 3] = 255 * clamp(Math.min(R + 0.5 - d, d - RI + 0.5), 0, 1);
    }
    rx.putImageData(rid, 0, 0);
    const verts = () => {
      const a = (hh - 90) * Math.PI / 180;
      const P = (o) => ({ x: TS / 2 + Math.cos(a + o) * RT, y: TS / 2 + Math.sin(a + o) * RT });
      return { H: P(0), W: P(2 * Math.PI / 3), B: P(4 * Math.PI / 3) };
    };
    const bary = (p, V) => {
      const { H, W, B } = V, det = (W.y - B.y) * (H.x - B.x) + (B.x - W.x) * (H.y - B.y);
      const l1 = ((W.y - B.y) * (p.x - B.x) + (B.x - W.x) * (p.y - B.y)) / det;
      const l2 = ((B.y - H.y) * (p.x - B.x) + (H.x - B.x) * (p.y - B.y)) / det;
      return [l1, l2, 1 - l1 - l2]; // weights of H, W, B
    };
    let triHue = -1, triImg = null;
    const triCanvas = makeCanvas(TS * 2, TS * 2);
    const draw = () => {
      const x = c.getContext('2d');
      x.clearRect(0, 0, TS * 2, TS * 2);
      x.drawImage(ring, 0, 0);
      const V = verts();
      if (triHue !== hh) {
        // re-shade the triangle only when the hue changes
        triImg = x.createImageData(TS * 2, TS * 2);
        const [hr, hg, hb] = hsvToRgb(hh, 1, 1), d = triImg.data;
        const x0 = Math.floor(Math.min(V.H.x, V.W.x, V.B.x) * 2), x1 = Math.ceil(Math.max(V.H.x, V.W.x, V.B.x) * 2);
        const y0 = Math.floor(Math.min(V.H.y, V.W.y, V.B.y) * 2), y1 = Math.ceil(Math.max(V.H.y, V.W.y, V.B.y) * 2);
        for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
          const [wh, ww, wb] = bary({ x: px / 2 + 0.25, y: py / 2 + 0.25 }, V);
          const edge = Math.min(wh, ww, wb);
          if (edge < -0.006) continue;
          const k = (py * TS * 2 + px) * 4;
          d[k] = hr * wh + 255 * ww; d[k + 1] = hg * wh + 255 * ww; d[k + 2] = hb * wh + 255 * ww;
          d[k + 3] = 255 * clamp(1 + edge / 0.006, 0, 1);
        }
        triHue = hh;
        triCanvas.getContext('2d').putImageData(triImg, 0, 0);
      }
      x.drawImage(triCanvas, 0, 0);
      // markers
      const a = (hh - 90) * Math.PI / 180, mr = (R + RI) / 2;
      const ring2 = (px, py, col) => { x.beginPath(); x.arc(px * 2, py * 2, 22, 0, Math.PI * 2); x.lineWidth = 6; x.strokeStyle = '#fff'; x.stroke(); x.lineWidth = 2; x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke(); };
      ring2(TS / 2 + Math.cos(a) * mr, TS / 2 + Math.sin(a) * mr);
      const wh = s * v, ww = v * (1 - s), wb = 1 - v;
      ring2(V.H.x * wh + V.W.x * ww + V.B.x * wb, V.H.y * wh + V.W.y * ww + V.B.y * wb);
    };
    let mode = null;
    drag(c, (e, first) => {
      const r = c.getBoundingClientRect(), p = { x: (e.clientX - r.left) * TS / r.width, y: (e.clientY - r.top) * TS / r.height };
      const d = Math.hypot(p.x - TS / 2, p.y - TS / 2);
      if (first) mode = d > RI - 3 ? 'ring' : 'tri';
      if (mode === 'ring') hh = ((Math.atan2(p.y - TS / 2, p.x - TS / 2) * 180 / Math.PI + 90) % 360 + 360) % 360;
      else {
        let [wh, ww, wb] = bary(p, verts());
        wh = Math.max(0, wh); ww = Math.max(0, ww); wb = Math.max(0, wb);
        const sum = wh + ww + wb || 1; wh /= sum; ww /= sum;
        v = clamp(wh + ww, 0, 1); s = v > 0 ? clamp(wh / v, 0, 1) : 0;
      }
      apply();
    });
    return { el: c, draw };
  };

  // ── classic square ──
  const buildSquare = () => {
    const sv = makeCanvas(600, 460), svDot = h('div', { class: 'color-dot' });
    const box = h('div', { class: 'color-sv' }, sv, svDot);
    const draw = () => {
      const x = sv.getContext('2d');
      x.fillStyle = rgbToHex(...hsvToRgb(hh, 1, 1)); x.fillRect(0, 0, 600, 460);
      let gr = x.createLinearGradient(0, 0, 600, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 600, 460);
      gr = x.createLinearGradient(0, 0, 0, 460); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); x.fillStyle = gr; x.fillRect(0, 0, 600, 460);
      svDot.style.left = s * 100 + '%'; svDot.style.top = (1 - v) * 100 + '%'; svDot.style.background = hex();
    };
    drag(box, (e) => { const r = box.getBoundingClientRect(); s = clamp((e.clientX - r.left) / r.width, 0, 1); v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); apply(); });
    return { el: box, draw };
  };

  // ── values ──
  const buildValues = () => {
    const box = h('div', { class: 'color-values' });
    const hexIn = h('input', { class: 'text-in', maxLength: 7 });
    hexIn.addEventListener('change', () => { const val = hexIn.value.startsWith('#') ? hexIn.value : '#' + hexIn.value; if (/^#[0-9a-f]{6}$/i.test(val)) setFromHex(val); });
    const rows = ['R', 'G', 'B'].map((ch, i) => {
      const inp = h('input', { type: 'range', min: 0, max: 255, step: 1 }), out = h('output');
      inp.addEventListener('input', () => { const rgb = hexToRgb(hex()); rgb[i] = +inp.value; [hh, s, v] = rgbToHsv(...rgb); apply(); });
      inp.addEventListener('change', commit);
      return { el: h('div', { class: 'field' }, h('label', {}, ch), out, inp), inp, out, i };
    });
    box.append(...rows.map((r) => r.el), h('div', { class: 'field' }, h('label', {}, 'Hex'), h('span'), hexIn));
    const draw = () => { const rgb = hexToRgb(hex()); for (const r of rows) { r.inp.value = rgb[r.i]; r.out.textContent = rgb[r.i]; } if (document.activeElement !== hexIn) hexIn.value = hex().toUpperCase(); };
    return { el: box, draw };
  };

  // ── palettes ──
  let renderSw = null;
  const swatchBtn = (c, onHold) => {
    const b = h('button', { style: { background: c }, title: c });
    let t = null;
    b.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; onHold && onHold(); }, 550); });
    b.addEventListener('pointerup', () => { if (t) { clearTimeout(t); t = null; setFromHex(c); } });
    b.addEventListener('pointerleave', () => { if (t) { clearTimeout(t); t = null; } });
    return b;
  };
  const pals = () => Pal.loadPalettes();
  const savePals = (list) => { Pal.savePalettes(list); renderSw && renderSw(); quick.render(); };
  const addPalette = (name, colors) => {
    const list = pals(); const pal = { id: uid(), name, colors };
    list.unshift(pal); savePals(list); return pal;
  };
  const newPaletteMenu = () => dialog({ title: 'New palette', body: h('p', { class: 'hint' }, 'Import accepts Procreate .swatches, Photoshop .aco / .ase, GIMP .gpl and lists of hex codes.'), actions: [
    { label: 'Cancel' },
    { label: 'From photo…', onClick: async () => {
      const [f] = await pickFile('image/*'); if (!f) return;
      try { addPalette(f.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Photo palette', await Pal.paletteFromImage(f, 20)); toast('Palette created from photo'); }
      catch { toast('Couldn’t read that image'); }
    } },
    { label: 'Import file…', onClick: async () => {
      const files = await pickFile(Pal.PALETTE_ACCEPT, true);
      for (const f of files) {
        try { const got = await Pal.importPaletteFile(f); for (const p of got) addPalette(p.name, p.colors); toast(`Imported ${got.length === 1 ? '“' + got[0].name + '”' : got.length + ' palettes'}`); }
        catch (e) { toast(`${f.name}: ${e.message}`, 3500); }
      }
    } },
    { label: 'From recent colors', onClick: () => { addPalette('Recent colors', [...app.colorHistory]); } },
    { label: 'Blank', primary: true, onClick: async () => { const n = await promptDialog('Palette name', 'New palette'); if (n != null) addPalette(n || 'New palette', []); } },
  ] });
  const paletteMenu = (pal) => {
    const list = pals(), i = list.findIndex((x) => x.id === pal.id);
    dialog({ title: pal.name, body: '', actions: [
      { label: 'Cancel' },
      { label: 'Delete', onClick: async () => {
        if (list.length < 2) { toast('Keep at least one palette'); return; }
        if (await confirmDialog(`Delete the palette “${pal.name}”?`, 'Delete', true)) { list.splice(i, 1); savePals(list); }
      } },
      { label: 'Share .swatches', onClick: async () => download(await Pal.exportSwatches(pal), (pal.name || 'palette').replace(/[^\w\- ]+/g, '') + '.swatches') },
      { label: 'Duplicate', onClick: () => { list.splice(i + 1, 0, { id: uid(), name: pal.name + ' copy', colors: [...pal.colors] }); savePals(list); } },
      { label: 'Rename', onClick: async () => { const n = await promptDialog('Palette name', pal.name); if (n) { list[i].name = n; savePals(list); } } },
      { label: 'Set as default', primary: true, onClick: () => { Pal.setDefaultPalette(pal.id); savePals(list); } },
    ] });
  };
  const swatchMenu = (palId, ci) => {
    const list = pals(), pal = list.find((x) => x.id === palId); if (!pal) return;
    dialog({ title: 'Swatch', body: h('div', { class: 'swatch-big', style: { background: pal.colors[ci] } }), actions: [
      { label: 'Cancel' },
      { label: 'Delete', onClick: () => { pal.colors.splice(ci, 1); savePals(list); } },
      { label: 'Replace with current', primary: true, onClick: () => { pal.colors[ci] = app.color; savePals(list); } },
    ] });
  };
  const swatchGrid = (pal) => {
    const row = h('div', { class: 'swatches' });
    pal.colors.forEach((c, ci) => row.append(swatchBtn(c, () => swatchMenu(pal.id, ci))));
    row.append(h('button', { class: 'add', title: 'Add current color', onclick: () => { const list = pals(); const p2 = list.find((x) => x.id === pal.id); p2.colors.push(app.color); savePals(list); } }, '+'));
    return row;
  };
  const buildPalettes = () => {
    const box = h('div', { class: 'palettes' });
    const histRow = h('div', { class: 'swatches' }), palBox = h('div');
    renderSw = () => {
      histRow.innerHTML = '';
      for (const c of app.colorHistory) histRow.append(swatchBtn(c));
      palBox.innerHTML = '';
      const list = pals(), def = Pal.defaultPaletteId(list);
      for (const pal of list) {
        palBox.append(h('div', { class: 'pal-head' },
          h('span', { class: 'pal-name' }, pal.name),
          pal.id === def ? h('span', { class: 'pal-default' }, 'Default') : h('button', { class: 'pal-setdef', onclick: () => { Pal.setDefaultPalette(pal.id); savePals(pals()); } }, 'Set default'),
          h('button', { class: 'pal-more', title: 'Palette options', onclick: () => paletteMenu(pal) }, '⋯')),
          swatchGrid(pal));
      }
    };
    box.append(h('div', { class: 'pal-top' }, h('div', { class: 'menu-section' }, 'History'), h('button', { class: 'pill', onclick: newPaletteMenu }, '＋ New palette')),
      histRow, h('p', { class: 'hint' }, 'Tap a swatch to use it · hold to replace or delete'), palBox);
    renderSw();
    return { el: box, draw: () => {} };
  };
  // the default palette, compact, under the other color modes (like Procreate)
  const quick = h('div', { class: 'pal-quick' });
  quick.render = () => {
    quick.innerHTML = '';
    if (tab === 'palettes') return;
    const list = pals(), pal = list.find((x) => x.id === Pal.defaultPaletteId(list));
    if (pal) quick.append(swatchGrid(pal));
  };
  body.insertBefore(quick, tabsEl);

  const builders = { triangle: buildTriangle, square: buildSquare, values: buildValues, palettes: buildPalettes };
  let cur = null;
  const renderTab = () => {
    tabsEl.innerHTML = '';
    for (const [k, l] of [['triangle', 'Triangle'], ['square', 'Classic'], ['values', 'Value'], ['palettes', 'Palettes']]) {
      tabsEl.append(h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; store.prefs.set('colorTab', k); renderTab(); } }, l));
    }
    cur = builders[tab]();
    view.innerHTML = ''; view.append(cur.el);
    quick.render();
    refresh();
  };
  let raf = 0;
  const refresh = () => {
    chipCur.style.background = hex(); chipPrev.style.background = prev;
    for (const b of [barH, barS, barV]) b.sync();
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; cur && cur.draw(); });
  };
  // keep in sync when the color changes elsewhere (eyedropper, ColorDrop…)
  const listener = (c) => { if (selfSet) return; [hh, s, v] = rgbToHsv(...hexToRgb(c)); refresh(); renderSw && renderSw(); };
  app.colorListeners.add(listener);
  renderTab();
  openPopover(anchor, { title: 'Colors', body, head: [head], width: 330, key: 'color', float: true, onClose: () => app.colorListeners.delete(listener) });
}

// ───────── brush previews ─────────
const previewEngine = new StrokeEngine();
const previewCache = new Map();
export function brushPreview(brush, w = 230, hgt = 40, color = '#ffffff') {
  const key = brush.id + '|' + (brush._v || 0) + '|' + w + '|' + color;
  let src = previewCache.get(key);
  if (!src) {
    src = makeCanvas(w * 2, hgt * 2);
    const target = { canvas: src, layer: { alphaLock: false }, scale: 1, matrix: null, toLocal: (x, y) => ({ x, y }) };
    const size = clamp(brush.size * 1.2, 6, hgt * 1.3);
    previewEngine.begin(target, brush, { kind: 'paint', color, size, opacity: 1, noUndo: true, simTaper: true });
    for (const p of strokePreviewPoints(w * 2, hgt * 2)) previewEngine.add(p);
    previewEngine.end();
    previewCache.set(key, src);
  }
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ───────── brush library ─────────
// ───────── brush library: Recent, Favorites, your own sets, then the built-in categories ─────────
const getSets = () => store.prefs.get('brushSets', []);
const putSets = (v) => store.prefs.set('brushSets', v);
const getFavs = () => store.prefs.get('brushFavs', []);
const putFavs = (v) => store.prefs.set('brushFavs', v);
let libCat = null;

export function openBrushLibrary(app, anchor) {
  const toolName = app.paintToolName();
  const byId = (id) => app.brushes.find((b) => b.id === id);
  const builtinCats = () => [...new Set(app.brushes.map((b) => b.category || 'Other'))];
  const catKeys = () => ['recent', 'fav', ...getSets().map((x) => 'set:' + x.id), ...builtinCats().map((c) => 'cat:' + c)];
  const brushesIn = (key) => {
    if (key === 'recent') return store.prefs.get('brushRecents', []).map(byId).filter(Boolean);
    if (key === 'fav') return getFavs().map(byId).filter(Boolean);
    if (key.startsWith('set:')) { const st = getSets().find((x) => 'set:' + x.id === key); return st ? st.ids.map(byId).filter(Boolean) : []; }
    return app.brushes.filter((b) => 'cat:' + (b.category || 'Other') === key);
  };
  if (!libCat || !catKeys().includes(libCat)) libCat = 'cat:' + (app.brushFor(toolName).category || builtinCats()[0]);
  const catsEl = h('div', { class: 'brush-cats' }), listEl = h('div', { class: 'brush-list' });

  const toggleFav = (b) => { const f = getFavs(); putFavs(f.includes(b.id) ? f.filter((x) => x !== b.id) : [b.id, ...f]); render(); };
  const addToSet = (b) => {
    const sets = getSets();
    dialog({ title: `Add "${b.name}" to…`, body: '', actions: [
      ...sets.map((st) => ({ label: (st.ids.includes(b.id) ? '✓ ' : '') + st.name, onClick: () => { if (!st.ids.includes(b.id)) st.ids.push(b.id); putSets(sets); toast(`Added to ${st.name}`); render(); } })),
      { label: '＋ New set…', onClick: async () => { const n = await promptDialog('New brush set', 'My set'); if (!n) return; putSets([...getSets(), { id: 's' + Date.now().toString(36), name: n, ids: [b.id] }]); toast(`Created "${n}"`); render(); } },
      { label: 'Cancel', primary: true },
    ] });
  };
  const brushMenu = (b) => {
    const inSet = libCat.startsWith('set:');
    dialog({ title: b.name, body: '', actions: [
      { label: getFavs().includes(b.id) ? '☆ Remove from Favorites' : '★ Add to Favorites', onClick: () => toggleFav(b) },
      { label: 'Add to set…', onClick: () => setTimeout(() => addToSet(b), 0) },
      inSet && { label: 'Remove from this set', onClick: () => { const sets = getSets(); const st = sets.find((x) => 'set:' + x.id === libCat); st.ids = st.ids.filter((x) => x !== b.id); putSets(sets); render(); } },
      { label: 'Edit in Brush Studio', onClick: () => { closePopover(); openBrushStudio(app, b); } },
      { label: 'Duplicate', onClick: () => { closePopover(); openBrushStudio(app, b, true); } },
      { label: 'Cancel', primary: true },
    ].filter(Boolean) });
  };
  const setMenu = (st) => {
    dialog({ title: st.name, body: '', actions: [
      { label: 'Rename', onClick: async () => { const n = await promptDialog('Rename set', st.name); if (!n) return; putSets(getSets().map((x) => (x.id === st.id ? { ...x, name: n } : x))); render(); } },
      { label: 'Delete set', danger: true, onClick: async () => { if (await confirmDialog(`Delete the set "${st.name}"? The brushes themselves stay in the library.`, 'Delete', true)) { putSets(getSets().filter((x) => x.id !== st.id)); libCat = 'fav'; render(); } } },
      { label: 'Cancel', primary: true },
    ] });
  };
  const holdable = (el, onTap, onHold) => {
    let t = null, held = false;
    el.addEventListener('pointerdown', () => { held = false; t = setTimeout(() => { held = true; navigator.vibrate && navigator.vibrate(8); onHold(); }, 480); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(t));
    el.addEventListener('click', (e) => { if (held) { e.preventDefault(); return; } onTap(e); });
  };

  const render = () => {
    catsEl.innerHTML = '';
    const label = (k) => k === 'recent' ? '🕘 Recent' : k === 'fav' ? '★ Favorites' : k.startsWith('set:') ? '◆ ' + (getSets().find((x) => 'set:' + x.id === k) || {}).name : k.slice(4);
    for (const k of catKeys()) {
      const btn = h('button', { class: (k === libCat ? 'on' : '') + (k.startsWith('set:') ? ' user-set' : '') }, label(k));
      if (k.startsWith('set:')) holdable(btn, () => { libCat = k; render(); }, () => setMenu(getSets().find((x) => 'set:' + x.id === k)));
      else btn.onclick = () => { libCat = k; render(); };
      catsEl.append(btn);
      if (k === 'fav') {
        catsEl.append(h('button', { class: 'new-set', onclick: async () => { const n = await promptDialog('New brush set', 'My set'); if (!n) return; const st = { id: 's' + Date.now().toString(36), name: n, ids: [] }; putSets([...getSets(), st]); libCat = 'set:' + st.id; render(); } }, '＋ New set'));
      }
      if (k === 'fav' || (k.startsWith('set:') && catKeys()[catKeys().indexOf(k) + 1]?.startsWith('cat:'))) catsEl.append(h('div', { class: 'cat-sep' }));
    }
    listEl.innerHTML = '';
    const cur = app.brushFor(toolName), favs = getFavs(), list = brushesIn(libCat);
    if (!list.length) listEl.append(h('p', { class: 'hint lib-empty' }, libCat === 'fav' ? 'Tap ☆ on any brush to keep it here.' : libCat === 'recent' ? 'Brushes you use show up here.' : 'Empty set — hold a brush and choose "Add to set…".'));
    for (const b of list) {
      const star = h('button', { class: 'fav-star' + (favs.includes(b.id) ? ' on' : ''), title: 'Favorite', onclick: (e) => { e.stopPropagation(); toggleFav(b); } }, favs.includes(b.id) ? '★' : '☆');
      const row = h('div', { class: 'brush-row' + (b.id === cur.id ? ' on' : ''), role: 'button' },
        h('b', {}, b.name, h('span', {}, b.source || (b.override ? 'edited' : ''))), brushPreview(b), star);
      holdable(row, (e) => {
        if (e.target === star) return;
        if (b.id === app.brushFor(toolName).id) { closePopover(); openBrushStudio(app, b); return; }
        app.setBrush(b.id, toolName); render();
      }, () => brushMenu(b));
      listEl.append(row);
    }
  };
  render();
  const head = [
    h('button', { class: 'small-btn', title: 'Import .sut (Clip Studio), .brush/.brushset (Procreate) or PNG tips', onclick: () => importBrushesFlow(app, () => { libCat = 'cat:Imported'; render(); }) }, 'Import'),
    h('button', { class: 'small-btn', onclick: () => { closePopover(); openBrushStudio(app, app.brushFor(toolName), true); } }, '＋ New'),
    h('button', { class: 'small-btn ibis', title: 'Import an ibis Paint brush QR code, or create an ibis-style brush', onclick: () => ibisMenu(app, () => { libCat = 'cat:ibis Paint'; render(); }) }, 'ibis Paint'),
  ];
  const title = { brush: 'Brush Library', smudge: 'Smudge — brush', eraser: 'Eraser — brush' }[toolName];
  openPopover(anchor, { title, body: h('div', {}, h('div', { class: 'brush-lib' }, catsEl, listEl), h('p', { class: 'hint', style: { margin: '8px 4px 0' } }, 'Tap ☆ to favorite · hold a brush for sets & options · hold a set to rename it · tap the selected brush to edit it.')), head, width: 440, key: 'brushes', float: true });
}

function ibisMenu(app, after) {
  dialog({ title: 'ibis Paint brushes', body: h('p', {}, 'In ibis Paint: open the Brush window › choose your custom brush › menu › Export Brush QR Code. Then pick that QR image here (a screenshot of a QR code works too).'), actions: [
    { label: 'Scan QR image…', primary: true, onClick: () => { closePopover(); Ibis.importIbisQR(app, after); } },
    { label: 'Create ibis-style brush', onClick: () => { closePopover(); Ibis.ibisEditor(app, {}, null, after); } },
    { label: 'Cancel' },
  ] });
}

export async function importBrushesFlow(app, after) {
  const files = await pickFile('.sut,.brush,.brushset,.abr,.png,.jpg,.jpeg,.webp', true);
  if (!files.length) return;
  toast('Importing…', 8000);
  const { brushes, notes } = await importBrushFiles(files);
  for (const b of brushes) {
    await preloadBrush(b);
    app.brushes.push(b);
    try { await store.saveBrush(b); } catch (e) { console.warn(e); }
  }
  if (brushes.length) app.setBrush(brushes[0].id, 'brush');
  toast(notes.join(' · ') || 'Nothing imported', 4500);
  after && after();
}

// ───────── Brush Studio ─────────
export function openBrushStudio(app, base, asNew = false) {
  const b = asNew ? newBrushFrom(base, { name: base.name + ' copy', category: 'My Brushes', builtin: false, override: false, source: '' }) : JSON.parse(JSON.stringify(base));
  const pad = h('canvas', { class: 'studio-pad' });
  const tipPrev = makeCanvas(128, 128);
  const bump = () => { b._v = (b._v || 0) + 1; drawTip(); };
  const drawTip = async () => {
    await preloadBrush(b);
    const x = tipPrev.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128);
    const m = getTipMask(b), r = (b.roundness || 1);
    x.save(); x.translate(64, 64); x.rotate((b.rotation || 0) * Math.PI / 180);
    x.drawImage(m, -54, -54 * r, 108, 108 * r); x.restore();
  };
  const num = (key, label, min, max, step, fmt = (v) => (+v).toFixed(2)) => field(label, { min, max, step, value: b[key] ?? 0, fmt, onInput: (v) => { b[key] = v; bump(); } });
  const sw = (key, label) => switchRow(label, !!b[key], (on) => { b[key] = on; bump(); });
  const section = (t, ...kids) => h('div', {}, h('div', { class: 'menu-section' }, t), ...kids);

  const tipSel = h('select', {}, ...[['round', 'Round (hardness)'], ['pencil', 'Pencil grain'], ['chalk', 'Chalk'], ['bristle', 'Bristles'], ['splatter', 'Splatter'], ['star', 'Sparkle'], ['image', 'Custom image']]
    .map(([v, l]) => h('option', { value: v, selected: (b.tipImage ? 'image' : b.tip || 'round') === v }, l)));
  tipSel.onchange = async () => {
    if (tipSel.value === 'image') {
      const [f] = await pickFile('image/*'); if (!f) return;
      const img = await loadImage(URL.createObjectURL(f));
      b.tipImage = rawImageToMaskCanvas(img, 'csp').toDataURL(); b.tip = 'image';
    } else { b.tip = tipSel.value; b.tipImage = null; }
    bump();
  };
  const grainSel = h('select', {}, h('option', { value: '' }, 'None'), ...GRAINS.map(([v, l]) => h('option', { value: v, selected: !b.grainImage && b.grain === v }, l)), h('option', { value: 'image', selected: !!b.grainImage }, 'Custom image…'));
  grainSel.onchange = async () => {
    if (grainSel.value === 'image') {
      const [f] = await pickFile('image/*'); if (!f) return;
      const img = await loadImage(URL.createObjectURL(f));
      b.grainImage = rawImageToMaskCanvas(img, 'procreate').toDataURL();
    } else { b.grainImage = null; b.grain = grainSel.value || null; }
    bump();
  };
  const name = h('input', { class: 'text-in', value: b.name });
  name.oninput = () => (b.name = name.value);
  const catIn = h('input', { class: 'text-in', value: b.category || 'My Brushes' });
  catIn.oninput = () => (b.category = catIn.value || 'My Brushes');

  const left = h('div', {},
    section('Stroke path', num('spacing', 'Spacing', 0.01, 2, 0.01), num('streamline', 'StreamLine (stabilizer)', 0, 0.95, 0.01), num('scatter', 'Scatter', 0, 3, 0.01), num('taper', 'Taper (finger/mouse)', 0, 1, 0.01)),
    section('Shape', h('div', { class: 'field' }, h('label', {}, 'Tip source'), h('span'), tipSel), num('hardness', 'Hardness (round tip)', 0, 1, 0.01), num('roundness', 'Roundness', 0.05, 1, 0.01), num('rotation', 'Rotation°', -180, 180, 1, (v) => Math.round(v) + '°'), num('angleJitter', 'Rotation jitter', 0, 1, 0.01), num('sizeJitter', 'Size jitter', 0, 1, 0.01), sw('follow', 'Follow stroke direction'), sw('invertTip', 'Invert shape')),
    section('Grain', h('div', { class: 'field' }, h('label', {}, 'Texture'), h('span'), grainSel), num('grainScale', 'Scale', 0.2, 5, 0.05), num('grainDepth', 'Depth', 0, 1, 0.01)),
    section('Dynamics (Apple Pencil)', num('sizePressure', 'Pressure → size', 0, 1, 0.01), num('minSize', 'Minimum size', 0, 1, 0.01), num('opacityPressure', 'Pressure → opacity', 0, 1, 0.01), num('flowPressure', 'Pressure → flow', 0, 1, 0.01), num('tiltSize', 'Tilt → size (shading)', 0, 4, 0.05), num('tiltOpacity', 'Tilt → opacity', 0, 1, 0.01),
      num('speedSize', 'Speed → thinner', 0, 1, 0.01), num('speedOpacity', 'Speed → lighter', 0, 1, 0.01), sw('taperAlways', 'Taper also with Apple Pencil')),
    section('Properties', h('div', { class: 'field' }, h('label', {}, 'Name'), h('span'), name), h('div', { class: 'field' }, h('label', {}, 'Category'), h('span'), catIn), num('flow', 'Flow (build-up)', 0.01, 1, 0.01), num('opacity', 'Default opacity', 0.01, 1, 0.01), num('maxSize', 'Max size (px)', 2, 1000, 1, (v) => Math.round(v)), num('size', 'Default size (px)', 1, 1000, 1, (v) => Math.round(v)), num('smudgeStrength', 'Smudge strength', 0, 1, 0.01)),
  );
  // drawing pad
  const padEngine = new StrokeEngine();
  let padTarget = null;
  const right = h('div', {},
    h('div', { class: 'menu-section' }, 'Drawing pad'), pad,
    h('div', { class: 'studio-tip' }, tipPrev, h('button', { class: 'small-btn', onclick: () => clearPad() }, 'Clear pad'),
      h('span', { class: 'hint' }, 'Draw here with Apple Pencil to test pressure & tilt.')),
  );
  const clearPad = () => { const x = pad.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, pad.width, pad.height); };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    const r = pad.getBoundingClientRect();
    if (pad.width !== Math.round(r.width * 2)) { pad.width = r.width * 2; pad.height = r.height * 2; clearPad(); }
    padTarget = { canvas: pad, layer: { alphaLock: false }, scale: 1, matrix: null, toLocal: (x, y) => ({ x, y }) };
    padEngine.begin(padTarget, b, { kind: 'paint', color: app.color === '#ffffff' ? '#000000' : app.color, size: Math.min(b.size, 120), opacity: b.opacity, noUndo: true, noFast: true, simTaper: e.pointerType !== 'pen' });
    padEngine.add(padPoint(e));
    drawPadPreview();
  });
  const padPoint = (e) => {
    const r = pad.getBoundingClientRect();
    let pressure = 1, tilt = 0;
    if (e.pointerType === 'pen') { pressure = e.pressure || 0.01; if (typeof e.altitudeAngle === 'number') tilt = clamp((1 - e.altitudeAngle / (Math.PI / 2) - 0.4) / 0.6, 0, 1); }
    return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2, pressure, tilt };
  };
  let rafId = 0;
  const drawPadPreview = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!padEngine.active) return;
      padEngine.updatePreview();
      const x = pad.getContext('2d');
      x.drawImage(padEngine.preview, 0, 0);
    });
  };
  pad.addEventListener('pointermove', (e) => {
    if (!padEngine.active) return;
    for (const ce of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) padEngine.add(padPoint(ce));
    drawPadPreview();
  });
  pad.addEventListener('pointerup', () => { if (padEngine.active) padEngine.end(); });

  const actions = [{ label: 'Cancel' }];
  if (b.override) actions.unshift({ label: 'Reset to default', onClick: async () => {
    const def = DEFAULT_BRUSHES.find((x) => x.id === b.id) || Ibis.IBIS_PRESETS.find((x) => x.id === b.id);
    await store.deleteBrush(b.id);
    const i = app.brushes.findIndex((x) => x.id === b.id);
    if (def && i >= 0) app.brushes[i] = { ...def, _v: Date.now() };
    toast('Brush reset');
  } });
  if (!b.builtin && !asNew) actions.unshift({ label: 'Delete', danger: true, onClick: async () => {
    if (!(await confirmDialog(`Delete "${b.name}"?`, 'Delete', true))) return false;
    await store.deleteBrush(b.id);
    app.brushes = app.brushes.filter((x) => x.id !== b.id);
    for (const k of ['brush', 'smudge', 'eraser']) if (app.toolBrush[k] === b.id) app.toolBrush[k] = DEFAULT_BRUSHES[0].id;
    app.updateSliders();
  } });
  actions.push({ label: 'Save', primary: true, onClick: async () => {
    b._v = Date.now();
    if (b.builtin) b.override = true;
    await preloadBrush(b);
    const i = app.brushes.findIndex((x) => x.id === b.id);
    if (i >= 0) app.brushes[i] = b; else app.brushes.push(b);
    try { await store.saveBrush(b); } catch (e) { toast('Could not save brush: ' + e.message); }
    app.setBrush(b.id, app.paintToolName());
    toast('Brush saved');
  } });
  dialog({ title: 'Brush Studio — ' + b.name, body: h('div', { class: 'studio-grid' }, left, right), actions, wide: true });
  requestAnimationFrame(() => {
    const r = pad.getBoundingClientRect(); pad.width = r.width * 2; pad.height = r.height * 2; clearPad(); drawTip();
  });
}

// ───────── layers ─────────
// ───────── actions ─────────
const menuItem = (icon, label, fn, extra) => h('button', { class: 'menu-item', onclick: () => { closePopover(); fn(); } }, h('span', { html: ICONS[icon] || '' }), label, extra ? h('small', {}, extra) : null);

let actionsTab = 'add';
export function openActions(app, anchor) {
  app.finishTransient();
  const d = app.doc;
  const tabs = [['add', 'Add', 'plus'], ['canvas', 'Canvas', 'canvas'], ['share', 'Share', 'share']];
  if (d.mode === 'animate') tabs.push(['anim', 'Animation', 'video']);
  if (d.mode === 'webtoon') tabs.push(['toon', 'Webtoon', 'panel']);
  tabs.push(['video', 'Video', 'video'], ['prefs', 'Prefs', 'settings'], ['help', 'Help', 'help']);
  if (!tabs.some((t) => t[0] === actionsTab)) actionsTab = 'add';
  const bar = h('div', { class: 'action-tabs' }), list = h('div');
  const pages = {
    add: () => [
      menuItem('image', 'Insert a photo', () => Media.insertPhoto(app, false)),
      menuItem('image', 'Insert a private photo', () => Media.insertPhoto(app, true), 'not in time-lapse'),
      menuItem('video', 'Insert a video frame', () => Media.insertVideoFrame(app)),
      d.mode === 'animate' && menuItem('video', 'Import video as animation', () => Media.importVideoAsAnimation(app)),
      d.mode !== 'animate' && menuItem('cube', 'Add 3D layer (model / figure)', () => app.add3DLayer()),
      menuItem('brushImport', 'Import brushes', () => importBrushesFlow(app), '.sut · .brush'),
      menuItem('brushImport', 'Import ibis Paint brush', () => Ibis.importIbisQR(app), 'QR code'),
      d.mode !== 'animate' && menuItem('pencil', 'Add text', () => app.addText('none')),
      d.mode !== 'animate' && menuItem('balloon', 'Add speech bubble', () => app.addText('ellipse')),
    ],
    canvas: () => [
      menuItem('canvas', 'Canvas size', () => resizeDialog(app), `${d.width}×${d.height}`),
      menuItem('sym', 'Flip view horizontally', () => { app.view.flip *= -1; app.fitView(); }, app.view.flip < 0 ? 'On' : ''),
      menuItem('sym', 'Drawing guide · Symmetry', () => symmetryDialog(app), app.symmetry.mode === 'off' ? '' : app.symmetry.mode),
      h('div', {}, switchRow('Reference', app.reference.open, (v) => app.reference.toggle(v))),
      menuItem('pencil', 'Rename', async () => { const n = await promptDialog('Name', d.name); if (n) { d.name = n; $('#doc-title').textContent = n; app.changed(); } }),
    ],
    share: () => [
      h('div', { class: 'menu-section' }, 'Share Image'),
      menuItem('copy', 'Inkwell', async () => download(await d.toFile(), safeName(d.name) + '.inkwell'), 'project'),
      menuItem('layers', 'PSD', () => shareFile(app, 'psd'), 'layered'),
      menuItem('share', 'PDF', () => shareFile(app, 'pdf')),
      menuItem('image', 'JPEG', () => exportImage(app, 'jpeg')),
      menuItem('image', 'PNG', () => exportImage(app, 'png')),
      menuItem('image', 'TIFF', () => shareFile(app, 'tiff')),
      h('div', { class: 'menu-section' }, d.mode === 'animate' ? 'Share Frames' : 'Share Layers'),
      menuItem('share', 'PDF', () => shareFile(app, 'layers-pdf'), 'one page each'),
      menuItem('layers', 'PNG Files', () => exportLayers(app)),
      menuItem('video', 'Animated GIF', () => shareAnimated(app, 'gif')),
      menuItem('video', 'Animated PNG', () => shareAnimated(app, 'apng')),
      menuItem('video', 'Animated MP4', () => shareAnimated(app, 'mp4')),
      menuItem('video', 'Animated HEVC', () => shareAnimated(app, 'hevc')),
      h('div', { class: 'menu-section' }, 'Time-lapse'),
      menuItem('play', 'Time-lapse Video', () => app.tlapse.exportDialog()),
    ],
    anim: () => [
      menuItem('share', 'Animated GIF', () => app.timeline.exportGif()),
      menuItem('video', 'Video (MP4 / WebM)', () => app.timeline.exportVideo()),
      menuItem('layers', 'PNG frames (.zip)', () => app.timeline.exportFrames()),
    ],
    toon: () => [
      menuItem('panel', 'Auto panel layout', () => Toon.autoPanelsDialog(app)),
      menuItem('canvas', 'Extend canvas height', () => Toon.extendDialog(app)),
      menuItem('video', 'Phone scroll preview', () => Toon.phonePreview(app)),
      menuItem('share', 'Export episode slices (.zip)', () => Toon.exportSlicesDialog(app)),
    ],
    video: () => {
      const T = app.tlapse, i = T.info();
      const q = h('select', {}, ...Object.keys(TL_QUALITIES).map((k) => h('option', { value: k, selected: i.quality === k }, k)));
      q.onchange = () => { i.quality = q.value; app.dirtySave = true; };
      return [
        menuItem('play', 'Time-lapse Replay', () => T.replay(), `${i.count} frames`),
        h('div', {}, switchRow('Record time-lapse', i.on, (v) => { i.on = v; app.dirtySave = true; if (v) T.schedule(0); })),
        menuItem('share', 'Export Time-lapse Video…', () => T.exportDialog()),
        h('div', { class: 'toggle-row' }, h('span', {}, 'Time-lapse quality'), q),
        menuItem('trash', 'Clear recording', async () => { if (await confirmDialog('Delete this canvas’s time-lapse recording?', 'Delete', true)) T.reset(); }),
        h('p', { class: 'hint', style: { padding: '0 12px' } }, 'Layers marked Private (and private photos) never appear in the time-lapse.'),
      ];
    },
    prefs: () => [
      h('div', {}, switchRow('Right-hand interface', app.settings.rightHanded, (v) => { app.settings.rightHanded = v; app.applySettings(); })),
      h('div', {}, switchRow('Reduce transparency', app.settings.solidUI, (v) => { app.settings.solidUI = v; app.applySettings(); })),
      h('div', {}, switchRow('Steady ink (pens stay solid at any pressure)', app.settings.steadyInk !== false, (v) => { app.settings.steadyInk = v; app.applySettings(); })),
      h('div', { style: { padding: '4px 12px' } }, field('Post-correction on lift', { min: 0, max: 1, step: 0.05, value: app.settings.liftAmount ?? 0, fmt: (v) => (v ? pct(v) : 'Off — as drawn'), onInput: (v) => { app.settings.liftAmount = v; app.applySettings(); } })),
      h('div', {}, switchRow('Hold to keep undoing / redoing', app.settings.holdRepeat !== false, (v) => { app.settings.holdRepeat = v; app.applySettings(); })),
      h('div', {}, switchRow('Brush cursor', app.settings.cursor, (v) => { app.settings.cursor = v; app.applySettings(); })),
      h('div', {}, switchRow('Brush cursor while painting', app.settings.cursorPaint, (v) => { app.settings.cursorPaint = v; app.applySettings(); })),
      menuItem('settings', 'All settings…', () => openSettings(app)),
    ],
    help: () => [menuItem('help', 'Gestures & shortcuts', () => helpDialog())],
  };
  const render = () => {
    bar.innerHTML = '';
    for (const [k, label, ic] of tabs) bar.append(h('button', { class: actionsTab === k ? 'on' : '', onclick: () => { actionsTab = k; render(); } }, h('span', { html: ICONS[ic] }), label));
    list.innerHTML = '';
    list.append(...pages[actionsTab]().filter(Boolean));
  };
  render();
  openPopover(anchor, { title: 'Actions', body: h('div', {}, bar, list), width: 380 });
}

async function shareFile(app, kind) {
  const d = app.doc, name = safeName(d.name);
  toast('Preparing ' + kind.replace('layers-', '').toUpperCase() + '…', 60000);
  await new Promise((r) => setTimeout(r, 30));
  try {
    if (kind === 'psd') {
      const merged = d.flatten({ bg: d.bgVisible, frame: d.playhead });
      download(X.writePSD(d.width, d.height, X.layerCanvases(d), merged), name + '.psd');
    } else if (kind === 'pdf') download(await X.writePDF([d.flatten({ bg: true, frame: d.playhead })]), name + '.pdf');
    else if (kind === 'layers-pdf') {
      const src = X.frameSource(app, 2480), pages = [];
      for (let i = 0; i < src.count; i++) pages.push(src.render(i));
      download(await X.writePDF(pages), name + ' layers.pdf');
    } else if (kind === 'tiff') download(X.writeTIFF(d.flatten({ bg: d.bgVisible, frame: d.playhead })), name + '.tiff');
    toast('Ready to share');
  } catch (e) { console.error(e); toast('Export failed: ' + e.message, 5000); }
}

function shareAnimated(app, format) {
  const d = app.doc, src = X.frameSource(app, format === 'gif' ? 960 : 1920);
  if (src.count < 2) { toast(d.mode === 'animate' ? 'Add more frames first' : 'Animated exports use each visible layer as a frame — add at least two layers'); return; }
  let fps = src.fps;
  dialog({
    title: { gif: 'Animated GIF', apng: 'Animated PNG', mp4: 'Animated MP4', hevc: 'Animated HEVC' }[format],
    body: h('div', {}, h('p', {}, `${src.count} frames${d.mode === 'animate' ? '' : ' (one per visible layer, bottom to top)'} at ${src.w}×${src.h}.`),
      field('Frames per second', { min: 1, max: 60, step: 1, value: fps, fmt: (v) => v + ' fps', onInput: (v) => (fps = v) })),
    actions: [{ label: 'Cancel' }, { label: 'Export', primary: true, onClick: () => { setTimeout(async () => {
      const name = safeName(d.name);
      toast('Rendering…', 120000);
      try {
        if (format === 'gif') {
          const { run } = await import('./pool.js'), { encodeGif } = await import('./gif.js');
          const frames = []; for (let i = 0; i < src.count; i++) frames.push(src.render(i).getContext('2d').getImageData(0, 0, src.w, src.h));
          const delay = Math.max(2, Math.round(100 / fps));
          let bytes;
          try { const bufs = frames.map((f) => f.data.slice().buffer); bytes = new Uint8Array(await run('gif', { frames: bufs, w: src.w, h: src.h, delay, loop: true }, bufs)); }
          catch { bytes = encodeGif(frames, delay, true); }
          download(new Blob([bytes], { type: 'image/gif' }), name + '.gif');
        } else if (format === 'apng') {
          const frames = []; for (let i = 0; i < src.count; i++) frames.push(src.render(i));
          download(await X.writeAPNG(frames, fps), name + '.png');
        } else {
          if (format === 'hevc' && !(await hevcSupported(src.w, src.h))) { toast('HEVC isn’t available on this device — exporting MP4 (H.264) instead', 3500); format = 'mp4'; }
          const blob = await encodeVideo({ width: src.w, height: src.h, fps, count: src.count, codec: format === 'hevc' ? 'hevc' : 'avc',
            drawFrame: (i, x) => x.drawImage(src.render(i), 0, 0, src.w - (src.w % 2), src.h - (src.h % 2)) });
          download(blob, name + (blob.type.includes('mp4') ? '.mp4' : '.webm'));
        }
        toast('Ready to share');
      } catch (e) { console.error(e); toast('Export failed: ' + e.message, 5000); }
    }, 0); } }],
  });
}

const safeName = (n) => (n || 'untitled').replace(/[^\w\- ]+/g, '').trim() || 'untitled';

async function exportImage(app, type) {
  const d = app.doc;
  const c = d.flatten({ bg: type === 'jpeg' ? true : d.bgVisible, frame: d.playhead });
  if (type === 'jpeg' && !d.bgVisible) { const x = c.getContext('2d'); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  download(await canvasToBlob(c, 'image/' + type, 0.92), safeName(d.name) + (type === 'png' ? '.png' : '.jpg'));
}

async function exportLayers(app) {
  const d = app.doc;
  const JSZip = await loadZip();
  const zip = new JSZip();
  let n = 0;
  for (const it of d.items) {
    n++;
    if (it.type === 'raster') zip.file(`${String(n).padStart(2, '0')} ${safeName(it.name)}.png`, await canvasToBlob(it.canvas));
    else if (it.type === 'track') for (const c of it.cels) zip.file(`${safeName(it.name)}/frame_${String(c.start).padStart(4, '0')}.png`, await canvasToBlob(c.canvas));
    else zip.file(`${String(n).padStart(2, '0')} ${safeName(it.name)}.png`, await canvasToBlob(d.flatten({ bg: false, filter: (x) => x === it })));
  }
  download(await zip.generateAsync({ type: 'blob' }), safeName(d.name) + ' layers.zip');
}
export async function loadZip() { const { loadScript } = await import('./util.js'); await loadScript('vendor/jszip.min.js'); return window.JSZip; }

function resizeDialog(app) {
  const d = app.doc;
  const w = h('input', { class: 'text-in', type: 'number', value: d.width }), hh = h('input', { class: 'text-in', type: 'number', value: d.height });
  let anchor = 'center';
  dialog({
    title: 'Canvas size',
    body: h('div', {}, h('div', { class: 'row2' }, h('div', {}, h('label', {}, 'Width'), w), h('div', {}, h('label', {}, 'Height'), hh)),
      h('div', { class: 'stack' }, h('label', {}, 'Anchor content'), seg([['top', 'Top'], ['center', 'Center']], anchor, (v) => (anchor = v))),
      h('p', {}, 'Changing the canvas size clears undo history.')),
    actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => {
      const W = clamp(parseInt(w.value) || d.width, 16, 16384), H = clamp(parseInt(hh.value) || d.height, 16, 16384);
      if (W * H > 16.7e6) { toast('Too large for iPad Safari (max ~16.7 megapixels)'); return false; }
      const oy = anchor === 'center' ? Math.round((H - d.height) / 2) : 0, ox = anchor === 'center' ? Math.round((W - d.width) / 2) : 0;
      resizeDoc(app, W, H, ox, oy);
    } }],
  });
}
export function resizeDoc(app, W, H, ox = 0, oy = 0) {
  const d = app.doc;
  const move = (c) => { const n = makeCanvas(W, H); n.getContext('2d').drawImage(c, ox, oy); return n; };
  for (const l of d.layers) {
    if (l.type === 'raster' || l.type === '3d') l.canvas = move(l.canvas);
    if (l.type === 'frames') for (const p of l.panels) { p.x += ox; p.y += oy; }
    if (l.type === 'balloons') for (const b of l.balloons) { b.x += ox; b.y += oy; if (b.tail) { b.tail.x += ox; b.tail.y += oy; } }
  }
  for (const t of d.tracks) for (const c of t.cels) c.canvas = move(c.canvas);
  d.width = W; d.height = H; d._tmp = [];
  app.selection = new (app.selection.constructor)(W, H);
  app.history.clear();
  app.changed(); app.fitView();
}

function symmetryDialog(app) {
  const count = field('Radial segments', { min: 2, max: 16, step: 1, value: app.symmetry.count, fmt: (v) => v, onInput: (v) => { app.symmetry.count = v; app.requestRender(); } });
  dialog({
    title: 'Symmetry (drawing guide)',
    body: h('div', {}, seg([['off', 'Off'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['quad', 'Quadrant'], ['radial', 'Radial']], app.symmetry.mode, (v) => { app.symmetry.mode = v; app.requestRender(); }), count),
    actions: [{ label: 'Done', primary: true }],
  });
}

// ───────── brush save points: remembered size + opacity per brush ─────────
const pointKey = (app) => app.sizeKey();
export function openPoints(app, anchor) {
  const all = store.prefs.get('brushPoints', {});
  const body = h('div', { class: 'points' });
  const render = () => {
    body.innerHTML = '';
    const k = pointKey(app), list = all[k] || [], b = app.brushFor(app.paintToolName());
    const cur = { size: Math.round(app.getSize() * 10) / 10, opacity: Math.round(app.getOpacity() * 100) / 100 };
    const label = (p) => `${p.size >= 10 ? Math.round(p.size) : p.size} px · ${Math.round(p.opacity * 100)}%`;
    body.append(h('p', { class: 'hint' }, b.name + ' — tap a point to go back to it, hold to delete'));
    const grid = h('div', { class: 'point-grid' });
    list.forEach((p, i) => {
      const dot = Math.max(4, Math.min(30, 4 + Math.sqrt(p.size / b.maxSize) * 26));
      const btn = h('button', { class: 'point' + (p.size === cur.size && p.opacity === cur.opacity ? ' on' : '') },
        h('i', { style: { width: dot + 'px', height: dot + 'px', opacity: Math.max(0.15, p.opacity) } }), h('span', {}, label(p)));
      let t = null;
      btn.addEventListener('pointerdown', () => { t = setTimeout(async () => { t = null; if (await confirmDialog(`Delete the save point ${label(p)}?`, 'Delete', true)) { list.splice(i, 1); all[k] = list; store.prefs.set('brushPoints', all); app.updateSliders(); render(); } }, 550); });
      btn.addEventListener('pointerup', () => { if (!t) return; clearTimeout(t); t = null; app.setSize(p.size); app.setOpacity(p.opacity); app.updateSliders(); app.showHud(label(p)); render(); });
      btn.addEventListener('pointerleave', () => { if (t) { clearTimeout(t); t = null; } });
      grid.append(btn);
    });
    if (!list.length) grid.append(h('p', { class: 'hint' }, 'No save points for this brush yet.'));
    const exists = list.some((p) => p.size === cur.size && p.opacity === cur.opacity);
    body.append(grid, h('button', { class: 'pill primary point-add', disabled: exists || list.length >= 16, onclick: () => {
      list.push(cur); list.sort((a, c) => a.size - c.size || a.opacity - c.opacity); all[k] = list; store.prefs.set('brushPoints', all); app.updateSliders(); render();
    } }, exists ? 'Current size is saved' : `＋ Save current · ${label(cur)}`));
  };
  render();
  openPopover(anchor, { title: 'Save points', body, width: 300, key: 'points', float: true });
}

// ───────── backup / restore ─────────
export function backupDialog(app) {
  let withTL = false;
  const status = h('p', { class: 'hint' }, '');
  const body = h('div', {},
    h('p', {}, 'Saves all your canvases, brushes, fonts, palettes and settings in one file. Keep it in Files (or iCloud Drive) before deleting the app, then restore it after installing.'),
    switchRow('Include time-lapse recordings (much bigger file)', false, (v) => (withTL = v)), status);
  const run = async (fn) => { try { await fn(); } catch (e) { console.error(e); status.textContent = 'Failed: ' + e.message; return false; } };
  dialog({ title: 'Backup & Restore', body, actions: [
    { label: 'Close' },
    { label: 'Restore from backup…', onClick: () => run(async () => {
      const [f] = await pickFile(Backup.BACKUP_ACCEPT); if (!f) return false;
      if (!(await confirmDialog('Restore this backup? Canvases and brushes in it are added (ones with the same name are replaced), then the app reloads.', 'Restore'))) return false;
      toast('Restoring…', 60000);
      const r = await Backup.importBackup(f, { onProgress: (m) => toast(m, 60000) });
      toast(`Restored ${r.canvases} canvas${r.canvases === 1 ? '' : 'es'} — reloading…`, 3000);
      setTimeout(() => location.reload(), 1200);
    }) },
    { label: 'Back up everything', primary: true, onClick: () => run(async () => {
      await app.saveNow(true);
      toast('Preparing backup…', 60000);
      const r = await Backup.exportBackup({ timelapse: withTL, onProgress: (m) => toast(m, 60000) });
      toast(`Backup ready: ${r.canvases} canvas${r.canvases === 1 ? '' : 'es'}, ${(r.bytes / 1e6).toFixed(1)} MB`, 4000);
    }) },
  ] });
}

export function sharePenLog(blob) {
  dialog({ title: 'Pencil recording ready', body: h('p', {}, 'Share this file so the strokes can be replayed exactly (it only contains pen positions, pressure and timing).'),
    actions: [{ label: 'Close' }, { label: 'Share recording', primary: true, onClick: () => download(blob, 'inkwell-pencil-recording.json') }] });
}

export function openSettings(app) {
  const s = app.settings;
  const save = () => app.applySettings();
  const body = h('div', {},
    h('div', { class: 'menu-section' }, 'Interface'),
    switchRow('Right-hand sidebar', s.rightHanded, (v) => { s.rightHanded = v; save(); }),
    switchRow('Reduce transparency (solid panels)', s.solidUI, (v) => { s.solidUI = v; save(); }),
    switchRow('Brush cursor (Apple Pencil hover)', s.cursor, (v) => { s.cursor = v; save(); }),
    switchRow('Brush cursor while painting', s.cursorPaint, (v) => { s.cursorPaint = v; save(); }),
    switchRow('Gestures (pinch / rotate / pan)', s.gestures, (v) => { s.gestures = v; save(); }),
    switchRow('Hold to keep undoing / redoing (2 or 3 fingers, or the undo buttons)', s.holdRepeat !== false, (v) => { s.holdRepeat = v; save(); }),
    h('button', { class: 'pill', style: { margin: '6px 6px 6px 0' }, onclick: () => { dlg.close(); backupDialog(app); } }, 'Backup & Restore…'),
    h('button', { class: 'pill', style: { margin: '6px 0' }, onclick: () => { app.recordPen = true; app.penLog = []; dlg.close(); toast('Recording: draw a few strokes with the Apple Pencil', 4000); } }, 'Record Pencil strokes (for support)…'),
    field('Rapid undo delay', { min: 0.15, max: 1.5, step: 0.05, value: s.rapidUndoDelay ?? 0.35, fmt: (v) => v.toFixed(2) + ' s', onInput: (v) => { s.rapidUndoDelay = v; save(); } }),
    h('div', { class: 'menu-section' }, 'Apple Pencil'),
    h('div', { class: 'stack' }, h('label', {}, 'Pen pressure from'),
      seg([['auto', app.penNoPressure ? 'Auto (tilt — no pressure found)' : 'Auto'], ['pressure', 'Pencil pressure'], ['tilt', 'Tilt'], ['speed', 'Speed'], ['off', 'Off']], s.pressureSource || 'auto', (v) => { s.pressureSource = v; save(); }),
      h('p', { class: 'hint' }, 'For styluses without pressure (Apple Pencil USB-C, Logitech Crayon and most other pens): Tilt — lean the pen for a thicker, darker line; Speed — slow strokes are heavier, fast ones lighter.')),
    switchRow('Steady ink — pens stay solid black at any pressure; pressure only changes the width a little', s.steadyInk !== false, (v) => { s.steadyInk = v; save(); }),
    h('div', { class: 'stack' }, h('label', {}, 'Finger behaviour'), seg([['auto', 'Auto (pencil only once detected)'], ['on', 'Pencil only'], ['off', 'Fingers draw']], s.penOnly, (v) => { s.penOnly = v; save(); })),
    field('Pressure curve (lower = softer touch)', { min: 0.3, max: 2.5, step: 0.05, value: s.pressureGamma, fmt: (v) => v.toFixed(2), onInput: (v) => { s.pressureGamma = v; save(); } }),
    switchRow('QuickShape (hold at end of a stroke)', s.quickShape, (v) => { s.quickShape = v; save(); }),
    field('Post-correction when lifting the pen (0 = keep strokes exactly as drawn)', { min: 0, max: 1, step: 0.05, value: s.liftAmount ?? 0, fmt: pct, onInput: (v) => { s.liftAmount = v; save(); } }),
    field('QuickShape delay', { min: 250, max: 1500, step: 50, value: s.quickShapeDelay, fmt: (v) => v + ' ms', onInput: (v) => { s.quickShapeDelay = v; save(); } }),
    h('div', { class: 'menu-section' }, 'Performance'),
    field('Memory budget for layers', { min: 300, max: 4000, step: 50, value: s.memoryMB, fmt: (v) => v + ' MB', onInput: (v) => { s.memoryMB = v; save(); } }),
    h('p', { class: 'hint' }, 'Sets how many layers you can add. M-series iPads start at 2000 MB (≈115 layers at 2048×2048). Drawing speed does not depend on layer count. If the app ever reloads by itself, lower this.'),
    switchRow('Autosave', s.autosave, (v) => { s.autosave = v; save(); }),
  );
  const dlg = dialog({ title: 'Settings', body, actions: [{ label: 'Done', primary: true }] });
}

function helpDialog() {
  const row = (a, b) => h('div', { class: 'toggle-row' }, h('span', {}, a), h('span', { class: 'hint' }, b));
  dialog({
    title: 'Gestures & shortcuts', wide: true,
    body: h('div', {},
      row('Two-finger tap', 'Undo — hold two fingers to keep undoing'), row('Three-finger tap', 'Redo — hold three fingers to keep redoing'), row('Four-finger tap', 'Hide / show interface'),
      row('Pinch / twist / drag with two fingers', 'Zoom, rotate, pan'), row('Quick pinch in', 'Fit canvas to screen'),
      row('Touch & hold (finger)', 'Eyedropper'), row('Hold at the end of a stroke', 'QuickShape: line, arc or ellipse. Put a finger down to snap angles / make a circle'),
      row('Drag the color dot onto the canvas', 'ColorDrop fill'), row('One finger drag (when pencil-only)', 'Pan'),
      row('Tap a selected brush', 'Open Brush Studio'), row('Tap a selected layer', 'Layer options'),
      h('div', { class: 'menu-section' }, 'Keyboard'),
      row('B / E / S', 'Brush / Eraser / Smudge'), row('V / G / I', 'Transform / Fill / Eyedropper'), row('P / T / M', 'Panel / Balloon (webtoon) · Move (animation)'),
      row('[ ]', 'Brush size'), row('⌘Z / ⇧⌘Z', 'Undo / redo'), row('Space + drag', 'Pan'), row('0 / + / −', 'Fit / zoom'), row(', .  Enter', 'Previous / next frame, play (animation)'), row('Tab', 'Hide interface')),
    actions: [{ label: 'Close', primary: true }],
  });
}

// ───────── adjustments ─────────
export function openAdjustments(app, anchor) {
  app.finishTransient();
  const body = h('div');
  for (const [k, a] of Object.entries(ADJUSTMENTS)) body.append(menuItem('adjust', a.name, () => openAdjust(app, k, anchor)));
  openPopover(anchor, { title: 'Adjustments', body, width: 330 });
}

// Gradient map editor: presets + editable colour stops (dark → light)
const cssGradient = (stops) => 'linear-gradient(90deg,' + [...stops].sort((a, b) => a[0] - b[0]).map(([p, c]) => `${c} ${Math.round(p * 100)}%`).join(',') + ')';
function gradientEditor(params, run) {
  const box = h('div', { class: 'gmap' });
  const bar = h('div', { class: 'gmap-bar' }), stopsEl = h('div', { class: 'gmap-stops' }), presets = h('div', { class: 'gmap-presets' });
  const changed = () => { store.prefs.set('gmapStops', params.stops); draw(); run(); };
  const draw = () => {
    bar.style.background = cssGradient(params.stops);
    stopsEl.innerHTML = '';
    params.stops.forEach((st, i) => {
      const col = h('input', { type: 'color', value: st[1] });
      col.oninput = () => { st[1] = col.value; changed(); };
      const pos = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: String(st[0]) });
      pos.oninput = () => { st[0] = parseFloat(pos.value); changed(); };
      const del = h('button', { class: 'icon-btn', title: 'Remove stop', onclick: () => { if (params.stops.length > 2) { params.stops.splice(i, 1); changed(); } } }, '×');
      stopsEl.append(h('div', { class: 'gmap-stop' }, col, pos, del));
    });
  };
  for (const pr of GRADIENT_PRESETS) {
    presets.append(h('button', { class: 'gmap-preset', title: pr.name, onclick: () => { params.stops = pr.stops.map((x) => [...x]); changed(); } },
      h('span', { style: { background: cssGradient(pr.stops) } }), pr.name));
  }
  box.append(h('div', { class: 'menu-section' }, 'Presets'), presets, h('div', { class: 'menu-section' }, 'Gradient (shadows → highlights)'), bar, stopsEl,
    h('div', { class: 'gmap-actions' },
      h('button', { class: 'small-btn', onclick: () => { const s2 = [...params.stops].sort((a, b) => a[0] - b[0]); params.stops.push([0.5, '#808080']); changed(); } }, '＋ Stop'),
      h('button', { class: 'small-btn', onclick: () => { params.stops = params.stops.map(([p2, c]) => [1 - p2, c]); changed(); } }, 'Reverse'),
      h('button', { class: 'small-btn', onclick: () => { params.stops = [[0, '#000000'], [0.5, '#808080'], [1, '#ffffff']]; changed(); } }, 'Reset')));
  draw();
  return box;
}

function openAdjust(app, key, anchor) {
  const adj = ADJUSTMENTS[key];
  const target = app.doc.getTarget(false);
  if (!target) { toast('Select a raster layer (or a drawing in the timeline)'); return; }
  const c = target.canvas, ctx = c.getContext('2d');
  let bb = alphaBounds(c);
  if (!bb) { toast('This layer is empty'); return; }
  const pad = key === 'blur' || key === 'sharpen' ? 64 : 0;
  const x0 = Math.max(0, bb.x - pad), y0 = Math.max(0, bb.y - pad);
  bb = { x: x0, y: y0, w: Math.min(c.width, bb.x + bb.w + pad) - x0, h: Math.min(c.height, bb.y + bb.h + pad) - y0 };
  snapshot(c);
  const orig = ctx.getImageData(bb.x, bb.y, bb.w, bb.h);
  const maskData = app.selection.active ? app.selection.mask.getContext('2d').getImageData(bb.x, bb.y, bb.w, bb.h).data : null;
  const params = Object.fromEntries(adj.params.map(([k, , , , def]) => [k, def]));
  let pending = false, done = false, busy = false, again = false, ticket = 0, applying = false;
  // runs on all worker cores in parallel bands; newest slider value wins
  const run = () => {
    if (pending) return; pending = true;
    requestAnimationFrame(async () => {
      pending = false; if (done) return;
      if (busy) { again = true; return; }
      busy = true; const my = ++ticket;
      const data = await parallelAdjust(key, { ...params, color: app.color }, orig.data, bb.w, bb.h);
      busy = false;
      if (done || my !== ticket) return;
      if (again) { again = false; run(); }
      const img = new ImageData(data, bb.w, bb.h);
      if (maskData) {
        const o = orig.data, n = img.data;
        for (let i = 0; i < n.length; i += 4) { const m = maskData[i + 3] / 255; if (m >= 1) continue; for (let k = 0; k < 4; k++) n[i + k] = o[i + k] + (n[i + k] - o[i + k]) * m; }
      }
      ctx.putImageData(img, bb.x, bb.y);
      app.requestRender();
    });
  };
  const apply = async () => {
    if (done || applying) return; applying = true;
    // let the latest preview finish on the workers before committing it
    while (busy || pending || again) await new Promise((r) => setTimeout(r, 16));
    done = true;
    const cmd = pixelCmd(c, { x: bb.x, y: bb.y, w: bb.w, h: bb.h }, adj.name, () => app.requestRender());
    if (cmd) app.history.push(cmd);
    app.changed();
  };
  const cancel = () => { if (done) return; done = true; ctx.putImageData(orig, bb.x, bb.y); app.requestRender(); };
  const body = h('div');
  for (const [k, label, min, max, def, step] of adj.params) body.append(field(label, { min, max, step, value: def, fmt: (v) => (step < 1 ? (+v).toFixed(2) : Math.round(v)), onInput: (v) => { params[k] = v; run(); } }));
  if (key === 'gradientMap') { params.stops = store.prefs.get('gmapStops', GRADIENT_PRESETS[0].stops); body.append(gradientEditor(params, run)); }
  if (!adj.params.length) body.append(h('p', { class: 'hint' }, 'Preview shown on canvas.'));
  if (app.selection.active) body.append(h('p', { class: 'hint' }, 'Limited to the current selection.'));
  const head = [h('button', { class: 'small-btn', onclick: () => { cancel(); closePopover(); } }, 'Cancel'), h('button', { class: 'small-btn on', onclick: () => { apply(); closePopover(); } }, 'Apply')];
  setTimeout(() => {
    openPopover(anchor, { title: adj.name, body, head, width: 340, key: 'adj-' + key, onClose: () => apply() });
    run();
  }, 0);
}

// ───────── tools with context bars ─────────
const cbBtn = (label, fn, on = false, cls = '') => h('button', { class: 'cb-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
const cbSep = () => h('span', { class: 'cb-sep' });

export function fillBar(app) {
  const s = app.settings;
  const rng = (label, min, max, step, key, fmt) => {
    const out = h('span', { class: 'cb-label' }, label + ' ' + fmt(s[key]));
    const r = h('input', { type: 'range', class: 'cb-range', min, max, step, value: String(s[key]) });
    r.oninput = () => { s[key] = parseFloat(r.value); out.textContent = label + ' ' + fmt(s[key]); app.applySettings(); };
    return [out, r];
  };
  const refSeg = ['layer', 'all', 'reference'].map((v) => cbBtn({ layer: 'This layer', all: 'All layers', reference: 'Reference' }[v], () => { s.fillRef = v; app.applySettings(); app.updateCtxBar(); }, s.fillRef === v));
  return [h('span', { class: 'cb-label' }, 'Reads'), ...refSeg, cbSep(), ...rng('Tolerance', 0, 1, 0.01, 'fillTolerance', pct), ...rng('Close gaps', 0, 16, 1, 'fillGap', (v) => v + 'px'), ...rng('Expand', 0, 8, 1, 'fillExpand', (v) => v + 'px')];
}

// Selection: Automatic (magic wand, drag sideways to change threshold), Freehand lasso
// (drag to draw, or tap to place polygon points — mix freely, tap the start dot to close),
// Rectangle, Ellipse. Modes: New / Add / Subtract / Intersect.
export function selectTool(app) {
  const selCmd = (label, fn) => {
    const s = app.selection, before = s.snapshot();
    fn();
    const after = s.snapshot();
    app.history.push({ label, bytes: s.w * s.h * 8, undo() { s.restore(before); app.selectionChanged(); app.updateCtxBar(); }, redo() { s.restore(after); app.selectionChanged(); app.updateCtxBar(); } });
    app.selectionChanged(); app.updateCtxBar();
  };
  const saved = (app.savedSelections ||= []);
  const t = {
    mode: store.prefs.get('selMode', 'freehand'), op: 'replace', wandRef: 'layer', wandTol: 0.2,
    poly: null, // lasso in progress: [{x,y}]
    exit() { this.poly = null; this.drag = null; this.wand = null; },
    screenDist(a, b) { const p = app.docToScreen(a.x, a.y), q = app.docToScreen(b.x, b.y); return Math.hypot(p.x - q.x, p.y - q.y); },
    down(p) {
      this.p0 = p; this.p1 = p; this.moved = false;
      if (this.mode === 'auto') { this.startWand(p); return; }
      if (this.mode === 'freehand') {
        this.fresh = !this.poly;
        if (!this.poly) this.poly = [{ x: p.x, y: p.y }];
        this.segStart = this.poly.length;
        return;
      }
      this.drag = true;
    },
    move(p) {
      this.p1 = p;
      if (Math.hypot(p.sx - this.p0.sx, p.sy - this.p0.sy) > 6) this.moved = true;
      if (this.mode === 'auto') { this.updateWand(p); return; }
      if (this.mode === 'freehand' && this.moved) {
        const last = this.poly[this.poly.length - 1];
        if (this.screenDist(last, p) > 1.5) this.poly.push({ x: p.x, y: p.y });
      }
    },
    up(p) {
      if (this.mode === 'auto') { this.finishWand(); return; }
      if (this.mode === 'freehand') {
        const poly = this.poly;
        if (this.moved) {
          // a single drag closes itself (lasso); a drag inside a polygon continues it
          const nearStart = poly.length > 3 && this.screenDist(poly[0], p) < 28;
          if (this.fresh || nearStart) this.closeLasso();
        } else {
          if (poly.length >= 3 && this.screenDist(poly[0], p) < 26) this.closeLasso();
          else if (!this.fresh) poly.push({ x: p.x, y: p.y });
          else app.showHud('Tap to add points · tap the first point to close', 1800);
        }
        app.updateCtxBar(); app.requestRender('view');
        return;
      }
      this.drag = false;
      if (!this.moved) { app.requestRender('view'); return; }
      const sh = this.shape();
      selCmd('Select', () => app.selection.apply(sh, this.op));
    },
    cancel() { this.drag = false; if (this.mode === 'freehand' && this.fresh) this.poly = null; this.wand = null; },
    closeLasso() {
      const pts = this.poly; this.poly = null;
      if (!pts || pts.length < 3) { app.updateCtxBar(); return; }
      selCmd('Lasso', () => app.selection.apply({ type: 'poly', pts }, this.op));
    },
    shape() {
      const a = this.p0, b = this.p1;
      if (this.mode === 'rect') return { type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      return { type: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 };
    },
    // ── automatic ──
    startWand(p) {
      const d = app.doc;
      let ref;
      if (this.wandRef === 'layer') {
        const tg = d.getTarget(false);
        if (tg && !tg.matrix) ref = tg.canvas;
      }
      if (!ref) ref = d.flatten({ bg: false });
      this.wand = { ref: ref.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, ref.width, ref.height), seed: p, tol: this.wandTol, mask: null, pending: false };
      this.computeWand();
    },
    updateWand(p) {
      const w = this.wand; if (!w) return;
      w.tol = clamp(this.wandTol + (p.sx - this.p0.sx) / 500, 0, 1);
      app.showHud('Threshold ' + Math.round(w.tol * 100) + '%  ·  slide left / right', 900);
      if (!w.pending) { w.pending = true; requestAnimationFrame(() => { w.pending = false; if (this.wand === w) this.computeWand(); }); }
    },
    async computeWandFinal(w) {
      const region = await wandRegionAsync(w.ref.data, w.ref.width, w.ref.height, w.seed.x, w.seed.y, w.tol);
      w.mask = regionToCanvas(region, w.ref.width, w.ref.height, null, null); w.lastTol = w.tol;
    },
    async computeWand() {
      const w = this.wand;
      const my = (w.ticket = (w.ticket || 0) + 1), tol = w.tol;
      w.busy = true;
      const region = await wandRegionAsync(w.ref.data, w.ref.width, w.ref.height, w.seed.x, w.seed.y, tol);
      w.busy = false;
      if (this.wand !== w && !w.finishing) return;
      if (my !== w.ticket) return;
      w.mask = regionToCanvas(region, w.ref.width, w.ref.height, null, null); w.lastTol = tol;
      const tint = makeCanvas(w.mask.width, w.mask.height), x = tint.getContext('2d');
      x.drawImage(w.mask, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = 'rgba(61,139,255,0.45)'; x.fillRect(0, 0, tint.width, tint.height);
      w.tint = tint;
      app.requestRender('view');
    },
    async finishWand() {
      const w = this.wand; this.wand = null;
      if (!w) return;
      w.finishing = true;
      while (w.busy) await new Promise((r) => setTimeout(r, 16));
      if (Math.abs((w.lastTol ?? w.tol) - w.tol) > 1e-6 || !w.mask) await this.computeWandFinal(w);
      if (!w.mask) return;
      this.wandTol = w.tol;
      selCmd('Automatic select', () => app.selection.applyMask(w.mask, this.op));
    },
    overlay(ctx, px) {
      ctx.save();
      if (this.wand && this.wand.tint) ctx.drawImage(this.wand.tint, 0, 0);
      ctx.lineWidth = 1.6 * px; ctx.lineJoin = 'round';
      if (this.poly) {
        const pts = this.poly;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const q of pts) ctx.lineTo(q.x, q.y);
        const hover = app.hover && !this.moved ? app.hover : null;
        if (hover) ctx.lineTo(hover.x, hover.y);
        ctx.strokeStyle = '#fff'; ctx.setLineDash([]); ctx.lineWidth = 3 * px; ctx.stroke();
        ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 1.6 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.stroke();
        ctx.setLineDash([]);
        // start point: tap it to close
        ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, (pts.length >= 3 ? 11 : 7) * px, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 2.5 * px; ctx.stroke();
        for (const q of pts.length < 200 ? pts.slice(1) : []) { ctx.beginPath(); ctx.arc(q.x, q.y, 2.5 * px, 0, Math.PI * 2); ctx.fillStyle = '#3d8bff'; ctx.fill(); }
      } else if (this.drag && this.moved) {
        const sh = this.shape();
        ctx.strokeStyle = '#3d8bff'; ctx.setLineDash([6 * px, 4 * px]);
        ctx.beginPath();
        if (sh.type === 'rect') ctx.rect(sh.x, sh.y, sh.w, sh.h); else ctx.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    },
    onDelete() { clearSelected(); },
    bar() {
      const S = app.selection, act = S.active;
      if (this.poly) {
        return [h('span', { class: 'cb-label' }, `Lasso · ${this.poly.length} point${this.poly.length === 1 ? '' : 's'} · tap the start dot to close`),
          cbBtn('Close ✓', () => this.closeLasso(), false, 'primary'),
          cbBtn('Undo point', () => { this.poly.pop(); if (!this.poly.length) this.poly = null; app.updateCtxBar(); app.requestRender('view'); }),
          cbBtn('Cancel', () => { this.poly = null; app.updateCtxBar(); app.requestRender('view'); })];
      }
      const setMode = (v) => { t.mode = v; store.prefs.set('selMode', v); app.updateCtxBar(); };
      const items = [
        ...[['auto', 'Automatic'], ['freehand', 'Freehand'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']].map(([v, l]) => cbBtn(l, () => setMode(v), t.mode === v)),
        cbSep(),
        ...[['replace', 'New'], ['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']].map(([v, l]) => cbBtn(l, () => { t.op = v; app.updateCtxBar(); }, t.op === v)),
      ];
      if (t.mode === 'auto') items.push(cbSep(), h('span', { class: 'cb-label' }, 'Reads'),
        cbBtn('Layer', () => { t.wandRef = 'layer'; app.updateCtxBar(); }, t.wandRef === 'layer'),
        cbBtn('All layers', () => { t.wandRef = 'all'; app.updateCtxBar(); }, t.wandRef === 'all'));
      items.push(cbSep(),
        cbBtn('All', () => selCmd('Select all', () => S.selectAll())),
        cbBtn('Invert', () => selCmd('Invert selection', () => S.invert())),
        act && cbBtn('Feather…', () => featherDialog()),
        act && cbBtn('Save', () => { saved.push(S.snapshot()); toast(`Selection saved (${saved.length})`); app.updateCtxBar(); }),
        saved.length && cbBtn(`Load (${saved.length})`, () => loadDialog()),
        act && cbBtn('Deselect', () => selCmd('Deselect', () => S.clear())),
        act && cbSep(),
        act && cbBtn('Copy & Paste', () => copyToLayer(false)),
        act && cbBtn('Cut & Paste', () => copyToLayer(true)),
        act && cbBtn('Color fill', () => fillSelected()),
        act && cbBtn('Clear', () => clearSelected()),
        act && cbBtn('Transform', () => app.setTool('transform')));
      return items.filter(Boolean);
    },
  };
  const featherDialog = () => {
    let r = 8;
    dialog({ title: 'Feather selection', body: field('Feather', { min: 1, max: 100, step: 1, value: r, fmt: (v) => v + ' px', onInput: (v) => (r = v) }),
      actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => selCmd('Feather', () => app.selection.feather(r)) }] });
  };
  const loadDialog = () => {
    dialog({ title: 'Load selection', body: '', actions: [
      ...saved.map((snap, i) => ({ label: 'Selection ' + (i + 1), onClick: () => selCmd('Load selection', () => app.selection.restore(snap)) })),
      { label: 'Clear saved', danger: true, onClick: () => { saved.length = 0; app.updateCtxBar(); } },
      { label: 'Cancel', primary: true },
    ] });
  };
  const curCanvas = () => { const tg = app.doc.getTarget(false); if (!tg) toast('Select a raster layer'); return tg && tg.canvas; };
  const clearSelected = () => {
    const c = curCanvas(); if (!c || !app.selection.active) return;
    withUndo(app.history, c, 'Clear selection', (x) => { x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(app.selection.mask, 0, 0); x.restore(); }, () => app.requestRender());
    app.changed();
  };
  const fillSelected = () => {
    const c = curCanvas(); if (!c) return;
    const tmp = makeCanvas(c.width, c.height), tx = tmp.getContext('2d');
    tx.fillStyle = app.color; tx.fillRect(0, 0, c.width, c.height);
    tx.globalCompositeOperation = 'destination-in'; tx.drawImage(app.selection.mask, 0, 0);
    withUndo(app.history, c, 'Fill selection', (x) => x.drawImage(tmp, 0, 0), () => app.requestRender());
    app.changed();
  };
  const copyToLayer = (cut) => {
    const d = app.doc;
    if (d.mode === 'animate') { toast('Use Transform to move parts of a drawing in animation mode'); return; }
    const c = curCanvas(); if (!c || !app.canAddRaster()) return;
    const l = new Layer(d.width, d.height, { name: cut ? 'Cut' : 'Copy', panelMask: d.mode === 'webtoon' });
    const x = l.canvas.getContext('2d');
    x.drawImage(c, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(app.selection.mask, 0, 0);
    if (cut) clearSelected();
    insertLayer(app, l);
    toast(cut ? 'Cut to a new layer' : 'Copied to a new layer');
  };
  return t;
}

export function transformTool(app) {
  const HANDLE = 22;
  const t = {
    uniform: true,
    enter() {
      this.entered = true;
      const tg = app.doc.getTarget(false);
      if (!tg) { toast('Select a raster layer to transform'); return; }
      snapshot(tg.canvas);
      app.transform = new FloatingTransform(tg, app.selection);
      app.requestRender(); app.updateCtxBar();
    },
    exit() { if (app.transform) this.commit(); this.entered = false; },
    toDoc(pt) { const T = app.transform; return T.target.matrix ? T.target.matrix.transformPoint(pt) : pt; },
    handles() {
      const T = app.transform;
      const cs = T.corners().map((p) => this.toDoc(p));
      const sc = cs.map((p) => app.docToScreen(p.x, p.y));
      const mid = { x: (sc[0].x + sc[1].x) / 2, y: (sc[0].y + sc[1].y) / 2 };
      const cen = { x: sc.reduce((a, p) => a + p.x, 0) / 4, y: sc.reduce((a, p) => a + p.y, 0) / 4 };
      const L = Math.hypot(mid.x - cen.x, mid.y - cen.y) || 1;
      const rot = { x: mid.x + (mid.x - cen.x) / L * 40, y: mid.y + (mid.y - cen.y) / L * 40 };
      return { sc, rot, cen };
    },
    down(p) {
      if (!app.transform) { this.enter(); if (!app.transform) return false; }
      const T = app.transform, hd = this.handles();
      const local = T.target.toLocal(p.x, p.y);
      let type = 'move', corner = -1;
      if (Math.hypot(p.sx - hd.rot.x, p.sy - hd.rot.y) < HANDLE) type = 'rotate';
      else hd.sc.forEach((c, i) => { if (Math.hypot(p.sx - c.x, p.sy - c.y) < HANDLE) { type = 'scale'; corner = i; } });
      this.drag = { type, corner, l0: local, s0: { tx: T.tx, ty: T.ty, sx: T.sx, sy: T.sy, rot: T.rot } };
    },
    move(p) {
      const T = app.transform, g = this.drag; if (!T || !g) return;
      const l = T.target.toLocal(p.x, p.y), s0 = g.s0;
      const C = { x: T.center.x + s0.tx, y: T.center.y + s0.ty };
      if (g.type === 'move') { T.tx = s0.tx + l.x - g.l0.x; T.ty = s0.ty + l.y - g.l0.y; }
      else if (g.type === 'scale') {
        if (this.uniform) {
          const k = Math.hypot(l.x - C.x, l.y - C.y) / (Math.hypot(g.l0.x - C.x, g.l0.y - C.y) || 1);
          T.sx = s0.sx * k; T.sy = s0.sy * k;
        } else {
          const a = -s0.rot * Math.PI / 180, rotP = (q) => ({ x: (q.x - C.x) * Math.cos(a) - (q.y - C.y) * Math.sin(a), y: (q.x - C.x) * Math.sin(a) + (q.y - C.y) * Math.cos(a) });
          const u = rotP(l), u0 = rotP(g.l0);
          if (Math.abs(u0.x) > 1) T.sx = s0.sx * u.x / u0.x;
          if (Math.abs(u0.y) > 1) T.sy = s0.sy * u.y / u0.y;
        }
      } else if (g.type === 'rotate') {
        let r = s0.rot + (Math.atan2(l.y - C.y, l.x - C.x) - Math.atan2(g.l0.y - C.y, g.l0.x - C.x)) * 180 / Math.PI;
        const sn = Math.round(r / 15) * 15; if (Math.abs(r - sn) < 3) r = sn;
        T.rot = r;
        app.showHud(Math.round(((r % 360) + 360) % 360) + '°');
      }
      T.update(); app.requestRender('active');
    },
    up() { this.drag = null; },
    commit() {
      const T = app.transform; if (!T) return;
      T.commit();
      app.transform = null;
      const cmd = pixelCmd(T.target.canvas, null, 'Transform', () => app.requestRender());
      if (cmd) app.history.push(cmd);
      if (app.selection.active) { app.selection.clear(); app.selectionChanged(); }
      app.changed();
    },
    cancel() {
      const T = app.transform; if (!T) return;
      T.cancel(); app.transform = null; app.requestRender();
      app.setTool(app.prevTool && app.prevTool !== 'transform' ? app.prevTool : 'brush');
    },
    overlay(ctx, px) {
      const T = app.transform; if (!T) return;
      const cs = T.corners().map((q) => this.toDoc(q));
      ctx.save();
      ctx.lineWidth = 1.5 * px; ctx.strokeStyle = '#3d8bff';
      ctx.beginPath(); cs.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
      ctx.restore();
    },
    overlayScreen(ctx) {
      if (!app.transform) return;
      const hd = this.handles();
      ctx.save();
      ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo((hd.sc[0].x + hd.sc[1].x) / 2, (hd.sc[0].y + hd.sc[1].y) / 2); ctx.lineTo(hd.rot.x, hd.rot.y); ctx.stroke();
      for (const c of [...hd.sc, hd.rot]) {
        ctx.beginPath(); ctx.arc(c.x, c.y, c === hd.rot ? 9 : 8, 0, Math.PI * 2);
        ctx.fillStyle = c === hd.rot ? '#3d8bff' : '#fff'; ctx.fill(); ctx.strokeStyle = '#3d8bff'; ctx.stroke();
      }
      ctx.restore();
    },
    bar() {
      const T = app.transform;
      const upd = () => { if (app.transform) { app.transform.update(); app.requestRender(); } };
      return [
        cbBtn('Uniform', () => { t.uniform = true; app.updateCtxBar(); }, t.uniform),
        cbBtn('Freeform', () => { t.uniform = false; app.updateCtxBar(); }, !t.uniform), cbSep(),
        cbBtn('Flip H', () => { if (T) { T.flipX *= -1; upd(); } }), cbBtn('Flip V', () => { if (T) { T.flipY *= -1; upd(); } }),
        cbBtn('Rotate 90°', () => { if (T) { T.rot = (T.rot + 90) % 360; upd(); } }),
        cbBtn('Fit to canvas', () => {
          if (!T) return; const d = app.doc, b = T.bbox, k = Math.min(d.width / b.w, d.height / b.h);
          T.sx = T.sy = k; T.rot = 0; T.tx = d.width / 2 - T.center.x; T.ty = d.height / 2 - T.center.y; upd();
        }),
        cbBtn('Reset', () => { if (T) { Object.assign(T, { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, flipX: 1, flipY: 1 }); upd(); } }),
        cbBtn(T && !T.smooth ? 'Nearest' : 'Bilinear', () => { if (T) { T.smooth = !T.smooth; upd(); app.updateCtxBar(); } }),
        cbSep(), cbBtn('Cancel', () => t.cancel()), cbBtn('Done', () => { t.commit(); app.setTool(app.prevTool && app.prevTool !== 'transform' ? app.prevTool : 'brush'); }, false, 'primary'),
      ];
    },
  };
  return t;
}

// Animation: drag the active track; with Perform armed + playing, motion is recorded live.
export function moveTool(app) {
  const t = {
    down(p) {
      const tr = app.doc.activeItem;
      if (!tr || tr.type !== 'track') return false;
      this.track = tr; this.p0 = p; this.last = p;
      this.t0 = { ...tr.transformAt(app.doc.playhead) };
      this.before = JSON.stringify(tr.keys);
      this.dragging = true;
      this.apply();
    },
    apply() {
      const f = app.doc.playhead, tr = this.track;
      tr.setKey(f, { ...tr.transformAt(f), x: this.t0.x + this.last.x - this.p0.x, y: this.t0.y + this.last.y - this.p0.y });
      app.requestRender('active');
    },
    tick() { if (this.dragging) this.apply(); },
    move(p) { this.last = p; this.apply(); },
    up() {
      this.dragging = false;
      const tr = this.track, before = this.before, after = JSON.stringify(tr.keys);
      if (before !== after) app.history.push({ label: 'Motion', undo() { tr.keys = JSON.parse(before); app.changed(); }, redo() { tr.keys = JSON.parse(after); app.changed(); } });
      app.changed(); app.updateCtxBar();
    },
    cancel() { this.dragging = false; },
    bar() {
      const tr = app.doc.activeItem;
      if (!tr || tr.type !== 'track') return [h('span', { class: 'cb-label' }, 'Select a track')];
      const f = app.doc.playhead, cur = tr.transformAt(f);
      const setKey = (patch) => {
        const before = JSON.stringify(tr.keys);
        tr.setKey(f, { ...tr.transformAt(f), ...patch });
        const after = JSON.stringify(tr.keys);
        app.history.push({ label: 'Key', undo() { tr.keys = JSON.parse(before); app.changed(); }, redo() { tr.keys = JSON.parse(after); app.changed(); } });
        app.changed();
      };
      const rng = (label, min, max, step, key, fmt) => {
        const out = h('span', { class: 'cb-label' }, label + ' ' + fmt(cur[key]));
        const r = h('input', { type: 'range', class: 'cb-range', min, max, step, value: String(cur[key]) });
        r.oninput = () => { tr.setKey(f, { ...tr.transformAt(f), [key]: parseFloat(r.value) }); out.textContent = label + ' ' + fmt(parseFloat(r.value)); app.requestRender(); };
        r.onchange = () => app.changed();
        return [out, r];
      };
      const key = tr.keys.find((k) => k.f === f);
      return [
        h('span', { class: 'cb-label' }, 'Drag canvas to move · arm ● Perform & play to record'),
        ...rng('Scale', 0.1, 4, 0.01, 's', (v) => Math.round(v * 100) + '%'),
        ...rng('Rotate', -360, 360, 1, 'r', (v) => Math.round(v) + '°'),
        ...rng('Opacity', 0, 1, 0.01, 'o', pct), cbSep(),
        ...['smooth', 'linear', 'hold'].map((e) => cbBtn(e[0].toUpperCase() + e.slice(1), () => setKey({ ease: e }), key && key.ease === e)),
        cbSep(),
        cbBtn('◆ Key', () => setKey({})),
        key && cbBtn('Delete key', () => { const before = JSON.stringify(tr.keys); tr.keys = tr.keys.filter((k) => k.f !== f); const after = JSON.stringify(tr.keys); app.history.push({ label: 'Delete key', undo() { tr.keys = JSON.parse(before); app.changed(); }, redo() { tr.keys = JSON.parse(after); app.changed(); } }); app.changed(); app.updateCtxBar(); }),
        cbBtn('Clear motion', () => { const before = JSON.stringify(tr.keys); tr.keys = []; app.history.push({ label: 'Clear motion', undo() { tr.keys = JSON.parse(before); app.changed(); }, redo() { tr.keys = []; app.changed(); } }); app.changed(); app.updateCtxBar(); }),
      ].filter(Boolean);
    },
  };
  return t;
}

// ───────── gallery ─────────
let thumbURLs = [];
// ───────── gallery folders (Procreate-style stacks) ─────────
// Folders live in prefs; each canvas's gallery entry (meta) records its folder id.
const getFolders = () => store.prefs.get('folders', []);
const setFolders = (f) => store.prefs.set('folders', f);
async function newFolder(name) {
  const f = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || 'Folder', created: Date.now() };
  setFolders([...getFolders(), f]);
  return f;
}
async function moveToFolder(app, m, folderId) {
  m.folder = folderId || null;
  await store.saveMeta(m);
  if (app.doc && app.doc.id === m.id) app.doc.folder = m.folder;
}

export async function renderGallery(app) {
  const grid = $('#gal-grid'), crumb = $('#gal-crumb');
  // free the previous render's thumbnails once the new ones have had time to load
  const old = thumbURLs; setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 3000);
  thumbURLs = [];
  let metas = [];
  try { metas = await store.listDocs(); } catch (e) { console.warn(e); }
  metas.sort((a, b) => b.updated - a.updated);
  let folders = getFolders();
  const known = new Set(folders.map((f) => f.id));
  for (const m of metas) if (m.folder && !known.has(m.folder)) m.folder = null; // folder was deleted
  if (app.currentFolder && !known.has(app.currentFolder)) app.currentFolder = null;
  const cur = folders.find((f) => f.id === app.currentFolder) || null;
  grid.innerHTML = '';
  const thumbURL = (m) => { if (!m.thumb) return ''; const u = URL.createObjectURL(m.thumb); thumbURLs.push(u); return u; };

  // breadcrumb inside a folder (also a drop target to move artwork back out)
  crumb.hidden = !cur;
  crumb.innerHTML = '';
  if (cur) {
    const back = h('button', { class: 'crumb-back', onclick: () => { app.currentFolder = null; renderGallery(app); } }, '‹ Gallery');
    back.dataset.drop = 'root';
    crumb.append(back, h('span', { class: 'crumb-sep' }, '/'), h('b', {}, cur.name),
      h('button', { class: 'pill', onclick: () => folderMenu(app, cur) }, '⋯'));
  }

  const docs = metas.filter((m) => (m.folder || null) === (cur ? cur.id : null));
  if (!cur) {
    for (const f of folders) {
      const inside = metas.filter((m) => m.folder === f.id);
      const stack = h('button', { class: 'gal-thumb gal-stack', onclick: () => { app.currentFolder = f.id; renderGallery(app); } });
      inside.slice(0, 3).reverse().forEach((m, i, arr) => {
        const u = thumbURL(m);
        stack.append(h('span', { class: 'stack-page', style: { backgroundImage: u ? `url(${u})` : '', transform: `rotate(${(arr.length - 1 - i) * -4}deg) translate(${(arr.length - 1 - i) * -6}px, ${(arr.length - 1 - i) * 3}px)` } }));
      });
      if (!inside.length) stack.append(h('span', { class: 'stack-empty', html: ICONS.folder }));
      const card = h('div', { class: 'gal-card folder' }, stack,
        h('button', { class: 'gal-more', onclick: () => folderMenu(app, f) }, '⋯'),
        h('div', { class: 'gal-meta' }, h('b', {}, f.name), h('span', { class: 'badge' }, `${inside.length}`)),
        h('small', { class: 'hint' }, inside.length === 1 ? '1 artwork' : `${inside.length} artworks`));
      card.dataset.drop = 'folder:' + f.id;
      grid.append(card);
    }
  }
  if (!docs.length && !(!cur && folders.length)) {
    grid.append(h('div', { class: 'gal-empty' }, cur ? 'This folder is empty — drag artwork onto it, or tap ＋ New to create one here.' : 'No artwork yet — pick a mode above or tap ＋ New.'));
  }
  for (const m of docs) {
    const url = thumbURL(m);
    const thumb = h('button', { class: 'gal-thumb', style: { backgroundImage: url ? `url(${url})` : '', width: '100%', display: 'block' } });
    const card = h('div', { class: 'gal-card' }, thumb,
      h('button', { class: 'gal-more', onclick: () => galleryMenu(app, m) }, '⋯'),
      h('div', { class: 'gal-meta' }, h('b', {}, m.name), h('span', { class: 'badge ' + m.mode }, { paint: 'Illustration', animate: 'Animation', webtoon: 'Webtoon' }[m.mode] || m.mode)),
      h('small', { class: 'hint' }, `${m.width}×${m.height} · ${new Date(m.updated).toLocaleDateString()}`));
    card.dataset.drop = 'doc:' + m.id;
    bindGalleryDrag(app, card, thumb, m, metas);
    grid.append(card);
  }
}

// tap = open · hold & drag = move onto a folder, onto another artwork (new folder) or onto "‹ Gallery"
function bindGalleryDrag(app, card, thumb, m, metas) {
  thumb.addEventListener('pointerdown', (e) => {
    const st = { x: e.clientX, y: e.clientY, lifted: false, cancelled: false };
    let ghost = null, over = null;
    st.timer = setTimeout(() => {
      if (st.cancelled) return;
      st.lifted = true;
      const r = card.getBoundingClientRect();
      ghost = card.cloneNode(true); ghost.classList.add('gal-ghost');
      Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
      document.body.append(ghost); card.classList.add('dragging');
      st.dx = e.clientX - r.left; st.dy = e.clientY - r.top;
      navigator.vibrate && navigator.vibrate(8);
    }, e.pointerType === 'mouse' ? 160 : 260);
    const move = (ev) => {
      if (!st.lifted) { if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 8) { st.cancelled = true; clearTimeout(st.timer); } return; }
      ev.preventDefault();
      ghost.style.left = ev.clientX - st.dx + 'px'; ghost.style.top = ev.clientY - st.dy + 'px';
      ghost.hidden = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      ghost.hidden = false;
      const t = el && el.closest('[data-drop]');
      if (over && over !== t) over.classList.remove('drop-over');
      over = t && t !== card ? t : null;
      if (over) over.classList.add('drop-over');
    };
    const block = (ev) => { if (st.lifted) ev.preventDefault(); };
    const up = async () => {
      clearTimeout(st.timer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      document.removeEventListener('touchmove', block);
      if (!st.lifted) { if (!st.cancelled) openSaved(app, m); return; }
      ghost.remove(); card.classList.remove('dragging');
      if (!over) return;
      over.classList.remove('drop-over');
      const [kind, id] = over.dataset.drop.split(':');
      if (kind === 'root') await moveToFolder(app, m, null);
      else if (kind === 'folder') await moveToFolder(app, m, id);
      else if (kind === 'doc') {
        const other = metas.find((x) => x.id === id);
        const name = await promptDialog('New folder name', 'Folder');
        if (name == null) return;
        const f = await newFolder(name);
        await moveToFolder(app, m, f.id); if (other) await moveToFolder(app, other, f.id);
        toast(`Created "${f.name}"`);
      }
      renderGallery(app);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    document.addEventListener('touchmove', block, { passive: false });
  });
}

export async function createFolderFlow(app) {
  const name = await promptDialog('New folder', 'Folder');
  if (name == null) return;
  await newFolder(name.trim() || 'Folder');
  renderGallery(app);
}

function folderMenu(app, f) {
  dialog({
    title: f.name, body: '',
    actions: [
      { label: 'Rename', onClick: async () => { const n = await promptDialog('Rename folder', f.name); if (!n) return; setFolders(getFolders().map((x) => (x.id === f.id ? { ...x, name: n } : x))); renderGallery(app); } },
      { label: 'Delete folder', danger: true, onClick: async () => {
        if (!(await confirmDialog(`Delete the folder "${f.name}"? Its artwork moves back to the Gallery.`, 'Delete folder', true))) return;
        for (const m of (await store.listDocs()).filter((x) => x.folder === f.id)) await moveToFolder(app, m, null);
        setFolders(getFolders().filter((x) => x.id !== f.id));
        if (app.currentFolder === f.id) app.currentFolder = null;
        renderGallery(app);
      } },
      { label: 'Close', primary: true },
    ],
  });
}

function moveDialog(app, m) {
  const folders = getFolders();
  dialog({
    title: `Move "${m.name}"`, body: '',
    actions: [
      ...folders.filter((f) => f.id !== m.folder).map((f) => ({ label: '📁 ' + f.name, onClick: async () => { await moveToFolder(app, m, f.id); renderGallery(app); } })),
      m.folder && { label: 'Gallery (no folder)', onClick: async () => { await moveToFolder(app, m, null); renderGallery(app); } },
      { label: '＋ New folder…', onClick: async () => { const n = await promptDialog('New folder', 'Folder'); if (n == null) return; const f = await newFolder(n.trim() || 'Folder'); await moveToFolder(app, m, f.id); renderGallery(app); } },
      { label: 'Cancel', primary: true },
    ].filter(Boolean),
  });
}

async function openSaved(app, m) {
  toast('Opening…', 6000);
  try {
    const data = await store.loadDoc(m.id);
    if (!data) { toast('Document not found'); return; }
    const doc = await Doc.deserialize(data);
    doc.folder = m.folder || null;
    await app.openDoc(doc);
    $('#toast').hidden = true;
  } catch (e) { console.error(e); toast('Could not open: ' + e.message); }
}

function galleryMenu(app, m) {
  dialog({
    title: m.name, body: '',
    actions: [
      { label: 'Move to folder…', onClick: () => { setTimeout(() => moveDialog(app, m), 0); } },
      { label: 'Rename', onClick: async () => { const n = await promptDialog('Rename', m.name); if (!n) return; const data = await store.loadDoc(m.id); data.name = n; await store.saveDoc(data, { ...m, name: n }); renderGallery(app); } },
      { label: 'Duplicate', onClick: async () => { const data = await store.loadDoc(m.id); const id = 'd' + Date.now().toString(36); await store.saveDoc({ ...data, id, name: m.name + ' copy', timelapse: data.timelapse ? { ...data.timelapse, count: 0 } : null }, { ...m, id, name: m.name + ' copy', updated: Date.now() }); renderGallery(app); } },
      { label: 'Export project', onClick: async () => { const doc = await Doc.deserialize(await store.loadDoc(m.id)); download(await doc.toFile(), safeName(m.name) + '.inkwell'); } },
      { label: 'Delete', danger: true, onClick: async () => { if (await confirmDialog(`Delete "${m.name}"? This can't be undone.`, 'Delete', true)) { await store.deleteDoc(m.id); store.deleteTimelapse(m.id).catch(() => {}); renderGallery(app); } } },
      { label: 'Close', primary: true },
    ],
  });
}

const PRESETS = {
  paint: [['Square', 2048, 2048], ['Screen size', 0, 0], ['A4 · 300dpi', 2480, 3508], ['4K', 3840, 2160], ['Portrait post', 1080, 1350], ['Comic page (B4)', 2508, 3541]],
  animate: [['HD 1080p', 1920, 1080], ['HD 720p', 1280, 720], ['Square', 1080, 1080], ['Vertical (Reels)', 1080, 1920]],
  webtoon: [['Webtoon · 800 wide', 800, 6400], ['Tapas · 940 wide', 940, 6000], ['HD · 1080 wide', 1080, 8000], ['Short strip', 800, 3200]],
};

export function newDocDialog(app, mode = 'paint') {
  let sel = 0, W = 0, H = 0;
  const name = h('input', { class: 'text-in', value: { paint: 'Illustration', animate: 'Animation', webtoon: 'Episode 1' }[mode] });
  const wIn = h('input', { class: 'text-in', type: 'number' }), hIn = h('input', { class: 'text-in', type: 'number' });
  const fps = h('select', {}, ...[6, 8, 12, 15, 24, 30, 60].map((f) => h('option', { value: f, selected: f === 12 }, f + ' fps')));
  const len = h('input', { class: 'text-in', type: 'number', value: 24 });
  const grid = h('div', { class: 'preset-grid' });
  const animRow = h('div', { class: 'row2' }, h('div', {}, h('label', {}, 'Frame rate'), fps), h('div', {}, h('label', {}, 'Length (frames)'), len));
  const renderPresets = () => {
    grid.innerHTML = '';
    PRESETS[mode].forEach(([label, w, hh], i) => {
      if (!w) { w = Math.round(innerWidth * Math.min(2, devicePixelRatio || 1)); hh = Math.round(innerHeight * Math.min(2, devicePixelRatio || 1)); }
      const b = h('button', { class: 'preset' + (i === sel ? ' on' : ''), onclick: () => { sel = i; W = w; H = hh; wIn.value = w; hIn.value = hh; renderPresets(); } }, h('b', {}, label), h('small', {}, `${w} × ${hh}`));
      if (i === sel) { W = w; H = hh; wIn.value = w; hIn.value = hh; }
      grid.append(b);
    });
    animRow.hidden = mode !== 'animate';
  };
  const modeSeg = seg([['paint', 'Illustrate'], ['animate', 'Animate'], ['webtoon', 'Webtoon']], mode, (v) => { mode = v; sel = 0; name.value = { paint: 'Illustration', animate: 'Animation', webtoon: 'Episode 1' }[v]; renderPresets(); });
  renderPresets();
  dialog({
    title: 'New canvas', wide: true,
    body: h('div', {}, modeSeg, grid,
      h('div', { class: 'row2' }, h('div', {}, h('label', {}, 'Width (px)'), wIn), h('div', {}, h('label', {}, 'Height (px)'), hIn)),
      animRow, h('div', { class: 'stack' }, h('label', {}, 'Name'), name)),
    actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async () => {
      W = clamp(parseInt(wIn.value) || W, 16, 16384); H = clamp(parseInt(hIn.value) || H, 16, 16384);
      if (W * H > 16.7e6) { toast('Canvas too large for iPad Safari (max ~16.7 megapixels). Try a smaller size.'); return false; }
      const doc = Doc.create({ name: name.value || 'Untitled', mode, width: W, height: H });
      doc.folder = app.currentFolder || null;
      if (mode === 'animate') { doc.anim.fps = parseInt(fps.value); doc.anim.length = clamp(parseInt(len.value) || 24, 1, 2000); }
      await app.openDoc(doc);
      app.dirtySave = true; app.saveNow();
    } }],
  });
}

export async function importAny(app) {
  const files = await pickFile('.inkwell,.json,image/*,.sut,.brush,.brushset', true);
  if (!files.length) return;
  const brushFiles = files.filter((f) => /\.(sut|brush|brushset)$/i.test(f.name));
  if (brushFiles.length) {
    const { brushes, notes } = await importBrushFiles(brushFiles);
    for (const b of brushes) { await preloadBrush(b); app.brushes.push(b); await store.saveBrush(b); }
    toast(notes.join(' · '), 4000);
  }
  for (const f of files) {
    if (/\.(inkwell|json)$/i.test(f.name)) {
      try {
        const data = JSON.parse(await f.text());
        data.id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const doc = await Doc.deserialize(data);
        doc.folder = app.currentFolder || null;
        await app.openDoc(doc); app.dirtySave = true; await app.saveNow();
      } catch (e) { toast('Not a valid project: ' + e.message); }
    } else if (f.type.startsWith('image/')) {
      const img = await createImageBitmap(f);
      let w = img.width, hh = img.height;
      const k = Math.min(1, Math.sqrt(16e6 / (w * hh)));
      w = Math.round(w * k); hh = Math.round(hh * k);
      const doc = Doc.create({ name: f.name.replace(/\.[^.]+$/, ''), mode: 'paint', width: w, height: hh });
      doc.layers[0].canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
      doc.layers[0].name = 'Image';
      doc.folder = app.currentFolder || null;
      await app.openDoc(doc); app.dirtySave = true; await app.saveNow();
    }
  }
}
