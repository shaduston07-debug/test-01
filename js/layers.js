// Layers panel: Procreate-style rows, groups, long-press drag to reorder (and into / out of
// groups), and a scrollable options side sheet that opens beside the panel.
import { $, h, clamp, toast, dialog, confirmDialog, promptDialog, makeCanvas, cloneCanvas, field, pct } from './util.js';
import { ICONS } from './icons.js';
import { Layer, Track, BLEND_MODES, blendShort } from './doc.js';
import { withUndo, touch } from './history.js';
import { openPopover, closePopover, openColor } from './ui.js';
import { blendDraw, isCustomBlend } from './blendgl.js';

// the layers panel's current multi-selection (swiped rows), for other tools
let pickedRef = null;
export function pickedLayers(app) { const d = app.doc; return pickedRef ? [...pickedRef].filter((x) => d.items.includes(x)) : []; }
export function clearPicked() { if (pickedRef) pickedRef.clear(); }

// ───────── structural undo ─────────
const PROPS = ['type', 'name', 'visible', 'opacity', 'blend', 'alphaLock', 'clip', 'reference', 'panelMask', 'locked', 'groupId', 'collapsed', 'private', 'tint', 'draft', 'express', 'border', 'borderWidth', 'borderColor'];
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
    // a new paint layer inside a clipping stack (between clipping layers, or added while working
    // on one) becomes a clipping layer too, like Clip Studio
    const paintable = layer.type === 'raster' || layer.type === 'track';
    if (paintable && index == null && ((d.items[i] && d.items[i].clip) || (cur && cur.clip))) layer.clip = true;
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

  // swipe a row sideways to add it to / take it out of a multi-selection (like Procreate)
  const picked = new Set();
  pickedRef = picked;
  const render = () => {
    list.innerHTML = '';
    const items = d.items;
    for (const p of [...picked]) if (!items.includes(p)) picked.delete(p);
    if (picked.size) list.append(multiBar());
    const groups = d.mode === 'animate' ? new Map() : d.groupMap();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const grp = it.groupId ? groups.get(it.groupId) : null;
      if (grp && grp.collapsed) continue;
      list.append(rowFor(it, i, !!grp));
    }
    // the background gets the full colour panel (disc, sliders, history, palettes), with undo
    const colorIn = h('button', { class: 'bg-swatch', title: 'Background colour', style: { background: d.bg }, onclick: (e) => { e.stopPropagation(); openBgColor(colorIn); } });
    list.append(h('div', { class: 'layer-row bg-row' }, h('div', { class: 'layer-thumb', style: { background: d.bg } }), h('div', { class: 'layer-name' }, h('b', {}, 'Background color')), colorIn,
      h('button', { class: 'layer-vis' + (d.bgVisible ? ' on' : ''), onclick: () => { d.bgVisible = !d.bgVisible; app.changed(); render(); } })));
    list.append(h('p', { class: 'hint layer-hint' }, `${d.rasterCount()} of ${app.maxRaster()} ${d.mode === 'animate' ? 'drawings' : 'layers'} at ${d.width}×${d.height} · hold & drag to reorder · tap a selected layer for options`));
    if (sheetFor && !d.items.includes(sheetFor.it)) closeSheet();
  };

  const openBgColor = (btn) => {
    let last = d.bg;
    // the Layers popover closes when the colour panel opens: anchor to the Layers button then
    const anchor = btn.closest('.float-win') ? btn : (document.getElementById('btn-layers') || btn);
    openColor(app, anchor, {
      title: 'Background colour', key: 'bg-color',
      get: () => d.bg,
      set: (hex, commit) => {
        d.bg = hex; if (btn.isConnected) btn.style.background = hex; app.changed();
        if (commit && hex !== last) {
          const before = last, after = hex; last = hex;
          app.history.push({ label: 'Background colour', undo() { d.bg = before; app.changed(); }, redo() { d.bg = after; app.changed(); } });
        }
      },
      onClose: () => render(),
    });
  };
  const rowFor = (it, i, inGroup) => {
    const on = i === d.active;
    const vis = h('button', { class: 'layer-vis' + (it.visible ? ' on' : ''), onclick: (e) => { e.stopPropagation(); it.visible = !it.visible; app.changed(); render(); } });
    let row;
    if (it.type === 'group') {
      const n = d.layers.filter((l) => l.groupId === it.id).length;
      const chev = h('button', { class: 'grp-chev' + (it.collapsed ? '' : ' open'), html: ICONS.chevron, onclick: (e) => { e.stopPropagation(); it.collapsed = !it.collapsed; app.dirtySave = true; render(); } });
      row = h('div', { class: 'layer-row group' + (on ? ' on' : '') + (picked.has(it) ? ' picked' : '') }, chev, h('div', { class: 'layer-name' }, h('b', {}, it.name), h('small', {}, `${n} layer${n === 1 ? '' : 's'}${it.opacity < 1 ? ' · ' + pct(it.opacity) : ''}`)), vis);
    } else {
      const tags = [it.locked && '🔒 locked', it.draft && 'draft', it.private && 'private', it.alphaLock && 'α-lock', it.reference && 'reference', it.panelMask && 'panel mask', it.clip && 'clip', it.border && 'border', it.express === 'gray' && 'gray', it.express === 'mono' && 'mono'].filter(Boolean).join(' · ');
      const sub = it.type === '3d' ? `3D · ${it.scene3d ? it.scene3d.objects.length : 0} object${it.scene3d && it.scene3d.objects.length === 1 ? '' : 's'}` : it.type === 'frames' ? `${it.panels.length} panels` : it.type === 'balloons' ? `${it.balloons.length} balloons` : it.type === 'track' ? `${it.cels.length} drawings · ${it.keys.length} keys` : (tags || (it.opacity < 1 ? pct(it.opacity) : ''));
      const canTint = it.type === 'raster' || it.type === 'track';
      const tintBtn = canTint ? h('button', { class: 'layer-tint' + (it.tint ? ' on' : ''), title: 'Layer colour', style: it.tint ? { background: it.tint } : {}, onclick: (e) => { e.stopPropagation(); d.active = i; render(); openTint(it); } }) : null;
      const blendBtn = h('button', { class: 'layer-blend', title: 'Blend mode & opacity', onclick: (e) => { e.stopPropagation(); d.active = i; render(); openBlend(it); } }, it.type === 'raster' || it.type === 'track' ? blendShort(it.blend) : '');
      row = h('div', { class: 'layer-row' + (on ? ' on' : '') + (picked.has(it) ? ' picked' : '') + (it.clip ? ' clip' : '') + (inGroup ? ' member' : '') },
        thumbOf(app, it), h('div', { class: 'layer-name' }, h('b', {}, it.name), sub ? h('small', {}, sub) : null), tintBtn, blendBtn, vis);
    }
    row.dataset.idx = i;
    if (quickFor === it) { row.classList.add('quick'); row.append(quickBar(it)); }
    bindRow(row, it, i);
    return row;
  };

  const select = (it, i) => {
    if (quickFor) { quickFor = null; render(); return; }
    if (picked.size) { picked.clear(); d.active = i; render(); app.requestRender('view'); return; }
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
      if (e.target.closest('.layer-vis, .grp-chev, .layer-blend, .layer-tint, .quick-bar, input')) return;
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
        if (!st.lifted) {
          const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
          if (!st.swiped && Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.8) { st.swiped = true; st.cancelled = true; clearTimeout(st.timer); togglePick(it); return; }
          if (Math.hypot(dx, dy) > 8) { st.cancelled = true; clearTimeout(st.timer); }
          return;
        }
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

  // swipe the layer you're on: quick actions on its row (like Procreate); other layers: multi-select
  let quickFor = null;
  const hideQuick = () => { if (quickFor) { quickFor = null; render(); } };
  const onDocDown = (e) => { if (quickFor && !e.target.closest('.layer-row.quick')) hideQuick(); };
  document.addEventListener('pointerdown', onDocDown, true);
  const duplicateItem = (it) => {
    const i = d.items.indexOf(it); if (i < 0) return;
    if (!app.canAddRaster(it.type === 'track' ? it.cels.length : 1)) return;
    let copy;
    if (it.type === 'raster') { copy = new Layer(d.width, d.height, { ...it, id: null, name: it.name + ' copy' }); copy.canvas.getContext('2d').drawImage(it.canvas, 0, 0); }
    else if (it.type === 'track') { copy = new Track({ ...it, id: null, name: it.name + ' copy', keys: JSON.parse(JSON.stringify(it.keys)) }); for (const c of it.cels) { const n = d.addCel(copy, c.start, c.dur); n.canvas.getContext('2d').drawImage(c.canvas, 0, 0); } }
    else { toast('Only paint layers can be duplicated here'); return; }
    insertLayer(app, copy, i + 1);
  };
  const quickBar = (it) => {
    const act = (label, cls, fn) => h('button', { class: 'quick-act ' + cls, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    const paint = it.type === 'raster' || it.type === 'track';
    return h('div', { class: 'quick-bar' },
      act(it.locked ? 'Unlock' : 'Lock', 'lock', () => { structCmd(app, it.locked ? 'Unlock layer' : 'Lock layer', () => { it.locked = !it.locked; }); render(); }),
      paint ? act('Duplicate', 'dup', () => { quickFor = null; duplicateItem(it); render(); }) : null,
      paint ? act(it.clip ? 'Unclip' : 'Clipping', 'clip', () => { structCmd(app, it.clip ? 'Release clipping' : 'Clipping mask', () => { it.clip = !it.clip; }); render(); app.requestRender(); }) : null,
      act('Delete', 'del', () => {
        quickFor = null;
        const i = d.items.indexOf(it); if (i < 0) return;
        if (it.type === 'group') deletePicked(app, [it]);
        else structCmd(app, 'Delete layer', () => { d.items.splice(i, 1); d.active = clamp(d.active >= i ? d.active - 1 : d.active, 0, Math.max(0, d.items.length - 1)); });
        render();
      }));
  };
  const togglePick = (it) => {
    closeSheet(); closeBlend();
    if (it === d.activeItem && !picked.size) { quickFor = quickFor === it ? null : it; navigator.vibrate && navigator.vibrate(6); render(); return; }
    quickFor = null;
    if (!picked.size && d.activeItem && d.activeItem !== it) picked.add(d.activeItem);
    if (picked.has(it)) picked.delete(it); else picked.add(it);
    if (picked.size === 1 && picked.has(d.activeItem)) picked.clear();
    navigator.vibrate && navigator.vibrate(6);
    render();
  };
  const multiBar = () => {
    const n = picked.size;
    const act = (label, fn, cls = '') => h('button', { class: 'multi-act ' + cls, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    const bar = h('div', { class: 'multi-bar' },
      h('div', { class: 'multi-head' }, h('b', {}, `${n} layer${n === 1 ? '' : 's'} selected`), act('Done', () => { picked.clear(); render(); }, 'done')),
      h('div', { class: 'multi-acts' },
        d.mode !== 'animate' ? act('Group', () => { groupPicked(app, [...picked]); picked.clear(); render(); }) : null,
        act('Merge', () => { if (mergePicked(app, [...picked])) { picked.clear(); render(); } }),
        act('Merge copy', () => { if (mergeCopyPicked(app, [...picked])) { picked.clear(); render(); } }),
        act('Duplicate', () => { duplicatePicked(app, [...picked]); render(); }),
        act([...picked].some((x) => x.visible) ? 'Hide' : 'Show', () => { const v = ![...picked].some((x) => x.visible); structCmd(app, v ? 'Show layers' : 'Hide layers', () => { for (const x of picked) x.visible = v; }); render(); }),
        act('Reference', () => { const v = ![...picked].every((x) => x.reference); structCmd(app, 'Reference', () => { for (const x of picked) if (x.type !== 'group') x.reference = v; }); render(); }),
        act('Lock', () => { const v = ![...picked].every((x) => x.locked); structCmd(app, v ? 'Lock layers' : 'Unlock layers', () => { for (const x of picked) x.locked = v; }); render(); }),
        act('Delete', async () => { if (!(await confirmDialog(`Delete ${n} layer${n === 1 ? '' : 's'}?`, 'Delete', true))) return; deletePicked(app, [...picked]); picked.clear(); render(); }, 'danger')),
      h('p', { class: 'hint' }, 'Swipe more layers sideways to add or remove them · tap a layer to finish'));
    return bar;
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
    // same layer, sheet already open: refresh its contents in place (no slide-in animation, the
    // scroll position is kept) — rebuilding it on every toggle made it jump and wobble
    if (sheetEl && sheetFor && sheetFor.it === it && sheetEl.isConnected) {
      const i = d.items.indexOf(it); if (i < 0) { closeSheet(); return; }
      const sb = sheetEl.querySelector('.sheet-body'), keep = sb.scrollTop;
      const rerender = () => { render(); if (d.items.includes(it)) openSheet(it); else closeSheet(); };
      sb.replaceChildren(sheetBody(app, it, i, rerender, closeSheet, () => openBlend(it)));
      sb.scrollTop = keep;
      sheetEl.querySelector('.sheet-head b').textContent = it.name;
      return;
    }
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
  const p = openPopover(anchor, { title: d.mode === 'animate' ? 'Tracks' : 'Layers', body: list, head, width: 340, key: 'layers', float: true, onClose: () => { closeSheet(); closeBlend(); layersOpen = null; document.removeEventListener('pointerdown', onDocDown, true); } });
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
  ['Darken', ['multiply', 'darken', 'color-burn', 'x-linear-burn', 'x-darker-color']],
  ['Lighten', ['screen', 'lighten', 'color-dodge', 'lighter', 'x-linear-dodge', 'x-lighter-color']],
  ['Contrast', ['overlay', 'soft-light', 'hard-light', 'x-vivid-light', 'x-linear-light', 'x-pin-light', 'x-hard-mix']],
  ['Difference', ['difference', 'exclusion', 'x-subtract', 'x-divide']],
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
    box.append(toggle('Alpha Lock', 'alphaLock', rerender), toggle('Clipping Mask', 'clip', rerender), toggle('Reference', 'reference', rerender), toggle('Lock Layer', 'locked', rerender), toggle('Private (hidden from time-lapse)', 'private', rerender));
    if (it.type === 'raster') {
      // Clip Studio layer options
      box.append(section('Clip Studio'));
      box.append(toggle('Draft Layer', 'draft', rerender));
      const exp = h('div', { class: 'sheet-seg' });
      for (const [k, l] of [['color', 'Color'], ['gray', 'Gray'], ['mono', 'Mono']]) exp.append(h('button', { class: (it.express || 'color') === k ? 'on' : '', onclick: () => { structCmd(app, 'Expression colour', () => { it.express = k; }); rerender(); } }, l));
      box.append(h('div', { class: 'sheet-item static' }, h('span', { html: ICONS.adjust || '' }), 'Expression', exp));
      box.append(toggle('Border Effect', 'border', rerender));
      if (it.border) {
        let bStart = null;
        const bw = field('Border width', { min: 1, max: 40, step: 1, value: it.borderWidth ?? 4, fmt: (v) => v + ' px', onInput: (v) => { if (!bStart) bStart = captureStruct(d); it.borderWidth = v; app.requestRender(); } });
        bw.querySelector('input').addEventListener('change', () => { if (!bStart) return; const before = bStart; bStart = null; const after = captureStruct(d); app.history.push({ label: 'Border width', undo() { restoreStruct(d, before); app.changed(); }, redo() { restoreStruct(d, after); app.changed(); } }); app.changed(); });
        const bc = h('input', { type: 'color', value: it.borderColor || '#ffffff' });
        bc.addEventListener('change', () => { structCmd(app, 'Border colour', () => { it.borderColor = bc.value; }); });
        bc.addEventListener('input', () => { it.borderColor = bc.value; app.requestRender(); });
        box.append(bw, h('div', { class: 'sheet-item static' }, h('span', { html: ICONS.panel || '' }), 'Border colour', bc));
      }
      box.append(section('Actions'));
    }
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

// ───────── multi-selection actions ─────────
export const membersOf = (d, list) => {
  // a picked group stands for its members
  const out = new Set();
  for (const it of list) {
    if (it.type === 'group') { for (const l of d.items) if (l.groupId === it.id) out.add(l); }
    else out.add(it);
  }
  return d.items.filter((x) => out.has(x)); // bottom → top
};
export function groupPicked(app, list) {
  const d = app.doc, mem = membersOf(d, list);
  if (!mem.length) return;
  structCmd(app, 'Group layers', () => {
    const top = mem[mem.length - 1];
    const oldGroups = new Set(list.filter((x) => x.type === 'group'));
    // anchor: insert the new group where the topmost layer was (outside any old group)
    const anchorG = top.groupId ? d.items.find((x) => x.id === top.groupId) : null;
    let after = null;
    if (!anchorG) { for (let k = d.items.indexOf(top) + 1; k < d.items.length; k++) if (!mem.includes(d.items[k]) && !oldGroups.has(d.items[k])) { after = d.items[k]; break; } }
    const g = new Layer(d.width, d.height, { type: 'group', name: 'New Group' });
    const rest = d.items.filter((x) => !mem.includes(x) && !oldGroups.has(x));
    let at = anchorG && rest.includes(anchorG) ? rest.indexOf(anchorG) + 1 : after ? rest.indexOf(after) : rest.length;
    for (const m of mem) m.groupId = g.id;
    rest.splice(at, 0, ...mem, g);
    // drop groups that were emptied
    const used = new Set(rest.map((x) => x.groupId));
    const items = rest.filter((x) => x.type !== 'group' || x === g || used.has(x.id));
    if (d.mode === 'animate') d.tracks = items; else d.layers = items;
    d.active = items.indexOf(g);
  });
}
// "pseudo merge": a new layer holding exactly what the picked layers show together, placed
// above the topmost one; the originals stay as they are (separate and editable)
function mergeCopyPicked(app, list) {
  const d = app.doc;
  const mem = membersOf(d, list).filter((x) => x.type === 'raster');
  if (mem.length < 2) { toast('Pick at least two paint layers'); return false; }
  if (!app.canAddRaster()) return false;
  const set = new Set(mem);
  const vis = mem.map((x) => x.visible); mem.forEach((x) => { x.visible = true; });
  const flat = d.flatten({ bg: false, filter: (it) => set.has(it) });
  mem.forEach((x, k) => { x.visible = vis[k]; });
  const top = mem[mem.length - 1];
  const copy = new Layer(d.width, d.height, { name: 'Merged copy (' + mem.length + ' layers)', groupId: top.groupId });
  copy.canvas.getContext('2d').drawImage(flat, 0, 0);
  structCmd(app, 'Merge copy', () => {
    const items = d.items;
    let at = items.indexOf(top) + 1;
    while (at < items.length && items[at].clip) at++; // keep the top layer's clipping layers attached
    items.splice(at, 0, copy);
    d.active = at;
  });
  toast(`Merged copy added · the ${mem.length} layers stay separate`);
  return true;
}
function mergePicked(app, list) {
  const d = app.doc;
  const mem = membersOf(d, list).filter((x) => x.type === 'raster');
  if (mem.length < 2) { toast('Pick at least two paint layers to merge'); return false; }
  const set = new Set(mem);
  const top = mem[mem.length - 1], bottom = mem[0];
  // composite exactly what is visible of those layers (blend modes, clipping, opacity)
  const vis = mem.map((x) => x.visible); mem.forEach((x) => { x.visible = true; });
  const flat = d.flatten({ bg: false, filter: (it) => set.has(it) });
  mem.forEach((x, k) => { x.visible = vis[k]; });
  const merged = new Layer(d.width, d.height, { name: top.name, groupId: bottom.groupId });
  merged.canvas.getContext('2d').drawImage(flat, 0, 0);
  structCmd(app, 'Merge layers', () => {
    const items = d.items, at = items.indexOf(bottom);
    items.splice(at, 1, merged);
    for (const m of mem) if (m !== bottom) items.splice(items.indexOf(m), 1);
    d.active = items.indexOf(merged);
  });
  return true;
}
function duplicatePicked(app, list) {
  const d = app.doc, mem = membersOf(d, list).filter((x) => x.type === 'raster');
  if (!mem.length) { toast('Only paint layers can be duplicated'); return; }
  if (!app.canAddRaster(mem.length)) return;
  structCmd(app, 'Duplicate layers', () => {
    for (const it of mem) {
      const copy = new Layer(d.width, d.height, { ...it, id: null, name: it.name + ' copy' });
      copy.canvas.getContext('2d').drawImage(it.canvas, 0, 0);
      d.items.splice(d.items.indexOf(it) + 1, 0, copy);
    }
  });
}
function deletePicked(app, list) {
  const d = app.doc;
  const gone = new Set(membersOf(d, list));
  for (const it of list) if (it.type === 'group') gone.add(it);
  structCmd(app, 'Delete layers', () => {
    const cur = d.activeItem;
    const items = d.items.filter((x) => !gone.has(x));
    if (d.mode === 'animate') d.tracks = items; else d.layers = items;
    d.active = clamp(items.includes(cur) ? items.indexOf(cur) : items.length - 1, 0, Math.max(0, items.length - 1));
  });
}

function mergeDown(app, i) {
  const d = app.doc, up = d.layers[i], low = d.layers[i - 1];
  const beforePx = cloneCanvas(low.canvas);
  const before = captureStruct(d);
  const x = low.canvas.getContext('2d');
  x.save(); x.globalAlpha = up.opacity;
  if (!up.clip && isCustomBlend(up.blend)) blendDraw(x, up.blend, (l) => l.drawImage(up.canvas, 0, 0));
  else { x.globalCompositeOperation = up.clip ? 'source-atop' : up.blend; x.drawImage(up.canvas, 0, 0); }
  x.restore();
  const afterPx = cloneCanvas(low.canvas);
  d.layers.splice(i, 1); d.active = i - 1;
  const after = captureStruct(d);
  touch(low.canvas);
  const put = (c) => { x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(c, 0, 0); x.restore(); touch(low.canvas); };
  app.history.push({ label: 'Merge', bytes: d.pixelBytes * 2, undo() { put(beforePx); restoreStruct(d, before); app.changed(); }, redo() { put(afterPx); restoreStruct(d, after); app.changed(); } });
  app.changed();
}
