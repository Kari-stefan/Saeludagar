import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { attendanceWindow } from '../src/services/attendance.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// A date relative to today (UTC, which is Iceland's time), as 'YYYY-MM-DD'.
const dateIn = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 10);

let site;
let teacher;
let coteacher;
const students = {};
const as = {};

before(async () => {
  site = await startSite();
  teacher = await site.addUser({ name: 'Kennari Prófun', email: 'kennari@example.is' });
  coteacher = await site.addUser({ name: 'Meðkennari Prófun', email: 'medkennari@example.is' });
  const other = await site.addUser({ name: 'Annar Kennari', email: 'annar@example.is' });
  for (const [key, name, braut] of [['thorunn', 'Þórunn Prófun', 'Rafmagnsbraut'], ['asta', 'Ásta Prófun', 'Starfsbraut'],
    ['bjarni', 'Bjarni Prófun', null], ['orn', 'Örn Prófun', 'Rafmagnsbraut']]) {
    students[key] = await site.addUser({ role: 'student', name, email: `${key}@example.is` });
    site.db.prepare('UPDATE users SET braut = ? WHERE id = ?').run(braut, students[key].id);
  }
  for (const [key, account] of [['teacher', teacher], ['coteacher', coteacher], ['other', other], ['student', students.thorunn]]) {
    as[key] = site.browser();
    await as[key].login(account.kennitala, account.code);
  }
});

after(() => site.close());

beforeEach(() => {
  site.db.exec('DELETE FROM registrations; DELETE FROM events; DELETE FROM audit_log; DELETE FROM email_outbox; DELETE FROM student_courses');
  site.db.prepare('UPDATE settings SET choice_deadline_at = NULL').run();
});

const event = (fields = {}) => insertEvent(site.db, teacher.id, fields);
const register = (eventId, ...keys) => {
  for (const key of keys) {
    site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(eventId, students[key].id, toIso());
  }
};
const signup = (eventId, key) => site.db.prepare('SELECT * FROM registrations WHERE event_id = ? AND student_id = ?').get(eventId, students[key].id);
const auditLog = () => site.db.prepare('SELECT actor_id, action, student_id, details FROM audit_log ORDER BY id').all();

// One tick, the way public/js/attendance.js sends it: the token in a header, JSON back.
async function tick(browser, eventId, key, attended) {
  const token = await browser.csrfToken('/teacher');
  const res = await browser.request('POST', `/teacher/events/${eventId}/attendance`,
    { student: String(students[key].id), attended: attended ? '1' : '0' },
    { Accept: 'application/json', 'X-CSRF-Token': token });
  return { status: res.status, body: JSON.parse(res.html) };
}

// The whole list, the way the "Vista" button sends it without JavaScript: `marked` is who was
// ticked when the page loaded, `present` who is ticked now.
async function saveAll(browser, eventId, listed, present, marked = []) {
  const form = new URLSearchParams([['_csrf', await browser.csrfToken('/teacher')]]);
  for (const key of listed) form.append('listed', String(students[key].id));
  for (const key of marked) form.append('marked', String(students[key].id));
  for (const key of present) form.append('present', String(students[key].id));
  return browser.request('POST', `/teacher/events/${eventId}/attendance`, form);
}

