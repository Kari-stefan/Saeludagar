// Milestone 7: the audit log page (BR-56), with its access and privacy rules (§9). Only fake
// people and fake kennitölur (000000000N).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { formatDateTime } from '../src/i18n/index.js';
import { setAttendance } from '../src/services/attendance.js';
import { AUDIT_PAGE_SIZE, auditEntries, auditEvents } from '../src/services/audit.js';
import { givePoints, takePoints } from '../src/services/choices.js';
import { getEvent } from '../src/services/events.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const COURSE = 'ÍSLE2MB05';
// Attendance can be marked from the event's date (BR-39); insertEvent's events are on 2027-03-11.
const EVENT_DAY = new Date('2027-03-11T12:00:00Z');
let site;
const people = {};
const as = {};

before(async () => {
  site = await startSite();
  const add = async (key, fields, { login = true } = {}) => {
    people[key] = await site.addUser(fields);
    if (!login) return;
    as[key] = site.browser();
    await as[key].login(people[key].kennitala, people[key].code);
  };
  await add('teacher', { name: 'Kennari Prófun', email: 'kennari@example.is' });
  await add('admin', { name: 'Stefán Stjórnandi', email: 'stefan@example.is', isAdmin: true });
  await add('thorunn', { role: 'student', name: 'Þórunn Nemandi', email: 'thorunn@example.is' });
  await add('jona', { role: 'student', name: 'Jóna Nemandi', email: 'jona@example.is' }, { login: false });
  await add('markup', { role: 'student', name: '<b>x</b>', email: 'x@example.is' }, { login: false });
  as.english = site.browser();
  await as.english.login(people.admin.kennitala, people.admin.code);
  await as.english.post('/language', { lang: 'en', returnTo: '/' });
  as.guest = site.browser();
  const at = (offset) => toIso(new Date(Date.now() + offset));
  site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?').run(at(-HOUR), at(HOUR));
});

after(() => site.close());

beforeEach(() => {
  site.db.exec('DELETE FROM audit_log; DELETE FROM registrations; DELETE FROM events; DELETE FROM student_courses');
  site.db.prepare("UPDATE users SET is_event_manager = 0 WHERE role = 'student'").run();
});

// An entry written straight into the log, the way the import and an event's deletion write theirs.
// Returns its id.
const log = (fields) => Number(site.db.prepare(`INSERT INTO audit_log (at, actor_id, action, event_id, student_id, details)
  VALUES (@at, @actor, @action, @event, @student, @details)`)
  .run({ at: toIso(), actor: null, event: null, student: null, details: '{}', ...fields }).lastInsertRowid);

