/* Paramedic Papers offline copy (review BC8).

   Network first for every same-origin GET, so a reader with signal always
   gets the latest papers and code. Each good response is also kept on the
   device; when the network fails (or is very slow), the kept copy is used.
   Keys drop the query string: the app cache-busts data with ?t=… and
   versions assets with ?v=…, and only the latest copy of each is wanted.
   Cross-origin requests (audio, the API, analytics) are left alone. */

var CACHE = 'pp-offline-v1';
var SLOW_MS = 6000;  /* past this, a kept copy beats waiting on bad signal */
var SHELL = [
  '/', '/css/style.css', '/css/fonts.css',
  '/js/app.js', '/js/cpd.js', '/js/podcasts.js', '/js/track.js',
  '/fonts/newsreader-latin.woff2', '/fonts/ibm-plex-sans-latin.woff2',
  '/fonts/ibm-plex-mono-latin-400.woff2', '/fonts/ibm-plex-mono-latin-500.woff2',
  '/icon-192.png', '/icon-32.png', '/site.webmanifest',
  '/data/papers.json', '/data/episodes.json', '/data/pd-brief.json'
];

function keyOf(url) {
  var u = new URL(url);
  u.search = '';
  u.hash = '';
  if (u.pathname === '/index.html') u.pathname = '/';
  return u.href;
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (path) {
      return fetch(path, { cache: 'no-cache' }).then(function (r) {
        if (r.ok) return c.put(keyOf(new URL(path, self.location).href), r);
      }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('pp-offline-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  e.respondWith(networkFirst(req, e));
});

function networkFirst(req, e) {
  var key = keyOf(req.url);
  var kept = caches.match(key);
  var net = fetch(req).then(function (r) {
    /* The host having a bad moment: a kept copy is better than an error page. */
    if (r.status >= 500) return kept.then(function (k) { return k || r; });
    if (r.ok && r.type === 'basic') {
      var copy = r.clone();
      e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(key, copy); }));
    }
    return r;
  });
  var slow = new Promise(function (resolve) {
    setTimeout(function () { kept.then(function (k) { if (k) resolve(k); }); }, SLOW_MS);
  });
  return Promise.race([net, slow]).catch(function () {
    return kept.then(function (k) {
      if (k) return k;
      /* An uncached page while offline: the dashboard can still open. */
      if (req.mode === 'navigate') {
        return caches.match(keyOf(self.location.origin + '/')).then(function (home) {
          return home ? Response.redirect('/', 302) : Response.error();
        });
      }
      return Response.error();
    });
  });
}
