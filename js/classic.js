// Classic studio workspace (the hidden layout behind the Inkwell logo), arranged the way Clip
// Studio Paint arranges its studio: a menu bar and a command bar across the top, the tool
// palette down the far left, the Sub Tool palette (the brushes of the current tool, in groups)
// and the Tool Property palette (size, opacity, stabilization… as horizontal value bars) next
// to it with a Brush Size palette, Colour and Layers docked on the right with a Layer Property
// bar (blend mode + opacity) on top of the layers, and a status bar under the canvas (zoom,
// rotation). Everything here drives the same app underneath; only the arrangement changes.
import { $, h, clamp, toast } from './util.js';
import { ICONS } from './icons.js';
import { Layer, BLEND_MODES } from './doc.js';
import * as store from './storage.js';
import { preloadBrush } from './brushes.js';
import { structCmd, insertLayer, openLayers } from './layers.js';
import * as UI from './ui.js';
import { openOutline } from './filters.js';
import { openStacks } from './stacks.js';

let app = null, root = null, built = false, ticker = 0;
const on = () => document.body.classList.contains('classic-ui') && !$('#studio').hidden && !!app.doc;
const PAINT = ['brush', 'eraser', 'smudge'];

// ───────── value bars (Clip Studio's Tool Property sliders: drag anywhere on the bar) ─────────
function valueBar(label, { get, set, min, max, fmt = (v) => Math.round(v), log = false, step = 0, done }) {
  const fill = h('div', { class: 'cs-vb-fill' }), val = h('span', { class: 'cs-vb-val' });
  const bar = h('div', { class: 'cs-vb-bar' }, fill, val);
  const toT = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (t) => { let v = log ? min * Math.pow(max / min, t) : min + (max - min) * t; if (step) v = Math.round(v / step) * step; return clamp(v, min, max); };
  const sync = () => { const v = get(); fill.style.width = clamp(toT(v), 0, 1) * 100 + '%'; val.textContent = fmt(v); };
  let drag = null;
  bar.addEventListener('pointerdown', (e) => { e.preventDefault(); bar.setPointerCapture(e.pointerId); drag = { r: bar.getBoundingClientRect() }; move(e); });
  const move = (e) => { if (!drag) return; set(fromT(clamp((e.clientX - drag.r.left) / drag.r.width, 0, 1))); sync(); };
  bar.addEventListener('pointermove', move);
  const end = () => { if (!drag) return; drag = null; done && done(); };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  const nudge = (d) => { const v = get(); set(clamp(log ? v * (d > 0 ? 1.1 : 1 / 1.1) : v + d * (step || (max - min) / 100), min, max)); sync(); done && done(); };
  const row = h('div', { class: 'cs-vb' }, h('label', {}, label),
    h('button', { class: 'cs-vb-step', onclick: () => nudge(-1) }, '−'), bar, h('button', { class: 'cs-vb-step', onclick: () => nudge(1) }, '+'));
  row.sync = sync; sync();
  return row;
}

