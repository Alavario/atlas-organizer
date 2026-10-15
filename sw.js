// Service worker: somente a interface estática é armazenada em cache.
const CACHE='atlas-static-2.1-persistent-1';
const SHELL=['./','./index.html','./app.js?v=2.1.0','./styles.css','./drive.js?v=2.1.0','./backend-client.js?v=2.1.0','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',ev=>{ev.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',ev=>{ev.waitUntil((async()=>{for(const name of await caches.keys()){if(name.startsWith('atlas-static-')&&name!==CACHE)await caches.delete(name)}await self.clients.claim()})())});
self.addEventListener('fetch',ev=>{
 const req=ev.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 if(new URL(req.url).pathname.includes('/api/'))return;
 ev.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   if(req.mode==='navigate'){
    try{const res=await fetch(req);if(res.ok)await cache.put(req,res.clone());return res}catch{return (await cache.match('./index.html'))||Response.error()}
   }
   const saved=await cache.match(req);
   if(saved)return saved;
   const res=await fetch(req);if(res.ok)await cache.put(req,res.clone());return res;
 })());
});
