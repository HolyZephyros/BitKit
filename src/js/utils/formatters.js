
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(timestamp) {
  const localeMap = { tr: 'tr-TR', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ja: 'ja-JP', zh: 'zh-CN', ko: 'ko-KR', ru: 'ru-RU', ar: 'ar-SA' };
  const locale = (typeof currentLocale !== 'undefined' && localeMap[currentLocale]) || 'tr-TR';
  return new Date(timestamp).toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function truncate(str, maxLength = 50) {
  if (!str) return '';
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getPlatformName(extractor) {
  const map = {
    'youtube': 'YouTube',
    'twitter': 'Twitter/X',
    'instagram': 'Instagram',
    'tiktok': 'TikTok',
    'twitch': 'Twitch',
    'reddit': 'Reddit',
    'vimeo': 'Vimeo',
    'dailymotion': 'Dailymotion',
    'soundcloud': 'SoundCloud',
    'bilibili': 'Bilibili'
  };
  const key = (extractor || '').toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k)) return v;
  }
  return extractor || (typeof t === 'function' ? t('dl.unknownPlatform') : 'Unknown');
}
