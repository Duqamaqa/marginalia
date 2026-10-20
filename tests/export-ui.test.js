import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createExportPayload, chooseWords } from '../public/core.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
// Execute the real export controller with just its DOM and storage boundaries mocked.
const section = app.slice(app.indexOf('let exportRevision='), app.indexOf("$('backup').onclick="));
assert.ok(section.includes("$('copy-export').onclick="));
const seed = () => ['a', 'b', 'c'].map((id, index) => ({ id, word: id, translation: `слово ${id}`, example: '', book: '', createdAt: index + 1 }));

function harness(clipboard) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', max: '', checked: false, open: false, disabled: false, textContent: '', events: {},
      addEventListener(name, handler) { this.events[name] = handler; },
      replaceChildren(...children) { this.children = children; },
      showModal() { this.open = true; },
      focus() { this.focused = true; }, select() { this.selected = true; },
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    });
    return elements.get(id);
  }
  element('export-target').value = 'knowt';
  element('export-order').value = 'oldest';
  const commits = [], messages = [];
  const context = vm.createContext({
    $: element, seedWords: seed(), commits, navigator: { clipboard },
    createExportPayload, chooseWords, el: (_tag, _class, textContent) => ({ textContent }),
    toast: message => messages.push(message), URL, Blob, setTimeout,
  });
  vm.runInContext(`let words=seedWords, exportSelection=[];
    function commit(next){words=next;commits.push(next);return true;}
    ${section}
    globalThis.state={get words(){return words;}};`, context);
  element('export-open').onclick();
  return { element, commits, messages, get words() { return context.state.words; } };
}

test('clipboard rejection exposes selectable text without marking cards exported', async () => {
  const ui = harness({ writeText: async () => { throw new Error('Permission denied'); } });
  const expected = ui.element('export-text').value;
  await ui.element('copy-export').onclick();
  assert.equal(ui.commits.length, 0);
  assert.ok(ui.words.every(word => !word.exportedAt));
  assert.ok(ui.element('export-dialog').open);
  assert.ok(ui.element('manual-export').open);
  assert.equal(ui.element('export-text').value, expected);
  assert.ok(ui.element('export-text').focused && ui.element('export-text').selected);
  assert.equal(ui.element('export-text').selectionEnd, expected.length);
  assert.match(ui.element('export-status').textContent, /touch and hold/i);
  assert.equal(ui.element('copy-export').disabled, false);
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const textarea = html.match(/<textarea\b[^>]*\bid="export-text"[^>]*>/)?.[0];
  assert.ok(textarea && /\breadonly\b/i.test(textarea), 'manual text must be read-only so exported content stays intact');
});

test('missing clipboard API supports manual copy without claiming a successful export', async () => {
  const ui = harness(undefined);
  await ui.element('copy-export').onclick();
  assert.equal(ui.commits.length, 0);
  assert.ok(ui.element('manual-export').open);
  ui.element('select-export').onclick();
  assert.ok(ui.element('export-text').selected);
  assert.equal(ui.commits.length, 0, 'selecting text alone does not prove that copying succeeded');
});

test('clipboard success marks captured IDs when selection changes during the async write', async () => {
  let resolveWrite;
  const writes = [];
  const ui = harness({ writeText: text => { writes.push(text); return new Promise(resolve => { resolveWrite = resolve; }); } });
  ui.element('export-count').value = '1';
  ui.element('export-count').events.change();
  const pending = ui.element('copy-export').onclick();
  assert.equal(writes[0], 'a\tслово a');
  assert.ok(ui.element('copy-export').disabled);
  ui.element('export-count').value = '2';
  ui.element('export-order').value = 'newest';
  ui.element('export-count').events.change();
  ui.element('export-target').value = 'quizlet';
  ui.element('export-target').onchange();
  resolveWrite();
  await pending;
  assert.equal(ui.commits.length, 1);
  assert.ok(ui.words.find(word => word.id === 'a').exportedAt);
  assert.ok(ui.words.filter(word => word.id !== 'a').every(word => !word.exportedAt));
  assert.equal(ui.element('export-status').textContent, '', 'old clipboard completion must not report success for a newer selection');
  assert.equal(ui.element('copy-export').textContent, 'Copy for Quizlet');
  assert.equal(ui.element('copy-export').disabled, false);
});

test('failed pending copy cannot replace a newer selection with its older fallback text', async () => {
  let rejectWrite;
  const ui = harness({ writeText: () => new Promise((_resolve, reject) => { rejectWrite = reject; }) });
  const pending = ui.element('copy-export').onclick();
  ui.element('export-count').value = '1';
  ui.element('export-order').value = 'newest';
  ui.element('export-count').events.change();
  const currentText = ui.element('export-text').value;
  rejectWrite(new Error('Denied'));
  await pending;
  assert.equal(ui.element('export-text').value, currentText);
  assert.equal(ui.element('manual-export').open, false);
  assert.equal(ui.commits.length, 0);
});
