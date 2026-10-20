export const cleanCell = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
export const normalizeWord = value => cleanCell(value).normalize('NFKC').toLocaleLowerCase('en');
export const findDuplicate = (words, term, editingId = null) => words.find(w=>w.id!==editingId && normalizeWord(w.word)===normalizeWord(term));
export function toTSV(words) {
  return words.map(w => `${cleanCell(w.word)}\t${[cleanCell(w.translation), cleanCell(w.example),w.exampleSource?`Example: ${cleanCell(w.exampleSource)} (CC BY-SA 4.0)`:''].filter(Boolean).join(' — ')}`).join('\n');
}
export function createExportPayload(words) {
  return { ids: words.map(w=>w.id), count: words.length, text: toTSV(words) };
}
export function chooseWords(words, { count, order = 'oldest', onlyNew = false }, random = Math.random) {
  const list = words.filter(w => !onlyNew || !w.exportedAt).sort((a,b) => a.createdAt - b.createdAt);
  if (order === 'newest') list.reverse();
  if (order === 'random') for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.slice(0, Math.max(0, Math.floor(Number(count) || 0)));
}
export function validateBackup(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.words) || input.words.length > 50000) throw new Error('This is not a valid Marginalia backup.');
  const ids = new Set();
  return input.words.map(w => {
    if (!w || typeof w.id !== 'string' || !w.id || ids.has(w.id) || typeof w.word !== 'string' || !w.word.trim() || w.word.length > 100 || !Number.isFinite(w.createdAt)) throw new Error('The backup contains an invalid word.');
    for (const [key,max] of [['translation',1000],['example',2000],['book',160]]) if (typeof w[key] !== 'string' || w[key].length > max) throw new Error('The backup contains invalid fields.');
    if (!w.translation.trim() && !w.example.trim()) throw new Error('A word needs a meaning or example.');
    if (w.exportedAt != null && !Number.isFinite(w.exportedAt)) throw new Error('Invalid export date.');
    if (w.exampleSource != null && (typeof w.exampleSource !== 'string' || w.exampleSource.length>1000 || !w.exampleSource.startsWith('https://en.wiktionary.org/wiki/'))) throw new Error('Invalid example source.');
    ids.add(w.id);
    return { id:w.id, word:w.word.trim(), translation:w.translation, example:w.example, book:w.book, createdAt:w.createdAt, ...(w.exportedAt != null ? {exportedAt:w.exportedAt} : {}), ...(w.exampleSource ? {exampleSource:w.exampleSource} : {}) };
  });
}
