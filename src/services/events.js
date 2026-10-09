import { toIso } from '../db/index.js';
import { queueEmail } from './email.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WHOLE_NUMBER = /^\d{1,9}$/;
// Control characters other than line breaks and tabs.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const collator = new Intl.Collator('is');

// The event form uses the column names as field names, so a form re-renders from its own values.
const TEXT_FIELDS = ['title_is', 'title_en', 'host', 'location'];
const LONG_FIELDS = ['description_is', 'description_en'];

// BR-20, BR-21, BR-24, BR-26 and BR-28. `brautir` is what may be chosen (BR-18, plus the event's
// own); `signups` is the event's current number of sign-ups. Returns { values, errors }, with
// errors as i18n keys by field.
export function validateEvent(input, { days, brautir, signups = 0 }) {
  const values = {};
  const errors = {};
  for (const name of [...TEXT_FIELDS, ...LONG_FIELDS]) {
    const raw = typeof input[name] === 'string' ? input[name].replace(/\r\n?/g, '\n').trim() : '';
    values[name] = raw;
    const max = LONG_FIELDS.includes(name) ? 5000 : 200;
    if (raw.length > max) errors[name] = 'events.errors.tooLong';
    else if (CONTROL_CHARACTERS.test(raw) || (!LONG_FIELDS.includes(name) && raw.includes('\n'))) errors[name] = 'events.errors.invalid';
  }
  for (const name of ['title_is', 'description_is', 'host', 'location']) {
    if (!values[name]) errors[name] ??= 'events.errors.required';
  }

  values.capacity = String(input.capacity ?? '').trim();
  if (!WHOLE_NUMBER.test(values.capacity) || Number(values.capacity) < 1) errors.capacity = 'events.errors.capacity';
  else if (Number(values.capacity) < signups) errors.capacity = 'events.errors.capacityBelowSignups';

  values.fee_isk = String(input.fee_isk ?? '').trim();
  if (values.fee_isk && !WHOLE_NUMBER.test(values.fee_isk)) errors.fee_isk = 'events.errors.fee';

  values.event_date = String(input.event_date ?? '');
  if (!days.includes(values.event_date)) errors.event_date = 'events.errors.date';

  values.start_time = String(input.start_time ?? '').trim();
  values.end_time = String(input.end_time ?? '').trim();
  if (!TIME_PATTERN.test(values.start_time)) errors.start_time = 'events.errors.time';
  if (!TIME_PATTERN.test(values.end_time)) errors.end_time = 'events.errors.time';
  else if (!errors.start_time && values.end_time <= values.start_time) errors.end_time = 'events.errors.endBeforeStart';

  values.brautir = [...new Set([].concat(input.brautir ?? []).filter((b) => typeof b === 'string'))];
  if (values.brautir.some((b) => !brautir.includes(b))) errors.brautir = 'events.errors.braut';
  values.braut_restricted = input.braut_restricted === '1';
  if (values.braut_restricted && values.brautir.length === 0) errors.brautir = 'events.errors.restrictedWithoutBraut';

  return { values, errors };
}

// The values as stored: English and fee may be left empty.
function columns(values) {
  return {
    title_is: values.title_is,
    title_en: values.title_en || null,
    description_is: values.description_is,
    description_en: values.description_en || null,
    host: values.host,
    location: values.location,
    capacity: Number(values.capacity),
    fee_isk: values.fee_isk ? Number(values.fee_isk) : 0,
    event_date: values.event_date,
    start_time: values.start_time,
    end_time: values.end_time,
    braut_restricted: values.braut_restricted ? 1 : 0,
  };
}

function withBrautir(db, events) {
  const brautir = db.prepare('SELECT braut FROM event_brautir WHERE event_id = ?').pluck();
  return events.map((event) => ({ ...event, brautir: brautir.all(event.id).sort(collator.compare) }));
}

