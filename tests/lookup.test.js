import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWiktionary, parseLegacy, dictionaryExample } from '../public/lookup.js';

const example = 'This latest discovery should eventually lead to much better treatments for disease.';
const source = 'https://en.wiktionary.org/wiki/discovery';
const wiktionary = { entries: [{ senses: [{ definition: 'Something discovered.', examples: [example], subsenses: [] }] }], source: { url: source } };
const legacy = [{ meanings: [{ definitions: [{ definition: 'Something discovered.', example }] }] }];
const response = data => ({ ok: true, json: async () => data });
const isWiktionary = url => url.includes('freedictionaryapi.com');

function pendingUntilAborted(signal) {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

test('Wiktionary parser reads sourced examples and searches nested senses', () => {
  assert.deepEqual(parseWiktionary(wiktionary), { example, definition: 'Something discovered.', exampleSource: source });
  const nested = { entries: [{ senses: [{ definition: 'Parent definition.', examples: [], subsenses: [{ definition: 'Nested meaning.', examples: [' ', example] }] }] }] };
  assert.deepEqual(parseWiktionary(nested), { example, definition: 'Nested meaning.' });
});

test('legacy parser finds an example beyond the first definition', () => {
  const data = [{ meanings: [{ definitions: [{ definition: 'First meaning.' }, ...legacy[0].meanings[0].definitions] }] }];
  assert.deepEqual(parseLegacy(data), { example, definition: 'Something discovered.' });
});

test('neither parser fabricates an example from a definition', () => {
  assert.deepEqual(parseWiktionary({ entries: [{ senses: [{ definition: 'Definition only.' }] }] }), { example: '', definition: 'Definition only.' });
  assert.deepEqual(parseLegacy([{ meanings: [{ definitions: [{ definition: 'Definition only.' }] }] }]), { example: '', definition: 'Definition only.' });
  assert.deepEqual(parseWiktionary({}), { example: '', definition: '' });
  assert.deepEqual(parseLegacy([]), { example: '', definition: '' });
});

test('dictionary fallback succeeds when the first provider fails', async () => {
  const calls = [];
  const result = await dictionaryExample('discovery', { fetchImpl: async url => {
    calls.push(url);
    if (isWiktionary(url)) throw new Error('Network unavailable');
    return response(legacy);
  } });
  assert.equal(calls.length, 2);
  assert.equal(result.example, example);
});

test('dictionary fallback succeeds when the legacy provider fails', async () => {
  const result = await dictionaryExample('discovery', { fetchImpl: async url => {
    if (!isWiktionary(url)) return { ok: false };
    return response(wiktionary);
  } });
  assert.deepEqual(result, { example, definition: 'Something discovered.', exampleSource: source });
});

test('definition-only response cannot win the example lookup', async () => {
  const result = await dictionaryExample('discovery', { fetchImpl: async url => isWiktionary(url)
    ? response({ entries: [{ senses: [{ definition: 'Not an example.' }] }] })
    : response(legacy) });
  assert.equal(result.example, example);
});

test('both provider failures reject without a fabricated sentence', async () => {
  await assert.rejects(dictionaryExample('unknown', { fetchImpl: async () => { throw new Error('Offline'); } }), AggregateError);
  await assert.rejects(dictionaryExample('unknown', { fetchImpl: async url => response(isWiktionary(url)
    ? { entries: [{ senses: [{ definition: 'Meaning only.' }] }] }
    : [{ meanings: [{ definitions: [{ definition: 'Meaning only.' }] }] }]) }), AggregateError);
});

test('a successful example aborts a pending provider without waiting for its timeout', async () => {
  let losingSignal;
  const result = await dictionaryExample('discovery', { fetchImpl: async (url, { signal }) => {
    if (isWiktionary(url)) return response(wiktionary);
    losingSignal = signal;
    return pendingUntilAborted(signal);
  } });
  assert.equal(result.example, example);
  assert.ok(losingSignal.aborted);
});

test('cancelling a lookup aborts both in-flight requests', async () => {
  const controller = new AbortController();
  const signals = [];
  const lookup = dictionaryExample('discovery', { signal: controller.signal, fetchImpl: (_url, { signal }) => {
    signals.push(signal);
    return pendingUntilAborted(signal);
  } });
  assert.equal(signals.length, 2, 'both providers start in parallel');
  controller.abort();
  await assert.rejects(lookup);
  assert.ok(signals.every(signal => signal.aborted));
});

test('an already-cancelled lookup forwards cancellation to every request', async () => {
  const controller = new AbortController();
  controller.abort();
  const signals = [];
  await assert.rejects(dictionaryExample('discovery', { signal: controller.signal, fetchImpl: (_url, { signal }) => {
    signals.push(signal);
    return pendingUntilAborted(signal);
  } }));
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
});
