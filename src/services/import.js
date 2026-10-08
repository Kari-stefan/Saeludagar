import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { toIso } from '../db/index.js';
import { isValidEmail, isValidName } from './accounts.js';
import { normalizeKennitala } from './crypto.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // AGENT_START §8
export const HOLD_MS = 10 * 60 * 1000; // §8: a checked file waits at most 10 minutes for the confirm
const HEADER = ['kennitala', 'nafn', 'netfang', 'braut', 'afangi'];
const collator = new Intl.Collator('is');

// §8: UTF-8 with or without a BOM (TextDecoder drops it). Bytes that are not valid UTF-8 are read
// as Windows-1252, so Icelandic letters from Excel survive.
export function decodeCsv(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// BR-14, BR-16 and §8: reads and checks the whole file in memory, collecting every error.
// Returns { students, errors }. Errors are { key, params } for t(), with params.line when the
// error belongs to a line of the file. Never shows a kennitala.
export function readStudentCsv(bytes, { db, kt }) {
  const text = decodeCsv(bytes);
  const errors = [];
  const fail = (line, key) => errors.push({ key, params: line ? { line } : {} });

  // The delimiter is ";", or "," when the header line uses commas.
  const headerLine = text.split(/\r?\n/, 1)[0];
  const delimiter = !headerLine.includes(';') && headerLine.includes(',') ? ',' : ';';
  let records;
  try {
    records = parse(text, { delimiter, relax_column_count: true, skip_empty_lines: true, trim: true, info: true });
  } catch (err) {
    fail(err.lines ?? 1, 'import.errors.unreadable');
    return { students: [], errors };
  }
  if (records.length === 0 || records[0].record.map((name) => name.toLowerCase()).join(';') !== HEADER.join(';')) {
    fail(1, 'import.errors.header');
    return { students: [], errors };
  }

  const students = new Map();
  for (const { record, info } of records.slice(1)) {
    // info.lines is where the record ends; a quoted field can span lines.
    const line = info.lines - record.join('').split('\n').length + 1;
    if (record.length !== HEADER.length) {
      fail(line, 'import.errors.columns');
      continue;
    }
    const [rawKennitala, name, email, braut, course] = record;
    const kennitala = normalizeKennitala(rawKennitala);
    if (!kennitala) fail(line, 'import.errors.kennitala');
    if (!isValidName(name)) fail(line, 'import.errors.name');
    if (!isValidEmail(email)) fail(line, 'import.errors.email');
    if (!kennitala || !isValidName(name) || !isValidEmail(email)) continue;

    let student = students.get(kennitala);
    if (!student) {
      student = { kennitala, name, email, braut: braut || null, courses: [], line };
      students.set(kennitala, student);
    } else if (student.name !== name || student.email !== email || student.braut !== (braut || null)) {
      errors.push({ key: 'import.errors.mismatch', params: { line, first: student.line } });
      continue;
    }
    if (course && !student.courses.includes(course)) student.courses.push(course);
  }
  if (records.length === 1) fail(null, 'import.errors.noStudents');

  // BR-12: a kennitala can belong to only one account.
  const role = db.prepare('SELECT role FROM users WHERE kennitala_hmac = ?').pluck();
  for (const student of students.values()) {
    if (role.get(kt.hmac(student.kennitala)) === 'teacher') fail(student.line, 'import.errors.teacher');
  }

  errors.sort((a, b) => (a.params.line ?? 0) - (b.params.line ?? 0));
  return { students: [...students.values()], errors };
}

// Between upload and confirm the checked file lives only in this process's memory, for at most
// 10 minutes, under a random token kept in the admin's session (BR-15, §8).
const held = new Map();

export function holdImport(students) {
  const token = crypto.randomBytes(24).toString('base64url');
  const timer = setTimeout(() => held.delete(token), HOLD_MS);
  timer.unref();
  held.set(token, { students, expiresAt: Date.now() + HOLD_MS, timer });
  return token;
}

// Returns the held students once, or null if the token is unknown or has expired.
export function takeImport(token) {
  const entry = held.get(token);
  if (!entry) return null;
  clearTimeout(entry.timer);
  held.delete(token);
  return entry.expiresAt > Date.now() ? entry.students : null;
}

// BR-17: what the import does, worked out against the database as it is now.
function plan(db, kt, students) {
  const existing = new Map(db.prepare("SELECT id, kennitala_hmac, active FROM users WHERE role = 'student'").all()
    .map((row) => [row.kennitala_hmac, row]));
  const inFile = new Set();
  const added = [];
  const updated = [];
  for (const student of students) {
    const hmac = kt.hmac(student.kennitala);
    inFile.add(hmac);
    const row = existing.get(hmac);
    if (row) updated.push({ ...student, id: row.id });
    else added.push({ ...student, hmac });
  }
  const deactivated = [...existing.values()]
    .filter((row) => row.active === 1 && !inFile.has(row.kennitala_hmac))
    .map((row) => row.id);
  return { added, updated, deactivated };
}

// The summary shown before the confirm (§6): added, updated, deactivated, sign-ups to be removed.
export function previewImport(db, kt, students) {
  const { added, updated, deactivated } = plan(db, kt, students);
  const signupsRemoved = db.prepare(`SELECT COUNT(*) FROM registrations
    WHERE attended = 0 AND student_id IN (SELECT value FROM json_each(?))`).pluck().get(JSON.stringify(deactivated));
  return { students: students.length, added: added.length, updated: updated.length, deactivated: deactivated.length, signupsRemoved };
}

// BR-16, BR-17: applies the import in one transaction. Returns the same counts as the preview,
// or { error } if a kennitala in the file has become a teacher's since the upload (BR-12).
export function applyImport(db, kt, students, actorId) {
  return db.transaction(() => {
    const role = db.prepare('SELECT role FROM users WHERE kennitala_hmac = ?').pluck();
    if (students.some((student) => role.get(kt.hmac(student.kennitala)) === 'teacher')) {
      return { error: 'import.errors.changed' };
    }
    const now = toIso();
    const { added, updated, deactivated } = plan(db, kt, students);
    const insert = db.prepare(`INSERT INTO users (role, kennitala_hmac, kennitala_enc, name, email, braut, created_at, updated_at)
      VALUES ('student', ?, ?, ?, ?, ?, ?, ?)`);
    const update = db.prepare('UPDATE users SET name = ?, email = ?, braut = ?, active = 1, updated_at = ? WHERE id = ?');
    const clearCourses = db.prepare('DELETE FROM student_courses WHERE user_id = ?');
    const addCourse = db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)');

    for (const student of added) {
      const id = insert.run(student.hmac, kt.encrypt(student.kennitala), student.name, student.email, student.braut, now, now)
        .lastInsertRowid;
      for (const course of student.courses) addCourse.run(id, course);
    }
    for (const student of updated) {
      update.run(student.name, student.email, student.braut, now, student.id);
      clearCourses.run(student.id);
      for (const course of student.courses) addCourse.run(student.id, course);
    }

    // Students missing from the file become inactive and are logged out (§8). Their sign-ups
    // without marked attendance are deleted, which frees the places, and the audit log records
    // it (BR-56). Attended sign-ups and their course choices stay for the export.
    const ids = JSON.stringify(deactivated);
    db.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))").run(now, ids);
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT value FROM json_each(?))').run(ids);
    db.prepare(`INSERT INTO audit_log (at, actor_id, action, event_id, student_id, details)
      SELECT ?, ?, 'signup.delete', event_id, student_id, '{"reason":"import"}' FROM registrations
      WHERE attended = 0 AND student_id IN (SELECT value FROM json_each(?))`).run(now, actorId, ids);
    const signupsRemoved = db.prepare(`DELETE FROM registrations
      WHERE attended = 0 AND student_id IN (SELECT value FROM json_each(?))`).run(ids).changes;

    return { students: students.length, added: added.length, updated: updated.length, deactivated: deactivated.length, signupsRemoved };
  })();
}

// BR-18: the braut list is the distinct braut values among active students.
export function brautList(db) {
  return db.prepare("SELECT DISTINCT braut FROM users WHERE role = 'student' AND active = 1 AND braut IS NOT NULL")
    .pluck().all().sort(collator.compare);
}

export function activeStudentCount(db) {
  return db.prepare("SELECT COUNT(*) FROM users WHERE role = 'student' AND active = 1").pluck().get();
}
