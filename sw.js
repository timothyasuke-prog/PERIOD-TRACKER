const CACHE = 'period-tracker-v1'
const ASSETS = ['index.html','admin.html','styles.css','app.js','admin.js','public-quotes.json','manifest.json','icon-192.png','icon-512.png']
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))
})
self.addEventListener('activate', e=>{ e.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(r=>r || fetch(e.request)))
})
