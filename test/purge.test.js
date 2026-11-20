// Milestone 8: the manual and automatic purge (BR-55), the audit log it empties (BR-56) and the
// hourly check (AGENT_START §8). Only fake people and fake kennitölur.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { startAutoPurge } from '../src/jobs/autoPurge.js';
import { audit } from '../src/services/audit.js';
import { autoPurge, purgeConfirmed, purgeData, purgeStatus } from '../src/services/purge.js';
import { insertEvent, startSite } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const DEADLINE = new Date('2027-04-01T12:00:00Z');
const DUE = new Date(DEADLINE.getTime() + 30 * DAY);
let site;
const people = {};
const as = {};
const events = {};

before(async () => {
  site = await startSite();
  const add = async (key, fields, login = false) => {
    people[key] = await site.addUser(fields);
    if (login) {
      as[key] = site.browser();
      await as[key].login(people[key].kennitala, people[key].code);
    }
  };
  await add('teacher', { name: 'Kennari Prófun', email: 'kennari@example.is' }, true);
  await add('admin', { name: 'Stefán Stjórnandi', email: 'stefan@example.is', isAdmin: true }, true);
  await add('admin2', { name: 'Halla Stjórnandi', email: 'halla@example.is', isAdmin: true });
  await add('inactiveAdmin', { name: 'Óvirkur Stjórnandi', email: 'ovirkur@example.is', isAdmin: true, active: false });
  as.guest = site.browser();
});

after(() => site.close());

// Every test starts from the same data: three students (a purge deletes them, so they are made
// again each time) with sign-ups, a course choice and audit entries, a student event manager who
// owns an event and co-teaches another, and a teacher co-teacher.
beforeEach(async () => {
  const { db } = site;
  db.exec(`DELETE FROM registrations; DELETE FROM event_coteachers; DELETE FROM events; DELETE FROM audit_log;
    DELETE FROM email_outbox; DELETE FROM users WHERE role = 'student'`);
  for (const [key, name] of [['jona', 'Jóna Nemandi'], ['sara', 'Sara Nemandi'], ['runar', 'Rúnar Nemandastjóri']]) {
    people[key] = await site.addUser({ role: 'student', name, email: `${key}@example.is` });
  }
  as.jona = site.browser();
  await as.jona.login(people.jona.kennitala, people.jona.code);
  db.exec('DELETE FROM sessions WHERE user_id IS NULL');
  db.prepare("UPDATE users SET is_event_manager = 1, created_at = ? WHERE role = 'teacher' OR id = ?")
    .run('2026-01-01T00:00:00Z', people.runar.id);
  const older = '2025-01-01T00:00:00Z';
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(older, people.admin2.id);
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run('2024-01-01T00:00:00Z', people.inactiveAdmin.id);
  db.prepare('UPDATE settings SET choice_deadline_at = NULL, last_purged_at = NULL').run();
  for (const key of ['jona', 'sara']) {
    db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)').run(people[key].id, 'ENSK2LS05');
  }
  events.published = insertEvent(db, people.teacher.id, { brautir: ['Náttúrufræðibraut'], image_file: 'mynd.png' });
  events.draft = insertEvent(db, people.teacher.id, { status: 'draft', event_date: '2027-03-12' });
  events.owned = insertEvent(db, people.runar.id, { title_is: 'Viðburður nemanda', event_date: '2027-03-12', start_time: '13:00', end_time: '14:00' });
  db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(events.published, people.runar.id);
  db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(events.draft, people.teacher.id);
  db.prepare(`INSERT INTO registrations (event_id, student_id, created_at, attended, course_code, course_chosen_at)
    VALUES (?, ?, ?, 1, 'ENSK2LS05', ?)`).run(events.published, people.jona.id, toIso(), toIso());
  db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(events.draft, people.sara.id, toIso());
  audit(db, 'signup.create', people.jona.id, events.published, people.jona.id);
  const queue = db.prepare("INSERT INTO email_outbox (kind, user_id, created_at) VALUES (?, ?, ?)");
  queue.run('student_code', people.jona.id, toIso());
  queue.run('teacher_message', people.teacher.id, toIso());
});

