import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toIso } from '../src/db/index.js';
import { hashCode } from '../src/services/codes.js';
import { brautList, holdImport, HOLD_MS, readStudentCsv, takeImport } from '../src/services/import.js';
import { startSite } from './helpers.js';

const HEADER = 'kennitala;nafn;netfang;braut;afangi';
const csv = (...lines) => Buffer.from([HEADER, ...lines].join('\n'));

// Encodes text the way Excel saves a CSV in Windows-1252. Only the letters these tests use.
const CP1252 = { á: 0xe1, ð: 0xf0, é: 0xe9, í: 0xed, Í: 0xcd, ó: 0xf3, ú: 0xfa, ý: 0xfd, þ: 0xfe, Þ: 0xde, æ: 0xe6, Æ: 0xc6, ö: 0xf6 };
const windows1252 = (text) => Buffer.from([...text].map((c) => {
  const byte = CP1252[c] ?? c.charCodeAt(0);
  assert.ok(byte < 256, `cannot encode ${c}`);
  return byte;
}));

let site;
let adminAccount;
let admin;

before(async () => {
  site = await startSite();
  adminAccount = await site.addUser({ isAdmin: true, name: 'Anna Stjórnandi' });
  admin = site.browser();
  await admin.login(adminAccount.kennitala, adminAccount.code);
});

after(() => site.close());

const read = (bytes) => readStudentCsv(bytes, { db: site.db, kt: site.kt });
const errorList = (result) => result.errors.map((e) => `${e.params.line ?? '-'} ${e.key.replace('import.errors.', '')}`);
const student = (kennitala) => site.db.prepare('SELECT * FROM users WHERE kennitala_hmac = ?').get(site.kt.hmac(kennitala));
const courses = (id) => new Set(site.db.prepare('SELECT course_code FROM student_courses WHERE user_id = ?').pluck().all(id));
const studentCount = () => site.db.prepare("SELECT COUNT(*) FROM users WHERE role = 'student'").pluck().get();

