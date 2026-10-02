/* ============================================================
   Paramedic Papers — app logic (mobile news-app redesign)
   Reads the same data/papers.json schema as the previous build.
   ============================================================ */

(function () {
  'use strict';

  var SAVED_KEY = 'pp:saved';
  var POS_KEY = 'pp:pos';    /* episode date -> seconds listened */
  var RATE_KEY = 'pp:rate';
  var RATES = [1, 1.25, 1.5];

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
    topic: '',
    episodes: [],
    playDate: null,
    rate: loadRate(),
    positions: loadJSON(POS_KEY),
    saved: loadSaved()
  };

  var $ = function (id) { return document.getElementById(id); };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindTabs();
    bindHome();
    bindFeed();
    bindWeekly();
    bindPodcast();
    bindSaved();
    $('btn-refresh').addEventListener('click', refresh);
    window.addEventListener('hashchange', function () {
      if (paperFromHash()) { openPaperLink(); return; }
      if (episodeFromHash()) { openEpisodeLink(); return; }
      setTab(tabFromHash(), true);
    });
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
    if (paperFromHash()) openPaperLink(); else setTab(tabFromHash(), true);

    /* Podcast episodes are independent of papers.json — a missing or failed
       episodes.json must never break the paper dashboard. */
    loadEpisodes().then(function (eps) {
      state.episodes = eps;
      renderPodcastStrip();
      renderEpisodes();
      renderPaperLists();
      if (episodeFromHash()) openEpisodeLink();
    }).catch(function (err) {
      console.warn('No podcast episodes:', err && err.message);
    });
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
      loadEpisodes().then(function (eps) {
        state.episodes = eps;
        renderPodcastStrip();
        renderEpisodes();
        renderPaperLists();
      }).catch(function () {});
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      btn.disabled = false; btn.classList.remove('spinning');
    }
  }

  /* ── navigation ─────────────────────────────────────── */

  var TABS = ['home', 'feed', 'weekly', 'podcast', 'saved'];
  var TITLES = { home: 'Paramedic Papers', feed: 'Research feed', weekly: 'Weekly', podcast: 'Podcast', saved: 'Saved' };
  /* On desktop the sidebar carries the wordmark, so the content header
     names the view instead of the app. */
  var TITLES_WIDE = { home: 'Today', feed: 'Research feed', weekly: 'Weekly digest', podcast: 'Podcast', saved: 'Saved papers' };

  /* Shareable paper links: #paper=<encoded id> opens the feed with that
     paper pinned at the top. */
  function paperFromHash() {
    var m = /^#paper=(.+)$/.exec(location.hash || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
  }

  function openPaperLink() {
    var id = paperFromHash();
    if (!id || !paperById(id)) { setTab('feed', true); return; }
    state.pinned = id;
    state.pinnedFrom = 'link';
    state.query = '';
    $('search-input').value = '';
    renderFeed();
    setTab('feed', true);
  }

  /* Episode links from the RSS show notes: #episode=YYYY-MM-DD opens the
     Podcast tab with that episode's notes expanded. */
  function episodeFromHash() {
    var m = /^#episode=(\d{4}-\d{2}-\d{2})$/.exec(location.hash || '');
    return m ? m[1] : '';
  }

  function openEpisodeLink() {
    var date = episodeFromHash();
    setTab('podcast', true);
    var row = document.querySelector('.ep-row[data-ep="' + date + '"]');
    if (!row) return;  /* episodes not loaded yet — init calls this again */
    toggleNotes(row, true);
    row.scrollIntoView({ block: 'start' });
  }

  function paperLink(id) {
    return location.origin + location.pathname + '#paper=' + encodeURIComponent(id);
  }

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
    renderTopicFilter();
    renderFeed();
    renderWeeklyPicks();
    renderSaved();
    renderPodcastStrip();
    renderEpisodes();
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

    var todayCount = days.length && isToday(days[0].date) ? (days[0].papers || []).length : 0;
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
    } else if (state.tab === 'podcast') {
      text = state.episodes.length ? state.episodes.length + ' episodes' : 'Daily audio roundup';
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
    var split = sentenceEnd(text);
    var head = split > 40 ? text.slice(0, split + 1) : text;
    var rest = split > 40 ? text.slice(split + 1).trim() : '';

    $('fun-fact-headline').textContent = head;
    $('fun-fact-body').textContent = rest;
    $('fun-fact-toggle').hidden = !rest;
  }

  /* Index of the full stop ending the first sentence, or -1. Skips
     abbreviations ("e.g.", "vs.", "Dr.") and full stops not followed by a
     capital, so the headline isn't cut mid-sentence. */
  var ABBREVS = /(?:\b(?:e\.g|i\.e|vs|etc|approx|Dr|Mr|Mrs|Ms|St|No|Fig|cf|al)|\b[A-Z])$/;
  function sentenceEnd(text) {
    var re = /\.\s+(?=["'‘“(]?[A-Z0-9])/g, m;
    while ((m = re.exec(text))) {
      if (!ABBREVS.test(text.slice(0, m.index))) return m.index;
    }
    return -1;
  }

  /* Daily TLDR — lead is the first summary line, expanded bullets are
     tldr.highlights, each linking to its paper card via highlight.id. */
  function renderDailyTldr() {
    var t = state.data.tldr;
    /* The TLDR is from the latest scan, which on a quiet day (or before the
       morning run) is not today's — say which day it covers. */
    $('daily-tldr-kicker').textContent = (t && t.date && !isToday(t.date))
      ? 'Latest TLDR · ' + dayLabel(t.date) : "Today's TLDR";
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
        state.pinnedFrom = 'tldr';
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
    var fresh = day && isToday(day.date);
    /* No scan today (quiet day, or the morning run hasn't happened yet):
       keep showing the latest scan, labelled with its date. */
    $('today-head').textContent = fresh || !day ? "Today's newest" : 'Latest scan';
    if (fresh || !day) {
      /* The desktop section head carries the scan date alongside the count. */
      $('today-count').textContent = papers.length + ' new today' +
        (isWide() && day ? ' · ' + dayLabel(day.date).replace('Today · ', '') : '');
    } else {
      $('today-count').textContent = 'None new today · ' + dayLabel(day.date);
    }
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
        (hasFacts(p) ? '<div class="today-detail">' + factsHTML(p) + '</div>' : '') +
        '<span class="today-chev" aria-hidden="true"></span>' +
      '</div>' +
      /* Desktop hides the tap-to-expand detail, so it gets the Details toggle. */
      extraHTML(p, isWide()) +
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

  /* Topic filter: only topics present in the data (structured triage
     fields exist from 2 Oct 2026; older papers have none). Hidden until
     there are at least two topics to choose between. */
  function renderTopicFilter() {
    var counts = {};
    allPapers().forEach(function (p) { if (p.topic) counts[p.topic] = (counts[p.topic] || 0) + 1; });
    var topics = Object.keys(counts).sort();
    var sel = $('topic-filter');
    sel.hidden = topics.length < 2;
    sel.innerHTML = '<option value="">All topics</option>' + topics.map(function (t) {
      return '<option value="' + esc(t) + '"' + (t === state.topic ? ' selected' : '') + '>' +
        esc(t) + ' (' + counts[t] + ')</option>';
    }).join('');
    sel.classList.toggle('is-on', !!state.topic);
  }

  function renderFeed() {
    var term = state.query.trim().toLowerCase();
    var list = allPapers().filter(function (p) {
      if (term && !matches(p, term)) return false;
      if (state.highRelOnly && relLevel(p.relevance) !== 'High') return false;
      if (state.savedOnly && !isSaved(p.id)) return false;
      if (state.topic && p.topic !== state.topic) return false;
      return true;
    });
    $('result-count').textContent = list.length + ' result' + (list.length === 1 ? '' : 's');

    /* pinned card, if a TLDR bullet sent us here */
    var pin = state.pinned ? paperById(state.pinned) : null;
    $('pinned-slot').innerHTML = pin ? (
      '<div class="pin-head"><span class="label">' +
        (state.pinnedFrom === 'link' ? 'Shared paper' : 'From the TLDR') +
        '</span><span class="rule"></span>' +
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
        extraHTML(p, true) +
        footHTML(p) +
      '</article>';
    }).join('');
    bindActs($('weekly-picks'));
  }

  function renderSaved() {
    var list = savedPapers();
    $('saved-empty').hidden = list.length > 0;
    $('saved-tools').hidden = list.length === 0;
    $('saved-list').innerHTML = list.map(cardHTML).join('');
    bindActs($('saved-list'));
    if (state.tab === 'saved') renderKicker();
  }

  /* ── podcast ────────────────────────────────────────── */

  /* One shared Audio element for the whole app: starting an episode from
     anywhere stops whatever was playing (single-player invariant). */
  var audioEl = null;
  var lastSave = 0;
  function getAudio() {
    if (!audioEl) {
      audioEl = new Audio();
      ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata'].forEach(function (ev) {
        audioEl.addEventListener(ev, syncPlayerUi);
      });
      audioEl.addEventListener('timeupdate', function () {
        if (Date.now() - lastSave > 5000) savePosition();
      });
      audioEl.addEventListener('pause', function () { savePosition(); renderEpisodes(); });
      audioEl.addEventListener('ended', function () {
        delete state.positions[state.playDate];
        persistJSON(POS_KEY, state.positions);
        renderEpisodes();
      });
    }
    return audioEl;
  }

  /* Listening position per episode, so a half-played episode resumes. */
  function savePosition() {
    var a = audioEl;
    if (!a || !state.playDate || !a.duration) return;
    lastSave = Date.now();
    if (a.currentTime > 5 && a.currentTime < a.duration - 10) {
      state.positions[state.playDate] = Math.floor(a.currentTime);
    } else if (a.currentTime >= a.duration - 10) {
      delete state.positions[state.playDate];
    }
    persistJSON(POS_KEY, state.positions);
  }

  function playEpisode(ep) {
    var a = getAudio();
    if (state.playDate === ep.date) {
      if (a.paused) a.play(); else a.pause();
      return;
    }
    savePosition();
    a.src = ep.url || 'audio/' + ep.file;  /* audio lives on R2 (audio.paramedicpapers.com) */
    a.defaultPlaybackRate = a.playbackRate = state.rate;
    state.playDate = ep.date;
    var resume = state.positions[ep.date] || 0;
    if (resume) {
      a.addEventListener('loadedmetadata', function seek() {
        a.removeEventListener('loadedmetadata', seek);
        if (resume < a.duration - 10) a.currentTime = resume;
      });
    }
    a.play();
    /* "Paramedic Papers Daily — 2 October 2026" → "2 October 2026": the
       bar is narrow on phones and the show name adds nothing there. */
    $('player-title').textContent = ep.title.replace(/^.*—\s*/, '') || ep.title;
    $('player').hidden = false;
    document.body.classList.add('has-player');
    setMediaSession(ep);
    syncPlayerUi();
  }

  /* Lock-screen / headphone / car controls. */
  function setMediaSession(ep) {
    if (!('mediaSession' in navigator)) return;
    var icon = new URL('icon-512.png', location.href).href;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title, artist: 'Paramedic Papers Daily', album: 'Paramedic Papers',
      artwork: [{ src: icon, sizes: '512x512', type: 'image/png' }]
    });
    var a = getAudio();
    var handlers = {
      play: function () { a.play(); },
      pause: function () { a.pause(); },
      seekbackward: function (d) { skip(-((d && d.seekOffset) || 15)); },
      seekforward: function (d) { skip((d && d.seekOffset) || 30); },
      seekto: function (d) { if (d && d.seekTime != null) a.currentTime = d.seekTime; }
    };
    Object.keys(handlers).forEach(function (k) {
      try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (e) {}
    });
  }

  function skip(sec) {
    var a = getAudio();
    if (!a.duration) return;
    a.currentTime = Math.max(0, Math.min(a.duration - 0.5, a.currentTime + sec));
  }

  function fmtClock(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  /* Reflect audio state onto every play button ([data-ep-play]) and the
     strip's progress bar. Called from audio events and after renders. */
  function syncPlayerUi() {
    var a = getAudio();
    var playing = !a.paused && !a.ended && a.src;
    document.querySelectorAll('[data-ep-play]').forEach(function (btn) {
      var on = playing && btn.getAttribute('data-ep-play') === state.playDate;
      btn.classList.toggle('is-on', on);
      var p = btn.querySelector('.ply'), s = btn.querySelector('.pse');
      if (p && s) { p.style.display = on ? 'none' : ''; s.style.display = on ? '' : 'none'; }
    });
    var bar = $('strip-progress');
    if (bar) bar.style.width = (a.duration ? (a.currentTime / a.duration) * 100 : 0) + '%';

    $('player-play').setAttribute('data-ep-play', state.playDate || '');
    var seek = $('player-seek');
    if (a.duration && !seek.matches(':active')) {
      seek.max = Math.floor(a.duration);
      seek.value = Math.floor(a.currentTime);
      seek.style.setProperty('--pct', (a.currentTime / a.duration * 100) + '%');
    }
    $('player-time').textContent = fmtClock(a.currentTime) + ' / ' + fmtClock(a.duration);
    if ('mediaSession' in navigator && a.duration && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration: a.duration, playbackRate: a.playbackRate, position: Math.min(a.currentTime, a.duration)
        });
      } catch (e) {}
    }
  }

  async function loadEpisodes() {
    var resp = await fetch('data/episodes.json?t=' + Date.now(), { cache: 'no-cache' });
    if (!resp.ok) throw new Error('episodes.json not available');
    var d = await resp.json();
    return d.episodes || [];
  }

  /* Latest episode at the top of Home. Pure render — listeners live in
     bindPodcast() so refreshes can't stack duplicates. */
  function renderPodcastStrip() {
    var strip = $('podcast-strip');
    if (!strip) return;
    if (!state.episodes.length) { strip.hidden = true; return; }
    var ep = state.episodes[0];
    strip.hidden = false;
    $('strip-title').textContent = ep.title;
    $('strip-dur').textContent = fmtDur(ep.durationSec);
    var btn = $('strip-play');
    btn.setAttribute('data-ep-play', ep.date);
    btn.setAttribute('aria-label', 'Play ' + ep.title);
    syncPlayerUi();
  }

  /* Full episode list on the Podcast tab. */
  function renderEpisodes() {
    var list = $('episode-list');
    if (!list) return;
    $('episode-count').textContent = state.episodes.length || '';
    $('episodes-empty').hidden = !!state.episodes.length;
    list.innerHTML = state.episodes.map(function (ep) {
      var hasNotes = (ep.papers && ep.papers.length) || ep.transcript;
      return '<div class="ep-row" data-ep="' + esc(ep.date) + '">' +
        '<div class="ep-main">' +
          '<button class="ep-play" data-ep-play="' + esc(ep.date) + '" type="button" aria-label="Play ' + esc(ep.title) + '">' +
            playIconSVG() +
          '</button>' +
          '<div class="ep-meta">' +
            '<span class="ep-date">' + esc(ep.date) + (ep.kind === 'archive' ? ' · From the archive' : '') + '</span>' +
            '<span class="ep-name">' + esc(ep.title) + '</span>' +
            '<span class="ep-desc">' + esc(ep.description) + '</span>' +
            (hasNotes ? '<button class="link-btn ep-notes-btn" data-notes type="button" aria-expanded="false">Show notes</button>' : '') +
          '</div>' +
          '<span class="ep-len">' + epLenLabel(ep) + '</span>' +
        '</div>' +
        (hasNotes ? '<div class="ep-notes" hidden>' + notesHTML(ep) + '</div>' : '') +
      '</div>';
    }).join('');
    list.querySelectorAll('[data-notes]').forEach(function (btn) {
      btn.addEventListener('click', function () { toggleNotes(btn.closest('.ep-row')); });
    });
    list.querySelectorAll('[data-transcript]').forEach(function (btn) {
      btn.addEventListener('click', function () { loadTranscript(btn); });
    });
    bindPaperLinks(list);
    list.querySelectorAll('[data-ep-play]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = btn.getAttribute('data-ep-play');
        var ep = state.episodes.filter(function (e) { return e.date === d; })[0];
        if (ep) playEpisode(ep);
      });
    });
    syncPlayerUi();
  }

  /* Show notes: the papers covered (linking into the feed when the paper is
     on the dashboard) and the transcript, fetched on demand. */
  function notesHTML(ep) {
    var out = '';
    if (ep.papers && ep.papers.length) {
      out += '<ol class="ep-papers">' + ep.papers.map(function (pp) {
        var onSite = pp.id && paperById(pp.id);
        var label = esc(pp.title) + (pp.journal ? ' <span class="ep-journal">' + esc(pp.journal) + '</span>' : '');
        if (onSite) return '<li><button class="ep-paper" data-paper-link="' + esc(pp.id) + '" type="button">' + label + '</button></li>';
        var href = externalHref(pp);
        return '<li>' + (href !== '#' ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + label + '</a>' : label) + '</li>';
      }).join('') + '</ol>';
    }
    if (ep.transcript) {
      out += '<button class="link-btn" data-transcript="' + esc(ep.transcriptUrl || 'audio/' + ep.transcript) + '" type="button">Read transcript</button>' +
        '<div class="ep-transcript" hidden></div>';
    }
    return out;
  }

  function toggleNotes(row, open) {
    var notes = row && row.querySelector('.ep-notes');
    var btn = row && row.querySelector('[data-notes]');
    if (!notes) return;
    var show = open === undefined ? notes.hidden : open;
    notes.hidden = !show;
    btn.textContent = show ? 'Hide notes' : 'Show notes';
    btn.setAttribute('aria-expanded', String(show));
  }

  function loadTranscript(btn) {
    var box = btn.nextElementSibling;
    if (!box.hidden) { box.hidden = true; btn.textContent = 'Read transcript'; return; }
    btn.textContent = 'Loading…';
    fetch(btn.getAttribute('data-transcript'))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (text) {
        box.innerHTML = text.trim().split(/\n\s*\n/).map(function (para) {
          return '<p>' + esc(para) + '</p>';
        }).join('');
        box.hidden = false;
        btn.textContent = 'Hide transcript';
      })
      .catch(function () { btn.textContent = 'Transcript unavailable'; });
  }

  /* Paper buttons inside show notes open the paper in the feed. */
  function bindPaperLinks(root) {
    root.querySelectorAll('[data-paper-link]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        location.hash = 'paper=' + encodeURIComponent(btn.getAttribute('data-paper-link'));
      });
    });
  }

  /* paper id → newest episode that covered it */
  function episodeForPaper(id) {
    for (var i = 0; i < state.episodes.length; i++) {
      var ps = state.episodes[i].papers || [];
      for (var j = 0; j < ps.length; j++) if (ps[j].id === id) return state.episodes[i];
    }
    return null;
  }

  function playIconSVG() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
      '<path class="ply" d="M8 5v14l11-7z"/>' +
      '<path class="pse" d="M6 5h4v14H6zM14 5h4v14h-4z" style="display:none"/></svg>';
  }

  function fmtDur(s) { return Math.max(1, Math.round(s / 60)) + ' min'; }

  function epLenLabel(ep) {
    var pos = state.positions[ep.date];
    return pos ? fmtDur(ep.durationSec - pos) + ' left' : fmtDur(ep.durationSec);
  }

  /* Static listeners, bound once. */
  function bindPodcast() {
    $('strip-play').addEventListener('click', function () {
      if (state.episodes.length) playEpisode(state.episodes[0]);
    });
    $('strip-open').addEventListener('click', function () { setTab('podcast'); });
    $('strip-open').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab('podcast'); }
    });
    $('btn-copy-feed').addEventListener('click', function () {
      var btn = $('btn-copy-feed');
      copyText($('feed-url').textContent.trim(), function () { flash(btn, 'Copied ✓'); });
    });

    $('player-play').addEventListener('click', function () {
      var a = getAudio();
      if (!a.src) return;
      if (a.paused) a.play(); else a.pause();
    });
    $('player-back').addEventListener('click', function () { skip(-15); });
    $('player-fwd').addEventListener('click', function () { skip(30); });
    $('player-seek').addEventListener('input', function (e) {
      var a = getAudio();
      if (a.duration) a.currentTime = Number(e.target.value);
    });
    $('player-rate').addEventListener('click', function () {
      state.rate = RATES[(RATES.indexOf(state.rate) + 1) % RATES.length];
      try { localStorage.setItem(RATE_KEY, String(state.rate)); } catch (e) {}
      var a = getAudio();
      a.defaultPlaybackRate = a.playbackRate = state.rate;
      renderRate();
    });
    renderRate();
  }

  function renderRate() {
    $('player-rate').textContent = state.rate + '×';
  }

  function loadRate() {
    var r = 1;
    try { r = Number(localStorage.getItem(RATE_KEY)) || 1; } catch (e) {}
    return RATES.indexOf(r) !== -1 ? r : 1;
  }

  /* ── clipboard / share ──────────────────────────────── */

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { if (document.execCommand('copy')) done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function flash(btn, text) {
    var orig = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', orig);
    btn.textContent = text;
    setTimeout(function () { btn.textContent = orig; }, 1500);
  }

  /* Native share sheet where there is one (phones), else copy the link. */
  function sharePaper(id, btn) {
    var p = paperById(id);
    if (!p) return;
    var url = paperLink(id);
    if (navigator.share) {
      navigator.share({ title: p.title, text: p.title + ' (' + (p.journal || 'paper') + ')', url: url })
        .catch(function () {});
    } else {
      copyText(url, function () { flash(btn, 'Link copied'); });
    }
  }

  /* Saved papers as a numbered plain-text reference list. */
  function citationList() {
    return savedPapers().map(function (p, i) {
      var parts = [p.title.replace(/\.$/, '') + '.'];
      if (p.journal) parts.push(p.journal + '.');
      if (p.date) parts.push(p.date.slice(0, 4) + '.');
      if (p.doi) parts.push('https://doi.org/' + p.doi);
      else if (p.pmid) parts.push('https://pubmed.ncbi.nlm.nih.gov/' + p.pmid + '/');
      return (i + 1) + '. ' + parts.join(' ');
    }).join('\n');
  }

  /* ── card builders ──────────────────────────────────── */

  function cardHTML(p) { return '<article class="paper-card">' + cardInnerHTML(p) + '</article>'; }

  function cardInnerHTML(p) {
    return tagsHTML(p) +
      '<h3 class="paper-title">' + titleLinkHTML(p) + '</h3>' +
      (p.summary ? '<p class="paper-summary">' + esc(p.summary) + '</p>' : '') +
      extraHTML(p, true) +
      footHTML(p);
  }

  /* Structured triage fields (papers from 2 Oct 2026 on). */
  function hasFacts(p) { return !!(p.design || p.finding || p.caveat); }

  function factsHTML(p) {
    var rows = [];
    if (p.design || p.n) rows.push(['Design', [p.design, p.n].filter(Boolean).join(' · ')]);
    if (p.finding) rows.push(['Found', p.finding]);
    if (p.caveat) rows.push(['Caveat', p.caveat]);
    return '<dl class="facts">' + rows.map(function (r) {
      return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /* Row between summary and footer: a Details toggle for the structured
     fields (cards only; Home cards show them on tap) and a play button when
     an episode covered the paper. Empty when neither applies. */
  function extraHTML(p, withFacts) {
    var ep = episodeForPaper(p.id);
    var facts = withFacts && hasFacts(p);
    if (!facts && !ep) return '';
    return '<div class="paper-extra">' +
      (facts ? '<button class="act" data-details type="button" aria-expanded="false">Details</button>' : '') +
      (ep ? '<button class="act act-ep" data-episode="' + esc(ep.date) + '" type="button">▶ Episode · ' +
            esc(shortDate(new Date(ep.date + 'T00:00:00'))) + '</button>' : '') +
      '</div>' +
      (facts ? '<div class="facts-wrap" hidden>' + factsHTML(p) + '</div>' : '');
  }

  /* topic / studyType are optional — rendered only when the backend supplies them. */
  function tagsHTML(p) {
    var out = '<div class="tagrow">';
    if (p.topic) out += '<span class="tag">' + esc(p.topic) + '</span>';
    if (p.studyType) out += '<span class="tag tag-outline">' + esc(p.studyType) + '</span>';
    if (p.bottomLine) out += '<span class="tag tag-bl bl-' + esc(p.bottomLine.split(' ')[0].toLowerCase()) + '">' + esc(p.bottomLine) + '</span>';
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
    /* Publication date when known (Crossref/PubMed; may be month-only),
       otherwise the date we found it. */
    var pub = pubLabel(p.pubDate);
    if (pub) meta += ' · ' + pub;
    else if (p.date) meta += ' · ' + shortDate(new Date(p.date + 'T00:00:00'));
    var saved = isSaved(p.id);
    var links = '';
    if (p.pmid) links += '<a class="act" href="https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(p.pmid) + '/" target="_blank" rel="noopener">PubMed</a>';
    if (p.doi) links += '<a class="act" href="https://doi.org/' + encodeURIComponent(p.doi) + '" target="_blank" rel="noopener">DOI</a>';
    return '<div class="paper-foot">' +
      '<span class="paper-meta">' + meta + '</span>' +
      '<span class="paper-acts">' + links +
        '<button class="act" data-share="' + esc(p.id) + '" type="button">Share</button>' +
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
    root.querySelectorAll('[data-share]').forEach(function (btn) {
      btn.addEventListener('click', function () { sharePaper(btn.getAttribute('data-share'), btn); });
    });
    root.querySelectorAll('[data-details]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = btn.parentNode.nextElementSibling;
        box.hidden = !box.hidden;
        btn.textContent = box.hidden ? 'Details' : 'Hide details';
        btn.setAttribute('aria-expanded', String(!box.hidden));
      });
    });
    root.querySelectorAll('[data-episode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = btn.getAttribute('data-episode');
        var ep = state.episodes.filter(function (e) { return e.date === d; })[0];
        if (ep) playEpisode(ep);
      });
    });
  }

  /* Re-render every paper list (after episodes load, so cards gain their
     episode buttons). */
  function renderPaperLists() {
    if (!state.data) return;
    renderToday(); renderFeed(); renderWeeklyPicks(); renderSaved();
  }

  /* ── saved ──────────────────────────────────────────── */

  function loadSaved() { return loadJSON(SAVED_KEY); }
  function loadJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch (e) { return {}; }
  }
  function persistJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
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

  function bindSaved() {
    $('btn-copy-citations').addEventListener('click', function () {
      copyText(citationList(), function () { flash($('btn-copy-citations'), 'Copied ✓'); });
    });
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
    $('topic-filter').addEventListener('change', function (e) {
      state.topic = e.target.value;
      e.target.classList.toggle('is-on', !!state.topic);
      renderFeed();
    });
    /* High-rel / Saved filters; not persisted. */
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
    return [p.title, p.journal, p.summary, p.relevance, p.topic, p.studyType,
            p.shortTitle, p.design, p.finding, p.caveat, p.bottomLine]
      .map(function (v) { return v || ''; }).join(' ')
      .toLowerCase().indexOf(term) !== -1;
  }
  function externalHref(p) {
    if (p.pmid) return 'https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(p.pmid) + '/';
    if (p.doi) return 'https://doi.org/' + encodeURIComponent(p.doi);
    return '#';
  }

  /* Relevance is collapsed to High / Med / Low from the leading emoji, or
     failing that the leading word. Never search the whole text: reasons
     like "🟡 Medium — … low-acuity patients" mention other levels. */
  function relLevel(text) {
    if (!text) return '';
    var s = String(text);
    if (s.indexOf('🟢') !== -1) return 'High';
    if (s.indexOf('🟡') !== -1) return 'Med';
    if (s.indexOf('🔴') !== -1) return 'Low';
    var first = s.trim().split(/[^A-Za-z]+/)[0].toLowerCase();
    if (first === 'high') return 'High';
    if (first === 'low' || first === 'indirect') return 'Low';
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

  /* Scan dates are Sydney dates; compared with the reader's local date. */
  function isToday(date) {
    return new Date(date + 'T00:00:00').toDateString() === new Date().toDateString();
  }

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
  /* "2026-09-29" → "29 Sept 2026"; "2026-10" → "Oct 2026"; else ''. */
  function pubLabel(s) {
    if (!s) return '';
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
    if (!m) return '';
    var d = new Date(+m[1], +m[2] - 1, +(m[3] || 1));
    return d.toLocaleDateString('en-GB', m[3] ? { day: 'numeric', month: 'short', year: 'numeric' }
                                              : { month: 'short', year: 'numeric' });
  }

  function shortDate(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    /* innerHTML escapes & < > but not quotes, and esc() also fills attributes. */
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
