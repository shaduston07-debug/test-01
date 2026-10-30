# Inkwell Notes

A notes app in the style of Apple Notes, with a few extras:

- **Click-to-correct spelling.** Misspelled words get a wavy red underline. Click one to see suggestions, then click a suggestion to replace the word (Ctrl/⌘ Z undoes it). You can also **Add to Personal Dictionary** (the word is never flagged again) or **Ignore** it for this session.
- **Book-style definitions.** Click any correctly spelled word to get a definition laid out like a page from an old dictionary: headword with a red initial, pronunciation (with audio when available), abbreviated part of speech, numbered senses, quoted examples, synonyms, antonyms and etymology. Click the speaker icon to hear the word. Use the **Look up on click** switch in the toolbar to turn this off while you write.
- **Old Norse translations.** On the same card, switch to the **Old Norse** tab to see the word in the language of the sagas. Options are grouped as *Saga prose*, *Skaldic verse* (poetic words) and *Kennings* (poetic phrases such as *Sifjar haddr*, "Sif's hair", for gold). Pick one to swap it into your note. It looks like the rest of your text, with the same font and size. Click it later to choose a different option or put back the original word.
  - **a–z / ð þ ǫ** switch: write the Old Norse word using only everyday letters (*vordr*, *hermadr*) or with the original Old Norse letters (*vǫrðr*, *hermaðr*). Both forms are shown for every option.
  - Typed an Old Norse word from memory, like *voror* or *vordr*? The spelling card suggests the real word (*vǫrðr*, "warden").
  - About 270 English words come from a built-in glossary that works offline. For any other word, the app looks up Old Norse translations on Wiktionary.
- **Pencil sketches.** Tap the squiggle in the toolbar to draw with an Apple Pencil, any stylus, a mouse or a finger. Lines get thicker as you press harder. Once a pencil touches the canvas, your palm and fingers are ignored. You get a pen, a highlighter, a stroke eraser (a stylus's eraser end works too), three sizes, six colours, and undo/redo. The sketch is saved as a drawing inside the note; tap it to edit it again.

## Running it

**On a tablet or phone:** open the published version at https://claude.ai/artifact/BJ7rWPs8uzsiPmKZ5s4N4D (sign in to claude.ai). There, notes and your personal dictionary are saved to your claude.ai account, so they're on every device. claude.ai pages can't reach outside websites, so Claude writes the definitions and the extra Old Norse translations instead. The first time, the page asks your permission.

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
| Old Norse glossary and Wiktionary lookup | `js/norse.js` |
| Pencil / stylus sketching | `js/sketch.js` |
| Styles | `css/styles.css` |
| Spell checking engine ([Typo.js](https://github.com/cfinke/Typo.js)) and the en_US Hunspell dictionary | `vendor/typo/` |

- Spell checking runs fully offline. The dictionary is bundled in `vendor/typo/en_US.js`, and the app adds a short list of modern words such as *email*, *app* and *selfie* that the older dictionary lacks.
- The underlines are drawn with the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API) (Chrome/Edge 105+, Safari 17.2+, Firefox 140+), so they never change the text you're editing. In browsers without it, clicking words still works but no underlines appear.
- Definitions come from the free [Free Dictionary API](https://dictionaryapi.dev) and need an internet connection.
- Old Norse words are given in their dictionary form (no grammatical endings for case or number), in standard normalized spelling.
- On an iPad, Apple's Scribble (handwriting into text) also works in the note itself.
