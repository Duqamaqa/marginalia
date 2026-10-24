import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVocabularyEntry, lookupVocabulary } from '../public/lookup.js';

const ru = word => ({ language: { code: 'ru' }, word });
const sense = { definition: 'A surface used for writing.', examples: ['She wrote on the board.'], translations: [ru('доска')] };
const primary = senses => ({ word: 'board', entries: [{ senses }], source: { url: 'https://en.wiktionary.org/wiki/board' } });
const response = data => ({ ok: true, status: 200, json: async () => data });
const missing = () => ({ ok: false, status: 404 });
const isPrimary = url => url.includes('freedictionaryapi.com');
const isTranslator = url => url.includes('mymemory');

test('dictionary sense supplies its own Russian translation and English example', async () => {
  const calls = [];
  const result = await lookupVocabulary('board', { fetchImpl: async url => {
    calls.push(url);
    return isPrimary(url) ? response(primary([sense, { definition: 'A governing committee.', translations: [ru('совет')] }])) : missing();
  } });
  assert.equal(result.status, 'found');
  assert.equal(result.translation, 'доска');
  assert.equal(result.example, sense.examples[0]);
  assert.equal(result.definition, sense.definition);
  assert.equal(calls.length, 2, 'explicit same-sense Russian translation needs no translator');
});

test('sense parsing never borrows Russian from another sense', () => {
  const parsed = parseVocabularyEntry(primary([
    { definition: sense.definition, examples: sense.examples },
    { definition: 'A governing committee.', translations: [ru('совет')] },
  ]));
  assert.equal(parsed.example, sense.examples[0]);
  assert.equal(parsed.translation, '');
  assert.equal(parsed.definition, sense.definition);
});

test('fallback translation queries the selected definition rather than the bare word or other sense', async () => {
  let translatedQuery;
  const result = await lookupVocabulary('board', { fetchImpl: async url => {
    if (isTranslator(url)) {
      translatedQuery = new URL(url).searchParams.get('q');
      return response({ responseStatus: 200, responseData: { translatedText: 'Поверхность для письма.' } });
    }
    if (isPrimary(url)) return response(primary([
      { definition: sense.definition, examples: sense.examples },
      { definition: 'A governing committee.', translations: [ru('совет')] },
    ]));
    return missing();
  } });
  assert.equal(translatedQuery, sense.definition);
  assert.equal(result.translation, 'Поверхность для письма.');
  assert.equal(result.example, sense.examples[0]);
});

test('legacy fallback also translates only its selected example definition', async () => {
  let translatedQuery;
  const result = await lookupVocabulary('board', { fetchImpl: async url => {
    if (isTranslator(url)) { translatedQuery = new URL(url).searchParams.get('q'); return response({ responseStatus: 200, responseData: { translatedText: 'Доска для письма.' } }); }
    if (isPrimary(url)) return missing();
    return response([{ word: 'board', meanings: [{ definitions: [{ definition: 'An unrelated first sense.' }, { definition: sense.definition, example: sense.examples[0] }] }] }]);
  } });
  assert.equal(translatedQuery, sense.definition);
  assert.equal(result.example, sense.examples[0]);
});

test('unknown words never reach translation and remain distinct from network failures', async () => {
  let calls = 0;
  const absent = await lookupVocabulary('nonsense', { fetchImpl: async url => {
    calls++; assert.ok(!isTranslator(url)); return missing();
  } });
  assert.equal(calls, 2);
  assert.equal(absent.status, 'not-found');
  assert.equal(absent.translation, '');
  assert.equal(absent.example, '');
  const confirmedAbsent = await lookupVocabulary('board', { fetchImpl: async url => {
    assert.ok(!isTranslator(url));
    if (isPrimary(url)) throw new Error('Network error');
    return missing();
  } });
  assert.equal(confirmedAbsent.status, 'not-found', 'one available dictionary can confirm no entry despite the other provider failing');
  const unavailable = await lookupVocabulary('board', { fetchImpl: async url => {
    assert.ok(!isTranslator(url));
    throw new Error('Network error');
  } });
  assert.equal(unavailable.status, 'unavailable');
});

test('empty Wiktionary entries remain not-found when the fallback returns a server error', async () => {
  const result = await lookupVocabulary('unlistedword', { fetchImpl: async url => {
    assert.ok(!isTranslator(url));
    return isPrimary(url) ? response({ word: 'unlistedword', entries: [] }) : { ok: false, status: 530 };
  } });
  assert.equal(result.status, 'not-found');
  assert.equal(result.translation, '');
  assert.equal(result.example, '');
});

