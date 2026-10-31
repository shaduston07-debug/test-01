/*
 * Optional claude.ai features. When the app is opened as a claude.ai page,
 * notes sync to the viewer's private storage and Claude can answer
 * definition / translation lookups the browser can't reach. Opened any
 * other way (a file, a web server), everything here resolves to null and
 * the app works on its own.
 */
const Cloud = (() => {
  const available = typeof window.claude === 'object' && window.claude && typeof window.claude.use === 'function';

  // { db, base } where base is the viewer's private collection, or null.
  const storePromise = !available ? Promise.resolve(null) :
    Promise.all([window.claude.use('db'), window.claude.use('user')])
      .then(async ([db, user]) => {
        if (!db || !user) return null;
        const id = await user.id();
        return id ? { db, base: 'data/users/' + id } : null;
      })
      .catch(() => null);

  const samplePromise = !available ? Promise.resolve(null) :
    window.claude.use('sample').catch(() => null);

  // Image uploads (synced across devices) and file saving on claude.ai.
  const assetsPromise = !available ? Promise.resolve(null) :
    window.claude.use('assets').catch(() => null);
  const downloadsPromise = !available ? Promise.resolve(null) :
    window.claude.use('downloads').catch(() => null);

  /* ---------- Claude with your own API key (installed app, websites) ---------- */

  // Outside claude.ai, an Anthropic API key saved in Settings gives the same
  // { json, limits } interface as claude.ai's `sample`, so phrase translation,
  // Solve and Claude definitions work in the installed app too.
  const KEY_STORE = 'inkwell.claudeKey';
  const MODEL = 'claude-opus-5-5';
  const EFFORT = { quick: 'low', default: 'medium', complex: 'high' };

  function claudeKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
  }

  function setClaudeKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORE, key);
      else localStorage.removeItem(KEY_STORE);
    } catch { /* storage blocked: nothing to remember */ }
    window.dispatchEvent(new Event('inkwell:claude-changed'));
  }

  const failure = (code, message) => Object.assign(new Error(message), { code });

  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  // The reply's JSON, from the first { or [ to the matching end.
  function parseJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : text;
    const start = body.search(/[{[]/);
    if (start < 0) throw failure('invalid_json', 'No JSON in the reply');
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      throw failure('invalid_json', 'The reply was not valid JSON');
    }
  }

  function keyAdapter(key) {
    async function json(prompt, options = {}) {
      const content = [];
      for (const image of options.images || []) {
        content.push({ type: 'image', source: { type: 'base64', media_type: image.type || 'image/png', data: await blobToBase64(image) } });
      }
      content.push({ type: 'text', text: prompt });
      let res;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2026-10-21',
            'anthropic-beta': 'server-side-fallback-2026-07-01',
            // The key is the user's own and stays on their device.
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 16000,
            // If Claude declines, the API retries on Anthropic's recommended fallback model.
            fallbacks: 'default',
            output_config: { effort: EFFORT[options.modelTier] || 'medium' },
            messages: [{ role: 'user', content }],
          }),
        });
      } catch {
        throw failure('network', 'Claude is out of reach');
      }
      if (res.status === 401 || res.status === 403) throw failure('not_granted', 'The Claude API key was refused');
      if (res.status === 429) throw failure('rate_limited', 'Too many requests');
      if (!res.ok) throw failure('upstream_error', 'Claude returned ' + res.status);
      const message = await res.json();
      if (message.stop_reason === 'refusal') throw failure('refused', 'Claude declined this request');
      const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      return parseJson(text);
    }
    return {
      json,
      limits: async () => ({ maxPromptBytes: 262144, images: { maxCount: 20, maxInputBytes: 5e6, mediaTypes: ['image/png', 'image/jpeg'] } }),
    };
  }

  // What answers "ask Claude": claude.ai's sample, else your key, else nothing.
  const sample = () => (available ? samplePromise : Promise.resolve(claudeKey() ? keyAdapter(claudeKey()) : null));

  /* ---------- Notes & personal dictionary ---------- */

  const notesCollection = s => s.db.doc(s.base + '/notes').collection('items');
  const dictionaryDoc = s => s.db.doc(s.base + '/dictionary');
  const groupsDoc = s => s.db.doc(s.base + '/groups');

  // One write at a time per document; a newer value replaces a queued one.
  const queues = new Map();
  function write(key, run) {
    const q = queues.get(key) || { running: false, next: null };
    queues.set(key, q);
    q.next = run;
    if (!q.running) drain(key, q);
  }
  async function drain(key, q) {
    q.running = true;
    while (q.next) {
      const run = q.next;
      q.next = null;
      try {
        await run();
      } catch (err) {
        errorListeners.forEach(fn => fn(err));
      }
    }
    q.running = false;
  }

  const errorListeners = new Set();
  const timers = new Map();

  async function loadNotes() {
    const s = await storePromise;
    if (!s) return null;
    const snap = await notesCollection(s).get();
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  }

  // Coalesce typing into one write per pause.
  function saveNote(note) {
    clearTimeout(timers.get(note.id));
    timers.set(note.id, setTimeout(async () => {
      const s = await storePromise;
      if (!s) return;
      const body = { html: note.html, text: note.text, created: note.created, updated: note.updated, group: note.group || '' };
      write('note:' + note.id, () => notesCollection(s).doc(note.id).set(body));
    }, 1200));
  }

  async function deleteNote(id) {
    clearTimeout(timers.get(id));
    const s = await storePromise;
    if (s) write('note:' + id, () => notesCollection(s).doc(id).delete());
  }

  async function loadDictionary() {
    const s = await storePromise;
    if (!s) return null;
    const snap = await dictionaryDoc(s).get();
    return snap.exists ? (snap.data().words || []) : [];
  }

  async function saveDictionary(words) {
    const s = await storePromise;
    if (s) write('dictionary', () => dictionaryDoc(s).set({ words }));
  }

  async function loadGroups() {
    const s = await storePromise;
    if (!s) return null;
    const snap = await groupsDoc(s).get();
    return snap.exists ? (snap.data().groups || []) : null;
  }

  async function saveGroups(groups) {
    const s = await storePromise;
    if (s) write('groups', () => groupsDoc(s).set({ groups }));
  }

  return {
    onClaude: available,   // opened as a claude.ai page
    store: () => storePromise,
    sample,
    claudeKey,
    setClaudeKey,
    assets: () => assetsPromise,
    downloads: () => downloadsPromise,
    loadNotes,
    saveNote,
    deleteNote,
    loadDictionary,
    saveDictionary,
    loadGroups,
    saveGroups,
    onError: fn => errorListeners.add(fn),
  };
})();
