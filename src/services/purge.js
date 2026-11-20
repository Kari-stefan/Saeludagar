import { toIso } from '../db/index.js';
import { t } from '../i18n/index.js';

export const AUTO_PURGE_DAYS = 30; // BR-55
const AUTO_PURGE_MS = AUTO_PURGE_DAYS * 24 * 60 * 60 * 1000;

// BR-55: the time of the automatic purge, 30 days after the course-choice deadline (ISO UTC).
function autoPurgeTime(deadline) {
  return toIso(new Date(Date.parse(deadline) + AUTO_PURGE_MS));
}

// BR-55: true when nobody has purged since the deadline (stored times are UTC ISO strings, so they
// compare as text).
function notPurgedSince(deadline, lastPurgedAt) {
  return lastPurgedAt === null || lastPurgedAt < deadline;
}

// BR-55, §8: true when the course-choice deadline is set, `now` is at or after the deadline plus 30
// days, and nobody has purged since the deadline. The automatic purge and the settings page share it.
export function autoPurgeDue(deadline, lastPurgedAt, now = new Date()) {
  return Boolean(deadline) && now.getTime() >= Date.parse(deadline) + AUTO_PURGE_MS && notPurgedSince(deadline, lastPurgedAt);
}

// BR-55, BR-56: deletes all student data and sets every event back to draft, in one transaction.
// An event owned by a student event manager (BR-67) moves to `newOwnerId`. Teacher accounts, events,
// the Sæludagar days and the three times in settings stay. Call it inside a transaction.
function deleteStudentData(db, newOwnerId, now) {
  const at = toIso(now);
  const students = db.prepare("SELECT COUNT(*) FROM users WHERE role = 'student'").pluck().get();
  // An event's owner is never also its co-teacher.
  db.prepare("DELETE FROM event_coteachers WHERE teacher_id = ? AND event_id IN (SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE role = 'student'))")
    .run(newOwnerId);
  db.prepare("UPDATE events SET owner_id = ?, updated_at = ? WHERE owner_id IN (SELECT id FROM users WHERE role = 'student')")
    .run(newOwnerId, at);
  // This foreign key does not cascade, so a student's co-teacher links go first.
  db.prepare("DELETE FROM event_coteachers WHERE teacher_id IN (SELECT id FROM users WHERE role = 'student')").run();
  db.prepare('DELETE FROM registrations').run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'student')").run();
  db.prepare("DELETE FROM email_outbox WHERE user_id IN (SELECT id FROM users WHERE role = 'student')").run();
  db.prepare('DELETE FROM audit_log').run();
  db.prepare("DELETE FROM users WHERE role = 'student'").run();
  db.prepare("UPDATE events SET status = 'draft', updated_at = ?").run(at);
  db.prepare('UPDATE settings SET last_purged_at = ?, updated_at = ? WHERE id = 1').run(at, at);
  return students;
}

// BR-55: the manual purge, run by the admin `adminId`. Refuses anyone who is not an active admin,
// and changes nothing then. There is no check on the course-choice deadline (open question 24).
// Returns { ok, students } or { error }.
export function purgeData(db, adminId, now = new Date()) {
  return db.transaction(() => {
    const admin = db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'teacher' AND is_admin = 1 AND active = 1").get(adminId);
    if (!admin) return { error: 'purge.errors.notAdmin' };
    return { ok: true, students: deleteStudentData(db, adminId, now) };
  }).immediate();
}

// BR-55, §8: the hourly check. Purges when the course-choice deadline is set, now is at or after
// the deadline plus 30 days, and nobody has purged since the deadline. Events owned by students go
// to the active admin whose account is oldest, else to the oldest admin account; with no admin at
// all and such an event it changes nothing. Returns { purged: true, students }, { purged: false }
// or { purged: false, reason: 'no-admin' }.
export function autoPurge(db, now = new Date()) {
  return db.transaction(() => {
    const { choice_deadline_at: deadline, last_purged_at: lastPurgedAt } = db.prepare(
      'SELECT choice_deadline_at, last_purged_at FROM settings WHERE id = 1',
    ).get();
    if (!autoPurgeDue(deadline, lastPurgedAt, now)) {
      return { purged: false };
    }
    const admin = db.prepare(`SELECT id FROM users WHERE role = 'teacher' AND is_admin = 1
      ORDER BY active DESC, created_at, id LIMIT 1`).pluck().get();
    const studentEvents = db.prepare("SELECT 1 FROM events WHERE owner_id IN (SELECT id FROM users WHERE role = 'student') LIMIT 1").get();
    if (studentEvents && admin === undefined) return { purged: false, reason: 'no-admin' };
    // With no admin account there is no student-owned event either, so no event changes owner.
    return { purged: true, students: deleteStudentData(db, admin ?? null, now) };
  }).immediate();
}

// BR-55: what the purge page shows. `autoPurgeAt` is set while an automatic purge is still to come.
export function purgeStatus(db, now = new Date()) {
  const { choice_deadline_at: deadline, last_purged_at: lastPurgedAt } = db.prepare(
    'SELECT choice_deadline_at, last_purged_at FROM settings WHERE id = 1',
  ).get();
  return {
    deadline,
    deadlinePassed: Boolean(deadline) && now.getTime() >= Date.parse(deadline),
    autoPurgeAt: deadline && notPurgedSince(deadline, lastPurgedAt) ? autoPurgeTime(deadline) : null,
    lastPurgedAt,
  };
}

// BR-55: true when the typed value is the confirmation word of either language, in any case.
export function purgeConfirmed(value) {
  if (typeof value !== 'string') return false;
  const typed = value.trim().toUpperCase();
  return ['is', 'en'].some((lang) => typed === t(lang, 'purge.confirmWord').toUpperCase());
}