// One event with its brautir, co-teachers and counts, or undefined.
export function getEvent(db, id) {
  const event = db.prepare(`SELECT e.*, u.name AS owner_name, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS signups,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.attended = 1) AS attended
    FROM events e JOIN users u ON u.id = e.owner_id WHERE e.id = ?`).get(id);
  if (!event) return undefined;
  const [withLists] = withBrautir(db, [event]);
  withLists.coteachers = db.prepare(`SELECT u.id, u.name FROM event_coteachers c JOIN users u ON u.id = c.teacher_id
    WHERE c.event_id = ?`).all(id).sort((a, b) => collator.compare(a.name, b.name));
  return withLists;
}

// §8 authorization: 'owner' for the owner or an admin, 'editor' for a co-teacher, otherwise null.
export function eventAccess(db, user, event) {
  if (user?.role !== 'teacher') return null;
  if (user.isAdmin || event.owner_id === user.id) return 'owner';
  const coteacher = db.prepare('SELECT 1 FROM event_coteachers WHERE event_id = ? AND teacher_id = ?').get(event.id, user.id);
  return coteacher ? 'editor' : null;
}

// §6 teacher home: the events a teacher owns or co-teaches.
export function teacherEvents(db, teacherId) {
  return db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS signups FROM events e
    WHERE e.owner_id = ? OR EXISTS (SELECT 1 FROM event_coteachers c WHERE c.event_id = e.id AND c.teacher_id = ?)
    ORDER BY e.event_date, e.start_time, e.id`).all(teacherId, teacherId);
}

// §6 admin: every event with its owner.
export function allEvents(db) {
  return db.prepare(`SELECT e.*, u.name AS owner_name, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS signups FROM events e
    JOIN users u ON u.id = e.owner_id ORDER BY e.event_date, e.start_time, e.id`).all();
}

// BR-23, BR-25: published events, optionally only those a student of `braut` can see: events
// tagged with that braut, and events with no braut, which are for everyone (project owner's
// decision). Sorted by day, then start time.
export function publishedEvents(db, braut = null) {
  const events = db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS signups FROM events e WHERE e.status = 'published'
    AND (@braut IS NULL OR NOT EXISTS (SELECT 1 FROM event_brautir b WHERE b.event_id = e.id)
      OR EXISTS (SELECT 1 FROM event_brautir b WHERE b.event_id = e.id AND b.braut = @braut))
    ORDER BY e.event_date, e.start_time, e.id`).all({ braut });
  return withBrautir(db, events);
}

function setBrautir(db, eventId, brautir) {
  db.prepare('DELETE FROM event_brautir WHERE event_id = ?').run(eventId);
  const add = db.prepare('INSERT INTO event_brautir (event_id, braut) VALUES (?, ?)');
  for (const braut of brautir) add.run(eventId, braut);
}

// The checks that depend on other rows are made again here, inside the transaction that saves,
// because a sign-up or a removed day can land while the form is being read. Returns
// { field, error } or null.
function recheck(db, values, eventId) {
  if (!db.prepare('SELECT 1 FROM saeludagar_days WHERE day = ?').get(values.event_date)) {
    return { field: 'event_date', error: 'events.errors.date' }; // BR-21
  }
  const signups = eventId ? db.prepare('SELECT COUNT(*) FROM registrations WHERE event_id = ?').pluck().get(eventId) : 0;
  if (Number(values.capacity) < signups) return { field: 'capacity', error: 'events.errors.capacityBelowSignups' }; // BR-28
  return null;
}

