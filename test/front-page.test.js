import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SIGNUPS_PER_DAY, MAX_SIGNUPS_PER_STUDENT } from '../src/config.js';
import { toIso } from '../src/db/index.js';
import {
  browseEvents, eventFilters, filterEvents, sortOrder, validateEvent,
} from '../src/services/events.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const titles = (html) => [...html.matchAll(/<h(\d) class="event-card__title">([^<]+)<\/h\1>/g)].map((m) => m[2]);
const chips = (html) => [...html.matchAll(/<li class="chip"><span>([^<]+)<\/span>/g)].map((m) => m[1]);
const sections = (html) => {
  const mine = html.indexOf('id="mine-events"');
  const others = html.indexOf('id="other-events"');
  assert.ok(mine > 0 && others > mine, 'Þínir viðburðir comes before Aðrir viðburðir');
  return { mine: html.slice(mine, others), others: html.slice(others) };
};
const managedPart = (html) => /id="managed-events"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

describe('"Sía" and "Raða" (BR-63)', () => {
  // Plain objects, as publishedEvents returns them.
  const events = [
    { id: 1, title_is: 'Morgunganga', title_en: null, event_date: '2027-03-11', start_time: '09:00', fee_isk: 0 },
    { id: 2, title_is: 'Hádegismatur', title_en: null, event_date: '2027-03-11', start_time: '12:00', fee_isk: 1500 },
    { id: 3, title_is: 'Bíó', title_en: null, event_date: '2027-03-12', start_time: '14:00', fee_isk: 2500 },
    { id: 4, title_is: 'Ratleikur', title_en: null, event_date: '2027-03-12', start_time: '08:00', fee_isk: 500 },
    { id: 5, title_is: 'Kvöldvaka', title_en: null, event_date: '2027-03-13', start_time: '18:00', fee_isk: 0 },
  ];
  const filtered = (query) => filterEvents(events, eventFilters(query)).map((event) => event.id);
  const ordered = (sort) => browseEvents(events, { sort }).map((event) => event.id);

  test('BR-63: each filter narrows the list: fee, date, start time, and before or after noon', () => {
    assert.deepEqual(filtered({ free: '1' }), [1, 5]);
    assert.deepEqual(filtered({ fee_min: '1000' }), [2, 3]);
    assert.deepEqual(filtered({ fee_max: '1000' }), [1, 4, 5]);
    assert.deepEqual(filtered({ fee_min: '500', fee_max: '1500' }), [2, 4]);
    assert.deepEqual(filtered({ from: '2027-03-12' }), [3, 4, 5]);
    assert.deepEqual(filtered({ to: '2027-03-11' }), [1, 2]);
    assert.deepEqual(filtered({ from: '2027-03-12', to: '2027-03-12' }), [3, 4], 'one day');
    assert.deepEqual(filtered({ time_from: '12:00' }), [2, 3, 5]);
    assert.deepEqual(filtered({ time_to: '09:00' }), [1, 4]);
    assert.deepEqual(filtered({ noon: 'before' }), [1, 4]);
    assert.deepEqual(filtered({ noon: 'after' }), [2, 3, 5], 'an event starting at 12:00 is after noon');
    assert.deepEqual(filtered({}), [1, 2, 3, 4, 5]);
  });

  test('BR-63: filters combine', () => {
    assert.deepEqual(filtered({ noon: 'before', from: '2027-03-12' }), [4]);
    assert.deepEqual(filtered({ free: '1', noon: 'after' }), [5]);
    assert.deepEqual(filtered({ free: '1', fee_min: '500' }), [], 'nothing matches both');
  });

  test('BR-63: unknown or malformed filter values are ignored', () => {
    assert.deepEqual(eventFilters({
      free: 'yes', fee_min: '-1', fee_max: 'abc', from: '2027-13-45', to: 'x', time_from: '25:00', time_to: '9', noon: 'midnight', other: '1',
    }), {});
    assert.deepEqual(eventFilters({ from: ['2027-03-11', '2027-03-12'], noon: ['before'] }), {}, 'repeated parameters');
    assert.deepEqual(eventFilters({ from: '2027-02-30', to: '2027-04-31' }), {}, 'dates that do not exist');
    assert.deepEqual(eventFilters({ free: '1', fee_max: '0', time_to: '12:00' }), { free: '1', fee_max: '0', time_to: '12:00' });
    assert.equal(sortOrder('time-desc'), 'time-desc');
    assert.equal(sortOrder('noon'), 'date');
  });

  test('BR-63: the new orders use the real values, with ties in date and time order', () => {
    assert.deepEqual(ordered('time'), [4, 1, 2, 3, 5]);
    assert.deepEqual(ordered('time-desc'), [5, 3, 2, 1, 4]);
    assert.deepEqual(ordered('before-noon'), [1, 4, 2, 3, 5]);
    assert.deepEqual(ordered('after-noon'), [2, 3, 5, 1, 4]);
    const sameTime = [
      { id: 7, title_is: 'B', event_date: '2027-03-12', start_time: '09:00', fee_isk: 0 },
      { id: 6, title_is: 'A', event_date: '2027-03-11', start_time: '09:00', fee_isk: 0 },
      { id: 8, title_is: 'C', event_date: '2027-03-11', start_time: '09:00', fee_isk: 0 },
    ];
    for (const sort of ['time', 'time-desc', 'fee', 'fee-desc', 'before-noon', 'after-noon']) {
      assert.deepEqual(browseEvents(sameTime, { sort }).map((event) => event.id), [6, 8, 7], sort);
    }
  });
});

