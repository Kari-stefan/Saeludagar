import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SIGNUPS_PER_STUDENT, POINTS_PER_ATTENDANCE } from '../src/config.js';
import { toIso } from '../src/db/index.js';
import { overlaps, signUp } from '../src/services/signups.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const FAILED = (text) => new RegExp(`role="alert">\\s*<p>${text}`);

let site;
let teacher;
const students = {};
const as = {};

before(async () => {
  site = await startSite();
  teacher = await site.addUser({ name: 'Kennari' });
  as.teacher = site.browser();
  await as.teacher.login(teacher.kennitala, teacher.code);
  for (const [key, braut] of [['jona', 'Rafmagnsbraut'], ['pall', 'Starfsbraut'], ['sara', null]]) {
    students[key] = await site.addUser({ role: 'student', name: `Nemandi ${key}` });
    site.db.prepare('UPDATE users SET braut = ? WHERE id = ?').run(braut, students[key].id);
    as[key] = site.browser();
    await as[key].login(students[key].kennitala, students[key].code);
  }
  as.guest = site.browser();
});

after(() => site.close());

// The sign-up window, relative to now (BR-31). null leaves it unset.
function setWindow(opensIn, closesIn) {
  const at = (ms) => (ms === null ? null : toIso(new Date(Date.now() + ms)));
  site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?').run(at(opensIn), at(closesIn));
}

const event = (fields) => insertEvent(site.db, teacher.id, fields);
const signupsOf = (eventId) => site.db.prepare('SELECT student_id FROM registrations WHERE event_id = ? ORDER BY student_id').pluck().all(eventId);
const mine = (studentId) => site.db.prepare('SELECT event_id FROM registrations WHERE student_id = ? ORDER BY event_id').pluck().all(studentId);

// Signs up through the event page and returns that page as the student then sees it.
async function signUpVia(browser, eventId, action = 'signup') {
  const res = await browser.post(`/events/${eventId}`, { action });
  assert.equal(res.status, 303, res.html);
  assert.equal(res.location, `/events/${eventId}`);
  return (await browser.get(`/events/${eventId}`)).html;
}

beforeEach(() => {
  site.db.exec('DELETE FROM events; DELETE FROM audit_log');
  setWindow(-HOUR, HOUR);
});

