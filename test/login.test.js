import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, LOCKOUT_MS } from '../src/services/accounts.js';
import { startSite } from './helpers.js';

const FAILED = /<div class="alert alert--error" role="alert">\s*<p>Kennitala eða kóði er rangur<\/p>/;

describe('login (BR-01 to BR-06, BR-09)', () => {
  let site;
  let admin;
  let teacher;
  let student;
  let inactiveTeacher;
  let inactiveStudent;

  before(async () => {
    site = await startSite();
    admin = await site.addUser({ isAdmin: true, name: 'Anna Stjórnandi', code: '111111' });
    teacher = await site.addUser({ name: 'Kári Kennari', code: '222222' });
    student = await site.addUser({ role: 'student', name: 'Nanna Nemandi', code: '333333' });
    inactiveTeacher = await site.addUser({ active: false, code: '444444' });
    inactiveStudent = await site.addUser({ role: 'student', active: false, code: '555555' });
  });

  after(() => site.close());

  const user = (id) => site.db.prepare('SELECT failed_logins, locked_until, code_hash FROM users WHERE id = ?').get(id);
  const unlock = (id) => site.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(id);

  test('BR-01: the kennitala works with or without the hyphen', async () => {
    const plain = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(plain.location, '/teacher');
    const hyphen = `${teacher.kennitala.slice(0, 6)}-${teacher.kennitala.slice(6)}`;
    const hyphenated = await site.browser().login(hyphen, teacher.code);
    assert.equal(hyphenated.status, 303);
    assert.equal(hyphenated.location, '/teacher');
  });

  test('BR-01: other input gets a validation message, not a login attempt', async () => {
    for (const kennitala of ['123', '00000000021', '00000-000002', 'abcdefghij', '']) {
      const res = await site.browser().login(kennitala, teacher.code);
      assert.equal(res.status, 400, kennitala);
      assert.match(res.html, /Kennitala verður að vera 10 tölustafir/);
      assert.match(res.html, /aria-invalid="true"/);
      assert.doesNotMatch(res.html, FAILED);
    }
    const badCode = await site.browser().login(teacher.kennitala, '12345');
    assert.equal(badCode.status, 400);
    assert.match(badCode.html, /Kóðinn er 6 tölustafir/);
    assert.equal(user(teacher.id).failed_logins, 0);
  });

  test('BR-01: the kennitala is never echoed back into the form', async () => {
    const res = await site.browser().login(teacher.kennitala, '000000');
    assert.equal(res.status, 401);
    assert.doesNotMatch(res.html, new RegExp(teacher.kennitala));
    unlock(teacher.id);
  });

  test('BR-02: one form for everyone; students land on student pages, teachers and admins on teacher pages', async () => {
    const asStudent = await site.browser().login(student.kennitala, student.code);
    assert.equal(asStudent.location, '/my-events');
    const asTeacher = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(asTeacher.location, '/teacher');
    const asAdmin = await site.browser().login(admin.kennitala, admin.code);
    assert.equal(asAdmin.location, '/teacher');
  });

  test('BR-03, BR-04: every kind of failed login shows the same message', async () => {
    unlock(teacher.id);
    const attempts = {
      'unknown kennitala': ['0000009999', '123456'],
      'wrong code': [teacher.kennitala, '999999'],
      'inactive teacher, right code': [inactiveTeacher.kennitala, inactiveTeacher.code],
      'inactive student, right code': [inactiveStudent.kennitala, inactiveStudent.code],
    };
    const pages = [];
    for (const [name, [kennitala, code]] of Object.entries(attempts)) {
      const res = await site.browser().login(kennitala, code);
      assert.equal(res.status, 401, name);
      assert.match(res.html, FAILED, name);
      pages.push(res.html.replace(/name="_csrf" value="[^"]+"/g, ''));
    }
    // A locked account with the right code too (BR-05).
    site.db.prepare('UPDATE users SET locked_until = ? WHERE id = ?')
      .run(new Date(Date.now() + 60_000).toISOString(), teacher.id);
    const locked = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(locked.status, 401);
    pages.push(locked.html.replace(/name="_csrf" value="[^"]+"/g, ''));
    assert.equal(new Set(pages).size, 1, 'all failure pages are identical');
    unlock(teacher.id);
  });

  test('BR-04: the English page shows the English message', async () => {
    const browser = site.browser();
    await browser.post('/language', { lang: 'en', returnTo: '/login' });
    const res = await browser.login(teacher.kennitala, '999999');
    assert.match(res.html, /Incorrect kennitala or code/);
    unlock(teacher.id);
  });

  test('BR-05: 5 wrong codes lock that kennitala for 15 minutes, even with the right code', async () => {
    unlock(teacher.id);
    for (let i = 1; i <= 4; i += 1) {
      await site.browser().login(teacher.kennitala, '999999');
      assert.equal(user(teacher.id).failed_logins, i);
    }
    const before = Date.now();
    await site.browser().login(teacher.kennitala, '999999');
    const after = Date.now();
    const locked = user(teacher.id);
    assert.equal(locked.failed_logins, 0, 'the counter resets when the lock is set');
    // The lock starts while the request runs, and is stored to the second.
    const lockedUntil = Date.parse(locked.locked_until);
    assert.ok(lockedUntil >= before - 1000 + LOCKOUT_MS && lockedUntil <= after + LOCKOUT_MS,
      `locked until ${locked.locked_until}, request ran ${new Date(before).toISOString()}–${new Date(after).toISOString()}`);
    assert.equal(LOCKOUT_MS, 15 * 60 * 1000);

    const right = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(right.status, 401);
    assert.match(right.html, FAILED);
    assert.equal(user(teacher.id).failed_logins, 0, 'attempts while locked are not counted');

    // Locked per kennitala, never by IP: another account on the same address still logs in.
    const other = await site.browser().login(admin.kennitala, admin.code);
    assert.equal(other.location, '/teacher');

    // 15 minutes later.
    site.db.prepare('UPDATE users SET locked_until = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'), teacher.id);
    const later = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(later.location, '/teacher');
    assert.equal(user(teacher.id).failed_logins, 0);
    assert.equal(user(teacher.id).locked_until, null);
  });

  test('BR-05: a successful login resets the failed attempts', async () => {
    unlock(teacher.id);
    await site.browser().login(teacher.kennitala, '999999');
    await site.browser().login(teacher.kennitala, '999999');
    assert.equal(user(teacher.id).failed_logins, 2);
    await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(user(teacher.id).failed_logins, 0);
  });

  test('BR-05: parallel attempts cannot get more than 5 guesses in before the lock', async () => {
    unlock(teacher.id);
    const accounts = createAccounts({ db: site.db, kt: site.kt });
    // 20 guesses at once; the right code is the 10th. Only the first 5 are checked.
    const guesses = Array.from({ length: 20 }, (_, i) => (i === 9 ? teacher.code : '999999'));
    const results = await Promise.all(guesses.map((code) => accounts.login(teacher.kennitala, code)));
    assert.deepEqual(results, Array(20).fill(null));
    assert.ok(Date.parse(user(teacher.id).locked_until) > Date.now());
    unlock(teacher.id);
  });

  test('BR-06: the code is stored only as a hash', async () => {
    const { code_hash: hash } = user(teacher.id);
    assert.match(hash, /^scrypt\$/);
    assert.doesNotMatch(hash, new RegExp(teacher.code));
  });

  test('§8: login regenerates the session ID and stores { userId, role, isAdmin, lang }', async () => {
    const browser = site.browser();
    await browser.post('/language', { lang: 'en', returnTo: '/' });
    const guestSid = browser.sessionId;
    await browser.login(admin.kennitala, admin.code);
    assert.notEqual(browser.sessionId, guestSid);
    const session = site.db.prepare('SELECT sess FROM sessions WHERE sid = ?').pluck();
    assert.equal(session.get(guestSid), undefined, 'the guest session is gone');
    const sess = JSON.parse(session.get(browser.sessionId));
    assert.deepEqual(
      { userId: sess.userId, role: sess.role, isAdmin: sess.isAdmin, lang: sess.lang },
      { userId: admin.id, role: 'teacher', isAdmin: true, lang: 'en' },
    );
    const home = await browser.get('/teacher');
    assert.match(home.html, /<html lang="en">/, 'the language survives the login');
  });

  test('BR-09: student sessions last 2 hours, teacher and admin sessions 12 hours', async () => {
    const expiresIn = (res) => Date.parse(/Expires=([^;]+)/.exec(res.setCookies[0])[1]) - Date.now();
    const hour = 60 * 60 * 1000;
    for (const [account, hours] of [[student, 2], [teacher, 12], [admin, 12]]) {
      const res = await site.browser().login(account.kennitala, account.code);
      const ms = expiresIn(res);
      assert.ok(ms > hours * hour - 5000 && ms <= hours * hour, `${account.kennitala}: ${ms} ms`);
    }
  });

  test('BR-09: every request renews the session; an idle session expires on the server', async () => {
    const browser = site.browser();
    await browser.login(student.kennitala, student.code);
    const expiresAt = () => site.db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').pluck().get(browser.sessionId);
    const setExpiresAt = (ms) => site.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(ms, browser.sessionId);

    setExpiresAt(Date.now() + 60_000);
    const res = await browser.get('/my-events');
    assert.equal(res.status, 200);
    assert.ok(expiresAt() > Date.now() + 2 * 60 * 60 * 1000 - 5000, 'renewed to 2 hours');
    assert.equal(res.setCookies.length, 1, 'the cookie is renewed too');

    setExpiresAt(Date.now() - 1);
    const expired = await browser.get('/my-events');
    assert.equal(expired.status, 303);
    assert.equal(expired.location, '/login');
  });

  test('BR-09: a teacher\'s session is renewed to 12 hours on every request', async () => {
    const browser = site.browser();
    await browser.login(admin.kennitala, admin.code);
    site.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() + 60_000, browser.sessionId);
    assert.equal((await browser.get('/teacher')).status, 200);
    const expiresAt = site.db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').pluck().get(browser.sessionId);
    const twelveHours = 12 * 60 * 60 * 1000;
    assert.ok(expiresAt > Date.now() + twelveHours - 5000 && expiresAt <= Date.now() + twelveHours, 'renewed to 12 hours');
  });

  test('§11: a form with field errors announces them to screen readers', async () => {
    const res = await site.browser().login('123', '1');
    assert.match(res.html, /<div class="alert alert--error" role="alert">\s*<p>Lagaðu villurnar hér fyrir neðan\.<\/p>/);
    const ok = await site.browser().get('/login');
    assert.doesNotMatch(ok.html, /Lagaðu villurnar/);
  });

  test('§9 item 6: logout destroys the session and keeps the language', async () => {
    const browser = site.browser();
    await browser.post('/language', { lang: 'en', returnTo: '/' });
    await browser.login(teacher.kennitala, teacher.code);
    const loggedIn = browser.sessionId;
    const res = await browser.post('/logout');
    assert.equal(res.status, 303);
    assert.equal(res.location, '/');
    const row = site.db.prepare('SELECT 1 FROM sessions WHERE sid = ?').get(loggedIn);
    assert.equal(row, undefined, 'the logged-in session row is deleted');

    const after = await browser.get('/teacher');
    assert.equal(after.status, 303);
    assert.equal(after.location, '/login');
    const home = await browser.get('/');
    assert.match(home.html, /<html lang="en">/);
    assert.match(home.html, />Log in</);
  });

  test('a logged-in user who opens the login page goes to their home page', async () => {
    const browser = site.browser();
    await browser.login(student.kennitala, student.code);
    const res = await browser.get('/login');
    assert.equal(res.status, 303);
    assert.equal(res.location, '/my-events');
  });

  test('§6: the header shows the user\'s name and a logout button', async () => {
    const browser = site.browser();
    await browser.login(admin.kennitala, admin.code);
    const res = await browser.get('/teacher');
    assert.match(res.html, /<span class="site-nav__user">Anna Stjórnandi<\/span>/);
    assert.match(res.html, /<form class="site-nav__form" method="post" action="\/logout">/);
    assert.match(res.html, /href="\/admin">Stjórnendasvæði</);
    assert.doesNotMatch(res.html, /href="\/login"/);
  });
});
