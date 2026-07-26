/* ============================================================
   Paramedic Papers — app logic (mobile news-app redesign)
   Reads the same data/papers.json schema as the previous build.
   ============================================================ */

(function () {
  'use strict';

  var SAVED_KEY = 'pp:saved';

  var state = {
    data: null,
    tab: 'home',
    query: '',
    sort: 'newest',
    pinned: '',
    saved: loadSaved()
  };

  var $ = function (id) { return document.getElementById(id); };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindTabs();
    bindHome();
    bindFeed();
    bindWeekly();
    $('btn-refresh').addEventListener('click', refresh);
    window.addEventListener('hashchange', function () { setTab(tabFromHash(), true); });

    try {
      state.data = await loadData(false);
    } catch (err) {
      console.error(err);
      $('feed-list').innerHTML = '<p class="empty">Unable to load research data. Please try again later.</p>';
      return;
    }
    renderAll();
    setTab(tabFromHash(), true);
  }

  async function loadData(bust) {
    var url = bust ? 'data/papers.json?t=' + Date.now() : 'data/papers.json';
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to load papers.json');
    return resp.json();
  }

  async function refresh() {
    var btn = $('btn-refresh');
    btn.disabled = true; btn.classList.add('spinning');
    try {
      state.data = await loadData(true);
      renderAll();
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      btn.disabled = false; btn.classList.remove('spinning');
    }
  }

  /* ── navigation ─────────────────────────────────────── */

  var TABS = ['home', 'feed', 'weekly', 'saved'];
  var TITLES = { home: 'Paramedic Papers', feed: 'Research feed', weekly: 'Weekly', saved: 'Saved' };

  function tabFromHash() {
    var h = (location.hash || '').replace('#', '');
    return TABS.indexOf(h) !== -1 ? h : 'home';
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); });
    });
  }

  function setTab(tab, silent) {
    state.tab = tab;
    TABS.forEach(function (t) { $('page-' + t).hidden = (t !== tab); });
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-tab') === tab);
    });
    $('page-title').textContent = TITLES[tab];
    renderKicker();
    if (!silent) location.hash = tab;
    window.scrollTo(0, 0);
  }

  /* ── rendering ──────────────────────────────────────── */

  function renderAll() {
    renderUpdated();
    renderKicker();
    renderFunFact();
    renderDailyTldr();
    renderWeeklyTldr();
    renderToday();
    renderFeed();
    renderWeeklyPicks();
    renderSaved();
  }

  function renderUpdated() {
    if (!state.data.lastUpdated) return;
    $('last-updated').textContent = 'Upd ' + shortDate(new Date(state.data.lastUpdated));
  }

  function renderKicker() {
    var d = state.data;
    var text = '';
    if (!d) { $('page-kicker').textContent = 'Loading…'; return; }
    if (state.tab === 'home') {
      text = longDate(new Date());
    } else if (state.tab === 'feed') {
      text = allPapers().length + ' papers · ' + d.dailyUpdates.length + ' scans';
    } else if (state.tab === 'weekly') {
      text = (d.weeklyTldr && d.weeklyTldr.dateRange) || 'This week';
    } else {
      text = savedPapers().length + ' papers kept';
    }
    $('page-kicker').textContent = text;
  }

  /* Fun fact — same day-of-year rotation as the previous build. */
  function renderFunFact() {
    var facts = state.data.funFacts || [];
    if (!facts.length) { $('fun-fact-panel').hidden = true; return; }
    var now = new Date();
    var dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    var fact = facts[dayOfYear % facts.length];
    var text = fact.fact || '';
    var split = text.indexOf('. ');
    var head = split > 40 ? text.slice(0, split + 1) : text;
    var rest = split > 40 ? text.slice(split + 2) : '';

    $('fun-fact-headline').textContent = head;
    $('fun-fact-body').textContent = rest;
    $('fun-fact-toggle').hidden = !rest;
  }

  /* Daily TLDR — lead is the first summary line, expanded bullets are
     tldr.highlights, each linking to its paper card via highlight.id. */
  function renderDailyTldr() {
    var t = state.data.tldr;
    if (!t || !t.summary) {
      $('daily-tldr-lead').textContent = 'TLDR not yet available for today.';
      $('daily-tldr-body').innerHTML = '';
      $('daily-tldr-toggle').hidden = true;
      return;
    }
    var lines = bulletLines(t.summary);
    $('daily-tldr-lead').textContent = lines[0] || '';

    var rest = lines.slice(1).map(function (l) { return { text: l, ref: null }; });
    var highlights = (t.highlights || []).map(function (h) {
      return { text: h.note || h.title, ref: h.id, refTitle: h.title };
    });
    $('daily-tldr-body').innerHTML = bulletsHTML(rest.concat(highlights), false);
    bindBulletLinks($('daily-tldr-body'));
  }

  function renderWeeklyTldr() {
    var w = state.data.weeklyTldr;
    var lead = 'Weekly digest not yet available.';
    var items = [];
    if (w && w.summary) {
      var lines = bulletLines(w.summary);
      lead = lines[0] || '';
      /* Prefer explicit ids from weeklyTldr.highlights; only fall back to the
         title-word heuristic when the backend has not supplied that field. */
      var byText = weeklyRefIndex(w.highlights);
      items = lines.slice(1).map(function (l) {
        return { text: l, ref: byText ? (byText[normText(l)] || null) : refForText(l) };
      });
    }
    ['', '-home'].forEach(function (sfx) {
      var leadEl = $('weekly-tldr-lead' + sfx);
      var bodyEl = $('weekly-tldr-body' + sfx);
      if (!leadEl) return;
      leadEl.textContent = lead;
      bodyEl.innerHTML = bulletsHTML(items, true);
      bindBulletLinks(bodyEl);
    });
  }

  /* Build a bullet-text -> paper-id lookup from weeklyTldr.highlights.
     Returns null when the field is absent/empty so callers keep the heuristic;
     an entry whose id matches no paper is dropped, leaving that bullet plain. */
  function weeklyRefIndex(highlights) {
    if (!highlights || !highlights.length) return null;
    var index = {};
    highlights.forEach(function (h) {
      if (!h || !h.text || !h.id) return;
      if (!paperById(h.id)) return;
      index[normText(h.text)] = h.id;
    });
    return index;
  }

  /* Bullets are read off weeklyTldr.summary and ids off weeklyTldr.highlights;
     normalising both sides keeps them matched despite bullet-marker/space drift. */
  function normText(text) {
    return String(text == null ? '' : text)
      .replace(/^[•\-]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /* Match a weekly bullet to a paper by longest shared title token run.
     Returns a paper id or null — bullets without a match render unlinked.
     Fallback only: used when weeklyTldr.highlights is absent. */
  function refForText(text) {
    var lower = text.toLowerCase();
    var best = null, bestScore = 0;
    allPapers().forEach(function (p) {
      var words = (p.title || '').toLowerCase().split(/\W+/).filter(function (w) { return w.length > 5; });
      var score = words.filter(function (w) { return lower.indexOf(w) !== -1; }).length;
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return bestScore >= 2 && best ? best.id : null;
  }

  function bulletsHTML(items, weekly) {
    return items.map(function (it) {
      var link = '';
      if (it.ref) {
        var p = paperById(it.ref);
        if (p) {
          link = '<button class="bullet-link" data-ref="' + esc(it.ref) + '">↗ ' +
            esc(p.journal || 'View study') + '</button>';
        }
      }
      return '<div class="bullet' + (weekly ? ' is-weekly' : '') + '">' +
        '<span class="dot"></span>' +
        '<span class="bullet-body">' +
          '<span class="bullet-text">' + esc(it.text) + '</span>' + link +
        '</span></div>';
    }).join('');
  }

  function bindBulletLinks(root) {
    root.querySelectorAll('.bullet-link').forEach(function (el) {
      el.addEventListener('click', function () {
        state.pinned = el.getAttribute('data-ref');
        state.query = '';
        $('search-input').value = '';
        renderFeed();
        setTab('feed');
      });
    });
  }

  function renderToday() {
    var day = (state.data.dailyUpdates || [])[0];
    var papers = day ? day.papers : [];
    $('today-count').textContent = papers.length + ' new today';
    $('today-list').innerHTML = papers.map(function (p) {
      return '<article class="today-item">' + cardInnerHTML(p) + '</article>';
    }).join('');
    bindActs($('today-list'));
  }

  function renderFeed() {
    var term = state.query.trim().toLowerCase();
    var list = allPapers().filter(function (p) { return !term || matches(p, term); });
    $('result-count').textContent = list.length + ' result' + (list.length === 1 ? '' : 's');

    /* pinned card, if a TLDR bullet sent us here */
    var pin = state.pinned ? paperById(state.pinned) : null;
    $('pinned-slot').innerHTML = pin ? (
      '<div class="pin-head"><span class="label">From the TLDR</span><span class="rule"></span>' +
      '<button class="act" id="clear-pin" type="button">Clear</button></div>' +
      '<article class="paper-card is-pinned">' + cardInnerHTML(pin) + '</article>'
    ) : '';
    if (pin) {
      $('clear-pin').addEventListener('click', function () { state.pinned = ''; renderFeed(); });
      bindActs($('pinned-slot'));
    }

    var body = list.filter(function (p) { return !pin || p.id !== pin.id; });
    var html = '';

    if (state.sort === 'relevance') {
      var ranked = body.slice().sort(function (a, b) { return relRank(b.relevance) - relRank(a.relevance); });
      if (ranked.length) html += dayHeadHTML('Ranked by relevance', ranked.length);
      html += ranked.map(cardHTML).join('');
    } else {
      (state.data.dailyUpdates || []).forEach(function (day) {
        var ps = body.filter(function (p) { return day.papers.indexOf(p) !== -1; });
        if (!ps.length) return;
        html += dayHeadHTML(dayLabel(day.date), ps.length) + ps.map(cardHTML).join('');
      });
    }

    $('feed-list').innerHTML = html;
    $('feed-empty').hidden = !!(html || pin);
    bindActs($('feed-list'));
  }

  function renderWeeklyPicks() {
    var w = state.data.weeklyTldr || {};
    var picks = w.topPicks || state.data.featuredPapers || [];
    $('weekly-pick-count').textContent = picks.length + ' of ' + allPapers().length;
    $('weekly-picks').innerHTML = picks.map(function (p, i) {
      var why = p.featuredReason || p.why || p.reason || '';
      return '<article class="paper-card">' +
        '<div class="pick-head">' +
          '<span class="pick-rank">' + pad(i + 1) + '</span>' +
          tagsHTML(p) +
        '</div>' +
        '<h3 class="paper-title">' + titleLinkHTML(p) + '</h3>' +
        (p.summary ? '<p class="paper-summary">' + esc(p.summary) + '</p>' : '') +
        (why ? '<div class="why"><span class="why-kicker">Why it\'s picked</span>' +
               '<span class="why-text">' + esc(why) + '</span></div>' : '') +
        footHTML(p) +
      '</article>';
    }).join('');
    bindActs($('weekly-picks'));
  }

  function renderSaved() {
    var list = savedPapers();
    $('saved-empty').hidden = list.length > 0;
    $('saved-list').innerHTML = list.map(cardHTML).join('');
    bindActs($('saved-list'));
    if (state.tab === 'saved') renderKicker();
  }

  /* ── card builders ──────────────────────────────────── */

  function cardHTML(p) { return '<article class="paper-card">' + cardInnerHTML(p) + '</article>'; }

  function cardInnerHTML(p) {
    return tagsHTML(p) +
      '<h3 class="paper-title">' + titleLinkHTML(p) + '</h3>' +
      (p.summary ? '<p class="paper-summary">' + esc(p.summary) + '</p>' : '') +
      footHTML(p);
  }

  /* topic / studyType are optional — rendered only when the backend supplies them. */
  function tagsHTML(p) {
    var out = '<div class="tagrow">';
    if (p.topic) out += '<span class="tag">' + esc(p.topic) + '</span>';
    if (p.studyType) out += '<span class="tag tag-outline">' + esc(p.studyType) + '</span>';
    var lvl = relLevel(p.relevance);
    if (lvl) out += '<span class="rel' + (lvl === 'High' ? ' rel-high' : '') + '">' + lvl + ' rel</span>';
    return out + '</div>';
  }

  function titleLinkHTML(p) {
    var href = externalHref(p);
    if (href === '#') return esc(p.title);
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>';
  }

  function footHTML(p) {
    var meta = esc(p.journal || '');
    if (p.date) meta += ' · ' + shortDate(new Date(p.date + 'T00:00:00'));
    var saved = isSaved(p.id);
    var links = '';
    if (p.pmid) links += '<a class="act" href="https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(p.pmid) + '/" target="_blank" rel="noopener">PubMed</a>';
    if (p.doi) links += '<a class="act" href="https://doi.org/' + encodeURIComponent(p.doi) + '" target="_blank" rel="noopener">DOI</a>';
    return '<div class="paper-foot">' +
      '<span class="paper-meta">' + meta + '</span>' +
      '<span class="paper-acts">' + links +
        '<button class="act' + (saved ? ' is-saved' : '') + '" data-save="' + esc(p.id) + '" type="button">' +
          (saved ? 'Saved' : 'Save') +
        '</button>' +
      '</span></div>';
  }

  function dayHeadHTML(label, n) {
    return '<div class="day-head"><span class="label">' + esc(label) + '</span>' +
      '<span class="rule"></span><span class="n">' + n + ' paper' + (n === 1 ? '' : 's') + '</span></div>';
  }

  function bindActs(root) {
    root.querySelectorAll('[data-save]').forEach(function (btn) {
      btn.addEventListener('click', function () { toggleSave(btn.getAttribute('data-save')); });
    });
  }

  /* ── saved ──────────────────────────────────────────── */

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function persistSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved)); } catch (e) {}
  }
  function isSaved(id) { return !!state.saved[id]; }
  function toggleSave(id) {
    if (state.saved[id]) delete state.saved[id]; else state.saved[id] = true;
    persistSaved();
    renderToday(); renderFeed(); renderWeeklyPicks(); renderSaved();
  }
  function savedPapers() {
    return allPapers().filter(function (p) { return isSaved(p.id); });
  }

  /* ── bindings ───────────────────────────────────────── */

  function bindHome() {
    collapser('fun-fact-toggle', 'fun-fact-body', 'Read more', 'Close');
    collapser('daily-tldr-toggle', 'daily-tldr-body', '+', '−');
    collapser('weekly-tldr-toggle-home', 'weekly-tldr-body-home', '+', '−');
    $('btn-open-feed').addEventListener('click', function () { setTab('feed'); });
  }

  function bindWeekly() {
    collapser('weekly-tldr-toggle', 'weekly-tldr-body', '+', '−');
  }

  function collapser(btnId, bodyId, closedLabel, openLabel) {
    var btn = $(btnId), body = $(bodyId);
    if (!btn || !body) return;
    btn.addEventListener('click', function () {
      var open = body.hidden;
      body.hidden = !open;
      btn.textContent = open ? openLabel : closedLabel;
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  function bindFeed() {
    $('search-input').addEventListener('input', function (e) {
      state.query = e.target.value;
      renderFeed();
    });
    document.querySelectorAll('.chip[data-sort]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.sort = chip.getAttribute('data-sort');
        document.querySelectorAll('.chip[data-sort]').forEach(function (c) {
          c.classList.toggle('is-on', c === chip);
        });
        renderFeed();
      });
    });
  }

  /* ── data helpers ───────────────────────────────────── */

  function allPapers() {
    if (!state.data) return [];
    var out = [];
    (state.data.dailyUpdates || []).forEach(function (d) { out = out.concat(d.papers || []); });
    return out;
  }
  function paperById(id) {
    return allPapers().filter(function (p) { return p.id === id; })[0] || null;
  }
  function matches(p, term) {
    return ((p.title || '') + ' ' + (p.journal || '') + ' ' + (p.summary || '') + ' ' + (p.relevance || ''))
      .toLowerCase().indexOf(term) !== -1;
  }
  function externalHref(p) {
    if (p.pmid) return 'https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(p.pmid) + '/';
    if (p.doi) return 'https://doi.org/' + encodeURIComponent(p.doi);
    return '#';
  }

  /* Relevance is collapsed to High / Med / Low, from the same
     emoji-or-word indicator the previous build parsed. */
  function relLevel(text) {
    if (!text) return '';
    var t = String(text).toLowerCase();
    if (text.indexOf('🟢') !== -1 || t.indexOf('high') !== -1) return 'High';
    if (text.indexOf('🔴') !== -1 || t.indexOf('low') !== -1 || t.indexOf('indirect') !== -1) return 'Low';
    return 'Med';
  }
  function relRank(text) {
    var l = relLevel(text);
    return l === 'High' ? 3 : (l === 'Med' ? 2 : 1);
  }

  function bulletLines(summary) {
    return String(summary).split('\n')
      .map(function (l) { return l.replace(/^[•\-]\s*/, '').trim(); })
      .filter(Boolean);
  }

  /* ── formatting ─────────────────────────────────────── */

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function dayLabel(date) {
    var d = new Date(date + 'T00:00:00');
    var today = new Date();
    var same = d.toDateString() === today.toDateString();
    var label = DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' +
      d.toLocaleDateString('en-GB', { month: 'short' });
    return same ? 'Today · ' + label : label;
  }
  function longDate(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function shortDate(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }
})();
