import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startSite } from './helpers.js';

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
    ['/events/1', 200, 200, 200, 200],
    ['/my-events', '/login', 200, 403, 403],
    ['/teacher', '/login', 403, 200, 200],
    ['/teacher/events/1/attendance', '/login', 403, 200, 200],
    ['/admin', '/login', 403, 403, 200],
    ['/admin/teachers', '/login', 403, 403, 200],
    ['/admin/export.csv', '/login', 403, 403, 501],
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
    const before = site.db.prepare('SELECT COUNT(*) FROM users').pluck().get();
    for (const role of ['student', 'teacher']) {
      const res = await browsers[role].post('/admin/teachers', {
        action: 'create', name: 'Laumu Kennari', email: 'laumu@example.is', kennitala: '0000000901',
      });
      assert.equal(res.status, 403, role);
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

  test('§9 item 3: a POST without the session\'s token gets the 403 "form expired" page', async () => {
    const browser = site.browser();
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
    const res = await mine.request('POST', '/language', { lang: 'en', _csrf: othersToken });
    assert.equal(res.status, 403);
    const noSession = await site.browser().request('POST', '/login', { kennitala: '0000000001', code: '123456', _csrf: othersToken });
    assert.equal(noSession.status, 403);
  });

  test('§8: the token stays the same for the session, and every form on the page carries it', async () => {
    const browser = site.browser();
    const page = await browser.get('/login');
    const tokens = [...page.html.matchAll(/name="_csrf" value="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(tokens.length, 2, 'the login form and the language switch');
    assert.equal(new Set(tokens).size, 1);
    assert.equal(await browser.csrfToken('/'), tokens[0]);
  });
});
