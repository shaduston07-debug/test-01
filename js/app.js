/*
 * Inkwell Notes — an Apple Notes–style editor with click-to-correct spelling
 * and book-like definitions.
 */
(() => {
  const NOTES_KEY = 'inkwell.notes';
  const DEFINE_KEY = 'inkwell.defineOnClick';
  // A word: letters, optionally joined by apostrophes (don't, o'clock, Kevin's).
  const WORD_RE = /\p{L}+(?:['’]\p{L}+)*/gu;
  const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

  const $ = sel => document.querySelector(sel);
  const app = $('#app');
  const editor = $('#editor');
  const editorScroll = $('#editor-scroll');
  const noteList = $('#note-list');
  const noteDate = $('#note-date');
  const search = $('#search');
  const card = $('#word-card');
  const defineToggle = $('#define-toggle');
  const status = $('#status');
  const dictModal = $('#dictionary-modal');
  const wordList = $('#word-list');

  let notes = loadNotes();
  let currentId = null;
  let query = '';

  /* ---------- Notes storage ---------- */

  function loadNotes() {
    try {
      return JSON.parse(localStorage.getItem(NOTES_KEY)) || [];
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      flash('Couldn’t save — browser storage is full or blocked.');
    }
  }

  const current = () => notes.find(n => n.id === currentId);

  function createNote(html = '', text = '') {
    const now = Date.now();
    const note = { id: now.toString(36) + Math.random().toString(36).slice(2, 7), html, text, created: now, updated: now };
    notes.unshift(note);
    persist();
    return note;
  }

  function saveCurrent() {
    const note = current();
    if (!note) return;
    note.html = editor.innerHTML;
    note.text = editor.innerText;
    note.updated = Date.now();
    persist();
    renderList();
    renderDate(note);
  }

  // Drop the open note if the user left it blank.
  function discardIfEmpty(note) {
    if (note && !note.text.trim()) {
      notes = notes.filter(n => n !== note);
      persist();
    }
  }

  /* ---------- Sidebar ---------- */

  function titleAndSnippet(note) {
    const lines = note.text.split('\n').map(l => l.trim()).filter(Boolean);
    return { title: lines[0] || 'New Note', snippet: lines.slice(1).join(' ') || 'No additional text' };
  }

  function formatDate(ts, long = false) {
    const d = new Date(ts);
    const today = new Date();
    if (long) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) +
        ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
  }

  function renderList() {
    const q = query.toLowerCase();
    const visible = notes
      .filter(n => !q || n.text.toLowerCase().includes(q))
      .sort((a, b) => b.updated - a.updated);

    noteList.innerHTML = '';
    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'empty-list';
      li.textContent = q ? 'No matching notes' : 'No notes yet';
      noteList.append(li);
      return;
    }
    for (const note of visible) {
      const { title, snippet } = titleAndSnippet(note);
      const li = document.createElement('li');
      li.className = 'note-item' + (note.id === currentId ? ' active' : '');
      li.dataset.id = note.id;
      li.innerHTML = `
        <div class="note-title"></div>
        <div class="note-meta"><span class="note-time"></span><span class="note-snippet"></span></div>`;
      li.querySelector('.note-title').textContent = title;
      li.querySelector('.note-time').textContent = formatDate(note.updated);
      li.querySelector('.note-snippet').textContent = snippet;
      noteList.append(li);
    }
  }

  function renderDate(note) {
    noteDate.textContent = note ? formatDate(note.updated, true) : '';
  }

  function openNote(id, { focus = false } = {}) {
    const previous = current();
    if (previous && previous.id !== id) discardIfEmpty(previous);
    closeCard();
    currentId = id;
    const note = current();
    editor.innerHTML = note ? note.html : '';
    renderDate(note);
    renderList();
    scanSpelling();
    app.classList.add('show-editor');
    editorScroll.scrollTop = 0;
    if (focus) {
      editor.focus();
      placeCaretAtEnd();
    }
  }

  function placeCaretAtEnd() {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---------- Spelling highlights ---------- */

  let scanTimer = null;
  let typing = false;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanSpelling, 350);
  }

  function scanSpelling() {
    if (!supportsHighlights || !SpellCheck.ready) return;
    const sel = getSelection();
    const caret = typing && sel.rangeCount && sel.isCollapsed ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
    const ranges = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of node.data.matchAll(WORD_RE)) {
        const end = m.index + m[0].length;
        // Don't nag about the word that's still being typed.
        if (caret && caret.node === node && caret.offset === end) continue;
        if (SpellCheck.isCorrect(m[0])) continue;
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, end);
        ranges.push(range);
      }
    }
    CSS.highlights.set('misspelled', new Highlight(...ranges));
  }

  function setLookupHighlight(range) {
    if (!supportsHighlights) return;
    if (range) CSS.highlights.set('lookup', new Highlight(range));
    else CSS.highlights.delete('lookup');
  }

  /* ---------- Finding the clicked word ---------- */

  function caretFromPoint(x, y) {
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      return pos && { node: pos.offsetNode, offset: pos.offset };
    }
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      return range && { node: range.startContainer, offset: range.startOffset };
    }
    return null;
  }

  function wordAtPoint(x, y) {
    const caret = caretFromPoint(x, y);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !editor.contains(caret.node)) return null;
    for (const m of caret.node.data.matchAll(WORD_RE)) {
      const end = m.index + m[0].length;
      if (caret.offset < m.index || caret.offset > end) continue;
      const range = document.createRange();
      range.setStart(caret.node, m.index);
      range.setEnd(caret.node, end);
      // Clicking past the end of a line resolves to its last word; make sure we're actually on it.
      const onWord = [...range.getClientRects()].some(r =>
        x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
      return onWord ? { word: m[0], range } : null;
    }
    return null;
  }

  /* ---------- Word card ---------- */

  let active = null;     // { word, range, misspelled }
  let cardToken = 0;     // guards against out-of-order async lookups

  function openCard(hit, misspelled) {
    active = { ...hit, misspelled };
    const token = ++cardToken;
    setLookupHighlight(hit.range);

    if (misspelled) {
      card.innerHTML = `
        <div class="spelling">
          <p class="card-label">Spelling</p>
          <p class="misspelled-word"></p>
          <div class="suggestions"><span class="muted">Finding suggestions…</span></div>
          <div class="card-actions">
            <button class="action" data-action="add">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Add to Personal Dictionary</button>
            <button class="action subtle" data-action="ignore">Ignore</button>
            <button class="action subtle" data-action="define">Look up anyway</button>
          </div>
        </div>
        <div class="definition" hidden></div>`;
      card.querySelector('.misspelled-word').textContent = hit.word;
      showCard();
      // Suggestions can take a moment for long words; let the card paint first.
      setTimeout(() => {
        if (token !== cardToken) return;
        const suggestions = SpellCheck.suggest(hit.word);
        const box = card.querySelector('.suggestions');
        box.innerHTML = suggestions.length
          ? suggestions.map(s => `<button class="suggestion" data-replace="${Definitions.escape(s)}">${Definitions.escape(s)}</button>`).join('')
          : '<span class="muted">No suggestions found.</span>';
        positionCard();
      }, 0);
    } else {
      card.innerHTML = '<div class="definition"></div>';
      showCard();
      showDefinition(hit.word, token);
    }
  }

  function showDefinition(word, token = cardToken) {
    const box = card.querySelector('.definition');
    box.hidden = false;
    box.innerHTML = `
      <div class="entry loading">
        <div class="headword">${Definitions.escape(word)}</div>
        <p class="muted serif">Consulting the lexicon…</p>
      </div>`;
    positionCard();

    Definitions.lookup(word).then(entry => {
      if (token !== cardToken) return;
      box.innerHTML = entry ? Definitions.render(entry) : `
        <div class="entry not-found">
          <p class="serif">No entry for <em>${Definitions.escape(word)}</em> was found in the lexicon.</p>
        </div>`;
      positionCard();
    }).catch(() => {
      if (token !== cardToken) return;
      box.innerHTML = `
        <div class="entry not-found">
          <p class="serif">The lexicon is out of reach — check your internet connection.</p>
          <button class="action subtle" data-lookup="${Definitions.escape(word)}">Try again</button>
        </div>`;
      positionCard();
    });
  }

  function showCard() {
    card.hidden = false;
    card.scrollTop = 0;
    positionCard();
  }

  function positionCard() {
    if (card.hidden || !active) return;
    const margin = 12;
    const rect = active.range.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(380, vw - margin * 2);
    card.style.width = width + 'px';
    card.style.left = Math.min(Math.max(rect.left - 24, margin), vw - width - margin) + 'px';

    const below = vh - rect.bottom - margin * 2;
    const above = rect.top - margin * 2;
    card.style.maxHeight = '';
    const natural = Math.min(card.scrollHeight, 520);
    if (natural <= below || below >= above) {
      card.style.top = (rect.bottom + 8) + 'px';
      card.style.maxHeight = Math.min(520, below) + 'px';
    } else {
      const h = Math.min(natural, above);
      card.style.top = (rect.top - 8 - h) + 'px';
      card.style.maxHeight = h + 'px';
    }
  }

  function closeCard() {
    if (card.hidden) return;
    card.hidden = true;
    card.innerHTML = '';
    active = null;
    cardToken++;
    setLookupHighlight(null);
  }

  function replaceActiveWord(replacement) {
    const { range, word } = active;
    if (range.toString() !== word) return closeCard(); // the text changed underneath us
    editor.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // execCommand keeps the change on the undo stack (Ctrl/⌘ Z works).
    if (!document.execCommand('insertText', false, replacement)) {
      range.deleteContents();
      range.insertNode(document.createTextNode(replacement));
      saveCurrent();
    }
    closeCard();
    scanSpelling();
  }

  card.addEventListener('mousedown', e => {
    // Keep the caret in the editor while using the card's buttons.
    if (e.target.closest('button')) e.preventDefault();
  });

  card.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || !active) return;
    if (btn.dataset.replace) return replaceActiveWord(btn.dataset.replace);
    if (btn.dataset.lookup) return showDefinition(btn.dataset.lookup);
    if (btn.dataset.audio) {
      new Audio(btn.dataset.audio).play().catch(() => flash('Couldn’t play the pronunciation.'));
      return;
    }
    switch (btn.dataset.action) {
      case 'add':
        SpellCheck.addPersonal(active.word);
        flash(`“${active.word}” added to your Personal Dictionary`);
        closeCard();
        break;
      case 'ignore':
        SpellCheck.ignore(active.word);
        closeCard();
        break;
      case 'define':
        card.querySelector('.spelling').classList.add('compact');
        btn.remove();
        showDefinition(active.word);
        break;
    }
  });

  /* ---------- Editor events ---------- */

  let saveTimer = null;

  editor.addEventListener('input', () => {
    typing = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 300);
    scheduleScan();
  });

  editor.addEventListener('keydown', e => {
    if (e.key === 'Escape') return closeCard();
    if (!e.metaKey && !e.ctrlKey && !card.hidden) closeCard();
  });

  editor.addEventListener('click', e => {
    typing = false;
    scheduleScan();
    if (!SpellCheck.ready || e.detail > 1 || !getSelection().isCollapsed) return;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) return closeCard();
    const misspelled = !SpellCheck.isCorrect(hit.word);
    if (!misspelled && !defineToggle.checked) return closeCard();
    if (active && active.range.startContainer === hit.range.startContainer &&
        active.range.startOffset === hit.range.startOffset) return; // same word, already open
    openCard(hit, misspelled);
  });

  editor.addEventListener('blur', () => {
    typing = false;
    scheduleScan();
  });

  // Paste as plain text so styles from other apps don't come along.
  editor.addEventListener('paste', e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  document.addEventListener('mousedown', e => {
    if (!card.hidden && !card.contains(e.target) && !editor.contains(e.target)) closeCard();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeCard();
      closeDictionary();
    }
  });
  editorScroll.addEventListener('scroll', closeCard);
  window.addEventListener('resize', positionCard);

  /* ---------- Toolbar ---------- */

  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      editor.focus();
      let arg = btn.dataset.arg;
      if (btn.dataset.cmd === 'formatBlock') {
        const currentBlock = (document.queryCommandValue('formatBlock') || '').toLowerCase();
        arg = currentBlock === arg ? 'div' : arg;
      }
      document.execCommand(btn.dataset.cmd, false, arg);
      saveCurrent();
    });
  });

  try {
    defineToggle.checked = localStorage.getItem(DEFINE_KEY) !== 'off';
  } catch { /* default on */ }
  defineToggle.addEventListener('change', () => {
    try { localStorage.setItem(DEFINE_KEY, defineToggle.checked ? 'on' : 'off'); } catch {}
    if (!defineToggle.checked && active && !active.misspelled) closeCard();
  });

  $('#new-note').addEventListener('click', () => {
    const blank = notes.find(n => !n.text.trim());
    openNote((blank || createNote()).id, { focus: true });
  });

  $('#delete-note').addEventListener('click', () => {
    const note = current();
    if (!note) return;
    if (note.text.trim() && !confirm('Delete this note?')) return;
    notes = notes.filter(n => n !== note);
    persist();
    currentId = null;
    const next = [...notes].sort((a, b) => b.updated - a.updated)[0];
    if (next) {
      openNote(next.id);
    } else {
      openNote(createNote().id, { focus: true });
    }
    app.classList.remove('show-editor');
  });

  $('#back').addEventListener('click', () => {
    saveCurrent();
    closeCard();
    app.classList.remove('show-editor');
  });

  noteList.addEventListener('click', e => {
    const item = e.target.closest('.note-item');
    if (item) openNote(item.dataset.id);
  });

  search.addEventListener('input', () => {
    query = search.value.trim();
    renderList();
  });

  /* ---------- Personal dictionary ---------- */

  function renderDictionary() {
    const words = SpellCheck.list();
    wordList.innerHTML = '';
    if (!words.length) {
      const li = document.createElement('li');
      li.className = 'empty-list';
      li.textContent = 'No words yet. Click a misspelled word and choose “Add to Personal Dictionary”.';
      wordList.append(li);
      return;
    }
    for (const word of words) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><button class="icon-btn small" aria-label="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
      li.querySelector('span').textContent = word;
      li.querySelector('button').addEventListener('click', () => SpellCheck.removePersonal(word));
      wordList.append(li);
    }
  }

  function closeDictionary() {
    dictModal.hidden = true;
  }

  $('#open-dictionary').addEventListener('click', () => {
    closeCard();
    renderDictionary();
    dictModal.hidden = false;
    $('#add-word-input').focus();
  });
  $('#close-dictionary').addEventListener('click', closeDictionary);
  dictModal.addEventListener('click', e => {
    if (e.target === dictModal) closeDictionary();
  });
  $('#add-word-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#add-word-input');
    if (SpellCheck.addPersonal(input.value)) input.value = '';
    input.focus();
  });

  SpellCheck.onChange(() => {
    scanSpelling();
    if (!dictModal.hidden) renderDictionary();
  });

  /* ---------- Status messages ---------- */

  let flashTimer = null;
  function flash(message, sticky = false) {
    status.textContent = message;
    status.classList.add('visible');
    clearTimeout(flashTimer);
    if (!sticky) flashTimer = setTimeout(() => status.classList.remove('visible'), 2600);
  }

  /* ---------- Start up ---------- */

  const WELCOME = `
    <div>Welcome to Inkwell</div>
    <div>This works just like a notes app, with a few literary tricks.</div>
    <div><br></div>
    <div>Words with a wavy red underline are mispelled. Click one to see suggestions, then click a suggestion to fix it. If a word is actualy right (like your name, or slang), choose “Add to Personal Dictionary” and it will never be flagged again.</div>
    <div><br></div>
    <div>Click any other word — try <b>serendipity</b>, <b>luminous</b> or <b>wander</b> — and you’ll get a definition set like a page from an old dictionary. Turn that off with the “Define on click” switch above.</div>`;

  if (!notes.length) {
    const tmp = document.createElement('div');
    tmp.innerHTML = WELCOME;
    tmp.style.cssText = 'position:absolute;left:-9999px;white-space:pre-wrap';
    document.body.append(tmp);
    createNote(WELCOME.trim(), tmp.innerText);
    tmp.remove();
  }

  const newest = [...notes].sort((a, b) => b.updated - a.updated)[0];
  openNote(newest.id);
  app.classList.remove('show-editor'); // on phones, start on the list

  if (!supportsHighlights) {
    flash('This browser can’t draw spelling underlines, but clicking words still works.', true);
  } else {
    flash('Loading dictionary…', true);
  }
  // Parse the dictionary after the first paint so the app appears instantly.
  setTimeout(() => {
    SpellCheck.init();
    scanSpelling();
    if (supportsHighlights) status.classList.remove('visible');
  }, 30);
})();
