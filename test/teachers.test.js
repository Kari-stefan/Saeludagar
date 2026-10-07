import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { codeFrom, startSite } from './helpers.js';

describe('teacher accounts (BR-10 to BR-12)', () => {
  let site;
  let admin;
  let adminBrowser;
  let student;

  before(async () => {
    site = await startSite();
    admin = await site.addUser({ isAdmin: true, name: 'Anna Stjórnandi', email: 'anna@example.is' });
    student = await site.addUser({ role: 'student', name: 'Nanna Nemandi' });
    adminBrowser = site.browser();
    await adminBrowser.login(admin.kennitala, admin.code);
  });

  after(() => site.close());

  const teacherRow = (kennitala) => site.db.prepare('SELECT * FROM users WHERE kennitala_hmac = ?').get(site.kt.hmac(kennitala));
  const act = (action, id) => adminBrowser.post('/admin/teachers', { action, id: String(id) });

  async function createTeacher(fields) {
    const res = await adminBrowser.post('/admin/teachers', { action: 'create', ...fields });
    assert.equal(res.status, 303, res.html);
    return res;
  }

  test('BR-10: the admin creates a teacher, who gets a code by email and can log in', async () => {
    await createTeacher({ name: 'Jón Kennari', email: 'jon@example.is', kennitala: '000000-0101' });
    const page = await adminBrowser.get('/admin/teachers');
    assert.match(page.html, /Aðgangur stofnaður: Jón Kennari\. Kóði verður sendur á jon@example\.is\./);
    assert.match(page.html, /<td>Jón Kennari<\/td>\s*<td>jon@example\.is<\/td>\s*<td>Nei<\/td>\s*<td>Virkur<\/td>/);

    const row = teacherRow('0000000101');
    assert.equal(row.role, 'teacher');
    assert.equal(row.is_admin, 0);
    assert.equal(row.active, 1);
    assert.equal(row.code_hash, null, 'the worker generates the code when it sends the email');
    assert.ok(row.code_requested_at);
    const queued = site.db.prepare('SELECT kind, priority, payload FROM email_outbox WHERE user_id = ?').all(row.id);
    assert.deepEqual(queued, [{ kind: 'teacher_code', priority: 0, payload: null }]);

    const [email] = await site.sendEmails();
    assert.deepEqual(email.to, { name: 'Jón Kennari', address: 'jon@example.is' });
    const login = await site.browser().login('0000000101', codeFrom(email));
    assert.equal(login.location, '/teacher');
  });

  test('BR-10: the form checks every field and keeps the kennitala out of the page', async () => {
    const res = await adminBrowser.post('/admin/teachers', { action: 'create', name: ' ', email: 'not-an-email', kennitala: '12345-67890' });
    assert.equal(res.status, 400);
    assert.match(res.html, /Sláðu inn nafn/);
    assert.match(res.html, /Sláðu inn gilt netfang/);
    assert.match(res.html, /Kennitala verður að vera 10 tölustafir/);
    assert.match(res.html, /value="not-an-email"/);
    assert.doesNotMatch(res.html, /12345-67890/);
    assert.equal(site.db.prepare("SELECT COUNT(*) FROM users WHERE email = 'not-an-email'").pluck().get(), 0);
  });

  test('BR-12: a kennitala can belong to only one account, student or teacher', async () => {
    for (const kennitala of [student.kennitala, '000000-0101', admin.kennitala]) {
      const res = await adminBrowser.post('/admin/teachers', { action: 'create', name: 'Afrit', email: 'afrit@example.is', kennitala });
      assert.equal(res.status, 400, kennitala);
      assert.match(res.html, /Þessi kennitala er þegar með aðgang/);
      assert.doesNotMatch(res.html, new RegExp(kennitala));
    }
    assert.equal(site.db.prepare("SELECT COUNT(*) FROM users WHERE name = 'Afrit'").pluck().get(), 0);
  });

  test('BR-11: the admin sends a teacher a new code; the old one stops working once it is sent', async () => {
    const teacher = await site.addUser({ name: 'Gömul Kóði', email: 'gomul@example.is', code: '123123' });
    const res = await act('new-code', teacher.id);
    assert.equal(res.location, '/admin/teachers');
    assert.match((await adminBrowser.get('/admin/teachers')).html, /Nýr kóði verður sendur á gomul@example\.is\./);
    const [email] = await site.sendEmails();
    assert.equal(email.subject, 'Kóði fyrir Sæludagavefinn / Your code for the Sæludagar website');
    assert.equal((await site.browser().login(teacher.kennitala, '123123')).status, 401);
    assert.equal((await site.browser().login(teacher.kennitala, codeFrom(email))).location, '/teacher');
  });

  test('BR-11: a deactivated teacher loses their sessions and cannot log in; their events stay', async () => {
    const teacher = await site.addUser({ name: 'Óli Óvirki' });
    const now = toIso();
    site.db.prepare(`INSERT INTO events (owner_id, title_is, description_is, host, capacity, event_date, start_time,
      end_time, location, created_at, updated_at) VALUES (?, 'Viðburður', 'Lýsing', 'Gestgjafi', 10, '2027-03-11',
      '10:00', '12:00', 'Stofa 1', ?, ?)`).run(teacher.id, now, now);
    const teacherBrowser = site.browser();
    await teacherBrowser.login(teacher.kennitala, teacher.code);
    assert.equal((await teacherBrowser.get('/teacher')).status, 200);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM sessions WHERE user_id = ?').pluck().get(teacher.id), 1);

    await act('deactivate', teacher.id);
    assert.match((await adminBrowser.get('/admin/teachers')).html, /Aðgangur gerður óvirkur: Óli Óvirki/);
    assert.equal(site.db.prepare('SELECT active FROM users WHERE id = ?').pluck().get(teacher.id), 0);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM sessions WHERE user_id = ?').pluck().get(teacher.id), 0);
    const kicked = await teacherBrowser.get('/teacher');
    assert.equal(kicked.status, 303);
    assert.equal(kicked.location, '/login');
    const login = await site.browser().login(teacher.kennitala, teacher.code);
    assert.equal(login.status, 401);
    assert.match(login.html, /Kennitala eða kóði er rangur/);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM events WHERE owner_id = ?').pluck().get(teacher.id), 1);

    await act('activate', teacher.id);
    assert.match((await adminBrowser.get('/admin/teachers')).html, /Aðgangur virkjaður: Óli Óvirki/);
    assert.equal((await site.browser().login(teacher.kennitala, teacher.code)).location, '/teacher');
  });

  test('BR-11: a code queued for a teacher who is then deactivated is never sent', async () => {
    const teacher = await site.addUser({ name: 'Bið Kennari' });
    await act('new-code', teacher.id);
    await act('deactivate', teacher.id);
    assert.deepEqual(await site.sendEmails(), []);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM email_outbox WHERE user_id = ?').pluck().get(teacher.id), 0);
    const res = await act('new-code', teacher.id);
    assert.equal(res.location, '/admin/teachers');
    assert.match((await adminBrowser.get('/admin/teachers')).html, /Virkjaðu aðganginn fyrst\./);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM email_outbox WHERE user_id = ?').pluck().get(teacher.id), 0);
  });

  test('BR-11: granting and revoking the admin flag takes effect at once', async () => {
    const teacher = await site.addUser({ name: 'Verðandi Stjórnandi' });
    const teacherBrowser = site.browser();
    await teacherBrowser.login(teacher.kennitala, teacher.code);
    assert.equal((await teacherBrowser.get('/admin')).status, 403);

    await act('grant-admin', teacher.id);
    assert.match((await adminBrowser.get('/admin/teachers')).html, /Stjórnandaréttindi veitt: Verðandi Stjórnandi/);
    assert.equal((await teacherBrowser.get('/admin')).status, 200);

    await act('revoke-admin', teacher.id);
    assert.match((await adminBrowser.get('/admin/teachers')).html, /Stjórnandaréttindi tekin af: Verðandi Stjórnandi/);
    assert.equal((await teacherBrowser.get('/admin')).status, 403);
  });

  test('BR-11: an admin cannot deactivate themselves or remove their own admin rights; another admin can', async () => {
    const page = await adminBrowser.get('/admin/teachers');
    const ownRow = /<tr>\s*<td>Anna Stjórnandi \(þú\)<\/td>[\s\S]*?<\/tr>/.exec(page.html)[0];
    assert.doesNotMatch(ownRow, /value="deactivate"|value="revoke-admin"/);

    for (const action of ['deactivate', 'revoke-admin']) {
      const res = await act(action, admin.id);
      assert.equal(res.location, '/admin/teachers');
      assert.match((await adminBrowser.get('/admin/teachers')).html,
        /role="alert">\s*<p>Þú getur ekki gert þinn eigin aðgang óvirkan eða tekið af þér stjórnandaréttindin\.<\/p>/);
    }
    assert.deepEqual(site.db.prepare('SELECT active, is_admin FROM users WHERE id = ?').get(admin.id), { active: 1, is_admin: 1 });

    const second = await site.addUser({ isAdmin: true, name: 'Önnur Stjórnandi' });
    const secondBrowser = site.browser();
    await secondBrowser.login(second.kennitala, second.code);
    await secondBrowser.post('/admin/teachers', { action: 'revoke-admin', id: String(admin.id) });
    assert.equal(site.db.prepare('SELECT is_admin FROM users WHERE id = ?').pluck().get(admin.id), 0);
    await secondBrowser.post('/admin/teachers', { action: 'grant-admin', id: String(admin.id) });
    assert.equal(site.db.prepare('SELECT is_admin FROM users WHERE id = ?').pluck().get(admin.id), 1);
  });

  test('BR-11: actions only work on teacher accounts that exist', async () => {
    assert.equal((await act('deactivate', student.id)).status, 404);
    assert.equal((await act('deactivate', 99999)).status, 404);
    assert.equal((await act('deactivate', 'abc')).status, 404);
    assert.equal((await act('delete', student.id)).status, 400);
    assert.equal(site.db.prepare('SELECT active FROM users WHERE id = ?').pluck().get(student.id), 1);
  });

  test('the teacher list shows name, email, admin and active, sorted by name', async () => {
    const page = await adminBrowser.get('/admin/teachers');
    const names = [...page.html.matchAll(/<tr>\s*<td>([^<]+?)(?: \(þú\))?<\/td>/g)].map((m) => m[1]);
    assert.deepEqual(names, [...names].sort(new Intl.Collator('is').compare));
    assert.ok(names.includes('Óli Óvirki') && names.includes('Jón Kennari'));
    assert.doesNotMatch(page.html, /Nanna Nemandi/, 'students are not listed');
    assert.match(page.html, /<th scope="col">Netfang<\/th>/);
  });

  test('§6: the admin home shows the email outbox status and links to every admin page', async () => {
    site.db.exec('DELETE FROM email_outbox');
    const now = toIso();
    const insert = site.db.prepare(`INSERT INTO email_outbox (kind, user_id, created_at, next_try_at, attempts, last_error)
      VALUES ('teacher_code', ?, ?, ?, ?, ?)`);
    insert.run(admin.id, now, now, 0, null);
    insert.run(admin.id, now, now, 2, 'Timeout');
    insert.run(admin.id, now, null, 6, 'Rejected');
    const page = await adminBrowser.get('/admin');
    assert.match(page.html, /Í biðröð: 2/);
    assert.match(page.html, /Tókst ekki að senda: 1/);
    for (const path of ['settings', 'import', 'codes', 'teachers', 'events', 'export', 'purge', 'audit']) {
      assert.match(page.html, new RegExp(`href="/admin/${path}"`));
    }
    site.db.exec('DELETE FROM email_outbox');
  });
});
