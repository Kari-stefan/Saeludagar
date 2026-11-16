// Milestone M6c: the "Fjarvistastig" page (BR-40 to BR-44, BR-69), a re-import that drops a
// course (BR-17), and the two decisions on open question 21 (BR-38, BR-67).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { givePoints, studentPoints } from '../src/services/choices.js';
import { applyImport, previewImport } from '../src/services/import.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const COURSES = ['ENSK2LS05', 'ÍSLE2MB05', 'STÆR2BH05'];
let site;
const people = {};
const as = {};

before(async () => {
  site = await startSite();
  const add = async (key, fields) => {
    people[key] = await site.addUser(fields);
    as[key] = site.browser();
    await as[key].login(people[key].kennitala, people[key].code);
  };
  await add('teacher', { name: 'Kennari Prófun', email: 'kennari@example.is' });
  await add('admin', { name: 'Stefán Stjórnandi', email: 'stefan@example.is', isAdmin: true });
  await add('jona', { role: 'student', name: 'Jóna Nemandi', email: 'jona@example.is' });
  await add('sara', { role: 'student', name: 'Sara Nemandi', email: 'sara@example.is' });
  await add('runar', { role: 'student', name: 'Rúnar Nemandastjóri', email: 'runar@example.is' });
  site.db.prepare('UPDATE users SET is_event_manager = 1 WHERE id = ?').run(people.runar.id);
  as.guest = site.browser();
});

after(() => site.close());

beforeEach(() => {
  site.db.exec('DELETE FROM registrations; DELETE FROM events; DELETE FROM audit_log; DELETE FROM student_courses');
  site.db.prepare('UPDATE settings SET choice_deadline_at = NULL').run();
  for (const course of COURSES) site.db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)').run(people.jona.id, course);
});

// Events on different days, the earliest first, so "the earliest attendance" is the first made.
let day = 0;
const event = (fields = {}) => {
  day += 1;
  return insertEvent(site.db, people.teacher.id, { event_date: `2027-03-${String(10 + (day % 18)).padStart(2, '0')}`, ...fields });
};
const signUp = (eventId, key, attended = 1) => site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at, attended) VALUES (?, ?, ?, ?)')
  .run(eventId, people[key].id, toIso(), attended);
const attend = (key, count) => Array.from({ length: count }, () => {
  const id = event();
  signUp(id, key);
  return id;
});
const choices = (key = 'jona') => site.db.prepare('SELECT event_id, course_code FROM registrations WHERE student_id = ? AND course_code IS NOT NULL ORDER BY event_id')
  .all(people[key].id).map((row) => [row.event_id, row.course_code]);
const step = (browser, action, course) => browser.post('/points', { action, course });

// What the page shows: the counter, each course's points, and which buttons can be pressed.
function read(html) {
  const counter = /<span class="points__number" aria-hidden="true">(\d+)\/(\d+)<\/span>/.exec(html);
  const courses = [...html.matchAll(/<span class="points__course">([^<]+)<\/span>[\s\S]*?value="take"( disabled)?>[\s\S]*?<output class="stepper__value"><span aria-hidden="true">(\d+)<\/span>[\s\S]*?value="give"( disabled)?>/g)]
    .map((m) => ({ code: m[1], points: Number(m[3]), take: !m[2], give: !m[4] }));
  return { left: Number(counter[1]), earned: Number(counter[2]), courses };
}
const show = async (browser = as.jona) => read((await browser.get('/points')).html);
const failed = (text) => new RegExp(`role="alert">\\s*<p>${text}`);