describe('participants (BR-37)', () => {
  test('BR-37: the name search ignores case for Icelandic letters, and names sort in Icelandic order', async () => {
    const id = event();
    const found = (await as.teacher.get(`/teacher/events/${id}?search=${encodeURIComponent('þór')}`)).html;
    assert.match(found, /Leitarniðurstöður[\s\S]*Þórunn Prófun/);
    assert.match((await as.teacher.get(`/teacher/events/${id}?search=${encodeURIComponent('ÁSTA')}`)).html, /Leitarniðurstöður[\s\S]*Ásta Prófun/);
    assert.doesNotMatch((await as.teacher.get(`/teacher/events/${id}?search=%25`)).html, /Leitarniðurstöður[\s\S]*Prófun<\/td>/, 'a % is a letter, not a wildcard');

    register(id, 'orn', 'thorunn', 'bjarni', 'asta');
    const page = (await as.teacher.get(`/teacher/events/${id}`)).html;
    const names = [...page.matchAll(/<td>(\S+ Prófun)<\/td>/g)].map((m) => m[1]);
    assert.deepEqual(names, ['Ásta Prófun', 'Bjarni Prófun', 'Þórunn Prófun', 'Örn Prófun']);
  });

  test('BR-37: a teacher can add a student while sign-up is closed', async () => {
    const id = event();
    const at = (ms) => toIso(new Date(Date.now() + ms));
    site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?').run(at(-2 * DAY), at(-DAY));
    try {
      await as.teacher.post(`/teacher/events/${id}`, { action: 'add-student', student: String(students.asta.id) });
      assert.equal(signup(id, 'asta').added_by, teacher.id);
    } finally {
      site.db.prepare('UPDATE settings SET signup_opens_at = NULL, signup_closes_at = NULL').run();
    }
  });

  test('BR-37, BR-32: a student can only be added to a published event', async () => {
    const id = event({ status: 'draft' });
    const page = (await as.teacher.get(`/teacher/events/${id}`)).html;
    assert.match(page, /Birtu viðburðinn til að geta bætt nemendum við\./);
    assert.doesNotMatch(page, /id="student-search"/);
    await as.teacher.post(`/teacher/events/${id}`, { action: 'add-student', student: String(students.asta.id) });
    assert.match((await as.teacher.get(`/teacher/events/${id}`)).html, /Aðeins er hægt að bæta nemendum við birta viðburði\./);
    assert.equal(signup(id, 'asta'), undefined);
  });
});

