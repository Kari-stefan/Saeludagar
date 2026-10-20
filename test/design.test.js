import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { normalizeKennitala } from '../src/services/crypto.js';
import { browseEvents, excerpt, searchTerm, sortOrder } from '../src/services/events.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;

// Card titles in page order, whatever their heading level.
const titles = (html) => [...html.matchAll(/<h(\d) class="event-card__title">([^<]+)<\/h\1>/g)].map((m) => m[2]);
// A student's front page split into its two sections (BR-64).
const sections = (html) => {
  const mine = html.indexOf('id="mine-events"');
  const others = html.indexOf('id="other-events"');
  assert.ok(mine > 0 && others > mine, 'Þínir viðburðir comes before Aðrir viðburðir');
  return { mine: html.slice(mine, others), others: html.slice(others) };
};

describe('search and sort (BR-63)', () => {
  // Plain objects, as publishedEvents returns them.
  const events = [
    { id: 1, title_is: 'Gönguferð', title_en: 'A walk', event_date: '2027-03-11', start_time: '10:00', fee_isk: 0 },
    { id: 2, title_is: 'Bíóferð', title_en: 'Cinema trip', event_date: '2027-03-11', start_time: '13:00', fee_isk: 1500 },
    { id: 3, title_is: 'Ástarbréf', title_en: null, event_date: '2027-03-12', start_time: '09:00', fee_isk: 500 },
    { id: 4, title_is: 'Ökuskóli', title_en: null, event_date: '2027-03-12', start_time: '11:00', fee_isk: 2500 },
    { id: 5, title_is: 'Andlitsmálun', title_en: null, event_date: '2027-03-12', start_time: '13:00', fee_isk: 500 },
  ];
  const ids = (options) => browseEvents(events, options).map((event) => event.id);

  test('BR-63: the search matches the Icelandic or English title, ignoring case', () => {
    assert.deepEqual(ids({ search: 'GÖNGU' }), [1]);
    assert.deepEqual(ids({ search: 'cinema' }), [2], 'an English title is found from the Icelandic page');
    assert.deepEqual(ids({ search: 'ferð' }), [1, 2]);
    assert.deepEqual(ids({ search: 'ekkert slíkt' }), []);
    assert.deepEqual(ids({}), [1, 2, 3, 4, 5]);
  });

  test('BR-63: the six sort orders, with ties kept in date and time order', () => {
    assert.deepEqual(ids({ sort: 'date' }), [1, 2, 3, 4, 5]);
    assert.deepEqual(ids({ sort: 'date-desc' }), [5, 4, 3, 2, 1]);
    assert.deepEqual(ids({ sort: 'fee' }), [1, 3, 5, 2, 4]);
    assert.deepEqual(ids({ sort: 'fee-desc' }), [4, 2, 3, 5, 1]);
    assert.deepEqual(ids({ sort: 'name' }), [5, 3, 2, 1, 4], 'Icelandic order: A, Á, B, G, Ö');
    assert.deepEqual(ids({ sort: 'name-desc' }), [4, 1, 2, 3, 5]);
  });

  test('BR-63, BR-60: in English, names sort by the English title where there is one', () => {
    assert.deepEqual(ids({ sort: 'name', lang: 'en' }), [1, 5, 3, 2, 4], 'A walk, Andlitsmálun, Ástarbréf, Cinema trip, Ökuskóli');
  });

  test('BR-63: the query values are checked: text only, at most 100 characters, and a known order', () => {
    assert.equal(searchTerm('  ferð  '), 'ferð');
    assert.equal(searchTerm(['a', 'b']), '');
    assert.equal(searchTerm(undefined), '');
    assert.equal(searchTerm('x'.repeat(500)).length, 100);
    assert.equal(sortOrder('fee-desc'), 'fee-desc');
    assert.equal(sortOrder('DROP TABLE'), 'date');
    assert.equal(sortOrder(undefined), 'date');
  });

  test('§6: a card shows a short description, cut at a word', () => {
    assert.equal(excerpt('Stutt lýsing.'), 'Stutt lýsing.');
    assert.equal(excerpt('Fyrsta lína.\n\nÖnnur lína.'), 'Fyrsta lína. Önnur lína.');
    const long = excerpt(`${'orð '.repeat(60)}endir`);
    assert.ok(long.length <= 141, long);
    assert.match(long, /orð…$/);
  });
});

