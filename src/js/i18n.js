
const locales = {};
let currentLocale = 'tr';
let fallbackLocale = 'tr';

async function loadLocale(lang) {
  if (locales[lang]) return locales[lang];

  try {
    const resp = await fetch(`locales/${lang}.json?v=${Date.now()}`);
    if (!resp.ok) throw new Error(`Locale ${lang} not found`);
    locales[lang] = await resp.json();
    return locales[lang];
  } catch (e) {
    console.warn(`[i18n] Failed to load locale: ${lang}`, e);
    return null;
  }
}

async function initI18n(lang = 'tr') {
  currentLocale = lang;
  await loadLocale(fallbackLocale);
  if (lang !== fallbackLocale) {
    await loadLocale(lang);
  }
  applyTranslations();
}

function resolveKey(dict, key) {
  if (!dict || !key) return undefined;
  if (typeof dict[key] === 'string') return dict[key];
  if (key.includes('.')) {
    const parts = key.split('.');
    let cur = dict;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) {
        cur = cur[part];
      } else {
        return undefined;
      }
    }
    if (typeof cur === 'string') return cur;
  }
  return undefined;
}

function t(key, params = {}) {
  const lang = locales[currentLocale] || {};
  const fb = locales[fallbackLocale] || {};
  let text = resolveKey(lang, key) || resolveKey(fb, key) || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{{${k}}}`, v);
  }
  return text;
}

async function setLocale(locale) {
  await loadLocale(locale);
  if (!locales[locale]) return;
  currentLocale = locale;
  document.documentElement.lang = locale;
  applyTranslations();
}

function applyTranslations() {

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });

  document.querySelectorAll('[data-i18n-tip]').forEach(el => {
    el.setAttribute('data-tooltip', t(el.dataset.i18nTip));
  });

  document.querySelectorAll('[data-i18n-label]').forEach(el => {
    el.label = t(el.dataset.i18nLabel);
  });
}

function getAvailableLocales() {
  return Object.keys(locales);
}
