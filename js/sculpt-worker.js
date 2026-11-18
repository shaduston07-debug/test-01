// Meshes one sculpted part off the main thread (see sculpt.js).
import { buildPart } from './sculpt.js';
self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const r = buildPart(job);
    self.postMessage({ id, result: r }, [r.pos.buffer, r.nor.buffer, r.index.buffer, r.si.buffer, r.sw.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.stack || err) }); }
};
