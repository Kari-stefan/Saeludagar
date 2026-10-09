import { toIso } from '../db/index.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// The three times the admin sets (BR-31, BR-44, BR-54), by form field prefix.
const TIMES = { signupOpens: 'signup_opens_at', signupCloses: 'signup_closes_at', choiceDeadline: 'choice_deadline_at' };

// 'YYYY-MM-DD' and a real calendar date.
export function isValidDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function getSettings(db) {
  const row = db.prepare('SELECT signup_opens_at, signup_closes_at, choice_deadline_at FROM settings WHERE id = 1').get();
  return {
    days: db.prepare('SELECT day FROM saeludagar_days ORDER BY day').pluck().all(),
    signupOpens: row.signup_opens_at,
    signupCloses: row.signup_closes_at,
    choiceDeadline: row.choice_deadline_at,
  };
}

// The stored ISO values split into the form's date and time fields.
export function timeFields(settings) {
  const fields = {};
  for (const name of Object.keys(TIMES)) {
    const iso = settings[name];
    fields[`${name}Date`] = iso ? iso.slice(0, 10) : '';
    fields[`${name}Time`] = iso ? iso.slice(11, 16) : '';
  }
  return fields;
}

// BR-54: Sæludagar days. Adding a day that is already there changes nothing.
export function addDay(db, day) {
  if (!isValidDay(day)) return { error: 'admin.settings.errors.day' };
  db.prepare('INSERT OR IGNORE INTO saeludagar_days (day) VALUES (?)').run(day);
  touch(db);
  return {};
}

// Every event stays on a Sæludagar day (BR-21), so a day with events cannot be removed until they
// are moved or deleted (the project owner's decision). Returns { error, events } or {}.
export function removeDay(db, day) {
  const events = db.prepare('SELECT title_is, title_en FROM events WHERE event_date = ? ORDER BY start_time').all(day);
  if (events.length > 0) return { error: 'admin.settings.errors.dayHasEvents', events };
  db.prepare('DELETE FROM saeludagar_days WHERE day = ?').run(day);
  touch(db);
  return {};
}

// BR-54: the sign-up window (BR-31) and the course-choice deadline (BR-44), each a date and a time.
// Both empty means "not set". Returns { values, errors }, with errors as i18n keys by field prefix.
export function saveTimes(db, input) {
  const values = {};
  const errors = {};
  const stored = {};
  for (const name of Object.keys(TIMES)) {
    const date = String(input[`${name}Date`] ?? '').trim();
    const time = String(input[`${name}Time`] ?? '').trim();
    values[`${name}Date`] = date;
    values[`${name}Time`] = time;
    if (!date && !time) stored[name] = null;
    else if (!date || !time) errors[name] = 'admin.settings.errors.both';
    else if (!isValidDay(date) || !TIME_PATTERN.test(time)) errors[name] = 'admin.settings.errors.dateTime';
    else stored[name] = `${date}T${time}:00Z`;
  }
  if (!errors.signupOpens && !errors.signupCloses && stored.signupOpens && stored.signupCloses
    && stored.signupCloses <= stored.signupOpens) {
    errors.signupCloses = 'admin.settings.errors.closesBeforeOpens';
  }
  if (Object.keys(errors).length === 0) {
    db.prepare(`UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?, choice_deadline_at = ?, updated_at = ?
      WHERE id = 1`).run(stored.signupOpens, stored.signupCloses, stored.choiceDeadline, toIso());
  }
  return { values, errors };
}

function touch(db) {
  db.prepare('UPDATE settings SET updated_at = ? WHERE id = 1').run(toIso());
}
