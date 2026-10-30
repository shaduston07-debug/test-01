/*
 * Images and audio recordings in notes.
 *
 * The files themselves live outside the note's HTML: in the browser's
 * IndexedDB ("idb:<id>"), or, for images on claude.ai, in the page's asset
 * store ("asset:<id>", which also syncs across devices). A note only holds
 * the reference in data-media; the playable/viewable source is attached
 * when the note opens.
 */
const Media = (() => {
  const DB_NAME = 'inkwell-media';
  const STORE = 'files';
  let dbPromise = null;
  const objectUrls = new Map(); // "idb:<id>" → blob: URL for this session

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const newId = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Store a file; resolves { ref, url } where url can be shown right away.
  async function save(blob, kind) {
    if (kind === 'image') {
      const assets = await Cloud.assets();
      if (assets) {
        try {
          const up = await assets.upload(blob);
          return { ref: 'asset:' + up.id, url: up.url };
        } catch { /* fall back to this device */ }
      }
    }
    const id = newId(kind === 'audio' ? 'a' : 'i');
    await run('readwrite', s => s.put(blob, id));
    const url = URL.createObjectURL(blob);
    objectUrls.set('idb:' + id, url);
    return { ref: 'idb:' + id, url };
  }

  // Put a file back under a known reference (restoring a backup).
  async function restore(ref, blob) {
    if (!ref.startsWith('idb:')) return;
    await run('readwrite', s => s.put(blob, ref.slice(4)));
  }

  async function blob(ref, el) {
    if (ref.startsWith('idb:')) return run('readonly', s => s.get(ref.slice(4)));
    // Assets (and anything else) are fetched from the URL kept on the element.
    const target = el && sourceElement(el);
    const src = target && target.getAttribute('src');
    if (!src) return null;
    const res = await fetch(src);
    return res.ok ? res.blob() : null;
  }

  async function url(ref) {
    if (!objectUrls.has(ref)) {
      const file = await blob(ref);
      if (!file) return null;
      objectUrls.set(ref, URL.createObjectURL(file));
    }
    return objectUrls.get(ref);
  }

  const sourceElement = el => (el.matches('img, audio') ? el : el.querySelector('img, audio'));

  // Attach sources to every stored file inside root (an opened note).
  async function hydrate(root) {
    await Promise.all([...root.querySelectorAll('[data-media^="idb:"]')].map(async el => {
      const target = sourceElement(el);
      if (!target) return;
      try {
        const src = await url(el.dataset.media);
        if (src) target.src = src;
        else el.classList.add('missing');
      } catch {
        el.classList.add('missing');
      }
    }));
  }

  // The note's HTML without this session's temporary blob: URLs.
  function serialize(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('[data-media^="idb:"]').forEach(el => {
      const target = sourceElement(el);
      if (target) target.removeAttribute('src');
    });
    return clone.innerHTML;
  }

  const toDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  return { save, restore, blob, url, hydrate, serialize, toDataUrl };
})();
