# Paramedic Papers

A static dashboard displaying daily curated paramedic and prehospital research paper summaries. Designed for working paramedics to quickly scan the latest evidence.

## Setup

### Local Development

Open `index.html` directly in a browser, or serve locally:

```bash
# Python
python3 -m http.server 8000

# Node.js (npx)
npx serve .
```

### Browser support

Baseline [Widely available](https://web.dev/baseline) features are used freely; Newly available or limited ones need a fallback or feature detection, so the site still works without them (for example `hidden="until-found"`, which Safari treats as plain `hidden`).

### Accessibility

- Skip link to `#main` first in `<body>` on hand-written pages with a nav before the content.
- The current view is marked with `aria-current="page"` (set in `setTab()`); CSS styles that, not a class.
- Focus rings use `:focus-visible`; never set `outline: none` without a visible replacement.
- Movement (transforms, slides, spins, progress bars) only runs inside `@media (prefers-reduced-motion: no-preference)`; colour fades can stay.
- Collapsed text (TLDRs, fun fact, episode notes, paper details) uses `hidden="until-found"` via `fold()` in `js/app.js`, so find-in-page opens it.

### Text size

Text follows the reader's own text size (browser setting, and on Chrome for Android the phone's text size through `<meta name="text-scale" content="scale">`).

- Font sizes are in `rem` (16 px = 1 rem), never `px`. Never set a font size on `html` or `:root`; body text is `.9375rem` (15 px) on `body`.
- Media query breakpoints are in `em` (960 px = `60em`), so large text gets the narrower layout. `DESKTOP` in `js/app.js` uses the same `60em`.
- Widths that hold text (page column `35rem`, empty-state copy) are in `rem` so the column grows with the text.
- No fixed `height` or `white-space: nowrap` on blocks that hold sentences; use `min-height`. Single-line titles in the podcast strip and player bar still truncate, by design.
- The mobile tab bar labels stop growing at `3.6vw` so five labels still fit; icons carry the meaning.
- Check a change at 200% text: in Playwright, `Page.setFontSizes` through a CDP session (`{ standard: 32, fixed: 26 }`).

### Security

GitHub Pages sends no headers, so each hand-written page (`index.html`, `about.html`, `links.html`, `privacy.html`, `404.html`, `stats.html`) carries its Content-Security-Policy as a `<meta http-equiv>` straight after `<meta charset>`.

- **Never write markup with `innerHTML`.** Build it from templates with data through `esc()`, then `setHTML(el, html)` (`window.ppSetHTML`, from `js/safe-html.js`). The policy requires Trusted Types, so a plain string assigned to `innerHTML` throws in Chrome, Edge, Firefox 148+ and Safari 26+. Use `textContent`, or `el.replaceChildren()` to empty an element.
- `js/safe-html.js` holds the only Trusted Types policy (`pp`). It also strips script tags, `on*` handlers and `javascript:` URLs if a template ever lets them through, and only allows `/sw.js` as a script URL.
- **Inline `<script>` blocks are allowed by hash.** After editing one (theme pre-paint, intro hide, speculation rules, the stats/privacy code), run `python3 tools/csp.py`; `python3 tools/csp.py --check` fails if a page is out of date. A new outside host (script, image, audio, API, iframe) goes in `BASE` in `tools/csp.py`, then rerun it.
- `style-src` allows inline styles (progress bars, chart colours, the stand-alone pages' `<style>`).
- A meta policy can't set `frame-ancestors` or report-only mode; those need headers (Cloudflare in front of Pages), which isn't set up.
- Built pages (`papers/`, `topics/`, `daily/`, `episodes/`) get their policy from greg's `build_static_pages.py`.

### Install (web app manifest)

`site.webmanifest` gives the app a stable `id` (`/`), `scope`, a `start_url`, shortcuts (Today, Papers, PD, Podcast, icons in `shortcuts/`), and screenshots for the install dialog (`screenshots/`, narrow at 780×1688 and wide at 1280×800; the `sizes` must match the files). `icon-maskable-*.png` keep the logo inside the central 80% safe zone; regenerate them from `icon-master-1024.png` if the logo changes. Don't change `id`, or installed copies become a different app. There's no in-page Install button; browsers offer install from their own menu.

### Forms (CPD sheets)

- Required fields use `reqField()` in `js/cpd.js`: a visible `<label for>`, the control with `required` and `data-error`, and an error line below it. `bindChecks(form, touched)` shows the error only after the field is changed and left, or a save is tried (`:user-invalid`, or `.touched:invalid` because the sheets re-render), keeps `aria-invalid` and `aria-describedby` in step, reads a new error out once, and on save focuses the first field to fix. No error shows on load.
- Every field has a visible label (a `<label>` inside the `<legend>` where the group heading names it); no `aria-label` or placeholder-only fields.
- Single-line fields that aren't last use `enterkeyhint="next"`; Enter moves to the next field instead of saving (IME-safe).
- Text boxes grow with their content (`field-sizing: content`, 2 to about 12 lines); form controls are at least 16 px so iPhones don't zoom on focus.

### GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to the branch (`main`) and root (`/`)
4. Your site will be live at `https://<username>.github.io/<repo>/`

## Updating Data

`data/papers.json` is **built**, not hand-edited: `scripts/update-paramedic-dashboard.py`
(see `~/.hermes/paramedic/scripts/`) converts `references/paramedic-paper-log.json`
into it, then commits and pushes. The nightly cron (`daily-dashboard-push.sh`) reruns
this with the LLM-written daily TLDR. There is no build step for the front-end itself.

Since the review's BC4 (Nov 2026) `papers.json` holds only the last 30 days of
scans; older days are in `data/papers-archive.json` (`{"lastUpdated", "dailyUpdates"}`),
which `js/app.js` loads only for search, filters, scrolling past the recent papers, or
a link or saved paper that points at an older one. Without an `archive` block the
app treats `papers.json` as the whole set, as before.

`sw.js` keeps the last copy of the app and its data on the device for offline use
(network first for pages and data, so online readers always get the latest). Two
exceptions: `css/` and `js/` files loaded with `?v=N`, and fonts, are served from the
device cache first, so **a changed file that keeps its old `?v=` stays stale for
readers**; and at most 60 paper/topic/daily/episode pages are kept (least recently
opened dropped first). `static.css`, `fonts.css` and `track.js` stay network first
because greg's built pages reference them with their own `?v=` (bump it in
`build_static_pages.py` via a greg patch).

