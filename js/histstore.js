// Undo history that survives closing the app. Each step that knows how to describe itself
// (cmd.ser) is stored with the canvas: pixel steps keep the changed area as a PNG, 3D steps the
// scene before / after, layer steps the layer ids and settings. A step that can't be saved (it
// needs a deleted layer's pixels, for example) is where the saved history starts.
import * as store from './storage.js';
import { pixelCmdFrom, imageCanvas } from './history.js';
import { structFrom } from './layers.js';

const sid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const safe = async (p) => { try { return await p; } catch (e) { console.warn('history step', e); return null; } };

async function serAll(list, undone) {
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i], rec = c.ser ? await safe(c.ser(undone)) : null;
    if (!rec) break;
    out.unshift([c, rec]);
  }
  return out;
}

export async function saveHistory(d, u, r) {
  if (!d || !d.id) return;
  const su = await serAll(u, false), sr = await serAll(r, true);
  const puts = [];
  for (const [list, state] of [[su, 'u'], [sr, 'r']]) {
    for (const [c, rec] of list) {
      c._hid ||= sid();
      if (c._saved === state) continue;
      const packed = { ...rec };
      for (const k of ['before', 'redo']) if (packed[k] instanceof Blob) packed[k] = await store.toBytes(packed[k]);
      puts.push({ id: d.id + ':' + c._hid, label: c.label || '', t: c.t || 0, rec: packed });
      c._saved = state;
    }
  }
  const index = { id: d.id + ':index', u: su.map(([c]) => c._hid), r: sr.map(([c]) => c._hid), at: Date.now() };
  await store.histPut([...puts, index]);
  // steps no longer in the history (undone and replaced, or too old)
  const keep = new Set([index.id, ...index.u.map((x) => d.id + ':' + x), ...index.r.map((x) => d.id + ':' + x)]);
  const gone = (await store.histKeys(d.id)).filter((k) => !keep.has(k));
  if (gone.length) await store.histDelete(gone);
}

async function revive(app, d, row, undone) {
  const rec = row.rec, label = row.label;
  if (rec.k === 'px') {
    let canvas = null;
    if (rec.own.lid) { const it = d.items.find((x) => x.id === rec.own.lid); canvas = it && it.canvas; }
    else if (rec.own.tid) { const t = d.items.find((x) => x.id === rec.own.tid); const cel = t && t.cels && t.cels.find((c) => c.start === rec.own.start); canvas = cel && cel.canvas; }
    if (!canvas || rec.x + rec.w > canvas.width || rec.y + rec.h > canvas.height) return null;
    const before = await imageCanvas(store.toBlob(rec.before));
    const redo = undone ? (rec.redo ? await imageCanvas(store.toBlob(rec.redo)) : null) : null;
    if (undone && !redo) return null;
    return pixelCmdFrom(canvas, rec.x, rec.y, rec.w, rec.h, label, before, redo, () => app.requestRender());
  }
  if (rec.k === '3d') {
    const L = d.items.find((x) => x.id === rec.lid && x.type === '3d'), tool = app.tools && app.tools['3d'];
    if (!L || !tool || !tool.cmd3d) return null;
    return tool.cmd3d(L, label, rec.before, rec.after, rec.stack, undone);
  }
  if (rec.k === 'st') return structFrom(app, d, rec, label);
  if (rec.k === 'bg') return { label, undo() { d.bg = rec.before; app.changed(); }, redo() { d.bg = rec.after; app.changed(); }, ser: async () => rec };
  if (rec.k === 'sel') return { label, undo() {}, redo() {}, ser: async () => rec }; // the selection itself isn't kept
  return null;
}

export async function loadHistory(app, d) {
  if (!d || !d.id) return;
  const idx = await safe(store.histGet(d.id + ':index'));
  if (!idx) return;
  const build = async (ids, undone) => {
    let out = [];
    for (const hid of ids) {
      const row = await safe(store.histGet(d.id + ':' + hid));
      const c = row ? await safe(revive(app, d, row, undone)) : null;
      if (app.doc !== d) return null;
      // a step that can't come back: everything before it goes too (it would undo out of order)
      if (!c) { out = []; continue; }
      c._hid = hid; c._saved = undone ? 'r' : 'u'; c.t = row.t; c.bytes ||= 0;
      out.push(c);
    }
    return out;
  };
  const U = await build(idx.u || [], false); if (!U) return;
  const R = await build(idx.r || [], true); if (!R) return;
  const H = app.history;
  // anything done while this was loading comes after the saved steps (and ends their redo)
  const fresh = H.u.length > 0;
  H.u = [...U, ...H.u];
  if (!fresh) H.r = [...R, ...H.r];
  H.bytes = [...H.u, ...H.r].reduce((a, c) => a + (c.bytes || 0), 0);
  H.onChange();
  if (app.tools && app.tools['3d'] && app.tools['3d'].u3dButtons) app.tools['3d'].u3dButtons();
}
