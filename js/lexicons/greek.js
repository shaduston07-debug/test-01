/*
 * Ancient Greek: Attic prose words and the epic vocabulary of Homer, in
 * polytonic Greek script, dictionary forms. "a–z" letters use the usual
 * scholarly transliteration (ξίφος → xiphos, Ἀχιλλεύς → Achilleus).
 */
const greekToLatin = (() => {
  const LETTERS = {
    α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
    ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō',
  };
  const VOWELS = 'αεηιουω';
  const ROUGH = '̔';
  const DIAERESIS = '̈';
  return word => word.split(/(\s+)/).map(part => {
    // Split into base letters with their accents and breathings.
    const letters = [];
    for (const ch of part.normalize('NFD')) {
      if (/[̀-ͯͅ]/.test(ch) && letters.length) letters[letters.length - 1].marks += ch;
      else letters.push({ ch, marks: '' });
    }
    let out = '';
    letters.forEach((l, i) => {
      const lower = l.ch.toLowerCase();
      let t = LETTERS[lower];
      if (t === undefined) {
        out += l.ch;
        return;
      }
      const prev = letters[i - 1] && letters[i - 1].ch.toLowerCase();
      const next = letters[i + 1] && letters[i + 1].ch.toLowerCase();
      if (lower === 'υ' && prev && 'αεηο'.includes(prev) && !l.marks.includes(DIAERESIS)) t = 'u';
      if (lower === 'υ' && next === 'ι' && !letters[i + 1].marks.includes(DIAERESIS)) t = 'u';
      if (lower === 'γ' && next && 'γκξχ'.includes(next)) t = 'n';
      if (lower === 'ρ' && l.marks.includes(ROUGH)) t = 'rh';
      if (l.ch !== lower) t = t[0].toUpperCase() + t.slice(1);
      out += t;
    });
    // A rough breathing on the opening vowel (or diphthong) is written h-.
    const opening = letters.slice(0, 2).filter(l => VOWELS.includes(l.ch.toLowerCase()));
    if (opening.some(l => l.marks.includes(ROUGH)) && VOWELS.includes(letters[0].ch.toLowerCase())) {
      out = letters[0].ch !== letters[0].ch.toLowerCase() ? 'H' + out[0].toLowerCase() + out.slice(1) : 'h' + out;
    }
    return out;
  }).join('');
})();

