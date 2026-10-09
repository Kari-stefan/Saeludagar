import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// AGENT_START §8: one random token per session. Views call csrfToken() for the _csrf form field;
// the token is made the first time a page needs it.
export function csrfToken(req, res, next) {
  res.locals.csrfToken = () => {
    req.session.csrfToken ??= crypto.randomBytes(32).toString('base64url');
    return req.session.csrfToken;
  };
  next();
}

// Every request that is not a GET must send the token as _csrf or in an X-CSRF-Token header.
export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session.csrfToken;
  const sent = req.body?._csrf ?? req.get('X-CSRF-Token');
  if (expected && typeof sent === 'string' && sameToken(sent, expected)) return next();
  res.status(403).render('errors/403', { titleKey: 'errors.csrfTitle', textKey: 'errors.csrfText' });
}

// File uploads are multipart, which only multer can read, inside the route. Those routes are listed
// here and run verifyCsrf themselves, right after multer. Any other multipart request is checked
// now, which refuses it, because its body cannot be read.
const UPLOAD_ROUTES = [/^\/admin\/import$/, /^\/teacher\/events\/(new|\d+\/edit)$/];

export function verifyCsrfUnlessUpload(req, res, next) {
  if (req.is('multipart/form-data') && UPLOAD_ROUTES.some((route) => route.test(req.path))) return next();
  verifyCsrf(req, res, next);
}

function sameToken(sent, expected) {
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
