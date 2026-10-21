const ROOT = self.registration.scope;
const PREFIX = `marginalia-${new URL(ROOT).pathname}-`;
const CACHE = `${PREFIX}v9`;
const SHELL = ['./','index.html','style.css','theme.js','app.js','core.js','lookup.js','pdf-export.js','vendor/pdf-lib.esm.min.js','vendor/fontkit.es.min.js','vendor/NotoSans-Regular.ttf','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'].map(path=>new URL(path,ROOT).href);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(!url.href.startsWith(ROOT)||event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(()=>caches.open(CACHE).then(async cache=>(await cache.match(event.request))||(event.request.mode==='navigate'?await cache.match(ROOT):Response.error()))));
});
