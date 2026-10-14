# Marginalia

**Words worth keeping.** A quiet home for the vocabulary you discover between the pages.

Capture unfamiliar English words, discover their Russian meanings and English examples, and carry your collection into Quizlet or Knowt. Thoughtfully designed for reading on an iPhone and installing on its Home Screen.

[Open Marginalia](https://duqamaqa.github.io/marginalia/) · [Report an issue](https://github.com/Duqamaqa/marginalia/issues)

## A small ritual, beautifully simple

- **Capture without losing your place.** Type a word, review its meaning, save, and keep reading.
- **Learn in context.** Keep a Russian translation, an English example, or both. Add the book it came from.
- **Keep a collection, not duplicates.** Saved words are recognized instantly; edit an existing entry whenever you need.
- **Practice on your terms.** Export any number of words in chronological or random order, ready for flashcard text import.
- **Make it yours.** A focused Home Screen experience, offline access to saved words, and portable JSON backups.

## Run locally

Requires Node.js 20 or newer. There are no package dependencies and no API keys to configure.

```sh
git clone https://github.com/Duqamaqa/marginalia.git
cd marginalia
npm start
```

Open http://localhost:4173. Set `PORT` to use another port. Run `npm test` for the export and backup validation tests.

## Reading workflow

1. Type an English word or phrase. Lookups request a Russian translation and an English dictionary example when available.
2. Choose Both, Translation, or English example. Edit the suggested meaning to match your book; dictionary examples are not available for every word.
3. Add an optional book title and save. The form clears and returns focus to the next word.
4. Search or sort your collection, then export a chosen number of words in oldest, newest, or random order. Filter out previously exported words when desired.

Exports are UTF-8 `.txt` files with a tab between the word and its meaning and a new line between cards. Translation and example share the definition field. In Quizlet or Knowt's text-import workflow, paste the file contents and select **Tab** and **New line** as separators. This is a portable text format; it does not directly sync to either account.

## Install on an iPhone

The live website is hosted on **GitHub Pages**. The included workflow tests and publishes `public/` to the dedicated `gh-pages` branch whenever `main` changes, then requests a Pages build. All asset and install paths also work under a repository subpath. The bundled Node server is for local preview.

Open the HTTPS address in Safari, tap **Share → Add to Home Screen**, enable **Open as Web App** if offered, and tap **Add**. The manifest, home-screen icon, mobile layout, and offline app shell are included. Load the published app online once before using it offline. Live translations and dictionary lookups still need an internet connection.

## Keep your words safe

Words are stored in the current browser's local storage. There is no account, server database, or automatic device sync. Clearing site data, private browsing, or switching browser/device can remove or isolate your collection. An installed iPhone web app can also have separate storage from Safari.

Use **Back up** regularly to download a JSON copy. Use **Restore** to bring that copy into another browser or the installed app. Restore merges cards by their unique IDs, keeping existing cards with the same ID. Keep a backup before changing hosts: local storage belongs to the site's origin. The flashcard text export is for learning apps; use the JSON backup to preserve the complete collection metadata.

## Lookup services

Lookups use [MyMemory](https://mymemory.translated.net/) for translation and [Free Dictionary API](https://dictionaryapi.dev/) and [Free Dictionary API / Wiktionary](https://freedictionaryapi.com/api/v1) in parallel for English examples. These external services receive the requested word. Availability, coverage, rate limits, and translation quality depend on those providers. Wiktionary example sources and their CC BY-SA 4.0 attribution are kept with saved words, backups, and exports. Failed or incomplete lookups are retryable. A handful of starter words have built-in translations and examples. If a request fails or a meaning is missing, enter or correct it manually and save it.

The interface does not require a paid service, authentication, analytics, or a backend. Serving it over HTTPS is required for service-worker support outside localhost and for the intended installed-app experience.
