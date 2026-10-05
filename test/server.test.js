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

// Starts src/server.js the way `npm start` does, without reading any .env file.
function runServer(env, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: ROOT_DIR,
      env: { ...process.env, NODE_ENV: 'test', ...env },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe('starting the server (src/server.js)', () => {
  let dir;
  let migratedDb;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-server-'));
    migratedDb = path.join(dir, 'migrated.db');
    const db = openDatabase(migratedDb);
    migrate(db);
    db.close();
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('exits with a clear message when the port is already in use', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, resolve));
    const { port } = blocker.address();
    try {
      const { code, output } = await runServer({
        PORT: String(port), SESSION_SECRET: 'test-secret', DATABASE_PATH: migratedDb,
      });
      assert.equal(code, 1);
      assert.match(output, new RegExp(`Port ${port} is already in use`));
      assert.doesNotMatch(output, /is running at/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  test('refuses to start before the database is migrated', async () => {
    const { code, output } = await runServer({
      PORT: '0', SESSION_SECRET: 'test-secret', DATABASE_PATH: path.join(dir, 'not-migrated.db'),
    });
    assert.equal(code, 1);
    assert.match(output, /The database is not set up\. Run: npm run migrate/);
  });

  test('refuses to start without SESSION_SECRET', async () => {
    const { code, output } = await runServer({
      PORT: '0', SESSION_SECRET: '', DATABASE_PATH: migratedDb,
    });
    assert.equal(code, 1);
    assert.match(output, /SESSION_SECRET is not set/);
  });
});
