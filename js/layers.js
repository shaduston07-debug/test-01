// Layers panel: Procreate-style rows, groups, long-press drag to reorder (and into / out of
// groups), and a scrollable options side sheet that opens beside the panel.
import { $, h, clamp, toast, dialog, confirmDialog, promptDialog, makeCanvas, cloneCanvas, field, pct } from './util.js';
import { ICONS } from './icons.js';
import { Layer, Track, BLEND_MODES, blendShort } from './doc.js';
import { withUndo, touch } from './history.js';
import { openPopover, closePopover } from './ui.js';

// ───────── structural undo ─────────
const PROPS = ['type', 'name', 'visible', 'opacity', 'blend', 'alphaLock', 'clip', 'reference', 'panelMask', 'locked', 'groupId', 'collapsed', 'private', 'tint'];
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
    const cur = d.activeItem;
    let i = index ?? Math.min(d.active + 1, d.items.length);
    // new layers join the active layer's group (or the group whose header is selected)
    if (index == null && cur && layer.type !== 'group') {
      if (cur.type === 'group') { i = d.active; layer.groupId = cur.id; }
      else if (cur.groupId) layer.groupId = cur.groupId;
    }
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

// ───────── groups ─────────
function newGroupFrom(app, idx) {
  const d = app.doc, it = d.layers[idx];
  structCmd(app, 'Group', () => {
    const [s, e] = d.blockOf(idx);
    const g = new Layer(d.width, d.height, { type: 'group', name: 'New Group' });
    if (it.type !== 'group') { for (let k = s; k <= e; k++) d.layers[k].groupId = g.id; }
    d.layers.splice(e + 1, 0, g);
    d.active = e + 1;
  });
}
function ungroup(app, idx) {
  const d = app.doc, g = d.layers[idx];
  structCmd(app, 'Ungroup', () => {
    for (const l of d.layers) if (l.groupId === g.id) l.groupId = null;
    d.layers.splice(idx, 1);
    d.active = clamp(idx - 1, 0, d.layers.length - 1);
  });
}
function deleteGroup(app, idx) {
  const d = app.doc;
  structCmd(app, 'Delete group', () => {
    const [s, e] = d.blockOf(idx);
    d.layers.splice(s, e - s + 1);
    d.active = clamp(s - 1, 0, Math.max(0, d.layers.length - 1));
  });
}
function flattenGroup(app, idx) {
  const d = app.doc, g = d.layers[idx];
  const [s, e] = d.blockOf(idx);
  const flat = new Layer(d.width, d.height, { name: g.name });
  // composite just the members (visibility / opacity / blend / clipping respected)
  d.composite(flat.canvas.getContext('2d'), { from: s, to: e, bg: false });
  structCmd(app, 'Flatten group', () => {
    d.layers.splice(s, e - s + 1, flat);
    d.active = s;
  });
}

// ───────── moving ─────────
// target: { into: index } | { above: index|null, below: index|null } (array indices, display neighbours)
function moveLayer(app, from, tgt) {
  const d = app.doc, items = d.items;
  const [bs, be] = d.blockOf(from);
  const block = items.slice(bs, be + 1), moving = items[from];
  const isGroup = moving.type === 'group';
  const above = tgt.above != null ? items[tgt.above] : null;
  const below = tgt.below != null ? items[tgt.below] : null;
  let intoG = tgt.into != null ? items[tgt.into] : null;
  if (intoG && (isGroup || block.includes(intoG))) intoG = null;
  if (!intoG && block.includes(above) && block.includes(below)) return;
  if (!intoG && (block.includes(above) || block.includes(below))) {
    // dropped right next to itself: only a group change can happen
    if (isGroup) return;
  }
  structCmd(app, 'Move layer', () => {
    items.splice(bs, block.length);
    let at, gid = null;
    if (intoG) {
      at = items.indexOf(intoG); gid = intoG.id;
    } else {
      const A = above && !block.includes(above) ? above : null;
      const B = below && !block.includes(below) ? below : null;
      if (A && A.type === 'group') at = d.blockOf(items.indexOf(A))[0];
      else if (B) at = items.indexOf(B) + 1;
      else if (A) at = items.indexOf(A);
      else at = 0;
      if (B && B.groupId && A && (A.groupId === B.groupId || A.id === B.groupId)) gid = B.groupId;
      else if (!B && A && A.groupId) gid = A.groupId;
      if (isGroup && gid) { const host = items.find((x) => x.id === gid); at = items.indexOf(host) + 1; gid = null; }
    }
    items.splice(at, 0, ...block);
    if (!isGroup) moving.groupId = gid;
    d.active = items.indexOf(moving);
  });
}

