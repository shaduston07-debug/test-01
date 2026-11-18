// API keys and setup that must survive updates: mirrored into the iOS Keychain (outside the
// app's web storage, which a re-signed / reinstalled app starts without). On a fresh install the
// Keychain copy is put back before anything reads it. In a browser this does nothing.
const KEYS = ['inkwellsecret:github', 'inkwell:sketchfab.token', 'inkwell:autobackup', 'inkwell:settings', 'inkwell:toolBrush', 'inkwell:panelStyle'];
const watched = (k) => KEYS.includes(k) || /^inkwellsecret:/.test(k);
function plugin() {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
  try { return C.Plugins.InkwellKeychain || (C.registerPlugin && C.registerPlugin('InkwellKeychain')); } catch { return null; }
}
let timer = null;
async function save() {
  const P = plugin(); if (!P) return;
  const data = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (watched(k)) data[k] = localStorage.getItem(k); }
  try { await P.set({ key: 'setup', value: JSON.stringify(data) }); } catch (e) { console.warn('keychain save', e); }
}
const later = () => { clearTimeout(timer); timer = setTimeout(save, 400); };
// put the Keychain copy back for anything this install doesn't have yet; returns how many
export async function restore() {
  const P = plugin(); if (!P) return 0;
  let n = 0;
  try {
    const r = await Promise.race([P.get({ key: 'setup' }), new Promise((res) => setTimeout(() => res(null), 1500))]);
    const data = r && r.value ? JSON.parse(r.value) : null;
    if (data) for (const [k, v] of Object.entries(data)) if (localStorage.getItem(k) == null && v != null) { localStorage.setItem(k, v); n++; }
  } catch (e) { console.warn('keychain restore', e); }
  // from now on every change to these is mirrored
  const set = Storage.prototype.setItem, rm = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === localStorage && watched(k)) later(); };
  Storage.prototype.removeItem = function (k) { rm.call(this, k); if (this === localStorage && watched(k)) later(); };
  later();
  return n;
}
