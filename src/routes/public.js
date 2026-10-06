import express from 'express';
import { LANGUAGES } from '../i18n/index.js';
import { safeReturnPath } from '../middleware/language.js';

export function publicRouter() {
  const router = express.Router();

  router.get('/', (req, res) => res.render('public/home'));
  router.get('/events/:id', (req, res) => res.render('public/event'));

  router.post('/language', (req, res) => {
    if (LANGUAGES.includes(req.body?.lang)) req.session.lang = req.body.lang;
    res.redirect(303, safeReturnPath(req.body?.returnTo));
  });

  return router;
}
