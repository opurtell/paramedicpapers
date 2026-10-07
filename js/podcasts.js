/* ============================================================
   Paramedic Papers — other podcasts for CPD (cpd/plan phase 5)
   #podcasts lists a curated set of EM / prehospital podcasts;
   the list's search box matches podcasts and every listed podcast's
   episodes; #podcasts=<id> searches one podcast's episodes; &ep=<eid> scrolls
   to and highlights one. Public: no sign-in to browse. Data comes from
   data/podcasts/ (greg's index-podcasts.py, from each public feed).
   Log PD lives in js/cpd.js (hooks.logEpisode / episodeAct), because
   it needs the API, goals and drafts.
   ============================================================ */

(function () {
  'use strict';

  var PP = window.PP;
  if (!PP) return;

  var PAGE = 50;
  var SUGGEST = 'mailto:newsletter@paramedicpapers.com?subject=' + encodeURIComponent('Podcast suggestion for CPD');

  var pz = {
    index: null,      /* [{ id, name, publisher, focus, region, site, art, episodes, latest }] */
    indexError: '',
    files: {},        /* id → podcast file (with episodes) */
    id: null,         /* podcast on screen, or null for the list */
    error: '',
    q: '',
    region: '',       /* list filter: '' | 'anz' | 'intl' */
    listQ: '',        /* list search: podcasts and episodes across all of them */
    listShown: PAGE,
    topic: '',
    year: '',
    shown: PAGE,
    open: {},         /* eid → notes expanded */
    hot: ''           /* eid to scroll to and highlight once */
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = PP.esc, ico = PP.ico;
  var timer = null;

  /* ── hooks and the surface js/cpd.js uses ───────────── */

  var prevShow = PP.hooks.onShow;
  PP.hooks.onShow = function (tab) {
    if (prevShow) prevShow(tab);
    if (tab === 'podcasts') show();
    if (tab === 'podcast') renderPromo();
  };
  PP.hooks.podcastsKicker = kicker;

  PP.podcasts = {
    loadIndex: loadIndex,
    cachedIndex: function () { return pz.index; },
    load: loadPodcast,
    matches: matches,
    render: function () {
      renderPromo();
      if (PP.state.tab === 'podcasts') render();
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    renderPromo();
    /* The Podcast tab's panel names the listed podcasts, so fetch the
       small index early; it's cached for the browse view. */
    loadIndex().then(renderPromo, function () {});
  });

  /* ── data ───────────────────────────────────────────── */

  function loadIndex() {
    if (pz.index) return Promise.resolve(pz.index);
    return fetch('data/podcasts/index.json?t=' + Date.now(), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('index.json ' + r.status);
      return r.json();
    }).then(function (d) {
      pz.index = Array.isArray(d) ? d : [];
      pz.indexError = '';
      return pz.index;
    }).catch(function (err) {
      pz.indexError = 'The podcast list isn’t available right now. Try again in a few minutes.';
      throw err;
    });
  }

  function loadPodcast(id) {
    if (pz.files[id]) return Promise.resolve(pz.files[id]);
    return fetch('data/podcasts/' + encodeURIComponent(id) + '.json?t=' + Date.now(), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('That podcast isn’t in the list any more.');
      return r.json();
    }).then(function (p) {
      p.episodes.forEach(function (e) { e._text = fold(e.title + ' ' + (e.notes || '')); });
      pz.files[id] = p;
      return p;
    });
  }

  /* Every podcast's episodes, for the list's cross-podcast search. A
     feed that fails to load is left out rather than failing the search. */
  var allP = null;
  function loadAll() {
    if (!allP) allP = loadIndex().then(function (idx) {
      return Promise.all(idx.map(function (p) { return loadPodcast(p.id).catch(function () { return null; }); }));
    }).then(function (r) { allP = null; return r; }, function (err) { allP = null; throw err; });
    return allP;
  }

  var allTried = false;
  function allLoaded() {
    return allTried || (!!pz.index && pz.index.every(function (p) { return pz.files[p.id]; }));
  }

  /* "#podcasts=resus-room&ep=1258b551c27f" → { id, ep } */
  function fromHash() {
    var m = /^#podcasts(?:=([a-z0-9-]+))?(?:&ep=([a-f0-9]+))?$/.exec(location.hash || '');
    return m ? { id: m[1] || null, ep: m[2] || '' } : { id: null, ep: '' };
  }

  function show() {
    var h = fromHash();
    if (h.id !== pz.id) { pz.q = ''; pz.topic = ''; pz.year = ''; pz.shown = PAGE; pz.open = {}; }
    pz.id = h.id;
    pz.hot = h.ep;
    pz.error = '';
    /* Already loaded (e.g. opened from a search result): one render, so
       the highlighted episode isn't re-rendered away. */
    var had = !!(pz.id && pz.files[pz.id]);
    render();
    loadIndex().catch(function () {}).then(function () {
      if (!pz.id) { render(); return; }
      if (had) return;
      return loadPodcast(pz.id).then(function () { render(); }, function (err) { pz.error = err.message; render(); });
    });
  }

  function kicker() {
    var p = pz.id && pz.files[pz.id];
    if (p) return p.episodes.length + ' episodes · latest ' + shortDate(p.latest);
    return 'Log them as CPD';
  }

  /* ── search ─────────────────────────────────────────── */

  /* Case- and accent-insensitive: "Résumé" matches "resume". */
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function words(q) {
    return fold(q).split(/\s+/).filter(Boolean);
  }

  /* Every word must appear in the title or the notes excerpt. */
  function matches(ep, q) {
    var ws = words(q);
    var text = ep._text || fold(ep.title + ' ' + (ep.notes || ''));
    return ws.every(function (w) { return text.indexOf(w) !== -1; });
  }

  /* Escaped text with the query's words in <b>. Folding is done per
     character so positions map back onto the original string. */
  function highlight(text, q) {
    text = String(text || '');
    var ws = words(q);
    if (!ws.length) return esc(text);
    var folded = '', map = [];
    for (var i = 0; i < text.length; i++) {
      var f = fold(text.charAt(i));
      for (var j = 0; j < f.length; j++) { folded += f.charAt(j); map.push(i); }
    }
    var marks = new Array(text.length + 1).join('0').split('');
    ws.forEach(function (w) {
      var at = folded.indexOf(w);
      while (at !== -1) {
        for (var k = at; k < at + w.length; k++) marks[map[k]] = '1';
        at = folded.indexOf(w, at + w.length);
      }
    });
    var out = '', on = false;
    for (var n = 0; n < text.length; n++) {
      var m = marks[n] === '1';
      if (m !== on) { out += m ? '<b>' : '</b>'; on = m; }
      out += esc(text.charAt(n));
    }
    return out + (on ? '</b>' : '');
  }

  /* ── dates and lengths ──────────────────────────────── */

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    var thisYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('en-AU', thisYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function lenLabel(sec) {
    if (!sec) return '';
    var m = Math.round(sec / 60), h = Math.floor(m / 60);
    return h ? h + ' h ' + (m % 60) + ' min' : m + ' min';
  }

  /* Year chips: the last four years one by one, then "Older". */
  function yearOf(ep) {
    var y = +(ep.date || '0').slice(0, 4);
    return y >= new Date().getFullYear() - 3 ? String(y) : 'older';
  }

  /* ── Podcast tab panel ──────────────────────────────── */

  function renderPromo() {
    var el = $('podcasts-promo');
    if (!el) return;
    var names = (pz.index || []).map(function (p) { return p.name; });
    var lead = names.length === 1 ? 'Listened to ' + names[0] + '?' : 'Listened to an emergency medicine podcast?';
    var stats = PP.hooks.podcastStats ? PP.hooks.podcastStats() : null;
    el.innerHTML =
      '<span class="panel-kicker panel-kicker-accent">' + ico('cpd') + 'Log other podcasts as CPD</span>' +
      '<p class="panel-lead">' + esc(lead) + ' Find the episode and log it toward your 30 hours.</p>' +
      (stats && stats.count ? '<p class="pods-stats">' + ico('check') + esc(stats.count + ' episode' + (stats.count === 1 ? '' : 's') + ' logged this year · ' + stats.time) + '</p>' : '') +
      '<a class="btn pods-go" href="#podcasts">Browse podcasts' + ico('arrow') + '</a>';
  }

  /* ── views ──────────────────────────────────────────── */

  function render() {
    var root = $('podcasts-body');
    if (!root) return;
    PP.renderKicker();
    if (!pz.id) { renderList(root); return; }
    var p = pz.files[pz.id];
    if (pz.error) {
      root.innerHTML = '<div class="empty-state"><h2>Podcast not found</h2><p>' + esc(pz.error) + '</p>' +
        '<a class="btn" href="#podcasts">All podcasts</a></div>';
      return;
    }
    if (!p) { root.innerHTML = '<p class="empty">Loading episodes…</p>'; return; }
    renderPodcast(root, p);
  }

  function artHTML(p, cls) {
    return p.art
      ? '<img class="' + cls + '" src="' + esc(p.art) + '" alt="" width="64" height="64" loading="lazy">'
      : '<span class="' + cls + ' pods-art-none" aria-hidden="true">' + ico('podcast') + '</span>';
  }

  function renderList(root) {
    if (!pz.index) {
      root.innerHTML = pz.indexError ? '<p class="empty">' + esc(pz.indexError) + '</p>' : '<p class="empty">Loading podcasts…</p>';
      return;
    }
    var anzCount = pz.index.filter(isANZ).length;
    var total = pz.index.reduce(function (n, p) { return n + (p.episodes || 0); }, 0);
    root.innerHTML =
      '<p class="pods-intro">Pick a podcast, find the episode you listened to, and log it as CPD with the listening time filled in.</p>' +
      '<div class="search-wrap pods-search">' + ico('search', 'search-ico') +
        '<input id="pods-list-q" type="search" placeholder="Search ' + esc(pz.index.length) + ' podcasts and ' + esc(total.toLocaleString('en-AU')) + ' episodes" aria-label="Search podcasts and episodes" value="' + esc(pz.listQ) + '" autocomplete="off">' +
      '</div>' +
      (anzCount && anzCount < pz.index.length ? '<div class="chips pods-chips" role="group" aria-label="Region">' +
        chip('region', '', 'All ' + pz.index.length, !pz.region) +
        chip('region', 'anz', 'Australia & NZ ' + anzCount, pz.region === 'anz') +
        chip('region', 'intl', 'International ' + (pz.index.length - anzCount), pz.region === 'intl') + '</div>' : '') +
      '<div class="pods-list-results" id="pods-list-results"></div>' +
      '<p class="fine pods-foot">Not listed? <a href="#cpd" data-add-podcast>Add it from CPD → Add</a> · ' +
        '<a href="' + SUGGEST + '">Suggest a podcast</a></p>' +
      '<p class="fine">Episode details from each podcast’s public feed; listen in your podcast app.</p>';
    var q = $('pods-list-q');
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { pz.listQ = q.value; pz.listShown = PAGE; renderListResults(); }, 150);
    });
    root.querySelectorAll('[data-chip="region"]').forEach(function (b) {
      b.addEventListener('click', function () { pz.region = b.getAttribute('data-val'); pz.listShown = PAGE; renderList(root); });
    });
    var add = root.querySelector('[data-add-podcast]');
    if (add) add.addEventListener('click', function (e) {
      if (!PP.hooks.openAdd) return;
      e.preventDefault();
      PP.setTab('cpd');
      PP.hooks.openAdd('podcast');
    });
    renderListResults();
  }

  /* Podcasts whose name, publisher or focus match, then (once every feed
     is loaded) matching episodes from all the podcasts in the region. */
  function renderListResults() {
    var box = $('pods-list-results');
    if (!box) return;
    var q = pz.listQ.trim();
    var inRegion = pz.index.filter(function (p) {
      return !pz.region || (pz.region === 'anz') === isANZ(p);
    }).sort(function (a, b) { return (b.latest || '').localeCompare(a.latest || ''); });
    var ws = words(q);
    var pods = inRegion.filter(function (p) {
      var text = fold([p.name, p.publisher, p.focus, p.region].join(' '));
      return ws.every(function (w) { return text.indexOf(w) !== -1; });
    });

    if (!q) { box.innerHTML = cardsHTML(pods, ''); return; }

    var html = pods.length
      ? '<div class="section-head"><h2>Podcasts</h2><span class="muted-flag">' + pods.length + '</span></div>' + cardsHTML(pods, q)
      : '';

    if (!allLoaded()) {
      box.innerHTML = html + '<p class="empty">Searching episodes…</p>';
      var asked = pz.listQ;
      loadAll().then(function () { allTried = true; if (pz.listQ === asked) renderListResults(); }, function () {});
      return;
    }

    var eps = [];
    inRegion.forEach(function (p) {
      var file = pz.files[p.id];
      if (file) file.episodes.forEach(function (e) { if (matches(e, q)) eps.push({ p: file, e: e }); });
    });
    eps.sort(function (a, b) { return (b.e.date || '').localeCompare(a.e.date || ''); });
    var rows = eps.slice(0, pz.listShown);
    box.innerHTML = html +
      '<div class="section-head"><h2>Episodes</h2><span class="muted-flag">' + eps.length + '</span></div>' +
      (eps.length ? '<div class="pods-eps">' + rows.map(function (r) { return rowHTML(r.p, r.e, q, true); }).join('') + '</div>'
        : '<p class="empty">No episodes match. Try fewer words' + (pz.region ? ', or search all regions' : '') + '.</p>') +
      (eps.length > rows.length ? '<button class="btn pods-more" data-more type="button">Show more (' + (eps.length - rows.length) + ' left)</button>' : '');
    bindRows(box, function (id) { return pz.files[id]; });
    var more = box.querySelector('[data-more]');
    if (more) more.addEventListener('click', function () { pz.listShown += PAGE; renderListResults(); });
  }

  function cardsHTML(list, q) {
    if (!list.length) return q ? '' : '<p class="empty">No podcasts in this region.</p>';
    return '<div class="pods-list">' + list.map(function (p) {
      var logged = PP.hooks.podcastLogged ? PP.hooks.podcastLogged(p.id) : 0;
      return '<a class="panel pods-card" href="#podcasts=' + esc(p.id) + '">' +
        artHTML(p, 'pods-art') +
        '<span class="pods-card-main">' +
          '<span class="pods-card-name">' + highlight(p.name, q) + '</span>' +
          '<span class="pods-card-pub">' + highlight(p.publisher || '', q) + (p.region ? ' <span class="pods-region">' + esc(p.region) + '</span>' : '') + '</span>' +
          '<span class="pods-card-focus">' + highlight(p.focus || '', q) + '</span>' +
          '<span class="pods-card-meta">' + esc(p.episodes + ' episodes · latest ' + shortDate(p.latest)) +
            (logged ? ' · <span class="pods-logged">' + ico('check') + esc(logged + ' logged') + '</span>' : '') + '</span>' +
        '</span>' + ico('chev-right', 'pods-chev') + '</a>';
    }).join('') + '</div>';
  }

  /* Catalogue region: "AU", "NZ" or "AU/NZ" count as Australia & NZ. */
  function isANZ(p) {
    return /^(AU|NZ)(\/(AU|NZ))?$/.test(p.region || '');
  }

  function filtered(p) {
    return p.episodes.filter(function (e) {
      return (!pz.topic || e.topic === pz.topic) && (!pz.year || yearOf(e) === pz.year) && (!pz.q || matches(e, pz.q));
    });
  }

  function renderPodcast(root, p) {
    var topics = {};
    p.episodes.forEach(function (e) { if (e.topic) topics[e.topic] = (topics[e.topic] || 0) + 1; });
    var topicList = Object.keys(topics).sort();
    var years = [];
    p.episodes.forEach(function (e) { var y = yearOf(e); if (years.indexOf(y) === -1) years.push(y); });
    years.sort(function (a, b) { return a === 'older' ? 1 : b === 'older' ? -1 : b - a; });

    /* A linked episode outside the filters or past "Show more": clear the
       filters and show enough rows to reach it. */
    if (pz.hot) {
      var all = p.episodes.map(function (e) { return e.eid; });
      var at = all.indexOf(pz.hot);
      if (at !== -1) {
        if (filtered(p).every(function (e) { return e.eid !== pz.hot; })) { pz.q = ''; pz.topic = ''; pz.year = ''; }
        var pos = filtered(p).map(function (e) { return e.eid; }).indexOf(pz.hot);
        if (pos >= pz.shown) pz.shown = Math.ceil((pos + 1) / PAGE) * PAGE;
      }
    }

    root.innerHTML =
      '<div class="pods-head">' +
        artHTML(p, 'pods-art pods-art-lg') +
        '<div class="pods-head-main">' +
          '<a class="link-btn pods-all" href="#podcasts">' + ico('chev-left') + 'All podcasts</a>' +
          '<h2 class="pods-title">' + esc(p.name) + '</h2>' +
          '<p class="pods-card-pub">' + esc(p.publisher || '') + (p.region ? ' <span class="pods-region">' + esc(p.region) + '</span>' : '') + '</p>' +
          (p.site ? '<a class="link-btn" href="' + esc(p.site) + '" target="_blank" rel="noopener">' + ico('link') + 'Podcast website</a>' : '') +
        '</div>' +
      '</div>' +
      '<div class="search-wrap pods-search">' + ico('search', 'search-ico') +
        '<input id="pods-q" type="search" placeholder="Search ' + esc(p.episodes.length) + ' episodes, e.g. pupils" aria-label="Search episodes" value="' + esc(pz.q) + '" autocomplete="off">' +
      '</div>' +
      (topicList.length ? '<div class="chips pods-chips" role="group" aria-label="Topic">' +
        chip('topic', '', 'All topics', !pz.topic) +
        topicList.map(function (t) { return chip('topic', t, t, pz.topic === t); }).join('') + '</div>' : '') +
      '<div class="chips pods-chips" role="group" aria-label="Year">' +
        chip('year', '', 'Any year', !pz.year) +
        years.map(function (y) { return chip('year', y, y === 'older' ? 'Older' : y, pz.year === y); }).join('') + '</div>' +
      '<div id="pods-results"></div>' +
      '<p class="fine pods-foot">Episode details from ' + esc(p.name) + '’s public feed; listen in your podcast app.</p>';

    var q = $('pods-q');
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { pz.q = q.value; pz.shown = PAGE; renderResults(p); }, 150);
    });
    root.querySelectorAll('[data-chip]').forEach(function (b) {
      b.addEventListener('click', function () {
        pz[b.getAttribute('data-chip')] = b.getAttribute('data-val');
        pz.shown = PAGE;
        renderPodcast(root, p);
      });
    });
    renderResults(p);
  }

  function chip(kind, val, label, on) {
    return '<button class="chip' + (on ? ' is-on' : '') + '" data-chip="' + kind + '" data-val="' + esc(val) + '" type="button" aria-pressed="' + on + '">' + esc(label) + '</button>';
  }

  function renderResults(p) {
    var box = $('pods-results');
    if (!box) return;
    var list = filtered(p);
    var rows = list.slice(0, pz.shown);
    box.innerHTML =
      '<div class="section-head"><h2>Episodes</h2><span class="muted-flag">' +
        (list.length === p.episodes.length ? list.length : list.length + ' of ' + p.episodes.length) + '</span></div>' +
      (list.length ? '<div class="pods-eps">' + rows.map(function (e) { return rowHTML(p, e, pz.q, false); }).join('') + '</div>'
        : '<p class="empty">No episodes match. Try fewer words, or clear the filters.</p>') +
      (list.length > rows.length ? '<button class="btn pods-more" data-more type="button">Show more (' + (list.length - rows.length) + ' left)</button>' : '');
    bindRows(box, function () { return p; });
    var more = box.querySelector('[data-more]');
    if (more) more.addEventListener('click', function () { pz.shown += PAGE; renderResults(p); });

    if (pz.hot) {
      var row = box.querySelector('[data-eid="' + pz.hot + '"]');
      pz.hot = '';
      if (row) {
        row.classList.add('is-hot');
        row.scrollIntoView({ block: 'center' });
        setTimeout(function () { row.classList.remove('is-hot'); }, 2400);
      }
    }
  }

  /* Notes expand on tap; Log PD opens the sheet for that row's podcast. */
  function bindRows(box, podcastOf) {
    box.querySelectorAll('[data-notes]').forEach(function (el) {
      var toggle = function () {
        var eid = el.getAttribute('data-notes');
        pz.open[eid] = !pz.open[eid];
        el.classList.toggle('is-open', pz.open[eid]);
        el.setAttribute('aria-expanded', String(!!pz.open[eid]));
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      });
    });
    box.querySelectorAll('[data-log-ep]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = podcastOf(b.closest('[data-pod]').getAttribute('data-pod'));
        var ep = p && p.episodes.filter(function (e) { return e.eid === b.getAttribute('data-log-ep'); })[0];
        if (ep && PP.hooks.logEpisode) PP.hooks.logEpisode(p, ep);
      });
    });
  }

  /* showPod: name the podcast (cross-podcast search results). */
  function rowHTML(p, e, q, showPod) {
    var act = PP.hooks.episodeAct ? PP.hooks.episodeAct(p, e) : '';
    var open = !!pz.open[e.eid];
    return '<article class="pods-ep" data-eid="' + esc(e.eid) + '" data-pod="' + esc(p.id) + '">' +
      (showPod ? '<a class="pods-ep-pod" href="#podcasts=' + esc(p.id) + '&amp;ep=' + esc(e.eid) + '">' + esc(p.name) + '</a>' : '') +
      '<p class="ep-date">' + esc(shortDate(e.date)) + (e.durationSec ? ' · ' + esc(lenLabel(e.durationSec)) : '') +
        (e.topic ? ' · ' + esc(e.topic) : '') + '</p>' +
      '<h3 class="pods-ep-title">' + highlight(e.title, q) + '</h3>' +
      (e.notes ? '<p class="pods-notes' + (open ? ' is-open' : '') + '" data-notes="' + esc(e.eid) + '" role="button" tabindex="0" aria-expanded="' + open + '" title="Tap to expand">' +
        highlight(e.notes, q) + '</p>' : '') +
      '<div class="pods-ep-foot">' +
        (e.link ? '<a class="act" href="' + esc(e.link) + '" target="_blank" rel="noopener">Episode page ↗</a>' : '') +
        '<span class="pods-ep-act">' + act + '</span>' +
      '</div>' +
    '</article>';
  }
})();
