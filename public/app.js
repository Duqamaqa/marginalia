import { cleanCell, createExportPayload, chooseWords, validateBackup, findDuplicate, LANGUAGES, languageOf, wordsForLanguage } from './core.js';
import { lookupVocabulary } from './lookup.js';
const $ = id => document.getElementById(id);
const STORAGE = 'marginalia.words.v1';
let words = [], mode = 'both', revision = 0, lookupTimer, lookupController, toastTimer, editingId = null, editingSnapshot = null, exportSelection = [], storageHealthy = true, exampleSource = null;
const cache = new Map(), drafts = new Map();
let activeLanguage = 'en';
try { const saved = localStorage.getItem('marginalia.language.v1'); if(Object.hasOwn(LANGUAGES,saved))activeLanguage=saved; } catch {}
const activeWords = () => wordsForLanguage(words,activeLanguage);
const languageName = () => LANGUAGES[activeLanguage].name;
const hebrewStarter = {
  'שלום':{translation:'привет',example:'שלום, מה שלומך?',definition:'A greeting used when meeting someone.'},
};
const starter = {
  serendipity:{translation:'счастливая случайность',example:'Finding that little bookshop was pure serendipity.',definition:'An unexpected, fortunate discovery.'},
  ephemeral:{translation:'мимолётный; недолговечный',example:'The beauty of the sunset was ephemeral.',definition:'Lasting for only a short time.'},
  solace:{translation:'утешение',example:'She found solace in the familiar pages of her favorite book.',definition:'Comfort in a time of sadness or distress.'},
  profound:{translation:'глубокий',example:'The book had a profound effect on the way she saw the world.',definition:'Very deep or intense.'},
  linger:{translation:'задерживаться; медлить',example:'The scent of coffee lingered in the room.',definition:'To remain longer than expected.'},
};
function toast(message, action) {
  clearTimeout(toastTimer); $('toast').textContent = message;
  if (action) { const b=document.createElement('button'); b.textContent='Undo'; b.onclick=()=>{action(); $('toast').classList.remove('visible');}; $('toast').append(b); }
  $('toast').classList.add('visible'); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),action?8000:4500);
}
function commit(next, recover = false) {
  if (!storageHealthy && !recover) { toast('Back up the unreadable data first, then restore a valid backup to continue.'); return false; }
  try { const valid=validateBackup({version:1,words:next}); localStorage.setItem(STORAGE, JSON.stringify({version:1,words:valid})); words=valid; storageHealthy=true; render(); return true; }
  catch { toast('Couldn’t save on this device. Free up browser storage and try again.'); return false; }
}
try { const saved=localStorage.getItem(STORAGE); if(saved) words=validateBackup(JSON.parse(saved)); } catch { storageHealthy=false; toast('Your saved data could not be read. Back it up, then restore a valid backup.'); }
function el(tag, cls, content) { const n=document.createElement(tag); if(cls)n.className=cls; if(content!=null)n.textContent=content; return n; }
function updateLanguageControls(){
  const language=LANGUAGES[activeLanguage];
  $('language-choice').value=activeLanguage;
  $('word-label').textContent=`${language.name} word`;$('word').placeholder=language.placeholder;
  $('example-label').textContent=`${language.name} example`;
  for(const id of ['word','example']){$(id).lang=activeLanguage;$(id).dir=language.dir;}
  $('intro-copy').textContent=`Type ${activeLanguage==='en'?'an English':'a Hebrew'} word, save its Russian meaning, then export words to study.`;
  $('collection-help').textContent=`Your ${language.name} list. Export to practice in Quizlet or Knowt.`;
  const tabs=$('language-tabs');tabs.replaceChildren();
  for(const [code,details] of Object.entries(LANGUAGES)){
    const count=wordsForLanguage(words,code).length;if(!count)continue;
    const button=el('button','language-tab');button.type='button';
    button.setAttribute('aria-pressed',String(code===activeLanguage));button.setAttribute('aria-label',`${details.name}, ${count} ${count===1?'word':'words'}`);
    button.append(el('span','',details.name),el('span','language-count',String(count)));button.onclick=()=>switchLanguage(code);tabs.append(button);
  }
  tabs.hidden=!tabs.childElementCount;
}
function switchLanguage(next){
  if(!Object.hasOwn(LANGUAGES,next)||next===activeLanguage)return;
  drafts.set(activeLanguage,{word:$('word').value,translation:$('translation').value,example:$('example').value,book:$('book').value,mode,editingId,editingSnapshot,exampleSource,definition:$('definition').textContent,status:$('lookup-status').textContent});
  clearTimeout(lookupTimer);lookupController?.abort();revision++;
  if($('export-dialog').open)$('export-dialog').close();exportRevision++;clearPdf();exportSelection=[];
  activeLanguage=next;try{localStorage.setItem('marginalia.language.v1',next);}catch{}
  const draft=drafts.get(next);editingId=draft?.editingId||null;editingSnapshot=draft?.editingSnapshot||null;
  for(const id of ['word','translation','example','book'])$(id).value=draft?.[id]||'';
  $('definition').textContent=draft?.definition||'';setExampleSource(draft?.exampleSource);
  $('lookup-status').textContent=draft?.status||'Lookups are automatic. You can edit the results.';
  $('example-status').textContent='';$('cancel-edit').hidden=!editingId;$('save').textContent=editingId?'Save changes':'Save word';
  $('search').value='';setMode(draft?.mode||'both');render();
  if($('word').value.trim()&&!$('translation').value.trim()&&!$('example').value.trim())lookupTimer=setTimeout(lookup,550);
}
$('language-choice').onchange=event=>switchLanguage(event.target.value);
function render() {
  updateLanguageControls();updateDuplicate();
  const currentWords=activeWords();
  $('word-count').textContent=String(currentWords.length);
  $('word-count').setAttribute('aria-label',`${currentWords.length} saved ${currentWords.length===1?'word':'words'}`);
  $('collection-tools').hidden=!currentWords.length;
  $('export-open').disabled=!currentWords.length;
  const waiting=currentWords.filter(w=>!w.exportedAt).length;
  $('collection-note').textContent=`${waiting} not exported yet.`;
  $('collection-note').hidden=!currentWords.length;
  const q=$('search').value.trim().toLocaleLowerCase();
  const list=currentWords.filter(w=>[w.word,w.translation,w.example,w.book].some(x=>x.toLocaleLowerCase().includes(q)));
  list.sort($('sort').value==='alphabetical'?(a,b)=>a.word.localeCompare(b.word,activeLanguage):$('sort').value==='oldest'?(a,b)=>a.createdAt-b.createdAt:(a,b)=>b.createdAt-a.createdAt);
  $('word-list').replaceChildren();
  if(!list.length) {
    const empty=el('div','empty-state'); empty.append(el('h3','',currentWords.length?'No matching words':'No saved words yet'),el('p','',currentWords.length?'Try another word or book title.':'Enter a word, then tap Save word.')); $('word-list').append(empty); return;
  }
  list.forEach(w=>{
    const card=el('article','word-card'); const top=el('div','word-card-top'); const heading=el('h3','',w.word);heading.lang=languageOf(w);heading.dir=LANGUAGES[languageOf(w)].dir;top.append(heading);
    const actions=el('details','word-actions');actions.name='word-actions';
    const trigger=el('summary','','···');trigger.setAttribute('aria-label',`Actions for ${w.word}`);
    const menu=el('div','word-menu-items');
    actions.addEventListener('click',e=>{if(e.target.closest('button'))actions.open=false;});
    const speak=el('button','','Listen'); speak.type='button'; speak.setAttribute('aria-label',`Pronounce ${w.word}`); speak.onclick=()=>{if(!('speechSynthesis' in window))return toast('Pronunciation is unavailable in this browser.'); speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(w.word);u.lang=LANGUAGES[languageOf(w)].voice;u.rate=.85;speechSynthesis.speak(u);};
    const edit=el('button','','Edit');edit.setAttribute('aria-label',`Edit ${w.word}`); edit.onclick=()=>editWord(w);
    const remove=el('button','','Delete');remove.setAttribute('aria-label',`Delete ${w.word}`);remove.onclick=()=>{if(commit(words.filter(x=>x.id!==w.id)))toast(`“${w.word}” removed.`,()=>{if(!words.some(x=>x.id===w.id))commit([...words,w]);});};
    menu.append(speak,edit,remove);actions.append(trigger,menu);top.append(actions);card.append(top);
    if(w.translation){const t=el('p','translation',w.translation);t.lang='ru';card.append(t);}
    if(w.example){const example=el('p','example',w.example);example.lang=languageOf(w);example.dir=LANGUAGES[languageOf(w)].dir;card.append(example);}
    if(w.exampleSource){const source=el('a','example-source','Wiktionary · CC BY-SA 4.0');source.href=w.exampleSource;source.target='_blank';source.rel='noopener';card.append(source);}
    const meta=[w.book,w.exportedAt?'Exported':''].filter(Boolean).join(' · '); if(meta)card.append(el('p','book',meta));
    $('word-list').append(card);
  });
}
function setMode(next) { mode=next;updateOptionsSummary();document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));$('translation-block').hidden=mode==='example';$('example-block').hidden=mode==='translation';updateDuplicate(); }
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
function editWord(w) {
  clearTimeout(lookupTimer);lookupController?.abort();revision++;editingId=w.id;editingSnapshot=JSON.stringify({...w,exportedAt:undefined});
  $('word').value=w.word;$('translation').value=w.translation;$('example').value=w.example;$('book').value=w.book;$('definition').textContent='';
  setExampleSource(w.exampleSource);$('example-status').textContent='';updateDuplicate();
  setMode(w.translation&&w.example?'both':w.translation?'translation':'example');$('cancel-edit').hidden=false;$('save').innerHTML='Save changes';$('lookup-status').textContent='Editing a saved word. Changes will update this entry.';$('word').focus();$('capture').scrollIntoView({behavior:'smooth'});
}
function setExampleSource(url) {exampleSource=url||null;$('example-source').hidden=!exampleSource;if(exampleSource)$('example-source').href=exampleSource;}
function updateOptionsSummary(){
  const parts=[];if($('book').value.trim())parts.push(`Book: ${$('book').value.trim()}`);
  if(mode!=='both')parts.push(mode==='translation'?'Translation only':'Example only');
  $('options-summary').textContent=parts.length?parts.join(' · '):'Book & save options';
}
$('book').addEventListener('input',updateOptionsSummary);
function updateDuplicate() {
  const hasWord=Boolean($('word').value.trim());
  $('entry-details').hidden=!hasWord;
  $('starter-hint').hidden=hasWord||activeWords().length>0;
  updateOptionsSummary();
  const existing=findDuplicate(words,$('word').value,editingId,activeLanguage);
  $('duplicate-notice').hidden=!existing;
  $('duplicate-message').textContent=existing?`“${existing.word}” is already in your collection.`:'';
  const hasMeaning=(mode!=='example'&&Boolean($('translation').value.trim()))||(mode!=='translation'&&Boolean($('example').value.trim()));
  $('save').disabled=!hasWord||Boolean(existing)||!hasMeaning;
  $('edit-existing').onclick=()=>{const saved=findDuplicate(words,$('word').value,editingId,activeLanguage);if(saved)editWord(saved);};
  return existing;
}
function clearMeaning(){ $('translation').value='';$('example').value='';$('definition').textContent='';$('example-status').textContent='';setExampleSource(null); }
function meaningEdited(){
  clearTimeout(lookupTimer);lookupController?.abort();revision++;
  $('lookup-status').textContent=($('translation').value.trim()||$('example').value.trim())?'Your meaning is ready. Review it, then save.':'Add your own translation or example to save this word.';
  $('example-status').textContent='';updateDuplicate();
}
$('translation').addEventListener('input',meaningEdited);
$('example').addEventListener('input',()=>{if(!$('example').value.trim())setExampleSource(null);meaningEdited();});
$('cancel-edit').onclick=()=>{clearTimeout(lookupTimer);lookupController?.abort();revision++;editingId=null;$('cancel-edit').hidden=true;$('word').value='';clearMeaning();updateDuplicate();$('save').innerHTML='Save word';$('lookup-status').textContent='Lookups are automatic. You can edit the results.';$('word').focus();};
async function lookup() {
  const term=$('word').value.trim();if(!term)return;
  clearTimeout(lookupTimer);lookupController?.abort();lookupController=new AbortController();
  const current=++revision,signal=lookupController.signal,language=activeLanguage;
  const cacheKey=`${language}:${term.toLowerCase()}`;
  const active=()=>current===revision&&language===activeLanguage&&term===$('word').value.trim();
  clearMeaning();updateDuplicate();
  $('lookup-status').textContent='Finding a matching meaning and example…';
  let result=cache.get(cacheKey)||(activeLanguage==='en'?starter[term.toLowerCase()]:hebrewStarter[term]);
  try {
    if(!result){
      result=await lookupVocabulary(term,{signal,language});
      if(result.translation&&result.example)cache.set(cacheKey,result);
    }
  } catch {if(!active())return;result={status:'unavailable'};}
  if(!active())return;
  // Apply a complete sense together; never display a translation from a different request.
  $('translation').value=(result.translation||'').slice(0,1000);
  $('example').value=(result.example||'').slice(0,2000);
  $('definition').textContent=result.definition||'';setExampleSource(result.exampleSource);
  if(result.status==='not-found'){
    $('lookup-status').textContent='Word not found in the available dictionaries. Check the spelling, or enter your own translation or example to save it.';
  }else if(result.status==='unavailable'){
    $('lookup-status').textContent='Lookup unavailable. Check your connection and retry, or enter your own translation or example.';
  }else{
    $('lookup-status').textContent=result.translation&&result.example?'Meaning and example found. Review them, then save.':result.translation?'Meaning found. Add an example if you want one.':result.example?'Example found. A matching Russian meaning is unavailable; you can add your own.':'Word found, but no translation or example is available. Add your own to save it.';
    if(!result.example)$('example-status').textContent='No example available for this meaning. You can add a sentence from your book.';
  }
  updateDuplicate();
}
$('word').addEventListener('input',()=>{ clearTimeout(lookupTimer);lookupController?.abort();revision++; clearMeaning();updateDuplicate();$('lookup-status').textContent=$('word').value.trim()?'Looking up…':'Lookups are automatic. You can edit the results.';if($('word').value.trim())lookupTimer=setTimeout(lookup,550); });
$('lookup').onclick=lookup;
$('try-word').onclick=()=>{editingId=null;$('cancel-edit').hidden=true;$('save').innerHTML='Save word';$('word').value=LANGUAGES[activeLanguage].sample;clearMeaning();updateDuplicate();setMode('both');lookup();$('capture').scrollIntoView({behavior:'smooth'});$('word').focus();};
$('word-form').onsubmit=e=>{
  e.preventDefault();const word=cleanCell($('word').value),translation=mode==='example'?'':$('translation').value.trim(),example=mode==='translation'?'':$('example').value.trim();
  if(!word){$('word').focus();return toast(`Enter a ${languageName()} word first.`);}
  if(!translation&&!example){(mode==='example'?$('example'):$('translation')).focus();return toast('Add a translation or example before saving.');}
  if(updateDuplicate())return toast('This word is already in your collection. Edit the saved word instead.');
  const old=words.find(w=>w.id===editingId);
  if(editingId&&(!old||JSON.stringify({...old,exportedAt:undefined})!==editingSnapshot))return toast('This word changed in another tab. Cancel editing and reopen the saved word before saving changes.');
  const item={id:old?.id||crypto.randomUUID(),word,translation,example,language:activeLanguage,book:$('book').value.trim(),createdAt:old?.createdAt||Date.now(),...(exampleSource?{exampleSource}: {})};
  if(!commit(old?words.map(w=>w.id===old.id?item:w):[...words,item]))return;
  toast(old?'Your word has been updated.':`“${word}” saved.`);clearTimeout(lookupTimer);lookupController?.abort();revision++;editingId=null;$('cancel-edit').hidden=true;$('word').value='';clearMeaning();updateDuplicate();$('save').innerHTML='Save word';$('lookup-status').textContent='Saved. Enter the next word.';$('word').focus();
};
$('search').oninput=render;$('sort').onchange=render;
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
for(const key of ['help','install'])$(key+'-open').onclick=()=>$(key+'-dialog').showModal();
let exportRevision=0, copyPending=false, pdfPending=false, pdfUrl=null;
function clearPdf(){if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl=null;$('pdf-ready').hidden=true;}
const studyApps={
  knowt:{name:'Knowt',url:'https://knowt.com/',help:'https://help.knowt.com/en/articles/10305785-how-do-i-use-the-ai-summarizers',steps:['Download the PDF above. If a preview opens on iPhone, tap Share → Save to Files.','In the Knowt app, choose Create → Flashcards → Upload file from device, then select the PDF from Files.','Choose Flashcards if prompted. Review the generated cards before saving your set.'],note:'Knowt uses AI to turn uploaded PDFs into flashcards. This uses your AI allowance and may change or omit cards. The PDF includes your selected words, translations and examples.'},
  quizlet:{name:'Quizlet',url:'https://quizlet.com/',help:'https://help.quizlet.com/hc/en-au/articles/360029977151-Creating-sets-by-importing-content',steps:['On Quizlet’s website, choose Create → Flashcard set.','Select Import and paste the copied text.','Set Tab between term and definition, and New line between cards. Review, import, and create the set.'],note:'Quizlet imports sets on its website. If the import screen isn’t available in Safari on iPhone, use a computer. You can study the saved set in the iPhone app.'}
};
function exportApp(){return studyApps[$('export-target').value]||studyApps.knowt;}
function updateExportTarget(){
  exportRevision++;clearPdf();$('export-status').textContent='';
  const target=exportApp(),isKnowt=target===studyApps.knowt;
  $('download-pdf').hidden=!isKnowt;$('copy-export').hidden=isKnowt;$('open-study-app').hidden=isKnowt;
  $('export-intro').textContent=isKnowt?'Download a PDF, then upload it in the Knowt app.':'Copy your words, then paste them into Quizlet’s website.';
  $('copy-export').textContent=copyPending?'Copying…':`Copy for ${target.name}`;
  $('open-study-app').textContent=`Open ${target.name} website ↗`;$('open-study-app').href=target.url;
  $('import-heading').textContent=isKnowt?'Import a file into Knowt':`Paste into ${target.name}`;
  $('import-steps').replaceChildren(...target.steps.map(step=>el('li','',step)));
  $('mobile-import-note').textContent=target.note;
  $('import-help').textContent=`${target.name}’s import instructions ↗`;$('import-help').href=target.help;
}
function updateExport() {
  exportRevision++;clearPdf();$('export-status').textContent='';
  const available=activeWords().filter(w=>!$('only-new').checked||!w.exportedAt).length;
  $('export-count').max=String(available);$('export-count').value=String(available?Math.min(Math.max(1,Number($('export-count').value)||1),available):0);
  $('export-available').textContent=`of ${available} ${available===1?'word':'words'}`;
  exportSelection=chooseWords(words,{count:$('export-count').value,order:$('export-order').value,onlyNew:$('only-new').checked,language:activeLanguage});
  $('export-preview-text').textContent=exportSelection.length?`${exportSelection[0].word} → ${[exportSelection[0].translation,exportSelection[0].example].filter(Boolean).join(' — ')}${exportSelection.length>1?` (+${exportSelection.length-1} more)`:''}`:'No unexported words. Uncheck the filter to export saved words again.';
  $('export-text').value=createExportPayload(exportSelection).text;
  $('download').disabled=$('select-export').disabled=!exportSelection.length;
  $('copy-export').disabled=copyPending||!exportSelection.length;
  $('download-pdf').disabled=pdfPending||!exportSelection.length;
}
$('export-target').onchange=updateExportTarget;
$('export-open').onclick=()=>{
  $('export-title').textContent=`Export ${languageName()} words`;
  $('export-count').value=String(Math.min(10,activeWords().length));$('only-new').checked=false;
  $('manual-export').open=false;updateExportTarget();updateExport();$('export-dialog').showModal();
};
$('export-dialog').addEventListener('close',()=>{exportRevision++;clearPdf();});
['export-count','export-order','only-new'].forEach(id=>$(id).addEventListener('change',updateExport));
$('minus').onclick=()=>{$('export-count').value=String(Number($('export-count').value)-1);updateExport();};$('plus').onclick=()=>{$('export-count').value=String(Number($('export-count').value)+1);updateExport();};
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function markExported(selectedIds){const ids=new Set(selectedIds);return commit(words.map(w=>ids.has(w.id)?{...w,exportedAt:Date.now()}:w));}
function currentExport(){const count=Number($('export-count').value);if(!Number.isInteger(count)||count<1||count>Number($('export-count').max)){toast('Choose a word count within the available range.');return null;}if(exportSelection.length!==count)updateExport();return createExportPayload(exportSelection);}
$('download').onclick=()=>{
  const payload=currentExport();if(!payload)return;
  download(payload.text,`marginalia-${payload.count}-words.txt`,'text/plain;charset=utf-8');markExported(payload.ids);
  $('export-status').textContent='Text file prepared for website import. For file upload in the Knowt app, use Download PDF for Knowt.';
};
$('download-pdf').onclick=async()=>{
  const payload=currentExport();if(!payload||pdfPending)return;
  const selected=exportSelection.map(word=>({...word})),revision=exportRevision;
  clearPdf();pdfPending=true;$('download-pdf').disabled=true;$('download-pdf').textContent='Preparing PDF…';
  try{
    const {createVocabularyPdf}=await import('./pdf-export.js');
    const bytes=await createVocabularyPdf(selected);
    if(revision!==exportRevision||!$('export-dialog').open)return;
    pdfUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const link=$('save-pdf-link');link.href=pdfUrl;link.download=`marginalia-${payload.count}-words.pdf`;
    link.onclick=()=>markExported(payload.ids);
    $('pdf-ready').hidden=false;
    $('export-status').textContent=`PDF ready with ${payload.count} ${payload.count===1?'word':'words'}. Tap Save PDF. If a preview opens, tap Share → Save to Files, then upload it in Knowt.`;
  }catch{
    if(revision===exportRevision&&$('export-dialog').open)$('export-status').textContent='Couldn’t prepare the PDF. Connect to the internet once to load the PDF tools, then try again.';
  }finally{pdfPending=false;$('download-pdf').disabled=!exportSelection.length;$('download-pdf').textContent='Download PDF for Knowt';}
};
function selectExportText(){
  $('manual-export').open=true;const area=$('export-text');area.focus();area.select();area.setSelectionRange(0,area.value.length);
}
$('select-export').onclick=()=>{selectExportText();$('export-status').textContent='Text selected. Touch and hold the selection, choose Copy, then paste into your study app’s website.';};
$('copy-export').onclick=async()=>{
  const payload=currentExport();if(!payload||copyPending)return;
  const revision=exportRevision,target=exportApp();copyPending=true;$('copy-export').disabled=true;$('copy-export').textContent='Copying…';
  try{
    if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(payload.text);
    markExported(payload.ids);
    if(revision===exportRevision&&$('export-dialog').open)$('export-status').textContent=`Copied ${payload.count} ${payload.count===1?'word':'words'}. Open ${target.name}’s website and paste into its import screen. Copying does not create a set automatically.`;
  }catch{
    if(revision===exportRevision&&$('export-dialog').open){
      $('export-text').value=payload.text;selectExportText();
      $('export-status').textContent='Automatic copying is unavailable. The text below is selected: touch and hold it, choose Copy, then paste it into the website’s import screen.';
    }
  }finally{copyPending=false;$('copy-export').disabled=!exportSelection.length;$('copy-export').textContent=`Copy for ${exportApp().name}`;}
};
$('backup').onclick=()=>{let data;try{data=storageHealthy?JSON.stringify({version:1,words},null,2):localStorage.getItem(STORAGE);}catch{return toast('Browser storage is unavailable.');}download(data||'{}',`marginalia-backup-${new Date().toISOString().slice(0,10)}.json`,'application/json');toast('Backup downloaded. Keep it somewhere safe.');};
$('restore').onclick=()=>$('restore-file').click();
$('restore-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>30_000_000)throw Error('This backup is too large.');const restored=validateBackup(JSON.parse(await f.text()));const ids=new Set(words.map(w=>w.id));const newWords=restored.filter(w=>!ids.has(w.id));if(commit([...words,...newWords],true))toast(`${newWords.length} words restored. Existing words kept.`);}catch(err){toast(err.message||'This backup could not be restored.');}e.target.value='';};
window.addEventListener('storage',e=>{if(e.key!==STORAGE)return;try{words=e.newValue?validateBackup(JSON.parse(e.newValue)):[];render();if($('export-dialog').open)updateExport();}catch{toast('A change from another tab could not be read.');}});
function connection(){ $('connection-status').textContent=navigator.onLine?'Saved on this device':'Offline · your words are here'; }window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();render();
if('serviceWorker' in navigator)navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(()=>{});
