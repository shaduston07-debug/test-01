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
      if (node.parentElement.closest(XLAT)) continue; // translated words aren't English
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
  Cloud.sample().then(s => { canAskClaude = !!s; });

  function openCard(hit, misspelled) {
    active = { ...hit, misspelled, more: {} };
    const token = ++cardToken;
    setLookupHighlight(hit.range);

    if (hit.xlat) {
      // A word that was already translated: offer the alternatives again.
      card.innerHTML = '<div class="xlat-panel"></div>';
      showCard();
      showLang(spanLang(hit.xlat), hit.xlat.dataset.original, token);
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
            `<p class="card-label">Did you mean the ${esc(g.lang.name)}</p>` +
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
      switchTab(pref(TAB_KEY, 'define'));
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

  editor.addEventListener('input', () => {
    typing = true;
    fixTranslatedSpans();
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
    const sketch = e.target.closest('.sketch');
    if (sketch) return editSketch(sketch);
    if (!SpellCheck.ready || e.detail > 1 || !getSelection().isCollapsed) return;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) return closeCard();
    const misspelled = !hit.xlat && !SpellCheck.isCorrect(hit.word);
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
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      setSidebarHidden(!app.classList.contains('sidebar-hidden'));
    }
  });
  editorScroll.addEventListener('scroll', () => {
    closeCard();
    hideMath();
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
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
  applyAppearance();

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
    scanSpelling();
    if (supportsHighlights) status.classList.remove('visible');
  }, 30);
})();
