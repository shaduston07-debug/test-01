# Inkwell Notes

A notes app in the style of Apple Notes, with a few extras:

- **Click-to-correct spelling.** Misspelled words get a wavy red underline. Click one to see suggestions, then click a suggestion to replace the word (Ctrl/⌘ Z undoes it). You can also **Add to Personal Dictionary** (the word is never flagged again) or **Ignore** it for this session.
- **Book-style definitions.** Click any correctly spelled word to get a definition laid out like a page from an old dictionary: headword with a red initial, pronunciation (with audio when available), abbreviated part of speech, numbered senses, quoted examples, synonyms, antonyms and etymology. Click the speaker icon to hear the word. Use the **Look up on click** switch in the toolbar to turn this off while you write.
- **Old-language translations.** The word card has tabs for **Norse**, **Latin**, **Greek** and **Argot** (French thieves' slang, *la langue des voleurs*). Each shows the word grouped by register: Old Norse saga prose, skaldic verse and kennings (*Sifjar haddr*, "Sif's hair", for gold); everyday and poetic Latin (Virgil, Ovid); classical and Homeric Greek; Vidocq-era thieves' cant and classic Paris argot. Argot also accepts French words (*argent* → *aubert*, *pognon*). Pick one to swap it into your note in the same font. Click it later to choose another option or put the original back.
  - A letters switch writes Old Norse, Latin and Greek words with everyday a–z letters (*vordr*, *ensis*, *xiphos*) or with their own letters (*vǫrðr*, *ēnsis* with its long-vowel mark, *ξίφος*).
  - Typed an old word from memory, like *voror* or *xifos*? The spelling card suggests the real one.
  - Built-in glossaries work offline (about 270 Norse, 210 Latin, 185 Greek and 90 argot entries). "More translations" uses Wiktionary, or Claude on claude.ai.
- **Groups.** Organise notes into coloured groups from the sidebar (+ to create, ⋯ to rename, recolour or delete). The folder button on the toolbar puts the open note into a group.
- **Appearance.** Automatic, light or dark theme, and nine accent colours.
- **Hide the sidebar** with the button at the left of the toolbar, or Ctrl/⌘ \.
- **Typed sums.** Type something like `12 × 7 + 3 =` and the answer appears beside it; press Tab or tap it to add it. On an iPad, writing a sum with Scribble works the same way.
- **Pencil sketches.** Tap the squiggle in the toolbar to draw with an Apple Pencil, any stylus, a mouse or a finger. Lines get thicker as you press harder. Once a pencil touches the canvas, your palm and fingers are ignored. You get a pen, a highlighter, a stroke eraser (a stylus's eraser end works too), three sizes, six colours, and undo/redo. On claude.ai, **Solve** reads handwritten maths (sums, equations, fractions) and shows the working; **Add answer to note** puts the result under the sketch.

## Running it

**On a tablet or phone:** open the published version at https://claude.ai/artifact/BJ7rWPs8uzsiPmKZ5s4N4D (sign in to claude.ai). There, notes and your personal dictionary are saved to your claude.ai account, so they're on every device. claude.ai pages can't reach outside websites, so Claude writes the definitions and the extra Old Norse translations instead. The first time, the page asks your permission.

**As a home-screen app:** the files include a web-app manifest, icons and an offline cache. Host the folder on any web server (for example GitHub Pages) and choose *Add to Home Screen*. It then opens full screen with its own icon and works offline. Saved that way, notes stay on that device, and definitions and translations come from dictionaryapi.dev and Wiktionary. Adding the claude.ai link to the home screen also works, but it opens inside claude.ai.

**On a computer:** you don't need to build or install anything. Open `index.html` in a browser (double-clicking it works). Notes and your personal dictionary are saved in the browser's local storage.

To serve it instead, for example to open it on your phone:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000 (or http://<your-computer's-IP>:8000 from your phone)
```

## Features

- Sidebar with search, a note list showing times and snippets, and new/delete note buttons
- The first line of a note becomes its title, like in Apple Notes
- Bold, italic, underline, strikethrough, headings, bulleted lists and numbered lists
- Pasted text comes in as plain text
- A **Personal Dictionary** panel (bottom of the sidebar) where you can view, add and remove your own words
- Light and dark mode, plus a phone layout

## How it works

| Piece | File |
| --- | --- |
| Notes, editor, click handling, word card | `js/app.js` |
| Spell checking and personal dictionary | `js/spellcheck.js` |
| Definition lookup and book-style rendering | `js/definitions.js` |
| Translation engine (Wiktionary / Claude lookups, Greek transliteration) | `js/lexicon.js` |
| Glossaries: Old Norse, Latin, Ancient Greek, argot | `js/lexicons/` |
| Typed-sum calculator | `js/calc.js` |
| claude.ai sync and Claude lookups | `js/cloud.js` |
| Home-screen app: manifest, icons, offline cache | `manifest.webmanifest`, `icons/`, `sw.js` |
| Pencil / stylus sketching | `js/sketch.js` |
| Styles | `css/styles.css` |
| Spell checking engine ([Typo.js](https://github.com/cfinke/Typo.js)) and the en_US Hunspell dictionary | `vendor/typo/` |

- Spell checking runs fully offline. The dictionary is bundled in `vendor/typo/en_US.js`, and the app adds a short list of modern words such as *email*, *app* and *selfie* that the older dictionary lacks.
- The underlines are drawn with the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API) (Chrome/Edge 105+, Safari 17.2+, Firefox 140+), so they never change the text you're editing. In browsers without it, clicking words still works but no underlines appear.
- Definitions come from the free [Free Dictionary API](https://dictionaryapi.dev) and need an internet connection.
- Translations are given in dictionary form (no grammatical endings for case or number).
- On an iPad, Apple's Scribble (handwriting into text) also works in the note itself.
