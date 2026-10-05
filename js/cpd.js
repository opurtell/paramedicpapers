/* ============================================================
   Paramedic Papers — CPD tracker (beta)
   Sign-in, the "More" menu, the CPD tab, manual PD entries, learning
   goals, exports and the Account page. Talks to the API Worker at
   api.paramedicpapers.com (repo: cpd/, plan: cpd/plan/phase-1).
   Uses only window.PP from app.js. Does nothing until /#cpd-beta has
   been visited in this browser.
   ============================================================ */

(function () {
  'use strict';

  var PP = window.PP;
  if (!PP || !PP.beta()) return;

  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8787' : 'https://api.paramedicpapers.com';
  var DRAFT_KEY = 'pp:cpd-draft';

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
    sheet: null          /* { type: 'menu' | 'entry' | 'goal', … } */
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = PP.esc, ico = PP.ico;

  /* ── boot ───────────────────────────────────────────── */

  readLoginError();
  PP.hooks.openMenu = openMenu;
  PP.hooks.kicker = kicker;
  PP.hooks.onShow = function (tab) {
    if (tab === 'cpd' || tab === 'account') render();
    if (tab === 'cpd' && st.user && !st.entries && !st.loading) loadYear();
  };
  PP.hooks.onRender.push(renderChrome);

  document.addEventListener('DOMContentLoaded', function () {
    $('sheet-backdrop').addEventListener('click', function () { closeSheet(true); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && st.sheet) closeSheet(true);
    });
    boot();
  });

  function boot() {
    /* Never blocks the rest of the site: papers.json loads in parallel. */
    api('/api/config').then(function (c) { if (c && c.providers) st.providers = c.providers; }).catch(function () {});
    api('/api/me').then(function (me) {
      st.user = me;
      st.checked = true;
      st.apiDown = false;
      render();
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
        if (r.status === 401) { st.user = null; st.entries = st.summary = st.goals = null; }
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
    PP.renderKicker();
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

  function signInHTML(lead) {
    var buttons = st.providers.map(function (p) {
      return '<a class="btn btn-provider" href="' + esc(API + '/auth/' + p + '?return=' + encodeURIComponent('#' + (PP.state.tab || 'cpd'))) + '">' +
        providerLogo(p) + 'Continue with ' + esc(PROVIDER_NAMES[p] || p) + '</a>';
    }).join('');
    return '<article class="panel signin">' +
      '<span class="panel-kicker panel-kicker-accent">CPD tracker · beta</span>' +
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
    return '<button class="entry-row" data-entry="' + esc(e.id) + '" type="button">' +
      '<span class="entry-date">' + esc(niceDate(e.date)) + '</span>' +
      '<span class="entry-main">' +
        '<span class="entry-title">' + esc(e.title) + '</span>' +
        '<span class="entry-meta">' + esc(type ? type.label : e.activity_type) + ' · ' + dur(e.minutes) + '</span>' +
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
    var form = $('entry-form');
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
        st.user = null; st.summary = st.entries = st.goals = null;
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
