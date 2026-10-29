import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { codeFrom, insertEvent, startSite } from './helpers.js';

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
    assert.match(page.html, /<td>Jón Kennari<\/td>\s*<td>jon@example\.is<\/td>\s*<td>Kennaraaðgangur<\/td>\s*<td>Nei<\/td>\s*<td>Virkur<\/td>/);

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

  test('admin can promote an active student to Event Manager, keeping student data and access', async () => {
    const dual = await site.addUser({ role: 'student', name: 'Dóra Dual' });
    const owner = await site.addUser({ name: 'Eigandi Viðburðar' });
    const signupEvent = insertEvent(site.db, owner.id, { title_is: 'Skráning viðburður' });
    site.db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)').run(dual.id, 'ENSK2AB05');

    const dualBrowser = site.browser();
    await dualBrowser.login(dual.kennitala, dual.code);
    site.db.prepare('INSERT INTO registrations (event_id, student_id, created_at) VALUES (?, ?, ?)').run(signupEvent, dual.id, toIso());
    assert.equal((await dualBrowser.get('/teacher')).status, 403);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM sessions WHERE user_id = ?').pluck().get(dual.id), 1);

    await adminBrowser.post('/admin/teachers', { action: 'promote-event-manager', id: String(dual.id) });
    const page = await adminBrowser.get('/admin/teachers');
    assert.match(page.html, /Viðburðastjóraréttindi veitt: Dóra Dual/);
    assert.match(page.html, /<td>Dóra Dual<\/td>\s*<td>profun@example\.is<\/td>\s*<td>Nemandi<\/td>\s*<td>Nei<\/td>\s*<td>Virkur<\/td>/);
    assert.deepEqual(site.db.prepare('SELECT role, is_event_manager FROM users WHERE id = ?').get(dual.id), { role: 'student', is_event_manager: 1 });
    assert.deepEqual(site.db.prepare(`SELECT action, actor_id, student_id FROM audit_log WHERE action = 'event-manager.grant' ORDER BY id DESC LIMIT 1`).get(), {
      action: 'event-manager.grant', actor_id: admin.id, student_id: dual.id,
    });

    assert.equal((await dualBrowser.get('/my-events')).status, 200);
    assert.equal((await dualBrowser.get('/teacher')).status, 200);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM student_courses WHERE user_id = ?').pluck().get(dual.id), 1);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM registrations WHERE student_id = ?').pluck().get(dual.id), 1);

    site.db.prepare('INSERT OR IGNORE INTO saeludagar_days (day) VALUES (?)').run('2027-03-12');
    const created = await dualBrowser.postForm('/teacher/events/new', {
      title_is: 'Viðburður frá nemanda',
      title_en: '',
      description_is: 'Lýsing.',
      description_en: '',
      host: 'FB',
      location: 'Stofa 4',
      capacity: '20',
      fee_isk: '',
      event_date: '2027-03-12',
      start_time: '09:00',
      end_time: '10:00',
      braut_restricted: '0',
    });
    assert.equal(created.status, 303);
    assert.match(created.location, /^\/teacher\/events\/\d+$/);
  });

  test('admin can revoke Event Manager role without ending student sessions or deleting ownership', async () => {
    const dual = await site.addUser({ role: 'student', name: 'Rósa Revoked' });
    await adminBrowser.post('/admin/teachers', { action: 'promote-event-manager', id: String(dual.id) });
    const dualBrowser = site.browser();
    await dualBrowser.login(dual.kennitala, dual.code);

    site.db.prepare('INSERT OR IGNORE INTO saeludagar_days (day) VALUES (?)').run('2027-03-13');
    const ownEvent = await dualBrowser.postForm('/teacher/events/new', {
      title_is: 'Viðburður sem helst',
      title_en: '',
      description_is: 'Lýsing.',
      description_en: '',
      host: 'FB',
      location: 'Stofa 5',
      capacity: '20',
      fee_isk: '',
      event_date: '2027-03-13',
      start_time: '11:00',
      end_time: '12:00',
      braut_restricted: '0',
    });
    const ownId = Number(/^\/teacher\/events\/(\d+)$/.exec(ownEvent.location)?.[1]);
    assert.ok(Number.isSafeInteger(ownId));
    const beforeSessions = site.db.prepare('SELECT COUNT(*) FROM sessions WHERE user_id = ?').pluck().get(dual.id);

    await adminBrowser.post('/admin/teachers', { action: 'revoke-event-manager', id: String(dual.id) });
    const page = await adminBrowser.get('/admin/teachers');
    assert.match(page.html, /Viðburðastjóraréttindi tekin af: Rósa Revoked/);
    assert.deepEqual(site.db.prepare('SELECT role, is_event_manager FROM users WHERE id = ?').get(dual.id), { role: 'student', is_event_manager: 0 });
    assert.deepEqual(site.db.prepare(`SELECT action, actor_id, student_id FROM audit_log WHERE action = 'event-manager.revoke' ORDER BY id DESC LIMIT 1`).get(), {
      action: 'event-manager.revoke', actor_id: admin.id, student_id: dual.id,
    });

    assert.equal(site.db.prepare('SELECT COUNT(*) FROM sessions WHERE user_id = ?').pluck().get(dual.id), beforeSessions);
    assert.equal((await dualBrowser.get('/my-events')).status, 200);
    assert.equal((await dualBrowser.get('/teacher')).status, 403);
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM events WHERE id = ? AND owner_id = ?').pluck().get(ownId, dual.id), 1);
  });

  test('a promoted student Event Manager cannot access admin pages', async () => {
    const dual = await site.addUser({ role: 'student', name: 'Stína Stjórnlaus' });
    await adminBrowser.post('/admin/teachers', { action: 'promote-event-manager', id: String(dual.id) });
    const dualBrowser = site.browser();
    await dualBrowser.login(dual.kennitala, dual.code);
    assert.equal((await dualBrowser.get('/admin')).status, 403);
    assert.equal((await dualBrowser.post('/admin/teachers', { action: 'promote-event-manager', id: String(student.id) })).status, 403);
  });

  test('the teacher list shows name, email, admin and active, sorted by name', async () => {
    const page = await adminBrowser.get('/admin/teachers');
    const names = [...page.html.matchAll(/<tr>\s*<td>([^<]+?)(?: \(þú\))?<\/td>/g)].map((m) => m[1]);
    assert.deepEqual(names, [...names].sort(new Intl.Collator('is').compare));
    assert.ok(names.includes('Óli Óvirki') && names.includes('Jón Kennari'));
    assert.match(page.html, /<th scope="col">Tegund aðgangs<\/th>/);
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
