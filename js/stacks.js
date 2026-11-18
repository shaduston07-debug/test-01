// Colouring stacks: ready-made sets of clipped colour layers (each a solid colour with a blend
// mode and opacity), the way ibis Paint / Procreate artists colour-grade a grayscale or flat
// drawing. Apply them as real clipped layers (editable, re-orderable, hideable) or bake them
// into the layer. With several layers picked in the Layers panel they are grouped and the
// stack clips to the whole folder, so each layer stays separate and editable.
import { h, toast, promptDialog } from './util.js';
import { touch } from './history.js';
import { Layer, BLEND_MODES } from './doc.js';
import { blendDraw, isCustomBlend } from './blendgl.js';
import { structCmd, pickedLayers, membersOf, groupPicked, clearPicked } from './layers.js';
import { openPopover, closePopover } from './ui.js';
import * as store from './storage.js';

// layers listed top → bottom, as in the Layers panel: [colour, blend, opacity]
export const STACK_PRESETS = [
  { name: 'Crimson', note: 'for a grayscale base', layers: [['#8E343D', 'color-dodge', 1], ['#B7595B', 'color-dodge', 0.65], ['#B6976C', 'color-burn', 0.65], ['#808080', 'saturation', 1]] },
  { name: 'Lit', layers: [['#000000', 'soft-light', 1], ['#4a1010', 'soft-light', 1], ['#b30000', 'soft-light', 1], ['#ffffff', 'darken', 1]] },
  { name: 'Teal', layers: [['#FAF1CA', 'overlay', 0.81], ['#0F3C66', 'x-vivid-light', 0.64], ['#000000', 'saturation', 0.74]] },
  { name: 'Blue', layers: [['#2D9099', 'color-burn', 0.2], ['#6D558F', 'screen', 0.3], ['#1D3026', 'color-burn', 0.4], ['#494354', 'x-linear-dodge', 0.85]] },
  { name: 'Lavender', layers: [['#ffffff', 'soft-light', 1], ['#8aa6ff', 'saturation', 0.8], ['#c8bcd6', 'color-burn', 0.7], ['#808080', 'x-vivid-light', 0.4], ['#f3ead2', 'lighten', 0.55]] },
  { name: 'Warm tutorial', layers: [['#6b4a3e', 'x-lighter-color', 0.47], ['#ff8c1a', 'color-burn', 0.22], ['#ff9fb5', 'color-burn', 0.39], ['#a58cd6', 'color-burn', 0.47]] },
  { name: 'Neon', layers: [['#7fe6f0', 'saturation', 0.4], ['#f07a6e', 'difference', 0.4], ['#d6f07a', 'x-darker-color', 0.3], ['#ff7ab4', 'color', 0.4], ['#8a96ff', 'x-lighter-color', 0.4]] },
];
const modeName = (m) => (BLEND_MODES.find((b) => b[0] === m) || [m, m])[1];
const userPresets = () => store.prefs.get('stacks.user', []);

// draws a stack over a copy of src the same way clipped layers composite (doc.js): each colour
// is blended with what is below, kept only where the base has paint, laid source-atop
export function bakeStack(src, layers) {
  const W = src.width, H = src.height;
  const G = document.createElement('canvas'); G.width = W; G.height = H;
  const T = document.createElement('canvas'); T.width = W; T.height = H;
  const g = G.getContext('2d'), t = T.getContext('2d');
  g.drawImage(src, 0, 0);
  for (const [color, blend, op] of [...layers].reverse()) {
    t.globalCompositeOperation = 'copy'; t.globalAlpha = 1; t.drawImage(G, 0, 0);
    t.globalCompositeOperation = 'source-over';
    const fill = (c) => { c.fillStyle = color; c.fillRect(0, 0, W, H); };
    if (isCustomBlend(blend)) { t.globalAlpha = op; blendDraw(t, blend, fill, null); t.globalAlpha = 1; }
    else { t.globalCompositeOperation = blend; t.globalAlpha = op; fill(t); t.globalAlpha = 1; t.globalCompositeOperation = 'source-over'; }
    g.globalCompositeOperation = 'source-atop'; g.drawImage(T, 0, 0); g.globalCompositeOperation = 'source-over';
  }
  return G;
}

// what the stack applies to: the picked layers (if any) or the active layer
function targets(app) {
  const d = app.doc, picked = pickedLayers(app);
  if (picked.length > 1) return { multi: true, list: membersOf(d, picked).filter((x) => x.type === 'raster'), picked };
  const it = d.activeItem;
  if (!it) return { list: [] };
  if (it.type === 'group') return { group: it, list: d.items.filter((x) => x.groupId === it.id && x.type === 'raster') };
  return { list: it.type === 'raster' ? [it] : [] };
}

