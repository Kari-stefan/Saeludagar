import express from 'express';
import { LANGUAGES } from '../i18n/index.js';
import { setFlash } from '../middleware/flash.js';
import { safeReturnPath } from '../middleware/language.js';
import { eventAccess, getEvent, publishedEvents } from '../services/events.js';
import { brautList } from '../services/import.js';
import { getSettings } from '../services/settings.js';
import { cancelSignup, signupFor, signUp, signupWindow } from '../services/signups.js';

// The message for a refused sign-up or cancel (BR-34); an overlap names the other event.
export function refusalParams(res, result) {
  if (!result.event) return result.params ?? {};
  const other = result.event;
  return {
    title: res.locals.eventText(other, 'title'),
    when: `${res.locals.formatDate(other.event_date)}, ${res.locals.formatTimeRange(other.start_time, other.end_time)}`,
  };
}

export function publicRouter({ db }) {
  const router = express.Router();

  // §6 front page: the Sæludagar days and the published events, filtered by braut (BR-23, BR-25).
  router.get('/', (req, res) => {
    const brautir = brautList(db);
    const braut = brautir.includes(req.query.braut) ? req.query.braut : null;
    res.render('public/home', { days: getSettings(db).days, brautir, braut, events: publishedEvents(db, braut) });
  });

  // §6 event page: published events, and drafts for those who may preview them (BR-22, BR-23).
  // Students see "Skrá mig" or "Afskrá mig"; guests a link to log in that comes back here.
  router.get('/events/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const event = Number.isSafeInteger(id) ? getEvent(db, id) : undefined;
    if (!event || (event.status !== 'published' && !eventAccess(db, req.user, event))) return next();
    const student = req.user?.role === 'student';
    res.render('public/event', {
      event,
      window: signupWindow(db),
      signup: student ? signupFor(db, req.user.id, event.id) ?? null : null,
    });
  });

  // BR-31 to BR-36: sign up or cancel, then back to the event page with the result.
  router.post('/events/:id', (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return next();
    const back = `/events/${id}`;
    if (!req.user) return res.redirect(303, `/login?next=${encodeURIComponent(back)}`);
    if (req.user.role !== 'student') return res.status(403).render('errors/403');
    // An event that is gone (deleted, BR-29) or not published has no page to come back to.
    const event = getEvent(db, id);
    if (!event || event.status !== 'published') return next();

    const action = req.body?.action;
    let result;
    if (action === 'signup') result = signUp(db, req.user.id, id);
    else if (action === 'cancel') result = cancelSignup(db, req.user.id, id);
    else return next(Object.assign(new Error('HTTP 400'), { status: 400 }));

    if (result.error === 'signups.errors.notAvailable') return next();
    if (result.ok) setFlash(req, 'success', action === 'signup' ? 'signups.signedUp' : 'signups.cancelled');
    else setFlash(req, 'error', result.error, refusalParams(res, result));
    res.redirect(303, back);
  });

  router.post('/language', (req, res) => {
    if (LANGUAGES.includes(req.body?.lang)) req.session.lang = req.body.lang;
    res.redirect(303, safeReturnPath(req.body?.returnTo));
  });

  return router;
}
