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
