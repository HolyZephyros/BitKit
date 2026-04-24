
function initDownloader() {
  const urlInput = document.getElementById('urlInput');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const btnDownload = document.getElementById('btnDownload');
  const advancedToggle = document.getElementById('advancedToggle');
  const btnSelectFolder = document.getElementById('btnSelectFolder');
  const btnSelectCookies = document.getElementById('btnSelectCookies');

  btnAnalyze?.addEventListener('click', () => analyzeUrl());

  const btnClearUrl = document.getElementById('btnClearUrl');

  urlInput?.addEventListener('input', () => {
    if (btnClearUrl) {
      btnClearUrl.style.display = urlInput.value.length > 0 ? 'inline-flex' : 'none';
    }
  });

  btnClearUrl?.addEventListener('click', () => {
    if (urlInput) urlInput.value = '';

    batchUrls = [];
    renderBatchPills();
    btnClearUrl.style.display = 'none';

    const mediaPreview = document.getElementById('mediaPreview');
    const downloadOptions = document.getElementById('downloadOptions');
    const analyzeLoading = document.getElementById('analyzeLoading');
    const playlistPanel = document.getElementById('playlistPanel');
    if (mediaPreview) mediaPreview.style.display = 'none';
    if (downloadOptions) downloadOptions.style.display = 'none';
    if (analyzeLoading) analyzeLoading.style.display = 'none';
    if (playlistPanel) playlistPanel.style.display = 'none';

    state.mediaInfo = null;
    state.playlistEntries = null;
    state.playlistSelected = new Set();
  });

  const btnToggleBatchMode = document.getElementById('btnToggleBatchMode');
  const batchLinkList = document.getElementById('batchLinkList');
  const btnAnalyzeText = document.querySelector('#btnAnalyze span');

  let isBatchMode = false;
  let batchUrls = [];

  const updateBatchUI = () => {
    if (isBatchMode) {
      if (btnToggleBatchMode) {
         btnToggleBatchMode.classList.add('active');
      }
      if (batchLinkList) batchLinkList.style.display = 'flex';
      if (btnAnalyzeText) btnAnalyzeText.textContent = t('dl.analyzeBatch') || "Batch Analyze";
      if (urlInput) urlInput.placeholder = t('dl.batchPlaceholderPill') || "Paste a link and press Enter...";
    } else {
      if (btnToggleBatchMode) {
         btnToggleBatchMode.classList.remove('active');
      }
      if (batchLinkList) batchLinkList.style.display = 'none';
      if (btnAnalyzeText) btnAnalyzeText.textContent = t('dl.analyze') || "Analyze";
      if (urlInput) urlInput.placeholder = t('dl.urlPlaceholder') || "Paste a video or audio URL...";
      batchUrls = [];
      renderBatchPills();
    }
  };

  const renderBatchPills = () => {
    batchLinkList.innerHTML = '';
    batchUrls.forEach((url, index) => {
      const pill = document.createElement('div');
      pill.className = 'batch-pill';
      pill.style.cssText = 'display:flex; align-items:center; background:var(--bg-elevated); border:1px solid var(--glass-border); padding:4px 8px; border-radius:12px; gap:6px; font-size:12px; max-width:100%;';

      const textSpan = document.createElement('span');
      textSpan.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px; color:var(--text-primary);';
      textSpan.textContent = url;

      const removeBtn = document.createElement('button');
      removeBtn.style.cssText = 'background:none; border:none; color:var(--accent-bordo); cursor:pointer; padding:0; display:flex;';
      removeBtn.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path d="M18 6L6 18M6 6l12 12"></path></svg>';
      removeBtn.onclick = () => {
        batchUrls.splice(index, 1);
        renderBatchPills();
        if (batchUrls.length === 0 && !urlInput.value) {
           if (btnClearUrl) btnClearUrl.style.display = 'none';
        }
      };

      pill.appendChild(textSpan);
      pill.appendChild(removeBtn);
      batchLinkList.appendChild(pill);
    });
  };

  const addUrlToBatch = (url) => {
    url = url.trim();
    if (!url || !isValidUrl(url)) return;
    if (!batchUrls.includes(url)) {
      batchUrls.push(url);
      renderBatchPills();
      if (btnClearUrl) btnClearUrl.style.display = 'inline-flex';
    }
  };

  btnToggleBatchMode?.addEventListener('click', () => {
    isBatchMode = !isBatchMode;
    updateBatchUI();
  });

  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isBatchMode) {
         addUrlToBatch(urlInput.value);
         urlInput.value = '';
      } else {
         analyzeUrl();
      }
    }
  });

  urlInput?.addEventListener('paste', (e) => {
    setTimeout(() => {
      const val = urlInput.value;
      if (val.includes('\n')) {

        isBatchMode = true;
        updateBatchUI();
        const lines = val.split('\n');
        lines.forEach(l => addUrlToBatch(l));
        urlInput.value = '';
      } else {
        if (isBatchMode) {

        } else {
          analyzeUrl();
        }
      }
      if (btnClearUrl) btnClearUrl.style.display = 'inline-flex';
    }, 50);
  });

  btnDownload?.addEventListener('click', () => startDownload());

  document.getElementById('btnAddToQueue')?.addEventListener('click', () => addToQueue());

  document.getElementById('btnClearQueue')?.addEventListener('click', () => {
    state.pendingQueue.length = 0;
    state.pendingQueue = [];
    state.queueProcessingActive = false;
    renderPendingQueue();
  });

  document.getElementById('btnDownloadAll')?.addEventListener('click', () => downloadAllQueued());
  document.getElementById('btnCancelAllActive')?.addEventListener('click', () => cancelAllActiveDownloads());

  advancedToggle?.addEventListener('click', () => {
    advancedToggle.classList.toggle('open');
    document.getElementById('advancedSettings')?.classList.toggle('open');
  });

  btnSelectCookies?.addEventListener('click', async () => {
    if (!window.bitkit) return;
    const result = await window.bitkit.file.selectFile({
      type: 'cookies',
      filters: [{ name: t('dialog.cookies'), extensions: ['txt'] }, { name: t('dialog.allFiles'), extensions: ['*'] }]
    });
    if (!result.canceled) {
      document.getElementById('cookiesPath').value = result.path;

      state.settings.cookiesPath = result.path;
      const settingsInput = document.getElementById('settingsCookiesPath');
      if (settingsInput) settingsInput.value = result.path;
      await window.bitkit.settings.set(state.settings);

      if (result.hasYoutube === false) {
        showToast(t('toast.cookiesNoYoutube'), 'warning', 10000);
      }
    }
  });

  if (window.bitkit) {
    state._unsubProgress = window.bitkit.download.onProgress((data) => updateDownloadProgress(data));
    state._unsubComplete = window.bitkit.download.onComplete((data) => onDownloadComplete(data));
    state._unsubError = window.bitkit.download.onError((data) => onDownloadError(data));
  }

  document.getElementById('filenameTemplate')?.addEventListener('change', async (e) => {
    if (window.bitkit) {
      state.settings.filenameTemplate = e.target.value;
      await window.bitkit.settings.set(state.settings);
    }
  });

  const rateLimitInput = document.getElementById('globalRateLimit');

  const autoResizeRate = (input) => {
    if (!input || !input.classList.contains('font-mono')) return;
    const isModal = input.id === 'rateLimit';
    const padding = isModal ? 55 : 55;
    const displayStr = input.value || input.placeholder || '';
    const len = Math.max(4, displayStr.length);
    input.style.width = `calc(${len}ch + ${padding}px)`;
  };

  const numFilter = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
    autoResizeRate(e.target);
  };

  const syncTabs = (selector, inputId, blockId) => {
    const input = document.getElementById(inputId);
    const block = document.getElementById(blockId);
    const tabs = document.querySelectorAll(selector);
    if (!input || tabs.length === 0) return;

    const val = input.value;
    let found = false;
    tabs.forEach(t => t.classList.remove('active'));

    tabs.forEach(t => {
      if (t.getAttribute('data-val') === val) {
        t.classList.add('active');
        found = true;
      }
    });

    if (!found && val && val !== '0') {
      tabs.forEach(t => { if (t.getAttribute('data-val') === 'custom') t.classList.add('active'); });
      if (block) block.style.display = 'inline-flex';
      autoResizeRate(input);
    } else {
      if (block) block.style.display = 'none';
      if (!val || val === '0') tabs.forEach(t => { if (t.getAttribute('data-val') === '') t.classList.add('active'); });
    }
  };

  const applyGlobalRate = async () => {
    let newRate = parseInt(rateLimitInput?.value) || 0;
    if (!window.bitkit) return;

    let isAdjusted = false;

    if (newRate > 0 && newRate < 100) {
      newRate = 100;
      if (rateLimitInput) rateLimitInput.value = '100';
      isAdjusted = true;
    }

    syncTabs('#activeRateLimitTabs .tab', 'globalRateLimit', 'activeRateInputBlock');

    const initialRateLimit = document.getElementById('rateLimit');
    if (initialRateLimit) {
      initialRateLimit.value = newRate === 0 ? '' : newRate.toString();
      syncTabs('#optRateLimitTabs .mode-btn', 'rateLimit', 'customRateInputBlock');
    }

    await window.bitkit.download.changeRate('', newRate);

    state.globalRateLimit = newRate;

    if (isAdjusted) {
      showToast(t('toast.minRateLimit') || 'Auto-adjusted to 100 KB/s', 'warning');
    } else {
      showToast(
        newRate
          ? t('dl.rateLimitSet', { rate: newRate >= 1024 ? (parseFloat((newRate / 1024).toFixed(2))) + ' MB/s' : newRate + ' KB/s' })
          : t('dl.rateLimitOff'),
        'info'
      );
    }
  };

  rateLimitInput?.addEventListener('input', numFilter);
  rateLimitInput?.addEventListener('change', applyGlobalRate);
  rateLimitInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      rateLimitInput.blur();
    }
  });

  const activeRateLimitTabs = document.querySelectorAll('#activeRateLimitTabs .tab');
  const activeRateInputBlock = document.getElementById('activeRateInputBlock');

  activeRateLimitTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      activeRateLimitTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const val = btn.getAttribute('data-val');
      if (val === 'custom') {
        if (activeRateInputBlock) activeRateInputBlock.style.display = 'flex';
        if (rateLimitInput) {
           rateLimitInput.focus();
           autoResizeRate(rateLimitInput);
        }

        const initialRateLimit = document.getElementById('rateLimit');
        if (initialRateLimit) {
           document.getElementById('customRateInputBlock').style.display = 'block';
           document.querySelectorAll('#optRateLimitTabs .mode-btn').forEach(b => {
               b.classList.toggle('active', b.getAttribute('data-val') === 'custom')
           });
        }
      } else {
        if (activeRateInputBlock) activeRateInputBlock.style.display = 'none';
        if (rateLimitInput) {
           rateLimitInput.value = val;
           applyGlobalRate();
        }
      }
    });
  });

  const timeFilter = (e) => { e.target.value = e.target.value.replace(/[^\d:.]/g, ''); };
  document.getElementById('startTime')?.addEventListener('input', timeFilter);
  document.getElementById('endTime')?.addEventListener('input', timeFilter);

  document.getElementById('maxFilesize')?.addEventListener('input', numFilter);

  const initialRateLimit = document.getElementById('rateLimit');
  const optRateLimitTabs = document.querySelectorAll('#optRateLimitTabs .mode-btn');
  const customRateInputBlock = document.getElementById('customRateInputBlock');

  optRateLimitTabs.forEach(btn => {
    btn.addEventListener('click', () => {

      optRateLimitTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const val = btn.getAttribute('data-val');
      if (val === 'custom') {
        if (customRateInputBlock) customRateInputBlock.style.display = 'block';
        if (initialRateLimit) {
           initialRateLimit.focus();
           autoResizeRate(initialRateLimit);
        }

        const activeBlock = document.getElementById('activeRateInputBlock');
        if (activeBlock) {
           activeBlock.style.display = 'flex';
           document.querySelectorAll('#activeRateLimitTabs .tab').forEach(b => {
               b.classList.toggle('active', b.getAttribute('data-val') === 'custom')
           });
        }
      } else {
        if (customRateInputBlock) customRateInputBlock.style.display = 'none';
        if (initialRateLimit) {
             initialRateLimit.value = val;

             if (rateLimitInput) {
                 rateLimitInput.value = val;
                 applyGlobalRate();
             }
        }
      }
    });
  });

  setTimeout(() => {
    syncTabs('#activeRateLimitTabs .tab', 'globalRateLimit', 'activeRateInputBlock');
    syncTabs('#optRateLimitTabs .mode-btn', 'rateLimit', 'customRateInputBlock');
  }, 100);

  initialRateLimit?.addEventListener('input', numFilter);
  initialRateLimit?.addEventListener('change', (e) => {
    let val = parseInt(e.target.value) || 0;
    if (val > 0 && val < 100) {
      e.target.value = '100';
      syncTabs('#optRateLimitTabs .mode-btn', 'rateLimit', 'customRateInputBlock');
      showToast(t('toast.minRateLimit') || 'Auto-adjusted to 100 KB/s', 'warning');
    }

    if (rateLimitInput) {
       rateLimitInput.value = e.target.value;
       applyGlobalRate();
    }
  });

  rateLimitInput?.addEventListener('input', numFilter);

  let lastClipboardUrl = '';
  window.addEventListener('focus', async () => {

    if (typeof getAvailableLocales === 'function' && getAvailableLocales().length === 0) return;

    try {
      const text = await navigator.clipboard.readText();
      const urlInput = document.getElementById('urlInput');
      if (text && urlInput && !urlInput.value && isValidUrl(text) && text !== lastClipboardUrl) {
        lastClipboardUrl = text;
        urlInput.value = text;
        showToast('📋 ' + t('toast.urlPasted'), 'info');
      }
    } catch (e) {  }
  });

  const dropZone = document.getElementById('urlDropZone');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
      if (text && isValidUrl(text.trim())) {
        document.getElementById('urlInput').value = text.trim();
        showToast('🖱️ ' + t('toast.urlDropped'), 'info');
        analyzeUrl();
      }
    });
  }

}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

