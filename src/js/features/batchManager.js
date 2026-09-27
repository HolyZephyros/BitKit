// ===== BitKit Batch Link & Clipboard Auto-Detect Manager =====

(() => {
  let isBatchMode = false;
  let batchUrls = [];
  let unsubClipboard = null;
  let lastCheckedClipboard = '';

  function isValidUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function extractUrlsFromText(text) {
    if (!text || typeof text !== 'string') return [];
    const urlRegex = /(https?:\/\/[^\s<>"'{}|\\^`]+)/gi;
    const matches = text.match(urlRegex) || [];
    const cleaned = matches.map(url => {
      return url.replace(/[.,;:!?)\]]+$/, '');
    }).filter(url => isValidUrl(url));
    return [...new Set(cleaned)];
  }

  function initBatchManager() {
    const btnToggleBatchMode = document.getElementById('btnToggleBatchMode');
    const btnClearBatch = document.getElementById('btnClearBatch');
    const urlInput = document.getElementById('urlInput');
    const btnClearUrl = document.getElementById('btnClearUrl');

    btnToggleBatchMode?.addEventListener('click', () => {
      toggleBatchMode();
    });

    btnClearBatch?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearBatchUrls();
    });

    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (isBatchMode) {
          e.preventDefault();
          const val = urlInput.value.trim();
          if (val) {
            const urls = extractUrlsFromText(val);
            if (urls.length > 0) {
              urls.forEach(u => addUrlToBatch(u, false));
            } else if (isValidUrl(val)) {
              addUrlToBatch(val, false);
            }
            urlInput.value = '';
          }
        }
      }
    });

    urlInput?.addEventListener('paste', () => {
      setTimeout(() => {
        const val = urlInput.value;
        if (!val) return;

        if (val.includes('\n')) {
          if (!isBatchMode) {
            toggleBatchMode(true);
          }
          const urls = extractUrlsFromText(val);
          if (urls.length > 0) {
            let added = 0;
            urls.forEach(u => {
              if (addUrlToBatch(u, true)) added++;
            });
            if (added > 0) {
              showToast('📋 ' + (added === 1 ? t('toast.linkAutoDetected') : t('toast.linksAutoDetected', { count: added })), 'info');
            }
          }
          urlInput.value = '';
        } else if (isBatchMode && isValidUrl(val.trim())) {
          addUrlToBatch(val.trim(), false);
          urlInput.value = '';
        }
      }, 50);
    });

    // Window focus fallback checking
    window.addEventListener('focus', async () => {
      if (!isBatchMode) return;
      try {
        let text = '';
        if (window.bitkit?.clipboard?.readText) {
          text = await window.bitkit.clipboard.readText();
        } else if (navigator.clipboard?.readText) {
          text = await navigator.clipboard.readText();
        }
        if (text && text.trim() !== lastCheckedClipboard) {
          lastCheckedClipboard = text.trim();
          const urls = extractUrlsFromText(text);
          if (urls.length > 0) {
            let added = 0;
            urls.forEach(u => {
              if (addUrlToBatch(u, true)) added++;
            });
            if (added > 0) {
              const msg = added === 1 ? t('toast.linkAutoDetected') : t('toast.linksAutoDetected', { count: added });
              showToast('📋 ' + msg, 'info');
              triggerPopupNotification(added, urls[urls.length - 1]);
            }
          }
        }
      } catch (err) {
        // focus read error ignored
      }
    });

    // Global hooks
    window.getBatchUrls = () => [...batchUrls];
    window.clearBatchUrls = () => clearBatchUrls();
    window.isBatchModeActive = () => isBatchMode;
    window.addUrlToBatch = (url, silent) => addUrlToBatch(url, silent);
  }

  async function toggleBatchMode(forceState) {
    isBatchMode = (forceState !== undefined) ? forceState : !isBatchMode;

    const btnToggleBatchMode = document.getElementById('btnToggleBatchMode');
    const batchContainer = document.getElementById('batchContainer');
    const urlInput = document.getElementById('urlInput');
    const btnAnalyzeSpan = document.querySelector('#btnAnalyze span');

    if (isBatchMode) {
      if (btnToggleBatchMode) btnToggleBatchMode.classList.add('active');
      if (batchContainer) batchContainer.style.display = 'flex';
      if (urlInput) urlInput.placeholder = t('dl.batchPlaceholderPill') || "Link girip Enter'a basın...";

      // Check if input currently has a valid URL and move it to batch
      if (urlInput && urlInput.value.trim()) {
        const val = urlInput.value.trim();
        const urls = extractUrlsFromText(val);
        if (urls.length > 0) {
          urls.forEach(u => addUrlToBatch(u, true));
        } else if (isValidUrl(val)) {
          addUrlToBatch(val, true);
        }
        urlInput.value = '';
      }

      // Start background clipboard watching
      if (window.bitkit?.clipboard) {
        await window.bitkit.clipboard.startWatch();

        if (unsubClipboard) unsubClipboard();
        unsubClipboard = window.bitkit.clipboard.onUrlsDetected((urls) => {
          if (!isBatchMode) return;
          let added = 0;
          urls.forEach(u => {
            if (addUrlToBatch(u, true)) added++;
          });
          if (added > 0) {
            const msg = added === 1 ? t('toast.linkAutoDetected') : t('toast.linksAutoDetected', { count: added });
            showToast('📋 ' + msg, 'info');
            triggerPopupNotification(added, urls[urls.length - 1]);
          }
        });

        // Immediately check current clipboard content
        try {
          const currentText = await window.bitkit.clipboard.readText();
          if (currentText) {
            lastCheckedClipboard = currentText.trim();
            const currentUrls = extractUrlsFromText(currentText);
            if (currentUrls.length > 0) {
              let added = 0;
              currentUrls.forEach(u => {
                if (addUrlToBatch(u, true)) added++;
              });
              if (added > 0) {
                const msg = added === 1 ? t('toast.linkAutoDetected') : t('toast.linksAutoDetected', { count: added });
                showToast('📋 ' + msg, 'info');
                triggerPopupNotification(added, currentUrls[currentUrls.length - 1]);
              }
            }
          }
        } catch (e) {}
      }

      renderBatchUI();
    } else {
      if (btnToggleBatchMode) btnToggleBatchMode.classList.remove('active');
      if (batchContainer) batchContainer.style.display = 'none';
      if (urlInput) urlInput.placeholder = t('dl.urlPlaceholder') || "Video veya ses URL'si yapıştır...";
      if (btnAnalyzeSpan) btnAnalyzeSpan.textContent = t('dl.analyze') || "Analiz Et";

      if (window.bitkit?.clipboard) {
        window.bitkit.clipboard.stopWatch();
      }
      if (unsubClipboard) {
        unsubClipboard();
        unsubClipboard = null;
      }

      batchUrls = [];
      renderBatchUI();
    }
  }

  function addUrlToBatch(url, silent = false) {
    url = (url || '').trim();
    if (!url || !isValidUrl(url)) return false;

    if (batchUrls.includes(url)) {
      return false;
    }

    batchUrls.push(url);
    renderBatchUI();

    const btnClearUrl = document.getElementById('btnClearUrl');
    if (btnClearUrl) btnClearUrl.style.display = 'inline-flex';

    if (!silent) {
      showToast('📋 ' + t('toast.linkAutoDetected'), 'info');
      triggerPopupNotification(1, url);
    }

    return true;
  }

  function triggerPopupNotification(addedCount, sampleUrl) {
    if (window.bitkit?.popup?.show) {
      const statusText = addedCount === 1
        ? (t('dl.linkAdded') || "Link Eklendi")
        : (t('toast.linksAutoDetected', { count: addedCount }) || `${addedCount} Link Eklendi`);

      window.bitkit.popup.show({
        title: 'BitKit',
        status: statusText,
        subtitle: t('dl.batchModeTitle') || 'Toplu Linkler',
        message: addedCount === 1 && sampleUrl ? sampleUrl : (addedCount === 1 ? t('toast.linkAutoDetected') : t('toast.linksAutoDetected', { count: addedCount })),
        count: batchUrls.length
      });
    }
  }

  function removeUrlFromBatch(index) {
    if (index >= 0 && index < batchUrls.length) {
      batchUrls.splice(index, 1);
      renderBatchUI();

      const urlInput = document.getElementById('urlInput');
      const btnClearUrl = document.getElementById('btnClearUrl');
      if (batchUrls.length === 0 && (!urlInput || !urlInput.value)) {
        if (btnClearUrl) btnClearUrl.style.display = 'none';
      }
    }
  }

  function clearBatchUrls() {
    batchUrls = [];
    renderBatchUI();

    const urlInput = document.getElementById('urlInput');
    const btnClearUrl = document.getElementById('btnClearUrl');
    if (!urlInput || !urlInput.value) {
      if (btnClearUrl) btnClearUrl.style.display = 'none';
    }
  }

  function renderBatchUI() {
    const batchList = document.getElementById('batchLinkList');
    const batchBadge = document.getElementById('batchBadge');
    const batchListeningBanner = document.getElementById('batchListeningBanner');
    const batchHeader = document.getElementById('batchHeader');
    const batchCountLabel = document.getElementById('batchCountLabel');
    const btnAnalyzeSpan = document.querySelector('#btnAnalyze span');

    // Update pills
    if (batchList) {
      batchList.textContent = '';
      batchUrls.forEach((url, index) => {
        const pill = document.createElement('div');
        pill.className = 'batch-pill';
        pill.title = t('dl.clearUrl') || 'Kaldır';
        pill.onclick = (e) => {
          e.stopPropagation();
          removeUrlFromBatch(index);
        };

        // Link icon
        const iconSpan = document.createElement('span');
        iconSpan.style.cssText = 'display:flex; align-items:center; color:var(--accent-teal); flex-shrink:0; pointer-events:none;';
        setSafeHtml(iconSpan, '<svg fill="none" height="13" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="13"><circle cx="12" cy="12" r="10"></circle><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>');

        // Text
        const textSpan = document.createElement('span');
        textSpan.className = 'batch-url-text';
        textSpan.style.pointerEvents = 'none';
        textSpan.textContent = url;

        // Remove button (icon)
        const removeBtn = document.createElement('span');
        removeBtn.className = 'batch-pill-remove';
        removeBtn.style.pointerEvents = 'none';
        setSafeHtml(removeBtn, '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><path d="M18 6L6 18M6 6l12 12"></path></svg>');

        pill.appendChild(iconSpan);
        pill.appendChild(textSpan);
        pill.appendChild(removeBtn);
        batchList.appendChild(pill);
      });
    }

    // Update count badge on batch toggle button
    if (batchBadge) {
      if (isBatchMode && batchUrls.length > 0) {
        batchBadge.textContent = batchUrls.length;
        batchBadge.style.display = 'flex';
      } else {
        batchBadge.style.display = 'none';
      }
    }

    // Toggle listening banner vs header
    if (isBatchMode) {
      if (batchUrls.length === 0) {
        if (batchListeningBanner) batchListeningBanner.style.display = 'flex';
        if (batchHeader) batchHeader.style.display = 'none';
      } else {
        if (batchListeningBanner) batchListeningBanner.style.display = 'none';
        if (batchHeader) batchHeader.style.display = 'flex';
        if (batchCountLabel) {
          batchCountLabel.textContent = t('dl.batchLinksCount', { count: batchUrls.length }) || `${batchUrls.length} link toplandı`;
        }
      }
    }

    // Update Analyze Button label
    if (btnAnalyzeSpan) {
      if (isBatchMode) {
        const base = t('dl.analyzeBatch') || "Toplu Analiz Et";
        btnAnalyzeSpan.textContent = batchUrls.length > 0 ? `${base} (${batchUrls.length})` : base;
      } else {
        btnAnalyzeSpan.textContent = t('dl.analyze') || "Analiz Et";
      }
    }
  }

  // Export module
  window.initBatchManager = initBatchManager;
})();
