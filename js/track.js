/* ============================================================
   Paramedic Papers — first-party usage counts for /stats.html.
   One random ID per browser (local storage, not a cookie) so returning
   visitors and retention can be counted, plus a few named actions.
   Nothing about who you are or what you type is sent. See privacy.html.
   Off when Global Privacy Control / Do Not Track is on, or after opting
   out on the privacy page.
   ============================================================ */

(function () {
  'use strict';

  var ENDPOINT = 'https://api.paramedicpapers.com/api/e';
  var ID_KEY = 'pp:vid';
  var OFF_KEY = 'pp:no-track';
  var LIVE = location.hostname === 'paramedicpapers.com' || location.hostname === 'www.paramedicpapers.com';

  function randomId() {
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function optedOut() {
    try { if (localStorage.getItem(OFF_KEY)) return true; } catch (e) {}
    return !!(navigator.globalPrivacyControl || navigator.doNotTrack === '1' || navigator.webdriver);
  }

  var vid = null;
  if (LIVE && !optedOut()) {
    try {
      vid = localStorage.getItem(ID_KEY);
      if (!vid) { vid = randomId(); localStorage.setItem(ID_KEY, vid); }
    } catch (e) { vid = null; }  /* storage blocked: count nothing */
  }

  /* name: one of the action names the API accepts; key: page, paper id,
     episode date or similar (never free text). text/plain keeps it a
     simple request, so there's no CORS preflight. */
  function track(name, key) {
    if (!vid) return;
    var body = JSON.stringify({ v: vid, n: name, k: String(key == null ? '' : key).slice(0, 200) });
    try { if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return; } catch (e) {}
    try { fetch(ENDPOINT, { method: 'POST', body: body, mode: 'no-cors', credentials: 'include', keepalive: true }); } catch (e) {}
  }

  window.ppTrack = track;
  window.ppTracking = {
    enabled: function () { return !!vid; },
    optedOut: optedOut,
    /* off: true stops counting and forgets this browser's ID. */
    setOptOut: function (off) {
      try {
        if (off) { localStorage.setItem(OFF_KEY, '1'); localStorage.removeItem(ID_KEY); vid = null; }
        else localStorage.removeItem(OFF_KEY);
      } catch (e) {}
    }
  };

  /* Dashboard views live in the #fragment: #paper=<id>, #episode=<date>,
     #cpd, #quiz=… Count each change once. */
  var lastHash = null;
  function route() {
    var h = location.hash || '';
    if (h === lastHash) return;
    lastHash = h;
    var m = /^#paper=(.+)$/.exec(h);
    if (m) { track('paper_open', decodeURIComponent(m[1])); return; }
    m = /^#episode=(\d{4}-\d{2}-\d{2})$/.exec(h);
    if (m) { track('view', 'episode'); return; }
    m = /^#([a-z-]+)/.exec(h);
    if (m) track('view', m[1]);
  }

  track('pageview', location.pathname);
  route();
  addEventListener('hashchange', route);

  /* Sign-in buttons go to api.paramedicpapers.com/auth/<provider>. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="/auth/"]');
    if (!a) return;
    var m = /\/auth\/([a-z]+)/.exec(a.getAttribute('href'));
    if (m && m[1] !== 'logout') track('signin_start', m[1]);
  }, true);
})();