async function analyzeUrl() {
  let lines = [];
  const batchList = document.getElementById('batchLinkList');
  if (batchList && batchList.style.display !== 'none') {
      const pills = batchList.querySelectorAll('.batch-pill span');
      pills.forEach(p => lines.push(p.textContent));
  }

  const urlInput = document.getElementById('urlInput');
  const currentInput = urlInput.value.trim();
  if (currentInput) {
      if (currentInput.includes('\n')) {
          lines.push(...currentInput.split('\n').map(l=>l.trim()).filter(l=>l));
      } else {
          lines.push(currentInput);
      }
  }

  lines = lines.filter(l => l && isValidUrl(l));
  lines = [...new Set(lines)];

  if (lines.length === 0) {
     showToast(t('dl.invalidUrl') || "No valid URL found.", "warning");
     return;
  }

  const loadingEl = document.getElementById('analyzeLoading');
  const loadingText = loadingEl.querySelector('.text-secondary');
  loadingEl.style.display = 'block';
  document.getElementById('mediaPreview').classList.remove('visible');
  document.getElementById('downloadOptions').style.display = 'none';
  document.getElementById('playlistPanel').style.display = 'none';

  if (!window.bitkit) {
    setTimeout(() => {
      loadingEl.style.display = 'none';
      showToast(t('toast.electronRequired'), 'warning');
    }, 1000);
    return;
  }

  try {
    const cookiesPath = document.getElementById('cookiesPath')?.value || state.settings.cookiesPath || '';

    if (lines.length === 1) {
      if (loadingText) loadingText.textContent = t('dl.analyzing') || "URL analiz ediliyor...";
      let url = lines[0];
      if (url.includes('youtube.com/list=')) url = url.replace('youtube.com/list=', 'youtube.com/playlist?list=');
      if (batchList && batchList.style.display === 'none') {
          urlInput.value = url;
      }

      const result = await window.bitkit.download.analyze(url, cookiesPath);
      loadingEl.style.display = 'none';

      if (result.success) {
        state.mediaInfo = result.data;
        showMediaPreview(result.data);

        if (result.isPlaylist && result.playlist) {
          state.playlistEntries = result.playlist.entries;
          state.playlistSelected = new Set(result.playlist.entries.map((_, i) => i));
          showToast('🎬 ' + t('toast.playlistDetected', {title: result.playlist.title, count: result.playlist.count}), 'info');

          const previewEl = document.getElementById('mediaPreview');
          previewEl.style.display = 'none';
          previewEl.classList.remove('visible');

          showPlaylistPanel(result.playlist);
        } else {

          state.playlistEntries = null;
          state.playlistSelected = new Set();
          updatePlaylistSelectionInfo();

          document.getElementById('playlistPanel').style.display = 'none';

          const btnDownload = document.getElementById('btnDownload');
          if (btnDownload) btnDownload.style.display = 'inline-flex';

          const btnQueueText = document.getElementById('btnAddToQueueText');
          if (btnQueueText) btnQueueText.textContent = t('dl.addToQueue');
        }
      } else {
        const errMsg = result.error || t('toast.analysisFailed');
        const shortErr = errMsg.length > 150 ? errMsg.substring(0, 150) + '…' : errMsg;
        console.error('[BitKit:Analyze] Failed:', result);
        showToast(shortErr, 'error', 8000);
      }
    }

    else {
      const results = [];
      const errors = [];
      let firstValidMediaInfo = null;

      for (let i = 0; i < lines.length; i++) {
        let url = lines[i];
        if (url.includes('youtube.com/list=')) url = url.replace('youtube.com/list=', 'youtube.com/playlist?list=');

        if (loadingText) loadingText.textContent = `${t('dl.analyzingBatch') || 'Linkler analiz ediliyor:'} ${i + 1} / ${lines.length}...`;

        const result = await window.bitkit.download.analyze(url, cookiesPath);
        if (result.success) {
          if (!firstValidMediaInfo && result.data && result.data.formats) {
              firstValidMediaInfo = result.data;
          }
          if (result.isPlaylist && result.playlist && result.playlist.entries) {
             results.push(...result.playlist.entries);
          } else {
             results.push(result.data);
          }
        } else {
          errors.push(url);
          console.error('[BitKit:Analyze] Failed for:', url, result.error);
        }
      }

      loadingEl.style.display = 'none';

      if (results.length > 0) {
        if (errors.length > 0) {
           showToast(t('toast.batchPartial', {success: results.length, error: errors.length}) || `${results.length} links added, ${errors.length} failed.`, 'warning', 5000);
        } else {
           showToast(t('toast.batchSuccess', {count: results.length}) || `All ${results.length} links analyzed successfully.`, 'success');
        }

        const mockPlaylist = {
           title: t('dl.batchModeTitle') || "Toplu Linkler",
           uploader: `${results.length} Medya`,
           count: results.length,
           entries: results
        };

        state.mediaInfo = firstValidMediaInfo || results[0];
        if (!state.mediaInfo.formats) state.mediaInfo.formats = [];
        showMediaPreview(state.mediaInfo);

        state.playlistEntries = results;
        state.playlistSelected = new Set(results.map((_, i) => i));

        const previewEl = document.getElementById('mediaPreview');
        previewEl.style.display = 'none';
        previewEl.classList.remove('visible');

        showPlaylistPanel(mockPlaylist);

        resetFormatListsToDefault();

        const pTitle = document.getElementById('playlistPanelTitle');
        if (pTitle) pTitle.textContent = mockPlaylist.title;

      } else {
        showToast(t('toast.batchFailed') || "No links could be analyzed.", 'error');
      }
    }
  } catch (err) {
    const loadingEl = document.getElementById('analyzeLoading');
    if (loadingEl) loadingEl.style.display = 'none';
    showToast(t('toast.error', {error: err.message}), 'error');
  }
}

