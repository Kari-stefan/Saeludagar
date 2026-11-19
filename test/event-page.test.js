// Milestone M6c: the event page's two columns, "Viðburðastjóri" and "Hópur" (BR-23, BR-68).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;
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
  await add('owner', { name: 'Olga Eigandi', email: 'olga@example.is' });
  await add('coteacher', { name: 'Karl Meðstjóri', email: 'karl@example.is' });
  await add('other', { name: 'Anna Annar', email: 'anna@example.is' });
  await add('admin', { name: 'Stefán Stjórnandi', email: 'stefan@example.is', isAdmin: true });
  await add('jona', { role: 'student', name: 'Jóna Nemandi', email: 'jona@example.is' });
  await add('sara', { role: 'student', name: 'Sara Nemandi', email: 'sara@example.is' });
  // A student whom an admin has made an event manager (BR-67).
  await add('runar', { role: 'student', name: 'Rúnar Nemandastjóri', email: 'runar@example.is' });
  site.db.prepare('UPDATE users SET is_event_manager = 1 WHERE id = ?').run(people.runar.id);
  as.guest = site.browser();
  const at = (ms) => toIso(new Date(Date.now() + ms));
  site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?').run(at(-HOUR), at(HOUR));
});

after(() => site.close());

beforeEach(() => site.db.exec('DELETE FROM registrations; DELETE FROM events'));

const register = (eventId, key) => site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)')
  .run(eventId, people[key].id, toIso());
const page = async (browser, id) => (await browser.get(`/events/${id}`)).html;
const box = (html, heading) => new RegExp(`<section class="event-box" aria-labelledby="${heading}-heading">[\\s\\S]*?</section>`).exec(html)?.[0];

describe('the event page (§6)', () => {
  test('§6: the images and description are in one column, and the sign-up box, "Viðburðastjóri" and "Hópur" in the other', async () => {
    const id = insertEvent(site.db, people.owner.id, { title_is: 'Skíðaferð', description_is: 'Fyrsta lína.\nÖnnur lína.' });
    const html = await page(as.jona, id);
    const article = /<article class="event">[\s\S]*<\/article>/.exec(html)[0];
    // In this order: the title and facts, then the two columns.
    assert.match(article, /<h1>Skíðaferð<\/h1>\s*<dl class="facts">[\s\S]*<\/dl>\s*<div class="event__columns">\s*<div class="event__main">/);
    const [main, side] = article.split('<div class="event__side">');
    assert.match(main, /class="event-box gallery"[\s\S]*<h2 id="description-heading">Lýsing<\/h2>\s*<div class="event__description">Fyrsta lína\.\nÖnnur lína\.<\/div>/);
    assert.doesNotMatch(main, /signup-heading|manager-heading|group-heading/);
    // "Hópur" comes directly after "Viðburðastjóri", which is what stacks them that way on a phone.
    assert.match(side, /<h2 id="signup-heading">Skráning<\/h2>[\s\S]*<h2 id="manager-heading">Viðburðastjóri<\/h2>[\s\S]*?<\/section>\s*<section class="event-box" aria-labelledby="group-heading">\s*<h2 id="group-heading">Hópur<\/h2>/);
    // A teacher has no sign-up box, so the column starts with "Viðburðastjóri".
    assert.match((await page(as.other, id)).split('<div class="event__side">')[1], /^\s*<section class="event-box" aria-labelledby="manager-heading">/);
  });

  test('§6: the page is in English for an English session, with the Icelandic title where there is no English one', async () => {
    const id = insertEvent(site.db, people.owner.id, { title_is: 'Skíðaferð' });
    const english = site.browser();
    await english.post('/language', { lang: 'en', returnTo: '/' });
    const html = await page(english, id);
    for (const text of ['Description', 'Event Manager', 'Group', 'Log in to see the email address.', 'Only the people who run the event can see who has signed up.']) {
      assert.ok(html.includes(text), text);
    }
  });
});

describe('"Viðburðastjóri" (BR-68)', () => {
  test('BR-68: the owner is named to everyone, and their email is shown to logged-in users only', async () => {
    const id = insertEvent(site.db, people.owner.id);
    const guest = box(await page(as.guest, id), 'manager');
    assert.match(guest, /<p class="people__name">Olga Eigandi<\/p>\s*<p class="field__hint">Skráðu þig inn til að sjá netfangið\.<\/p>/);
    assert.doesNotMatch(await page(as.guest, id), /olga@example\.is/);
    for (const key of ['jona', 'other', 'admin']) {
      assert.match(box(await page(as[key], id), 'manager'),
        /<p class="people__name">Olga Eigandi<\/p>\s*<p><a href="mailto:olga@example\.is">olga@example\.is<\/a><\/p>/, key);
    }
  });

  test('BR-68, BR-23: a student who runs an event is not named to other students or guests, who see the host instead', async () => {
    const id = insertEvent(site.db, people.runar.id, { host: 'Nemendafélagið' });
    site.db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(id, people.coteacher.id);
    for (const key of ['guest', 'jona', 'other']) {
      const html = await page(as[key], id);
      assert.match(box(html, 'manager'), /<h2 id="manager-heading">Viðburðastjóri<\/h2>\s*<p class="people__name">Nemendafélagið<\/p>\s*<\/section>/, key);
      assert.doesNotMatch(html, /Rúnar Nemandastjóri|runar@example\.is/, `${key} is not told who the student is`);
    }
    // The student himself, the event's co-teacher and an admin manage the event, so they are told.
    for (const key of ['runar', 'coteacher', 'admin']) {
      assert.match(box(await page(as[key], id), 'manager'), /Rúnar Nemandastjóri<\/p>\s*<p><a href="mailto:runar@example\.is">/, key);
    }
  });
});

