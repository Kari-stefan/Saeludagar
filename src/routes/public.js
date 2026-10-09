import express from 'express';
import { LANGUAGES } from '../i18n/index.js';
import { safeReturnPath } from '../middleware/language.js';
import { eventAccess, getEvent, publishedEvents } from '../services/events.js';
import { brautList } from '../services/import.js';
import { getSettings } from '../services/settings.js';

export function publicRouter({ db }) {
  const router = express.Router();

  // §6 front page: the Sæludagar days and the published events, filtered by braut (BR-23, BR-25).
  router.get('/', (req, res) => {
    const brautir = brautList(db);
    const braut = brautir.includes(req.query.braut) ? req.query.braut : null;
    res.render('public/home', { days: getSettings(db).days, brautir, braut, events: publishedEvents(db, braut) });
  });

  // §6 event page: published events, and drafts for those who may preview them (BR-22, BR-23).
  router.get('/events/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const event = Number.isSafeInteger(id) ? getEvent(db, id) : undefined;
    if (!event || (event.status !== 'published' && !eventAccess(db, req.user, event))) return next();
    res.render('public/event', { event });
  });

  router.post('/language', (req, res) => {
    if (LANGUAGES.includes(req.body?.lang)) req.session.lang = req.body.lang;
    res.redirect(303, safeReturnPath(req.body?.returnTo));
  });

  return router;
}
