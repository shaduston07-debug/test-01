/*
 * Word definitions from the Free Dictionary API (https://dictionaryapi.dev),
 * rendered as an old-fashioned, book-like dictionary entry.
 */
const Definitions = (() => {
  const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const MAX_SENSES = 4;
  const cache = new Map();

  // Resolves to an entry object, or null when the word isn't in the dictionary.
  // Rejects when no source can be reached.
  function lookup(word) {
    const key = word.toLowerCase().replace(/[\u2018\u2019]/g, "'");
    if (!cache.has(key)) {
      const request = fromApi(key)
        .catch(() => undefined) // unreachable: try Claude instead
        .then(async entry => {
          if (entry) return entry;
          const sample = await Cloud.sample();
          if (sample) return fromClaude(sample, key);
          if (entry === null) return null;
          throw new Error('No dictionary reachable');
        })
        .catch(err => {
          cache.delete(key); // allow a retry later
          throw err;
        });
      cache.set(key, request);
    }
    return cache.get(key);
  }

  function fromApi(key) {
    return fetch(API + encodeURIComponent(key)).then(res => {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Dictionary returned ${res.status}`);
      return res.json().then(toEntry);
    });
  }

  // Inside claude.ai the page can't reach dictionaryapi.dev, so Claude writes the entry.
  async function fromClaude(sample, word) {
    const reply = await sample.json(
      `Write a dictionary entry for the English word "${word}", as a classic printed dictionary would.
Reply with JSON only, in this shape:
{"word": "${word}", "phonetic": "IPA between slashes, or empty", "origin": "one-sentence etymology, or empty",
 "meanings": [{"pos": "noun | verb | adjective | adverb | ...", "senses": [{"text": "definition", "example": "short example sentence, or empty"}], "synonyms": ["up to 6"], "antonyms": ["up to 4"]}]}
Give at most 4 senses per part of speech. If "${word}" is not an English word, reply {"word": "${word}", "meanings": []}.`,
      { modelTier: 'quick' });
    if (!reply || !Array.isArray(reply.meanings) || !reply.meanings.length) return null;
    return {
      word: reply.word || word,
      phonetic: reply.phonetic || '',
      audio: '',
      origin: reply.origin || '',
      meanings: reply.meanings.map(m => ({
        pos: m.pos || '',
        senses: (m.senses || []).slice(0, MAX_SENSES).map(x => ({ text: x.text, example: x.example })),
        more: 0,
        synonyms: (m.synonyms || []).slice(0, 6),
        antonyms: (m.antonyms || []).slice(0, 4),
      })),
      source: '',
      by: 'Written by Claude',
    };
  }

  // Merge the API's (often several) results into one tidy entry.
  function toEntry(results) {
    const first = results[0];
    const phonetics = results.flatMap(r => r.phonetics || []);
    const meanings = new Map();

    for (const result of results) {
      for (const m of result.meanings || []) {
        const pos = m.partOfSpeech || '';
        if (!meanings.has(pos)) meanings.set(pos, { pos, senses: [], synonyms: new Set(), antonyms: new Set() });
        const group = meanings.get(pos);
        for (const d of m.definitions || []) {
          group.senses.push({ text: d.definition, example: d.example });
          (d.synonyms || []).forEach(s => group.synonyms.add(s));
          (d.antonyms || []).forEach(s => group.antonyms.add(s));
        }
        (m.synonyms || []).forEach(s => group.synonyms.add(s));
        (m.antonyms || []).forEach(s => group.antonyms.add(s));
      }
    }

    return {
      word: first.word,
      phonetic: first.phonetic || (phonetics.find(p => p.text) || {}).text || '',
      audio: (phonetics.find(p => p.audio) || {}).audio || '',
      origin: results.map(r => r.origin).find(Boolean) || '',
      meanings: [...meanings.values()].map(g => ({
        pos: g.pos,
        senses: g.senses.slice(0, MAX_SENSES),
        more: Math.max(0, g.senses.length - MAX_SENSES),
        synonyms: [...g.synonyms].slice(0, 6),
        antonyms: [...g.antonyms].slice(0, 4),
      })),
      source: (first.sourceUrls || [])[0] || '',
    };
  }

  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const POS_ABBR = {
    noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', pronoun: 'pron.',
    preposition: 'prep.', conjunction: 'conj.', interjection: 'interj.', exclamation: 'excl.',
  };

  function render(entry) {
    const head = escape(entry.word);
    const blocks = entry.meanings.map(m => `
      <section class="sense-block">
        <p class="pos"><abbr title="${escape(m.pos)}">${escape(POS_ABBR[m.pos] || m.pos)}</abbr></p>
        <ol class="senses">
          ${m.senses.map(s => `
            <li>
              <span class="def">${escape(s.text)}</span>
              ${s.example ? `<span class="example">“${escape(s.example)}”</span>` : ''}
            </li>`).join('')}
        </ol>
        ${m.more ? `<p class="more">&amp; ${m.more} further sense${m.more > 1 ? 's' : ''}.</p>` : ''}
        ${m.synonyms.length ? `<p class="nyms"><span class="sc">Syn.</span> ${m.synonyms.map(escape).join(', ')}.</p>` : ''}
        ${m.antonyms.length ? `<p class="nyms"><span class="sc">Ant.</span> ${m.antonyms.map(escape).join(', ')}.</p>` : ''}
      </section>`).join('<div class="fleuron" aria-hidden="true">⁂</div>');

    return `
      <article class="entry">
        <header class="entry-head">
          <h2 class="headword"><span class="initial">${head.charAt(0)}</span>${head.slice(1)}</h2>
          <div class="pronunciation">
            ${entry.phonetic ? `<span class="ipa">${escape(entry.phonetic)}</span>` : ''}
            ${entry.audio ? `<button class="audio-btn" data-audio="${escape(entry.audio)}" title="Hear it spoken" aria-label="Play pronunciation">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9H5z"/><path d="M17 8.5a5 5 0 0 1 0 7"/></svg></button>` : ''}
          </div>
        </header>
        <div class="rule" aria-hidden="true"></div>
        ${blocks}
        ${entry.origin ? `<p class="etym"><span class="sc">Origin</span> ${escape(entry.origin)}</p>` : ''}
        <footer class="colophon">
          <span aria-hidden="true">❦</span>
          ${entry.source ? `<a href="${escape(entry.source)}" target="_blank" rel="noopener">Wiktionary</a>` : ''}
          ${entry.by ? `<span>${escape(entry.by)}</span>` : ''}
        </footer>
      </article>`;
  }

  return { lookup, render, escape };
})();
