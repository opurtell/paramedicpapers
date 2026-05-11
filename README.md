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
  "dailyUpdates": [
    {
      "date": "YYYY-MM-DD",
      "papers": [ ... ]
    }
  ]
}
```

Each paper object:

| Field       | Required | Description |
|-------------|----------|-------------|
| `id`        | Yes      | Unique identifier |
| `title`     | Yes      | Paper title |
| `journal`   | Yes      | Journal name |
| `date`      | Yes      | Publication date (YYYY-MM-DD) |
| `pmid`      | No       | PubMed ID (empty string if absent) |
| `doi`       | No       | DOI (empty string if absent) |
| `summary`   | Yes      | One-sentence summary |
| `relevance` | Yes      | Relevance indicator with emoji |
| `featuredReason` | Featured only | Why this paper is highlighted |

## Architecture

- **Vanilla HTML/CSS/JS** — no frameworks, no build step
- Client-side rendering from `papers.json`
- Mobile-first responsive design
- Collapsible day sections
- Client-side full-text search across title, journal, and summary
- Print-friendly styles

## License

MIT
