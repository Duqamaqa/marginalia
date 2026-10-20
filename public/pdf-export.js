import { PDFDocument, rgb, PageSizes } from './vendor/pdf-lib.esm.min.js';
import fontkit from './vendor/fontkit.es.min.js';
import { cleanCell } from './core.js';

let fontRequest;
async function loadFont() {
  if (!fontRequest) {
    fontRequest = fetch(new URL('./vendor/NotoSans-Regular.ttf', import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error('The PDF font could not be loaded. Try again while online.');
        return response.arrayBuffer();
      }).catch(error => { fontRequest = undefined; throw error; });
  }
  return fontRequest;
}

// Measure the actual embedded font, including Cyrillic and long unbroken URLs.
function wrap(text, font, size, width) {
  const result = [];
  let line = '';
  for (const word of cleanCell(text).split(' ').filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
    if (line) { result.push(line); line = ''; }
    const letters = Array.from(word);
    while (letters.length && font.widthOfTextAtSize(letters.join(''), size) > width) {
      let low = 1, high = letters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (font.widthOfTextAtSize(letters.slice(0, middle).join(''), size) <= width) low = middle;
        else high = middle - 1;
      }
      result.push(letters.splice(0, low).join(''));
    }
    line = letters.join('');
  }
  if (line) result.push(line);
  return result;
}

export async function createVocabularyPdf(words, { fontBytes, title = 'Marginalia vocabulary' } = {}) {
  if (!Array.isArray(words) || !words.length) throw new Error('Choose at least one word to export.');
  // Capture the collection before font loading yields to other app interactions.
  const records = words.map(word => ({
    word: cleanCell(word.word), translation: cleanCell(word.translation),
    example: cleanCell(word.example), book: cleanCell(word.book), source: cleanCell(word.exampleSource),
  }));
  if (records.some(record => !record.word || (!record.translation && !record.example))) {
    throw new Error('Each exported word needs a term and a translation or example.');
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes || await loadFont(), { subset: true });
  const documentTitle = cleanCell(title) || 'Marginalia vocabulary';
  pdf.setTitle(documentTitle);
  pdf.setAuthor('Marginalia');
  pdf.setSubject('English vocabulary with Russian translations and examples');
  pdf.setCreator('Marginalia');
  pdf.setLanguage('en');

  const [pageWidth, pageHeight] = PageSizes.A4;
  const margin = 48, width = pageWidth - margin * 2, bottom = 54;
  const ink = rgb(.12, .14, .16), muted = rgb(.37, .40, .43), rule = rgb(.86, .88, .89);
  let page, y;
  const draw = (text, size, color = ink) => page.drawText(text, { x: margin, y, size, font, color });
  function newPage(recordNumber) {
    page = pdf.addPage(PageSizes.A4);
    y = pageHeight - margin;
    // Bound the presentation heading; full caller-supplied title remains PDF metadata.
    const heading = wrap(documentTitle, font, 18, width);
    for (const line of heading.slice(0, 2)) { draw(line, 18); y -= 24; }
    draw(`${records.length} ${records.length === 1 ? 'word' : 'words'} | English / Russian`, 9, muted); y -= 19;
    draw('Create one flashcard per numbered record. Use Term as the front;', 9, muted); y -= 13;
    draw('use its translation and example as the back. Do not add other terms.', 9, muted); y -= 15;
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: .6, color: rule });
    y -= 24;
    if (recordNumber) { draw(`Record ${recordNumber} (continued)`, 9, muted); y -= 21; }
  }
  function field(label, value, recordNumber, size = 11) {
    if (!value) return;
    const lines = wrap(value, font, size, width);
    if (y - 33 < bottom) newPage(recordNumber);
    draw(label, 8.5, muted); y -= 16;
    for (const line of lines) {
      if (y < bottom) { newPage(recordNumber); draw(`${label} (continued)`, 8.5, muted); y -= 16; }
      draw(line, size); y -= 16;
    }
    y -= 10;
  }

  newPage();
  records.forEach((record, index) => {
    if (index) {
      if (y - 100 < bottom) newPage();
      else {
        page.drawLine({ start: { x: margin, y: y + 1 }, end: { x: pageWidth - margin, y: y + 1 }, thickness: .4, color: rule });
        y -= 20;
      }
    }
    field(`${index + 1}. Term`, record.word, index + 1, 13);
    field('Russian translation', record.translation, index + 1);
    field('English example', record.example, index + 1);
    field('Book', record.book, index + 1, 9);
    if (record.source) field('Example source (CC BY-SA 4.0)', record.source, index + 1, 8);
  });
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    const number = `${index + 1} / ${pages.length}`;
    current.drawText(number, { x: pageWidth - margin - font.widthOfTextAtSize(number, 8), y: 27, size: 8, font, color: muted });
  });
  return pdf.save();
}
