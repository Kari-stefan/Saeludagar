import path from 'node:path';
import ejs from 'ejs';
import nodemailer from 'nodemailer';
import { ROOT_DIR } from '../config.js';
import { toIso } from '../db/index.js';
import { translator } from '../i18n/index.js';

const EMAIL_VIEWS = path.join(ROOT_DIR, 'src', 'views', 'emails');

// AGENT_START §8: SMTP when SMTP_HOST is set. Without it, development prints each email to the
// console instead; production never does, because emails contain login codes (§9, item 10).
export function createMailer(config, { log = console.log } = {}) {
  const { host, port, secure, user, pass, from } = config.smtp;

  if (host) {
    if (!from) {
      throw new Error('MAIL_FROM is not set. Set it to the school\'s noreply address (see README, "Environment variables").');
    }
    const transport = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined });
    return { send: (message) => transport.sendMail({ from, ...message }) };
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

// Every email goes through the outbox (BR-53). Priority 0 is sent first; 1 is bulk.
export function queueEmail(db, { kind, userId, priority = 0 }) {
  const now = toIso();
  db.prepare(`INSERT INTO email_outbox (kind, priority, user_id, created_at, next_try_at)
    VALUES (?, ?, ?, ?, ?)`).run(kind, priority, userId, now, now);
}

// A row whose next_try_at is NULL has used up its retries and stays for the admin to see.
export function outboxStatus(db) {
  return db.prepare(`SELECT COUNT(*) FILTER (WHERE next_try_at IS NOT NULL) AS queued,
    COUNT(*) FILTER (WHERE next_try_at IS NULL) AS failed FROM email_outbox`).get();
}

// BR-52: Icelandic first, then English, in the same plain-text message. The templates in
// src/views/emails/ render once per language; <%= %> must not HTML-escape plain text.
export async function renderEmail(kind, data) {
  const languages = [translator('is'), translator('en')];
  const text = await ejs.renderFile(path.join(EMAIL_VIEWS, `${kind}.ejs`), { ...data, languages }, {
    escape: (value) => (value == null ? '' : String(value)),
  });
  const subject = languages.map((t) => t(`emails.${kind}.subject`)).join(' / ');
  return { subject, text };
}
