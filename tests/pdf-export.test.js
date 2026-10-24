import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFHexString, decodePDFRawStream } from '../public/vendor/pdf-lib.esm.min.js';
import { createVocabularyPdf } from '../public/pdf-export.js';

const fontBytes = new Uint8Array(await readFile(new URL('../public/vendor/NotoSans-Regular.ttf', import.meta.url)));
const word = {
  word: 'discovery', translation: 'открытие; находка — «счастливая»',
  example: 'This discovery changed everything.', book: 'A book',
  exampleSource: 'https://en.wiktionary.org/wiki/discovery',
};

function unicodeMappings(pdf, page) {
  const resources = page.node.Resources();
  const fonts = resources.lookup(PDFName.of('Font'), PDFDict);
  return fonts.entries().map(([_key, reference]) => {
    const embeddedFont = pdf.context.lookup(reference);
    const unicode = embeddedFont.lookup(PDFName.of('ToUnicode'));
    assert.ok(unicode, 'embedded Unicode font needs a text-extraction map');
    return new TextDecoder().decode(decodePDFRawStream(unicode).decode());
  }).join('\n');
}

test('vocabulary PDF is a real A4 file with embedded extractable Cyrillic', async () => {
  const bytes = await createVocabularyPdf([word], { fontBytes });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), 'Marginalia vocabulary');
  const page = pdf.getPage(0);
  assert.ok(Math.abs(page.getWidth() - 595.28) < .1);
  assert.ok(Math.abs(page.getHeight() - 841.89) < .1);
  const mapping = unicodeMappings(pdf, page);
  assert.match(mapping, /043e/i, 'Cyrillic о must survive as Unicode, not an image');
  assert.match(mapping, /044f/i, 'Cyrillic я must survive as Unicode, not an image');
});

test('long vocabulary fields and unbroken source URLs produce additional usable pages', async () => {
  const records = Array.from({ length: 4 }, (_, index) => ({
    ...word,
    word: `long-record-${index + 1}`,
    translation: 'д'.repeat(1000),
    example: 'A long English example with meaningful context. '.repeat(43),
    exampleSource: `https://en.wiktionary.org/wiki/${'discovery'.repeat(100)}`,
  }));
  const pdf = await PDFDocument.load(await createVocabularyPdf(records, { fontBytes, title: 'My reading vocabulary' }));
  assert.ok(pdf.getPageCount() >= 4, 'large records must flow to further pages rather than clip');
  assert.equal(pdf.getTitle(), 'My reading vocabulary');
  for (const page of pdf.getPages()) {
    assert.ok(page.node.Contents(), 'each output page must contain rendered content');
    assert.ok(Math.abs(page.getWidth() - 595.28) < .1);
    assert.match(unicodeMappings(pdf, page), /0434/i);
  }
});

test('PDF generation rejects an empty selection or missing card meaning', async () => {
  await assert.rejects(createVocabularyPdf([], { fontBytes }), /at least one word/i);
  await assert.rejects(createVocabularyPdf([{ word: 'empty', translation: '', example: '' }], { fontBytes }), /translation or example/i);
});

const hebrewFontBytes = new Uint8Array(await readFile(new URL('../public/vendor/NotoSansHebrew-Regular.ttf', import.meta.url)));
function contentText(pdf) {
  return pdf.getPages().flatMap(page => page.node.Contents().asArray().map(ref =>
    new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref)).decode()))).join('\n');
}

test('Hebrew PDF embeds both scripts and retains logical Unicode text for RTL mixed sentences', async () => {
  const sentence = 'שלום עולם! יש לי 123 ספרים (books).';
  const bytes = await createVocabularyPdf([{language:'he', word:'שלום', translation:'мир; приветствие', example:sentence}], {fontBytes, hebrewFontBytes});
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.catalog.get(PDFName.of('Lang')).decodeText(), 'he');
  assert.match(pdf.getSubject(), /Hebrew vocabulary/);
  const mappings = unicodeMappings(pdf, pdf.getPage(0));
  assert.match(mappings, /05e9/i, 'Hebrew shin needs an extractable Unicode mapping');
  assert.match(mappings, /043c/i, 'Russian translation must keep its own supported font');
  const content = contentText(pdf);
  assert.ok(content.includes(PDFHexString.fromText('שלום').toString()), 'term ActualText stays logical');
  assert.ok(content.includes(PDFHexString.fromText(sentence).toString()), 'mixed sentence ActualText preserves original punctuation and digits');
  assert.ok(!content.includes('/ActualText <FEFF>'), 'no empty text spans');
});

test('Hebrew PDF snapshots records before async font work and handles niqqud and wrapped lines', async () => {
  const records = [{language:'he', word:'תַּגְלִית', translation:'открытие', example:'זאת תגלית חשובה מאוד. '.repeat(250)}];
  const pending = createVocabularyPdf(records, {fontBytes, hebrewFontBytes});
  records[0].word = 'changed';
  const pdf = await PDFDocument.load(await pending);
  assert.ok(pdf.getPageCount() > 1, 'long Hebrew sentences flow rather than clip');
  assert.ok(contentText(pdf).includes(PDFHexString.fromText('תַּגְלִית').toString()));
});

test('PDF rejects mixed vocabulary lists instead of mislabeling their language', async () => {
  await assert.rejects(createVocabularyPdf([word,{language:'he',word:'שלום',translation:'привет'}], {fontBytes,hebrewFontBytes}), /one vocabulary language/i);
});
