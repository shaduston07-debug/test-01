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
import * as AutoBackup from './autobackup.js';
import * as Platform from './platform.js';
import * as X from './exporters.js';
import { encodeVideo, hevcSupported } from './video.js';
import { QUALITIES as TL_QUALITIES } from './timelapse.js';
import { ADJUSTMENTS, FloatingTransform, alphaBounds, wandMask, wandRegion, regionToCanvas, GRADIENT_PRESETS } from './tools.js';
import { parallelAdjust, wandRegionAsync } from './pool.js';
import * as store from './storage.js';
import { openStacks } from './stacks.js';
import { openOutline } from './filters.js';
import { pickedLayers, membersOf } from './layers.js';
import * as Toon from './webtoon.js';
import { insertLayer, structCmd, openLayers, onDocChanged, closeLayerSheet } from './layers.js';
export { insertLayer, structCmd, openLayers, onDocChanged, closeLayerSheet };

// ───────── popover / floating windows ─────────
// Any panel opened with `float: true` gets a pin button that turns it into a floating
// window: draggable by its title bar, stays open while you paint, remembers its position.
let pop = null;
const floats = new Map();
// sticky: the popover stays open while the canvas is touched (pinch / pan / zoom the view), e.g.
// adjustments with a live preview — they finish only with their own Apply / Cancel
export const popoverSticky = () => !!(pop && pop.sticky);
export function openPopover(anchor, { title, body, width = 340, head = [], onClose, key, float = false, side = false, sticky = false }) {
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
  if (side) {
    // beside a sidebar button: to its right (left in right-hand mode), vertically kept on screen
    const right = document.body.classList.contains('right-handed');
    const sb = anchor.closest('#sidebar') ? anchor.closest('#sidebar').getBoundingClientRect() : r;
    el.style.left = (right ? Math.max(8, sb.left - W - 12) : Math.min(sb.right + 12, innerWidth - W - 8)) + 'px';
    el.style.maxHeight = innerHeight - 16 + 'px';
    const place = () => { const H = el.offsetHeight; el.style.top = clamp(r.top + r.height / 2 - H / 2, 8, Math.max(8, innerHeight - H - 8)) + 'px'; };
    place();
    // re-place whenever the content grows (e.g. more save points), so it never runs off screen
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (el.hidden) ro.disconnect(); else place(); }); ro.observe(el); }
  } else {
    const arrow = h('div', { class: 'pop-arrow', style: { left: clamp(r.left + r.width / 2 - left, 24, W - 24) + 'px' } });
    el.append(arrow);
    // anchored low on the screen (the bottom context bar): open above it
    if (r.top > innerHeight * 0.6) {
      el.style.maxHeight = Math.max(160, r.top - 28) + 'px';
      el.style.top = Math.max(8, r.top - 12 - el.offsetHeight) + 'px';
      arrow.classList.add('below');
    } else el.style.maxHeight = '';
  }
  pop = { el, anchor, onClose, key: k, body: bodyEl, sticky };
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
    const top = clamp(y, 4, innerHeight - Math.min(hh, 120));
    win.style.top = top + 'px';
    // the whole window stays on screen; its contents scroll inside it
    win.style.maxHeight = Math.max(220, innerHeight - top - 12) + 'px';
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
    return (store.prefs.get('brushPoints', {})[app.sizeKey()] || []).map((p) => ({ size: p.size, opacity: p.opacity, v: Math.sqrt(Math.max(0, p.size - 1) / Math.max(1, b.maxSize - 1)) }));
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
  // the save point whose mark is nearest the finger (within tol px), if any
  const nearMark = (e, tol) => {
    if (!marks) return null;
    const r = el.getBoundingClientRect(), fromBottom = r.bottom - e.clientY;
    let best = null, bd = tol;
    for (const p of pointVals()) { const d = Math.abs(clamp(p.v, 0, 1) * (r.height - 14) - fromBottom); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  const onPos = (e, tap) => {
    const r = el.getBoundingClientRect();
    const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    // tapping a mark jumps to that save point (size + opacity); dragging snaps onto marks
    snapped = nearMark(e, tap ? 14 : 7);
    if (snapped) {
      app.setSize(snapped.size);
      if (tap && snapped.opacity != null) { app.setOpacity(snapped.opacity); app.updateSliders(); }
    } else set(v);
    sync(); show();
    app.onBrushValues && app.onBrushValues();
    if (snapped) bubble.append(h('small', { class: 'vs-snap' }, tap && snapped.opacity != null ? `Save point · ${Math.round(snapped.opacity * 100)}%` : 'Save point'));
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); active = true; el.setPointerCapture(e.pointerId); onPos(e, true); });
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

