import { MAX_POINTS_PER_COURSE, POINTS_PER_ATTENDANCE } from '../config.js';
import { toIso } from '../db/index.js';
import { audit } from './audit.js';

const collator = new Intl.Collator('is');

// BR-44: points can be given and taken back until the course-choice deadline. While the admin has
// not set one, they can.
export function choiceWindow(db, now = new Date()) {
  const deadline = db.prepare('SELECT choice_deadline_at FROM settings WHERE id = 1').pluck().get();
  return { deadline, open: !deadline || now.getTime() < Date.parse(deadline) };
}

// BR-69: what the "Fjarvistastig" page shows. `earned` is 4 points for each marked attendance
// (BR-40) and `left` what has not been given to a course. `courses` are the student's own courses
// (BR-41) with the points on each, and whether a step up or down is possible now: up while points
// are left and the course is under its maximum (BR-42), and either way only before the deadline.
// A course that holds points but has left the student's list (an import after the deadline,
// BR-17) is listed too, marked `dropped`, so that the courses add up to the counter.
export function studentPoints(db, studentId, now = new Date()) {
  const attended = db.prepare('SELECT course_code FROM registrations WHERE student_id = ? AND attended = 1').pluck().all(studentId);
  const given = attended.filter((course) => course !== null);
  const { deadline, open } = choiceWindow(db, now);
  const earned = attended.length * POINTS_PER_ATTENDANCE;
  const left = earned - given.length * POINTS_PER_ATTENDANCE;
  const own = db.prepare('SELECT course_code FROM student_courses WHERE user_id = ?').pluck().all(studentId);
  const codes = [...new Set([...own, ...given])].sort(collator.compare);
  const courses = codes.map((code) => {
    const points = given.filter((course) => course === code).length * POINTS_PER_ATTENDANCE;
    const dropped = !own.includes(code);
    return {
      code,
      points,
      dropped,
      canGive: open && !dropped && left >= POINTS_PER_ATTENDANCE && points + POINTS_PER_ATTENDANCE <= MAX_POINTS_PER_COURSE,
      canTake: open && points > 0,
    };
  });
  return {
    earned, left, courses, deadline, open, step: POINTS_PER_ATTENDANCE, max: MAX_POINTS_PER_COURSE,
  };
}

// BR-41, BR-69: gives the points of one marked attendance to `course`: the earliest attendance
// that has no course yet. Every rule is checked here, inside one transaction, so nothing a browser
// sends can give away more points than the student has earned, or more than a course may hold.
// Returns { ok } or { error, params }.
export function givePoints(db, studentId, course, now = new Date()) {
  return db.transaction(() => {
    if (!choiceWindow(db, now).open) return { error: 'points.errors.closed' };
    if (!db.prepare('SELECT 1 FROM student_courses WHERE user_id = ? AND course_code = ?').get(studentId, course)) {
      return { error: 'points.errors.notYourCourse' };
    }
    const onCourse = db.prepare('SELECT COUNT(*) FROM registrations WHERE student_id = ? AND course_code = ?').pluck().get(studentId, course);
    if ((onCourse + 1) * POINTS_PER_ATTENDANCE > MAX_POINTS_PER_COURSE) {
      return { error: 'points.errors.courseFull', params: { course, max: MAX_POINTS_PER_COURSE } };
    }
    const free = db.prepare(`SELECT r.id, r.event_id FROM registrations r JOIN events e ON e.id = r.event_id
      WHERE r.student_id = ? AND r.attended = 1 AND r.course_code IS NULL
      ORDER BY e.event_date, e.start_time, e.id LIMIT 1`).get(studentId);
    if (!free) return { error: 'points.errors.noneLeft' };
    db.prepare('UPDATE registrations SET course_code = ?, course_chosen_at = ? WHERE id = ?').run(course, toIso(now), free.id);
    audit(db, 'choice.set', studentId, free.event_id, studentId, { course });
    return { ok: true };
  }).immediate();
}

// BR-69: takes the points on `course` back, so they can go to another course.
// Returns { ok } or { error }.
export function takePoints(db, studentId, course, now = new Date()) {
  return db.transaction(() => {
    if (!choiceWindow(db, now).open) return { error: 'points.errors.closed' };
    const given = db.prepare(`SELECT id, event_id FROM registrations WHERE student_id = ? AND course_code = ?
      ORDER BY course_chosen_at DESC, id DESC LIMIT 1`).get(studentId, course);
    if (!given) return { error: 'points.errors.nothingToTake' };
    db.prepare('UPDATE registrations SET course_code = NULL, course_chosen_at = NULL WHERE id = ?').run(given.id);
    audit(db, 'choice.clear', studentId, given.event_id, studentId, { course });
    return { ok: true };
  }).immediate();
}
