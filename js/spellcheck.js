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
    streaming subreddit tablet texting timeline touchscreen tweet tweeted tweets unfollow unfriend
    upload uploaded uploading uploads username usernames vlog webcam webinar website websites wifi
    wiki workflow youtube
  `.trim().split(/\s+/));

  let typo = null;
  const checkCache = new Map();
  const suggestCache = new Map();
  const ignored = new Set();          // "Ignore" for this session only
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
    if (personal.has(lower) || ignored.has(lower) || MODERN_WORDS.has(lower)) return true;
    if (!checkCache.has(word)) {
      // Typo.js doesn't know possessives of every word, so accept "word's" if "word" is fine.
      const ok = typo.check(word) || (/'s$/i.test(word) && typo.check(word.slice(0, -2)));
      checkCache.set(word, ok);
    }
    return checkCache.get(word);
  }

  function suggest(raw, limit = 6) {
    const word = normalize(raw);
    if (!typo) return [];
    if (!suggestCache.has(word)) {
      const lower = word.toLowerCase();
      const candidates = [
        ...[...personal.values()].filter(p => editDistance(p.toLowerCase(), lower) <= 2),
        ...[...MODERN_WORDS].filter(m => editDistance(m, lower) <= 1),
        ...typo.suggest(word, limit + 4),
      ];
      // Collapse case variants ("Dispelled"/"dispelled"), preferring the plain form,
      // then rank the closest matches first (ties keep Typo's own order).
      const byKey = new Map();
      for (const c of candidates) {
        const key = c.toLowerCase();
        if (!byKey.has(key) || c === key) byKey.set(key, c);
      }
      const rank = s => editDistance(s.toLowerCase(), lower) * 2 + (s[0].toLowerCase() === lower[0] ? 0 : 1);
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

  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 4;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[b.length];
  }

  function addPersonal(raw) {
    const word = normalize(raw.trim());
    if (!word) return false;
    personal.set(word.toLowerCase(), word);
    suggestCache.clear();
    savePersonal();
    return true;
  }

  function removePersonal(word) {
    personal.delete(word.toLowerCase());
    suggestCache.clear();
    savePersonal();
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
    suggest,
    addPersonal,
    removePersonal,
    ignore,
    list,
    onChange: fn => listeners.add(fn),
  };
})();
