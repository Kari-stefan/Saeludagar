import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// AGENT_START §8: one random token per session. Views call csrfToken() for the _csrf form field;
// the token is made the first time a page needs it, which starts the session. BR-70: the header
// calls existingCsrfToken() for a guest instead, which never makes one, so opening a page does not
// start a session.
export function csrfToken(req, res, next) {
  res.locals.csrfToken = () => {
    req.session.csrfToken ??= crypto.randomBytes(32).toString('base64url');
    return req.session.csrfToken;
  };
  res.locals.existingCsrfToken = () => req.session.csrfToken ?? '';
  next();
}

// BR-70: the language and theme switches only store a guest's display preference, and a guest
// may have no token yet, so they are not checked while nobody is logged in, but only when they
// come from the site's own pages. A form on another site arrives without the visitor's cookie, and
// answering it would replace their session with a new one.
const GUEST_PREFERENCE_ROUTES = new Set(['/language', '/theme']);

// The browser's Sec-Fetch-Site header says where a request comes from, or else its Origin header
// does. A request with neither (not from a browser) is let through as before.
function fromOwnSite(req) {
  const site = req.get('Sec-Fetch-Site');
  if (site !== undefined) return site === 'same-origin';
  // The site's own forms send "Origin: null", because its pages say Referrer-Policy: no-referrer,
  // so "null" tells nothing and counts as no header. Only a named other origin is refused here.
  const origin = req.get('Origin');
  if (origin !== undefined && origin !== 'null') return origin === `${req.protocol}://${req.get('host')}`;
  return true;
}

// Every request that is not a GET must send the token as _csrf or in an X-CSRF-Token header.
export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.user && req.method === 'POST' && GUEST_PREFERENCE_ROUTES.has(req.baseUrl + req.path) && fromOwnSite(req)) return next();
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
