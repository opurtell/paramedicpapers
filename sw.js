/* Paramedic Papers offline copy (review BC8; web guidance phase 4).

   Three rules, by request:
   - Versioned code (/css/*.css?v=… and /js/*.js?v=…) and fonts: cache
     first. A ?v= file never changes, so a kept copy is served at once with
     no network wait. ALWAYS bump ?v= when a file changes, or readers keep
     the old one. Files that greg's built pages also load (static.css,
     fonts.css, track.js) stay network first: those pages can lag behind a
     ?v= bump until the template is patched.
   - Everything else same-origin (pages, data): network first, so a reader
     with signal always gets the latest papers. Each good response is also
     kept; when the network fails (or is very slow), the kept copy is used.
   - Paper, topic, daily and episode pages: at most PAGE_CAP are kept, the
     least recently opened dropped first, so the cache can't grow forever.

   Keys drop the query string (the app cache-busts data with ?t=…), except
   for cache-first files, which keep their ?v= so a bump is a new key; older
   versions of the same file are deleted when the new one is stored.
   Cross-origin requests (audio, the API, analytics) are left alone. */

var CACHE = 'pp-offline-v3';
var SLOW_MS = 6000;  /* past this, a kept copy beats waiting on bad signal */
var PAGE_CAP = 60;
var PAGE_DIRS = /^\/(papers|topics|daily|episodes)\//;
var SHARED_WITH_BUILT_PAGES = ['/css/static.css', '/css/fonts.css', '/js/track.js'];
var SHELL = [
  '/', '/css/style.css', '/css/fonts.css',
  '/js/safe-html.js', '/js/app.js', '/js/cpd.js', '/js/podcasts.js', '/js/track.js',
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

function cacheFirst(url) {
  if (url.pathname.indexOf('/fonts/') === 0) return true;
  if (!/^\/(css|js)\/[^/]+\.(css|js)$/.test(url.pathname)) return false;
  if (!url.searchParams.get('v')) return false;
  return SHARED_WITH_BUILT_PAGES.indexOf(url.pathname) === -1;
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
  e.waitUntil(Promise.all([
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('pp-offline-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }),
    /* Start page requests while the worker boots, not after. */
    self.registration.navigationPreload ? self.registration.navigationPreload.enable() : null
  ]).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  e.respondWith(cacheFirst(url) ? fromCacheFirst(req, url, e) : networkFirst(req, e));
});

/* Versioned file or font: the exact version if kept, else the network
   (keeping it, and dropping other versions of that file). Offline with
   the exact version missing, any kept version beats nothing. */
function fromCacheFirst(req, url, e) {
  var fonts = url.pathname.indexOf('/fonts/') === 0;
  var key = fonts ? keyOf(req.url) : url.origin + url.pathname + '?v=' + url.searchParams.get('v');
  return caches.open(CACHE).then(function (c) {
    return c.match(key).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r.ok && r.type === 'basic') {
          var copy = r.clone();
          e.waitUntil(c.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) {
              var u = new URL(k.url);
              return u.pathname === url.pathname && k.url !== key;
            }).map(function (k) { return c.delete(k); }));
          }).then(function () { return c.put(key, copy); }));
        }
        return r;
      }).catch(function (err) {
        return c.match(req, { ignoreSearch: true }).then(function (any) {
          if (any) return any;
          throw err;
        });
      });
    });
  });
}

function networkFirst(req, e) {
  var key = keyOf(req.url);
  var kept = caches.match(key);
  /* Navigations use the preloaded response when there is one. */
  var net = Promise.resolve(req.mode === 'navigate' ? e.preloadResponse : null)
    .then(function (pre) { return pre || fetch(req); })
    .then(function (r) {
      /* The host having a bad moment: a kept copy is better than an error page. */
      if (r.status >= 500) return kept.then(function (k) { return k || r; });
      if (r.ok && r.type === 'basic') {
        var copy = r.clone();
        e.waitUntil(keep(key, copy));
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

/* Store a response. Built pages are re-added at the end of the cache's key
   order (delete, then put) so the order is least recently opened first,
   then trimmed to PAGE_CAP. */
function keep(key, res) {
  return caches.open(CACHE).then(function (c) {
    if (!PAGE_DIRS.test(new URL(key).pathname)) return c.put(key, res);
    return c.delete(key).then(function () { return c.put(key, res); }).then(function () {
      return c.keys();
    }).then(function (keys) {
      var pages = keys.filter(function (k) { return PAGE_DIRS.test(new URL(k.url).pathname); });
      var extra = pages.length - PAGE_CAP;
      return Promise.all(pages.slice(0, Math.max(0, extra)).map(function (k) { return c.delete(k); }));
    });
  });
}
