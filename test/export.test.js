// Milestone 7: the office export (BR-45, BR-46, BR-48, BR-49 and AGENT_START §8 "Absence-system
// handoff"). Only fake people and fake kennitölur.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { POINTS_PER_ATTENDANCE } from '../src/config.js';
import { toIso } from '../src/db/index.js';
import { givePoints } from '../src/services/choices.js';
import { exportCsv, exportFileName, exportRows, exportSummary } from '../src/services/export.js';
import { insertEvent, startSite } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const HEADER = 'kennitala;nafn;braut;afangi;stig;vidburdur;dagsetning;merkt_af';
let site;
const people = {};
const as = {};

before(async () => {
  site = await startSite();
  const add = async (key, fields, { braut = null, login = false } = {}) => {
    people[key] = await site.addUser(fields);
    site.db.prepare('UPDATE users SET braut = ? WHERE id = ?').run(braut, people[key].id);
    if (login) {
      as[key] = site.browser();
      await as[key].login(people[key].kennitala, people[key].code);
    }
  };
  await add('teacher', { name: 'Kennari Prófun', email: 'kennari@example.is' }, { login: true });
  await add('admin', { name: 'Stefán Stjórnandi', email: 'stefan@example.is', isAdmin: true }, { login: true });
  // Names that only Icelandic order sorts right: Anna, Ásta, Zoë, Þór, Örn.
  await add('orn', { role: 'student', kennitala: '0000000015', name: 'Örn Prófun', email: 'orn@example.is' }, { braut: 'Náttúrufræðibraut' });
  await add('anna', { role: 'student', kennitala: '0000000011', name: 'Anna Prófun', email: 'anna@example.is' },
    { braut: 'Félagsvísindabraut', login: true });
  await add('thor', { role: 'student', kennitala: '0000000014', name: 'Þór Prófun', email: 'thor@example.is', active: false },
    { braut: 'Náttúrufræðibraut' });
  await add('asta', { role: 'student', kennitala: '0000000012', name: 'Ásta Prófun', email: 'asta@example.is' });
  await add('zoe', { role: 'student', kennitala: '0000000013', name: 'Zoë Prófun', email: 'zoe@example.is' }, { braut: 'Listnámsbraut' });
  as.guest = site.browser();
});

after(() => site.close());

beforeEach(() => {
  site.db.exec('DELETE FROM registrations; DELETE FROM events; DELETE FROM audit_log; DELETE FROM student_courses');
  site.db.prepare('UPDATE settings SET choice_deadline_at = NULL').run();
});

const signUp = (eventId, key, attended = 1, course = null) => site.db.prepare(`INSERT INTO registrations
  (event_id, student_id, created_at, attended, course_code) VALUES (?, ?, ?, ?, ?)`).run(eventId, people[key].id, toIso(), attended, course);
const setDeadline = (date) => site.db.prepare('UPDATE settings SET choice_deadline_at = ?').run(date ? toIso(date) : null);
const formatted = (kennitala) => `${kennitala.slice(0, 6)}-${kennitala.slice(6)}`;
const STUDENTS = ['anna', 'asta', 'zoe', 'thor', 'orn'];

// Three events, and sign-ups made out of order, so the file's order can only come from the sort.
function seed() {
  const event = (fields) => insertEvent(site.db, people.teacher.id, fields);
  const walk = event({ title_is: 'Gönguferð á Esjuna', title_en: 'A walk up Esja', event_date: '2027-03-12', start_time: '09:00', end_time: '12:00' });
  const quiz = event({ title_is: 'Spurningakeppni; "Gettu betur"', event_date: '2027-03-11', start_time: '13:00', end_time: '15:00' });
  const excel = event({ title_is: '=Excel fyrir byrjendur', event_date: '2027-03-11', start_time: '10:00', end_time: '12:00' });
  signUp(walk, 'thor', 1, 'ENSK2LS05'); // made inactive since: still in the file (BR-17)
  signUp(walk, 'anna', 1, 'ENSK2LS05');
  signUp(quiz, 'anna', 1); // no course chosen
  signUp(quiz, 'orn', 1, 'DANS2MO05');
  signUp(walk, 'orn', 0); // signed up, attendance not marked: not in the file
  signUp(excel, 'zoe', 1); // no course chosen
  signUp(quiz, 'asta', 1, 'STÆR2BH05'); // no braut
  signUp(excel, 'anna', 1, 'ÍSLE2MB05');
}