describe('signing up and cancelling (BR-31 to BR-36, BR-43)', () => {
  test('BR-32: a student signs up for a published event, and it shows on the event page and in Mínir viðburðir', async () => {
    const id = event({ title_is: 'Gönguferð', capacity: 10 });
    const page = await signUpVia(as.jona, id);
    assert.match(page, /role="status">\s*<p>Skráning tókst\. Viðburðurinn er nú á Mínum viðburðum\./);
    assert.match(page, /Þú hefur skráð þig á þennan viðburð\./);
    assert.match(page, /value="cancel">Afskrá mig</);
    assert.match(page, /1 \/ 10 skráðir/);
    assert.deepEqual(signupsOf(id), [students.jona.id]);
    const myEvents = (await as.jona.get('/my-events')).html;
    assert.match(myEvents, /Skráningar: 1 \/ 4/);
    assert.match(myEvents, /<a href="\/events\/\d+">Gönguferð<\/a><\/td>\s*<td>11\. mars 2027, kl\. 10:00–12:00<\/td>\s*<td>Stofa 101<\/td>\s*<td>Ekki skráð<\/td>/);
  });

  test('BR-31: students can sign up and cancel only while the window is open', async () => {
    const id = event({ title_is: 'Gluggaprófun' });
    for (const [opensIn, closesIn, phase] of [[HOUR, 2 * HOUR, /Skráning opnar /], [-2 * HOUR, -HOUR, /Skráningu lauk /], [null, null, /Ekki er búið að ákveða hvenær skráning opnar\./]]) {
      setWindow(opensIn, closesIn);
      const page = await signUpVia(as.jona, id);
      assert.match(page, FAILED('Skráning er ekki opin núna\\.'));
      assert.match(page, phase);
    }
    assert.deepEqual(signupsOf(id), []);

    setWindow(-HOUR, HOUR);
    await signUpVia(as.jona, id);
    setWindow(-2 * HOUR, -HOUR);
    const page = await signUpVia(as.jona, id, 'cancel');
    assert.match(page, FAILED('Skráning er ekki opin núna\\.'));
    assert.doesNotMatch(page, /value="cancel"/, 'no cancel button outside the window');
    assert.deepEqual(signupsOf(id), [students.jona.id]);
  });

  test('BR-31: the window opens at its opening time and closes at its closing time', () => {
    const id = event({});
    const opens = new Date('2027-02-15T12:00:00Z');
    const closes = new Date('2027-03-01T12:00:00Z');
    site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?').run(toIso(opens), toIso(closes));
    assert.equal(signUp(site.db, students.jona.id, id, new Date(opens.getTime() - 1)).error, 'signups.errors.windowClosed');
    assert.equal(signUp(site.db, students.pall.id, id, new Date(closes.getTime())).error, 'signups.errors.windowClosed');
    assert.deepEqual(signUp(site.db, students.sara.id, id, opens), { ok: true });
  });

  test('BR-32: drafts cannot be signed up for, and nobody signs up twice', async () => {
    const draft = event({ status: 'draft' });
    assert.equal((await as.jona.post(`/events/${draft}`, { action: 'signup' })).status, 404);
    assert.deepEqual(signupsOf(draft), []);
    const id = event({});
    await signUpVia(as.jona, id);
    const again = await as.jona.post(`/events/${id}`, { action: 'signup' });
    assert.equal(again.location, `/events/${id}`);
    assert.deepEqual(signupsOf(id), [students.jona.id]);
    assert.equal(signUp(site.db, students.jona.id, id).error, 'signups.errors.already');
  });

  test('BR-32, BR-24: a restricted event takes only students of its brautir; tagged events take everyone', async () => {
    const restricted = event({ title_is: 'Starfsbrautarferð', brautir: ['Starfsbraut', 'Íþróttabraut'], braut_restricted: 1 });
    const page = await signUpVia(as.jona, restricted);
    assert.match(page, FAILED('Þessi viðburður er aðeins fyrir nemendur þessara brauta: Starfsbraut, Íþróttabraut\\.'));
    assert.match(await signUpVia(as.sara, restricted), FAILED('Þessi viðburður er aðeins fyrir nemendur'));
    assert.match(await signUpVia(as.pall, restricted), /Skráning tókst/);
    assert.deepEqual(signupsOf(restricted), [students.pall.id]);

    const tagged = event({ title_is: 'Merktur viðburður', brautir: ['Starfsbraut'], start_time: '13:00', end_time: '14:00' });
    assert.match(await signUpVia(as.jona, tagged), /Skráning tókst/);
  });

  test('BR-33: events overlap on the same day when each starts before the other ends; back-to-back is fine', async () => {
    const at = (event_date, start_time, end_time) => ({ event_date, start_time, end_time });
    assert.equal(overlaps(at('2027-03-11', '10:00', '12:00'), at('2027-03-11', '11:00', '13:00')), true);
    assert.equal(overlaps(at('2027-03-11', '10:00', '12:00'), at('2027-03-11', '10:30', '11:00')), true);
    assert.equal(overlaps(at('2027-03-11', '10:00', '12:00'), at('2027-03-11', '12:00', '13:00')), false);
    assert.equal(overlaps(at('2027-03-11', '12:00', '13:00'), at('2027-03-11', '10:00', '12:00')), false);
    assert.equal(overlaps(at('2027-03-11', '10:00', '12:00'), at('2027-03-12', '10:00', '12:00')), false);

    const first = event({ title_is: 'Fyrsti', start_time: '10:00', end_time: '12:00' });
    const clashing = event({ title_is: 'Skarast', start_time: '11:00', end_time: '13:00' });
    const backToBack = event({ title_is: 'Strax á eftir', start_time: '12:00', end_time: '13:00' });
    const otherDay = event({ title_is: 'Annar dagur', event_date: '2027-03-12' });
    for (const id of [first, backToBack, otherDay]) assert.match(await signUpVia(as.jona, id), /Skráning tókst/);
    await signUpVia(as.jona, clashing);
    assert.deepEqual(mine(students.jona.id), [first, backToBack, otherDay]);
  });

  test('BR-34: a refused sign-up says why; an overlap names the other event, in either language', async () => {
    event({ title_is: 'Gönguferð', title_en: 'Hike', start_time: '10:00', end_time: '12:00' });
    const clash = event({ title_is: 'Bíóferð', start_time: '11:00', end_time: '13:00' });
    await signUpVia(as.pall, Number(site.db.prepare("SELECT id FROM events WHERE title_is = 'Gönguferð'").pluck().get()));
    const page = await signUpVia(as.pall, clash);
    assert.match(page, FAILED('Viðburðurinn skarast á við Gönguferð \\(11\\. mars 2027, kl\\. 10:00–12:00\\), sem þú hefur skráð þig á\\.'));

    const english = site.browser();
    await english.post('/language', { lang: 'en', returnTo: '/' });
    await english.login(students.pall.kennitala, students.pall.code);
    const englishPage = await signUpVia(english, clash);
    assert.match(englishPage, FAILED('This event overlaps Hike \\(11 March 2027, 10:00–12:00\\), which you are signed up for\\.'));
  });

  test('BR-35: 50 students signing up at the same moment for 10 places get exactly 10 places', async () => {
    const id = event({ title_is: 'Vinsæll viðburður', capacity: 10 });
    const crowd = [];
    for (let i = 0; i < 50; i += 1) {
      const account = await site.addUser({ role: 'student', name: `Fjöldi ${i}` });
      const browser = site.browser();
      await browser.login(account.kennitala, account.code);
      crowd.push({ browser, token: await browser.csrfToken() });
    }
    const results = await Promise.all(crowd.map(({ browser, token }) =>
      browser.request('POST', `/events/${id}`, { _csrf: token, action: 'signup' })));
    assert.ok(results.every((res) => res.status === 303));
    assert.equal(signupsOf(id).length, 10);
    assert.match((await as.guest.get(`/events/${id}`)).html, /10 \/ 10 skráðir <span class="badge badge--full">Uppselt<\/span>/);
    // Every student was told the outcome: 10 confirmations and 40 "Uppselt".
    const pages = await Promise.all(crowd.map(({ browser }) => browser.get(`/events/${id}`)));
    assert.equal(pages.filter((page) => /Skráning tókst/.test(page.html)).length, 10);
    assert.equal(pages.filter((page) => /Uppselt: öll pláss eru tekin\./.test(page.html)).length, 40);
  });

  test('BR-36: cancelling frees the place at once', async () => {
    const id = event({ title_is: 'Eitt pláss', capacity: 1 });
    await signUpVia(as.jona, id);
    assert.match(await signUpVia(as.pall, id), FAILED('Uppselt: öll pláss eru tekin\\.'));
    const cancelled = await signUpVia(as.jona, id, 'cancel');
    assert.match(cancelled, /Þú hefur afskráð þig og plássið er laust fyrir aðra\./);
    assert.match(cancelled, /value="signup">Skrá mig</);
    assert.match(await signUpVia(as.pall, id), /Skráning tókst/);
    assert.deepEqual(signupsOf(id), [students.pall.id]);
  });

  test('BR-36: students cancel from Mínir viðburðir too; a sign-up with marked attendance stays', async () => {
    const id = event({ title_is: 'Afskráning' });
    await signUpVia(as.jona, id);
    const res = await as.jona.post('/my-events', { action: 'cancel', event: String(id) });
    assert.equal(res.location, '/my-events');
    assert.match((await as.jona.get('/my-events')).html, /Þú hefur afskráð þig/);
    assert.deepEqual(signupsOf(id), []);

    await signUpVia(as.jona, id);
    site.db.prepare('UPDATE registrations SET attended = 1 WHERE event_id = ?').run(id);
    const myEvents = (await as.jona.get('/my-events')).html;
    assert.match(myEvents, /<td>Skráð<\/td>/, 'the attendance is shown');
    assert.doesNotMatch(myEvents, /name="event" value="\d+">/, 'no cancel button for an attended event');
    await as.jona.post('/my-events', { action: 'cancel', event: String(id) });
    assert.match((await as.jona.get('/my-events')).html, FAILED('Ekki er hægt að afskrá sig eftir að mæting hefur verið skráð\\.'));
    assert.deepEqual(signupsOf(id), [students.jona.id]);
  });

  test('BR-43: a 5th sign-up is refused, so a student can earn at most 16 points', async () => {
    assert.equal(MAX_SIGNUPS_PER_STUDENT, 4);
    assert.equal(MAX_SIGNUPS_PER_STUDENT * POINTS_PER_ATTENDANCE, 16);
    const ids = ['08:00', '09:00', '10:00', '11:00', '12:00'].map((start, i) =>
      event({ title_is: `Viðburður ${i + 1}`, start_time: start, end_time: `${String(9 + i).padStart(2, '0')}:00` }));
    for (const id of ids.slice(0, 4)) assert.match(await signUpVia(as.sara, id), /Skráning tókst/);
    const fifth = await signUpVia(as.sara, ids[4]);
    assert.match(fifth, FAILED('Þú hefur þegar skráð þig á 4 viðburði, sem er hámarkið\\. Afskráðu þig af öðrum fyrst\\.'));
    assert.deepEqual(mine(students.sara.id), ids.slice(0, 4));
    assert.match((await as.sara.get('/my-events')).html, /Skráningar: 4 \/ 4/);
  });

  test('BR-56: sign-ups and cancellations are recorded in the audit log', async () => {
    const id = event({});
    await signUpVia(as.jona, id);
    await signUpVia(as.jona, id, 'cancel');
    assert.deepEqual(site.db.prepare('SELECT actor_id, action, event_id, student_id FROM audit_log ORDER BY id').all(), [
      { actor_id: students.jona.id, action: 'signup.create', event_id: id, student_id: students.jona.id },
      { actor_id: students.jona.id, action: 'signup.delete', event_id: id, student_id: students.jona.id },
    ]);
  });
});

