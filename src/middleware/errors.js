import { DEFAULT_LANGUAGE } from '../i18n/index.js';
import { applyLanguage } from './language.js';

export function notFound(req, res) {
  res.status(404).render('errors/404');
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // Log only the stack: body-parser errors carry the raw form body (kennitala, code) as a property.
  console.error(err?.stack ?? String(err));
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  // The error can happen before the language middleware has run.
  if (!res.locals.t) applyLanguage(req, res, DEFAULT_LANGUAGE);
  const view = status === 403 ? 'errors/403' : status === 404 ? 'errors/404' : 'errors/500';
  res.status(status).render(view);
}
