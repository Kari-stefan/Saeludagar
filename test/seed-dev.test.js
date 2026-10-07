import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { ROOT_DIR } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { kennitalaCrypto } from '../src/services/crypto.js';
import { Browser, insertUser, randomKey, tempDatabase, testConfig } from './helpers.js';

// Runs the script the way `npm run seed:dev` does, without reading any .env file.
function seedDev(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/seed-dev.js'], {
      cwd: ROOT_DIR,
      env: { ...process.env, NODE_ENV: 'development', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const codesFrom = (stdout) => Object.fromEntries(
  [...stdout.matchAll(/^ {2}kennitala (\d{10}) {2}code (\d{6}) /gm)].map((m) => [m[1], m[2]]),
);

describe('npm run seed:dev (fake development data, AGENT_START §10)', () => {
  let database;
  let env;
  let config;

  before(() => {
    database = tempDatabase();
    env = { DATABASE_PATH: database.file, KENNITALA_ENC_KEY: randomKey(), KENNITALA_HMAC_KEY: randomKey() };
    config = testConfig({ KENNITALA_ENC_KEY: env.KENNITALA_ENC_KEY, KENNITALA_HMAC_KEY: env.KENNITALA_HMAC_KEY });
  });

  after(() => database.remove());

  async function loginAs(kennitala, code) {
    const server = await new Promise((resolve) => {
      const listening = createApp({ config, db: database.db }).listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      return await new Browser(`http://127.0.0.1:${server.address().port}`).login(kennitala, code);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('creates fake students with courses and prints their codes; BR-02: they land on the student pages', async () => {
    const { code, stdout, stderr } = await seedDev(env);
    assert.equal(code, 0, stderr);
    const codes = codesFrom(stdout);
    assert.deepEqual(Object.keys(codes), ['0000000101', '0000000102', '0000000103']);

    const students = database.db.prepare("SELECT id, name, braut, active FROM users WHERE role = 'student' ORDER BY id").all();
    assert.equal(students.length, 3);
    assert.ok(students.every((s) => s.active === 1));
    const courses = database.db.prepare('SELECT course_code FROM student_courses WHERE user_id = ?').pluck().all(students[0].id);
    assert.deepEqual(new Set(courses), new Set(['STÆR2BH05', 'ÍSLE2MB05']));

    const login = await loginAs('000000-0101', codes['0000000101']);
    assert.equal(login.location, '/my-events');
  });

  test('running it again gives the same students new codes, without duplicates', async () => {
    const before = codesFrom((await seedDev(env)).stdout);
    const { code, stdout } = await seedDev(env);
    assert.equal(code, 0);
    const after = codesFrom(stdout);
    assert.equal(database.db.prepare("SELECT COUNT(*) FROM users WHERE role = 'student'").pluck().get(), 3);
    assert.equal(database.db.prepare('SELECT COUNT(*) FROM student_courses').pluck().get(), 3);
    assert.equal((await loginAs('0000000102', after['0000000102'])).location, '/my-events');
    if (before['0000000102'] !== after['0000000102']) {
      assert.equal((await loginAs('0000000102', before['0000000102'])).status, 401, 'the previous code stops working');
    }
  });

  test('BR-12: never turns a teacher\'s kennitala into a student', async () => {
    const kt = kennitalaCrypto({ kennitalaEncKey: env.KENNITALA_ENC_KEY, kennitalaHmacKey: env.KENNITALA_HMAC_KEY });
    const db = tempDatabase();
    try {
      await insertUser(db.db, kt, { kennitala: '0000000103', role: 'teacher' });
      db.db.close();
      const { code, stdout } = await seedDev({ ...env, DATABASE_PATH: db.file });
      assert.equal(code, 0);
      assert.match(stdout, /^Skipped 0000000103: it belongs to a teacher account\.$/m);
      assert.deepEqual(Object.keys(codesFrom(stdout)), ['0000000101', '0000000102']);
      const check = openDatabase(db.file);
      assert.equal(check.prepare('SELECT role FROM users WHERE kennitala_hmac = ?').pluck().get(kt.hmac('0000000103')), 'teacher');
      check.close();
    } finally {
      db.remove();
    }
  });

  test('refuses to run in production, before migrate, or without the kennitala keys', async () => {
    const production = await seedDev({ ...env, NODE_ENV: 'production' });
    assert.equal(production.code, 1);
    assert.equal(production.stderr.trim(), 'seed:dev only creates fake development data. It does not run when NODE_ENV=production.');

    const notMigrated = await seedDev({ ...env, DATABASE_PATH: path.join(database.dir, 'empty.db') });
    assert.equal(notMigrated.code, 1);
    assert.equal(notMigrated.stderr.trim(), 'The database is not set up. Run: npm run migrate');

    const noKey = await seedDev({ ...env, KENNITALA_HMAC_KEY: '' });
    assert.equal(noKey.code, 1);
    assert.match(noKey.stderr, /^KENNITALA_HMAC_KEY is not set/);
  });
});
