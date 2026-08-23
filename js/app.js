/* ============================================================
   Paramedic Papers — app logic (mobile news-app redesign)
   Reads the same data/papers.json schema as the previous build.
   ============================================================ */

(function () {
  'use strict';

  var SAVED_KEY = 'pp:saved';

  /* Matches the desktop layer in css/style.css. Above it the sidebar takes
     over navigation, search lives in the header and the Feed gains two
     extra filters; below it the mobile layout is untouched. */
  var DESKTOP = window.matchMedia('(min-width: 960px)');
  function isWide() { return DESKTOP.matches; }

  var state = {
    data: null,
    tab: 'home',
    query: '',
    sort: 'newest',
    pinned: '',
    highRelOnly: false,
    savedOnly: false,
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
    DESKTOP.addEventListener('change', syncLayout);
    syncLayout();

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
    /* Always cache-bust: GitHub Pages caches for ~10 min, and the fun
       fact / TLDR change with each push. The query string forces a fresh
       fetch on every page load and manual refresh. */
    var url = 'data/papers.json?t=' + Date.now();
    var resp = await fetch(url, { cache: 'no-cache' });
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
  /* On desktop the sidebar carries the wordmark, so the content header
     names the view instead of the app. */
  var TITLES_WIDE = { home: 'Today', feed: 'Research feed', weekly: 'Weekly digest', saved: 'Saved papers' };

  function tabFromHash() {
    var h = (location.hash || '').replace('#', '');
    return TABS.indexOf(h) !== -1 ? h : 'home';
  }

  /* Binds both the mobile tab bar and the desktop sidebar nav. */
  function bindTabs() {
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); });
    });
  }

  function setTab(tab, silent) {
    state.tab = tab;
    TABS.forEach(function (t) { $('page-' + t).hidden = (t !== tab); });
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-tab') === tab);
    });
    $('page-title').textContent = (isWide() ? TITLES_WIDE : TITLES)[tab];
    renderKicker();
    if (!silent) location.hash = tab;
    window.scrollTo(0, 0);
  }

  /* ── desktop / mobile layout swap ───────────────────── */

  /* The search box and the updated-stamp + refresh pair live in different
     places per breakpoint. Rather than duplicating them (and their ids),
     the same nodes are re-parented when the breakpoint flips. */
  function syncLayout() {
    var wide = isWide();
    var search = document.querySelector('.search-wrap');
    var acts = document.querySelector('.masthead-actions');
    var row = $('masthead-row');
    var feed = $('page-feed');

    if (wide) {
      $('sidebar-foot').appendChild(acts);
      row.appendChild(search);
    } else {
      feed.insertBefore(search, feed.firstChild);
      row.appendChild(acts);
    }
    applyPanelDefaults();
    $('page-title').textContent = (wide ? TITLES_WIDE : TITLES)[state.tab];
    if (state.data) renderToday();
  }

  /* TLDR panels start expanded on desktop (the rail has the room) and
     collapsed on mobile. The fun-fact panel follows the same rule — expanded
     on desktop, collapsed with a Read-more toggle on mobile. The +/− toggles
     stay live either way. */
  function applyPanelDefaults() {
    var wide = isWide();
    [['daily-tldr-toggle', 'daily-tldr-body'],
     ['weekly-tldr-toggle-home', 'weekly-tldr-body-home']].forEach(function (pair) {
      var btn = $(pair[0]), body = $(pair[1]);
      body.hidden = !wide;
      btn.textContent = wide ? '−' : '+';
      btn.setAttribute('aria-expanded', String(wide));
    });

    var factBody = $('fun-fact-body'), factToggle = $('fun-fact-toggle');
    var hasMore = !!factBody.textContent;
    factBody.hidden = !(wide && hasMore);
    factToggle.hidden = !hasMore || wide;
    factToggle.textContent = 'Read more';
    factToggle.setAttribute('aria-expanded', 'false');
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
    renderSidebar();
    applyPanelDefaults();
  }

  /* Sidebar count pills and the scan-window block. The week count is taken
     relative to the newest scan rather than today, so the numbers stay
     meaningful when a scan has not run for a day or two. */
  function renderSidebar() {
    var days = state.data.dailyUpdates || [];
    var savedCount = savedPapers().length;

    $('nav-count-feed').textContent = allPapers().length;
    $('nav-count-saved').textContent = savedCount;
    $('nav-count-saved').hidden = savedCount === 0;

    var todayCount = days.length ? (days[0].papers || []).length : 0;
    $('scan-today').textContent = todayCount + ' new';
    $('scan-week').textContent = weekPaperCount(days);
    $('scan-total').textContent = days.length;
  }

  function weekPaperCount(days) {
    if (!days.length) return 0;
    var newest = new Date(days[0].date + 'T00:00:00');
    var cutoff = new Date(newest.getTime() - 6 * 86400000);
    return days.reduce(function (n, d) {
      return new Date(d.date + 'T00:00:00') >= cutoff ? n + (d.papers || []).length : n;
    }, 0);
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

  /* Fun fact — prefer the server-picked daily fact (funFact), which changes
     with each dashboard push. Fall back to client-side day-of-year rotation
     for older cached data that lacks the field. */
  function renderFunFact() {
    var facts = state.data.funFacts || [];
    if (!facts.length && !state.data.funFact) { $('fun-fact-panel').hidden = true; return; }
    var fact;
    if (state.data.funFact && state.data.funFact.fact) {
      fact = state.data.funFact;
    } else {
      var now = new Date();
      var dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
      fact = facts[dayOfYear % facts.length];
    }
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

    /* Use highlights (structured, with paper ids) as the expanded bullets.
       Each highlight's note is the bullet text and its id links to the paper.
       If no highlights exist, fall back to plain summary lines. */
    var items;
    if (t.highlights && t.highlights.length) {
      items = t.highlights.map(function (h) {
        return { text: h.note || h.title, ref: h.id, refTitle: h.title };
      });
    } else {
      items = lines.slice(1).map(function (l) { return { text: l, ref: null }; });
    }
    $('daily-tldr-body').innerHTML = bulletsHTML(items, false);
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
    /* The desktop section head carries the scan date alongside the count. */
    $('today-count').textContent = papers.length + ' new today' +
      (isWide() && day ? ' · ' + dayLabel(day.date).replace('Today · ', '') : '');
    $('today-list').innerHTML = papers.map(function (p) {
      return '<article class="today-item" data-today-id="' + esc(p.id) + '">' +
        todayCardInnerHTML(p) + '</article>';
    }).join('');
    bindActs($('today-list'));
    bindTodayExpand($('today-list'));
  }

  /* Home cards are compact: summary is line-clamped, tapping the body
     expands it to reveal the full summary and full relevance detail.
     Title link and action buttons are outside the tappable area. */
  function todayCardInnerHTML(p) {
    return tagsHTML(p) +
      '<h3 class="paper-title">' + titleLinkHTML(p) + '</h3>' +
      '<div class="today-expand" data-expand>' +
        (p.summary ? '<p class="paper-summary">' + esc(p.summary) + '</p>' : '') +
        (p.relevance ? '<p class="today-detail">' + esc(p.relevance) + '</p>' : '') +
        '<span class="today-chev" aria-hidden="true"></span>' +
      '</div>' +
      footHTML(p);
  }

  function bindTodayExpand(root) {
    root.querySelectorAll('[data-expand]').forEach(function (el) {
      el.addEventListener('click', function () {
        var card = el.closest('.today-item');
        if (!card) return;
        card.classList.toggle('is-expanded');
      });
    });
  }

  function renderFeed() {
    var term = state.query.trim().toLowerCase();
    var list = allPapers().filter(function (p) {
      if (term && !matches(p, term)) return false;
      if (state.highRelOnly && relLevel(p.relevance) !== 'High') return false;
      if (state.savedOnly && !isSaved(p.id)) return false;
      return true;
    });
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
    renderToday(); renderFeed(); renderWeeklyPicks(); renderSaved(); renderSidebar();
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
    $('btn-see-week').addEventListener('click', function () { setTab('weekly'); });
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
      /* On desktop the search sits in the header on every view — typing
         there means the reader wants the feed. */
      if (state.tab !== 'feed') setTab('feed');
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
    /* Desktop-only feed filters; not persisted. */
    document.querySelectorAll('.chip[data-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var key = chip.getAttribute('data-filter') === 'high' ? 'highRelOnly' : 'savedOnly';
        state[key] = !state[key];
        chip.classList.toggle('is-on', state[key]);
        chip.setAttribute('aria-pressed', String(state[key]));
        renderFeed();
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'k' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (state.tab !== 'feed' && !isWide()) setTab('feed');
      $('search-input').focus();
      $('search-input').select();
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