describe('the front page', () => {
  let site;
  let teacher;
  let otherTeacher;
  const students = {};
  const as = {};

  before(async () => {
    site = await startSite();
    teacher = await site.addUser({ name: 'Kennari Prófun', email: 'kennari@example.is' });
    otherTeacher = await site.addUser({ name: 'Annar Kennari', email: 'annar@example.is' });
    const admin = await site.addUser({ name: 'Stjórnandi Prófun', email: 'stjorn@example.is', isAdmin: true });
    for (const key of ['jona', 'sara', 'pall']) {
      students[key] = await site.addUser({ role: 'student', name: `Nemandi ${key}`, email: `${key}@example.is` });
    }
    site.db.prepare("UPDATE users SET is_event_manager = 1 WHERE role = 'teacher'").run();
    for (const [key, account] of [['teacher', teacher], ['otherTeacher', otherTeacher], ['admin', admin], ['jona', students.jona], ['sara', students.sara], ['pall', students.pall]]) {
      as[key] = site.browser();
      await as[key].login(account.kennitala, account.code);
    }
    as.guest = site.browser();
  });

  after(() => site.close());

  function setWindow(opensIn, closesIn) {
    const at = (ms) => (ms === null ? null : toIso(new Date(Date.now() + ms)));
    site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?').run(at(opensIn), at(closesIn));
  }

  beforeEach(() => {
    site.db.exec('DELETE FROM registrations; DELETE FROM events; DELETE FROM audit_log; DELETE FROM event_coteachers');
    setWindow(-HOUR, HOUR);
  });

  const event = (fields = {}) => insertEvent(site.db, teacher.id, fields);
  const signupsOf = (id) => site.db.prepare('SELECT student_id FROM registrations WHERE event_id = ?').pluck().all(id);

  describe('filters and orders on the page (BR-63)', () => {
    beforeEach(() => {
      event({ title_is: 'Morgunganga', start_time: '09:00', end_time: '10:00', fee_isk: 0 });
      event({ title_is: 'Bíó', start_time: '14:00', end_time: '16:00', fee_isk: 2500, brautir: ['Rafmagnsbraut'] });
      event({ title_is: 'Ratleikur', event_date: '2027-03-12', start_time: '08:00', end_time: '09:00', fee_isk: 500, brautir: ['Starfsbraut'] });
      site.db.prepare('INSERT OR IGNORE INTO student_courses (user_id, course_code) VALUES (?, ?)').run(students.jona.id, 'STÆR2BH05');
      site.db.prepare("UPDATE users SET braut = 'Rafmagnsbraut' WHERE id = ?").run(students.jona.id);
      site.db.prepare("UPDATE users SET braut = 'Starfsbraut' WHERE id = ?").run(students.sara.id);
    });

    test('BR-63: "Raða" sits beside "Sía", which offers every filter', async () => {
      const html = (await as.guest.get('/')).html;
      assert.match(html, /<summary class="button button--secondary">Sía<\/summary>[\s\S]*<summary class="button button--secondary">Raða<\/summary>/);
      for (const name of ['free', 'fee_min', 'fee_max', 'braut', 'from', 'to', 'time_from', 'time_to', 'noon', 'sort']) {
        assert.match(html, new RegExp(`name="${name}"`), name);
      }
    });

    test('BR-63: filters and orders work together on the page, and the form keeps every choice', async () => {
      const html = (await as.guest.get('/?noon=before&fee_max=1000&sort=name-desc')).html;
      assert.deepEqual(titles(html), ['Ratleikur', 'Morgunganga']);
      assert.match(html, /<input type="radio" name="noon" value="before" checked>/);
      assert.match(html, /name="fee_max" min="0" step="1" value="1000"/);
      assert.match(html, /<input type="radio" name="sort" value="name-desc" checked>/);
      assert.match(html, />Sía \(2\)<\/summary>/, 'the button shows that filters are on');
    });

    test('BR-63: each choice is shown, can be cleared on its own, and "Hreinsa allt" clears them all', async () => {
      const html = (await as.guest.get('/?q=g&free=1&from=2027-03-11&to=2027-03-11&time_from=08:00&noon=before&sort=fee')).html;
      assert.deepEqual(chips(html), [
        'Leit: „g“', 'Aðeins ókeypis', 'Frá 11. mars 2027', 'Til 11. mars 2027', 'Hefst í fyrsta lagi kl. 08:00', 'Fyrir hádegi', 'Röðun: Verð, lægst fyrst',
      ]);
      const free = /<span>Aðeins ókeypis<\/span> <a class="chip__clear" href="([^"]+)"/.exec(html)[1];
      assert.equal(free.replaceAll('&amp;', '&'), '/?q=g&sort=fee&from=2027-03-11&to=2027-03-11&time_from=08%3A00&noon=before');
      assert.match(html, /<li><a href="\/">Hreinsa allt<\/a><\/li>/);
    });

    test('BR-63: a date outside the Sæludagar days is ignored, and a price of 0 is shown as an amount', async () => {
      const html = (await as.guest.get('/?from=2020-01-01&to=2030-01-01&fee_max=0')).html;
      assert.deepEqual(chips(html), ['Verð til 0 kr.']);
      assert.deepEqual(titles(html), ['Morgunganga']);
      assert.doesNotMatch(html, /value="20[23]0-01-01"/, 'the date fields stay empty, so the form can still be sent');
      // Each end on its own: a "from" after the last day, and a "to" before the first.
      const swapped = (await as.guest.get('/?from=2030-01-01&to=2020-01-01')).html;
      assert.deepEqual(chips(swapped), []);
      assert.deepEqual(titles(swapped), ['Morgunganga', 'Bíó', 'Ratleikur']);
      assert.doesNotMatch(swapped, /value="20[23]0-01-01"/);
    });

    test('BR-63: a date is only grouped by day when sorted by date, and no match says so', async () => {
      assert.match((await as.guest.get('/')).html, /id="day-2027-03-12"/);
      const byTime = (await as.guest.get('/?sort=time')).html;
      assert.deepEqual(titles(byTime), ['Ratleikur', 'Morgunganga', 'Bíó']);
      assert.doesNotMatch(byTime, /id="day-/);
      const none = (await as.guest.get('/?fee_min=99999')).html;
      assert.deepEqual(titles(none), []);
      assert.match(none, /Enginn viðburður passar við leitina\./);
    });

    test('BR-25, BR-63: the braut filter still shows that braut\'s events and those for everyone, combined with the rest', async () => {
      assert.deepEqual(titles((await as.guest.get('/?braut=Rafmagnsbraut')).html), ['Morgunganga', 'Bíó']);
      assert.deepEqual(titles((await as.guest.get('/?braut=Rafmagnsbraut&noon=after')).html), ['Bíó']);
    });

    test('BR-64: the filters apply to "Aðrir viðburðir" only, and "Þínir viðburðir" has search and "Raða"', async () => {
      const own = event({ title_is: 'Eigin dýr viðburður', event_date: '2027-03-13', start_time: '15:00', end_time: '16:00', fee_isk: 900 });
      site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(own, students.jona.id, toIso());
      const page = sections((await as.jona.get('/?free=1')).html);
      assert.deepEqual(titles(page.mine), ['Eigin dýr viðburður'], 'own events are not filtered away');
      assert.deepEqual(titles(page.others), ['Morgunganga']);
      assert.match(page.mine, />Raða<\/summary>/);
      assert.doesNotMatch(page.mine, />Sía/);
      assert.match(page.mine, /<input type="hidden" name="free" value="1">/, 'its form keeps the other list\'s filter');
    });
  });

  describe('sign-up on the card (BR-66)', () => {
    test('BR-66: a student signs up from a card, comes back to the same list, and the event, its count and the counter all update', async () => {
      const id = event({ title_is: 'Gönguferð', capacity: 10 });
      const before = sections((await as.jona.get('/')).html);
      assert.match(before.others, new RegExp(`<form class="event-card__action" method="post" action="/events/${id}" data-card-signup>`));
      assert.match(before.others, /name="returnTo" value="\/"/);
      assert.match(before.others, /value="signup">Skrá<span class="visually-hidden">: Gönguferð<\/span>/);
      assert.match(before.mine, /<span class="home-counter">0\/4/);

      const res = await as.jona.post(`/events/${id}`, { action: 'signup', returnTo: '/?q=g%C3%B6ngu' });
      assert.deepEqual([res.status, res.location], [303, '/?q=g%C3%B6ngu']);

      const html = (await as.jona.get('/')).html;
      assert.match(html, /role="status">\s*<p>Skráning tókst\./);
      const after = sections(html);
      assert.deepEqual(titles(after.mine), ['Gönguferð']);
      assert.deepEqual(titles(after.others), []);
      assert.match(after.mine, /<span class="home-counter">1\/4/);
      assert.match(after.mine, /1 \/ 10 skráðir/);
      assert.match(after.mine, /value="cancel">Afskrá<span class="visually-hidden">: Gönguferð<\/span>/);
      assert.doesNotMatch(after.mine, /value="signup"/);

      await as.jona.post(`/events/${id}`, { action: 'cancel', returnTo: '/' });
      const cancelled = sections((await as.jona.get('/')).html);
      assert.deepEqual(titles(cancelled.others), ['Gönguferð']);
      assert.match(cancelled.mine, /<span class="home-counter">0\/4/);
      assert.match(cancelled.others, /0 \/ 10 skráðir/);
    });

    test('BR-66, §9: a card only returns to the front page; any other address goes to the event\'s page', async () => {
      const id = event();
      for (const returnTo of ['https://example.com/', '//example.com', '/admin', '/\\example.com']) {
        const res = await as.sara.post(`/events/${id}`, { action: 'signup', returnTo });
        assert.equal(res.location, `/events/${id}`, returnTo);
        site.db.exec('DELETE FROM registrations');
      }
    });

    test('BR-66: the state stays true after a reload, and nobody signs up twice', async () => {
      const id = event({ title_is: 'Tvískráning' });
      await as.pall.post(`/events/${id}`, { action: 'signup', returnTo: '/' });
      await as.pall.post(`/events/${id}`, { action: 'signup', returnTo: '/' });
      const html = (await as.pall.get('/')).html;
      assert.match(html, /Þú hefur þegar skráð þig á þennan viðburð\./);
      assert.deepEqual(signupsOf(id), [students.pall.id]);
      assert.match((await as.pall.get('/')).html, /value="cancel">Afskrá/, 'after a reload too');
    });

    test('BR-34, BR-66: a refusal on the front page says why', async () => {
      const id = event({ title_is: 'Lokaður', braut_restricted: 1, brautir: ['Starfsbraut'] });
      site.db.prepare('UPDATE users SET braut = NULL WHERE id = ?').run(students.pall.id);
      await as.pall.post(`/events/${id}`, { action: 'signup', returnTo: '/' });
      assert.match((await as.pall.get('/')).html, /role="alert"[^>]*>\s*<p>Þessi viðburður er aðeins fyrir nemendur þessara brauta: Starfsbraut\./);
      assert.deepEqual(signupsOf(id), []);
    });

    test('BR-66: the controls follow the rules: full, marked attendance, closed window, guests and teachers', async () => {
      const full = event({ title_is: 'Fullur', capacity: 1 });
      site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(full, students.sara.id, toIso());
      const open = event({ title_is: 'Opinn', event_date: '2027-03-12' });
      const marked = event({ title_is: 'Mættur', event_date: '2027-03-13' });
      site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at, attended) VALUES (?, ?, ?, 1)').run(marked, students.jona.id, toIso());

      const student = (await as.jona.get('/')).html;
      assert.doesNotMatch(student, new RegExp(`action="/events/${full}"`), 'no "Skrá" on a full event');
      assert.match(student, /<li class="badge badge--full">Uppselt<\/li>/);
      assert.match(student, new RegExp(`action="/events/${open}"`));
      assert.doesNotMatch(student, new RegExp(`action="/events/${marked}"`), 'no "Afskrá" once attendance is marked');
      assert.match(student, /<li class="badge badge--done">Mæting skráð<\/li>/);

      const guest = (await as.guest.get('/')).html;
      assert.match(guest, new RegExp(`<a class="button event-card__action" href="/login\\?next=/events/${open}">Skrá`));
      assert.doesNotMatch(guest, /data-card-signup/);
      assert.doesNotMatch(guest, new RegExp(`next=/events/${full}"`), 'no "Skrá" for a guest on a full event');

      assert.doesNotMatch((await as.teacher.get('/')).html, /data-card-signup|event-card__action[ "]/, 'teachers\' cards have neither');

      // A sign-up without marked attendance has "Afskrá" while the window is open, and not after.
      const unmarked = event({ title_is: 'Ómerktur', event_date: '2027-03-14' });
      site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(unmarked, students.jona.id, toIso());
      assert.match((await as.jona.get('/')).html, new RegExp(`action="/events/${unmarked}" data-card-signup>[\\s\\S]*?value="cancel">Afskrá`));

      setWindow(HOUR, 2 * HOUR);
      const closed = (await as.jona.get('/')).html;
      assert.doesNotMatch(closed, /data-card-signup/);
      assert.match(closed, /Skráning opnar /);
      assert.doesNotMatch((await as.guest.get('/')).html, /event-card__action[ "]/);
    });
  });

  describe('the limits (BR-64, BR-65)', () => {
    test('BR-65: a third sign-up on one day is refused with a clear reason; another day is fine', async () => {
      assert.equal(MAX_SIGNUPS_PER_DAY, 2);
      const [first, second, third] = ['08:00', '10:00', '12:00'].map((start, i) => event({ title_is: `Viðburður ${i}`, start_time: start, end_time: `${String(9 + 2 * i).padStart(2, '0')}:00` }));
      const nextDay = event({ title_is: 'Næsti dagur', event_date: '2027-03-12' });
      for (const id of [first, second]) await as.jona.post(`/events/${id}`, { action: 'signup', returnTo: '/' });
      await as.jona.get('/'); // reads the confirmation
      await as.jona.post(`/events/${third}`, { action: 'signup', returnTo: '/' });
      const html = (await as.jona.get('/')).html;
      assert.match(html, /role="alert"[^>]*>\s*<p>Þú hefur þegar skráð þig á 2 viðburði þennan dag, sem er hámarkið á einum degi\./);
      assert.match(html, /<span class="home-counter">2\/4/);
      assert.deepEqual(signupsOf(third), []);

      await as.jona.post(`/events/${nextDay}`, { action: 'signup', returnTo: '/' });
      assert.deepEqual(signupsOf(nextDay), [students.jona.id]);

      await as.jona.post(`/events/${first}`, { action: 'cancel', returnTo: '/' });
      await as.jona.post(`/events/${third}`, { action: 'signup', returnTo: '/' });
      assert.deepEqual(signupsOf(third), [students.jona.id], 'cancelling frees the day');
    });

    test('BR-65, BR-37: a teacher adding by hand cannot override the limit, though the event\'s own limits still can be', async () => {
      const ids = ['08:00', '10:00'].map((start, i) => event({ start_time: start, end_time: `${String(9 + 2 * i).padStart(2, '0')}:00` }));
      for (const id of ids) site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(id, students.sara.id, toIso());
      const third = event({ start_time: '12:00', end_time: '13:00' });
      await as.teacher.post(`/teacher/events/${third}`, { action: 'add-student', student: String(students.sara.id) });
      assert.match((await as.teacher.get(`/teacher/events/${third}`)).html, /Nemandinn er þegar skráður á 2 viðburði þennan dag, sem er hámarkið á einum degi\./);
      assert.deepEqual(signupsOf(third), []);
    });

    test('BR-65, BR-32: simultaneous sign-ups cannot get past the limits', async () => {
      const sameDay = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00'].map((start, i) => event({ start_time: start, end_time: `${String(9 + i).padStart(2, '0')}:00` }));
      const token = await as.pall.csrfToken('/');
      await Promise.all(sameDay.map((id) => as.pall.request('POST', `/events/${id}`, { _csrf: token, action: 'signup' })));
      assert.equal(site.db.prepare('SELECT COUNT(*) FROM registrations WHERE student_id = ?').pluck().get(students.pall.id), MAX_SIGNUPS_PER_DAY);

      site.db.exec('DELETE FROM registrations');
      const days = ['2027-03-11', '2027-03-12', '2027-03-13', '2027-03-14', '2027-03-15', '2027-03-16'].map((day) => event({ event_date: day }));
      await Promise.all(days.map((id) => as.pall.request('POST', `/events/${id}`, { _csrf: token, action: 'signup' })));
      assert.equal(site.db.prepare('SELECT COUNT(*) FROM registrations WHERE student_id = ?').pluck().get(students.pall.id), MAX_SIGNUPS_PER_STUDENT);
    });
  });

  describe('one front page (§6)', () => {
    test('BR-02, BR-64: the old pages redirect there, and the header no longer links to them', async () => {
      event();
      const student = await as.jona.get('/my-events');
      assert.deepEqual([student.status, student.location], [303, '/#mine-events']);
      const teacherHome = await as.teacher.get('/teacher');
      assert.deepEqual([teacherHome.status, teacherHome.location], [303, '/#managed-events']);
      assert.equal((await as.jona.post('/my-events', { action: 'cancel', event: '1' })).status, 404);
      for (const browser of [as.jona, as.teacher, as.admin]) {
        const html = (await browser.get('/')).html;
        assert.doesNotMatch(html, /href="\/my-events"|href="\/teacher"/);
      }
      assert.match((await as.admin.get('/')).html, /href="\/admin">Stjórnendasvæði</, 'Stjórnendasvæði stays');
      assert.equal((await as.admin.get('/admin')).status, 200);
      assert.equal((await as.jona.get('/admin')).status, 403);
    });

    test('§6: "Viðburðir sem þú sérð um" lists own and co-taught events, drafts included, and only for them', async () => {
      const draft = event({ title_is: 'Óbirt drög', status: 'draft' });
      const published = event({ title_is: 'Birtur viðburður' });
      const others = insertEvent(site.db, otherTeacher.id, { title_is: 'Viðburður annars', status: 'draft' });
      const shared = insertEvent(site.db, otherTeacher.id, { title_is: 'Sameiginlegur', status: 'draft' });
      site.db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(shared, teacher.id);

      const part = managedPart((await as.teacher.get('/')).html);
      assert.match(part, /<h2 id="managed-heading">Viðburðir sem þú sérð um<\/h2>/);
      assert.match(part, new RegExp(`<a href="/teacher/events/${draft}">Óbirt drög</a>`));
      assert.match(part, new RegExp(`<a href="/teacher/events/${published}">Birtur viðburður</a>`));
      assert.match(part, new RegExp(`<a href="/teacher/events/${shared}">Sameiginlegur</a>`));
      assert.doesNotMatch(part, /Viðburður annars/);
      assert.match(part, /<td>Drög<\/td>/);
      assert.match(part, new RegExp(`href="/teacher/events/${draft}/preview"`));
      assert.match(part, new RegExp(`action="/teacher/events/${draft}">[\\s\\S]*?value="publish"`));
      assert.doesNotMatch(part, new RegExp(`action="/teacher/events/${published}"`), 'a published event has no "Birta"');

      for (const browser of [as.jona, as.guest]) {
        const html = (await browser.get('/')).html;
        assert.equal(managedPart(html), '');
        assert.doesNotMatch(html, /Óbirt drög|Sameiginlegur/);
      }
      void others;
    });

    test('BR-67: a student with the event manager role has both their own events and those they manage', async () => {
      const own = insertEvent(site.db, students.sara.id, { title_is: 'Stýrt af nemanda', status: 'draft' });
      site.db.prepare('UPDATE users SET is_event_manager = 1 WHERE id = ?').run(students.sara.id);
      try {
        const html = (await as.sara.get('/')).html;
        assert.match(html, /id="mine-events"/);
        assert.match(managedPart(html), new RegExp(`<a href="/teacher/events/${own}">`));
        assert.match(html, /data-open-event-dialog/);
      } finally {
        site.db.prepare('UPDATE users SET is_event_manager = 0 WHERE id = ?').run(students.sara.id);
      }
    });
  });

  describe('the "Nýr viðburður" dialog (§6, BR-22)', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const fields = (extra = {}) => ({
      title_is: 'Úr glugganum', description_is: 'Lýsing.', host: 'Gestgjafi', event_date: '2027-03-11', start_time: '10:00', end_time: '11:00', location: 'Stofa 1', capacity: '10', fee_isk: '0', ...extra,
    });

    // Saves the way public/js/event-dialog.js does: multipart, asking for JSON.
    async function saveFromDialog(browser, values, file) {
      const form = new FormData();
      form.append('_csrf', await browser.csrfToken('/'));
      for (const [name, value] of Object.entries(values)) form.append(name, value);
      for (const one of [].concat(file ?? [])) form.append('images', new Blob([one.bytes], { type: one.type }), one.name);
      const res = await browser.request('POST', '/teacher/events/new', form, { Accept: 'application/json' });
      return { status: res.status, location: res.location, html: res.html, body: res.html.startsWith('{') ? JSON.parse(res.html) : null };
    }
    const row = (id) => site.db.prepare('SELECT * FROM events WHERE id = ?').get(id);

    test('§6: the button and dialog show only for those who can manage events, and the button is a link without JavaScript', async () => {
      event();
      for (const browser of [as.teacher, as.admin]) {
        const html = (await browser.get('/')).html;
        assert.match(html, /<a class="button fab" href="\/teacher\/events\/new" data-open-event-dialog>[\s\S]*?Nýr viðburður<\/a>/);
        assert.match(html, /<dialog class="modal" id="new-event-dialog"/);
        assert.match(html, /<script src="\/js\/event-dialog.js" defer><\/script>/);
      }
      for (const browser of [as.jona, as.guest]) {
        const html = (await browser.get('/')).html;
        assert.doesNotMatch(html, /data-open-event-dialog|new-event-dialog|event-dialog\.js/);
      }
    });

    test('§6: the dialog has the fields and the image area, with required fields marked', async () => {
      event();
      const html = (await as.teacher.get('/')).html;
      const dialog = /<dialog[\s\S]*<\/dialog>/.exec(html)[0];
      assert.match(dialog, /<div class="modal__columns">\s*<div class="modal__fields">[\s\S]*<section class="modal__image"/);
      for (const name of ['title_is', 'title_en', 'description_is', 'description_en', 'host', 'event_date', 'start_time', 'end_time', 'location', 'capacity', 'fee_isk', 'braut_restricted']) {
        assert.match(dialog, new RegExp(`name="${name}"`), name);
      }
      assert.match(dialog, /Reitir merktir \* eru nauðsynlegir\./);
      assert.match(dialog, /Heiti <span class="field__required" aria-hidden="true">\*<\/span>/);
      assert.match(dialog, /<h3 id="new-event-image-heading">Myndir fyrir viðburð<\/h3>/);
      assert.match(dialog, /<span>Hengja við skrá<\/span>/);
      assert.match(dialog, /data-image-picker data-max="5" data-max-bytes="2097152"/);
      assert.match(dialog, /name="images" type="file" multiple accept="image\/jpeg,image\/png,image\/webp"/);
      assert.match(dialog, /data-image-previews hidden/);
      assert.match(html, /<script src="\/js\/image-preview\.js" defer><\/script>\s*<script src="\/js\/event-dialog\.js" defer><\/script>/);

      const english = site.browser();
      await english.login(otherTeacher.kennitala, otherTeacher.code);
      await english.post('/language', { lang: 'en', returnTo: '/' });
      assert.match((await english.get('/')).html, /<span>Attach file<\/span>/);
    });

    test('BR-22: an event saved from the dialog is a draft, kept with its creator and confirmed on the front page', async () => {
      event();
      const res = await saveFromDialog(as.teacher, fields(), [{ bytes: png, type: 'image/png', name: 'mynd.png' }, { bytes: png, type: 'image/png', name: 'onnur.png' }]);
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      const saved = row(res.body.id);
      assert.deepEqual([saved.status, saved.owner_id, saved.title_is], ['draft', teacher.id, 'Úr glugganum']);
      const images = site.db.prepare('SELECT file FROM event_images WHERE event_id = ? ORDER BY position').pluck().all(res.body.id);
      assert.equal(images.length, 2, 'the dialog takes several images (BR-27)');
      for (const image of images) assert.match(image, /^[0-9a-f-]{36}\.png$/);

      const home = (await as.teacher.get('/')).html;
      assert.match(home, /Viðburðurinn var vistaður sem drög\. Nemendur sjá hann ekki fyrr en þú birtir hann\./);
      assert.match(managedPart(home), new RegExp(`<a href="/teacher/events/${res.body.id}">Úr glugganum</a>`));
    });

    test('BR-20, §9: a field sent with a nested name is an error in that field, not a crash', async () => {
      event();
      const {
        capacity, fee_isk, event_date, start_time, end_time, ...rest
      } = fields();
      const res = await saveFromDialog(as.teacher, {
        ...rest, 'capacity[a]': capacity, 'fee_isk[a]': fee_isk, 'event_date[a]': event_date, 'start_time[a]': start_time, 'end_time[a]': end_time,
      });
      assert.equal(res.status, 400);
      assert.deepEqual(Object.keys(res.body.errors), ['capacity', 'fee_isk', 'event_date', 'start_time', 'end_time'], 'a fee that is not text does not pass as free');
      // The optional fields too: they must not pass as left empty.
      const optional = await saveFromDialog(as.teacher, { ...fields(), 'title_en[a]': 'x', 'braut_restricted[a]': '1' });
      assert.equal(optional.status, 400);
      assert.deepEqual(Object.keys(optional.body.errors), ['title_en', 'brautir']);
      assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), 1, 'nothing was saved');
    });

    test('BR-24, §9: a braut field with a huge index is refused at once, and cannot hold up the site', async () => {
      event();
      const started = performance.now();
      const res = await saveFromDialog(as.teacher, { ...fields(), 'brautir[4294967294]': 'Rafmagnsbraut' });
      assert.equal(res.status, 400);
      assert.ok(performance.now() - started < 3000, 'the upload is refused before the list is read');
      // The check itself reads only the entries that are there, not the holes between them.
      const holes = [];
      holes[4294967294] = 'Rafmagnsbraut';
      const checked = performance.now();
      assert.equal(validateEvent({ ...fields(), brautir: holes }, { days: ['2027-03-11'], brautir: [] }).errors.brautir, 'events.errors.braut');
      assert.ok(performance.now() - checked < 3000, 'no walk through four thousand million holes');
      assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), 1, 'nothing was saved');
    });

    test('BR-22, BR-23: students cannot see or sign up for a draft until it is published', async () => {
      event();
      const { body: { id } } = await saveFromDialog(as.teacher, fields({ title_is: 'Leynileg drög' }));
      for (const browser of [as.jona, as.guest]) {
        assert.doesNotMatch((await browser.get('/')).html, /Leynileg drög/);
        assert.doesNotMatch((await browser.get('/?q=leynileg')).html, /Leynileg drög/);
        assert.equal((await browser.get(`/events/${id}`)).status, 404);
      }
      assert.equal((await as.jona.post(`/events/${id}`, { action: 'signup' })).status, 404);
      assert.deepEqual(signupsOf(id), []);

      assert.equal((await as.otherTeacher.post(`/teacher/events/${id}`, { action: 'publish' })).status, 403, 'only those allowed can publish');
      assert.equal(row(id).status, 'draft');
      await as.teacher.post(`/teacher/events/${id}`, { action: 'publish' });
      assert.equal(row(id).status, 'published');
      assert.match((await as.jona.get('/')).html, /Leynileg drög/);
    });

    test('§6: errors come back by field, in the page\'s language, and nothing is saved', async () => {
      event();
      const before = site.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
      const missing = await saveFromDialog(as.teacher, fields({ title_is: '', event_date: '2020-01-01' }));
      assert.equal(missing.status, 400);
      assert.equal(missing.body.ok, false);
      assert.deepEqual(Object.keys(missing.body.errors).sort(), ['event_date', 'title_is']);
      assert.doesNotMatch(missing.body.errors.title_is, /^events\./, 'a message, not a key');

      const wrongFile = await saveFromDialog(as.teacher, fields(), { bytes: Buffer.from('ekki mynd'), type: 'image/png', name: 'mynd.png' });
      assert.equal(wrongFile.status, 400);
      assert.equal(wrongFile.body.errors.images, 'Myndin verður að vera JPG, PNG eða WebP.');
      const tooLarge = await saveFromDialog(as.teacher, fields(), { bytes: Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]), type: 'image/png', name: 'stor.png' });
      assert.equal(tooLarge.status, 400);
      assert.equal(tooLarge.body.errors.images, 'Myndin er of stór. Hámarkið er 2 MB.');
      const six = Array.from({ length: 6 }, (_, n) => ({ bytes: png, type: 'image/png', name: `mynd-${n}.png` }));
      assert.equal((await saveFromDialog(as.teacher, fields(), six)).body.errors.images, 'Viðburður má mest hafa 5 myndir. Fjarlægðu mynd til að bæta annarri við.');
      assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), before);
    });

    test('§8, §9: the server refuses those without the right, and a missing token', async () => {
      event();
      const before = site.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
      assert.equal((await saveFromDialog(as.jona, fields())).status, 403);
      const guest = await saveFromDialog(as.guest, fields());
      assert.deepEqual([guest.status, guest.location], [303, '/login']);
      const form = new FormData();
      for (const [name, value] of Object.entries(fields())) form.append(name, value);
      const noToken = await as.teacher.request('POST', '/teacher/events/new', form, { Accept: 'application/json' });
      assert.equal(noToken.status, 403);
      assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), before);
    });

    test('§6: without JavaScript the form page still saves a draft and goes to the event', async () => {
      event();
      const res = await as.teacher.postForm('/teacher/events/new', fields({ title_is: 'Án JavaScript' }));
      assert.equal(res.status, 303);
      assert.match(res.location, /^\/teacher\/events\/\d+$/);
      assert.equal(site.db.prepare("SELECT status FROM events WHERE title_is = 'Án JavaScript'").pluck().get(), 'draft');
      assert.equal((await as.teacher.postForm('/teacher/events/new', fields({ title_is: '' }))).status, 400, 'errors re-render the page');
    });

    test('BR-22: the preview shows the card and the event page as a student sees them', async () => {
      const id = event({ title_is: 'Forskoðuð drög', status: 'draft', fee_isk: 500 });
      const html = (await as.teacher.get(`/teacher/events/${id}/preview`)).html;
      const card = /<div class="preview-card">[\s\S]*?<\/article>/.exec(html)[0];
      assert.match(card, /<h2 class="event-card__title">Forskoðuð drög<\/h2>/);
      assert.match(card, /500 kr\./);
      assert.match(card, /<button type="button" class="button event-card__action" disabled>Skrá<\/button>/);
      assert.match(card, /href="#event-details"/);
      assert.doesNotMatch(card, /<form|data-card-signup/, 'nothing in it can be used');
      assert.match(html, /id="event-details"[\s\S]*<h1>Forskoðuð drög<\/h1>/);
      // The event's title is the main heading, as on its page; the boxes and the card come under it.
      const headings = html.match(/<h[1-6]/g);
      assert.equal(headings[0], '<h1');
      assert.ok(headings.length > 3 && headings.slice(1).every((heading) => heading === '<h2'), 'the headings are in order');
    });

    test('§6: editing a published event keeps it published, and saving a draft does not publish it', async () => {
      const published = event({ title_is: 'Birtur fyrir' });
      assert.equal((await as.teacher.postForm(`/teacher/events/${published}/edit`, fields({ title_is: 'Birtur eftir' }))).status, 303);
      assert.deepEqual([row(published).status, row(published).title_is], ['published', 'Birtur eftir']);
      const draft = event({ title_is: 'Drög fyrir', status: 'draft' });
      await as.teacher.postForm(`/teacher/events/${draft}/edit`, fields({ title_is: 'Drög eftir' }));
      assert.deepEqual([row(draft).status, row(draft).title_is], ['draft', 'Drög eftir']);
    });
  });
});
