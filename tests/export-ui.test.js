import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createExportPayload, chooseWords } from '../public/core.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
// Execute the real export controller with just its DOM and storage boundaries mocked.
const section = app.slice(app.indexOf('let exportRevision='), app.indexOf("$('backup').onclick="));
assert.ok(section.includes("$('copy-export').onclick="));
const pdfImport = "await import('./pdf-export.js')";
assert.ok(section.includes(pdfImport));
const controller = section.replace(pdfImport, 'await Promise.resolve({createVocabularyPdf: pdfGenerator})');
const seed = () => ['a', 'b', 'c'].map((id, index) => ({ id, word: id, translation: `слово ${id}`, example: '', book: '', createdAt: index + 1 }));

function harness(clipboard, pdfGenerator = async () => new Uint8Array([37, 80, 68, 70])) {
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
  const commits = [], messages = [], blobs = new Map(), revoked = [];
  const urls = {
    createObjectURL(blob) { const url = `blob:test-${blobs.size + 1}`; blobs.set(url, blob); return url; },
    revokeObjectURL(url) { revoked.push(url); },
  };
  const context = vm.createContext({
    $: element, seedWords: seed(), commits, navigator: { clipboard },
    createExportPayload, chooseWords, el: (_tag, _class, textContent) => ({ textContent }),
    toast: message => messages.push(message), URL: urls, Blob, setTimeout, pdfGenerator,
  });
  vm.runInContext(`let words=seedWords, exportSelection=[];
    function commit(next){words=next;commits.push(next);return true;}
    ${controller}
    globalThis.state={get words(){return words;}};`, context);
  element('export-open').onclick();
  return { element, commits, messages, blobs, revoked, get words() { return context.state.words; } };
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

test('prepared PDF keeps a persistent save link and marks only captured IDs on save', async () => {
  let captured;
  const ui = harness(undefined, async records => { captured = records; return new Uint8Array([37, 80, 68, 70]); });
  ui.element('export-count').value = '1';
  ui.element('export-count').events.change();
  const pending = ui.element('download-pdf').onclick();
  ui.words[0].translation = 'Changed during PDF preparation';
  await pending;
  assert.equal(captured.length, 1);
  assert.equal(captured[0].translation, 'слово a', 'PDF generation receives captured card contents');
  assert.equal(ui.commits.length, 0, 'preparing a PDF is not the same as saving it');
  assert.equal(ui.element('pdf-ready').hidden, false);
  const link = ui.element('save-pdf-link');
  assert.equal(link.download, 'marginalia-1-words.pdf');
  assert.equal(ui.blobs.get(link.href).type, 'application/pdf');
  assert.deepEqual([...new Uint8Array(await ui.blobs.get(link.href).arrayBuffer())], [37, 80, 68, 70]);
  link.onclick();
  assert.ok(ui.words.find(record => record.id === 'a').exportedAt);
  assert.ok(ui.words.filter(record => record.id !== 'a').every(record => !record.exportedAt));
  assert.equal(ui.element('pdf-ready').hidden, false, 'save link remains available for an iPhone preview or retry');
  assert.deepEqual(ui.revoked, [], 'the blob must outlive the async preparation click');
  ui.element('export-count').value = '2';
  ui.element('export-count').events.change();
  assert.equal(ui.element('pdf-ready').hidden, true);
  assert.deepEqual(ui.revoked, [link.href], 'changing selection releases the outdated PDF');
});

test('PDF result is discarded when its selection changes while generation is pending', async () => {
  let finish;
  const ui = harness(undefined, () => new Promise(resolve => { finish = resolve; }));
  const pending = ui.element('download-pdf').onclick();
  await Promise.resolve();
  assert.equal(ui.element('download-pdf').disabled, true);
  ui.element('export-count').value = '1';
  ui.element('export-order').value = 'newest';
  ui.element('export-count').events.change();
  finish(new Uint8Array([37, 80, 68, 70]));
  await pending;
  assert.equal(ui.blobs.size, 0, 'a stale document must never be offered as the current selection');
  assert.equal(ui.element('pdf-ready').hidden, true);
  assert.equal(ui.element('export-status').textContent, '');
  assert.equal(ui.commits.length, 0);
  assert.equal(ui.element('download-pdf').disabled, false);
});

test('PDF generation failure permits retry and never marks cards exported', async () => {
  const ui = harness(undefined, async () => { throw new Error('Font unavailable'); });
  await ui.element('download-pdf').onclick();
  assert.equal(ui.commits.length, 0);
  assert.equal(ui.blobs.size, 0);
  assert.equal(ui.element('pdf-ready').hidden, true);
  assert.match(ui.element('export-status').textContent, /couldn.t prepare the PDF/i);
  assert.equal(ui.element('download-pdf').disabled, false);
  assert.equal(ui.element('download-pdf').textContent, 'Download PDF for Knowt');
});

test('closing the export dialog discards a PDF still being generated', async () => {
  let finish;
  const ui = harness(undefined, () => new Promise(resolve => { finish = resolve; }));
  const pending = ui.element('download-pdf').onclick();
  await Promise.resolve();
  ui.element('export-dialog').open = false;
  ui.element('export-dialog').events.close();
  finish(new Uint8Array([37, 80, 68, 70]));
  await pending;
  assert.equal(ui.blobs.size, 0);
  assert.equal(ui.commits.length, 0);
  assert.equal(ui.element('pdf-ready').hidden, true);
});
