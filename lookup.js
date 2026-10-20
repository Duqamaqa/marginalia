function text(value) { return typeof value === 'string' ? value.trim() : ''; }
export function parseWiktionary(data) {
  const flatten = senses => (Array.isArray(senses) ? senses : []).flatMap(s => [s, ...flatten(s.subsenses)]);
  const senses=(data?.entries || []).flatMap(entry => flatten(entry.senses));
  const sense=senses.find(s => s.examples?.some(e => text(e)));
  return {example:text(sense?.examples.find(e=>text(e))), definition:text((sense||senses[0])?.definition), ...(data?.source?.url ? {exampleSource:data.source.url} : {})};
}
export function parseLegacy(data) {
  const definitions=(Array.isArray(data)?data:[]).flatMap(e=>(e.meanings||[]).flatMap(m=>m.definitions||[]));
  const sense=definitions.find(d=>text(d.example));
  return {example:text(sense?.example),definition:text((sense||definitions[0])?.definition)};
}
export async function dictionaryExample(term, {signal,fetchImpl=fetch}={}) {
  const controllers=[];
  const providers=[
    [`https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(term)}`,parseWiktionary],
    [`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`,parseLegacy]
  ];
  try {
    return await Promise.any(providers.map(async ([url,parse])=>{
      const controller=new AbortController();controllers.push(controller);
      const abort=()=>controller.abort();
      if(signal?.aborted)controller.abort(); else signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,7000);
      try {
        const response=await fetchImpl(url,{signal:controller.signal});
        if(!response.ok)throw new Error('Dictionary request failed.');
        const result=parse(await response.json());
        if(!result.example)throw new Error('This entry has no example sentence.');
        return result;
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }));
  } finally {controllers.forEach(c=>c.abort());}
}

// Keep the Russian meaning and English sentence attached to one dictionary sense.
export function parseVocabularyEntry(data) {
  const flatten = senses => (Array.isArray(senses) ? senses : []).flatMap(s => [s, ...flatten(s.subsenses)]);
  const russian = sense => [...new Set((sense.translations || [])
    .filter(t => t.language?.code === 'ru').map(t => text(t.word).normalize('NFC').replace(/\u0301/g, '')).filter(Boolean))].join('; ');
  const senses = (data?.entries || []).flatMap(entry => flatten(entry.senses)).filter(s => text(s.definition));
  const sentence = s => s.examples?.find(e => /[.!?][’”"']?$/.test(text(e)) && text(e).split(/\s+/).length >= 4);
  const hasExample = s => s.examples?.some(e => text(e));
  const sense = senses.find(s => russian(s) && sentence(s)) || senses.find(sentence)
    || senses.find(s => russian(s) && hasExample(s)) || senses.find(hasExample)
    || senses.find(s => russian(s)) || senses[0];
  if (!sense) return null;
  return { definition: text(sense.definition), example: text(sentence(sense) || sense.examples?.find(e => text(e))),
    translation: russian(sense), ...(data?.source?.url?.startsWith('https://en.wiktionary.org/wiki/') ? {exampleSource: data.source.url} : {}) };
}

async function requestDictionary(url, parse, {signal, fetchImpl}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(abort, 7000);
  try {
    const response = await fetchImpl(url, {signal:controller.signal});
    if (response.status === 404) return {status:'not-found'};
    if (!response.ok) throw new Error('Dictionary unavailable');
    const entry = parse(await response.json());
    return entry?.definition ? {status:'found', ...entry} : {status:'not-found'};
  } catch { return {status:'unavailable'}; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
}

function decodeTranslation(value) {
  return text(value).replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code);
    return point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}

async function translateMeaning(definition, {signal,fetchImpl}) {
  // Grammatical tags such as (countable) are metadata, not part of the meaning.
  definition = definition.replace(/^(?:\([^)]*\)\s*)+/, '').trim();
  // MyMemory accepts at most 500 UTF-8 bytes. Never send an unrelated bare word.
  if (!definition || new TextEncoder().encode(definition).length > 500) return '';
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort,8000);
  try {
    const response = await fetchImpl(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(definition)}&langpair=en%7Cru`, {signal:controller.signal});
    if (!response.ok) return '';
    const data = await response.json();
    if (Number(data.responseStatus)!==200 || data.quotaFinished) return '';
    const translated = decodeTranslation(data.responseData?.translatedText);
    return /[а-яё]/i.test(translated) && translated.toLocaleLowerCase()!==definition.toLocaleLowerCase() ? translated : '';
  } catch { return ''; }
  finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
}

export async function lookupVocabulary(term, {signal,fetchImpl=fetch}={}) {
  const options = {signal,fetchImpl};
  const fallbackController = new AbortController(), abortFallback = () => fallbackController.abort();
  if (signal?.aborted) abortFallback(); else signal?.addEventListener('abort',abortFallback,{once:true});
  // Start the fallback immediately, but don't delay a successful primary for a slow fallback.
  const fallbackRequest = requestDictionary(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`, data => {
    const entries = Array.isArray(data) ? data.filter(e => text(e.word).toLocaleLowerCase()===term.trim().toLocaleLowerCase()) : [];
    return {...parseLegacy(entries),translation:''};
  }, {...options,signal:fallbackController.signal});
  try {
    const primary = await requestDictionary(`https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(term)}?translations=true`, data => {
      if (text(data?.word).toLocaleLowerCase() !== term.trim().toLocaleLowerCase()) return null;
      return parseVocabularyEntry(data);
    }, options);
    if (signal?.aborted) throw new DOMException('Aborted','AbortError');
    const fallback = primary.status==='found'&&primary.example ? null : await fallbackRequest;
    abortFallback();
    if (signal?.aborted) throw new DOMException('Aborted','AbortError');
    // Never borrow a translation from a different sense or provider.
    const entry = primary.status==='found'&&primary.example ? primary
      : fallback?.status==='found'&&fallback.example ? fallback
      : primary.status==='found' ? primary : fallback?.status==='found' ? fallback : null;
    if (!entry) return {status:(primary.status==='not-found'||fallback?.status==='not-found')?'not-found':'unavailable',translation:'',example:'',definition:''};
    const translation = entry.translation || await translateMeaning(entry.definition,options);
    if (signal?.aborted) throw new DOMException('Aborted','AbortError');
    return {...entry,translation};
  } finally {abortFallback();signal?.removeEventListener('abort',abortFallback);}
}
