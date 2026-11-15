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

// ───────── Sketchfab (huge library of downloadable models, many rigged characters) ─────────
// Search is public; downloading needs the user's own free Sketchfab account token (pasted once,
// kept only on this device). Each model keeps its author and licence for crediting.
const SF = 'https://api.sketchfab.com/v3';
export const sfToken = () => store.prefs.get('sketchfab.token', '');
export const setSfToken = (t) => store.prefs.set('sketchfab.token', String(t || '').trim());
export const SF_CATS = [['', 'All'], ['characters-creatures', 'Characters'], ['people', 'People'], ['animals-pets', 'Animals'], ['weapons-military', 'Weapons'], ['furniture-home', 'Furniture'], ['architecture', 'Buildings'], ['places-travel', 'Places'], ['cars-vehicles', 'Vehicles'], ['nature-plants', 'Nature'], ['fashion-style', 'Clothes'], ['food-drink', 'Food'], ['electronics-gadgets', 'Gadgets']];
const native = () => { const c = window.Capacitor; return c && c.isNativePlatform && c.isNativePlatform() ? c : null; };
// JSON / bytes: the native HTTP plugin in the iPad app (no web-page limits), fetch elsewhere
async function netJSON(url, headers = {}) {
  const c = native();
  if (c) {
    const http = c.Plugins && c.Plugins.CapacitorHttp;
    const r = await (http ? http.get({ url, headers }) : c.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', headers }));
    const data = typeof r.data === 'string' ? (() => { try { return JSON.parse(r.data); } catch { return r.data; } })() : r.data;
    return { status: r.status || 200, data };
  }
  const r = await fetch(url, { headers });
  let data = null; try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data };
}
async function netBytes(url, onProgress) {
  const c = native();
  if (c) {
    const http = c.Plugins && c.Plugins.CapacitorHttp;
    const r = await (http ? http.get({ url, responseType: 'arraybuffer' }) : c.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', responseType: 'arraybuffer' }));
    if (r.status && r.status >= 400) throw new Error('download failed (' + r.status + ')');
    if (r.data instanceof ArrayBuffer) return new Uint8Array(r.data);
    const bin = atob(String(r.data)), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return getBytes(url, onProgress);
}
const sfThumb = (r, want = 360) => {
  const imgs = ((r.thumbnails && r.thumbnails.images) || []).slice().sort((a, b) => a.width - b.width);
  return (imgs.find((i) => i.width >= want) || imgs[imgs.length - 1] || {}).url || '';
};
// one page of search results; opts: { q, cat, rigged, animated, light, cursor }
export async function sfSearch(o = {}) {
  const p = new URLSearchParams({ type: 'models', downloadable: 'true', count: '24' });
  if (!o.q) p.set('sort_by', '-likeCount'); // most liked first when browsing
  if (o.q) p.set('q', o.q);
  if (o.cat) p.set('categories', o.cat);
  if (o.rigged) p.append('tags', 'rigged');
  if (o.animated) p.set('animated', 'true');
  if (o.light) p.set('max_face_count', '60000');
  if (o.cursor) p.set('cursor', o.cursor);
  let r;
  try { r = await netJSON(`${SF}/search?${p}`); }
  catch (e) { throw new Error(navigator.onLine === false ? 'You’re offline — connect to browse Sketchfab (downloaded models still work).' : 'Couldn’t reach Sketchfab: ' + e.message); }
  if (r.status >= 400 || !r.data || !r.data.results) throw new Error('Sketchfab answered ' + r.status);
  const items = r.data.results.filter((m) => m.isDownloadable !== false && !m.isAgeRestricted).map((m) => ({
    id: m.uid, sf: true, name: m.name || 'Untitled', thumb: sfThumb(m), author: (m.user && (m.user.displayName || m.user.username)) || '',
    license: (m.license && m.license.label) || '', faces: m.faceCount || 0, animated: (m.animationCount || 0) > 0, page: m.viewerUrl || `https://sketchfab.com/3d-models/${m.uid}`,
  }));
  return { items, next: (r.data.cursors && r.data.cursors.next) || null };
}
// download (glb when offered, otherwise the glTF zip packed into one .glb) → kept on the device
export async function sfDownload(item, onStatus = () => {}) {
  const tok = sfToken();
  if (!tok) { const e = new Error('Add your Sketchfab token first'); e.code = 'auth'; throw e; }
  onStatus('Asking Sketchfab for the file…');
  const r = await netJSON(`${SF}/models/${item.id}/download`, { Authorization: 'Token ' + tok });
  if (r.status === 401 || r.status === 403) { const e = new Error('Sketchfab didn’t accept the token (check it in Settings › Password & API).'); e.code = 'auth'; throw e; }
  if (r.status === 429) throw new Error('Sketchfab says: too many downloads for now. Try again in a few minutes.');
  if (r.status >= 400 || !r.data) throw new Error('Sketchfab answered ' + r.status + (r.data && r.data.detail ? ': ' + r.data.detail : ''));
  const glbInfo = r.data.glb, gltfInfo = r.data.gltf;
  const info = glbInfo && glbInfo.url ? glbInfo : gltfInfo;
  if (!info || !info.url) throw new Error('No glTF download for this model');
  const mb = info.size ? (info.size / 1048576).toFixed(1) + ' MB' : '';
  onStatus(`Downloading ${item.name}${mb ? ' (' + mb + ')' : ''}…`);
  const bytes = await netBytes(info.url, (n, t) => onStatus(`Downloading ${item.name} — ${t ? Math.round((n / t) * 100) + '%' : Math.round(n / 1048576) + ' MB'}`));
  let glb;
  if (info === glbInfo || (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46)) glb = bytes;
  else {
    onStatus('Unpacking…');
    const m = await modelFromFiles([new File([bytes], 'scene.zip', { type: 'application/zip' })]);
    if (!m) throw new Error('No model inside the download');
    glb = new Uint8Array(await m.blob.arrayBuffer());
  }
  let thumb = null; try { if (item.thumb) thumb = (await netBytes(item.thumb)).buffer; } catch { /* no thumbnail */ }
  const rec = { id: 'sf:model:' + item.id, kind: 'model', src: 'Sketchfab', name: item.name, author: item.author, license: item.license, page: item.page,
    ext: 'glb', bytes: glb.buffer.byteLength === glb.length ? glb.buffer : glb.slice().buffer, thumb, added: Date.now(), size: glb.length };
  await store.putAsset(rec);
  return rec;
}
// any direct link to a model file (.glb / .gltf zip / .fbx / .obj / .vrm / .zip), e.g. a creator's
// download page link → kept on the device like the other downloads
export async function downloadFromLink(url, onStatus = () => {}) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Paste a full link starting with https://');
  // Google Drive / Dropbox share links → their direct-download form
  const gd = /drive\.google\.com\/file\/d\/([^/]+)/.exec(url); if (gd) url = `https://drive.google.com/uc?export=download&id=${gd[1]}`;
  if (/dropbox\.com/.test(url)) url = url.replace(/[?&]dl=0/, '').replace(/(\?|$)/, (m) => (m ? '?dl=1&' : '?dl=1'));
  onStatus('Downloading…');
  const bytes = await netBytes(url, (n, t) => onStatus(`Downloading — ${t ? Math.round((n / t) * 100) + '%' : Math.round(n / 1048576) + ' MB'}`));
  const head = new TextDecoder().decode(bytes.slice(0, 64));
  if (/<!doctype html|<html/i.test(head)) throw new Error('That link opens a web page, not a file. Use the site’s direct download link (the one that starts the download).');
  let name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'model');
  const magic = bytes[0] === 0x50 && bytes[1] === 0x4b ? 'zip' : head.startsWith('glTF') ? 'glb' : /Kaydara FBX Binary/.test(head) ? 'fbx' : null;
  if (magic && !name.toLowerCase().endsWith('.' + magic) && !(magic === 'glb' && /\.vrm$/i.test(name))) name = name.replace(/\.[^.]*$/, '') + '.' + magic;
  if (!/\.(glb|gltf|vrm|fbx|obj|zip)$/i.test(name)) throw new Error('That file is not a model this app can read (.glb, .gltf in a .zip, .vrm, .fbx, .obj).');
  onStatus('Reading the model…');
  const m = await modelFromFiles([new File([bytes], name)]);
  if (!m) throw new Error('No model inside that file');
  const out = new Uint8Array(await m.blob.arrayBuffer());
  const rec = { id: 'link:' + uid(), kind: 'model', src: 'Link', name: m.name.replace(/\.[^.]+$/, ''), page: url, ext: m.ext, bytes: out.buffer, thumb: null, added: Date.now(), size: out.length };
  await store.putAsset(rec);
  return rec;
}
export function sfTokenDialog(after) {
  const inp = h('input', { class: 'text-in', type: 'password', placeholder: 'Paste your Sketchfab API token', value: sfToken(), autocomplete: 'off' });
  dialog({
    title: 'Sketchfab token',
    body: h('div', {},
      h('p', {}, 'Searching Sketchfab is free and open. To download, Sketchfab needs your own free account:'),
      h('ol', {}, h('li', {}, 'Sign up or log in at sketchfab.com.'), h('li', {}, 'Open Settings › Password & API and copy the API token.'), h('li', {}, 'Paste it below.')),
      h('p', {}, h('a', { href: 'https://sketchfab.com/settings/password', target: '_blank', rel: 'noopener' }, 'Open sketchfab.com › Password & API')),
      inp,
      h('p', { class: 'hint' }, 'The token stays on this device and is only sent to Sketchfab. Models keep their author and licence: most are Creative Commons, so credit the author when you share work that shows the model.')),
    actions: [{ label: 'Cancel' }, sfToken() ? { label: 'Remove token', danger: true, onClick: () => { setSfToken(''); toast('Sketchfab token removed'); after && after(); } } : null,
      { label: 'Save', primary: true, onClick: () => { setSfToken(inp.value); toast(inp.value.trim() ? 'Sketchfab token saved' : 'No token'); after && after(); } }].filter(Boolean),
  });
}

