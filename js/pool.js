// Worker pool sized to the CPU (an M4 iPad has 9–10 cores). Jobs go to the least busy
// worker; image adjustments are split into horizontal bands and run on all of them at once.
// Everything falls back to the main thread if workers aren't available.
import { ADJUSTMENTS, fillRegion, wandRegion } from './tools.js';

export const poolSize = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
let workers = null, seq = 0;
const pending = new Map();

function ensure() {
  if (workers) return workers;
  workers = [];
  try {
    for (let i = 0; i < poolSize; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = (e) => {
        const { id, ok, result, error } = e.data, p = pending.get(id);
        if (!p) return;
        pending.delete(id); w.busy--;
        ok ? p.res(result) : p.rej(new Error(error));
      };
      w.onerror = (e) => { console.warn('worker error', e.message); };
      workers.push(w);
    }
  } catch (e) { console.warn('workers unavailable', e); workers = []; }
  return workers;
}

export function run(task, payload, transfer = []) {
  const ws = ensure();
  if (!ws.length) return Promise.reject(new Error('no workers'));
  const w = ws.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = ++seq;
  w.busy++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    w.postMessage({ id, task, payload }, transfer);
  });
}

const NEIGHBOURHOOD = { blur: (p) => p.radius, sharpen: (p) => p.radius };

// Runs an adjustment on RGBA data in parallel bands; returns the new data.
export async function parallelAdjust(key, params, data, w, h) {
  const reach = NEIGHBOURHOOD[key] ? Math.ceil(NEIGHBOURHOOD[key](params) * 3) + 2 : 0;
  const bands = Math.max(1, Math.min(poolSize, Math.floor(h / Math.max(32, reach * 2))));
  try {
    if (bands < 2 && h * w < 300000) throw new Error('small: run locally');
    const rows = Math.ceil(h / bands);
    const jobs = [];
    for (let b = 0; b < bands; b++) {
      const y0 = b * rows, y1 = Math.min(h, y0 + rows);
      if (y0 >= y1) break;
      const s0 = Math.max(0, y0 - reach), s1 = Math.min(h, y1 + reach);
      const band = data.slice(s0 * w * 4, s1 * w * 4);
      jobs.push(run('adjust', { key, params, data: band.buffer, w, h: s1 - s0 }, [band.buffer]).then((buf) => ({ buf, y0, y1, s0 })));
    }
    const out = new Uint8ClampedArray(data.length);
    for (const { buf, y0, y1, s0 } of await Promise.all(jobs)) {
      const band = new Uint8ClampedArray(buf);
      out.set(band.subarray((y0 - s0) * w * 4, (y1 - s0) * w * 4), y0 * w * 4);
    }
    return out;
  } catch {
    const out = new Uint8ClampedArray(data);
    ADJUSTMENTS[key].run(out, params, w, h);
    return out;
  }
}

export async function fillRegionAsync(src, w, h, x, y, opts) {
  try {
    const buf = await run('fill', { data: src.buffer, w, h, x, y, opts }, [src.buffer]);
    return buf ? new Uint8Array(buf) : null;
  } catch { return src.byteLength ? fillRegion(src, w, h, x, y, opts) : null; }
}

export async function wandRegionAsync(src, w, h, x, y, tol) {
  const copy = src.slice();
  try { return new Uint8Array(await run('wand', { data: copy.buffer, w, h, x, y, tol }, [copy.buffer])); }
  catch { return wandRegion(src, w, h, x, y, tol); }
}

// PNG encode in a worker (OffscreenCanvas), falling back to canvas.toBlob.
const canOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
export async function encodePNG(canvas) {
  if (canOffscreen) {
    try {
      const bitmap = await createImageBitmap(canvas);
      const blob = await run('png', { bitmap }, [bitmap]);
      if (blob && blob.size) return blob;
    } catch { /* fall back */ }
  }
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}