describe('the "Fjarvistastig" page (BR-69, §6)', () => {
  test('BR-69, §6: the header links to it for students only, and only a student can open it', async () => {
    assert.match((await as.jona.get('/')).html, /<a class="nav-links__link" href="\/points">Fjarvistastig<\/a>/);
    for (const key of ['guest', 'teacher', 'admin']) assert.doesNotMatch((await as[key].get('/')).html, /href="\/points"/, key);
    assert.equal((await as.guest.get('/points')).location, '/login');
    assert.equal((await as.teacher.get('/points')).status, 403);
    const html = (await as.jona.get('/points')).html;
    assert.match(html, /<h1>Fjarvistastig<\/h1>/);
    assert.match(html, /<a class="nav-links__link" href="\/points" aria-current="page">Fjarvistastig<\/a>/);
    // Laid out like the login page: the counter first, then the centred box.
    assert.match(html, /<div class="auth points"[^>]*>\s*<p class="points__counter" role="status" data-points-counter>[\s\S]*<div class="auth__box auth__box--wide">/);
  });

  test('BR-40, BR-69: each marked attendance earns 4 points, and the counter shows points left and points earned', async () => {
    const none = (await as.jona.get('/points')).html;
    assert.deepEqual([read(none).left, read(none).earned], [0, 0]);
    assert.match(none, /Þú hefur ekki unnið þér inn fjarvistastig enn\./);
    assert.ok(read(none).courses.every((course) => !course.give && !course.take), 'nothing to give or take yet');

    signUp(event(), 'jona', 0);
    assert.equal((await show()).earned, 0, 'a sign-up without marked attendance earns nothing');
    attend('jona', 3);
    const page = await show();
    assert.deepEqual([page.left, page.earned], [12, 12]);
    assert.deepEqual(page.courses, COURSES.map((code) => ({ code, points: 0, take: false, give: true })), 'one row for each of the student\'s courses');
    assert.match((await as.jona.get('/points')).html, /<span class="visually-hidden">12 stig eftir af 12 sem þú hefur unnið þér inn<\/span>/);
    // Another student's attendance is not Jóna's.
    attend('sara', 1);
    assert.equal((await show()).earned, 12);
  });

  test('BR-41, BR-69: "+" gives the 4 points of the earliest attendance to a course, and "−" takes them back', async () => {
    const [first, second] = attend('jona', 2);
    const given = await step(as.jona, 'give', 'STÆR2BH05');
    assert.equal(given.location, '/points');
    const html = (await as.jona.get('/points')).html;
    assert.match(html, /role="status">\s*<p>4 stig sett á STÆR2BH05\./);
    assert.deepEqual([read(html).left, read(html).earned], [4, 8]);
    assert.deepEqual(read(html).courses.find((course) => course.code === 'STÆR2BH05'), { code: 'STÆR2BH05', points: 4, take: true, give: false });
    assert.deepEqual(choices(), [[first, 'STÆR2BH05']]);

    await step(as.jona, 'give', 'ENSK2LS05');
    assert.deepEqual(choices(), [[first, 'STÆR2BH05'], [second, 'ENSK2LS05']]);
    const all = await show();
    assert.deepEqual([all.left, all.earned], [0, 8]);
    assert.ok(all.courses.every((course) => !course.give), 'no "+" when no points are left');

    await step(as.jona, 'take', 'STÆR2BH05');
    assert.match((await as.jona.get('/points')).html, /role="status">\s*<p>4 stig tekin af STÆR2BH05\./);
    assert.deepEqual(choices(), [[second, 'ENSK2LS05']]);
    assert.equal((await show()).left, 4, 'the points are back, to give to another course');
    assert.deepEqual(site.db.prepare('SELECT action, actor_id, event_id, student_id, details FROM audit_log ORDER BY id').all().map((row) => [row.action, row.event_id, JSON.parse(row.details).course]), [
      ['choice.set', first, 'STÆR2BH05'], ['choice.set', second, 'ENSK2LS05'], ['choice.clear', first, 'STÆR2BH05'],
    ], 'BR-56: each step is logged');
  });

  test('BR-42, BR-69: a course holds at most 4 points, whatever the browser sends', async () => {
    attend('jona', 3);
    await step(as.jona, 'give', 'STÆR2BH05');
    await step(as.jona, 'give', 'STÆR2BH05');
    assert.match((await as.jona.get('/points')).html, failed('STÆR2BH05 hefur þegar fengið 4 stig, sem er hámarkið í einum áfanga\\.'));
    assert.equal(choices().length, 1);
    assert.equal((await show()).left, 8);
  });

  test('BR-69: nobody can give away more points than they have earned', async () => {
    attend('jona', 1);
    await step(as.jona, 'give', 'STÆR2BH05');
    await step(as.jona, 'give', 'ENSK2LS05');
    assert.match((await as.jona.get('/points')).html, failed('Þú átt engin stig eftir til að ráðstafa\\.'));
    assert.deepEqual(choices().map(([, course]) => course), ['STÆR2BH05']);
    // Taking from a course with nothing on it changes nothing either.
    await step(as.jona, 'take', 'ÍSLE2MB05');
    assert.match((await as.jona.get('/points')).html, failed('Engin stig eru á þessum áfanga\\.'));
    assert.equal((await show()).left, 0);
  });

  test('BR-69: steps sent at the same time cannot give away the same points twice', async () => {
    attend('jona', 2);
    const token = await as.jona.csrfToken('/points');
    const results = await Promise.all([...COURSES, ...COURSES].map((course) => as.jona.request('POST', '/points', { _csrf: token, action: 'give', course })));
    assert.ok(results.every((res) => res.status === 303));
    assert.equal(choices().length, 2, 'two attendances, so two courses and no more');
    assert.equal(new Set(choices().map(([, course]) => course)).size, 2);
    const page = await show();
    assert.deepEqual([page.left, page.earned], [0, 8]);
  });

  test('BR-41: points go only to the student\'s own courses, and an odd request is refused', async () => {
    attend('jona', 1);
    await step(as.jona, 'give', 'EFNA2AA05');
    assert.match((await as.jona.get('/points')).html, failed('Þessi áfangi er ekki á listanum þínum\\.'));
    assert.equal((await step(as.jona, 'double', 'STÆR2BH05')).status, 400);
    assert.equal((await as.jona.post('/points', { action: 'give' })).status, 400);
    assert.equal((await as.jona.request('POST', '/points', { action: 'give', course: 'STÆR2BH05' })).status, 403, 'without the token');
    assert.equal((await step(as.teacher, 'give', 'STÆR2BH05')).status, 403);
    assert.deepEqual(choices(), []);
    // The other student has no courses at all.
    assert.match((await as.sara.get('/points')).html, /Engir áfangar eru skráðir á þig\./);
  });

  test('BR-44: after the course-choice deadline the page is read-only', async () => {
    attend('jona', 2);
    await step(as.jona, 'give', 'STÆR2BH05');
    site.db.prepare('UPDATE settings SET choice_deadline_at = ?').run(toIso(new Date(Date.now() + HOUR)));
    const open = (await as.jona.get('/points')).html;
    assert.match(open, /Þú getur breytt þessu til /);
    assert.ok(read(open).courses.some((course) => course.give));

    site.db.prepare('UPDATE settings SET choice_deadline_at = ?').run(toIso(new Date(Date.now() - HOUR)));
    const closed = (await as.jona.get('/points')).html;
    assert.match(closed, /Fresturinn rann út /);
    assert.ok(read(closed).courses.every((course) => !course.give && !course.take), 'every button is off');
    assert.deepEqual([read(closed).left, read(closed).earned], [4, 8], 'what was given still shows');
    for (const [action, course] of [['give', 'ENSK2LS05'], ['take', 'STÆR2BH05']]) {
      await step(as.jona, action, course);
      assert.match((await as.jona.get('/points')).html, failed('Fresturinn til að ráðstafa fjarvistastigum er liðinn\\.'), action);
    }
    assert.deepEqual(choices().map(([, course]) => course), ['STÆR2BH05']);
  });

  test('BR-41: unmarking attendance removes the choice, and its points with it', async () => {
    const today = toIso().slice(0, 10);
    const id = event({ event_date: today, start_time: '00:00', end_time: '23:59' });
    signUp(id, 'jona');
    await step(as.jona, 'give', 'STÆR2BH05');
    assert.deepEqual(choices(), [[id, 'STÆR2BH05']]);
    const token = await as.teacher.csrfToken(`/teacher/events/${id}/attendance`);
    const res = await as.teacher.request('POST', `/teacher/events/${id}/attendance`, { _csrf: token, student: String(people.jona.id), attended: '0' }, { Accept: 'application/json' });
    assert.equal(res.status, 200);
    assert.deepEqual(choices(), []);
    const page = await show();
    assert.deepEqual([page.left, page.earned], [0, 0]);
  });

  test('BR-69: the service refuses on its own, without the route: the checks are inside its transaction', () => {
    attend('jona', 1);
    assert.deepEqual(givePoints(site.db, people.jona.id, 'STÆR2BH05'), { ok: true });
    assert.equal(givePoints(site.db, people.jona.id, 'STÆR2BH05').error, 'points.errors.courseFull');
    assert.equal(givePoints(site.db, people.jona.id, 'ENSK2LS05').error, 'points.errors.noneLeft');
    assert.equal(givePoints(site.db, people.sara.id, 'STÆR2BH05').error, 'points.errors.notYourCourse');
    assert.equal(givePoints(site.db, people.jona.id, 'ENSK2LS05', new Date(Date.now() + HOUR)).error, 'points.errors.noneLeft');
    const points = studentPoints(site.db, people.jona.id);
    assert.deepEqual([points.left, points.earned, points.step, points.max], [0, 4, 4, 4]);
  });
});

