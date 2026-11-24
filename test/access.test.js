import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { insertEvent, startSite } from './helpers.js';

describe('role guards (AGENT_START §8, §9 item 8)', () => {
  let site;
  const browsers = {};

  before(async () => {
    site = await startSite();
    const accounts = {
      student: await site.addUser({ role: 'student' }),
      teacher: await site.addUser(),
      admin: await site.addUser({ isAdmin: true }),
    };
    insertEvent(site.db, accounts.teacher.id); // event 1, owned by the teacher
    browsers.guest = site.browser();
    for (const [role, account] of Object.entries(accounts)) {
      browsers[role] = site.browser();
      await browsers[role].login(account.kennitala, account.code);
    }
  });

  after(() => site.close());

  // [path, guest, student, teacher, admin]
  const expected = [
    ['/', 200, 200, 200, 200],
    ['/info', 200, 200, 200, 200],
    ['/events/1', 200, 200, 200, 200],
    ['/my-events', '/login', '/#mine-events', 403, 403],
    ['/teacher', '/login', 403, '/#managed-events', '/#managed-events'],
    ['/teacher/events/new', '/login', 403, 200, 200],
    ['/teacher/events/1/attendance', '/login', 403, 200, 200],
    ['/admin', '/login', 403, 403, 200],
    ['/admin/teachers', '/login', 403, 403, 200],
    ['/admin/export.csv', '/login', 403, 403, 200],
    ['/admin/no-such-page', '/login', 403, 403, 404],
  ];

  test('§8: guests are sent to log in, and other roles get 403', async () => {
    for (const [path, ...results] of expected) {
      for (const [index, role] of ['guest', 'student', 'teacher', 'admin'].entries()) {
        const res = await browsers[role].get(path);
        const want = results[index];
        if (typeof want === 'string') {
          assert.deepEqual([res.status, res.location], [303, want], `${role} ${path}`);
        } else {
          assert.equal(res.status, want, `${role} ${path}`);
        }
        if (want === 403) assert.match(res.html, /Aðgangur ekki leyfður/);
      }
    }
  });

  test('§8: admin actions are checked on the server, not only hidden in the page', async () => {
    const student = await site.addUser({ role: 'student', name: 'Nemo Nemandi' });
    const before = site.db.prepare('SELECT COUNT(*) FROM users').pluck().get();
    const managerId = site.db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').pluck().get('teacher');
    for (const role of ['student', 'teacher']) {
      const browser = browsers[role];
      assert.equal((await browser.post('/admin/teachers', {
        action: 'create', name: 'Laumu Kennari', email: 'laumu@example.is', kennitala: '0000000901',
      })).status, 403, `${role} create`);
      assert.equal((await browser.post('/admin/teachers', {
        action: 'promote-event-manager', id: String(student.id),
      })).status, 403, `${role} promote`);
      assert.equal((await browser.post('/admin/teachers', {
        action: 'revoke-event-manager', id: String(managerId),
      })).status, 403, `${role} revoke`);
    }
    const guest = await browsers.guest.post('/admin/teachers', { action: 'create' });
    assert.equal(guest.status, 303);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM users').pluck().get(), before);
  });
});