async function page(url = '/admin/audit', browser = as.admin) {
  const res = await browser.get(url);
  assert.equal(res.status, 200, url);
  return res.html;
}

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The table's rows, each as the text of its five cells: when, who, what, event, student.
function rows(html) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (!body) return [];
  return [...body[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((row) => [...row[1].matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((cell) => text(cell[1])));
}

const withoutWhen = (html) => rows(html).map((cells) => cells.slice(1));

describe('BR-56: the audit log page', () => {
  test('BR-56: every kind of action shows who did it, what, and when', async () => {
    const eventId = insertEvent(site.db, people.teacher.id, { title_is: 'Fjallganga' });
    const student = people.thorunn.id;
    site.db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)').run(student, COURSE);

    // The student signs up and cancels; the owner adds the student, removes and adds again.
    for (const action of ['signup', 'cancel']) {
      assert.equal((await as.thorunn.post(`/events/${eventId}`, { action })).status, 303, action);
    }
    for (const action of ['add-student', 'remove-student', 'add-student']) {
      assert.equal((await as.teacher.post(`/teacher/events/${eventId}`, { action, student: String(student) })).status, 303, action);
    }
    // Attendance and points: unmarking the attendance also takes the points back.
    const event = getEvent(site.db, eventId);
    assert.ok(setAttendance(site.db, people.teacher.id, event, [{ studentId: student, attended: true }], EVENT_DAY).ok);
    assert.ok(givePoints(site.db, student, COURSE).ok);
    assert.ok(takePoints(site.db, student, COURSE).ok);
    assert.ok(givePoints(site.db, student, COURSE).ok);
    assert.ok(setAttendance(site.db, people.teacher.id, event, [{ studentId: student, attended: false }], EVENT_DAY).ok);
    // The admin grants and takes away the event-manager role (BR-67).
    for (const action of ['promote-event-manager', 'revoke-event-manager']) {
      assert.equal((await as.admin.post('/admin/teachers', { action, id: String(student) })).status, 303, action);
    }
    // What the import and an event's deletion write.
    log({ actor: people.admin.id, action: 'signup.delete', event: eventId, student, details: '{"reason":"import"}' });
    log({ actor: people.admin.id, action: 'choice.clear', event: eventId, student, details: JSON.stringify({ course: COURSE, reason: 'import' }) });
    log({ actor: people.teacher.id, action: 'signup.delete', event: eventId, student, details: '{"reason":"event_deleted"}' });

    const html = await page();
    const [T, A, S, E] = ['Kennari Prófun', 'Stefán Stjórnandi', 'Þórunn Nemandi', 'Fjallganga'];
    assert.deepEqual(withoutWhen(html), [
      [T, 'Afskráning af viðburði Viðburðinum var eytt', E, S],
      [A, 'Stig tekin af áfanga Vegna innflutnings á nemendalista Áfangi: ÍSLE2MB05', E, S],
      [A, 'Afskráning af viðburði Vegna innflutnings á nemendalista', E, S],
      [A, 'Viðburðastjóraréttindi tekin Viðburðir sem viðkomandi átti þá: 0. Viðburðir sem meðviðburðastjóri: 0.', '', S],
      [A, 'Viðburðastjóraréttindi veitt', '', S],
      [T, 'Stig tekin af áfanga Mætingin var tekin til baka Áfangi: ÍSLE2MB05', E, S],
      [T, 'Mæting tekin til baka', E, S],
      [S, 'Stig sett á áfanga Áfangi: ÍSLE2MB05', E, S],
      [S, 'Stig tekin af áfanga Áfangi: ÍSLE2MB05', E, S],
      [S, 'Stig sett á áfanga Áfangi: ÍSLE2MB05', E, S],
      [T, 'Mæting skráð', E, S],
      [T, 'Skráning á viðburð Viðburðastjóri gerði þetta fyrir nemandann', E, S],
      [T, 'Afskráning af viðburði Viðburðastjóri gerði þetta fyrir nemandann', E, S],
      [T, 'Skráning á viðburð Viðburðastjóri gerði þetta fyrir nemandann', E, S],
      [S, 'Afskráning af viðburði Nemandinn gerði þetta sjálfur', E, S],
      [S, 'Skráning á viðburð Nemandinn gerði þetta sjálfur', E, S],
    ]);
    const stored = site.db.prepare('SELECT at FROM audit_log ORDER BY at DESC, id DESC').pluck().all();
    assert.deepEqual(rows(html).map((cells) => cells[0]), stored.map((at) => formatDateTime('is', at)));
    assert.match(html, /Færslur 1–16 af 16/);
    assert.ok(html.includes(`<a href="/teacher/events/${eventId}">Fjallganga</a>`), 'the event links to its page');
    for (const header of ['Hvenær', 'Hver', 'Hvað', 'Viðburður', 'Nemandi']) {
      assert.ok(html.includes(`<th scope="col">${header}</th>`), header);
    }
  });

  test('BR-56: the newest entries come first', async () => {
    const eventId = insertEvent(site.db, people.teacher.id);
    const entry = (at, action) => log({ at, actor: people.teacher.id, action, event: eventId, student: people.thorunn.id });
    entry('2027-03-11T10:00:00Z', 'attendance.set');
    entry('2027-03-11T12:00:00Z', 'signup.create');
    entry('2027-03-11T11:00:00Z', 'attendance.unset');
    entry('2027-03-11T12:00:00Z', 'signup.delete'); // the same second: the later entry first

    const shown = rows(await page());
    assert.deepEqual(shown.map((cells) => cells[2]), ['Afskráning af viðburði', 'Skráning á viðburð', 'Mæting tekin til baka', 'Mæting skráð']);
    assert.deepEqual(shown.map((cells) => cells[0]), ['12:00', '12:00', '11:00', '10:00'].map((time) => formatDateTime('is', `2027-03-11T${time}:00Z`)));
  });

  test('BR-56: the log can be filtered by event, by part of a student\'s name in any case, or both', async () => {
    const hike = insertEvent(site.db, people.teacher.id, { title_is: 'Fjallganga' });
    const baking = insertEvent(site.db, people.teacher.id, { title_is: 'Bakstur' });
    for (const event of [hike, baking]) {
      for (const key of ['thorunn', 'jona']) log({ actor: people.teacher.id, action: 'attendance.set', event, student: people[key].id });
    }
    log({ actor: people.admin.id, action: 'event-manager.grant', student: people.thorunn.id });
    const what = (html) => withoutWhen(html).map((cells) => `${cells[2]}/${cells[3]}`);

    const unfiltered = await page();
    assert.equal(rows(unfiltered).length, 5);
    assert.doesNotMatch(unfiltered, /Hreinsa síu/, 'no clear link without a filter');
    assert.ok(unfiltered.indexOf('>Bakstur</option>') < unfiltered.indexOf('>Fjallganga</option>'), 'events by title');
    assert.match(unfiltered, /<form class="form" method="get" action="\/admin\/audit" role="search" aria-label="Sía færslur">/);

    const byEvent = await page(`/admin/audit?event=${hike}`);
    assert.deepEqual(what(byEvent), ['Fjallganga/Jóna Nemandi', 'Fjallganga/Þórunn Nemandi']);
    assert.ok(byEvent.includes(`<option value="${hike}" selected>Fjallganga</option>`));
    assert.ok(byEvent.includes('<a class="button button--secondary" href="/admin/audit">Hreinsa síu</a>'));

    // SQL LIKE would not match "þór" with "Þórunn"; the Icelandic lower case does.
    for (const fragment of ['þór', 'ÞÓRU', 'unn nem']) {
      const html = await page(`/admin/audit?student=${encodeURIComponent(fragment)}`);
      assert.deepEqual(what(html), ['/Þórunn Nemandi', 'Bakstur/Þórunn Nemandi', 'Fjallganga/Þórunn Nemandi'], fragment);
      assert.ok(html.includes(`name="student" maxlength="100" value="${fragment}"`), fragment);
      assert.match(html, /Hreinsa síu/);
    }

    const both = await page(`/admin/audit?event=${baking}&student=${encodeURIComponent('þór')}`);
    assert.deepEqual(what(both), ['Bakstur/Þórunn Nemandi']);

    for (const url of ['/admin/audit?student=Zebra', `/admin/audit?event=${hike}&student=${encodeURIComponent('<b>')}`]) {
      const none = await page(url);
      assert.match(none, /<p class="empty">Engar færslur passa við síuna\.<\/p>/, url);
      assert.doesNotMatch(none, /<table/, url);
    }
  });

  test('BR-56: an empty log says so, and an action without a text shows as stored', async () => {
    const empty = await page();
    assert.match(empty, /<p class="empty">Engar færslur eru í skránni\.<\/p>/);
    assert.doesNotMatch(empty, /<table/);

    log({ action: 'something.new', details: 'not json' });
    assert.deepEqual(withoutWhen(await page()), [['Ekki lengur til', 'something.new', '', '']]);
  });

  test('BR-56: 100 entries a page, a page beyond the last shows the last, and the page links keep the filter', async () => {
    const hike = insertEvent(site.db, people.teacher.id, { title_is: 'Fjallganga' });
    const start = Date.parse('2027-03-11T08:00:00Z');
    const minute = (i) => toIso(new Date(start + i * 60 * 1000));
    for (let i = 0; i < 205; i += 1) {
      log({ at: minute(i), actor: people.teacher.id, action: 'attendance.set', event: hike, student: people.thorunn.id });
    }

    const first = await page();
    assert.match(first, /Færslur 1–100 af 205/);
    assert.equal(rows(first).length, AUDIT_PAGE_SIZE);
    assert.equal(rows(first)[0][0], formatDateTime('is', minute(204)));
    assert.ok(first.includes('href="/admin/audit?page=2">Eldri færslur</a>'));
    assert.doesNotMatch(first, /Nýrri færslur/);

    const last = await page('/admin/audit?page=3');
    assert.match(last, /Færslur 201–205 af 205/);
    assert.deepEqual(rows(last).map((cells) => cells[0]), [4, 3, 2, 1, 0].map((i) => formatDateTime('is', minute(i))));
    assert.ok(last.includes('href="/admin/audit?page=2">Nýrri færslur</a>'));
    assert.doesNotMatch(last, /Eldri færslur/);

    const beyond = await page('/admin/audit?page=99');
    assert.match(beyond, /Færslur 201–205 af 205/);
    assert.deepEqual(rows(beyond), rows(last));

    // Entries the filter leaves out are not counted, and both links keep the filter.
    const other = insertEvent(site.db, people.teacher.id, { title_is: 'Bakstur' });
    for (let i = 0; i < 3; i += 1) log({ actor: people.teacher.id, action: 'attendance.set', event: hike, student: people.jona.id });
    log({ actor: people.teacher.id, action: 'attendance.set', event: other, student: people.thorunn.id });
    assert.match(await page(), /Færslur 1–100 af 209/);

    const filter = { event: String(hike), student: 'þór' };
    const middle = await page(`/admin/audit?${new URLSearchParams({ ...filter, page: '2' })}`);
    assert.match(middle, /Færslur 101–200 af 205/);
    const link = (extra) => `/admin/audit?${new URLSearchParams({ ...filter, ...extra })}`.replaceAll('&', '&amp;');
    assert.ok(middle.includes(`href="${link({})}">Nýrri færslur</a>`), 'newer');
    assert.ok(middle.includes(`href="${link({ page: '3' })}">Eldri færslur</a>`), 'older');
  });

  test('BR-56: an entry stays when its event, actor or student is gone', async () => {
    const eventId = insertEvent(site.db, people.teacher.id, { title_is: 'Fjallganga' });
    site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(eventId, people.thorunn.id, toIso());
    // The owner deletes the event (BR-29), and its sign-ups go with it.
    assert.equal((await as.teacher.post(`/teacher/events/${eventId}`, { action: 'delete', confirm: '1' })).status, 303);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM events WHERE id = ?').pluck().get(eventId), 0);
    // A teacher whose account was deleted, about a student who no longer exists.
    const gone = await site.addUser({ name: 'Horfinn Kennari', email: 'horfinn@example.is' });
    log({ actor: gone.id, action: 'attendance.set', event: eventId, student: 999999 });
    site.db.prepare('DELETE FROM users WHERE id = ?').run(gone.id);

    const html = await page();
    assert.deepEqual(withoutWhen(html), [
      ['Ekki lengur til', 'Mæting skráð', `Viðburður nr. ${eventId} (eytt)`, 'Ekki lengur til'],
      ['Kennari Prófun', 'Afskráning af viðburði Viðburðinum var eytt', `Viðburður nr. ${eventId} (eytt)`, 'Þórunn Nemandi'],
    ]);
    assert.doesNotMatch(html, new RegExp(`href="/teacher/events/${eventId}"`));
    assert.doesNotMatch(html, /Horfinn Kennari/);
    assert.ok(html.includes(`<option value="${eventId}">Viðburður nr. ${eventId} (eytt)</option>`));
  });

  test('§9: a guest is sent to log in, and a student or a teacher who is not an admin gets 403', async () => {
    log({ actor: people.teacher.id, action: 'attendance.set', student: people.thorunn.id });
    const guest = await as.guest.get('/admin/audit');
    assert.equal(guest.status, 303);
    assert.equal(guest.location, '/login');
    for (const key of ['thorunn', 'teacher']) {
      const res = await as[key].get('/admin/audit?student=a');
      assert.equal(res.status, 403, key);
      assert.doesNotMatch(res.html, /<table/, key);
    }
  });

  test('§9: names and the filter are escaped', async () => {
    log({ actor: people.markup.id, action: 'signup.create', student: people.markup.id, details: JSON.stringify({ by: 'student', course: '<i>y</i>' }) });
    const html = await page(`/admin/audit?student=${encodeURIComponent('<b>')}`);
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.doesNotMatch(html, /<i>y<\/i>/);
    assert.deepEqual(withoutWhen(html), [['&lt;b&gt;x&lt;/b&gt;', 'Skráning á viðburð Nemandinn gerði þetta sjálfur Áfangi: &lt;i&gt;y&lt;/i&gt;', '', '&lt;b&gt;x&lt;/b&gt;']]);
    assert.ok(html.includes('name="student" maxlength="100" value="&lt;b&gt;"'));
  });

  test('§9: the page never shows a kennitala', async () => {
    const eventId = insertEvent(site.db, people.teacher.id, { title_is: 'Fjallganga' });
    for (const key of ['thorunn', 'jona', 'markup']) {
      log({ actor: people.teacher.id, action: 'signup.create', event: eventId, student: people[key].id, details: '{"by":"event_manager"}' });
    }
    log({ actor: people.admin.id, action: 'event-manager.grant', student: people.thorunn.id });
    for (const url of ['/admin/audit', `/admin/audit?event=${eventId}&student=n`]) {
      const html = await page(url);
      assert.equal(rows(html).length > 0, true, url);
      for (const [key, person] of Object.entries(people)) {
        // Both the 10 digits and the form the export writes, with a hyphen after the sixth digit.
        const hyphenated = `${person.kennitala.slice(0, 6)}-${person.kennitala.slice(6)}`;
        for (const form of [person.kennitala, hyphenated]) assert.ok(!html.includes(form), `${key} (${form}) on ${url}`);
      }
    }
  });

  test('BR-56: an English session shows the English texts', async () => {
    const eventId = insertEvent(site.db, people.teacher.id, { title_is: 'Fjallganga', title_en: 'Mountain hike' });
    const at = '2027-03-11T10:15:00Z';
    log({ at, actor: people.thorunn.id, action: 'signup.create', event: eventId, student: people.thorunn.id, details: '{"by":"student"}' });
    log({ at, actor: people.admin.id, action: 'event-manager.revoke', student: people.thorunn.id, details: '{"owned":2,"coteaching":1}' });
    log({ at, action: 'signup.delete', event: 31337, student: people.thorunn.id, details: '{"reason":"event_deleted"}' });

    const html = await page('/admin/audit', as.english);
    assert.match(html, /<h1>Audit log<\/h1>/);
    assert.match(html, /Entries 1–3 of 3/);
    assert.ok(html.includes('<option value="">All events</option>'));
    assert.ok(html.includes(`<option value="${eventId}">Mountain hike</option>`));
    assert.deepEqual(withoutWhen(html), [
      ['No longer exists', 'Sign-up removed The event was deleted', 'Event no. 31337 (deleted)', 'Þórunn Nemandi'],
      ['Stefán Stjórnandi', 'Event Manager role removed Events owned at the time: 2. Events co-managed: 1.', '', 'Þórunn Nemandi'],
      ['Þórunn Nemandi', 'Signed up for an event Done by the student', 'Mountain hike', 'Þórunn Nemandi'],
    ]);
    assert.equal(rows(html)[0][0], formatDateTime('en', at));
    assert.match(await page(`/admin/audit?student=${encodeURIComponent('nobody')}`, as.english), /No entries match the filter\./);
  });
});

describe('BR-56: auditEntries and auditEvents', () => {
  const summary = (options) => {
    const { entries, ...rest } = auditEntries(site.db, options);
    return { ...rest, shown: entries.length };
  };

  test('BR-56: the page is clamped into 1..pages, and from and to are the positions shown', () => {
    assert.equal(AUDIT_PAGE_SIZE, 100);
    assert.deepEqual(auditEntries(site.db, { page: 4 }), { entries: [], total: 0, page: 1, pages: 1, from: 0, to: 0 });
    assert.deepEqual(auditEntries(site.db), { entries: [], total: 0, page: 1, pages: 1, from: 0, to: 0 });

    for (let i = 0; i < 205; i += 1) log({ action: 'attendance.set' });
    const onPage = (page, from, to) => ({ total: 205, page, pages: 3, from, to, shown: to - from + 1 });
    assert.deepEqual(summary(), onPage(1, 1, 100));
    assert.deepEqual(summary({ page: 2 }), onPage(2, 101, 200));
    assert.deepEqual(summary({ page: 3 }), onPage(3, 201, 205));
    for (const page of [4, 99, Infinity]) assert.deepEqual(summary({ page }), onPage(3, 201, 205), String(page));
    for (const page of [0, -2, NaN, 'abc']) assert.deepEqual(summary({ page }), onPage(1, 1, 100), String(page));
    assert.deepEqual(summary({ page: 2.7 }), onPage(2, 101, 200));
    assert.deepEqual(summary({ student: 'enginn', page: 2 }), { total: 0, page: 1, pages: 1, from: 0, to: 0, shown: 0 });

    // Exactly one page full.
    site.db.prepare('DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log LIMIT 105)').run();
    assert.deepEqual(summary({ page: 2 }), { total: 100, page: 1, pages: 1, from: 1, to: 100, shown: 100 });
  });

  test('BR-56: an entry has its details, people and event, and null for what is gone', () => {
    const eventId = insertEvent(site.db, people.teacher.id, { title_is: 'Fjallganga', title_en: 'Mountain hike' });
    const first = log({
      at: '2027-03-11T10:00:00Z', actor: people.teacher.id, action: 'choice.clear', event: eventId, student: people.thorunn.id,
      details: JSON.stringify({ course: COURSE, reason: 'import' }),
    });
    const second = log({ at: '2027-03-11T09:00:00Z', action: 'attendance.set', event: 424242, student: 999999, details: 'not json' });
    const third = log({ at: '2027-03-11T08:00:00Z', actor: people.admin.id, action: 'event-manager.grant', student: people.jona.id, details: null });

    assert.deepEqual(auditEntries(site.db).entries, [
      {
        id: first, at: '2027-03-11T10:00:00Z', action: 'choice.clear', details: { course: COURSE, reason: 'import' },
        actor: 'Kennari Prófun', eventId, event: { title_is: 'Fjallganga', title_en: 'Mountain hike' }, studentId: people.thorunn.id, student: 'Þórunn Nemandi',
      },
      {
        id: second, at: '2027-03-11T09:00:00Z', action: 'attendance.set', details: {},
        actor: null, eventId: 424242, event: null, studentId: 999999, student: null,
      },
      {
        id: third, at: '2027-03-11T08:00:00Z', action: 'event-manager.grant', details: {},
        actor: 'Stefán Stjórnandi', eventId: null, event: null, studentId: people.jona.id, student: 'Jóna Nemandi',
      },
    ]);
    assert.deepEqual(auditEntries(site.db, { eventId: 424242 }).entries.map((entry) => entry.id), [second]);
    assert.deepEqual(auditEntries(site.db, { student: 'JÓNA' }).entries.map((entry) => entry.id), [third]);
    assert.deepEqual(auditEntries(site.db, { eventId, student: 'jóna' }).entries, []);
  });

  test('BR-56: the filter lists the events in the log, existing ones by Icelandic title, then deleted ones by number', () => {
    const ids = ['Örnefni', 'Bátsferð', 'Ævintýri', 'Ásaferð'].map((title) => insertEvent(site.db, people.teacher.id, { title_is: title }));
    insertEvent(site.db, people.teacher.id, { title_is: 'Án færslna' });
    for (const event of [...ids, 9002, 9001, ids[0]]) log({ action: 'attendance.set', event });
    log({ action: 'event-manager.grant', student: people.thorunn.id });

    const events = auditEvents(site.db);
    assert.deepEqual(events.map((event) => event.title_is ?? event.id), ['Ásaferð', 'Bátsferð', 'Ævintýri', 'Örnefni', 9001, 9002]);
    assert.deepEqual(events[0], { id: ids[3], title_is: 'Ásaferð', title_en: null });
    assert.deepEqual(events.at(-1), { id: 9002, title_is: null, title_en: null });
  });
});
