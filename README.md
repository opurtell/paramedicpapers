# Paramedic Research Updates

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

### GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to the branch (`main`) and root (`/`)
4. Your site will be live at `https://<username>.github.io/<repo>/`

## Updating Data

Replace `data/papers.json` with fresh data. The site loads this file client-side — no build step needed.

The JSON schema:

```json
{
  "lastUpdated": "ISO-8601 timestamp",
  "featuredPapers": [ ... ],
  "funFacts": [ { "fact": "..." } ],
  "dailyUpdates": [
    {
      "date": "YYYY-MM-DD",
      "papers": [ ... ]
    }
  ],
  "tldr": { ... },
  "weeklyTldr": { ... }
}
```

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
      "note": "why it matters"
    }
  ]
}
```

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

## Saved papers (client-side)

The Saved tab persists to `localStorage` under the key `pp:saved`. The value is an **object map** (not an array):

```json
{ "41886731": true, "10.1080/10903127.2026.2673361": true }
```

Keys are paper `id`s. This shape must not be changed to an array — `JSON.stringify` drops string-keyed properties on arrays, which would break persistence.

## Architecture

- **Vanilla HTML/CSS/JS** — no frameworks, no build step
- Client-side rendering from `papers.json`
- Four views: Home, Feed, Weekly, Saved
- View state in the URL hash (`#home`, `#feed`, `#weekly`, `#saved`)
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

## License

MIT
