// Outline filter (like ibis Paint's "Outline"): a stroke of any width around the layer's
// paint — outside, inside or centred — with soft edges, optional "outline only" (the fill is
// removed) and "on a new layer". Distances come from an exact Euclidean distance transform, so
// thick outlines stay round at the corners; width / colour changes only re-run a cheap pass.
import { h, toast, field, seg, switchRow, hexToRgb, clamp } from './util.js';
import { Layer } from './doc.js';
import { alphaBounds } from './tools.js';
import { touch } from './history.js';
import { insertLayer } from './layers.js';
import { openPopover, closePopover } from './ui.js';
import * as store from './storage.js';

const INF = 1e20;
// 1-D squared distance transform (Felzenszwalb & Huttenlocher)
function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// distance (px) from every pixel to the nearest pixel where inside[i] is true
function edt(inside, w, hh) {
  const g = new Float64Array(w * hh), n = Math.max(w, hh);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < g.length; i++) g[i] = inside[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { for (let y = 0; y < hh; y++) f[y] = g[y * w + x]; dt1(f, hh, d, v, z); for (let y = 0; y < hh; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < hh; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; dt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}

export function openOutline(app, anchor) {
  const d = app.doc, target = d.getTarget(false);
  if (!target || d.isLocked(d.activeItem)) { toast(target ? 'This layer is locked' : 'Pick a paint layer'); return; }
  const c = target.canvas, ctx = c.getContext('2d', { willReadFrequently: true });
  const ab = alphaBounds(c);
  if (!ab) { toast('This layer is empty'); return; }
  const P = { width: 8, soft: 0.5, pos: 'outside', only: false, newLayer: false, color: app.color, ...store.prefs.get('outline', {}) };
  P.color = app.color;
  const M = 104; // room for the widest outline
  const x0 = Math.max(0, ab.x - M), y0 = Math.max(0, ab.y - M), x1 = Math.min(c.width, ab.x + ab.w + M), y1 = Math.min(c.height, ab.y + ab.h + M);
  const w = x1 - x0, hh = y1 - y0;
  const orig = ctx.getImageData(x0, y0, w, hh), od = orig.data;
  const inside = new Uint8Array(w * hh); for (let i = 0; i < inside.length; i++) inside[i] = od[i * 4 + 3] >= 128;
  const outside = new Uint8Array(w * hh); for (let i = 0; i < inside.length; i++) outside[i] = !inside[i];
  const dOut = edt(inside, w, hh); // for pixels outside the paint: distance to it
  const dIn = edt(outside, w, hh); // for pixels inside: distance to the edge
  let done = false, raf = 0;
  // outline alpha (0–1) for one pixel
  const lineA = (i) => {
    const W = P.width, s = Math.max(0.5, P.soft * W * 0.5 + 0.5);
    let lo, hi, dist;
    if (inside[i]) dist = -(dIn[i] - 0.5); else dist = dOut[i] - 0.5; // signed: <0 inside, >0 outside
    if (P.pos === 'outside') { lo = 0; hi = W; } else if (P.pos === 'inside') { lo = -W; hi = 0; } else { lo = -W / 2; hi = W / 2; }
    // soft only on the far edge (the edge touching the paint stays crisp), both edges when centred
    const a1 = P.pos === 'inside' || P.pos === 'center' ? clamp((dist - lo) / s + 0.5, 0, 1) : (dist >= lo - 0.5 ? 1 : 0);
    const a2 = P.pos === 'outside' || P.pos === 'center' ? clamp((hi - dist) / s + 0.5, 0, 1) : (dist <= hi + 0.5 ? 1 : 0);
    return Math.min(a1, a2);
  };
  // the outline pixels alone, and the layer result
  const render = (mode) => {
    const [r, g, b] = hexToRgb(P.color);
    const out = new ImageData(w, hh), o = out.data;
    for (let i = 0, n = w * hh; i < n; i++) {
      const la = lineA(i), q = i * 4;
      const sa = od[q + 3] / 255;
      if (mode === 'line' || P.only) {
        // outline only: hide the paint; an inside outline keeps the paint's own alpha edge
        o[q] = r; o[q + 1] = g; o[q + 2] = b; o[q + 3] = (P.pos === 'inside' ? la * sa : la) * 255;
        continue;
      }
      // paint + outline: inside / centre lines lie on top of the paint, outside ones beneath it
      const top = P.pos !== 'outside';
      const la2 = top && P.pos === 'inside' ? la * sa : la;
      let fr, fg, fb, fa;
      if (top) { fa = la2 + sa * (1 - la2); fr = (r * la2 + od[q] * sa * (1 - la2)); fg = (g * la2 + od[q + 1] * sa * (1 - la2)); fb = (b * la2 + od[q + 2] * sa * (1 - la2)); }
      else { fa = sa + la * (1 - sa); fr = (od[q] * sa + r * la * (1 - sa)); fg = (od[q + 1] * sa + g * la * (1 - sa)); fb = (od[q + 2] * sa + b * la * (1 - sa)); }
      if (fa > 0) { o[q] = fr / fa; o[q + 1] = fg / fa; o[q + 2] = fb / fa; }
      o[q + 3] = fa * 255;
    }
    return out;
  };
  const preview = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (done) return; ctx.putImageData(render(), x0, y0); touch(c); app.markDirty({ x: x0, y: y0, w, h: hh }); });
  };
  const save = () => store.prefs.set('outline', { width: P.width, soft: P.soft, pos: P.pos, only: P.only, newLayer: P.newLayer });
  const apply = () => {
    if (done) return; done = true; save();
    if (P.newLayer) {
      // the layer stays as it was; the outline goes on its own layer (below for outside lines)
      ctx.putImageData(orig, x0, y0); touch(c);
      const l = new Layer(d.width, d.height, { name: `${d.activeItem.name} outline`, groupId: d.activeItem.groupId });
      l.canvas.getContext('2d').putImageData(render('line'), x0, y0);
      if (!app.canAddRaster()) { app.requestRender(); return; }
      const i = d.active;
      insertLayer(app, l, P.pos === 'outside' ? i : i + 1);
      return;
    }
    const after = ctx.getImageData(x0, y0, w, hh);
    const put = (img) => { ctx.putImageData(img, x0, y0); touch(c); app.requestRender(); };
    app.history.push({ label: 'Outline', bytes: w * hh * 8, undo() { put(orig); app.changed(); }, redo() { put(after); app.changed(); } });
    app.changed();
  };
  const cancel = () => { if (done) return; done = true; ctx.putImageData(orig, x0, y0); touch(c); app.changed('patched'); app.markDirty({ x: x0, y: y0, w, h: hh }); };
  const colorIn = h('input', { type: 'color', value: P.color });
  colorIn.oninput = () => { P.color = colorIn.value; preview(); };
  const body = h('div', { class: 'outline-pop' },
    field('Width', { min: 1, max: 100, step: 1, value: P.width, fmt: (v) => v + ' px', onInput: (v) => { P.width = v; preview(); } }),
    field('Softness', { min: 0, max: 1, step: 0.01, value: P.soft, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { P.soft = v; preview(); } }),
    h('div', { class: 'toggle-row' }, h('span', {}, 'Colour'), colorIn),
    seg([['outside', 'Outside'], ['center', 'Centre'], ['inside', 'Inside']], P.pos, (v) => { P.pos = v; preview(); }),
    switchRow('Outline only (remove the fill)', P.only, (v) => { P.only = v; preview(); }),
    switchRow('Put the outline on a new layer', P.newLayer, (v) => { P.newLayer = v; }),
  );
  const head = [h('button', { class: 'small-btn', onclick: () => { cancel(); closePopover(); } }, 'Cancel'), h('button', { class: 'small-btn on', onclick: () => { apply(); closePopover(); } }, 'Apply')];
  openPopover(anchor, { title: 'Outline', body, head, width: 340, key: 'outline', sticky: true, onClose: () => apply() });
  preview();
}