Loading speed (web guidance phase 4, Nov 2026): long Papers and Podcast lists use
`content-visibility: auto`; `index.html` has speculation rules that prefetch links to
the built pages on hover and prerender them on press (Chromium only); same-origin page
loads cross-fade (`@view-transition` in `style.css` and `static.css`); on first load
`app.js` draws Today, yields, then draws the other tabs. `track.js` counts a
prerendered page only once it is shown.

The JSON schema:

```json
{
  "lastUpdated": "ISO-8601 UTC timestamp",
  "lastUpdatedSydney": "human-readable Sydney time",
  "lastUpdatedDate": "YYYY-MM-DD (Sydney)",
  "featuredPapers": [ ... ],
  "funFacts": [ { "fact": "..." } ],
  "funFact": { "category": "...", "fact": "..." },
  "dailyUpdates": [
    {
      "date": "YYYY-MM-DD",
      "papers": [ ... ]
    }
  ],
  "archive": {
    "url": "data/papers-archive.json",
    "version": "same as lastUpdated",
    "days": 92, "papers": 466, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",
    "topics": { "Cardiac arrest": 142 }
  },
  "tldr": { ... },
  "weeklyTldr": { ... }
}
```

`funFact` is today's server-picked fact (Sydney day-of-year rotation, chosen at
each dashboard push so it changes with the nightly update). The front-end prefers
it and falls back to client-side rotation over `funFacts` for older cached data.

### Paper object

| Field        | Required | Description |
|--------------|----------|-------------|
| `id`         | Yes      | Unique identifier — PMID if available, else DOI, else `synth-<hash>` |
| `title`      | Yes      | Paper title |
| `journal`    | Yes      | Journal name |
| `date`       | Yes      | Publication date (YYYY-MM-DD) |
| `pmid`       | No       | PubMed ID (empty string if absent) |
| `doi`        | No       | DOI (empty string if absent) |
| `summary`    | Yes      | One-sentence summary |
| `relevance`  | Yes      | Relevance indicator with emoji (🟢🟡🔴) |
| `topic`      | No       | Topic tag (e.g. "Trauma") — renders as a chip |
| `studyType`  | No       | Study type (e.g. "RCT") — renders as a chip |

### Daily TLDR (`tldr`)

```json
{
  "date": "YYYY-MM-DD",
  "paperCount": 5,
  "summary": "• Bullet one\n• Bullet two\n• Bullet three",
  "highlights": [
    {
      "id": "paper id (pmid or doi) matching dailyUpdates",
      "pmid": "PMID",
      "doi": "DOI",
      "title": "short title",
      "note": "one-sentence summary of the paper's findings"
    }
  ]
}
```

