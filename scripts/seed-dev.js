// npm run seed:dev: fake development data only (AGENT_START §10). Creates a few fake students
// with new login codes, so student login can be tried before the CSV import (milestone 3).
// Running it again gives the same students new codes. It never runs in production.
import { loadConfig } from '../src/config.js';
import { openDatabase, toIso } from '../src/db/index.js';
import { SCHEMA_VERSION } from '../src/db/migrate.js';
import { generateCode, hashCode } from '../src/services/codes.js';
import { kennitalaCrypto } from '../src/services/crypto.js';

const STUDENTS = [
  { kennitala: '0000000101', name: 'Jóna Jónsdóttir', email: 'jona@example.is', braut: 'Rafmagnsbraut', courses: ['STÆR2BH05', 'ÍSLE2MB05'] },
  { kennitala: '0000000102', name: 'Páll Pálsson', email: 'pall@example.is', braut: 'Starfsbraut', courses: [] },
  { kennitala: '0000000103', name: 'Sara Sigurðardóttir', email: 'sara@example.is', braut: 'Rafmagnsbraut', courses: ['ENSK2LS05'] },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

const config = loadConfig();
if (config.isProduction) fail('seed:dev only creates fake development data. It does not run when NODE_ENV=production.');
let kt;
try {
  kt = kennitalaCrypto(config);
} catch (err) {
  fail(err.message);
}

const db = openDatabase(config.databasePath);
if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) {
  fail('The database is not set up. Run: npm run migrate');
}

const students = [];
for (const student of STUDENTS) {
  const code = generateCode();
  students.push({ ...student, code, codeHash: await hashCode(code) });
}

const byHmac = db.prepare('SELECT id, role FROM users WHERE kennitala_hmac = ?');
const insert = db.prepare(`INSERT INTO users (role, kennitala_hmac, kennitala_enc, name, email, braut, code_hash, created_at, updated_at)
  VALUES ('student', ?, ?, ?, ?, ?, ?, ?, ?)`);
const update = db.prepare(`UPDATE users SET name = ?, email = ?, braut = ?, active = 1, code_hash = ?,
  failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?`);
const clearCourses = db.prepare('DELETE FROM student_courses WHERE user_id = ?');
const addCourse = db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)');

const seeded = db.transaction(() => students.filter((student) => {
  const now = toIso();
  const hmac = kt.hmac(student.kennitala);
  const existing = byHmac.get(hmac);
  // BR-12: a kennitala belongs to one account only, so a teacher's is never turned into a student.
  if (existing && existing.role !== 'student') {
    console.log(`Skipped ${student.kennitala}: it belongs to a teacher account.`);
    return false;
  }
  let id = existing?.id;
  if (id) {
    update.run(student.name, student.email, student.braut, student.codeHash, now, id);
    clearCourses.run(id);
  } else {
    id = Number(insert.run(hmac, kt.encrypt(student.kennitala), student.name, student.email, student.braut,
      student.codeHash, now, now).lastInsertRowid);
  }
  for (const course of student.courses) addCourse.run(id, course);
  return true;
}))();
db.close();

console.log(`Fake students for development. Log in at ${new URL('/login', config.baseUrl).href}`);
for (const student of seeded) {
  console.log(`  kennitala ${student.kennitala}  code ${student.code}  ${student.name} (${student.braut})`);
}
console.log('Run npm run seed:dev again to give them new codes.');