function addAsLayers(app, preset) {
  const d = app.doc, tg = targets(app);
  if (!tg.list.length && !tg.group) { toast('Pick a paint layer (or several in the Layers panel)'); return; }
  const n = preset.layers.length;
  if (!app.canAddRaster(n)) return;
  // several picked layers: group them first, then clip the stack to the folder
  if (tg.multi) { groupPicked(app, tg.picked); clearPicked(); }
  const anchor = tg.multi ? d.activeItem : tg.group || tg.list[0];
  structCmd(app, 'Colouring stack: ' + preset.name, () => {
    const items = d.items;
    let at = items.indexOf(anchor) + 1;
    while (at < items.length && items[at].clip) at++; // above the base's existing clipping layers
    const made = [...preset.layers].reverse().map(([color, blend, op]) => {
      const l = new Layer(d.width, d.height, { name: `${preset.name} · ${modeName(blend)}`, blend, opacity: op, clip: true, groupId: anchor.type === 'group' ? null : anchor.groupId });
      const x = l.canvas.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, d.width, d.height);
      return l;
    });
    items.splice(at, 0, ...made);
    d.active = at + made.length - 1;
  });
  toast(`${preset.name}: ${n} clipped colour layers added${tg.multi || tg.group ? ' above the folder' : ''}`);
}

function bakeInto(app, preset) {
  const tg = targets(app);
  const list = tg.list.filter((x) => !app.doc.isLocked(x));
  if (!list.length) { toast('Pick an unlocked paint layer'); return; }
  const before = list.map((l) => { const c = document.createElement('canvas'); c.width = l.canvas.width; c.height = l.canvas.height; c.getContext('2d').drawImage(l.canvas, 0, 0); return c; });
  const after = list.map((l) => bakeStack(l.canvas, preset.layers));
  const put = (arr) => list.forEach((l, i) => { const x = l.canvas.getContext('2d'); x.save(); x.globalCompositeOperation = 'copy'; x.drawImage(arr[i], 0, 0); x.restore(); touch(l.canvas); });
  put(after);
  app.history.push({ label: 'Colouring stack: ' + preset.name, bytes: list.reduce((a, l) => a + l.canvas.width * l.canvas.height * 8, 0), undo() { put(before); app.changed(); }, redo() { put(after); app.changed(); } });
  app.changed();
  toast(`${preset.name} baked into ${list.length} layer${list.length > 1 ? 's' : ''}`);
}

// save the clipped solid-colour layers above the active base as a new preset
async function saveFromLayers(app) {
  const d = app.doc, items = d.items;
  let i = d.active;
  while (i > 0 && items[i].clip) i--;
  const clips = [];
  for (let j = i + 1; j < items.length && items[j].clip; j++) {
    const l = items[j]; if (l.type !== 'raster') continue;
    const x = l.canvas.getContext('2d', { willReadFrequently: true });
    const px = x.getImageData(Math.floor(l.canvas.width / 2), Math.floor(l.canvas.height / 2), 1, 1).data;
    if (px[3] < 128) continue;
    clips.push(['#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join(''), l.blend, l.opacity]);
  }
  if (!clips.length) { toast('Select a layer that has solid colour clipping layers above it'); return null; }
  const name = await promptDialog('Name for this colouring stack', 'My stack ' + (userPresets().length + 1));
  if (!name) return null;
  const list = userPresets(); list.push({ name, layers: clips.reverse(), user: true });
  store.prefs.set('stacks.user', list);
  toast(`Saved “${name}” (${clips.length} layers)`);
  return true;
}

export function openStacks(app, anchor) {
  const body = h('div', { class: 'stacks' });
  const build = () => {
    body.innerHTML = '';
    const tg = targets(app);
    const who = tg.multi ? `${tg.list.length} picked layers → grouped, stack clips to the folder` : tg.group ? `Folder “${tg.group.name}”` : tg.list[0] ? `Layer “${tg.list[0].name}”` : 'No paint layer selected';
    body.append(h('p', { class: 'hint' }, 'Applies to: ' + who));
    for (const pr of [...STACK_PRESETS, ...userPresets()]) {
      const sw = h('div', { class: 'stack-sw' }, ...pr.layers.map(([c, b, o]) => h('span', { title: `${c} · ${modeName(b)} ${Math.round(o * 100)}%`, style: { background: c } })));
      const row = h('div', { class: 'stack-row' },
        h('div', { class: 'stack-info' }, h('b', {}, pr.name), h('small', {}, pr.layers.map(([, b, o]) => `${modeName(b)} ${Math.round(o * 100)}%`).join(' · ') + (pr.note ? ' — ' + pr.note : '')), sw),
        h('div', { class: 'stack-acts' },
          h('button', { class: 'small-btn on', title: 'Add as separate clipped layers', onclick: () => { addAsLayers(app, pr); closePopover(); } }, 'As layers'),
          h('button', { class: 'small-btn', title: 'Bake into the selected layer(s)', onclick: () => { bakeInto(app, pr); closePopover(); } }, 'Onto layer'),
          pr.user ? h('button', { class: 'small-btn', title: 'Delete preset', onclick: () => { store.prefs.set('stacks.user', userPresets().filter((u) => u.name !== pr.name)); build(); } }, '×') : null));
      body.append(row);
    }
    body.append(h('button', { class: 'small-btn', style: { marginTop: '8px' }, onclick: async () => { if (await saveFromLayers(app)) build(); } }, '＋ Save the clipping layers above this layer as a preset'));
  };
  build();
  openPopover(anchor, { title: 'Colouring stacks', body, width: 380, key: 'stacks' });
}
