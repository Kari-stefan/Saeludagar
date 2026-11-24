import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import {
  MAX_POINTS_PER_COURSE, MAX_SIGNUPS_PER_DAY, MAX_SIGNUPS_PER_STUDENT, POINTS_PER_ATTENDANCE,
} from '../src/config.js';
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
      ['guest', '/info', 'Upplýsingar'],
      ['guest', `/events/${eventId}`, 'Prófunarviðburður'],
      ['guest', '/login', 'Innskráning'],
      ['guest', '/login/new-code', 'Fá nýjan kóða'],
      ['teacher', '/teacher/events/new', 'Nýr viðburður'],
      ['teacher', `/teacher/events/${eventId}/edit`, 'Breyta viðburði'],
      ['teacher', `/teacher/events/${eventId}/preview`, 'Prófunarviðburður'],
      ['teacher', `/teacher/events/${eventId}`, 'Prófunarviðburður'],
      // These three are headed by the event's title; the page's name is in <title>.
      ['teacher', `/teacher/events/${eventId}/attendance`, 'Prófunarviðburður', 'Mæting'],
      ['teacher', `/teacher/events/${eventId}/print`, 'Prófunarviðburður', 'Þátttakendalisti'],
      ['teacher', `/teacher/events/${eventId}/message`, 'Prófunarviðburður', 'Senda póst á þátttakendur'],
      ['admin', '/admin', 'Stjórnendasvæði'],
      ['admin', '/admin/settings', 'Dagsetningar og frestir'],
      ['admin', '/admin/import', 'Innflutningur nemenda'],
      ['admin', '/admin/codes', 'Senda kóða'],
      ['admin', '/admin/teachers', 'Viðburðastjórar'],
      ['admin', '/admin/events', 'Allir viðburðir'],
      ['admin', '/admin/export', 'Útflutningur fyrir skrifstofu'],
      ['admin', '/admin/purge', 'Hreinsun gagna'],
      ['admin', '/admin/audit', 'Aðgerðaskrá'],
    ];
    for (const [role, pagePath, title, pageName] of pages) {
      const res = await as[role].get(pagePath);
      assert.equal(res.status, 200, pagePath);
      assert.match(res.html, new RegExp(`<h1>${title}</h1>`), pagePath);
      if (pageName) assert.match(res.html, new RegExp(`<title>${pageName}: ${title} · `), pagePath);
    }
  });

  test('GET /admin/export.csv answers 200 with a CSV file', async () => {
    const cookie = [...as.admin.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const csv = await fetch(`${site.baseUrl}/admin/export.csv`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /^text\/csv; charset=utf-8$/);
    assert.match(await csv.text(), /^kennitala;nafn;braut;afangi;stig;vidburdur;dagsetning;merkt_af\r\n/);
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

  // The scripts in public/js are plain scripts (§9 item 2), so those on one page share one scope:
  // a name declared at the top of two of them stops the second from running at all.
  test('§9 item 2, §11: no two page scripts declare the same top-level name', () => {
    const dir = new URL('../public/js/', import.meta.url);
    const seen = new Map();
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(new URL(file, dir), 'utf8');
      for (const [, name] of source.matchAll(/^(?:const|let|var|class|(?:async )?function\*?) +([A-Za-z_$][\w$]*)/gm)) {
        assert.equal(seen.get(name), undefined, `"${name}" is declared at the top of both ${seen.get(name)} and ${file}`);
        seen.set(name, file);
      }
    }
    assert.ok(seen.size > 0, 'the scripts were read');
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

  test('migrate creates every table and index and sets the schema version', () => {
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 4);
    const names = (type) => db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'")
      .pluck().all(type).sort();
    assert.deepEqual(names('table'), [
      'audit_log', 'email_outbox', 'event_brautir', 'event_coteachers', 'event_images', 'events', 'registrations',
      'saeludagar_days', 'sessions', 'settings', 'student_courses', 'users',
    ]);
    assert.deepEqual(names('index'), [
      'audit_at', 'email_outbox_due', 'event_images_event', 'events_status_date', 'registrations_one_event_per_course',
      'registrations_student', 'sessions_expires', 'sessions_user', 'users_event_manager_active', 'users_role_active',
    ]);
  });

  // The tables as an older version had them, made from today's schema.sql by undoing what the
  // later versions changed. Returns a database at that version, without any rows.
  function databaseAt(version) {
    let sql = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    // Version 4 added the signup_added email kind.
    const withoutSignupAdded = sql.replace(",'signup_added'", '');
    assert.ok(withoutSignupAdded !== sql, 'schema.sql still has what version 4 changed');
    sql = withoutSignupAdded;
    // Version 3 moved each event's one image from events.image_file to the event_images table.
    if (version < 3) {
      const withoutImages = sql.replace(/-- Up to 5 images[\s\S]*?CREATE INDEX event_images_event[^\n]*\n/, '');
      const withImageFile = withoutImages.replace('  event_date        TEXT    NOT NULL,', '  image_file        TEXT,\n  event_date        TEXT    NOT NULL,');
      assert.ok(withoutImages !== sql && withImageFile !== withoutImages, 'schema.sql still has what version 3 changed');
      sql = withImageFile;
    }
    // Version 2 added the event-manager role.
    if (version < 2) sql = sql.split('\n').filter((line) => !line.includes('is_event_manager')).join('\n');
    const old = tempDatabase();
    old.db.pragma('foreign_keys = OFF');
    for (const table of old.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all()) {
      old.db.exec(`DROP TABLE ${table}`);
    }
    old.db.exec(sql);
    old.db.pragma('foreign_keys = ON');
    old.db.pragma(`user_version = ${version}`);
    return old;
  }
  // Every table's columns and every index, to compare an upgraded database with a new one.
  const shape = (database) => Object.fromEntries(database.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name, type }) => [name, type === 'table' ? database.prepare(`SELECT name, type, "notnull", pk FROM pragma_table_info('${name}') ORDER BY name`).all() : type]));

  test('BR-67: migrate upgrades a version 1 database, keeping its data and making teachers event managers', () => {
    const old = databaseAt(1);
    try {
      const add = old.db.prepare(`INSERT INTO users (role, kennitala_hmac, kennitala_enc, name, email, created_at, updated_at)
        VALUES (?, ?, 'x', ?, 'profun@example.is', 'nu', 'nu')`);
      add.run('teacher', 'kennari', 'Kennari');
      add.run('student', 'nemandi', 'Nemandi');

      assert.equal(migrate(old.db), SCHEMA_VERSION);
      assert.equal(old.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
      assert.deepEqual(old.db.prepare('SELECT name, is_event_manager FROM users ORDER BY name').all(), [
        { name: 'Kennari', is_event_manager: 1 }, { name: 'Nemandi', is_event_manager: 0 },
      ]);
      assert.deepEqual(shape(old.db), shape(db), 'the same tables, columns and indexes as a new database');
      assert.equal(migrate(old.db), SCHEMA_VERSION, 'running it again changes nothing');
    } finally {
      old.remove();
    }
  });

  test('BR-27, BR-67: migrate upgrades a version 2 database: each image moves to event_images, and teachers get the role back', () => {
    const old = databaseAt(2);
    try {
      const add = old.db.prepare(`INSERT INTO users (role, is_event_manager, kennitala_hmac, kennitala_enc, name, email, created_at, updated_at)
        VALUES (?, ?, ?, 'x', ?, 'profun@example.is', 'nu', 'nu')`);
      const teacher = add.run('teacher', 0, 'kennari', 'Kennari sem missti réttindin').lastInsertRowid;
      add.run('student', 1, 'stjori', 'Nemandi með réttindi');
      add.run('student', 0, 'nemandi', 'Nemandi');
      const event = old.db.prepare(`INSERT INTO events (owner_id, title_is, description_is, host, capacity, image_file, event_date,
        start_time, end_time, location, created_at, updated_at) VALUES (?, ?, 'L', 'H', 10, ?, '2027-03-11', '10:00', '12:00', 'Stofa', 'nu', 'nu')`);
      const withImage = event.run(teacher, 'Með mynd', '11111111-2222-3333-4444-555555555555.png').lastInsertRowid;
      const without = event.run(teacher, 'Án myndar', null).lastInsertRowid;

      assert.equal(migrate(old.db), SCHEMA_VERSION);
      assert.deepEqual(old.db.prepare('SELECT event_id, file, position FROM event_images').all(), [
        { event_id: Number(withImage), file: '11111111-2222-3333-4444-555555555555.png', position: 0 },
      ]);
      assert.deepEqual(old.db.prepare('SELECT title_is FROM events ORDER BY id').pluck().all(), ['Með mynd', 'Án myndar'], 'the events are kept');
      assert.equal(old.db.prepare('SELECT COUNT(*) FROM event_images WHERE event_id = ?').pluck().get(without), 0);
      assert.deepEqual(old.db.prepare('SELECT name, is_event_manager FROM users ORDER BY id').all(), [
        { name: 'Kennari sem missti réttindin', is_event_manager: 1 }, { name: 'Nemandi með réttindi', is_event_manager: 1 }, { name: 'Nemandi', is_event_manager: 0 },
      ]);
      assert.deepEqual(shape(old.db), shape(db), 'the same tables, columns and indexes as a new database');
      assert.equal(migrate(old.db), SCHEMA_VERSION, 'running it again changes nothing');
    } finally {
      old.remove();
    }
  });

  test('BR-37, BR-53: migrate upgrades a version 3 database: the outbox keeps every row, with its kind\'s new priority, and accepts the signup_added kind', () => {
    const old = databaseAt(3);
    try {
      const user = old.db.prepare(`INSERT INTO users (role, is_event_manager, kennitala_hmac, kennitala_enc, name, email, created_at, updated_at)
        VALUES ('student', 0, 'nemandi', 'x', 'Nemandi', 'profun@example.is', 'nu', 'nu')`).run().lastInsertRowid;
      const queue = old.db.prepare(`INSERT INTO email_outbox (kind, priority, user_id, payload, created_at, attempts, last_error, next_try_at)
        VALUES (?, ?, ?, ?, '2027-03-01T10:00:00Z', ?, ?, ?)`);
      assert.throws(() => queue.run('signup_added', 1, user, null, 0, null, '2027-03-01T10:00:00Z'), /CHECK/, 'version 3 has no signup_added');
      queue.run('student_code', 1, user, null, 0, null, '2027-03-01T10:00:00Z');
      queue.run('event_changed', 0, user, '{"event":{"id":7}}', 3, 'connection refused', '2027-03-01T10:08:00Z');
      queue.run('teacher_message', 0, user, '{"subject":"Halló"}', 6, 'gave up', null);
      queue.run('new_code', 0, user, null, 0, null, '2027-03-01T10:01:00Z');
      queue.run('teacher_code', 0, user, null, 1, 'timeout', '2027-03-01T10:02:00Z');
      const rows = () => old.db.prepare('SELECT * FROM email_outbox ORDER BY id').all();
      const before = rows();
      assert.equal(before.length, 5);
      assert.deepEqual(before.map((row) => row.priority), [1, 0, 0, 0, 0], 'the priorities before M9');

      assert.equal(migrate(old.db), SCHEMA_VERSION);
      assert.equal(old.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
      // BR-53: each waiting email gets its kind's new priority, so mail queued before the upgrade
      // does not go ahead of new login codes; every other column is kept as it was.
      const priorities = [2, 1, 1, 0, 0]; // student_code, event_changed, teacher_message, new_code, teacher_code
      assert.deepEqual(rows(), before.map((row, n) => ({ ...row, priority: priorities[n] })));
      queue.run('signup_added', 1, user, '{"event":{"id":7}}', 0, null, '2027-03-01T11:00:00Z');
      assert.throws(() => queue.run('unknown_kind', 1, user, null, 0, null, '2027-03-01T11:00:00Z'), /CHECK/);
      assert.deepEqual(shape(old.db), shape(db), 'the same tables, columns and indexes as a new database');
      const outboxSql = (database) => database.prepare("SELECT sql FROM sqlite_master WHERE name = 'email_outbox'").pluck().get();
      assert.match(outboxSql(old.db), /'signup_added'/);
      assert.equal(migrate(old.db), SCHEMA_VERSION, 'running it again changes nothing');
    } finally {
      old.remove();
    }
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
    db.prepare(`INSERT INTO users (id, role, is_event_manager, kennitala_hmac, kennitala_enc, name, email, created_at, updated_at)
      VALUES (1, 'teacher', 1, 'h-teacher', 'e', 'Kennari', 'k@example.is', ?, ?),
             (2, 'student', 0, 'h-student', 'e', 'Nemandi', 'n@example.is', ?, ?)`).run(now, now, now, now);
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

test('BR-47: the constants are 4 points, 4 points per course, 4 sign-ups and 2 sign-ups a day', () => {
  assert.equal(POINTS_PER_ATTENDANCE, 4);
  assert.equal(MAX_POINTS_PER_COURSE, 4);
  assert.equal(MAX_SIGNUPS_PER_STUDENT, 4);
  assert.equal(MAX_SIGNUPS_PER_DAY, 2);
});
