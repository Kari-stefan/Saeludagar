import path from 'node:path';
import ejs from 'ejs';
import nodemailer from 'nodemailer';
import { ROOT_DIR } from '../config.js';
import { toIso } from '../db/index.js';
import { eventText, formatDate, formatTimeRange, LANGUAGES, translator } from '../i18n/index.js';

const EMAIL_VIEWS = path.join(ROOT_DIR, 'src', 'views', 'emails');

// nodemailer's codes for a connection that timed out, dropped or could not be made. A wrong
// password (EAUTH) or a refused address is not one of them, so trying again would not help.
const NETWORK_ERRORS = new Set(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS']);

export const MESSAGE_INTERVAL_MS = 5 * 60 * 1000; // BR-50: one message per event every 5 minutes

// AGENT_START §8: SMTP when SMTP_HOST is set. Without it, development prints each email to the
// console instead; production never does, because emails contain login codes (§9, item 10).
export function createMailer(config, { log = console.log, retryDelayMs = 3000, timeoutMs = 15_000 } = {}) {
  const { host, port, secure, user, pass, from } = config.smtp;

  if (host) {
    if (!from) {
      throw new Error('MAIL_FROM is not set. Set it to the school\'s noreply address (see docs/run.md, "Environment variables").');
    }
    // Port 465 uses TLS from the start and 587 switches to it after connecting (RFC 8314). The
    // other way round, every send fails, so the server refuses to start instead.
    if (port === 465 && !secure) {
      throw new Error('SMTP_PORT is 465, so SMTP_SECURE must be true (see docs/run.md, "Environment variables").');
    }
    if (port === 587 && secure) {
      throw new Error('SMTP_PORT is 587, so SMTP_SECURE must be false (see docs/run.md, "Environment variables").');
    }
    // A mail server that does not answer (often a provider blocking mail ports) fails within
    // seconds instead of nodemailer's default two minutes, so the error shows up quickly.
    const transport = nodemailer.createTransport({
      host, port, secure, auth: user ? { user, pass } : undefined,
      connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs * 4,
    });
    const sendMail = (message) => transport.sendMail({ from, ...message });
    return {
      // A network hiccup is tried once more after a short pause, before the outbox counts the
      // send as failed and waits a minute (src/jobs/outbox.js).
      async send(message) {
        try {
          return await sendMail(message);
        } catch (err) {
          if (!NETWORK_ERRORS.has(err?.code)) throw err;
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          return sendMail(message);
        }
      },
    };
  }

  if (config.isProduction) {
    return {
      async send() {
        throw new Error('SMTP_HOST is not set, so emails cannot be sent.');
      },
    };
  }

  return {
    async send({ to, replyTo, subject, text }) {
      log([
        '--- Email (not sent, because SMTP_HOST is empty) ---',
        `To: ${to.name} <${to.address}>`,
        ...(replyTo ? [`Reply-To: ${replyTo.name} <${replyTo.address}>`] : []),
        `Subject: ${subject}`,
        '',
        text.trimEnd(),
        '--- End of email ---',
      ].join('\n'));
    },
  };
}

// BR-53: the worker sends the lowest priority number first. A login code is wanted by a person
// who is waiting (0), so no message can hold it back; event messages and notices go next (1);
// the bulk "Senda kóða" goes last (2). The priority belongs to the kind, so no caller picks it.
export const EMAIL_PRIORITY = {
  new_code: 0,
  teacher_code: 0,
  teacher_message: 1,
  event_changed: 1,
  event_deleted: 1,
  student_code: 2,
};

export function priorityOf(kind) {
  if (!(kind in EMAIL_PRIORITY)) throw new Error(`Unknown email kind: ${kind}`);
  return EMAIL_PRIORITY[kind];
}

// Every email goes through the outbox (BR-53). The payload holds what the template needs, such
// as an event's details; never a login code.
export function queueEmail(db, { kind, userId, payload = null }) {
  const now = toIso();
  db.prepare(`INSERT INTO email_outbox (kind, priority, user_id, payload, created_at, next_try_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(kind, priorityOf(kind), userId, payload && JSON.stringify(payload), now, now);
}

// BR-50: when an event's last message was queued, kept in this process's memory only (the site
// runs as one process; a restart clears it). minutesLeft returns 0 when a message may be sent,
// else the whole minutes to wait, rounded up.
export function createMessageCooldown() {
  const lastSent = new Map();
  return {
    minutesLeft(eventId, now = new Date()) {
      const last = lastSent.get(eventId);
      if (last === undefined) return 0;
      const left = MESSAGE_INTERVAL_MS - (now.getTime() - last);
      return left > 0 ? Math.max(1, Math.ceil(left / 60_000)) : 0;
    },
    start(eventId, now = new Date()) {
      lastSent.set(eventId, now.getTime());
    },
  };
}

// BR-50: a teacher's message to an event's participants. One subject line of at most 150
// characters and a text of at most 5,000; line breaks are allowed in the text only. Returns
// { values, errors }, errors as i18n keys by field.
const MESSAGE_LIMITS = { subject: 150, body: 5000 };
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function validateMessage(input) {
  const values = {
    subject: typeof input.subject === 'string' ? input.subject.trim() : '',
    body: typeof input.body === 'string' ? input.body.replace(/\r\n?/g, '\n').trim() : '',
  };
  const errors = {};
  for (const field of ['subject', 'body']) {
    if (!values[field]) errors[field] = 'message.errors.required';
    else if (values[field].length > MESSAGE_LIMITS[field]) errors[field] = `message.errors.${field}Long`;
    // A line break in the subject could start a new email header, so it is refused here rather than left to nodemailer.
    else if (CONTROL_CHARACTERS.test(values[field]) || (field === 'subject' && /[\r\n]/.test(values[field]))) errors[field] = 'message.errors.characters';
  }
  return { values, errors, limits: MESSAGE_LIMITS };
}

// BR-50: one email per participant, from the school's noreply address with the teacher as
// Reply-To. The payload holds the event's details as they are now. Returns the number queued.
export function queueTeacherMessage(db, { event, teacherId, studentIds, subject, body }) {
  const teacher = db.prepare('SELECT name, email FROM users WHERE id = ?').get(teacherId);
  const payload = {
    event: Object.fromEntries(['id', 'title_is', 'title_en', 'event_date', 'start_time', 'end_time', 'location'].map((key) => [key, event[key]])),
    teacher: teacher.name,
    replyTo: { name: teacher.name, address: teacher.email },
    subject,
    body,
  };
  db.transaction(() => {
    for (const userId of studentIds) queueEmail(db, { kind: 'teacher_message', userId, payload });
  })();
  return studentIds.length;
}

// A row whose next_try_at is NULL has used up its retries and stays for the admin to see.
export function outboxStatus(db) {
  return db.prepare(`SELECT COUNT(*) FILTER (WHERE next_try_at IS NOT NULL) AS queued,
    COUNT(*) FILTER (WHERE next_try_at IS NULL) AS failed FROM email_outbox`).get();
}

// BR-52: Icelandic first, then English, in the same plain-text message. The templates in
// src/views/emails/ render once per language, with that language's t() and formatters;
// <%= %> must not HTML-escape plain text. The subject may name the event (BR-60).
export async function renderEmail(kind, data) {
  const languages = LANGUAGES.map((lang) => ({
    lang,
    t: translator(lang),
    formatDate: (day) => formatDate(lang, day),
    formatTimeRange: (start, end) => formatTimeRange(lang, start, end),
    eventText: (event, field) => eventText(lang, event, field),
  }));
  const rendered = await ejs.renderFile(path.join(EMAIL_VIEWS, `${kind}.ejs`), { ...data, languages }, {
    escape: (value) => (value == null ? '' : String(value)),
  });
  // A checkout can hold the templates with CRLF line endings (an older clone, or an editor that
  // saves them so); the email is the same either way.
  const text = rendered.replace(/\r\n?/g, '\n');
  // A subject that reads the same in both languages, such as a teacher's own subject line, is
  // given once.
  const subjects = languages.map(({ t, lang }) => t(`emails.${kind}.subject`, {
    title: data.event ? eventText(lang, data.event, 'title') : '',
    subject: data.subject ?? '',
  }));
  const subject = [...new Set(subjects)].join(' / ');
  return { subject, text };
}
