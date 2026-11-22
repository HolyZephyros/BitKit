// ===== BitKit Discord-Style 1-Click Auto-Updater UI =====

(function initBitKitUpdaterModule() {
  let activeUpdateVersion = '';
  let updateInProgress = false;
  let overlayEl = null;

  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.id = 'bitkitUpdateOverlay';
    overlayEl.className = 'bitkit-update-overlay';
    overlayEl.innerHTML = `
      <div class="bitkit-update-card" role="dialog" aria-modal="true">
        <img class="bitkit-update-logo" src="assets/icons/icon.png" alt="BitKit" draggable="false" />
        <h3 class="bitkit-update-title" id="bitkitUpdateTitle"></h3>
        <p class="bitkit-update-subtitle" id="bitkitUpdateSubtitle"></p>
        <div class="bitkit-update-bar-track">
          <div class="bitkit-update-bar-fill" id="bitkitUpdateBarFill"></div>
        </div>
        <div class="bitkit-update-meta" id="bitkitUpdateMeta"></div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function hideOverlay() {
    updateInProgress = false;
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function showDownloadingOverlay(version) {
    const ov = ensureOverlay();
    const title = ov.querySelector('#bitkitUpdateTitle');
    const sub = ov.querySelector('#bitkitUpdateSubtitle');
    const fill = ov.querySelector('#bitkitUpdateBarFill');
    const meta = ov.querySelector('#bitkitUpdateMeta');

    if (title) title.textContent = t('updater.modalTitle', { version: version || '' });
    if (sub) sub.textContent = t('updater.downloadingSubtitle');
    if (fill) {
      fill.classList.add('indeterminate');
      fill.style.width = '35%';
    }
    if (meta) meta.textContent = '';
  }

  function updateDownloadProgress(progressObj) {
    const percent = Math.max(0, Math.min(100, Math.round(progressObj.percent || 0)));
    const transferred = ((progressObj.transferred || 0) / 1024 / 1024).toFixed(1);
    const total = ((progressObj.total || 0) / 1024 / 1024).toFixed(1);
    const speed = ((progressObj.bytesPerSecond || 0) / 1024 / 1024).toFixed(1);

    const el = document.getElementById('settingsAppVersion');
    if (el) {
      el.textContent = t('app.downloadingPercent', { percent });
      el.style.color = 'var(--accent-teal)';
    }

    const ov = ensureOverlay();
    const fill = ov.querySelector('#bitkitUpdateBarFill');
    const meta = ov.querySelector('#bitkitUpdateMeta');
    if (fill) {
      fill.classList.remove('indeterminate');
      fill.style.width = `${percent}%`;
    }
    if (meta) {
      meta.textContent = t('toast.appDownloadProgress', { percent, transferred, total, speed });
    }
  }

  function triggerSeamlessInstall(version) {
    const ver = version || activeUpdateVersion || '';
    const ov = ensureOverlay();
    const title = ov.querySelector('#bitkitUpdateTitle');
    const sub = ov.querySelector('#bitkitUpdateSubtitle');
    const fill = ov.querySelector('#bitkitUpdateBarFill');
    const meta = ov.querySelector('#bitkitUpdateMeta');

    const installingTitle = t('updater.installingTitle', { version: ver });
    const installingSubtitle = t('updater.installingSubtitle');
    const restartingSubtitle = t('updater.restartingSubtitle');

    if (title) title.textContent = installingTitle;
    if (sub) sub.textContent = installingSubtitle;
    if (fill) {
      fill.classList.add('indeterminate');
      fill.style.width = '100%';
    }
    if (meta) meta.textContent = '';

    const el = document.getElementById('settingsAppVersion');
    if (el) {
      el.textContent = t('toast.installingRestart');
      el.style.color = 'var(--success)';
    }

    setTimeout(() => {
      window.bitkit.updater.installApp({
        version: ver,
        title: installingTitle,
        subtitle: installingSubtitle,
        restarting: restartingSubtitle
      });
    }, 350);
  }

  async function startUpdate(appCheck) {
    if (updateInProgress || !window.bitkit?.updater) return;
    updateInProgress = true;

    const existingPrompt = document.getElementById('bitkitUpdateAvailableToast');
    if (existingPrompt) {
      existingPrompt.classList.add('toast-exit');
      setTimeout(() => existingPrompt.remove(), 250);
    }

    activeUpdateVersion = appCheck?.latest || '';

    if (appCheck?.alreadyDownloaded) {
      triggerSeamlessInstall(activeUpdateVersion);
      return;
    }

    showDownloadingOverlay(activeUpdateVersion);
    try {
      const res = await window.bitkit.updater.downloadApp();
      if (res && res.success === false) {
        hideOverlay();
      }
    } catch (err) {
      hideOverlay();
      console.error('[BitKit] Update download failed:', err);
    }
  }

  function showUpdateAvailableToast(appCheck) {
    if (!appCheck?.updateAvailable || updateInProgress) return;
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Avoid duplicate update prompt toasts
    if (document.getElementById('bitkitUpdateAvailableToast')) return;

    activeUpdateVersion = appCheck.latest || '';

    const toast = document.createElement('div');
    toast.id = 'bitkitUpdateAvailableToast';
    toast.className = 'toast toast-info';
    toast.style.display = 'flex';
    toast.style.flexDirection = 'column';
    toast.style.gap = '10px';

    toast.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="toast-icon" style="color:var(--accent-teal); font-weight:bold;">ℹ</span>
        <span class="toast-message" style="margin:0;">${t('toast.appUpdateFound', { latest: appCheck.latest })}</span>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.85rem; color:var(--text-secondary);" id="btnToastUpdateLater">${t('updater.later')}</button>
        <button class="btn" style="padding:4px 12px; font-size:0.85rem; background:var(--success); color:white; border:none;" id="btnToastUpdateNow">${t('settings.update')}</button>
      </div>
    `;

    container.appendChild(toast);

    toast.querySelector('#btnToastUpdateLater').onclick = () => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 250);
    };

    toast.querySelector('#btnToastUpdateNow').onclick = () => {
      startUpdate(appCheck);
    };
  }

  function init() {
    if (!window.bitkit?.updater) return;

    window.bitkit.updater.onAppUpdateProgress((progressObj) => {
      updateDownloadProgress(progressObj);
    });

    // Discord / Steam style: automatically install & restart as soon as download finishes
    window.bitkit.updater.onAppUpdateDownloaded((info) => {
      const latestVer = info?.version || activeUpdateVersion || '';
      triggerSeamlessInstall(latestVer);
    });

    window.bitkit.updater.onAppUpdateError((errorMsg) => {
      console.error('[BitKit] Update error:', errorMsg);
      hideOverlay();
      let displayMsg = errorMsg;
      if (errorMsg === 'DEV_MODE_ERROR') displayMsg = t('updater.devModeError');
      showToast(t('toast.updateError', { error: displayMsg }), 'error', 8000);
    });

    setTimeout(async () => {
      try {
        const appCheck = await window.bitkit.updater.checkApp();
        if (appCheck && appCheck.updateAvailable) {
          showUpdateAvailableToast(appCheck);
        }
      } catch (e) {
        console.error('[BitKit] Auto-update check failed', e);
      }
    }, 2000);
  }

  window.BitKitUpdater = {
    init,
    startUpdate,
    showUpdateAvailableToast
  };
})();
