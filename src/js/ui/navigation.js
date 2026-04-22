
function initNavigation() {
  document.querySelectorAll('.sidebar-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
    });
  });
}

function navigateTo(pageId) {

  document.querySelectorAll('.sidebar-item[data-page]').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector(`.sidebar-item[data-page="${pageId}"]`);
  if (navItem) navItem.classList.add('active');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  state.currentPage = pageId;

  if (pageId === 'history') loadHistory();
}

function initSidebarToggle() {
  const toggle = document.getElementById('sidebarToggle');

  const icon = toggle?.querySelector('svg');
  if (icon) icon.style.transform = 'rotate(180deg)';

  toggle?.addEventListener('click', () => {
    state.sidebarExpanded = !state.sidebarExpanded;
    const shell = document.getElementById('appShell');
    shell.classList.toggle('sidebar-expanded', state.sidebarExpanded);

    if (state.sidebarExpanded) {
      icon.style.transform = '';
      toggle.querySelector('.sidebar-item-label').textContent = t('nav.collapse');
    } else {
      icon.style.transform = 'rotate(180deg)';
      toggle.querySelector('.sidebar-item-label').textContent = t('nav.expand');
    }
  });
}

function updateStatusBar() {
  const dCount = state.downloads.size;
  const cCount = state.conversions.size;
  const textEl = document.getElementById('activeDownloads');

  if (dCount === 0 && cCount === 0) {
    textEl.textContent = t('status.noActiveTasks');
  } else if (dCount > 0 && cCount === 0) {
    textEl.textContent = t('status.activeDownloads', { count: dCount });
  } else if (dCount === 0 && cCount > 0) {
    textEl.textContent = t('status.activeConversions', { count: cCount });
  } else {
    textEl.textContent = t('status.activeTasks', { dCount, cCount });
  }

  const statusText = document.getElementById('statusText');
  if (statusText) statusText.textContent = (dCount + cCount) > 0 ? '...' : t('status.ready');
}
