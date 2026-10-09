import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { MAX_POINTS_PER_COURSE, MAX_SIGNUPS_PER_STUDENT, POINTS_PER_ATTENDANCE } from '../src/config.js';
import { migrate, SCHEMA_VERSION } from '../src/db/migrate.js';
import { dictionaries } from '../src/i18n/index.js';
import { Browser, insertEvent, startSite, tempDatabase } from './helpers.js';

let site;
const as = {};
let eventId;

before(async () => {
  site = await startSite();
  as.guest = site.browser();
  for (const [role, fields] of [['student', { role: 'student' }], ['teacher', {}], ['admin', { isAdmin: true }]]) {
    const account = await site.addUser(fields);
    as[role] = site.browser();
    await as[role].login(account.kennitala, account.code);
    if (role === 'teacher') eventId = insertEvent(site.db, account.id, { title_is: 'Prófunarviðburður' });
  }
});

after(() => site.close());

describe('app shell', () => {
  test('the app starts and GET / returns 200 with the page shell', async () => {
    const res = await as.guest.get('/');
    assert.equal(res.status, 200);
    assert.match(res.html, /<html lang="is">/);
    assert.match(res.html, /Sæludagar – Prófunarskóli/);
    assert.match(res.html, /Viðburðir á Sæludögum/);
  });

  test('every page in AGENT_START §6 renders in Icelandic for the role it is for', async () => {
    const pages = [
      ['guest', '/', 'Viðburðir á Sæludögum'],
      ['guest', `/events/${eventId}`, 'Prófunarviðburður'],
      ['guest', '/login', 'Innskráning'],
      ['guest', '/login/new-code', 'Fá nýjan kóða'],
      ['student', '/my-events', 'Mínir viðburðir'],
      ['teacher', '/teacher', 'Kennarasvæði'],
      ['teacher', '/teacher/events/new', 'Nýr viðburður'],
      ['teacher', `/teacher/events/${eventId}/edit`, 'Breyta viðburði'],
      ['teacher', `/teacher/events/${eventId}/preview`, 'Prófunarviðburður'],
      ['teacher', `/teacher/events/${eventId}`, 'Prófunarviðburður'],
      ['teacher', `/teacher/events/${eventId}/attendance`, 'Mæting'],
      ['teacher', `/teacher/events/${eventId}/print`, 'Þátttakendalisti'],
      ['teacher', `/teacher/events/${eventId}/message`, 'Senda póst á þátttakendur'],
      ['admin', '/admin', 'Stjórnendasvæði'],
      ['admin', '/admin/settings', 'Dagsetningar og frestir'],
      ['admin', '/admin/import', 'Innflutningur nemenda'],
      ['admin', '/admin/codes', 'Senda kóða'],
      ['admin', '/admin/teachers', 'Kennarar'],
      ['admin', '/admin/events', 'Allir viðburðir'],
      ['admin', '/admin/export', 'Útflutningur fyrir skrifstofu'],
      ['admin', '/admin/purge', 'Hreinsun gagna'],
      ['admin', '/admin/audit', 'Aðgerðaskrá'],
    ];
    for (const [role, pagePath, title] of pages) {
      const res = await as[role].get(pagePath);
      assert.equal(res.status, 200, pagePath);
      assert.match(res.html, new RegExp(`<h1>${title}</h1>`), pagePath);
    }
  });

  test('GET /admin/export.csv is still a stub that answers 501', async () => {
    const csv = await as.admin.get('/admin/export.csv');
    assert.equal(csv.status, 501);
    assert.equal(csv.html, 'Ekki tilbúið enn.');
  });

  test('a form body over 100 kB gets the error page without details', async () => {
    const res = await as.guest.post('/language', { lang: 'en', filler: 'x'.repeat(200 * 1024) });
    assert.equal(res.status, 413);
    assert.match(res.html, /<html lang="is">/);
    assert.match(res.html, /Eitthvað fór úrskeiðis/);
    assert.doesNotMatch(res.html, /PayloadTooLargeError|at .*\.js/);
  });

  test('unknown paths get the 404 page', async () => {
    const res = await as.guest.get('/does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.html, /Síða fannst ekki/);
  });

  test('security headers: strict CSP without inline styles or scripts, no X-Powered-By', async () => {
    const res = await fetch(`${site.baseUrl}/`);
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
    const browser = site.browser();
    const res = await browser.post('/language', { lang: 'en', returnTo: '/login' });
    assert.equal(res.status, 303);
    assert.equal(res.location, '/login');
    assert.ok(browser.sessionId);

    const html = (await browser.get('/')).html;
    assert.match(html, /<html lang="en">/);
    assert.match(html, />Log in</);
    assert.match(html, /<h1>Sæludagar events<\/h1>/);

    const fresh = (await site.browser().get('/')).html;
    assert.match(fresh, />Innskráning</);
  });

  test('BR-59: the choice survives a server restart, because sessions are kept in the database', async () => {
    const browser = site.browser();
    await browser.post('/language', { lang: 'en', returnTo: '/' });
    const restarted = await new Promise((resolve) => {
      const listening = createApp({ config: site.config, db: site.db }).listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const again = new Browser(`http://127.0.0.1:${restarted.address().port}`);
      again.cookies = browser.cookies;
      assert.match((await again.get('/')).html, /<html lang="en">/);
    } finally {
      await new Promise((resolve) => restarted.close(resolve));
    }
  });

  test('BR-59: the language switch never redirects off-site', async () => {
    const browser = site.browser();
    for (const returnTo of ['//evil.example', 'https://evil.example', '/\\evil.example', '']) {
      const res = await browser.post('/language', { lang: 'en', returnTo });
      assert.equal(res.location, '/', returnTo);
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
  let database;
  let db;

  before(() => {
    database = tempDatabase();
    db = database.db;
  });

  after(() => database.remove());

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
