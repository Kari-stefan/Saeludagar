import { MAX_SIGNUPS_PER_DAY, MAX_SIGNUPS_PER_STUDENT } from '../config.js';
import { toIso } from '../db/index.js';
import { audit } from './audit.js';
import { queueEmail } from './email.js';

// BR-31: students sign up and cancel only between the opening and closing times. `phase` is
// 'notSet', 'before', 'open' or 'after', for the messages on the pages.
export function signupWindow(db, now = new Date()) {
  const { signup_opens_at: opens, signup_closes_at: closes } = db
    .prepare('SELECT signup_opens_at, signup_closes_at FROM settings WHERE id = 1').get();
  const t = now.getTime();
  let phase = 'notSet';
  if (opens && closes) phase = t < Date.parse(opens) ? 'before' : t < Date.parse(closes) ? 'open' : 'after';
  return { opens, closes, phase, open: phase === 'open' };
}

// BR-33: same date, and each starts before the other ends. Back-to-back events do not overlap.
export function overlaps(a, b) {
  return a.event_date === b.event_date && a.start_time < b.end_time && b.start_time < a.end_time;
}

// BR-32, BR-34, BR-35: every check and the insert run in one BEGIN IMMEDIATE transaction, so
// simultaneous sign-ups can never push an event past its maximum. Returns { ok } or { error }
// (an i18n key), with `params` or the clashing `event` for the message.
export function signUp(db, studentId, eventId, now = new Date()) {
  return db.transaction(() => {
    if (!signupWindow(db, now).open) return { error: 'signups.errors.windowClosed' };
    const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").get(eventId);
    if (!event) return { error: 'signups.errors.notAvailable' };
    if (db.prepare('SELECT 1 FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, studentId)) {
      return { error: 'signups.errors.already' };
    }
    const taken = db.prepare('SELECT COUNT(*) FROM registrations WHERE event_id = ?').pluck().get(eventId);
    if (taken >= event.capacity) return { error: 'signups.errors.full' };

    // BR-24: with the flag set, only students of the event's brautir.
    if (event.braut_restricted) {
      const brautir = db.prepare('SELECT braut FROM event_brautir WHERE event_id = ? ORDER BY braut').pluck().all(eventId);
      const braut = db.prepare('SELECT braut FROM users WHERE id = ?').pluck().get(studentId);
      if (!brautir.includes(braut)) return { error: 'signups.errors.braut', params: { brautir: brautir.join(', ') } };
    }

    const blocked = registrationLimits(db, studentId, event, 'signups.errors');
    if (blocked) return blocked;

    db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(eventId, studentId, toIso(now));
    audit(db, 'signup.create', studentId, eventId, studentId, { by: 'student' }); // BR-56
    return { ok: true };
  }).immediate();
}

// BR-36: a student cancels while the window is open, and the place is free at once. A sign-up
// with marked attendance is kept: it carries the attendance and course choice for the export.
export function cancelSignup(db, studentId, eventId, now = new Date()) {
  return db.transaction(() => {
    if (!signupWindow(db, now).open) return { error: 'signups.errors.windowClosed' };
    const signup = db.prepare('SELECT id, attended FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, studentId);
    if (!signup) return { error: 'signups.errors.notSignedUp' };
    if (signup.attended) return { error: 'signups.errors.attended' };
    db.prepare('DELETE FROM registrations WHERE id = ?').run(signup.id);
    audit(db, 'signup.delete', studentId, eventId, studentId, { by: 'student' }); // BR-56
    return { ok: true };
  }).immediate();
}

// "Þínir viðburðir": the student's sign-ups, by date and time.
export function studentSignups(db, studentId) {
  return db.prepare(`SELECT e.id, e.title_is, e.title_en, e.event_date, e.start_time, e.end_time, e.location, r.attended
    FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.student_id = ?
    ORDER BY e.event_date, e.start_time, e.id`).all(studentId);
}

// Whether a student is signed up for an event, with its attendance.
export function signupFor(db, studentId, eventId) {
  return db.prepare('SELECT attended FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, studentId);
}

// Names sort in Icelandic order (Á after A, Þ and Ö at the end), which SQLite's ORDER BY does not do.
const collator = new Intl.Collator('is');
const byName = (a, b) => collator.compare(a.name, b.name);

// Everyone signed up. A student deactivated by a re-import keeps a sign-up with marked attendance
// (BR-17), so `active` is included: emails leave those students out, since the outbox never
// sends to them (BR-03).
// BR-68: who runs the event and who is in it, for the event page. A student who runs it is named
// only to those who manage it (`access`, from eventAccess): for everyone else `manager` is
// null and the page shows the host, so that students never see each other's names (BR-23). The
// owner's email is for logged-in users. The participants are for those who manage the event; for
// everyone else `group` is null and the page shows only the count.
export function eventPeople(db, event, { loggedIn, access }) {
  const named = event.owner_role === 'teacher' || Boolean(access);
  return {
    manager: named ? { name: event.owner_name, email: loggedIn ? event.owner_email : null } : null,
    group: access ? eventParticipants(db, event.id) : null,
  };
}

export function eventParticipants(db, eventId) {
  return db.prepare(`SELECT u.id, u.name, u.braut, u.email, u.active, r.attended
    FROM registrations r JOIN users u ON u.id = r.student_id
    WHERE r.event_id = ?`).all(eventId).sort(byName);
}

const MAX_STUDENT_SEARCH_RESULTS = 20;

// BR-37: the name search ignores case for Icelandic letters too ("þór" finds "Þórunn"), which
// SQLite's LIKE does only for A–Z, so the matching is done here. Results show the name and braut,
// never the kennitala. Students with the same name (ignoring case) and the same braut (no braut
// counts as one) also carry their school email, so they can be told apart; this is decided over
// every match, before the list is cut.
export function searchStudentsForEvent(db, eventId, query) {
  const search = typeof query === 'string' ? query.trim().slice(0, 100) : '';
  if (!search) return { search: '', students: [] };
  const term = search.toLocaleLowerCase('is');
  const matches = db.prepare(`SELECT u.id, u.name, u.braut, u.email
    FROM users u
    WHERE u.role = 'student' AND u.active = 1
      AND NOT EXISTS (
        SELECT 1 FROM registrations r WHERE r.event_id = ? AND r.student_id = u.id
      )`).all(eventId)
    .filter((student) => student.name.toLocaleLowerCase('is').includes(term));
  const sameAs = (student) => JSON.stringify([student.name.toLocaleLowerCase('is'), student.braut ?? null]);
  const counts = new Map();
  for (const student of matches) counts.set(sameAs(student), (counts.get(sameAs(student)) ?? 0) + 1);
  const students = matches
    .map(({ email, ...student }) => (counts.get(sameAs(student)) > 1 ? { ...student, email } : student))
    .sort(byName)
    .slice(0, MAX_STUDENT_SEARCH_RESULTS);
  return { search, students };
}

// BR-32, BR-37, BR-65: the student's own limits, which every sign-up keeps, a teacher's too: at
// most 4 sign-ups, at most 2 on one day, and no overlaps. `messages` is where the i18n keys are.
// Returns null, or { error } with what its message needs.
function registrationLimits(db, studentId, event, messages) {
  const mine = db.prepare(`SELECT e.id, e.title_is, e.title_en, e.event_date, e.start_time, e.end_time
    FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.student_id = ?`).all(studentId);
  if (mine.length >= MAX_SIGNUPS_PER_STUDENT) {
    return { error: `${messages}.limit`, params: { max: MAX_SIGNUPS_PER_STUDENT } };
  }
  if (mine.filter((other) => other.event_date === event.event_date).length >= MAX_SIGNUPS_PER_DAY) {
    return { error: `${messages}.dayLimit`, params: { max: MAX_SIGNUPS_PER_DAY } };
  }
  const clash = mine.find((other) => overlaps(other, event));
  return clash ? { error: `${messages}.overlap`, event: clash } : null;
}

// BR-37: teachers may bypass the event's own limits, but not the student's own: 4 events, 2 on
// one day (BR-65), and no overlaps. As for every sign-up, the event must be published (BR-32): a draft is hidden from
// students. The student gets a signup_added email, queued with the sign-up, which does not say who
// added them (a student who runs the event is never named to other students, BR-68).
// Returns { ok } or { error } (+ params/event for the message).
export function addStudentToEvent(db, teacherId, eventId, studentId, now = new Date()) {
  return db.transaction(() => {
    const event = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'published'").get(eventId);
    if (!event) return { error: 'events.participants.errors.notPublished' };
    if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'student' AND active = 1`).get(studentId)) {
      return { error: 'events.participants.errors.notFound' };
    }
    if (db.prepare('SELECT 1 FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, studentId)) {
      return { error: 'events.participants.errors.already' };
    }
    const blocked = registrationLimits(db, studentId, event, 'events.participants.errors');
    if (blocked) return blocked;
    db.prepare('INSERT INTO registrations (event_id, student_id, added_by, created_at) VALUES (?, ?, ?, ?)')
      .run(eventId, studentId, teacherId, toIso(now));
    audit(db, 'signup.create', teacherId, eventId, studentId, { by: 'event_manager' }); // BR-56
    const details = ['id', 'title_is', 'title_en', 'event_date', 'start_time', 'end_time', 'location'];
    queueEmail(db, { kind: 'signup_added', userId: studentId, payload: { event: Object.fromEntries(details.map((key) => [key, event[key]])) } });
    return { ok: true };
  }).immediate();
}

export function removeStudentFromEvent(db, teacherId, eventId, studentId) {
  return db.transaction(() => {
    const signup = db.prepare('SELECT id, attended FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, studentId);
    if (!signup) return { error: 'events.participants.errors.notSignedUp' };
    if (signup.attended) return { error: 'events.participants.errors.attended' };
    db.prepare('DELETE FROM registrations WHERE id = ?').run(signup.id);
    audit(db, 'signup.delete', teacherId, eventId, studentId, { by: 'event_manager' }); // BR-56
    return { ok: true };
  }).immediate();
}