// ───────── browser UI ─────────
// onModel(rec) adds a downloaded model to the scene; onMaterial(rec) applies a material (null if no object is selected)
export function openAssetBrowser({ onModel, onMaterial, query }) {
  let tab = query ? 'sketchfab' : store.prefs.get('assetTab', 'sketchfab'), q = query || '', cat = '', res = store.prefs.get('assetRes', '1k');
  // Sketchfab search state (server-side search, paged)
  const sf = { cat: query ? '' : store.prefs.get('sf.cat', 'characters-creatures'), rigged: store.prefs.get('sf.rigged', false), animated: false, light: store.prefs.get('sf.light', true), next: null, ticket: 0 };
  const grid = h('div', { class: 'asset-grid' }), cats = h('div', { class: 'asset-cats' }), status = h('p', { class: 'hint asset-status' });
  const tokenRow = h('div', { class: 'asset-token' });
  const more = h('button', { class: 'pill', hidden: true, onclick: () => sfLoad(false) }, 'More models');
  const search = h('input', { class: 'text-in', type: 'search', placeholder: 'Search (e.g. anime girl, sword, chair, mannequin pose)…' });
  let sT = 0;
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); if (tab === 'sketchfab') { clearTimeout(sT); sT = setTimeout(() => sfLoad(true), 450); } else draw(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && tab === 'sketchfab') { clearTimeout(sT); sfLoad(true); } });
  const tabs = h('div', { class: 'seg' });
  const setTab = (t) => { tab = t; cat = ''; store.prefs.set('assetTab', t); for (const b of tabs.children) b.classList.toggle('on', b.dataset.t === t); load(); };
  for (const [t, l] of [['sketchfab', 'Sketchfab'], ['models', 'Poly Haven'], ['textures', 'Materials'], ['local', 'On this iPad']]) { const b = h('button', { 'data-t': t, class: tab === t ? 'on' : '', onclick: () => setTab(t) }, l); tabs.append(b); }
  const resSeg = h('div', { class: 'seg asset-res' });
  for (const r of ['1k', '2k', '4k']) resSeg.append(h('button', { class: r === res ? 'on' : '', onclick: (e) => { res = r; store.prefs.set('assetRes', r); for (const b of resSeg.children) b.classList.toggle('on', b === e.currentTarget); } }, r));
  const resBox = h('span', { class: 'asset-resbox' }, h('span', { class: 'hint' }, 'Texture size'), resSeg);
  let items = [], localIds = new Set();
  const keyOf = (a) => (a.sf ? 'sf:model:' + a.id : 'ph:' + (tab === 'textures' ? 'tex' : 'model') + ':' + a.id);
  const card = (a, local) => {
    const img = h('img', { loading: 'lazy', alt: '', referrerpolicy: 'no-referrer', src: local ? assetThumb(a) : a.sf ? a.thumb : THUMB(a.id, 200) });
    const meta = a.sf || (local && a.src === 'Sketchfab') ? h('small', {}, [a.author, shortLic(a.license)].filter(Boolean).join(' · ')) : null;
    const b = h('button', { class: 'asset-card' + (!local && localIds.has(keyOf(a)) ? ' have' : '') + (a.animated ? ' anim' : '') }, img, h('span', {}, a.name), meta);
    b.onclick = () => (local ? useLocal(a) : get(a, b));
    if (local) b.oncontextmenu = (e) => { e.preventDefault(); delLocal(a); };
    if (local) { let t; b.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; delLocal(a); }, 650); }); b.addEventListener('pointerup', () => clearTimeout(t)); b.addEventListener('pointerleave', () => clearTimeout(t)); }
    return b;
  };
  const shortLic = (l) => (l || '').replace('CC Attribution', 'CC BY').replace('-NonCommercial', '-NC').replace('-ShareAlike', '-SA').replace('-NoDerivs', '-ND').replace('Free Standard', 'Standard');
  const delLocal = (a) => dialog({ title: a.name, body: h('div', {}, a.src === 'Sketchfab' ? h('p', { class: 'hint' }, `By ${a.author || 'unknown'} · ${a.license || ''}`) : null, h('p', {}, 'Remove this download from the iPad? (Scenes that already use it keep their copy.)')), actions: [{ label: 'Cancel' }, { label: 'Remove', primary: true, onClick: async () => { await removeAsset(a.id); load(); } }] });
  const useLocal = (a) => (a.kind === 'model' ? (onModel(a), close()) : applyMat(a));
  const applyMat = (a) => { if (onMaterial(a) === false) toast('Select an object in the scene first, then pick a material', 3500); else close(); };
  const get = async (a, btn) => {
    const have = await getAsset(keyOf(a));
    if (have) return useLocal(have);
    if (a.sf && !sfToken()) { sfTokenDialog(() => { drawToken(); if (sfToken()) get(a, btn); }); return; }
    btn.classList.add('busy'); status.textContent = `Downloading ${a.name}…`;
    try {
      const rec = a.sf
        ? await sfDownload(a, (t) => { status.textContent = t; })
        : tab === 'textures'
          ? await downloadMaterial(a.id, a.name, res, (n, t) => { status.textContent = `Downloading ${a.name} — map ${n} of ${t}`; })
          : await downloadModel(a.id, a.name, res, (n, t) => { status.textContent = `Downloading ${a.name}${t ? ' — ' + Math.min(100, Math.round(n / t * 100)) + '%' : '…'}`; });
      status.textContent = ''; localIds.add(keyOf(a));
      if (a.sf && a.license && /Attribution|CC BY/i.test(a.license)) toast(`“${a.name}” by ${a.author} (${shortLic(a.license)}) — credit the author when you share work with it`, 4500);
      useLocal(rec);
    } catch (e) {
      console.error(e);
      if (e.code === 'auth') { status.textContent = e.message; sfTokenDialog(() => drawToken()); }
      else status.textContent = 'Couldn’t download: ' + e.message;
    } finally { btn.classList.remove('busy'); }
  };
  const drawToken = () => {
    tokenRow.innerHTML = '';
    if (tab !== 'sketchfab') return;
    tokenRow.append(sfToken() ? h('span', { class: 'hint' }, '✓ Sketchfab token saved · downloads go to your account') : h('span', { class: 'hint' }, 'Browsing is free · downloading needs your free Sketchfab account token'),
      h('button', { class: 'pill', onclick: () => sfTokenDialog(() => drawToken()) }, sfToken() ? 'Token…' : 'Add token'));
  };
  const toggle = (label, key) => h('button', { class: sf[key] ? 'on' : '', onclick: () => { sf[key] = !sf[key]; store.prefs.set('sf.' + key, sf[key]); sfLoad(true); } }, label);
  const draw = () => {
    grid.innerHTML = ''; cats.innerHTML = '';
    if (tab === 'sketchfab') {
      cats.append(...SF_CATS.map(([v, l]) => h('button', { class: sf.cat === v ? 'on' : '', onclick: () => { sf.cat = v; store.prefs.set('sf.cat', v); sfLoad(true); } }, l)),
        h('span', { class: 'asset-sep' }), toggle('Rigged (poseable)', 'rigged'), toggle('Animated', 'animated'), toggle('Light (< 60k faces)', 'light'));
      for (const a of items) grid.append(card(a, false));
      if (!items.length && !status.textContent) grid.append(h('p', { class: 'hint' }, 'No models found. Try other words or another category.'));
      more.hidden = !sf.next;
      return;
    }
    more.hidden = true;
    if (tab !== 'local') {
      const counts = new Map(); for (const a of items) for (const c of a.cats) counts.set(c, (counts.get(c) || 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([c]) => c);
      cats.append(h('button', { class: !cat ? 'on' : '', onclick: () => { cat = ''; draw(); } }, 'All'), ...top.map((c) => h('button', { class: cat === c ? 'on' : '', onclick: () => { cat = c; draw(); } }, c)));
    }
    const list = items.filter((a) => (!cat || (a.cats || []).includes(cat)) && (!q || a.name.toLowerCase().includes(q) || (a.author || '').toLowerCase().includes(q) || (a.tags || []).some((t) => t.includes(q)) || (a.cats || []).some((t) => t.includes(q))));
    for (const a of list.slice(0, 240)) grid.append(card(a, tab === 'local'));
    if (!list.length) grid.append(h('p', { class: 'hint' }, tab === 'local' ? 'Nothing downloaded yet. Models and materials you download are kept here for offline use (hold one to remove it).' : 'No matches.'));
  };
  async function sfLoad(reset) {
    const my = ++sf.ticket;
    if (reset) { items = []; sf.next = null; grid.innerHTML = ''; }
    status.textContent = 'Searching Sketchfab…'; draw();
    try {
      const r = await sfSearch({ q, cat: sf.cat, rigged: sf.rigged, animated: sf.animated, light: sf.light, cursor: reset ? null : sf.next });
      if (my !== sf.ticket) return;
      items = reset ? r.items : items.concat(r.items); sf.next = r.next;
      status.textContent = items.length ? `${items.length}${sf.next ? '+' : ''} downloadable models · tap one to download and add it` : '';
    } catch (e) { if (my !== sf.ticket) return; status.textContent = e.message; }
    draw();
  }
  const load = async () => {
    grid.innerHTML = ''; resBox.hidden = tab === 'sketchfab' || tab === 'local';
    search.placeholder = tab === 'sketchfab' ? 'Search Sketchfab (e.g. anime girl, sword, mannequin pose)…' : 'Search (e.g. chair, rock, wood, brick)…';
    localIds = new Set((await localAssets()).map((a) => a.id));
    drawToken();
    if (tab === 'sketchfab') { sfLoad(true); return; }
    status.textContent = tab === 'local' ? '' : 'Loading the catalogue…';
    try {
      items = tab === 'local' ? await localAssets() : await listOnline(tab);
      status.textContent = tab === 'local' ? '' : `${items.length} free ${tab === 'textures' ? 'materials' : 'models'} from Poly Haven (CC0, made in Blender) · tap to download & use`;
    } catch (e) { items = []; status.textContent = e.message; }
    draw();
  };
  const linkBtn = h('button', { class: 'pill', onclick: () => {
    const inp = h('input', { class: 'text-in', type: 'url', placeholder: 'https://… (.glb, .vrm, .fbx, .obj or .zip)' });
    dialog({ title: 'Download from a link', body: h('div', {}, h('p', {}, 'Paste a direct download link to a 3D model: a creator’s download link, a Google Drive or Dropbox share link, a GitHub file… It is kept on this iPad for offline use.'), inp),
      actions: [{ label: 'Cancel' }, { label: 'Download', primary: true, onClick: async () => {
        try { const rec = await downloadFromLink(inp.value, (t) => { status.textContent = t; }); status.textContent = ''; useLocal(rec); }
        catch (e) { status.textContent = 'Couldn’t download: ' + e.message; }
      } }] });
  } }, '⤓ From a link…');
  const body = h('div', { class: 'asset-browser' }, tabs, tokenRow, h('div', { class: 'asset-top' }, search, resBox, linkBtn), cats, status, grid, more,
    h('p', { class: 'hint' }, 'Got a model elsewhere (Blender, VRoid, a CSP Assets creator who also shares FBX / OBJ / glTF / VRM)? Use ＋ Model… to import the file; a .zip of a glTF folder works too.'));
  const dlg = dialog({ title: '3D Assets', body, actions: [{ label: 'Close', primary: true }], wide: true });
  const close = () => { dlg && dlg.close ? dlg.close() : document.querySelector('.modal-foot button')?.click(); };
  if (query) search.value = query;
  load();
}
