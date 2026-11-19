import { POINTS_PER_ATTENDANCE } from '../config.js';
import { toIso } from '../db/index.js';
import { choiceWindow } from './choices.js';

// BR-48 and AGENT_START §8 "Absence-system handoff": the office export. UTF-8 with a BOM, ';' as
// the delimiter and CRLF after every line, so that it opens correctly in Excel with Icelandic settings.
const collator = new Intl.Collator('is');
const BOM = '﻿';
const CRLF = '\r\n';
const HEADER = ['kennitala', 'nafn', 'braut', 'afangi', 'stig', 'vidburdur', 'dagsetning'];

// A text value a spreadsheet would run as a formula is shown as text instead (CSV injection), and a
// value holding the delimiter, a quote or a line break is quoted, with its quotes doubled.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[;"\r\n]/;

function textField(value) {
  let text = String(value ?? '');
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// One row per marked attendance (BR-48), whoever the student is: an inactive student's attendance
// still counts (BR-17). The kennitala is decrypted here and nowhere else (BR-19); it is written as
// 6 digits, a hyphen and 4 digits, which a spreadsheet keeps as text with any leading zero. Never
// log it. Sorted by name in Icelandic order, then by student, so that two students with the same
// name are not mixed, then by date, start time and sign-up.
export function exportRows(db, kt) {
  const rows = db.prepare(`SELECT u.kennitala_enc, u.name, u.braut, r.course_code, e.title_is, e.event_date
    FROM registrations r
    JOIN users u ON u.id = r.student_id
    JOIN events e ON e.id = r.event_id
    WHERE r.attended = 1
    ORDER BY u.id, e.event_date, e.start_time, r.id`).all();
  // The sort is stable, so rows with the same name keep the query's order: student, then date and
  // start time. Each student's rows stay together.
  rows.sort((a, b) => collator.compare(a.name, b.name));
  return rows.map((row) => {
    const digits = kt.decrypt(row.kennitala_enc);
    return {
      kennitala: `${digits.slice(0, 6)}-${digits.slice(6)}`,
      name: row.name,
      braut: row.braut ?? '',
      course: row.course_code ?? '',
      points: POINTS_PER_ATTENDANCE, // BR-40; the site stores no balances (BR-46)
      event: row.title_is,
      date: row.event_date,
    };
  });
}

// The file's text, starting with the byte order mark.
export function exportCsv(rows) {
  const lines = [
    HEADER.join(';'),
    ...rows.map((row) => [
      row.kennitala, textField(row.name), textField(row.braut), textField(row.course), row.points, textField(row.event), row.date,
    ].join(';')),
  ];
  return BOM + lines.map((line) => line + CRLF).join('');
}

// BR-49: what the export page says. The file is final once the course-choice deadline has passed,
// because attendance and course choices can no longer change (BR-39, BR-44).
export function exportSummary(db, now = new Date()) {
  const counts = db.prepare(`SELECT COUNT(*) AS total, COUNT(*) - COUNT(course_code) AS without_course
    FROM registrations WHERE attended = 1`).get();
  const { deadline, open } = choiceWindow(db, now);
  return {
    rows: counts.total,
    withoutCourse: counts.without_course,
    deadline: deadline ?? null,
    final: Boolean(deadline) && !open,
  };
}

// The download date in UTC, which is Iceland's time all year.
export function exportFileName(now = new Date()) {
  return `saeludagar-fjarvistir-${toIso(now).slice(0, 10)}.csv`;
}
