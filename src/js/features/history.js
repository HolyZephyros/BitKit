
async function loadHistory() {
  if (!window.bitkit) return;

  const history = await window.bitkit.history.get();
  const container = document.getElementById('historyList');

  if (history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
        <div class="empty-state-title">${t('history.emptyTitle')}</div>
        <div class="empty-state-text">${t('history.emptyDesc')}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = history.map((item) => {
    return `
    <div class="card hover-lift" style="margin-bottom:var(--space-sm);cursor:pointer" data-open-path="${encodeURIComponent(item.outputPath || '')}">
      <div class="flex-between">
        <div>
          <div class="text-md" style="font-weight:500">${escapeHtml(truncate(item.title, 60))}</div>
          <div class="text-xs text-muted font-mono mt-sm">${formatDate(item.timestamp)}</div>
        </div>
        <span class="tag ${item.type === 'download' ? 'tag-teal' : 'tag-bordo'}">${item.type === 'download' ? t('nav.downloader') : t('nav.converter')}</span>
      </div>
    </div>
  `}).join('');

  container.querySelectorAll('[data-open-path]').forEach(el => {
    el.addEventListener('click', () => {
      const rawPath = decodeURIComponent(el.getAttribute('data-open-path'));
      if (rawPath) {
        if (window.bitkit?.shell?.showInFolder) {
          window.bitkit.shell.showInFolder(rawPath);
        } else if (window.bitkit?.shell?.openPath) {
          window.bitkit.shell.openPath(rawPath);
        }
      }
    });
  });
}

function initHistory() {
  document.getElementById('btnClearHistory')?.addEventListener('click', async () => {
    if (window.bitkit) {
      await window.bitkit.history.clear();
      loadHistory();
      showToast(t('toast.historyCleared'), 'info');
    }
  });
}
