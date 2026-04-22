
async function loadViews() {
  const views = ['downloader', 'converter', 'editor', 'history', 'settings'];
  const mainContent = document.getElementById('mainContent');

  for (const view of views) {
    try {
      const response = await fetch(`views/${view}.html`);
      if (response.ok) {
        const html = await response.text();
        mainContent.insertAdjacentHTML('beforeend', html);
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
        containerQuick.innerHTML = htmlQuick;
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

    let updateToast = null;
    window.bitkit.updater.onAppUpdateProgress((progressObj) => {
      const el = document.getElementById('settingsAppVersion');
      const percent = Math.round(progressObj.percent);
      const transferred = (progressObj.transferred / 1024 / 1024).toFixed(1);
      const total = (progressObj.total / 1024 / 1024).toFixed(1);
      const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(1);

      if (el) {
        el.textContent = t('app.downloadingPercent', {percent});
        el.style.color = 'var(--accent-teal)';
      }

      const container = document.getElementById('toastContainer');
      if (!container) return;

      if (!updateToast) {
        updateToast = document.createElement('div');
        updateToast.className = 'toast toast-info';
        updateToast.id = 'updateProgressToast';
        updateToast.style.display = 'flex';
        updateToast.style.flexDirection = 'column';
        updateToast.style.gap = '6px';
        container.appendChild(updateToast);
      }

      updateToast.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="toast-icon" style="color:var(--accent-teal);">⬇</span>
          <span class="toast-message" style="margin:0;">${t('toast.appDownloadProgress', {percent, transferred, total, speed})}</span>
        </div>
        <div style="width:100%; height:4px; background:var(--bg-elevated); border-radius:var(--radius-full); overflow:hidden;">
          <div style="width:${percent}%; height:100%; background:var(--accent-teal); border-radius:var(--radius-full); transition:width 0.3s ease;"></div>
        </div>
      `;
    });

    window.bitkit.updater.onAppUpdateDownloaded((info) => {
      if (updateToast) {
        updateToast.classList.add('toast-exit');
        setTimeout(() => { updateToast?.remove(); updateToast = null; }, 300);
      }
      const el = document.getElementById('settingsAppVersion');
      const latestVer = info?.version || t('settings.newVersionBackup');
      if (el) {
        el.textContent = t('app.updateReady', {ver: latestVer});
        el.style.color = 'var(--success)';
        el.style.cursor = 'pointer';
        el.style.textDecoration = 'underline';
        el.onclick = () => window.bitkit.updater.installApp();
      }

      const container = document.getElementById('toastContainer');
      if (container) {
        const installToast = document.createElement('div');
        installToast.className = 'toast toast-success';
        installToast.style.cursor = 'pointer';
        installToast.style.display = 'flex';
        installToast.style.alignItems = 'center';
        installToast.style.gap = '10px';
        installToast.innerHTML = `
          <span class="toast-icon" style="color:var(--success); font-size:1.2rem;">✓</span>
          <span class="toast-message" style="margin:0;">${t('toast.clickToInstall', {version: latestVer})}</span>
        `;
        installToast.onclick = () => {
          installToast.innerHTML = `
            <span class="toast-icon" style="color:var(--accent-teal);">⟳</span>
            <span class="toast-message" style="margin:0;">${t('toast.installingRestart')}</span>
          `;
          installToast.style.cursor = 'default';
          setTimeout(() => window.bitkit.updater.installApp(), 500);
        };
        container.appendChild(installToast);
      }

      const btn = document.getElementById('btnUpdateAllText');
      if (btn) btn.textContent = t('app.clickToInstall');
    });

    window.bitkit.updater.onAppUpdateError((errorMsg) => {
      console.error('[BitKit] Update error:', errorMsg);
      showToast(t('toast.updateError', {error: errorMsg}), 'error', 8000);
    });
    
    setTimeout(async () => {
      try {
        const appCheck = await window.bitkit.updater.checkApp();
        if (appCheck && appCheck.updateAvailable) {
          const container = document.getElementById('toastContainer');
          if (!container) return;

          if (appCheck.alreadyDownloaded) {
            const installToast = document.createElement('div');
            installToast.className = 'toast toast-success';
            installToast.style.cursor = 'pointer';
            installToast.style.display = 'flex';
            installToast.style.alignItems = 'center';
            installToast.style.gap = '10px';
            installToast.innerHTML = `
              <span class="toast-icon" style="color:var(--success); font-size:1.2rem;">✓</span>
              <span class="toast-message" style="margin:0;">${t('toast.clickToInstall', {version: appCheck.latest})}</span>
            `;
            installToast.onclick = () => {
              installToast.innerHTML = `
                <span class="toast-icon" style="color:var(--accent-teal);">⟳</span>
                <span class="toast-message" style="margin:0;">${t('toast.installingRestart')}</span>
              `;
              installToast.style.cursor = 'default';
              setTimeout(() => window.bitkit.updater.installApp(), 500);
            };
            container.appendChild(installToast);
            return;
          }
          
          const toast = document.createElement('div');
          toast.className = 'toast toast-info';
          toast.style.display = 'flex';
          toast.style.flexDirection = 'column';
          toast.style.gap = '10px';
          
          toast.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="toast-icon" style="color:var(--accent-teal); font-weight:bold;">ℹ</span>
              <span class="toast-message" style="margin:0;">${t('toast.appUpdateFound', {latest: appCheck.latest})}</span>
            </div>
            <div style="display:flex; gap:8px; justify-content:flex-end;">
              <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.85rem; color:var(--error);" id="btnToastCancel">${t('toast.cancelShutdown')}</button>
              <button class="btn" style="padding:4px 12px; font-size:0.85rem; background:var(--success); color:white; border:none;" id="btnToastUpdate">${t('settings.update')}</button>
            </div>
          `;
          
          container.appendChild(toast);
          
          toast.querySelector('#btnToastCancel').onclick = () => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
          };
          
          toast.querySelector('#btnToastUpdate').onclick = async () => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
            
            showToast(t('settings.checking') + '...', 'info', 5000);
            await window.bitkit.updater.downloadApp();
          };
        }
      } catch(e) {
        console.error('[BitKit] Auto-update check failed', e);
      }
    }, 2000);
  }
});
