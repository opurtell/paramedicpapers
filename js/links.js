/* ============================================================
   Paramedic Papers — bio link page (links.html).
   Fills "Latest studies" and "Recent posts" from two small files and flags
   Instagram's in-app browser. Never loads papers.json (too heavy for a
   webview). Everything here is progressive: with JS off, the static links
   in links.html still work.
   Schemas: README.md → "Link page".
   ============================================================ */

(function () {
  'use strict';

  var MAX_POSTS = 12;

  // Same rule as paperKey() in js/app.js (and paper_key() in build_static_pages.py).
  function slugPart(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function paperKey(p) {
    if (p.key) return p.key;
    if (/^\d+$/.test(p.pmid || '')) return p.pmid;
    if (p.doi) return 'doi-' + slugPart(p.doi);
    return 'id-' + slugPart(p.id);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  // Google blocks OAuth in embedded webviews.
  if (/Instagram|FBAN|FBAV/.test(navigator.userAgent)) {
    document.documentElement.className += ' is-inapp';
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  function renderLatest(links) {
    var box = document.getElementById('latest');
    var papers = (links.latest || []).slice(0, 4);
    if (!box || !papers.length) return;
    // Replaces whatever build_static_pages.py put in the marker block.
    box.textContent = '';
    papers.forEach(function (p) {
      var a = el('a', 'study');
      a.href = '/papers/' + paperKey(p) + '/';
      if (p.topic) a.appendChild(el('span', 'chip', p.topic));
      a.appendChild(el('span', 't', p.title || 'Study'));
      if (p.finding) a.appendChild(el('span', 'f', p.finding));
      box.appendChild(a);
    });
    var fb = document.getElementById('latest-fallback');
    if (fb) fb.hidden = true;
  }

  function renderEpisode(links) {
    var ep = links.episode, a = document.getElementById('link-episode');
    if (!ep || !a) return;
    a.href = ep.page || ('/episodes/' + ep.date + '/');
    a.firstChild.textContent = "Today's podcast episode";
  }

  function renderPosts(ig) {
    var box = document.getElementById('posts');
    if (!box) return;
    (ig.posts || []).slice(0, MAX_POSTS).forEach(function (p) {
      var a = el('a');
      a.href = p.permalink;
      a.rel = 'noopener';
      a.appendChild(el('span', 'ph', p.hook || p.date));
      if (p.cover) {
        var img = new Image();
        img.alt = p.hook ? p.hook + ' (' + p.date + ')' : 'Post from ' + p.date;
        img.loading = 'lazy';
        img.onerror = function () { img.remove(); };
        img.src = p.cover;
        a.appendChild(img);
      }
      box.appendChild(a);
    });
  }

  getJSON('/data/links.json').then(function (l) { renderLatest(l); renderEpisode(l); }).catch(function () {});
  getJSON('/data/instagram.json').then(renderPosts).catch(function () {});
})();
