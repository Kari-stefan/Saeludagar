import express from 'express';
import { MAX_POINTS_PER_COURSE, MAX_SIGNUPS_PER_STUDENT, POINTS_PER_ATTENDANCE } from '../config.js';
import { LANGUAGES } from '../i18n/index.js';
import { setFlash } from '../middleware/flash.js';
import { safeReturnPath, THEMES } from '../middleware/language.js';
import {
  browseEvents, eventAccess, getEvent, publishedEvents, searchTerm, SORTS, sortOrder,
} from '../services/events.js';
import { brautList } from '../services/import.js';
import { getSettings } from '../services/settings.js';
import {
  cancelSignup, signupFor, signUp, signupWindow, studentSignups,
} from '../services/signups.js';

// The message for a refused sign-up or cancel (BR-34); an overlap names the other event.
export function refusalParams(res, result) {
  if (!result.event) return result.params ?? {};
  const other = result.event;
  return {
    title: res.locals.eventText(other, 'title'),
    when: `${res.locals.formatDate(other.event_date)}, ${res.locals.formatTimeRange(other.start_time, other.end_time)}`,
  };
}

// §6: sorted by date, the events are grouped by day, and a day without events is listed only
// when nothing is filtered. Any other order gives one group with no day.
function groupByDay(events, { days, sort, filtered }) {
  if (sort !== 'date' && sort !== 'date-desc') return [{ day: null, events }];
  const order = [...new Set([...(filtered ? [] : days), ...events.map((event) => event.event_date)])].sort();
  if (sort === 'date-desc') order.reverse();
  return order.map((day) => ({ day, events: events.filter((event) => event.event_date === day) }));
}

export function publicRouter({ db }) {
  const router = express.Router();

  // §6 front page: the published events (BR-23), with name search, sort and the braut filter
  // (BR-25, BR-63). A student sees "Þínir viðburðir" above "Aðrir viðburðir", each list with its
  // own search and sort: q, sort and braut for the other events, mq and msort for their own (BR-64).
  router.get('/', (req, res) => {
    const { lang } = res.locals;
    const { days } = getSettings(db);
    const brautir = brautList(db);
    const braut = brautir.includes(req.query.braut) ? req.query.braut : null;
    const others = { search: searchTerm(req.query.q), sort: sortOrder(req.query.sort), braut };
    const student = req.user?.role === 'student';
    const mine = student ? { search: searchTerm(req.query.mq), sort: sortOrder(req.query.msort) } : null;
    const signedUp = new Set(student ? studentSignups(db, req.user.id).map((signup) => signup.id) : []);

    others.filtered = Boolean(others.search || braut);
    others.groups = groupByDay(
      browseEvents(publishedEvents(db, braut).filter((event) => !signedUp.has(event.id)), { ...others, lang }),
      { days, sort: others.sort, filtered: others.filtered },
    );
    if (mine) {
      const own = publishedEvents(db).filter((event) => signedUp.has(event.id));
      Object.assign(mine, { total: own.length, events: browseEvents(own, { ...mine, lang }) });
    }
    // Every choice that is not the default, so each list's form keeps the other's.
    const state = Object.fromEntries(Object.entries({
      q: others.search,
      sort: others.sort === SORTS[0] ? '' : others.sort,
      braut: braut ?? '',
      mq: mine?.search ?? '',
      msort: mine && mine.sort !== SORTS[0] ? mine.sort : '',
    }).filter(([, value]) => value));
    res.render('public/home', { days, brautir, others, mine, state, sorts: SORTS });
  });

  // §6 "Upplýsingar": what Sæludagar is and how the site works, with the current dates.
  router.get('/info', (req, res) => {
    res.render('public/info', {
      settings: getSettings(db),
      numbers: {
        max: MAX_SIGNUPS_PER_STUDENT,
        points: POINTS_PER_ATTENDANCE,
        perCourse: MAX_POINTS_PER_COURSE,
        total: MAX_SIGNUPS_PER_STUDENT * POINTS_PER_ATTENDANCE,
      },
    });
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

  // BR-62: light or dark, kept in the session like the language.
  router.post('/theme', (req, res) => {
    if (THEMES.includes(req.body?.theme)) req.session.theme = req.body.theme;
    res.redirect(303, safeReturnPath(req.body?.returnTo));
  });

  return router;
}
