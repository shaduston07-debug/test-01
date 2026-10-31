/*
 * Translating a whole selected phrase ("I said it" → Lingala "Nalobaki yango"),
 * not word by word. Sources, best first:
 *   1. Claude (on claude.ai, or with your own API key in the app's settings);
 *   2. Google Translate's free endpoint, for the languages it knows;
 *   3. the built-in word lists, word by word (clearly marked as rough).
 */
const Phrase = (() => {
  const TARGETS = [
    { id: 'norse', name: 'Old Norse', google: null,
      claude: 'Old Norse, in standard normalized spelling (with ð, þ, ǫ, æ, ø and accents), as in the sagas' },
    { id: 'latin', name: 'Latin', google: 'la',
      claude: 'Classical Latin, with macrons on long vowels' },
    { id: 'greek', name: 'Ancient Greek', google: null,
      claude: 'Ancient Greek (Attic, or Homeric where it suits), in polytonic Greek script with accents and breathings' },
    { id: 'argot', name: 'Argot', google: null,
      claude: 'French thieves’ argot ("la langue des voleurs"), the way the old Paris underworld would say it, using real argot words' },
    { id: 'lingala', name: 'Lingala', google: 'ln',
      claude: 'Lingala as spoken in Kinshasa, in standard spelling with ɛ and ɔ where they belong (no tone marks)' },
    { id: 'tshiluba', name: 'Tshiluba', google: 'lua',
      claude: 'Tshiluba (Ciluba, Luba-Kasai) as spoken in Kananga and Mbuji-Mayi, in standard spelling' },
    { id: 'english', name: 'English', google: 'en', claude: 'natural English' },
    { id: 'french', name: 'French', google: 'fr', claude: 'natural French' },
  ];
  const cache = new Map();

  const target = id => TARGETS.find(t => t.id === id);

  // Resolves { source, options: [{ text, note }], rough }.
  function translate(text, id) {
    const key = id + '\u0000' + text;
    if (!cache.has(key)) {
      const request = run(text, target(id)).then(result => {
        if (result.rough) cache.delete(key);   // try a real translator again next time
        return result;
      }, err => {
        cache.delete(key);
        throw err;
      });
      cache.set(key, request);
    }
    return cache.get(key);
  }

  async function run(text, t) {
    const claude = await Cloud.sample();
    if (claude) {
      return { source: 'Claude', options: await viaClaude(claude, text, t), rough: false };
    }
    if (t.google) {
      try {
        return { source: 'Google Translate', options: [{ text: await viaGoogle(text, t.google), note: '' }], rough: false };
      } catch { /* offline or blocked: fall back to the word lists */ }
    }
    if (Lexicon.get(t.id)) {
      return { source: 'built-in word lists', options: [{ text: wordByWord(text, t.id), note: '' }], rough: true };
    }
    throw new Error('No translator reachable');
  }

  async function viaClaude(claude, text, t) {
    const reply = await claude.json(
      `Translate the text below into ${t.claude}.
The text may be in English, French, Lingala or another language; work out which.
Keep the meaning, tense, person and tone exactly, and translate the whole phrase as one piece, not word by word.
Give the most natural translation first, then up to two alternatives (for example more formal, more poetic, or more colloquial) only if they are genuinely different.
Reply with JSON only: {"translations": [{"text": "the translation", "note": "a few words in English on how it differs or what it literally says, or empty"}]}

Text:
"""${text}"""`,
      { modelTier: 'default' });
    const list = (reply && Array.isArray(reply.translations) ? reply.translations : [])
      .filter(o => o && typeof o.text === 'string' && o.text.trim())
      .map(o => ({ text: o.text.trim(), note: typeof o.note === 'string' ? o.note.trim() : '' }));
    if (!list.length) throw new Error('No translation returned');
    return list.slice(0, 3);
  }

  async function viaGoogle(text, code) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + code +
      '&q=' + encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Translate returned ' + res.status);
    const data = await res.json();
    const out = (data && data[0] || []).map(part => part && part[0] || '').join('').trim();
    if (!out) throw new Error('Empty translation');
    return out;
  }

  // Each word the lists know is swapped; the rest stay as they are.
  function wordByWord(text, id) {
    return text.replace(/\p{L}+(?:['’]\p{L}+)*/gu, word => {
      const hit = Lexicon.translate(id, word)[0];
      if (!hit) return word;
      return word[0] !== word[0].toLowerCase() ? hit.word[0].toUpperCase() + hit.word.slice(1) : hit.word;
    });
  }

  // A newly saved (or removed) Claude key changes which translator answers.
  window.addEventListener('inkwell:claude-changed', () => cache.clear());

  return { TARGETS, translate };
})();
