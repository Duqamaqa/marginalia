import { PDFDocument, rgb, PageSizes, PDFOperator, PDFName, PDFHexString, beginText, endText, setFontAndSize, setTextMatrix, showText } from './vendor/pdf-lib.esm.min.js';
import fontkit from './vendor/fontkit.es.min.js';
import bidiFactory from './vendor/bidi.es.min.js';
const bidi = bidiFactory();
const hebrewPattern = /[\u0590-\u05ff\ufb1d-\ufb4f]/;
const graphemes = new Intl.Segmenter('he', {granularity:'grapheme'});
import { cleanCell } from './core.js';

const fontRequests = new Map();
async function loadFont(name = 'NotoSans-Regular.ttf') {
  if (!fontRequests.has(name)) {
    fontRequests.set(name, fetch(new URL(`./vendor/${name}`, import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error('The PDF font could not be loaded. Try again while online.');
        return response.arrayBuffer();
      }).catch(error => { fontRequests.delete(name); throw error; }));
  }
  return fontRequests.get(name);
}

// Measure the actual embedded font, including Cyrillic and long unbroken URLs.
function wrap(text, measure, size, width) {
  const result = [];
  let line = '';
  for (const word of cleanCell(text).split(' ').filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size) <= width) { line = candidate; continue; }
    if (line) { result.push(line); line = ''; }
    const letters = Array.from(graphemes.segment(word), part => part.segment);
    while (letters.length && measure(letters.join(''), size) > width) {
      let low = 1, high = letters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (measure(letters.slice(0, middle).join(''), size) <= width) low = middle;
        else high = middle - 1;
      }
      result.push(letters.splice(0, low).join(''));
    }
    line = letters.join('');
  }
  if (line) result.push(line);
  return result;
}