// The file as the office gets it, byte for byte.
const SEEDED_FILE = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from([
    'kennitala;nafn;braut;afangi;stig;vidburdur;dagsetning;merkt_af\r\n',
    "000000-0011;Anna Prófun;Félagsvísindabraut;ÍSLE2MB05;4;'=Excel fyrir byrjendur;2027-03-11;\r\n",
    '000000-0011;Anna Prófun;Félagsvísindabraut;;4;"Spurningakeppni; ""Gettu betur""";2027-03-11;\r\n',
    '000000-0011;Anna Prófun;Félagsvísindabraut;ENSK2LS05;4;Gönguferð á Esjuna;2027-03-12;\r\n',
    '000000-0012;Ásta Prófun;;STÆR2BH05;4;"Spurningakeppni; ""Gettu betur""";2027-03-11;\r\n',
    "000000-0013;Zoë Prófun;Listnámsbraut;;4;'=Excel fyrir byrjendur;2027-03-11;\r\n",
    '000000-0014;Þór Prófun;Náttúrufræðibraut;ENSK2LS05;4;Gönguferð á Esjuna;2027-03-12;\r\n',
    '000000-0015;Örn Prófun;Náttúrufræðibraut;DANS2MO05;4;"Spurningakeppni; ""Gettu betur""";2027-03-11;\r\n',
  ].join(''), 'utf8'),
]);

