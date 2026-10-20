import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCell, toTSV, createExportPayload, chooseWords, validateBackup, normalizeWord, findDuplicate } from '../public/core.js';

const entry = (id, createdAt, extra = {}) => ({ id, word: `word-${id}`, translation: 'слово', example: 'A word in context.', book: 'My book', createdAt, ...extra });

test('word matching ignores Unicode presentation, case and stray whitespace', () => {
  assert.equal(normalizeWord('  ＢＯＯＫ\n '), 'book');
  assert.equal(normalizeWord(' Ice\t cream '), 'ice cream');
  assert.equal(normalizeWord('CAFÉ'), normalizeWord('cafe\u0301'));
});

test('duplicate warning finds words across books and excludes the card being edited', () => {
  const first = entry('1', 1, { word: '  Solace ', book: 'Book one' });
  const second = entry('2', 2, { word: 'linger', book: 'Book two' });
  const words = [first, second];
  assert.equal(findDuplicate(words, 'ＳＯＬＡＣＥ'), first);
  assert.equal(findDuplicate(words, 'solace', '2'), first);
  assert.ok(!findDuplicate(words, 'solace', '1'));
  assert.ok(!findDuplicate(words, 'new word'));
  assert.deepEqual(words, [first, second]);
});

test('TSV keeps each card on one line with exactly two cells', () => {
  assert.equal(cleanCell('  a\t b\r\n c  '), 'a b c');
  const result = toTSV([
    entry('1', 1, { word: ' green\ttea ', translation: 'зелёный\nчай', example: 'I drink\r\ntea.' }),
    entry('2', 2, { word: 'hello', translation: '', example: 'Hello there.' }),
    entry('3', 3, { word: 'book', translation: 'книга', example: '' }),
  ]);
  assert.equal(result, 'green tea\tзелёный чай — I drink tea.\nhello\tHello there.\nbook\tкнига');
  assert.equal(result.split('\n').length, 3);
  for (const row of result.split('\n')) assert.equal(row.split('\t').length, 2);
  assert.equal(toTSV([]), '');
});

test('sourced examples retain attribution through backup and flashcard export', () => {
  const word = entry('source', 1, { exampleSource: 'https://en.wiktionary.org/wiki/discovery' });
  assert.deepEqual(validateBackup({ version: 1, words: [word] }), [word]);
  const exported = toTSV([word]);
  assert.ok(exported.includes('https://en.wiktionary.org/wiki/discovery'));
  assert.ok(exported.includes('CC BY-SA 4.0'));
  assert.equal(exported.split('\t').length, 2);
  assert.throws(() => validateBackup({ version: 1, words: [{ ...word, exampleSource: 'javascript:alert(1)' }] }));
});

test('export payload snapshots selected IDs, count and sanitized Russian text', () => {
  const words = [
    entry('1', 1, { word: '  discovery\t', translation: 'открытие;\nнаходка — «счастливая»', example: 'A\r\nnew discovery.' }),
    entry('2', 2, { word: 'solace', translation: '\tутешение…\n', example: '' }),
  ];
  const payload = createExportPayload(words);
  const expected = { ids: ['1', '2'], count: 2, text: 'discovery\tоткрытие; находка — «счастливая» — A new discovery.\nsolace\tутешение…' };
  assert.deepEqual(payload, expected);
  words[0].id = 'changed'; words[0].word = 'changed'; words[0].translation = 'changed';
  words.reverse(); words.push(entry('3', 3));
  assert.deepEqual(payload, expected, 'pending clipboard work must retain exactly the selected snapshot');
  assert.ok(!payload.text.endsWith('\n'));
  assert.ok(payload.text.split('\n').every(row => row && row.split('\t').length === 2));
});

test('export selection respects chronology, count and previously exported cards', () => {
  const words = [entry('b', 20), entry('c', 30, { exportedAt: 40 }), entry('a', 10)];
  assert.deepEqual(chooseWords(words, { count: 2 }).map(w => w.id), ['a', 'b']);
  assert.deepEqual(chooseWords(words, { count: 2, order: 'newest' }).map(w => w.id), ['c', 'b']);
  assert.deepEqual(chooseWords(words, { count: 9, onlyNew: true }).map(w => w.id), ['a', 'b']);
  assert.deepEqual(chooseWords(words, { count: -1 }), []);
  assert.deepEqual(chooseWords(words, { count: 0 }), []);
  assert.deepEqual(words.map(w => w.id), ['b', 'c', 'a'], 'selection must not reorder the library');
});

test('random export selection is reproducible and never repeats cards', () => {
  const words = [entry('1', 1), entry('2', 2), entry('3', 3), entry('4', 4)];
  const selected = chooseWords(words, { count: 3, order: 'random' }, () => 0);
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map(w => w.id)).size, 3);
  assert.deepEqual(selected.map(w => w.id), chooseWords(words, { count: 3, order: 'random' }, () => 0).map(w => w.id));
});

test('backup accepts valid Unicode cards and optional export timestamps', () => {
  const words = [entry('1', 123, { word: 'naïve', translation: 'наивный' }), entry('2', 234, { exportedAt: 345 })];
  assert.deepEqual(validateBackup({ version: 1, words }), words);
  assert.deepEqual(validateBackup({ version: 1, words: [] }), []);
  const boundary = entry('boundary', 0, { word: 'w'.repeat(100), translation: 't'.repeat(1000), example: 'e'.repeat(2000), book: 'b'.repeat(160) });
  assert.deepEqual(validateBackup({ version: 1, words: [boundary] }), [boundary]);
});

test('backup rejects incompatible or malformed data before it reaches storage', () => {
  const valid = entry('1', 1);
  const malformed = [
    null, {}, { version: 2, words: [valid] }, { version: 1, words: {} },
    { version: 1, words: [valid, valid] },
    ...[
      { id: 7 }, { word: '' }, { word: 'x'.repeat(101) },
      { translation: 7 }, { translation: 'x'.repeat(1001) },
      { example: 'x'.repeat(2001) }, { book: 'x'.repeat(161) },
      { createdAt: Infinity }, { createdAt: 'yesterday' }, { exportedAt: NaN },
    ].map(change => ({ version: 1, words: [{ ...valid, ...change }] })),
  ];
  for (const input of malformed) assert.throws(() => validateBackup(input));
});
