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
    sample: () => samplePromise,
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
