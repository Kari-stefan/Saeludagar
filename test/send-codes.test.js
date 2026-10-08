import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutboxWorker } from '../src/jobs/outbox.js';
import { queueEmail, renderEmail } from '../src/services/email.js';
import { codeFrom, startSite, testConfig } from './helpers.js';

describe('"Senda kóða" (BR-07, BR-53)', () => {
  let site;
  let admin;
  let students;
  let teacher;

  before(async () => {
    site = await startSite();
    const account = await site.addUser({ isAdmin: true });
    admin = site.browser();
    await admin.login(account.kennitala, account.code);
    teacher = await site.addUser({ name: 'Kári Kennari', email: 'kari@example.is' });
    students = [];
    for (let i = 1; i <= 5; i += 1) {
      students.push(await site.addUser({ role: 'student', name: `Nemandi ${i}`, email: `nemandi${i}@example.is`, code: '11111' + i }));
    }
    await site.addUser({ role: 'student', active: false, name: 'Óvirkur Nemandi' });
  });

  beforeEach(() => site.db.exec('DELETE FROM email_outbox'));

  after(() => site.close());

  const queued = () => site.db.prepare('SELECT kind, priority, user_id, payload FROM email_outbox ORDER BY id').all();

  test('§6: the page shows the number of active students, a warning and a confirm button', async () => {
    const page = await admin.get('/admin/codes');
    assert.match(page.html, /Virkir nemendur: 5/);
    assert.match(page.html, /Fyrri kóði hvers nemanda hættir að virka um leið og nýi kóðinn er sendur\./);
    assert.match(page.html, /<button type="submit" class="button">Senda kóða á 5 nemendur<\/button>/);
    assert.deepEqual(queued(), [], 'opening the page sends nothing');
  });

  test('BR-07: confirming queues one bulk code email for every active student, and only them', async () => {
    const res = await admin.post('/admin/codes');
    assert.deepEqual([res.status, res.location], [303, '/admin/codes']);
    assert.match((await admin.get('/admin/codes')).html, /Kóðar fara í tölvupósti til 5 nemenda\./);
    assert.deepEqual(queued(), students.map((s) => ({ kind: 'student_code', priority: 1, user_id: s.id, payload: null })));
    const requested = site.db.prepare("SELECT COUNT(*) FROM users WHERE role = 'student' AND active = 1 AND code_requested_at IS NOT NULL").pluck().get();
    assert.equal(requested, 5);
  });

  test('BR-07: a second click while the emails wait queues nothing twice', async () => {
    await admin.post('/admin/codes');
    await admin.post('/admin/codes');
    assert.equal(queued().length, 5);
  });

  test('BR-07: each previous code works until the new one is sent, then stops working', async () => {
    const [first] = students;
    await admin.post('/admin/codes');
    assert.equal((await site.browser().login(first.kennitala, first.code)).location, '/my-events');
    const emails = await site.sendEmails();
    assert.equal(emails.length, 5);
    const email = emails.find((e) => e.to.address === 'nemandi1@example.is');
    assert.equal((await site.browser().login(first.kennitala, first.code)).status, 401);
    const newCode = codeFrom(email);
    assert.equal((await site.browser().login(first.kennitala, newCode)).location, '/my-events');
    first.code = newCode;
  });

  test('BR-53: codes go out no faster than SMTP_MAX_PER_MINUTE, and priority-0 emails go first', async () => {
    await admin.post('/admin/codes');
    // A teacher asks for a new code after the bulk send has started.
    queueEmail(site.db, { kind: 'new_code', userId: teacher.id });

    let clock = Date.now() + 1000;
    const sent = [];
    const worker = createOutboxWorker({
      db: site.db,
      config: testConfig({ SMTP_MAX_PER_MINUTE: '2' }),
      now: () => new Date(clock),
      mailer: { async send(message) { sent.push(message.to.address); } },
    });
    await worker.runOnce();
    assert.deepEqual(sent, ['kari@example.is', 'nemandi1@example.is'], 'the new code first, then the bulk');
    clock += 30_000;
    await worker.runOnce();
    assert.equal(sent.length, 2, 'nothing more within the same minute');
    clock += 31_000;
    await worker.runOnce();
    assert.equal(sent.length, 4);
    clock += 61_000;
    await worker.runOnce();
    assert.equal(sent.length, 6);
    assert.deepEqual(queued(), []);
  });

  test('§6: the page shows the progress: queued, sent and failed', async () => {
    await admin.post('/admin/codes');
    let clock = Date.now() + 1000;
    let calls = 0;
    const worker = createOutboxWorker({
      db: site.db,
      config: testConfig({ SMTP_MAX_PER_MINUTE: '3' }),
      now: () => new Date(clock),
      mailer: {
        async send() {
          calls += 1;
          if (calls === 1) throw new Error('Mailbox full');
        },
      },
    });
    const quiet = console.error;
    console.error = () => {};
    try {
      await worker.runOnce(); // 1 fails (to be retried), 2 sent
    } finally {
      console.error = quiet;
    }
    const failed = site.db.prepare("SELECT id FROM email_outbox WHERE kind = 'student_code' AND attempts = 1").pluck().get();
    site.db.prepare('UPDATE email_outbox SET next_try_at = NULL WHERE id = ?').run(failed); // retries used up
    const page = (await admin.get('/admin/codes')).html;
    assert.match(page, /<li>Í biðröð: 2<\/li>/);
    assert.match(page, /<li>Sendir síðan [^<]+: 2<\/li>/);
    assert.match(page, /<li>Tókst ekki að senda: 1<\/li>/);
    assert.match(page, /Pósturinn fer út í mesta lagi 30 á mínútu/);

    // A student made inactive before their email went out is dropped unsent, not counted as sent.
    const waiting = site.db.prepare("SELECT user_id FROM email_outbox WHERE kind = 'student_code' AND next_try_at IS NOT NULL").pluck().all();
    site.db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(waiting[0]);
    clock += 61_000;
    await worker.runOnce();
    const after = (await admin.get('/admin/codes')).html;
    assert.match(after, /<li>Í biðröð: 0<\/li>/);
    assert.match(after, /<li>Sendir síðan [^<]+: 3<\/li>/);
    site.db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(waiting[0]);
  });

  test('BR-52: the student code email is in Icelandic, then English, with the code, the link and instructions', async () => {
    const email = await renderEmail('student_code', { name: 'Jóna', code: '012345', loginUrl: 'http://localhost:3000/login' });
    assert.equal(email.subject, 'Kóðinn þinn fyrir Sæludaga / Your Sæludagar code');
    const is = email.text.indexOf('Á Sæludagavefnum skráir þú þig á viðburði');
    const en = email.text.indexOf('On the Sæludagar website you sign up for events');
    assert.ok(is >= 0 && en > is);
    assert.equal(email.text.match(/^ {4}012345$/gm).length, 2);
    assert.match(email.text, /„Fá nýjan kóða“/);
    assert.match(email.text, /“Get a new code”/);
  });

  test('BR-07: only admins can send codes', async () => {
    const other = await site.addUser({ name: 'Annar Kennari' });
    const teacherBrowser = site.browser();
    assert.equal((await teacherBrowser.login(other.kennitala, other.code)).location, '/teacher');
    assert.equal((await teacherBrowser.post('/admin/codes')).status, 403);
    assert.deepEqual(queued(), []);
  });

  test('§6: with no active students there is nothing to send', async () => {
    site.db.exec("UPDATE users SET active = 0 WHERE role = 'student'");
    const page = (await admin.get('/admin/codes')).html;
    assert.match(page, /Engir virkir nemendur\. Fluttu inn nemendalistann fyrst\./);
    assert.doesNotMatch(page, /Senda kóða á/);
    site.db.exec(`UPDATE users SET active = 1 WHERE role = 'student' AND name LIKE 'Nemandi %'`);
  });
});