describe('attendance (BR-38, BR-39, BR-41, BR-56)', () => {
  test('BR-39: attendance opens at 00:00 on the event date and closes at the deadline; with no deadline it stays open', () => {
    const day = { event_date: '2027-03-11' };
    const phase = (iso) => attendanceWindow(site.db, day, new Date(iso)).phase;
    assert.equal(phase('2027-03-10T23:59:59Z'), 'before');
    assert.equal(phase('2027-03-11T00:00:00Z'), 'open');
    assert.equal(phase('2028-01-01T00:00:00Z'), 'open', 'no deadline set yet');
    site.db.prepare('UPDATE settings SET choice_deadline_at = ?').run('2027-03-20T16:00:00Z');
    assert.equal(phase('2027-03-20T15:59:59Z'), 'open');
    assert.equal(phase('2027-03-20T16:00:00Z'), 'after');
  });

  test('BR-38: the checklist starts unticked, and each tick saves at once', async () => {
    const id = event({ event_date: dateIn(0) });
    register(id, 'asta', 'bjarni');
    const page = (await as.teacher.get(`/teacher/events/${id}/attendance`)).html;
    assert.match(page, /0 af 2 mættu/);
    assert.equal([...page.matchAll(/<input type="checkbox" name="present" value="\d+">/g)].length, 2, 'both unticked and enabled');
    assert.match(page, /data-autosave/);
    assert.match(page, /<script src="\/js\/attendance.js" defer><\/script>/);
    assert.match(page, /<button type="submit" class="button" data-save-all>Vista<\/button>/);

    const res = await tick(as.teacher, id, 'asta', true);
    assert.deepEqual([res.status, res.body], [200, { ok: true, message: 'Vistað.', summary: '1 af 2 mættu' }]);
    assert.equal(signup(id, 'asta').attended, 1);
    assert.equal(signup(id, 'asta').attendance_marked_by, teacher.id);
    assert.match(signup(id, 'asta').attendance_marked_at, /^\d{4}-\d\d-\d\dT/);
    assert.equal(signup(id, 'bjarni').attended, 0);
    assert.deepEqual(auditLog(), [{ actor_id: teacher.id, action: 'attendance.set', student_id: students.asta.id, details: '{}' }]);
    assert.match((await as.teacher.get(`/teacher/events/${id}/attendance`)).html, /value="\d+" checked>/);
  });

  test('BR-38: without JavaScript, "Vista" saves the whole list', async () => {
    const id = event({ event_date: dateIn(0) });
    register(id, 'asta', 'bjarni', 'orn');
    const res = await saveAll(as.teacher, id, ['asta', 'bjarni', 'orn'], ['asta', 'orn']);
    assert.deepEqual([res.status, res.location], [303, `/teacher/events/${id}/attendance`]);
    assert.match((await as.teacher.get(`/teacher/events/${id}/attendance`)).html, /Mætingin var vistuð\.[\s\S]*2 af 3 mættu/);
    assert.deepEqual(['asta', 'bjarni', 'orn'].map((key) => signup(id, key).attended), [1, 0, 1]);

    const reloaded = (await as.teacher.get(`/teacher/events/${id}/attendance`)).html;
    assert.equal([...reloaded.matchAll(/<input type="hidden" name="marked" value="\d+">/g)].length, 2, 'the page carries who was ticked');
    await saveAll(as.teacher, id, ['asta', 'bjarni', 'orn'], ['bjarni'], ['asta', 'orn']);
    assert.deepEqual(['asta', 'bjarni', 'orn'].map((key) => signup(id, key).attended), [0, 1, 0]);
    assert.deepEqual(auditLog().map((row) => row.action).sort(), [
      'attendance.set', 'attendance.set', 'attendance.set', 'attendance.unset', 'attendance.unset',
    ]);
  });

  test('BR-38, BR-41: "Vista" on a page loaded earlier saves only what changed there, never undoing a newer tick', async () => {
    const id = event({ event_date: dateIn(0) });
    register(id, 'asta', 'bjarni');
    // The list is loaded on one phone with nobody ticked; meanwhile Ásta is ticked on another.
    await tick(as.teacher, id, 'asta', true);
    // The old page still shows Ásta unticked; the teacher ticks Bjarni there and presses Vista.
    await saveAll(as.teacher, id, ['asta', 'bjarni'], ['bjarni'], []);
    assert.deepEqual([signup(id, 'asta').attended, signup(id, 'bjarni').attended], [1, 1], 'Ásta stays ticked');
  });

  test('BR-39: before the event\'s date the list is read-only, and saving is refused', async () => {
    const id = event({ event_date: dateIn(DAY) });
    register(id, 'asta');
    const page = (await as.teacher.get(`/teacher/events/${id}/attendance`)).html;
    assert.match(page, /Hægt er að skrá mætingu frá .*kl\. 00:00\. Þangað til er listinn aðeins til lestrar\./);
    assert.match(page, /<input type="checkbox" name="present" value="\d+" disabled>/);
    assert.doesNotMatch(page, /data-save-all|attendance\.js/);
    const res = await tick(as.teacher, id, 'asta', true);
    assert.deepEqual([res.status, res.body.message], [409, 'Ekki er hægt að breyta mætingu núna.']);
    await saveAll(as.teacher, id, ['asta'], ['asta']);
    assert.equal(signup(id, 'asta').attended, 0);
    assert.deepEqual(auditLog(), []);
  });

  test('BR-39: after the course-choice deadline the list is read-only', async () => {
    const id = event({ event_date: dateIn(0) });
    register(id, 'asta');
    site.db.prepare('UPDATE registrations SET attended = 1').run();
    site.db.prepare('UPDATE settings SET choice_deadline_at = ?').run(toIso(new Date(Date.now() - HOUR)));
    const page = (await as.teacher.get(`/teacher/events/${id}/attendance`)).html;
    assert.match(page, /Fresturinn rann út .*\. Listinn er aðeins til lestrar\./);
    assert.match(page, /value="\d+" checked disabled>/);
    assert.equal((await tick(as.teacher, id, 'asta', false)).status, 409);
    assert.equal(signup(id, 'asta').attended, 1);
  });

  test('BR-39: with no deadline set, the list is open from the event\'s date and says so', async () => {
    const id = event({ event_date: dateIn(-2 * DAY) });
    register(id, 'asta');
    assert.match((await as.teacher.get(`/teacher/events/${id}/attendance`)).html, /Frestur til að velja áfanga hefur ekki verið settur, svo listinn er opinn þangað til\./);
    assert.equal((await tick(as.teacher, id, 'asta', true)).status, 200);
  });

  test('BR-41, BR-56: unmarking attendance deletes the course choice, and both changes are logged', async () => {
    const id = event({ event_date: dateIn(0) });
    register(id, 'asta');
    site.db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)').run(students.asta.id, 'STÆR2BH05');
    site.db.prepare('UPDATE registrations SET attended = 1, course_code = ?, course_chosen_at = ? WHERE event_id = ?')
      .run('STÆR2BH05', toIso(), id);
    assert.equal((await tick(as.teacher, id, 'asta', false)).status, 200);
    assert.deepEqual([signup(id, 'asta').attended, signup(id, 'asta').course_code, signup(id, 'asta').course_chosen_at], [0, null, null]);
    assert.deepEqual(auditLog(), [
      { actor_id: teacher.id, action: 'attendance.unset', student_id: students.asta.id, details: '{}' },
      { actor_id: teacher.id, action: 'choice.clear', student_id: students.asta.id, details: '{"course":"STÆR2BH05","reason":"attendance.unset"}' },
    ]);
  });

  test('BR-38: a student who was removed meanwhile is reported, not saved', async () => {
    const id = event({ event_date: dateIn(0) });
    const res = await tick(as.teacher, id, 'asta', true);
    assert.deepEqual([res.status, res.body.ok], [409, false]);
    assert.match(res.body.message, /ekki lengur skráður/);
  });

  test('§8: co-teachers can take attendance; other teachers and students cannot', async () => {
    const id = event({ event_date: dateIn(0) });
    site.db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(id, coteacher.id);
    register(id, 'asta');
    assert.equal((await tick(as.coteacher, id, 'asta', true)).status, 200);
    assert.equal(signup(id, 'asta').attendance_marked_by, coteacher.id);
    assert.equal((await as.other.get(`/teacher/events/${id}/attendance`)).status, 403);
    assert.equal((await as.student.get(`/teacher/events/${id}/attendance`)).status, 403);
    const token = await as.other.csrfToken('/teacher');
    const res = await as.other.request('POST', `/teacher/events/${id}/attendance`, { _csrf: token, student: String(students.asta.id), attended: '0' });
    assert.equal(res.status, 403);
    assert.equal(signup(id, 'asta').attended, 1);
  });
});

