/* ============================================================
   Paramedic Papers — CPD tracker
   Sign-in, the "More" menu, the CPD tab, manual PD entries, learning
   goals, exports, the Account page, "Log PD" on paper cards
   (phase 2) and the PD quiz (phase 3). Talks to the API Worker at
   api.paramedicpapers.com (repo: cpd/, plan: cpd/plan/phase-1).
   Uses only window.PP from app.js. Behind /#cpd-beta until the
   launch (plan phase 4, Oct 2026).
   ============================================================ */

(function () {
  'use strict';

  var PP = window.PP;
  if (!PP) return;

  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8787' : 'https://api.paramedicpapers.com';
  var DRAFT_KEY = 'pp:cpd-draft';
  var PAPER_DRAFT_KEY = 'pp:cpd-paper:';   /* + paper id */
  var RESUME_KEY = 'pp:cpd-resume';        /* paper id to reopen after sign-in */
  var PROMO_KEY = 'pp:cpd-promo-closed';   /* the home launch card was dismissed */

  /* Copied from cpd/src/cpd.js — keep the two in step. */
  var ACTIVITY_TYPES = {
    reading: { label: 'Reading a paper', interactive: false },
    quiz: { label: 'PD quiz', interactive: false },
    journal_club: { label: 'Journal club', interactive: true },
    simulation: { label: 'Simulation / scenario', interactive: true },
    case_review: { label: 'Case review / M&M', interactive: true },
    conference: { label: 'Conference / in-service', interactive: true },
    mentoring: { label: 'Mentoring / supervision', interactive: true },
    online_course: { label: 'Online course', interactive: false },
    media: { label: 'Podcast / video', interactive: false },
    other: { label: 'Other', interactive: false }
  };
  var MANUAL_TYPES = ['journal_club', 'simulation', 'case_review', 'conference', 'mentoring', 'online_course', 'media', 'other'];
  var PROVIDER_NAMES = { google: 'Google', microsoft: 'Microsoft' };
  var MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
  /* Bar colours, validated with the dataviz palette checker (both pass on
     the light surface; the lighter one is below 3:1, so the chart has a
     legend, tooltips and a table view). */
  var C_INTERACTIVE = '#2F5FA8';
  var C_OTHER = '#6F93D8';

  var st = {
    checked: false,      /* /api/me has answered (or failed) */
    apiDown: false,
    user: null,
    providers: ['google', 'microsoft'],
    loginError: '',
    year: cpdYear(todayISO()),
    summary: null,       /* for st.year */
    entries: null,
    goals: null,
    loading: false,
    filter: 'all',       /* all | interactive | reflect */
    showTable: false,
    deleting: false,
    logged: null,        /* { paper_id: [{ id, minutes, activity_type }] } for the card badges */
    sheet: null          /* { type: 'menu' | 'entry' | 'goal' | 'paper' | 'signin', … } */
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = PP.esc, ico = PP.ico;

  /* ── boot ───────────────────────────────────────────── */

  readLoginError();
  PP.hooks.openMenu = openMenu;
  PP.hooks.kicker = kicker;
  PP.hooks.onShow = function (tab) {
    if (tab !== 'quiz') pauseClock();
    if (tab === 'quiz') showQuiz();
    if (tab === 'cpd' || tab === 'account') render();
    if (tab === 'cpd' && st.user && !st.entries && !st.loading) loadYear();
  };
  PP.hooks.onRender.push(renderChrome);
  PP.hooks.onRender.push(resumePaper);
  PP.hooks.paperAct = paperActHTML;
  PP.hooks.logPaper = logPaper;

  document.addEventListener('DOMContentLoaded', function () {
    $('sheet-backdrop').addEventListener('click', function () { closeSheet(true); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && st.sheet) closeSheet(true);
    });
    boot();
    loadQuizIndex();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseClock(); else resumeClock();
  });

  function boot() {
    /* Never blocks the rest of the site: papers.json loads in parallel. */
    api('/api/config').then(function (c) { if (c && c.providers) st.providers = c.providers; }).catch(function () {});
    api('/api/me').then(function (me) {
      st.user = me;
      st.checked = true;
      st.apiDown = false;
      render();
      resumePaper();
      loadLogged();
      loadAttempts();
      return loadYear();
    }).catch(function (err) {
      st.checked = true;
      if (!err || err.status !== 401) st.apiDown = true;
      render();
    });
  }

  /* "#account?login=failed&reason=AADSTS65001" from the API's callback. */
  function readLoginError() {
    var m = /^#account\?(.*)$/.exec(location.hash || '');
    if (!m) return;
    var q = new URLSearchParams(m[1]);
    if (q.get('login') === 'failed') st.loginError = q.get('reason') || 'unknown';
    try { history.replaceState(null, '', location.pathname + location.search + '#account'); } catch (e) {}
  }

  /* ── API client ─────────────────────────────────────── */

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (init.method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body || {});
    }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok) return data;
        var err = new Error(data.error || ('HTTP ' + r.status));
        err.status = r.status;
        err.field = data.field;
        err.data = data;
        if (r.status === 401) { st.user = null; st.entries = st.summary = st.goals = null; qz.attempts = null; dropLogged(); }
        throw err;
      });
    }, function (e) {
      st.apiDown = true;
      var err = new Error('The CPD tracker is unavailable right now.');
      err.status = 0;
      throw err;
    });
  }

  function loadYear() {
    if (!st.user) return Promise.resolve();
    st.loading = true;
    var y = st.year;
    return Promise.all([
      api('/api/summary?year=' + y),
      api('/api/entries?year=' + y),
      api('/api/goals?year=' + y)
    ]).then(function (r) {
      if (y !== st.year) return;
      st.apiDown = false;
      st.summary = r[0]; st.entries = r[1].entries; st.goals = r[2].goals;
    }).catch(function (err) {
      if (err.status !== 401) st.apiDown = true;
    }).then(function () {
      st.loading = false;
      render();
    });
  }

  function refreshSummary() {
    return api('/api/summary?year=' + st.year).then(function (s) { st.summary = s; });
  }

  /* ── dates and numbers ──────────────────────────────── */

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /* The registration year runs 1 Dec – 30 Nov, stored as its ending year. */
  function cpdYear(iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    return m === 12 ? y + 1 : y;
  }
  function yearLabel(y) { return (y - 1) + '–' + pad(y % 100); }
  function niceDate(iso, withYear) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-AU', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function hrs(min) {
    var h = Math.round(min / 6) / 10;
    return (h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)) + ' h';
  }
  function dur(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m || !h ? m + ' min' : '');
  }
  function daysLeft(y) {
    var end = new Date(y + '-11-30T23:59:59');
    return Math.max(0, Math.ceil((end - new Date()) / 86400000));
  }

  /* ── chrome: menu subtitles, sidebar chip, kicker ───── */

  function cpdLine() {
    if (!st.user) return 'Track your PD hours';
    var s = st.summary;
    if (!s || st.year !== cpdYear(todayISO())) return 'Your PD hours';
    return hrs(s.minutes).replace(' h', '') + ' of ' + st.user.target_hours + ' h · ' +
      hrs(s.interactive_minutes).replace(' h', '') + ' of ' + st.user.target_interactive_hours + ' h interactive';
  }

  function kicker(tab) {
    if (tab === 'quiz') {
      var q = qz.id && qz.quizzes[qz.id];
      return q ? q.span : qz.id === 'all' ? 'Past quizzes' : 'Every 8 days';
    }
    if (tab === 'account') return st.user ? 'Signed in with ' + (PROVIDER_NAMES[st.user.provider] || st.user.provider) : 'Not signed in';
    return 'Registration year ' + yearLabel(st.year);
  }

  function renderChrome() {
    var chipName = $('account-chip-name');
    if (chipName) {
      chipName.textContent = st.user ? (st.user.name || st.user.email || 'Account') : 'Sign in';
      $('account-chip-sub').textContent = st.user ? (st.user.email || '') : 'Track your CPD';
      $('account-chip-avatar').innerHTML = st.user ? esc(initial(st.user)) : ico('user');
    }
    var pill = $('nav-cpd-hours');
    if (pill) {
      var show = !!(st.user && st.summary && st.year === cpdYear(todayISO()));
      pill.hidden = !show;
      if (show) pill.textContent = hrs(st.summary.minutes);
    }
    if (st.sheet && st.sheet.type === 'menu') renderMenu();
  }

  function initial(u) {
    return ((u.name || u.email || '?').trim().charAt(0) || '?').toUpperCase();
  }

  function render() {
    renderChrome();
    var tab = PP.state.tab;
    if (tab === 'cpd') renderCpd();
    if (tab === 'account') renderAccount();
    if (tab === 'quiz') renderQuiz();
    renderQuizCard();
    renderPromo();
    PP.renderKicker();
  }

  /* Home: a one-line launch card for signed-out visitors, until dismissed.
     Waits for /api/me so signed-in users never see it flash. */
  function renderPromo() {
    var el = $('cpd-promo');
    if (!el) return;
    var closed = false;
    try { closed = localStorage.getItem(PROMO_KEY) === '1'; } catch (e) {}
    var show = st.checked && !st.user && !st.apiDown && !closed;
    el.hidden = !show;
    if (!show) { el.innerHTML = ''; return; }
    if (el.firstChild) return;
    el.innerHTML =
      '<a class="cpd-promo-link" href="#cpd"><span class="cpd-promo-new">New</span>' +
        '<span>Track your CPD hours, log papers, and take the PD quiz</span>' + ico('arrow') + '</a>' +
      '<button class="cpd-promo-close" type="button" aria-label="Dismiss">' + ico('x') + '</button>';
    el.querySelector('.cpd-promo-close').addEventListener('click', function () {
      try { localStorage.setItem(PROMO_KEY, '1'); } catch (e) {}
      el.hidden = true;
      el.innerHTML = '';
    });
  }

  /* ── sheets (menu, entry form, goal form) ───────────── */

  function openSheet(sheet, html) {
    st.sheet = sheet;
    var el = $('sheet');
    el.className = 'sheet sheet-' + sheet.type;
    el.innerHTML = html;
    el.hidden = false;
    $('sheet-backdrop').hidden = false;
    document.body.classList.add('has-sheet');
    var first = el.querySelector('[autofocus]') || el.querySelector('button, input, textarea, select, a');
    if (first) first.focus({ preventScroll: true });
  }

  /* soft = backdrop / Escape: an entry form keeps its draft. */
  function closeSheet(soft) {
    if (!st.sheet) return;
    if (!soft && st.sheet.type === 'entry') clearDraft();
    if (!soft && st.sheet.type === 'paper') clearPaperDraft(st.sheet.paperId);
    st.sheet = null;
    $('sheet').hidden = true;
    $('sheet').innerHTML = '';
    $('sheet-backdrop').hidden = true;
    document.body.classList.remove('has-sheet');
  }

  /* The mobile "More" tab. */
  function openMenu() {
    openSheet({ type: 'menu' }, '');
    renderMenu();
  }

  function renderMenu() {
    var saved = PP.savedCount();
    var acct = st.user ? (st.user.name || st.user.email) + ' · ' + (PROVIDER_NAMES[st.user.provider] || '') : 'Sign in';
    var item = function (tab, icon, title, sub, badge) {
      return '<button class="menu-item' + (PP.state.tab === tab ? ' is-on' : '') + '" data-go="' + tab + '" type="button">' +
        '<span class="menu-ico">' + ico(icon) + '</span>' +
        '<span class="menu-text"><span class="menu-title">' + esc(title) + '</span>' +
        (sub ? '<span class="menu-sub">' + esc(sub) + '</span>' : '') + '</span>' +
        (badge ? '<span class="nav-pill nav-pill-warm menu-badge">' + badge + '</span>' : '') +
        ico('chev-right', 'menu-chev') + '</button>';
    };
    var el = $('sheet');
    el.innerHTML =
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<h2 class="sr-only" id="sheet-title">More</h2>' +
      '<nav class="menu-list" aria-label="More">' +
        item('cpd', 'cpd', 'CPD', cpdLine()) +
        item('saved', 'saved', 'Saved', saved ? saved + ' paper' + (saved === 1 ? '' : 's') : 'Papers you keep for later', saved || '') +
        item('account', 'user', 'Account', acct) +
      '</nav>' +
      '<a class="menu-foot" href="privacy.html">Privacy</a>';
    el.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { closeSheet(true); PP.setTab(b.getAttribute('data-go')); });
    });
  }

  /* ── shared bits ────────────────────────────────────── */

  function signInHTML(lead, returnHash) {
    var back = returnHash || '#' + (PP.state.tab || 'cpd');
    var buttons = st.providers.map(function (p) {
      return '<a class="btn btn-provider" href="' + esc(API + '/auth/' + p + '?return=' + encodeURIComponent(back)) + '">' +
        providerLogo(p) + 'Continue with ' + esc(PROVIDER_NAMES[p] || p) + '</a>';
    }).join('');
    return '<article class="panel signin">' +
      '<span class="panel-kicker panel-kicker-accent">CPD tracker</span>' +
      '<h2 class="signin-title">' + esc(lead) + '</h2>' +
      '<p class="panel-lead">Log your PD as you go, see your hours against the Paramedicine Board’s 30 h (8 h interactive), and export a portfolio you can hand to an auditor. Free, no ads.</p>' +
      loginErrorHTML() +
      '<div class="signin-btns">' + buttons + '</div>' +
      /* Microsoft's "Need admin approval" page doesn't always send people
         back here, so warn before they try (plan README, decision 4). */
      (st.providers.indexOf('microsoft') !== -1
        ? '<p class="hint">Work or health service Microsoft accounts are often blocked from outside apps. If yours is, use a personal Microsoft or Google account.</p>' : '') +
      '<p class="fine">We keep your name, email and what you log — nothing else. <a href="privacy.html">Privacy</a></p>' +
      '</article>';
  }

  function providerLogo(p) {
    if (p === 'google') {
      return '<svg class="prov-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9c-.3 1.4-1 2.5-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.8 3.2-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8C3.9 20.5 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.8 14.1c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V7.1H2.1C1.4 8.6 1 10.2 1 12s.4 3.4 1.1 4.9l3.7-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2C17.5 2.1 15 1 12 1 7.7 1 3.9 3.5 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>';
    }
    return '<svg class="prov-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>';
  }

  function loginErrorHTML() {
    if (!st.loginError) return '';
    var r = st.loginError, msg;
    if (/^AADSTS(65001|90094|90095|900941|50105|53003)$/.test(r) || r === 'consent_required') {
      msg = 'Your organisation’s Microsoft account isn’t allowed to sign in to outside apps. Use a personal Microsoft or Google account instead.';
    } else if (r === 'access_denied') {
      msg = 'Sign-in was cancelled. Try again whenever you’re ready.';
    } else {
      msg = 'Sign-in didn’t finish. Try again, or use the other sign-in option.';
    }
    return '<p class="notice notice-warn" role="alert">' + esc(msg) + '</p>';
  }

  function downHTML() {
    return '<div class="empty-state"><h2>CPD tracker unavailable</h2>' +
      '<p>The CPD tracker is unavailable right now. Your data is safe. Try again in a few minutes.</p></div>';
  }

  function loadingHTML() { return '<p class="empty">Loading…</p>'; }

  /* ── CPD view ───────────────────────────────────────── */

  function renderCpd() {
    var root = $('cpd-body');
    if (!st.checked) { root.innerHTML = loadingHTML(); return; }
    if (st.apiDown && !st.entries) { root.innerHTML = downHTML(); return; }
    if (!st.user) { root.innerHTML = signInHTML('Sign in to track your CPD'); return; }
    if (!st.summary || !st.entries || !st.goals) { root.innerHTML = yearBarHTML() + loadingHTML(); bindYearBar(root); return; }

    root.innerHTML =
      yearBarHTML() +
      ringsHTML() +
      '<button class="btn btn-primary btn-add" id="cpd-add" type="button">' + ico('plus') + 'Add PD</button>' +
      monthsHTML() +
      goalsHTML() +
      entriesHTML() +
      exportHTML();

    bindYearBar(root);
    $('cpd-add').addEventListener('click', function () { openEntry(null); });
    bindChart(root);
    root.querySelectorAll('[data-goal]').forEach(function (b) {
      b.addEventListener('click', function () { openGoal(b.getAttribute('data-goal')); });
    });
    var addGoal = $('cpd-add-goal');
    if (addGoal) addGoal.addEventListener('click', function () { openGoal(null); });
    root.querySelectorAll('[data-entry]').forEach(function (b) {
      b.addEventListener('click', function () { openEntry(b.getAttribute('data-entry')); });
    });
    root.querySelectorAll('[data-filter-cpd]').forEach(function (b) {
      b.addEventListener('click', function () { st.filter = b.getAttribute('data-filter-cpd'); renderCpd(); });
    });
  }

  function yearBarHTML() {
    var now = cpdYear(todayISO());
    var left = st.year === now ? daysLeft(st.year) : 0;
    return '<div class="year-bar">' +
      '<button class="icon-btn" data-year="-1" type="button" aria-label="Previous year"' + (st.year <= now - 5 ? ' disabled' : '') + '>' + ico('chev-left') + '</button>' +
      '<div class="year-text"><span class="year-range">1 Dec ' + (st.year - 1) + ' – 30 Nov ' + st.year + '</span>' +
      '<span class="year-sub">' + (st.year === now ? left + ' days left' : (st.year < now ? 'Past year' : 'Next year')) + '</span></div>' +
      '<button class="icon-btn" data-year="1" type="button" aria-label="Next year"' + (st.year >= now ? ' disabled' : '') + '>' + ico('chev-right') + '</button>' +
      '</div>';
  }

  function bindYearBar(root) {
    root.querySelectorAll('[data-year]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.year += +b.getAttribute('data-year');
        st.summary = st.entries = st.goals = null;
        st.filter = 'all';
        render();
        loadYear();
      });
    });
  }

  function ring(min, targetH, label) {
    var target = Math.max(1, targetH) * 60;
    var pct = Math.min(1, min / target);
    var r = 34, c = 2 * Math.PI * r;
    var met = min >= target;
    return '<div class="ring">' +
      '<svg viewBox="0 0 80 80" role="img" aria-label="' + esc(label + ': ' + hrs(min) + ' of ' + targetH + ' hours') + '">' +
        '<circle cx="40" cy="40" r="' + r + '" class="ring-track"/>' +
        '<circle cx="40" cy="40" r="' + r + '" class="ring-fill" stroke-dasharray="' + (pct * c).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 40 40)"/>' +
      '</svg>' +
      '<div class="ring-center"><span class="ring-val">' + hrs(min).replace(' h', '') + '</span><span class="ring-of">of ' + targetH + ' h</span></div>' +
      '<span class="ring-label">' + (met ? ico('check') : '') + esc(label) + (met ? ' · met' : '') + '</span>' +
      '</div>';
  }

  function ringsHTML() {
    var s = st.summary, u = st.user;
    var toGo = Math.max(0, u.target_hours * 60 - s.minutes);
    var line;
    if (!toGo) {
      line = 'You’ve met this year’s ' + u.target_hours + ' h.';
    } else if (st.year === cpdYear(todayISO())) {
      var months = Math.max(1, Math.ceil(daysLeft(st.year) / 30.4));
      line = hrs(toGo) + ' to go · about ' + hrs(Math.ceil(toGo / months / 30) * 30) + ' a month';
    } else {
      line = hrs(toGo) + ' short of the target';
    }
    var interToGo = Math.max(0, u.target_interactive_hours * 60 - s.interactive_minutes);
    if (toGo && interToGo) line += ' · ' + hrs(interToGo) + ' of it interactive';
    return '<article class="panel rings-panel">' +
      '<div class="rings">' + ring(s.minutes, u.target_hours, 'Total CPD') + ring(s.interactive_minutes, u.target_interactive_hours, 'Interactive') + '</div>' +
      '<p class="rings-line">' + esc(line) + '</p>' +
      (s.incomplete ? '<p class="rings-warn">' + s.incomplete + ' entr' + (s.incomplete === 1 ? 'y needs' : 'ies need') + ' a reflection to pass an audit.</p>' : '') +
      '</article>';
  }

  /* Monthly bars, Dec → Nov: interactive at the base, other on top, a 2px
     surface gap between them and a 4px rounded top end. */
  function monthsHTML() {
    var data = st.summary.by_month;
    var max = Math.max(60, Math.max.apply(null, data.map(function (m) { return m.minutes; })));
    var maxH = Math.ceil(max / 60);
    var W = 320, H = 120, top = 14, base = H - 18, colW = W / 12, barW = Math.min(16, colW - 8);
    var scale = function (min) { return (min / (maxH * 60)) * (base - top); };
    var bars = data.map(function (m, i) {
      var x = i * colW + (colW - barW) / 2;
      var hi = scale(m.interactive_minutes), ho = scale(m.minutes - m.interactive_minutes);
      var out = '';
      var gap = hi && ho ? 2 : 0;
      if (hi) out += barPath(x, base - hi, barW, hi, !ho, C_INTERACTIVE);
      if (ho) out += barPath(x, base - hi - gap - ho, barW, ho, true, C_OTHER);
      var tip = MONTHS[i] + ' · ' + (m.minutes ? hrs(m.minutes) + (m.interactive_minutes ? ' (' + hrs(m.interactive_minutes) + ' interactive)' : '') : 'nothing logged');
      return '<g class="bar" data-tip="' + esc(tip) + '">' + out +
        '<rect class="bar-hit" x="' + (i * colW) + '" y="0" width="' + colW + '" height="' + H + '"><title>' + esc(tip) + '</title></rect>' +
        '<text class="bar-x" x="' + (i * colW + colW / 2) + '" y="' + (H - 4) + '">' + MONTHS[i].charAt(0) + '</text></g>';
    }).join('');
    var grid = '<line class="grid" x1="0" x2="' + W + '" y1="' + top + '" y2="' + top + '"/>' +
      '<text class="bar-y" x="0" y="' + (top - 4) + '">' + maxH + ' h</text>' +
      '<line class="axis" x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '"/>';
    var table = '<table class="cpd-table"><thead><tr><th>Month</th><th>Total</th><th>Interactive</th></tr></thead><tbody>' +
      data.map(function (m, i) { return '<tr><td>' + MONTHS[i] + '</td><td>' + hrs(m.minutes) + '</td><td>' + hrs(m.interactive_minutes) + '</td></tr>'; }).join('') +
      '</tbody></table>';
    return '<article class="panel">' +
      '<div class="panel-head"><span class="panel-kicker">Hours by month</span>' +
        '<button class="link-btn" id="cpd-table-toggle" type="button" aria-expanded="' + st.showTable + '">' + (st.showTable ? 'Chart' : 'Table') + '</button></div>' +
      '<div class="legend"><span><i style="background:' + C_INTERACTIVE + '"></i>Interactive</span><span><i style="background:' + C_OTHER + '"></i>Other</span></div>' +
      (st.showTable ? table :
        '<div class="chart-wrap"><svg class="months" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Hours logged each month, December to November">' + grid + bars + '</svg>' +
        '<div class="chart-tip" id="chart-tip" hidden></div></div>') +
      '</article>';
  }

  function barPath(x, y, w, h, roundTop, color) {
    var r = Math.min(4, h, w / 2);
    if (!roundTop) return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + color + '"/>';
    return '<path fill="' + color + '" d="M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z"/>';
  }

  function bindChart(root) {
    var t = $('cpd-table-toggle');
    if (t) t.addEventListener('click', function () { st.showTable = !st.showTable; renderCpd(); });
    var tip = $('chart-tip');
    if (!tip) return;
    var wrap = tip.parentNode;
    root.querySelectorAll('.bar').forEach(function (g) {
      var show = function () {
        var hit = g.querySelector('.bar-hit').getBoundingClientRect();
        var box = wrap.getBoundingClientRect();
        tip.textContent = g.getAttribute('data-tip');
        tip.hidden = false;
        var left = hit.left - box.left + hit.width / 2 - tip.offsetWidth / 2;
        tip.style.left = Math.max(0, Math.min(box.width - tip.offsetWidth, left)) + 'px';
        g.classList.add('is-hot');
      };
      var hide = function () { tip.hidden = true; g.classList.remove('is-hot'); };
      g.addEventListener('pointerenter', show);
      g.addEventListener('pointerleave', hide);
      g.addEventListener('click', show);
    });
  }

  function goalsHTML() {
    var status = { active: 'Active', met: 'Met', dropped: 'Dropped' };
    var list = st.goals.length
      ? '<ul class="goal-list">' + st.goals.map(function (g) {
          return '<li><button class="goal-row" data-goal="' + esc(g.id) + '" type="button">' +
            '<span class="goal-text' + (g.status === 'dropped' ? ' is-dropped' : '') + '">' + esc(g.text) + '</span>' +
            '<span class="pill pill-' + g.status + '">' + (g.status === 'met' ? ico('check') : '') + status[g.status] + '</span></button></li>';
        }).join('') + '</ul>'
      : '<p class="panel-lead">Add 2–3 goals for this year. The Board asks for them in your portfolio.</p>';
    return '<article class="panel">' +
      '<div class="panel-head"><span class="panel-kicker panel-kicker-accent">Learning goals</span>' +
        '<button class="link-btn" id="cpd-add-goal" type="button">' + ico('plus') + 'Add goal</button></div>' +
      list + '</article>';
  }

  function entriesHTML() {
    var all = st.entries;
    var list = all.filter(function (e) {
      if (st.filter === 'interactive') return e.interactive;
      if (st.filter === 'reflect') return !e.complete;
      return true;
    });
    var chips = [['all', 'All'], ['interactive', 'Interactive'], ['reflect', 'Needs reflection']].map(function (c) {
      var on = st.filter === c[0];
      return '<button class="chip' + (on ? ' is-on' : '') + '" data-filter-cpd="' + c[0] + '" type="button" aria-pressed="' + on + '">' + c[1] + '</button>';
    }).join('');

    var body;
    if (!all.length) {
      body = '<div class="empty-state">' + ico('cpd', 'empty-ico') + '<h2>No PD logged yet</h2><p>Tap Add PD after a journal club, sim, course or case review.</p></div>';
    } else if (!list.length) {
      body = '<p class="empty">Nothing matches that filter.</p>';
    } else {
      var groups = [], cur = null;
      list.forEach(function (e) {
        var key = e.date.slice(0, 7);
        if (!cur || cur.key !== key) { cur = { key: key, items: [] }; groups.push(cur); }
        cur.items.push(e);
      });
      body = groups.map(function (g) {
        var d = new Date(g.key + '-01T00:00:00');
        var mins = g.items.reduce(function (n, e) { return n + e.minutes; }, 0);
        return '<div class="day-head"><span class="label">' + esc(d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })) + '</span>' +
          '<span class="rule"></span><span class="n">' + hrs(mins) + '</span></div>' +
          '<div class="entry-list">' + g.items.map(entryRowHTML).join('') + '</div>';
      }).join('');
    }
    return '<div class="section-head"><h2>Activities</h2><span class="muted-flag">' + all.length + ' logged</span></div>' +
      (all.length ? '<div class="chips" role="group" aria-label="Filter activities">' + chips + '</div>' : '') +
      body;
  }

  function entryRowHTML(e) {
    var type = ACTIVITY_TYPES[e.activity_type];
    var paper = e.kind === 'paper';
    return '<button class="entry-row" data-entry="' + esc(e.id) + '" type="button">' +
      '<span class="entry-date">' + esc(niceDate(e.date)) + '</span>' +
      '<span class="entry-main">' +
        '<span class="entry-title">' + (paper ? ico('log', 'entry-ico') + '<span class="sr-only">Paper: </span>' : '') + esc(e.title) + '</span>' +
        '<span class="entry-meta">' + esc(type ? type.label : e.activity_type) + (paper && e.paper_journal ? ' · ' + esc(e.paper_journal) : '') + ' · ' + dur(e.minutes) + '</span>' +
        '<span class="entry-tags">' +
          (e.interactive ? '<span class="pill pill-inter">Interactive</span>' : '') +
          (e.complete ? '' : '<span class="pill pill-warn">Needs reflection</span>') +
        '</span>' +
      '</span>' + ico('chev-right', 'entry-chev') + '</button>';
  }

  function exportHTML() {
    var y = st.year;
    return '<article class="panel">' +
      '<span class="panel-kicker">Export ' + esc(yearLabel(y)) + '</span>' +
      '<div class="export-row">' +
        '<a class="btn" href="' + esc(API + '/api/export?year=' + y) + '" target="_blank" rel="noopener">Portfolio (print / PDF)</a>' +
        '<a class="btn" href="' + esc(API + '/api/export.csv?year=' + y) + '">' + ico('download') + 'CSV</a>' +
      '</div>' +
      '<p class="fine">Keep each year’s export for 5 years after the registration period ends. AHPRA can audit any of them.</p>' +
      '</article>';
  }

  /* ── entry sheet ────────────────────────────────────── */

  var PII = [
    /\b(DOB|D\.O\.B|URN|MRN|UR number|Medicare)\b/i,
    /\b(Mr|Mrs|Ms|Miss|Mstr)\.?\s+[A-Z][a-z]+/,
    /\d{6,}/
  ];

  function blankEntry() {
    return {
      activity_type: '', title: '', summary: '', date: todayISO(), minutes: 60,
      interactive: false, with_whom: '', goal_id: '', learning_goal: '',
      reflection_learned: '', reflection_practice: '', reflection_next: ''
    };
  }

  function readDraft() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeDraft(d) {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  function openEntry(id) {
    var existing = id ? st.entries.filter(function (e) { return e.id === id; })[0] : null;
    if (id && !existing) return;
    if (existing && existing.kind === 'paper') { openPaper(existing.paper_id, existing.id); return; }
    var draft = readDraft();
    var restored = !!(draft && (draft.id || null) === (id || null) && draft.v);
    var v = restored ? draft.v : (existing ? {
      activity_type: existing.activity_type, title: existing.title || '', summary: existing.summary || '',
      date: existing.date, minutes: existing.minutes, interactive: existing.interactive,
      with_whom: existing.with_whom || '', goal_id: existing.goal_id || '', learning_goal: existing.learning_goal || '',
      reflection_learned: existing.reflection_learned || '', reflection_practice: existing.reflection_practice || '',
      reflection_next: existing.reflection_next || ''
    } : blankEntry());
    if (!restored) clearDraft();
    openSheet({ type: 'entry', id: id, v: v, kind: existing ? existing.kind : 'manual', restored: restored, error: '' }, '');
    renderEntrySheet();
  }

  function renderEntrySheet(focusName) {
    var s = st.sheet, v = s.v;
    var types = s.kind === 'manual' ? MANUAL_TYPES : [v.activity_type];
    var activeGoals = st.goals.filter(function (g) { return g.status === 'active' || g.id === v.goal_id; });
    var goalOpts = '<option value="">Write my own…</option>' + activeGoals.map(function (g) {
      return '<option value="' + esc(g.id) + '"' + (g.id === v.goal_id ? ' selected' : '') + '>' + esc(g.text) + '</option>';
    }).join('');
    /* Same bounds as the API: from 1 Dec six years ago to tomorrow. */
    var lim = { min: (+todayISO().slice(0, 4) - 6) + '-12-01', max: addDays(todayISO(), 1) };

    $('sheet').innerHTML =
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="sheet-head"><h2 id="sheet-title">' + (s.id ? 'Edit PD' : 'Add PD') + '</h2>' +
        '<button class="icon-btn" data-close type="button" aria-label="Close">' + ico('plus', 'rot45') + '</button></div>' +
      (s.restored ? '<p class="notice">Draft restored. <button class="link-inline" data-discard type="button">Discard it</button></p>' : '') +
      '<form class="form" id="entry-form" novalidate>' +
        '<fieldset><legend>What did you do?</legend><div class="chips type-chips">' +
          types.map(function (t) {
            var on = v.activity_type === t;
            return '<button class="chip' + (on ? ' is-on' : '') + '" data-type="' + t + '" type="button" aria-pressed="' + on + '"' + (s.kind !== 'manual' ? ' disabled' : '') + '>' + esc(ACTIVITY_TYPES[t].label) + '</button>';
          }).join('') + '</div></fieldset>' +
        field('Title', '<input name="title" maxlength="200" required value="' + esc(v.title) + '" placeholder="e.g. Station journal club: paediatric sepsis">') +
        field('Short summary <span class="opt">optional</span>', '<textarea name="summary" rows="2" maxlength="4000" placeholder="What it covered">' + esc(v.summary) + '</textarea>') +
        '<div class="form-row">' +
          field('Date', '<input type="date" name="date" required value="' + esc(v.date) + '" min="' + lim.min + '" max="' + lim.max + '">') +
          '<div class="field"><span class="label">Time spent</span><div class="stepper">' +
            stepper('h', Math.floor(v.minutes / 60) + ' h', 'hours') + stepper('m', (v.minutes % 60) + ' min', 'minutes') +
          '</div></div>' +
        '</div>' +
        '<p class="hint">Activity time only — reflection time doesn’t count toward the Board’s 30 hours.</p>' +
        '<label class="switch-row"><input type="checkbox" name="interactive" role="switch"' + (v.interactive ? ' checked' : '') + '>' +
          '<span class="switch" aria-hidden="true"></span><span><b>Interactive with other practitioners?</b>' +
          '<span class="hint">A two-way exchange with other practitioners, face to face or live online.</span></span></label>' +
        (v.interactive ? field('Who with? <span class="opt">roles, not names</span>', '<input name="with_whom" maxlength="200" value="' + esc(v.with_whom) + '" placeholder="e.g. crew partner, station journal club">') : '') +
        '<fieldset><legend>Learning goal</legend>' +
          (activeGoals.length ? '<select name="goal_id" aria-label="Pick one of this year’s goals">' + goalOpts + '</select>' : '') +
          (v.goal_id ? '' : '<input name="learning_goal" maxlength="4000" value="' + esc(v.learning_goal) + '" placeholder="What did you want to get better at?" aria-label="Learning goal">') +
        '</fieldset>' +
        '<fieldset><legend>Reflection <span class="opt">needed for a complete entry</span></legend>' +
          field('What did I learn?', '<textarea name="reflection_learned" rows="3" maxlength="4000">' + esc(v.reflection_learned) + '</textarea>') +
          field('How will this change or confirm my practice?', '<textarea name="reflection_practice" rows="3" maxlength="4000">' + esc(v.reflection_practice) + '</textarea>') +
          field('Anything to follow up? <span class="opt">optional</span>', '<textarea name="reflection_next" rows="2" maxlength="4000">' + esc(v.reflection_next) + '</textarea>') +
        '</fieldset>' +
        '<p class="notice notice-warn" id="pii-warn" hidden>That looks like it might identify a patient (a name, date of birth or record number). Please remove it.</p>' +
        '<p class="fine">Don’t include patient-identifying details.</p>' +
        (s.error ? '<p class="notice notice-warn" role="alert">' + esc(s.error) + '</p>' : '') +
        '<div class="sheet-actions">' +
          (s.id ? (s.confirmDelete
            ? '<button class="btn btn-danger" data-delete-yes type="button">Delete this entry</button><button class="btn" data-delete-no type="button">Keep</button>'
            : '<button class="btn btn-quiet" data-delete type="button">Delete</button>') : '') +
          (s.confirmDelete ? '' :
            '<span class="spacer"></span>' +
            '<button class="btn" data-close type="button">Cancel</button>' +
            '<button class="btn btn-primary" type="submit"' + (s.saving ? ' disabled' : '') + '>' + (s.saving ? 'Saving…' : 'Save') + '</button>') +
        '</div>' +
      '</form>';

    bindEntrySheet();
    checkPII();
    if (focusName) {
      var f = $('sheet').querySelector('[name="' + focusName + '"]');
      if (f) f.focus();
    }
  }

  function field(label, control) {
    return '<label class="field"><span class="label">' + label + '</span>' + control + '</label>';
  }

  function stepper(unit, text, name) {
    return '<span class="step"><button type="button" data-step="' + unit + '-" aria-label="Fewer ' + name + '">' + ico('minus') + '</button>' +
      '<output aria-live="polite">' + esc(text) + '</output>' +
      '<button type="button" data-step="' + unit + '+" aria-label="More ' + name + '">' + ico('plus') + '</button></span>';
  }

  function bindEntrySheet() {
    var el = $('sheet'), s = st.sheet, form = $('entry-form');
    el.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeSheet(false); }); });
    var discard = el.querySelector('[data-discard]');
    if (discard) discard.addEventListener('click', function () { clearDraft(); var id = s.id; closeSheet(false); openEntry(id); });

    el.querySelectorAll('[data-type]').forEach(function (b) {
      b.addEventListener('click', function () {
        collect();
        var t = b.getAttribute('data-type');
        s.v.activity_type = t;
        s.v.interactive = ACTIVITY_TYPES[t].interactive;
        saveDraft();
        renderEntrySheet();
      });
    });
    el.querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        collect();
        var k = b.getAttribute('data-step');
        var delta = { 'h+': 60, 'h-': -60, 'm+': 5, 'm-': -5 }[k];
        s.v.minutes = Math.max(5, Math.min(600, s.v.minutes + delta));
        saveDraft();
        renderEntrySheet();
        var again = $('sheet').querySelector('[data-step="' + k + '"]');
        if (again) again.focus();
      });
    });
    var inter = form.querySelector('[name="interactive"]');
    inter.addEventListener('change', function () { collect(); saveDraft(); renderEntrySheet(inter.checked ? 'with_whom' : null); });
    var goalSel = form.querySelector('[name="goal_id"]');
    if (goalSel) goalSel.addEventListener('change', function () { collect(); saveDraft(); renderEntrySheet(goalSel.value ? null : 'learning_goal'); });

    form.addEventListener('input', function () { collect(); saveDraft(); checkPII(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); saveEntry(); });

    var del = el.querySelector('[data-delete]');
    if (del) del.addEventListener('click', function () { collect(); s.confirmDelete = true; renderEntrySheet(); });
    var no = el.querySelector('[data-delete-no]');
    if (no) no.addEventListener('click', function () { s.confirmDelete = false; renderEntrySheet(); });
    var yes = el.querySelector('[data-delete-yes]');
    if (yes) yes.addEventListener('click', deleteEntry);
  }

  /* Form → st.sheet.v */
  function collect() {
    var form = $('entry-form'), v = st.sheet.v;
    ['title', 'summary', 'date', 'with_whom', 'learning_goal', 'reflection_learned', 'reflection_practice', 'reflection_next', 'goal_id'].forEach(function (n) {
      var f = form.querySelector('[name="' + n + '"]');
      if (f) v[n] = f.value;
    });
    v.interactive = form.querySelector('[name="interactive"]').checked;
  }

  function saveDraft() {
    var s = st.sheet;
    if (s && s.type === 'entry') writeDraft({ id: s.id || null, v: s.v });
  }

  function checkPII() {
    var form = $('entry-form') || $('paper-form') || $('quiz-form');
    if (!form) return;
    var text = Array.prototype.map.call(form.querySelectorAll('input:not([type]), input[name], textarea'), function (f) {
      return f.type === 'date' || f.type === 'checkbox' ? '' : f.value;
    }).join('\n');
    $('pii-warn').hidden = !PII.some(function (re) { return re.test(text); });
  }

  function saveEntry() {
    var s = st.sheet;
    collect();
    var v = s.v;
    var problem = !v.activity_type ? 'Pick what kind of activity it was.'
      : !v.title.trim() ? 'Give it a title.'
      : !v.date ? 'Add the date.'
      : (v.interactive && !v.with_whom.trim()) ? 'Say who it was with (roles, not names) — that’s your audit evidence.'
      : '';
    if (problem) { s.error = problem; renderEntrySheet(); return; }

    var goal = v.goal_id ? st.goals.filter(function (g) { return g.id === v.goal_id; })[0] : null;
    var body = {
      activity_type: v.activity_type, title: v.title, summary: v.summary, date: v.date, minutes: v.minutes,
      interactive: !!v.interactive, with_whom: v.interactive ? v.with_whom : null,
      goal_id: v.goal_id || null, learning_goal: goal ? goal.text : v.learning_goal,
      reflection_learned: v.reflection_learned, reflection_practice: v.reflection_practice, reflection_next: v.reflection_next
    };
    if (!s.id) body.kind = 'manual';
    s.saving = true; s.error = '';
    renderEntrySheet();
    api(s.id ? '/api/entries/' + encodeURIComponent(s.id) : '/api/entries', { method: s.id ? 'PATCH' : 'POST', body: body })
      .then(function (saved) {
        clearDraft();
        closeSheet(false);
        /* A date change can move it to another year: jump there. */
        if (saved.cpd_year !== st.year) { st.year = saved.cpd_year; st.summary = st.entries = st.goals = null; return loadYear(); }
        return loadYear();
      })
      .catch(function (err) {
        if (!st.sheet) return;
        s.saving = false;
        s.error = err.status === 401 ? 'You’ve been signed out. Your draft is kept — sign in again and reopen Add PD.' : err.message;
        renderEntrySheet();
        if (err.status === 401) render();
      });
  }

  function deleteEntry() {
    var s = st.sheet;
    api('/api/entries/' + encodeURIComponent(s.id), { method: 'DELETE' })
      .then(function () { closeSheet(false); return loadYear(); })
      .catch(function (err) { s.error = err.message; s.confirmDelete = false; renderEntrySheet(); });
  }

  /* ── paper diary: "Log PD" on paper cards (plan phase 2) ── */

  /* Typical reading time for the whole paper, by study type: an estimate
     to start the stepper from, not a rule. Summary + abstract is 10 min. */
  var READ_SUMMARY = 10;
  var READ_MINUTES = {
    'Case series': 20, 'Guideline / statement': 20, 'Other': 20,
    'RCT': 30, 'Cohort': 30, 'Registry': 30, 'Case-control': 30, 'Cross-sectional': 30,
    'Qualitative': 30, 'Simulation': 30, 'Modelling': 30,
    'Systematic review': 45
  };
  var READ_MAX = 180;

  function fullMinutes(p) { return (p && READ_MINUTES[p.studyType]) || 30; }

  function loadLogged() {
    if (!st.user) return Promise.resolve();
    return api('/api/entries?paper_ids=1').then(function (r) {
      var map = {};
      r.papers.forEach(function (x) { (map[x.paper_id] = map[x.paper_id] || []).push(x); });
      st.logged = map;
      PP.renderPapers();
    }).catch(function () {});
  }

  function dropLogged() {
    if (!st.logged) return;
    st.logged = null;
    PP.renderPapers();
  }

  /* The reading entry first: that's the one the card's button opens. */
  function loggedFor(paperId) {
    var list = (st.logged && st.logged[paperId]) || [];
    return list.slice().sort(function (a, b) { return (a.activity_type === 'reading' ? 0 : 1) - (b.activity_type === 'reading' ? 0 : 1); });
  }

  /* The card button, after Save (app.js footHTML). */
  function paperActHTML(p) {
    var list = loggedFor(p.id);
    var mins = list.reduce(function (n, x) { return n + x.minutes; }, 0);
    return '<button class="act act-log' + (list.length ? ' is-logged' : '') + '" data-log="' + esc(p.id) + '" type="button"' +
      (list.length ? ' aria-label="Logged as PD, ' + esc(dur(mins)) + '. Edit"' : '') + '>' +
      ico('log') + '<span class="lbl">' + (list.length ? 'Logged · ' + esc(dur(mins)) : 'Log PD') + '</span></button>';
  }

  function logPaper(paperId) {
    if (!st.user) { openPaperSignIn(paperId); return; }
    var first = loggedFor(paperId)[0];
    openPaper(paperId, first ? first.id : null);
  }

  function openPaperSignIn(paperId, note) {
    openSheet({ type: 'signin', paperId: paperId }, '');
    var el = $('sheet');
    el.innerHTML =
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="sheet-head"><h2 id="sheet-title" class="sr-only">Sign in</h2><span></span>' +
        '<button class="icon-btn" data-close type="button" aria-label="Close">' + ico('plus', 'rot45') + '</button></div>' +
      (note ? '<p class="notice notice-warn" role="alert">' + esc(note) + '</p>' : '') +
      (!st.checked ? loadingHTML() : st.apiDown ? downHTML() : signInHTML('Log this paper toward your 30 CPD hours', '#paper=' + encodeURIComponent(paperId)));
    el.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeSheet(true); }); });
    el.querySelectorAll('.btn-provider').forEach(function (a) {
      a.addEventListener('click', function () { try { sessionStorage.setItem(RESUME_KEY, paperId); } catch (e) {} });
    });
  }

  /* Back from sign-in: reopen the paper sheet once both the user and
     papers.json are loaded (either can arrive first). */
  function resumePaper() {
    var id;
    try { id = sessionStorage.getItem(RESUME_KEY); } catch (e) { return; }
    if (!id || !st.user || !PP.hasData()) return;
    try { sessionStorage.removeItem(RESUME_KEY); } catch (e) {}
    if (!st.logged) {
      loadLogged().then(function () { logPaper(id); });
      return;
    }
    logPaper(id);
  }

  function readPaperDraft(paperId) {
    try { return JSON.parse(sessionStorage.getItem(PAPER_DRAFT_KEY + paperId) || 'null'); } catch (e) { return null; }
  }
  function writePaperDraft(paperId, d) {
    try { sessionStorage.setItem(PAPER_DRAFT_KEY + paperId, JSON.stringify(d)); } catch (e) {}
  }
  function clearPaperDraft(paperId) {
    try { sessionStorage.removeItem(PAPER_DRAFT_KEY + paperId); } catch (e) {}
  }

  /* The year's goals for the dropdown (the CPD tab may be showing another year). */
  function goalsFor(year) {
    if (st.year === year && st.goals) return Promise.resolve(st.goals);
    return api('/api/goals?year=' + year).then(function (r) { return r.goals; });
  }

  /* entryId null → a new entry. opts.discussed starts it as journal club;
     opts.notice shows a line at the top. */
  function openPaper(paperId, entryId, opts) {
    opts = opts || {};
    var p = PP.paperById(paperId);
    var cached = entryId && st.entries ? st.entries.filter(function (e) { return e.id === entryId; })[0] : null;
    var getEntry = !entryId ? Promise.resolve(null) : cached ? Promise.resolve(cached) : api('/api/entries/' + encodeURIComponent(entryId));
    openSheet({ type: 'paper', paperId: paperId, loading: true }, '<div class="sheet-grip" aria-hidden="true"></div>' + loadingHTML());
    getEntry.then(function (e) {
      if (!p && !e) throw new Error('That paper is no longer on the dashboard.');
      var date = e ? e.date : todayISO();
      return goalsFor(cpdYear(date)).then(function (goals) { return { e: e, goals: goals }; });
    }).then(function (r) {
      if (!st.sheet || st.sheet.paperId !== paperId) return;
      var e = r.e;
      var draft = readPaperDraft(paperId);
      var restored = !!(draft && (draft.entryId || null) === (entryId || null) && draft.v);
      var v = restored ? draft.v : e ? {
        read: e.minutes === READ_SUMMARY ? 'summary' : e.minutes === fullMinutes(p) ? 'full' : '', minutes: e.minutes, date: e.date, interactive: e.interactive, with_whom: e.with_whom || '',
        learning_goal: e.learning_goal || '', goal_id: e.goal_id || '',
        reflection_learned: e.reflection_learned || '', reflection_practice: e.reflection_practice || '',
        reflection_next: e.reflection_next || ''
      } : {
        read: 'summary', minutes: READ_SUMMARY, date: todayISO(), interactive: !!opts.discussed, with_whom: '',
        learning_goal: (p && p.learningGoal) || '', goal_id: '',
        reflection_learned: '', reflection_practice: '', reflection_next: ''
      };
      if (!restored) clearPaperDraft(paperId);
      st.sheet = {
        type: 'paper', paperId: paperId, entryId: entryId, entry: e, p: p, goals: r.goals,
        v: v, restored: restored, notice: opts.notice || '', error: ''
      };
      renderPaperSheet();
    }).catch(function (err) {
      if (!st.sheet || st.sheet.paperId !== paperId) return;
      if (err.status === 401) { openPaperSignIn(paperId, 'You’ve been signed out. Sign in again to log this paper.'); return; }
      $('sheet').innerHTML = '<div class="sheet-grip" aria-hidden="true"></div><p class="notice notice-warn" role="alert">' + esc(err.message) + '</p>' +
        '<div class="sheet-actions"><span class="spacer"></span><button class="btn" data-close type="button">Close</button></div>';
      $('sheet').querySelector('[data-close]').addEventListener('click', function () { closeSheet(true); });
    });
  }

  function paperHeadHTML(s) {
    var p = s.p, e = s.entry;
    var title = (p && (p.shortTitle || p.title)) || (e && e.title) || '';
    var journal = (p && p.journal) || (e && e.paper_journal) || '';
    var doi = (p && p.doi) || (e && e.paper_doi) || '';
    var when = p && p.date ? niceDate(p.date, true) : '';
    return '<div class="paper-sheet-head">' +
      '<span class="panel-kicker panel-kicker-accent">' + (s.entryId ? 'Edit PD · paper' : 'Log PD · paper') + '</span>' +
      '<h2 id="sheet-title">' + esc(title) + '</h2>' +
      '<p class="paper-sheet-meta">' + esc([journal, when].filter(Boolean).join(' · ')) +
        (doi ? ' · <a href="https://doi.org/' + esc(encodeURIComponent(doi).replace(/%2F/g, '/')) + '" target="_blank" rel="noopener">DOI</a>' : '') +
        (s.entryId && p ? ' · <a href="#paper=' + esc(encodeURIComponent(p.id)) + '" data-close-soft>Read on the dashboard</a>' : '') +
      '</p></div>';
  }

  function renderPaperSheet(focusName) {
    var s = st.sheet, v = s.v, p = s.p;
    var full = fullMinutes(p);
    var suggested = p && p.learningGoal && v.learning_goal.trim() === p.learningGoal;
    var activeGoals = s.goals.filter(function (g) { return g.status === 'active' || g.id === v.goal_id; });
    var linked = v.goal_id ? activeGoals.filter(function (g) { return g.id === v.goal_id; })[0] : null;
    var canSaveGoal = v.learning_goal.trim() && !activeGoals.some(function (g) { return g.text.trim() === v.learning_goal.trim(); });
    var lim = { min: (+todayISO().slice(0, 4) - 6) + '-12-01', max: addDays(todayISO(), 1) };
    var others = s.entryId ? loggedFor(s.paperId).filter(function (x) { return x.id !== s.entryId; }) : [];
    var hasDiscussion = others.some(function (x) { return x.activity_type === 'journal_club'; });
    var ph = placeholders(p);

    if (s.done) { renderPaperDone(); return; }

    $('sheet').innerHTML =
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="sheet-head sheet-head-top">' + paperHeadHTML(s) +
        '<button class="icon-btn" data-close type="button" aria-label="Close">' + ico('plus', 'rot45') + '</button></div>' +
      (s.notice ? '<p class="notice">' + esc(s.notice) + '</p>' : '') +
      (s.restored ? '<p class="notice">Draft restored. <button class="link-inline" data-discard type="button">Discard it</button></p>' : '') +
      '<form class="form" id="paper-form" novalidate>' +
        '<fieldset><legend>How did you read it?</legend><div class="chips">' +
          [['summary', 'Summary + abstract', READ_SUMMARY], ['full', 'Full paper', full]].map(function (o) {
            var on = v.read === o[0];
            return '<button class="chip' + (on ? ' is-on' : '') + '" data-read="' + o[0] + '" type="button" aria-pressed="' + on + '">' + o[1] + ' · ' + dur(o[2]) + '</button>';
          }).join('') + '</div></fieldset>' +
        '<div class="form-row">' +
          '<div class="field"><span class="label">Reading time</span><div class="stepper">' +
            '<span class="step"><button type="button" data-pstep="-5" aria-label="5 minutes less"' + (v.minutes <= 5 ? ' disabled' : '') + '>' + ico('minus') + '</button>' +
            '<output aria-live="polite">' + esc(dur(v.minutes)) + '</output>' +
            '<button type="button" data-pstep="5" aria-label="5 minutes more"' + (v.minutes >= READ_MAX ? ' disabled' : '') + '>' + ico('plus') + '</button></span>' +
          '</div></div>' +
          field('Date', '<input type="date" name="date" required value="' + esc(v.date) + '" min="' + lim.min + '" max="' + lim.max + '">') +
        '</div>' +
        '<p class="hint">Reading time only. Reflection doesn’t count toward the 30 hours.</p>' +
        '<label class="switch-row"><input type="checkbox" name="interactive" role="switch"' + (v.interactive ? ' checked' : '') + '>' +
          '<span class="switch" aria-hidden="true"></span><span><b>Discussed it with other practitioners?</b>' +
          '<span class="hint">Logs it as journal club, which counts toward your 8 interactive hours.</span></span></label>' +
        (v.interactive ? field('Who with? <span class="opt">roles, not names</span>', '<input name="with_whom" maxlength="200" value="' + esc(v.with_whom) + '" placeholder="e.g. crew partner, station journal club">') : '') +
        '<fieldset><legend>Learning goal' + (suggested ? ' <span class="pill pill-inter">Suggested</span>' : '') + '</legend>' +
          '<textarea name="learning_goal" rows="2" maxlength="4000" aria-label="Learning goal" placeholder="What did you want to get better at?">' + esc(v.learning_goal) + '</textarea>' +
          (activeGoals.length ? '<label class="field"><span class="label">Link to one of my goals <span class="opt">optional</span></span>' +
            '<select name="goal_id"><option value="">None</option>' + activeGoals.map(function (g) {
              return '<option value="' + esc(g.id) + '"' + (g.id === v.goal_id ? ' selected' : '') + '>' + esc(g.text) + '</option>';
            }).join('') + '</select></label>' : '') +
          (canSaveGoal && !linked ? '<button class="link-btn" data-save-goal type="button"' + (s.savingGoal ? ' disabled' : '') + '>' + ico('plus') + 'Save as a goal for ' + esc(yearLabel(cpdYear(v.date))) + '</button>' : '') +
        '</fieldset>' +
        '<fieldset><legend>Reflection <span class="opt">needed for a complete entry</span></legend>' +
          field('What did I learn?', '<textarea name="reflection_learned" rows="3" maxlength="4000" placeholder="' + esc(ph.learned) + '">' + esc(v.reflection_learned) + '</textarea>') +
          field('How will this change or confirm my practice?', '<textarea name="reflection_practice" rows="3" maxlength="4000" placeholder="' + esc(ph.practice) + '">' + esc(v.reflection_practice) + '</textarea>') +
          field('Anything to follow up? <span class="opt">optional</span>', '<textarea name="reflection_next" rows="2" maxlength="4000" placeholder="' + esc(ph.next) + '">' + esc(v.reflection_next) + '</textarea>') +
        '</fieldset>' +
        '<p class="notice notice-warn" id="pii-warn" hidden>That looks like it might identify a patient (a name, date of birth or record number). Please remove it.</p>' +
        '<p class="fine">Don’t include patient-identifying details.</p>' +
        (s.entryId && !v.interactive && !hasDiscussion
          ? '<p class="fine">Discussed it later at journal club or with your crew? <button class="link-inline" data-log-discussion type="button">Log that separately</button></p>' : '') +
        (s.error ? '<p class="notice notice-warn" role="alert">' + esc(s.error) + '</p>' : '') +
        '<div class="sheet-actions">' +
          (s.entryId ? (s.confirmDelete
            ? '<button class="btn btn-danger" data-delete-yes type="button">Delete this entry</button><button class="btn" data-delete-no type="button">Keep</button>'
            : '<button class="btn btn-quiet" data-delete type="button">Delete</button>') : '') +
          (s.confirmDelete ? '' :
            '<span class="spacer"></span>' +
            '<button class="btn" data-close type="button">Cancel</button>' +
            '<button class="btn btn-primary" type="submit"' + (s.saving ? ' disabled' : '') + '>' + (s.saving ? 'Saving…' : 'Save') + '</button>') +
        '</div>' +
      '</form>';

    bindPaperSheet();
    checkPII();
    if (focusName) {
      var f = $('sheet').querySelector('[name="' + focusName + '"]');
      if (f) f.focus();
    }
  }

  /* Static hints from the paper's own fields; no extra LLM call. */
  function placeholders(p) {
    p = p || {};
    var clip = function (t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
    return {
      learned: p.design ? 'e.g. what a ' + clip(p.design.charAt(0).toLowerCase() + p.design.slice(1), 70) + ' found, and how far you trust it'
        : 'e.g. the main finding, and how far you trust it',
      practice: p.bottomLine ? 'e.g. what a “' + p.bottomLine.toLowerCase() + '” result means for your patients'
        : 'e.g. whether it changes or confirms what you do on scene',
      next: p.caveat ? 'e.g. whether the caveat matters where you work: ' + clip(p.caveat.charAt(0).toLowerCase() + p.caveat.slice(1), 80)
        : 'e.g. the full paper, or what your guideline says'
    };
  }

  function bindPaperSheet() {
    var el = $('sheet'), s = st.sheet, form = $('paper-form');
    el.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeSheet(false); }); });
    el.querySelectorAll('[data-close-soft]').forEach(function (a) { a.addEventListener('click', function () { closeSheet(true); }); });
    var discard = el.querySelector('[data-discard]');
    if (discard) discard.addEventListener('click', function () { clearPaperDraft(s.paperId); closeSheet(false); openPaper(s.paperId, s.entryId); });

    el.querySelectorAll('[data-read]').forEach(function (b) {
      b.addEventListener('click', function () {
        collectPaper();
        s.v.read = b.getAttribute('data-read');
        s.v.minutes = s.v.read === 'full' ? fullMinutes(s.p) : READ_SUMMARY;
        savePaperDraft();
        renderPaperSheet();
      });
    });
    el.querySelectorAll('[data-pstep]').forEach(function (b) {
      b.addEventListener('click', function () {
        collectPaper();
        var d = +b.getAttribute('data-pstep');
        s.v.minutes = Math.max(5, Math.min(READ_MAX, s.v.minutes + d));
        s.v.read = '';
        savePaperDraft();
        renderPaperSheet();
        var again = $('sheet').querySelector('[data-pstep="' + d + '"]');
        if (again && !again.disabled) again.focus();
      });
    });
    var inter = form.querySelector('[name="interactive"]');
    inter.addEventListener('change', function () { collectPaper(); savePaperDraft(); renderPaperSheet(inter.checked ? 'with_whom' : null); });
    var goalSel = form.querySelector('[name="goal_id"]');
    if (goalSel) goalSel.addEventListener('change', function () { collectPaper(); savePaperDraft(); renderPaperSheet(); });
    var date = form.querySelector('[name="date"]');
    date.addEventListener('change', function () {
      /* A date in another registration year: that year's goals. */
      collectPaper();
      var y = cpdYear(s.v.date || todayISO());
      goalsFor(y).then(function (g) {
        if (st.sheet !== s) return;
        s.goals = g;
        if (s.v.goal_id && !g.some(function (x) { return x.id === s.v.goal_id; })) s.v.goal_id = '';
        renderPaperSheet();
      }).catch(function () {});
    });
    var saveGoal = el.querySelector('[data-save-goal]');
    if (saveGoal) saveGoal.addEventListener('click', function () {
      collectPaper();
      s.savingGoal = true;
      renderPaperSheet();
      var year = cpdYear(s.v.date || todayISO());
      api('/api/goals', { method: 'POST', body: { text: s.v.learning_goal.trim().slice(0, 300), cpd_year: year } }).then(function (g) {
        s.savingGoal = false;
        s.goals = s.goals.concat([g]);
        if (st.year === year && st.goals && st.goals !== s.goals) st.goals = st.goals.concat([g]);
        s.v.goal_id = g.id;
        savePaperDraft();
        if (st.sheet === s) renderPaperSheet();
      }).catch(function (err) {
        s.savingGoal = false;
        s.error = err.message;
        if (st.sheet === s) renderPaperSheet();
      });
    });
    var disc = el.querySelector('[data-log-discussion]');
    if (disc) disc.addEventListener('click', function () { closeSheet(true); openPaper(s.paperId, null, { discussed: true }); });

    form.addEventListener('input', function () { collectPaper(); savePaperDraft(); checkPII(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); savePaper(); });

    var del = el.querySelector('[data-delete]');
    if (del) del.addEventListener('click', function () { collectPaper(); s.confirmDelete = true; renderPaperSheet(); });
    var no = el.querySelector('[data-delete-no]');
    if (no) no.addEventListener('click', function () { s.confirmDelete = false; renderPaperSheet(); });
    var yes = el.querySelector('[data-delete-yes]');
    if (yes) yes.addEventListener('click', deletePaperEntry);
  }

  function collectPaper() {
    var form = $('paper-form'), v = st.sheet.v;
    ['date', 'with_whom', 'learning_goal', 'goal_id', 'reflection_learned', 'reflection_practice', 'reflection_next'].forEach(function (n) {
      var f = form.querySelector('[name="' + n + '"]');
      if (f) v[n] = f.value;
    });
    v.interactive = form.querySelector('[name="interactive"]').checked;
  }

  function savePaperDraft() {
    var s = st.sheet;
    if (s && s.type === 'paper') writePaperDraft(s.paperId, { entryId: s.entryId || null, v: s.v });
  }

  function savePaper() {
    var s = st.sheet;
    collectPaper();
    var v = s.v, p = s.p || {}, e = s.entry;
    var problem = !v.date ? 'Add the date.'
      : (v.interactive && !v.with_whom.trim()) ? 'Say who you discussed it with (roles, not names). That’s your audit evidence.'
      : '';
    if (problem) { s.error = problem; renderPaperSheet(); return; }

    var body = {
      activity_type: v.interactive ? 'journal_club' : 'reading',
      date: v.date, minutes: v.minutes, interactive: !!v.interactive, with_whom: v.interactive ? v.with_whom : null,
      learning_goal: v.learning_goal, goal_id: v.goal_id || null,
      reflection_learned: v.reflection_learned, reflection_practice: v.reflection_practice, reflection_next: v.reflection_next
    };
    /* A non-paper activity type set elsewhere stays as it is. */
    if (e && e.activity_type !== 'reading' && e.activity_type !== 'journal_club') delete body.activity_type;
    if (!s.entryId) {
      /* Evidence snapshot: the portfolio still reads right if the paper
         ever leaves the dashboard. */
      body.kind = 'paper';
      body.paper_id = s.paperId;
      body.title = String(p.title || p.shortTitle || s.paperId).slice(0, 200);
      body.paper_doi = p.doi || null;
      body.paper_journal = p.journal || null;
    }
    s.saving = true; s.error = '';
    renderPaperSheet();
    api(s.entryId ? '/api/entries/' + encodeURIComponent(s.entryId) : '/api/entries', { method: s.entryId ? 'PATCH' : 'POST', body: body })
      .then(function (saved) {
        clearPaperDraft(s.paperId);
        loadLogged();
        if (saved.cpd_year === st.year || !st.entries) loadYear();
        if (st.sheet !== s) return;
        s.saving = false;
        s.done = saved;
        renderPaperDone();
      })
      .catch(function (err) {
        if (st.sheet !== s) return;
        s.saving = false;
        if (err.status === 409 && err.data && err.data.existing_id && !s.entryId) {
          clearPaperDraft(s.paperId);
          openPaper(s.paperId, err.data.existing_id, { notice: 'You’ve already logged this paper' + (v.interactive ? ' as journal club' : '') + '. Here’s that entry.' });
          return;
        }
        if (err.status === 401) { render(); openPaperSignIn(s.paperId, 'You’ve been signed out. Your draft is kept: sign in again to save it.'); return; }
        s.error = err.message;
        renderPaperSheet();
      });
  }

  function renderPaperDone() {
    var s = st.sheet, e = s.done;
    $('sheet').innerHTML =
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="paper-done">' +
        '<span class="done-ico">' + ico('check') + '</span>' +
        '<h2 id="sheet-title">' + (s.entryId ? 'Saved' : 'Logged') + ' · ' + esc(dur(e.minutes)) + '</h2>' +
        '<p class="panel-lead">' + (e.complete
          ? 'It counts toward ' + esc(yearLabel(e.cpd_year)) + (e.interactive ? ', including your interactive hours.' : '.')
          : 'Saved. Add a reflection later to complete it. It’s listed under “Needs reflection” on your CPD tab.') + '</p>' +
      '</div>' +
      '<div class="sheet-actions"><span class="spacer"></span>' +
        '<button class="btn" data-go-cpd type="button">Open CPD</button>' +
        '<button class="btn btn-primary" data-close type="button" autofocus>Done</button></div>';
    var el = $('sheet');
    el.querySelector('[data-close]').addEventListener('click', function () { closeSheet(true); });
    el.querySelector('[data-close]').focus();
    el.querySelector('[data-go-cpd]').addEventListener('click', function () {
      closeSheet(true);
      if (st.year !== e.cpd_year) { st.year = e.cpd_year; st.summary = st.entries = st.goals = null; loadYear(); }
      PP.setTab('cpd');
    });
  }

  function deletePaperEntry() {
    var s = st.sheet;
    api('/api/entries/' + encodeURIComponent(s.entryId), { method: 'DELETE' })
      .then(function () { closeSheet(false); loadLogged(); return loadYear(); })
      .catch(function (err) { s.error = err.message; s.confirmDelete = false; renderPaperSheet(); });
  }

  /* ── goal sheet ─────────────────────────────────────── */

  function openGoal(id) {
    var g = id ? st.goals.filter(function (x) { return x.id === id; })[0] : null;
    openSheet({ type: 'goal', id: id, text: g ? g.text : '', status: g ? g.status : 'active', error: '' }, '');
    renderGoalSheet();
  }

  function renderGoalSheet() {
    var s = st.sheet;
    var statuses = [['active', 'Active'], ['met', 'Met'], ['dropped', 'Dropped']];
    $('sheet').innerHTML =
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="sheet-head"><h2 id="sheet-title">' + (s.id ? 'Learning goal' : 'New learning goal') + '</h2>' +
        '<button class="icon-btn" data-close type="button" aria-label="Close">' + ico('plus', 'rot45') + '</button></div>' +
      '<form class="form" id="goal-form" novalidate>' +
        field('Goal for ' + esc(yearLabel(st.year)), '<textarea name="text" rows="3" maxlength="300" autofocus placeholder="e.g. Get confident reading paediatric ECGs">' + esc(s.text) + '</textarea>') +
        '<p class="hint">Think about gaps in your practice, your patients’ needs, new evidence, or what your service is focusing on.</p>' +
        (s.id ? '<fieldset><legend>Status</legend><div class="chips">' + statuses.map(function (x) {
          var on = s.status === x[0];
          return '<button class="chip' + (on ? ' is-on' : '') + '" data-status="' + x[0] + '" type="button" aria-pressed="' + on + '">' + x[1] + '</button>';
        }).join('') + '</div></fieldset>' : '') +
        (s.error ? '<p class="notice notice-warn" role="alert">' + esc(s.error) + '</p>' : '') +
        '<div class="sheet-actions">' +
          (s.id ? (s.confirmDelete
            ? '<button class="btn btn-danger" data-delete-yes type="button">Delete goal</button><button class="btn" data-delete-no type="button">Keep</button>'
            : '<button class="btn btn-quiet" data-delete type="button">Delete</button>') : '') +
          (s.confirmDelete ? '' :
            '<span class="spacer"></span>' +
            '<button class="btn" data-close type="button">Cancel</button>' +
            '<button class="btn btn-primary" type="submit">Save</button>') +
        '</div>' +
      '</form>';

    var el = $('sheet'), form = $('goal-form');
    var text = form.querySelector('[name="text"]');
    text.addEventListener('input', function () { s.text = text.value; });
    el.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeSheet(false); }); });
    el.querySelectorAll('[data-status]').forEach(function (b) {
      b.addEventListener('click', function () { s.status = b.getAttribute('data-status'); renderGoalSheet(); });
    });
    var del = el.querySelector('[data-delete]');
    if (del) del.addEventListener('click', function () { s.confirmDelete = true; renderGoalSheet(); });
    var no = el.querySelector('[data-delete-no]');
    if (no) no.addEventListener('click', function () { s.confirmDelete = false; renderGoalSheet(); });
    var yes = el.querySelector('[data-delete-yes]');
    if (yes) yes.addEventListener('click', function () {
      api('/api/goals/' + encodeURIComponent(s.id), { method: 'DELETE' })
        .then(function () { closeSheet(false); return loadYear(); })
        .catch(function (err) { s.error = err.message; renderGoalSheet(); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!s.text.trim()) { s.error = 'Write the goal first.'; renderGoalSheet(); return; }
      var req = s.id
        ? api('/api/goals/' + encodeURIComponent(s.id), { method: 'PATCH', body: { text: s.text, status: s.status } })
        : api('/api/goals', { method: 'POST', body: { text: s.text, cpd_year: st.year } });
      req.then(function () { closeSheet(false); return loadYear(); })
        .catch(function (err) { s.error = err.message; renderGoalSheet(); });
    });
  }

  /* ── PD quiz (plan phase 3) ─────────────────────────── */

  /* greg publishes a quiz with each PD brief: data/quizzes/<id>.json
     (answers included; it's self-directed CPD) and data/quizzes/index.json.
     Anyone can take it. Signed in, the attempt is logged as CPD once; the
     API grades from the same file. A run (answers, time, the log form) is
     kept in sessionStorage so it survives the sign-in round trip. */
  var QUIZ_KEY = 'pp:quiz:';   /* + quiz id */
  var QUIZ_MIN = 5, QUIZ_MAX = 60;
  var SEGMENT_MAX = 900;       /* one timing stretch counts at most 15 min (a sleeping laptop) */
  var LETTERS = 'ABCD';

  var qz = {
    index: null,      /* [{ id, span, count, est_minutes }], newest first */
    quizzes: {},      /* id → quiz */
    attempts: null,   /* quiz_id → { score, total, entry_id }, signed in only */
    id: null,         /* quiz on screen, or 'all' for the list */
    error: '',
    run: null,        /* { id, pos (-1 = intro), answers, seconds, done, v (log form), saving, error, saved } */
    goals: null,
    clock: null       /* performance.now() when the current timing stretch began */
  };

  function loadQuizIndex() {
    return fetch('data/quizzes/index.json?t=' + Date.now(), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('index.json ' + r.status);
      return r.json();
    }).then(function (d) {
      qz.index = (d && d.quizzes) || [];
    }).catch(function () {
      qz.index = [];
    }).then(function () {
      renderQuizCard();
      if (PP.state.tab === 'quiz') showQuiz();
    });
  }

  function loadQuizFile(id) {
    if (qz.quizzes[id]) return Promise.resolve(qz.quizzes[id]);
    return fetch('data/quizzes/' + encodeURIComponent(id) + '.json?t=' + Date.now(), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('That quiz isn’t available.');
      return r.json();
    }).then(function (q) {
      qz.quizzes[id] = q;
      return q;
    });
  }

  function loadAttempts() {
    if (!st.user) return Promise.resolve();
    return api('/api/quiz/attempts').then(function (r) {
      var map = {};
      r.attempts.forEach(function (a) { map[a.quiz_id] = a; });
      qz.attempts = map;
      renderQuizCard();
      if (PP.state.tab === 'quiz') renderQuiz();
    }).catch(function (err) {
      /* Still let them try to save: a retake answers 409 with the first result. */
      if (err.status === 401) return;
      qz.attempts = qz.attempts || {};
      if (PP.state.tab === 'quiz') renderQuiz();
    });
  }

  /* A logged attempt whose CPD entry still exists. */
  function attemptFor(id) {
    var a = st.user && qz.attempts && qz.attempts[id];
    return a && a.entry_id ? a : null;
  }

  function quizIdFromHash() {
    var m = /^#quiz=([\w-]+)$/.exec(location.hash || '');
    return m ? m[1] : '';
  }

  /* onShow('quiz'), and again once the index arrives. */
  function showQuiz() {
    var want = quizIdFromHash() || (qz.index && qz.index[0] ? qz.index[0].id : '');
    if (want === 'all' || !want) { pauseClock(); qz.id = want || null; qz.error = ''; renderQuiz(); return; }
    if (qz.run && qz.run.id === want) { qz.id = want; renderQuiz(); resumeClock(); return; }
    pauseClock();
    qz.id = want; qz.run = null; qz.error = '';
    renderQuiz();
    loadQuizFile(want).then(function (quiz) {
      if (qz.id !== want) return;
      qz.run = restoreRun(quiz);
      renderQuiz();
      resumeClock();
    }).catch(function (err) {
      if (qz.id !== want) return;
      qz.error = err.message;
      renderQuiz();
    });
  }

  /* ── run state ── */

  function defaultGoal(quiz) {
    /* "Stroke & neuro" → "stroke", so the list reads cleanly. */
    var t = [];
    quiz.questions.forEach(function (x) {
      var s = String(x.topic || '').split(/\s*[&(]/)[0].trim().toLowerCase();
      if (s && s !== 'other' && t.indexOf(s) === -1) t.push(s);
    });
    t = t.slice(0, 5);
    var list = t.length > 1 ? t.slice(0, -1).join(', ') + ' and ' + t[t.length - 1] : (t[0] || 'prehospital care');
    return 'Update my knowledge of recent prehospital research on ' + list + '.';
  }

  function newRun(quiz) {
    return {
      id: quiz.id, pos: -1, answers: [], seconds: 0, done: false,
      v: { minutes: QUIZ_MIN, group: false, with_whom: '', learning_goal: defaultGoal(quiz), goal_id: '',
        reflection_learned: '', reflection_practice: '', reflection_next: '' }
    };
  }

  function restoreRun(quiz) {
    var r;
    try { r = JSON.parse(sessionStorage.getItem(QUIZ_KEY + quiz.id) || 'null'); } catch (e) { r = null; }
    var n = quiz.questions.length;
    if (!r || r.id !== quiz.id || !Array.isArray(r.answers) || r.answers.length > n || !r.v) return newRun(quiz);
    r.pos = Math.max(-1, Math.min(n - 1, +r.pos || 0));
    r.seconds = +r.seconds || 0;
    r.done = !!r.done && r.answers.length === n;
    return r;
  }

  function saveRun() {
    var r = qz.run;
    if (!r) return;
    try {
      sessionStorage.setItem(QUIZ_KEY + r.id, JSON.stringify({ id: r.id, pos: r.pos, answers: r.answers, seconds: Math.round(r.seconds), done: r.done, v: r.v }));
    } catch (e) {}
  }

  /* The timer runs while a question is on screen and the tab is visible. */
  function tickClock() {
    if (qz.clock == null || !qz.run) return;
    var now = performance.now();
    qz.run.seconds += Math.min(SEGMENT_MAX, (now - qz.clock) / 1000);
    qz.clock = now;
  }
  function resumeClock() {
    var r = qz.run;
    if (r && r.pos >= 0 && !r.done && !document.hidden && PP.state.tab === 'quiz' && qz.clock == null) qz.clock = performance.now();
  }
  function pauseClock() {
    if (qz.clock == null) return;
    tickClock();
    qz.clock = null;
    saveRun();
  }

  /* Actual time, rounded up to the next 5 minutes, 5 min – 1 h (as the API does). */
  function quizMinutes(seconds) {
    return Math.min(QUIZ_MAX, Math.max(QUIZ_MIN, Math.ceil(seconds / 60 / 5) * 5));
  }

  /* ── Weekly-tab card ── */

  function renderQuizCard() {
    var slot = $('quiz-slot');
    if (!slot) return;
    var q = qz.index && qz.index[0];
    slot.hidden = !q;
    if (!q) { slot.innerHTML = ''; return; }
    var a = attemptFor(q.id);
    slot.innerHTML =
      '<a class="brief-card quiz-card" href="#quiz">' +
        '<span class="panel-kicker panel-kicker-accent">' + ico('quiz') + 'PD quiz · ' + esc(q.span) + '</span>' +
        '<span class="brief-card-title">' + esc(q.count) + ' questions on this period’s papers</span>' +
        '<span class="brief-card-lead">' + (a
          ? '<span class="quiz-done">' + ico('check') + 'Done · ' + a.score + '/' + a.total + '</span> Logged to your CPD.'
          : 'About ' + esc(q.est_minutes) + ' minutes. Each answer comes with why. Signed in, it’s logged as CPD.') + '</span>' +
        '<span class="brief-card-go">' + (a ? 'Review it' : 'Take the quiz') + ico('arrow') + '</span>' +
      '</a>' +
      (qz.index.length > 1 ? '<a class="quiz-past-link" href="#quiz=all">Past quizzes ' + ico('chev-right') + '</a>' : '');
  }

  /* ── quiz view ── */

  function renderQuiz() {
    var root = $('quiz-body');
    if (!root) return;
    PP.renderKicker();
    if (!qz.index) { root.innerHTML = loadingHTML(); return; }
    if (qz.id === 'all') { renderQuizList(root); return; }
    if (!qz.id) {
      root.innerHTML = '<div class="empty-state">' + ico('quiz', 'empty-ico') + '<h2>No quiz yet</h2><p>A short quiz comes with each PD brief, every 8 days.</p></div>';
      return;
    }
    if (qz.error) {
      root.innerHTML = '<div class="empty-state"><h2>Quiz unavailable</h2><p>' + esc(qz.error) + '</p></div>' +
        (qz.index.length ? '<p class="quiz-foot"><a href="#quiz=all">All quizzes</a></p>' : '');
      return;
    }
    var quiz = qz.quizzes[qz.id], r = qz.run;
    if (!quiz || !r) { root.innerHTML = loadingHTML(); return; }
    if (r.done) renderResults(root, quiz, r);
    else if (r.pos < 0) renderIntro(root, quiz);
    else renderQuestion(root, quiz, r);
  }

  function renderQuizList(root) {
    root.innerHTML =
      '<div class="section-head"><h2>Past quizzes</h2><span class="muted-flag">' + qz.index.length + '</span></div>' +
      (qz.index.length ? '<div class="quiz-list">' + qz.index.map(function (q) {
        var a = attemptFor(q.id);
        return '<a class="quiz-row" href="#quiz=' + esc(q.id) + '">' +
          '<span class="quiz-row-main"><span class="quiz-row-title">' + esc(q.span) + '</span>' +
          '<span class="entry-meta">' + q.count + ' questions · about ' + esc(q.est_minutes) + ' min</span></span>' +
          (a ? '<span class="pill pill-met">' + ico('check') + a.score + '/' + a.total + '</span>' : '') +
          ico('chev-right', 'entry-chev') + '</a>';
      }).join('') + '</div>' : '<p class="empty">No quizzes yet.</p>');
  }

  function quizHeadHTML(quiz, sub) {
    return '<header class="brief-head">' +
      '<p class="panel-kicker panel-kicker-accent">' + ico('quiz') + 'PD quiz</p>' +
      '<h2 class="brief-title">' + esc(quiz.span) + '</h2>' +
      '<p class="brief-sub">' + esc(sub) + '</p></header>';
  }

  function renderIntro(root, quiz) {
    var a = attemptFor(quiz.id);
    root.innerHTML =
      quizHeadHTML(quiz, quiz.questions.length + ' questions · about ' + quiz.est_minutes + ' min') +  /* esc'd in quizHeadHTML */
      '<p class="quiz-lead">One question per paper from this period’s PD brief. Each answer shows why, with a link to the paper.</p>' +
      (a ? '<p class="notice">' + ico('check') + ' You’ve logged this quiz: ' + a.score + '/' + a.total + '. A retake isn’t logged again.</p>' : '') +
      '<button class="btn btn-primary btn-add" data-quiz-start type="button">' + (a ? 'Take it again' : 'Start') + '</button>' +
      '<p class="fine">Your time is counted while a question is on screen, for your CPD log.' +
        (qz.index.length > 1 ? ' <a href="#quiz=all">Past quizzes</a>' : '') + '</p>';
    root.querySelector('[data-quiz-start]').addEventListener('click', function () {
      var r = qz.run;
      r.pos = 0; r.answers = []; r.seconds = 0; r.done = false;
      saveRun();
      resumeClock();
      renderQuiz();
      focusQuestion();
    });
  }

  function dotsHTML(quiz, r) {
    return '<ol class="quiz-dots" aria-label="Question ' + (r.pos + 1) + ' of ' + quiz.questions.length + '">' +
      quiz.questions.map(function (x, i) {
        var a = r.answers[i];
        var cls = a == null ? (i === r.pos ? 'is-now' : '') : (a === x.answer ? 'is-right' : 'is-wrong');
        return '<li class="' + cls + '"' + (i === r.pos ? ' aria-current="step"' : '') + '></li>';
      }).join('') + '</ol>';
  }

  function renderQuestion(root, quiz, r) {
    var q = quiz.questions[r.pos], picked = r.answers[r.pos], answered = picked != null;
    var last = r.pos === quiz.questions.length - 1;
    var right = answered && picked === q.answer;
    root.innerHTML =
      '<div class="quiz-top">' + dotsHTML(quiz, r) + '<span class="quiz-count">' + (r.pos + 1) + ' / ' + quiz.questions.length + '</span></div>' +
      '<p class="quiz-paper">' + esc(q.topic) + ' · ' + esc(q.short_title) + '</p>' +
      '<h2 class="quiz-q" id="quiz-q" tabindex="-1">' + esc(q.question) + '</h2>' +
      '<div class="quiz-opts" role="group" aria-labelledby="quiz-q">' +
        q.options.map(function (o, j) {
          var cls = !answered ? '' : j === q.answer ? ' is-right' : j === picked ? ' is-wrong' : ' is-dim';
          var mark = !answered ? '' : j === q.answer ? ico('check') + '<span class="sr-only">Correct answer</span>'
            : j === picked ? ico('x') + '<span class="sr-only">Your answer, wrong</span>' : '';
          return '<button class="quiz-opt' + cls + '" data-opt="' + j + '" type="button"' + (answered ? ' disabled' : '') + '>' +
            '<span class="quiz-letter" aria-hidden="true">' + LETTERS[j] + '</span>' +
            '<span class="quiz-opt-text">' + esc(o) + '</span>' +
            '<span class="quiz-mark">' + mark + '</span></button>';
        }).join('') +
      '</div>' +
      (answered
        ? '<div class="quiz-why" role="status">' +
            '<p class="quiz-verdict ' + (right ? 'is-right' : 'is-wrong') + '" id="quiz-verdict" tabindex="-1">' +
              ico(right ? 'check' : 'x') + (right ? 'Correct' : 'Not quite. It’s ' + LETTERS[q.answer] + '.') + '</p>' +
            '<p>' + esc(q.explanation) + '</p>' +
            '<a class="quiz-read" href="#paper=' + esc(encodeURIComponent(q.paper_id)) + '">' + ico('feed') + 'Read the paper</a>' +
          '</div>' +
          '<div class="quiz-nav"><span class="spacer"></span><button class="btn btn-primary" data-quiz-next type="button">' + (last ? 'See results' : 'Next') + ico('chev-right') + '</button></div>'
        : '');

    root.querySelectorAll('[data-opt]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (r.answers[r.pos] != null) return;
        tickClock();
        r.answers[r.pos] = +b.getAttribute('data-opt');
        saveRun();
        renderQuiz();
        var v = $('quiz-verdict');
        if (v) v.focus({ preventScroll: true });
      });
    });
    var next = root.querySelector('[data-quiz-next]');
    if (next) next.addEventListener('click', function () {
      tickClock();
      if (last) {
        pauseClock();
        r.done = true;
        r.v.minutes = quizMinutes(r.seconds);
        r.saved = null; r.error = '';
      } else {
        r.pos++;
      }
      saveRun();
      renderQuiz();
      window.scrollTo(0, 0);
      if (!last) focusQuestion();
    });
  }

  function focusQuestion() {
    var h = $('quiz-q');
    if (h) h.focus({ preventScroll: true });
  }

  function score(quiz, r) {
    return r.answers.reduce(function (n, a, i) { return n + (a === quiz.questions[i].answer ? 1 : 0); }, 0);
  }

  function renderResults(root, quiz, r) {
    var n = quiz.questions.length, s = score(quiz, r);
    var recap = quiz.questions.map(function (q, i) {
      var a = r.answers[i], ok = a === q.answer;
      return '<li class="' + (ok ? 'is-right' : 'is-wrong') + '">' +
        '<span class="quiz-recap-mark">' + ico(ok ? 'check' : 'x') + '<span class="sr-only">' + (ok ? 'Right' : 'Wrong') + '</span></span>' +
        '<div><p class="quiz-recap-q">' + esc(q.question) + '</p>' +
        (ok ? '' : '<p class="quiz-recap-a">You said ' + LETTERS[a] + ': ' + esc(q.options[a]) + '</p>') +
        '<p class="quiz-recap-a"><b>' + LETTERS[q.answer] + ': ' + esc(q.options[q.answer]) + '</b></p>' +
        '<p class="quiz-recap-why">' + esc(q.explanation) + ' <a href="#paper=' + esc(encodeURIComponent(q.paper_id)) + '">Read the paper</a></p></div></li>';
    }).join('');
    root.innerHTML =
      quizHeadHTML(quiz, 'Your result') +
      '<div class="quiz-score"><span class="quiz-score-n">' + s + '<span>/' + n + '</span></span>' +
        '<span class="quiz-score-line">' + esc(scoreLine(s, n)) + '</span></div>' +
      '<details class="quiz-recap"><summary>Your answers</summary><ol>' + recap + '</ol></details>' +
      '<div id="quiz-log">' + logBlockHTML(quiz, r, s) + '</div>' +
      '<div class="quiz-nav"><button class="btn" data-quiz-again type="button">Try again</button>' +
        (qz.index.length > 1 ? '<a class="link-btn" href="#quiz=all">Past quizzes</a>' : '') + '</div>';
    root.querySelector('[data-quiz-again]').addEventListener('click', function () {
      r.pos = 0; r.answers = []; r.seconds = 0; r.done = false; r.saved = null; r.error = '';
      saveRun();
      resumeClock();
      renderQuiz();
      window.scrollTo(0, 0);
      focusQuestion();
    });
    bindLogBlock(quiz, r);
  }

  function scoreLine(s, n) {
    if (s === n) return 'All of them. Nicely done.';
    if (s >= n * 0.75) return 'Solid. The recap shows the ones that got away.';
    if (s >= n * 0.5) return 'Over half. The explanations are worth a look.';
    return 'A tough set. The explanations and papers are the useful part.';
  }

  /* The log-to-CPD block under the results. */
  function logBlockHTML(quiz, r, s) {
    var a = attemptFor(quiz.id);
    if (a) {
      return '<article class="panel quiz-logged">' +
        '<span class="done-ico">' + ico('check') + '</span>' +
        '<div><h3>' + (r.saved ? 'Saved to your CPD log' : 'Already in your CPD log') + '</h3>' +
        '<p class="panel-lead">' + (r.saved
          ? 'Logged · ' + esc(dur(r.saved.minutes)) + ', score ' + a.score + '/' + a.total + '.'
          : 'Logged with your first result, ' + a.score + '/' + a.total + '. Retakes aren’t logged again.') + '</p>' +
        '<button class="btn" data-go-cpd type="button">Open CPD</button></div></article>';
    }
    if (!st.checked) return loadingHTML();
    if (st.apiDown && !st.user) return downHTML();
    if (!st.user) return signInHTML('Sign in to save this to your CPD log', '#quiz=' + quiz.id);
    if (!qz.attempts) return loadingHTML();

    var v = r.v;
    var goals = (qz.goals || []).filter(function (g) { return g.status === 'active' || g.id === v.goal_id; });
    return '<article class="panel">' +
      '<span class="panel-kicker panel-kicker-accent">' + ico('log') + 'Log to my CPD</span>' +
      '<form class="form" id="quiz-form" novalidate>' +
        '<div class="field"><span class="label">Time spent</span><div class="stepper">' +
          '<span class="step"><button type="button" data-qstep="-5" aria-label="5 minutes less"' + (v.minutes <= QUIZ_MIN ? ' disabled' : '') + '>' + ico('minus') + '</button>' +
          '<output aria-live="polite">' + esc(dur(v.minutes)) + '</output>' +
          '<button type="button" data-qstep="5" aria-label="5 minutes more"' + (v.minutes >= QUIZ_MAX ? ' disabled' : '') + '>' + ico('plus') + '</button></span>' +
        '</div></div>' +
        '<p class="hint">From the timer, rounded up to 5 minutes. Quiz time only; reflection doesn’t count toward the 30 hours.</p>' +
        '<label class="switch-row"><input type="checkbox" name="group" role="switch"' + (v.group ? ' checked' : '') + '>' +
          '<span class="switch" aria-hidden="true"></span><span><b>Done as a group?</b>' +
          '<span class="hint">With other practitioners, it counts toward your 8 interactive hours.</span></span></label>' +
        (v.group ? field('Who with? <span class="opt">roles, not names</span>', '<input name="with_whom" maxlength="200" value="' + esc(v.with_whom) + '" placeholder="e.g. station PD session, crew partner">') : '') +
        '<fieldset><legend>Learning goal</legend>' +
          '<textarea name="learning_goal" rows="2" maxlength="4000" aria-label="Learning goal">' + esc(v.learning_goal) + '</textarea>' +
          (goals.length ? '<label class="field"><span class="label">Link to one of my goals <span class="opt">optional</span></span>' +
            '<select name="goal_id"><option value="">None</option>' + goals.map(function (g) {
              return '<option value="' + esc(g.id) + '"' + (g.id === v.goal_id ? ' selected' : '') + '>' + esc(g.text) + '</option>';
            }).join('') + '</select></label>' : '') +
        '</fieldset>' +
        '<fieldset><legend>Reflection <span class="opt">needed for a complete entry</span></legend>' +
          field('Which answer surprised you?', '<textarea name="reflection_learned" rows="2" maxlength="4000">' + esc(v.reflection_learned) + '</textarea>') +
          field('Does it change anything you do?', '<textarea name="reflection_practice" rows="2" maxlength="4000">' + esc(v.reflection_practice) + '</textarea>') +
          field('Anything to follow up? <span class="opt">optional</span>', '<textarea name="reflection_next" rows="2" maxlength="4000">' + esc(v.reflection_next) + '</textarea>') +
        '</fieldset>' +
        '<p class="notice notice-warn" id="pii-warn" hidden>That looks like it might identify a patient (a name, date of birth or record number). Please remove it.</p>' +
        '<p class="fine">Don’t include patient-identifying details.</p>' +
        (r.error ? '<p class="notice notice-warn" role="alert">' + esc(r.error) + '</p>' : '') +
        '<button class="btn btn-primary btn-add" type="submit"' + (r.saving ? ' disabled' : '') + '>' + (r.saving ? 'Saving…' : 'Save to my CPD log · ' + s + '/' + quiz.questions.length) + '</button>' +
      '</form></article>';
  }

  function bindLogBlock(quiz, r) {
    var box = $('quiz-log');
    var go = box.querySelector('[data-go-cpd]');
    if (go) go.addEventListener('click', function () {
      var y = cpdYear(todayISO());
      if (st.year !== y) { st.year = y; st.summary = st.entries = st.goals = null; loadYear(); }
      PP.setTab('cpd');
    });
    var form = $('quiz-form');
    if (!form) return;
    if (!qz.goals) {
      goalsFor(cpdYear(todayISO())).then(function (g) {
        qz.goals = g;
        if (g.length && qz.run === r && $('quiz-form')) rerenderLog(quiz, r);
      }).catch(function () {});
    }
    form.querySelectorAll('[data-qstep]').forEach(function (b) {
      b.addEventListener('click', function () {
        collectQuiz(r);
        var d = +b.getAttribute('data-qstep');
        r.v.minutes = Math.max(QUIZ_MIN, Math.min(QUIZ_MAX, r.v.minutes + d));
        saveRun();
        rerenderLog(quiz, r);
        var again = $('quiz-form').querySelector('[data-qstep="' + d + '"]');
        if (again && !again.disabled) again.focus();
      });
    });
    var group = form.querySelector('[name="group"]');
    group.addEventListener('change', function () {
      collectQuiz(r);
      saveRun();
      rerenderLog(quiz, r);
      if (r.v.group) $('quiz-form').querySelector('[name="with_whom"]').focus();
    });
    form.addEventListener('input', function () { collectQuiz(r); saveRun(); checkPII(); });
    form.addEventListener('change', function (e) { if (e.target.name === 'goal_id') { collectQuiz(r); saveRun(); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); saveQuiz(quiz, r); });
    checkPII();
  }

  function rerenderLog(quiz, r) {
    $('quiz-log').innerHTML = logBlockHTML(quiz, r, score(quiz, r));
    bindLogBlock(quiz, r);
  }

  function collectQuiz(r) {
    var form = $('quiz-form'), v = r.v;
    ['with_whom', 'learning_goal', 'goal_id', 'reflection_learned', 'reflection_practice', 'reflection_next'].forEach(function (n) {
      var f = form.querySelector('[name="' + n + '"]');
      if (f) v[n] = f.value;
    });
    v.group = form.querySelector('[name="group"]').checked;
  }

  function saveQuiz(quiz, r) {
    collectQuiz(r);
    var v = r.v;
    if (v.group && !v.with_whom.trim()) {
      r.error = 'Say who you did it with (roles, not names). That’s your audit evidence.';
      rerenderLog(quiz, r);
      return;
    }
    r.saving = true; r.error = '';
    rerenderLog(quiz, r);
    var goal = v.goal_id ? (qz.goals || []).filter(function (g) { return g.id === v.goal_id; })[0] : null;
    api('/api/quiz/' + encodeURIComponent(quiz.id) + '/attempt', { method: 'POST', body: {
      answers: r.answers, seconds: v.minutes * 60, group: !!v.group, with_whom: v.group ? v.with_whom : null,
      learning_goal: v.learning_goal || (goal ? goal.text : ''), goal_id: v.goal_id || null,
      reflection_learned: v.reflection_learned, reflection_practice: v.reflection_practice, reflection_next: v.reflection_next
    } }).then(function (res) {
      qz.attempts = qz.attempts || {};
      qz.attempts[quiz.id] = { quiz_id: quiz.id, score: res.score, total: res.total, entry_id: res.entry_id };
      r.saving = false;
      r.saved = res;
      saveRun();
      if (res.cpd_year === st.year || !st.entries) loadYear();
      renderQuizCard();
      if (qz.run === r) rerenderLog(quiz, r);
    }).catch(function (err) {
      r.saving = false;
      if (err.status === 409 && err.data && err.data.entry_id) {
        qz.attempts = qz.attempts || {};
        qz.attempts[quiz.id] = { quiz_id: quiz.id, score: err.data.score, total: err.data.total, entry_id: err.data.entry_id };
        renderQuizCard();
      } else if (err.status === 401) {
        render();
      } else {
        r.error = err.message;
      }
      if (qz.run === r && $('quiz-log')) rerenderLog(quiz, r);
    });
  }

  /* ── Account view ───────────────────────────────────── */

  function renderAccount() {
    var root = $('account-body');
    if (!st.checked) { root.innerHTML = loadingHTML(); return; }
    if (st.apiDown && !st.user) { root.innerHTML = downHTML(); return; }
    if (!st.user) { root.innerHTML = signInHTML('Sign in to track your CPD'); st.loginError = ''; return; }
    var u = st.user;
    root.innerHTML =
      '<article class="panel account-card">' +
        '<span class="avatar avatar-lg" aria-hidden="true">' + esc(initial(u)) + '</span>' +
        '<div class="account-id"><span class="account-name">' + esc(u.name || 'Your account') + '</span>' +
          '<span class="account-email">' + esc(u.email || '') + '</span>' +
          '<span class="account-prov">' + providerLogo(u.provider) + 'Signed in with ' + esc(PROVIDER_NAMES[u.provider] || u.provider) + '</span></div>' +
      '</article>' +

      '<article class="panel">' +
        '<span class="panel-kicker panel-kicker-accent">Yearly targets</span>' +
        targetRow('target_hours', 'Total CPD', u.target_hours, 1, 60) +
        targetRow('target_interactive_hours', 'Interactive', u.target_interactive_hours, 0, 30) +
        '<p class="hint">The Board asks for 30 h a year, 8 h of it interactive. Registered part-way through the year? It’s 7.5 h for every 3 months left in the period, and first-time registrants are exempt in their first period.</p>' +
      '</article>' +

      '<article class="panel">' +
        '<span class="panel-kicker">Your data</span>' +
        '<a class="btn" href="' + esc(API + '/api/export.json') + '">' + ico('download') + 'Download all my data (JSON)</a>' +
        '<p class="hint">Everything you’ve logged, every year. Signing in with ' + esc(PROVIDER_NAMES[u.provider === 'google' ? 'microsoft' : 'google']) + ' would create a separate account.</p>' +
        '<button class="btn" id="btn-signout" type="button">Sign out</button>' +
      '</article>' +

      '<article class="panel danger-zone">' +
        '<span class="panel-kicker">Delete account</span>' +
        (st.deleting
          ? '<p class="panel-lead">This permanently deletes your account, goals and every entry. Download your data first if you need it for an audit. Type <b>DELETE</b> to confirm.</p>' +
            '<input id="delete-confirm" autocomplete="off" autocapitalize="characters" aria-label="Type DELETE to confirm">' +
            '<div class="sheet-actions"><button class="btn" id="delete-cancel" type="button">Cancel</button>' +
            '<button class="btn btn-danger" id="delete-go" type="button" disabled>Delete my account</button></div>' +
            '<p class="notice notice-warn" id="delete-error" hidden></p>'
          : '<p class="hint">Removes everything we hold about you.</p><button class="btn btn-quiet" id="delete-start" type="button">Delete my account…</button>') +
      '</article>' +
      '<p class="fine"><a href="privacy.html">Privacy</a> · Questions: newsletter@paramedicpapers.com</p>';

    root.querySelectorAll('[data-target]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-target'), d = +b.getAttribute('data-d');
        var lim = key === 'target_hours' ? [1, 60] : [0, 30];
        var next = Math.max(lim[0], Math.min(lim[1], u[key] + d));
        if (next === u[key]) return;
        var body = {}; body[key] = next;
        u[key] = next;
        renderAccount();
        api('/api/me', { method: 'PATCH', body: body }).then(function (me) { st.user = me; renderChrome(); })
          .catch(function () { u[key] -= d; renderAccount(); });
      });
    });
    $('btn-signout').addEventListener('click', function () {
      api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
        st.user = null; st.summary = st.entries = st.goals = null; qz.attempts = null;
        dropLogged();
        render();
      });
    });
    var start = $('delete-start');
    if (start) start.addEventListener('click', function () { st.deleting = true; renderAccount(); $('delete-confirm').focus(); });
    var input = $('delete-confirm');
    if (input) {
      input.addEventListener('input', function () { $('delete-go').disabled = input.value.trim() !== 'DELETE'; });
      $('delete-cancel').addEventListener('click', function () { st.deleting = false; renderAccount(); });
      $('delete-go').addEventListener('click', function () {
        $('delete-go').disabled = true;
        api('/api/me', { method: 'DELETE', body: { confirm: 'DELETE' } }).then(function () {
          clearDraft();
          st.user = null; st.summary = st.entries = st.goals = null; st.deleting = false;
          dropLogged();
          render();
        }).catch(function (err) {
          $('delete-error').textContent = err.message;
          $('delete-error').hidden = false;
          $('delete-go').disabled = false;
        });
      });
    }
  }

  function targetRow(key, label, val, min, max) {
    return '<div class="target-row"><span class="target-label">' + esc(label) + '</span>' +
      '<span class="step"><button type="button" data-target="' + key + '" data-d="-1" aria-label="Lower ' + esc(label) + ' target"' + (val <= min ? ' disabled' : '') + '>' + ico('minus') + '</button>' +
      '<output aria-live="polite">' + val + ' h</output>' +
      '<button type="button" data-target="' + key + '" data-d="1" aria-label="Raise ' + esc(label) + ' target"' + (val >= max ? ' disabled' : '') + '>' + ico('plus') + '</button></span></div>';
  }
})();
