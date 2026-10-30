// UI panels: popovers, sliders, color, brushes (+Brush Studio), layers, actions, adjustments,
// gallery, dialogs, and the selection / transform / move / fill tools' context bars.
import {
  $, h, clamp, toast, dialog, confirmDialog, promptDialog, download, pickFile, makeCanvas, cloneCanvas,
  hsvToRgb, rgbToHsv, rgbToHex, hexToRgb, field, switchRow, seg, pct, canvasToBlob, loadImage,
} from './util.js';
import { ICONS } from './icons.js';
import { Doc, Layer, Track, BLEND_MODES, blendShort } from './doc.js';
import { snapshot, pixelCmd, withUndo } from './history.js';
import { StrokeEngine } from './engine.js';
import { DEFAULT_BRUSHES, GRAINS, getTipMask, preloadBrush, newBrushFrom, strokePreviewPoints, rawImageToMaskCanvas } from './brushes.js';
import { importBrushFiles } from './importers.js';
import { ADJUSTMENTS, FloatingTransform, alphaBounds } from './tools.js';
import * as store from './storage.js';
import * as Toon from './webtoon.js';

// ───────── popover ─────────
let pop = null;
export function openPopover(anchor, { title, body, width = 340, head = [], onClose, key }) {
  if (pop && pop.key === (key || title)) { closePopover(); return null; }
  closePopover();
  const el = $('#popover');
  el.innerHTML = '';
  el.style.width = width + 'px';
  el.append(h('div', { class: 'pop-head' }, h('h3', {}, title), h('div', { style: { display: 'flex', gap: '6px' } }, ...head)));
  const bodyEl = h('div', { class: 'pop-body' });
  if (body) bodyEl.append(body);
  el.append(bodyEl);
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  const W = Math.min(width, innerWidth - 16);
  el.style.left = clamp(r.left + r.width / 2 - W / 2, 8, innerWidth - W - 8) + 'px';
  el.style.top = (r.bottom + 8) + 'px';
  pop = { el, anchor, onClose, key: key || title, body: bodyEl };
  return pop;
}
export function closePopover() {
  if (!pop) return;
  const p = pop; pop = null;
  $('#popover').hidden = true;
  p.onClose && p.onClose();
}
document.addEventListener('pointerdown', (e) => {
  if (!pop) return;
  if (pop.el.contains(e.target) || pop.anchor.contains(e.target) || e.target.closest('.modal-bg')) return;
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
  const sync = () => {
    const v = clamp(get(), 0, 1);
    knob.style.bottom = `calc(${v * 100}% - ${v * 14}px)`;
    fill.style.height = v * 100 + '%';
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
  const onPos = (e) => {
    const r = el.getBoundingClientRect();
    set(clamp(1 - (e.clientY - r.top) / r.height, 0, 1));
    sync(); show();
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

export function openColor(app, anchor) {
  let [hh, s, v] = rgbToHsv(...hexToRgb(app.color));
  const sv = makeCanvas(300, 230);
  const svDot = h('div', { class: 'color-dot' }), hueDot = h('div', { class: 'color-dot' });
  const svBox = h('div', { class: 'color-sv' }, sv, svDot);
  const hue = h('div', { class: 'hue-bar' }, hueDot);
  const hex = h('input', { class: 'text-in', value: app.color, maxLength: 7 });
  const cur = h('div', { class: 'swatch-cur' });
  const histRow = h('div', { class: 'swatches' });
  const palRow = h('div', { class: 'swatches' });
  const drawSV = () => {
    const x = sv.getContext('2d');
    const [r, g, b] = hsvToRgb(hh, 1, 1);
    x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, 300, 230);
    let gr = x.createLinearGradient(0, 0, 300, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 300, 230);
    gr = x.createLinearGradient(0, 0, 0, 230); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000');
    x.fillStyle = gr; x.fillRect(0, 0, 300, 230);
  };
  const sync = (fromHex) => {
    const hexv = rgbToHex(...hsvToRgb(hh, s, v));
    svDot.style.left = s * 100 + '%'; svDot.style.top = (1 - v) * 100 + '%'; svDot.style.background = hexv;
    hueDot.style.left = (hh / 360) * 100 + '%'; hueDot.style.background = rgbToHex(...hsvToRgb(hh, 1, 1));
    cur.style.background = hexv;
    if (!fromHex) hex.value = hexv;
    app.setColor(hexv, false);
  };
  const commit = () => { app.setColor(app.color, true); renderSw(); };
  const drag = (el, fn) => {
    let on = false;
    el.addEventListener('pointerdown', (e) => { on = true; el.setPointerCapture(e.pointerId); fn(e); });
    el.addEventListener('pointermove', (e) => on && fn(e));
    el.addEventListener('pointerup', () => { on = false; commit(); });
  };
  drag(svBox, (e) => { const r = svBox.getBoundingClientRect(); s = clamp((e.clientX - r.left) / r.width, 0, 1); v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); sync(); });
  drag(hue, (e) => { const r = hue.getBoundingClientRect(); hh = clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360; drawSV(); sync(); });
  hex.addEventListener('change', () => {
    const val = hex.value.startsWith('#') ? hex.value : '#' + hex.value;
    if (!/^#[0-9a-f]{6}$/i.test(val)) return;
    [hh, s, v] = rgbToHsv(...hexToRgb(val)); drawSV(); sync(true); commit();
  });
  const pick = (c) => { [hh, s, v] = rgbToHsv(...hexToRgb(c)); drawSV(); sync(); commit(); };
  const renderSw = () => {
    histRow.innerHTML = '';
    for (const c of app.colorHistory) histRow.append(h('button', { style: { background: c }, onclick: () => pick(c) }));
    palRow.innerHTML = '';
    const pal = app.palette || DEFAULT_PALETTE;
    pal.forEach((c, i) => {
      const b = h('button', { style: { background: c } });
      let t;
      b.addEventListener('pointerdown', () => { t = setTimeout(async () => { t = null; if (await confirmDialog('Remove this swatch?', 'Remove', true)) { pal.splice(i, 1); app.palette = pal; store.prefs.set('palette', pal); renderSw(); } }, 600); });
      b.addEventListener('pointerup', () => { if (t) { clearTimeout(t); pick(c); } });
      palRow.append(b);
    });
    palRow.append(h('button', { class: 'add', title: 'Add current color', onclick: () => { const p = [...(app.palette || DEFAULT_PALETTE), app.color]; app.palette = p; store.prefs.set('palette', p); renderSw(); } }, '+'));
  };
  drawSV(); sync(); renderSw();
  const body = h('div', {}, svBox, hue, h('div', { class: 'color-row' }, cur, hex, h('span', { class: 'hint' }, 'Drag the color dot onto the canvas to fill (ColorDrop)')),
    h('div', { class: 'menu-section' }, 'History'), histRow, h('div', { class: 'menu-section' }, 'Palette  ·  hold a swatch to remove'), palRow);
  openPopover(anchor, { title: 'Color', body, width: 340 });
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
export function openBrushLibrary(app, anchor) {
  const toolName = app.paintToolName();
  const cats = () => [...new Set(app.brushes.map((b) => b.category || 'Other'))];
  let cat = app.brushFor(toolName).category || cats()[0];
  const catsEl = h('div', { class: 'brush-cats' });
  const listEl = h('div', { class: 'brush-list' });
  const render = () => {
    catsEl.innerHTML = '';
    for (const c of cats()) catsEl.append(h('button', { class: c === cat ? 'on' : '', onclick: () => { cat = c; render(); } }, c));
    listEl.innerHTML = '';
    const cur = app.brushFor(toolName);
    for (const b of app.brushes.filter((x) => (x.category || 'Other') === cat)) {
      const row = h('button', { class: 'brush-row' + (b.id === cur.id ? ' on' : '') },
        h('b', {}, b.name, h('span', {}, b.source || (b.override ? 'edited' : ''))), brushPreview(b));
      row.onclick = () => {
        if (b.id === app.brushFor(toolName).id) { closePopover(); openBrushStudio(app, b); return; }
        app.setBrush(b.id, toolName); render();
      };
      listEl.append(row);
    }
  };
  render();
  const head = [
    h('button', { class: 'small-btn', title: 'Import .sut (Clip Studio), .brush/.brushset (Procreate) or PNG tips', onclick: () => importBrushesFlow(app, () => { cat = 'Imported'; render(); }) }, 'Import'),
    h('button', { class: 'small-btn', onclick: () => { closePopover(); openBrushStudio(app, app.brushFor(toolName), true); } }, '＋ New'),
  ];
  const title = { brush: 'Brush Library', smudge: 'Smudge — brush', eraser: 'Eraser — brush' }[toolName];
  openPopover(anchor, { title, body: h('div', {}, h('div', { class: 'brush-lib' }, catsEl, listEl), h('p', { class: 'hint', style: { margin: '8px 4px 0' } }, 'Tap a selected brush again to edit it in Brush Studio.')), head, width: 420, key: 'brushes' });
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
    section('Dynamics (Apple Pencil)', num('sizePressure', 'Pressure → size', 0, 1, 0.01), num('minSize', 'Minimum size', 0, 1, 0.01), num('opacityPressure', 'Pressure → opacity', 0, 1, 0.01), num('flowPressure', 'Pressure → flow', 0, 1, 0.01), num('tiltSize', 'Tilt → size (shading)', 0, 4, 0.05), num('tiltOpacity', 'Tilt → opacity', 0, 1, 0.01)),
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
    padEngine.begin(padTarget, b, { kind: 'paint', color: app.color === '#ffffff' ? '#000000' : app.color, size: Math.min(b.size, 120), opacity: b.opacity, noUndo: true, simTaper: e.pointerType !== 'pen' });
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
    const def = DEFAULT_BRUSHES.find((x) => x.id === b.id);
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
const PROPS = ['name', 'visible', 'opacity', 'blend', 'alphaLock', 'clip', 'reference', 'panelMask', 'locked'];
function captureStruct(doc) {
  return { items: [...doc.items], props: doc.items.map((it) => Object.fromEntries(PROPS.map((k) => [k, it[k]]))), active: doc.active };
}
function restoreStruct(doc, s) {
  if (doc.mode === 'animate') doc.tracks = [...s.items]; else doc.layers = [...s.items];
  s.items.forEach((it, i) => Object.assign(it, s.props[i]));
  doc.active = s.active;
}
export function structCmd(app, label, fn) {
  const doc = app.doc;
  const before = captureStruct(doc);
  fn();
  const after = captureStruct(doc);
  app.history.push({ label, bytes: 1000, undo() { restoreStruct(doc, before); app.changed(); }, redo() { restoreStruct(doc, after); app.changed(); } });
  app.changed();
}
export function insertLayer(app, layer, index) {
  const d = app.doc;
  structCmd(app, 'Add layer', () => {
    const i = index ?? Math.min(d.active + 1, d.items.length);
    d.items.splice(i, 0, layer);
    d.active = i;
  });
}
function addTrack(app) {
  const d = app.doc;
  if (!app.canAddRaster()) return;
  const t = new Track({ name: 'Track ' + (d.tracks.length + 1) });
  d.addCel(t, d.playhead, 1);
  insertLayer(app, t);
}

let layersOpen = null;
export function onDocChanged(app) {
  if (!layersOpen) return;
  clearTimeout(layersOpen.t);
  layersOpen.t = setTimeout(() => layersOpen && layersOpen.render(), 250);
}

function thumbOf(app, it) {
  const box = h('div', { class: 'layer-thumb' });
  const d = app.doc;
  let src = null;
  if (it.type === 'raster') src = it.canvas;
  else if (it.type === 'track') { const c = it.celAt(d.playhead); src = c && c.canvas; }
  if (src) {
    const s = Math.min(54 / d.width, 40 / d.height);
    const c = makeCanvas(Math.max(1, d.width * s * 2), Math.max(1, d.height * s * 2));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    c.style.width = c.width / 2 + 'px';
    box.append(c);
  } else {
    box.style.background = '#3a3a42';
    box.innerHTML = it.type === 'frames' ? ICONS.panel : ICONS.balloon;
    box.firstChild.style.width = '24px';
  }
  return box;
}

export function openLayers(app, anchor) {
  app.finishTransient();
  const d = app.doc;
  let expanded = null;
  const list = h('div');
  const render = () => {
    list.innerHTML = '';
    const items = d.items;
    const maxR = app.maxRaster();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const vis = h('button', { class: 'layer-vis' + (it.visible ? ' on' : ''), onclick: (e) => { e.stopPropagation(); it.visible = !it.visible; app.changed(); render(); } });
      const tags = [it.alphaLock && 'α-lock', it.reference && 'reference', it.panelMask && 'panel mask', it.clip && 'clip'].filter(Boolean).join(' · ');
      const sub = it.type === 'frames' ? `${it.panels.length} panels` : it.type === 'balloons' ? `${it.balloons.length} balloons` : it.type === 'track' ? `${it.cels.length} drawings · ${it.keys.length} keys` : (tags || pct(it.opacity));
      const row = h('div', { class: 'layer-row' + (i === d.active ? ' on' : '') + (it.clip ? ' clip' : '') },
        thumbOf(app, it), h('div', { class: 'layer-name' }, h('b', {}, it.name), h('small', {}, sub)),
        h('span', { class: 'layer-blend' }, it.type === 'raster' || it.type === 'track' ? blendShort(it.blend) : ''), vis);
      row.onclick = () => {
        if (d.active === i) expanded = expanded === it ? null : it;
        else { d.active = i; expanded = null; if (it.type === 'balloons' && app.tool !== 'balloon' && d.mode === 'webtoon') app.setTool('balloon'); if (it.type === 'frames' && d.mode === 'webtoon') app.setTool('panel'); }
        render(); app.requestRender();
        if (d.mode === 'animate') app.timeline.refresh();
      };
      list.append(row);
      if (expanded === it) list.append(layerOptions(app, it, i, render));
    }
    // background
    if (d.mode !== 'animate' || true) {
      const colorIn = h('input', { type: 'color', value: d.bg });
      colorIn.oninput = () => { d.bg = colorIn.value; app.changed(); };
      list.append(h('div', { class: 'bg-row' }, h('span', { style: { flex: 1 } }, 'Background'), colorIn,
        h('button', { class: 'layer-vis' + (d.bgVisible ? ' on' : ''), onclick: () => { d.bgVisible = !d.bgVisible; app.changed(); render(); } })));
    }
    list.append(h('p', { class: 'hint', style: { margin: '8px 4px' } }, `${d.rasterCount()} / ${maxR} ${d.mode === 'animate' ? 'drawings' : 'raster layers'} available at ${d.width}×${d.height}. Tap a selected layer for options.`));
  };
  const addBtn = h('button', { class: 'icon-btn', title: 'Add', html: ICONS.plus });
  addBtn.onclick = () => {
    if (d.mode === 'animate') { addTrack(app); render(); return; }
    if (d.mode === 'webtoon') {
      dialog({ title: 'Add', body: '', actions: [
        { label: 'Raster layer', primary: true, onClick: () => { if (app.canAddRaster()) insertLayer(app, new Layer(d.width, d.height, { name: 'Layer ' + (d.layers.length + 1), panelMask: true })); render(); } },
        { label: 'Panel layer', onClick: () => { insertLayer(app, new Layer(d.width, d.height, { type: 'frames', name: 'Panels' })); render(); } },
        { label: 'Balloon layer', onClick: () => { insertLayer(app, new Layer(d.width, d.height, { type: 'balloons', name: 'Balloons' })); render(); } },
        { label: 'Cancel' },
      ] });
      return;
    }
    if (app.canAddRaster()) { insertLayer(app, new Layer(d.width, d.height, { name: 'Layer ' + (d.layers.length + 1) })); render(); }
  };
  const p = openPopover(anchor, { title: d.mode === 'animate' ? 'Tracks' : 'Layers', body: list, head: [addBtn], width: 340, key: 'layers', onClose: () => { layersOpen = null; } });
  if (!p) return;
  layersOpen = { render };
  render();
}

function layerOptions(app, it, i, rerender) {
  const d = app.doc;
  const box = h('div', { class: 'layer-opts' });
  const btn = (label, fn, cls = '') => h('button', { class: 'small-btn ' + cls, onclick: () => { fn(); rerender(); } }, label);
  box.append(h('button', { class: 'small-btn', onclick: async () => { const n = await promptDialog('Rename', it.name); if (n) { structCmd(app, 'Rename', () => { it.name = n; }); rerender(); } } }, 'Rename “' + it.name + '”'));
  let opStart = null;
  const op = field('Opacity', { min: 0, max: 1, step: 0.01, value: it.opacity, fmt: pct, onInput: (v) => { if (!opStart) opStart = captureStruct(d); it.opacity = v; app.requestRender(); } });
  op.querySelector('input').addEventListener('change', () => {
    if (!opStart) return; const before = opStart; opStart = null; const after = captureStruct(d);
    app.history.push({ label: 'Opacity', undo() { restoreStruct(d, before); app.changed(); }, redo() { restoreStruct(d, after); app.changed(); } });
    app.changed();
  });
  box.append(op);
  if (it.type === 'raster' || it.type === 'track') {
    const sel = h('select', {}, ...BLEND_MODES.map(([v, l]) => h('option', { value: v, selected: it.blend === v }, l)));
    sel.onchange = () => { structCmd(app, 'Blend mode', () => { it.blend = sel.value; }); rerender(); };
    box.append(sel);
    box.append(switchRow('Alpha lock', it.alphaLock, (v) => structCmd(app, 'Alpha lock', () => { it.alphaLock = v; })));
    box.append(switchRow('Clipping mask', it.clip, (v) => { structCmd(app, 'Clipping mask', () => { it.clip = v; }); rerender(); }));
    box.append(switchRow('Reference layer (fill reads this)', it.reference, (v) => structCmd(app, 'Reference', () => { it.reference = v; })));
    if (d.mode === 'webtoon' && it.type === 'raster') box.append(switchRow('Mask to panels', it.panelMask, (v) => structCmd(app, 'Panel mask', () => { it.panelMask = v; })));
  }
  if (it.type === 'frames') {
    box.append(field('Border width', { min: 0, max: 30, step: 1, value: it.border, fmt: (v) => v + ' px', onInput: (v) => { it.border = v; app.changed(); } }));
    const ci = h('input', { type: 'color', value: it.borderColor }); ci.oninput = () => { it.borderColor = ci.value; app.changed(); };
    box.append(h('div', { class: 'toggle-row' }, h('span', {}, 'Border color'), ci));
  }
  const g = h('div', { class: 'grid2' });
  g.append(btn('Move up ↑', () => move(1)), btn('Move down ↓', () => move(-1)));
  const move = (dir) => {
    const j = i + dir; if (j < 0 || j >= d.items.length) return;
    structCmd(app, 'Reorder', () => { const arr = d.items; [arr[i], arr[j]] = [arr[j], arr[i]]; d.active = j; });
  };
  if (it.type === 'raster' || it.type === 'track') {
    g.append(btn('Duplicate', () => {
      if (!app.canAddRaster(it.type === 'track' ? it.cels.length : 1)) return;
      let copy;
      if (it.type === 'raster') { copy = new Layer(d.width, d.height, { ...it, id: null, name: it.name + ' copy' }); copy.canvas.getContext('2d').drawImage(it.canvas, 0, 0); }
      else { copy = new Track({ ...it, id: null, name: it.name + ' copy', keys: JSON.parse(JSON.stringify(it.keys)) }); for (const c of it.cels) { const n = d.addCel(copy, c.start, c.dur); n.canvas.getContext('2d').drawImage(c.canvas, 0, 0); } }
      insertLayer(app, copy, i + 1);
    }));
    if (it.type === 'raster' && i > 0 && d.items[i - 1].type === 'raster') g.append(btn('Merge down', () => mergeDown(app, i)));
    const target = () => (it.type === 'raster' ? it.canvas : (it.celAt(d.playhead) || {}).canvas);
    g.append(btn('Clear', () => { const c = target(); if (!c) return; withUndo(app.history, c, 'Clear', (x) => {
      if (app.selection.active) { x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(app.selection.mask, 0, 0); x.restore(); } else x.clearRect(0, 0, c.width, c.height);
    }, () => app.requestRender()); app.changed(); }));
    g.append(btn('Fill with color', () => { const c = target(); if (!c) return; withUndo(app.history, c, 'Fill layer', (x) => {
      x.save(); x.fillStyle = app.color; x.globalCompositeOperation = it.alphaLock ? 'source-atop' : 'source-over';
      if (app.selection.active) { const t = makeCanvas(c.width, c.height), tx = t.getContext('2d'); tx.fillStyle = app.color; tx.fillRect(0, 0, c.width, c.height); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(app.selection.mask, 0, 0); x.drawImage(t, 0, 0); }
      else x.fillRect(0, 0, c.width, c.height);
      x.restore();
    }, () => app.requestRender()); app.changed(); }));
    if (it.type === 'raster') g.append(btn('Select (alpha)', () => { app.selection.fromAlpha(it.canvas); app.selectionChanged(); app.setTool('select'); }));
    if (it.type === 'raster') g.append(btn('Invert pixels', () => withUndo(app.history, it.canvas, 'Invert', (x) => {
      const id = x.getImageData(0, 0, it.canvas.width, it.canvas.height);
      for (let k = 0; k < id.data.length; k += 4) { id.data[k] = 255 - id.data[k]; id.data[k + 1] = 255 - id.data[k + 1]; id.data[k + 2] = 255 - id.data[k + 2]; }
      x.putImageData(id, 0, 0);
    }, () => app.changed())));
  }
  g.append(btn('Delete', () => {
    structCmd(app, 'Delete layer', () => { d.items.splice(i, 1); d.active = clamp(d.active >= i ? d.active - 1 : d.active, 0, Math.max(0, d.items.length - 1)); });
  }, 'danger'));
  box.append(g);
  return box;
}

function mergeDown(app, i) {
  const d = app.doc, up = d.layers[i], low = d.layers[i - 1];
  const beforePx = cloneCanvas(low.canvas);
  const before = captureStruct(d);
  const x = low.canvas.getContext('2d');
  x.save(); x.globalAlpha = up.opacity; x.globalCompositeOperation = up.clip ? 'source-atop' : up.blend; x.drawImage(up.canvas, 0, 0); x.restore();
  const afterPx = cloneCanvas(low.canvas);
  d.layers.splice(i, 1); d.active = i - 1;
  const after = captureStruct(d);
  const put = (c) => { x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(c, 0, 0); x.restore(); };
  app.history.push({ label: 'Merge', bytes: d.pixelBytes * 2, undo() { put(beforePx); restoreStruct(d, before); app.changed(); }, redo() { put(afterPx); restoreStruct(d, after); app.changed(); } });
  app.changed();
}

// ───────── actions ─────────
const menuItem = (icon, label, fn, extra) => h('button', { class: 'menu-item', onclick: () => { closePopover(); fn(); } }, h('span', { html: ICONS[icon] || '' }), label, extra ? h('small', {}, extra) : null);

export function openActions(app, anchor) {
  app.finishTransient();
  const d = app.doc;
  const body = h('div');
  const sec = (t) => body.append(h('div', { class: 'menu-section' }, t));
  sec('Add');
  body.append(menuItem('image', 'Insert a photo / image', async () => { const [f] = await pickFile('image/*'); if (f) app.insertImage(f); }));
  body.append(menuItem('brushImport', 'Import brushes (.sut · .brush · .brushset · .png)', () => importBrushesFlow(app)));
  sec('Canvas');
  body.append(menuItem('canvas', 'Canvas size…', () => resizeDialog(app), `${d.width}×${d.height}`));
  body.append(menuItem('sym', 'Flip view horizontally', () => { app.view.flip *= -1; app.fitView(); }, app.view.flip < 0 ? 'on' : ''));
  body.append(menuItem('sym', 'Symmetry guide…', () => symmetryDialog(app), app.symmetry.mode));
  body.append(menuItem('canvas', 'Rename document', async () => { const n = await promptDialog('Name', d.name); if (n) { d.name = n; $('#doc-title').textContent = n; app.changed(); } }));
  if (d.mode === 'webtoon') {
    sec('Webtoon');
    body.append(menuItem('panel', 'Auto panel layout…', () => Toon.autoPanelsDialog(app)));
    body.append(menuItem('canvas', 'Extend canvas height…', () => Toon.extendDialog(app)));
    body.append(menuItem('video', 'Phone scroll preview', () => Toon.phonePreview(app)));
    body.append(menuItem('share', 'Export episode slices (.zip)', () => Toon.exportSlicesDialog(app)));
  }
  if (d.mode === 'animate') {
    sec('Animation');
    body.append(menuItem('share', 'Export animated GIF', () => app.timeline.exportGif()));
    body.append(menuItem('video', 'Export video (MP4/WebM)', () => app.timeline.exportVideo()));
    body.append(menuItem('share', 'Export PNG frames (.zip)', () => app.timeline.exportFrames()));
  }
  sec('Share');
  body.append(menuItem('share', 'Export PNG', () => exportImage(app, 'png')));
  body.append(menuItem('share', 'Export JPEG', () => exportImage(app, 'jpeg')));
  body.append(menuItem('share', 'Export layers as PNGs (.zip)', () => exportLayers(app)));
  body.append(menuItem('copy', 'Export project (.inkwell)', async () => download(await d.toFile(), safeName(d.name) + '.inkwell')));
  sec('Preferences');
  body.append(menuItem('settings', 'Settings', () => openSettings(app)));
  body.append(menuItem('help', 'Gestures & shortcuts', () => helpDialog()));
  openPopover(anchor, { title: 'Actions', body, width: 330 });
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
    if (l.type === 'raster') l.canvas = move(l.canvas);
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

export function openSettings(app) {
  const s = app.settings;
  const save = () => app.applySettings();
  const body = h('div', {},
    h('div', { class: 'menu-section' }, 'Interface'),
    switchRow('Right-hand sidebar', s.rightHanded, (v) => { s.rightHanded = v; save(); }),
    switchRow('Brush cursor (hover)', s.cursor, (v) => { s.cursor = v; save(); }),
    switchRow('Gestures (pinch / rotate / pan)', s.gestures, (v) => { s.gestures = v; save(); }),
    h('div', { class: 'menu-section' }, 'Apple Pencil'),
    h('div', { class: 'stack' }, h('label', {}, 'Finger behaviour'), seg([['auto', 'Auto (pencil only once detected)'], ['on', 'Pencil only'], ['off', 'Fingers draw']], s.penOnly, (v) => { s.penOnly = v; save(); })),
    field('Pressure curve (lower = softer touch)', { min: 0.3, max: 2.5, step: 0.05, value: s.pressureGamma, fmt: (v) => v.toFixed(2), onInput: (v) => { s.pressureGamma = v; save(); } }),
    switchRow('QuickShape (hold at end of a stroke)', s.quickShape, (v) => { s.quickShape = v; save(); }),
    field('QuickShape delay', { min: 250, max: 1500, step: 50, value: s.quickShapeDelay, fmt: (v) => v + ' ms', onInput: (v) => { s.quickShapeDelay = v; save(); } }),
    h('div', { class: 'menu-section' }, 'Performance'),
    field('Memory budget for layers', { min: 200, max: 3000, step: 50, value: s.memoryMB, fmt: (v) => v + ' MB', onInput: (v) => { s.memoryMB = v; save(); } }),
    h('p', { class: 'hint' }, 'iPads give Safari a limited amount of canvas memory. Raise this on newer iPads (M-series); lower it if the app reloads unexpectedly.'),
    switchRow('Autosave', s.autosave, (v) => { s.autosave = v; save(); }),
  );
  dialog({ title: 'Settings', body, actions: [{ label: 'Done', primary: true }] });
}

function helpDialog() {
  const row = (a, b) => h('div', { class: 'toggle-row' }, h('span', {}, a), h('span', { class: 'hint' }, b));
  dialog({
    title: 'Gestures & shortcuts', wide: true,
    body: h('div', {},
      row('Two-finger tap', 'Undo (hold the undo button to rewind fast)'), row('Three-finger tap', 'Redo'), row('Four-finger tap', 'Hide / show interface'),
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
  let pending = false, done = false;
  const run = () => {
    if (pending) return; pending = true;
    requestAnimationFrame(() => {
      pending = false; if (done) return;
      const img = new ImageData(new Uint8ClampedArray(orig.data), bb.w, bb.h);
      adj.run(img.data, { ...params, color: app.color }, bb.w, bb.h);
      if (maskData) {
        const o = orig.data, n = img.data;
        for (let i = 0; i < n.length; i += 4) { const m = maskData[i + 3] / 255; if (m >= 1) continue; for (let k = 0; k < 4; k++) n[i + k] = o[i + k] + (n[i + k] - o[i + k]) * m; }
      }
      ctx.putImageData(img, bb.x, bb.y);
      app.requestRender();
    });
  };
  const apply = () => {
    if (done) return; done = true;
    const cmd = pixelCmd(c, { x: bb.x, y: bb.y, w: bb.w, h: bb.h }, adj.name, () => app.requestRender());
    if (cmd) app.history.push(cmd);
    app.changed();
  };
  const cancel = () => { if (done) return; done = true; ctx.putImageData(orig, bb.x, bb.y); app.requestRender(); };
  const body = h('div');
  for (const [k, label, min, max, def, step] of adj.params) body.append(field(label, { min, max, step, value: def, fmt: (v) => (step < 1 ? (+v).toFixed(2) : Math.round(v)), onInput: (v) => { params[k] = v; run(); } }));
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

export function selectTool(app) {
  const selCmd = (label, fn) => {
    const s = app.selection, before = s.snapshot();
    fn();
    const after = s.snapshot();
    app.history.push({ label, bytes: s.w * s.h * 8, undo() { s.restore(before); app.selectionChanged(); }, redo() { s.restore(after); app.selectionChanged(); } });
    app.selectionChanged();
  };
  const t = {
    mode: 'freehand', op: 'replace',
    down(p) { this.pts = [{ x: p.x, y: p.y }]; this.p0 = p; this.p1 = p; },
    move(p) {
      if (!this.pts) return;
      this.p1 = p;
      const last = this.pts[this.pts.length - 1];
      if (this.mode === 'freehand' && Math.hypot(p.x - last.x, p.y - last.y) * app.view.zoom > 3) this.pts.push({ x: p.x, y: p.y });
    },
    shape() {
      const a = this.p0, b = this.p1;
      if (this.mode === 'rect') return { type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      if (this.mode === 'ellipse') return { type: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 };
      return { type: 'poly', pts: this.pts };
    },
    up() {
      if (!this.pts) return;
      const tiny = Math.hypot(this.p1.sx - this.p0.sx, this.p1.sy - this.p0.sy) < 6 && this.pts.length < 4;
      if (tiny) { if (app.selection.active && this.op === 'replace') selCmd('Deselect', () => app.selection.clear()); }
      else { const sh = this.shape(); selCmd('Select', () => app.selection.apply(sh, this.op)); }
      this.pts = null;
      app.requestRender(); app.updateCtxBar();
    },
    cancel() { this.pts = null; },
    overlay(ctx, px) {
      if (!this.pts) return;
      ctx.save(); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = '#3d8bff'; ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath();
      const sh = this.shape();
      if (sh.type === 'poly') { ctx.moveTo(sh.pts[0].x, sh.pts[0].y); for (const q of sh.pts) ctx.lineTo(q.x, q.y); }
      else if (sh.type === 'rect') ctx.rect(sh.x, sh.y, sh.w, sh.h);
      else ctx.ellipse(sh.cx, sh.cy, sh.rx, sh.ry, 0, 0, Math.PI * 2);
      ctx.stroke(); ctx.restore();
    },
    onDelete() { clearSelected(); },
    bar() {
      const modes = [['freehand', 'Freehand'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']].map(([v, l]) => cbBtn(l, () => { t.mode = v; app.updateCtxBar(); }, t.mode === v));
      const ops = [['replace', 'New'], ['add', 'Add'], ['subtract', 'Subtract']].map(([v, l]) => cbBtn(l, () => { t.op = v; app.updateCtxBar(); }, t.op === v));
      const act = app.selection.active;
      return [...modes, cbSep(), ...ops, cbSep(),
        cbBtn('All', () => selCmd('Select all', () => app.selection.selectAll())),
        act && cbBtn('Invert', () => selCmd('Invert selection', () => app.selection.invert())),
        act && cbBtn('Deselect', () => selCmd('Deselect', () => app.selection.clear())),
        act && cbSep(),
        act && cbBtn('Copy → layer', () => copyToLayer(false)),
        act && cbBtn('Cut → layer', () => copyToLayer(true)),
        act && cbBtn('Fill', () => fillSelected()),
        act && cbBtn('Clear', () => clearSelected()),
        act && cbBtn('Transform', () => app.setTool('transform')),
      ].filter(Boolean);
    },
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
    toast(cut ? 'Cut to new layer' : 'Copied to new layer');
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
      T.update(); app.requestRender();
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
      tr.setKey(f, { ...tr.transformAt(f), ...(app.timeline.recording ? {} : {}), x: this.t0.x + this.last.x - this.p0.x, y: this.t0.y + this.last.y - this.p0.y });
      app.requestRender();
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
export async function renderGallery(app) {
  const grid = $('#gal-grid');
  for (const u of thumbURLs) URL.revokeObjectURL(u);
  thumbURLs = [];
  let metas = [];
  try { metas = await store.listDocs(); } catch (e) { console.warn(e); }
  metas.sort((a, b) => b.updated - a.updated);
  grid.innerHTML = '';
  if (!metas.length) { grid.append(h('div', { class: 'gal-empty' }, 'No artwork yet — pick a mode above or tap ＋ New.')); return; }
  for (const m of metas) {
    const url = m.thumb ? URL.createObjectURL(m.thumb) : '';
    if (url) thumbURLs.push(url);
    const card = h('div', { class: 'gal-card' },
      h('button', { class: 'gal-thumb', style: { backgroundImage: url ? `url(${url})` : '', width: '100%', display: 'block' }, onclick: () => openSaved(app, m.id) }),
      h('button', { class: 'gal-more', onclick: () => galleryMenu(app, m) }, '⋯'),
      h('div', { class: 'gal-meta' }, h('b', {}, m.name), h('span', { class: 'badge ' + m.mode }, { paint: 'Illustration', animate: 'Animation', webtoon: 'Webtoon' }[m.mode] || m.mode)),
      h('small', { class: 'hint' }, `${m.width}×${m.height} · ${new Date(m.updated).toLocaleDateString()}`));
    grid.append(card);
  }
}

async function openSaved(app, id) {
  toast('Opening…', 6000);
  try {
    const data = await store.loadDoc(id);
    if (!data) { toast('Document not found'); return; }
    const doc = await Doc.deserialize(data);
    await app.openDoc(doc);
    $('#toast').hidden = true;
  } catch (e) { console.error(e); toast('Could not open: ' + e.message); }
}

function galleryMenu(app, m) {
  dialog({
    title: m.name, body: '',
    actions: [
      { label: 'Rename', onClick: async () => { const n = await promptDialog('Rename', m.name); if (!n) return; const data = await store.loadDoc(m.id); data.name = n; await store.saveDoc(data, { ...m, name: n }); renderGallery(app); } },
      { label: 'Duplicate', onClick: async () => { const data = await store.loadDoc(m.id); const id = 'd' + Date.now().toString(36); await store.saveDoc({ ...data, id, name: m.name + ' copy' }, { ...m, id, name: m.name + ' copy', updated: Date.now() }); renderGallery(app); } },
      { label: 'Export project', onClick: async () => { const doc = await Doc.deserialize(await store.loadDoc(m.id)); download(await doc.toFile(), safeName(m.name) + '.inkwell'); } },
      { label: 'Delete', danger: true, onClick: async () => { if (await confirmDialog(`Delete "${m.name}"? This can't be undone.`, 'Delete', true)) { await store.deleteDoc(m.id); renderGallery(app); } } },
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
      await app.openDoc(doc); app.dirtySave = true; await app.saveNow();
    }
  }
}