// ───────── menus ─────────
let openMenu = null;
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; for (const b of root.querySelectorAll('.cs-menubar > button')) b.classList.remove('on'); } }
function showMenu(btn, items) {
  const was = openMenu && openMenu.dataset.for === btn.textContent;
  closeMenu(); if (was) return;
  const m = h('div', { class: 'cs-menu' });
  m.dataset.for = btn.textContent;
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('div', { class: 'cs-menu-sep' })); continue; }
    const [label, fn, hint, disabled] = it;
    m.append(h('button', { class: 'cs-menu-item', disabled: !!disabled, onclick: (e) => { closeMenu(); fn(e, btn); } }, h('span', {}, label), hint ? h('small', {}, hint) : null));
  }
  const r = btn.getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - 250) + 'px'; m.style.top = r.bottom + 'px';
  document.body.append(m); openMenu = m; btn.classList.add('on');
}
const active = () => app.doc && app.doc.activeItem;
const rerenderLayers = () => { if (UI.floatOpen('layers')) UI.dockClassic(app); };
function duplicateActive() {
  const d = app.doc, it = active();
  if (!it || it.type !== 'raster' || !app.canAddRaster()) { toast('Pick a paint layer to duplicate'); return; }
  const copy = new Layer(d.width, d.height, { ...it, id: null, name: it.name + ' copy' });
  copy.canvas.getContext('2d').drawImage(it.canvas, 0, 0);
  insertLayer(app, copy, d.active + 1); rerenderLayers();
}
function menus() {
  const d = app.doc, anim = d.mode === 'animate', sel = app.selection;
  const selCmd = (label, fn, hud) => app.selectionCmd(label, fn, hud);
  return {
    File: [
      ['New canvas…', () => UI.newDocDialog(app, d.mode)],
      ['Save', async () => { await app.saveNow(true); toast('Saved ✓', 1200); }, '⌘S'],
      ['Export / Share…', (e, b) => UI.openActions(app, b)],
      '-',
      ['Close canvas (Gallery)', () => app.closeDoc()],
      ['Preferences…', () => UI.openSettings(app)],
    ],
    Edit: [
      ['Undo', () => app.undo(), '⌘Z', !app.history.canUndo],
      ['Redo', () => app.redo(), '⇧⌘Z', !app.history.canRedo],
      '-',
      ['Transform', () => app.setTool('transform'), 'V'],
      ['Liquify', () => app.setTool('liquify')],
      ['Fill', () => app.setTool('fill'), 'G'],
      '-',
      ['Tonal correction / Adjustments…', (e, b) => UI.openAdjustments(app, b)],
    ],
    Layer: [
      ['New raster layer', () => { if (anim) { toast('Use ＋ Track in the timeline'); return; } if (app.canAddRaster()) { insertLayer(app, new Layer(d.width, d.height, { name: 'Layer ' + (d.layers.filter((l) => l.isRaster).length + 1), panelMask: d.mode === 'webtoon' })); rerenderLayers(); } }],
      ['New layer folder', () => { if (anim) return; const g = new Layer(d.width, d.height, { type: 'group', name: 'Folder' }); insertLayer(app, g); rerenderLayers(); }, '', anim],
      ['Duplicate layer', () => duplicateActive(), '', anim],
      '-',
      ['Clip to layer below', () => { const it = active(); if (!it) return; structCmd(app, it.clip ? 'Release clipping' : 'Clipping mask', () => { it.clip = !it.clip; }); rerenderLayers(); }, active() && active().clip ? 'on' : ''],
      ['Lock layer', () => { const it = active(); if (!it) return; structCmd(app, it.locked ? 'Unlock layer' : 'Lock layer', () => { it.locked = !it.locked; }); rerenderLayers(); }, active() && active().locked ? 'on' : ''],
      ['Lock transparent pixels', () => { const it = active(); if (!it) return; structCmd(app, 'Alpha lock', () => { it.alphaLock = !it.alphaLock; }); rerenderLayers(); }, active() && active().alphaLock ? 'on' : ''],
      ['Reference layer', () => { const it = active(); if (!it) return; structCmd(app, 'Reference', () => { it.reference = !it.reference; }); rerenderLayers(); }, active() && active().reference ? 'on' : ''],
      ['Rasterize 3D layer (shaded)', () => { const it = active(); if (it && it.type === '3d') import('./three3d.js').then((m) => m.rasterizeLayer(app, it, false)); }, '', !(active() && active().type === '3d')],
      ['Shaded copy of 3D layer (keep the 3D)', () => { const it = active(); if (it && it.type === '3d') import('./three3d.js').then((m) => m.rasterizeLayer(app, it, true)); }, '', !(active() && active().type === '3d')],
      ['Hide from time-lapse (private)', () => { const it = active(); if (!it) return; structCmd(app, 'Private', () => { it.private = !it.private; }); if (it.private && app.tlapse) app.tlapse.privatized(it); rerenderLayers(); }, active() && active().private ? 'on' : ''],
    ],
    Select: [
      ['Select all', () => selCmd('Select all', () => sel.selectAll(), 'All')],
      ['Deselect', () => selCmd('Deselect', () => sel.clear(), 'Deselected'), '', !sel.active],
      ['Reselect', () => app.reselect()],
      ['Invert selected area', () => selCmd('Invert selection', () => sel.invert(), 'Inverted')],
      '-',
      ['Selection tool', () => app.setTool('select')],
    ],
    View: [
      ['Zoom in', () => app.zoomBy(1.25)],
      ['Zoom out', () => app.zoomBy(0.8)],
      ['100%', () => app.zoomBy(1 / app.view.zoom)],
      ['Fit to window', () => app.fitView()],
      '-',
      ['Rotate left 15°', () => rotateBy(-15)],
      ['Rotate right 15°', () => rotateBy(15)],
      ['Reset rotation', () => { app.view.rot = 0; app.fitView(); }],
      ['Flip horizontal', () => { app.view.flip *= -1; app.fitView(); }, app.view.flip < 0 ? 'on' : ''],
      '-',
      ['Perspective ruler', () => app.setTool('persp')],
    ],
    Filter: [
      ['Adjustments…', (e, b) => UI.openAdjustments(app, b)],
      ['Outline…', (e, b) => openOutline(app, b)],
      ['Colouring stacks…', (e, b) => openStacks(app, b)],
      ['Liquify', () => app.setTool('liquify')],
    ],
    Window: [
      ['Colour wheel & Layers', () => UI.dockClassic(app, true)],
      ['Brush library…', (e, b) => UI.openBrushLibrary(app, b)],
      ['Reference', () => app.reference && app.reference.toggle()],
      anim ? ['Cut library (draw over a cut)', () => UI.openCutLibrary(app)] : null,
      anim ? ['Timeline', () => { const t = $('#timeline .tl-collapse, #timeline [title*="ollapse"]'); if (t) t.click(); }] : null,
      '-',
      ['Hide interface', () => document.body.classList.toggle('ui-hidden'), '4 fingers'],
    ],
    Help: [
      ['Gestures & shortcuts…', () => UI.openActions(app, $('#cs-help'))],
      ['Inkwell layout', () => app.toggleClassic(), 'leave this layout'],
    ],
  };
}
function rotateBy(deg) {
  const c = app.screenToDoc(app.vw / 2, app.vh / 2);
  app.view.rot += deg * Math.PI / 180;
  app.setViewAt(c, { x: app.vw / 2, y: app.vh / 2 });
  app.requestRender('view');
}

