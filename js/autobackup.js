// Automatic backups, so artwork survives app reinstalls, updates gone wrong, and deleted apps.
//
// 1. On this device (iPad app): after you work, a full backup is written to
//    Files › On My iPad › Inkwell Studio › Backups (the last 5 are kept). These live inside the
//    app's folder, so they protect against mistakes and bad updates, but iOS deletes them if the
//    app itself is deleted. In Safari / the Home Screen web app, which can't write files on its
//    own, you get a weekly reminder to save a backup instead.
// 2. Cloud (optional, survives deleting the app or losing the iPad): every canvas that changed is
//    uploaded as its own small backup file to a private GitHub repository you own, using a
//    fine-grained access key limited to that repository (the same set-up as Inkwell Notes).
import * as store from './storage.js';
import * as Backup from './backup.js';
import { isNative } from './platform.js';
import { toast } from './util.js';

const S_KEY = 'autobackup';
const SECRET = 'inkwellsecret:github'; // not "inkwell:" — so the key is never copied into backups
const KEEP = 5;
const MIN_GAP = 10 * 60e3; // at most one local backup every 10 minutes
const state = () => ({ local: true, remind: true, lastLocal: 0, lastChange: 0, cloud: null, lastRemind: 0, ...store.prefs.get(S_KEY, {}) });
const save = (s) => store.prefs.set(S_KEY, s);
export const getState = state;
export function setState(patch) { save({ ...state(), ...patch }); }
export const cloudToken = () => { try { return localStorage.getItem(SECRET) || ''; } catch { return ''; } };
export const setCloudToken = (t) => { try { if (t) localStorage.setItem(SECRET, t); else localStorage.removeItem(SECRET); } catch { /* ignore */ } };

// called after every successful save of a canvas
export function noteChange() { const s = state(); s.lastChange = Date.now(); save(s); }

let running = null;
// Run whatever is due. Quiet unless something was backed up or went wrong.
export function runSoon(app, delay = 4000) {
  clearTimeout(runSoon.t);
  runSoon.t = setTimeout(() => { if (!app.doc && !running) running = run(app).finally(() => { running = null; }); }, delay);
}
async function run(app) {
  const s = state();
  const metas = await store.listDocs().catch(() => []);
  if (!metas.length) return;
  // 1. local, on the iPad
  if (isNative && s.local && (s.lastChange > s.lastLocal || !s.lastLocal) && Date.now() - s.lastLocal > MIN_GAP) {
    try { await localBackup(); toast('Backed up ✓ (Files › Inkwell Studio › Backups)', 1800); } catch (e) { console.warn('auto backup', e); toast('Automatic backup failed: ' + (e.message || e), 4000); }
  }
  // web: a gentle weekly reminder
  if (!isNative && s.remind) {
    const last = Math.max(Number(localStorage.getItem('inkwell:lastManualBackup') || 0), s.lastCloud || 0);
    if (Date.now() - last > 7 * 864e5 && Date.now() - (s.lastRemind || 0) > 864e5) {
      setState({ lastRemind: Date.now() });
      toast('Reminder: save a backup of your artwork (Gallery › Backup), or turn on Cloud backup there.', 6000);
    }
  }
  // 2. cloud
  if (s.cloud && s.cloud.repo && cloudToken()) {
    try { const n = await cloudBackup(metas); if (n) toast(`Cloud backup ✓ (${n} canvas${n === 1 ? '' : 'es'})`, 1800); }
    catch (e) { console.warn('cloud backup', e); toast('Cloud backup failed: ' + (e.message || e), 4000); }
  }
}

// ───────── local (native app) ─────────
const fs = (method, options) => {
  const cap = window.Capacitor, p = cap.Plugins && cap.Plugins.Filesystem;
  return p && p[method] ? p[method](options) : cap.nativePromise('Filesystem', method, options);
};
const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });

export async function localBackup() {
  const { blob, canvases } = await Backup.buildBackup({});
  const d = new Date(), name = `Inkwell auto-backup ${Backup.backupStamp(d)} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.inkwellbackup`;
  // written in slices so a big backup never has to cross the native bridge in one piece
  const CH = 6 * 1024 * 1024;
  for (let o = 0; o < blob.size || o === 0; o += CH) {
    const data = await toB64(blob.slice(o, o + CH));
    await fs(o === 0 ? 'writeFile' : 'appendFile', { path: 'Backups/' + name, data, directory: 'DOCUMENTS', recursive: true });
    if (blob.size === 0) break;
  }
  const s = state(); s.lastLocal = Date.now(); save(s);
  // keep the newest few
  const list = await listLocalBackups();
  for (const f of list.slice(KEEP)) await fs('deleteFile', { path: 'Backups/' + f.name, directory: 'DOCUMENTS' }).catch(() => {});
  return { name, canvases, bytes: blob.size };
}
export async function listLocalBackups() {
  if (!isNative) return [];
  try {
    const r = await fs('readdir', { path: 'Backups', directory: 'DOCUMENTS' });
    return (r.files || []).map((f) => (typeof f === 'string' ? { name: f } : f)).filter((f) => /\.inkwellbackup$/.test(f.name))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || b.name.localeCompare(a.name));
  } catch { return []; }
}
export async function readLocalBackup(name) {
  const r = await fs('readFile', { path: 'Backups/' + name, directory: 'DOCUMENTS' });
  return await (await fetch('data:application/zip;base64,' + r.data)).blob();
}

