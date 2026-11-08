/*
 * Cloud backup and sync through a private GitHub repository, so the iPad
 * app, the phone app and the claude.ai page share the same notes.
 *
 * Layout of the repository:
 *   notes/<id>.json           one note (or { id, deleted: true, updated } once deleted)
 *   media/<id>.<ext>          a picture or recording referenced as "idb:<id>"
 *   media/<id>.<ext>.b64      the same, written as base64 text (from the claude.ai page,
 *                             whose GitHub connector can only save text)
 *   meta/groups.json          groups
 *   meta/dictionary.json      personal dictionary
 *
 * Two ways to reach the repository:
 *   - "token": the installed app and websites call GitHub's API directly with
 *     a fine-grained access key;
 *   - "connector": on claude.ai, where pages can't call GitHub themselves,
 *     through the viewer's GitHub connector in claude.ai.
 *
 * Each sync lists the repository, downloads what changed, merges (newest edit
 * wins; when both sides changed, the other version is kept as a "conflicted
 * copy"), then saves everything new in one commit.
 */
const Sync = (() => {
  const CONFIG_KEY = 'inkwell.sync';          // { mode, token?, owner, repo, branch }
  const STATE_KEY = 'inkwell.sync.state';     // { paths: {path: sha}, synced: {id: updated}, last }
  const DELETED_KEY = 'inkwell.sync.deleted'; // { id: deletedAt } not yet uploaded
  const API = 'https://api.github.com';
  const CONNECTOR = 'github';                 // the GitHub connector in claude.ai

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

  /* ---------- Bytes, text and git ids ---------- */

  const utf8 = text => new TextEncoder().encode(text);
  const bytesToBase64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const base64ToBytes = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0));

  // Git's id for a file ("blob <size>\0<bytes>", SHA-1): lets both sides tell
  // which files changed without downloading them.
  async function gitSha(bytes) {
    const header = utf8(`blob ${bytes.length}\0`);
    const all = new Uint8Array(header.length + bytes.length);
    all.set(header);
    all.set(bytes, header.length);
    const hash = window.crypto && crypto.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-1', all)) : sha1(all);
    return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // SHA-1 for places without crypto.subtle (it is only for comparing file versions).
  function sha1(bytes) {
    const words = new Uint32Array(((bytes.length + 8 >> 6) + 1) * 16);
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
    words[words.length - 1] = bytes.length * 8;
    let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Uint32Array(80);
    for (let block = 0; block < words.length; block += 16) {
      for (let t = 0; t < 80; t++) {
        w[t] = t < 16 ? words[block + t] : ((x => (x << 1) | (x >>> 31))(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]));
      }
      let [A, B, C, D, E] = [a, b, c, d, e];
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? (B & C) | (~B & D) : t < 40 ? B ^ C ^ D : t < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
        const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const temp = (((A << 5) | (A >>> 27)) + f + E + k + w[t]) >>> 0;
        [E, D, C, B, A] = [D, C, ((B << 30) | (B >>> 2)) >>> 0, A, temp];
      }
      [a, b, c, d, e] = [(a + A) >>> 0, (b + B) >>> 0, (c + C) >>> 0, (d + D) >>> 0, (e + E) >>> 0];
    }
    const out = new Uint8Array(20);
    [a, b, c, d, e].forEach((v, i) => { out[i * 4] = v >>> 24; out[i * 4 + 1] = v >>> 16; out[i * 4 + 2] = v >>> 8; out[i * 4 + 3] = v; });
    return out;
  }

  /* ---------- Transport 1: GitHub's API with an access key ---------- */

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

  function tokenTransport(cfg) {
    const base = repoPath(cfg);
    let headSha = null;
    let treeSha = null;
    return {
      async list() {
        const ref = await gh(`${base}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
        headSha = ref.object.sha;
        const head = await gh(`${base}/git/commits/${headSha}`);
        treeSha = head.tree.sha;
        const tree = await gh(`${base}/git/trees/${treeSha}?recursive=1`);
        return new Map(tree.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
      },
      async read(path, sha) {
        const blob = await gh(`${base}/git/blobs/${sha}`);
        return base64ToBytes(blob.content);
      },
      // files: [{ path, bytes }] — saved as one commit.
      async commit(files, message) {
        const tree = [];
        for (const f of files) {
          const { sha } = await gh(`${base}/git/blobs`, { method: 'POST', body: { content: bytesToBase64(f.bytes), encoding: 'base64' } });
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha });
        }
        const newTree = await gh(`${base}/git/trees`, { method: 'POST', body: { base_tree: treeSha, tree } });
        const commit = await gh(`${base}/git/commits`, { method: 'POST', body: { message, tree: newTree.sha, parents: [headSha] } });
        await gh(`${base}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      },
      binaryMedia: true,
    };
  }

  /* ---------- Transport 2: the GitHub connector on claude.ai ---------- */

  let mcpPromise = null;
  const mcp = () => {
    if (!mcpPromise) {
      mcpPromise = window.claude && typeof window.claude.use === 'function'
        ? window.claude.use('mcp').catch(() => null)
        : Promise.resolve(null);
    }
    return mcpPromise;
  };

  async function callGitHub(tool, input) {
    const m = await mcp();
    if (!m) throw failure('no_connector', 'This page can’t use connectors here');
    try {
      return await m.callTool(CONNECTOR, tool, input, { cache: false });
    } catch (err) {
      const code = err && err.code;
      if (code === 'tool_error' && /not found|404/i.test(err.message || '')) throw failure('not_found', err.message);
      throw failure('connector_' + (code || 'error'), (err && err.message) || 'The GitHub connector failed');
    }
  }

  function connectorTransport(cfg) {
    const ref = 'refs/heads/' + cfg.branch;
    const listDir = async dir => {
      try {
        const result = await callGitHub('get_file_contents', { owner: cfg.owner, repo: cfg.repo, path: dir, ref, fields: ['path', 'sha', 'type'] });
        const entries = Array.isArray(result.payload) ? result.payload : [];
        return entries.filter(e => e.type === 'file').map(e => [e.path, e.sha]);
      } catch (err) {
        if (err.code === 'not_found') return [];   // the folder doesn't exist yet
        throw err;
      }
    };
    return {
      async list() {
        const parts = await Promise.all(['notes', 'media', 'meta'].map(listDir));
        return new Map(parts.flat());
      },
      async read(path) {
        const result = await callGitHub('get_file_contents', { owner: cfg.owner, repo: cfg.repo, path, ref });
        for (const block of result.content || []) {
          if (block.type === 'resource' && block.resource) {
            if (typeof block.resource.text === 'string') return utf8(block.resource.text);
            if (typeof block.resource.blob === 'string') return base64ToBytes(block.resource.blob);
          }
          if (block.type === 'image' && typeof block.data === 'string') return base64ToBytes(block.data);
        }
        throw failure('unreadable', 'Couldn’t read ' + path);
      },
      async commit(files, message) {
        // The connector saves text only; binary files are written as base64 text (*.b64).
        await callGitHub('push_files', {
          owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, message,
          files: files.map(f => ({ path: f.path, content: new TextDecoder().decode(f.bytes) })),
        });
      },
      binaryMedia: false,
    };
  }

  const transport = cfg => (cfg.mode === 'connector' ? connectorTransport(cfg) : tokenTransport(cfg));

  /* ---------- Connecting ---------- */

  // Installed app / website: checks the key and the repository, and prepares
  // an empty repository.
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
    const cfg = { mode: 'token', token, owner, repo: repo.name, branch: repo.default_branch || 'main' };
    write(CONFIG_KEY, cfg);
    write(STATE_KEY, { paths: {}, synced: {}, last: 0 });
    // A brand-new repository has no commits yet; give it one so it can be synced.
    try {
      await gh(`${repoPath(cfg)}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    } catch (err) {
      if (!/^http_(404|409)$/.test(err.code)) throw err;
      await gh(`${repoPath(cfg)}/contents/README.md`, {
        method: 'PUT',
        body: { message: 'Start Inkwell notes backup', content: bytesToBase64(utf8('# Inkwell notes\n\nBackup of the Inkwell notes app. Edit notes in the app, not here.\n')) },
      });
    }
    setStatus('idle');
    return cfg;
  }

  // claude.ai page: the same repository through the GitHub connector.
  async function connectConnector(repoName, branch = 'main') {
    const me = await callGitHub('get_me', {});
    const owner = me.payload && (me.payload.login || (me.payload.user && me.payload.user.login));
    if (!owner) throw failure('no_user', 'The GitHub connector didn’t say which account it uses');
    const cfg = { mode: 'connector', owner, repo: repoName, branch };
    // Make sure the repository is reachable before saving anything.
    try {
      await callGitHub('get_file_contents', { owner, repo: repoName, path: '/', ref: 'refs/heads/' + branch, fields: ['path'] });
    } catch (err) {
      if (err.code === 'not_found') throw failure('no_repo', `No repository “${owner}/${repoName}” with a “${branch}” branch that your GitHub connector can see`);
      throw err;
    }
    write(CONFIG_KEY, cfg);
    write(STATE_KEY, { paths: {}, synced: {}, last: 0 });
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

  const MESSAGES = {
    offline: 'Offline. Changes will sync when you’re back online.',
    bad_token: 'GitHub refused the access key. It may have expired: connect again with a new one.',
    http_403: 'The access key can’t write to the repository. Give it “Contents: Read and write”.',
    http_404: 'The repository is gone or the key can no longer see it.',
    connector_server_not_connected: 'Connect GitHub in claude.ai Settings › Connectors, then try again.',
    connector_needs_reauth: 'Reconnect GitHub in claude.ai Settings › Connectors.',
    connector_not_in_manifest: 'This page isn’t allowed to use your GitHub connector. Allow it from the page’s permissions.',
    connector_approval_required: 'Allow this page to use your GitHub connector, then try again.',
    connector_selection_required: 'Choose which GitHub connector this page should use, then try again.',
    connector_server_unavailable: 'GitHub didn’t answer. Changes will sync on the next try.',
    no_connector: 'Connectors aren’t available in this view.',
  };

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
            // The other device synced at the same moment: start over.
            if (err.code === 'http_422' && attempt < 2) continue;
            throw err;
          }
        }
        setStatus('ok');
      } catch (err) {
        setStatus('error', MESSAGES[err.code] || 'Sync failed: ' + err.message);
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
  const readJson = async (remote, path, sha) => JSON.parse(new TextDecoder().decode(await remote.read(path, sha)));

  async function syncOnce() {
    const cfg = config();
    const remoteRepo = transport(cfg);
    const state = read(STATE_KEY, { paths: {}, synced: {} });
    state.paths = state.paths || {};
    state.synced = state.synced || {};

    // 1. What the repository holds now.
    const remote = await remoteRepo.list();
    const remoteMedia = new Map();   // id → path
    for (const path of remote.keys()) {
      const m = path.match(/^media\/([^/.]+)\.(\w+)(\.b64)?$/);
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
      const theirs = await readJson(remoteRepo, path, sha);
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
      const data = await readJson(remoteRepo, path, sha);
      if (key === 'groups') {
        const ids = new Set(groups.map(g => g.id));
        groups = [...groups, ...(data.groups || []).filter(g => !ids.has(g.id))];
      } else {
        words = [...new Set([...words, ...(data.words || [])])];
      }
      state.paths[path] = sha;
    }

    // 3. Send what's new here, in one commit. Files already there unchanged are skipped.
    const files = [];
    const uploaded = [];
    const add = async (path, bytes, extra = {}) => {
      const sha = await gitSha(bytes);
      if (sha !== remote.get(path)) files.push({ path, bytes });
      uploaded.push({ path, sha, ...extra });
    };
    for (const note of notes) {
      if (app.isPristine(note)) continue;
      const path = `notes/${note.id}.json`;
      // Unchanged since it was last sent (or received): nothing to do.
      if (remote.has(path) && state.synced[note.id] === note.updated && state.paths[path] === remote.get(path)) continue;
      const body = JSON.stringify({ id: note.id, html: note.html, text: note.text, created: note.created, updated: note.updated, group: note.group || '' });
      await add(path, utf8(body), { id: note.id, updated: note.updated });
    }
    for (const [id, at] of Object.entries(deleted)) {
      if (notes.some(n => n.id === id)) continue;
      await add(`notes/${id}.json`, utf8(JSON.stringify({ id, deleted: true, updated: at })), { id, updated: at, tombstone: true });
    }
    // Pictures and recordings this device has that the repository doesn't.
    for (const note of notes) {
      for (const id of mediaRefs(note.html)) {
        if (remoteMedia.has(id)) continue;
        const file = await Media.blob('idb:' + id).catch(() => null);
        if (!file) continue;
        const raw = new Uint8Array(await file.arrayBuffer());
        const path = `media/${id}.${extOf(file.type)}` + (remoteRepo.binaryMedia ? '' : '.b64');
        await add(path, remoteRepo.binaryMedia ? raw : utf8(bytesToBase64(raw)));
        remoteMedia.set(id, path);
      }
    }
    await add('meta/groups.json', utf8(JSON.stringify({ groups })));
    await add('meta/dictionary.json', utf8(JSON.stringify({ words })));

    if (files.length) {
      await remoteRepo.commit(files, `Sync from ${app.deviceName()} (${files.length} file${files.length === 1 ? '' : 's'})`);
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
        let bytes = await remoteRepo.read(path, sha);
        if (path.endsWith('.b64')) bytes = base64ToBytes(new TextDecoder().decode(bytes));
        const ext = path.replace(/\.b64$/, '').split('.').pop();
        await Media.restore('idb:' + id, new Blob([bytes], { type: typeOf(ext) }));
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
    init, connect, connectConnector, disconnect, syncNow, schedule, noteDeleted, sha1,
    config, status: () => status, onStatus: fn => listeners.add(fn),
    message: code => MESSAGES[code],
  };
})();