One highlight per paper found that day (each renders as a dot point under the
headline). `note` summarises findings, not significance commentary.

Each `highlights[].id` **must** match a paper `id` in `dailyUpdates`. That is what makes a TLDR bullet link to its paper card.

### Weekly TLDR (`weeklyTldr`)

```json
{
  "dateRange": "20–27 July 2026",
  "summary": "Lead bullet line\nSecond bullet\nThird bullet",
  "highlights": [
    { "text": "Second bullet (exact match to summary line)", "id": "pmid or doi" },
    { "text": "Third bullet (exact match to summary line)", "id": "pmid or doi" }
  ],
  "topPicks": [
    {
      "id": "pmid or doi",
      "title": "Full paper title",
      "authors": "Author1, Author2, et al.",
      "journal": "Journal",
      "summary": "One sentence summary",
      "relevance": "🟢 High transferability — reason",
      "pmid": "PMID or empty string",
      "doi": "DOI or empty string",
      "featuredReason": "Why this paper was picked"
    }
  ]
}
```

**Critical:** `highlights[].text` must exactly match its corresponding line in `summary` (after stripping bullet markers). The front-end uses this to match bullets to paper ids. `highlights[].id` and `topPicks[].id` must match a paper `id` in `dailyUpdates`.

### Featured papers (`featuredPapers`)

Used as a fallback for the Weekly tab's "Editor's picks" when `weeklyTldr.topPicks` is empty. Same shape as a paper object, plus:

| Field             | Required | Description |
|-------------------|----------|-------------|
| `featuredReason`  | No       | Why this paper is highlighted |

## Static pages (generated — don't hand-edit)

`papers/`, `topics/`, `daily/`, `episodes/` and `sitemap.xml` are written by
the pipeline's `build_static_pages.py` from `data/papers.json` and
`data/episodes.json`. They give every paper, topic, daily scan and episode a
crawlable URL (`/papers/<key>/`, `/topics/<slug>/`, `/daily/YYYY-MM-DD/`,
`/episodes/YYYY-MM-DD/`). Each run rebuilds those folders in full and deletes
anything it no longer produces, so edits there are lost; change the generator
instead.

- Styling: `css/static.css` (standalone; tokens copied from `style.css`) and
  `css/fonts.css`. Bump `STATIC_CSS_V` / `FONTS_CSS_V` in the generator when
  either changes.
- Paper keys: `paperKey()` in `js/app.js` and `paper_key()` in the generator
  must stay identical. Share links use it.
- `404.html` and `about.html` are hand-written and use the same layout.

## Link page (`links.html`, `js/links.js`)

Hand-written bio-link page for Instagram (`paramedicpapers.com/links.html`). It never
loads `papers.json`; static links work with JS off, and `js/links.js` fills two
sections from small files. Plan: `_notes/paramedicpapers/instagram-plan.md` §3a.

- `data/links.json` (written by the publisher):
  `{ "updated": "YYYY-MM-DD", "episode": { "date", "title", "page" },
  "latest": [ { "key", "title", "topic", "finding" } ] }`. `key` is the paper's
  `paperKey()` (PMID, else `doi-<slug>`, else `id-<slug>`), linking to `/papers/<key>/`.
  Only the first 4 `latest` items show.
- `data/instagram.json`: `{ "updated", "posts": [ { "date", "hook", "permalink",
  "cover", "papers"? } ] }`, newest first; the first 12 show as a grid. `cover` is a permanent
  540 px thumbnail URL; if it fails, the `hook` text shows instead. Each tile opens
  the dashboard at `/#post=<date>` (not the Instagram post: visitors have just come
  from there), which pins that post's papers in the feed: `papers` (dashboard paper
  ids) when present, else the papers of that date's entry in `episodes.json`.
- `<!-- LINKS:LATEST:START --><!-- LINKS:LATEST:END -->` in `links.html` is
  for `build_static_pages.py` to fill with the same `.study` links (no-JS latest
  studies); until then a "See today's studies" link shows. The checked-in JSON files
  are samples.
- Instagram's in-app browser (`Instagram`/`FBAN`/`FBAV` in the user agent) gets an
  "Open in your browser to sign in" note above the quiz and CPD links.

## Saved papers (client-side)

