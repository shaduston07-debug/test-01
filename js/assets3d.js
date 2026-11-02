// 3D asset library (like Clip Studio's Assets, for Blender-made content):
// browse and download free CC0 models and PBR materials from Poly Haven — authored in Blender,
// with their Blender materials exported as glTF — whenever there is Wi-Fi. Downloads are packed
// into a single .glb and kept on the device, so they also work offline.
// Also: Blender exports (.glb / .gltf + its files / .zip) imported from Files.
import { h, toast, dialog, uid, loadScript } from './util.js';
import * as store from './storage.js';

const API = 'https://api.polyhaven.com';
const THUMB = (id, w = 256) => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=${w}&height=${w}`;

async function getJSON(url, ms = 15000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('server answered ' + r.status);
    return await r.json();
  } catch (e) {
    throw new Error(navigator.onLine === false ? 'You’re offline — connect to Wi-Fi to browse new assets (downloaded ones still work).' : (e.name === 'AbortError' ? 'The asset server didn’t answer in time.' : e.message));
  } finally { clearTimeout(t); }
}
async function getBytes(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed (' + r.status + ')');
  if (!r.body || !onProgress) return new Uint8Array(await r.arrayBuffer());
  const total = +r.headers.get('content-length') || 0, chunks = []; let got = 0;
  const rd = r.body.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length; onProgress(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ───────── glTF → single GLB (buffers and images embedded) ─────────
const enc = new TextEncoder();
const mimeOf = (name) => (/\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.ktx2$/i.test(name) ? 'image/ktx2' : 'image/jpeg');
// json: parsed .gltf; files: Map(uri or file name → Uint8Array)
export function packGLB(json, files) {
  const find = (uri) => {
    const u = decodeURIComponent(uri);
    if (files.has(uri)) return files.get(uri);
    if (files.has(u)) return files.get(u);
    const base = u.split('/').pop();
    for (const [k, v] of files) if (k.split('/').pop() === base) return v;
    return null;
  };
  const parts = []; let off = 0;
  const add = (bytes) => { const at = off; parts.push(bytes); off += bytes.length; const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; } return at; };
  const dataUri = (uri) => { const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri); if (!m) return null; if (m[2]) { const b = atob(m[3]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } return enc.encode(decodeURIComponent(m[3])); };
  const bufOff = (json.buffers || []).map((b) => {
    const bytes = b.uri ? (b.uri.startsWith('data:') ? dataUri(b.uri) : find(b.uri)) : null;
    if (!bytes) throw new Error('missing file ' + (b.uri || 'buffer') + ' — pick the .gltf together with its .bin and texture files, or a .zip of the folder');
    return add(bytes);
  });
  for (const bv of json.bufferViews || []) { bv.byteOffset = (bv.byteOffset || 0) + bufOff[bv.buffer]; bv.buffer = 0; }
  json.bufferViews = json.bufferViews || [];
  for (const img of json.images || []) {
    if (!img.uri) continue;
    const bytes = img.uri.startsWith('data:') ? dataUri(img.uri) : find(img.uri);
    if (!bytes) { delete img.uri; continue; } // missing texture: the material keeps its colour
    const at = add(bytes);
    json.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: bytes.length });
    img.mimeType = img.mimeType || (img.uri.startsWith('data:') ? img.uri.slice(5, img.uri.indexOf(';')) : mimeOf(img.uri));
    img.bufferView = json.bufferViews.length - 1; delete img.uri;
  }
  json.buffers = [{ byteLength: off }];
  let js = enc.encode(JSON.stringify(json)); const jpad = (4 - (js.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.length + jpad).fill(0x20); t.set(js); js = t; }
  const total = 12 + 8 + js.length + 8 + off, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  let p = 20 + js.length; dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004e4942, true); p += 8;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

// Files picked in the Files app (a Blender export): one model ready for the 3D layer.
// Returns {ext, blob, name} or null. Handles .glb, .gltf + .bin + textures, .zip, .fbx, .obj, .blend.
export async function modelFromFiles(files) {
  files = [...files];
  const by = (re) => files.find((f) => re.test(f.name));
  const blend = by(/\.blend\d*$/i);
  if (blend && !by(/\.(glb|gltf|fbx|obj|zip)$/i)) return { ext: 'blend', name: blend.name, blob: blend };
  const zip = by(/\.zip$/i);
  if (zip) {
    await loadScript('vendor/jszip.min.js');
    const z = await window.JSZip.loadAsync(await zip.arrayBuffer());
    const entries = Object.values(z.files).filter((e) => !e.dir && !/__MACOSX|\/\./.test(e.name));
    const pick = (re) => entries.find((e) => re.test(e.name));
    const main = pick(/\.glb$/i) || pick(/\.gltf$/i) || pick(/\.vrm$/i) || pick(/\.fbx$/i) || pick(/\.obj$/i) || pick(/\.blend$/i);
    if (!main) throw new Error('No 3D model (.blend, .glb, .gltf, .fbx, .obj) inside that zip');
    const ext = main.name.split('.').pop().toLowerCase();
    if (ext !== 'gltf') return { ext, name: main.name.split('/').pop(), blob: new Blob([await main.async('uint8array')]) };
    const dir = main.name.includes('/') ? main.name.slice(0, main.name.lastIndexOf('/') + 1) : '';
    const map = new Map();
    for (const e of entries) if (e !== main) map.set(e.name.startsWith(dir) ? e.name.slice(dir.length) : e.name, await e.async('uint8array'));
    const glb = packGLB(JSON.parse(await main.async('string')), map);
    return { ext: 'glb', name: main.name.split('/').pop().replace(/\.gltf$/i, '.glb'), blob: new Blob([glb]) };
  }
  const gltf = by(/\.gltf$/i);
  if (gltf) {
    const map = new Map();
    for (const f of files) if (f !== gltf) map.set(f.name, new Uint8Array(await f.arrayBuffer()));
    const glb = packGLB(JSON.parse(await gltf.text()), map);
    return { ext: 'glb', name: gltf.name.replace(/\.gltf$/i, '.glb'), blob: new Blob([glb]) };
  }
  const f = by(/\.(glb|vrm|fbx|obj)$/i);
  return f ? { ext: f.name.split('.').pop().toLowerCase(), name: f.name, blob: f } : null;
}

// ───────── Poly Haven catalogue ─────────
let catalog = { models: null, textures: null };
export async function listOnline(kind) {
  if (catalog[kind]) return catalog[kind];
  const d = await getJSON(`${API}/assets?t=${kind}`);
  const list = Object.entries(d).map(([id, a]) => ({ id, name: a.name || id, cats: a.categories || [], tags: a.tags || [], n: a.download_count || 0 }));
  list.sort((a, b) => b.n - a.n);
  return (catalog[kind] = list);
}
export const thumbUrl = THUMB;

// download a model (glTF at the chosen texture resolution) → packed GLB stored on the device
export async function downloadModel(id, name, res = '1k', onProgress) {
  const files = await getJSON(`${API}/files/${id}`);
  const g = files.gltf && (files.gltf[res] || files.gltf['1k'] || Object.values(files.gltf)[0]);
  const entry = g && g.gltf;
  if (!entry) throw new Error('No glTF version of this model');
  const incl = Object.entries(entry.include || {});
  const total = (entry.size || 0) + incl.reduce((a, [, v]) => a + (v.size || 0), 0);
  let done = 0; const tick = (n) => { done += n; onProgress && onProgress(done, total); };
  const json = JSON.parse(new TextDecoder().decode(await getBytes(entry.url))); tick(entry.size || 0);
  const map = new Map();
  await Promise.all(incl.map(async ([path, v]) => { map.set(path, await getBytes(v.url)); tick(v.size || 0); }));
  const glb = packGLB(json, map);
  const thumb = await fetchThumb(id);
  const rec = { id: 'ph:model:' + id, kind: 'model', src: 'Poly Haven', name, ext: 'glb', bytes: glb.buffer, thumb, added: Date.now(), size: glb.length };
  await store.putAsset(rec);
  return rec;
}
// a PBR material: colour, normal (OpenGL) and roughness maps
export async function downloadMaterial(id, name, res = '1k', onProgress) {
  const files = await getJSON(`${API}/files/${id}`);
  const pick = (keys) => { for (const k of keys) { const f = files[k]; if (!f) continue; const r = f[res] || f['1k'] || Object.values(f)[0]; const j = r && (r.jpg || r.png); if (j) return j.url; } return null; };
  const urls = { map: pick(['Diffuse', 'diffuse', 'Color']), normal: pick(['nor_gl', 'Normal', 'nor']), rough: pick(['Rough', 'rough', 'Roughness']), ao: pick(['AO', 'ao']) };
  if (!urls.map) throw new Error('This material has no colour map');
  const maps = {}; let n = 0; const keys = Object.keys(urls).filter((k) => urls[k]);
  for (const k of keys) { maps[k] = (await getBytes(urls[k])).buffer; onProgress && onProgress(++n, keys.length); }
  const rec = { id: 'ph:tex:' + id, kind: 'material', src: 'Poly Haven', name, maps, thumb: await fetchThumb(id), added: Date.now() };
  await store.putAsset(rec);
  return rec;
}
async function fetchThumb(id) { try { return (await getBytes(THUMB(id, 160))).buffer; } catch { return null; } }
export const localAssets = async (kind) => (await store.listAssets()).filter((a) => !kind || a.kind === kind).sort((a, b) => b.added - a.added);
export const getAsset = (id) => store.getAsset(id);
export const removeAsset = (id) => store.deleteAsset(id);
export const assetThumb = (a) => (a && a.thumb ? URL.createObjectURL(new Blob([a.thumb], { type: 'image/png' })) : '');

// ───────── browser UI ─────────
// onModel(rec) adds a downloaded model to the scene; onMaterial(rec) applies a material (null if no object is selected)
export function openAssetBrowser({ onModel, onMaterial }) {
  let tab = store.prefs.get('assetTab', 'models'), q = '', cat = '', res = store.prefs.get('assetRes', '1k');
  const grid = h('div', { class: 'asset-grid' }), cats = h('div', { class: 'asset-cats' }), status = h('p', { class: 'hint asset-status' });
  const search = h('input', { class: 'text-in', type: 'search', placeholder: 'Search (e.g. chair, rock, wood, brick)…' });
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
  const tabs = h('div', { class: 'seg' });
  const setTab = (t) => { tab = t; cat = ''; store.prefs.set('assetTab', t); for (const b of tabs.children) b.classList.toggle('on', b.dataset.t === t); load(); };
  for (const [t, l] of [['models', 'Models'], ['textures', 'Materials'], ['local', 'On this iPad']]) { const b = h('button', { 'data-t': t, class: tab === t ? 'on' : '', onclick: () => setTab(t) }, l); tabs.append(b); }
  const resSeg = h('div', { class: 'seg asset-res' });
  for (const r of ['1k', '2k', '4k']) resSeg.append(h('button', { class: r === res ? 'on' : '', onclick: (e) => { res = r; store.prefs.set('assetRes', r); for (const b of resSeg.children) b.classList.toggle('on', b === e.currentTarget); } }, r));
  let items = [], localIds = new Set();
  const card = (a, local) => {
    const img = h('img', { loading: 'lazy', alt: '', src: local ? assetThumb(a) : THUMB(a.id, 200) });
    const b = h('button', { class: 'asset-card' + (localIds.has('ph:' + (tab === 'textures' ? 'tex' : 'model') + ':' + a.id) ? ' have' : '') }, img, h('span', {}, a.name));
    b.onclick = () => (local ? useLocal(a) : get(a, b));
    if (local) b.oncontextmenu = (e) => { e.preventDefault(); delLocal(a); };
    if (local) { let t; b.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; delLocal(a); }, 650); }); b.addEventListener('pointerup', () => clearTimeout(t)); b.addEventListener('pointerleave', () => clearTimeout(t)); }
    return b;
  };
  const delLocal = (a) => dialog({ title: a.name, body: h('p', {}, 'Remove this download from the iPad? (Scenes that already use it keep their copy.)'), actions: [{ label: 'Cancel' }, { label: 'Remove', primary: true, onClick: async () => { await removeAsset(a.id); load(); } }] });
  const useLocal = (a) => (a.kind === 'model' ? (onModel(a), close()) : applyMat(a));
  const applyMat = (a) => { if (onMaterial(a) === false) toast('Select an object in the scene first, then pick a material', 3500); else close(); };
  const get = async (a, btn) => {
    const key = 'ph:' + (tab === 'textures' ? 'tex' : 'model') + ':' + a.id;
    const have = await getAsset(key);
    if (have) return useLocal(have);
    btn.classList.add('busy'); status.textContent = `Downloading ${a.name}…`;
    try {
      const rec = tab === 'textures'
        ? await downloadMaterial(a.id, a.name, res, (n, t) => { status.textContent = `Downloading ${a.name} — map ${n} of ${t}`; })
        : await downloadModel(a.id, a.name, res, (n, t) => { status.textContent = `Downloading ${a.name}${t ? ' — ' + Math.min(100, Math.round(n / t * 100)) + '%' : '…'}`; });
      status.textContent = ''; localIds.add(key);
      useLocal(rec);
    } catch (e) { console.error(e); status.textContent = 'Couldn’t download: ' + e.message; }
    finally { btn.classList.remove('busy'); }
  };
  const draw = () => {
    grid.innerHTML = ''; cats.innerHTML = '';
    if (tab !== 'local') {
      const counts = new Map(); for (const a of items) for (const c of a.cats) counts.set(c, (counts.get(c) || 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([c]) => c);
      cats.append(h('button', { class: !cat ? 'on' : '', onclick: () => { cat = ''; draw(); } }, 'All'), ...top.map((c) => h('button', { class: cat === c ? 'on' : '', onclick: () => { cat = c; draw(); } }, c)));
    }
    const list = items.filter((a) => (!cat || (a.cats || []).includes(cat)) && (!q || a.name.toLowerCase().includes(q) || (a.tags || []).some((t) => t.includes(q)) || (a.cats || []).some((t) => t.includes(q))));
    for (const a of list.slice(0, 240)) grid.append(card(a, tab === 'local'));
    if (!list.length) grid.append(h('p', { class: 'hint' }, tab === 'local' ? 'Nothing downloaded yet. Models and materials you download are kept here for offline use (hold one to remove it).' : 'No matches.'));
  };
  const load = async () => {
    grid.innerHTML = ''; status.textContent = tab === 'local' ? '' : 'Loading the catalogue…';
    localIds = new Set((await localAssets()).map((a) => a.id));
    try {
      items = tab === 'local' ? await localAssets() : await listOnline(tab);
      status.textContent = tab === 'local' ? '' : `${items.length} free ${tab === 'textures' ? 'materials' : 'models'} from Poly Haven (CC0, made in Blender) · tap to download & use`;
    } catch (e) { items = []; status.textContent = e.message; }
    draw();
  };
  const body = h('div', { class: 'asset-browser' }, tabs, h('div', { class: 'asset-top' }, search, h('span', { class: 'hint' }, 'Texture size'), resSeg), cats, status, grid,
    h('p', { class: 'hint' }, 'Got a model from Blender? Export it as glTF 2.0 (.glb) and use ＋ Model… — .gltf with its files, or a .zip of the folder, work too.'));
  const dlg = dialog({ title: '3D Assets', body, actions: [{ label: 'Close', primary: true }] });
  const close = () => { dlg && dlg.close ? dlg.close() : document.querySelector('.modal-foot button')?.click(); };
  load();
}
