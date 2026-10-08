import { toIso } from '../db/index.js';
import { normalizeKennitala } from './crypto.js';
import { generateCode, hashCode, verifyCode } from './codes.js';
import { queueEmail } from './email.js';

export const MAX_FAILED_LOGINS = 5; // BR-05
export const LOCKOUT_MS = 15 * 60 * 1000; // BR-05
export const NEW_CODE_INTERVAL_MS = 10 * 60 * 1000; // BR-08

const KENNITALA_TAKEN = 'admin.teachers.errors.kennitalaTaken';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const collator = new Intl.Collator('is');

// Names and email addresses of teachers and imported students. Both are trimmed first.
export function isValidName(name) {
  return name.length > 0 && name.length <= 200 && !CONTROL_CHARACTERS.test(name);
}

export function isValidEmail(email) {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

// Checks a new teacher account's fields (the admin page and scripts/create-admin.js).
// Errors are i18n keys, by field.
export function validateTeacher(input) {
  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim();
  const kennitala = normalizeKennitala(input.kennitala);
  const errors = {};
  if (!isValidName(name)) errors.name = 'admin.teachers.errors.name';
  if (!isValidEmail(email)) errors.email = 'admin.teachers.errors.email';
  if (!kennitala) errors.kennitala = 'validation.kennitala';
  return { values: { name, email, kennitala }, errors };
}

function toTeacher(row) {
  return { id: row.id, name: row.name, email: row.email, isAdmin: row.is_admin === 1, active: row.active === 1 };
}

export function createAccounts({ db, kt }) {
  const userByHmac = db.prepare('SELECT * FROM users WHERE kennitala_hmac = ?');
  const isActive = db.prepare('SELECT active FROM users WHERE id = ?').pluck();
  const teacherById = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'");
  const allTeachers = db.prepare("SELECT * FROM users WHERE role = 'teacher'");
  const setFailures = db.prepare('UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?');
  const setCodeRequested = db.prepare('UPDATE users SET code_requested_at = ?, updated_at = ? WHERE id = ?');
  const setActive = db.prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?');
  const setAdmin = db.prepare('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?');
  const deleteSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
  const insertTeacher = db.prepare(`INSERT INTO users
    (role, is_admin, kennitala_hmac, kennitala_enc, name, email, code_hash, created_at, updated_at)
    VALUES ('teacher', ?, ?, ?, ?, ?, ?, ?, ?)`);

  // Login steps 1, 3 and 5 (AGENT_START §8). The attempt is counted before the slow scrypt check,
  // in one synchronous transaction, so parallel requests cannot get more than 5 guesses in before
  // the lock (BR-05). A correct code resets the count afterwards.
  const admitAttempt = db.transaction((hmac) => {
    const user = userByHmac.get(hmac);
    if (!user) return null;
    const now = new Date();
    if (user.locked_until && Date.parse(user.locked_until) > now.getTime()) return null;
    const failed = user.failed_logins + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      setFailures.run(0, toIso(new Date(now.getTime() + LOCKOUT_MS)), toIso(now), user.id);
    } else {
      setFailures.run(failed, null, toIso(now), user.id);
    }
    return user;
  });

  // Returns { id, role, isAdmin }, or null. Unknown, locked and inactive accounts still run one
  // scrypt check (step 2), so every failure looks and takes the same as a wrong code (BR-03, BR-04).
  async function login(kennitala, code) {
    const user = admitAttempt(kt.hmac(kennitala));
    const matches = await verifyCode(code, user?.code_hash);
    if (!user || !matches || isActive.get(user.id) !== 1) return null;
    setFailures.run(0, null, toIso(), user.id);
    return { id: user.id, role: user.role, isAdmin: user.is_admin === 1 };
  }

  // The outbox worker generates the code when it sends the email (AGENT_START §8).
  function queueCode(userId, kind) {
    const now = toIso();
    setCodeRequested.run(now, now, userId);
    queueEmail(db, { kind, userId });
  }

  // BR-08: at most one new code per kennitala every 10 minutes, for active accounts only.
  // The caller shows the same message whatever happens here.
  const requestNewCode = db.transaction((kennitala) => {
    const user = userByHmac.get(kt.hmac(kennitala));
    if (user?.active !== 1) return;
    if (user.code_requested_at && Date.now() - Date.parse(user.code_requested_at) < NEW_CODE_INTERVAL_MS) return;
    queueCode(user.id, 'new_code');
  });

  function insertTeacherRow({ name, email, kennitala }, isAdmin, codeHash) {
    const now = toIso();
    const result = insertTeacher.run(isAdmin ? 1 : 0, kt.hmac(kennitala), kt.encrypt(kennitala), name, email, codeHash, now, now);
    return Number(result.lastInsertRowid);
  }

  // BR-10, BR-12. Takes the values from validateTeacher. Returns { id } or { error }.
  const createTeacher = db.transaction((fields) => {
    if (userByHmac.get(kt.hmac(fields.kennitala))) return { error: KENNITALA_TAKEN };
    const id = insertTeacherRow(fields, false, null);
    queueCode(id, 'teacher_code');
    return { id };
  });

  // BR-13: the first admin, made by scripts/create-admin.js, which prints the code once.
  // Returns { id, code } or { error }.
  async function createAdmin(fields) {
    const code = generateCode();
    const codeHash = await hashCode(code);
    if (userByHmac.get(kt.hmac(fields.kennitala))) return { error: KENNITALA_TAKEN };
    return { id: insertTeacherRow(fields, true, codeHash), code };
  }

  function listTeachers() {
    return allTeachers.all().map(toTeacher).sort((a, b) => collator.compare(a.name, b.name));
  }

  // The functions below return null when there is no such teacher, otherwise { teacher } or
  // { teacher, error }. An admin cannot deactivate their own account or remove their own
  // admin rights (BR-11).

  // BR-11: an admin sends a teacher a new code.
  const sendTeacherCode = db.transaction((teacherId) => {
    const row = teacherById.get(teacherId);
    if (!row) return null;
    const teacher = toTeacher(row);
    if (!teacher.active) return { teacher, error: 'admin.teachers.errors.inactive' };
    queueCode(teacher.id, 'teacher_code');
    return { teacher };
  });

  // BR-11: deactivating deletes the teacher's sessions (AGENT_START §8). Their events stay.
  const setTeacherActive = db.transaction((actorId, teacherId, active) => {
    const row = teacherById.get(teacherId);
    if (!row) return null;
    const teacher = toTeacher(row);
    if (!active && teacher.id === actorId) return { teacher, error: 'admin.teachers.errors.self' };
    setActive.run(active ? 1 : 0, toIso(), teacher.id);
    if (!active) deleteSessions.run(teacher.id);
    return { teacher };
  });

  // BR-11: grant or revoke the admin flag. Takes effect on the teacher's next request.
  const setTeacherAdmin = db.transaction((actorId, teacherId, isAdmin) => {
    const row = teacherById.get(teacherId);
    if (!row) return null;
    const teacher = toTeacher(row);
    if (!isAdmin && teacher.id === actorId) return { teacher, error: 'admin.teachers.errors.self' };
    setAdmin.run(isAdmin ? 1 : 0, toIso(), teacher.id);
    return { teacher };
  });

  // BR-07: "Senda kóða" queues a student_code email for every active student; the worker generates
  // each code when it sends it, so a student's previous code works until then. Priority 1 lets
  // other emails go first, and the worker keeps to SMTP_MAX_PER_MINUTE (BR-53). A student who
  // already has one waiting is not queued twice.
  const queueStudentCodes = db.prepare(`INSERT INTO email_outbox (kind, priority, user_id, created_at, next_try_at)
    SELECT 'student_code', 1, id, ?, ? FROM users
    WHERE role = 'student' AND active = 1 AND NOT EXISTS (SELECT 1 FROM email_outbox
      WHERE kind = 'student_code' AND user_id = users.id AND next_try_at IS NOT NULL)`);
  const markStudentCodesRequested = db.prepare(`UPDATE users SET code_requested_at = ?, updated_at = ?
    WHERE role = 'student' AND active = 1`);
  const studentCodeRows = db.prepare(`SELECT COUNT(*) FILTER (WHERE next_try_at IS NOT NULL) AS queued,
    COUNT(*) FILTER (WHERE next_try_at IS NULL) AS failed FROM email_outbox WHERE kind = 'student_code'`);
  const activeStudents = db.prepare("SELECT COUNT(*) FROM users WHERE role = 'student' AND active = 1").pluck();
  const activeStudentIds = db.prepare("SELECT id FROM users WHERE role = 'student' AND active = 1").pluck();
  // Students of the latest send whose email has gone: still active (the worker drops emails to
  // inactive accounts unsent) and with no student_code row left, waiting or failed.
  const sentOf = db.prepare(`SELECT COUNT(*) FROM users WHERE id IN (SELECT value FROM json_each(?)) AND active = 1
    AND NOT EXISTS (SELECT 1 FROM email_outbox WHERE kind = 'student_code' AND user_id = users.id)`).pluck();

  // The students of the latest send, for the "sent" count on the page. Only this process knows
  // them, so the count is gone after a restart; queued and failed always come from the outbox.
  let lastSend = null;

  const sendStudentCodes = db.transaction(() => {
    const now = toIso();
    const count = queueStudentCodes.run(now, now).changes;
    markStudentCodesRequested.run(now, now);
    if (count > 0) lastSend = { at: now, ids: JSON.stringify(activeStudentIds.all()) };
    return count;
  });

  // §6: the number of active students and the progress (queued / sent / failed).
  function studentCodeStatus() {
    const { queued, failed } = studentCodeRows.get();
    const sent = lastSend ? sentOf.get(lastSend.ids) : null;
    return { activeStudents: activeStudents.get(), queued, failed, sent, lastSentAt: lastSend?.at ?? null };
  }

  return {
    login,
    requestNewCode,
    sendStudentCodes,
    studentCodeStatus,
    createTeacher,
    createAdmin,
    listTeachers,
    sendTeacherCode,
    setTeacherActive,
    setTeacherAdmin,
  };
}
