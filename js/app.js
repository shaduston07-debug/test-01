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

  function persist({ sync = true } = {}) {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      flash('Couldn’t save — browser storage is full or blocked.');
    }
    if (sync) Sync.schedule();
  }

  const newNoteId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const current = () => notes.find(n => n.id === currentId);

  function createNote(html = '', text = '') {
    const now = Date.now();
    const note = { id: newNoteId(), html, text, created: now, updated: now };
    notes.unshift(note);
    persist();
    return note;
  }

  function saveCurrent() {
    const note = current();
    if (!note) return;
    note.html = Media.serialize(editor);
    note.text = editor.innerText;
    note.updated = Date.now();
    persist();
    Cloud.saveNote(note);
    renderList();
    renderDate(note);
  }

  const isBlank = note => !note.text.trim() && !/class="(sketch|image-block|audio-clip)"/.test(note.html);

  // Drop the open note if the user left it blank.
  function discardIfEmpty(note) {
    if (note && isBlank(note)) {
      notes = notes.filter(n => n !== note);
      persist();
      Cloud.deleteNote(note.id);
      Sync.noteDeleted(note.id);
    }
  }

  /* ---------- Groups ---------- */

  const GROUPS_KEY = 'inkwell.groups';
  const GROUP_COLORS = ['#d9a300', '#d93a2b', '#2f6fd6', '#2f9e5b', '#8a4fd1', '#e0702b', '#7a8290'];
  const groupsNav = $('#groups');
  const groupMenu = $('#group-menu');
  let groups = loadGroups();   // [{ id, name, color }]
  let currentGroup = '';       // '' shows every note
  let editingGroup = null;     // a group id, or 'new'
  let editingColor = GROUP_COLORS[0];
  let moveAfterCreate = null;  // note to put in the group being created

  function loadGroups() {
    try {
      return JSON.parse(localStorage.getItem(GROUPS_KEY)) || [];
    } catch {
      return [];
    }
  }

  function persistGroups() {
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); } catch { /* kept in memory */ }
    Cloud.saveGroups(groups);
    Sync.schedule();
  }

  const groupOf = note => groups.find(g => g.id === note.group);

  function renderGroups() {
    const count = id => notes.filter(n => !isBlank(n) && (!id || n.group === id)).length;
    const pick = (id, name, color) => `
      <div class="group-row${currentGroup === id ? ' active' : ''}">
        <button class="group-pick" data-group="${id}">
          <span class="group-dot${id ? '' : ' all'}" style="--dot:${color}"></span>
          <span class="group-name">${esc(name)}</span>
          <span class="group-count">${count(id)}</span>
        </button>
        ${id ? `<button class="icon-btn small group-edit" data-edit-group="${id}" aria-label="Edit ${esc(name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>` : ''}
      </div>`;
    const form = (id, name) => `
      <form class="group-form" data-group-form="${id}">
        <input class="group-input" id="group-name" value="${esc(name)}" placeholder="Group name" maxlength="40" aria-label="Group name" autocomplete="off">
        <div class="group-colors" role="radiogroup" aria-label="Group colour">
          ${GROUP_COLORS.map(c => `<button type="button" class="swatch${c === editingColor ? ' selected' : ''}" data-group-color="${c}" style="--swatch:${c}" aria-label="Colour ${c}"></button>`).join('')}
        </div>
        <div class="group-form-actions">
          ${id === 'new' ? '<button type="button" class="action subtle" data-cancel-group>Cancel</button>'
            : '<button type="button" class="action subtle danger" data-delete-group>Delete group</button>'}
          <button type="submit" class="action">${id === 'new' ? 'Create' : 'Done'}</button>
        </div>
      </form>`;

    // Keep a half-typed group name when the list redraws (e.g. after a sync).
    const nameInput = $('#group-name');
    const typed = nameInput ? { value: nameInput.value, focused: document.activeElement === nameInput } : null;
    groupsNav.innerHTML = `
      <div class="groups-head">
        <span>Groups</span>
        <button class="icon-btn small" data-new-group aria-label="New group" title="New group">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      ${pick('', 'All Notes', 'var(--muted)')}
      ${groups.map(g => editingGroup === g.id ? form(g.id, g.name) : pick(g.id, g.name, g.color)).join('')}
      ${editingGroup === 'new' ? form('new', '') : ''}`;
    const input = $('#group-name');
    if (input && typed) {
      input.value = typed.value;
      if (typed.focused) input.focus();
    }
  }

  function startEditingGroup(id) {
    editingGroup = id;
    const group = groups.find(g => g.id === id);
    editingColor = group ? group.color : GROUP_COLORS[groups.length % GROUP_COLORS.length];
    renderGroups();
    const input = $('#group-name');
    input.focus();
    input.select();
  }

  function finishEditingGroup() {
    const input = $('#group-name');
    const name = input ? input.value.trim() : '';
    if (editingGroup === 'new') {
      if (name) {
        const group = { id: 'g' + Date.now().toString(36), name, color: editingColor };
        groups.push(group);
        if (moveAfterCreate) moveNote(moveAfterCreate, group.id);
      }
    } else {
      const group = groups.find(g => g.id === editingGroup);
      if (group && name) Object.assign(group, { name, color: editingColor });
    }
    moveAfterCreate = null;
    editingGroup = null;
    persistGroups();
    renderList();
  }

  function moveNote(id, groupId) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    note.group = groupId;
    persist();
    Cloud.saveNote(note);
    const group = groups.find(g => g.id === groupId);
    flash(group ? `Moved to \u201C${group.name}\u201D` : 'Removed from its group');
  }

  groupsNav.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.group !== undefined) {
      currentGroup = btn.dataset.group;
      return renderList();
    }
    if (btn.dataset.editGroup) return startEditingGroup(btn.dataset.editGroup);
    if (btn.hasAttribute('data-new-group')) return startEditingGroup('new');
    if (btn.dataset.groupColor) {
      editingColor = btn.dataset.groupColor;
      groupsNav.querySelectorAll('[data-group-color]').forEach(b => b.classList.toggle('selected', b === btn));
      return;
    }
    if (btn.hasAttribute('data-cancel-group')) {
      editingGroup = null;
      moveAfterCreate = null;
      return renderGroups();
    }
    if (btn.hasAttribute('data-delete-group')) {
      if (!confirmByTapping(btn, 'Tap Delete again. Its notes stay, just without a group.')) return;
      const id = editingGroup;
      groups = groups.filter(g => g.id !== id);
      for (const note of notes.filter(n => n.group === id)) {
        note.group = '';
        Cloud.saveNote(note);
      }
      persist();
      if (currentGroup === id) currentGroup = '';
      editingGroup = null;
      persistGroups();
      renderList();
    }
  });

  groupsNav.addEventListener('submit', e => {
    e.preventDefault();
    finishEditingGroup();
  });

  groupsNav.addEventListener('keydown', e => {
    if (e.key === 'Escape' && editingGroup) {
      e.stopPropagation();
      editingGroup = null;
      moveAfterCreate = null;
      renderGroups();
    }
  });

  // "Put in a group" menu on the toolbar.
  function openGroupMenu(anchor) {
    const note = current();
    if (!note) return;
    const options = [{ id: '', name: 'No group', color: 'transparent' }, ...groups];
    groupMenu.innerHTML = '<p class="menu-label">Put this note in</p>' +
      options.map(g => `
        <button role="menuitemradio" aria-checked="${(note.group || '') === g.id}" data-move="${g.id}">
          <span class="group-dot${g.id ? '' : ' none'}" style="--dot:${g.color}"></span>${esc(g.name)}
        </button>`).join('') +
      '<button role="menuitem" data-move-new>New group\u2026</button>';
    groupMenu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    groupMenu.style.top = (rect.bottom + 6) + 'px';
    groupMenu.style.left = Math.max(12, Math.min(rect.right - groupMenu.offsetWidth, window.innerWidth - groupMenu.offsetWidth - 12)) + 'px';
  }

  function closeGroupMenu() {
    groupMenu.hidden = true;
  }

  $('#move-note').addEventListener('click', e => {
    if (!groupMenu.hidden) return closeGroupMenu();
    closeCard();
    openGroupMenu(e.currentTarget);
  });

  groupMenu.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    closeGroupMenu();
    if (btn.hasAttribute('data-move-new')) {
      moveAfterCreate = currentId;
      setSidebarHidden(false);
      app.classList.remove('show-editor');
      return startEditingGroup('new');
    }
    moveNote(currentId, btn.dataset.move);
    renderList();
  });

  document.addEventListener('mousedown', e => {
    if (!groupMenu.hidden && !groupMenu.contains(e.target) && !e.target.closest('#move-note')) closeGroupMenu();
  });

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
      .filter(n => !currentGroup || n.group === currentGroup || n.id === currentId && isBlank(n))
      .filter(n => !q || n.text.toLowerCase().includes(q))
      .sort((a, b) => b.updated - a.updated);
    renderGroups();

    noteList.innerHTML = '';
    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'empty-list';
      li.textContent = q ? 'No matching notes' : currentGroup ? 'No notes in this group yet' : 'No notes yet';
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
      const group = groupOf(note);
      if (group && !currentGroup) {
        const dot = document.createElement('span');
        dot.className = 'group-dot';
        dot.style.setProperty('--dot', group.color);
        dot.title = group.name;
        li.querySelector('.note-title').prepend(dot);
      }
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
    Media.hydrate(editor);
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

  /* Underlines: red (wavy) for spelling mistakes, blue (dotted) for words that may be translations. */

  const UNDERLINE_KEY = 'inkwell.underlines';
  const UNDERLINE_DEFAULTS = { spell: 'on', spellColour: '#e5352b', hints: 'lookalikes', hintColour: '#2f73d9' };
  const underlineSettings = () => {
    try { return { ...UNDERLINE_DEFAULTS, ...JSON.parse(localStorage.getItem(UNDERLINE_KEY)) }; } catch { return { ...UNDERLINE_DEFAULTS }; }
  };
  const hintCache = new Map();

  // A word from another language, or nearly one: "mobali", "vordr", "voror".
  // Not English and not in your Personal Dictionary.
  function isForeign(word) {
    const key = 'f:' + word.toLowerCase();
    if (!hintCache.has(key)) hintCache.set(key, !SpellCheck.isOwnWord(word) && Lexicon.lookalike(word));
    return hintCache.get(key);
  }

  // 'spell', 'hint' or '' for one word, given the underline settings.
  function underlineFor(word, settings) {
    if (settings.hints !== 'off') {
      if (isForeign(word)) return 'hint';
      if (settings.hints === 'all' && SpellCheck.isOwnWord(word)) {
        const key = 't:' + word.toLowerCase();
        if (!hintCache.has(key)) hintCache.set(key, Lexicon.translatable(word));
        if (hintCache.get(key)) return 'hint';
      }
    }
    return settings.spell === 'on' && !SpellCheck.isCorrect(word) ? 'spell' : '';
  }

  function scanSpelling() {
    if (!supportsHighlights || !SpellCheck.ready) return;
    const sel = getSelection();
    const caret = typing && sel.rangeCount && sel.isCollapsed ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
    const settings = underlineSettings();
    const ranges = [];
    const hints = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest(XLAT)) continue; // translated words aren't English
      if (node.parentElement.closest('[contenteditable="false"]')) continue; // recordings, pictures
      for (const m of node.data.matchAll(WORD_RE)) {
        const end = m.index + m[0].length;
        // Don't nag about the word that's still being typed.
        if (caret && caret.node === node && caret.offset === end) continue;
        const kind = underlineFor(m[0], settings);
        if (!kind) continue;
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, end);
        (kind === 'spell' ? ranges : hints).push(range);
      }
    }
    CSS.highlights.set('misspelled', new Highlight(...ranges));
    CSS.highlights.set('translatable', new Highlight(...hints));
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
    const xlat = caret.node.parentElement.closest(XLAT);
    if (xlat) {
      const range = document.createRange();
      range.selectNodeContents(xlat);
      return { word: xlat.textContent, range, xlat };
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

  let active = null;     // { word, range, misspelled, xlat?, lang?, source?, more }
  let cardToken = 0;     // guards against out-of-order async lookups
  const esc = Definitions.escape;

  const pref = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const setPref = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* keep the default */ }
  };

  // Translated words in a note. `.norse` spans come from before other languages existed.
  const XLAT = '.xlat, .norse';
  const spanLang = span => span.dataset.lang || 'norse';
  const spanWord = span => span.dataset.word || span.dataset.norse;

  // "a–z" keeps your everyday alphabet; the other choice uses the language's own letters.
  const plainLetters = lang =>
    pref('inkwell.letters.' + lang, lang === 'norse' ? pref(LETTERS_KEY, 'plain') : 'plain') === 'plain';
  const lettersFor = (lang, word) =>
    Lexicon.get(lang).letters && !plainLetters(lang) ? word : Lexicon.plain(lang, word);

  // Whether Claude can be asked (only when opened on claude.ai).
  let canAskClaude = false;
  const refreshClaude = () => Cloud.sample().then(s => { canAskClaude = !!s; });
  refreshClaude();
  window.addEventListener('inkwell:claude-changed', refreshClaude);

  function openCard(hit, misspelled) {
    if (hit.xlat && hit.xlat.dataset.phrase) return openPhraseCard(hit.range, null, hit.xlat);
    active = { ...hit, misspelled, more: {} };
    const token = ++cardToken;
    setLookupHighlight(hit.range);

    if (hit.xlat) {
      // A word that was already translated: offer the alternatives again.
      card.innerHTML = '<div class="xlat-panel"></div>';
      showCard();
      showLang(spanLang(hit.xlat), hit.xlat.dataset.original, token);
    } else if (misspelled) {
      const lookalike = underlineSettings().hints !== 'off' && isForeign(hit.word);
      card.innerHTML = `
        <div class="spelling${lookalike ? ' lookalike' : ''}">
          <p class="card-label">${lookalike ? 'Possible translation' : 'Spelling'}</p>
          <p class="misspelled-word"></p>
          <div class="suggestions"><span class="muted">Finding suggestions…</span></div>
          <div class="card-actions">
            <button class="action" data-action="add">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Add to Personal Dictionary</button>
            <button class="action subtle" data-action="ignore">Ignore</button>
            <button class="action subtle" data-action="define">Look up anyway</button>
          </div>
          <div class="xlat-guess" hidden></div>
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
        // Maybe it's an old-language word typed from memory ("vordr" → vǫrðr, "xiphos" → ξίφος).
        const guesses = Lexicon.list()
          .map(lang => ({ lang, entries: Lexicon.similar(lang.id, hit.word) }))
          .filter(g => g.entries.length);
        if (guesses.length) {
          const guess = card.querySelector('.xlat-guess');
          guess.hidden = false;
          guess.innerHTML = guesses.map(g =>
            `<p class="card-label">${lookalike ? '' : 'Did you mean '}the ${esc(g.lang.name)}</p>` +
            g.entries.map(e => xlatOption(e, false)).join('')).join('');
        }
        positionCard();
      }, 0);
    } else {
      card.innerHTML = `
        <div class="card-tabs" role="tablist">
          <button role="tab" data-tab="define">Define</button>
          ${Lexicon.list().map(l => `<button role="tab" data-tab="${l.id}">${esc(l.tab)}</button>`).join('')}
        </div>
        <div class="definition"></div>
        <div class="xlat-panel"></div>`;
      showCard();
      // A blue (translatable) word opens on a language that can translate it.
      let tab = pref(TAB_KEY, 'define');
      if (underlineSettings().hints === 'all' && Lexicon.translatable(hit.word) &&
          (tab === 'define' || !Lexicon.get(tab) || !Lexicon.translate(tab, hit.word).length)) {
        tab = (Lexicon.list().find(l => Lexicon.translate(l.id, hit.word).length) || { id: tab }).id;
      }
      switchTab(tab);
    }
  }

  function switchTab(tab) {
    if (tab !== 'define' && !Lexicon.get(tab)) tab = 'define';
    setPref(TAB_KEY, tab);
    card.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    const definition = card.querySelector('.definition');
    definition.hidden = tab !== 'define';
    card.querySelector('.xlat-panel').hidden = tab === 'define';
    if (tab === 'define') {
      if (!definition.childElementCount) showDefinition(active.word);
    } else {
      showLang(tab, active.word);
    }
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

  /* ---------- Translations (Old Norse, Latin, Greek, argot) ---------- */

  function xlatOption(entry, chosen) {
    const lang = Lexicon.get(entry.lang);
    const shown = lettersFor(entry.lang, entry.word);
    const other = shown === entry.word ? Lexicon.plain(entry.lang, entry.word) : entry.word;
    return `
      <button class="xlat-option${chosen ? ' chosen' : ''}" data-xlat="${esc(entry.word)}" data-lang="${entry.lang}" data-gloss="${esc(entry.gloss)}">
        <span class="xlat-word" lang="${lang.htmlLang}">${esc(shown)}</span>
        ${other !== shown ? `<span class="xlat-alt">${esc(other)}</span>` : ''}
        ${entry.pos ? `<span class="xlat-pos">${esc(entry.pos)}</span>` : ''}
        ${entry.gloss ? `<span class="xlat-gloss">${esc(entry.gloss)}</span>` : ''}
      </button>`;
  }

  function xlatGroup(label, entries, chosen) {
    if (!entries.length) return '';
    return `<section class="xlat-group"><p class="xlat-group-label">${esc(label)}</p>` +
      entries.map(e => xlatOption(e, e.word === chosen)).join('') + '</section>';
  }

  function showLang(lang, original, token = cardToken) {
    active.lang = lang;
    active.source = original;
    // Words the glossary doesn't know are looked up further straight away.
    const askable = Lexicon.get(lang).wiki || canAskClaude;
    if (!Lexicon.translate(lang, original).length && active.more[lang] === undefined && askable) loadMore(lang, token);
    else renderLang();
  }

  function loadMore(lang = active.lang, token = cardToken) {
    active.more[lang] = 'loading';
    renderLang();
    Lexicon.more(lang, active.source).then(result => {
      if (token !== cardToken) return;
      active.more[lang] = result;
      if (active.lang === lang) renderLang();
    }).catch(() => {
      if (token !== cardToken) return;
      active.more[lang] = 'error';
      if (active.lang === lang) renderLang();
    });
  }

  function renderLang() {
    const box = card.querySelector('.xlat-panel');
    if (!box || !active || !active.lang) return;
    const lang = Lexicon.get(active.lang);
    const original = active.source;
    const chosen = active.xlat ? spanWord(active.xlat) : null;
    const found = Lexicon.translate(lang.id, original);
    const lookalikes = found.length ? [] : Lexicon.similar(lang.id, original);
    const known = new Set([...found, ...lookalikes].map(e => e.word));
    const state = active.more[lang.id];
    const extra = state && state.words ? state.words.filter(e => !known.has(e.word)) : [];
    const askable = lang.wiki || canAskClaude;

    let moreSection = '';
    if (state === undefined) {
      moreSection = askable ? '<button class="action subtle" data-action="more">More translations</button>'
        : known.size ? '' : `<p class="muted serif">No ${esc(lang.name)} word for “${esc(original)}” in the built-in list.</p>`;
    } else if (state === 'loading') {
      moreSection = '<p class="muted serif">Searching for more translations…</p>';
    } else if (state === 'error') {
      moreSection = '<p class="muted serif">More translations are out of reach — check your internet connection.</p>' +
        '<button class="action subtle" data-action="more">Try again</button>';
    } else if (extra.length) {
      moreSection = xlatGroup('From ' + state.source, extra, chosen) +
        (state.source === 'Claude' ? '<p class="xlat-note">Suggested by Claude. Worth checking against a dictionary before you rely on them.</p>' : '');
    } else {
      moreSection = `<p class="muted serif">${known.size ? 'No further translations found.' : `No ${esc(lang.name)} word for “${esc(original)}” was found.`}</p>`;
    }

    const letters = lang.letters ? `
      <div class="letters" role="group" aria-label="Letters to write with">
        <button data-letters="plain" aria-pressed="${plainLetters(lang.id)}" title="Write it with ${esc(lang.letters.plainHint)}">${lang.letters.plain}</button>
        <button data-letters="native" aria-pressed="${!plainLetters(lang.id)}" title="Write it with ${esc(lang.letters.nativeHint)}">${lang.letters.native}</button>
      </div>` : '';

    const scroll = card.scrollTop;
    box.innerHTML = `
      <div class="xlat-card">
        <header class="xlat-head">
          <div>
            <h3>${esc(lang.title || lang.name)}</h3>
            <p class="xlat-for">for “${esc(original)}”</p>
          </div>
          ${letters}
        </header>
        ${active.xlat ? `<button class="action subtle restore" data-action="restore">↩ Put back “${esc(original)}”</button>` : ''}
        ${Object.entries(lang.kinds).map(([kind, label]) => xlatGroup(label, found.filter(e => e.kind === kind), chosen)).join('')}
        ${xlatGroup('Looks like', lookalikes, chosen)}
        <section class="xlat-more">${moreSection}</section>
        <p class="xlat-note">Dictionary forms. Choosing one only swaps the word; it keeps your note’s font.</p>
      </div>`;
    card.scrollTop = scroll;
    positionCard();
  }

  function matchCase(original, word) {
    if (original.length > 1 && original === original.toUpperCase()) return word.toUpperCase();
    if (original[0] !== original[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  function insertTranslation(word, langId, gloss) {
    const lang = Lexicon.get(langId);
    const original = active.xlat ? active.xlat.dataset.original : active.word;
    const text = matchCase(active.word, lettersFor(langId, word));
    replaceActive(
      `<span class="xlat" lang="${lang.htmlLang}" data-lang="${langId}" data-word="${esc(word)}" data-original="${esc(original)}" data-text="${esc(text)}"` +
      ` title="${esc(lang.name)} ${esc(word)}${gloss ? ' — ' + esc(gloss) : ''} (for “${esc(original)}”)">${esc(text)}</span>`,
      true);
  }

  // Typing at the edge of a translated word must not grow the translated word itself.
  function fixTranslatedSpans() {
    for (const span of editor.querySelectorAll(XLAT)) {
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
      if (!have) {
        // Enter after a translated word copies an empty one onto the new line: drop it.
        const parent = span.parentNode;
        const index = [...parent.childNodes].indexOf(span);
        span.remove();
        if (!parent.textContent && !parent.querySelector('br')) parent.append(document.createElement('br'));
        if (caret !== null) sel.collapse(parent, Math.min(index, parent.childNodes.length));
        continue;
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

  /* ---------- Selected text: translate the whole phrase, or check its spelling ---------- */

  const PHRASE_TAB_KEY = 'inkwell.phraseTab';
  const selectionBar = $('#selection-bar');
  let selectionRange = null;
  let selectionTimer = null;

  // Leave out spaces at either end of a selection ("I said " → "I said").
  function trimRange(range) {
    const r = range.cloneRange();
    while (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset < r.startContainer.length &&
           /\s/.test(r.startContainer.data[r.startOffset]) && r.toString().trim()) r.setStart(r.startContainer, r.startOffset + 1);
    while (r.endContainer.nodeType === Node.TEXT_NODE && r.endOffset > 0 &&
           /\s/.test(r.endContainer.data[r.endOffset - 1]) && r.toString().trim()) r.setEnd(r.endContainer, r.endOffset - 1);
    return r;
  }

  // Misspelled words that touch the range (a half-selected word counts).
  function misspellingsIn(range) {
    const found = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      if (node.parentElement.closest(XLAT) || node.parentElement.closest('[contenteditable="false"]')) continue;
      for (const m of node.data.matchAll(WORD_RE)) {
        const end = m.index + m[0].length;
        const before = node === range.startContainer ? end <= range.startOffset : range.comparePoint(node, end) < 0;
        const after = node === range.endContainer ? m.index >= range.endOffset : range.comparePoint(node, m.index) > 0;
        if (before || after || SpellCheck.isCorrect(m[0])) continue;
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, end);
        found.push({ word: m[0], range: r });
      }
    }
    return found;
  }

  function hideSelectionBar() {
    selectionBar.hidden = true;
  }

  function updateSelectionBar() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode) || !editor.contains(sel.focusNode) ||
        (!card.hidden && active && active.phrase)) return hideSelectionBar();
    const range = trimRange(sel.getRangeAt(0));
    const text = range.toString();
    if (!/\p{L}/u.test(text) || text.length > 3000) return hideSelectionBar();
    selectionRange = range;
    const issues = SpellCheck.ready ? misspellingsIn(range).length : 0;
    selectionBar.querySelector('.sel-count').textContent = issues ? ` (${issues})` : '';
    selectionBar.querySelector('[data-sel="spelling"]').classList.toggle('has-issues', issues > 0);
    selectionBar.hidden = false;
    const box = range.getBoundingClientRect();
    let top = box.bottom + 12;
    if (top + selectionBar.offsetHeight > window.innerHeight - 12) top = box.top - selectionBar.offsetHeight - 12;
    selectionBar.style.top = Math.max(8, top) + 'px';
    selectionBar.style.left = Math.max(8, Math.min(box.left + box.width / 2 - selectionBar.offsetWidth / 2,
      window.innerWidth - selectionBar.offsetWidth - 8)) + 'px';
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(updateSelectionBar, 250);
  });
  selectionBar.addEventListener('pointerdown', e => e.preventDefault());   // keep the selection
  selectionBar.addEventListener('mousedown', e => e.preventDefault());
  selectionBar.addEventListener('click', e => {
    const btn = e.target.closest('[data-sel]');
    if (btn && selectionRange) openPhraseCard(selectionRange, btn.dataset.sel);
  });

  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // span: an earlier phrase translation being reopened.
  function openPhraseCard(range, tab, span = null) {
    const text = range.toString();
    active = {
      phrase: true, range, word: text, xlat: span, misspelled: false, results: {},
      text: (span ? span.dataset.original : text).trim(),
    };
    const token = ++cardToken;
    hideSelectionBar();
    setLookupHighlight(range);
    card.innerHTML = `
      <div class="phrase-head">
        <p class="card-label">${span ? 'Translated phrase' : 'Selected text'}</p>
        <p class="phrase-text"></p>
        ${span ? '<button class="action subtle restore" data-action="restore">↩ Put back the original</button>' : ''}
      </div>
      <div class="card-tabs" role="tablist">
        ${span ? '' : '<button role="tab" data-ptab="spelling">Spelling</button>'}
        ${Phrase.TARGETS.map(t => `<button role="tab" data-ptab="${t.id}">${esc(t.id === 'norse' ? 'Norse' : t.id === 'greek' ? 'Greek' : t.name)}</button>`).join('')}
      </div>
      <div class="phrase-body"></div>`;
    card.querySelector('.phrase-text').textContent = '“' + truncate(active.text, 180) + '”';
    showCard();
    switchPhraseTab(span ? spanLang(span) : tab === 'spelling' ? 'spelling' : pref(PHRASE_TAB_KEY, 'lingala'), token);
  }

  function switchPhraseTab(tab, token = cardToken) {
    active.ptab = tab;
    card.querySelectorAll('[data-ptab]').forEach(b => {
      b.setAttribute('aria-selected', b.dataset.ptab === tab);
      if (b.dataset.ptab === tab) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    if (tab === 'spelling') return renderPhraseSpelling();
    setPref(PHRASE_TAB_KEY, tab);
    if (active.results[tab]) return renderPhraseResult(tab);
    const body = card.querySelector('.phrase-body');
    const t = Phrase.TARGETS.find(x => x.id === tab);
    body.innerHTML = `<p class="phrase-empty">Translating into ${esc(t.name)}…</p>`;
    positionCard();
    Phrase.translate(active.text, tab).then(result => {
      if (token !== cardToken) return;
      active.results[tab] = result;
      if (active.ptab === tab) renderPhraseResult(tab);
    }).catch(err => {
      if (token !== cardToken || active.ptab !== tab) return;
      const why = {
        not_granted: 'The Claude API key was refused. Check it under Appearance › Claude.',
        rate_limited: 'Claude is busy right now. Try again in a minute.',
        refused: 'Claude declined to translate this.',
      }[err && err.code] || 'The translator is out of reach. Check your internet connection.';
      body.innerHTML = `<p class="phrase-empty">${why}</p><button class="action subtle" data-action="retry-phrase">Try again</button>`;
      positionCard();
    });
  }

  function renderPhraseSpelling() {
    const body = card.querySelector('.phrase-body');
    const issues = misspellingsIn(active.range).slice(0, 12);
    active.issues = issues;
    if (!issues.length) {
      body.innerHTML = '<p class="phrase-empty">No spelling mistakes in the selection.</p>';
      return positionCard();
    }
    body.innerHTML = issues.map((issue, i) => `
      <div class="phrase-issue">
        <span class="misspelled-word">${esc(issue.word)}</span>
        <div class="suggestions" data-issue="${i}"><span class="muted">…</span></div>
      </div>`).join('') +
      '<div class="card-actions"><button class="action subtle" data-action="add-all">Add all to Personal Dictionary</button></div>';
    positionCard();
    // Suggestions take a moment per word; fill them in one at a time.
    const token = cardToken;
    issues.forEach((issue, i) => setTimeout(() => {
      if (token !== cardToken || active.ptab !== 'spelling') return;
      const box = card.querySelector(`[data-issue="${i}"]`);
      if (!box) return;
      const options = SpellCheck.suggest(issue.word).slice(0, 4);
      box.innerHTML = options.length
        ? options.map(s => `<button class="suggestion" data-fix="${i}" data-to="${esc(s)}">${esc(s)}</button>`).join('')
        : '<span class="muted">No suggestions</span>';
      positionCard();
    }, 0));
  }

  function fixIssue(i, replacement) {
    const issue = active.issues && active.issues[i];
    if (!issue || issue.range.toString() !== issue.word) return renderPhraseSpelling();
    const node = issue.range.startContainer;
    node.replaceData(issue.range.startOffset, issue.word.length, replacement);   // the selection's range follows along
    active.word = active.range.toString();
    active.text = active.word.trim();
    active.results = {};
    card.querySelector('.phrase-text').textContent = '“' + truncate(active.text, 180) + '”';
    saveCurrent();
    scanSpelling();
    renderPhraseSpelling();
  }

  function renderPhraseResult(id) {
    const body = card.querySelector('.phrase-body');
    const result = active.results[id];
    const lang = Lexicon.get(id);
    const options = result.options.map((o, i) => {
      const shown = lang ? lettersFor(id, o.text) : o.text;
      const other = lang && lang.letters ? (shown === o.text ? Lexicon.plain(id, o.text) : o.text) : '';
      return `
        <button class="xlat-option phrase-option" data-phrase-option="${i}">
          <span class="xlat-word"${lang ? ` lang="${lang.htmlLang}"` : ''}>${esc(shown)}</span>
          ${other && other !== shown ? `<span class="xlat-alt">${esc(other)}</span>` : ''}
          ${o.note ? `<span class="xlat-gloss">${esc(o.note)}</span>` : ''}
        </button>`;
    }).join('');
    const letters = lang && lang.letters ? `
      <div class="letters phrase-letters" role="group" aria-label="Letters to write with">
        <button data-letters="plain" aria-pressed="${plainLetters(id)}">${lang.letters.plain}</button>
        <button data-letters="native" aria-pressed="${!plainLetters(id)}">${lang.letters.native}</button>
      </div>` : '';
    const note = result.rough
      ? 'Rough: word by word from the built-in lists, not a real translation. For whole phrases, add a Claude API key under Appearance › Claude.'
      : result.source === 'Google Translate'
        ? 'Translated by Google Translate. Machine translation: check anything important.'
        : 'Translated by Claude. Check anything important with a fluent speaker.';
    body.innerHTML = `${letters}<div class="phrase-options">${options}</div>
      <p class="xlat-note">${note} Tap a translation to put it in your note.</p>`;
    positionCard();
  }

  function insertPhrase(i) {
    const id = active.ptab;
    const option = active.results[id].options[i];
    const lang = Lexicon.get(id);
    const shown = lang ? lettersFor(id, option.text) : option.text;
    const text = matchCase(active.text, shown);
    if (!lang) return replaceActive(text);   // English or French: ordinary text (undo with Ctrl/⌘ Z)
    const original = active.xlat ? active.xlat.dataset.original : active.text;
    replaceActive(
      `<span class="xlat" lang="${lang.htmlLang}" data-lang="${id}" data-phrase="1" data-word="${esc(option.text)}"` +
      ` data-original="${esc(original)}" data-text="${esc(text)}" title="${esc(lang.name)}: ${esc(option.text)} (for “${esc(original)}”)">${esc(text)}</span>`,
      true);
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
    const { range, word, xlat } = active;
    if (xlat ? !editor.contains(xlat) : range.toString() !== word) return closeCard(); // text changed underneath us
    editor.focus();
    const target = document.createRange();
    if (xlat) target.selectNode(xlat);
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
    if (active.phrase) {
      if (btn.dataset.ptab) return switchPhraseTab(btn.dataset.ptab);
      if (btn.dataset.fix !== undefined) return fixIssue(+btn.dataset.fix, btn.dataset.to);
      if (btn.dataset.phraseOption !== undefined) return insertPhrase(+btn.dataset.phraseOption);
      if (btn.dataset.letters) {
        setPref('inkwell.letters.' + active.ptab, btn.dataset.letters);
        return renderPhraseResult(active.ptab);
      }
      if (btn.dataset.action === 'add-all') {
        (active.issues || []).forEach(issue => SpellCheck.addPersonal(issue.word));
        flash('Added to your Personal Dictionary');
        return renderPhraseSpelling();
      }
      if (btn.dataset.action === 'retry-phrase') return switchPhraseTab(active.ptab);
    }
    if (btn.dataset.replace) return replaceActive(btn.dataset.replace);
    if (btn.dataset.xlat) return insertTranslation(btn.dataset.xlat, btn.dataset.lang, btn.dataset.gloss);
    if (btn.dataset.tab) return switchTab(btn.dataset.tab);
    if (btn.dataset.lookup) return showDefinition(btn.dataset.lookup);
    if (btn.dataset.letters) {
      setPref('inkwell.letters.' + active.lang, btn.dataset.letters);
      return renderLang();
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
      case 'more':
        loadMore();
        break;
      case 'restore':
        replaceActive(active.xlat.dataset.original);
        break;
    }
  });

  /* ---------- Editor events ---------- */

  let saveTimer = null;

  /* Keep the line you're writing comfortably up the screen, not at the bottom edge. */

  const WRITING_LINE = 0.6;   // the caret stays above 60% of the visible height

  function caretRect() {
    const sel = getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rect = range.getClientRects()[0];
    if (rect && rect.height) return rect;
    // An empty line has no text to measure: use its element instead.
    const el = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
    return el ? el.getBoundingClientRect() : null;
  }

  function keepCaretComfortable() {
    const rect = caretRect();
    if (!rect) return;
    const box = editorScroll.getBoundingClientRect();
    // The on-screen keyboard shrinks the visual viewport; measure what's really visible.
    const viewBottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
    const top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, viewBottom);
    const limit = top + (bottom - top) * WRITING_LINE;
    if (rect.bottom > limit) {
      autoScrolling = true;   // our own scroll: don't close the answer bubble or cards
      editorScroll.scrollTop += rect.bottom - limit;
      requestAnimationFrame(() => requestAnimationFrame(() => { autoScrolling = false; }));
    }
  }
  let autoScrolling = false;

  editor.addEventListener('input', () => {
    typing = true;
    fixTranslatedSpans();
    keepCaretComfortable();
    checkMath();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 300);
    scheduleScan();
  });

  editor.addEventListener('keydown', e => {
    if (e.key === 'Tab' && mathAnswer) {
      e.preventDefault();
      return acceptMath();
    }
    if (e.key === 'Escape') {
      hideMath();
      return closeCard();
    }
    if (!e.metaKey && !e.ctrlKey && !card.hidden) closeCard();
  });

  editor.addEventListener('click', e => {
    typing = false;
    hideMath();
    scheduleScan();
    if (e.target.closest('.audio-clip, .image-block')) return closeCard(); // handled by Blocks
    const sketch = e.target.closest('.sketch');
    if (sketch) return editSketch(sketch);
    if (!SpellCheck.ready || e.detail > 1 || !getSelection().isCollapsed) return;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) return closeCard();
    const misspelled = !hit.xlat && (!SpellCheck.isCorrect(hit.word) ||
      (underlineSettings().hints !== 'off' && isForeign(hit.word)));
    if (!misspelled && !defineToggle.checked) return closeCard();
    if (active && active.range.startContainer === hit.range.startContainer &&
        active.range.startOffset === hit.range.startOffset) return; // same word, already open
    openCard(hit, misspelled);
  });

  editor.addEventListener('blur', () => {
    typing = false;
    hideMath();
    scheduleScan();
  });

  // Paste as plain text so styles from other apps don't come along.
  editor.addEventListener('paste', e => {
    e.preventDefault();
    const images = [...(e.clipboardData.files || [])].filter(f => f.type.startsWith('image/'));
    if (images.length) {
      Blocks.rememberCaret();
      return Blocks.insertImages(images);
    }
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
      closeAppearance();
      closeGroupMenu();
      closeShare();
      hideSelectionBar();
      colourMenu.hidden = true;
      Blocks.deselect();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      setSidebarHidden(!app.classList.contains('sidebar-hidden'));
    }
  });
  editorScroll.addEventListener('scroll', () => {
    if (autoScrolling) return;
    closeCard();
    hideMath();
    hideSelectionBar();
  });

  /* ---------- Typed sums: "12 × 7 =" ---------- */

  const mathChip = $('#math-chip');
  let mathAnswer = null;   // { answer, node, offset, spaced }

  function checkMath() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed || sel.anchorNode.nodeType !== Node.TEXT_NODE) return hideMath();
    const before = sel.anchorNode.data.slice(0, sel.anchorOffset);
    const answer = Calc.answerFor(before);
    if (answer === null) return hideMath();
    mathAnswer = { answer, node: sel.anchorNode, offset: sel.anchorOffset, spaced: /=\s$/.test(before) };
    mathChip.innerHTML = `<span>${esc(answer)}</span><kbd>Tab</kbd>`;
    mathChip.title = 'Add the answer (Tab)';
    mathChip.hidden = false;
    // Place it just after the "=".
    const r = document.createRange();
    r.setStart(sel.anchorNode, Math.max(0, sel.anchorOffset - 1));
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    const rect = r.getBoundingClientRect();
    mathChip.style.left = Math.min(rect.right + 6, window.innerWidth - mathChip.offsetWidth - 8) + 'px';
    mathChip.style.top = (rect.top + rect.height / 2 - mathChip.offsetHeight / 2) + 'px';
  }

  function hideMath() {
    mathChip.hidden = true;
    mathAnswer = null;
  }

  function acceptMath() {
    if (!mathAnswer || !editor.contains(mathAnswer.node)) return hideMath();
    const { answer, node, offset, spaced } = mathAnswer;
    hideMath();
    editor.focus();
    getSelection().collapse(node, offset);
    document.execCommand('insertText', false, (spaced ? '' : ' ') + answer);
  }

  mathChip.addEventListener('mousedown', e => e.preventDefault());
  mathChip.addEventListener('click', acceptMath);
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
    const result = await Sketch.open();
    if (!result || !result.strokes.length) return;
    editor.focus();
    if (!sketchSpot) {
      placeCaretAtEnd();
    } else {
      sel.removeAllRanges();
      sel.addRange(sketchSpot);
    }
    const markup = Sketch.html(result.strokes) + solutionHTML(result.solution) + '<div><br></div>';
    if (!document.execCommand('insertHTML', false, markup)) editor.insertAdjacentHTML('beforeend', markup);
    saveCurrent();
  });

  async function editSketch(el) {
    closeCard();
    const result = await Sketch.open(Sketch.read(el));
    if (!result) return;
    if (result.solution) el.insertAdjacentHTML('afterend', solutionHTML(result.solution));
    if (result.strokes.length) el.outerHTML = Sketch.html(result.strokes);
    else el.remove();
    saveCurrent();
  }

  // The worked answer Claude read from a handwritten sum, as a line of the note.
  // An equation reads "3x + 4 = 19 → x = 5"; a plain sum "12 × 7 = 84".
  const solutionHTML = sol => !sol ? '' :
    `<div>${esc(sol.problem)} ${sol.problem.includes('=') ? '\u2192' : '='} <b>${esc(sol.answer)}</b></div>`;

  try {
    defineToggle.checked = localStorage.getItem(DEFINE_KEY) !== 'off';
  } catch { /* default on */ }
  defineToggle.addEventListener('change', () => {
    try { localStorage.setItem(DEFINE_KEY, defineToggle.checked ? 'on' : 'off'); } catch {}
    if (!defineToggle.checked && active && !active.misspelled) closeCard();
  });

  $('#new-note').addEventListener('click', () => {
    const blank = notes.find(isBlank);
    const note = blank || createNote();
    note.group = currentGroup;
    persist();
    openNote(note.id, { focus: true });
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
    Sync.noteDeleted(note.id);
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
    hintCache.clear();
    scanSpelling();
    Sync.schedule();
    if (!dictModal.hidden) renderDictionary();
    const words = SpellCheck.list();
    if (dictionarySynced && JSON.stringify(words) !== lastSavedWords) {
      lastSavedWords = JSON.stringify(words);
      Cloud.saveDictionary(words);
    }
  });

  /* ---------- Hiding the sidebar ---------- */

  const SIDEBAR_KEY = 'inkwell.sidebarHidden';
  const sidebarButton = $('#toggle-sidebar');

  function setSidebarHidden(hidden) {
    app.classList.toggle('sidebar-hidden', hidden);
    sidebarButton.setAttribute('aria-pressed', hidden);
    sidebarButton.setAttribute('aria-label', hidden ? 'Show sidebar' : 'Hide sidebar');
    sidebarButton.title = (hidden ? 'Show' : 'Hide') + ' the sidebar (Ctrl/\u2318 \\)';
    setPref(SIDEBAR_KEY, hidden ? 'yes' : 'no');
    setTimeout(positionCard, 260);
  }

  sidebarButton.addEventListener('click', () => setSidebarHidden(!app.classList.contains('sidebar-hidden')));
  setSidebarHidden(pref(SIDEBAR_KEY, 'no') === 'yes');

  /* ---------- Appearance: theme and colour ---------- */

  const APPEARANCE_KEY = 'inkwell.appearance';
  const ACCENT_KEY = 'inkwell.accent';
  const ACCENTS = [
    { id: 'gold', name: 'Gold', light: '#d9a300', dark: '#f0be1d' },
    { id: 'ember', name: 'Ember', light: '#d0532c', dark: '#ff8a5c' },
    { id: 'crimson', name: 'Crimson', light: '#b8323f', dark: '#ff6b78' },
    { id: 'rose', name: 'Rose', light: '#c8467f', dark: '#ff86b8' },
    { id: 'violet', name: 'Violet', light: '#7a4bd0', dark: '#ae92ff' },
    { id: 'ocean', name: 'Ocean', light: '#2366c4', dark: '#64a6ff' },
    { id: 'teal', name: 'Teal', light: '#13857f', dark: '#3fd0c5' },
    { id: 'forest', name: 'Forest', light: '#2f8a4f', dark: '#5bcc85' },
    { id: 'ink', name: 'Ink', light: '#3d4451', dark: '#c9d0da' },
  ];
  const appearanceModal = $('#appearance-modal');
  const root = document.documentElement;

  const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, t) => '#' + hexToRgb(a).map((v, i) => Math.round(v * t + hexToRgb(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
  const luminance = hex => {
    const [r, g, b] = hexToRgb(hex).map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Text on an accent-coloured button: dark on bright colours, white on deep ones.
  const onAccent = hex => (luminance(hex) > 0.3 ? '#1d1600' : '#ffffff');

  function applyAppearance() {
    const mode = pref(APPEARANCE_KEY, 'system');
    if (mode === 'system') delete root.dataset.appearance;
    else root.dataset.appearance = mode;
    const accent = ACCENTS.find(a => a.id === pref(ACCENT_KEY, 'gold')) || ACCENTS[0];
    root.style.setProperty('--accent-light', accent.light);
    root.style.setProperty('--accent-soft-light', mix(accent.light, '#ffffff', 0.22));
    root.style.setProperty('--selected-light', mix(accent.light, '#ffffff', 0.35));
    root.style.setProperty('--on-accent-light', onAccent(accent.light));
    root.style.setProperty('--accent-dark', accent.dark);
    root.style.setProperty('--accent-soft-dark', mix(accent.dark, '#1e1e1e', 0.25));
    root.style.setProperty('--selected-dark', mix(accent.dark, '#1e1e1e', 0.38));
    root.style.setProperty('--on-accent-dark', onAccent(accent.dark));
    // Home-screen app: the status bar follows the sidebar colour.
    const sidebarColour = getComputedStyle(root).getPropertyValue('--sidebar').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', sidebarColour));
    renderAppearance();
  }

  function renderAppearance() {
    const mode = pref(APPEARANCE_KEY, 'system');
    const accentId = pref(ACCENT_KEY, 'gold');
    document.querySelectorAll('#theme-choice [data-appearance]').forEach(b => b.setAttribute('aria-checked', b.dataset.appearance === mode));
    $('#accent-choice').innerHTML = ACCENTS.map(a => `
      <button role="radio" class="accent-option" data-accent="${a.id}" aria-checked="${a.id === accentId}"
        style="--swatch-light:${a.light};--swatch-dark:${a.dark}">
        <span class="accent-swatch"></span>${a.name}
      </button>`).join('');
  }

  /* Page: paper, paper colour, font, size, width */

  const PAGE_KEY = 'inkwell.page';
  const TINTS = [
    { id: 'default', name: 'Default', light: null, dark: null },
    { id: 'cream', name: 'Cream', light: '#fbf6e9', dark: '#29251f' },
    { id: 'sepia', name: 'Sepia', light: '#f2e5cf', dark: '#30281d' },
    { id: 'mint', name: 'Mint', light: '#edf7ef', dark: '#1c2922' },
    { id: 'sky', name: 'Sky', light: '#edf3fb', dark: '#1b2430' },
    { id: 'rose', name: 'Rose', light: '#fbeff1', dark: '#2d1f23' },
    { id: 'slate', name: 'Slate', light: '#eceef1', dark: '#23262b' },
  ];
  const FONTS = [
    { id: 'system', name: 'System', css: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif', docx: 'Calibri' },
    { id: 'book', name: 'Book', css: '"Literata", "Iowan Old Style", Georgia, serif', docx: 'Georgia' },
    { id: 'garamond', name: 'Garamond', css: '"EB Garamond", Garamond, "Iowan Old Style", Georgia, serif', docx: 'Garamond' },
    { id: 'mono', name: 'Typewriter', css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', docx: 'Courier New' },
    { id: 'hand', name: 'Handwriting', css: '"Caveat", "Bradley Hand", "Segoe Print", cursive', docx: 'Bradley Hand ITC' },
  ];
  const PAGE_DEFAULTS = { paper: 'plain', tint: 'default', font: 'system', size: '17', width: '760' };

  function pageSettings() {
    try {
      return { ...PAGE_DEFAULTS, ...JSON.parse(localStorage.getItem(PAGE_KEY)) };
    } catch {
      return { ...PAGE_DEFAULTS };
    }
  }

  function setPage(change) {
    try { localStorage.setItem(PAGE_KEY, JSON.stringify({ ...pageSettings(), ...change })); } catch { /* this visit only */ }
    applyPage();
  }

  function applyPage() {
    const page = pageSettings();
    const font = FONTS.find(f => f.id === page.font) || FONTS[0];
    const tint = TINTS.find(t => t.id === page.tint) || TINTS[0];
    root.style.setProperty('--page-font', font.css);
    root.style.setProperty('--page-size', page.size + 'px');
    root.style.setProperty('--page-width', page.width === 'none' ? 'none' : page.width + 'px');
    for (const side of ['light', 'dark']) {
      if (tint[side]) root.style.setProperty(`--page-bg-${side}`, tint[side]);
      else root.style.removeProperty(`--page-bg-${side}`);
    }
    $('.editor-pane').dataset.paper = page.paper;
    renderPage();
  }

  function renderPage() {
    const page = pageSettings();
    const check = (sel, key, value) => document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-checked', b.dataset[key] === value));
    check('#paper-choice [data-paper]', 'paper', page.paper);
    check('#size-choice [data-size]', 'size', page.size);
    check('#width-choice [data-width]', 'width', page.width);
    $('#tint-choice').innerHTML = TINTS.map(t => `
      <button role="radio" class="tint-option" data-tint="${t.id}" aria-checked="${t.id === page.tint}" title="${t.name}"
        style="--tint-light:${t.light || 'var(--bg)'};--tint-dark:${t.dark || 'var(--bg)'}"><span class="tint-swatch"></span>${t.name}</button>`).join('');
    $('#font-choice').innerHTML = FONTS.map(f => `
      <button role="radio" class="font-option" data-font="${f.id}" aria-checked="${f.id === page.font}" style="font-family:${esc(f.css)}">${f.name}</button>`).join('');
  }

  // What exports use: the page's font and size, on white paper.
  function pageForExport() {
    const page = pageSettings();
    const font = FONTS.find(f => f.id === page.font) || FONTS[0];
    return { fontFamily: font.css, fontSize: +page.size, docxFont: font.docx };
  }

  function closeAppearance() {
    appearanceModal.hidden = true;
  }

  $('#open-appearance').addEventListener('click', () => {
    closeCard();
    renderAppearance();
    appearanceModal.hidden = false;
  });
  $('#close-appearance').addEventListener('click', closeAppearance);
  appearanceModal.addEventListener('click', e => {
    if (e.target === appearanceModal) return closeAppearance();
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.appearance) setPref(APPEARANCE_KEY, btn.dataset.appearance);
    if (btn.dataset.accent) setPref(ACCENT_KEY, btn.dataset.accent);
    if (btn.dataset.appearance || btn.dataset.accent) applyAppearance();
    if (btn.dataset.paper) setPage({ paper: btn.dataset.paper });
    if (btn.dataset.tint) setPage({ tint: btn.dataset.tint });
    if (btn.dataset.font) setPage({ font: btn.dataset.font });
    if (btn.closest('#size-choice')) setPage({ size: btn.dataset.size });
    if (btn.dataset.width) setPage({ width: btn.dataset.width });
    if (btn.dataset.spell || btn.dataset.spellColour || btn.dataset.hints || btn.dataset.hintColour) {
      setUnderlines({
        ...(btn.dataset.spell && { spell: btn.dataset.spell }),
        ...(btn.dataset.spellColour && { spellColour: btn.dataset.spellColour }),
        ...(btn.dataset.hints && { hints: btn.dataset.hints }),
        ...(btn.dataset.hintColour && { hintColour: btn.dataset.hintColour }),
      });
    }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
  applyAppearance();
  applyPage();

  const SPELL_COLOURS = [['Red', '#e5352b'], ['Orange', '#e8812c'], ['Pink', '#d6458a'], ['Purple', '#8a52d6']];
  const HINT_COLOURS = [['Blue', '#2f73d9'], ['Teal', '#13958d'], ['Green', '#2f9e5b'], ['Purple', '#8a52d6'], ['Gold', '#c99a06']];

  function setUnderlines(change) {
    try { localStorage.setItem(UNDERLINE_KEY, JSON.stringify({ ...underlineSettings(), ...change })); } catch { /* this visit only */ }
    applyUnderlines();
    scanSpelling();
  }

  function applyUnderlines() {
    const u = underlineSettings();
    root.style.setProperty('--spell-underline', u.spellColour);
    root.style.setProperty('--hint-underline', u.hintColour);
    document.querySelectorAll('#spell-choice [data-spell]').forEach(b => b.setAttribute('aria-checked', b.dataset.spell === u.spell));
    document.querySelectorAll('#hint-choice [data-hints]').forEach(b => b.setAttribute('aria-checked', b.dataset.hints === u.hints));
    const dots = (list, key, current) => list.map(([name, c]) =>
      `<button role="radio" class="colour-dot" data-${key}="${c}" aria-checked="${c === current}" title="${name}" aria-label="${name}" style="--swatch:${c}"></button>`).join('');
    $('#spell-colours').innerHTML = dots(SPELL_COLOURS, 'spell-colour', u.spellColour);
    $('#hint-colours').innerHTML = dots(HINT_COLOURS, 'hint-colour', u.hintColour);
  }
  applyUnderlines();

  /* Claude with your own API key (not needed, and hidden, on claude.ai) */

  const claudeSettings = $('#claude-settings');
  claudeSettings.hidden = Cloud.onClaude;

  function renderClaudeKey() {
    const key = Cloud.claudeKey();
    $('#claude-key-status').textContent = key
      ? `Key saved (${key.slice(0, 10)}\u2026${key.slice(-4)}). To remove it, save an empty field.`
      : 'No key saved. Phrases use Google Translate where it can, otherwise the built-in word lists.';
  }

  $('#claude-key-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#claude-key-input');
    const key = input.value.trim();
    if (key && !key.startsWith('sk-ant-')) {
      $('#claude-key-status').textContent = 'That doesn\u2019t look like an Anthropic API key (they start with \u201Csk-ant-\u201D).';
      return;
    }
    Cloud.setClaudeKey(key);
    input.value = '';
    renderClaudeKey();
    flash(key ? 'Claude key saved on this device' : 'Claude key removed');
  });
  renderClaudeKey();

  /* ---------- Text colour and highlight ---------- */

  const TEXT_COLOURS = [
    ['Default', null], ['Red', '#e0453a'], ['Orange', '#e8812c'], ['Gold', '#c99a06'], ['Green', '#2f9e5b'],
    ['Teal', '#13958d'], ['Blue', '#2f73d9'], ['Purple', '#8a52d6'], ['Pink', '#d6458a'], ['Grey', '#8a8f98'],
  ];
  const HIGHLIGHTS = [
    ['None', null], ['Yellow', 'rgba(255, 214, 10, 0.42)'], ['Green', 'rgba(52, 199, 89, 0.32)'],
    ['Blue', 'rgba(10, 132, 255, 0.26)'], ['Pink', 'rgba(255, 55, 140, 0.26)'], ['Purple', 'rgba(175, 82, 222, 0.3)'],
  ];
  // "Default" is applied as a marker colour and then removed, so the text
  // goes back to following the theme (dark text in light mode, light in dark).
  const MARKER = { color: 'rgb(1, 2, 3)', background: 'rgb(1, 2, 4)' };
  const colourMenu = $('#colour-menu');
  const colourButton = $('#text-colour');
  let colourRange = null;

  colourMenu.innerHTML =
    '<p class="menu-label">Text colour</p><div class="colour-row">' +
    TEXT_COLOURS.map(([name, c]) => `<button class="colour-swatch${c ? '' : ' default'}" data-text-colour="${c || ''}" title="${name}" aria-label="${name}" style="--swatch:${c || 'var(--text)'}">A</button>`).join('') +
    '</div><p class="menu-label">Highlight</p><div class="colour-row">' +
    HIGHLIGHTS.map(([name, c]) => `<button class="colour-swatch highlight${c ? '' : ' default'}" data-highlight="${c || ''}" title="${name}" aria-label="${name} highlight" style="--swatch:${c || 'transparent'}">ab</button>`).join('') +
    '</div>';

  colourButton.addEventListener('mousedown', e => e.preventDefault());
  colourButton.addEventListener('click', () => {
    if (!colourMenu.hidden) return (colourMenu.hidden = true);
    const sel = getSelection();
    colourRange = sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    closeCard();
    colourMenu.hidden = false;
    const r = colourButton.getBoundingClientRect();
    colourMenu.style.top = r.bottom + 6 + 'px';
    colourMenu.style.left = Math.max(12, Math.min(r.left - 10, window.innerWidth - colourMenu.offsetWidth - 12)) + 'px';
  });
  colourMenu.addEventListener('mousedown', e => e.preventDefault());
  colourMenu.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    editor.focus();
    const sel = getSelection();
    if (colourRange) {
      sel.removeAllRanges();
      sel.addRange(colourRange);
    }
    document.execCommand('styleWithCSS', false, true);
    if (btn.dataset.textColour !== undefined) {
      const c = btn.dataset.textColour;
      document.execCommand('foreColor', false, c || MARKER.color);
      colourButton.style.setProperty('--last-colour', c || 'var(--text)');
    } else {
      const c = btn.dataset.highlight;
      document.execCommand('hiliteColor', false, c || MARKER.background);
    }
    clearColourMarkers();
    colourMenu.hidden = true;
    saveCurrent();
  });
  document.addEventListener('mousedown', e => {
    if (!colourMenu.hidden && !colourMenu.contains(e.target) && !colourButton.contains(e.target)) colourMenu.hidden = true;
  });

  function clearColourMarkers() {
    for (const el of editor.querySelectorAll('[style], font[color]')) {
      if (el.style.color === MARKER.color) el.style.removeProperty('color');
      if (el.style.backgroundColor === MARKER.background) el.style.removeProperty('background-color');
      if (el.tagName === 'FONT' && /^#010203$/i.test(el.getAttribute('color') || '')) el.removeAttribute('color');
      if (!el.getAttribute('style')) el.removeAttribute('style');
      if (/^(SPAN|FONT)$/.test(el.tagName) && !el.attributes.length) el.replaceWith(...el.childNodes);
    }
  }

  /* ---------- Pictures and recordings ---------- */

  Blocks.init({ editor, scroller: editorScroll, onChange: () => saveCurrent(), flash: m => flash(m) });
  for (const [id, action] of [['#insert-image', () => Blocks.pickImages()], ['#record-audio', () => Blocks.startRecording()]]) {
    const btn = $(id);
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      closeCard();
      action();
    });
  }

  /* ---------- Sharing: PDF, Word, text, Markdown, web page, backup ---------- */

  const shareModal = $('#share-modal');
  const shareReady = $('#share-ready');
  const FORMAT_LABELS = { pdf: 'PDF', docx: 'Word document', txt: 'text file', md: 'Markdown file', html: 'web page', backup: 'backup' };
  let preparedFile = null;
  let shareToken = 0;

  function closeShare() {
    shareModal.hidden = true;
    shareToken++;
  }

  $('#share-note').addEventListener('click', () => {
    saveCurrent();
    closeCard();
    preparedFile = null;
    shareReady.hidden = true;
    shareModal.querySelectorAll('[data-format]').forEach(b => b.classList.remove('chosen'));
    shareModal.hidden = false;
  });
  $('#close-share').addEventListener('click', closeShare);

  async function prepareFile(format, btn) {
    const token = ++shareToken;
    shareModal.querySelectorAll('[data-format]').forEach(b => b.classList.toggle('chosen', b === btn));
    shareReady.hidden = false;
    shareReady.innerHTML = `<p class="share-status">Preparing the ${FORMAT_LABELS[format]}\u2026</p>`;
    try {
      const file = format === 'backup'
        ? await Exporter.backup({ notes: notes.filter(n => !isBlank(n)), groups, dictionary: SpellCheck.list() })
        : await Exporter.make(current(), format, pageForExport());
      if (token !== shareToken) return;
      preparedFile = file;
      const size = file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : (file.size / 1048576).toFixed(1) + ' MB';
      const canShare = Exporter.canShareFiles(file);
      shareReady.innerHTML = `
        <div class="ready-file"><span class="ext">${esc(file.name.split('.').pop().toUpperCase())}</span>
          <span class="ready-name">${esc(file.name)}</span><span class="ready-size">${size}</span></div>
        <div class="ready-actions">
          ${canShare ? '<button class="action" data-deliver="share">Share\u2026</button>' : ''}
          <button class="action${canShare ? ' subtle' : ''}" data-deliver="save">${canShare ? 'Download' : 'Save'}</button>
        </div>`;
    } catch (err) {
      if (token !== shareToken) return;
      shareReady.innerHTML = '<p class="share-status">Couldn\u2019t make that file. Try again, or pick another format.</p>';
    }
  }

  shareModal.addEventListener('click', async e => {
    if (e.target === shareModal) return closeShare();
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.format) return prepareFile(btn.dataset.format, btn);
    if (btn.dataset.deliver && preparedFile) {
      try {
        const result = btn.dataset.deliver === 'share' ? await Exporter.share(preparedFile) : await Exporter.save(preparedFile);
        if (result === 'saved') flash(`Saved \u201C${preparedFile.name}\u201D`);
        if (result !== 'cancelled') closeShare();
      } catch {
        flash('Couldn\u2019t share that file from here. Try Download instead.');
      }
    }
  });

  $('#restore-backup').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = await Exporter.readBackup(file);
        notes = notes.filter(n => !isPristineWelcome(n));
        let added = 0;
        for (const n of data.notes) {
          const i = notes.findIndex(x => x.id === n.id);
          if (i < 0) { notes.push(n); added++; } else if (n.updated > notes[i].updated) notes[i] = n;
          Cloud.saveNote(n);
        }
        const known = new Set(groups.map(g => g.id));
        groups = [...groups, ...(data.groups || []).filter(g => !known.has(g.id))];
        persistGroups();
        SpellCheck.merge(data.dictionary || []);
        persist();
        renderList();
        closeShare();
        flash(`Restored ${data.notes.length} note${data.notes.length === 1 ? '' : 's'} (${added} new)`);
      } catch {
        flash('That file isn\u2019t an Inkwell backup.');
      }
    });
    input.click();
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
    <div>Switch the card to <b>Norse</b>, <b>Latin</b>, <b>Greek</b> or <b>Argot</b> to swap a word for the tongue of the sagas, of Rome, of Homer or of the old Paris thieves: the warrior raised his sword against the wolf.</div>
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
  Cloud.pauseNotes(!!Sync.config());   // GitHub sync, when on, is the one place notes sync
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
    } else if (document.activeElement !== editor && Media.serialize(editor) !== note.html) {
      editor.innerHTML = note.html;
      Media.hydrate(editor);
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

  Cloud.loadGroups().then(remote => {
    if (!remote) {
      if (groups.length) Cloud.saveGroups(groups);
      return;
    }
    const ids = new Set(remote.map(g => g.id));
    const merged = [...remote, ...groups.filter(g => !ids.has(g.id))];
    if (merged.length !== remote.length) Cloud.saveGroups(merged);
    groups = merged;
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); } catch { /* kept in memory */ }
    renderList();
  }).catch(() => { /* groups on this device still work */ });

  /* ---------- Cloud sync with your other devices (GitHub) ---------- */

  const syncModal = $('#sync-modal');
  const syncBody = $('#sync-body');

  const deviceName = () =>
    /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
      : /iPhone/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'computer';

  function syncedAt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function renderSyncLine(status = Sync.status()) {
    const line = $('#sync-line');
    line.textContent = status.state === 'off' ? (Cloud.onClaude ? 'claude.ai account' : 'Off')
        : status.state === 'syncing' ? 'Syncing\u2026'
          : status.state === 'error' ? 'Needs attention'
            : status.last ? 'Synced ' + syncedAt(status.last) : 'On';
    line.classList.toggle('error', status.state === 'error');
  }

  function renderSync() {
    const status = Sync.status();
    const cfg = Sync.config();
    if (Cloud.onClaude && !cfg) {
      // On claude.ai the page reaches GitHub through the viewer's GitHub connector.
      syncBody.innerHTML = `
        <p class="modal-hint">Right now notes on this page are saved to your claude.ai account. To share them with the Inkwell app on your iPad and phone, connect this page to the same private GitHub repository the app uses (normally <b>inkwell-notes</b>).</p>
        <ol class="sync-steps">
          <li>Make sure GitHub is connected in claude.ai: Settings \u203A Connectors \u203A GitHub.</li>
          <li>Set up Cloud sync in the app first, so the repository exists.</li>
          <li>Connect below. claude.ai will ask you to allow this page to use your GitHub connector.</li>
        </ol>
        <form class="sync-form" id="sync-form" data-mode="connector">
          <input id="sync-repo" type="text" value="inkwell-notes" autocomplete="off" spellcheck="false" aria-label="Repository name">
          <input id="sync-branch" type="text" value="main" autocomplete="off" spellcheck="false" aria-label="Branch">
          <button type="submit" class="primary-btn">Connect with my GitHub connector</button>
        </form>
        <p class="sync-message" id="sync-message">${status.state === 'error' ? esc(status.message) : ''}</p>
        <p class="modal-hint">Your notes here and in the app are combined; nothing is lost. From then on this page syncs through GitHub instead of your claude.ai account.</p>`;
      return;
    }
    if (!cfg) {
      syncBody.innerHTML = `
        <p class="modal-hint">Keep this device and your phone in step through a private GitHub repository that only you can see. Notes, groups, your word list, pictures and recordings all sync.</p>
        <ol class="sync-steps">
          <li><a href="https://github.com/new?name=inkwell-notes&visibility=private" target="_blank" rel="noopener">Create a private repository</a> named <b>inkwell-notes</b>.</li>
          <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create an access key</a> (a fine-grained token): under <i>Repository access</i> pick <b>Only select repositories</b> \u203A inkwell-notes; under <i>Permissions</i> set <b>Contents</b> to <b>Read and write</b>. Pick a long expiry.</li>
          <li>Paste the key here. Do the same on your phone with the same key.</li>
        </ol>
        <form class="sync-form" id="sync-form">
          <input id="sync-token" type="password" placeholder="Access key (github_pat_\u2026)" autocomplete="off" spellcheck="false" aria-label="GitHub access key">
          <input id="sync-repo" type="text" value="inkwell-notes" autocomplete="off" spellcheck="false" aria-label="Repository name">
          <button type="submit" class="primary-btn">Connect</button>
        </form>
        <p class="sync-message" id="sync-message">${status.state === 'error' ? esc(status.message) : ''}</p>
        <p class="modal-hint">The key is stored only on this device and is only sent to GitHub.</p>`;
      return;
    }
    syncBody.innerHTML = `
      <div class="sync-summary">
        <p><b>${esc(cfg.owner)}/${esc(cfg.repo)}</b>${cfg.mode === 'connector' ? ' \u00B7 through your GitHub connector' : ''}</p>
        <p class="sync-message${status.state === 'error' ? ' error' : ''}">${
          status.state === 'syncing' ? 'Syncing\u2026'
            : status.state === 'error' ? esc(status.message)
              : status.last ? 'Last synced ' + syncedAt(status.last) : 'Not synced yet'}</p>
      </div>
      <p class="modal-hint">Changes sync a few seconds after you stop typing, when you come back to the app, and every two minutes while it's open. If a note was changed on both devices before they could sync, both versions are kept; the other one appears as a \u201CConflicted copy\u201D.</p>
      <div class="backup-row">
        <button class="action" data-sync="now">Sync now</button>
        <button class="action subtle danger" data-sync="disconnect">Turn off on this device</button>
      </div>`;
  }

  Sync.onStatus(status => {
    renderSyncLine(status);
    if (!syncModal.hidden && !syncBody.querySelector('#sync-token:focus')) renderSync();
  });

  $('#open-sync').addEventListener('click', () => {
    closeCard();
    renderSync();
    syncModal.hidden = false;
  });
  $('#close-sync').addEventListener('click', () => { syncModal.hidden = true; });
  syncModal.addEventListener('click', async e => {
    if (e.target === syncModal) return (syncModal.hidden = true);
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.sync === 'now') return Sync.syncNow();
    if (btn.dataset.sync === 'disconnect') {
      if (!confirmByTapping(btn, 'Tap again to stop syncing on this device. Your notes stay here and on GitHub.')) return;
      Sync.disconnect();
      Cloud.pauseNotes(false);
      renderSync();
    }
  });
  syncModal.addEventListener('submit', async e => {
    e.preventDefault();
    const repo = $('#sync-repo').value.trim() || 'inkwell-notes';
    const message = $('#sync-message');
    const viaConnector = e.target.dataset.mode === 'connector';
    const token = viaConnector ? '' : $('#sync-token').value.trim();
    if (!viaConnector && !token) return (message.textContent = 'Paste the access key first.');
    message.textContent = 'Connecting\u2026';
    try {
      if (viaConnector) await Sync.connectConnector(repo, $('#sync-branch').value.trim() || 'main');
      else await Sync.connect(token, repo);
      Cloud.pauseNotes(true);
      renderSync();
      await Sync.syncNow();
      flash('Cloud sync is on');
    } catch (err) {
      message.textContent = {
        bad_token: 'GitHub didn\u2019t accept that key. Check you copied all of it.',
        offline: 'No connection. Try again when you\u2019re online.',
      }[err.code] || Sync.message(err.code) || err.message;
    }
  });

  Sync.init({
    getNotes: () => notes.slice(),
    getGroups: () => groups.slice(),
    getWords: () => SpellCheck.list(),
    isPristine: n => isPristineWelcome(n),
    deviceName,
    conflictCopy: note => ({
      ...note,
      id: newNoteId(),
      html: '<div>Conflicted copy</div>' + note.html,
      text: 'Conflicted copy\n' + note.text,
      updated: Date.now(),
    }),
    apply({ notes: next, groups: nextGroups, words, changed }) {
      notes = next;
      groups = nextGroups;
      persist({ sync: false });
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); } catch { /* kept in memory */ }
      const have = new Set(SpellCheck.list().map(w => w.toLowerCase()));
      const newWords = words.filter(w => !have.has(w.toLowerCase()));
      if (newWords.length) SpellCheck.merge(newWords);
      const note = current();
      if (note && changed.has(note.id) && document.activeElement === editor) {
        // You're typing in a note the other device also changed: keep its version
        // as a copy, and keep what you're writing as the note itself.
        notes.push({ ...note, id: newNoteId(), html: '<div>Conflicted copy</div>' + note.html, text: 'Conflicted copy\n' + note.text });
        saveCurrent();
      } else if (!note) {
        const first = [...notes].sort((a, b) => b.updated - a.updated)[0];
        const showing = app.classList.contains('show-editor');
        if (first) openNote(first.id);
        if (!showing) app.classList.remove('show-editor');
      } else if (changed.has(note.id) && document.activeElement !== editor) {
        editor.innerHTML = note.html;
        Media.hydrate(editor);
        renderDate(note);
        scanSpelling();
      }
      renderList();
    },
  });
  renderSyncLine();

  Cloud.onError(err => {
    if (err && err.code === 'invalid_argument') flash('This note is too big to save to your account. It\u2019s still saved on this device.');
    else if (err && err.code === 'quota_exceeded') flash('Your account storage for this app is full. Delete some notes to make room.');
    else flash('Couldn\u2019t save to your account just now. It\u2019s still saved on this device.');
  });

  // Installed on the home screen (or served from a website): work offline.
  // Not on claude.ai or from a file, where service workers aren't available.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.self === window.top) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* online-only is fine */ });
  }

  // Parse the dictionary after the first paint so the app appears instantly.
  setTimeout(() => {
    SpellCheck.init();
    SpellCheck.addKnown(Lexicon.words());   // Lingala, Latin … words aren't spelling mistakes
    scanSpelling();
    if (supportsHighlights) status.classList.remove('visible');
  }, 30);
})();
