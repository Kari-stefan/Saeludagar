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

// AGENT_START §8: SMTP when SMTP_HOST is set. Without it, development prints each email to the
// console instead; production never does, because emails contain login codes (§9, item 10).
export function createMailer(config, { log = console.log, retryDelayMs = 3000 } = {}) {
  const { host, port, secure, user, pass, from } = config.smtp;

  if (host) {
    if (!from) {
      throw new Error('MAIL_FROM is not set. Set it to the school\'s noreply address (see README, "Environment variables").');
    }
    // Port 465 uses TLS from the start and 587 switches to it after connecting (RFC 8314). The
    // other way round, every send fails, so the server refuses to start instead.
    if (port === 465 && !secure) {
      throw new Error('SMTP_PORT is 465, so SMTP_SECURE must be true (see README, "Environment variables").');
    }
    if (port === 587 && secure) {
      throw new Error('SMTP_PORT is 587, so SMTP_SECURE must be false (see README, "Environment variables").');
    }
    const transport = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined });
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
    async send({ to, subject, text }) {
      log([
        '--- Email (not sent, because SMTP_HOST is empty) ---',
        `To: ${to.name} <${to.address}>`,
        `Subject: ${subject}`,
        '',
        text.trimEnd(),
        '--- End of email ---',
      ].join('\n'));
    },
  };
}

// Every email goes through the outbox (BR-53). Priority 0 is sent first; 1 is bulk. The payload
// holds what the template needs, such as an event's details; never a login code.
export function queueEmail(db, { kind, userId, priority = 0, payload = null }) {
  const now = toIso();
  db.prepare(`INSERT INTO email_outbox (kind, priority, user_id, payload, created_at, next_try_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(kind, priority, userId, payload && JSON.stringify(payload), now, now);
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
  const text = await ejs.renderFile(path.join(EMAIL_VIEWS, `${kind}.ejs`), { ...data, languages }, {
    escape: (value) => (value == null ? '' : String(value)),
  });
  const subject = languages
    .map(({ t, lang }) => t(`emails.${kind}.subject`, { title: data.event ? eventText(lang, data.event, 'title') : '' }))
    .join(' / ');
  return { subject, text };
}