// ───────── panel ─────────
let layersOpen = null;
export function onDocChanged() {
  if (!layersOpen) return;
  clearTimeout(layersOpen.t);
  layersOpen.t = setTimeout(() => layersOpen && !layersOpen.dragging && layersOpen.render(), 250);
}

const thumbCache = new WeakMap();
function thumbOf(app, it) {
  const box = h('div', { class: 'layer-thumb' });
  const d = app.doc;
  let src = null;
  if (it.type === 'raster' || it.type === '3d') src = it.canvas;
  else if (it.type === 'track') { const c = it.celAt(d.playhead); src = c && c.canvas; }
  if (src) {
    // thumbnails are cached per canvas version, so reopening the panel with 100 layers is free
    const s = Math.min(54 / d.width, 40 / d.height);
    let t = thumbCache.get(src);
    if (!t || t.ver !== (src._ver || 0) || t.w !== d.width) {
      const c = makeCanvas(Math.max(1, d.width * s * 2), Math.max(1, d.height * s * 2));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      t = { ver: src._ver || 0, w: d.width, c };
      thumbCache.set(src, t);
    }
    const c = makeCanvas(t.c.width, t.c.height);
    c.getContext('2d').drawImage(t.c, 0, 0);
    c.style.width = c.width / 2 + 'px';
    box.append(c);
  } else {
    box.classList.add('icon');
    box.innerHTML = it.type === 'frames' ? ICONS.panel : it.type === 'balloons' ? ICONS.balloon : ICONS.folder;
  }
  return box;
}

