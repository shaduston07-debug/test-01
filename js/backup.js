// Back up / restore everything (canvases, thumbnails, brushes, fonts, palettes, settings and,
// optionally, time-lapses) as one .inkwellbackup file — a zip of JSON plus the raw images —
// so nothing is lost when the app is deleted and reinstalled.
import { loadScript, toast, download } from './util.js';
import * as store from './storage.js';

const zipLib = async () => { await loadScript('vendor/jszip.min.js'); return window.JSZip; };

// replace Blobs / binary buffers with references to files inside the zip
function pack(value, files) {
  if (value instanceof Blob) { const p = 'files/' + files.length; files.push([p, value]); return { $blob: p, type: value.type }; }
  if (value instanceof ArrayBuffer) { const p = 'files/' + files.length; files.push([p, value]); return { $ab: p }; }
  if (ArrayBuffer.isView(value)) { const p = 'files/' + files.length; files.push([p, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)]); return { $view: p, kind: value.constructor.name }; }
  if (Array.isArray(value)) return value.map((v) => pack(v, files));
  if (value && typeof value === 'object') { const o = {}; for (const k in value) o[k] = pack(value[k], files); return o; }
  return value;
}
async function unpack(value, zip) {
  if (Array.isArray(value)) return Promise.all(value.map((v) => unpack(v, zip)));
  if (value && typeof value === 'object') {
    if (value.$blob) return new Blob([await zip.file(value.$blob).async('arraybuffer')], { type: value.type || '' });
    if (value.$ab) return zip.file(value.$ab).async('arraybuffer');
    if (value.$view) { const ab = await zip.file(value.$view).async('arraybuffer'); const C = globalThis[value.kind] || Uint8Array; return new C(ab); }
    const o = {}; for (const k in value) o[k] = await unpack(value[k], zip); return o;
  }
  return value;
}

export async function exportBackup({ timelapse = false, onProgress } = {}) {
  const JSZip = await zipLib(), zip = new JSZip(), files = [], data = { app: 'inkwell', v: 1, created: Date.now(), stores: {}, prefs: {} };
  for (const name of store.STORES) {
    if (name === 'timelapse' && !timelapse) continue;
    onProgress && onProgress('Reading ' + name + '…');
    data.stores[name] = pack(await store.dumpStore(name), files);
  }
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('inkwell:')) data.prefs[k] = localStorage.getItem(k); }
  zip.file('backup.json', JSON.stringify(data));
  for (const [p, b] of files) zip.file(p, b, { compression: 'STORE' }); // images are already compressed
  onProgress && onProgress('Packing…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  const n = (data.stores.meta || []).length;
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await download(blob, `Inkwell backup ${stamp}.inkwellbackup`);
  return { canvases: n, bytes: blob.size };
}

export async function importBackup(file, { onProgress } = {}) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(file);
  const json = zip.file('backup.json');
  if (!json) throw new Error('This isn’t an Inkwell backup');
  const data = JSON.parse(await json.async('string'));
  if (data.app !== 'inkwell') throw new Error('This isn’t an Inkwell backup');
  let canvases = 0;
  for (const name of store.STORES) {
    const recs = data.stores[name];
    if (!recs || !recs.length) continue;
    onProgress && onProgress('Restoring ' + name + '…');
    const restored = await unpack(recs, zip);
    // write in small batches so huge backups don't need everything in memory twice
    for (let i = 0; i < restored.length; i += 20) await store.putAll(name, restored.slice(i, i + 20));
    if (name === 'meta') canvases = restored.length;
  }
  for (const [k, v] of Object.entries(data.prefs || {})) { try { localStorage.setItem(k, v); } catch { /* storage full */ } }
  return { canvases };
}
export const BACKUP_ACCEPT = '.inkwellbackup,.zip';