describe('the front page and the new pages (BR-62 to BR-64, §6)', () => {
  let site;
  let teacher;
  const students = {};
  const as = {};
  const ev = {};

  before(async () => {
    site = await startSite();
    teacher = await site.addUser({ name: 'Kennari' });
    as.teacher = site.browser();
    await as.teacher.login(teacher.kennitala, teacher.code);
    for (const key of ['jona', 'sara']) {
      students[key] = await site.addUser({ role: 'student', name: `Nemandi ${key}` });
      site.db.prepare('UPDATE users SET braut = ? WHERE id = ?').run('Rafmagnsbraut', students[key].id);
      as[key] = site.browser();
      await as[key].login(students[key].kennitala, students[key].code);
    }
    as.guest = site.browser();
    const event = (fields) => insertEvent(site.db, teacher.id, fields);
    ev.walk = event({ title_is: 'Gönguferð', title_en: 'A walk', start_time: '10:00', end_time: '12:00' });
    ev.cinema = event({ title_is: 'Bíóferð', start_time: '13:00', end_time: '15:00', fee_isk: 1500, brautir: ['Rafmagnsbraut'] });
    ev.letters = event({ title_is: 'Ástarbréf', event_date: '2027-03-12', start_time: '09:00', end_time: '10:00', fee_isk: 500 });
    ev.driving = event({ title_is: 'Ökuskóli', event_date: '2027-03-12', start_time: '11:00', end_time: '12:00', fee_isk: 2500, brautir: ['Starfsbraut'] });
    ev.faces = event({ title_is: 'Andlitsmálun', event_date: '2027-03-12', start_time: '13:00', end_time: '14:00', fee_isk: 500 });
    event({ title_is: 'Óbirt drög', status: 'draft' });
  });

  after(() => site.close());

  beforeEach(() => {
    site.db.exec('DELETE FROM registrations');
    const at = (ms) => toIso(new Date(Date.now() + ms));
    site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?').run(at(-HOUR), at(HOUR));
  });

  const register = (studentId, ...eventIds) => {
    for (const eventId of eventIds) {
      site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(eventId, studentId, toIso());
    }
  };

  test('BR-63: a guest searches by name; empty days are hidden, and the page says when nothing matches', async () => {
    const found = (await as.guest.get('/?q=ferð')).html;
    assert.deepEqual(titles(found), ['Gönguferð', 'Bíóferð']);
    assert.match(found, /<h2 id="day-2027-03-11">/);
    assert.doesNotMatch(found, /id="day-2027-03-12"/, 'a day with no match is left out');
    assert.match(found, /<input class="field__input browse__search" id="events-search" type="search" name="q" value="ferð"/);
    const none = (await as.guest.get('/?q=ekkert')).html;
    assert.deepEqual(titles(none), []);
    assert.match(none, /Enginn viðburður passar við leitina\./);
    assert.doesNotMatch(none, /Óbirt drög/);
  });

  test('BR-63: sorted by date the events are grouped by day; any other order is one list', async () => {
    const byDate = (await as.guest.get('/')).html;
    assert.match(byDate, /<h2 id="day-2027-03-11">[\s\S]*Gönguferð[\s\S]*Bíóferð[\s\S]*<h2 id="day-2027-03-12">[\s\S]*Ástarbréf/);
    const latest = (await as.guest.get('/?sort=date-desc')).html;
    assert.deepEqual(titles(latest), ['Andlitsmálun', 'Ökuskóli', 'Ástarbréf', 'Bíóferð', 'Gönguferð']);
    assert.ok(latest.indexOf('id="day-2027-03-12"') < latest.indexOf('id="day-2027-03-11"'));
    const byFee = (await as.guest.get('/?sort=fee')).html;
    assert.deepEqual(titles(byFee), ['Gönguferð', 'Ástarbréf', 'Andlitsmálun', 'Bíóferð', 'Ökuskóli']);
    assert.doesNotMatch(byFee, /id="day-/);
    assert.deepEqual(titles((await as.guest.get('/?sort=name-desc')).html), ['Ökuskóli', 'Gönguferð', 'Bíóferð', 'Ástarbréf', 'Andlitsmálun']);
  });

  test('BR-63: search, sort and the braut filter work together, and the form keeps all three', async () => {
    const html = (await as.guest.get('/?q=ferð&sort=name-desc&braut=Rafmagnsbraut')).html;
    assert.deepEqual(titles(html), ['Gönguferð', 'Bíóferð'], 'the braut\'s events and those for everyone, matching "ferð"');
    assert.match(html, /name="q" value="ferð"/);
    assert.match(html, /<input type="radio" name="sort" value="name-desc" checked>/);
    assert.match(html, /<option value="Rafmagnsbraut" selected>Rafmagnsbraut<\/option>/);
    assert.match(html, /<p class="browse__active">Leit: „ferð“ · Röðun: Nafn, Ö til A · Braut: Rafmagnsbraut <a href="\/">Hreinsa<\/a><\/p>/);
    const sortOnly = (await as.guest.get('/?sort=fee')).html;
    assert.match(sortOnly, /<p class="browse__active">Röðun: Verð, lægst fyrst <a href="\/">Hreinsa<\/a><\/p>/);
    assert.doesNotMatch((await as.guest.get('/')).html, /browse__active/, 'no summary when nothing is chosen');
  });

  test('BR-63: unknown or repeated query values are ignored', async () => {
    const html = (await as.guest.get('/?q=a&q=b&sort=DROP&braut=Engin')).html;
    assert.deepEqual(titles(html), ['Gönguferð', 'Bíóferð', 'Ástarbréf', 'Ökuskóli', 'Andlitsmálun']);
    assert.match(html, /<input type="radio" name="sort" value="date" checked>/);
  });

  test('BR-63, BR-60: in English the controls are translated and names sort by the English title', async () => {
    const english = site.browser();
    await english.post('/language', { lang: 'en', returnTo: '/' });
    const html = (await english.get('/?sort=name')).html;
    assert.deepEqual(titles(html), ['A walk', 'Andlitsmálun', 'Ástarbréf', 'Bíóferð', 'Ökuskóli']);
    assert.match(html, />Search<\/button>/);
    assert.match(html, />Filter<\/summary>/);
    assert.match(html, /Name, A to Z/);
  });

  test('BR-64: a student sees Þínir viðburðir above Aðrir viðburðir, and signing up or cancelling moves the event', async () => {
    let page = sections((await as.jona.get('/')).html);
    assert.deepEqual(titles(page.mine), []);
    assert.ok(titles(page.others).includes('Gönguferð'));

    assert.equal((await as.jona.post(`/events/${ev.walk}`, { action: 'signup' })).status, 303);
    page = sections((await as.jona.get('/')).html);
    assert.deepEqual(titles(page.mine), ['Gönguferð']);
    assert.ok(!titles(page.others).includes('Gönguferð'), 'not in both lists');

    assert.equal((await as.jona.post(`/events/${ev.walk}`, { action: 'cancel' })).status, 303);
    page = sections((await as.jona.get('/')).html);
    assert.deepEqual(titles(page.mine), []);
    assert.ok(titles(page.others).includes('Gönguferð'));
  });

  test('BR-64: with no sign-ups the student is told so and pointed to the other events', async () => {
    const { mine } = sections((await as.sara.get('/')).html);
    assert.match(mine, /<h2 id="mine-heading">Þínir viðburðir<\/h2>/);
    assert.match(mine, /Þú hefur ekki skráð þig á neina viðburði ennþá\./);
    assert.match(mine, /<a class="button button--secondary" href="#other-events">Skoða aðra viðburði<\/a>/);
    assert.doesNotMatch(mine, /id="mine-search"/, 'no search for an empty list');
  });

  test('BR-64: own events sort by date and time by default, and each list has its own search and sort', async () => {
    register(students.jona.id, ev.letters, ev.cinema, ev.walk);
    let page = sections((await as.jona.get('/')).html);
    assert.deepEqual(titles(page.mine), ['Gönguferð', 'Bíóferð', 'Ástarbréf']);
    assert.deepEqual(titles(page.others), ['Ökuskóli', 'Andlitsmálun']);

    page = sections((await as.jona.get('/?msort=name')).html);
    assert.deepEqual(titles(page.mine), ['Ástarbréf', 'Bíóferð', 'Gönguferð']);
    assert.deepEqual(titles(page.others), ['Ökuskóli', 'Andlitsmálun'], 'the other list keeps its order');

    page = sections((await as.jona.get('/?mq=bíó&q=öku&sort=fee-desc')).html);
    assert.deepEqual(titles(page.mine), ['Bíóferð']);
    assert.deepEqual(titles(page.others), ['Ökuskóli']);
    // Each form carries the other list's choices, so using one keeps the other.
    assert.match(page.mine, /<form class="browse" method="get" action="\/#mine-events"[^>]*>\s*<input type="hidden" name="q" value="öku">\s*<input type="hidden" name="sort" value="fee-desc">/);
    assert.match(page.others, /<form class="browse" method="get" action="\/#other-events"[^>]*>\s*<input type="hidden" name="mq" value="bíó">/);
    assert.match(page.mine, /<a href="\/\?q=%C3%B6ku&amp;sort=fee-desc#mine-events">Hreinsa<\/a>/);
    assert.match(page.others, /<a href="\/\?mq=b%C3%AD%C3%B3#other-events">Hreinsa<\/a>/);

    const empty = sections((await as.jona.get('/?mq=ekkert')).html);
    assert.match(empty.mine, /Enginn viðburður passar við leitina\./);
  });

  test('BR-64: teachers and guests see one list, without the two sections', async () => {
    for (const browser of [as.teacher, as.guest]) {
      const html = (await browser.get('/')).html;
      assert.doesNotMatch(html, /id="mine-events"|Þínir viðburðir/);
      assert.equal(titles(html).length, 5);
    }
  });

  test('BR-62: the light/dark choice is kept in the session, through login and logout, with no new cookie', async () => {
    const browser = site.browser();
    let html = (await browser.get('/')).html;
    assert.match(html, /<html lang="is">/, 'no choice: no data-theme');
    assert.match(html, /name="theme" value="light" aria-pressed="true"/, 'light mode by default');
    assert.match(html, /name="theme" value="dark" aria-pressed="false"/);

    const res = await browser.post('/theme', { theme: 'dark', returnTo: '/info' });
    assert.deepEqual([res.status, res.location], [303, '/info']);
    html = (await browser.get('/info')).html;
    assert.match(html, /<html lang="is" data-theme="dark">/);
    assert.match(html, /name="theme" value="dark" aria-pressed="true"/);
    assert.match(html, /name="theme" value="light" aria-pressed="false"/);

    await browser.post('/theme', { theme: 'blue', returnTo: '/' });
    assert.match((await browser.get('/')).html, /data-theme="dark"/, 'an unknown value changes nothing');

    await browser.login(students.sara.kennitala, students.sara.code);
    assert.match((await browser.get('/')).html, /<html lang="is" data-theme="dark">/, 'kept through login');
    await browser.post('/theme', { theme: 'light', returnTo: '/' });
    await browser.post('/logout');
    assert.match((await browser.get('/')).html, /<html lang="is" data-theme="light">/, 'kept through logout');
    assert.deepEqual([...browser.cookies.keys()], ['sid'], 'BR-57: still only the session cookie');
  });

  test('BR-62: the theme switch needs the CSRF token and returns only to this site', async () => {
    const browser = site.browser();
    await browser.get('/');
    const noToken = await browser.request('POST', '/theme', { theme: 'dark', returnTo: '/' });
    assert.equal(noToken.status, 403);
    const offSite = await browser.post('/theme', { theme: 'dark', returnTo: 'https://example.com/' });
    assert.equal(offSite.location, '/');
  });

  test('§6: the header has the logo, the links in the bar and in the drawer, and marks the current page', async () => {
    const html = (await as.jona.get('/info')).html;
    assert.match(html, /<a class="site-logo" href="\/"><img src="\/img\/logo.svg" alt="Merki skólans – heimasíða"/);
    assert.match(html, /<a class="site-title" href="\/">Sæludagar<span class="visually-hidden"> – <\/span><span class="site-title__school">Prófunarskóli<\/span><\/a>/);
    assert.equal(html.match(/<a class="nav-links__link" href="\/info" aria-current="page">Upplýsingar<\/a>/g).length, 2, 'bar and drawer');
    assert.equal(html.match(/<a class="nav-links__link" href="\/">Heimasíða<\/a>/g).length, 2);
    assert.equal(html.match(/href="\/my-events">Mínir viðburðir</g).length, 2);
    assert.equal(html.match(/<span>Skráð inn: Nemandi jona<\/span>/g).length, 2);
    assert.match(html, /<details class="menu">\s*<summary class="menu__toggle">[\s\S]*Opna valmynd[\s\S]*Loka valmynd[\s\S]*<\/summary>/);
    assert.match(html, /<script src="\/js\/menu.js" defer><\/script>/);
    const guest = (await as.guest.get('/')).html;
    assert.match(guest, /<a class="nav-links__link" href="\/" aria-current="page">Heimasíða<\/a>/);
    assert.match(guest, /<a class="button button--small" href="\/login">Innskráning<\/a>/);
  });

  test('§6: the logo and the menu script are served from the site, and the logo holds no script', async () => {
    const logo = await fetch(`${site.baseUrl}/img/logo.svg`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get('content-type'), /^image\/svg\+xml/);
    const svg = await logo.text();
    assert.doesNotMatch(svg, /<script|\son\w+=|<foreignObject|href="(?!#)/i);
    assert.equal((await fetch(`${site.baseUrl}/js/menu.js`)).status, 200);
  });

  test('§6: Upplýsingar explains the site with the current dates, in both languages', async () => {
    site.db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?, choice_deadline_at = ?')
      .run('2027-02-15T12:00:00Z', '2027-03-08T16:00:00Z', '2027-03-20T16:00:00Z');
    const html = (await as.guest.get('/info')).html;
    assert.match(html, /<h1>Upplýsingar<\/h1>/);
    assert.match(html, /<dd>11\. mars 2027, 12\. mars 2027<\/dd>/);
    assert.match(html, /<dd>15\. febrúar 2027, kl\. 12:00<\/dd>/);
    assert.match(html, /allt að 4 viðburði/);
    assert.match(html, /gildir sem 4 stig í einum áfanga\. Hægt er að fá að hámarki 4 stig dregin frá í hverjum áfanga, í allt að 4 áföngum \(samtals 16 stig\)\./);
    assert.match(html, /<p class="placeholder">/, 'contact details are a marked placeholder');
    assert.doesNotMatch(html, /atburð/i);
    const english = site.browser();
    await english.post('/language', { lang: 'en', returnTo: '/info' });
    const en = (await english.get('/info')).html;
    assert.match(en, /<h1>Information<\/h1>/);
    assert.match(en, /up to 4 events/);
    assert.match(en, /<dd>15 February 2027, 12:00<\/dd>/);
  });

  test('§6: the login pages have a back link, and the browser checks the format before sending', async () => {
    const login = (await as.guest.get('/login')).html;
    assert.match(login, /<a class="back-link" href="\/">[\s\S]*Til baka á heimasíðu<\/a>/);
    assert.match(login, /<div class="auth__box">/);
    assert.match(login, /name="kennitala"[^>]* required pattern="\\s\*\\d\{6\}-\?\\d\{4\}\\s\*"/);
    assert.match(login, /name="code"[^>]* required pattern="\\s\*\\d\{6\}\\s\*"/);
    assert.doesNotMatch(login, /Nýskrá/, 'no self-registration (DES decision)');
    const newCode = (await as.guest.get('/login/new-code')).html;
    assert.match(newCode, /<a class="back-link" href="\/login">[\s\S]*Aftur í innskráningu<\/a>/);
    // The page's pattern accepts exactly what the server accepts (a browser anchors it as ^(?:…)$).
    const pattern = new RegExp(`^(?:${/name="kennitala"[^>]* pattern="([^"]+)"/.exec(login)[1]})$`, 'v');
    for (const kennitala of ['0000000101', '000000-0101', ' 0000000101 ', '00000-00101', '000000--0101', '00000001', 'abcdefghij']) {
      assert.equal(pattern.test(kennitala), normalizeKennitala(kennitala) !== null, kennitala);
    }
  });

  test('BR-61: the new pages say "viðburður", never "atburður"', async () => {
    register(students.jona.id, ev.walk);
    for (const [browser, url] of [[as.guest, '/'], [as.guest, '/info'], [as.guest, '/login'], [as.jona, '/'], [as.sara, '/']]) {
      assert.doesNotMatch((await browser.get(url)).html, /atburð/i, url);
    }
  });
});
