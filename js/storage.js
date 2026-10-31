// IndexedDB persistence: documents (with thumbnails) and user brushes.
const DB_NAME = 'inkwell', VERSION = 3;
let dbp = null;

function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('brushes')) db.createObjectStore('brushes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('timelapse')) db.createObjectStore('timelapse', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Images are stored as plain bytes, never as Blobs. WebKit (iPad) has a bug where a Blob that was
// read from IndexedDB and written back (an unchanged layer saved again) loses its backing file
// when the old record is replaced: the layer can then never be read again.
export const isBytes = (x) => !!x && typeof x === 'object' && x.bytes instanceof ArrayBuffer;
export async function toBytes(x) {
  if (!(x instanceof Blob)) return x;
  return { bytes: await x.arrayBuffer(), type: x.type || 'image/png' };
}
export function toBlob(x) { return isBytes(x) ? new Blob([x.bytes], { type: x.type || 'image/png' }) : x; }
async function packDoc(data) {
  const out = { ...data };
  if (data.layers) out.layers = await Promise.all(data.layers.map(async (l) => {
    const o = { ...l };
    if (l.png) o.png = await toBytes(l.png);
    if (l.models) o.models = await Promise.all(l.models.map(async (m) => ({ ...m, blob: await toBytes(m.blob) })));
    return o;
  }));
  if (data.tracks) out.tracks = await Promise.all(data.tracks.map(async (t) => ({ ...t, cels: await Promise.all((t.cels || []).map(async (c) => ({ ...c, png: await toBytes(c.png) }))) })));
  return out;
}

export async function saveDoc(data, meta) {
  // pack first: a transaction must not wait on anything else or it auto-commits
  data = await packDoc(data);
  if (meta && meta.thumb) meta = { ...meta, thumb: await toBytes(meta.thumb) };
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(['docs', 'meta'], 'readwrite');
    t.objectStore('docs').put(data);
    t.objectStore('meta').put(meta);
    t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
export const loadDoc = (id) => tx('docs', 'readonly', (s) => req(s.get(id)));
export const saveMeta = (meta) => tx('meta', 'readwrite', (s) => req(s.put(meta)));
export const listDocs = async () => (await tx('meta', 'readonly', (s) => req(s.getAll()))).map((m) => (m && isBytes(m.thumb) ? { ...m, thumb: toBlob(m.thumb) } : m));
export async function deleteDoc(id) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(['docs', 'meta'], 'readwrite');
    t.objectStore('docs').delete(id); t.objectStore('meta').delete(id);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
// time-lapse frames, stored in chunks: { id: '<docId>:<chunk>', frames: [Blob, …] }
export async function putTimelapse(rec) {
  const frames = await Promise.all((rec.frames || []).map(toBytes));
  return tx('timelapse', 'readwrite', (s) => req(s.put({ ...rec, frames })));
}
export async function getTimelapse(id) {
  const rec = await tx('timelapse', 'readonly', (s) => req(s.get(id)));
  return rec ? { ...rec, frames: (rec.frames || []).map(toBlob) } : rec;
}
export const deleteTimelapse = (docId) => tx('timelapse', 'readwrite', (s) => req(s.delete(IDBKeyRange.bound(docId + ':', docId + ':\uffff'))));
export const listFonts = () => tx('fonts', 'readonly', (s) => req(s.getAll()));
export const saveFont = (f) => tx('fonts', 'readwrite', (s) => req(s.put(f)));
export const listBrushes = () => tx('brushes', 'readonly', (s) => req(s.getAll()));
export const saveBrush = (b) => tx('brushes', 'readwrite', (s) => req(s.put(b)));
export const deleteBrush = (id) => tx('brushes', 'readwrite', (s) => req(s.delete(id)));

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}

// small synchronous prefs
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('inkwell:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('inkwell:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// whole-store access for backup / restore
export const dumpStore = (name) => tx(name, 'readonly', (s) => req(s.getAll()));
export const putAll = (name, records) => tx(name, 'readwrite', (s) => { for (const r of records) s.put(r); });
export const STORES = ['docs', 'meta', 'brushes', 'fonts', 'timelapse'];
