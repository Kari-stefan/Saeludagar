import express from 'express';
import { DEFAULT_LANGUAGE } from '../i18n/index.js';
import { homePathFor, STUDENT_SESSION_MS, TEACHER_SESSION_MS } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { normalizeKennitala } from '../services/crypto.js';

function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function authRouter({ accounts }) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, homePathFor(req.user));
    res.render('public/login');
  });

  // BR-01 to BR-05 and AGENT_START §8. The kennitala is never echoed back into the form.
  router.post('/login', async (req, res) => {
    const body = req.body ?? {}; // undefined when the request has no form body
    const kennitala = normalizeKennitala(body.kennitala);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const errors = {};
    if (!kennitala) errors.kennitala = 'validation.kennitala';
    if (!/^\d{6}$/.test(code)) errors.code = 'login.errors.code';
    if (Object.keys(errors).length > 0) return res.status(400).render('public/login', { errors });

    const user = await accounts.login(kennitala, code);
    if (!user) return res.status(401).render('public/login', { failed: true });

    // A new session ID at login (§9, item 6), keeping the language the visitor chose (BR-59).
    const lang = req.session.lang ?? DEFAULT_LANGUAGE;
    await regenerate(req);
    Object.assign(req.session, { userId: user.id, role: user.role, isAdmin: user.isAdmin, lang });
    req.session.cookie.maxAge = user.role === 'student' ? STUDENT_SESSION_MS : TEACHER_SESSION_MS; // BR-09
    res.redirect(303, homePathFor(user));
  });

  // A logged-in user goes to their home page, as on /login, where the confirmation would not show.
  router.get('/login/new-code', (req, res) => {
    if (req.user) return res.redirect(303, homePathFor(req.user));
    res.render('public/new-code');
  });

  // BR-08: the same message whatever happens, shown on the login page.
  router.post('/login/new-code', (req, res) => {
    if (req.user) return res.redirect(303, homePathFor(req.user));
    const kennitala = normalizeKennitala(req.body?.kennitala);
    if (!kennitala) {
      return res.status(400).render('public/new-code', { errors: { kennitala: 'validation.kennitala' } });
    }
    accounts.requestNewCode(kennitala);
    setFlash(req, 'info', 'newCode.sent');
    res.redirect(303, '/login');
  });

  // The old session is destroyed (§9, item 6); the new one only remembers the language.
  router.post('/logout', async (req, res) => {
    const { lang } = req.session;
    await regenerate(req);
    if (lang) req.session.lang = lang;
    res.redirect(303, '/');
  });

  return router;
}
