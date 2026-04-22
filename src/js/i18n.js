
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

function t(key, params = {}) {
  const lang = locales[currentLocale] || {};
  const fb = locales[fallbackLocale] || {};
  let text = lang[key] || fb[key] || key;
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