describe('CSRF protection (AGENT_START §8, §9 item 3)', () => {
  let site;

  before(async () => {
    site = await startSite();
  });

  after(() => site.close());

  test('BR-70, §9 item 3: a POST without the session\'s token gets the 403 "form expired" page, also a logged-in user\'s language switch', async () => {
    const user = await site.addUser();
    const browser = site.browser();
    await browser.login(user.kennitala, user.code);
    const token = await browser.csrfToken();
    const attempts = [
      {},
      { _csrf: '' },
      { _csrf: 'x'.repeat(token.length) },
      { _csrf: `${token}x` },
    ];
    for (const form of attempts) {
      const res = await browser.request('POST', '/language', { lang: 'en', returnTo: '/', ...form });
      assert.equal(res.status, 403, JSON.stringify(form));
      assert.match(res.html, /Eyðublaðið er útrunnið/);
    }
    const ok = await browser.request('POST', '/language', { lang: 'en', returnTo: '/', _csrf: token });
    assert.equal(ok.status, 303);
  });

  test('§8: the token can also come in an X-CSRF-Token header', async () => {
    const browser = site.browser();
    const token = await browser.csrfToken();
    const res = await browser.request('POST', '/language', { lang: 'en', returnTo: '/' }, { 'X-CSRF-Token': token });
    assert.equal(res.status, 303);
  });

  test('§8: a POST with the token in the header but no form body gets a validation message, not an error', async () => {
    const browser = site.browser();
    const token = await browser.csrfToken();
    const res = await browser.request('POST', '/login', undefined, { 'X-CSRF-Token': token });
    assert.equal(res.status, 400);
    assert.match(res.html, /Kennitala verður að vera 10 tölustafir/);
    const newCode = await browser.request('POST', '/login/new-code', undefined, { 'X-CSRF-Token': token });
    assert.equal(newCode.status, 400);
  });

  test('§8: a token from another session is refused, and so is a POST with no session', async () => {
    const mine = site.browser();
    const other = site.browser();
    const othersToken = await other.csrfToken();
    await mine.csrfToken();
    const res = await mine.request('POST', '/login/new-code', { kennitala: '0000000001', _csrf: othersToken });
    assert.equal(res.status, 403);
    const noSession = await site.browser().request('POST', '/login', { kennitala: '0000000001', code: '123456', _csrf: othersToken });
    assert.equal(noSession.status, 403);
  });

  test('§8: the token stays the same for the session, and every form on the page carries it', async () => {
    const browser = site.browser();
    const page = await browser.get('/login');
    const tokens = [...page.html.matchAll(/name="_csrf" value="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(tokens.length, 5, 'the login form, and the language and theme switches in the header bar and the drawer');
    assert.equal(new Set(tokens).size, 1);
    assert.equal(await browser.csrfToken('/'), tokens[0]);
  });
});

describe('guests get no session from opening a page (BR-70)', () => {
  let site;
  let teacher;
  let eventId;
  let draftId;
  const sessionRows = () => site.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get();
  const tokensIn = (html) => [...html.matchAll(/name="_csrf" value="([^"]*)"/g)].map((m) => m[1]);
  const cookieNames = new Set();
  const collect = (res) => {
    for (const header of res.setCookies) cookieNames.add(header.split('=')[0]);
    return res;
  };

  before(async () => {
    site = await startSite();
    teacher = await site.addUser();
    eventId = insertEvent(site.db, teacher.id);
    draftId = insertEvent(site.db, teacher.id, { status: 'draft' });
  });

  after(() => site.close());

  test('BR-70: a guest who opens pages gets no Set-Cookie, and the sessions table stays empty', async () => {
    const browser = site.browser();
    const pages = [['/', 200], ['/info', 200], [`/events/${eventId}`, 200], ['/no-such-page', 404], [`/events/${draftId}`, 404], ['/admin', 303], ['/privacy', 200]];
    for (const [path, status] of pages) {
      const res = collect(await browser.get(path));
      assert.equal(res.status, status, path);
      assert.deepEqual(res.setCookies, [], `no cookie from ${path}`);
      assert.deepEqual(tokensIn(res.html), [], `no token on ${path}`);
    }
    const refused = collect(await browser.request('POST', '/login', { kennitala: '0000000001', code: '123456' }));
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.setCookies, [], 'the 403 page starts no session either');
    assert.equal(sessionRows(), 0);
  });

  test('BR-70: opening /login or /login/new-code starts a session whose forms carry its token, and login works', async () => {
    for (const path of ['/login', '/login/new-code']) {
      const browser = site.browser();
      const before = sessionRows();
      const page = collect(await browser.get(path));
      assert.equal(page.setCookies.length, 1, path);
      assert.equal(sessionRows(), before + 1, path);
      const tokens = tokensIn(page.html);
      assert.equal(tokens.length, 5, `${path}: its form and the language and theme switches in the bar and the drawer`);
      assert.equal(new Set(tokens).size, 1);
      assert.ok(tokens[0].length > 20);
      assert.deepEqual(tokensIn((await browser.get('/')).html), Array(4).fill(tokens[0]),
        'the front page\'s switches now carry the session\'s token');
    }
    const browser = site.browser();
    const [token] = tokensIn((await browser.get('/login')).html);
    const res = collect(await browser.request('POST', '/login', { _csrf: token, kennitala: teacher.kennitala, code: teacher.code }));
    assert.deepEqual([res.status, res.location], [303, '/']);
    assert.match(collect(await browser.get('/')).html, /action="\/logout"/);
  });

  test('BR-70: a guest switches language and theme without a token, and the choice starts one session', async () => {
    const browser = site.browser();
    const before = sessionRows();
    const lang = collect(await browser.request('POST', '/language', { lang: 'en', returnTo: '/info' }));
    assert.deepEqual([lang.status, lang.location], [303, '/info']);
    assert.equal(lang.setCookies.length, 1);
    const theme = collect(await browser.request('POST', '/theme', { theme: 'dark', returnTo: '/' }));
    assert.deepEqual([theme.status, theme.location], [303, '/']);
    assert.equal(sessionRows(), before + 1, 'exactly one session row');
    const page = collect(await browser.get('/'));
    assert.match(page.html, /<html lang="en" data-theme="dark">/);
    assert.deepEqual(tokensIn(page.html), [], 'no token exists yet, so the switches carry none');
    const login = collect(await browser.get('/login'));
    assert.match(login.html, /<html lang="en" data-theme="dark">/);
    const [token] = tokensIn(login.html);
    assert.deepEqual(tokensIn(collect(await browser.get('/info')).html), Array(4).fill(token), 'then they carry the session\'s token');
    assert.equal(sessionRows(), before + 1, 'still one session row');
  });

  test('BR-70, §9 item 3: a guest\'s language or theme switch from another site is refused, sets no cookie and starts no session', async () => {
    const refused = [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'https://other.example.is' },
      { 'Sec-Fetch-Site': 'cross-site', Origin: site.baseUrl }, { 'Sec-Fetch-Site': 'cross-site', Origin: 'null' }];
    for (const headers of refused) {
      for (const [path, form] of [['/language', { lang: 'en', returnTo: '/' }], ['/theme', { theme: 'dark', returnTo: '/' }]]) {
        const browser = site.browser();
        const before = sessionRows();
        const res = collect(await browser.request('POST', path, form, headers));
        assert.equal(res.status, 403, `${path} ${JSON.stringify(headers)}`);
        assert.match(res.html, /Eyðublaðið er útrunnið/);
        assert.deepEqual(res.setCookies, [], `${path}: no cookie`);
        assert.equal(sessionRows(), before, `${path}: no session row`);
        assert.doesNotMatch((await browser.get('/')).html, /<html lang="en"|data-theme="dark"/, 'nothing changed');
      }
    }

    // A visitor who has a session (the cookie is sent, as a same-site request would send it) keeps
    // it, and their choice stays as it was.
    const visitor = site.browser();
    await visitor.get('/login');
    const sid = visitor.sessionId;
    for (const [path, form] of [['/language', { lang: 'en', returnTo: '/' }], ['/theme', { theme: 'dark', returnTo: '/' }]]) {
      const res = collect(await visitor.request('POST', path, form, { 'Sec-Fetch-Site': 'same-site' }));
      assert.equal(res.status, 403, path);
      assert.equal(visitor.sessionId, sid, `${path}: the same session`);
    }
    assert.doesNotMatch((await visitor.get('/')).html, /<html lang="en"|data-theme="dark"/, 'nothing changed');
  });

  test('BR-70: a guest\'s language or theme switch from the site\'s own page is accepted without a token', async () => {
    // The site's own forms send "Origin: null" (its pages say Referrer-Policy: no-referrer), and a
    // browser without Sec-Fetch-Site sends only that.
    for (const headers of [{ 'Sec-Fetch-Site': 'same-origin' }, { Origin: site.baseUrl }, { 'Sec-Fetch-Site': 'same-origin', Origin: site.baseUrl },
      { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-origin', Origin: 'null' }]) {
      const browser = site.browser();
      const lang = collect(await browser.request('POST', '/language', { lang: 'en', returnTo: '/info' }, headers));
      assert.deepEqual([lang.status, lang.location], [303, '/info'], JSON.stringify(headers));
      const theme = collect(await browser.request('POST', '/theme', { theme: 'dark', returnTo: '/' }, headers));
      assert.deepEqual([theme.status, theme.location], [303, '/'], JSON.stringify(headers));
      assert.match((await browser.get('/')).html, /<html lang="en" data-theme="dark">/);
    }
  });

  test('BR-70, §9 item 3: a logged-in user\'s language or theme switch without a token is refused, and so is any other guest POST', async () => {
    const browser = site.browser();
    await browser.login(teacher.kennitala, teacher.code);
    for (const [path, form] of [['/language', { lang: 'en', returnTo: '/' }], ['/theme', { theme: 'dark', returnTo: '/' }]]) {
      const res = await browser.request('POST', path, form);
      assert.equal(res.status, 403, path);
      assert.match(res.html, /Eyðublaðið er útrunnið/);
    }
    assert.doesNotMatch((await browser.get('/')).html, /<html lang="en"|data-theme="dark"/, 'nothing changed');

    const guest = site.browser();
    await guest.get('/login');
    const posts = [['/login', { kennitala: teacher.kennitala, code: teacher.code }], ['/login/new-code', { kennitala: teacher.kennitala }], ['/logout', {}]];
    for (const [path, form] of posts) assert.equal((await guest.request('POST', path, form)).status, 403, path);
  });

  test('BR-57: the only cookie name the site set in these visits is sid', () => {
    assert.deepEqual([...cookieNames], ['sid']);
  });
});