// BR-22: a new event starts as a draft. Returns { id } or { field, error }.
export function createEvent(db, ownerId, values, imageFile) {
  return db.transaction(() => {
    const problem = recheck(db, values, null);
    if (problem) return problem;
    const now = toIso();
    const c = columns(values);
    const id = Number(db.prepare(`INSERT INTO events (owner_id, title_is, title_en, description_is, description_en, host,
      braut_restricted, capacity, fee_isk, image_file, event_date, start_time, end_time, location, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ownerId, c.title_is, c.title_en, c.description_is,
      c.description_en, c.host, c.braut_restricted, c.capacity, c.fee_isk, imageFile, c.event_date, c.start_time,
      c.end_time, c.location, now, now).lastInsertRowid);
    setBrautir(db, id, values.brautir);
    return { id };
  })();
}

// The details students are told about when they change (BR-28), and the event's titles for emails.
const WHEN_AND_WHERE = ['event_date', 'start_time', 'end_time', 'location'];
const pick = (event, keys) => Object.fromEntries(keys.map((key) => [key, event[key]]));

function studentsOf(db, eventId) {
  return db.prepare('SELECT student_id FROM registrations WHERE event_id = ?').pluck().all(eventId);
}

// BR-28: a published event can still be edited. If the date, times or location change, every
// student signed up gets an email. Existing sign-ups are not checked again. `imageFile` is the
// new image name, or undefined to keep the current one. Returns { changed } (the changed fields)
// or { field, error }.
export function updateEvent(db, event, values, imageFile) {
  return db.transaction(() => {
    const problem = recheck(db, values, event.id);
    if (problem) return problem;
    const c = columns(values);
    if (imageFile !== undefined) c.image_file = imageFile;
    const changed = Object.keys(c).filter((key) => c[key] !== event[key]);
    db.prepare(`UPDATE events SET title_is = ?, title_en = ?, description_is = ?, description_en = ?, host = ?,
      braut_restricted = ?, capacity = ?, fee_isk = ?, image_file = ?, event_date = ?, start_time = ?, end_time = ?,
      location = ?, updated_at = ? WHERE id = ?`).run(c.title_is, c.title_en, c.description_is, c.description_en, c.host,
      c.braut_restricted, c.capacity, c.fee_isk, imageFile === undefined ? event.image_file : imageFile, c.event_date, c.start_time, c.end_time,
      c.location, toIso(), event.id);
    setBrautir(db, event.id, values.brautir);

    if (WHEN_AND_WHERE.some((key) => changed.includes(key))) {
      const payload = {
        event: { id: event.id, title_is: c.title_is, title_en: c.title_en },
        before: pick(event, WHEN_AND_WHERE),
        after: pick(c, WHEN_AND_WHERE),
      };
      for (const studentId of studentsOf(db, event.id)) queueEmail(db, { kind: 'event_changed', userId: studentId, payload });
    }
    return { changed };
  })();
}

export function publishEvent(db, event) {
  db.prepare("UPDATE events SET status = 'published', updated_at = ? WHERE id = ? AND status = 'draft'").run(toIso(), event.id);
}

// BR-29: blocked once attendance has been marked. Otherwise every student signed up gets an
// email, and their sign-ups go with the event (recorded in the audit log, BR-56).
// Returns { error } or { image } (the file to delete).
export function deleteEvent(db, event, actorId) {
  return db.transaction(() => {
    if (getEvent(db, event.id).attended > 0) return { error: 'events.errors.attendanceMarked' };
    const payload = { event: { ...pick(event, ['title_is', 'title_en']), ...pick(event, WHEN_AND_WHERE) } };
    for (const studentId of studentsOf(db, event.id)) queueEmail(db, { kind: 'event_deleted', userId: studentId, payload });
    db.prepare(`INSERT INTO audit_log (at, actor_id, action, event_id, student_id, details)
      SELECT ?, ?, 'signup.delete', event_id, student_id, '{"reason":"event_deleted"}' FROM registrations WHERE event_id = ?`)
      .run(toIso(), actorId, event.id);
    db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
    return { image: event.image_file };
  })();
}

// Co-teachers (owner or admin only, §6): chosen from the active teachers.
export function coteacherCandidates(db, event) {
  return db.prepare(`SELECT id, name FROM users WHERE role = 'teacher' AND active = 1 AND id <> ?
    AND id NOT IN (SELECT teacher_id FROM event_coteachers WHERE event_id = ?)`).all(event.owner_id, event.id)
    .sort((a, b) => collator.compare(a.name, b.name));
}

export function addCoteacher(db, event, teacherId) {
  if (!coteacherCandidates(db, event).some((teacher) => teacher.id === teacherId)) return false;
  db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(event.id, teacherId);
  return true;
}

export function removeCoteacher(db, event, teacherId) {
  return db.prepare('DELETE FROM event_coteachers WHERE event_id = ? AND teacher_id = ?').run(event.id, teacherId).changes > 0;
}
