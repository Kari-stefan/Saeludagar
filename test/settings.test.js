import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startSite } from './helpers.js';

const TIMES = {
  signupOpensDate: '2027-02-15', signupOpensTime: '12:00',
  signupClosesDate: '2027-03-01', signupClosesTime: '23:59',
  choiceDeadlineDate: '2027-03-20', choiceDeadlineTime: '16:00',
};

describe('admin settings (BR-54)', () => {
  let site;
  let admin;

  before(async () => {
    site = await startSite();
    const account = await site.addUser({ isAdmin: true });
    admin = site.browser();
    await admin.login(account.kennitala, account.code);
  });

  after(() => site.close());

  const days = () => site.db.prepare('SELECT day FROM saeludagar_days ORDER BY day').pluck().all();
  const stored = () => site.db.prepare('SELECT signup_opens_at, signup_closes_at, choice_deadline_at FROM settings').get();

  test('BR-54: the admin adds and removes Sæludagar days', async () => {
    for (const day of ['2027-03-12', '2027-03-11', '2027-03-11']) {
      const res = await admin.post('/admin/settings', { action: 'add-day', day });
      assert.deepEqual([res.status, res.location], [303, '/admin/settings']);
    }
    assert.deepEqual(days(), ['2027-03-11', '2027-03-12'], 'stored once each, sorted');
    const page = await admin.get('/admin/settings');
    assert.match(page.html, /Degi bætt við: 11\. mars 2027/);
    assert.match(page.html, /<span>11\. mars 2027<\/span>[\s\S]*<span>12\. mars 2027<\/span>/);

    await admin.post('/admin/settings', { action: 'remove-day', day: '2027-03-12' });
    assert.deepEqual(days(), ['2027-03-11']);
    assert.match((await admin.get('/admin/settings')).html, /Degi eytt\./);
  });

  test('BR-54: a day must be a real date', async () => {
    for (const day of ['2027-02-30', '11.03.2027', '', '2027-3-11']) {
      const res = await admin.post('/admin/settings', { action: 'add-day', day });
      assert.equal(res.status, 400, day);
      assert.match(res.html, /Sláðu inn gilda dagsetningu/);
    }
    assert.deepEqual(days(), ['2027-03-11']);
  });

  test('BR-54: the admin sets the sign-up window and the course-choice deadline', async () => {
    const res = await admin.post('/admin/settings', { action: 'save-times', ...TIMES });
    assert.deepEqual([res.status, res.location], [303, '/admin/settings']);
    assert.deepEqual(stored(), {
      signup_opens_at: '2027-02-15T12:00:00Z',
      signup_closes_at: '2027-03-01T23:59:00Z',
      choice_deadline_at: '2027-03-20T16:00:00Z',
    });
    const page = await admin.get('/admin/settings');
    assert.match(page.html, /Tímarnir hafa verið vistaðir\./);
    assert.match(page.html, /Núna: 15\. febrúar 2027, kl\. 12:00/);
    assert.match(page.html, /id="signupOpensDate" name="signupOpensDate" type="date" value="2027-02-15"/);
    assert.match(page.html, /id="choiceDeadlineTime" name="choiceDeadlineTime" type="time" value="16:00"/);
  });

  test('§6: the admin home shows the current dates and windows, in both languages', async () => {
    const home = await admin.get('/admin');
    assert.match(home.html, /<dd>11\. mars 2027<\/dd>/);
    assert.match(home.html, /<dt>Skráning opnar<\/dt>\s*<dd>15\. febrúar 2027, kl\. 12:00<\/dd>/);
    assert.match(home.html, /<dt>Frestur til að velja áfanga<\/dt>\s*<dd>20\. mars 2027, kl\. 16:00<\/dd>/);

    await admin.post('/language', { lang: 'en', returnTo: '/admin' });
    const english = await admin.get('/admin');
    assert.match(english.html, /<dt>Sign-up closes<\/dt>\s*<dd>1 March 2027, 23:59<\/dd>/);
    assert.match(english.html, /<dd>11 March 2027<\/dd>/);
    await admin.post('/language', { lang: 'is', returnTo: '/admin' });
  });

  test('BR-54: each time needs both a date and a time, and sign-up must close after it opens', async () => {
    const before = stored();
    const halfFilled = await admin.post('/admin/settings', { action: 'save-times', ...TIMES, choiceDeadlineTime: '' });
    assert.equal(halfFilled.status, 400);
    assert.match(halfFilled.html, /Fylltu inn bæði dagsetningu og tíma, eða hvorugt/);
    assert.match(halfFilled.html, /Lagaðu villurnar hér fyrir neðan\./);

    const backwards = await admin.post('/admin/settings', { action: 'save-times', ...TIMES, signupClosesDate: '2027-02-15', signupClosesTime: '12:00' });
    assert.equal(backwards.status, 400);
    assert.match(backwards.html, /Skráningu verður að ljúka eftir að hún opnar/);

    const invalid = await admin.post('/admin/settings', { action: 'save-times', ...TIMES, signupOpensTime: '25:00' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.html, /Sláðu inn gilda dagsetningu og tíma/);
    assert.match(invalid.html, /value="25:00"/, 'what the admin typed is kept in the form');

    assert.deepEqual(stored(), before, 'nothing is saved');
  });

  test('BR-54: emptying both fields clears that time', async () => {
    await admin.post('/admin/settings', { action: 'save-times', ...TIMES, choiceDeadlineDate: '', choiceDeadlineTime: '' });
    assert.equal(stored().choice_deadline_at, null);
    assert.match((await admin.get('/admin')).html, /<dt>Frestur til að velja áfanga<\/dt>\s*<dd>Ekki skráð<\/dd>/);
  });

  test('BR-54: only admins can change the settings', async () => {
    const account = await site.addUser();
    const teacher = site.browser();
    await teacher.login(account.kennitala, account.code);
    const res = await teacher.post('/admin/settings', { action: 'add-day', day: '2027-03-13' });
    assert.equal(res.status, 403);
    assert.deepEqual(days(), ['2027-03-11']);
  });
});