export function openLayers(app, anchor) {
  app.finishTransient();
  const d = app.doc;
  const list = h('div', { class: 'layer-list' });
  // stop native scrolling while a row is being dragged
  list.addEventListener('touchmove', (e) => { if (layersOpen && layersOpen.dragging) e.preventDefault(); }, { passive: false });

  const render = () => {
    list.innerHTML = '';
    const items = d.items;
    const groups = d.mode === 'animate' ? new Map() : d.groupMap();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const grp = it.groupId ? groups.get(it.groupId) : null;
      if (grp && grp.collapsed) continue;
      list.append(rowFor(it, i, !!grp));
    }
    const colorIn = h('input', { type: 'color', value: d.bg });
    colorIn.oninput = () => { d.bg = colorIn.value; app.changed(); };
    list.append(h('div', { class: 'layer-row bg-row' }, h('div', { class: 'layer-thumb', style: { background: d.bg } }), h('div', { class: 'layer-name' }, h('b', {}, 'Background color')), colorIn,
      h('button', { class: 'layer-vis' + (d.bgVisible ? ' on' : ''), onclick: () => { d.bgVisible = !d.bgVisible; app.changed(); render(); } })));
    list.append(h('p', { class: 'hint layer-hint' }, `${d.rasterCount()} of ${app.maxRaster()} ${d.mode === 'animate' ? 'drawings' : 'layers'} at ${d.width}×${d.height} · hold & drag to reorder · tap a selected layer for options`));
    if (sheetFor && !d.items.includes(sheetFor.it)) closeSheet();
  };

  const rowFor = (it, i, inGroup) => {
    const on = i === d.active;
    const vis = h('button', { class: 'layer-vis' + (it.visible ? ' on' : ''), onclick: (e) => { e.stopPropagation(); it.visible = !it.visible; app.changed(); render(); } });
    let row;
    if (it.type === 'group') {
      const n = d.layers.filter((l) => l.groupId === it.id).length;
      const chev = h('button', { class: 'grp-chev' + (it.collapsed ? '' : ' open'), html: ICONS.chevron, onclick: (e) => { e.stopPropagation(); it.collapsed = !it.collapsed; app.dirtySave = true; render(); } });
      row = h('div', { class: 'layer-row group' + (on ? ' on' : '') }, chev, h('div', { class: 'layer-name' }, h('b', {}, it.name), h('small', {}, `${n} layer${n === 1 ? '' : 's'}${it.opacity < 1 ? ' · ' + pct(it.opacity) : ''}`)), vis);
    } else {
      const tags = [it.private && 'private', it.alphaLock && 'α-lock', it.reference && 'reference', it.panelMask && 'panel mask', it.clip && 'clip'].filter(Boolean).join(' · ');
      const sub = it.type === '3d' ? `3D · ${it.scene3d ? it.scene3d.objects.length : 0} object${it.scene3d && it.scene3d.objects.length === 1 ? '' : 's'}` : it.type === 'frames' ? `${it.panels.length} panels` : it.type === 'balloons' ? `${it.balloons.length} balloons` : it.type === 'track' ? `${it.cels.length} drawings · ${it.keys.length} keys` : (tags || (it.opacity < 1 ? pct(it.opacity) : ''));
      const canTint = it.type === 'raster' || it.type === 'track';
      const tintBtn = canTint ? h('button', { class: 'layer-tint' + (it.tint ? ' on' : ''), title: 'Layer colour', style: it.tint ? { background: it.tint } : {}, onclick: (e) => { e.stopPropagation(); d.active = i; render(); openTint(it); } }) : null;
      const blendBtn = h('button', { class: 'layer-blend', title: 'Blend mode & opacity', onclick: (e) => { e.stopPropagation(); d.active = i; render(); openBlend(it); } }, it.type === 'raster' || it.type === 'track' ? blendShort(it.blend) : '');
      row = h('div', { class: 'layer-row' + (on ? ' on' : '') + (it.clip ? ' clip' : '') + (inGroup ? ' member' : '') },
        thumbOf(app, it), h('div', { class: 'layer-name' }, h('b', {}, it.name), sub ? h('small', {}, sub) : null), tintBtn, blendBtn, vis);
    }
    row.dataset.idx = i;
    bindRow(row, it, i);
    return row;
  };

  const select = (it, i) => {
    if (d.active === i) { openSheet(it); return; }
    d.active = i;
    if (sheetFor) openSheet(it);
    if (d.mode === 'webtoon') { if (it.type === 'balloons' && app.tool !== 'balloon') app.setTool('balloon'); if (it.type === 'frames') app.setTool('panel'); }
    if (it.type === '3d') app.setTool('3d');
    render(); app.requestRender('view');
    if (d.mode === 'animate') app.timeline.refresh();
  };

  // tap = select / options; hold then drag = move (over a group's row = put inside it)
  const bindRow = (row, it, i) => {
    row.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.layer-vis, .grp-chev, .layer-blend, .layer-tint, input')) return;
      const st = { x: e.clientX, y: e.clientY, lifted: false, cancelled: false };
      const hold = e.pointerType === 'mouse' ? 120 : 220;
      st.timer = setTimeout(() => { if (!st.cancelled) lift(); }, hold);
      let ghost, marker, target = null;
      const rows = () => [...list.querySelectorAll('.layer-row[data-idx]')];
      const lift = () => {
        st.lifted = true; layersOpen.dragging = true;
        const r = row.getBoundingClientRect();
        ghost = row.cloneNode(true); ghost.classList.add('drag-ghost');
        Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
        document.body.append(ghost);
        row.classList.add('drag-src');
        marker = h('div', { class: 'drop-marker' }); list.append(marker); marker.hidden = true;
        st.dy = e.clientY - r.top;
        navigator.vibrate && navigator.vibrate(8);
      };
      const move = (ev) => {
        if (!st.lifted) { if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 8) { st.cancelled = true; clearTimeout(st.timer); } return; }
        ev.preventDefault();
        ghost.style.top = ev.clientY - st.dy + 'px';
        const lr = list.getBoundingClientRect();
        if (ev.clientY < lr.top + 30) list.scrollTop -= 12; else if (ev.clientY > lr.bottom - 30) list.scrollTop += 12;
        const rs = rows();
        target = null; marker.hidden = true;
        for (const r of rs) r.classList.remove('drop-into');
        for (let k = 0; k < rs.length; k++) {
          const rr = rs[k].getBoundingClientRect();
          if (ev.clientY < rr.top || ev.clientY > rr.bottom) continue;
          const idx = +rs[k].dataset.idx, item = d.items[idx], f = (ev.clientY - rr.top) / rr.height;
          if (item.type === 'group' && it.type !== 'group' && f > 0.3 && f < 0.7) { target = { into: idx }; rs[k].classList.add('drop-into'); return; }
          const before = f < 0.5; // gap above this row
          const aboveRow = before ? rs[k - 1] : rs[k], belowRow = before ? rs[k] : rs[k + 1];
          target = { above: aboveRow ? +aboveRow.dataset.idx : null, below: belowRow ? +belowRow.dataset.idx : null };
          marker.hidden = false;
          marker.style.top = (before ? rr.top : rr.bottom) - lr.top + list.scrollTop - 1 + 'px';
          return;
        }
      };
      const up = () => {
        clearTimeout(st.timer);
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        if (st.lifted) {
          ghost.remove(); marker.remove(); layersOpen.dragging = false;
          if (target) moveLayer(app, i, target);
          render();
          return;
        }
        if (!st.cancelled) select(it, i);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
  };

  // ── blend mode & opacity popup (Procreate's "N" button) ──
  let blendEl = null;
  const closeBlend = () => { if (blendEl) { blendEl.remove(); document.removeEventListener('pointerdown', blendEl._outside, true); } blendEl = null; };
  const openBlend = (it) => {
    closeSheet(); closeBlend();
    const panel = list.closest('#popover, .float-win');
    if (!panel) return;
    const canBlend = it.type === 'raster' || it.type === 'track';
    const modes = h('div', { class: 'blend-list' });
    const fill = () => {
      modes.innerHTML = '';
      for (const [title, keys] of BLEND_GROUPS) {
        if (!canBlend) break;
        if (title) modes.append(h('div', { class: 'blend-group' }, title));
        for (const k of keys) {
          const m = BLEND_MODES.find((x) => x[0] === k); if (!m) continue;
          modes.append(h('button', { class: 'blend-row' + ((it.blend || 'source-over') === k ? ' on' : ''), onclick: () => { structCmd(app, 'Blend mode', () => { it.blend = k; }); fill(); render(); } },
            h('span', {}, m[1]), h('b', {}, m[2])));
        }
      }
    };
    fill();
    blendEl = h('div', { class: 'blend-pop glass' },
      h('div', { class: 'sheet-head' }, h('b', {}, it.name), h('button', { class: 'float-close', onclick: closeBlend }, '×')),
      h('div', { class: 'blend-op' }, opacityField(app, it, () => render())),
      h('div', { class: 'sheet-body' }, modes));
    $('#overlay-ui').append(blendEl);
    const r = panel.getBoundingClientRect(), W = Math.min(250, innerWidth - 16);
    const left = r.left - W - 8 >= 8 ? r.left - W - 8 : Math.min(r.right + 8, innerWidth - W - 8);
    Object.assign(blendEl.style, { left: left + 'px', top: r.top + 'px', width: W + 'px', maxHeight: Math.max(360, Math.min(innerHeight - r.top - 12, 620)) + 'px' });
    blendEl.style.zIndex = (parseInt(panel.style.zIndex) || 20) + 1;
    blendEl._outside = (e) => { if (blendEl && !blendEl.contains(e.target) && !e.target.closest('.layer-blend')) closeBlend(); };
    setTimeout(() => blendEl && document.addEventListener('pointerdown', blendEl._outside, true), 0);
  };

  // ── layer colour popup (display tint, e.g. blue sketch lines) ──
  const openTint = (it) => {
    closeSheet(); closeBlend();
    const panel = list.closest('#popover, .float-win');
    if (!panel) return;
    const grid = h('div', { class: 'tint-grid' });
    const set = (c) => { structCmd(app, c ? 'Layer colour' : 'Remove layer colour', () => { it.tint = c; }); fill(); render(); };
    const fill = () => {
      grid.innerHTML = '';
      grid.append(h('button', { class: 'tint-chip none' + (!it.tint ? ' on' : ''), onclick: () => set(null) }, 'Off'));
      for (const c of LAYER_TINTS) grid.append(h('button', { class: 'tint-chip' + (it.tint === c ? ' on' : ''), style: { background: c }, title: c, onclick: () => set(c) }));
      grid.append(h('button', { class: 'tint-chip cur' + (it.tint === app.color && !LAYER_TINTS.includes(app.color) ? ' on' : ''), style: { background: app.color }, title: 'Current colour', onclick: () => set(app.color) }, '＋'));
    };
    fill();
    blendEl = h('div', { class: 'blend-pop glass' },
      h('div', { class: 'sheet-head' }, h('b', {}, 'Layer colour'), h('button', { class: 'float-close', onclick: closeBlend }, '×')),
      h('div', { class: 'sheet-body' }, h('p', { class: 'hint' }, 'Shows this layer in one colour (like Clip Studio’s layer colour) — handy for blue sketch lines under line art. Your pixels aren’t changed; choose Off to see them again.'), grid));
    $('#overlay-ui').append(blendEl);
    const r = panel.getBoundingClientRect(), W = Math.min(250, innerWidth - 16);
    const left = r.left - W - 8 >= 8 ? r.left - W - 8 : Math.min(r.right + 8, innerWidth - W - 8);
    Object.assign(blendEl.style, { left: left + 'px', top: r.top + 'px', width: W + 'px' });
    blendEl.style.zIndex = (parseInt(panel.style.zIndex) || 20) + 1;
    blendEl._outside = (e) => { if (blendEl && !blendEl.contains(e.target) && !e.target.closest('.layer-tint')) closeBlend(); };
    setTimeout(() => blendEl && document.addEventListener('pointerdown', blendEl._outside, true), 0);
  };

  // ── options side sheet ──
  let sheetFor = null, sheetEl = null;
  const closeSheet = () => { if (sheetEl) sheetEl.remove(); sheetEl = null; sheetFor = null; };
  const openSheet = (it) => {
    closeSheet(); closeBlend();
    const i = d.items.indexOf(it);
    if (i < 0) return;
    const panel = list.closest('#popover, .float-win');
    if (!panel) return;
    sheetFor = { it };
    const rerender = () => { render(); if (d.items.includes(it)) openSheet(it); else closeSheet(); };
    const body = sheetBody(app, it, i, rerender, closeSheet, () => openBlend(it));
    sheetEl = h('div', { class: 'side-sheet glass' },
      h('div', { class: 'sheet-head' }, h('b', {}, it.name), h('button', { class: 'float-close', onclick: closeSheet }, '×')),
      h('div', { class: 'sheet-body' }, body));
    $('#overlay-ui').append(sheetEl);
    const r = panel.getBoundingClientRect(), W = Math.min(290, innerWidth - 16);
    const left = r.left - W - 8 >= 8 ? r.left - W - 8 : Math.min(r.right + 8, innerWidth - W - 8);
    Object.assign(sheetEl.style, { left: left + 'px', top: r.top + 'px', width: W + 'px', maxHeight: Math.max(360, Math.min(innerHeight - r.top - 12, 640)) + 'px' });
    sheetEl.style.zIndex = (parseInt(panel.style.zIndex) || 20) + 1;
  };

  const addBtn = h('button', { class: 'icon-btn', title: 'New layer', html: ICONS.plus });
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
    if (app.canAddRaster()) { insertLayer(app, new Layer(d.width, d.height, { name: 'Layer ' + (d.layers.filter((l) => l.isRaster).length + 1) })); render(); }
  };
  const head = [addBtn];
  if (d.mode !== 'animate') head.unshift(h('button', { class: 'icon-btn', title: 'Group the selected layer', html: ICONS.folder, onclick: () => { if (d.activeItem) { newGroupFrom(app, d.active); render(); } } }));
  if (d.mode !== 'animate') head.unshift(h('button', { class: 'icon-btn', title: '3D layer', html: ICONS.cube, onclick: () => app.add3DLayer && app.add3DLayer() }));
  const p = openPopover(anchor, { title: d.mode === 'animate' ? 'Tracks' : 'Layers', body: list, head, width: 340, key: 'layers', float: true, onClose: () => { closeSheet(); closeBlend(); layersOpen = null; } });
  if (!p) return;
  layersOpen = { render, dragging: false, closeSheet };
  render();
}
export function closeLayerSheet() { layersOpen && layersOpen.closeSheet(); }