describe('a re-import that drops a course (BR-17)', () => {
  test('BR-17: the points on a course that leaves the student\'s list go back to the student, and it is logged', async () => {
    const [first, second] = attend('jona', 2);
    await step(as.jona, 'give', 'STÆR2BH05');
    await step(as.jona, 'give', 'ENSK2LS05');
    // The new list keeps ENSK2LS05 and drops STÆR2BH05. The other students are in the file too,
    // because a student missing from it is made inactive (BR-17).
    const file = [
      { kennitala: people.jona.kennitala, name: 'Jóna Nemandi', email: 'jona@example.is', braut: 'Rafmagnsbraut', courses: ['ENSK2LS05', 'EFNA2AA05'] },
      { kennitala: people.sara.kennitala, name: 'Sara Nemandi', email: 'sara@example.is', braut: null, courses: [] },
      { kennitala: people.runar.kennitala, name: 'Rúnar Nemandastjóri', email: 'runar@example.is', braut: null, courses: [] },
    ];
    assert.equal(previewImport(site.db, site.kt, file).choicesCleared, 1, 'the summary before the confirm counts it');
    assert.deepEqual(choices(), [[first, 'STÆR2BH05'], [second, 'ENSK2LS05']], 'the preview changes nothing');

    site.db.exec('DELETE FROM audit_log');
    assert.equal(applyImport(site.db, site.kt, file, people.admin.id).choicesCleared, 1);
    assert.deepEqual(choices(), [[second, 'ENSK2LS05']]);
    const logged = site.db.prepare("SELECT actor_id, event_id, student_id, details FROM audit_log WHERE action = 'choice.clear'").all();
    assert.deepEqual(logged.map((row) => [row.actor_id, row.event_id, row.student_id, JSON.parse(row.details)]), [
      [people.admin.id, first, people.jona.id, { course: 'STÆR2BH05', reason: 'import' }],
    ]);
    const page = await show();
    assert.deepEqual([page.left, page.earned], [4, 8], 'the 4 points are back');
    assert.deepEqual(page.courses.map((course) => [course.code, course.points]), [['EFNA2AA05', 0], ['ENSK2LS05', 4]], 'only the courses on the new list');
    await step(as.jona, 'give', 'EFNA2AA05');
    assert.equal((await show()).left, 0, 'and can go to a course on the new list');
  });
});