// ───────── cloud (private GitHub repository) ─────────
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + cloudToken(), Accept: opts.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (opts.allow && opts.allow.includes(r.status)) return { status: r.status };
  if (!r.ok) {
    let msg = r.status + ''; try { msg = (await r.json()).message || msg; } catch { /* ignore */ }
    if (r.status === 401) msg = 'the access key was refused (expired or mistyped)';
    if (r.status === 404) msg = 'repository not found (check the name, and that the key can read and write it)';
    throw new Error(msg);
  }
  return opts.raw ? r.blob() : r.json();
}
// "owner/name", or just "name" (then your own account)
async function repoPath(repo) {
  if (repo.includes('/')) return repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const me = await gh('/user');
  return me.login + '/' + repo;
}
export async function testCloud(repo) {
  const full = await repoPath(repo);
  const info = await gh('/repos/' + full);
  if (!info.private) throw new Error('this repository is public — make it private so only you can see your artwork');
  if (info.permissions && !info.permissions.push) throw new Error('the access key can read but not write this repository (give it Contents: Read and write)');
  return { full, branch: info.default_branch || 'main' };
}
const b64 = toB64;

async function headCommit(full, branch) {
  const r = await gh(`/repos/${full}/git/ref/heads/${branch}`, { allow: [404, 409] });
  if (r.status) return null; // empty repository
  return r.object.sha;
}
// upload every canvas that changed since its last upload; returns how many were uploaded
export async function cloudBackup(metas, { force = false, onProgress } = {}) {
  const s = state(), c = s.cloud; if (!c || !c.repo) return 0;
  const { full, branch } = c.full ? c : await testCloud(c.repo);
  const done = c.done || {};
  const todo = metas.filter((m) => force || !(done[m.id] >= m.updated));
  if (!todo.length) return 0;
  let parent = await headCommit(full, branch);
  if (!parent) { // an empty repository needs a first commit before the Git Data API works
    await gh(`/repos/${full}/contents/README.md`, { method: 'PUT', body: JSON.stringify({ message: 'Inkwell Studio backups', content: btoa(unescape(encodeURIComponent('Automatic backups from Inkwell Studio. Each file in canvases/ is one canvas; restore it with Gallery › Backup › Restore from cloud, or Import.\n'))), branch }) });
    parent = await headCommit(full, branch);
  }
  const baseTree = (await gh(`/repos/${full}/git/commits/${parent}`)).tree.sha;
  const tree = [];
  let i = 0;
  for (const m of todo) {
    i++; onProgress && onProgress(`Uploading ${i} / ${todo.length}: ${m.name}`);
    const { blob } = await Backup.buildBackup({ onlyIds: [m.id] });
    if (blob.size > 95e6) { console.warn('canvas too big for GitHub', m.name); continue; }
    const sha = (await gh(`/repos/${full}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: await b64(blob), encoding: 'base64' }) })).sha;
    tree.push({ path: `canvases/${m.id}.inkwellbackup`, mode: '100644', type: 'blob', sha });
  }
  // a readable list of what is in the backup
  const all = { ...(c.names || {}) }; for (const m of metas) all[m.id] = m.name;
  const listing = JSON.stringify(Object.entries(all).map(([id, name]) => ({ id, name, file: `canvases/${id}.inkwellbackup` })), null, 1);
  tree.push({ path: 'canvases.json', mode: '100644', type: 'blob', content: listing });
  const t = await gh(`/repos/${full}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
  const commit = await gh(`/repos/${full}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Backup ${todo.length} canvas${todo.length === 1 ? '' : 'es'}`, tree: t.sha, parents: [parent] }) });
  await gh(`/repos/${full}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  const s2 = state(); s2.cloud = { ...s2.cloud, full, branch, names: all, done: { ...(s2.cloud.done || {}), ...Object.fromEntries(todo.map((m) => [m.id, m.updated])) } }; s2.lastCloud = Date.now(); save(s2);
  return tree.length - 1;
}
// every canvas file in the cloud backup, newest first
export async function listCloud() {
  const s = state(), c = s.cloud; if (!c || !c.repo) throw new Error('Cloud backup is not set up');
  const { full, branch } = c.full ? c : await testCloud(c.repo);
  const r = await gh(`/repos/${full}/git/trees/${branch}?recursive=1`, { allow: [404, 409] });
  if (r.status) return [];
  return r.tree.filter((e) => /^canvases\/.*\.inkwellbackup$/.test(e.path)).map((e) => ({ ...e, full, name: (c.names || {})[e.path.slice(9, -14)] || e.path }));
}
export async function restoreCloud({ onProgress } = {}) {
  const files = await listCloud();
  let n = 0;
  for (const f of files) {
    onProgress && onProgress(`Restoring ${n + 1} / ${files.length}: ${f.name}`);
    const blob = await gh(`/repos/${f.full}/git/blobs/${f.sha}`, { raw: true });
    const r = await Backup.importBackup(blob);
    n += r.canvases;
  }
  return n;
}
