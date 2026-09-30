/* Guarda la app para que abra aunque no haya señal. Sube VERSION al publicar cambios. */
var VERSION = 'cc-v2';
var ARCHIVOS = ['./', './index.html', './styles.css?v=2', './core.js?v=2', './app.js?v=2', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // la API nunca se guarda
  // Primero la red (para recibir cambios); si no hay señal, lo guardado.
  e.respondWith(fetch(req).then(function (r) {
    var copia = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, copia); }); return r;
  }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('./index.html'); }); }));
});
