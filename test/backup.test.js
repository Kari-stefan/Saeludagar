// Milestone 8: scripts/backup.js (AGENT_START §10 Hosting "Backups", §9 Retention, §8 Scheduled jobs).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { ROOT_DIR } from '../src/config.js';
import { openDatabase, toIso } from '../src/db/index.js';
import { SCHEMA_VERSION } from '../src/db/migrate.js';
import { kennitalaCrypto } from '../src/services/crypto.js';
import { Browser, insertEvent, insertUser, randomKey, tempDatabase, testConfig } from './helpers.js';

// Runs the script the way `npm run backup` does, without reading any .env file.
function runBackup(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/backup.js'], {
      cwd: ROOT_DIR,
      env: { ...process.env, NODE_ENV: 'test', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const stamp = (date) => `backup-${toIso(date).replaceAll(':', '-')}`;
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe('npm run backup (§10, §9)', () => {
  const dirs = [];
  const temp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-backup-'));
    dirs.push(dir);
    return dir;
  };
  after(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('§10: a backup restores into a temporary database', async () => {
    const database = tempDatabase();
    dirs.push(database.dir);
    const root = temp();
    const uploadDir = path.join(root, 'uploads');
    const backupDir = path.join(root, 'backups');
    fs.mkdirSync(uploadDir);
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    fs.writeFileSync(path.join(uploadDir, 'mynd.png'), imageBytes);
    fs.writeFileSync(path.join(uploadDir, '.gitkeep'), '');

    const keys = { KENNITALA_ENC_KEY: randomKey(), KENNITALA_HMAC_KEY: randomKey() };
    const kt = kennitalaCrypto({ kennitalaEncKey: keys.KENNITALA_ENC_KEY, kennitalaHmacKey: keys.KENNITALA_HMAC_KEY });
    // The source connection stays open, so these rows are still in the WAL when the script runs.
    const user = await insertUser(database.db, kt, { kennitala: '0000000001', name: 'Anna Kennari', email: 'anna@example.is', code: '654321' });
    const eventId = insertEvent(database.db, user.id, { title_is: 'Afritunarviðburður' });
    database.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(eventId, user.id, toIso());

    const { code, stdout, stderr } = await runBackup({ DATABASE_PATH: database.file, UPLOAD_DIR: uploadDir, BACKUP_DIR: backupDir });
    assert.equal(code, 0, stderr);
    const folders = fs.readdirSync(backupDir);
    assert.equal(folders.length, 1);
    assert.match(folders[0], /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
    assert.ok(stdout.includes(path.join(backupDir, folders[0])));
    assert.match(stdout, /1 image files copied/);

    const backup = path.join(backupDir, folders[0]);
    assert.deepEqual(fs.readFileSync(path.join(backup, 'uploads', 'mynd.png')), imageBytes);

    // Restore: copy the database file to a new place and open it.
    const restoredFile = path.join(temp(), 'restored.db');
    fs.copyFileSync(path.join(backup, 'saeludagar.db'), restoredFile);
    const restored = openDatabase(restoredFile);
    try {
      assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(restored.pragma('user_version', { simple: true }), SCHEMA_VERSION);
      for (const table of ['users', 'events', 'registrations']) {
        assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY id`).all(), database.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(), table);
      }
      assert.equal(restored.prepare('SELECT COUNT(*) FROM registrations').pluck().get(), 1);

      const config = testConfig(keys);
      const server = await new Promise((resolve) => {
        const listening = createApp({ config, db: restored }).listen(0, '127.0.0.1', () => resolve(listening));
      });
      try {
        const browser = new Browser(`http://127.0.0.1:${server.address().port}`);
        const login = await browser.login('0000000001', '654321');
        assert.equal(login.location, '/');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      restored.close();
      database.remove();
    }
  });

  test('§9: backups older than 7 days are deleted and newer ones kept', async () => {
    const database = tempDatabase();
    dirs.push(database.dir);
    database.db.close();
    const root = temp();
    const backupDir = path.join(root, 'backups');
    fs.mkdirSync(backupDir);
    const old = [stamp(daysAgo(8)), stamp(daysAgo(30)), `${stamp(daysAgo(9))}.partial`];
    const recent = [stamp(daysAgo(6)), stamp(daysAgo(1))];
    for (const name of [...old, ...recent]) {
      fs.mkdirSync(path.join(backupDir, name));
      fs.writeFileSync(path.join(backupDir, name, 'saeludagar.db'), 'x');
    }
    fs.writeFileSync(path.join(backupDir, '.gitkeep'), '');
    fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'hello');
    fs.mkdirSync(path.join(backupDir, 'other-folder'));
    fs.mkdirSync(path.join(backupDir, 'backup-9999-99-99T99-99-99Z'));

    const { code, stdout, stderr } = await runBackup({ DATABASE_PATH: database.file, UPLOAD_DIR: path.join(root, 'none'), BACKUP_DIR: backupDir });
    assert.equal(code, 0, stderr);
    assert.match(stdout, /Removed 3 backups/);
    const left = fs.readdirSync(backupDir);
    for (const name of old) assert.ok(!left.includes(name), `${name} is gone`);
    for (const name of recent) assert.ok(left.includes(name), `${name} is kept`);
    for (const name of ['.gitkeep', 'notes.txt', 'other-folder', 'backup-9999-99-99T99-99-99Z']) assert.ok(left.includes(name), `${name} is untouched`);
    const created = left.filter((name) => !old.includes(name) && !recent.includes(name) && name.startsWith('backup-2'));
    assert.equal(created.length, 1, 'one new backup');
    assert.ok(fs.statSync(path.join(backupDir, created[0], 'uploads')).isDirectory(), 'an empty uploads folder when there is no upload folder');
  });

  test('§10: a missing database fails without leaving a backup or a database file', async () => {
    const root = temp();
    const databaseFile = path.join(root, 'data', 'missing.db');
    const backupDir = path.join(root, 'backups');
    const { code, stderr } = await runBackup({ DATABASE_PATH: databaseFile, UPLOAD_DIR: path.join(root, 'uploads'), BACKUP_DIR: backupDir });
    assert.equal(code, 1);
    assert.match(stderr, /Cannot open the database/);
    assert.equal(fs.existsSync(databaseFile), false, 'no database file is created');
    assert.deepEqual(fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [], [], 'no backup folder');
  });

  test('§10: the output names the backup folder and holds no personal data', async () => {
    const database = tempDatabase();
    dirs.push(database.dir);
    const kt = kennitalaCrypto(testConfig());
    await insertUser(database.db, kt, { kennitala: '0000000001', email: 'nemandi@example.is' });
    database.db.close();
    const root = temp();
    const backupDir = path.join(root, 'backups');
    const { code, stdout, stderr } = await runBackup({ DATABASE_PATH: database.file, UPLOAD_DIR: path.join(root, 'uploads'), BACKUP_DIR: backupDir });
    assert.equal(code, 0, stderr);
    const [folder] = fs.readdirSync(backupDir);
    assert.ok(stdout.includes(path.join(backupDir, folder)));
    assert.match(stdout, /Removed 0 backups/);
    assert.doesNotMatch(stdout + stderr, /\b\d{10}\b|\b\d{6}-\d{4}\b|@/);
  });
});
