import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toIso } from '../src/db/index.js';
import { ROOT_DIR } from '../src/config.js';
import { createEvent, getEvent, updateEvent, validateEvent } from '../src/services/events.js';
import { startSite } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(200, 3)]);

let site;
const people = {};
const as = {};

before(async () => {
  site = await startSite();
  for (const [key, fields] of Object.entries({
    admin: { isAdmin: true, name: 'Anna Stjórnandi' },
    owner: { name: 'Óli Eigandi' },
    coteacher: { name: 'Sara Samkennari' },
    other: { name: 'Gunnar Annar' },
    student: { role: 'student', name: 'Jóna Nemandi' },
    student2: { role: 'student', name: 'Páll Nemandi' },
  })) {
    people[key] = await site.addUser(fields);
    as[key] = site.browser();
    await as[key].login(people[key].kennitala, people[key].code);
  }
  as.guest = site.browser();
  site.db.prepare('UPDATE users SET braut = ? WHERE id = ?').run('Rafmagnsbraut', people.student.id);
  site.db.prepare('UPDATE users SET braut = ? WHERE id = ?').run('Starfsbraut', people.student2.id);
  for (const day of ['2027-03-11', '2027-03-12']) site.db.prepare('INSERT INTO saeludagar_days (day) VALUES (?)').run(day);
});

after(() => site.close());

const fields = (overrides = {}) => ({
  title_is: 'Gönguferð', title_en: '', description_is: 'Fyrsta lína.\nÖnnur lína.', description_en: '',
  host: 'Ferðafélag skólans', event_date: '2027-03-11', start_time: '10:00', end_time: '12:00',
  location: 'Íþróttahús', capacity: '20', fee_isk: '0', ...overrides,
});
const eventRow = (id) => site.db.prepare('SELECT * FROM events WHERE id = ?').get(id);
const brautirOf = (id) => site.db.prepare('SELECT braut FROM event_brautir WHERE event_id = ? ORDER BY braut').pluck().all(id);
const register = (eventId, studentId, attended = 0) => site.db.prepare(`INSERT INTO registrations
  (event_id, student_id, created_at, attended) VALUES (?, ?, ?, ?)`).run(eventId, studentId, toIso(), attended);
const uploads = () => (fs.existsSync(site.config.uploadDir) ? fs.readdirSync(site.config.uploadDir) : []);
const articleOf = (html) => /<article class="event">[\s\S]*?<\/article>/.exec(html)?.[0];

async function create(browser = as.owner, overrides = {}, file) {
  const res = await browser.postForm('/teacher/events/new', fields(overrides), file);
  assert.equal(res.status, 303, res.html);
  return Number(/^\/teacher\/events\/(\d+)$/.exec(res.location)[1]);
}

const publish = (id, browser = as.owner) => browser.post(`/teacher/events/${id}`, { action: 'publish' });

