import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { verifyCode } from '../src/services/codes.js';
import { kennitalaCrypto } from '../src/services/crypto.js';
import { queueEmail } from '../src/services/email.js';
import { insertUser, randomKey } from './helpers.js';

// Starts src/server.js the way `npm start` does, without reading any .env file.
function startServer(env) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, NODE_ENV: 'test', ...env },
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { child, exited, output: () => output };
}

// For a server that is expected to stop by itself.
async function runServer(env, timeoutMs = 15000) {
  const server = startServer(env);
  const timer = setTimeout(() => server.child.kill(), timeoutMs);
  const code = await server.exited;
  clearTimeout(timer);
  return { code, output: server.output() };
}

// A port nobody is using. (PORT=0 does not work: the config treats 0 as unset and uses 3000.)
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor(check, timeoutMs = 15000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the server');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('starting the server (src/server.js)', () => {
  let dir;
  let migratedDb;
  let port;
  const keys = { KENNITALA_ENC_KEY: randomKey(), KENNITALA_HMAC_KEY: randomKey() };

  before(async () => {
    port = await freePort();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-server-'));
    migratedDb = path.join(dir, 'migrated.db');
    const db = openDatabase(migratedDb);
    migrate(db);
    db.close();
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const base = () => ({ PORT: String(port), SESSION_SECRET: 'test-secret', DATABASE_PATH: migratedDb, ...keys });

  test('exits with a clear message when the port is already in use', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, resolve));
    const busy = blocker.address().port;
    try {
      const { code, output } = await runServer({ ...base(), PORT: String(busy) });
      assert.equal(code, 1);
      assert.match(output, new RegExp(`Port ${busy} is already in use`));
      assert.doesNotMatch(output, /is running at/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  test('refuses to start before the database is migrated', async () => {
    const { code, output } = await runServer({ ...base(), DATABASE_PATH: path.join(dir, 'not-migrated.db') });
    assert.equal(code, 1);
    assert.match(output, /The database is not set up\. Run: npm run migrate/);
  });

  test('refuses to start without SESSION_SECRET', async () => {
    const { code, output } = await runServer({ ...base(), SESSION_SECRET: '' });
    assert.equal(code, 1);
    assert.match(output, /SESSION_SECRET is not set/);
  });

  test('BR-19: refuses to start without valid, separate kennitala keys', async () => {
    const cases = [
      [{ KENNITALA_ENC_KEY: '' }, /KENNITALA_ENC_KEY is not set\. Copy \.env\.example to \.env and fill it in/],
      [{ KENNITALA_HMAC_KEY: '' }, /KENNITALA_HMAC_KEY is not set/],
      [{ KENNITALA_HMAC_KEY: 'too-short' }, /KENNITALA_HMAC_KEY must be 32 random bytes, base64-encoded/],
      [{ KENNITALA_HMAC_KEY: keys.KENNITALA_ENC_KEY }, /KENNITALA_ENC_KEY and KENNITALA_HMAC_KEY must be different/],
    ];
    for (const [env, message] of cases) {
      const { code, output } = await runServer({ ...base(), ...env });
      assert.equal(code, 1, JSON.stringify(env));
      assert.match(output, message);
      assert.doesNotMatch(output, /is running at/);
    }
  });

  test('refuses to start with SMTP_HOST but no MAIL_FROM', async () => {
    const { code, output } = await runServer({ ...base(), SMTP_HOST: 'smtp.example.is', MAIL_FROM: '' });
    assert.equal(code, 1);
    assert.match(output, /MAIL_FROM is not set\. Set it to the school's noreply address/);
  });

  test('§8: starts the outbox worker, which prints code emails to the console in development', async () => {
    const db = openDatabase(migratedDb);
    try {
      const kt = kennitalaCrypto({ kennitalaEncKey: keys.KENNITALA_ENC_KEY, kennitalaHmacKey: keys.KENNITALA_HMAC_KEY });
      const teacher = await insertUser(db, kt, { kennitala: '0000000001', name: 'Kári Kennari', email: 'kari@example.is', code: null });
      queueEmail(db, { kind: 'teacher_code', userId: teacher.id });

      const server = startServer({ ...base(), NODE_ENV: 'development', SMTP_HOST: '' });
      const queued = db.prepare('SELECT COUNT(*) FROM email_outbox').pluck();
      try {
        await waitFor(() => queued.get() === 0 && /--- End of email ---/.test(server.output()));
      } finally {
        server.child.kill();
        await server.exited;
      }

      const output = server.output();
      assert.match(output, /is running at/);
      assert.match(output, /--- Email \(not sent, because SMTP_HOST is empty\) ---\r?\nTo: Kári Kennari <kari@example\.is>\r?\nSubject: Kóði fyrir Sæludagavefinn \/ Your code for the Sæludagar website/);
      const code = /^ {4}(\d{6})\r?$/m.exec(output)[1];
      const hash = db.prepare('SELECT code_hash FROM users WHERE id = ?').pluck().get(teacher.id);
      assert.equal(await verifyCode(code, hash), true, 'the printed code is the one stored');
      db.exec('DELETE FROM users');
    } finally {
      db.close();
    }
  });
});
