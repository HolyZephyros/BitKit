
window.handleError = function(error, context = 'General') {
  const errMsg = error.message || error;
  const errStack = typeof error.stack === 'string' ? error.stack : '';

  if (window.bitkit && window.bitkit.log) {
    window.bitkit.log.error(`[${context}]`, errMsg, errStack);
  } else {
    console.error(`[${context}]`, errMsg);
  }

  const msgStr = String(errMsg).toLowerCase();

  if (msgStr.includes('enotfound') || msgStr.includes('etimedout') || msgStr.includes('econnrefused') || msgStr.includes('fetch failed') || msgStr.includes('network error') || msgStr.includes('timeout') || msgStr.includes('name not resolved')) {
    return 'error.network';
  }
  if (msgStr.includes('403') || msgStr.includes('forbidden') || msgStr.includes('sign in') || msgStr.includes('login required') || msgStr.includes('unauthorized') || msgStr.includes('age restricted') || msgStr.includes('age-restricted') || msgStr.includes('confirm your age') || msgStr.includes('video unavailable') || msgStr.includes('unsupported url')) {
    return 'error.auth';
  }
  if (msgStr.includes('eperm') || msgStr.includes('eacces') || msgStr.includes('enoent') || msgStr.includes('permission denied') || msgStr.includes('enospc')) {
    return 'error.filesystem';
  }
  if (msgStr.includes('ffmpeg is not installed') || msgStr.includes('ffprobe is not installed') || msgStr.includes('yt-dlp.exe not found') || msgStr.includes('spawn enoent') || msgStr.includes('binary not found')) {
    return 'error.dependency';
  }
  if (msgStr.includes('not packed') || msgStr.includes('dev update config')) {
    return 'toast.updateDevMode';
  }

  if (msgStr.includes('drm') || msgStr.includes('widevine') || msgStr.includes('playready') || msgStr.includes('fairplay') || msgStr.includes('drm protection')) {
    return 'error.drm';
  }

  return 'error.generic';
};

window.showErrorToast = function(error, context = 'General') {
  const i18nKey = window.handleError(error, context);

  if (typeof window.showToast === 'function' && typeof window.t === 'function') {
    if (i18nKey === 'toast.updateDevMode') {
      window.showToast(window.t(i18nKey), 'warning');
    } else if (i18nKey === 'error.auth' && window.state && window.state.settings && window.state.settings.cookiesPath) {
      const expiredMsg = window.t('error.authExpired');
      const fallbackMsg = 'Erişim Reddedildi. Yüklediğiniz cookies.txt dosyasının süresi dolmuş veya geçersiz olabilir. Lütfen tarayıcıdan yeni bir dosya çıkartıp Ayarlar menüsünden tekrar seçin.';
      window.showToast(expiredMsg === 'error.authExpired' ? fallbackMsg : expiredMsg, 'error', 8000);
    } else {
      window.showToast(window.t(i18nKey), 'error', 6000);
    }
  }
  return i18nKey;
};
