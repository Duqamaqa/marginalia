import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { cleanCell, findDuplicate } from '../public/core.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const controller = app.slice(app.indexOf('function setMode('), app.indexOf("$('search').oninput="));
assert.ok(controller.includes('async function lookup()'));
const absent = { status: 'not-found', translation: '', example: '', definition: '' };

function harness(lookupVocabulary = async () => absent) {
  const elements = new Map(), timers = new Map(), commits = [];
  let timerId = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, textContent: '', events: {},
      addEventListener(name, callback) { this.events[name] = callback; },
      setAttribute() {}, focus() {}, scrollIntoView() {},
    });
    return elements.get(id);
  };
  const modes = ['both', 'translation', 'example'].map(mode => ({ dataset: { mode }, setAttribute() {} }));
  const context = vm.createContext({
    $: element, document: { querySelectorAll: () => modes }, cleanCell, findDuplicate, lookupVocabulary,
    AbortController, crypto: { randomUUID: () => 'saved-id' }, commits, toast() {},
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(`let words=[], mode='both', revision=0,lookupTimer,lookupController,editingId=null,exampleSource=null;
    const cache=new Map(),starter={};
    function commit(next){words=next;commits.push(next);updateDuplicate();return true;}
    ${controller}
    globalThis.state={get words(){return words;},setMode};updateDuplicate();`, context);
  return {
    element, commits, modes,
    input(id, value) { element(id).value = value; element(id).events.input(); },
    lookup() { return element('lookup').onclick(); },
    setMode(mode) { context.state.setMode(mode); },
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