export async function createVocabularyPdf(words, { fontBytes, hebrewFontBytes, title = 'Marginalia vocabulary' } = {}) {
  if (!Array.isArray(words) || !words.length) throw new Error('Choose at least one word to export.');
  // Capture the collection before font loading yields to other app interactions.
  const records = words.map(word => ({
    language: word.language === 'he' ? 'he' : 'en',
    word: cleanCell(word.word), translation: cleanCell(word.translation),
    example: cleanCell(word.example), book: cleanCell(word.book), source: cleanCell(word.exampleSource),
  }));
  if (records.some(record => !record.word || (!record.translation && !record.example))) {
    throw new Error('Each exported word needs a term and a translation or example.');
  }
  const language = records[0].language;
  if (records.some(record => record.language !== language)) throw new Error('Export one vocabulary language at a time.');
  const sourceLanguage = language === 'he' ? 'Hebrew' : 'English';
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes || await loadFont(), { subset: true });
  const needsHebrew = records.some(record => Object.values(record).some(value => hebrewPattern.test(value))) || hebrewPattern.test(title);
  const hebrewFont = needsHebrew ? await pdf.embedFont(hebrewFontBytes || await loadFont('NotoSansHebrew-Regular.ttf'), {subset:true}) : null;
  const fontFor = value => hebrewPattern.test(value) ? hebrewFont : font;
  const segments = value => Array.from(graphemes.segment(value));
  const measure = (value, size) => hebrewPattern.test(value)
    ? segments(value).reduce((sum, part) => sum + fontFor(part.segment).widthOfTextAtSize(part.segment, size), 0)
    : font.widthOfTextAtSize(value, size);
  const documentTitle = cleanCell(title) || 'Marginalia vocabulary';
  pdf.setTitle(documentTitle);
  pdf.setAuthor('Marginalia');
  pdf.setSubject(`${sourceLanguage} vocabulary with Russian translations and examples`);
  pdf.setCreator('Marginalia');
  pdf.setLanguage(language);

  const [pageWidth, pageHeight] = PageSizes.A4;
  const margin = 48, width = pageWidth - margin * 2, bottom = 54;
  const ink = rgb(.12, .14, .16), muted = rgb(.37, .40, .43), rule = rgb(.86, .88, .89);
  let page, y;
  const draw = (value, size, color = ink, direction) => {
    if (!hebrewPattern.test(value)) { page.drawText(value, {x:direction==='rtl'?pageWidth-margin-measure(value,size):margin,y,size,font,color}); return; }
    const levels = bidi.getEmbeddingLevels(value, direction);
    const indices = Array.from({length:value.length}, (_unused,index)=>index);
    for (const [start,end] of bidi.getReorderSegments(value,levels)) {
      const reversed=indices.slice(start,end+1).reverse();indices.splice(start,end-start+1,...reversed);
    }
    const parts=segments(value), owners=[];
    parts.forEach((part,index)=>{for(let offset=0;offset<part.segment.length;offset++)owners[part.index+offset]=index;});
    const seen=new Set(), visual=[];
    const mirrors=bidi.getMirroredCharactersMap(value,levels.levels);
    for(const index of indices){const owner=owners[index];if(seen.has(owner))continue;seen.add(owner);const part=parts[owner];visual.push({owner, text:mirrors.get(part.index)||part.segment});}
    const rtl=direction==='rtl'||(!direction&&levels.paragraphs[0]?.level%2===1);
    let x=rtl?pageWidth-margin-measure(value,size):margin;
    // ActualText retains the complete logical Unicode line for PDF import/extraction,
    // while the glyphs below follow visual bidi order and keep combining marks attached.
    page.pushOperators(PDFOperator.of('BDC',[PDFName.of('Span'),pdf.context.obj({ActualText:PDFHexString.fromText(value)})]));
    const positioned=visual.map(part=>{const face=fontFor(part.text),position={...part,face,x};x+=face.widthOfTextAtSize(part.text,size);return position;});
    page.pushOperators(beginText());
    // Emit in logical reading order while positioning in visual order. This also
    // supports extraction engines that do not implement the ActualText span.
    for(const part of positioned.sort((a,b)=>a.owner-b.owner)){
      const resource=page.node.newFontDictionary(part.face.name,part.face.ref);
      page.pushOperators(setFontAndSize(resource,size),setTextMatrix(1,0,0,1,part.x,y),showText(part.face.encodeText(part.text)));
    }
    page.pushOperators(endText());
    page.pushOperators(PDFOperator.of('EMC'));
  };
  function newPage(recordNumber) {
    page = pdf.addPage(PageSizes.A4);
    y = pageHeight - margin;
    // Bound the presentation heading; full caller-supplied title remains PDF metadata.
    const heading = wrap(documentTitle, measure, 18, width);
    for (const line of heading.slice(0, 2)) { draw(line, 18); y -= 24; }
    draw(`${records.length} ${records.length === 1 ? 'word' : 'words'} | ${sourceLanguage} / Russian`, 9, muted); y -= 19;
    draw('Create one flashcard per numbered record. Use Term as the front;', 9, muted); y -= 13;
    draw('use the meaning and sentence as the back, without field labels.', 9, muted); y -= 13;
    draw('Do not add other terms or labels such as Translation or Example.', 9, muted); y -= 15;
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: .6, color: rule });
    y -= 24;
    if (recordNumber) { draw(`Record ${recordNumber} (continued)`, 9, muted); y -= 21; }
  }
  function field(label, value, recordNumber, size = 11, direction) {
    if (!value) return;
    const lines = wrap(value, measure, size, width);
    if (y - 33 < bottom) newPage(recordNumber);
    if (label) { draw(label, 8.5, muted); y -= 16; }
    for (const line of lines) {
      if (y < bottom) { newPage(recordNumber); if (label) { draw(`${label} (continued)`, 8.5, muted); y -= 16; } }
      draw(line, size, ink, direction); y -= 16;
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
    field(`${index + 1}. Term`, record.word, index + 1, 13, language==='he'?'rtl':undefined);
    field('', record.translation, index + 1);
    field('', record.example, index + 1, 11, language==='he'?'rtl':undefined);
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