function showMediaPreview(data) {
  document.getElementById('mediaThumbnail').src = data.thumbnail || '';
  document.getElementById('mediaTitle').textContent = data.title;
  document.getElementById('mediaPlatform').textContent = getPlatformName(data.platform);
  document.getElementById('mediaDuration').textContent = formatDuration(data.duration);
  document.getElementById('mediaUploader').textContent = data.uploader;
  const videoResolutions = new Set(data.formats.filter(f => f.hasVideo && f.height).map(f => f.height)).size;
  const audioStreams = data.formats.filter(f => f.hasAudio && !f.hasVideo).length;
  document.getElementById('mediaFormatCount').textContent = t('dl.formatsDetail', {
    video: videoResolutions,
    audio: audioStreams
  });

  const previewEl = document.getElementById('mediaPreview');
  previewEl.style.display = '';
  previewEl.classList.add('visible');
  document.getElementById('downloadOptions').style.display = 'block';

  populateFormatLists(data.formats);

  initModeToggle();
}

function populateFormatLists(formats) {
  const videoFormats = formats
    .filter(f => f.hasVideo && f.height && f.vcodec !== 'none')
    .sort((a, b) => (b.height - a.height) || (b.fps || 0) - (a.fps || 0) || (b.tbr || 0) - (a.tbr || 0));

  const audioFormats = formats
    .filter(f => f.hasAudio && !f.hasVideo && f.acodec !== 'none')
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));

  const bestAudioSize = audioFormats.length > 0 ? (audioFormats[0].filesize || 0) : 0;
  const videoFormatsWithSize = videoFormats.map(f => {
    if (!f.hasAudio && bestAudioSize > 0) {
      return { ...f, filesize: (f.filesize || 0) + bestAudioSize };
    }
    return f;
  });

  populateFormatList('videoFormatList', videoFormatsWithSize, 'video');

  populateFormatList('audioOnlyFormatList', audioFormats, 'audio');
}

