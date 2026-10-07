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

function sameToken(sent, expected) {
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