// layer colours offered (blue first: the classic sketch-layer colour)
const LAYER_TINTS = ['#3d7bff', '#2fb8ff', '#7a5cff', '#ff4d6d', '#ff8a2a', '#f2c200', '#2fbf71', '#8a8f98', '#000000'];

// Procreate-style grouping of the blend modes
const BLEND_GROUPS = [
  ['', ['source-over']],
  ['Darken', ['multiply', 'darken', 'color-burn']],
  ['Lighten', ['screen', 'lighten', 'color-dodge', 'lighter']],
  ['Contrast', ['overlay', 'soft-light', 'hard-light']],
  ['Difference', ['difference', 'exclusion']],
  ['Color', ['hue', 'saturation', 'color', 'luminosity']],
];

// opacity slider: live while dragging, one undo step per drag
function opacityField(app, it, after) {
  const d = app.doc;
  let opStart = null;
  const op = field('Opacity', { min: 0, max: 1, step: 0.01, value: it.opacity, fmt: pct, onInput: (v) => { if (!opStart) opStart = captureStruct(d); it.opacity = v; app.requestRender(); } });
  op.querySelector('input').addEventListener('change', () => {
    if (!opStart) return; const before = opStart; opStart = null; const after2 = captureStruct(d);
    app.history.push({ label: 'Opacity', undo() { restoreStruct(d, before); app.changed(); }, redo() { restoreStruct(d, after2); app.changed(); } });
    app.changed(); after && after();
  });
  return op;
}