const COLOR_TABS = [
  ['ring', 'Disc', '<circle cx="12" cy="12" r="9"/><rect x="8" y="8" width="8" height="8"/>'],
  ['triangle', 'Triangle', '<circle cx="12" cy="12" r="9"/><path d="M12 6.5 17 15H7z"/>'],
  ['square', 'Classic', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 15h16"/>'],
  ['values', 'Value', '<path d="M5 8h14M5 12h14M5 16h14"/><circle cx="9" cy="8" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="11" cy="16" r="1.6" fill="currentColor"/>'],
  ['palettes', 'Palettes', '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'],
];
// Color panel: Triangle (hue ring + SV triangle), Classic square, Values, Palettes —
// with Hue / Saturation / Brightness bars underneath that work in every mode.
// target (optional): another colour to edit with the full panel, e.g. the background:
// { get(): hex, set(hex, commit), title, key }
export function openColor(app, anchor, target = null) {
  const curHex = () => (target ? target.get() : app.color);
  let [hh, s, v] = rgbToHsv(...hexToRgb(curHex()));
  const prev = curHex();
  let tab = store.prefs.get('colorTab', 'ring');
  let selfSet = false;
  const body = h('div', { class: 'color-panel' });
  const head = h('div', { class: 'color-chips' });
  const chipCur = h('div', { class: 'chip-cur' }), chipPrev = h('button', { class: 'chip-prev', title: 'Previous color', onclick: () => setFromHex(prev) });
  head.append(chipPrev, chipCur);
  const tabsEl = h('div', { class: 'pop-tabs' });
  const view = h('div', { class: 'color-view' });
  const bars = h('div', { class: 'hsb-bars' });
  const histQuick = h('div', { class: 'hist-tiles' });
  const histHead = h('div', { class: 'col-sec' }, h('span', null, 'History'),
    h('button', { class: 'col-clear', onclick: () => { app.colorHistory = []; store.prefs.set('colorHistory', []); histKey = ''; quick.render(); renderSw && renderSw(); } }, 'Clear'));
  tabsEl.className = 'col-tabs';
  body.append(view, bars, histHead, histQuick, tabsEl);

  const hex = () => rgbToHex(...hsvToRgb(hh, s, v));
  const commit = () => { if (target) target.set(hex(), true); else app.setColor(hex(), true); };
  const apply = () => { selfSet = true; if (target) target.set(hex(), false); else app.setColor(hex(), false); selfSet = false; refresh(); };
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
  const buildTriangle = (shape = 'triangle') => {
    const c = h('canvas', { class: 'color-tri', width: TS * 2, height: TS * 2 });
    // inner square (Ring + square mode): saturation left → right, brightness bottom → top
    const SQ = (RI - 6) * Math.SQRT1_2, sq = { x0: TS / 2 - SQ, y0: TS / 2 - SQ, w: SQ * 2 };
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
      const a0 = (hh - 90) * Math.PI / 180, mr0 = (R + RI) / 2;
      const marker = (px, py) => { x.beginPath(); x.arc(px * 2, py * 2, 15, 0, Math.PI * 2); x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke(); x.lineWidth = 2; x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke(); };
      if (shape === 'square') {
        const X = sq.x0 * 2, Y = sq.y0 * 2, Wd = sq.w * 2;
        x.fillStyle = rgbToHex(...hsvToRgb(hh, 1, 1)); x.fillRect(X, Y, Wd, Wd);
        let gr = x.createLinearGradient(X, 0, X + Wd, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(X, Y, Wd, Wd);
        gr = x.createLinearGradient(0, Y, 0, Y + Wd); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); x.fillStyle = gr; x.fillRect(X, Y, Wd, Wd);
        x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,0.35)'; x.strokeRect(X + 1, Y + 1, Wd - 2, Wd - 2);
        marker(TS / 2 + Math.cos(a0) * mr0, TS / 2 + Math.sin(a0) * mr0);
        marker(sq.x0 + s * sq.w, sq.y0 + (1 - v) * sq.w);
        return;
      }
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
      if (first) mode = d > RI - 3 ? 'ring' : shape;
      if (mode === 'ring') hh = ((Math.atan2(p.y - TS / 2, p.x - TS / 2) * 180 / Math.PI + 90) % 360 + 360) % 360;
      else if (mode === 'square') { s = clamp((p.x - sq.x0) / sq.w, 0, 1); v = clamp(1 - (p.y - sq.y0) / sq.w, 0, 1); }
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
      { label: 'Replace with current', primary: true, onClick: () => { pal.colors[ci] = curHex(); savePals(list); } },
    ] });
  };
  const swatchGrid = (pal) => {
    const row = h('div', { class: 'swatches' });
    pal.colors.forEach((c, ci) => row.append(swatchBtn(c, () => swatchMenu(pal.id, ci))));
    row.append(h('button', { class: 'add', title: 'Add current color', onclick: () => { const list = pals(); const p2 = list.find((x) => x.id === pal.id); p2.colors.push(curHex()); savePals(list); } }, '+'));
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
    // palettes of this project (from inserted pictures): ☆ copies one to your palettes
    const projBox = h('div');
    const renderProj = () => {
      projBox.innerHTML = '';
      const d = app.doc, pp = d ? d.projPalettes : [];
      if (!pp.length) return;
      projBox.append(h('div', { class: 'menu-section' }, 'This project (from pictures)'));
      for (const pal of pp) {
        const star = h('button', { class: 'pal-star' + (pal.starred ? ' on' : ''), title: pal.starred ? 'Saved to your palettes' : 'Keep in your palettes (all projects)', onclick: () => {
          if (pal.starred) { toast('Already in your palettes'); return; }
          pal.starred = true; app.dirtySave = true;
          addPalette(pal.name, [...pal.colors]); toast(`“${pal.name}” added to your palettes`); renderProj();
        } }, pal.starred ? '★' : '☆');
        const del = h('button', { class: 'pal-more', title: 'Remove from this project', onclick: () => { d.projPalettes.splice(d.projPalettes.indexOf(pal), 1); app.dirtySave = true; renderProj(); } }, '×');
        const row = h('div', { class: 'swatches' }); pal.colors.forEach((c) => row.append(swatchBtn(c)));
        projBox.append(h('div', { class: 'pal-head proj' }, h('span', { class: 'pal-name' }, pal.name), del, star), row);
      }
    };
    refreshProj = renderProj;
    renderProj();
    box.append(h('div', { class: 'pal-top' }, h('div', { class: 'menu-section' }, 'History'), h('button', { class: 'pill', onclick: newPaletteMenu }, '＋ New palette')),
      histRow, h('p', { class: 'hint' }, 'Tap a swatch to use it · hold to replace or delete'), projBox, palBox);
    renderSw();
    return { el: box, draw: () => {} };
  };
  // the default palette, compact, under the other color modes (like Procreate)
  // under the wheel: recent colours, then the chosen palette (tap its name to pick another)
  const quick = h('div', { class: 'pal-quick' });
  quick.render = () => {
    quick.innerHTML = ''; histQuick.innerHTML = '';
    const showHist = tab !== 'palettes';
    histQuick.hidden = histHead.hidden = !showHist;
    if (!showHist) return;
    // Procreate-style: a flush row of the last 10 colours actually used (empty slots stay dark)
    for (let i = 0; i < 10; i++) { const c = app.colorHistory[i]; histQuick.append(c ? swatchBtn(c) : h('span', { class: 'empty' })); }
    const list = pals(), pal = list.find((x) => x.id === Pal.defaultPaletteId(list));
    if (!pal) return;
    const pick = h('button', { class: 'pal-pick', title: 'Choose the palette shown here', onclick: () => dialog({ title: 'Palette under the wheel', body: '', actions: [
      ...list.map((p2) => ({ label: (p2.id === pal.id ? '✓ ' : '') + p2.name, onClick: () => { Pal.setDefaultPalette(p2.id); quick.render(); renderSw && renderSw(); } })),
      { label: 'Cancel', primary: true },
    ] }) }, pal.name + ' ▾');
    // the palette as a grid of square tiles; empty slots add the current colour
    const grid = h('div', { class: 'pal-tiles' });
    pal.colors.forEach((c, ci) => grid.append(swatchBtn(c, () => swatchMenu(pal.id, ci))));
    const cells = Math.max(30, Math.ceil((pal.colors.length + 1) / 10) * 10);
    for (let i = pal.colors.length; i < cells; i++) grid.append(h('button', { class: 'empty', title: 'Add current colour', onclick: () => { const l2 = pals(); const p2 = l2.find((x) => x.id === pal.id); p2.colors.push(curHex()); savePals(l2); } }));
    quick.append(h('div', { class: 'col-sec' }, pick), grid);
  };
  body.insertBefore(quick, tabsEl);

  const builders = { ring: () => buildTriangle('square'), triangle: () => buildTriangle('triangle'), square: buildSquare, values: buildValues, palettes: buildPalettes };
  let cur = null;
  const renderTab = () => {
    tabsEl.innerHTML = '';
    for (const [k, l, ic] of COLOR_TABS) {
      const b = h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; store.prefs.set('colorTab', k); renderTab(); } });
      b.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">${ic}</svg><span>${l}</span>`;
      tabsEl.append(b);
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
  let histKey = app.colorHistory.join();
  const listener = (c) => {
    if (!selfSet) { [hh, s, v] = rgbToHsv(...hexToRgb(c)); refresh(); }
    // swatch rows only change when the history does (not on every drag step)
    if (app.colorHistory.join() !== histKey) { histKey = app.colorHistory.join(); renderSw && renderSw(); quick.render(); }
  };
  if (!target) app.colorListeners.add(listener);
  renderTab();
  openPopover(anchor, { title: target ? target.title : 'Colours', body, head: [head], width: 400, key: target ? target.key || 'color-target' : 'color', float: true, onClose: () => { app.colorListeners.delete(listener); target && target.onClose && target.onClose(); } });
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
    // previews show the brush's character at a readable size: very fine pens (ibis brushes are
    // often 1–3 px) are drawn thicker, and the quick synthetic stroke doesn't trigger speed thinning
    const size = clamp(brush.size * 1.2, 12, hgt * 1.3);
    const pb = { ...brush, speedSize: 0, speedOpacity: 0 };
    previewEngine.begin(target, pb, { kind: 'paint', color, size, opacity: 1, noUndo: true, simTaper: true });
    for (const p of strokePreviewPoints(w * 2, hgt * 2)) previewEngine.add(p);
    previewEngine.end();
    // faint brushes (pencils, airbrushes, low-flow textures): lift the strongest part of the stroke
    // to near full strength so every preview is easy to see; the texture/softness is kept
    const x = src.getContext('2d', { willReadFrequently: true }), id = x.getImageData(0, 0, src.width, src.height), dd = id.data;
    const hist = new Uint32Array(256); let n = 0;
    for (let i = 3; i < dd.length; i += 4) if (dd[i]) { hist[dd[i]]++; n++; }
    let acc = 0, p95 = 255; for (let v = 255; v > 0; v--) { acc += hist[v]; if (acc >= n * 0.05) { p95 = v; break; } }
    if (n && p95 < 215) { const k = 235 / Math.max(20, p95); for (let i = 3; i < dd.length; i += 4) dd[i] = Math.min(255, dd[i] * k); x.putImageData(id, 0, 0); }
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
      menuItem('camera', 'Take a photo', () => Media.takePhoto(app, false)),
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
      menuItem('persp', 'Drawing guide · Perspective', () => { closePopover(); app.setTool('persp'); }, d.persp ? d.persp.type.replace('pt', '-point') : ''),
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
      h('div', { style: { padding: '4px 12px' } }, field('Ink blobs at stroke ends', { min: 0, max: 1, step: 0.05, value: app.settings.blobAmount ?? 0, fmt: (v) => (v ? pct(v) : 'Off — clean joins'), onInput: (v) => { app.settings.blobAmount = v; app.applySettings(); } })),
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
  app.changed();
  // a webtoon strip that grows at the bottom keeps its scroll position
  if (d.mode === 'webtoon' && !ox && !oy) app.requestRender('view'); else app.fitView();
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
  // keep the list and the "Save current" button up to date while sizes / opacity change
  app.onBrushValues = () => { if (body.isConnected) render(); };
  openPopover(anchor, { title: 'Save points', body, width: 300, key: 'points', float: true, side: true, onClose: () => { if (app.onBrushValues) app.onBrushValues = null; } });
}