The Saved tab persists to `localStorage` under the key `pp:saved`. The value is an **object map** (not an array):

```json
{ "41886731": true, "10.1080/10903127.2026.2673361": true }
```

Keys are paper `id`s. This shape must not be changed to an array — `JSON.stringify` drops string-keyed properties on arrays, which would break persistence.

## CPD tracker (`js/cpd.js`)

Sign-in, the CPD log, goals, exports, **Log PD** on paper cards and the PD
quiz. All personal data goes to the API Worker at
`https://api.paramedicpapers.com` (code in the sibling `cpd/` folder, not in
this public repo); `js/cpd.js` only talks to it with `credentials: 'include'`.
On `localhost` it uses `http://localhost:8787` (`npm run dev` in `cpd/`).

- Views: `#cpd`, `#account` (reached from the mobile **More** tab or the
  sidebar), `#quiz` / `#quiz=<date>` / `#quiz=all` (sub-view of Weekly).
  `#account?login=failed&reason=…` is where a failed sign-in lands.
- `app.js` exposes a small `window.PP` surface and `PP.hooks`; `cpd.js` uses
  nothing else. If `cpd.js` fails to load, the More tab falls back to Saved.
- Home shows a dismissible launch card to signed-out visitors
  (`pp:cpd-promo-closed`). Other `localStorage` keys: `pp:cpd-draft`,
  `pp:cpd-paper:<id>`, `pp:cpd-resume`.
- `privacy.html`: what the tracker stores, backups (30 days), export/delete.
- Data pushed by greg: `learningGoal` on each paper in `papers.json`,
  `data/quiz.json` (latest), `data/quizzes/<date>.json` + `index.json`.
- Until the launch (Oct 2026) the tracker was behind `/#cpd-beta`; that hash
  now redirects to `#cpd`.

## Architecture

- **Vanilla HTML/CSS/JS** — no frameworks, no build step
- Client-side rendering from `papers.json`
- Views: Home, Feed, Weekly (+ PD brief, PD quiz), Podcast, Saved, CPD, Account
- View state in the URL hash (`#home`, `#feed`, `#weekly`, `#podcast`, `#saved`, `#cpd`, …)
- Client-side full-text search across title, journal, and summary
- Save/Remove on every card, persisted to `localStorage`
- TLDR bullets link to their paper card (switches to Feed with the paper pinned)

### Responsive layout

One set of views, two layouts, split at **960px** (`--sidebar-w` and the desktop
layer live at the bottom of `css/style.css`):

| | Below 960px | 960px and up |
|---|---|---|
| Navigation | Bottom tab bar | Persistent left sidebar with count pills and a scan-window summary |
| Masthead | App title + refresh | Sticky content header: view title, kicker, always-visible search + `⌘K` |
| Home | Single column | Reading column plus a sticky TLDR rail |
| Feed | Stacked cards | Card grid, plus **High rel only** / **Saved only** filters |
| TLDR panels | Collapsed by default | Expanded by default |

Both layouts drive the same view state and the same DOM. `syncLayout()` in
`js/app.js` re-parents the search box and the refresh/last-updated pair when the
breakpoint flips, rather than duplicating those nodes and their ids.

### Home layout

Mobile stack order (the `.home-rail` / `.home-main` wrappers are
`display: contents` below 960px, so this is the DOM order):

1. Today's TLDR panel
2. This week's TLDR panel
3. "Today's newest" paper list
4. **Open full feed** button
5. Fun fact panel (dark) — a closer, not the opener

On desktop the same nodes become: left reading column (papers → button → fun
fact, the fact capped at `max-width: 560px`) and right sticky rail (the two
TLDR panels). The fun fact lives in the reading column, below the button.

## Deploying UI changes

The site is live at `https://paramedicpapers.com/` (GitHub Pages, `main`
branch, custom domain via `CNAME`; episode audio is served from Cloudflare R2
at `https://audio.paramedicpapers.com`, not from this repo). The nightly data push only ever commits `data/papers.json` —
**any change to `index.html`, `css/`, or `js/` must be committed and pushed
manually**:

```bash
cd ~/.hermes/paramedic/dashboard
git add index.html css/ js/ && git commit -m "..." && git push
```

Bump the cache-bust query strings whenever a CSS or JS file changes:
`css/style.css?v=N` / `js/app.js?v=N` (and the other `?v=` files) in `index.html`.
The service worker serves `?v=` files from the device cache, so a missed bump means
readers keep the old file. GitHub Pages deploys
within a minute or two of push.

## License

MIT
