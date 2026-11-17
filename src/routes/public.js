import express from 'express';
import {
  MAX_POINTS_PER_COURSE, MAX_SIGNUPS_PER_DAY, MAX_SIGNUPS_PER_STUDENT, POINTS_PER_ATTENDANCE,
} from '../config.js';
import { LANGUAGES } from '../i18n/index.js';
import { setFlash } from '../middleware/flash.js';
import { safeReturnPath, THEMES } from '../middleware/language.js';
import {
  browseEvents, eventAccess, eventFilters, FILTER_KEYS, filterEvents, getEvent, publishedEvents, searchTerm, SORTS, sortOrder,
  teacherEvents,
} from '../services/events.js';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_EVENT } from '../services/images.js';
import { brautList } from '../services/import.js';
import { getSettings } from '../services/settings.js';
import {
  cancelSignup, eventPeople, signupFor, signUp, signupWindow, studentSignups,
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

// BR-66: a sign-up from an event card comes back to the front page, with its search and filters.
// Only that page: anything else goes to the event's own page, as a sign-up there does.
function frontPageReturn(value) {
  if (value !== '/' && !(typeof value === 'string' && value.startsWith('/?'))) return null;
  return safeReturnPath(value);
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

  // §6 front page: the published events (BR-23), with name search, the filters in "Sía" and the
  // orders in "Raða" (BR-25, BR-63). A student sees "Þínir viðburðir" above "Aðrir viðburðir", each
  // list with its own search and order: q, sort, braut and the filters for the other events, mq
  // and msort for their own (BR-64). Those who can manage events see theirs, and the
  // "Nýr viðburður" button and dialog (§6).
  router.get('/', (req, res) => {
    const { lang } = res.locals;
    const { days } = getSettings(db);
    const brautir = brautList(db);
    const braut = brautir.includes(req.query.braut) ? req.query.braut : null;
    const filters = eventFilters(req.query);
    // A date outside the Sæludagar days cannot be chosen in "Sía", and would leave its date field
    // invalid and the whole form unsendable, so it is ignored like any other odd value.
    for (const key of ['from', 'to']) {
      if (filters[key] < days[0] || filters[key] > days.at(-1)) delete filters[key];
    }
    const others = { search: searchTerm(req.query.q), sort: sortOrder(req.query.sort), braut, filters };
    const student = req.user?.role === 'student';
    const mine = student ? { search: searchTerm(req.query.mq), sort: sortOrder(req.query.msort) } : null;
    const signedUp = new Map((student ? studentSignups(db, req.user.id) : []).map((signup) => [signup.id, signup]));

    others.filtered = Boolean(others.search || braut || Object.keys(filters).length > 0);
    others.groups = groupByDay(
      browseEvents(filterEvents(publishedEvents(db, braut).filter((event) => !signedUp.has(event.id)), filters), { ...others, lang }),
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
      ...filters,
      mq: mine?.search ?? '',
      msort: mine && mine.sort !== SORTS[0] ? mine.sort : '',
    }).filter(([, value]) => value));
    const canManage = req.user?.canManageEvents || req.user?.isAdmin;
    res.render('public/home', {
      days,
      brautir,
      others,
      mine,
      state,
      sorts: SORTS,
      filterKeys: FILTER_KEYS,
      window: signupWindow(db),
      signedUp,
      maxSignups: MAX_SIGNUPS_PER_STUDENT,
      managed: canManage ? teacherEvents(db, req.user.id) : null,
      maxImages: MAX_IMAGES_PER_EVENT,
      maxImageBytes: MAX_IMAGE_BYTES,
    });
  });

  // §6 "Upplýsingar": what Sæludagar is and how the site works, with the current dates.
  router.get('/info', (req, res) => {
    res.render('public/info', {
      settings: getSettings(db),
      numbers: {
        max: MAX_SIGNUPS_PER_STUDENT,
        points: POINTS_PER_ATTENDANCE,
        perCourse: MAX_POINTS_PER_COURSE,
        perDay: MAX_SIGNUPS_PER_DAY,
        total: MAX_SIGNUPS_PER_STUDENT * POINTS_PER_ATTENDANCE,
      },
    });
  });

  // §6 event page: published events, and drafts for those who may preview them (BR-22, BR-23).
  // Students see "Skrá mig" or "Afskrá mig"; guests a link to log in that comes back here. Who
  // runs the event and who is in it follow BR-68.
  router.get('/events/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const event = Number.isSafeInteger(id) ? getEvent(db, id) : undefined;
    const access = event ? eventAccess(db, req.user, event) : null;
    if (!event || (event.status !== 'published' && !access)) return next();
    const student = req.user?.role === 'student';
    res.render('public/event', {
      event,
      window: signupWindow(db),
      signup: student ? signupFor(db, req.user.id, event.id) ?? null : null,
      ...eventPeople(db, event, { loggedIn: Boolean(req.user), access }),
    });
  });

  // BR-31 to BR-36: sign up or cancel, then back to the event page, or the front page for a card
  // (BR-66), with the result.
  router.post('/events/:id', (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return next();
    const page = `/events/${id}`;
    if (!req.user) return res.redirect(303, `/login?next=${encodeURIComponent(page)}`);
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
    res.redirect(303, frontPageReturn(req.body?.returnTo) ?? page);
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