describe('reading the student CSV (BR-14, AGENT_START §8)', () => {
  test('BR-14: one row per student per course becomes one student with a course list', () => {
    const result = read(csv(
      '0000000301;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;STÆR2BH05',
      '0000000301;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;ÍSLE2MB05',
      '000000-0302;Páll Pálsson;pall@example.is;Starfsbraut;',
    ));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.students.map(({ kennitala, name, email, braut, courses: list }) => ({ kennitala, name, email, braut, list })), [
      { kennitala: '0000000301', name: 'Jóna Jónsdóttir', email: 'jona@example.is', braut: 'Rafmagnsbraut', list: ['STÆR2BH05', 'ÍSLE2MB05'] },
      { kennitala: '0000000302', name: 'Páll Pálsson', email: 'pall@example.is', braut: 'Starfsbraut', list: [] },
    ]);
  });

  test('BR-14: a comma delimiter is detected from the header line', () => {
    const result = read(Buffer.from('kennitala,nafn,netfang,braut,afangi\n0000000301,"Jónsdóttir, Jóna",jona@example.is,,STÆR2BH05\n'));
    assert.deepEqual(result.errors, []);
    assert.equal(result.students[0].name, 'Jónsdóttir, Jóna');
    assert.equal(result.students[0].braut, null, 'an empty braut is allowed');
  });

  test('BR-14: UTF-8 with a BOM, and Windows-1252 from Excel, keep the Icelandic letters', () => {
    const line = '0000000301;Þórunn Ævarsdóttir;thorunn@example.is;Íþróttabraut;ÍSLE2MB05';
    const withBom = read(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv(line)]));
    assert.deepEqual(withBom.errors, []);
    assert.equal(withBom.students[0].kennitala, '0000000301', 'the BOM does not end up in the header or first field');

    const excel = read(windows1252(`${HEADER}\r\n${line}\r\n`));
    assert.deepEqual(excel.errors, []);
    assert.equal(excel.students[0].name, 'Þórunn Ævarsdóttir');
    assert.equal(excel.students[0].braut, 'Íþróttabraut');
    assert.deepEqual(excel.students[0].courses, ['ÍSLE2MB05']);
  });

  test('BR-16: every bad row is reported with its line number', () => {
    const result = read(csv(
      '0000000301;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;STÆR2BH05', // line 2: fine
      '12345;Páll Pálsson;pall@example.is;Starfsbraut;', // line 3
      '0000000303;;not-an-email;Starfsbraut;', // line 4: two errors
      '',
      '0000000304;Sara;sara@example.is', // line 6: too few columns
      '0000000301;Jóna Jónsdóttir;jona@example.is;Starfsbraut;ÍSLE2MB05', // line 7: other braut than line 2
      '0000000305;Óli;oli@example.is;Starfsbraut;A;extra', // line 8: too many columns
    ));
    assert.deepEqual(errorList(result), ['3 kennitala', '4 name', '4 email', '6 columns', '7 mismatch', '8 columns']);
    assert.equal(result.errors.find((e) => e.key === 'import.errors.mismatch').params.first, 2);
  });

  test('BR-14: the header must be the agreed columns', () => {
    assert.deepEqual(errorList(read(Buffer.from('kt;nafn;netfang;braut;afangi\n0000000301;J;j@example.is;;\n'))), ['1 header']);
    assert.deepEqual(errorList(read(Buffer.from('nafn;kennitala;netfang;braut;afangi\n'))), ['1 header']);
    assert.deepEqual(errorList(read(Buffer.from(''))), ['1 header']);
    assert.deepEqual(errorList(read(Buffer.from('KENNITALA;Nafn;Netfang;Braut;Afangi\n0000000301;J;j@example.is;;\n'))), [],
      'capital letters in the header are fine');
  });

  test('BR-14: a file with only the header, or a broken quote, is reported', () => {
    assert.deepEqual(errorList(read(csv())), ['- noStudents']);
    assert.deepEqual(errorList(read(csv('0000000301;"Jóna;jona@example.is;R;A'))), ['2 unreadable']);
  });

  test('BR-12: a kennitala that belongs to a teacher cannot be imported as a student', () => {
    const result = read(csv(`${adminAccount.kennitala};Anna;anna@example.is;;`));
    assert.deepEqual(errorList(result), ['2 teacher']);
  });
});