describe('event form and drafts (BR-20 to BR-22)', () => {
  beforeEach(() => site.db.exec('DELETE FROM events'));

  test('BR-20, BR-22: a teacher creates an event with every field, and it starts as a draft', async () => {
    const id = await create(as.owner, {
      title_en: 'Hike', description_en: 'In English.', fee_isk: '2500', capacity: '15',
      brautir: ['Rafmagnsbraut', 'Starfsbraut'], braut_restricted: '1',
    });
    const event = eventRow(id);
    assert.equal(event.status, 'draft');
    assert.equal(event.owner_id, people.owner.id);
    assert.deepEqual(
      [event.title_is, event.title_en, event.description_is, event.description_en, event.host, event.capacity, event.fee_isk,
        event.event_date, event.start_time, event.end_time, event.location, event.braut_restricted, event.image_file],
      ['Gönguferð', 'Hike', 'Fyrsta lína.\nÖnnur lína.', 'In English.', 'Ferðafélag skólans', 15, 2500,
        '2027-03-11', '10:00', '12:00', 'Íþróttahús', 1, null],
    );
    assert.deepEqual(brautirOf(id), ['Rafmagnsbraut', 'Starfsbraut']);
    assert.match((await as.owner.get(`/teacher/events/${id}`)).html, /Viðburðurinn var vistaður sem drög\./);
  });

  test('BR-20: English is optional; empty English fields are stored as NULL and the fee defaults to 0', async () => {
    const id = await create(as.owner, { fee_isk: '' });
    const event = eventRow(id);
    assert.deepEqual([event.title_en, event.description_en, event.fee_isk], [null, null, 0]);
  });

  test('BR-20: required fields and whole numbers are checked, and nothing is saved', async () => {
    const res = await as.owner.postForm('/teacher/events/new', fields({
      title_is: ' ', description_is: '', host: '', location: '', capacity: '0', fee_isk: '-5',
    }));
    assert.equal(res.status, 400);
    assert.equal(res.html.match(/Þetta þarf að fylla út/g).length, 4);
    assert.match(res.html, /Sláðu inn heila tölu, 1 eða hærri/);
    assert.match(res.html, /Sláðu inn heila krónutölu, 0 eða hærri/);
    assert.match(res.html, /Lagaðu villurnar hér fyrir neðan\./);
    for (const [name, value] of [['capacity', '1.5'], ['capacity', 'tíu'], ['fee_isk', '99.9']]) {
      assert.equal((await as.owner.postForm('/teacher/events/new', fields({ [name]: value }))).status, 400, `${name}=${value}`);
    }
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), 0);
  });

  test('BR-21: the date must be a Sæludagar day, and the event must end after it starts', async () => {
    const wrongDay = await as.owner.postForm('/teacher/events/new', fields({ event_date: '2027-03-13' }));
    assert.equal(wrongDay.status, 400);
    assert.match(wrongDay.html, /Veldu einn af Sæludögunum/);
    for (const [start, end] of [['12:00', '12:00'], ['12:00', '10:00']]) {
      const res = await as.owner.postForm('/teacher/events/new', fields({ start_time: start, end_time: end }));
      assert.equal(res.status, 400);
      assert.match(res.html, /Viðburðinum verður að ljúka eftir að hann hefst/);
    }
    assert.equal((await as.owner.postForm('/teacher/events/new', fields({ start_time: '25:00' }))).status, 400);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), 0);
  });

  test('BR-21: a Sæludagar day with events cannot be removed', async () => {
    await create(as.owner, { event_date: '2027-03-12', title_is: 'Bíóferð' });
    const res = await as.admin.post('/admin/settings', { action: 'remove-day', day: '2027-03-12' });
    assert.equal(res.location, '/admin/settings');
    assert.match((await as.admin.get('/admin/settings')).html, /Ekki er hægt að fjarlægja 12\. mars 2027 því viðburðir eru á deginum: Bíóferð\./);
    assert.ok(site.db.prepare('SELECT 1 FROM saeludagar_days WHERE day = ?').get('2027-03-12'));
  });

  test('BR-22: only the owner, co-teachers and admins see a draft; preview, then publish', async () => {
    const id = await create();
    for (const role of ['guest', 'student']) assert.equal((await as[role].get(`/events/${id}`)).status, 404, role);
    assert.equal((await as.other.get(`/teacher/events/${id}`)).status, 403);
    assert.equal((await as.other.get(`/teacher/events/${id}/preview`)).status, 403);
    assert.doesNotMatch((await as.guest.get('/')).html, /Gönguferð/);

    const preview = await as.owner.get(`/teacher/events/${id}/preview`);
    assert.match(preview.html, /<strong>Forskoðun\.<\/strong> Svona sjá nemendur viðburðinn\./);
    assert.equal((await as.admin.get(`/teacher/events/${id}/preview`)).status, 200);

    const res = await publish(id);
    assert.equal(res.location, `/teacher/events/${id}`);
    assert.equal(eventRow(id).status, 'published');
    assert.equal((await as.guest.get(`/events/${id}`)).status, 200);
    assert.match((await as.guest.get('/')).html, /Gönguferð/);
  });

  test('§6: the preview is exactly the public event page', async () => {
    const id = await create(as.owner, { title_en: 'Hike', fee_isk: '1500', brautir: ['Starfsbraut'] });
    await publish(id);
    const preview = articleOf((await as.owner.get(`/teacher/events/${id}/preview`)).html);
    const page = articleOf((await as.guest.get(`/events/${id}`)).html);
    assert.ok(preview);
    assert.equal(preview, page);
  });

  test('§9 item 3: the multipart event form needs the CSRF token', async () => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields())) form.append(name, value);
    const res = await as.owner.request('POST', '/teacher/events/new', form);
    assert.equal(res.status, 403);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), 0);
  });
});