describe('emails and messages (BR-50)', () => {
  test('BR-50: the event page lists every participant\'s email, ready to paste into BCC', async () => {
    const id = event();
    assert.doesNotMatch((await as.teacher.get(`/teacher/events/${id}`)).html, /id="emails-list"/, 'no list without participants');
    register(id, 'orn', 'asta');
    const page = (await as.teacher.get(`/teacher/events/${id}`)).html;
    assert.match(page, /<textarea class="field__input copy-box" id="emails-list" rows="3" readonly aria-describedby="emails-hint">asta@example\.is; orn@example\.is<\/textarea>/);
    assert.match(page, /<button type="button" class="button button--secondary" data-copy="emails-list"[^>]* hidden>Afrita netföng<\/button>/);
    assert.match(page, /<script src="\/js\/copy-emails.js" defer><\/script>/);
  });

  test('BR-50, BR-52: a message goes to everyone signed up, from noreply with the teacher as Reply-To', async () => {
    const id = event({ title_is: 'Gönguferð', title_en: 'Hike' });
    register(id, 'asta', 'bjarni');
    assert.match((await as.teacher.get(`/teacher/events/${id}/message`)).html, /Viðtakendur: 2 \(allir sem eru skráðir á viðburðinn\)\./);

    const res = await as.teacher.post(`/teacher/events/${id}/message`, { subject: 'Mæting kl. 9', body: 'Hittumst við aðalinnganginn.\r\nTakið með nesti.' });
    assert.deepEqual([res.status, res.location], [303, `/teacher/events/${id}`]);
    assert.match((await as.teacher.get(`/teacher/events/${id}`)).html, /Pósturinn er kominn í biðröð og fer út á næstu mínútum\. Viðtakendur: 2\./);

    const sent = await site.sendEmails();
    assert.deepEqual(sent.map((email) => email.to.address).sort(), ['asta@example.is', 'bjarni@example.is']);
    for (const email of sent) {
      assert.deepEqual(email.replyTo, { name: 'Kennari Prófun', address: 'kennari@example.is' });
      assert.equal(email.subject, 'Mæting kl. 9', 'the teacher\'s subject, once');
      assert.match(email.text, /^Skilaboð frá Kennari Prófun til þeirra sem eru skráð á viðburðinn Gönguferð \(11\. mars 2027, kl\. 10:00–12:00\):\nA message from Kennari Prófun to everyone signed up for Hike \(11 March 2027, 10:00–12:00\):\n/);
      assert.match(email.text, /\n\nHittumst við aðalinnganginn\.\nTakið með nesti\.\n\n/);
      assert.match(email.text, new RegExp(`Ef þú svarar þessum pósti fer svarið til viðburðastjóra\\.[\\s\\S]*/events/${id}\\n?$`));
    }
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM email_outbox').pluck().get(), 0);
  });

  test('BR-50: the subject and text are checked, and nothing is sent when they are wrong', async () => {
    const id = event();
    register(id, 'asta');
    const empty = await as.teacher.post(`/teacher/events/${id}/message`, { subject: '  ', body: 'Texti.' });
    assert.equal(empty.status, 400);
    assert.match(empty.html, /id="field-subject-error">Fylltu út þennan reit\.</);
    assert.match(empty.html, />Texti\.<\/textarea>/, 'the text is kept');
    for (const subject of ['Efni\nBcc: einhver@example.is', 'Efni\rBcc: einhver@example.is']) {
      const twoLines = await as.teacher.post(`/teacher/events/${id}/message`, { subject, body: 'Texti.' });
      assert.match(twoLines.html, /id="field-subject-error">Textinn inniheldur ógild tákn\.</, JSON.stringify(subject));
    }
    const long = await as.teacher.post(`/teacher/events/${id}/message`, { subject: 'Efni', body: 'x'.repeat(5001) });
    assert.match(long.html, /id="field-body-error">Textinn má vera að hámarki 5\.000 stafir\.</);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM email_outbox').pluck().get(), 0);
  });

  test('BR-50, BR-17: a deactivated participant gets no email and is not counted, but stays on the lists', async () => {
    const id = event();
    register(id, 'asta', 'bjarni');
    site.db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(students.bjarni.id);
    try {
      const page = (await as.teacher.get(`/teacher/events/${id}`)).html;
      assert.match(page, /<td>Bjarni Prófun<\/td>/, 'still in the participant table');
      assert.match(page, /readonly aria-describedby="emails-hint">asta@example\.is<\/textarea>/);
      assert.match((await as.teacher.get(`/teacher/events/${id}/message`)).html, /Viðtakendur: 1 /);
      await as.teacher.post(`/teacher/events/${id}/message`, { subject: 'Efni', body: 'Texti.' });
      assert.deepEqual((await site.sendEmails()).map((email) => email.to.address), ['asta@example.is']);
      assert.match((await as.teacher.get(`/teacher/events/${id}/print`)).html, /<td>Bjarni Prófun<\/td>/);
    } finally {
      site.db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(students.bjarni.id);
    }
  });

  test('BR-50: with nobody signed up, there is nobody to send to', async () => {
    const id = event();
    assert.match((await as.teacher.get(`/teacher/events/${id}/message`)).html, /<button type="submit" class="button" disabled>Senda<\/button>/);
    const res = await as.teacher.post(`/teacher/events/${id}/message`, { subject: 'Efni', body: 'Texti.' });
    assert.equal(res.status, 400);
    assert.match(res.html, /Enginn er skráður á viðburðinn, svo enginn myndi fá póstinn\./);
  });

  test('§8: only the event\'s teachers can see the emails or send a message', async () => {
    const id = event();
    register(id, 'asta');
    for (const browser of [as.other, as.student]) {
      assert.equal((await browser.get(`/teacher/events/${id}/message`)).status, 403);
      assert.equal((await browser.post(`/teacher/events/${id}/message`, { subject: 'Efni', body: 'Texti.' })).status, 403);
    }
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM email_outbox').pluck().get(), 0);
  });
});

describe('the printable list (BR-51)', () => {
  test('BR-51: the event\'s details, then each participant\'s name and braut with an empty box, and nothing more about them', async () => {
    const id = event({ title_is: 'Gönguferð', location: 'Elliðaárdalur' });
    register(id, 'orn', 'asta', 'bjarni');
    const page = (await as.teacher.get(`/teacher/events/${id}/print`)).html;
    assert.match(page, /<h1>Gönguferð<\/h1>\s*<p class="print-meta">11\. mars 2027, kl\. 10:00–12:00<br>Elliðaárdalur<\/p>/);
    const rows = [...page.matchAll(/<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]*)<\/td>\s*<td class="print-table__box"><span class="print-box"><\/span><\/td>/g)]
      .map((m) => [m[1], m[2]]);
    assert.deepEqual(rows, [['Ásta Prófun', 'Starfsbraut'], ['Bjarni Prófun', ''], ['Örn Prófun', 'Rafmagnsbraut']]);
    assert.doesNotMatch(page, /@example\.is|Kennitala/);
    assert.match(page, /<div class="no-print">/);
    assert.equal((await as.other.get(`/teacher/events/${id}/print`)).status, 403);
  });
});
