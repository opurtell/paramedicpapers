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

  // --- Init ---
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const resp = await fetch('data/papers.json');
      if (!resp.ok) throw new Error('Failed to load papers.json');
      data = await resp.json();
    } catch (err) {
      $feed.innerHTML = '<p class="no-results">Unable to load research data. Please try again later.</p>';
      console.error(err);
      return;
    }

    renderLastUpdated();
    render();
    bindSearch();
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
      <div class="paper-card">
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

  function matchesPaper(p, term) {
    return (p.title || '').toLowerCase().includes(term)
      || (p.journal || '').toLowerCase().includes(term)
      || (p.summary || '').toLowerCase().includes(term)
      || (p.relevance || '').toLowerCase().includes(term);
  }

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
})();