function resetFormatListsToDefault() {

  ['videoFormatList', 'audioOnlyFormatList'].forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;

    container.querySelectorAll('.format-item').forEach(el => {
      if (el.dataset.formatId === 'best-video' || el.dataset.formatId === 'best-audio') {
        el.classList.add('selected');
      } else {
        el.remove();
      }
    });
  });

  const vVal = document.getElementById('videoFormatValue');
  const aVal = document.getElementById('audioOnlyFormatValue');
  if (vVal) vVal.textContent = t('dl.autoBest') || '⚡ Auto (Best)';
  if (aVal) aVal.textContent = t('dl.autoBest') || '⚡ Auto (Best)';
}

function populateFormatList(containerId, formats, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const defaults = container.querySelectorAll('[data-format-id="best-video"], [data-format-id="best-audio"], [data-format-id="none"]');
  container.innerHTML = '';

  defaults.forEach(el => {
    el.classList.add('selected');
    container.appendChild(el);
  });
  if (defaults.length > 0) {
    updateAccordionValue(containerId, defaults[0]);
  }

  const labels = { 2160: '4K', 1440: '2K', 1080: 'FHD', 720: 'HD', 480: 'SD' };

  for (const f of formats) {
    const item = document.createElement('div');
    item.className = 'format-item';
    item.dataset.formatId = f.formatId;
    if (f.hasAudio !== undefined) item.dataset.hasAudio = f.hasAudio ? 'true' : 'false';

    const radio = document.createElement('span');
    radio.className = 'format-radio';

    const label = document.createElement('span');
    label.className = 'format-label';

    if (type === 'video') {
      const resLabel = labels[f.height] ? ` ${labels[f.height]}` : '';
      label.textContent = `${f.height}p${resLabel}`;
    } else {
      const codec = (f.acodec || '').split('.')[0];
      label.textContent = codec.toUpperCase() || t('dl.modeAudio');
    }

    const detail = document.createElement('span');
    detail.className = 'format-detail';

    if (type === 'video') {
      const codec = (f.vcodec || '').split('.')[0];
      detail.innerHTML = `
        <span class="format-tag tag-ext" style="color:var(--text-primary);font-weight:600">${(f.ext || 'video').toUpperCase()}</span>
        <span class="format-tag tag-codec">${codec}</span>
        ${f.fps ? `<span class="format-tag">${f.fps}fps</span>` : ''}
        ${f.tbr ? `<span class="format-tag">${Math.round(f.tbr)}kbps</span>` : ''}
        ${f.filesize ? `<span class="format-tag tag-size">${formatFilesize(f.filesize)}</span>` : ''}
      `;
    } else {
      detail.innerHTML = `
        ${f.abr ? `<span class="format-tag">${Math.round(f.abr)}kbps</span>` : ''}
        ${f.filesize ? `<span class="format-tag tag-size">${formatFilesize(f.filesize)}</span>` : ''}
        <span class="format-tag">${f.ext || ''}</span>
      `;
    }

    item.appendChild(radio);
    item.appendChild(label);
    item.appendChild(detail);

    item.addEventListener('click', () => {
      container.querySelectorAll('.format-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      updateAccordionValue(containerId, item);
    });

    container.appendChild(item);
  }

  defaults.forEach(el => {
    el.onclick = () => {
      container.querySelectorAll('.format-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      updateAccordionValue(containerId, el);
    };
  });
}

function updateAccordionValue(containerId, selectedItem) {
  const valueMap = {
    videoFormatList: 'videoFormatValue',
    audioOnlyFormatList: 'audioOnlyFormatValue'
  };
  const valueEl = document.getElementById(valueMap[containerId]);
  if (!valueEl) return;

  const label = selectedItem.querySelector('.format-label');
  const detail = selectedItem.querySelector('.format-detail');
  let text = label ? label.textContent : '';
  if (detail && detail.textContent.trim()) {
    text += ' — ' + detail.textContent.trim().replace(/\s+/g, ' ');
  }
  valueEl.textContent = text;

  const accordion = selectedItem.closest('.format-accordion');
  if (accordion) {
    setTimeout(() => accordion.classList.remove('open'), 150);
  }
}

function formatFilesize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function getSelectedFormatId(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const selected = container.querySelector('.format-item.selected');
  if (!selected) return null;
  const id = selected.dataset.formatId;
  if (id === 'best-video' || id === 'best-audio') return null;
  if (id === 'none') return 'none';
  return id;
}

function initModeToggle() {
  const modeVideo = document.getElementById('modeVideo');
  const modeAudio = document.getElementById('modeAudio');

  modeVideo.onclick = () => setDownloadMode('video');
  modeAudio.onclick = () => setDownloadMode('audio');
}

function setDownloadMode(mode) {
  state.downloadMode = mode;

  document.getElementById('modeVideo').classList.toggle('active', mode === 'video');
  document.getElementById('modeAudio').classList.toggle('active', mode === 'audio');

  document.getElementById('videoSettings').style.display = mode === 'video' ? 'block' : 'none';
  document.getElementById('audioSettings').style.display = mode === 'audio' ? 'block' : 'none';

  updatePlaylistSelectionInfo();
}

function buildDownloadOptions(titleOverride = null) {
  const isAudio = state.downloadMode === 'audio';
  const isBulk = state.playlistEntries && state.playlistEntries.length > 0;
  let rawStart = document.getElementById('startTime')?.value.trim() || undefined;
  let rawEnd = document.getElementById('endTime')?.value.trim() || undefined;

  const dotSepRegex = /^(\d{1,2})\.(\d{2})$/;
  if (rawStart && dotSepRegex.test(rawStart)) {
    rawStart = rawStart.replace('.', ':');
    document.getElementById('startTime').value = rawStart;
  }
  if (rawEnd && dotSepRegex.test(rawEnd)) {
    rawEnd = rawEnd.replace('.', ':');
    document.getElementById('endTime').value = rawEnd;
  }

  const options = {
    title: titleOverride || state.mediaInfo?.title || 'Unknown',
    quality: isAudio ? 'audio' : 'best',
    isAudio: isAudio,
    outputPath: state.settings.downloadPath,
    startTime: rawStart,
    endTime: rawEnd,
    maxFilesize: document.getElementById('maxFilesize')?.value || undefined,
    rateLimit: state.globalRateLimit || document.getElementById('rateLimit')?.value || undefined,
    cookiesPath: document.getElementById('cookiesPath')?.value || state.settings.cookiesPath || undefined,
    filenameTemplate: document.getElementById('filenameTemplate')?.value || '%(title)s.%(ext)s',
    embedThumbnail: state.toggleStates.thumbnail,
    embedMetadata: state.toggleStates.metadata
  };

  const videoFormatId = (!isAudio && !isBulk) ? getSelectedFormatId('videoFormatList') : null;
  if (videoFormatId) {
    const list = document.getElementById('videoFormatList');
    const selectedEl = list ? list.querySelector('.format-item.selected') : null;
    const hasAudio = selectedEl ? selectedEl.dataset.hasAudio === 'true' : false;

    options.formatId = hasAudio ? `${videoFormatId}/bestvideo+bestaudio/best` : `${videoFormatId}+bestaudio/bestvideo+bestaudio/best`;

    if (selectedEl) {
      if (selectedEl.dataset.formatId === 'best-video') {
        options.quality = 'best';
      } else {
        const label = selectedEl.querySelector('.format-label');
        const extTag = selectedEl.querySelector('.tag-ext');
        if (label) {
          let qs = label.textContent.trim().split(' ')[0];
          if (extTag) qs += ` (${extTag.textContent.trim()})`;
          options.quality = qs;
        }
      }
    }
  }

  const audioFormatId = (isAudio && !isBulk) ? getSelectedFormatId('audioOnlyFormatList') : null;
  if (audioFormatId) {

    options.formatId = `${audioFormatId}/bestaudio/best`;

    const list = document.getElementById('audioOnlyFormatList');
    const selectedEl = list ? list.querySelector('.format-item.selected') : null;
    if (selectedEl) {
      const label = selectedEl.querySelector('.format-label');
      const detail = selectedEl.querySelector('.format-detail');
      let qual = label ? label.textContent.trim().split(' ')[0] : '';
      if (detail) {

        const tags = Array.from(detail.querySelectorAll('.format-tag'));
        const kbpsTag = tags.find(t => t.textContent.includes('kbps'));
        if (kbpsTag) {
           qual = kbpsTag.textContent.trim() + (qual ? ` (${qual})` : '');
        }
      }
      if (qual) options.quality = qual;
    }
  }

  return { options, rawStart, rawEnd };
}

async function startDownload() {

  if (state.playlistEntries && state.playlistEntries.length > 0) {
    queueSelectedPlaylistItems();
    downloadAllQueued();
    return;
  }

  if (!state.mediaInfo || !window.bitkit) {
    console.warn('[Downloader] startDownload blocked: mediaInfo=', !!state.mediaInfo, 'bitkit=', !!window.bitkit);
    return;
  }

  const customModalRate = document.getElementById('rateLimit')?.value;
  if (customModalRate && customModalRate !== '0') {
     const gInput = document.getElementById('globalRateLimit');
     if (gInput && gInput.value !== customModalRate) {
        gInput.value = customModalRate;
        gInput.dispatchEvent(new Event('change'));
     }
  }

  const url = document.getElementById('urlInput').value.trim();

  const { options, rawStart, rawEnd } = buildDownloadOptions();

  const timeRegex = /^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$/;
  if (rawStart && !timeRegex.test(rawStart)) {
    console.warn('[Downloader] Invalid startTime:', rawStart);
    showToast(t('dl.invalidTime', { field: t('dl.startTime') }), 'error');
    return;
  }
  if (rawEnd && !timeRegex.test(rawEnd)) {
    console.warn('[Downloader] Invalid endTime:', rawEnd);
    showToast(t('dl.invalidTime', { field: t('dl.endTime') }), 'error');
    return;
  }

  const parseTimeStr = (str) => {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  };

  if (rawStart || rawEnd) {
    const startSec = parseTimeStr(rawStart);
    const endSec = parseTimeStr(rawEnd);
    const duration = state.mediaInfo.duration || 0;

    if (rawStart && rawEnd && startSec >= endSec) {
      showToast(t('dl.timeStartAfterEnd'), 'error');
      return;
    }

    if (duration > 0) {
      if (rawStart && startSec >= duration) {
        showToast(t('dl.timeExceedsDuration', { time: rawStart, duration: Math.floor(duration / 60) + ':' + String(Math.floor(duration % 60)).padStart(2, '0') }), 'error');
        return;
      }
      if (rawEnd && endSec > duration) {
        showToast(t('dl.timeExceedsDuration', { time: rawEnd, duration: Math.floor(duration / 60) + ':' + String(Math.floor(duration % 60)).padStart(2, '0') }), 'error');
        return;
      }
    }
  }

  console.log('[Downloader] Starting download:', { url, options });

  const maxDownloads = parseInt(state.settings.maxConcurrentDownloads) || 1;
  if (state.downloads.size >= maxDownloads) {
    state.pendingQueue.push({
      url: url,
      title: state.mediaInfo.title,
      thumbnail: state.mediaInfo.thumbnail,
      mode: state.downloadMode,
      options: options
    });
    renderPendingQueue();
    showToast(t('toast.addedToQueue', { title: truncate(state.mediaInfo.title, 40) }) || 'Sıraya eklendi', 'success');

    state.mediaInfo = null;
    document.getElementById('urlInput').value = '';
    document.getElementById('urlInput').focus();
    const preview = document.getElementById('mediaPreview');
    preview.classList.remove('visible');
    preview.style.display = 'none';
    document.getElementById('downloadOptions').style.display = 'none';
    document.getElementById('playlistPanel').style.display = 'none';

    state.queueProcessingActive = true;
    processNextInQueue();
    return;
  }

  try {
    const result = await window.bitkit.download.start(url, options);
    if (result.success) {
      state.downloads.set(result.id, {
        id: result.id,
        title: state.mediaInfo.title,
        url,
        options,
        percent: 0,
        speed: '',
        eta: '',
        retries: 0,
        status: 'connecting'
      });
      renderDownloadQueue();
      showToast(t('toast.downloadStarted', { title: truncate(state.mediaInfo.title, 40) }), 'success');
      updateStatusBar();

      state.mediaInfo = null;
      document.getElementById('urlInput').value = '';
      document.getElementById('urlInput').focus();
      const preview = document.getElementById('mediaPreview');
      preview.classList.remove('visible');
      preview.style.display = 'none';
      document.getElementById('downloadOptions').style.display = 'none';
      document.getElementById('playlistPanel').style.display = 'none';
    } else {
      const errMsg = result.errorKey ? t(result.errorKey, result.errorParams) : (result.error || t('error.unknownDownload'));
      showToast('❌ ' + t('toast.downloadInitFailed', {error: errMsg}), 'error');
    }
  } catch (err) {
    showToast(t('toast.downloadError', { error: err.message }), 'error');
  }
}

function updateDownloadProgress(data) {
  const download = state.downloads.get(data.id);
  if (download) {

    if (!data.status) {
      delete download.status;
    }
    Object.assign(download, data);

    updateDownloadItemDOM(data.id);
  }
}

function onDownloadComplete(data) {
  const dl = state.downloads.get(data.id);
  if (dl?._cuttingTimerId) clearInterval(dl._cuttingTimerId);
  state.downloads.delete(data.id);
  const el = document.getElementById(`dl-${data.id}`);

  if (window.bitkit) {
    window.bitkit.history.add({
      title: data.title,
      url: data.url,
      outputPath: data.outputPath,
      type: 'download'
    });
    if (state.currentPage === 'history' && typeof loadHistory === 'function') {
      loadHistory();
    }
  }

  if (el) {
    el.classList.remove('download-item-postprocessing', 'download-item-cutting', 'download-item-connecting');
    el.classList.add('download-item-complete');
    const speedEl = el.querySelector('[data-field="speed"]');
    const etaEl = el.querySelector('[data-field="eta"]');
    const totalEl = el.querySelector('[data-field="totalSize"]');
    const barEl = el.querySelector('[data-field="bar"]');
    const percentEl = el.querySelector('[data-field="percent"]');
    const cancelBtn = el.querySelector('.btn-icon');

    if (speedEl) speedEl.innerHTML = '<span style="color:var(--success)">' + t('dl.completed') + '</span>';
    if (etaEl) etaEl.textContent = '';
    if (totalEl) totalEl.textContent = '';
    if (barEl) { barEl.style.width = '100%'; barEl.className = 'progress-fill progress-fill-complete'; }
    if (percentEl) percentEl.textContent = '✓';
    if (cancelBtn) cancelBtn.style.display = 'none';

    setTimeout(() => {
      if (!el.parentNode) return;
      el.classList.add('download-item-exit');
      setTimeout(() => {
        if (el.parentNode) el.remove();
        if (state.downloads.size === 0 && !document.getElementById('downloadQueueList')?.children.length) {
          document.getElementById('downloadQueue').style.display = 'none';
        }
      }, 400);
    }, 3500);
  }

  if (state.toggleStates.openFolder && data.outputPath && window.bitkit) {
    if (window.bitkit.shell.showInFolder) {
      window.bitkit.shell.showInFolder(data.outputPath);
    } else {
      window.bitkit.shell.openPath(data.outputPath);
    }
  }

  const hasActiveConversions = state.conversions && state.conversions.size > 0;
  if (state.toggleStates.shutdown && state.downloads.size === 0 && state.pendingQueue.length === 0 && !hasActiveConversions) {

    showToast('💤 ' + t('toast.shutdownMessage') + ' — <a href="#" onclick="window.bitkit.system.cancelShutdown(); showToast(\'' + t('toast.shutdownCancelled') + '\', \'success\'); return false;" style="color:var(--accent-teal);text-decoration:underline;font-weight:700">' + t('toast.cancelShutdown') + '</a>', 'warning', 15000);
    if (window.bitkit) {
      window.bitkit.system.shutdown(t('toast.shutdownMessage'));
    }
  }

  updateStatusBar();
  processNextInQueue();
}

function onDownloadError(data) {
  const dlInfo = state.downloads.get(data.id);

  if (data.error === 'MAX_FILESIZE_EXCEEDED') {
    state.downloads.delete(data.id);
    const el = document.getElementById(`dl-${data.id}`);
    if (el) el.remove();
    if (state.downloads.size === 0) {
      document.getElementById('downloadQueue').style.display = 'none';
    }
    updateStatusBar();
    showToast('📦 ' + t('dl.maxFilesizeExceeded'), 'warning', 8000);
    processNextInQueue();
    return;
  }

  if (dlInfo && (!dlInfo.retries || dlInfo.retries < 3)) {
    const retryCount = (dlInfo.retries || 0) + 1;
    const retryDelays = [3000, 6000, 10000];
    const delay = retryDelays[retryCount - 1] || 5000;
    showToast('🔄 ' + t('toast.retrying', {count: retryCount, delay: delay / 1000}), 'warning');
    dlInfo.retries = retryCount;

    if (window.bitkit && dlInfo.url) {
      setTimeout(() => {
        window.bitkit.download.start(dlInfo.url, dlInfo.options || {}).then((result) => {
          if (result.success) {

            state.downloads.delete(data.id);
            const el = document.getElementById(`dl-${data.id}`);
            if (el) el.remove();
            state.downloads.set(result.id, {
              ...dlInfo,
              id: result.id,
              retries: retryCount,
              percent: 0
            });
            renderDownloadQueue();
          }
        });
      }, delay);
      return;
    }
  }

  state.downloads.delete(data.id);
  const el = document.getElementById(`dl-${data.id}`);
  if (el) el.remove();
  if (state.downloads.size === 0) {
    document.getElementById('downloadQueue').style.display = 'none';
  }
  updateStatusBar();

  if (typeof window.showErrorToast === 'function') {
    window.showErrorToast(data.error || t('error.unknownDownload'), 'Downloader');
  } else {
    showToast(t('toast.downloadError', { error: data.error }), 'error');
  }

  processNextInQueue();
}

function renderDownloadQueue() {
  const container = document.getElementById('downloadQueueList');
  const wrapper = document.getElementById('downloadQueue');

  if (state.downloads.size === 0) {
    wrapper.style.display = 'none';
    return;
  }

  wrapper.style.display = 'block';

  const btnCancelAll = document.getElementById('btnCancelAllActive');
  if (btnCancelAll) {
    btnCancelAll.style.display = state.downloads.size > 1 ? 'inline-flex' : 'none';
  }

  state.downloads.forEach((dl) => {

    if (!document.getElementById(`dl-${dl.id}`)) {
      const el = document.createElement('div');
      el.className = 'download-item download-item-enter';
      el.id = `dl-${dl.id}`;
      el.innerHTML = `
        <div class="download-item-info">
          <div class="download-item-name">${escapeHtml(truncate(dl.title, 60))}</div>
          <div class="download-item-status">
            <span data-field="speed">${dl.speed || '—'}</span>
            <span><span data-field="etaLabel">${t('dl.eta')}</span> <span data-field="eta">${dl.eta || '—'}</span></span>
            <span data-field="totalSize">${dl.totalSize || ''}</span>
          </div>
        </div>
        <div class="download-item-progress" style="display: flex; align-items: center; gap: 14px;">
          <div class="progress-percent" style="font-size: 15px; font-weight: 800; color: var(--accent-teal); width: 46px; text-align: right; letter-spacing: 0.5px;">
            <span data-field="percent" style="font-family: var(--font-mono);">${Math.round(dl.percent || 0)}%</span>
          </div>
          <div class="progress-bar" style="flex: 1;">
            <div class="progress-fill" data-field="bar" style="width:${dl.percent || 0}%"></div>
          </div>
        </div>
        <button class="btn-icon btn-cancel-dl" data-dl-id="${dl.id}" data-tooltip="${t('dl.cancel')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      `;

      el.querySelector('.btn-cancel-dl')?.addEventListener('click', () => cancelDownload(dl.id));
      container.appendChild(el);

      updateDownloadItemDOM(dl.id);
    }
  });
}

function updateDownloadItemDOM(id) {
  const el = document.getElementById(`dl-${id}`);
  const dl = state.downloads.get(id);
  if (!el || !dl) return;

  const speedEl = el.querySelector('[data-field="speed"]');
  const etaEl = el.querySelector('[data-field="eta"]');
  const totalEl = el.querySelector('[data-field="totalSize"]');
  const barEl = el.querySelector('[data-field="bar"]');
  const percentEl = el.querySelector('[data-field="percent"]');
  const etaLabelEl = el.querySelector('[data-field="etaLabel"]');

  if (dl.status === 'connecting') {

    el.classList.add('download-item-connecting');
    el.classList.remove('download-item-postprocessing', 'download-item-cutting');
    if (speedEl) speedEl.innerHTML = '<span class="postprocess-label">🔗 ' + t('dl.connecting') + '</span>';
    if (etaLabelEl) etaLabelEl.textContent = '';
    if (etaEl) etaEl.textContent = '';
    if (totalEl) totalEl.textContent = '';
    if (barEl) { barEl.style.width = '100%'; barEl.className = 'progress-fill progress-fill-connecting'; }
    if (percentEl) percentEl.textContent = '—';
  } else if (dl.status === 'cutting') {

    el.classList.remove('download-item-connecting', 'download-item-postprocessing');
    el.classList.add('download-item-cutting');

    if (!dl._cuttingTimerId) {
      dl._cuttingStart = Date.now();
      dl._cuttingTimerId = setInterval(() => {
        const elapsed = Math.floor((Date.now() - dl._cuttingStart) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
        const etaField = el.querySelector('[data-field="eta"]');
        if (etaField) etaField.textContent = timeStr;
      }, 1000);
    }
    if (speedEl) speedEl.innerHTML = '<span class="postprocess-label">✂️ ' + t('dl.cutting') + '</span>';
    if (etaLabelEl) etaLabelEl.textContent = t('dl.elapsed');
    if (etaEl) etaEl.textContent = '0s';
    if (totalEl) totalEl.textContent = '';
    if (barEl) { barEl.style.width = '100%'; barEl.className = 'progress-fill progress-fill-cutting'; }
    if (percentEl) percentEl.textContent = '';
  } else if (dl.status === 'postprocessing') {
    el.classList.remove('download-item-connecting', 'download-item-cutting');
    el.classList.add('download-item-postprocessing');

    if (dl._cuttingTimerId) { clearInterval(dl._cuttingTimerId); dl._cuttingTimerId = null; }
    const speedText = dl.speed ? ` — ${dl.speed}` : '';
    if (speedEl) speedEl.innerHTML = '<span class="postprocess-label">⚙️ ' + t('dl.postprocessing') + speedText + '</span>';
    if (etaLabelEl) etaLabelEl.textContent = '';
    if (etaEl) etaEl.textContent = '';
    if (totalEl) totalEl.textContent = dl.totalSize || '';
    const pct = dl.percent || 0;
    if (barEl) { barEl.style.width = (pct > 10 ? pct : 100) + '%'; barEl.className = 'progress-fill progress-fill-processing'; }
    if (percentEl) percentEl.textContent = pct > 10 ? Math.round(pct) + '%' : '';
  } else {
    el.classList.remove('download-item-postprocessing', 'download-item-connecting', 'download-item-cutting');

    if (dl._cuttingTimerId) { clearInterval(dl._cuttingTimerId); dl._cuttingTimerId = null; }
    if (speedEl) speedEl.textContent = dl.speed || '—';
    if (etaLabelEl) etaLabelEl.textContent = t('dl.eta');
    if (etaEl) etaEl.textContent = dl.eta || '—';
    if (totalEl) totalEl.textContent = dl.totalSize || '';
    if (barEl) { barEl.style.width = (dl.percent || 0) + '%'; barEl.className = 'progress-fill'; }
    if (percentEl) percentEl.textContent = Math.round(dl.percent || 0) + '%';
  }
}

async function cancelDownload(id) {
  if (window.bitkit) {
    const dl = state.downloads.get(id);
    if (dl?._cuttingTimerId) clearInterval(dl._cuttingTimerId);
    await window.bitkit.download.cancel(id);
    state.downloads.delete(id);
    const el = document.getElementById(`dl-${id}`);
    if (el) el.remove();
    if (state.downloads.size === 0) {
      document.getElementById('downloadQueue').style.display = 'none';
    }
    updateStatusBar();
    showToast(t('toast.downloadCanceled'), 'info');
  }
}

async function cancelAllActiveDownloads() {
  if (state.downloads.size === 0) return;
  state.queueProcessingActive = false;

  const confirmStr = t('dl.confirmCancelAll');

  if (!(await window.showConfirm(confirmStr, null, null, true))) {
    return;
  }

  const ids = Array.from(state.downloads.keys());
  for (const id of ids) {
    await cancelDownload(id);
  }
}

function addToQueue() {

  if (state.playlistEntries && state.playlistEntries.length > 0) {
    queueSelectedPlaylistItems();
    return;
  }

  if (!state.mediaInfo) {
    showToast(t('toast.analyzeFirst'), 'warning');
    return;
  }

  const { options } = buildDownloadOptions();

  const item = {
    url: document.getElementById('urlInput').value.trim(),
    title: state.mediaInfo.title,
    thumbnail: state.mediaInfo.thumbnail,
    mode: state.downloadMode,
    options: options
  };

  if (state.pendingQueue.find(q => q.url === item.url)) {
    showToast(t('toast.alreadyInQueue'), 'warning');
    return;
  }

  state.pendingQueue.unshift(item);
  renderPendingQueue();
  showToast(t('toast.addedToQueue', { title: truncate(item.title, 40) }), 'success');

  state.mediaInfo = null;
  document.getElementById('urlInput').value = '';
  document.getElementById('urlInput').focus();
  const preview = document.getElementById('mediaPreview');
  preview.classList.remove('visible');
  preview.style.display = 'none';
  document.getElementById('downloadOptions').style.display = 'none';
  document.getElementById('playlistPanel').style.display = 'none';
}

function removeFromQueue(index) {
  const item = state.pendingQueue[index];
  state.pendingQueue.splice(index, 1);
  renderPendingQueue();
}

function startQueuedItem(index) {
  const maxDownloads = parseInt(state.settings.maxConcurrentDownloads) || 1;
  if (state.downloads.size >= maxDownloads) {
    showToast(t('toast.concurrentLimitReached') || 'Maksimum indirme limitine ulaşıldı.', 'warning');
    return;
  }

  const item = state.pendingQueue.splice(index, 1)[0];
  renderPendingQueue();

  item.options.outputPath = state.settings.downloadPath;
  window.bitkit.download.start(item.url, item.options).then(result => {
    if (result.success) {
      state.downloads.set(result.id, {
        id: result.id,
        title: item.title,
        url: item.url,
        options: item.options,
        percent: 0, speed: '', eta: ''
      });
      renderDownloadQueue();
      updateStatusBar();
    } else {
      const errMsg = result.errorKey ? t(result.errorKey, result.errorParams) : result.error;
      showToast('❌ ' + t('toast.downloadInitFailed', {error: errMsg}), 'error');
    }
  }).catch(err => {
    showToast(t('toast.downloadErrorTitle', {title: truncate(item.title, 30), error: err.message}), 'error');
  });
}

function renderPendingQueue() {
  if (window.bitkit) window.bitkit.queue.save(state.pendingQueue);

  const section = document.getElementById('pendingQueue');
  const list = document.getElementById('pendingQueueList');

  if (state.pendingQueue.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const countEl = document.getElementById('pendingQueueCount');
  if (countEl) countEl.innerText = `(${state.pendingQueue.length})`;
  list.innerHTML = state.pendingQueue.map((item, i) => {
    const modeLabel = item.mode === 'audio' ? '🎵 ' + t('dl.modeAudio') : '🎬 ' + t('dl.modeVideo');
    let qualStr = item.options.quality;
    if (qualStr === 'best' || qualStr === 'audio') qualStr = t('dl.qualityBest') + ` (${t('dl.autoExt')})`;
    const quality = !qualStr ? '' : ` • ${qualStr}`;
    return `
      <div style="border:1px solid var(--glass-border);border-radius:var(--radius-md);overflow:hidden;transition:all 150ms ease">
        <div style="display:flex;align-items:center;gap:var(--space-md);padding:12px 16px;background:var(--bg-tertiary)">
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--text-base);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</div>
            <div style="font-size:var(--text-sm);font-weight:500;color:var(--text-secondary);margin-top:6px">
              ${modeLabel}${quality}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn-icon q-btn-start" onclick="startQueuedItem(${i})" title="${t('dl.download') || 'Download'}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="btn-icon q-btn-remove" onclick="removeFromQueue(${i})" title="${t('dl.cancel') || 'Remove'}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function processNextInQueue() {
  if (!state.queueProcessingActive) return;
  const maxDownloads = state.settings.maxConcurrentDownloads || 1;
  if (state.downloads.size >= maxDownloads || state.pendingQueue.length === 0) {
    if (state.pendingQueue.length === 0) state.queueProcessingActive = false;
    return;
  }

  const item = state.pendingQueue.shift();
  renderPendingQueue();

  item.options.outputPath = state.settings.downloadPath;
  window.bitkit.download.start(item.url, item.options).then(result => {
    if (result.success) {
      state.downloads.set(result.id, {
        id: result.id,
        title: item.title,
        url: item.url,
        options: item.options,
        percent: 0, speed: '', eta: ''
      });
      renderDownloadQueue();
      updateStatusBar();

      processNextInQueue();
    } else {
      const errMsg = result.errorKey ? t(result.errorKey, result.errorParams) : result.error;
      showToast('❌ ' + t('toast.downloadInitFailed', {error: errMsg}), 'error');
      if (result.errorKey === 'backend.noWritePermission') {
        state.pendingQueue.unshift(item);
        state.queueProcessingActive = false;
        renderPendingQueue();
      } else {
        processNextInQueue();
      }
    }
  }).catch(err => {
    showToast(t('toast.downloadErrorTitle', {title: truncate(item.title, 30), error: err.message}), 'error');
    processNextInQueue();
  });
}

async function downloadAllQueued() {
  if (state.pendingQueue.length === 0 || !window.bitkit) return;

  state.queueProcessingActive = true;
  showToast(t('toast.downloadsStarting', { count: state.pendingQueue.length }), 'info');

  processNextInQueue();
}

function showPlaylistPanel(playlist) {
  const panel = document.getElementById('playlistPanel');
  panel.style.display = 'block';

  document.getElementById('playlistPanelTitle').textContent = playlist.title || t('dl.playlist');
  document.getElementById('playlistCountBadge').textContent = t('dl.videoCount', {count: playlist.count || 0});

  renderPlaylistItems();
  updatePlaylistSelectionInfo();

  const searchInput = document.getElementById('playlistSearch');
  searchInput.value = '';
  searchInput.oninput = () => filterPlaylistItems(searchInput.value);

  document.getElementById('playlistSelectAll').onclick = () => {
    if (!state.playlistEntries) return;

    const visibleIndices = [];
    document.querySelectorAll('.playlist-video-item').forEach(el => {
      if (!el.classList.contains('hidden')) {
        visibleIndices.push(parseInt(el.dataset.index));
        el.classList.add('selected');
      }
    });
    state.playlistSelected = new Set(visibleIndices);
    updatePlaylistSelectionInfo();
  };

  document.getElementById('playlistSelectNone').onclick = () => {
    state.playlistSelected = new Set();
    document.querySelectorAll('.playlist-video-item').forEach(el => el.classList.remove('selected'));
    updatePlaylistSelectionInfo();
  };

}

function renderPlaylistItems() {
  const container = document.getElementById('playlistVideoList');
  if (!state.playlistEntries || state.playlistEntries.length === 0) {
    container.innerHTML = `<div class="playlist-empty-search">${t('dl.playlistEmpty')}</div>`;
    return;
  }

  container.innerHTML = state.playlistEntries.map((entry, i) => {
    const isSelected = state.playlistSelected.has(i);
    const duration = entry.duration ? formatDuration(entry.duration) : '';
    const thumbUrl = entry.thumbnail || '';

    return `
      <div class="playlist-video-item ${isSelected ? 'selected' : ''}" data-index="${i}">
        <div class="playlist-video-checkbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
        </div>
        <span class="playlist-video-index">${i + 1}</span>
        ${thumbUrl ? `<img class="playlist-video-thumb" src="${thumbUrl}" alt="" loading="lazy">` : ''}
        <div class="playlist-video-info">
          <div class="playlist-video-title" title="${escapeHtml(entry.title || '')}">${escapeHtml(entry.title || t('dl.untitled'))}</div>
        </div>
        ${duration ? `<span class="playlist-video-duration">${duration}</span>` : ''}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.playlist-video-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index);
      if (state.playlistSelected.has(idx)) {
        state.playlistSelected.delete(idx);
        el.classList.remove('selected');
      } else {
        state.playlistSelected.add(idx);
        el.classList.add('selected');
      }
      updatePlaylistSelectionInfo();
    });
  });
}

function filterPlaylistItems(query) {
  const q = query.toLowerCase().trim();
  const items = document.querySelectorAll('.playlist-video-item');
  let visibleCount = 0;

  items.forEach(el => {
    const title = el.querySelector('.playlist-video-title')?.textContent?.toLowerCase() || '';
    const match = !q || title.includes(q);
    el.classList.toggle('hidden', !match);
    if (match) visibleCount++;
  });

  const container = document.getElementById('playlistVideoList');
  const existing = container.querySelector('.playlist-empty-search');
  if (visibleCount === 0 && q) {
    if (!existing) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'playlist-empty-search';
      emptyEl.textContent = t('dl.playlistNoMatch', {query: query});
      container.appendChild(emptyEl);
    }
  } else if (existing) {
    existing.remove();
  }
}