const count = (table, where = '1 = 1') => site.db.prepare(`SELECT COUNT(*) FROM ${table} WHERE ${where}`).pluck().get();
const setTimes = (deadline, lastPurged = null) => site.db.prepare('UPDATE settings SET choice_deadline_at = ?, last_purged_at = ?')
  .run(deadline ? toIso(deadline) : null, lastPurged ? toIso(lastPurged) : null);
const ownerOf = (id) => site.db.prepare('SELECT owner_id FROM events WHERE id = ?').pluck().get(id);
const studentSessions = () => count('sessions', "user_id IN (SELECT id FROM users WHERE role = 'student')");

describe('the purge service (BR-55, BR-56)', () => {
  test('BR-55, BR-56: a purge deletes all student data and keeps teachers, events and dates', () => {
    assert.ok(studentSessions() > 0);
    assert.equal(count('users', "role = 'student'"), 3);
    const days = count('saeludagar_days');
    const result = purgeData(site.db, people.admin.id);
    assert.deepEqual(result, { ok: true, students: 3 });
    assert.equal(count('users', "role = 'student'"), 0);
    assert.equal(count('student_courses'), 0);
    assert.equal(count('registrations'), 0);
    assert.equal(count('audit_log'), 0);
    assert.equal(count('email_outbox', "kind = 'student_code'"), 0);
    assert.equal(studentSessions(), 0);
    // Kept: teachers, a teacher's email, the events with brautir and images, the days.
    assert.equal(count('users', "role = 'teacher'"), 4);
    assert.equal(count('email_outbox', "kind = 'teacher_message'"), 1);
    assert.equal(count('events'), 3);
    assert.equal(count('event_brautir'), 1);
    assert.equal(count('event_images'), 1);
    assert.equal(count('saeludagar_days'), days);
  });

  test('BR-55: a purge deletes the students\' sessions and keeps those of teachers and guests', async () => {
    assert.ok(count('sessions', "user_id = " + people.jona.id) > 0);
    assert.ok(count('sessions', 'user_id = ' + people.teacher.id) > 0);
    await as.guest.get('/');
    purgeData(site.db, people.admin.id);
    assert.equal(studentSessions(), 0);
    assert.ok(count('sessions', 'user_id = ' + people.teacher.id) > 0);
    assert.ok(count('sessions', 'user_id IS NULL') > 0);
  });

  test('BR-55: every event is a draft afterwards, and the time of the purge is stored', () => {
    setTimes(DEADLINE);
    const before = site.db.prepare('SELECT choice_deadline_at, signup_opens_at FROM settings').get();
    assert.equal(count('events', "status = 'published'"), 2);
    purgeData(site.db, people.admin.id, DUE);
    assert.equal(count('events', "status = 'published'"), 0);
    assert.equal(site.db.prepare('SELECT last_purged_at FROM settings').pluck().get(), toIso(DUE));
    assert.deepEqual(site.db.prepare('SELECT choice_deadline_at, signup_opens_at FROM settings').get(), before);
  });

  test('BR-55, BR-67: an event owned by a student event manager moves to the admin who ran the purge', () => {
    purgeData(site.db, people.admin.id);
    assert.equal(ownerOf(events.owned), people.admin.id);
    assert.equal(ownerOf(events.published), people.teacher.id);
  });

  test('BR-55, BR-67: the student\'s co-teacher link is removed and a teacher\'s stays', () => {
    purgeData(site.db, people.admin.id);
    assert.equal(count('event_coteachers', 'teacher_id = ' + people.runar.id), 0);
    assert.equal(count('event_coteachers', 'teacher_id = ' + people.teacher.id), 1);
  });

  test('BR-55: the service refuses an account that is not an active admin and changes nothing', () => {
    for (const id of [people.teacher.id, people.inactiveAdmin.id, people.jona.id, 99999]) {
      assert.deepEqual(purgeData(site.db, id), { error: 'purge.errors.notAdmin' }, String(id));
    }
    assert.equal(count('users', "role = 'student'"), 3);
    assert.equal(count('registrations'), 2);
    assert.equal(count('events', "status = 'published'"), 2);
    assert.equal(site.db.prepare('SELECT last_purged_at FROM settings').pluck().get(), null);
  });

  test('BR-55: a purge is allowed before the course-choice deadline', () => {
    setTimes(new Date(Date.now() + 30 * DAY));
    assert.ok(purgeData(site.db, people.admin.id).ok);
  });

  test('BR-55: the confirmation word is EYÐA or DELETE, in any case, and nothing else', () => {
    for (const word of ['EYÐA', 'eyða', ' delete ', 'DELETE', 'Delete']) assert.equal(purgeConfirmed(word), true, word);
    for (const word of ['', 'eyda', 'yes', 'DELETE ME', undefined, null, ['DELETE'], 5]) assert.equal(purgeConfirmed(word), false, String(word));
  });

  test('BR-55: purgeStatus gives the deadline, whether it passed, the automatic purge and the last purge', () => {
    assert.deepEqual(purgeStatus(site.db), { deadline: null, deadlinePassed: false, autoPurgeAt: null, lastPurgedAt: null });
    setTimes(DEADLINE);
    assert.deepEqual(purgeStatus(site.db, new Date(DEADLINE.getTime() - 1000)), {
      deadline: toIso(DEADLINE), deadlinePassed: false, autoPurgeAt: toIso(DUE), lastPurgedAt: null,
    });
    assert.equal(purgeStatus(site.db, DEADLINE).deadlinePassed, true);
    setTimes(DEADLINE, DUE);
    assert.deepEqual(purgeStatus(site.db, DUE), {
      deadline: toIso(DEADLINE), deadlinePassed: true, autoPurgeAt: null, lastPurgedAt: toIso(DUE),
    });
    setTimes(DEADLINE, new Date(DEADLINE.getTime() - DAY));
    assert.equal(purgeStatus(site.db, DUE).autoPurgeAt, toIso(DUE));
  });
});

