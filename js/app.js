/*
 * Inkwell Notes — an Apple Notes–style editor with click-to-correct spelling
 * and book-like definitions.
 */
(() => {
  const NOTES_KEY = 'inkwell.notes';
  const DEFINE_KEY = 'inkwell.defineOnClick';
  const TAB_KEY = 'inkwell.cardTab';
  const LETTERS_KEY = 'inkwell.norseLetters';
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
    Cloud.saveNote(note);
    renderList();
    renderDate(note);
  }

  const isBlank = note => !note.text.trim() && !note.html.includes('class="sketch"');

  // Drop the open note if the user left it blank.
  function discardIfEmpty(note) {
    if (note && isBlank(note)) {
      notes = notes.filter(n => n !== note);
      persist();
      Cloud.deleteNote(note.id);
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
      if (node.parentElement.closest('.norse')) continue; // Old Norse words aren't English
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
    const norse = caret.node.parentElement.closest('.norse');
    if (norse) {
      const range = document.createRange();
      range.selectNodeContents(norse);
      return { word: norse.textContent, range, norse };
    }
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

  let active = null;     // { word, range, misspelled, norse?, norseFor?, wiki? }
  let cardToken = 0;     // guards against out-of-order async lookups
  const esc = Definitions.escape;

  const pref = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const setPref = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* keep the default */ }
  };
  // "a–z" keeps your everyday alphabet; "ð þ ǫ" uses the Old Norse letters.
  const plainLetters = () => pref(LETTERS_KEY, 'plain') === 'plain';

  function openCard(hit, misspelled) {
    active = { ...hit, misspelled };
    const token = ++cardToken;
    setLookupHighlight(hit.range);

    if (hit.norse) {
      // A word that was already translated: offer the alternatives again.
      card.innerHTML = '<div class="norse-panel"></div>';
      showCard();
      showNorse(hit.norse.dataset.original, token);
    } else if (misspelled) {
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
          <div class="norse-guess" hidden></div>
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
          ? suggestions.map(s => `<button class="suggestion" data-replace="${esc(s)}">${esc(s)}</button>`).join('')
          : '<span class="muted">No suggestions found.</span>';
        // Maybe it's an Old Norse word typed from memory ("vordr" → vǫrðr).
        const guesses = Norse.similar(hit.word);
        if (guesses.length) {
          const guess = card.querySelector('.norse-guess');
          guess.hidden = false;
          guess.innerHTML = '<p class="card-label">Did you mean the Old Norse</p>' +
            guesses.map(e => norseOption(e, false)).join('');
        }
        positionCard();
      }, 0);
    } else {
      card.innerHTML = `
        <div class="card-tabs" role="tablist">
          <button role="tab" data-tab="define">Definition</button>
          <button role="tab" data-tab="norse">Old Norse</button>
        </div>
        <div class="definition"></div>
        <div class="norse-panel"></div>`;
      showCard();
      switchTab(pref(TAB_KEY, 'define'));
    }
  }

  function switchTab(tab) {
    setPref(TAB_KEY, tab);
    card.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    const definition = card.querySelector('.definition');
    const norse = card.querySelector('.norse-panel');
    definition.hidden = tab !== 'define';
    norse.hidden = tab !== 'norse';
    if (tab === 'define' && !definition.childElementCount) showDefinition(active.word);
    if (tab === 'norse' && !norse.childElementCount) showNorse(active.word);
    positionCard();
  }

  function showDefinition(word, token = cardToken) {
    const box = card.querySelector('.definition');
    box.hidden = false;
    box.innerHTML = `
      <div class="entry loading">
        <div class="headword">${esc(word)}</div>
        <p class="muted serif">Consulting the lexicon…</p>
      </div>`;
    positionCard();

    Definitions.lookup(word).then(entry => {
      if (token !== cardToken) return;
      box.innerHTML = entry ? Definitions.render(entry) : `
        <div class="entry not-found">
          <p class="serif">No entry for <em>${esc(word)}</em> was found in the lexicon.</p>
        </div>`;
      positionCard();
    }).catch(() => {
      if (token !== cardToken) return;
      box.innerHTML = `
        <div class="entry not-found">
          <p class="serif">The lexicon is out of reach — check your internet connection.</p>
          <button class="action subtle" data-lookup="${esc(word)}">Try again</button>
        </div>`;
      positionCard();
    });
  }

  /* ---------- Old Norse ---------- */

  function norseOption(entry, chosen) {
    const shown = plainLetters() ? Norse.plain(entry.word) : entry.word;
    const other = plainLetters() ? entry.word : Norse.plain(entry.word);
    return `
      <button class="norse-option${chosen ? ' chosen' : ''}" data-norse="${esc(entry.word)}" data-gloss="${esc(entry.gloss)}">
        <span class="norse-word">${esc(shown)}</span>
        ${other !== shown ? `<span class="norse-alt">${esc(other)}</span>` : ''}
        ${entry.pos ? `<span class="norse-pos">${esc(entry.pos)}</span>` : ''}
        ${entry.gloss ? `<span class="norse-gloss">${esc(entry.gloss)}</span>` : ''}
      </button>`;
  }

  function norseGroup(label, entries, chosen) {
    if (!entries.length) return '';
    return `<section class="norse-group"><p class="norse-group-label">${label}</p>` +
      entries.map(e => norseOption(e, e.word === chosen)).join('') + '</section>';
  }

  function showNorse(original, token = cardToken) {
    active.norseFor = original;
    active.wiki = undefined;
    // Words the glossary doesn't know are looked up further straight away.
    if (!Norse.english(original).length) loadMore(token);
    else renderNorse();
  }

  function loadMore(token = cardToken) {
    active.wiki = 'loading';
    renderNorse();
    Norse.more(active.norseFor).then(result => {
      if (token !== cardToken) return;
      active.wiki = result;
      renderNorse();
    }).catch(() => {
      if (token !== cardToken) return;
      active.wiki = 'error';
      renderNorse();
    });
  }

  function renderNorse() {
    const box = card.querySelector('.norse-panel');
    if (!box || !active) return;
    const original = active.norseFor;
    const chosen = active.norse ? active.norse.dataset.norse : null;
    const found = Norse.english(original);
    const lookalikes = found.length ? [] : Norse.similar(original);
    const known = new Set([...found, ...lookalikes].map(e => e.word));
    const result = active.wiki && active.wiki.words ? active.wiki : null;
    const extra = result ? result.words.filter(e => !known.has(e.word)) : [];

    let wikiSection;
    if (active.wiki === undefined) {
      wikiSection = '<button class="action subtle" data-action="wiki">More translations</button>';
    } else if (active.wiki === 'loading') {
      wikiSection = '<p class="muted serif">Searching for more translations\u2026</p>';
    } else if (active.wiki === 'error') {
      wikiSection = '<p class="muted serif">More translations are out of reach \u2014 check your internet connection.</p>' +
        '<button class="action subtle" data-action="wiki">Try again</button>';
    } else if (extra.length) {
      wikiSection = norseGroup('From ' + result.source, extra, chosen) +
        (result.source === 'Claude' ? '<p class="norse-note">Suggested by Claude. Worth checking against a dictionary before you rely on them.</p>' : '');
    } else {
      wikiSection = `<p class="muted serif">${known.size ? 'No further translations found.' : `No Old Norse word for \u201C${esc(original)}\u201D was found.`}</p>`;
    }

    const scroll = card.scrollTop;
    box.innerHTML = `
      <div class="norse-card">
        <header class="norse-head">
          <div>
            <h3>Old Norse</h3>
            <p class="norse-for">for “${esc(original)}”</p>
          </div>
          <div class="letters" role="group" aria-label="Letters to write with">
            <button data-letters="plain" aria-pressed="${plainLetters()}" title="Write it with everyday letters (d, th, o)">a–z</button>
            <button data-letters="old" aria-pressed="${!plainLetters()}" title="Write it with Old Norse letters (ð, þ, ǫ)">ð þ ǫ</button>
          </div>
        </header>
        ${active.norse ? `<button class="action subtle restore" data-action="restore">↩ Put back “${esc(original)}”</button>` : ''}
        ${Object.entries(Norse.KIND_LABEL).map(([kind, label]) => norseGroup(label, found.filter(e => e.kind === kind), chosen)).join('')}
        ${norseGroup('Looks like', lookalikes, chosen)}
        <section class="norse-wiki">${wikiSection}</section>
        <p class="norse-note">Dictionary forms in normalized Old Norse spelling. Choosing one only swaps the word; it keeps your note’s font.</p>
      </div>`;
    card.scrollTop = scroll;
    positionCard();
  }

  function matchCase(original, word) {
    if (original.length > 1 && original === original.toUpperCase()) return word.toUpperCase();
    if (original[0] !== original[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  function insertNorse(word, gloss) {
    const original = active.norse ? active.norse.dataset.original : active.word;
    const text = matchCase(active.word, plainLetters() ? Norse.plain(word) : word);
    replaceActive(
      `<span class="norse" lang="non" data-norse="${esc(word)}" data-original="${esc(original)}" data-text="${esc(text)}"` +
      ` title="Old Norse ${esc(word)}${gloss ? ' — ' + esc(gloss) : ''} (for “${esc(original)}”)">${esc(text)}</span>`,
      true);
  }

  // Typing at the edge of a translated word must not grow the Old Norse word itself.
  function fixNorseSpans() {
    for (const span of editor.querySelectorAll('span.norse')) {
      const want = span.dataset.text;
      const have = span.textContent;
      if (have === want) continue;
      const sel = getSelection();
      let caret = null;
      if (sel.rangeCount && span.contains(sel.anchorNode)) {
        const before = document.createRange();
        before.setStart(span, 0);
        before.setEnd(sel.anchorNode, sel.anchorOffset);
        caret = before.toString().length;
      }
      let node;
      if (have.length > want.length && have.startsWith(want)) {
        span.textContent = want;
        node = document.createTextNode(have.slice(want.length));
        span.after(node);
        if (caret !== null) caret -= want.length;
      } else if (have.length > want.length && have.endsWith(want)) {
        span.textContent = want;
        node = document.createTextNode(have.slice(0, have.length - want.length));
        span.before(node);
      } else {
        // The translated word itself was edited: it's ordinary text again.
        node = document.createTextNode(have);
        span.replaceWith(node);
      }
      if (caret !== null) {
        const offset = Math.min(Math.max(caret, 0), node.length);
        sel.collapse(node, offset);
      }
    }
  }

  /* ---------- Card placement ---------- */

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

  // Swap the clicked word (or translated word) for new text or markup.
  function replaceActive(content, asHTML = false) {
    const { range, word, norse } = active;
    if (norse ? !editor.contains(norse) : range.toString() !== word) return closeCard(); // text changed underneath us
    editor.focus();
    const target = document.createRange();
    if (norse) target.selectNode(norse);
    else target.setStart(range.startContainer, range.startOffset), target.setEnd(range.endContainer, range.endOffset);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(target);
    // execCommand keeps the change on the undo stack (Ctrl/⌘ Z works).
    if (!document.execCommand(asHTML ? 'insertHTML' : 'insertText', false, content)) {
      target.deleteContents();
      target.insertNode(asHTML ? target.createContextualFragment(content) : document.createTextNode(content));
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
    if (btn.dataset.replace) return replaceActive(btn.dataset.replace);
    if (btn.dataset.norse) return insertNorse(btn.dataset.norse, btn.dataset.gloss);
    if (btn.dataset.tab) return switchTab(btn.dataset.tab);
    if (btn.dataset.lookup) return showDefinition(btn.dataset.lookup);
    if (btn.dataset.letters) {
      setPref(LETTERS_KEY, btn.dataset.letters);
      return renderNorse();
    }
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
      case 'wiki':
        loadMore();
        break;
      case 'restore':
        replaceActive(active.norse.dataset.original);
        break;
    }
  });

  /* ---------- Editor events ---------- */

  let saveTimer = null;

  editor.addEventListener('input', () => {
    typing = true;
    fixNorseSpans();
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
    const sketch = e.target.closest('.sketch');
    if (sketch) return editSketch(sketch);
    if (!SpellCheck.ready || e.detail > 1 || !getSelection().isCollapsed) return;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) return closeCard();
    const misspelled = !hit.norse && !SpellCheck.isCorrect(hit.word);
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

  document.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
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

  /* ---------- Sketches (Apple Pencil, stylus, mouse or finger) ---------- */

  let sketchSpot = null;   // where the caret was when "Sketch" was pressed

  const sketchButton = $('#insert-sketch');
  sketchButton.addEventListener('mousedown', e => e.preventDefault());
  sketchButton.addEventListener('click', async () => {
    const sel = getSelection();
    sketchSpot = sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    closeCard();
    const strokes = await Sketch.open();
    if (!strokes || !strokes.length) return;
    editor.focus();
    if (!sketchSpot) {
      placeCaretAtEnd();
    } else {
      sel.removeAllRanges();
      sel.addRange(sketchSpot);
    }
    const markup = Sketch.html(strokes) + '<div><br></div>';
    if (!document.execCommand('insertHTML', false, markup)) editor.insertAdjacentHTML('beforeend', markup);
    saveCurrent();
  });

  async function editSketch(el) {
    closeCard();
    const strokes = await Sketch.open(Sketch.read(el));
    if (!strokes) return;
    if (strokes.length) el.outerHTML = Sketch.html(strokes);
    else el.remove();
    saveCurrent();
  }

  try {
    defineToggle.checked = localStorage.getItem(DEFINE_KEY) !== 'off';
  } catch { /* default on */ }
  defineToggle.addEventListener('change', () => {
    try { localStorage.setItem(DEFINE_KEY, defineToggle.checked ? 'on' : 'off'); } catch {}
    if (!defineToggle.checked && active && !active.misspelled) closeCard();
  });

  $('#new-note').addEventListener('click', () => {
    const blank = notes.find(isBlank);
    openNote((blank || createNote()).id, { focus: true });
  });

  // Pop-up confirm dialogs don't work everywhere (claude.ai blocks them), so
  // destructive buttons ask for a second tap instead.
  function confirmByTapping(btn, message) {
    if (btn.classList.contains('armed')) {
      btn.classList.remove('armed');
      clearTimeout(btn.armTimer);
      return true;
    }
    btn.classList.add('armed');
    flash(message);
    btn.armTimer = setTimeout(() => btn.classList.remove('armed'), 3000);
    return false;
  }

  $('#delete-note').addEventListener('click', e => {
    const note = current();
    if (!note) return;
    if (!isBlank(note) && !confirmByTapping(e.currentTarget, 'Tap the bin again to delete this note')) return;
    notes = notes.filter(n => n !== note);
    persist();
    Cloud.deleteNote(note.id);
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

  let dictionarySynced = false;
  let lastSavedWords = '';
  SpellCheck.onChange(() => {
    scanSpelling();
    if (!dictModal.hidden) renderDictionary();
    const words = SpellCheck.list();
    if (dictionarySynced && JSON.stringify(words) !== lastSavedWords) {
      lastSavedWords = JSON.stringify(words);
      Cloud.saveDictionary(words);
    }
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
    <div>Click any other word — try <b>serendipity</b>, <b>luminous</b> or <b>wander</b> — and you’ll get a definition set like a page from an old dictionary. Turn that off with the “Look up on click” switch above.</div>
    <div><br></div>
    <div>Switch the card to <b>Old Norse</b> to swap a word for the tongue of the sagas: the warrior raised his sword against the wolf.</div>
    <div><br></div>
    <div>Tap the squiggle in the toolbar to sketch with an Apple Pencil, stylus, mouse or finger.</div>`;

  if (!notes.length) {
    const tmp = document.createElement('div');
    tmp.innerHTML = WELCOME;
    tmp.style.cssText = 'position:absolute;left:-9999px;white-space:pre-wrap';
    document.body.append(tmp);
    createNote(WELCOME.trim(), tmp.innerText).welcome = true;
    persist();
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
  /* ---------- Your claude.ai account (when opened there) ---------- */

  const isPristineWelcome = n => n.welcome && n.html === WELCOME.trim();

  // Bring in notes saved from other devices, and upload ones only this device has.
  Cloud.loadNotes().then(remote => {
    if (!remote) return;
    if (remote.length) notes = notes.filter(n => !isPristineWelcome(n));
    for (const r of remote) {
      const i = notes.findIndex(n => n.id === r.id);
      if (i < 0) notes.push(r);
      else if (r.updated > notes[i].updated) notes[i] = r;
    }
    for (const n of notes) {
      const r = remote.find(x => x.id === n.id);
      if ((!r || n.updated > r.updated) && !isPristineWelcome(n)) Cloud.saveNote(n);
    }
    persist();
    const showing = app.classList.contains('show-editor');
    const note = current();
    if (!note) {
      const first = [...notes].sort((a, b) => b.updated - a.updated)[0];
      if (first) openNote(first.id);
      if (!showing) app.classList.remove('show-editor');
    } else if (document.activeElement !== editor && editor.innerHTML !== note.html) {
      editor.innerHTML = note.html;
      renderDate(note);
      scanSpelling();
    }
    renderList();
  }).catch(() => flash('Couldn\u2019t load the notes saved to your account. Notes on this device still work.'));

  Cloud.loadDictionary().then(words => {
    if (words === null) return;
    lastSavedWords = JSON.stringify(words);
    dictionarySynced = true;
    SpellCheck.merge(words);
  }).catch(() => { /* the word list on this device still works */ });

  Cloud.onError(err => {
    if (err && err.code === 'invalid_argument') flash('This note is too big to save to your account. It\u2019s still saved on this device.');
    else if (err && err.code === 'quota_exceeded') flash('Your account storage for this app is full. Delete some notes to make room.');
    else flash('Couldn\u2019t save to your account just now. It\u2019s still saved on this device.');
  });

  // Parse the dictionary after the first paint so the app appears instantly.
  setTimeout(() => {
    SpellCheck.init();
    scanSpelling();
    if (supportsHighlights) status.classList.remove('visible');
  }, 30);
})();
