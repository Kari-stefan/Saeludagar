import {
  DEFAULT_LANGUAGE, eventText, formatDate, formatDateTime, formatFee, formatTimeRange, LANGUAGES, translator,
} from '../i18n/index.js';

export const THEMES = ['light', 'dark'];

export function applyLanguage(req, res, lang) {
  const t = translator(lang);
  const { schoolName } = req.app.locals;
  res.locals.lang = lang;
  res.locals.t = t;
  res.locals.formatDate = (day) => formatDate(lang, day);
  res.locals.formatDateTime = (iso) => formatDateTime(lang, iso);
  res.locals.formatTimeRange = (start, end) => formatTimeRange(lang, start, end);
  res.locals.formatFee = (isk) => formatFee(lang, isk);
  res.locals.eventText = (event, field) => eventText(lang, event, field);
  res.locals.siteTitle = schoolName ? `${t('site.name')} – ${schoolName}` : t('site.name');
  res.locals.currentPath = req.originalUrl;
  // For the header: the page's path without the query (to mark the current link), and the
  // chosen theme (BR-62), or null to follow the device.
  res.locals.navPath = req.path;
  res.locals.theme = THEMES.includes(req.session?.theme) ? req.session.theme : null;
}

// BR-59: the chosen language lives in the session; Icelandic is the default.
export function languageMiddleware(req, res, next) {
  applyLanguage(req, res, LANGUAGES.includes(req.session?.lang) ? req.session.lang : DEFAULT_LANGUAGE);
  next();
}

// Only same-site paths, so the language switch cannot redirect off-site.
export function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > 2000) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}