describe('the automatic purge (§8, BR-55)', () => {
  const purged = () => count('users', "role = 'student'") === 0;

  test('§8, BR-55: with no deadline nothing is purged', () => {
    assert.deepEqual(autoPurge(site.db, new Date('2099-01-01T00:00:00Z')), { purged: false });
    assert.equal(purged(), false);
  });

  test('§8, BR-55: one second before the deadline plus 30 days nothing is purged, and exactly then it is', () => {
    setTimes(DEADLINE);
    assert.deepEqual(autoPurge(site.db, new Date(DUE.getTime() - 1000)), { purged: false });
    assert.equal(purged(), false);
    assert.deepEqual(autoPurge(site.db, DUE), { purged: true, students: 3 });
    assert.equal(purged(), true);
    assert.equal(count('registrations'), 0);
    assert.equal(count('audit_log'), 0);
    assert.equal(count('events', "status = 'published'"), 0);
    assert.equal(site.db.prepare('SELECT last_purged_at FROM settings').pluck().get(), toIso(DUE));
  });

  test('§8, BR-55: it does not purge again once it has purged since the deadline', () => {
    setTimes(DEADLINE, DEADLINE);
    assert.deepEqual(autoPurge(site.db, DUE), { purged: false });
    assert.equal(purged(), false);
    setTimes(DEADLINE, new Date(DEADLINE.getTime() + DAY));
    assert.deepEqual(autoPurge(site.db, DUE), { purged: false });
    assert.equal(purged(), false);
    // After it has purged, a second check changes nothing.
    setTimes(DEADLINE);
    assert.equal(autoPurge(site.db, DUE).purged, true);
    assert.deepEqual(autoPurge(site.db, new Date(DUE.getTime() + 3600 * 1000)), { purged: false });
  });

  test('§8, BR-55: it purges when the last purge was before the deadline', () => {
    setTimes(DEADLINE, new Date(DEADLINE.getTime() - 1000));
    assert.equal(autoPurge(site.db, DUE).purged, true);
  });

  test('§8, BR-55, BR-67: a student\'s event goes to the active admin whose account is oldest', () => {
    setTimes(DEADLINE);
    autoPurge(site.db, DUE);
    // admin2 is older than admin; the oldest admin of all is inactive and must be skipped.
    assert.equal(ownerOf(events.owned), people.admin2.id);
    assert.equal(count('event_coteachers', 'teacher_id = ' + people.runar.id), 0);
  });

  test('§8, BR-55, BR-67: with only an inactive admin the event goes to that one', () => {
    site.db.prepare('UPDATE users SET active = 0 WHERE id IN (?, ?)').run(people.admin.id, people.admin2.id);
    try {
      setTimes(DEADLINE);
      assert.equal(autoPurge(site.db, DUE).purged, true);
      assert.equal(ownerOf(events.owned), people.inactiveAdmin.id);
    } finally {
      site.db.prepare('UPDATE users SET active = 1 WHERE id IN (?, ?)').run(people.admin.id, people.admin2.id);
    }
  });

  test('§8, BR-55, BR-67: with no admin and a student-owned event it changes nothing and says why', () => {
    site.db.prepare('UPDATE users SET is_admin = 0 WHERE is_admin = 1').run();
    try {
      setTimes(DEADLINE);
      assert.deepEqual(autoPurge(site.db, DUE), { purged: false, reason: 'no-admin' });
      assert.equal(purged(), false);
      assert.equal(count('registrations'), 2);
      assert.equal(site.db.prepare('SELECT last_purged_at FROM settings').pluck().get(), null);
      // Without a student-owned event it can purge, with nobody to take over.
      site.db.prepare('UPDATE events SET owner_id = ? WHERE id = ?').run(people.teacher.id, events.owned);
      assert.equal(autoPurge(site.db, DUE).purged, true);
    } finally {
      site.db.prepare('UPDATE users SET is_admin = 1 WHERE id IN (?, ?, ?)').run(people.admin.id, people.admin2.id, people.inactiveAdmin.id);
    }
  });

  test('§8, BR-55: the hourly job purges a due database and its stop function stops it', async () => {
    setTimes(new Date(Date.now() - 60 * DAY));
    const lines = [];
    const log = console.log;
    console.log = (text) => lines.push(text);
    const stop = startAutoPurge(site.db, 20);
    try {
      for (let i = 0; i < 100 && !purged(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      stop();
      console.log = log;
    }
    assert.equal(purged(), true);
    assert.deepEqual(lines, ['Automatic purge: student data deleted (BR-55).']);
    // Stopped: a database that is due again is not touched.
    site.db.prepare('UPDATE settings SET last_purged_at = NULL').run();
    const student = site.db.prepare("INSERT INTO users (role, kennitala_hmac, kennitala_enc, name, email, created_at, updated_at) VALUES ('student', 'x', 'x', 'Nemi', 'nemi@example.is', ?, ?)")
      .run(toIso(), toIso());
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(count('users', 'id = ' + student.lastInsertRowid), 1);
  });
});

describe('the purge page (§6, BR-55)', () => {
  test('BR-55, §6: an admin sees what is deleted, the export link and the warning when no deadline is set', async () => {
    const res = await as.admin.get('/admin/purge');
    assert.equal(res.status, 200);
    assert.match(res.html, /<h1>Hreinsun gagna<\/h1>/);
    assert.match(res.html, /Nemendum, áfangalistum þeirra og innskráningarkóðum/);
    assert.match(res.html, /Aðgerðaskránni/);
    assert.match(res.html, /Allir viðburðir verða að drögum/);
    assert.match(res.html, /<a href="\/admin\/export">/);
    assert.match(res.html, /<div class="alert">\s*<p>Frestur til að velja áfanga hefur ekki verið settur/);
    assert.match(res.html, /Engin sjálfvirk hreinsun er fyrirhuguð, því frestur/);
    assert.doesNotMatch(res.html, /síðast eytt/);
    assert.match(res.html, /Skrifaðu orðið EYÐA til að staðfesta/);
    assert.doesNotMatch(res.html, /<script(?![^>]* src=)|style=|onclick=/);
  });

  test('BR-55, §6: with a future deadline the warning names it, and the automatic purge date is shown', async () => {
    const deadline = new Date(Date.now() + 10 * DAY);
    deadline.setUTCSeconds(0, 0);
    setTimes(deadline);
    const html = (await as.admin.get('/admin/purge')).html;
    assert.match(html, /<div class="alert">\s*<p>Fresturinn til að velja áfanga rennur út \d+\. \S+ \d{4}, kl\. \d\d:\d\d\./);
    assert.match(html, /Gögnunum er eytt sjálfkrafa \d+\. /);
  });

  test('BR-55, §6: after the deadline there is no warning', async () => {
    setTimes(new Date(Date.now() - 2 * DAY));
    const html = (await as.admin.get('/admin/purge')).html;
    assert.doesNotMatch(html, /<div class="alert">/);
    assert.match(html, /Gögnunum er eytt sjálfkrafa/);
  });

  test('BR-55, §6: a wrong or missing word gives 400, an error on the field, and deletes nothing', async () => {
    for (const form of [{ confirm: 'já' }, {}, { confirm: '' }]) {
      const res = await as.admin.post('/admin/purge', form);
      assert.equal(res.status, 400);
      assert.match(res.html, /role="alert"/);
      assert.match(res.html, /<p class="field__error" id="field-confirm-error">Skrifaðu staðfestingarorðið/);
      assert.match(res.html, /id="field-confirm"[^>]*aria-describedby="field-confirm-error"[^>]*aria-invalid="true"/);
      assert.match(res.html, /id="field-confirm" name="confirm" type="text" value=""/);
      assert.equal(count('users', "role = 'student'"), 3);
      assert.equal(count('registrations'), 2);
    }
  });

  for (const word of ['EYÐA', ' delete ']) {
    test(`BR-55: typing "${word.trim()}" purges, with the success message`, async () => {
      assert.equal(count('users', "role = 'student'"), 3);
      const res = await as.admin.post('/admin/purge', { confirm: word });
      assert.equal(res.status, 303);
      assert.equal(res.location, '/admin/purge');
      assert.equal(count('users', "role = 'student'"), 0);
      assert.equal(ownerOf(events.owned), people.admin.id);
      const page = await as.admin.get('/admin/purge');
      assert.match(page.html, /<div class="alert alert--success" role="status">\s*<p>Nemendagögnum var eytt\. Fjöldi nemenda sem var eytt: 3\./);
      assert.match(page.html, /Gögnunum var síðast eytt/);
    });
  }

  test('BR-55: a teacher who is not an admin gets 403 and a guest is sent to the login page', async () => {
    assert.equal((await as.teacher.get('/admin/purge')).status, 403);
    assert.equal((await as.teacher.post('/admin/purge', { confirm: 'EYÐA' })).status, 403);
    assert.equal((await as.guest.get('/admin/purge')).location, '/login');
    assert.equal(count('users', "role = 'student'"), 3);
  });

  test('BR-55: a POST without the CSRF token gets 403 and deletes nothing', async () => {
    const res = await as.admin.request('POST', '/admin/purge', { confirm: 'EYÐA' });
    assert.equal(res.status, 403);
    assert.equal(count('users', "role = 'student'"), 3);
  });

  test('BR-55: a student who was logged in is logged out by the purge', async () => {
    assert.equal((await as.jona.get('/points')).status, 200);
    await as.admin.post('/admin/purge', { confirm: 'EYÐA' });
    assert.equal((await as.jona.get('/points')).location, '/login');
  });

  test('BR-55, BR-59: the English page shows DELETE as the confirmation word', async () => {
    const browser = site.browser();
    await browser.login(people.admin.kennitala, people.admin.code);
    await browser.post('/language', { lang: 'en', returnTo: '/admin/purge' });
    const html = (await browser.get('/admin/purge')).html;
    assert.match(html, /<h1>Purge data<\/h1>/);
    assert.match(html, /Type the word DELETE to confirm/);
    assert.equal((await browser.post('/admin/purge', { confirm: 'nei' })).status, 400);
    assert.equal(count('users', "role = 'student'"), 3);
  });
});