// ───────── sub tool / tool property ─────────
let subCat = null;
function subToolPanel() {
  const tabs = h('div', { class: 'cs-subtabs' }), list = h('div', { class: 'cs-sublist' });
  let key = '';
  const draw = (force) => {
    const tool = app.paintToolName(), cur = app.brushFor(tool);
    const k = tool + ':' + cur.id + ':' + subCat + ':' + app.brushes.length;
    if (k === key && force !== true) return; key = k;
    const cats = [...new Set(app.brushes.map((b) => b.category || 'Other'))];
    if (!subCat || !cats.includes(subCat)) subCat = cur.category || cats[0];
    tabs.innerHTML = '';
    for (const c of cats) tabs.append(h('button', { class: c === subCat ? 'on' : '', onclick: () => { subCat = c; draw(true); } }, c));
    list.innerHTML = '';
    for (const b of app.brushes.filter((x) => (x.category || 'Other') === subCat)) {
      const row = h('button', { class: 'cs-sub' + (b.id === cur.id ? ' on' : ''), onclick: () => { if (!PAINT.includes(app.tool)) app.setTool('brush'); app.setBrush(b.id, app.paintToolName()); refresh(); } },
        h('span', { class: 'cs-sub-name' }, b.name), UI.brushPreview(b, 150, 22, '#e8e8ea'));
      list.append(row);
    }
    const on = list.querySelector('.cs-sub.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const el = h('section', { class: 'cs-panel cs-subtool' }, h('header', {}, h('span', {}, 'Sub Tool'), h('button', { class: 'cs-mini', title: 'Brush library', onclick: (e) => UI.openBrushLibrary(app, e.currentTarget) }, '☰')), tabs, list);
  el.draw = draw;
  return el;
}
let saveT = 0;
function brushEdit(b) { // live edit of the current brush's own settings (saved as an edited copy)
  if (b.builtin) b.override = true;
  b._v = Date.now();
  clearTimeout(saveT); saveT = setTimeout(async () => { try { await preloadBrush(b); await store.saveBrush(b); } catch (e) { console.warn(e); } }, 400);
}
function toolPropertyPanel() {
  const body = h('div', { class: 'cs-tp-body' }), title = h('span', {}, 'Tool Property');
  const el = h('section', { class: 'cs-panel cs-toolprop' }, h('header', {}, title, h('button', { class: 'cs-mini', title: 'Sub Tool Detail (Brush Studio)', onclick: () => UI.openBrushStudio(app, app.brushFor(app.paintToolName())) }, '🔧')), body);
  let rows = [], key = '';
  el.draw = () => {
    const t = app.tool, paint = PAINT.includes(t);
    const k = paint ? t + ':' + app.brushFor(t).id : t;
    if (k === key) { rows.forEach((r) => r.sync()); return; }
    key = k; body.innerHTML = ''; rows = [];
    if (!paint) { title.textContent = 'Tool Property'; body.append($('#ctxbar').hidden ? h('p', { class: 'cs-dim' }, 'This tool has no settings.') : h('p', { class: 'cs-dim' }, 'Settings of this tool are in the bar above the canvas.')); return; }
    const b = app.brushFor(t), done = () => app.updateSliders();
    title.textContent = 'Tool Property · ' + b.name;
    rows = [
      valueBar('Brush size', { get: () => app.getSize(), set: (v) => app.setSize(Math.round(v * 10) / 10), min: 1, max: b.maxSize || 500, log: true, fmt: (v) => (v < 10 ? v.toFixed(1) : Math.round(v)), done }),
      valueBar('Opacity', { get: () => app.getOpacity() * 100, set: (v) => app.setOpacity(v / 100), min: 1, max: 100, step: 1, done }),
      valueBar('Stabilization', { get: () => (b.streamline || 0) * 100, set: (v) => { b.streamline = v / 100; brushEdit(b); }, min: 0, max: 95, step: 1 }),
      valueBar('Brush density', { get: () => (b.flow ?? 1) * 100, set: (v) => { b.flow = v / 100; brushEdit(b); }, min: 1, max: 100, step: 1 }),
      valueBar('Spacing', { get: () => (b.spacing || 0.05) * 100, set: (v) => { b.spacing = v / 100; brushEdit(b); }, min: 1, max: 200, step: 1 }),
      valueBar('Hardness', { get: () => (b.hardness ?? 1) * 100, set: (v) => { b.hardness = v / 100; brushEdit(b); }, min: 0, max: 100, step: 1 }),
      valueBar('Pressure → size', { get: () => (b.sizePressure || 0) * 100, set: (v) => { b.sizePressure = v / 100; brushEdit(b); }, min: 0, max: 100, step: 1 }),
    ];
    if (t === 'smudge' || b.mixOn) rows.push(valueBar(b.mixOn ? 'Colour stretch' : 'Blend strength', { get: () => ((b.mixOn ? b.mixStretch : b.smudgeStrength) ?? 0.7) * 100, set: (v) => { if (b.mixOn) b.mixStretch = v / 100; else b.smudgeStrength = v / 100; brushEdit(b); }, min: 0, max: 100, step: 1 }));
    if (b.mixOn) rows.push(valueBar('Amount of paint', { get: () => (b.mixPaint ?? 0.5) * 100, set: (v) => { b.mixPaint = v / 100; brushEdit(b); }, min: 0, max: 100, step: 1 }));
    body.append(...rows);
  };
  return el;
}
const SIZES = [1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50, 70, 100, 150, 200, 300];
function sizePalette() {
  const el = h('section', { class: 'cs-panel cs-sizes' }, h('header', {}, h('span', {}, 'Brush Size')));
  const grid = h('div', { class: 'cs-size-grid' }); el.append(grid);
  for (const s of SIZES) {
    const r = Math.max(1.5, Math.min(11, Math.sqrt(s) * 1.1));
    grid.append(h('button', { class: 'cs-size', title: s + ' px', onclick: () => { if (!PAINT.includes(app.tool)) app.setTool('brush'); app.setSize(s); app.updateSliders(); refresh(); } },
      h('i', { style: { width: r * 2 + 'px', height: r * 2 + 'px' } }), h('small', {}, s)));
  }
  el.draw = () => { const cur = app.getSize(); let best = null; for (const b of grid.children) { const v = +b.title.split(' ')[0]; if (!best || Math.abs(v - cur) < Math.abs(+best.title.split(' ')[0] - cur)) best = b; } for (const b of grid.children) b.classList.toggle('on', b === best && Math.abs(+b.title.split(' ')[0] - cur) < 0.5); };
  return el;
}

// ───────── layer property bar (blend mode + opacity of the active layer) ─────────
function layerBar() {
  const blend = h('select', { class: 'cs-blend' });
  for (const [k, name] of BLEND_MODES) blend.append(h('option', { value: k }, name));
  blend.onchange = () => { const it = active(); if (!it) return; structCmd(app, 'Blend mode', () => { it.blend = blend.value; }); rerenderLayers(); };
  let start = null;
  const op = valueBar('Opacity', { get: () => { const it = active(); return it ? Math.round((it.opacity ?? 1) * 100) : 100; }, set: (v) => { const it = active(); if (!it) return; if (start == null) start = it.opacity; it.opacity = v / 100; app.requestRender(); }, min: 0, max: 100, step: 1,
    done: () => { const it = active(); if (!it || start == null) return; const to = it.opacity; it.opacity = start; start = null; structCmd(app, 'Layer opacity', () => { it.opacity = to; }); rerenderLayers(); } });
  const el = h('section', { class: 'cs-panel cs-layerbar' }, h('header', {}, h('span', {}, 'Layer Property')), h('div', { class: 'cs-lb-row' }, blend), op);
  let last = '';
  el.draw = () => {
    const it = active(), k = it ? it.id + it.blend + it.opacity + it.type : '';
    if (k === last) return; last = k;
    blend.disabled = !it || it.type === 'group';
    blend.value = (it && it.blend) || 'source-over';
    op.sync();
  };
  return el;
}

// ───────── status bar ─────────
function statusBar() {
  const zoomTxt = h('span', { class: 'cs-zoom' }), rotTxt = h('span', { class: 'cs-rot' });
  // zoom as a value bar (log scale 2 % – 6400 %), like the rest of the workspace
  const zs = valueBar('', { get: () => app.view.zoom * 100, set: (v) => app.zoomBy(v / 100 / app.view.zoom), min: 2, max: 6400, log: true, fmt: (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + '%' });
  zs.classList.add('cs-zs');
  const el = h('footer', { class: 'cs-status' },
    zs, zoomTxt,
    h('span', { class: 'cs-sep' }),
    h('button', { onclick: () => rotateBy(-15), title: 'Rotate left' }, '⟲'), rotTxt, h('button', { onclick: () => rotateBy(15), title: 'Rotate right' }, '⟳'),
    h('button', { onclick: () => { app.view.rot = 0; app.fitView(); }, title: 'Reset rotation' }, 'Reset'),
    h('button', { onclick: () => { app.view.flip *= -1; app.fitView(); }, title: 'Flip horizontal' }, '⇋'),
    h('button', { onclick: () => app.fitView(), title: 'Fit to window' }, 'Fit'),
    h('span', { class: 'cs-docinfo' }));
  el.draw = () => {
    const v = app.view, d = app.doc;
    zoomTxt.textContent = ''; zs.sync();
    rotTxt.textContent = Math.round((((v.rot * 180) / Math.PI) % 360 + 360) % 360) + '°';
    el.querySelector('.cs-docinfo').textContent = `${d.width} × ${d.height} px · ${d.mode === 'animate' ? 'Animation' : d.mode === 'webtoon' ? 'Webtoon' : 'Illustration'}`;
  };
  return el;
}

// ───────── build / refresh ─────────
let parts = null;
function build() {
  const menubar = h('nav', { class: 'cs-menubar' });
  for (const name of ['File', 'Edit', 'Layer', 'Select', 'View', 'Filter', 'Window', 'Help']) {
    const b = h('button', { id: name === 'Help' ? 'cs-help' : null, onclick: () => showMenu(b, menus()[name]) }, name);
    b.addEventListener('pointerenter', () => { if (openMenu && openMenu.dataset.for !== name) showMenu(b, menus()[name]); });
    menubar.append(b);
  }
  const tab = h('div', { class: 'cs-doctab' }, h('span', { class: 'cs-doctab-name' }), h('button', { title: 'Close (back to the Gallery)', onclick: () => app.closeDoc() }, '×'));
  const ic = (name, title, fn, txt) => h('button', { class: 'cs-cmd', title, onclick: fn, html: ICONS[name] || '' }, txt || null);
  const cmdbar = h('div', { class: 'cs-cmdbar' },
    h('button', { class: 'cs-cmd txt', title: 'Gallery', onclick: () => app.closeDoc() }, '‹ Gallery'),
    ic('plus', 'New canvas', () => UI.newDocDialog(app, app.doc.mode)),
    ic('square', 'Save', async () => { await app.saveNow(true); toast('Saved ✓', 1200); }),
    ic('share', 'Export / Share', (e) => UI.openActions(app, e.currentTarget)),
    h('span', { class: 'cs-cmd-sep' }),
    ic('undo', 'Undo', () => app.undo()), ic('redo', 'Redo', () => app.redo()),
    h('span', { class: 'cs-cmd-sep' }),
    h('button', { class: 'cs-cmd txt', title: 'Deselect', onclick: () => app.selection.active && app.selectionCmd('Deselect', () => app.selection.clear(), 'Deselected') }, '⬚ ×'),
    h('button', { class: 'cs-cmd txt', title: 'Select all', onclick: () => app.selectionCmd('Select all', () => app.selection.selectAll(), 'All') }, '⬚ All'),
    h('button', { class: 'cs-cmd txt', title: 'Invert selection', onclick: () => app.selectionCmd('Invert selection', () => app.selection.invert(), 'Inverted') }, '⬚ ⇄'),
    h('span', { class: 'cs-cmd-sep' }),
    ic('transform', 'Transform', () => app.setTool('transform')), ic('fill', 'Fill', () => app.setTool('fill')), ic('adjust', 'Adjustments', (e) => UI.openAdjustments(app, e.currentTarget)),
    ic('persp', 'Perspective ruler', () => app.setTool('persp')), ic('sym', 'Flip horizontal', () => { app.view.flip *= -1; app.fitView(); }),
    h('span', { class: 'cs-cmd-sep' }),
    ic('brushImport', 'Brush library', (e) => UI.openBrushLibrary(app, e.currentTarget)),
    ic('settings', 'Preferences', () => UI.openSettings(app)), tab);
  const sub = subToolPanel(), sizes = sizePalette(), prop = toolPropertyPanel(), lbar = layerBar(), status = statusBar();
  const left = h('div', { class: 'cs-left' }, sub, sizes, prop);
  root = h('div', { id: 'cs-chrome' }, menubar, cmdbar, left, lbar, status);
  $('#overlay-ui').append(root);
  parts = { sub, sizes, prop, lbar, status, tab };
  document.addEventListener('pointerdown', (e) => { if (openMenu && !e.target.closest('.cs-menu, .cs-menubar')) closeMenu(); }, true);
  built = true;
}
export function refresh() {
  if (!built || !on()) return;
  parts.tab.querySelector('.cs-doctab-name').textContent = app.doc.name + (app.dirtySave ? ' *' : '');
  parts.sub.draw(); parts.prop.draw(); parts.sizes.draw(); parts.lbar.draw(); parts.status.draw();
}
// called by applySettings (layout switched) and when a canvas opens or closes
export function syncClassic(a) {
  app = a;
  const want = document.body.classList.contains('classic-ui');
  if (!built) build(); // built once up front, so switching layouts never waits for it
  if (root) root.hidden = !want;
  clearInterval(ticker);
  if (want) { ticker = setInterval(() => { if (on() && !document.hidden) refresh(); }, 250); refresh(); }
  else closeMenu();
}
export const classicMenusFor = () => (app && app.doc ? Object.keys(menus()) : []);
export { openLayers };
