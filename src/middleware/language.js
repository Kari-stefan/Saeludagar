import { DEFAULT_LANGUAGE, LANGUAGES, translator } from '../i18n/index.js';

export function applyLanguage(req, res, lang) {
  const t = translator(lang);
  const { schoolName } = req.app.locals;
  res.locals.lang = lang;
  res.locals.t = t;
  res.locals.siteTitle = schoolName ? `${t('site.name')} – ${schoolName}` : t('site.name');
  res.locals.currentPath = req.originalUrl;
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
