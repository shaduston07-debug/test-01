/*
 * Spell checking backed by Typo.js (Hunspell en_US dictionary) plus a
 * personal dictionary stored in localStorage.
 */
const SpellCheck = (() => {
  const PERSONAL_KEY = 'inkwell.personalDictionary';

  // The bundled Hunspell list predates smartphones; teach it some everyday modern words.
  const MODERN_WORDS = new Set(`
    app apps blog blogs blogger blogging bookmark bookmarked bookmarking chatbot cyberspace dashboard
    download downloaded downloading downloads email emailed emailing emails emoji emojis favorited
    google googled hashtag hashtags homepage hotspot inbox internet laptop laptops livestream login
    logins logout meme memes multitasking offline online passcode podcast podcasts screenshot
    screenshots selfie selfies smartphone smartphones smartwatch spreadsheet startup startups
    streaming subreddit tablet texting timeline toolbar touchscreen trackpad tweet tweeted tweets unfollow unfriend
    upload uploaded uploading uploads username usernames vlog webcam webinar website websites wifi
    wiki workflow youtube
  `.trim().split(/\s+/));

  let typo = null;
  const checkCache = new Map();
  const suggestCache = new Map();
  const ignored = new Set();          // "Ignore" for this session only
  const known = new Set();            // words from the translation lists (Lingala, Latin …)
  let personal = loadPersonal();      // Map<lowercase, word as typed>
  const listeners = new Set();

  function loadPersonal() {
    try {
      const words = JSON.parse(localStorage.getItem(PERSONAL_KEY)) || [];
      return new Map(words.map(w => [w.toLowerCase(), w]));
    } catch {
      return new Map();
    }
  }

  function savePersonal() {
    try {
      localStorage.setItem(PERSONAL_KEY, JSON.stringify(list()));
    } catch { /* storage full or blocked: keep the in-memory copy */ }
    listeners.forEach(fn => fn());
  }

  function init() {
    typo = new Typo('en_US', window.EN_US_AFF, window.EN_US_DIC);
    // The raw dictionary text is no longer needed once parsed.
    window.EN_US_AFF = window.EN_US_DIC = null;
  }

  const normalize = word => word.replace(/[‘’]/g, "'").replace(/^'+|'+$/g, '');

  // Things we don't spell check: single letters, anything with digits,
  // and short ALL-CAPS words (usually acronyms).
  function shouldSkip(word) {
    return word.length < 2 || /\d/.test(word) || (word.length <= 6 && word === word.toUpperCase());
  }

  function isCorrect(raw) {
    if (!typo) return true;
    const word = normalize(raw);
    if (shouldSkip(word)) return true;
    const lower = word.toLowerCase();
    if (personal.has(lower) || ignored.has(lower) || MODERN_WORDS.has(lower) || known.has(lower)) return true;
    if (!checkCache.has(word)) {
      // Typo.js doesn't know possessives of every word, so accept "word's" if "word" is fine.
      const ok = typo.check(word) || (/'s$/i.test(word) && typo.check(word.slice(0, -2)));
      checkCache.set(word, ok);
    }
    return checkCache.get(word);
  }

  // A word the reader means as-is: English, or one they added or ignored
  // (unlike isCorrect, words from the translation lists don't count).
  function isOwnWord(raw) {
    if (!typo) return true;
    const word = normalize(raw);
    if (shouldSkip(word)) return true;
    const lower = word.toLowerCase();
    if (personal.has(lower) || ignored.has(lower) || MODERN_WORDS.has(lower)) return true;
    return typo.check(word) || (/'s$/i.test(word) && typo.check(word.slice(0, -2)));
  }

  function suggest(raw, limit = 6) {
    const word = normalize(raw);
    if (!typo) return [];
    if (!suggestCache.has(word)) {
      const lower = word.toLowerCase();
      const candidates = [
        ...[...personal.values()].filter(p => editDistance(p.toLowerCase(), lower) <= 2),
        ...[...MODERN_WORDS].filter(m => editDistance(m, lower) <= 1),
        ...typo.suggest(word, limit + 4).filter(w => !/\d/.test(w)),   // not "v03rdr"
      ];
      // Collapse case variants ("Dispelled"/"dispelled"), preferring the plain form,
      // then rank the closest matches first (ties keep Typo's own order).
      const byKey = new Map();
      for (const c of candidates) {
        const key = c.toLowerCase();
        if (!byKey.has(key) || c === key) byKey.set(key, c);
      }
      // Closest first; then same first letter; names ("Asa") after ordinary words when you typed lowercase.
      const typedLower = word === lower;
      const rank = s => editDistance(s.toLowerCase(), lower) * 4 + (s[0].toLowerCase() === lower[0] ? 0 : 1) +
        (typedLower && s !== s.toLowerCase() ? 2 : 0);
      const ranked = [...byKey.values()]
        .map((s, i) => ({ s, i, r: rank(s) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => matchCase(word, x.s));
      suggestCache.set(word, ranked.slice(0, limit));
    }
    return suggestCache.get(word);
  }

  // Keep "Teh" -> "The" and "TEH" -> "THE".
  function matchCase(original, suggestion) {
    if (original.length > 1 && original === original.toUpperCase()) return suggestion.toUpperCase();
    if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
      return suggestion[0].toUpperCase() + suggestion.slice(1);
    }
    return suggestion;
  }

  // Edit distance where swapping two neighbouring letters ("wsa" → "was") costs 1.
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 4;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }


  function addPersonal(raw) {
    const word = normalize(raw.trim());
    if (!word) return false;
    personal.set(word.toLowerCase(), word);
    suggestCache.clear();
    savePersonal();
    return true;
  }

  // Add words saved elsewhere (another device) in one go.
  function merge(words) {
    let added = false;
    for (const w of words) {
      const word = normalize(String(w).trim());
      if (word && !personal.has(word.toLowerCase())) {
        personal.set(word.toLowerCase(), word);
        added = true;
      }
    }
    suggestCache.clear();
    if (added) savePersonal();
    else listeners.forEach(fn => fn());
  }

  function removePersonal(word) {
    personal.delete(word.toLowerCase());
    suggestCache.clear();
    savePersonal();
  }

  // Words of other languages that should never be flagged.
  function addKnown(words) {
    for (const w of words) known.add(normalize(w).toLowerCase());
    checkCache.clear();
  }

  function ignore(raw) {
    ignored.add(normalize(raw).toLowerCase());
    listeners.forEach(fn => fn());
  }

  function list() {
    return [...personal.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  return {
    init,
    get ready() { return !!typo; },
    isCorrect,
    isOwnWord,
    suggest,
    addPersonal,
    merge,
    addKnown,
    removePersonal,
    ignore,
    list,
    onChange: fn => listeners.add(fn),
  };
})();
