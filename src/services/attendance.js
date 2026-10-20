import { toIso } from '../db/index.js';
import { audit } from './audit.js';

// BR-39: attendance can be marked or changed from 00:00 on the event's date (Iceland is UTC+0)
// until the course-choice deadline. While the admin has not set the deadline, it stays open from
// the event's date. `phase` is 'before', 'open' or 'after', for the message on the page.
export function attendanceWindow(db, event, now = new Date()) {
  const deadline = db.prepare('SELECT choice_deadline_at FROM settings WHERE id = 1').pluck().get();
  const opens = `${event.event_date}T00:00:00Z`;
  const t = now.getTime();
  let phase = 'open';
  if (t < Date.parse(opens)) phase = 'before';
  else if (deadline && t >= Date.parse(deadline)) phase = 'after';
  return { opens, deadline, phase, open: phase === 'open' };
}

// BR-38: sets attendance for students of the event. `changes` is [{ studentId, attended }].
// Unmarking also deletes the course choice (BR-41), which the database requires anyway. Each
// change is logged (BR-56). Students no longer signed up (removed meanwhile) are skipped and
// counted in `missing`. Returns { ok, changed, missing } or { error }.
export function setAttendance(db, teacherId, event, changes, now = new Date()) {
  return db.transaction(() => {
    if (!attendanceWindow(db, event, now).open) return { error: 'attendance.errors.closed' };
    const find = db.prepare('SELECT id, attended, course_code FROM registrations WHERE event_id = ? AND student_id = ?');
    const mark = db.prepare('UPDATE registrations SET attended = 1, attendance_marked_by = ?, attendance_marked_at = ? WHERE id = ?');
    const unmark = db.prepare(`UPDATE registrations SET attended = 0, attendance_marked_by = NULL, attendance_marked_at = NULL,
      course_code = NULL, course_chosen_at = NULL WHERE id = ?`);
    let changed = 0;
    let missing = 0;
    for (const { studentId, attended } of changes) {
      const signup = find.get(event.id, studentId);
      if (!signup) {
        missing += 1;
        continue;
      }
      if (Boolean(signup.attended) === attended) continue;
      if (attended) {
        mark.run(teacherId, toIso(now), signup.id);
        audit(db, 'attendance.set', teacherId, event.id, studentId);
      } else {
        unmark.run(signup.id);
        audit(db, 'attendance.unset', teacherId, event.id, studentId);
        if (signup.course_code) audit(db, 'choice.clear', teacherId, event.id, studentId, { course: signup.course_code, reason: 'attendance.unset' });
      }
      changed += 1;
    }
    return { ok: true, changed, missing };
  }).immediate();
}