function updatePlaylistSelectionInfo() {
  const total = state.playlistEntries ? state.playlistEntries.length : 0;
  const selected = state.playlistSelected ? state.playlistSelected.size : 0;

  const btnQueue = document.getElementById('btnAddToQueue');
  const btnQueueText = document.getElementById('btnAddToQueueText');
  const btnDownload = document.getElementById('btnDownload');
  const btnDownloadText = document.getElementById('btnDownloadText');

  if (btnQueue && btnQueueText) {
    btnQueue.disabled = (total > 0 && selected === 0);
    const addStr = t('dl.addSelected') || 'Add Selected to Queue';
    if (total > 0) {
      btnQueueText.innerHTML = `<strong>${selected}</strong> ` + addStr;
      if (selected > 0) {
        btnQueue.style.color = '#fff';
        btnQueue.style.textShadow = '';
      } else {
        btnQueue.style.color = '';
        btnQueue.style.textShadow = '';
      }
    } else {
      btnQueueText.innerHTML = t('dl.addToQueue');
      btnQueue.style.color = '';
      btnQueue.style.textShadow = '';
    }
  }

  if (btnDownload && btnDownloadText) {
    btnDownload.disabled = (total > 0 && selected === 0);
    const isAudio = state.downloadMode === 'audio';
    const dlStr = isAudio ? t('dl.downloadAudio') : t('dl.downloadVideo');
    if (total > 0) {
      btnDownloadText.innerHTML = `<strong>${selected}</strong> ` + t('dl.downloadSelected');
    } else {
      btnDownloadText.innerHTML = dlStr;
    }
  }
}