// ───────── side sheet contents ─────────
function sheetBody(app, it, i, rerender, close, openBlend) {
  const d = app.doc;
  const box = h('div', { class: 'sheet-list' });
  const item = (icon, label, fn, cls = '') => h('button', { class: 'sheet-item ' + cls, onclick: () => fn() }, h('span', { html: ICONS[icon] || '' }), label);
  const toggle = (label, key, after) => {
    const sw = h('span', { class: 'switch' + (it[key] ? ' on' : '') });
    return h('button', { class: 'sheet-item', onclick: () => { structCmd(app, label, () => { it[key] = !it[key]; }); sw.classList.toggle('on', it[key]); after && after(); app.requestRender(); } }, h('span', { html: ICONS.check }), label, sw);
  };
  const section = (t) => h('div', { class: 'sheet-section' }, t);

  box.append(item('pencil', 'Rename', async () => { const n = await promptDialog('Rename', it.name); if (n) { structCmd(app, 'Rename', () => { it.name = n; }); rerender(); } }));
  // blend mode & opacity live in their own popup (also on the layer row's letter button)
  const bm = (BLEND_MODES.find((m) => m[0] === (it.blend || 'source-over')) || BLEND_MODES[0])[1];
  box.append(h('button', { class: 'sheet-item', onclick: () => openBlend() }, h('span', { html: ICONS.layers || '' }), h('span', { style: { whiteSpace: 'nowrap' } }, 'Blend & Opacity'),
    h('small', { class: 'sheet-val' }, (it.type === 'raster' || it.type === 'track' ? bm + ' · ' : '') + pct(it.opacity) + ' ›')));

  if (it.type === 'raster' || it.type === 'track') {
    box.append(section('Layer'));
    box.append(toggle('Alpha Lock', 'alphaLock', rerender), toggle('Clipping Mask', 'clip', rerender), toggle('Reference', 'reference'), toggle('Private (hidden from time-lapse)', 'private', rerender));
    if (d.mode === 'webtoon' && it.type === 'raster') box.append(toggle('Mask to panels', 'panelMask'));
    const target = () => (it.type === 'raster' ? it.canvas : (it.celAt(d.playhead) || {}).canvas);
    if (it.type === 'raster') box.append(item('select', 'Select', () => { app.selection.fromAlpha(it.canvas); app.selectionChanged(); app.setTool('select'); close(); }));
    box.append(item('copy', 'Duplicate', () => {
      if (!app.canAddRaster(it.type === 'track' ? it.cels.length : 1)) return;
      let copy;
      if (it.type === 'raster') { copy = new Layer(d.width, d.height, { ...it, id: null, name: it.name + ' copy' }); copy.canvas.getContext('2d').drawImage(it.canvas, 0, 0); }
      else { copy = new Track({ ...it, id: null, name: it.name + ' copy', keys: JSON.parse(JSON.stringify(it.keys)) }); for (const c of it.cels) { const n = d.addCel(copy, c.start, c.dur); n.canvas.getContext('2d').drawImage(c.canvas, 0, 0); } }
      insertLayer(app, copy, i + 1); rerender();
    }));
    box.append(item('fill', 'Fill Layer', () => { const c = target(); if (!c) return; withUndo(app.history, c, 'Fill layer', (x) => {
      x.save(); x.fillStyle = app.color; x.globalCompositeOperation = it.alphaLock ? 'source-atop' : 'source-over';
      if (app.selection.active) { const t = makeCanvas(c.width, c.height), tx = t.getContext('2d'); tx.fillStyle = app.color; tx.fillRect(0, 0, c.width, c.height); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(app.selection.mask, 0, 0); x.drawImage(t, 0, 0); }
      else x.fillRect(0, 0, c.width, c.height);
      x.restore();
    }, () => app.requestRender()); app.changed(); }));
    box.append(item('eraser', 'Clear', () => { const c = target(); if (!c) return; withUndo(app.history, c, 'Clear', (x) => {
      if (app.selection.active) { x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(app.selection.mask, 0, 0); x.restore(); } else x.clearRect(0, 0, c.width, c.height);
    }, () => app.requestRender()); app.changed(); }));
    if (it.type === 'raster') box.append(item('adjust', 'Invert', () => withUndo(app.history, it.canvas, 'Invert', (x) => {
      const id = x.getImageData(0, 0, it.canvas.width, it.canvas.height);
      for (let k = 0; k < id.data.length; k += 4) { id.data[k] = 255 - id.data[k]; id.data[k + 1] = 255 - id.data[k + 1]; id.data[k + 2] = 255 - id.data[k + 2]; }
      x.putImageData(id, 0, 0);
    }, () => app.changed())));
    if (it.type === 'raster' && i > 0 && d.items[i - 1].type === 'raster') box.append(item('layers', 'Merge Down', () => { mergeDown(app, i); rerender(); }));
  }
  if (it.type === 'frames') {
    box.append(field('Border width', { min: 0, max: 30, step: 1, value: it.border, fmt: (v) => v + ' px', onInput: (v) => { it.border = v; app.changed(); } }));
    const ci = h('input', { type: 'color', value: it.borderColor }); ci.oninput = () => { it.borderColor = ci.value; app.changed(); };
    box.append(h('div', { class: 'sheet-item' }, h('span', { html: ICONS.panel }), 'Border color', ci));
  }
  if (it.type === 'balloons' || it.type === 'frames') {
    box.append(item('layers', 'Rasterize (make it paintable)', () => {
      if (!app.canAddRaster()) return;
      const r = new Layer(d.width, d.height, { name: it.name, opacity: it.opacity, groupId: it.groupId });
      // render at full strength; the new layer carries the opacity / group itself
      const op = it.opacity, gid = it.groupId;
      it.opacity = 1; it.groupId = null;
      d.composite(r.canvas.getContext('2d'), { from: i, to: i + 1, bg: false });
      it.opacity = op; it.groupId = gid;
      structCmd(app, 'Rasterize', () => { d.layers.splice(i, 1, r); d.active = i; });
      if (app.tool === 'balloon' || app.tool === 'panel') app.setTool('brush');
      rerender();
    }));
  }
  if (it.type === 'group') {
    box.append(section('Group'));
    box.append(item('chevron', it.collapsed ? 'Expand' : 'Collapse', () => { it.collapsed = !it.collapsed; rerender(); }));
    box.append(item('layers', 'Flatten group', () => { flattenGroup(app, i); rerender(); }));
    box.append(item('folder', 'Ungroup', () => { ungroup(app, i); close(); rerender(); }));
    box.append(item('trash', 'Delete group & layers', async () => { if (await confirmDialog(`Delete "${it.name}" and its layers?`, 'Delete', true)) { deleteGroup(app, i); close(); rerender(); } }, 'danger'));
    return box;
  }
  if (d.mode !== 'animate') {
    box.append(section('Organize'));
    box.append(item('folder', it.groupId ? 'Remove from group' : 'Put in new group', () => {
      if (it.groupId) { const g = d.layers.find((x) => x.id === it.groupId); moveLayer(app, i, { above: d.layers.indexOf(g) + 1 < d.layers.length ? d.layers.indexOf(g) + 1 : null, below: d.layers.indexOf(g) }); }
      else newGroupFrom(app, i);
      rerender();
    }));
  }
  box.append(item('trash', 'Delete', () => {
    structCmd(app, 'Delete layer', () => { d.items.splice(i, 1); d.active = clamp(d.active >= i ? d.active - 1 : d.active, 0, Math.max(0, d.items.length - 1)); });
    close(); rerender();
  }, 'danger'));
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
  touch(low.canvas);
  const put = (c) => { x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(c, 0, 0); x.restore(); touch(low.canvas); };
  app.history.push({ label: 'Merge', bytes: d.pixelBytes * 2, undo() { put(beforePx); restoreStruct(d, before); app.changed(); }, redo() { put(afterPx); restoreStruct(d, after); app.changed(); } });
  app.changed();
}