describe('the import page (BR-14 to BR-18)', () => {
  beforeEach(() => {
    site.db.exec("DELETE FROM users WHERE role = 'student'; DELETE FROM events; DELETE FROM audit_log");
  });

  const tokenFrom = (html) => /name="token" value="([^"]+)"/.exec(html)[1];
  const page = async () => (await admin.get('/admin/import')).html;

  async function importFile(bytes) {
    const preview = await admin.upload('/admin/import', bytes);
    assert.equal(preview.status, 200, preview.html);
    const res = await admin.post('/admin/import', { action: 'confirm', token: tokenFrom(preview.html) });
    assert.deepEqual([res.status, res.location], [303, '/admin/import']);
    return preview;
  }

  test('BR-16: a file with several bad rows lists every error and saves nothing', async () => {
    const res = await admin.upload('/admin/import', csv(
      '0000000301;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;STÆR2BH05',
      '123;Páll;pall@example.is;Starfsbraut;',
      '0000000303;Sara;sara@;Starfsbraut;',
    ));
    assert.equal(res.status, 400);
    assert.match(res.html, /Skráin var ekki flutt inn og ekkert var vistað\. Lagaðu þessar villur \(2\)/);
    assert.match(res.html, /<li>Lína 3: kennitala verður að vera 10 tölustafir<\/li>\s*<li>Lína 4: netfangið er ekki gilt<\/li>/);
    assert.doesNotMatch(res.html, /0000000301|name="token"/);
    assert.equal(studentCount(), 0);
  });

  test('BR-14, BR-15: a valid file shows a summary, and nothing is saved until the admin confirms', async () => {
    const preview = await admin.upload('/admin/import', csv(
      '0000000301;Jóna Zxqvbnmsdóttir;jona@example.is;Rafmagnsbraut;STÆR2BH05',
      '0000000302;Páll Pálsson;pall@example.is;Starfsbraut;',
    ));
    assert.equal(preview.status, 200);
    assert.match(preview.html, /Skráin er í lagi: 2 nemendur/);
    assert.match(preview.html, /Nýir nemendur: 2/);
    assert.equal(studentCount(), 0, 'nothing saved yet');
    // BR-15: the uploaded file is not in the database, nor anywhere next to it.
    site.db.pragma('wal_checkpoint(TRUNCATE)');
    for (const file of fs.readdirSync(site.dbFile.replace(/[\\/][^\\/]+$/, ''))) {
      const bytes = fs.readFileSync(`${site.dbFile.replace(/[\\/][^\\/]+$/, '')}/${file}`);
      assert.equal(bytes.includes('Zxqvbnmsdóttir'), false, file);
    }

    const res = await admin.post('/admin/import', { action: 'confirm', token: tokenFrom(preview.html) });
    assert.deepEqual([res.status, res.location], [303, '/admin/import']);
    assert.match(await page(), /Innflutningi lokið: 2 nýir, 0 uppfærðir, 0 óvirkir og 0 skráningar fjarlægðar\./);
    const jona = student('0000000301');
    assert.deepEqual([jona.role, jona.active, jona.name, jona.braut, jona.code_hash], ['student', 1, 'Jóna Zxqvbnmsdóttir', 'Rafmagnsbraut', null]);
    assert.equal(site.kt.decrypt(jona.kennitala_enc), '0000000301');
    assert.deepEqual(courses(jona.id), new Set(['STÆR2BH05']));
    assert.equal(student('0000000302').braut, 'Starfsbraut');
  });

  test('BR-17: a re-import updates, reactivates and deactivates; missing students lose their sign-ups without attendance', async () => {
    await importFile(csv(
      '0000000301;Anna Nemandi;anna@example.is;Rafmagnsbraut;STÆR2BH05',
      '0000000302;Bjarni Nemandi;bjarni@example.is;Starfsbraut;ENSK2LS05',
      '0000000303;Clara Nemandi;clara@example.is;Starfsbraut;',
    ));
    const [anna, bjarni, clara] = ['0000000301', '0000000302', '0000000303'].map(student);
    site.db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(clara.id); // left in an earlier import

    const now = toIso();
    const event = site.db.prepare(`INSERT INTO events (owner_id, status, title_is, description_is, host, capacity, event_date,
      start_time, end_time, location, created_at, updated_at) VALUES (?, 'published', ?, 'Lýsing', 'Gestgjafi', 10,
      '2027-03-11', ?, ?, 'Stofa', ?, ?)`);
    const morning = Number(event.run(adminAccount.id, 'Morgunviðburður', '09:00', '10:00', now, now).lastInsertRowid);
    const noon = Number(event.run(adminAccount.id, 'Hádegisviðburður', '12:00', '13:00', now, now).lastInsertRowid);
    const register = site.db.prepare(`INSERT INTO registrations (event_id, student_id, created_at, attended, course_code)
      VALUES (?, ?, ?, ?, ?)`);
    register.run(morning, bjarni.id, now, 0, null);
    register.run(noon, bjarni.id, now, 1, 'ENSK2LS05');
    register.run(morning, anna.id, now, 0, null);

    // Bjarni is logged in when the import runs.
    site.db.prepare('UPDATE users SET code_hash = ? WHERE id = ?').run(await hashCode('123456'), bjarni.id);
    const bjarniBrowser = site.browser();
    assert.equal((await bjarniBrowser.login('0000000302', '123456')).location, '/my-events');

    const preview = await importFile(csv(
      '0000000301;Anna Jónsdóttir;anna.j@example.is;Starfsbraut;ÍSLE2MB05',
      '0000000301;Anna Jónsdóttir;anna.j@example.is;Starfsbraut;DANS2AA05',
      '0000000303;Clara Nemandi;clara@example.is;Starfsbraut;',
      '0000000304;Davíð Nýr;david@example.is;Rafmagnsbraut;',
    ));
    assert.match(preview.html, /Nýir nemendur: 1<\/li>\s*<li>Nemendur sem eru uppfærðir: 2<\/li>\s*<li>Nemendur sem verða óvirkir: 1<\/li>\s*<li>Skráningar sem verða fjarlægðar: 1<\/li>/);

    const annaNow = student('0000000301');
    assert.deepEqual([annaNow.name, annaNow.email, annaNow.braut, annaNow.active], ['Anna Jónsdóttir', 'anna.j@example.is', 'Starfsbraut', 1]);
    assert.deepEqual(courses(anna.id), new Set(['ÍSLE2MB05', 'DANS2AA05']), 'the course list is replaced');
    assert.equal(student('0000000303').active, 1, 'every student in the file becomes active');
    assert.equal(student('0000000304').name, 'Davíð Nýr');

    assert.equal(student('0000000302').active, 0, 'missing from the file: inactive');
    assert.equal(site.db.prepare('SELECT COUNT(*) FROM sessions WHERE user_id = ?').pluck().get(bjarni.id), 0);
    assert.equal((await bjarniBrowser.get('/my-events')).location, '/login');
    assert.equal((await site.browser().login('0000000302', '123456')).status, 401, 'BR-03: cannot log in');

    const signups = site.db.prepare('SELECT event_id, student_id, attended, course_code FROM registrations ORDER BY event_id, student_id').all();
    assert.deepEqual(signups, [
      { event_id: morning, student_id: anna.id, attended: 0, course_code: null },
      { event_id: noon, student_id: bjarni.id, attended: 1, course_code: 'ENSK2LS05' },
    ], "Bjarni's sign-up without attendance is gone; his attended one and its course choice stay");
    assert.deepEqual(site.db.prepare('SELECT actor_id, action, event_id, student_id FROM audit_log').all(), [
      { actor_id: adminAccount.id, action: 'signup.delete', event_id: morning, student_id: bjarni.id },
    ], 'BR-56: the removed sign-up is in the audit log');
  });

  test('BR-16: the confirm applies everything or nothing', async () => {
    const preview = await admin.upload('/admin/import', csv(
      '0000000311;Ein Nemandi;ein@example.is;;',
      '0000000312;Tveir Nemandi;tveir@example.is;;',
    ));
    // A teacher account gets one of the kennitölur between the upload and the confirm.
    await site.addUser({ kennitala: '0000000312' });
    const res = await admin.post('/admin/import', { action: 'confirm', token: tokenFrom(preview.html) });
    assert.equal(res.status, 400);
    assert.match(res.html, /Kennari er kominn með eina af kennitölunum í skránni/);
    assert.equal(studentCount(), 0);
    site.db.prepare('DELETE FROM users WHERE kennitala_hmac = ?').run(site.kt.hmac('0000000312'));
  });

  test('BR-15: a checked file is kept in memory for at most 10 minutes', (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2027-01-10T10:00:00Z') });
    assert.equal(HOLD_MS, 10 * 60 * 1000);
    const kept = holdImport([{ kennitala: '0000000301' }]);
    assert.deepEqual(takeImport(kept), [{ kennitala: '0000000301' }]);
    assert.equal(takeImport(kept), null, 'it can be confirmed only once');

    const expired = holdImport([{ kennitala: '0000000302' }]);
    t.mock.timers.tick(HOLD_MS);
    assert.equal(takeImport(expired), null);
  });

  test('BR-15, §8: a confirm from another session, a second confirm, or a cancel saves nothing', async () => {
    const preview = await admin.upload('/admin/import', csv('0000000321;Nemandi;n@example.is;;'));
    const token = tokenFrom(preview.html);

    const otherAccount = await site.addUser({ isAdmin: true });
    const other = site.browser();
    await other.login(otherAccount.kennitala, otherAccount.code);
    const stolen = await other.post('/admin/import', { action: 'confirm', token });
    assert.equal(stolen.status, 400);
    assert.match(stolen.html, /Innflutningurinn rann út eða var þegar staðfestur/);

    const cancel = await admin.post('/admin/import', { action: 'cancel', token });
    assert.equal(cancel.location, '/admin/import');
    assert.match(await page(), /Hætt var við innflutninginn\. Ekkert var vistað\./);
    const late = await admin.post('/admin/import', { action: 'confirm', token });
    assert.equal(late.status, 400);
    assert.equal(studentCount(), 0);
  });

  test('BR-15: files over 5 MB, and a missing file, are refused', async () => {
    const tooBig = await admin.upload('/admin/import', Buffer.concat([csv(), Buffer.alloc(5 * 1024 * 1024, 0x20)]));
    assert.equal(tooBig.status, 400);
    assert.match(tooBig.html, /Skráin er of stór\. Hámarkið er 5 MB\./);

    const form = new FormData();
    form.append('_csrf', await admin.csrfToken());
    const none = await admin.request('POST', '/admin/import', form);
    assert.equal(none.status, 400);
    assert.match(none.html, /<p class="field__error" id="file-error">Veldu skrá til að hlaða upp\.<\/p>/);
    assert.match(none.html, /aria-describedby="file-hint file-error" aria-invalid="true"/);
    assert.equal(studentCount(), 0);
  });

  test('§9 item 3: the upload needs the CSRF token, and other forms cannot be sent as multipart', async () => {
    const noToken = await admin.upload('/admin/import', csv('0000000331;Nemandi;n@example.is;;'), { token: null });
    assert.equal(noToken.status, 403);
    const wrongToken = await admin.upload('/admin/import', csv('0000000331;Nemandi;n@example.is;;'), { token: 'x'.repeat(43) });
    assert.equal(wrongToken.status, 403);

    for (const path of ['/logout', '/admin/teachers', '/admin/settings']) {
      const res = await admin.upload(path, Buffer.from('x'));
      assert.equal(res.status, 403, path);
    }
    assert.equal((await admin.get('/admin')).status, 200, 'still logged in');
    assert.equal(studentCount(), 0);
  });

  test('BR-18: the braut list is the distinct brautir of active students', async () => {
    await importFile(csv(
      '0000000341;Ein;ein@example.is;Starfsbraut;',
      '0000000342;Tveir;tveir@example.is;Rafmagnsbraut;',
      '0000000343;Þrír;thrir@example.is;Starfsbraut;',
      '0000000344;Fjórir;fjorir@example.is;;',
      '0000000345;Fimm;fimm@example.is;Íþróttabraut;',
    ));
    site.db.prepare('UPDATE users SET active = 0 WHERE kennitala_hmac = ?').run(site.kt.hmac('0000000345'));
    assert.deepEqual(brautList(site.db), ['Rafmagnsbraut', 'Starfsbraut']);
    assert.match(await page(), /Virkir nemendur: 4\.\s*Brautir: Rafmagnsbraut, Starfsbraut\./);
  });

  test('BR-14, §9 item 8: only admins can import', async () => {
    const account = await site.addUser();
    const teacher = site.browser();
    await teacher.login(account.kennitala, account.code);
    assert.equal((await teacher.get('/admin/import')).status, 403);
    assert.equal((await teacher.upload('/admin/import', csv('0000000351;Nemandi;n@example.is;;'))).status, 403);
    assert.equal(studentCount(), 0);
  });
});