function queueSelectedPlaylistItems() {
  if (!state.playlistEntries || !state.playlistSelected || state.playlistSelected.size === 0) {
    showToast('⚠️ ' + t('toast.noVideoSelected'), 'warning');
    return;
  }

  const isAudio = state.downloadMode === 'audio';

  let addedCount = 0;
  for (const idx of state.playlistSelected) {
    const entry = state.playlistEntries[idx];
    if (!entry) continue;

    if (state.pendingQueue.find(q => q.url === entry.url)) continue;

    const { options } = buildDownloadOptions(entry.title);

    state.pendingQueue.push({
      url: entry.url,
      title: entry.title,
      thumbnail: entry.thumbnail,
      mode: state.downloadMode,
      options: options
    });
    addedCount++;
  }

  renderPendingQueue();
  showToast('🎬 ' + t('toast.videosQueued', {count: addedCount}), 'success');

  state.mediaInfo = null;
  state.playlistEntries = null;
  state.playlistSelected = new Set();
  document.getElementById('urlInput').value = '';
  document.getElementById('urlInput').focus();
  const preview = document.getElementById('mediaPreview');
  preview.classList.remove('visible');
  preview.style.display = 'none';
  document.getElementById('downloadOptions').style.display = 'none';
  document.getElementById('playlistPanel').style.display = 'none';
}

function queuePlaylist() {

  if (state.playlistEntries) {
    state.playlistSelected = new Set(state.playlistEntries.map((_, i) => i));
    queueSelectedPlaylistItems();
  }
}