describe('"Skrá mig" for guests and other roles (§5, §6)', () => {
  test('§5: a guest is sent to log in and comes back to the event', async () => {
    const id = event({ title_is: 'Gestaviðburður' });
    const guest = site.browser();
    const page = (await guest.get(`/events/${id}`)).html;
    assert.match(page, new RegExp(`<a class="button" href="/login\\?next=/events/${id}">Skrá mig</a>`));
    assert.doesNotMatch(page, /value="signup"/);
    const loginPage = (await guest.get(`/login?next=/events/${id}`)).html;
    assert.match(loginPage, new RegExp(`<input type="hidden" name="next" value="/events/${id}">`));

    const failed = await guest.post('/login', { kennitala: students.pall.kennitala, code: '000000', next: `/events/${id}` });
    assert.match(failed.html, new RegExp(`name="next" value="/events/${id}"`), 'kept after a wrong code');
    site.db.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').run(students.pall.id);
    const res = await guest.post('/login', { kennitala: students.pall.kennitala, code: students.pall.code, next: `/events/${id}` });
    assert.equal(res.location, `/events/${id}`);
    assert.match(await signUpVia(guest, id), /Skráning tókst/);
  });

  test('BR-02: any other return address is ignored, so users land on their own home page', async () => {
    for (const next of ['/admin', '//evil.example', 'https://evil.example/events/1', '/events/1/../../admin']) {
      const browser = site.browser();
      const res = await browser.post('/login', { kennitala: students.jona.kennitala, code: students.jona.code, next });
      assert.equal(res.location, '/my-events', next);
    }
    const guestPost = await site.browser().post(`/events/${event({})}`, { action: 'signup' });
    assert.match(guestPost.location, /^\/login\?next=%2Fevents%2F\d+$/);
  });

  test('§6: teachers see no sign-up buttons and cannot sign up', async () => {
    const id = event({});
    const page = (await as.teacher.get(`/events/${id}`)).html;
    assert.doesNotMatch(page, /Skrá mig|Afskrá mig/);
    assert.equal((await as.teacher.post(`/events/${id}`, { action: 'signup' })).status, 403);
    assert.deepEqual(signupsOf(id), []);
  });

  test('BR-29: signing up for or cancelling an event that is gone gives 404 and leaves no message behind', async () => {
    const id = event({ title_is: 'Horfinn viðburður' });
    await signUpVia(as.pall, id);
    site.db.prepare('DELETE FROM events WHERE id = ?').run(id); // the teacher deleted it
    for (const action of ['cancel', 'signup']) {
      assert.equal((await as.pall.post(`/events/${id}`, { action })).status, 404, action);
    }
    const myEvents = (await as.pall.get('/my-events')).html;
    assert.doesNotMatch(myEvents, /role="alert"/);
  });

  test('BR-22, §6: the teacher\'s preview shows the sign-up box as students see it, with the button disabled', async () => {
    const id = event({ title_is: 'Forskoðun' });
    const preview = (await as.teacher.get(`/teacher/events/${id}/preview`)).html;
    assert.match(preview, /<h2 id="signup-heading">Skráning<\/h2>\s*<p class="signup-window">Skráning er opin til [^<]+<\/p>\s*<p><button type="button" class="button" disabled>Skrá mig<\/button><\/p>/);
    assert.doesNotMatch(preview, /name="action" value="signup"/);
  });

  test('§6: Mínir viðburðir with no sign-ups points to the events', async () => {
    site.db.exec('DELETE FROM registrations');
    const page = (await as.sara.get('/my-events')).html;
    assert.match(page, /Skráningar: 0 \/ 4/);
    assert.match(page, /Þú hefur ekki skráð þig á neinn viðburð enn\./);
    assert.match(page, /Skráning er opin til /);
  });
});