describe('"Hópur" (BR-23, BR-68)', () => {
  test('BR-68: the owner, a co-teacher and an admin see the participants by name and email, in Icelandic order', async () => {
    const id = insertEvent(site.db, people.owner.id);
    site.db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(id, people.coteacher.id);
    register(id, 'sara');
    register(id, 'jona');
    for (const key of ['owner', 'coteacher', 'admin']) {
      const group = box(await page(as[key], id), 'group');
      assert.match(group, /<p>2 \/ 10 skráðir<\/p>/, key);
      assert.deepEqual([...group.matchAll(/<span class="people__name">([^<]+)<\/span>\s*<a href="mailto:([^"]+)">\2<\/a>/g)].map((m) => [m[1], m[2]]), [
        ['Jóna Nemandi', 'jona@example.is'], ['Sara Nemandi', 'sara@example.is'],
      ], key);
      assert.doesNotMatch(group, /Aðeins þau sem sjá um viðburðinn/, key);
    }
  });

  test('BR-23, BR-68: everyone else sees only how many are signed up: guests, students (also one who is signed up) and other teachers', async () => {
    const id = insertEvent(site.db, people.owner.id);
    register(id, 'sara');
    register(id, 'jona');
    for (const key of ['guest', 'jona', 'runar', 'other']) {
      const html = await page(as[key], id);
      assert.match(box(html, 'group'), /<h2 id="group-heading">Hópur<\/h2>\s*<p>2 \/ 10 skráðir<\/p>\s*<p class="field__hint">Aðeins þau sem sjá um viðburðinn sjá hverjir eru skráðir\.<\/p>\s*<\/section>/, key);
      // Jóna's own name is in her header, so the check is on the other participant.
      assert.doesNotMatch(html, /Sara Nemandi|sara@example\.is/, `${key} does not see another participant`);
    }
  });

  test('BR-68: with nobody signed up, those who manage the event are told so', async () => {
    const id = insertEvent(site.db, people.owner.id);
    assert.match(box(await page(as.owner, id), 'group'), /<p>0 \/ 10 skráðir<\/p>\s*<p class="empty">Enginn hefur skráð sig enn\.<\/p>/);
  });

  test('BR-22, BR-68: the preview shows the page as a student sees it: the owner with email, and only the count in "Hópur"', async () => {
    const id = insertEvent(site.db, people.owner.id, { status: 'draft' });
    register(id, 'sara');
    const html = (await as.owner.get(`/teacher/events/${id}/preview`)).html;
    assert.match(box(html, 'manager'), /Olga Eigandi<\/p>\s*<p><a href="mailto:olga@example\.is">/);
    assert.match(box(html, 'group'), /<p>1 \/ 10 skráðir<\/p>\s*<p class="field__hint">Aðeins þau sem sjá um viðburðinn/);
    assert.doesNotMatch(html, /Sara Nemandi|sara@example\.is/);
  });

  test('§9 item 5: names, emails, the host and the description are escaped', async () => {
    const id = insertEvent(site.db, people.owner.id, { host: '<b>Gestgjafi</b>', description_is: '<script>alert(1)</script>' });
    site.db.prepare("UPDATE users SET name = '<i>Sara</i>' WHERE id = ?").run(people.sara.id);
    register(id, 'sara');
    try {
      const html = await page(as.owner, id);
      assert.doesNotMatch(html, /<i>Sara<\/i>|<b>Gestgjafi<\/b>|<script>alert/);
      assert.match(html, /&lt;i&gt;Sara&lt;\/i&gt;/);
    } finally {
      site.db.prepare("UPDATE users SET name = 'Sara Nemandi' WHERE id = ?").run(people.sara.id);
    }
  });
});

describe('the address of an event (§6)', () => {
  test('§6: only a plain event number opens an event; any other address is a 404', async () => {
    const id = insertEvent(site.db, people.owner.id);
    assert.equal((await as.guest.get(`/events/${id}`)).status, 200);
    assert.equal((await as.owner.get(`/teacher/events/${id}`)).status, 200);
    const spellings = [`0x${id.toString(16)}`, `${id}e0`, `${id}.0`, `%20${id}`, `${id}%20`, `+${id}`, `-${id}`, `0${id}`, 'abc'];
    for (const spelling of spellings) {
      for (const path of [`/events/${spelling}`, `/teacher/events/${spelling}`, `/teacher/events/${spelling}/print`]) {
        assert.equal((await as.owner.get(path)).status, 404, path);
      }
    }
  });
});
