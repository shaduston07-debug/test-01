/*
 * Cloud backup and sync through a private GitHub repository, so the iPad
 * app and the phone app share the same notes.
 *
 * Layout of the repository:
 *   notes/<id>.json         one note (or { id, deleted: true, updated } once deleted)
 *   media/<id>.<ext>        a picture or recording referenced as "idb:<id>"
 *   meta/groups.json        groups
 *   meta/dictionary.json    personal dictionary
 *
 * Each sync reads the repository's file list, downloads what changed,
 * merges (newest edit wins; when both sides changed, the other version is
 * kept as a "conflicted copy"), then uploads everything new in one commit.
 */
const Sync = (() => {
  const CONFIG_KEY = 'inkwell.sync';          // { token, owner, repo, branch }
  const STATE_KEY = 'inkwell.sync.state';     // { paths: {path: sha}, synced: {id: updated}, last, metaSha }
  const DELETED_KEY = 'inkwell.sync.deleted'; // { id: deletedAt } not yet uploaded
  const API = 'https://api.github.com';

  let app = null;          // hooks from app.js
  let running = null;      // the sync in progress
  let again = false;       // another sync was asked for while one ran
  let timer = null;
  let status = { state: 'off', message: '' };
  const listeners = new Set();

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full: next sync redoes the work */ }
  };

  const config = () => read(CONFIG_KEY, null);
  const failure = (code, message) => Object.assign(new Error(message), { code });

  function setStatus(state, message = '') {
    status = { state, message, last: read(STATE_KEY, {}).last || 0 };
    listeners.forEach(fn => fn(status));
  }

  /* ---------- GitHub API ---------- */

  async function gh(path, { method = 'GET', body, token } = {}) {
    const cfg = config();
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + (token || cfg.token),
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw failure('offline', 'No connection');
    }
    if (res.status === 401) throw failure('bad_token', 'GitHub refused the access key');
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw failure('http_' + res.status, detail.message || 'GitHub returned ' + res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  const repoPath = cfg => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

  const utf8ToBase64 = text => {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const base64ToBytes = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0));

  async function readBlob(cfg, sha) {
    const blob = await gh(`${repoPath(cfg)}/git/blobs/${sha}`);
    return base64ToBytes(blob.content);
  }
  const readJson = async (cfg, sha) => JSON.parse(new TextDecoder().decode(await readBlob(cfg, sha)));

  async function createBlob(cfg, content, encoding) {
    return (await gh(`${repoPath(cfg)}/git/blobs`, { method: 'POST', body: { content, encoding } })).sha;
  }

  // Git's id for a file ("blob <size>\0<bytes>", SHA-1), so unchanged files aren't uploaded again.
  async function gitSha(bytes) {
    if (!(window.crypto && crypto.subtle)) return null;
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(header.length + bytes.length);
    all.set(header);
    all.set(bytes, header.length);
    const hash = await crypto.subtle.digest('SHA-1', all);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Upload text unless the repository already has exactly this file.
  async function textBlob(cfg, text, existingSha) {
    const local = await gitSha(new TextEncoder().encode(text));
    if (local && local === existingSha) return local;
    return createBlob(cfg, text, 'utf-8');
  }

  /* ---------- Connecting ---------- */

  // Checks the key and the repository, and prepares an empty repository.
  async function connect(token, repoName) {
    const user = await gh('/user', { token });
    const owner = user.login;
    let repo;
    try {
      repo = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, { token });
    } catch (err) {
      if (err.code === 'http_404') throw failure('no_repo', `No repository called “${repoName}” that this key can see`);
      throw err;
    }
    if (!repo.private) throw failure('public_repo', `“${repoName}” is public. Use a private repository so your notes stay private.`);
    const cfg = { token, owner, repo: repo.name, branch: repo.default_branch || 'main' };
    write(CONFIG_KEY, cfg);
    write(STATE_KEY, { paths: {}, synced: {}, last: 0 });
    // A brand-new repository has no commits yet; give it one so it can be synced.
    try {
      await gh(`${repoPath(cfg)}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    } catch (err) {
      if (!/^http_(404|409)$/.test(err.code)) throw err;
      await gh(`${repoPath(cfg)}/contents/README.md`, {
        method: 'PUT',
        body: { message: 'Start Inkwell notes backup', content: utf8ToBase64('# Inkwell notes\n\nBackup of the Inkwell notes app. Edit notes in the app, not here.\n') },
      });
    }
    setStatus('idle');
    return cfg;
  }

  function disconnect() {
    try {
      localStorage.removeItem(CONFIG_KEY);
      localStorage.removeItem(STATE_KEY);
    } catch { /* nothing stored */ }
    setStatus('off');
  }

  /* ---------- Syncing ---------- */

  function noteDeleted(id) {
    if (!config()) return;
    const deleted = read(DELETED_KEY, {});
    deleted[id] = Date.now();
    write(DELETED_KEY, deleted);
    schedule();
  }

  // Sync a little after the last change (typing makes many changes).
  function schedule(delay = 15000) {
    if (!config()) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(), delay);
  }

  function syncNow() {
    if (!config()) return Promise.resolve();
    clearTimeout(timer);   // this sync covers any that was waiting
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      setStatus('syncing');
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            await syncOnce();
            break;
          } catch (err) {
            // Someone else (the other device) synced at the same moment: start over.
            if (err.code === 'http_422' && attempt < 2) continue;
            throw err;
          }
        }
        setStatus('ok');
      } catch (err) {
        setStatus('error', {
          offline: 'Offline. Changes will sync when you’re back online.',
          bad_token: 'GitHub refused the access key. It may have expired: connect again with a new one.',
          http_403: 'The access key can’t write to the repository. Give it “Contents: Read and write”.',
          http_404: 'The repository is gone or the key can no longer see it.',
        }[err.code] || 'Sync failed: ' + err.message);
      } finally {
        running = null;
        if (again) {
          again = false;
          schedule(1000);
        }
      }
    })();
    return running;
  }

  const extOf = type => ({
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  }[(type || '').split(';')[0]] || 'bin');
  const typeOf = ext => ({
    jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg',
  }[ext] || 'application/octet-stream');

  const mediaRefs = html => [...html.matchAll(/data-media="idb:([^"]+)"/g)].map(m => m[1]);

  async function syncOnce() {
    const cfg = config();
    const base = repoPath(cfg);
    const state = read(STATE_KEY, { paths: {}, synced: {} });
    state.paths = state.paths || {};
    state.synced = state.synced || {};

    // 1. What the repository holds now.
    const ref = await gh(`${base}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    const headSha = ref.object.sha;
    const head = await gh(`${base}/git/commits/${headSha}`);
    const tree = await gh(`${base}/git/trees/${head.tree.sha}?recursive=1`);
    const remote = new Map(tree.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
    const remoteMedia = new Map();   // id → path
    for (const path of remote.keys()) {
      const m = path.match(/^media\/([^/.]+)\.(\w+)$/);
      if (m) remoteMedia.set(m[1], path);
    }

    // 2. Bring in notes changed elsewhere.
    let notes = app.getNotes();
    const deleted = read(DELETED_KEY, {});
    const changed = new Set();
    const remoteHasNotes = [...remote.keys()].some(p => p.startsWith('notes/'));
    if (remoteHasNotes) notes = notes.filter(n => !app.isPristine(n));   // the other device has its own welcome note

    for (const [path, sha] of remote) {
      const m = path.match(/^notes\/([^/]+)\.json$/);
      if (!m || state.paths[path] === sha) continue;
      const theirs = await readJson(cfg, sha);
      const id = theirs.id || m[1];
      const i = notes.findIndex(n => n.id === id);
      const mine = notes[i];
      const lastSynced = state.synced[id] || 0;
      if (theirs.deleted) {
        if (mine && !(mine.updated > theirs.updated)) {
          notes.splice(i, 1);
          changed.add(id);
        }
      } else if (!mine) {
        if (!(deleted[id] >= theirs.updated)) {
          notes.push(theirs);
          changed.add(id);
        }
      } else if (theirs.updated > mine.updated) {
        if (mine.updated > lastSynced && mine.text !== theirs.text) notes.push(app.conflictCopy(mine));
        notes[i] = theirs;
        changed.add(id);
      } else if (mine.updated > theirs.updated && theirs.updated > lastSynced && mine.text !== theirs.text) {
        notes.push(app.conflictCopy(theirs));
        changed.add(id);
      }
      state.paths[path] = sha;
      // Remember the version we now share; a newer local edit (still to send) stays newer than it.
      if (theirs.deleted) delete state.synced[id];
      else state.synced[id] = theirs.updated;
    }

    // Groups and the personal dictionary: keep everything from both sides.
    let groups = app.getGroups();
    let words = app.getWords();
    for (const [path, key] of [['meta/groups.json', 'groups'], ['meta/dictionary.json', 'words']]) {
      const sha = remote.get(path);
      if (!sha || state.paths[path] === sha) continue;
      const data = await readJson(cfg, sha);
      if (key === 'groups') {
        const ids = new Set(groups.map(g => g.id));
        groups = [...groups, ...(data.groups || []).filter(g => !ids.has(g.id))];
      } else {
        words = [...new Set([...words, ...(data.words || [])])];
      }
      state.paths[path] = sha;
    }

    // 3. Send what's new here, in one commit.
    const entries = [];
    const uploaded = [];
    for (const note of notes) {
      if (app.isPristine(note)) continue;
      const path = `notes/${note.id}.json`;
      // Unchanged since it was last sent (or received): nothing to do.
      if (remote.has(path) && state.synced[note.id] === note.updated && state.paths[path] === remote.get(path)) continue;
      const body = JSON.stringify({ id: note.id, html: note.html, text: note.text, created: note.created, updated: note.updated, group: note.group || '' });
      const sha = await textBlob(cfg, body, remote.get(path));
      if (sha !== remote.get(path)) entries.push({ path, mode: '100644', type: 'blob', sha });
      uploaded.push({ path, sha, id: note.id, updated: note.updated });
    }
    for (const [id, at] of Object.entries(deleted)) {
      const path = `notes/${id}.json`;
      if (notes.some(n => n.id === id)) continue;
      const sha = await createBlob(cfg, JSON.stringify({ id, deleted: true, updated: at }), 'utf-8');
      entries.push({ path, mode: '100644', type: 'blob', sha });
      uploaded.push({ path, sha, id, updated: at, tombstone: true });
    }
    // Pictures and recordings this device has that the repository doesn't.
    for (const note of notes) {
      for (const id of mediaRefs(note.html)) {
        if (remoteMedia.has(id)) continue;
        const file = await Media.blob('idb:' + id).catch(() => null);
        if (!file) continue;
        const path = `media/${id}.${extOf(file.type)}`;
        const sha = await createBlob(cfg, await Media.toDataUrl(file).then(u => u.slice(u.indexOf(',') + 1)), 'base64');
        entries.push({ path, mode: '100644', type: 'blob', sha });
        remoteMedia.set(id, path);
        uploaded.push({ path, sha });
      }
    }
    for (const [path, value] of [['meta/groups.json', { groups }], ['meta/dictionary.json', { words }]]) {
      const json = JSON.stringify(value);
      const sha = await textBlob(cfg, json, remote.get(path));
      if (sha !== remote.get(path)) {
        entries.push({ path, mode: '100644', type: 'blob', sha });
        uploaded.push({ path, sha });
      }
    }

    if (entries.length) {
      const newTree = await gh(`${base}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree: entries } });
      const commit = await gh(`${base}/git/commits`, {
        method: 'POST',
        body: { message: `Sync from ${app.deviceName()} (${entries.length} file${entries.length === 1 ? '' : 's'})`, tree: newTree.sha, parents: [headSha] },
      });
      await gh(`${base}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
    }
    for (const u of uploaded) {
      state.paths[u.path] = u.sha;
      if (u.id && !u.tombstone) state.synced[u.id] = u.updated;
      if (u.tombstone) delete deleted[u.id];
    }
    write(DELETED_KEY, deleted);

    // 4. Fetch pictures and recordings this device is missing.
    for (const note of notes) {
      for (const id of mediaRefs(note.html)) {
        const path = remoteMedia.get(id);
        if (!path || await Media.has('idb:' + id)) continue;
        const sha = remote.get(path) || state.paths[path];
        if (!sha) continue;
        const bytes = await readBlob(cfg, sha);
        await Media.restore('idb:' + id, new Blob([bytes], { type: typeOf(path.split('.').pop()) }));
        changed.add(note.id);
      }
    }

    state.last = Date.now();
    write(STATE_KEY, state);
    app.apply({ notes, groups, words, changed });
  }

  function init(hooks) {
    app = hooks;
    if (!config()) return setStatus('off');
    setStatus('idle');
    syncNow();
    // Pick up the other device's changes when coming back to the app, and now and then.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow();
      else if (timer) {
        clearTimeout(timer);
        syncNow();
      }
    });
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 120000);
  }

  return {
    init, connect, disconnect, syncNow, schedule, noteDeleted,
    config, status: () => status, onStatus: fn => listeners.add(fn),
  };
})();
