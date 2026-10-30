/*
 * English → Old Norse translations.
 *
 * A hand-picked glossary (works offline) covers the epic vocabulary of the
 * sagas and skaldic poetry; Wiktionary's translation tables fill the gaps.
 * Words are given in standard normalized Old Norse spelling, in dictionary form.
 */
const Norse = (() => {
  // english: 'word|pos|gloss|kind; …'   kind: (blank) saga prose, p = poetic, k = kenning
  const GLOSSARY = {
    warrior: 'hermaðr|m.|man of the host; kappi|m.|champion; drengr|m.|valiant man; víkingr|m.|sea-raider; rekkr|m.|warrior|p; seggr|m.|man, warrior|p; einherjar|m. pl.|Odin’s chosen slain|p',
    berserker: 'berserkr|m.|bear-shirt warrior',
    viking: 'víkingr|m.|sea-raider',
    sword: 'sverð|n.|sword; mækir|m.|sword|p; hjǫrr|m.|sword|p; brandr|m.|blade, firebrand|p; benlogi|m.|“wound-flame”|k',
    blade: 'egg|f.|edge of a blade; brandr|m.|blade|p',
    shield: 'skjǫldr|m.|shield; rǫnd|f.|shield-rim, shield|p; lind|f.|linden-wood shield|p',
    spear: 'spjót|n.|spear; geirr|m.|spear|p; dǫrr|m.|spear|p',
    axe: 'øx|f.|axe; breiðøx|f.|broad axe; skeggøx|f.|bearded axe',
    helmet: 'hjálmr|m.|helmet',
    armor: 'brynja|f.|mail-coat',
    armour: 'brynja|f.|mail-coat',
    mail: 'brynja|f.|mail-coat',
    bow: 'bogi|m.|bow',
    arrow: 'ǫr|f.|arrow; fleinn|m.|dart, arrow|p',
    hammer: 'hamarr|m.|hammer, crag',
    wolf: 'úlfr|m.|wolf; vargr|m.|wolf, outlaw; ylgr|f.|she-wolf|p; Freki|m.|“the greedy one”, Odin’s wolf|p',
    raven: 'hrafn|m.|raven; Huginn|m.|“thought”, Odin’s raven|p',
    eagle: 'ǫrn|m.|eagle; ari|m.|eagle|p',
    bear: 'bjǫrn|m.|bear; bersi|m.|bear|p',
    dragon: 'dreki|m.|dragon; ormr|m.|serpent, dragon',
    serpent: 'ormr|m.|serpent; naðr|m.|adder; linnr|m.|serpent|p',
    snake: 'ormr|m.|serpent; naðr|m.|adder',
    horse: 'hestr|m.|horse; hross|n.|horse; jór|m.|steed|p; marr|m.|steed|p',
    steed: 'jór|m.|steed|p; marr|m.|steed|p; hestr|m.|horse',
    ship: 'skip|n.|ship; langskip|n.|longship; dreki|m.|dragon-ship; knǫrr|m.|ocean-going trading ship; snekkja|f.|swift warship; unnar hestr||“wave’s steed”|k',
    boat: 'bátr|m.|boat; nǫkkvi|m.|small boat',
    longship: 'langskip|n.|longship; dreki|m.|dragon-ship',
    sea: 'sær|m.|sea; haf|n.|open sea; marr|m.|sea|p; lǫgr|m.|sea, water|p',
    ocean: 'haf|n.|open sea; sær|m.|sea; marr|m.|sea|p',
    wave: 'bylgja|f.|billow; bára|f.|wave; alda|f.|swell; unnr|f.|wave|p',
    gold: 'gull|n.|gold; Sifjar haddr||“Sif’s hair”|k; Ægis eldr||“fire of the sea”|k; Fróða mjǫl||“Fróði’s meal”|k',
    silver: 'silfr|n.|silver',
    iron: 'járn|n.|iron',
    steel: 'stál|n.|steel',
    treasure: 'fé|n.|wealth, cattle; auðr|m.|riches; hodd|n.|hoard|p',
    wealth: 'auðr|m.|riches; fé|n.|wealth, cattle',
    ring: 'hringr|m.|ring; baugr|m.|arm-ring',
    fire: 'eldr|m.|fire; logi|m.|flame; bál|n.|blaze, pyre; funi|m.|fire|p',
    flame: 'logi|m.|flame; funi|m.|fire|p',
    blood: 'blóð|n.|blood; dreyri|m.|gore; sveiti|m.|blood (“sweat”)|p',
    battle: 'orrusta|f.|battle; bardagi|m.|fight; víg|n.|fight, slaying; styrr|m.|tumult of battle; hildr|f.|battle|p; gunnr|f.|battle|p; Hildar leikr||“Hild’s game”|k; vápnaþing|n.|“assembly of weapons”|k',
    fight: 'bardagi|m.|fight; víg|n.|fight, slaying; berjask|v.|to fight',
    war: 'ófriðr|m.|war, “un-peace”; hernaðr|m.|warfare, raiding',
    army: 'herr|m.|host, army; lið|n.|troop; fylking|f.|battle array',
    host: 'herr|m.|host, army; lið|n.|troop',
    victory: 'sigr|m.|victory',
    death: 'dauði|m.|death; bani|m.|death, slayer; hel|f.|death, the realm of the dead',
    fate: 'ørlǫg|n. pl.|fate; skǫp|n. pl.|destiny; urðr|f.|fate|p',
    destiny: 'skǫp|n. pl.|destiny; ørlǫg|n. pl.|fate',
    doom: 'ragnarǫk|n. pl.|doom of the gods; ørlǫg|n. pl.|fate',
    apocalypse: 'ragnarǫk|n. pl.|doom of the gods; ragnarøkkr|n.|twilight of the gods',
    king: 'konungr|m.|king; dróttinn|m.|lord; jǫfurr|m.|prince|p; gramr|m.|king|p; þengill|m.|prince|p; hilmir|m.|ruler|p; buðlungr|m.|king|p',
    queen: 'dróttning|f.|queen',
    lord: 'dróttinn|m.|lord; herra|m.|master, lord; lávarðr|m.|lord',
    chieftain: 'hǫfðingi|m.|chieftain; goði|m.|priest-chieftain',
    chief: 'hǫfðingi|m.|chieftain',
    earl: 'jarl|m.|earl',
    jarl: 'jarl|m.|earl',
    hero: 'hetja|f.|hero; kappi|m.|champion; garpr|m.|doughty man',
    champion: 'kappi|m.|champion',
    warden: 'vǫrðr|m.|warden; gætir|m.|keeper',
    guardian: 'vǫrðr|m.|warden; gætir|m.|keeper; verjandi|m.|defender',
    guard: 'vǫrðr|m.|warden, watch; gætir|m.|keeper',
    watchman: 'vǫrðr|m.|watchman',
    keeper: 'gætir|m.|keeper; vǫrðr|m.|warden',
    defender: 'verjandi|m.|defender; vǫrðr|m.|warden',
    protector: 'vǫrðr|m.|warden; verjandi|m.|defender',
    god: 'guð|m.|god; áss|m.|god of the Æsir; goð|n.|god',
    gods: 'goð|n. pl.|gods; æsir|m. pl.|the Æsir; regin|n. pl.|the ruling powers|p; tívar|m. pl.|gods|p; bǫnd|n. pl.|gods (“bonds”)|p',
    giant: 'jǫtunn|m.|giant; þurs|m.|giant, ogre; risi|m.|giant',
    elf: 'álfr|m.|elf',
    dwarf: 'dvergr|m.|dwarf',
    valkyrie: 'valkyrja|f.|chooser of the slain',
    shieldmaiden: 'skjaldmær|f.|shield-maiden',
    ghost: 'draugr|m.|undead, revenant; aptrganga|f.|one who walks after death',
    undead: 'draugr|m.|undead, revenant',
    witch: 'vǫlva|f.|seeress; seiðkona|f.|sorceress',
    seer: 'vǫlva|f.|seeress; spákona|f.|prophetess',
    seeress: 'vǫlva|f.|seeress; spákona|f.|prophetess',
    prophet: 'spámaðr|m.|prophet',
    magic: 'galdr|m.|spell-song; seiðr|m.|sorcery; fjǫlkynngi|f.|witchcraft',
    spell: 'galdr|m.|spell-song',
    sorcery: 'seiðr|m.|sorcery; fjǫlkynngi|f.|witchcraft',
    rune: 'rún|f.|rune, secret',
    secret: 'rún|f.|secret, rune; leynd|f.|secrecy',
    song: 'kvæði|n.|poem, lay; ljóð|n.|song, verse',
    poem: 'kvæði|n.|poem, lay; ljóð|n.|song, verse; drápa|f.|praise-poem; bragr|m.|poetry|p',
    poetry: 'skáldskapr|m.|poetry; bragr|m.|poetry|p',
    poet: 'skáld|n.|skald, poet',
    skald: 'skáld|n.|skald, poet',
    world: 'heimr|m.|world, home; verǫld|f.|world; Miðgarðr|m.|the world of men',
    earth: 'jǫrð|f.|earth; fold|f.|earth|p; grund|f.|ground|p',
    ground: 'jǫrð|f.|earth; grund|f.|ground|p',
    sky: 'himinn|m.|sky, heaven; upphiminn|m.|high heaven|p',
    heaven: 'himinn|m.|heaven; upphiminn|m.|high heaven|p',
    sun: 'sól|f.|sun; sunna|f.|sun|p; álfrǫðull|m.|“elf-disc”|k',
    moon: 'máni|m.|moon; ártali|m.|“year-counter”|k',
    star: 'stjarna|f.|star',
    night: 'nótt|f.|night',
    day: 'dagr|m.|day',
    morning: 'morginn|m.|morning',
    dawn: 'ótta|f.|the hour before dawn',
    evening: 'aptann|m.|evening; kveld|n.|evening',
    winter: 'vetr|m.|winter',
    summer: 'sumar|n.|summer',
    spring: 'vár|n.|spring',
    autumn: 'haust|n.|autumn',
    storm: 'stormr|m.|storm; veðr|n.|weather, storm; hregg|n.|tempest|p',
    wind: 'vindr|m.|wind',
    snow: 'snjór|m.|snow',
    ice: 'íss|m.|ice',
    frost: 'frost|n.|frost; hrím|n.|rime',
    rain: 'regn|n.|rain',
    thunder: 'þruma|f.|thunder',
    lightning: 'leiptr|n.|lightning|p',
    mountain: 'fjall|n.|mountain; bjarg|n.|rock, crag',
    hill: 'hóll|m.|hill; haugr|m.|mound',
    cliff: 'hamarr|m.|crag; bjarg|n.|cliff',
    cave: 'hellir|m.|cave',
    stone: 'steinn|m.|stone',
    rock: 'bjarg|n.|rock; steinn|m.|stone',
    river: 'á|f.|river; fljót|n.|great river',
    lake: 'vatn|n.|lake',
    water: 'vatn|n.|water',
    forest: 'skógr|m.|forest; mǫrk|f.|wild wood; viðr|m.|wood, tree',
    wood: 'viðr|m.|wood, tree; skógr|m.|forest',
    tree: 'tré|n.|tree; askr|m.|ash tree; Yggdrasill|m.|the world-tree',
    field: 'vǫllr|m.|field, plain',
    home: 'heimili|n.|home; heimr|m.|home, world',
    house: 'hús|n.|house',
    hall: 'hǫll|f.|hall; salr|m.|hall; skáli|m.|longhouse',
    fortress: 'borg|f.|stronghold; virki|n.|fortification',
    castle: 'borg|f.|stronghold',
    road: 'vegr|m.|way; leið|f.|path, route; stígr|m.|path',
    path: 'stígr|m.|path; leið|f.|route',
    way: 'vegr|m.|way; leið|f.|route',
    journey: 'fǫr|f.|journey; ferð|f.|voyage',
    voyage: 'ferð|f.|voyage; fǫr|f.|journey',
    friend: 'vinr|m.|friend; félagi|m.|comrade',
    comrade: 'félagi|m.|comrade',
    enemy: 'óvinr|m.|enemy; fjándi|m.|foe, fiend',
    foe: 'fjándi|m.|foe, fiend; óvinr|m.|enemy',
    brother: 'bróðir|m.|brother',
    sister: 'systir|f.|sister',
    father: 'faðir|m.|father',
    mother: 'móðir|f.|mother',
    son: 'sonr|m.|son',
    daughter: 'dóttir|f.|daughter',
    child: 'barn|n.|child',
    man: 'maðr|m.|man, person; karl|m.|man; halr|m.|man|p; seggr|m.|man, warrior|p',
    woman: 'kona|f.|woman; fljóð|n.|woman|p; víf|n.|woman|p; snót|f.|lady|p',
    lady: 'snót|f.|lady|p; kona|f.|woman',
    slave: 'þræll|m.|thrall',
    thrall: 'þræll|m.|thrall',
    wise: 'vitr|adj.|wise; fróðr|adj.|learned, wise',
    wisdom: 'speki|f.|wisdom; vizka|f.|wisdom',
    strong: 'sterkr|adj.|strong; rammr|adj.|mighty',
    strength: 'afl|n.|strength; máttr|m.|might',
    might: 'máttr|m.|might; afl|n.|strength',
    brave: 'djarfr|adj.|bold; hraustr|adj.|valiant; hugrakkr|adj.|stout-hearted',
    bold: 'djarfr|adj.|bold',
    courage: 'hugprýði|f.|valour',
    fierce: 'grimmr|adj.|fierce, grim',
    grim: 'grimmr|adj.|grim',
    ancient: 'forn|adj.|ancient',
    old: 'gamall|adj.|old; forn|adj.|ancient',
    young: 'ungr|adj.|young',
    great: 'mikill|adj.|great; stórr|adj.|big',
    good: 'góðr|adj.|good',
    evil: 'illr|adj.|evil, bad',
    true: 'sannr|adj.|true',
    honor: 'sæmð|f.|honour; virðing|f.|esteem',
    honour: 'sæmð|f.|honour; virðing|f.|esteem',
    fame: 'orðstírr|m.|renown that outlives you; frægð|f.|fame',
    glory: 'dýrð|f.|glory; orðstírr|m.|renown',
    oath: 'eiðr|m.|oath',
    vengeance: 'hefnd|f.|revenge',
    revenge: 'hefnd|f.|revenge',
    peace: 'friðr|m.|peace',
    love: 'ást|f.|love',
    hate: 'hatr|n.|hatred',
    sorrow: 'harmr|m.|grief; sorg|f.|sorrow',
    grief: 'harmr|m.|grief',
    joy: 'gleði|f.|gladness',
    hope: 'ván|f.|hope, expectation',
    mead: 'mjǫðr|m.|mead',
    ale: 'ǫl|n.|ale',
    beer: 'bjórr|m.|beer',
    feast: 'veizla|f.|feast',
    light: 'ljós|n.|light',
    darkness: 'myrkr|n.|darkness',
    dark: 'myrkr|adj.|dark',
    shadow: 'skuggi|m.|shadow',
    black: 'svartr|adj.|black',
    white: 'hvítr|adj.|white',
    red: 'rauðr|adj.|red',
    blue: 'blár|adj.|blue, dark',
    green: 'grœnn|adj.|green',
    grey: 'grár|adj.|grey',
    gray: 'grár|adj.|grey',
    golden: 'gullinn|adj.|golden',
    north: 'norðr|adv.|north',
    south: 'suðr|adv.|south',
    east: 'austr|adv.|east',
    west: 'vestr|adv.|west',
    heart: 'hjarta|n.|heart',
    mind: 'hugr|m.|mind, courage',
    soul: 'sál|f.|soul; ǫnd|f.|breath, spirit',
    spirit: 'andi|m.|spirit; hugr|m.|mind',
    eye: 'auga|n.|eye',
    hand: 'hǫnd|f.|hand',
    head: 'hǫfuð|n.|head',
    bone: 'bein|n.|bone',
    skull: 'hauss|m.|skull',
    deer: 'hjǫrtr|m.|stag',
    stag: 'hjǫrtr|m.|stag',
    boar: 'gǫltr|m.|boar',
    ox: 'uxi|m.|ox',
    dog: 'hundr|m.|dog; rakki|m.|dog',
    cat: 'kǫttr|m.|cat',
    fish: 'fiskr|m.|fish',
    whale: 'hvalr|m.|whale',
    hawk: 'haukr|m.|hawk',
    island: 'ey|f.|island',
    fjord: 'fjǫrðr|m.|fjord',
    shore: 'strǫnd|f.|shore',
    coast: 'strǫnd|f.|shore',
    kingdom: 'ríki|n.|realm',
    realm: 'ríki|n.|realm',
    land: 'land|n.|land',
    people: 'þjóð|f.|people, nation; fólk|n.|folk',
    folk: 'fólk|n.|folk',
    word: 'orð|n.|word',
    name: 'nafn|n.|name',
    book: 'bók|f.|book',
    free: 'frjáls|adj.|free',
    dead: 'dauðr|adj.|dead',
    alive: 'kvikr|adj.|living',
    silent: 'þǫgull|adj.|silent',
    swift: 'skjótr|adj.|swift; snarr|adj.|keen, quick',
    fast: 'skjótr|adj.|swift',
    beautiful: 'fagr|adj.|fair',
    fair: 'fagr|adj.|fair',
    hello: 'heill|adj.|hail, whole',
    hail: 'heill|adj.|hail, whole',
    farewell: 'far heill||fare well',
    goodbye: 'far heill||fare well',
    forever: 'at eilífu||for ever',
    never: 'aldri|adv.|never',
    always: 'ávallt|adv.|always',
    outlaw: 'útlagi|m.|outlaw; vargr|m.|outlaw, wolf',
    wanderer: 'fǫrumaðr|m.|wanderer; gestr|m.|guest, stranger',
    traveler: 'fǫrumaðr|m.|wanderer',
    traveller: 'fǫrumaðr|m.|wanderer',
    guest: 'gestr|m.|guest, stranger',
    stranger: 'gestr|m.|guest, stranger',
    grave: 'haugr|m.|burial mound',
    valhalla: 'Valhǫll|f.|hall of the slain',
    slain: 'valr|m.|the slain',
    kill: 'vega|v.|to slay; drepa|v.|to kill',
    slay: 'vega|v.|to slay',
    die: 'deyja|v.|to die',
    sail: 'sigla|v.|to sail',
    raid: 'herja|v.|to harry, raid',
    travel: 'fara|v.|to go, travel',
    go: 'fara|v.|to go',
    speak: 'mæla|v.|to speak',
    say: 'segja|v.|to say',
  };

  const KIND_LABEL = { '': 'Saga prose', p: 'Skaldic verse', k: 'Kennings' };

  const byEnglish = new Map();
  const headwords = new Map(); // folded word -> entries
  for (const [english, list] of Object.entries(GLOSSARY)) {
    const entries = list.split(';').map(item => {
      const [word, pos, gloss, kind = ''] = item.trim().split('|');
      return { word, pos, gloss, kind, english };
    });
    byEnglish.set(english, entries);
    for (const e of entries) {
      const key = fold(e.word);
      if (!headwords.has(key)) headwords.set(key, []);
      if (!headwords.get(key).some(h => h.word === e.word && h.gloss === e.gloss)) headwords.get(key).push(e);
    }
  }

  // The same word written with only the everyday a–z alphabet.
  function plain(word) {
    return word
      .replace(/Þ/g, 'Th').replace(/þ/g, 'th')
      .replace(/Ð/g, 'D').replace(/ð/g, 'd')
      .replace(/Æ/g, 'Ae').replace(/æ/g, 'ae')
      .replace(/Œ/g, 'Oe').replace(/œ/g, 'oe')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/Ø/g, 'O').replace(/ø/g, 'o');
  }

  function fold(word) {
    return plain(word).toLowerCase();
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

  // Glossary translations for an English word.
  function english(word) {
    for (const lemma of lemmas(word)) {
      if (byEnglish.has(lemma)) return byEnglish.get(lemma);
    }
    return [];
  }

  // Old Norse words that look like what was typed (e.g. "vordr" or "voror" → vǫrðr).
  function similar(word) {
    const typed = fold(word);
    if (typed.length < 3) return [];
    const limit = typed.length <= 4 ? 1 : 2;
    const scored = [];
    for (const [key, entries] of headwords) {
      if (key.includes(' ')) continue;
      const d = editDistance(typed, key);
      if (d <= limit && d < key.length) scored.push({ d, entries });
    }
    // One row per word, with its meanings combined (vǫrðr: warden, watchman …).
    const merged = new Map();
    for (const e of scored.sort((a, b) => a.d - b.d).flatMap(s => s.entries)) {
      const seen = merged.get(e.word);
      if (!seen) merged.set(e.word, { ...e });
      else if (!seen.gloss.split(', ').includes(e.gloss)) seen.gloss = [...new Set([...seen.gloss.split(', '), ...e.gloss.split(', ')])].join(', ');
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

  /* ---------- Wiktionary ---------- */

  const WIKI = 'https://en.wiktionary.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&origin=*&page=';
  const wikiCache = new Map();

  async function wikitext(page) {
    const res = await fetch(WIKI + encodeURIComponent(page));
    if (!res.ok) throw new Error(`Wiktionary returned ${res.status}`);
    const json = await res.json();
    return (json.parse && json.parse.wikitext && json.parse.wikitext['*']) || '';
  }

  // Pull Old Norse entries out of Wiktionary's translation tables.
  function parseTranslations(text) {
    const found = [];
    let gloss = '';
    for (const line of text.split('\n')) {
      const top = line.match(/\{\{trans-top\|([^}|]*)/);
      if (top) gloss = top[1].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim();
      const norse = line.match(/Old Norse:(.*)$/);
      if (!norse) continue;
      for (const t of norse[1].matchAll(/\{\{tt?\+?\|non\|([^|}]+)((?:\|[^}]*)?)\}\}/g)) {
        const gender = (t[2].match(/\|(m|f|n)(?:-p)?(?=\||$)/) || [])[1];
        found.push({ word: t[1].trim(), pos: gender ? gender + '.' : '', gloss, kind: 'w' });
      }
    }
    return found;
  }

  function wiktionary(word) {
    const key = lemmas(word)[0];
    if (!wikiCache.has(key)) {
      const request = (async () => {
        const page = await wikitext(key);
        const englishSection = (page.split(/^==English==\s*$/m)[1] || '').split(/^==[^=]/m)[0];
        let results = parseTranslations(englishSection);
        if (!results.length) {
          // Big entries keep their tables on a separate "/translations" page.
          try { results = parseTranslations(await wikitext(key + '/translations')); } catch { /* none */ }
        }
        const seen = new Set();
        return results.filter(r => !seen.has(r.word) && seen.add(r.word));
      })().catch(err => {
        wikiCache.delete(key);
        throw err;
      });
      wikiCache.set(key, request);
    }
    return wikiCache.get(key);
  }

  return { english, similar, wiktionary, plain, fold, KIND_LABEL };
})();
