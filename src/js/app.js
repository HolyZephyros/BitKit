
async function loadViews() {
  const views = ['downloader', 'converter', 'history', 'settings'];
  const mainContent = document.getElementById('mainContent');
  const parser = new DOMParser();

  for (const view of views) {
    try {
      const response = await fetch(`views/${view}.html`);
      if (response.ok) {
        const html = await response.text();
        const doc = parser.parseFromString(html, 'text/html');
        Array.from(doc.head.childNodes).forEach(node => mainContent.appendChild(node));
        Array.from(doc.body.childNodes).forEach(node => mainContent.appendChild(node));
      }
    } catch (e) {
      console.error(`[BitKit] Failed to load view: ${view}`, e);
    }
  }

  try {
    const resQuick = await fetch('views/converter-quick.html');
    if (resQuick.ok) {
      const htmlQuick = await resQuick.text();
      const containerQuick = document.getElementById('tabQuickTemplates');
      if (containerQuick) {
        containerQuick.textContent = '';
        const doc = parser.parseFromString(htmlQuick, 'text/html');
        Array.from(doc.head.childNodes).forEach(node => containerQuick.appendChild(node));
        Array.from(doc.body.childNodes).forEach(node => containerQuick.appendChild(node));
        if (window.applyTranslations) window.applyTranslations();
        if (window.initQuickTemplates) window.initQuickTemplates();
      }
    }
  } catch (e) {
    console.error(`[BitKit] Failed to load partial: converter-quick`, e);
  }
}

document.addEventListener('DOMContentLoaded', async () => {

  await loadViews();

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  initNavigation();
  initWindowControls();
  initSidebarToggle();
  initToggles();
  initSliders();
  initCommandPalette();
  initDownloader();
  initConverter();
  initHistory();
  initSettings();
  initKeyboardShortcuts();

  let savedLang = 'en';
  if (window.bitkit) {
    state.settings = await window.bitkit.settings.get();
    savedLang = state.settings?.language || 'en';
  }

  await initI18n(savedLang);

  if (window.bitkit) {
    applySettings();
    restoreToggleStates();

    const tplInput = document.getElementById('filenameTemplate');
    if (tplInput && state.settings.filenameTemplate) {
      tplInput.value = state.settings.filenameTemplate;
    }

    checkToolVersions();

    state.pendingQueue = await window.bitkit.queue.get();
    renderPendingQueue();

    if (window.BitKitUpdater) {
      window.BitKitUpdater.init();
    }
  }
});
