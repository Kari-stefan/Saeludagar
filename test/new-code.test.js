import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NEW_CODE_INTERVAL_MS } from '../src/services/accounts.js';
import { codeFrom, startSite } from './helpers.js';

const SENT = 'Ef kennitalan tilheyrir virkum aðgangi verður nýr kóði sendur á netfangið sem er skráð á aðganginn.';

describe('"Fá nýjan kóða" (BR-08)', () => {
  let site;
  let teacher;
  let student;
  let inactive;

  before(async () => {
    site = await startSite();
    teacher = await site.addUser({ name: 'Kári Kennari', email: 'kari@example.is', code: '222222' });
    student = await site.addUser({ role: 'student', name: 'Nanna Nemandi', email: 'nanna@example.is', code: '333333' });
    inactive = await site.addUser({ active: false, code: '444444' });
  });

  beforeEach(() => {
    site.db.exec('DELETE FROM email_outbox; UPDATE users SET code_requested_at = NULL');
  });

  after(() => site.close());

  const queued = () => site.db.prepare('SELECT kind, priority, user_id, payload FROM email_outbox ORDER BY id').all();

  // Posts the form and follows the redirect to the login page, where the message is shown.
  async function requestCode(kennitala) {
    const browser = site.browser();
    const res = await browser.post('/login/new-code', { kennitala });
    assert.equal(res.status, 303);
    assert.equal(res.location, '/login');
    const page = await browser.get('/login');
    return page.html.replace(/name="_csrf" value="[^"]+"/g, '');
  }

  test('BR-08: the page shows the same message whatever happens', async () => {
    const pages = [
      await requestCode(teacher.kennitala), // active: a code is queued
      await requestCode(teacher.kennitala), // the same kennitala again within 10 minutes
      await requestCode('0000009999'), // no such account
      await requestCode(inactive.kennitala), // inactive account
    ];
    assert.ok(pages[0].includes(SENT));
    assert.equal(new Set(pages).size, 1);
  });

  test('BR-08: an active account gets a new_code email, once per 10 minutes', async () => {
    await requestCode(student.kennitala);
    assert.deepEqual(queued(), [{ kind: 'new_code', priority: 0, user_id: student.id, payload: null }]);

    await requestCode(`${student.kennitala.slice(0, 6)}-${student.kennitala.slice(6)}`);
    assert.equal(queued().length, 1, 'a second request within 10 minutes is refused');

    assert.equal(NEW_CODE_INTERVAL_MS, 10 * 60 * 1000);
    site.db.prepare('UPDATE users SET code_requested_at = ? WHERE id = ?')
      .run(new Date(Date.now() - NEW_CODE_INTERVAL_MS - 1000).toISOString(), student.id);
    await requestCode(student.kennitala);
    assert.equal(queued().length, 2, 'allowed again after 10 minutes');
  });

  test('BR-08: unknown and inactive kennitölur queue nothing', async () => {
    await requestCode('0000009999');
    await requestCode(inactive.kennitala);
    assert.deepEqual(queued(), []);
  });

  test('BR-08: the new code is emailed to the address on file, and then the old code stops working', async () => {
    await requestCode(teacher.kennitala);
    const oldStillWorks = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(oldStillWorks.location, '/teacher', 'the old code works until the email is sent');

    const [email] = await site.sendEmails();
    assert.deepEqual(email.to, { name: 'Kári Kennari', address: 'kari@example.is' });
    assert.equal(email.subject, 'Nýr kóði fyrir Sæludaga / Your new Sæludagar code');
    const newCode = codeFrom(email);

    const old = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(old.status, 401);
    const fresh = await site.browser().login(teacher.kennitala, newCode);
    assert.equal(fresh.location, '/teacher');
    teacher.code = newCode;
  });

  test('BR-08: a logged-in user is sent to their home page, so the message is never lost', async () => {
    const browser = site.browser();
    await browser.login(student.kennitala, student.code);
    const page = await browser.get('/login/new-code');
    assert.deepEqual([page.status, page.location], [303, '/my-events']);
    const post = await browser.post('/login/new-code', { kennitala: student.kennitala });
    assert.deepEqual([post.status, post.location], [303, '/my-events']);
    assert.deepEqual(queued(), []);
    const sess = site.db.prepare('SELECT sess FROM sessions WHERE sid = ?').pluck().get(browser.sessionId);
    assert.equal(JSON.parse(sess).flash, undefined, 'no message left waiting in the session');
  });

  test('BR-01: an invalid kennitala gets a validation message', async () => {
    const res = await site.browser().post('/login/new-code', { kennitala: '12345' });
    assert.equal(res.status, 400);
    assert.match(res.html, /Kennitala verður að vera 10 tölustafir/);
    assert.deepEqual(queued(), []);
  });
});