describe('what guests and students see (BR-23 to BR-26, BR-60)', () => {
  let open;
  let electric;
  let restricted;

  before(async () => {
    site.db.exec('DELETE FROM events');
    open = await create(as.owner, { title_is: 'Opinn viðburður', start_time: '13:00', end_time: '14:00', capacity: '2' });
    electric = await create(as.owner, { title_is: 'Rafmagnsviðburður', brautir: ['Rafmagnsbraut'], start_time: '09:00', end_time: '10:00', fee_isk: '2500' });
    restricted = await create(as.owner, { title_is: 'Starfsbrautarviðburður', brautir: ['Starfsbraut'], braut_restricted: '1', event_date: '2027-03-12' });
    await create(as.owner, { title_is: 'Óbirt drög' });
    for (const id of [open, electric, restricted]) await publish(id);
  });

  test('BR-23: guests see only published events, by day and then start time', async () => {
    const home = (await as.guest.get('/')).html;
    assert.doesNotMatch(home, /Óbirt drög/);
    assert.match(home, /<h2 id="day-2027-03-11">11\. mars 2027<\/h2>[\s\S]*Rafmagnsviðburður[\s\S]*Opinn viðburður[\s\S]*<h2 id="day-2027-03-12">12\. mars 2027<\/h2>[\s\S]*Starfsbrautarviðburður/);
    assert.match(home, /Sæludagar: 11\. mars 2027, 12\. mars 2027/);
  });

  test('BR-23: the event page shows the sign-up count and the maximum, and "Uppselt" when full, but never names', async () => {
    register(open, people.student.id);
    let page = (await as.guest.get(`/events/${open}`)).html;
    assert.match(page, /1 \/ 2 skráðir/);
    assert.doesNotMatch(page, /Uppselt/);
    register(open, people.student2.id);
    page = (await as.student.get(`/events/${open}`)).html;
    assert.match(page, /2 \/ 2 skráðir <span class="badge badge--full">Uppselt<\/span>/);
    assert.match((await as.guest.get('/')).html, /<li class="badge badge--full">Uppselt<\/li>/);
    // The student sees their own name in the header, but no participant's name anywhere else.
    assert.doesNotMatch(articleOf(page), /Jóna Nemandi|Páll Nemandi/);
    assert.doesNotMatch(page, /Páll Nemandi/);
    assert.doesNotMatch((await as.guest.get(`/events/${open}`)).html, /Jóna Nemandi|Páll Nemandi/);
    assert.doesNotMatch((await as.guest.get('/')).html, /Jóna Nemandi|Páll Nemandi/);
    site.db.prepare('DELETE FROM registrations').run();
  });

  test('BR-24: brautir are shown, and the restriction as "Aðeins fyrir nemendur brautar"', async () => {
    const page = (await as.guest.get(`/events/${restricted}`)).html;
    assert.match(page, /<dt>Brautir<\/dt>\s*<dd>Starfsbraut <span class="badge">Aðeins fyrir nemendur brautar<\/span><\/dd>/);
    const tagged = (await as.guest.get(`/events/${electric}`)).html;
    assert.match(tagged, /<dd>Rafmagnsbraut<\/dd>/);
    assert.doesNotMatch(tagged, /Aðeins fyrir nemendur brautar/);
  });

  test('BR-24: the restriction needs a braut, and only brautir from the list can be chosen', async () => {
    const noBraut = await as.owner.postForm('/teacher/events/new', fields({ braut_restricted: '1' }));
    assert.equal(noBraut.status, 400);
    assert.match(noBraut.html, /Veldu að minnsta kosti eina braut ef viðburðurinn er aðeins fyrir nemendur brautar/);
    const unknown = await as.owner.postForm('/teacher/events/new', fields({ brautir: ['Draumabraut'] }));
    assert.equal(unknown.status, 400);
    assert.match(unknown.html, /Veldu brautir af listanum/);
  });

  test('BR-25: filtering by braut shows that braut\'s events and the events for everyone', async () => {
    const titles = (html) => [...html.matchAll(/<h3 class="event-card__title"><a href="\/events\/\d+">([^<]+)<\/a>/g)].map((m) => m[1]);
    assert.deepEqual(titles((await as.guest.get('/')).html), ['Rafmagnsviðburður', 'Opinn viðburður', 'Starfsbrautarviðburður']);
    const electricOnly = await as.guest.get('/?braut=Rafmagnsbraut');
    assert.deepEqual(titles(electricOnly.html), ['Rafmagnsviðburður', 'Opinn viðburður']);
    assert.match(electricOnly.html, /<a href="\/\?braut=Rafmagnsbraut" aria-current="page">Rafmagnsbraut<\/a>/);
    assert.deepEqual(titles((await as.guest.get('/?braut=Starfsbraut')).html), ['Opinn viðburður', 'Starfsbrautarviðburður']);
    assert.deepEqual(titles((await as.guest.get('/?braut=Engin')).html).length, 3, 'an unknown braut shows everything');
    assert.match((await as.guest.get('/')).html, /<a href="\/" aria-current="page">Allar brautir<\/a>/);
  });

  test('BR-26: the fee is shown in whole krónur, and 0 as "Ókeypis" / "Free"', async () => {
    assert.match((await as.guest.get(`/events/${electric}`)).html, /<dd>2\.500 kr\.<\/dd>/);
    assert.match((await as.guest.get(`/events/${open}`)).html, /<dd>Ókeypis<\/dd>/);
    const english = site.browser();
    await english.post('/language', { lang: 'en', returnTo: '/' });
    assert.match((await english.get(`/events/${electric}`)).html, /<dd>ISK 2,500<\/dd>/);
    assert.match((await english.get(`/events/${open}`)).html, /<dd>Free<\/dd>/);
  });

  test('BR-60: in English the English title and description are shown, or the Icelandic when missing', async () => {
    const both = await create(as.owner, { title_is: 'Skíðaferð', title_en: 'Ski trip', description_is: 'Á íslensku.', description_en: 'In English.' });
    await publish(both);
    const english = site.browser();
    await english.post('/language', { lang: 'en', returnTo: '/' });
    const page = (await english.get(`/events/${both}`)).html;
    assert.match(page, /<h1>Ski trip<\/h1>/);
    assert.match(page, /In English\./);
    assert.doesNotMatch(page, /Á íslensku\./);
    const fallback = (await english.get(`/events/${open}`)).html;
    assert.match(fallback, /<h1>Opinn viðburður<\/h1>/);
    assert.match(fallback, /Fyrsta lína\.\nÖnnur lína\./);
    assert.match((await as.guest.get(`/events/${both}`)).html, /<h1>Skíðaferð<\/h1>/);
  });

  test('BR-61: the Icelandic event pages say "viðburður", never "atburður"', async () => {
    for (const url of ['/', `/events/${open}`]) assert.doesNotMatch((await as.guest.get(url)).html, /atburð/i, url);
    for (const url of ['/teacher', '/teacher/events/new', `/teacher/events/${open}`, `/teacher/events/${open}/edit`]) {
      assert.doesNotMatch((await as.owner.get(url)).html, /atburð/i, url);
    }
  });
});

