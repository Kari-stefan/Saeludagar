import { toIso } from '../db/index.js';

// BR-56: who changed a sign-up, an attendance or a course choice, and when. `actorId` is the
// student or teacher who did it. The purge deletes the log (BR-55).
export function audit(db, action, actorId, eventId, studentId, details = {}) {
  db.prepare('INSERT INTO audit_log (at, actor_id, action, event_id, student_id, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(toIso(), actorId, action, eventId, studentId, JSON.stringify(details));
}

export const AUDIT_PAGE_SIZE = 100;

const collator = new Intl.Collator('is');

// The details column is JSON text; anything else reads as no details.
function parseDetails(text) {
  if (!text) return {};
  try {
    const details = JSON.parse(text);
    return details !== null && typeof details === 'object' && !Array.isArray(details) ? details : {};
  } catch {
    return {};
  }
}

// BR-56: the log for the admin page, newest first, AUDIT_PAGE_SIZE entries a page. `eventId` keeps
// one event's entries. `student` is a fragment of a student's name, matched here in JavaScript
// rather than with SQL LIKE, which ignores case only for A to Z (so "þór" finds "Þórunn"). `page`
// is clamped into 1..pages, and `from` and `to` are the 1-based positions shown (0 when none).
// An entry's actor, event and student are null once they no longer exist.
export function auditEntries(db, { eventId = null, student = '', page = 1 } = {}) {
  const fragment = String(student ?? '').trim().toLocaleLowerCase('is');
  const studentIds = fragment === '' ? null : db.prepare("SELECT id, name FROM users WHERE role = 'student'").all()
    .filter((row) => String(row.name ?? '').toLocaleLowerCase('is').includes(fragment))
    .map((row) => row.id);
  const filter = { eventId: eventId ?? null, students: studentIds === null ? null : JSON.stringify(studentIds) };
  const where = `(@eventId IS NULL OR a.event_id = @eventId)
    AND (@students IS NULL OR a.student_id IN (SELECT value FROM json_each(@students)))`;

  const total = db.prepare(`SELECT COUNT(*) FROM audit_log a WHERE ${where}`).pluck().get(filter);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const current = Math.min(Math.max(Math.trunc(Number(page)) || 1, 1), pages);
  const offset = (current - 1) * AUDIT_PAGE_SIZE;

  const rows = db.prepare(`SELECT a.id, a.at, a.action, a.details, a.event_id, a.student_id,
      actor.name AS actor_name, e.id AS found_event, e.title_is, e.title_en, s.name AS student_name
    FROM audit_log a
    LEFT JOIN users actor ON actor.id = a.actor_id
    LEFT JOIN events e ON e.id = a.event_id
    LEFT JOIN users s ON s.id = a.student_id
    WHERE ${where}
    ORDER BY a.at DESC, a.id DESC
    LIMIT @limit OFFSET @offset`).all({ ...filter, limit: AUDIT_PAGE_SIZE, offset });

  const entries = rows.map((row) => ({
    id: row.id,
    at: row.at,
    action: row.action,
    details: parseDetails(row.details),
    actor: row.actor_name ?? null,
    eventId: row.event_id ?? null,
    event: row.found_event === null ? null : { title_is: row.title_is, title_en: row.title_en },
    studentId: row.student_id ?? null,
    student: row.student_name ?? null,
  }));
  return {
    entries,
    total,
    page: current,
    pages,
    from: entries.length > 0 ? offset + 1 : 0,
    to: entries.length > 0 ? offset + entries.length : 0,
  };
}

// The events in the log, for the page's filter: existing ones by Icelandic title, then the deleted
// ones (both titles null) by number.
export function auditEvents(db) {
  const events = db.prepare(`SELECT l.id, e.id AS found, e.title_is, e.title_en
    FROM (SELECT DISTINCT event_id AS id FROM audit_log WHERE event_id IS NOT NULL) l
    LEFT JOIN events e ON e.id = l.id`).all();
  const existing = events.filter((event) => event.found !== null)
    .sort((a, b) => collator.compare(a.title_is, b.title_is) || a.id - b.id);
  const deleted = events.filter((event) => event.found === null).sort((a, b) => a.id - b.id);
  return [...existing, ...deleted].map((event) => ({ id: event.id, title_is: event.title_is, title_en: event.title_en }));
}
