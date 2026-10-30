// Background worker: runs CPU-heavy pixel jobs off the main thread, one per core.
import { ADJUSTMENTS, fillRegion, wandRegion } from './tools.js';
import { encodeGif } from './gif.js';

const tasks = {
  // one horizontal band of an image adjustment
  adjust({ key, params, data, w, h }) {
    const d = new Uint8ClampedArray(data);
    ADJUSTMENTS[key].run(d, params, w, h);
    return [d.buffer, [d.buffer]];
  },
  fill({ data, w, h, x, y, opts }) {
    const r = fillRegion(new Uint8ClampedArray(data), w, h, x, y, opts);
    return r ? [r.buffer, [r.buffer]] : [null, []];
  },
  wand({ data, w, h, x, y, tol }) {
    const r = wandRegion(new Uint8ClampedArray(data), w, h, x, y, tol);
    return [r.buffer, [r.buffer]];
  },
  // PNG encoding for autosave (OffscreenCanvas)
  async png({ bitmap }) {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close && bitmap.close();
    return [await c.convertToBlob({ type: 'image/png' }), []];
  },
  gif({ frames, w, h, delay, loop }) {
    const bytes = encodeGif(frames.map((b) => ({ width: w, height: h, data: new Uint8ClampedArray(b) })), delay, loop);
    return [bytes.buffer, [bytes.buffer]];
  },
};

self.onmessage = async (e) => {
  const { id, task, payload } = e.data;
  try {
    const [result, transfer] = await tasks[task](payload);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
