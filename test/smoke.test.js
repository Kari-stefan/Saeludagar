import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig, MAX_POINTS_PER_COURSE, MAX_SIGNUPS_PER_STUDENT, POINTS_PER_ATTENDANCE } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrate, SCHEMA_VERSION } from '../src/db/migrate.js';
import { dictionaries } from '../src/i18n/index.js';

const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'test-secret', SCHOOL_NAME: 'Prófunarskóli' });

let server;
let baseUrl;

before(async () => {
  const app = createApp({ config });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function cookieFrom(res) {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

describe('app shell', () => {
  test('the app starts and GET / returns 200 with the page shell', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<html lang="is">/);
    assert.match(html, /Sæludagar – Prófunarskóli/);
    assert.match(html, /Viðburðir á Sæludögum/);
  });

  test('every page in AGENT_START §6 renders its stub in Icelandic', async () => {
    const pages = [
      ['/', 'Viðburðir á Sæludögum'],
      ['/events/1', 'Viðburður'],
      ['/login', 'Innskráning'],
      ['/login/new-code', 'Fá nýjan kóða'],
      ['/my-events', 'Mínir viðburðir'],
      ['/teacher', 'Kennarasvæði'],
      ['/teacher/events/new', 'Nýr viðburður'],
      ['/teacher/events/1/edit', 'Breyta viðburði'],
      ['/teacher/events/1/preview', 'Forskoðun viðburðar'],
      ['/teacher/events/1', 'Umsjón viðburðar'],
      ['/teacher/events/1/attendance', 'Mæting'],
      ['/teacher/events/1/print', 'Þátttakendalisti'],
      ['/teacher/events/1/message', 'Senda póst á þátttakendur'],
      ['/admin', 'Stjórnendasvæði'],
      ['/admin/settings', 'Dagsetningar og frestir'],
      ['/admin/import', 'Innflutningur nemenda'],
      ['/admin/codes', 'Senda kóða'],
      ['/admin/teachers', 'Kennarar'],
      ['/admin/events', 'Allir viðburðir'],
      ['/admin/export', 'Útflutningur fyrir skrifstofu'],
      ['/admin/purge', 'Hreinsun gagna'],
      ['/admin/audit', 'Aðgerðaskrá'],
    ];
    for (const [pagePath, title] of pages) {
      const res = await fetch(`${baseUrl}${pagePath}`);
      assert.equal(res.status, 200, pagePath);
      assert.match(await res.text(), new RegExp(`<h1>${title}</h1>`), pagePath);
    }
  });

  test('stubs without a page: GET /admin/export.csv answers 501, POST /logout redirects home', async () => {
    const csv = await fetch(`${baseUrl}/admin/export.csv`);
    assert.equal(csv.status, 501);
    assert.equal(await csv.text(), 'Ekki tilbúið enn.');

    const logout = await fetch(`${baseUrl}/logout`, { method: 'POST', redirect: 'manual' });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get('location'), '/');
  });

  test('request errors before the language middleware still render the error page', async () => {
    const res = await fetch(`${baseUrl}/language`, {
      method: 'POST',
      body: new URLSearchParams({ lang: 'en', filler: 'x'.repeat(200 * 1024) }),
    });
    assert.equal(res.status, 413);
    const html = await res.text();
    assert.match(html, /<html lang="is">/);
    assert.match(html, /Eitthvað fór úrskeiðis/);
    assert.doesNotMatch(html, /PayloadTooLargeError|at .*\.js/);
  });

  test('unknown paths get the 404 page', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /Síða fannst ekki/);
  });

  test('security headers: strict CSP without inline styles or scripts, no X-Powered-By', async () => {
    const res = await fetch(`${baseUrl}/`);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /style-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('language (BR-59)', () => {
  test('BR-59: the ÍS/EN toggle switches the header text and is remembered for the session', async () => {
    const switchRes = await fetch(`${baseUrl}/language`, {
      method: 'POST',
      body: new URLSearchParams({ lang: 'en', returnTo: '/login' }),
      redirect: 'manual',
    });
    assert.equal(switchRes.status, 303);
    assert.equal(switchRes.headers.get('location'), '/login');
    const cookie = cookieFrom(switchRes);
    assert.ok(cookie.startsWith('sid='));

    const html = await (await fetch(`${baseUrl}/`, { headers: { cookie } })).text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, />Log in</);
    assert.match(html, /<h1>Sæludagar events<\/h1>/);

    const fresh = await (await fetch(`${baseUrl}/`)).text();
    assert.match(fresh, />Innskráning</);
  });

  test('BR-59: the language switch never redirects off-site', async () => {
    for (const returnTo of ['//evil.example', 'https://evil.example', '/\\evil.example', '']) {
      const res = await fetch(`${baseUrl}/language`, {
        method: 'POST',
        body: new URLSearchParams({ lang: 'en', returnTo }),
        redirect: 'manual',
      });
      assert.equal(res.headers.get('location'), '/', returnTo);
    }
  });

  test('BR-59: is.json and en.json contain exactly the same keys', () => {
    const keys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
    assert.deepEqual(keys(dictionaries.en).sort(), keys(dictionaries.is).sort());
  });

  test('BR-61: Icelandic strings say "viðburður", never "atburður"', () => {
    assert.doesNotMatch(JSON.stringify(dictionaries.is), /atburð/i);
  });
});

describe('database (§7)', () => {
  let dir;
  let db;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-test-'));
    db = openDatabase(path.join(dir, 'test.db'));
    migrate(db);
  });

  after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('migrate creates every table and index and sets user_version = 1', () => {
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 1);
    const names = (type) => db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'")
      .pluck().all(type).sort();
    assert.deepEqual(names('table'), [
      'audit_log', 'email_outbox', 'event_brautir', 'event_coteachers', 'events', 'registrations',
      'saeludagar_days', 'sessions', 'settings', 'student_courses', 'users',
    ]);
    assert.deepEqual(names('index'), [
      'audit_at', 'email_outbox_due', 'events_status_date', 'registrations_one_event_per_course',
      'registrations_student', 'sessions_expires', 'sessions_user', 'users_role_active',
    ]);
  });

  test('migrate is safe to run twice and creates the single settings row', () => {
    migrate(db);
    assert.equal(db.prepare('SELECT COUNT(*) FROM settings').pluck().get(), 1);
    assert.throws(() => db.prepare("INSERT INTO settings (id, updated_at) VALUES (2, 'x')").run());
  });

  test('connection pragmas: WAL, foreign keys on, busy timeout, synchronous NORMAL', () => {
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(db.pragma('synchronous', { simple: true }), 1); // 1 = NORMAL
  });

  test('BR-42: the schema allows each course only once per student', () => {
    const now = '2027-01-01T00:00:00Z';
    db.prepare(`INSERT INTO users (id, role, kennitala_hmac, kennitala_enc, name, email, created_at, updated_at)
      VALUES (1, 'teacher', 'h-teacher', 'e', 'Kennari', 'k@example.is', ?, ?),
             (2, 'student', 'h-student', 'e', 'Nemandi', 'n@example.is', ?, ?)`).run(now, now, now, now);
    const insertEvent = db.prepare(`INSERT INTO events (owner_id, title_is, description_is, host, capacity, event_date,
      start_time, end_time, location, created_at, updated_at)
      VALUES (1, 'V', 'L', 'H', 10, '2027-03-11', '10:00', '12:00', 'Stofa', ?, ?)`);
    const e1 = insertEvent.run(now, now).lastInsertRowid;
    const e2 = insertEvent.run(now, now).lastInsertRowid;
    const register = db.prepare(`INSERT INTO registrations (event_id, student_id, created_at, attended, course_code)
      VALUES (?, 2, ?, 1, 'STÆR2BH05')`);
    register.run(e1, now);
    assert.throws(() => register.run(e2, now), /UNIQUE/);
  });
});

test('BR-47: the absence-point constants are 4 / 4 / 4', () => {
  assert.equal(POINTS_PER_ATTENDANCE, 4);
  assert.equal(MAX_POINTS_PER_COURSE, 4);
  assert.equal(MAX_SIGNUPS_PER_STUDENT, 4);
});
