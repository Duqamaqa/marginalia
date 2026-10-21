# Marginalia

**Words worth keeping.** A quiet home for the vocabulary you discover between the pages.

Capture unfamiliar English words, discover their Russian meanings and English examples, and carry your collection into Quizlet or Knowt. Thoughtfully designed for reading on an iPhone and installing on its Home Screen.

[Open Marginalia](https://duqamaqa.github.io/marginalia/) · [Report an issue](https://github.com/Duqamaqa/marginalia/issues)

## A small ritual, beautifully simple

- **Capture without losing your place.** Type a word, review its meaning, save, and keep reading.
- **Learn in context.** Keep a Russian translation, an English example, or both. Add the book it came from.
- **Keep a collection, not duplicates.** Saved words are recognized instantly; edit an existing entry whenever you need.
- **Practice on your terms.** Export any number of words in chronological or random order, ready for flashcard text import.
- **Make it yours.** Choose Light, Dark, or System beside Help; your preference is remembered on this device. A focused Home Screen experience, offline access to saved words, and portable JSON backups.

## Run locally

Requires Node.js 20 or newer. There are no package dependencies and no API keys to configure.

```sh
git clone https://github.com/Duqamaqa/marginalia.git
cd marginalia
npm start
```

Open http://localhost:4173. Set `PORT` to use another port. Run `npm test` for the export and backup validation tests.

## Reading workflow

1. Type an English word or phrase. Lookups choose a dictionary meaning with an English example where available, then use the Russian translation for that same meaning. If the dictionary has no Russian translation, the selected English definition is translated into Russian instead.
2. Choose Both, Translation, or English example. Edit the suggested meaning to match your book; dictionary examples are not available for every word.
3. Add an optional book title and save. The form clears and returns focus to the next word.
4. Search or sort your collection, then export a chosen number of words in oldest, newest, or random order. Filter out previously exported words when desired.

For **Knowt’s iPhone app**, choose Knowt → Download PDF for Knowt → Save PDF to Files. If a preview opens, use Share → Save to Files. In Knowt choose Create → Flashcards → Upload file from device, select the PDF, and choose Flashcards if prompted. The [official AI summarizer guide](https://help.knowt.com/en/articles/10305785-how-do-i-use-the-ai-summarizers) confirms PDF support. This is AI generation: it uses Knowt’s AI allowance and can change or omit cards, so review the resulting set. The PDF preserves selected words, Russian translations, English examples and source attribution with embedded Unicode text. PDF creation runs locally; vocabulary is not sent to a PDF service. Bundled libraries and font licenses are in `public/vendor/`.

For **Quizlet**, copy the selected text into its website import screen with Tab between term and definition and New line between cards. A selectable text fallback and `.txt` download remain available. Preparing a file does not create a set in either app. Previously exported words can be exported again; the unexported-only filter starts off.

## Install on an iPhone

The live website is hosted on **GitHub Pages**. The included workflow tests and publishes `public/` to the dedicated `gh-pages` branch whenever `main` changes, then requests a Pages build. All asset and install paths also work under a repository subpath. The bundled Node server is for local preview.

Open the HTTPS address in Safari, tap **Share → Add to Home Screen**, enable **Open as Web App** if offered, and tap **Add**. The manifest, home-screen icon, mobile layout, and offline app shell are included. Load the published app online once before using it offline. Live translations and dictionary lookups still need an internet connection.

## Keep your words safe

Words are stored in the current browser's local storage. There is no account, server database, or automatic device sync. Clearing site data, private browsing, or switching browser/device can remove or isolate your collection. An installed iPhone web app can also have separate storage from Safari.

Use **Back up** regularly to download a JSON copy. Use **Restore** to bring that copy into another browser or the installed app. Restore merges cards by their unique IDs, keeping existing cards with the same ID. Keep a backup before changing hosts: local storage belongs to the site's origin. The flashcard text export is for learning apps; use the JSON backup to preserve the complete collection metadata.

## Lookup services

Lookups use [Free Dictionary API / Wiktionary](https://freedictionaryapi.com/api/v1) for sense-specific Russian translations and English examples, with [Free Dictionary API](https://dictionaryapi.dev/) as a fallback. Both dictionaries receive the requested word. When a selected sense has no Russian translation, [MyMemory](https://mymemory.translated.net/) receives that English definition to translate its meaning, rather than translating an ambiguous bare word independently. Availability, coverage, rate limits, and translation quality depend on those providers. Wiktionary example sources and their CC BY-SA 4.0 attribution are kept with saved words, backups, and exports. Unknown words display “Word not found” and remain unsavable until you enter a translation or example. Network failures display “Lookup unavailable” instead. Save is enabled only when the selected save format contains a nonblank translation or example. Editing either meaning field cancels pending lookup results so your own text is not overwritten. Failed or incomplete lookups are retryable. A handful of starter words have built-in translations and examples. If a request fails or a meaning is missing, enter or correct it manually and save it.

The interface does not require a paid service, authentication, analytics, or a backend. Serving it over HTTPS is required for service-worker support outside localhost and for the intended installed-app experience.
