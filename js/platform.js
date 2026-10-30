// Platform glue: native iPad app (Capacitor), Home Screen web app, or plain browser.
const cap = window.Capacitor;

export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = isNative || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

// Calls a native Capacitor plugin. Works without bundling @capacitor/core because the
// iOS shell injects window.Capacitor with the bridge.
function native(plugin, method, options) {
  const p = cap.Plugins && cap.Plugins[plugin];
  if (p && typeof p[method] === 'function') return p[method](options);
  return cap.nativePromise(plugin, method, options);
}

const toBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = rej;
  r.readAsDataURL(blob);
});

// Native app: save into Documents/Exports (visible in the Files app under
// "On My iPad › Inkwell Studio") and open the share sheet (Save Image, AirDrop, …).
export async function nativeSave(blob, filename) {
  const { uri } = await native('Filesystem', 'writeFile', {
    path: 'Exports/' + filename, data: await toBase64(blob), directory: 'DOCUMENTS', recursive: true,
  });
  try { await native('Share', 'share', { title: filename, files: [uri] }); }
  catch (e) { /* share sheet dismissed — the file is still in Files */ }
  return uri;
}

// Home Screen / Safari: prefer the system share sheet when it can take files.
export async function webShare(blob, filename) {
  if (!isIOS || !navigator.canShare) return false;
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (!navigator.canShare({ files: [file] })) return false;
  try { await navigator.share({ files: [file], title: filename }); return true; }
  catch (e) { return e && e.name === 'AbortError'; }
}

// iOS greys out files whose extension it doesn't recognise (.sut, .brush, .inkwell…)
// when they're listed in `accept`, so only keep the filter for plain image picks there.
export function pickerAccept(accept) {
  if (!isIOS || !accept) return accept;
  return /^(image\/\*|image\/[\w+.-]+)(,\s*image\/[\w+.-]+)*$/.test(accept) ? accept : '';
}
