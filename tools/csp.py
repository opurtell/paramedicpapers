#!/usr/bin/env python3
"""Keep the Content-Security-Policy <meta> on the hand-written pages in step.

GitHub Pages can't send headers, so each page carries its policy as
<meta http-equiv="Content-Security-Policy"> straight after <meta charset>.
Inline scripts are allowed by SHA-256 hash, so ANY edit to an inline
<script> (theme pre-paint, intro hide, speculation rules, stats/privacy
code) needs the hashes redone:

    python3 tools/csp.py          # rewrite the metas
    python3 tools/csp.py --check  # exit 1 if a page is out of date

JSON-LD blocks (type="application/ld+json") are data, not script, and need
no hash. Built pages (papers/, topics/, daily/, episodes/) get their policy
from greg's build_static_pages.py, not from here.
"""
import base64
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Where the site may load things from. Keep it short: each host is trusted.
BASE = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "https://static.cloudflareinsights.com"],
    # Inline style attributes (progress bars, chart fills) and the <style>
    # blocks on the stand-alone pages.
    "style-src": ["'self'", "'unsafe-inline'"],
    # Instagram covers on the links page and Today strip.
    "img-src": ["'self'", "data:", "https://social.paramedicpapers.com"],
    "font-src": ["'self'"],
    # API (CPD tracker, sign-in state, usage counts), transcripts on the audio
    # host, and the Cloudflare Web Analytics beacon's report.
    "connect-src": ["'self'", "https://api.paramedicpapers.com", "https://audio.paramedicpapers.com",
                    "https://cloudflareinsights.com", "https://static.cloudflareinsights.com"],
    # Episodes play from R2; op3.dev is the feed's download-count prefix.
    "media-src": ["'self'", "https://audio.paramedicpapers.com", "https://op3.dev"],
    # The PD brief sign-up popup.
    "frame-src": ["https://join.paramedicpapers.com"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "require-trusted-types-for": ["'script'"],
    # js/safe-html.js creates the only policy.
    "trusted-types": ["pp"],
}

PAGES = {
    "index.html": {},
    "about.html": {},
    "links.html": {},
    "privacy.html": {},
    "404.html": {},
    # Owner-only stats: also reads the podcast download counts from OP3, and
    # the API on localhost when run locally.
    "stats.html": {"connect-src": ["https://op3.dev", "http://localhost:8787"]},
}

SCRIPT = re.compile(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", re.S)
META = re.compile(r'\n\s*<meta http-equiv="Content-Security-Policy"[^>]*>')
CHARSET = re.compile(r'(<meta charset="[^"]*">)')


def inline_hashes(html):
    out = []
    for m in SCRIPT.finditer(html):
        attrs = m.group("attrs")
        if "src=" in attrs:
            continue
        t = re.search(r'type="([^"]*)"', attrs)
        if t and t.group(1) not in ("text/javascript", "module", "speculationrules"):
            continue  # JSON-LD and other data blocks
        digest = hashlib.sha256(m.group("body").encode("utf-8")).digest()
        out.append("'sha256-%s'" % base64.b64encode(digest).decode())
    return out


def policy(html, extra):
    d = {k: list(v) for k, v in BASE.items()}
    for k, v in extra.items():
        d[k] = d.get(k, []) + v
    d["script-src"] = d["script-src"][:1] + inline_hashes(html) + d["script-src"][1:]
    return "; ".join(k + " " + " ".join(v) for k, v in d.items())


def render(html, extra):
    tag = '\n  <meta http-equiv="Content-Security-Policy" content="%s">' % policy(META.sub("", html), extra)
    stripped = META.sub("", html)
    if not CHARSET.search(stripped):
        raise SystemExit("no <meta charset> to anchor the policy after")
    return CHARSET.sub(lambda m: m.group(1) + tag, stripped, count=1)


def main():
    check = "--check" in sys.argv
    stale = []
    for name, extra in PAGES.items():
        path = ROOT / name
        html = path.read_text(encoding="utf-8")
        new = render(html, extra)
        if new != html:
            stale.append(name)
            if not check:
                path.write_text(new, encoding="utf-8")
    if check and stale:
        print("CSP out of date in: " + ", ".join(stale) + " (run python3 tools/csp.py)")
        sys.exit(1)
    print(("Out of date: " if check else "Updated: ") + (", ".join(stale) or "none"))


if __name__ == "__main__":
    main()