describe('a re-import after the deadline (BR-17, BR-44)', () => {
  test('BR-17, BR-44: after the course-choice deadline the choice is kept, and the course still shows, marked as no longer on the list', async () => {
    const [first] = attend('jona', 1);
    await step(as.jona, 'give', 'STÆR2BH05');
    site.db.prepare('UPDATE settings SET choice_deadline_at = ?').run(toIso(new Date(Date.now() - HOUR)));
    const file = [
      { kennitala: people.jona.kennitala, name: 'Jóna Nemandi', email: 'jona@example.is', braut: 'Rafmagnsbraut', courses: ['ENSK2LS05'] },
      { kennitala: people.sara.kennitala, name: 'Sara Nemandi', email: 'sara@example.is', braut: null, courses: [] },
      { kennitala: people.runar.kennitala, name: 'Rúnar Nemandastjóri', email: 'runar@example.is', braut: null, courses: [] },
    ];
    assert.equal(previewImport(site.db, site.kt, file).choicesCleared, 0);
    assert.equal(applyImport(site.db, site.kt, file, people.admin.id).choicesCleared, 0);
    assert.deepEqual(choices(), [[first, 'STÆR2BH05']], 'the points could not be given again, so they stay where they were');
    assert.equal(site.db.prepare("SELECT COUNT(*) FROM audit_log WHERE action = 'choice.clear'").pluck().get(), 0);

    const html = (await as.jona.get('/points')).html;
    assert.deepEqual([read(html).left, read(html).earned], [0, 4]);
    assert.deepEqual(read(html).courses, [
      { code: 'ENSK2LS05', points: 0, take: false, give: false }, { code: 'STÆR2BH05', points: 4, take: false, give: false },
    ], 'the courses add up to the counter, and nothing can be pressed');
    assert.match(html, /<span class="points__course">STÆR2BH05<\/span>\s*<span class="points__note">Ekki lengur á listanum þínum<\/span>/);
    assert.doesNotMatch(html, /<span class="points__course">ENSK2LS05<\/span>\s*<span class="points__note">/);
    // If the deadline is moved back, the points can be taken off the dropped course but not put on it.
    site.db.prepare('UPDATE settings SET choice_deadline_at = NULL').run();
    assert.deepEqual(read((await as.jona.get('/points')).html).courses.find((course) => course.code === 'STÆR2BH05'), { code: 'STÆR2BH05', points: 4, take: true, give: false });
  });
});