// ───────── backup / restore ─────────
export function backupDialog(app) {
  let withTL = false;
  const st = AutoBackup.getState();
  const status = h('p', { class: 'hint' }, '');
  const run = async (fn) => { try { await fn(); } catch (e) { console.error(e); status.textContent = 'Failed: ' + (e.message || e); toast('Failed: ' + (e.message || e), 5000); return false; } };
  const when = (t) => (t ? new Date(t).toLocaleString() : 'never');
  const restoreBlob = async (blob, label) => {
    if (!(await confirmDialog(`Restore ${label}? Canvases in it are added back (ones that already exist are replaced by the backed-up version), then the app reloads.`, 'Restore'))) return false;
    toast('Restoring…', 60000);
    const r = await Backup.importBackup(blob, { onProgress: (m) => toast(m, 60000) });
    toast(`Restored ${r.canvases} canvas${r.canvases === 1 ? '' : 'es'} — reloading…`, 3000);
    setTimeout(() => location.reload(), 1200);
  };
  // ── automatic, on this device ──
  const local = h('div', { class: 'bk-sec' }, h('b', {}, 'Automatic backup on this iPad'));
  if (Platform.isNative) {
    local.append(
      switchRow('Back up automatically after I work', st.local !== false, (v) => AutoBackup.setState({ local: v })),
      h('p', { class: 'hint' }, `Keeps the last 5 full backups in Files › On My iPad › Inkwell Studio › Backups. Last one: ${when(st.lastLocal)}. They are inside the app's folder, so iOS deletes them if you delete the app: copy one to iCloud Drive now and then, or turn on Cloud backup below.`),
      h('div', { class: 'bk-row' },
        h('button', { class: 'pill', onclick: () => run(async () => { await app.saveNow(true); toast('Backing up…', 60000); const r = await AutoBackup.localBackup(); toast(`Backed up ${r.canvases} canvas${r.canvases === 1 ? '' : 'es'} ✓`, 3000); }) }, 'Back up now'),
        h('button', { class: 'pill', onclick: () => run(async () => {
          const list = await AutoBackup.listLocalBackups();
          if (!list.length) { toast('No automatic backups yet', 3000); return; }
          dialog({ title: 'Automatic backups', body: h('div', { class: 'bk-list' }, ...list.map((f) => h('button', { class: 'menu-item', onclick: () => run(async () => { closePopover(); await restoreBlob(await AutoBackup.readLocalBackup(f.name), '“' + f.name.replace('.inkwellbackup', '') + '”'); }) }, f.name.replace('Inkwell auto-backup ', '').replace('.inkwellbackup', ''), f.size ? h('small', {}, (f.size / 1e6).toFixed(1) + ' MB') : null))), actions: [{ label: 'Close' }] });
        }) }, 'Restore an automatic backup…')));
  } else {
    local.append(
      switchRow('Remind me every week to save a backup', st.remind !== false, (v) => AutoBackup.setState({ remind: v })),
      h('p', { class: 'hint' }, 'Safari and the Home Screen version can\'t save files on their own. Use “Back up everything” below now and then, or turn on Cloud backup, which is automatic.'));
  }
  // ── cloud: survives deleting the app ──
  const cloud = h('div', { class: 'bk-sec' }, h('b', {}, 'Cloud backup (survives deleting the app)'));
  const c = st.cloud;
  if (c && c.repo && AutoBackup.cloudToken()) {
    cloud.append(
      h('p', { class: 'hint' }, `On: every canvas you change, plus your brushes (including scanned ibis Paint brushes), fonts, palettes and settings, is uploaded to your private GitHub repository “${c.full || c.repo}”. Last upload: ${when(st.lastCloud)}.`),
      h('div', { class: 'bk-row' },
        h('button', { class: 'pill', onclick: () => run(async () => { await app.saveNow(true); toast('Uploading…', 60000); const n = await AutoBackup.cloudBackup(await store.listDocs(), { onProgress: (m) => toast(m, 60000) }); toast(n ? `Uploaded ${n} canvas${n === 1 ? '' : 'es'} ✓` : 'Everything is already backed up ✓', 3000); }) }, 'Back up now'),
        h('button', { class: 'pill', onclick: () => run(async () => {
          const files = await AutoBackup.listCloud();
          if (!files.length) { toast('The cloud backup is empty so far', 3000); return; }
          if (!(await confirmDialog(`Restore everything from the cloud backup (${files.length} file${files.length === 1 ? '' : 's'}: canvases, brushes, fonts, palettes and settings)? Missing things come back; existing ones are replaced by the backed-up version.`, 'Restore'))) return;
          const n = await AutoBackup.restoreCloud({ onProgress: (m) => toast(m, 60000) });
          toast(`Restored ${n} canvas${n === 1 ? '' : 'es'} — reloading…`, 3000); setTimeout(() => location.reload(), 1200);
        }) }, 'Restore from cloud…'),
        h('button', { class: 'pill', onclick: () => { AutoBackup.setState({ cloud: null }); AutoBackup.setCloudToken(''); closePopover(); toast('Cloud backup turned off (the files stay in your repository)'); } }, 'Turn off')));
  } else {
    cloud.append(h('p', { class: 'hint' }, 'Uploads each canvas you change, and your brushes (including scanned ibis Paint brushes), fonts, palettes and settings, to a private GitHub repository that only you can see, automatically. If the app or the iPad is ever lost, install the app again and use Restore from cloud.'),
      h('button', { class: 'pill primary', onclick: () => cloudSetup(app) }, 'Set up cloud backup…'));
  }
  // ── manual ──
  const manual = h('div', { class: 'bk-sec' }, h('b', {}, 'Backup file'),
    h('p', { class: 'hint' }, 'One file with all your canvases, brushes, fonts, palettes and settings. Keep it in Files or iCloud Drive; restore it after installing on any device.'),
    switchRow('Include time-lapse recordings (much bigger file)', false, (v) => (withTL = v)));
  dialog({ title: 'Backup & Restore', wide: true, body: h('div', {}, local, cloud, manual, status), actions: [
    { label: 'Close' },
    { label: 'Restore from backup file…', onClick: () => run(async () => { const [f] = await pickFile(Backup.BACKUP_ACCEPT); if (!f) return false; return restoreBlob(f, 'this backup'); }) },
    { label: 'Back up everything', primary: true, onClick: () => run(async () => {
      await app.saveNow(true);
      toast('Preparing backup…', 60000);
      const r = await Backup.exportBackup({ timelapse: withTL, onProgress: (m) => toast(m, 60000) });
      toast(`Backup ready: ${r.canvases} canvas${r.canvases === 1 ? '' : 'es'}, ${(r.bytes / 1e6).toFixed(1)} MB`, 4000);
    }) },
  ] });
}
function cloudSetup(app) {
  const repo = h('input', { class: 'text-in', value: 'inkwell-studio-backup', placeholder: 'repository name' });
  const key = h('input', { class: 'text-in', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
  const msg = h('p', { class: 'hint' });
  dialog({ title: 'Set up cloud backup', wide: true, body: h('div', {},
    h('ol', { class: 'bk-steps' },
      h('li', {}, 'On github.com, create a new repository named ', h('b', {}, 'inkwell-studio-backup'), ' and choose ', h('b', {}, 'Private'), '.'),
      h('li', {}, 'Open Settings › Developer settings › Personal access tokens › ', h('b', {}, 'Fine-grained tokens'), ' › Generate new token. Under Repository access pick ', h('b', {}, 'Only select repositories'), ' › inkwell-studio-backup. Under Permissions › Repository permissions set ', h('b', {}, 'Contents: Read and write'), '.'),
      h('li', {}, 'Copy the key and paste it below. It stays on this iPad only and is never put into backup files.')),
    h('label', {}, 'Repository'), repo, h('label', {}, 'Access key'), key, msg),
  actions: [{ label: 'Cancel' }, { label: 'Connect & back up', primary: true, onClick: async () => {
    AutoBackup.setCloudToken(key.value.trim());
    try {
      msg.textContent = 'Checking…';
      const t = await AutoBackup.testCloud(repo.value.trim());
      AutoBackup.setState({ cloud: { repo: repo.value.trim(), full: t.full, branch: t.branch, done: {} } });
      toast('Connected. Uploading your canvases…', 60000);
      const n = await AutoBackup.cloudBackup(await store.listDocs(), { onProgress: (m) => toast(m, 60000) });
      toast(`Cloud backup on ✓ (${n} canvas${n === 1 ? '' : 'es'} uploaded)`, 4000);
    } catch (e) { AutoBackup.setCloudToken(''); AutoBackup.setState({ cloud: null }); msg.textContent = 'Couldn’t connect: ' + (e.message || e); return false; }
  } }] });
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
    switchRow('Quick pinch snaps the canvas to fit the screen', !!s.pinchFit, (v) => { s.pinchFit = v; save(); }),
    field('Snap when pinched down to', { min: 0.1, max: 0.9, step: 0.05, value: s.pinchFitAmount ?? 0.5, fmt: (v) => Math.round(v * 100) + '% of the size (smaller = harder pinch)', onInput: (v) => { s.pinchFitAmount = v; save(); } }),
    field('…and within', { min: 0.15, max: 1, step: 0.05, value: s.pinchFitTime ?? 0.35, fmt: (v) => v.toFixed(2) + ' s', onInput: (v) => { s.pinchFitTime = v; save(); } }),
    switchRow('Rotation snaps to straight angles (0° / 90° / 180°)', s.rotateSnap !== false, (v) => { s.rotateSnap = v; save(); }),
    field('Rotation snap strength', { min: 1, max: 15, step: 1, value: s.rotateSnapDeg ?? 4, fmt: (v) => 'within ' + v + '°', onInput: (v) => { s.rotateSnapDeg = v; save(); } }),
    switchRow('Hold to keep undoing / redoing (2 or 3 fingers, or the undo buttons)', s.holdRepeat !== false, (v) => { s.holdRepeat = v; save(); }),
    h('button', { class: 'pill', style: { margin: '6px 6px 6px 0' }, onclick: () => { dlg.close(); backupDialog(app); } }, 'Backup & Restore…'),
    h('button', { class: 'pill', style: { margin: '6px 0' }, onclick: () => { app.recordPen = true; app.penLog = []; dlg.close(); toast('Recording: draw a few strokes with the Apple Pencil', 4000); } }, 'Record Pencil strokes (for support)…'),
    field('Rapid undo delay', { min: 0.15, max: 1.5, step: 0.05, value: s.rapidUndoDelay ?? 0.35, fmt: (v) => v.toFixed(2) + ' s', onInput: (v) => { s.rapidUndoDelay = v; save(); } }),
    h('div', { class: 'menu-section' }, 'Apple Pencil'),
    h('div', { class: 'stack' }, h('label', {}, 'Pen pressure from'),
      seg([['auto', app.penHasPressure ? 'Auto (pressure found)' : 'Auto (full strength)'], ['pressure', 'Pencil pressure'], ['tilt', 'Tilt'], ['speed', 'Speed'], ['off', 'Off (full strength)']], s.pressureSource || 'auto', (v) => { s.pressureSource = v; save(); }),
      switchRow('Solid colour — pressure, tilt and speed change the size only (overlapping strokes don’t darken)', s.solidColor !== false, (v) => { s.solidColor = v; save(); }),
      h('p', { class: 'hint' }, 'Every brush is made to look right at full strength; pressure is a bonus. Auto uses pressure only once your pen shows it really senses it. Optional extras for pens without pressure: Tilt — lean the pen for a thicker, darker line; Speed — slow strokes are heavier, fast ones lighter.')),
    switchRow('Steady ink — pens stay solid black at any pressure; pressure only changes the width a little', s.steadyInk !== false, (v) => { s.steadyInk = v; save(); }),
    h('div', { class: 'stack' }, h('label', {}, 'Finger behaviour'), seg([['auto', 'Auto (pencil only once detected)'], ['on', 'Pencil only'], ['off', 'Fingers draw']], s.penOnly, (v) => { s.penOnly = v; save(); })),
    field('Pressure curve (lower = softer touch)', { min: 0.3, max: 2.5, step: 0.05, value: s.pressureGamma, fmt: (v) => v.toFixed(2), onInput: (v) => { s.pressureGamma = v; save(); } }),
    switchRow('QuickShape (hold at end of a stroke)', s.quickShape, (v) => { s.quickShape = v; save(); }),
    field('Ink blobs where strokes start / end (brushes with a “bleed” fade; 0 = clean joins)', { min: 0, max: 1, step: 0.05, value: s.blobAmount ?? 0, fmt: pct, onInput: (v) => { s.blobAmount = v; save(); } }),
    field('Post-correction when lifting the pen (0 = keep strokes exactly as drawn)', { min: 0, max: 1, step: 0.05, value: s.liftAmount ?? 0, fmt: pct, onInput: (v) => { s.liftAmount = v; save(); } }),
    field('QuickShape delay', { min: 250, max: 1500, step: 50, value: s.quickShapeDelay, fmt: (v) => v + ' ms', onInput: (v) => { s.quickShapeDelay = v; save(); } }),
    h('div', { class: 'menu-section' }, 'Performance'),
    field('Memory budget for layers', { min: 300, max: 4000, step: 50, value: s.memoryMB, fmt: (v) => v + ' MB', onInput: (v) => { s.memoryMB = v; save(); } }),
    h('p', { class: 'hint' }, 'Sets how many layers you can add. M-series iPads start at 2000 MB (≈115 layers at 2048×2048). Drawing speed does not depend on layer count. If the app ever reloads by itself, lower this.'),
    switchRow('Autosave', s.autosave, (v) => { s.autosave = v; save(); }),
    switchRow('Clipping layers: delete paint that goes outside the base layer', s.clipTrim !== false, (v) => { s.clipTrim = v; save(); }),
    switchRow('Make a project palette from inserted pictures', s.picturePalette !== false, (v) => { s.picturePalette = v; save(); }),
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

let refreshProj = null;
export function refreshPalettes() { refreshProj && refreshProj(); }

// ───────── adjustments ─────────
export function openAdjustments(app, anchor) {
  app.finishTransient();
  const body = h('div');
  body.append(menuItem('adjust', 'Liquify', () => { closePopover(); app.setTool('liquify'); }));
  body.append(menuItem('adjust', 'Outline', () => { closePopover(); setTimeout(() => openOutline(app, anchor), 0); }));
  body.append(menuItem('adjust', 'Colouring stacks (layer presets)', () => { closePopover(); setTimeout(() => openStacks(app, anchor), 0); }));
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
  // several layers picked in the Layers panel: each one gets the adjustment (and stays its own layer)
  const picked = pickedLayers(app);
  let canvases;
  if (picked.length > 1) canvases = membersOf(app.doc, picked).filter((x) => x.type === 'raster' && !app.doc.isLocked(x)).map((x) => x.canvas);
  else { const target = app.doc.getTarget(false); canvases = target ? [target.canvas] : []; }
  if (!canvases.length) { toast('Select a raster layer (or a drawing in the timeline)'); return; }
  const pad = key === 'blur' || key === 'sharpen' ? 64 : 0;
  const T = [];
  for (const c of canvases) {
    let bb = alphaBounds(c);
    if (!bb) continue;
    const x0 = Math.max(0, bb.x - pad), y0 = Math.max(0, bb.y - pad);
    bb = { x: x0, y: y0, w: Math.min(c.width, bb.x + bb.w + pad) - x0, h: Math.min(c.height, bb.y + bb.h + pad) - y0 };
    const ctx = c.getContext('2d');
    T.push({ c, ctx, bb, orig: ctx.getImageData(bb.x, bb.y, bb.w, bb.h), maskData: app.selection.active ? app.selection.mask.getContext('2d').getImageData(bb.x, bb.y, bb.w, bb.h).data : null });
  }
  if (!T.length) { toast(canvases.length > 1 ? 'Those layers are empty' : 'This layer is empty'); return; }
  const params = Object.fromEntries(adj.params.map(([k, , , , def]) => [k, def]));
  let pending = false, done = false, busy = false, again = false, ticket = 0, applying = false;
  // runs on all worker cores in parallel bands; newest slider value wins
  const run = () => {
    if (pending) return; pending = true;
    requestAnimationFrame(async () => {
      pending = false; if (done) return;
      if (busy) { again = true; return; }
      busy = true; const my = ++ticket;
      const outs = [];
      for (const t of T) outs.push(await parallelAdjust(key, { ...params, color: app.color }, t.orig.data, t.bb.w, t.bb.h));
      busy = false;
      if (done || my !== ticket) return;
      if (again) { again = false; run(); }
      T.forEach((t, i) => {
        const img = new ImageData(outs[i], t.bb.w, t.bb.h);
        if (t.maskData) {
          const o = t.orig.data, n = img.data, md = t.maskData;
          for (let k = 0; k < n.length; k += 4) { const m = md[k + 3] / 255; if (m >= 1) continue; for (let q = 0; q < 4; q++) n[k + q] = o[k + q] + (n[k + q] - o[k + q]) * m; }
        }
        t.ctx.putImageData(img, t.bb.x, t.bb.y);
        touch(t.c);
      });
      app.requestRender();
    });
  };
  const apply = async () => {
    if (done || applying) return; applying = true;
    // let the latest preview finish on the workers before committing it
    while (busy || pending || again) await new Promise((r) => setTimeout(r, 16));
    done = true;
    const after = T.map((t) => t.ctx.getImageData(t.bb.x, t.bb.y, t.bb.w, t.bb.h));
    const put = (imgs) => { T.forEach((t, i) => { t.ctx.putImageData(imgs[i], t.bb.x, t.bb.y); touch(t.c); }); app.requestRender(); };
    const before = T.map((t) => t.orig);
    app.history.push({ label: adj.name + (T.length > 1 ? ` (${T.length} layers)` : ''), bytes: T.reduce((a, t) => a + t.bb.w * t.bb.h * 8, 0), undo() { put(before); app.changed(); }, redo() { put(after); app.changed(); } });
    app.changed();
  };
  const cancel = () => { if (done) return; done = true; for (const t of T) { t.ctx.putImageData(t.orig, t.bb.x, t.bb.y); touch(t.c); } app.requestRender(); };
  const body = h('div');
  if (T.length > 1) body.append(h('p', { class: 'hint' }, `Applies to the ${T.length} layers picked in the Layers panel (each stays its own layer).`));
  for (const [k, label, min, max, def, step] of adj.params) body.append(field(label, { min, max, step, value: def, fmt: (v) => (step < 1 ? (+v).toFixed(2) : Math.round(v)), onInput: (v) => { params[k] = v; run(); } }));
  if (key === 'gradientMap') { params.stops = store.prefs.get('gmapStops', GRADIENT_PRESETS[0].stops); body.append(gradientEditor(params, run)); }
  if (!adj.params.length) body.append(h('p', { class: 'hint' }, 'Preview shown on canvas.'));
  if (app.selection.active) body.append(h('p', { class: 'hint' }, 'Limited to the current selection.'));
  const head = [h('button', { class: 'small-btn', onclick: () => { cancel(); closePopover(); } }, 'Cancel'), h('button', { class: 'small-btn on', onclick: () => { apply(); closePopover(); } }, 'Apply')];
  setTimeout(() => {
    openPopover(anchor, { title: adj.name, body, head, width: 340, key: 'adj-' + key, sticky: true, onClose: () => apply() });
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
    // like Procreate: a new selection adds to the current one by default, so a stray tap or a
    // second lasso never wipes what is already selected (New / Subtract / Intersect are there too)
    mode: store.prefs.get('selMode', 'freehand'), op: store.prefs.get('selOp', 'add'), wandRef: 'layer', wandTol: 0.2,
    poly: null, // lasso in progress: [{x,y}]
    // leaving the tool closes an open lasso (like Procreate) instead of throwing it away
    exit() { if (this.poly && this.poly.length >= 3) this.closeLasso(); this.poly = null; this.drag = null; this.wand = null; },
    screenDist(a, b) { const p = app.docToScreen(a.x, a.y), q = app.docToScreen(b.x, b.y); return Math.hypot(p.x - q.x, p.y - q.y); },
    down(p) {
      this.p0 = p; this.p1 = p; this.moved = false;
      if (this.mode === 'auto') { this.startWand(p); return; }
      if (this.mode === 'freehand') {
        this.fresh = !this.poly;
        // each drag / tapped point is one undo step while the lasso is open
        this.stepStart = this.poly ? this.poly.length : 0;
        if (!this.poly) { this.poly = [{ x: p.x, y: p.y }]; this.steps = []; }
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
          // like Procreate: lifting leaves the lasso open (dotted line back to the start) —
          // draw more, tap to add straight edges, tap the start dot (or Close) to finish.
          // Ending a drag on the start dot closes it right away.
          const nearStart = poly.length > 3 && this.screenDist(poly[0], p) < 28;
          if (nearStart) this.closeLasso();
          else if (this.fresh) app.showHud('Draw more or tap to add points · tap the start dot to close', 1800);
        } else {
          if (poly.length >= 3 && this.screenDist(poly[0], p) < 26) this.closeLasso();
          else if (!this.fresh) poly.push({ x: p.x, y: p.y });
          else app.showHud('Tap to add points · tap the first point to close', 1800);
        }
        if (this.poly && this.poly.length > this.stepStart) { (this.steps ||= []).push(this.stepStart); this.redoSteps = []; }
        app.updateCtxBar(); app.requestRender('view');
        return;
      }
      this.drag = false;
      if (!this.moved) { app.requestRender('view'); return; }
      const sh = this.shape();
      selCmd('Select', () => app.selection.apply(sh, this.op));
    },
    cancel() { this.drag = false; if (this.mode === 'freehand' && this.fresh) this.poly = null; this.wand = null; },
    // undo while the lasso is open: remove the last drag / point instead of the last stroke
    undoStep() {
      if (!this.poly) return false;
      const start = (this.steps || []).pop() ?? 0;
      // keep what was removed so redo can put it back
      (this.redoSteps ||= []).push({ start, pts: this.poly.slice(start) });
      this.poly.length = Math.max(0, start);
      if (this.poly.length === 0) { this.poly = null; this.steps = []; }
      app.showHud('Undo lasso', 600); app.updateCtxBar(); app.requestRender('view');
      return true;
    },
    redoStep() {
      const r = this.redoSteps && this.redoSteps.pop();
      if (!r) return false;
      if (!this.poly) { this.poly = []; this.steps = []; }
      if (r.start > 0) this.steps.push(r.start);
      this.poly.length = r.start; this.poly.push(...r.pts);
      app.showHud('Redo lasso', 600); app.updateCtxBar(); app.requestRender('view');
      return true;
    },
    closeLasso() {
      const pts = this.poly; this.poly = null; this.redoSteps = [];
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
        // how it will close: a light dotted line from the last point back to the start
        if (pts.length > 1) {
          const last = hover || pts[pts.length - 1];
          ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(pts[0].x, pts[0].y);
          ctx.strokeStyle = 'rgba(61,139,255,0.55)'; ctx.lineWidth = 1.4 * px; ctx.setLineDash([2 * px, 5 * px]); ctx.stroke();
        }
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
          cbBtn('Undo', () => this.undoStep()),
          cbBtn('Cancel', () => { this.poly = null; app.updateCtxBar(); app.requestRender('view'); })];
      }
      const setMode = (v) => { t.mode = v; store.prefs.set('selMode', v); app.updateCtxBar(); };
      const items = [
        ...[['auto', 'Automatic'], ['freehand', 'Freehand'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']].map(([v, l]) => cbBtn(l, () => setMode(v), t.mode === v)),
        cbSep(),
        ...[['replace', 'New'], ['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect']].map(([v, l]) => cbBtn(l, () => { t.op = v; store.prefs.set('selOp', v); app.updateCtxBar(); }, t.op === v)),
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
  const HANDLE = 24;
  const pref = (k, d) => store.prefs.get(k, d), setPref = (k, v) => store.prefs.set(k, v);
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y }), add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y }), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const done = () => { t.commit(); app.setTool(app.prevTool && app.prevTool !== 'transform' ? app.prevTool : 'brush'); };
  // affine that scales by (kx, ky) along the shape's own axes e1/e2 around O
  const axisScale = (O, e1, e2, kx, ky) => {
    const B = new DOMMatrix([e1.x, e1.y, e2.x, e2.y, 0, 0]);
    if (Math.abs(e1.x * e2.y - e2.x * e1.y) < 1e-9) return new DOMMatrix();
    return new DOMMatrix().translate(O.x, O.y).multiply(B).scale(kx, ky).multiply(B.inverse()).translate(-O.x, -O.y);
  };
  const inBasis = (v, e1, e2) => { const den = e1.x * e2.y - e2.x * e1.y || 1e-9; return { a: (v.x * e2.y - e2.x * v.y) / den, b: (e1.x * v.y - v.x * e1.y) / den }; };
  const t = {
    get mode() { return pref('tf.mode', 'uniform'); },
    set mode(m) { setPref('tf.mode', m); },
    get snap() { return pref('tf.snap', true); },
    get fromCenter() { return pref('tf.center', false); },
    get snapPx() { return pref('tf.snapPx', 10); },
    guides: null,
    enter() {
      this.entered = true;
      const tg = app.doc.getTarget(false);
      if (!tg) { toast('Select a raster layer to transform'); return; }
      snapshot(tg.canvas);
      app.transform = new FloatingTransform(tg, app.selection);
      if (this.mode === 'warp') { app.transform.toWarp(); app.transform.update(); }
      this.undoStack = [];
      app.requestRender(); app.updateCtxBar();
    },
    exit() { if (app.transform) this.commit(); this.entered = false; },
    toDoc(pt) { const T = app.transform; return T.target.matrix ? T.target.matrix.transformPoint(pt) : pt; },
    scr(pt) { const q = this.toDoc(pt); return app.docToScreen(q.x, q.y); },
    setMode(m) {
      this.mode = m;
      const T = app.transform;
      if (T && m === 'warp') { T.toWarp(); T.update(); app.requestRender(); }
      app.updateCtxBar(); app.requestRender();
    },
    handles() {
      const T = app.transform, q = T.corners(), sc = q.map((p) => this.scr(p));
      const sides = [0, 1, 2, 3].map((i) => this.scr(mid(q[i], q[(i + 1) % 4])));
      const top = sides[0], cen = this.scr(T.center);
      const L = Math.hypot(top.x - cen.x, top.y - cen.y) || 1;
      const rot = { x: top.x + (top.x - cen.x) / L * 42, y: top.y + (top.y - cen.y) / L * 42 };
      const warp = T.warp ? T.warp.map((p) => this.scr(p)) : null;
      return { sc, sides, rot, cen, warp };
    },
    hit(p) {
      const T = app.transform, hd = this.handles(), m = this.mode, near = (c) => Math.hypot(p.sx - c.x, p.sy - c.y) < HANDLE;
      if (m === 'warp') {
        let best = -1, bd = HANDLE;
        hd.warp.forEach((c, i) => { const d = Math.hypot(p.sx - c.x, p.sy - c.y); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) return { type: 'wpt', idx: best };
        return { type: this.inside(p) ? 'wfall' : 'move' };
      }
      if (near(hd.rot)) return { type: 'rotate' };
      for (let i = 0; i < 4; i++) if (near(hd.sc[i])) return { type: 'corner', idx: i };
      if (m !== 'uniform') for (let i = 0; i < 4; i++) if (near(hd.sides[i])) return { type: 'side', idx: i };
      return { type: 'move' };
    },
    inside(p) {
      const T = app.transform, pts = T.outline(16).map((q) => this.scr(q));
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > p.sy) !== (b.y > p.sy) && p.sx < ((b.x - a.x) * (p.sy - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    },
    down(p) {
      if (!app.transform) { this.enter(); if (!app.transform) return false; }
      const T = app.transform;
      this.drag = { ...this.hit(p), l0: T.target.toLocal(p.x, p.y), s0: T.state() };
    },
    move(p) {
      const T = app.transform, g = this.drag; if (!T || !g) return;
      const l = T.target.toLocal(p.x, p.y), dl = sub(l, g.l0), m = this.mode;
      T.setState(g.s0);
      this.guides = null;
      const q = T.corners().map((c) => ({ ...c })), C = T.center;
      const e1 = sub(q[1], q[0]), e2 = sub(q[3], q[0]);
      if (g.type === 'move') {
        let d = dl;
        if (this.snap) d = this.snapMove(T, d);
        T.affine(new DOMMatrix().translate(d.x, d.y));
      } else if (g.type === 'rotate') {
        let r = (Math.atan2(l.y - C.y, l.x - C.x) - Math.atan2(g.l0.y - C.y, g.l0.x - C.x)) * 180 / Math.PI;
        const base = Math.atan2(e1.y, e1.x) * 180 / Math.PI;
        if (this.snap) { const tot = base + r, sn = Math.round(tot / 15) * 15; if (Math.abs(tot - sn) < 3) r = sn - base; }
        T.affine(new DOMMatrix().translate(C.x, C.y).rotate(r).translate(-C.x, -C.y));
        app.showHud(Math.round((((base + r) % 360) + 360) % 360) + '°');
      } else if (g.type === 'corner') {
        const i = g.idx;
        if (m === 'distort') this.distortCorner(T, i, dl);
        else {
          const O = this.fromCenter ? C : q[(i + 2) % 4], v0 = sub(q[i], O), v = add(v0, dl);
          let kx, ky;
          if (m === 'uniform') { const k = (v.x * v0.x + v.y * v0.y) / ((v0.x * v0.x + v0.y * v0.y) || 1); kx = ky = k; }
          else { const b0 = inBasis(v0, e1, e2), b1 = inBasis(v, e1, e2); kx = Math.abs(b0.a) > 1e-6 ? b1.a / b0.a : 1; ky = Math.abs(b0.b) > 1e-6 ? b1.b / b0.b : 1; }
          T.affine(axisScale(O, e1, e2, kx, ky));
          this.sizeHud(T);
        }
      } else if (g.type === 'side') {
        const i = g.idx, sm = mid(q[i], q[(i + 1) % 4]);
        if (m === 'distort') { this.distortCorner(T, i, dl); this.distortCorner(T, (i + 1) % 4, dl); }
        else {
          const O = this.fromCenter ? C : mid(q[(i + 2) % 4], q[(i + 3) % 4]), v0 = sub(sm, O), v = add(v0, dl);
          const b0 = inBasis(v0, e1, e2), b1 = inBasis(v, e1, e2);
          const horiz = i === 1 || i === 3;
          const k = horiz ? (Math.abs(b0.a) > 1e-6 ? b1.a / b0.a : 1) : (Math.abs(b0.b) > 1e-6 ? b1.b / b0.b : 1);
          T.affine(axisScale(O, e1, e2, horiz ? k : 1, horiz ? 1 : k));
          this.sizeHud(T);
        }
      } else if (g.type === 'wpt') {
        T.warp[g.idx] = add(T.warp[g.idx], dl);
      } else if (g.type === 'wfall') {
        const cs = T.corners(), diag = Math.hypot(cs[2].x - cs[0].x, cs[2].y - cs[0].y) || 100, sg = diag * 0.28;
        T.warp = T.warp.map((w) => { const d2 = (w.x - g.l0.x) ** 2 + (w.y - g.l0.y) ** 2, k = Math.exp(-d2 / (2 * sg * sg)); return { x: w.x + dl.x * k, y: w.y + dl.y * k }; });
      }
      T.update(12); app.requestRender('active');
    },
    // move one corner; a warped shape follows with bilinear weights
    distortCorner(T, i, d) {
      if (!T.warp) { T.q[i] = add(T.q[i], d); return; }
      const cu = i === 1 || i === 2 ? 1 : 0, cv = i >= 2 ? 1 : 0;
      T.warp = T.warp.map((w, k) => { const u = (k % 4) / 3, v = Math.floor(k / 4) / 3, wt = (cu ? u : 1 - u) * (cv ? v : 1 - v); return { x: w.x + d.x * wt, y: w.y + d.y * wt }; });
    },
    sizeHud(T) {
      const q = T.corners(), b = T.bbox;
      const w = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y), hh = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
      app.showHud(`${Math.round(w)} × ${Math.round(hh)} px · ${Math.round((w / b.w) * 100)}%`);
    },
    // magnetic snapping of the shape's centre / edges to the canvas centre / edges
    snapMove(T, d) {
      const pts = T.outline(8).map((p) => this.toDoc(add(p, d))), D = app.doc, thr = this.snapPx / app.view.zoom;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const bx = [Math.min(...xs), (Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...xs)], by = [Math.min(...ys), (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...ys)];
      const best = (vals, targets) => { let o = null; for (const v of vals) for (const tg of targets) { const dd = tg - v; if (Math.abs(dd) < thr && (!o || Math.abs(dd) < Math.abs(o.d))) o = { d: dd, at: tg }; } return o; };
      const sx = best(bx, [0, D.width / 2, D.width]), sy = best(by, [0, D.height / 2, D.height]);
      this.guides = { x: sx ? sx.at : null, y: sy ? sy.at : null };
      return { x: d.x + (sx ? sx.d : 0), y: d.y + (sy ? sy.d : 0) };
    },
    up() {
      const T = app.transform;
      if (this.drag && T) { this.undoStack.push(this.drag.s0); if (this.undoStack.length > 50) this.undoStack.shift(); T.update(24); app.requestRender('active'); }
      this.drag = null; this.guides = null;
    },
    act(fn) { const T = app.transform; if (!T) return; this.undoStack.push(T.state()); fn(T); T.update(24); app.requestRender(); },
    stepBack() { const T = app.transform, s = this.undoStack && this.undoStack.pop(); if (!T || !s) return false; T.setState(s); T.update(24); app.requestRender(); return true; },
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
      ctx.save();
      ctx.lineWidth = 1.5 * px; ctx.strokeStyle = '#3d8bff';
      const out = T.outline(32).map((q) => this.toDoc(q));
      ctx.beginPath(); out.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
      if (T.warp && this.mode === 'warp') {
        // mesh lines through the patch
        const f = T.mapper(); ctx.lineWidth = 1 * px; ctx.strokeStyle = 'rgba(61,139,255,0.7)';
        for (let k = 1; k < 4; k++) for (const dir of [0, 1]) {
          ctx.beginPath();
          for (let s = 0; s <= 24; s++) { const q = this.toDoc(dir ? f(k / 4, s / 24) : f(s / 24, k / 4)); s ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
          ctx.stroke();
        }
      }
      if (this.guides) {
        const D = app.doc; ctx.strokeStyle = '#ff9f1a'; ctx.lineWidth = 1 * px; ctx.setLineDash([6 * px, 4 * px]);
        if (this.guides.x != null) { ctx.beginPath(); ctx.moveTo(this.guides.x, 0); ctx.lineTo(this.guides.x, D.height); ctx.stroke(); }
        if (this.guides.y != null) { ctx.beginPath(); ctx.moveTo(0, this.guides.y); ctx.lineTo(D.width, this.guides.y); ctx.stroke(); }
      }
      ctx.restore();
    },
    overlayScreen(ctx) {
      if (!app.transform) return;
      const hd = this.handles(), m = this.mode;
      ctx.save();
      ctx.strokeStyle = '#3d8bff'; ctx.lineWidth = 1.5;
      const dot = (c, r, fill) => { ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#3d8bff'; ctx.stroke(); };
      if (m === 'warp') { hd.warp.forEach((c, i) => dot(c, [0, 3, 12, 15].includes(i) ? 8 : 6, '#fff')); ctx.restore(); return; }
      ctx.beginPath(); ctx.moveTo(hd.sides[0].x, hd.sides[0].y); ctx.lineTo(hd.rot.x, hd.rot.y); ctx.stroke();
      for (const c of hd.sc) dot(c, 8, m === 'distort' ? '#ffe9a8' : '#fff');
      if (m !== 'uniform') for (const c of hd.sides) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(c.x - 6, c.y - 6, 12, 12, 3) : ctx.rect(c.x - 6, c.y - 6, 12, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
      dot(hd.rot, 9, '#3d8bff');
      ctx.restore();
    },
    // bounds of the shape in layer space
    bounds(T) { const o = T.outline(12), xs = o.map((p) => p.x), ys = o.map((p) => p.y); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; },
    fit(cover) {
      this.act((T) => {
        const d = app.doc, b = this.bounds(T), w = b.x1 - b.x0, hh = b.y1 - b.y0;
        const k = (cover ? Math.max : Math.min)(d.width / w, d.height / hh);
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        T.affine(new DOMMatrix().translate(d.width / 2, d.height / 2).scale(k).translate(-cx, -cy));
      });
    },
    rotateBy(deg) { this.act((T) => { const C = T.center; T.affine(new DOMMatrix().translate(C.x, C.y).rotate(deg).translate(-C.x, -C.y)); }); },
    flip(hz) { this.act((T) => { const C = T.center; T.affine(new DOMMatrix().translate(C.x, C.y).scale(hz ? -1 : 1, hz ? 1 : -1).translate(-C.x, -C.y)); }); },
    more(anchor) {
      const T = app.transform;
      const body = h('div', { class: 'tf-more' },
        switchRow('Magnetic snapping (canvas centre & edges, 15° angles)', this.snap, (v) => { setPref('tf.snap', v); app.updateCtxBar(); }),
        field('Snapping distance', { min: 2, max: 40, step: 1, value: this.snapPx, fmt: (v) => v + ' px', onInput: (v) => setPref('tf.snapPx', v) }),
        switchRow('Scale from the centre (instead of the opposite corner)', this.fromCenter, (v) => setPref('tf.center', v)),
        h('div', { class: 'tf-grid' },
          cbBtn('↺ 90°', () => this.rotateBy(-90)), cbBtn('↻ 90°', () => this.rotateBy(90)),
          cbBtn('↺ 45°', () => this.rotateBy(-45)), cbBtn('180°', () => this.rotateBy(180)),
          cbBtn('Fill canvas', () => this.fit(true)), cbBtn('Centre', () => this.act((T2) => { const b = this.bounds(T2), d = app.doc; T2.affine(new DOMMatrix().translate(d.width / 2 - (b.x0 + b.x1) / 2, d.height / 2 - (b.y0 + b.y1) / 2)); })),
          cbBtn('Actual size', () => this.act((T2) => { const q = T2.corners(), b = T2.bbox, e1 = sub(q[1], q[0]), e2 = sub(q[3], q[0]); const kx = b.w / (Math.hypot(e1.x, e1.y) || 1), ky = b.h / (Math.hypot(e2.x, e2.y) || 1); T2.affine(axisScale(T2.center, e1, e2, kx, ky)); })),
          cbBtn('Straighten', () => this.act((T2) => { const q = T2.corners(), a = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180 / Math.PI, C = T2.center; T2.affine(new DOMMatrix().translate(C.x, C.y).rotate(-a).translate(-C.x, -C.y)); })),
          cbBtn('Undo step', () => { if (!this.stepBack()) toast('Nothing to undo in this transform'); }),
          cbBtn('Flatten warp', () => this.act((T2) => { if (T2.warp) { const q = T2.corners().map((p) => ({ ...p })); T2.warp = null; T2.q = q; } else toast('No warp to remove'); })),
        ));
      openPopover(anchor, { title: 'Transform options', body, width: 330, key: 'tf-more' });
      return T;
    },
    bar() {
      const m = this.mode;
      const moreBtn = cbBtn('More…', (e) => this.more(e.currentTarget));
      return [
        cbBtn('Freeform', () => this.setMode('freeform'), m === 'freeform'),
        cbBtn('Uniform', () => this.setMode('uniform'), m === 'uniform'),
        cbBtn('Distort', () => this.setMode('distort'), m === 'distort'),
        cbBtn('Warp', () => this.setMode('warp'), m === 'warp'), cbSep(),
        cbBtn('Snapping', () => { setPref('tf.snap', !this.snap); app.updateCtxBar(); }, this.snap),
        cbBtn('Flip H', () => this.flip(true)), cbBtn('Flip V', () => this.flip(false)),
        cbBtn('Rotate 45°', () => this.rotateBy(45)),
        cbBtn('Fit to canvas', () => this.fit(false)),
        cbBtn(app.transform && !app.transform.smooth ? 'Nearest' : 'Bilinear', () => this.act((T) => { T.smooth = !T.smooth; app.updateCtxBar(); }), !!(app.transform && app.transform.smooth)),
        cbBtn('Reset', () => this.act((T) => T.reset())),
        moreBtn,
        cbSep(), cbBtn('Cancel', () => t.cancel()), cbBtn('Done', done, false, 'primary'),
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
// The folder every Inkwell Learning canvas goes into (created on first use, found again even if renamed)
export const LEARNING_FOLDER = 'Inkwell Learning drafts';
export async function learningFolderId() {
  const fs = getFolders();
  const f = fs.find((x) => x.learning) || fs.find((x) => x.name === LEARNING_FOLDER);
  if (f) { if (!f.learning) setFolders(fs.map((x) => (x.id === f.id ? { ...x, learning: true } : x))); return f.id; }
  const n = await newFolder(LEARNING_FOLDER);
  setFolders(getFolders().map((x) => (x.id === n.id ? { ...x, learning: true } : x)));
  return n.id;
}
// once: move canvases made by Learning before this folder existed (recognised by their names)
export async function moveLearningDrafts(names) {
  if (store.prefs.get('mig.learnDrafts', false)) return 0;
  const metas = await store.listDocs().catch(() => []);
  const mine = metas.filter((m) => !m.folder && names.has(m.name));
  if (mine.length) { const id = await learningFolderId(); for (const m of mine) { m.folder = id; await store.saveMeta(m); } }
  store.prefs.set('mig.learnDrafts', true);
  return mine.length;
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
    for (const f of folders.filter((x) => !x.learning)) {
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

function moveDialog(app, m, after = () => renderGallery(app)) {
  const folders = getFolders();
  dialog({
    title: `Move "${m.name}"`, body: '',
    actions: [
      ...folders.filter((f) => f.id !== m.folder).map((f) => ({ label: '📁 ' + f.name, onClick: async () => { await moveToFolder(app, m, f.id); after(); } })),
      m.folder && { label: 'Gallery (no folder)', onClick: async () => { await moveToFolder(app, m, null); after(); } },
      { label: '＋ New folder…', onClick: async () => { const n = await promptDialog('New folder', 'Folder'); if (n == null) return; const f = await newFolder(n.trim() || 'Folder'); await moveToFolder(app, m, f.id); after(); } },
      { label: 'Cancel', primary: true },
    ].filter(Boolean),
  });
}

// Some layer images couldn't be read (iPad storage bug in earlier versions). Put the newest picture
// we still have (the last time-lapse frame, else the gallery thumbnail) on a Multiply layer on top so
// the work isn't lost.
async function recoverInto(doc, m) {
  const tryImg = async (blob) => { if (!blob) return null; const u = URL.createObjectURL(blob); try { return await loadImage(u); } catch { return null; } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); } };
  let img = null, from = '';
  const tl = doc.timelapse;
  if (tl && tl.count) {
    for (let n = tl.count - 1; n >= Math.max(0, tl.count - 6) && !img; n--) {
      const rec = await store.getTimelapse(doc.id + ':' + Math.floor(n / 40)).catch(() => null);
      img = await tryImg(rec && rec.frames[n % 40]);
    }
    if (img) from = 'time-lapse';
  }
  if (!img && m.thumb) { img = await tryImg(m.thumb); if (img) from = 'gallery preview'; }
  const names = doc.unreadable.join(', ');
  if (!img) return `Couldn’t read: ${names}. Those layers open empty.`;
  const l = new Layer(doc.width, doc.height, { name: `Recovered (${from})`, blend: 'multiply' });
  const x = l.canvas.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, doc.width, doc.height);
  touch(l.canvas);
  doc.layers.push(l);
  const ix = doc.items.indexOf(l); if (ix >= 0) doc.active = ix;
  return `Couldn’t read: ${names}. The last picture from the ${from} was added as the layer “Recovered” (Multiply) so you can keep working or trace over it.`;
}

// Copy a canvas. Fast path: copy the stored record. If that fails (images saved by older versions
// can be unreadable as-is on iPad), decode the drawing layer by layer and save it fresh.
async function duplicateDoc(app, m) {
  toast('Duplicating…', 8000);
  const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name = m.name + ' copy';
  const meta = { ...m, id, name, updated: Date.now(), created: Date.now() };
  try {
    const data = await store.loadDoc(m.id);
    if (!data) throw new Error('Canvas not found');
    try {
      await store.saveDoc({ ...data, id, name, timelapse: data.timelapse ? { ...data.timelapse, count: 0 } : null }, meta);
    } catch (e) {
      console.warn('fast duplicate failed, re-encoding', e);
      const doc = await Doc.deserialize(data);
      doc.id = id; doc.name = name; doc.timelapse = doc.timelapse ? { ...doc.timelapse, count: 0 } : null;
      const out = await doc.serialize(); out.id = id; out.name = name;
      let thumb = null; try { thumb = m.thumb ? new Blob([await m.thumb.arrayBuffer()], { type: m.thumb.type }) : null; } catch { /* no preview */ }
      await store.saveDoc(out, { ...meta, thumb });
    }
    toast('Duplicated as “' + name + '”', 2000);
  } catch (e) { console.error(e); toast('Couldn’t duplicate: ' + (e && e.message || e)); }
  renderGallery(app);
}

async function openSaved(app, m) {
  toast('Opening…', 6000);
  try {
    // a save still finishing in the background must land first, or we'd open the older copy
    if (app.saving && app.savePromise) await Promise.race([app.savePromise.catch(() => {}), new Promise((r) => setTimeout(r, 20000))]);
    const data = await store.loadDoc(m.id);
    if (!data) { toast('Document not found'); return; }
    const doc = await Doc.deserialize(data);
    doc.folder = m.folder || null;
    const lost = doc.unreadable && doc.unreadable.length ? await recoverInto(doc, m) : null;
    await app.openDoc(doc);
    $('#toast').hidden = true;
    if (lost) { app.dirtySave = true; toast(lost, 9000); }
  } catch (e) { console.error(e); toast('Could not open: ' + e.message); }
}

// `after` refreshes whichever screen shows the canvas (the Gallery, or Learning › My drafts)
function galleryMenu(app, m, after = () => renderGallery(app)) {
  dialog({
    title: m.name, body: '',
    actions: [
      { label: 'Move to folder…', onClick: () => { setTimeout(() => moveDialog(app, m, after), 0); } },
      { label: 'Rename', onClick: async () => { const n = await promptDialog('Rename', m.name); if (!n) return; try { const data = await store.loadDoc(m.id); data.name = n; await store.saveDoc(data, { ...m, name: n }); } catch (e) { console.error(e); toast('Couldn’t rename: ' + (e && e.message || e)); } after(); } },
      { label: 'Duplicate', onClick: () => duplicateDoc(app, m).then(after) },
      { label: 'Export project', onClick: async () => { const doc = await Doc.deserialize(await store.loadDoc(m.id)); download(await doc.toFile(), safeName(m.name) + '.inkwell'); } },
      { label: 'Delete', danger: true, onClick: async () => { if (await confirmDialog(`Delete "${m.name}"? This can't be undone.`, 'Delete', true)) { await store.deleteDoc(m.id); store.deleteTimelapse(m.id).catch(() => {}); after(); } } },
      { label: 'Close', primary: true },
    ],
  });
}

export { openSaved as openSavedCanvas, galleryMenu as canvasMenu };

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
  const files = await pickFile('.inkwell,.json,image/*,.sut,.brush,.brushset,.abr,' + Pal.PALETTE_ACCEPT + ',.inkwellbackup', true);
  if (files.length) await handleFiles(app, files);
}

// Any file handed to the app — from Import, or opened from Files / Safari / "Open in…" on iPad:
// brushes (Clip Studio .sut, Procreate .brush/.brushset), palettes, backups, projects, images.
export async function handleFiles(app, files) {
  const ext = (f) => (f.name.split('.').pop() || '').toLowerCase();
  // palettes
  const pals = files.filter((f) => ['swatches', 'aco', 'ase', 'gpl', 'hex', 'txt'].includes(ext(f)));
  for (const f of pals) {
    try {
      const list = Pal.loadPalettes();
      for (const pl of await Pal.importPaletteFile(f)) list.push({ id: uid(), name: pl.name, colors: pl.colors });
      Pal.savePalettes(list); toast(`Palette “${f.name.replace(/\.[^.]+$/, '')}” added`, 2500);
    } catch (e) { toast(`${f.name}: ${e.message || e}`, 3500); }
  }
  // a full backup
  for (const f of files.filter((f) => ext(f) === 'inkwellbackup')) {
    if (!(await confirmDialog(`Restore “${f.name}”? Canvases, brushes and settings in it are added back (nothing is deleted).`, 'Restore'))) continue;
    try { const r = await Backup.importBackup(f); toast(`Restored ${r.canvases} canvas${r.canvases === 1 ? '' : 'es'}`, 3000); if (!app.doc) renderGallery(app); } catch (e) { toast('Couldn’t restore: ' + (e.message || e), 4000); }
  }
  const brushFiles = files.filter((f) => /\.(sut|brush|brushset|abr)$/i.test(f.name));
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
