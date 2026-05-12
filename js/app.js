/* ============================================
   Paramedic Research Dashboard — App Logic
   ============================================ */

(function () {
  'use strict';

  // --- State ---
  let data = null;
  let searchTerm = '';

  // --- DOM refs ---
  const $lastUpdated   = document.getElementById('last-updated');
  const $featuredGrid  = document.getElementById('featured-grid');
  const $featuredSec   = document.getElementById('featured-section');
  const $feed          = document.getElementById('daily-feed-content');
  const $noResults     = document.getElementById('no-results');
  const $searchInput   = document.getElementById('search-input');
  const $searchClear   = document.getElementById('search-clear');
  const $searchHint    = document.getElementById('search-hint');
  const $btnTldr       = document.getElementById('btn-tldr');
  const $tldrModal     = document.getElementById('tldr-modal');
  const $tldrClose     = document.getElementById('tldr-close');
  const $tldrBody      = document.getElementById('tldr-body');
  const $tldrDate      = document.getElementById('tldr-date');

  // --- Init ---
  document.addEventListener('DOMContentLoaded', init);

  const $btnRefresh = document.getElementById('btn-refresh');

  async function loadData(cacheBust) {
    const url = cacheBust
      ? 'data/papers.json?t=' + Date.now()
      : 'data/papers.json';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to load papers.json');
    return resp.json();
  }

  async function init() {
    try {
      data = await loadData(false);
    } catch (err) {
      $feed.innerHTML = '<p class="no-results">Unable to load research data. Please try again later.</p>';
      console.error(err);
      return;
    }

    renderLastUpdated();
    render();
    bindSearch();
    bindTldr();
    bindRefresh();
  }

  // --- Render ---
  function renderLastUpdated() {
    if (!data.lastUpdated) return;
    const d = new Date(data.lastUpdated);
    $lastUpdated.textContent = 'Updated ' + formatDateShort(d);
  }

  function render() {
    const term = searchTerm.toLowerCase().trim();

    // Featured
    if (data.featuredPapers && data.featuredPapers.length) {
      const filtered = term
        ? data.featuredPapers.filter(p => matchesPaper(p, term))
        : data.featuredPapers;

      if (filtered.length) {
        $featuredGrid.innerHTML = filtered.map(p => featuredCardHTML(p)).join('');
        $featuredSec.classList.remove('hidden');
      } else {
        $featuredSec.classList.add('hidden');
      }
    } else {
      $featuredSec.classList.add('hidden');
    }

    // Daily feed
    let totalVisible = 0;
    let html = '';

    for (const day of data.dailyUpdates) {
      const papers = term
        ? day.papers.filter(p => matchesPaper(p, term))
        : day.papers;

      if (!papers.length) continue;
      totalVisible += papers.length;

      const dateObj = new Date(day.date + 'T00:00:00');
      const dateLabel = formatDateLong(dateObj);
      const collapsed = term ? '' : ''; // expand all when searching

      html += `
        <div class="day-group${collapsed}" data-date="${day.date}">
          <div class="day-header" onclick="toggleDay(this)">
            <div class="day-header-left">
              <span class="day-date">${dateLabel}</span>
              <span class="day-count">${papers.length} paper${papers.length !== 1 ? 's' : ''}</span>
            </div>
            <svg class="day-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div class="day-papers">
            ${papers.map(p => paperCardHTML(p)).join('')}
          </div>
        </div>`;
    }

    $feed.innerHTML = html;

    // Auto-expand all day groups when searching
    if (term) {
      document.querySelectorAll('.day-group').forEach(g => g.classList.remove('collapsed'));
    }

    // No results
    const featuredCount = term
      ? data.featuredPapers.filter(p => matchesPaper(p, term)).length
      : data.featuredPapers.length;
    $noResults.style.display = (totalVisible + featuredCount === 0) ? 'block' : 'none';

    // Search hint
    if (term) {
      const total = totalVisible + (term ? data.featuredPapers.filter(p => matchesPaper(p, term)).length : data.featuredPapers.length);
      $searchHint.textContent = `${total} paper${total !== 1 ? 's' : ''} found`;
    } else {
      const totalPapers = data.dailyUpdates.reduce((sum, d) => sum + d.papers.length, 0);
      $searchHint.textContent = `${totalPapers} papers from ${data.dailyUpdates.length} scan${data.dailyUpdates.length !== 1 ? 's' : ''}`;
    }
  }

  // --- HTML builders ---
  function featuredCardHTML(p) {
    const titleLink = paperTitleHref(p);
    return `
      <div class="featured-card">
        ${p.featuredReason ? `<div class="featured-reason">${esc(p.featuredReason)}</div>` : ''}
        <div class="paper-title"><a href="${titleLink}" target="_blank" rel="noopener">${esc(p.title)}</a></div>
        <div class="paper-meta">${esc(p.journal)}${p.date ? ' · ' + formatDateShort(new Date(p.date + 'T00:00:00')) : ''}</div>
        <div class="paper-summary">${esc(p.summary)}</div>
        <div class="paper-footer">
          ${relevanceBadge(p.relevance)}
          ${paperLinksHTML(p)}
        </div>
      </div>`;
  }

  function paperCardHTML(p) {
    const titleLink = paperTitleHref(p);
    return `
      <div class="paper-card" id="paper-${cssId(p.id)}">
        <div class="paper-title"><a href="${titleLink}" target="_blank" rel="noopener">${esc(p.title)}</a></div>
        <div class="paper-meta">${esc(p.journal)}${p.date ? ' · ' + formatDateShort(new Date(p.date + 'T00:00:00')) : ''}</div>
        <div class="paper-summary">${esc(p.summary)}</div>
        <div class="paper-footer">
          ${relevanceBadge(p.relevance)}
          ${paperLinksHTML(p)}
        </div>
      </div>`;
  }

  function paperTitleHref(p) {
    if (p.pmid) return 'https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(p.pmid) + '/';
    if (p.doi) return 'https://doi.org/' + encodeURIComponent(p.doi);
    return '#';
  }

  function relevanceBadge(text) {
    if (!text) return '';
    let cls = 'relevance-medium';
    if (text.includes('🟢') || text.toLowerCase().includes('high')) cls = 'relevance-high';
    else if (text.includes('🔴') || text.toLowerCase().includes('indirect') || text.toLowerCase().includes('low')) cls = 'relevance-low';
    else if (text.includes('🟡') || text.toLowerCase().includes('medium')) cls = 'relevance-medium';
    return `<span class="relevance-badge ${cls}">${esc(text)}</span>`;
  }

  function paperLinksHTML(p) {
    let links = '';
    if (p.pmid) {
      links += `<a class="paper-link" href="https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p.pmid)}/" target="_blank" rel="noopener">PubMed</a>`;
    }
    if (p.doi) {
      links += `<a class="paper-link" href="https://doi.org/${encodeURIComponent(p.doi)}" target="_blank" rel="noopener">DOI</a>`;
    }
    return links ? `<div class="paper-links">${links}</div>` : '';
  }

  // --- Search ---
  function bindSearch() {
    $searchInput.addEventListener('input', () => {
      searchTerm = $searchInput.value;
      $searchClear.style.display = searchTerm ? 'flex' : 'none';
      render();
    });

    $searchClear.addEventListener('click', () => {
      $searchInput.value = '';
      searchTerm = '';
      $searchClear.style.display = 'none';
      render();
      $searchInput.focus();
    });
  }

  // --- Refresh ---
  function bindRefresh() {
    $btnRefresh.addEventListener('click', async () => {
      $btnRefresh.disabled = true;
      $btnRefresh.classList.add('spinning');
      try {
        data = await loadData(true);
        renderLastUpdated();
        render();
      } catch (err) {
        console.error('Refresh failed:', err);
      } finally {
        $btnRefresh.disabled = false;
        $btnRefresh.classList.remove('spinning');
      }
    });
  }

  function matchesPaper(p, term) {
    return (p.title || '').toLowerCase().includes(term)
      || (p.journal || '').toLowerCase().includes(term)
      || (p.summary || '').toLowerCase().includes(term)
      || (p.relevance || '').toLowerCase().includes(term);
  }

  // --- TLDR Modal ---
  function bindTldr() {
    $btnTldr.addEventListener('click', () => {
      renderTldr();
      $tldrModal.classList.remove('hidden');
    });

    $tldrClose.addEventListener('click', () => {
      $tldrModal.classList.add('hidden');
    });

    $tldrModal.addEventListener('click', (e) => {
      if (e.target === $tldrModal) $tldrModal.classList.add('hidden');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $tldrModal.classList.add('hidden');
    });
  }

  function renderTldr() {
    const tldr = data.tldr;
    if (tldr && tldr.summary) {
      $tldrDate.textContent = 'Based on ' + tldr.paperCount + ' papers · ' + tldr.date;
      // Render summary bullets
      const lines = tldr.summary.split('\n').filter(s => s.trim());
      $tldrBody.innerHTML = '<ul class="tldr-bullets">' + lines.map(l => {
        const cleaned = l.replace(/^[•\-]\s*/, '');
        return '<li>' + esc(cleaned) + '</li>';
      }).join('') + '</ul>';

      // Render individual paper highlights if present
      if (tldr.highlights && tldr.highlights.length) {
        $tldrBody.innerHTML += tldr.highlights.map(h => {
          const pid = cssId(h.id || '');
          const extUrl = h.pmid
            ? 'https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(h.pmid) + '/'
            : h.doi ? 'https://doi.org/' + encodeURIComponent(h.doi) : '#';
          return '<div class="tldr-item" data-paper-id="' + pid + '" data-ext-url="' + esc(extUrl) + '">' +
            '<div class="tldr-title tldr-link" data-paper-id="' + pid + '" data-ext-url="' + esc(extUrl) + '">' + esc(h.title) + '</div>' +
            '<div class="tldr-note">' + esc(h.note) + '</div>' +
          '</div>';
        }).join('');

        // Bind clicks on tldr titles
        $tldrBody.querySelectorAll('.tldr-link').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            showTldrPopover(el);
          });
        });
      }
    } else {
      $tldrBody.innerHTML = '<p class="tldr-empty">TLDR not yet available for today. Check back after the next daily scan.</p>';
      $tldrDate.textContent = '';
    }
  }

  // --- TLDR Popover ---
  let activePopover = null;

  function showTldrPopover(el) {
    closeTldrPopover();
    const paperId = el.getAttribute('data-paper-id');
    const extUrl = el.getAttribute('data-ext-url');

    const popover = document.createElement('div');
    popover.className = 'tldr-popover';
    popover.innerHTML =
      '<button class="tldr-popover-btn" data-action="jump">↓ Jump to paper</button>' +
      '<button class="tldr-popover-btn" data-action="visit">↗ View article</button>';

    el.style.position = 'relative';
    el.appendChild(popover);
    activePopover = popover;

    popover.querySelector('[data-action="jump"]').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTldrPopover();
      $tldrModal.classList.add('hidden');
      // Expand the day group if collapsed, then scroll
      setTimeout(() => {
        const card = document.getElementById('paper-' + paperId);
        if (card) {
          const group = card.closest('.day-group');
          if (group && group.classList.contains('collapsed')) group.classList.remove('collapsed');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('paper-highlight');
          setTimeout(() => card.classList.remove('paper-highlight'), 2000);
        }
      }, 150);
    });

    popover.querySelector('[data-action="visit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTldrPopover();
      if (extUrl && extUrl !== '#') window.open(extUrl, '_blank', 'noopener');
    });
  }

  function closeTldrPopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
  }

  // Close popover on outside click
  document.addEventListener('click', (e) => {
    if (activePopover && !e.target.closest('.tldr-popover') && !e.target.closest('.tldr-link')) {
      closeTldrPopover();
    }
  });

  // --- Toggle day groups ---
  window.toggleDay = function (headerEl) {
    const group = headerEl.parentElement;
    group.classList.toggle('collapsed');
  };

  // --- Date formatting ---
  function formatDateLong(d) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function formatDateShort(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // --- Escape HTML ---
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // --- CSS-safe ID ---
  function cssId(id) {
    return (id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }
})();