Lexicon.register('greek', {
  name: 'Ancient Greek',
  htmlLang: 'grc',
  tab: 'Greek',
  wiki: { label: 'Ancient Greek', code: 'grc' },
  letters: { plain: 'a–z', native: 'Αβγ', plainHint: 'Latin letters (xiphos)', nativeHint: 'Greek letters (ξίφος)' },
  kinds: { '': 'Classical Greek', p: 'Homeric & poetic' },
  kindNames: { '': 'classical', p: 'homeric' },
  toPlain: word => greekToLatin(word).normalize('NFD').replace(/[̀-ͯ]/g, ''),
  claude: word => `Give Ancient Greek translations of the English word "${word}".
Write them in polytonic Greek script with accents and breathings, in dictionary form (nominative singular; verbs in the first person present).
Include Attic prose words ("classical") and the epic words of Homer or the poets ("homeric") when they exist.`,

  // english: 'word|pos|gloss|kind; …'   kind: (blank) classical, p = Homeric / poetic
  glossary: {
    warrior: 'μαχητής|m.|fighter|p; αἰχμητής|m.|spearman|p; ὁπλίτης|m.|hoplite; στρατιώτης|m.|soldier',
    soldier: 'στρατιώτης|m.|soldier; ὁπλίτης|m.|hoplite',
    hero: 'ἥρως|m.|hero',
    sword: 'ξίφος|n.|sword; φάσγανον|n.|sword|p; ἄορ|n.|sword|p',
    shield: 'ἀσπίς|f.|round shield; σάκος|n.|great shield|p',
    spear: 'δόρυ|n.|spear; ἔγχος|n.|spear|p; αἰχμή|f.|spear-point|p',
    bow: 'τόξον|n.|bow',
    arrow: 'ὀϊστός|m.|arrow|p; βέλος|n.|missile, arrow',
    helmet: 'κόρυς|f.|helmet|p; κράνος|n.|helmet',
    armor: 'θώραξ|m.|breastplate; τεύχεα|n. pl.|armour|p',
    armour: 'θώραξ|m.|breastplate; τεύχεα|n. pl.|armour|p',
    king: 'βασιλεύς|m.|king; ἄναξ|m.|lord, king|p; τύραννος|m.|sole ruler',
    queen: 'βασίλεια|f.|queen; ἄνασσα|f.|queen, lady|p',
    lord: 'ἄναξ|m.|lord|p; δεσπότης|m.|master',
    wolf: 'λύκος|m.|wolf',
    raven: 'κόραξ|m.|raven',
    eagle: 'ἀετός|m.|eagle; αἰετός|m.|eagle|p',
    bear: 'ἄρκτος|f.|bear',
    lion: 'λέων|m.|lion',
    dragon: 'δράκων|m.|serpent, dragon',
    serpent: 'ὄφις|m.|snake; δράκων|m.|great serpent',
    snake: 'ὄφις|m.|snake',
    horse: 'ἵππος|m.|horse',
    ship: 'ναῦς|f.|ship; τριήρης|f.|trireme',
    sea: 'θάλασσα|f.|sea; πόντος|m.|the open sea|p; ἅλς|f.|the salt sea|p; πέλαγος|n.|open sea',
    ocean: 'ὠκεανός|m.|the world-river Ocean; πέλαγος|n.|open sea',
    wave: 'κῦμα|n.|wave',
    gold: 'χρυσός|m.|gold',
    silver: 'ἄργυρος|m.|silver',
    iron: 'σίδηρος|m.|iron',
    bronze: 'χαλκός|m.|bronze',
    treasure: 'θησαυρός|m.|treasure',
    ring: 'δακτύλιος|m.|ring',
    fire: 'πῦρ|n.|fire; φλόξ|f.|flame',
    flame: 'φλόξ|f.|flame',
    blood: 'αἷμα|n.|blood',
    battle: 'μάχη|f.|battle; ὑσμίνη|f.|battle|p',
    war: 'πόλεμος|m.|war; Ἄρης|m.|“Ares”, war|p',
    army: 'στρατός|m.|army; λαός|m.|the host|p',
    victory: 'νίκη|f.|victory',
    death: 'θάνατος|m.|death; κήρ|f.|doom of death|p',
    fate: 'μοῖρα|f.|fate, one’s portion; αἶσα|f.|destiny|p',
    destiny: 'μοῖρα|f.|fate; αἶσα|f.|destiny|p',
    god: 'θεός|m.|god; δαίμων|m.|divine power',
    gods: 'θεοί|m. pl.|the gods; ἀθάνατοι|m. pl.|“the deathless ones”|p',
    goddess: 'θεά|f.|goddess|p',
    giant: 'γίγας|m.|giant',
    nymph: 'νύμφη|f.|nymph, bride',
    seer: 'μάντις|m.|seer, prophet',
    prophet: 'μάντις|m.|seer; προφήτης|m.|spokesman of a god',
    oracle: 'μαντεῖον|n.|oracle; χρησμός|m.|oracular response',
    song: 'ᾠδή|f.|song; ἀοιδή|f.|song|p',
    poet: 'ποιητής|m.|poet; ἀοιδός|m.|bard|p',
    hymn: 'ὕμνος|m.|hymn',
    world: 'κόσμος|m.|world, order',
    earth: 'γῆ|f.|earth; γαῖα|f.|earth|p; χθών|f.|the earth|p',
    sky: 'οὐρανός|m.|sky, heaven; αἰθήρ|m.|bright upper air|p',
    heaven: 'οὐρανός|m.|heaven',
    sun: 'ἥλιος|m.|sun',
    moon: 'σελήνη|f.|moon',
    star: 'ἀστήρ|m.|star; ἄστρον|n.|star',
    night: 'νύξ|f.|night',
    day: 'ἡμέρα|f.|day; ἦμαρ|n.|day|p',
    dawn: 'ἕως|f.|dawn; ἠώς|f.|dawn|p',
    evening: 'ἑσπέρα|f.|evening',
    winter: 'χειμών|m.|winter, storm',
    summer: 'θέρος|n.|summer',
    spring: 'ἔαρ|n.|spring',
    storm: 'χειμών|m.|storm; θύελλα|f.|squall; λαῖλαψ|f.|hurricane|p',
    wind: 'ἄνεμος|m.|wind',
    snow: 'χιών|f.|snow',
    ice: 'κρύσταλλος|m.|ice',
    thunder: 'βροντή|f.|thunder',
    thunderbolt: 'κεραυνός|m.|thunderbolt',
    lightning: 'ἀστραπή|f.|lightning; κεραυνός|m.|thunderbolt',
    mountain: 'ὄρος|n.|mountain',
    stone: 'λίθος|m.|stone',
    rock: 'πέτρα|f.|rock',
    river: 'ποταμός|m.|river',
    lake: 'λίμνη|f.|lake, marsh',
    water: 'ὕδωρ|n.|water',
    forest: 'ὕλη|f.|forest, wood',
    tree: 'δένδρον|n.|tree',
    field: 'ἀγρός|m.|field',
    home: 'οἶκος|m.|house, household; δῶμα|n.|house|p',
    house: 'οἰκία|f.|house; δόμος|m.|house|p',
    hall: 'μέγαρον|n.|great hall|p',
    city: 'πόλις|f.|city-state; ἄστυ|n.|town',
    fortress: 'ἀκρόπολις|f.|citadel; τεῖχος|n.|wall',
    tower: 'πύργος|m.|tower',
    road: 'ὁδός|f.|road, way',
    way: 'ὁδός|f.|way',
    journey: 'ὁδός|f.|journey; πορεία|f.|march',
    homecoming: 'νόστος|m.|homecoming|p',
    friend: 'φίλος|m.|friend; ἑταῖρος|m.|comrade|p',
    comrade: 'ἑταῖρος|m.|comrade|p',
    enemy: 'πολέμιος|m.|enemy (in war); ἐχθρός|m.|personal enemy',
    brother: 'ἀδελφός|m.|brother',
    sister: 'ἀδελφή|f.|sister',
    father: 'πατήρ|m.|father',
    mother: 'μήτηρ|f.|mother',
    son: 'υἱός|m.|son',
    daughter: 'θυγάτηρ|f.|daughter',
    child: 'παῖς|m./f.|child; τέκνον|n.|child',
    man: 'ἀνήρ|m.|man; ἄνθρωπος|m.|human being; φώς|m.|man|p',
    woman: 'γυνή|f.|woman',
    wise: 'σοφός|adj.|wise',
    wisdom: 'σοφία|f.|wisdom; μῆτις|f.|cunning intelligence|p',
    strong: 'ἰσχυρός|adj.|strong; κρατερός|adj.|mighty|p',
    strength: 'ἰσχύς|f.|strength; βίη|f.|might|p; μένος|n.|fury, force|p',
    brave: 'ἀνδρεῖος|adj.|brave',
    courage: 'ἀνδρεία|f.|courage; θάρσος|n.|boldness',
    excellence: 'ἀρετή|f.|excellence, virtue',
    virtue: 'ἀρετή|f.|excellence, virtue',
    glory: 'κλέος|n.|glory, fame|p; δόξα|f.|reputation',
    fame: 'κλέος|n.|undying fame|p; δόξα|f.|reputation',
    honor: 'τιμή|f.|honour',
    honour: 'τιμή|f.|honour',
    oath: 'ὅρκος|m.|oath',
    revenge: 'τίσις|f.|retribution; νέμεσις|f.|righteous anger',
    vengeance: 'νέμεσις|f.|retribution; τίσις|f.|vengeance',
    pride: 'ὕβρις|f.|insolence, overweening pride',
    peace: 'εἰρήνη|f.|peace',
    love: 'ἔρως|m.|desire, love; φιλία|f.|friendship',
    hate: 'μῖσος|n.|hatred',
    sorrow: 'λύπη|f.|grief; ἄχος|n.|anguish|p; πένθος|n.|mourning',
    grief: 'πένθος|n.|mourning; ἄχος|n.|anguish|p',
    anger: 'ὀργή|f.|anger; μῆνις|f.|wrath|p; χόλος|m.|bitter anger|p',
    wrath: 'μῆνις|f.|wrath|p; χόλος|m.|bitter anger|p',
    joy: 'χαρά|f.|joy',
    hope: 'ἐλπίς|f.|hope',
    wine: 'οἶνος|m.|wine',
    light: 'φῶς|n.|light; φάος|n.|light|p',
    darkness: 'σκότος|m.|darkness; ἔρεβος|n.|nether darkness|p',
    shadow: 'σκιά|f.|shadow',
    black: 'μέλας|adj.|black',
    white: 'λευκός|adj.|white, bright',
    red: 'ἐρυθρός|adj.|red',
    blue: 'κυάνεος|adj.|dark blue',
    green: 'χλωρός|adj.|pale green',
    golden: 'χρύσεος|adj.|golden',
    heart: 'καρδία|f.|heart; θυμός|m.|heart, spirit|p',
    spirit: 'θυμός|m.|heart, spirit|p; πνεῦμα|n.|breath, spirit',
    soul: 'ψυχή|f.|soul, life-breath',
    mind: 'νοῦς|m.|mind; φρήν|f.|mind, heart|p',
    eye: 'ὀφθαλμός|m.|eye; ὄμμα|n.|eye|p',
    hand: 'χείρ|f.|hand',
    head: 'κεφαλή|f.|head; κάρη|n.|head|p',
    bone: 'ὀστέον|n.|bone',
    deer: 'ἔλαφος|m./f.|deer',
    dog: 'κύων|m./f.|dog',
    cat: 'αἴλουρος|m.|cat',
    fish: 'ἰχθύς|m.|fish',
    bird: 'ὄρνις|m./f.|bird',
    island: 'νῆσος|f.|island',
    shore: 'ἀκτή|f.|shore, headland; αἰγιαλός|m.|beach',
    kingdom: 'βασιλεία|f.|kingdom',
    people: 'δῆμος|m.|the people; λαός|m.|the folk, the host|p',
    word: 'λόγος|m.|word, account; ἔπος|n.|word|p',
    name: 'ὄνομα|n.|name',
    book: 'βίβλος|f.|book',
    free: 'ἐλεύθερος|adj.|free',
    dead: 'νεκρός|adj.|dead',
    immortal: 'ἀθάνατος|adj.|deathless',
    swift: 'ταχύς|adj.|swift; ὠκύς|adj.|swift|p',
    beautiful: 'καλός|adj.|beautiful, noble',
    hello: 'χαῖρε||rejoice, hail',
    hail: 'χαῖρε||rejoice, hail',
    farewell: 'χαῖρε||farewell; ἔρρωσο||be strong, farewell',
    always: 'ἀεί|adv.|always',
    never: 'οὐδέποτε|adv.|never',
    stranger: 'ξένος|m.|stranger, guest-friend',
    guest: 'ξένος|m.|guest-friend',
    wanderer: 'πλανήτης|m.|wanderer',
    grave: 'τάφος|m.|tomb; σῆμα|n.|grave-mound|p',
    underworld: 'Ἅιδης|m.|Hades; ἔρεβος|n.|the dark below|p',
    kill: 'κτείνω|v.|I kill',
    die: 'θνῄσκω|v.|I die',
    fight: 'μάχομαι|v.|I fight',
    sail: 'πλέω|v.|I sail',
    speak: 'λέγω|v.|I say; φημί|v.|I declare',
    sing: 'ᾄδω|v.|I sing; ἀείδω|v.|I sing|p',
  },
});
