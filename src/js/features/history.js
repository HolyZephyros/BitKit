
async function loadHistory() {
  if (!window.bitkit) return;

  const history = await window.bitkit.history.get();
  const container = document.getElementById('historyList');

  if (history.length === 0) {
    setSafeHtml(container, `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
        <div class="empty-state-title">${t('history.emptyTitle')}</div>
        <div class="empty-state-text">${t('history.emptyDesc')}</div>
      </div>
    `);
    return;
  }

  setSafeHtml(container, history.map((item) => {
    return `
    <div class="card hover-lift" style="margin-bottom:var(--space-sm);cursor:pointer" data-open-path="${encodeURIComponent(item.outputPath || '')}">
      <div class="flex-between">
        <div style="flex:1; min-width:0; margin-right:16px;">
          <div class="text-md" style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="text-sm font-mono mt-sm" style="display:flex; align-items:center; gap:10px;">
            <span style="color:var(--text-primary); opacity:0.8; font-weight:500;">${formatDate(item.timestamp)}</span>
            ${item.actionLabel ? (() => {
              const translatedLabel = t(item.actionLabel);
              let paramText = item.actionParam;
              if (paramText === 'best' || paramText === 'best-video' || paramText === 'best-audio') paramText = t('history.best');
              const fullText = paramText ? translatedLabel + ' • ' + paramText : translatedLabel;
              
              const isVideo = item.actionLabel && item.actionLabel.toLowerCase().includes('video');
              const badgeColor = isVideo ? 'var(--accent-bordo)' : 'var(--accent-teal)';
              const bgColor = isVideo ? 'rgba(230, 57, 70, 0.15)' : 'rgba(42, 157, 143, 0.15)';
              
              return '<span style="color:' + badgeColor + '; background:' + bgColor + '; font-weight:600; padding:4px 10px; border-radius:6px; max-width:250px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + escapeHtml(fullText) + '">' + escapeHtml(fullText) + '</span>';
            })() : ''}
          </div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; flex-shrink:0;">
          <span class="tag ${item.type === 'download' ? 'tag-teal' : 'tag-bordo'}">${item.type === 'download' ? t('history.type.download') : t('history.type.convert')}</span>
        </div>
      </div>
    </div>
  `}).join(''));

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