describe('open question 21 (BR-38, BR-67)', () => {
  test('BR-38: an event manager cannot mark their own attendance; another manager of the event or an admin can', async () => {
    const today = toIso().slice(0, 10);
    const id = insertEvent(site.db, people.runar.id, { event_date: today, start_time: '00:00', end_time: '23:59' });
    signUp(id, 'runar', 0);
    signUp(id, 'jona', 0);
    const attended = (key) => site.db.prepare('SELECT attended FROM registrations WHERE event_id = ? AND student_id = ?').pluck().get(id, people[key].id);
    const tick = async (browser, key, value = '1') => browser.request('POST', `/teacher/events/${id}/attendance`,
      { _csrf: await browser.csrfToken(`/teacher/events/${id}/attendance`), student: String(people[key].id), attended: value }, { Accept: 'application/json' });

    const own = await tick(as.runar, 'runar');
    assert.equal(own.status, 409);
    assert.equal(JSON.parse(own.html).message, 'Þú getur ekki skráð þína eigin mætingu. Annar viðburðastjóri viðburðarins eða stjórnandi gerir það.');
    assert.equal(attended('runar'), 0);
    assert.equal((await tick(as.runar, 'jona')).status, 200, 'he still marks the others');
    assert.equal(attended('jona'), 1);

    // His own row cannot be ticked, and "Vista" does not send it.
    const page = (await as.runar.get(`/teacher/events/${id}/attendance`)).html;
    const row = (key) => new RegExp(`<li>(?:(?!</li>)[\\s\\S])*name="present" value="${people[key].id}"(?:(?!</li>)[\\s\\S])*</li>`).exec(page)[0];
    assert.match(row('runar'), new RegExp(`name="present" value="${people.runar.id}" disabled>`));
    assert.doesNotMatch(row('runar'), /name="listed"/);
    assert.match(row('runar'), /Þú\. Annar viðburðastjóri viðburðarins eða stjórnandi skráir mætingu þína\./);
    assert.match(row('jona'), /name="listed"/);
    // A hand-made "Vista" that includes his own row: his is skipped and said so, the other is saved.
    const saveAll = await as.runar.request('POST', `/teacher/events/${id}/attendance`, [
      ['_csrf', await as.runar.csrfToken(`/teacher/events/${id}/attendance`)],
      ['listed', String(people.runar.id)], ['listed', String(people.jona.id)], ['present', String(people.runar.id)], ['marked', String(people.jona.id)],
    ]);
    assert.equal(saveAll.status, 303);
    assert.deepEqual([attended('runar'), attended('jona')], [0, 0]);
    assert.match((await as.runar.get(`/teacher/events/${id}/attendance`)).html, failed('Þú getur ekki skráð þína eigin mætingu\\.'));

    assert.equal((await tick(as.admin, 'runar')).status, 200);
    assert.equal(attended('runar'), 1, 'an admin marks it');
    assert.deepEqual([studentPoints(site.db, people.runar.id).earned], [4], 'and it earns him points like anyone else');
  });

  test('BR-67: the role can be taken from a student, never from a teacher', async () => {
    const managers = (await as.admin.get('/admin/teachers')).html;
    const rowOf = (name) => new RegExp(`<tr>\\s*<td>${name}[\\s\\S]*?</tr>`).exec(managers)[0];
    assert.match(rowOf('Rúnar Nemandastjóri'), /value="revoke-event-manager"/);
    assert.doesNotMatch(rowOf('Kennari Prófun'), /value="revoke-event-manager"/, 'no button on a teacher\'s row');
    assert.doesNotMatch(rowOf('Stefán Stjórnandi'), /value="revoke-event-manager"/);

    const refused = await as.admin.post('/admin/teachers', { action: 'revoke-event-manager', id: String(people.teacher.id) });
    assert.equal(refused.status, 303);
    assert.match((await as.admin.get('/admin/teachers')).html, failed('Kennari er alltaf viðburðastjóri\\. Réttindin er aðeins hægt að taka af nemanda\\.'));
    assert.equal(site.db.prepare('SELECT is_event_manager FROM users WHERE id = ?').pluck().get(people.teacher.id), 1);
    assert.equal(site.db.prepare("SELECT COUNT(*) FROM audit_log WHERE action = 'event-manager.revoke'").pluck().get(), 0);
    assert.match(rowOf('Kennari Prófun'), /Kennari Prófun/, 'so a teacher stays on the page, where codes and admin rights are managed (BR-11)');

    await as.admin.post('/admin/teachers', { action: 'revoke-event-manager', id: String(people.runar.id) });
    assert.equal(site.db.prepare('SELECT is_event_manager FROM users WHERE id = ?').pluck().get(people.runar.id), 0);
    site.db.prepare('UPDATE users SET is_event_manager = 1 WHERE id = ?').run(people.runar.id);
  });
});
