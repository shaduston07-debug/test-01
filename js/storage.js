// IndexedDB persistence: documents (with thumbnails) and user brushes.
const DB_NAME = 'inkwell', VERSION = 1;
let dbp = null;

function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('brushes')) db.createObjectStore('brushes', { keyPath: 'id' });
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

export async function saveDoc(data, meta) {
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
export const listDocs = () => tx('meta', 'readonly', (s) => req(s.getAll()));
export async function deleteDoc(id) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(['docs', 'meta'], 'readwrite');
    t.objectStore('docs').delete(id); t.objectStore('meta').delete(id);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
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