describe('event images (BR-27)', () => {
  beforeEach(() => site.db.exec('DELETE FROM events'));

  test('BR-27: JPG, PNG and WebP are saved under random names outside public/ and served from /uploads', async () => {
    for (const [bytes, type] of [[PNG, 'image/png'], [JPG, 'image/jpeg'], [WEBP, 'image/webp']]) {
      const id = await create(as.owner, {}, { bytes, name: 'mynd.bin' });
      const file = eventRow(id).image_file;
      assert.match(file, /^[0-9a-f-]{36}\.(png|jpg|webp)$/);
      assert.ok(fs.existsSync(path.join(site.config.uploadDir, file)));
      assert.ok(!path.resolve(site.config.uploadDir).startsWith(path.join(ROOT_DIR, 'public')));
      const res = await fetch(`${site.baseUrl}/uploads/${file}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), type);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    }
    assert.equal((await fetch(`${site.baseUrl}/uploads/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${site.baseUrl}/uploads/not-a-uuid.png`)).status, 404);
  });

  test('BR-27: a file that is not an image, or an image over 2 MB, is refused', async () => {
    const before = uploads().length;
    const text = await as.owner.postForm('/teacher/events/new', fields(), { bytes: Buffer.from('<svg onload="x"></svg>'), name: 'mynd.png', type: 'image/png' });
    assert.equal(text.status, 400);
    assert.match(text.html, /Myndin verður að vera JPG, PNG eða WebP\./);
    const big = await as.owner.postForm('/teacher/events/new', fields(), { bytes: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]) });
    assert.equal(big.status, 400);
    assert.match(big.html, /Myndin er of stór\. Hámarkið er 2 MB\./);
    assert.equal(uploads().length, before);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM events').pluck().get(), 0);
  });

  test('BR-27: without an image the default image is shown; replacing or removing deletes the old file', async () => {
    const id = await create();
    await publish(id);
    assert.match((await as.guest.get(`/events/${id}`)).html, /<img class="event__image" src="\/img\/default-event\.svg" alt="Gönguferð">/);
    assert.equal((await fetch(`${site.baseUrl}/img/default-event.svg`)).status, 200);

    await as.owner.postForm(`/teacher/events/${id}/edit`, fields(), { bytes: PNG });
    const first = eventRow(id).image_file;
    assert.match((await as.guest.get(`/events/${id}`)).html, new RegExp(`src="/uploads/${first}" alt="Gönguferð"`));

    await as.owner.postForm(`/teacher/events/${id}/edit`, fields(), { bytes: JPG });
    const second = eventRow(id).image_file;
    assert.notEqual(second, first);
    assert.ok(uploads().includes(second));
    assert.ok(!uploads().includes(first), 'the replaced image is deleted');

    await as.owner.postForm(`/teacher/events/${id}/edit`, fields({ remove_image: '1' }));
    assert.equal(eventRow(id).image_file, null);
    assert.ok(!uploads().includes(second), 'the removed image is deleted');

    await as.owner.postForm(`/teacher/events/${id}/edit`, fields(), { bytes: WEBP });
    await as.owner.postForm(`/teacher/events/${id}/edit`, fields({ title_is: 'Nýtt heiti' }));
    assert.match(eventRow(id).image_file, /\.webp$/, 'saving without a new image keeps the current one');
  });
});

describe('editing and deleting (BR-28 to BR-30)', () => {
  beforeEach(() => site.db.exec('DELETE FROM events; DELETE FROM email_outbox; DELETE FROM audit_log'));

  test('BR-28: a published event can be edited, but the maximum cannot go below the sign-ups', async () => {
    const id = await create(as.owner, { capacity: '5' });
    await publish(id);
    register(id, people.student.id);
    register(id, people.student2.id);
    const tooLow = await as.owner.postForm(`/teacher/events/${id}/edit`, fields({ capacity: '1' }));
    assert.equal(tooLow.status, 400);
    assert.match(tooLow.html, /Hámarkið má ekki vera lægra en fjöldi skráðra/);
    const ok = await as.owner.postForm(`/teacher/events/${id}/edit`, fields({ capacity: '2', title_is: 'Breytt heiti' }));
    assert.equal(ok.location, `/teacher/events/${id}`);
    assert.deepEqual([eventRow(id).capacity, eventRow(id).title_is, eventRow(id).status], [2, 'Breytt heiti', 'published']);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM email_outbox').pluck().get(), 0, 'a new title emails nobody');
  });

  test('BR-28, BR-21: the save checks the sign-ups and the day again, in case they changed while the form was read', async () => {
    const id = await create(as.owner, { capacity: '5' });
    const event = getEvent(site.db, id); // read before the form, with 0 sign-ups
    const days = ['2027-03-11', '2027-03-12', '2027-03-20'];
    const { values, errors } = validateEvent(fields({ capacity: '1' }), { days, brautir: [], signups: event.signups });
    assert.deepEqual(errors, {});
    register(id, people.student.id); // two sign-ups land meanwhile
    register(id, people.student2.id);
    assert.deepEqual(updateEvent(site.db, event, values), { field: 'capacity', error: 'events.errors.capacityBelowSignups' });
    assert.equal(eventRow(id).capacity, 5);

    site.db.prepare('INSERT INTO saeludagar_days (day) VALUES (?)').run('2027-03-20');
    const later = validateEvent(fields({ event_date: '2027-03-20' }), { days, brautir: [] });
    site.db.prepare('DELETE FROM saeludagar_days WHERE day = ?').run('2027-03-20'); // the admin removes the day meanwhile
    assert.deepEqual(createEvent(site.db, people.owner.id, later.values, null), { field: 'event_date', error: 'events.errors.date' });
    assert.equal(site.db.prepare("SELECT COUNT(*) FROM events WHERE event_date = '2027-03-20'").pluck().get(), 0);
  });

  test('BR-28: changing the date, times or location emails every student signed up', async () => {
    const id = await create(as.owner, { title_en: 'Hike' });
    await publish(id);
    register(id, people.student.id);
    register(id, people.student2.id);
    await as.owner.postForm(`/teacher/events/${id}/edit`, fields({ title_en: 'Hike', event_date: '2027-03-12', location: 'Fjallið' }));
    const queued = site.db.prepare('SELECT kind, priority, user_id FROM email_outbox ORDER BY user_id').all();
    assert.deepEqual(queued, [
      { kind: 'event_changed', priority: 0, user_id: people.student.id },
      { kind: 'event_changed', priority: 0, user_id: people.student2.id },
    ]);
    const [email] = await site.sendEmails();
    assert.equal(email.subject, 'Breyting á viðburði: Gönguferð / Event changed: Hike');
    const is = email.text.indexOf('Breyting hefur orðið á viðburðinum Gönguferð sem þú skráðir þig á.');
    const en = email.text.indexOf('The event Hike that you signed up for has changed.');
    assert.ok(is >= 0 && en > is, 'Icelandic first, then English (BR-52)');
    assert.match(email.text, /Nú:\n {2}12\. mars 2027, kl\. 10:00–12:00\n {2}Fjallið\n\nÁður:\n {2}11\. mars 2027, kl\. 10:00–12:00\n {2}Íþróttahús/);
    assert.match(email.text, /Now:\n {2}12 March 2027, 10:00–12:00/);
    assert.match(email.text, new RegExp(`/events/${id}$`, 'm'));
  });

  test('BR-29: the owner deletes an event after confirming; students get an email and their sign-ups go', async () => {
    const id = await create(as.owner, {}, { bytes: PNG });
    await publish(id);
    register(id, people.student.id);
    const image = eventRow(id).image_file;

    const unconfirmed = await as.owner.post(`/teacher/events/${id}`, { action: 'delete' });
    assert.equal(unconfirmed.location, `/teacher/events/${id}`);
    assert.ok(eventRow(id));

    const res = await as.owner.post(`/teacher/events/${id}`, { action: 'delete', confirm: '1' });
    assert.equal(res.location, '/teacher');
    assert.match((await as.owner.get('/teacher')).html, /Viðburðinum var eytt: Gönguferð/);
    assert.equal(eventRow(id), undefined);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM registrations WHERE event_id = ?').pluck().get(id), 0);
    assert.ok(!uploads().includes(image), 'the image file is deleted');
    assert.deepEqual(site.db.prepare('SELECT actor_id, action, event_id, student_id FROM audit_log').all(), [
      { actor_id: people.owner.id, action: 'signup.delete', event_id: id, student_id: people.student.id },
    ]);
    const [email] = await site.sendEmails();
    assert.equal(email.subject, 'Viðburði aflýst: Gönguferð / Event cancelled: Gönguferð');
    assert.match(email.text, /hefur verið aflýst:\n\n {2}Gönguferð\n {2}11\. mars 2027, kl\. 10:00–12:00/);
  });

  test('BR-29: a co-teacher cannot delete; nobody can once attendance is marked; an admin can delete any event', async () => {
    const id = await create();
    site.db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(id, people.coteacher.id);
    assert.equal((await as.coteacher.post(`/teacher/events/${id}`, { action: 'delete', confirm: '1' })).status, 403);
    assert.doesNotMatch((await as.coteacher.get(`/teacher/events/${id}`)).html, /Eyða viðburði/);

    register(id, people.student.id, 1);
    const page = (await as.owner.get(`/teacher/events/${id}`)).html;
    assert.match(page, /Ekki er hægt að eyða viðburðinum því mæting hefur verið skráð\./);
    assert.match(page, /<button type="button" class="button button--secondary" disabled>Eyða viðburði<\/button>/);
    await as.owner.post(`/teacher/events/${id}`, { action: 'delete', confirm: '1' });
    assert.ok(eventRow(id), 'still there');

    site.db.prepare('UPDATE registrations SET attended = 0').run();
    const byAdmin = await as.admin.post(`/teacher/events/${id}`, { action: 'delete', confirm: '1' });
    assert.equal(byAdmin.location, '/teacher');
    assert.equal(eventRow(id), undefined);
  });

  test('BR-30: special and trip events follow the same rules as any other event', async () => {
    const trip = await create(as.owner, { title_is: 'Skíðaferð í Bláfjöll', fee_isk: '5000', capacity: '30' });
    assert.equal(eventRow(trip).status, 'draft');
    const offDay = await as.owner.postForm('/teacher/events/new', fields({ title_is: 'Sérviðburður', event_date: '2027-04-01' }));
    assert.equal(offDay.status, 400);
  });
});

describe('co-teachers and who manages what (§3, §6, §8)', () => {
  let id;

  before(async () => {
    site.db.exec('DELETE FROM events');
    id = await create(as.owner, { title_is: 'Sameiginlegur viðburður' });
    await create(as.other, { title_is: 'Viðburður annars' });
  });

  test('§6: the owner adds and removes co-teachers, chosen from the active teachers', async () => {
    const edit = (await as.owner.get(`/teacher/events/${id}/edit`)).html;
    const options = [...edit.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)].map((m) => m[2]);
    assert.ok(options.includes('Sara Samkennari') && options.includes('Anna Stjórnandi'));
    assert.ok(!options.includes('Óli Eigandi'), 'not the owner');
    assert.ok(!options.includes('Jóna Nemandi'), 'not students');

    const res = await as.owner.post(`/teacher/events/${id}`, { action: 'add-coteacher', teacher: String(people.coteacher.id) });
    assert.equal(res.location, `/teacher/events/${id}/edit#coteachers`);
    assert.match((await as.owner.get(`/teacher/events/${id}/edit`)).html, /Samkennara bætt við\./);
    assert.equal((await as.owner.post(`/teacher/events/${id}`, { action: 'add-coteacher', teacher: String(people.student.id) })).status, 303);
    assert.deepEqual(site.db.prepare('SELECT teacher_id FROM event_coteachers WHERE event_id = ?').pluck().all(id), [people.coteacher.id]);
  });

  test('§3: a co-teacher edits, previews and publishes, but cannot delete or manage co-teachers', async () => {
    assert.match((await as.coteacher.get('/teacher')).html, /Sameiginlegur viðburður/, 'on the co-teacher\'s home page');
    const edit = await as.coteacher.get(`/teacher/events/${id}/edit`);
    assert.equal(edit.status, 200);
    assert.doesNotMatch(edit.html, /id="coteachers"/);
    assert.equal((await as.coteacher.postForm(`/teacher/events/${id}/edit`, fields({ title_is: 'Sameiginlegur viðburður', location: 'Salur' }))).location, `/teacher/events/${id}`);
    assert.equal((await as.coteacher.get(`/teacher/events/${id}/preview`)).status, 200);
    await publish(id, as.coteacher);
    assert.equal(eventRow(id).status, 'published');
    for (const action of ['add-coteacher', 'remove-coteacher']) {
      const res = await as.coteacher.post(`/teacher/events/${id}`, { action, teacher: String(people.other.id) });
      assert.equal(res.status, 403, action);
    }
  });

  test('§8: other teachers cannot see or change the event; students and guests cannot open teacher pages', async () => {
    for (const url of ['', '/edit', '/preview', '/attendance', '/print', '/message']) {
      assert.equal((await as.other.get(`/teacher/events/${id}${url}`)).status, 403, url);
    }
    assert.equal((await as.other.postForm(`/teacher/events/${id}/edit`, fields({ title_is: 'Stolið' }))).status, 403);
    assert.equal(eventRow(id).title_is, 'Sameiginlegur viðburður');
    assert.doesNotMatch((await as.other.get('/teacher')).html, /Sameiginlegur viðburður/);
    assert.equal((await as.student.get(`/teacher/events/${id}`)).status, 403);
    assert.equal((await as.guest.get(`/teacher/events/${id}`)).location, '/login');
    assert.equal((await as.owner.get('/teacher/events/99999')).status, 404);
  });

  test('§6: the admin manages every event and sees them all on Allir viðburðir', async () => {
    const page = (await as.admin.get('/admin/events')).html;
    assert.match(page, /Sameiginlegur viðburður<\/a><\/td>\s*<td>Óli Eigandi<\/td>/);
    assert.match(page, /Viðburður annars<\/a><\/td>\s*<td>Gunnar Annar<\/td>/);
    assert.match(page, /<td>Birtur<\/td>/);
    assert.match(page, /<td>Drög<\/td>/);
    assert.equal((await as.admin.get(`/teacher/events/${id}/edit`)).status, 200);
    assert.match((await as.admin.get(`/teacher/events/${id}/edit`)).html, /id="coteachers"/);
    await as.admin.post(`/teacher/events/${id}`, { action: 'remove-coteacher', teacher: String(people.coteacher.id) });
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM event_coteachers WHERE event_id = ?').pluck().get(id), 0);
    assert.equal((await as.coteacher.get(`/teacher/events/${id}`)).status, 403, 'removed co-teachers lose access');
  });
});