// Browser.request reads the body as text, which drops the byte order mark, so the file is
// fetched here with the browser's cookies and read as bytes.
async function download(browser = as.admin) {
  const cookie = [...browser.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const res = await fetch(`${site.baseUrl}/admin/export.csv`, { headers: { cookie }, redirect: 'manual' });
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

// The file's lines without the byte order mark and the final CRLF.
function lines(bytes) {
  const text = bytes.toString('utf8');
  assert.ok(text.startsWith('﻿'), 'no byte order mark');
  assert.ok(text.endsWith('\r\n'), 'the last line has no CRLF');
  return text.slice(1, -2).split('\r\n');
}

describe('the export file (BR-48, AGENT_START §8)', () => {
  test('BR-48, BR-17: one row per marked attendance, in Icelandic name order, then by date and time, byte for byte', async () => {
    seed();
    const { res, bytes } = await download();
    assert.equal(res.status, 200);
    assert.deepEqual(bytes, SEEDED_FILE);
  });

  test('BR-48, §8: the file is sent as UTF-8 CSV, as an attachment named after the download date, never cached', async () => {
    const before = exportFileName();
    const { res } = await download();
    const names = [before, exportFileName()].map((name) => `attachment; filename="${name}"`);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.ok(names.includes(res.headers.get('content-disposition')), res.headers.get('content-disposition'));
    assert.match(before, /^saeludagar-fjarvistir-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('BR-48, §8: the file name uses the download date in UTC', () => {
    assert.equal(exportFileName(new Date('2027-03-11T23:59:59Z')), 'saeludagar-fjarvistir-2027-03-11.csv');
    assert.equal(exportFileName(new Date('2027-03-12T00:00:00Z')), 'saeludagar-fjarvistir-2027-03-12.csv');
  });

  test('BR-48: with no marked attendance the file has only its header row', async () => {
    const event = insertEvent(site.db, people.teacher.id);
    signUp(event, 'anna', 0);
    const { bytes } = await download();
    assert.deepEqual(bytes, Buffer.from(`﻿${HEADER}\r\n`, 'utf8'));
  });

  test('BR-45: a marked attendance and the student\'s course go straight into the file, with no approval step', async () => {
    // A past date, so that attendance can be marked now (BR-39).
    const event = insertEvent(site.db, people.teacher.id, { title_is: 'Bakstur', event_date: '2026-03-11' });
    signUp(event, 'anna', 0);
    site.db.prepare('INSERT INTO student_courses (user_id, course_code) VALUES (?, ?)').run(people.anna.id, 'ENSK2LS05');
    assert.deepEqual(lines((await download()).bytes), [HEADER]);

    const marked = await as.teacher.post(`/teacher/events/${event}/attendance`, { student: people.anna.id, attended: '1' });
    assert.equal(marked.status, 303);
    assert.deepEqual(lines((await download()).bytes), [HEADER, '000000-0011;Anna Prófun;Félagsvísindabraut;;4;Bakstur;2026-03-11;kennari']);

    assert.deepEqual(givePoints(site.db, people.anna.id, 'ENSK2LS05'), { ok: true });
    assert.deepEqual(lines((await download()).bytes), [HEADER, '000000-0011;Anna Prófun;Félagsvísindabraut;ENSK2LS05;4;Bakstur;2026-03-11;kennari']);

    const unmarked = await as.teacher.post(`/teacher/events/${event}/attendance`, { student: people.anna.id, attended: '0' });
    assert.equal(unmarked.status, 303);
    assert.deepEqual(lines((await download()).bytes), [HEADER]);
  });

  test('BR-48: the last column says whether a teacher or a student event manager marked the attendance, and is empty once that account is gone', async () => {
    const event = insertEvent(site.db, people.teacher.id, { title_is: 'Bakstur', event_date: '2026-03-11' });
    const marker = await site.addUser({ name: 'Kennari Sem Hættir', email: 'haettir@example.is' });
    const manager = await site.addUser({ role: 'student', name: 'Sigga Stjórnandi', email: 'sigga@example.is' });
    site.db.prepare('UPDATE users SET is_event_manager = 1 WHERE id = ?').run(manager.id);
    for (const account of [marker, manager]) {
      site.db.prepare('INSERT INTO event_coteachers (event_id, teacher_id) VALUES (?, ?)').run(event, account.id);
    }
    signUp(event, 'anna', 0);
    signUp(event, 'zoe', 0);
    const markAs = async (account, key) => {
      const browser = site.browser();
      await browser.login(account.kennitala, account.code);
      const res = await browser.post(`/teacher/events/${event}/attendance`, { student: people[key].id, attended: '1' });
      assert.equal(res.status, 303);
    };
    await markAs(marker, 'anna');
    await markAs(manager, 'zoe');
    assert.deepEqual(lines((await download()).bytes), [
      HEADER,
      '000000-0011;Anna Prófun;Félagsvísindabraut;;4;Bakstur;2026-03-11;kennari',
      '000000-0013;Zoë Prófun;Listnámsbraut;;4;Bakstur;2026-03-11;nemandi',
    ]);
    assert.deepEqual(exportRows(site.db, site.kt).map((row) => row.markedBy), ['kennari', 'nemandi']);

    site.db.prepare('DELETE FROM event_coteachers WHERE teacher_id = ?').run(marker.id);
    site.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(marker.id);
    site.db.prepare('DELETE FROM users WHERE id = ?').run(marker.id);
    assert.deepEqual(lines((await download()).bytes).slice(1), [
      '000000-0011;Anna Prófun;Félagsvísindabraut;;4;Bakstur;2026-03-11;',
      '000000-0013;Zoë Prófun;Listnámsbraut;;4;Bakstur;2026-03-11;nemandi',
    ]);
    site.db.prepare('DELETE FROM event_coteachers WHERE event_id = ?').run(event);
  });

  test('BR-46, BR-40: every row carries 4 points, and no table has a column for a balance', async () => {
    seed();
    const rows = exportRows(site.db, site.kt);
    assert.equal(rows.length, 7);
    assert.equal(POINTS_PER_ATTENDANCE, 4);
    for (const row of rows) assert.equal(row.points, 4);
    for (const line of lines((await download()).bytes).slice(1)) assert.equal(line.split(';')[4], '4', line);

    const tables = site.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
    assert.ok(tables.includes('registrations') && tables.includes('users'));
    for (const table of tables) {
      for (const column of site.db.prepare('SELECT name FROM pragma_table_info(?)').pluck().all(table)) {
        assert.doesNotMatch(column, /balance|stada|inneign/i, `${table}.${column}`);
      }
    }
  });

  test('BR-48: exportRows gives each row its fields, with an empty braut and course when there is none', () => {
    seed();
    const rows = exportRows(site.db, site.kt);
    assert.deepEqual(rows[3], {
      kennitala: '000000-0012', name: 'Ásta Prófun', braut: '', course: 'STÆR2BH05', points: 4,
      event: 'Spurningakeppni; "Gettu betur"', date: '2027-03-11', markedBy: '',
    });
    assert.deepEqual(rows.map((row) => row.name), [
      'Anna Prófun', 'Anna Prófun', 'Anna Prófun', 'Ásta Prófun', 'Zoë Prófun', 'Þór Prófun', 'Örn Prófun',
    ]);
    assert.equal(rows[4].course, '');
  });

  test('BR-48: two students with the same name each keep their rows together', async () => {
    // Both attend both events and sign up in turn, so that date order alone would interleave their rows.
    for (const [key, kennitala] of [['jon1', '0000000016'], ['jon2', '0000000017']]) {
      people[key] = await site.addUser({ role: 'student', kennitala, name: 'Jón Jónsson', email: `${key}@example.is` });
    }
    const first = insertEvent(site.db, people.teacher.id, { title_is: 'Bakstur', event_date: '2027-03-11' });
    const second = insertEvent(site.db, people.teacher.id, { title_is: 'Sund', event_date: '2027-03-12' });
    for (const event of [first, second]) {
      signUp(event, 'jon1');
      signUp(event, 'jon2');
    }
    assert.deepEqual(lines((await download()).bytes), [
      HEADER,
      '000000-0016;Jón Jónsson;;;4;Bakstur;2027-03-11;',
      '000000-0016;Jón Jónsson;;;4;Sund;2027-03-12;',
      '000000-0017;Jón Jónsson;;;4;Bakstur;2027-03-11;',
      '000000-0017;Jón Jónsson;;;4;Sund;2027-03-12;',
    ]);
  });
});

describe('exportCsv (BR-48)', () => {
  const row = (fields) => ({
    kennitala: '000000-0001', name: 'Nafn', braut: 'Braut', course: 'ENSK2LS05', points: 4, event: 'Viðburður', date: '2027-03-11', markedBy: '', ...fields,
  });
  const file = (...rows) => `﻿${HEADER}\r\n${rows.map((text) => `${text}\r\n`).join('')}`;
  // The event column as it is written for `value`.
  const eventField = (value) => {
    const text = exportCsv([row({ event: value })]);
    const prefix = `﻿${HEADER}\r\n000000-0001;Nafn;Braut;ENSK2LS05;4;`;
    const suffix = ';2027-03-11;\r\n';
    assert.ok(text.startsWith(prefix) && text.endsWith(suffix), JSON.stringify(text));
    return text.slice(prefix.length, -suffix.length);
  };

  test('BR-48: the header, then one line per row, each ending in CRLF, after a byte order mark', () => {
    assert.equal(exportCsv([]), `﻿${HEADER}\r\n`);
    assert.equal(exportCsv([row(), row({ course: '', braut: '' })]), file(
      '000000-0001;Nafn;Braut;ENSK2LS05;4;Viðburður;2027-03-11;',
      '000000-0001;Nafn;;;4;Viðburður;2027-03-11;',
    ));
  });

  test('BR-48: a value with ";", a double quote or a line break is quoted, with its quotes doubled', () => {
    assert.equal(eventField('Venjulegur titill'), 'Venjulegur titill');
    assert.equal(eventField('Ganga; hlaup'), '"Ganga; hlaup"');
    assert.equal(eventField('Sagt "halló"'), '"Sagt ""halló"""');
    assert.equal(eventField('lína 1\nlína 2'), '"lína 1\nlína 2"');
    assert.equal(eventField('lína 1\r\nlína 2'), '"lína 1\r\nlína 2"');
    assert.equal(eventField('a,b\tc'), 'a,b\tc');
  });

  test('BR-48, §9: a value a spreadsheet would run as a formula gets an apostrophe in front', () => {
    assert.equal(eventField('=1+1'), "'=1+1");
    assert.equal(eventField('+3545551234'), "'+3545551234");
    assert.equal(eventField('-5'), "'-5");
    assert.equal(eventField('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(eventField('\tflipi'), "'\tflipi");
    assert.equal(eventField('a=b+c-d@e'), 'a=b+c-d@e');
  });

  test('BR-48, §9: a value starting with "|" or a line break gets the apostrophe, and is quoted where needed', () => {
    assert.equal(eventField('|cmd'), "'|cmd");
    assert.equal(eventField('a|b'), 'a|b');
    assert.equal(eventField('\nx'), '"\'\nx"');
  });

  test('BR-48, §9: a value that needs both gets the apostrophe first and is then quoted', () => {
    assert.equal(eventField('=HYPERLINK("http://example.com";"smella")'), '"\'=HYPERLINK(""http://example.com"";""smella"")"');
    assert.equal(eventField('\rx'), '"\'\rx"');
    assert.equal(eventField('-1;2'), '"\'-1;2"');
  });

  test('BR-48: all four text columns are written safely, and the kennitala, points and date as they are', () => {
    assert.equal(exportCsv([row({ name: '=Nafn', braut: '+Braut', course: '-ÁFA1', event: '@"x"' })]),
      file(`000000-0001;'=Nafn;'+Braut;'-ÁFA1;4;"'@""x""";2027-03-11;`));
    assert.equal(exportCsv([row({ name: 'Jón; "Nonni"' })]), file('000000-0001;"Jón; ""Nonni""";Braut;ENSK2LS05;4;Viðburður;2027-03-11;'));
  });
});

describe('the export page (BR-49)', () => {
  test('BR-49: the page says provisional with no deadline and before it, final after it, and shows both counts', async () => {
    seed();
    let page = await as.admin.get('/admin/export');
    assert.equal(page.status, 200);
    assert.match(page.html, /<h1>Útflutningur fyrir skrifstofu<\/h1>/);
    assert.match(page.html, /<strong>Bráðabirgðaútgáfa<\/strong> Frestur til að velja áfanga hefur ekki verið settur/);
    assert.doesNotMatch(page.html, /Lokaútgáfa/);
    assert.match(page.html, /Línur í skránni: 7/);
    assert.match(page.html, /Línur án áfanga: 2/);
    assert.match(page.html, /Í þeim línum hefur nemandinn ekki sett stigin á áfanga/);
    assert.doesNotMatch(page.html, /Engin mæting hefur verið skráð enn/);
    assert.match(page.html, /<a class="button" href="\/admin\/export\.csv" download[^>]*>Sækja skrána \(CSV\)<\/a>/);
    assert.match(page.html, /Skráin inniheldur kennitölur\./);

    setDeadline(new Date(Date.now() + 24 * HOUR));
    page = await as.admin.get('/admin/export');
    assert.match(page.html, /<strong>Bráðabirgðaútgáfa<\/strong> Nemendur geta enn breytt vali á áfanga til /);
    assert.doesNotMatch(page.html, /Lokaútgáfa/);

    setDeadline(new Date(Date.now() - HOUR));
    page = await as.admin.get('/admin/export');
    assert.match(page.html, /<strong>Lokaútgáfa<\/strong> Fresturinn til að velja áfanga rann út /);
    assert.doesNotMatch(page.html, /Bráðabirgðaútgáfa/);
    assert.match(page.html, /Línur í skránni: 7/);
    assert.match(page.html, /Línur án áfanga: 2/);
  });

  test('BR-49: with no marked attendance the page says the file has only its header row', async () => {
    const page = await as.admin.get('/admin/export');
    assert.match(page.html, /Línur í skránni: 0/);
    assert.match(page.html, /Línur án áfanga: 0/);
    assert.match(page.html, /Engin mæting hefur verið skráð enn/);
    assert.doesNotMatch(page.html, /Í þeim línum hefur nemandinn/);
  });

  test('BR-49: exportSummary is final from the moment the deadline passes', () => {
    seed();
    const deadline = '2027-03-20T12:00:00Z';
    assert.deepEqual(exportSummary(site.db), { rows: 7, withoutCourse: 2, deadline: null, final: false });
    site.db.prepare('UPDATE settings SET choice_deadline_at = ?').run(deadline);
    assert.deepEqual(exportSummary(site.db, new Date('2027-03-20T11:59:59Z')), { rows: 7, withoutCourse: 2, deadline, final: false });
    assert.deepEqual(exportSummary(site.db, new Date(deadline)), { rows: 7, withoutCourse: 2, deadline, final: true });
  });
});

describe('who gets the export (AGENT_START §8, §9)', () => {
  test('§8, §9: only an admin gets the page or the file; a guest is sent to log in, a student or teacher gets 403', async () => {
    seed();
    for (const path of ['/admin/export', '/admin/export.csv']) {
      const guest = await as.guest.get(path);
      assert.deepEqual([guest.status, guest.location], [303, '/login'], `guest ${path}`);
      for (const role of ['anna', 'teacher']) {
        const res = await as[role].get(path);
        assert.equal(res.status, 403, `${role} ${path}`);
        for (const key of STUDENTS) assert.ok(!res.html.includes(formatted(people[key].kennitala)), `${role} ${path}`);
      }
      assert.equal((await as.admin.get(path)).status, 200, `admin ${path}`);
    }
  });

  test('BR-19, §9: the kennitala is in the file and nowhere on the page', async () => {
    seed();
    const text = (await download()).bytes.toString('utf8');
    const page = await as.admin.get('/admin/export');
    assert.equal(page.status, 200);
    for (const key of STUDENTS) {
      const { kennitala } = people[key];
      assert.ok(text.includes(`\r\n${formatted(kennitala)};`), `${key} not in the file`);
      assert.ok(!page.html.includes(kennitala) && !page.html.includes(formatted(kennitala)), `${key} on the page`);
    }
  });
});
