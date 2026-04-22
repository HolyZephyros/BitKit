
function initSettings() {
  document.getElementById('btnSettingsFolder')?.addEventListener('click', async () => {
    if (!window.bitkit) return;
    const result = await window.bitkit.file.selectFolder();
    if (!result.canceled) {
      state.settings.downloadPath = result.path;
      document.getElementById('settingsDownloadPath').value = result.path;

      const outEl = document.getElementById('outputPath');
      if (outEl) outEl.value = result.path;
      await window.bitkit.settings.set(state.settings);
      showToast(t('toast.folderUpdated'), 'success');
    }
  });

  document.getElementById('btnSettingsConvertFolder')?.addEventListener('click', async () => {
    if (!window.bitkit) return;
    const result = await window.bitkit.file.selectFolder();
    if (!result.canceled) {
      state.settings.convertPath = result.path;
      document.getElementById('settingsConvertPath').value = result.path;
      await window.bitkit.settings.set(state.settings);
      showToast(t('toast.folderUpdated'), 'success');
    }
  });

  document.getElementById('btnSettingsCookies')?.addEventListener('click', async () => {
    if (!window.bitkit) return;
    const result = await window.bitkit.file.selectFile({
      type: 'cookies',
      filters: [{ name: t('dialog.cookies'), extensions: ['txt'] }, { name: t('dialog.allFiles'), extensions: ['*'] }]
    });
    if (!result.canceled) {
      state.settings.cookiesPath = result.path;
      document.getElementById('settingsCookiesPath').value = result.path;

      const dlCookies = document.getElementById('cookiesPath');
      if (dlCookies) dlCookies.value = result.path;
      await window.bitkit.settings.set(state.settings);
      showToast(t('toast.cookiesSet'), 'success');

      if (result.hasYoutube === false) {
        showToast(t('toast.cookiesNoYoutube'), 'warning', 10000);
      }
    }
  });

  document.getElementById('btnClearCookies')?.addEventListener('click', async () => {
    state.settings.cookiesPath = '';
    document.getElementById('settingsCookiesPath').value = '';

    const dlCookies = document.getElementById('cookiesPath');
    if (dlCookies) dlCookies.value = '';
    
    if (window.bitkit) {
      await window.bitkit.settings.set(state.settings);
      await window.bitkit.file.deleteCookies();
    }
    showToast(t('toast.cookiesCleared'), 'info');
  });

  document.getElementById('btnUpdateAll')?.addEventListener('click', async () => {
    if (!window.bitkit) return;
    const btn = document.getElementById('btnUpdateAll');
    const textLabel = document.getElementById('btnUpdateAllText');
    if (!btn || !textLabel) return;

    btn.disabled = true;
    const originalText = textLabel.textContent;

    try {

      textLabel.textContent = t('settings.checkingBitKit');
      const appCheck = await window.bitkit.updater.checkApp();

      if (appCheck && appCheck.updateAvailable) {
        document.getElementById('settingsAppVersion').textContent = t('settings.newVersion', {current: appCheck.current, latest: appCheck.latest});
        document.getElementById('settingsAppVersion').style.color = 'var(--warning)';

        const container = document.getElementById('toastContainer');
        if (container) {
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
              <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.85rem; color:var(--error);" id="btnSettingsUpdateCancel">${t('toast.cancelShutdown')}</button>
              <button class="btn" style="padding:4px 12px; font-size:0.85rem; background:var(--success); color:white; border:none;" id="btnSettingsUpdateConfirm">${t('settings.update')}</button>
            </div>
          `;

          container.appendChild(toast);

          toast.querySelector('#btnSettingsUpdateCancel').onclick = () => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
          };

          toast.querySelector('#btnSettingsUpdateConfirm').onclick = async () => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
            showToast(t('settings.downloadingBitKit', {latest: appCheck.latest}), 'info', 15000);
            await window.bitkit.updater.downloadApp();
          };
        }
      } else if (appCheck && appCheck.error) {
        showToast(t('toast.updateError', {error: appCheck.error}), 'warning', 5000);
      }

      textLabel.textContent = t('settings.checkingYtdlp');
      const ytdlpCheck = await window.bitkit.updater.checkYtdlp();
      if (ytdlpCheck.updateAvailable || !ytdlpCheck.current) {
        textLabel.textContent = t('settings.updatingYtdlp');
        await window.bitkit.updater.updateYtdlp();
      }

      textLabel.textContent = t('settings.checkingFfmpeg');
      const ffmpegCheck = await window.bitkit.updater.checkFfmpeg();

      if (!ffmpegCheck.current) {
         textLabel.textContent = t('settings.downloadingFfmpeg');
         await window.bitkit.updater.updateFfmpeg();
      }

      textLabel.textContent = t('settings.systemUpToDate');
      showToast(t('toast.systemReady'), 'success');

      await checkToolVersions();
    } catch (e) {
      window.showErrorToast(e, 'Updater');
      textLabel.textContent = t('app.errorOccurred');
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        textLabel.textContent = t('settings.checkUpdates');
      }, 3000);
    }
  });

  document.getElementById('settingsLanguage')?.addEventListener('change', async (e) => {
    const lang = e.target.value;
    state.settings.language = lang;
    if (window.bitkit) await window.bitkit.settings.set(state.settings);
    await setLocale(lang);
  });

  document.getElementById('settingsConcurrentDownloads')?.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value) || 1;
    state.settings.maxConcurrentDownloads = val;
    if (window.bitkit) await window.bitkit.settings.set(state.settings);
    
    if (val > 1) {
      showToast(t('settings.concurrentWarning') || 'Uyarı: Eşzamanlı 1\'den fazla video indirmek YouTube vb. platformlarda IP engellemesine (HTTP 429) yol açabilir.', 'warning', 6000);
    }
  });
}

function applySettings() {
  const s = state.settings || {};
  document.getElementById('settingsDownloadPath').value = s.downloadPath || '';
  document.getElementById('settingsConvertPath').value = s.convertPath || '';
  document.getElementById('settingsCookiesPath').value = s.cookiesPath || '';
  const outputPathEl = document.getElementById('outputPath');
  if (outputPathEl) {
    outputPathEl.value = s.downloadPath || '';
  }
  if (s.cookiesPath) {
    document.getElementById('cookiesPath').value = s.cookiesPath;
  }

  if (s.language) {
    const langSelect = document.getElementById('settingsLanguage');
    if (langSelect) {
      langSelect.value = s.language;
    }
  }

  const concurrentSelect = document.getElementById('settingsConcurrentDownloads');
  if (concurrentSelect) {
    concurrentSelect.value = s.maxConcurrentDownloads || 1;
  }
}

async function checkToolVersions() {
  if (!window.bitkit) return;

  try {
    const versions = await window.bitkit.updater.getVersions();
    const appVersion = await window.bitkit.system.getVersion();

    const appVersionStr = 'v' + appVersion;
    document.getElementById('settingsAppVersion').textContent = appVersionStr;
    document.getElementById('settingsAppVersion').removeAttribute('data-i18n');
    
    document.getElementById('settingsYtdlpVersion').textContent = versions.ytdlp || t('settings.notFound');
    document.getElementById('settingsYtdlpVersion').removeAttribute('data-i18n');
    document.getElementById('settingsFfmpegVersion').textContent = versions.ffmpeg || t('settings.notFound');
    document.getElementById('settingsFfmpegVersion').removeAttribute('data-i18n');

    const statusVersions = document.getElementById('statusVersions');
    if (statusVersions) {
      statusVersions.textContent = `BitKit v${appVersion}`;
    }

    const ytdlpStatus = document.getElementById('ytdlpStatus');
    if (ytdlpStatus) {
      if (versions.ytdlp && versions.ytdlp !== t('settings.notFound')) {
        ytdlpStatus.textContent = 'yt-dlp: ' + versions.ytdlp.slice(0, 10);
        ytdlpStatus.classList.remove('tag-bordo');
        ytdlpStatus.classList.add('tag-teal');
        document.getElementById('statusDot')?.classList.remove('error');
      } else {
        ytdlpStatus.textContent = 'yt-dlp: ' + t('settings.notFound');
        ytdlpStatus.classList.remove('tag-teal');
        ytdlpStatus.classList.add('tag-bordo');
        document.getElementById('statusDot')?.classList.add('error');
      }
    }
  } catch (e) {
    console.error('Version check failed:', e);
  }
}
