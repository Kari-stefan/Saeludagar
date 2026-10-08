// Shared test setup. Only fake data: kennitölur are 000000000N.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, toIso } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createOutboxWorker } from '../src/jobs/outbox.js';
import { hashCode } from '../src/services/codes.js';
import { kennitalaCrypto } from '../src/services/crypto.js';

export function randomKey() {
  return crypto.randomBytes(32).toString('base64');
}

export function testConfig(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret',
    SCHOOL_NAME: 'Prófunarskóli',
    KENNITALA_ENC_KEY: randomKey(),
    KENNITALA_HMAC_KEY: randomKey(),
    ...env,
  });
}

export function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-test-'));
  const file = path.join(dir, 'test.db');
  const db = openDatabase(file);
  migrate(db);
  return {
    db,
    dir,
    file,
    remove() {
      if (db.open) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Inserts an account with a known code, the way an import or create-admin would.
export async function insertUser(db, kt, {
  kennitala, role = 'teacher', isAdmin = false, active = true, name = 'Prófun', email = 'profun@example.is', code = '123456',
}) {
  const now = toIso();
  const result = db.prepare(`INSERT INTO users
    (role, is_admin, kennitala_hmac, kennitala_enc, name, email, active, code_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(role, isAdmin ? 1 : 0, kt.hmac(kennitala), kt.encrypt(kennitala), name, email, active ? 1 : 0,
      code === null ? null : await hashCode(code), now, now);
  return { id: Number(result.lastInsertRowid), kennitala, code };
}

// A running site on a random port with a temporary database. Emails go to `sent` when the
// test runs the outbox worker with sendEmails().
export async function startSite(env = {}) {
  const database = tempDatabase();
  const config = testConfig(env);
  const app = createApp({ config, db: database.db });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const kt = kennitalaCrypto(config);
  const sent = [];
  const outbox = createOutboxWorker({ db: database.db, config, mailer: { async send(message) { sent.push(message); } } });
  let lastFake = 0;

  return {
    db: database.db,
    dbFile: database.file,
    config,
    kt,
    baseUrl,
    browser: () => new Browser(baseUrl),
    addUser(fields = {}) {
      lastFake += 1;
      return insertUser(database.db, kt, { kennitala: String(lastFake).padStart(10, '0'), ...fields });
    },
    // Runs the outbox worker once and returns the emails it sent.
    async sendEmails() {
      await outbox.runOnce();
      return sent.splice(0);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      database.remove();
    },
  };
}

// The 6-digit code on its own line in a code email.
export function codeFrom(email) {
  const match = /^ {4}(\d{6})$/m.exec(email.text);
  assert.ok(match, 'no code in the email');
  return match[1];
}

// A browser with a cookie jar. post() sends the CSRF token from a page in the same session,
// as the site's own forms do.
export class Browser {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  async request(method, url, form, headers = {}) {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const res = await fetch(this.baseUrl + url, {
      method,
      redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      body: form instanceof FormData || !form ? form : new URLSearchParams(form),
    });
    const setCookies = res.headers.getSetCookie();
    for (const header of setCookies) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return { status: res.status, location: res.headers.get('location'), setCookies, html: await res.text() };
  }

  get(url) {
    return this.request('GET', url);
  }

  async csrfToken(from = '/') {
    const page = await this.get(from);
    const match = /name="_csrf" value="([^"]+)"/.exec(page.html);
    assert.ok(match, `no CSRF token on ${from}`);
    return match[1];
  }

  async post(url, form = {}) {
    return this.request('POST', url, { _csrf: await this.csrfToken(), ...form });
  }

  login(kennitala, code) {
    return this.post('/login', { kennitala, code });
  }

  // Uploads one file as a multipart form, the way the import page does: the token field comes first.
  async upload(url, bytes, { token, filename = 'nemendur.csv' } = {}) {
    const form = new FormData();
    if (token !== null) form.append('_csrf', token ?? await this.csrfToken());
    form.append('file', new Blob([bytes]), filename);
    return this.request('POST', url, form);
  }

  // The session ID inside the signed cookie value (s:<id>.<signature>).
  get sessionId() {
    const value = this.cookies.get('sid');
    return value && decodeURIComponent(value).slice(2).split('.')[0];
  }
}
