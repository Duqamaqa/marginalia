import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { cleanCell, findDuplicate, LANGUAGES, wordsForLanguage, validateBackup } from '../public/core.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const controller = app.slice(app.indexOf('function setMode('), app.indexOf("$('search').oninput="));
const languageController = app.slice(app.indexOf('function switchLanguage('), app.indexOf("$('language-choice').onchange="));
const starters = app.slice(app.indexOf('const hebrewStarter ='), app.indexOf('function toast('));
const storageController = app.slice(app.indexOf("window.addEventListener('storage'"), app.indexOf('function connection()'));
assert.ok(controller.includes('async function lookup()'));
const absent = { status: 'not-found', translation: '', example: '', definition: '' };

function harness(lookupVocabulary = async () => absent) {
  const elements = new Map(), timers = new Map(), commits = [], messages = [], windowEvents = {};
  let timerId = 0, savedId = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, open: false, textContent: '', events: {},
      addEventListener(name, callback) { this.events[name] = callback; },
      setAttribute() {}, focus() {}, scrollIntoView() {},
      close() { this.open = false; },
    });
    return elements.get(id);
  };
  const modes = ['both', 'translation', 'example'].map(mode => ({ dataset: { mode }, setAttribute() {} }));
  const context = vm.createContext({
    $: element, document: { querySelectorAll: () => modes }, cleanCell, findDuplicate, lookupVocabulary, LANGUAGES, wordsForLanguage, validateBackup,
    window: { addEventListener(name, callback) { windowEvents[name] = callback; } },
    localStorage: { setItem() {} },
    AbortController, crypto: { randomUUID: () => `saved-${++savedId}` }, commits, toast(message) { messages.push(message); },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(`let words=[], mode='both', revision=0,lookupTimer,lookupController,editingId=null,editingSnapshot=null,exampleSource=null,activeLanguage='en',exportRevision=0,exportSelection=[];
    const STORAGE='marginalia.words.v1';
    const cache=new Map(),drafts=new Map();${starters}
    const activeWords=()=>wordsForLanguage(words,activeLanguage),languageName=()=>LANGUAGES[activeLanguage].name;
    function clearPdf(){}function render(){updateDuplicate();}
    function commit(next){words=next;commits.push(next);updateDuplicate();return true;}
    ${languageController}
    ${controller}
    ${storageController}
    globalThis.state={get words(){return words;},get language(){return activeLanguage;},setMode,switchLanguage,editWord};updateDuplicate();`, context);
  return {
    element, commits, modes, messages,
    input(id, value) { element(id).value = value; element(id).events.input(); },
    lookup() { return element('lookup').onclick(); },
    setMode(mode) { context.state.setMode(mode); },
    switchLanguage(language) { context.state.switchLanguage(language); },
    edit(word) { context.state.editWord(word); },
    storage(words) { windowEvents.storage({ key: 'marginalia.words.v1', newValue: JSON.stringify({ version: 1, words }) }); },
    get language() { return context.state.language; },
    get words() { return context.state.words; },
  };
}

test('unknown word cannot save until manual meaning exists; clearing either manual field disables save', async () => {
  const ui = harness();
  ui.input('word', 'unlistedword');
  assert.equal(ui.element('save').disabled, true);
  await ui.lookup();
  assert.match(ui.element('lookup-status').textContent, /word not found/i);
  assert.equal(ui.element('save').disabled, true);
  ui.input('translation', 'Моё значение');
  assert.equal(ui.element('save').disabled, false);
  ui.input('translation', '  ');
  assert.equal(ui.element('save').disabled, true);
  ui.input('example', 'An example from my book.');
  assert.equal(ui.element('save').disabled, false);
  ui.input('example', '');
  assert.equal(ui.element('save').disabled, true);
});

test('save eligibility follows the chosen translation/example mode', () => {
  const ui = harness();
  ui.input('word', 'unlistedword');
  ui.input('example', 'A book sentence.');
  ui.setMode('translation');
  assert.equal(ui.element('save').disabled, true, 'hidden example is not a selected meaning');
  ui.input('translation', 'Перевод');
  assert.equal(ui.element('save').disabled, false);
  ui.setMode('example');
  ui.input('example', '');
  assert.equal(ui.element('save').disabled, true, 'hidden translation is not a selected meaning');
  ui.setMode('both');
  assert.equal(ui.element('save').disabled, false);
});

test('manual meaning can save a word missing from dictionaries and form resets safely', async () => {
  const ui = harness();
  ui.input('word', 'unlistedword'); await ui.lookup();
  ui.input('translation', 'Мой перевод');
  ui.element('word-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.commits.length, 1);
  assert.equal(ui.words[0].word, 'unlistedword');
  assert.equal(ui.words[0].translation, 'Мой перевод');
  assert.equal(ui.element('word').value, '');
  assert.equal(ui.element('save').disabled, true);
});

test('manual editing aborts and invalidates late lookup results without losing either field', async () => {
  let finish, requestedSignal;
  const ui = harness((_term, { signal }) => { requestedSignal = signal; return new Promise(resolve => { finish = resolve; }); });
  ui.input('word', 'board');
  const pending = ui.lookup();
  ui.input('translation', 'Ручной перевод');
  ui.input('example', 'My own sentence.');
  assert.ok(requestedSignal.aborted);
  finish({ status: 'found', translation: 'Другой перевод', example: 'An automatic example.', definition: 'An automatic meaning.' });
  await pending;
  assert.equal(ui.element('translation').value, 'Ручной перевод');
  assert.equal(ui.element('example').value, 'My own sentence.');
  assert.equal(ui.element('definition').textContent, '');
  assert.equal(ui.element('save').disabled, false);
});

test('changing the word invalidates prior lookup even when a provider ignores cancellation', async () => {
  let finish;
  const ui = harness(() => new Promise(resolve => { finish = resolve; }));
  ui.input('word', 'board');
  const pending = ui.lookup();
  ui.input('word', 'different');
  finish({ status: 'found', translation: 'доска', example: 'The old word in a sentence.' });
  await pending;
  assert.equal(ui.element('word').value, 'different');
  assert.equal(ui.element('translation').value, '');
  assert.equal(ui.element('example').value, '');
  assert.equal(ui.element('save').disabled, true);
});

test('network failure and a known word without an example have distinct UI states', async () => {
  const unavailable = harness(async () => ({ status: 'unavailable' }));
  unavailable.input('word', 'board');await unavailable.lookup();
  assert.match(unavailable.element('lookup-status').textContent, /lookup unavailable/i);
  assert.equal(unavailable.element('save').disabled, true);
  const known = harness(async () => ({ status: 'found', translation: 'доска', example: '', definition: 'A surface.' }));
  known.input('word', 'board');await known.lookup();
  assert.doesNotMatch(known.element('lookup-status').textContent, /not found/i);
  assert.match(known.element('example-status').textContent, /no example available/i);
  assert.equal(known.element('save').disabled, false);
});

test('editing a sourced example preserves attribution until the field is cleared', async () => {
  const source = 'https://en.wiktionary.org/wiki/board';
  const ui = harness(async () => ({ status: 'found', translation: 'доска', example: 'She wrote on the board.', exampleSource: source }));
  ui.input('word', 'board');await ui.lookup();
  assert.equal(ui.element('example-source').hidden, false);
  assert.equal(ui.element('example-source').href, source);
  ui.input('example', 'She wrote on the board. [Edited for context.]');
  assert.equal(ui.element('example-source').hidden, false);
  assert.equal(ui.element('example-source').href, source);
  ui.input('example', '');
  assert.equal(ui.element('example-source').hidden, true);
});

test('switching languages aborts lookup and rejects a late result even for the same typed term', async () => {
  let finish, signal;
  const ui = harness((_term, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  ui.input('word', 'board');
  const pending = ui.lookup();
  ui.switchLanguage('he');
  assert.ok(signal.aborted);
  ui.input('word', 'board');
  finish({ status: 'found', translation: 'доска', example: 'She wrote on the board.' });
  await pending;
  assert.equal(ui.language, 'he');
  assert.equal(ui.element('translation').value, '');
  assert.equal(ui.element('example').value, '');
  assert.equal(ui.element('save').disabled, true);
});

test('each language restores its unfinished draft and save mode without mixing fields', () => {
  const ui = harness();
  ui.input('word', 'board');ui.input('translation', 'доска');
  ui.element('book').value = 'English book';ui.setMode('translation');
  ui.switchLanguage('he');
  assert.equal(ui.element('word').value, '');
  ui.input('word', 'ספר');ui.input('example', 'אני קורא ספר טוב.');
  ui.element('book').value = 'Hebrew book';ui.setMode('example');
  ui.switchLanguage('en');
  assert.equal(ui.element('word').value, 'board');
  assert.equal(ui.element('translation').value, 'доска');
  assert.equal(ui.element('example').value, '');
  assert.equal(ui.element('book').value, 'English book');
  assert.equal(ui.element('example-block').hidden, true);
  ui.switchLanguage('he');
  assert.equal(ui.element('word').value, 'ספר');
  assert.equal(ui.element('translation').value, '');
  assert.equal(ui.element('example').value, 'אני קורא ספר טוב.');
  assert.equal(ui.element('book').value, 'Hebrew book');
  assert.equal(ui.element('translation-block').hidden, true);
});

test('saving after a language switch tags each card and retains both lists', () => {
  const ui = harness();
  ui.input('word', 'book');ui.input('translation', 'книга');
  ui.element('word-form').onsubmit({ preventDefault() {} });
  ui.switchLanguage('he');
  ui.input('word', 'ספר');ui.input('translation', 'книга');
  ui.element('word-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.words.length, 2);
  assert.equal(ui.words[0].language, 'en');
  assert.equal(ui.words[1].language, 'he');
  assert.equal(ui.words[1].word, 'ספר');
  ui.input('word', 'סֵפֶר');ui.input('translation', 'книга');
  assert.equal(ui.element('duplicate-notice').hidden, false);
  assert.equal(ui.element('save').disabled, true);
});

test('English starter entries and cached provider results cannot leak into Hebrew', async () => {
  const calls = [];
  const ui = harness(async (term, { language }) => {
    calls.push({ term, language });
    return language === 'en' ? { status: 'found', translation: 'доска', example: 'She wrote on the board.' } : absent;
  });
  ui.input('word', 'serendipity');await ui.lookup();
  assert.equal(calls.length, 0);
  assert.ok(ui.element('translation').value);
  ui.input('word', 'board');await ui.lookup();
  assert.equal(calls.length, 1);
  ui.switchLanguage('he');
  ui.input('word', 'serendipity');await ui.lookup();
  assert.equal(ui.element('translation').value, '');
  ui.input('word', 'board');await ui.lookup();
  assert.equal(ui.element('example').value, '');
  assert.deepEqual(calls.map(call => `${call.language}:${call.term}`), ['en:board', 'he:serendipity', 'he:board']);
});

test('restored editing draft cannot overwrite a newer card received from another tab', () => {
  const ui = harness();
  ui.input('word', 'board');ui.input('translation', 'Original meaning');
  ui.element('word-form').onsubmit({ preventDefault() {} });
  ui.edit(ui.words[0]);ui.input('translation', 'Unfinished draft');
  ui.switchLanguage('he');
  ui.storage([{ ...ui.words[0], translation: 'Newer saved meaning' }]);
  ui.switchLanguage('en');
  assert.equal(ui.element('translation').value, 'Unfinished draft', 'draft remains available for the user to recover');
  ui.element('word-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.commits.length, 1, 'conflicting draft must not write to storage');
  assert.equal(ui.words[0].translation, 'Newer saved meaning');
  assert.match(ui.messages.at(-1), /changed in another tab/i);
});

test('editing draft for a deleted card cannot silently recreate the card after switching back', () => {
  const ui = harness();
  ui.input('word', 'board');ui.input('translation', 'A meaning');
  ui.element('word-form').onsubmit({ preventDefault() {} });
  ui.edit(ui.words[0]);ui.switchLanguage('he');ui.storage([]);ui.switchLanguage('en');
  ui.element('word-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.words.length, 0);
  assert.equal(ui.commits.length, 1);
  assert.match(ui.messages.at(-1), /changed in another tab/i);
});
