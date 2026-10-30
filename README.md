# Inkwell Notes

A notes app in the style of Apple Notes, with two extras:

- **Click-to-correct spelling.** Misspelled words get a wavy red underline. Click one to see suggestions, then click a suggestion to replace the word (Ctrl/⌘ Z undoes it). You can also **Add to Personal Dictionary** (the word is never flagged again) or **Ignore** it for this session.
- **Book-style definitions.** Click any correctly spelled word to get a definition laid out like a page from an old dictionary: headword with a red initial, pronunciation (with audio when available), abbreviated part of speech, numbered senses, quoted examples, synonyms, antonyms and etymology. Click the speaker icon to hear the word. Use the **Define on click** switch in the toolbar to turn this off while you write.

## Running it

You don't need to build or install anything. Open `index.html` in a browser (double-clicking it works). Notes and your personal dictionary are saved in the browser's local storage.

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
| Styles | `css/styles.css` |
| Spell checking engine ([Typo.js](https://github.com/cfinke/Typo.js)) and the en_US Hunspell dictionary | `vendor/typo/` |

- Spell checking runs fully offline. The dictionary is bundled in `vendor/typo/en_US.js`, and the app adds a short list of modern words such as *email*, *app* and *selfie* that the older dictionary lacks.
- The underlines are drawn with the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API) (Chrome/Edge 105+, Safari 17.2+, Firefox 140+), so they never change the text you're editing. In browsers without it, clicking words still works but no underlines appear.
- Definitions come from the free [Free Dictionary API](https://dictionaryapi.dev) and need an internet connection.
