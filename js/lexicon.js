/*
 * English → old-language translations (Old Norse, Latin, Ancient Greek,
 * French thieves' argot …). Each language registers a hand-picked glossary
 * from js/lexicons/; Wiktionary's translation tables or Claude fill the gaps.
 */
const Lexicon = (() => {
  const languages = new Map();

  /*
   * def: {
   *   name, tab,                      shown in the card
   *   glossary: { 'english[, other key]': 'word|pos|gloss|kind; …' },
   *   kinds: { kind: label },         groups, in display order
   *   kindNames: { kind: name },      how Claude is asked to label each kind
   *   letters: { plain, native, plainHint, nativeHint } | null,
   *   toPlain(word),                  the word in everyday a–z letters
   *   wiki: { label, code } | null,   Wiktionary translation-table language
   *   claude(word),                   what to ask Claude for this language
   * }
   */
  function register(id, def) {
    const lang = { id, toPlain: w => w, letters: null, wiki: null, ...def, byKey: new Map(), headwords: new Map(), cache: new Map() };
    for (const [keys, list] of Object.entries(def.glossary)) {
      const english = keys.split(',')[0].trim();
      const entries = list.split(';').map(item => {
        const [word, pos, gloss, kind = ''] = item.trim().split('|');
        return { word, pos, gloss, kind, english, lang: id };
      });
      for (const raw of keys.split(',')) {
        const key = raw.trim().toLowerCase();
        lang.byKey.set(key, [...(lang.byKey.get(key) || []), ...entries]);
      }
      for (const e of entries) {
        const folded = fold(lang, e.word);
        if (!lang.headwords.has(folded)) lang.headwords.set(folded, []);
        lang.headwords.get(folded).push(e);
      }
    }
    languages.set(id, lang);
  }

  const get = id => languages.get(id);
  const list = () => [...languages.values()];

  function plain(id, word) {
    return get(id).toPlain(word);
  }

  function fold(lang, word) {
    return lang.toPlain(word).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // warriors -> warrior, ravens -> raven, slaying -> slay …
  function lemmas(word) {
    const w = word.toLowerCase().replace(/[’]/g, "'").replace(/'s$/, '');
    const out = [w];
    if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ves')) out.push(w.slice(0, -3) + 'f');
    if (w.endsWith('es')) out.push(w.slice(0, -2));
    if (w.endsWith('s')) out.push(w.slice(0, -1));
    if (w.endsWith('ed')) out.push(w.slice(0, -2), w.slice(0, -1));
    if (w.endsWith('ing')) out.push(w.slice(0, -3), w.slice(0, -3) + 'e');
    if (/(.)\1(ed|ing)$/.test(w)) out.push(w.replace(/(.)\1(ed|ing)$/, '$1'));
    if (w.endsWith('men')) out.push(w.slice(0, -3) + 'man');
    return out;
  }

  // Glossary translations for an English (or, for argot, French) word.
  function translate(id, word) {
    const lang = get(id);
    for (const lemma of lemmas(word)) {
      if (lang.byKey.has(lemma)) return lang.byKey.get(lemma);
    }
    return [];
  }

  // Words in this language that look like what was typed ("voror" → vǫrðr).
  function similar(id, word) {
    const lang = get(id);
    const typed = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (typed.length < 3) return [];
    const limit = typed.length <= 4 ? 1 : 2;
    const scored = [];
    for (const [key, entries] of lang.headwords) {
      if (key.includes(' ')) continue;
      const d = editDistance(typed, key);
      if (d <= limit && d < key.length) scored.push({ d, entries });
    }
    // One row per word, with its meanings combined (vǫrðr: warden, watchman …).
    const merged = new Map();
    for (const e of scored.sort((a, b) => a.d - b.d).flatMap(s => s.entries)) {
      const seen = merged.get(e.word);
      if (!seen) merged.set(e.word, { ...e });
      else seen.gloss = [...new Set([...seen.gloss.split(', '), ...e.gloss.split(', ')])].join(', ');
    }
    return [...merged.values()].slice(0, 4);
  }

  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
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

  /* ---------- More translations: Wiktionary, else Claude ---------- */

  const WIKI = 'https://en.wiktionary.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&origin=*&page=';
  const pages = new Map();

  function wikitext(page) {
    if (!pages.has(page)) {
      pages.set(page, fetch(WIKI + encodeURIComponent(page)).then(async res => {
        if (!res.ok) throw new Error(`Wiktionary returned ${res.status}`);
        const json = await res.json();
        return (json.parse && json.parse.wikitext && json.parse.wikitext['*']) || '';
      }).catch(err => {
        pages.delete(page);
        throw err;
      }));
    }
    return pages.get(page);
  }

  // Pull one language's entries out of Wiktionary's translation tables.
  function parseTranslations(text, wiki) {
    const found = [];
    let gloss = '';
    const line = new RegExp(`${wiki.label}:(.*)$`);
    const template = new RegExp(`\\{\\{tt?\\+?\\|${wiki.code}\\|([^|}]+)((?:\\|[^}]*)?)\\}\\}`, 'g');
    for (const row of text.split('\n')) {
      const top = row.match(/\{\{trans-top\|([^}|]*)/);
      if (top) gloss = top[1].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim();
      const hit = row.match(line);
      if (!hit) continue;
      for (const t of hit[1].matchAll(template)) {
        const gender = (t[2].match(/\|(m|f|n)(?:-p)?(?=\||$)/) || [])[1];
        found.push({ word: t[1].trim(), pos: gender ? gender + '.' : '', gloss, kind: '' });
      }
    }
    return found;
  }

  async function fromWiktionary(lang, key) {
    if (!lang.wiki) throw new Error('No Wiktionary source for ' + lang.name);
    const page = await wikitext(key);
    const englishSection = (page.split(/^==English==\s*$/m)[1] || '').split(/^==[^=]/m)[0];
    let results = parseTranslations(englishSection, lang.wiki);
    if (!results.length) {
      // Big entries keep their tables on a separate "/translations" page.
      try { results = parseTranslations(await wikitext(key + '/translations'), lang.wiki); } catch { /* none */ }
    }
    const seen = new Set();
    return results.filter(r => !seen.has(r.word) && seen.add(r.word));
  }

  async function fromClaude(lang, sample, word) {
    const kinds = Object.entries(lang.kindNames);
    const reply = await sample.json(`${lang.claude(word)}
Reply with JSON only: {"words": [{"word": "...", "pos": "m. | f. | n. | adj. | v. | adv. | empty", "gloss": "short English meaning", "kind": "${kinds.map(([, name]) => name).join(' | ')}"}]}
At most 8 words. If there is no good equivalent, reply {"words": []}.`, { modelTier: 'default' });
    const byName = Object.fromEntries(kinds.map(([kind, name]) => [name, kind]));
    return ((reply && reply.words) || [])
      .filter(w => w && typeof w.word === 'string' && w.word.trim())
      .map(w => ({ word: w.word.trim(), pos: w.pos || '', gloss: w.gloss || '', kind: byName[w.kind] ?? '', lang: lang.id }));
  }

  // Resolves { source, words }.
  function more(id, word) {
    const lang = get(id);
    const key = lemmas(word)[0];
    if (!lang.cache.has(key)) {
      const request = fromWiktionary(lang, key)
        .then(words => ({ source: 'Wiktionary', words: words.map(w => ({ ...w, lang: id })) }))
        .catch(async err => {
          const sample = await Cloud.sample();
          if (!sample) throw err;
          return { source: 'Claude', words: await fromClaude(lang, sample, key) };
        })
        .catch(err => {
          lang.cache.delete(key);
          throw err;
        });
      lang.cache.set(key, request);
    }
    return lang.cache.get(key);
  }

  return { register, get, list, plain, translate, similar, more };
})();
