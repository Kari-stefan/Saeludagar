import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { ROOT_DIR } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { verifyCode } from '../src/services/codes.js';
import { kennitalaCrypto } from '../src/services/crypto.js';
import { Browser, randomKey, tempDatabase, testConfig } from './helpers.js';

// Runs the script the way `npm run create-admin -- …` does, without reading any .env file.
function createAdmin(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/create-admin.js', ...args], {
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

const ANNA = ['--name', 'Anna Stjórnandi', '--email', 'anna@example.is', '--kennitala', '000000-0001'];

describe('npm run create-admin (BR-13)', () => {
  let database;
  let env;

  before(() => {
    database = tempDatabase();
    database.db.close();
    env = {
      DATABASE_PATH: database.file,
      KENNITALA_ENC_KEY: randomKey(),
      KENNITALA_HMAC_KEY: randomKey(),
      BASE_URL: 'https://saeludagar.example.is',
    };
  });

  after(() => database.remove());

  test('BR-13: creates an active admin teacher account and prints its code once', async () => {
    const { code, stdout, stderr } = await createAdmin(ANNA, env);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^Admin account created for Anna Stjórnandi \(anna@example\.is\)\.$/m);
    assert.match(stdout, /^This is the only time the code is shown\. Log in at https:\/\/saeludagar\.example\.is\/login$/m);
    assert.doesNotMatch(stdout, /0000000001|000000-0001/, 'the kennitala is not printed');
    const loginCode = /^Login code: (\d{6})$/m.exec(stdout)[1];

    const db = openDatabase(database.file);
    try {
      const kt = kennitalaCrypto({ kennitalaEncKey: env.KENNITALA_ENC_KEY, kennitalaHmacKey: env.KENNITALA_HMAC_KEY });
      const user = db.prepare('SELECT * FROM users').get();
      assert.equal(user.role, 'teacher');
      assert.equal(user.is_admin, 1);
      assert.equal(user.active, 1);
      assert.equal(user.name, 'Anna Stjórnandi');
      assert.equal(user.email, 'anna@example.is');
      assert.equal(user.kennitala_hmac, kt.hmac('0000000001'));
      assert.equal(kt.decrypt(user.kennitala_enc), '0000000001');
      assert.equal(await verifyCode(loginCode, user.code_hash), true);
      assert.equal(db.prepare('SELECT COUNT(*) FROM email_outbox').pluck().get(), 0, 'nothing is emailed');

      // The new admin logs in on the site with that code.
      const config = testConfig({ KENNITALA_ENC_KEY: env.KENNITALA_ENC_KEY, KENNITALA_HMAC_KEY: env.KENNITALA_HMAC_KEY });
      const server = await new Promise((resolve) => {
        const listening = createApp({ config, db }).listen(0, '127.0.0.1', () => resolve(listening));
      });
      try {
        const browser = new Browser(`http://127.0.0.1:${server.address().port}`);
        const login = await browser.login('0000000001', loginCode);
        assert.equal(login.location, '/teacher');
        assert.equal((await browser.get('/admin/teachers')).status, 200);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      db.close();
    }
  });

  test('BR-12: refuses a kennitala that already has an account', async () => {
    const { code, stderr } = await createAdmin(['--name', 'Afrit', '--email', 'afrit@example.is', '--kennitala', '0000000001'], env);
    assert.equal(code, 1);
    assert.equal(stderr.trim(), 'This kennitala already has an account');
  });

  test('prints the usage when an option is missing or unknown', async () => {
    for (const args of [[], ['--name', 'Anna'], [...ANNA, '--admin']]) {
      const { code, stderr } = await createAdmin(args, env);
      assert.equal(code, 1, args.join(' '));
      assert.match(stderr, /Usage: npm run create-admin -- --name "Full name" --email "name@example\.is" --kennitala "0000000000"/);
    }
  });

  test('BR-01: checks the kennitala, the email and the name', async () => {
    const { code, stderr } = await createAdmin(['--name', ' ', '--email', 'anna', '--kennitala', '12345'], env);
    assert.equal(code, 1);
    assert.equal(stderr.trim().split(/\r?\n/).join('|'), 'Enter a name|Enter a valid email address|Kennitala must be 10 digits');
  });

  test('needs a migrated database and the kennitala keys', async () => {
    const notMigrated = await createAdmin(ANNA, { ...env, DATABASE_PATH: path.join(database.dir, 'empty.db') });
    assert.equal(notMigrated.code, 1);
    assert.equal(notMigrated.stderr.trim(), 'The database is not set up. Run: npm run migrate');

    const noKey = await createAdmin(ANNA, { ...env, KENNITALA_ENC_KEY: '' });
    assert.equal(noKey.code, 1);
    assert.match(noKey.stderr, /^KENNITALA_ENC_KEY is not set\. Copy \.env\.example to \.env and fill it in/);
  });
});