test('known dictionary words without examples are still found', async () => {
  const result = await lookupVocabulary('board', { fetchImpl: async url => isPrimary(url)
    ? response(primary([{ definition: sense.definition, translations: [ru('доска')] }])) : missing() });
  assert.equal(result.status, 'found');
  assert.equal(result.translation, 'доска');
  assert.equal(result.example, '');
});

test('translation failure preserves a verified example without inventing Russian', async () => {
  const result = await lookupVocabulary('board', { fetchImpl: async url => {
    if (isTranslator(url)) throw new Error('Translation unavailable');
    return isPrimary(url) ? response(primary([{ definition: sense.definition, examples: sense.examples }])) : missing();
  } });
  assert.equal(result.status, 'found');
  assert.equal(result.translation, '');
  assert.equal(result.example, sense.examples[0]);
});

test('lookup cancellation aborts in-flight dictionary requests and rejects', async () => {
  const controller = new AbortController(), signals = [];
  const pending = lookupVocabulary('board', { signal: controller.signal, fetchImpl: (_url, { signal }) => {
    signals.push(signal);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test('complete primary result returns immediately and aborts a pending fallback', async () => {
  let fallbackSignal;
  const result = await lookupVocabulary('board', { fetchImpl: async (url, { signal }) => {
    if (isPrimary(url)) return response(primary([sense]));
    assert.ok(!isTranslator(url));
    fallbackSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  assert.equal(result.translation, 'доска');
  assert.equal(result.example, sense.examples[0]);
  assert.ok(fallbackSignal.aborted, 'a slow fallback must not delay or outlive a complete primary result');
});

test('fallback example replaces the entire example-less primary sense', async () => {
  const fallbackDefinition = 'A group of people managing an organization.';
  const fallbackExample = 'The board approved the proposal.';
  let query;
  const result = await lookupVocabulary('board', { fetchImpl: async url => {
    if (isTranslator(url)) {
      query = new URL(url).searchParams.get('q');
      return response({ responseStatus: 200, responseData: { translatedText: 'Группа людей, управляющих организацией.' } });
    }
    if (isPrimary(url)) return response(primary([{ definition: sense.definition, translations: [ru('доска')] }]));
    return response([{ word: 'board', meanings: [{ definitions: [{ definition: fallbackDefinition, example: fallbackExample }] }] }]);
  } });
  assert.equal(query, fallbackDefinition);
  assert.equal(result.example, fallbackExample);
  assert.equal(result.definition, fallbackDefinition);
  assert.equal(result.translation, 'Группа людей, управляющих организацией.');
  assert.notEqual(result.translation, 'доска');
  assert.equal(result.exampleSource, undefined, 'fallback text must not inherit another provider’s attribution');
});

test('sentence selection prefers complete examples before fragments across and within senses', () => {
  const fragment = { definition: 'A surface.', examples: ['a wooden board'], translations: [ru('доска')] };
  const fullSentence = 'The board approved the proposal.';
  const committee = { definition: 'A governing committee.', examples: ['board members', fullSentence] };
  const parsed = parseVocabularyEntry(primary([fragment, committee]));
  assert.equal(parsed.example, fullSentence);
  assert.equal(parsed.definition, committee.definition);
  assert.equal(parsed.translation, '', 'better sentence must not borrow a fragment sense’s translation');
  const translated = parseVocabularyEntry(primary([fragment, { ...committee, translations: [ru('сове\u0301т')] }]));
  assert.equal(translated.example, fullSentence);
  assert.equal(translated.translation, 'совет');
});

const hebrewEntry = (senses, extra = {}) => ({ word: 'שלום', entries: [{ language: { code: 'he', name: 'Hebrew' }, senses }], source: { url: 'https://en.wiktionary.org/wiki/שלום' }, ...extra });
const hebrewSentence = 'אני רוצה לחיות בשלום.';

test('Hebrew lookup returns a same-sense Russian meaning and Hebrew sentence without English fallback', async () => {
  const calls = [];
  const result = await lookupVocabulary('שָׁלוֹם', { language: 'he', fetchImpl: async url => {
    calls.push(url);
    assert.equal(decodeURIComponent(new URL(url).pathname), '/api/v1/entries/he/שלום');
    assert.equal(new URL(url).searchParams.get('translations'), 'true');
    return response(hebrewEntry([{ definition: 'Peace.', examples: [hebrewSentence], translations: [ru('мир')] }]));
  } });
  assert.equal(calls.length, 1);
  assert.equal(result.status, 'found');
  assert.equal(result.translation, 'мир');
  assert.equal(result.example, hebrewSentence);
  assert.equal(result.exampleSource, 'https://en.wiktionary.org/wiki/שלום');
});

test('Hebrew entries never autofill English examples or use a different language entry', () => {
  const data = hebrewEntry([{ definition: 'Peace.', examples: ['We all want lasting peace.'], translations: [ru('мир')] }]);
  data.entries.unshift({ language: { code: 'en' }, senses: [{ definition: 'An English sense.', examples: ['An English example sentence here.'], translations: [ru('ошибка')] }] });
  const parsed = parseVocabularyEntry(data, { language: 'he' });
  assert.equal(parsed.definition, 'Peace.');
  assert.equal(parsed.translation, 'мир');
  assert.equal(parsed.example, '');
  const wrongLanguageOnly = parseVocabularyEntry({ entries: [data.entries[0]] }, { language: 'he' });
  assert.equal(wrongLanguageOnly, null);
});

test('Hebrew parser prefers Hebrew sentences over English sentences and Hebrew fragments', () => {
  const parsed = parseVocabularyEntry(hebrewEntry([
    { definition: 'Greeting.', examples: ['שלום', 'Hello there my good friend.'], translations: [ru('привет')] },
    { definition: 'Peace.', examples: ['שלום בעולם', hebrewSentence], translations: [ru('мир')] },
  ]), { language: 'he' });
  assert.equal(parsed.example, hebrewSentence);
  assert.equal(parsed.translation, 'мир');
  assert.equal(parsed.definition, 'Peace.');
});

test('Hebrew dictionary English definition is translated to Russian without a bare-word request', async () => {
  const calls = [];
  const result = await lookupVocabulary('שלום', { language: 'he', fetchImpl: async url => {
    calls.push(url);
    if (isTranslator(url)) {
      assert.equal(new URL(url).searchParams.get('q'), 'peace');
      assert.equal(new URL(url).searchParams.get('langpair'), 'en|ru');
      return response({ responseStatus: 200, responseData: { translatedText: 'мир' } });
    }
    assert.ok(isPrimary(url), 'English legacy provider must never receive Hebrew terms');
    return response(hebrewEntry([{ definition: '(uncountable) peace', examples: [hebrewSentence], translations: [] }]));
  } });
  assert.equal(calls.length, 2);
  assert.equal(result.translation, 'мир');
  assert.equal(result.example, hebrewSentence);
});

test('unknown Hebrew uses only the Hebrew dictionary and never an English fallback or translator', async () => {
  for (const unavailable of [false, true]) {
    let calls = 0;
    const result = await lookupVocabulary('מילהלאקיימת', { language: 'he', fetchImpl: async url => {
      calls++;
      assert.ok(isPrimary(url));
      assert.ok(new URL(url).pathname.includes('/entries/he/'));
      if (unavailable) throw new Error('Offline');
      return response({ word: 'מילהלאקיימת', entries: [] });
    } });
    assert.equal(calls, 1);
    assert.equal(result.status, unavailable ? 'unavailable' : 'not-found');
    assert.equal(result.translation, '');
    assert.equal(result.example, '');
  }
});

test('Hebrew exact-headword matching ignores niqqud but rejects unrelated dictionary results', async () => {
  const result = await lookupVocabulary('שלום', { language: 'he', fetchImpl: async () => response(hebrewEntry([
    { definition: 'Peace.', examples: [hebrewSentence], translations: [ru('мир')] },
  ], { word: 'שָׁלוֹם' })) });
  assert.equal(result.status, 'found');
  const wrong = await lookupVocabulary('שלום', { language: 'he', fetchImpl: async () => response(hebrewEntry([
    { definition: 'Book.', translations: [ru('книга')] },
  ], { word: 'ספר' })) });
  assert.equal(wrong.status, 'not-found');
});

test('known Hebrew without a Hebrew example keeps Russian meaning and does not borrow English', async () => {
  let calls = 0;
  const result = await lookupVocabulary('שלום', { language: 'he', fetchImpl: async () => {
    calls++;
    return response(hebrewEntry([{ definition: 'Peace.', examples: ['Peace is what we need.'], translations: [ru('мир')] }]));
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'found');
  assert.equal(result.example, '');
  assert.equal(result.translation, 'мир');
});
