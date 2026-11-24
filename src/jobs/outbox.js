import { toIso } from '../db/index.js';
import { generateCode, hashCode } from '../services/codes.js';
import { renderEmail } from '../services/email.js';

const MAX_RETRIES = 5; // AGENT_START §8: a failed send is retried up to 5 times,
const FIRST_RETRY_MS = 60_000; // 1, 2, 4, 8 and 16 minutes later.
const MINUTE_MS = 60_000;
const CODE_KINDS = new Set(['student_code', 'new_code', 'teacher_code']);

// The outbox worker (AGENT_START §8): sends due emails, lowest priority number first, at most
// SMTP_MAX_PER_MINUTE a minute (BR-53). A login code is generated here at send time: generate
// the code, send the email, then store the hash. Other emails take their details from the payload.
export function createOutboxWorker({ db, mailer, config, now = () => new Date() }) {
  const nextDue = db.prepare(`SELECT id, kind, user_id, payload, attempts, created_at FROM email_outbox
    WHERE next_try_at <= ? ORDER BY priority, id LIMIT 1`);
  const recipient = db.prepare('SELECT id, name, email, active FROM users WHERE id = ?');
  // The row being sent can be deleted meanwhile (a purge, a deleted or replaced recipient), and
  // SQLite can give its id to the next email queued. So the worker touches only the row it read:
  // the same id, kind, recipient and time queued. A row that is gone matches nothing.
  const SAME_ROW = 'id = ? AND kind = ? AND user_id IS ? AND created_at = ?';
  const remove = db.prepare(`DELETE FROM email_outbox WHERE ${SAME_ROW}`);
  const storeHash = db.prepare('UPDATE users SET code_hash = ?, updated_at = ? WHERE id = ?');
  const recordFailure = db.prepare(`UPDATE email_outbox SET attempts = ?, last_error = ?, next_try_at = ? WHERE ${SAME_ROW}`);
  const rowKey = (row) => [row.id, row.kind, row.user_id, row.created_at];
  const loginUrl = new URL('/login', config.baseUrl).href;
  const sendTimes = []; // send attempts in the last minute
  let timer = null;
  let running = null;
  let stopping = false;

  function underLimit() {
    const minuteAgo = now().getTime() - MINUTE_MS;
    while (sendTimes.length > 0 && sendTimes[0] <= minuteAgo) sendTimes.shift();
    return sendTimes.length < config.smtp.maxPerMinute;
  }

  async function deliver(row) {
    const user = recipient.get(row.user_id);
    // Only active accounts can log in (BR-03), so an email to a deactivated account is dropped unsent.
    if (!user?.active) {
      remove.run(...rowKey(row));
      return;
    }
    sendTimes.push(now().getTime());
    try {
      const to = { name: user.name, address: user.email };
      if (CODE_KINDS.has(row.kind)) {
        const code = generateCode();
        const codeHash = await hashCode(code);
        const { subject, text } = await renderEmail(row.kind, { name: user.name, code, loginUrl });
        await mailer.send({ to, subject, text });
        db.transaction(() => {
          storeHash.run(codeHash, toIso(now()), user.id);
          remove.run(...rowKey(row));
        })();
      } else {
        const payload = JSON.parse(row.payload ?? '{}');
        const eventUrl = payload.event?.id ? new URL(`/events/${payload.event.id}`, config.baseUrl).href : null;
        const { subject, text } = await renderEmail(row.kind, { ...payload, name: user.name, eventUrl });
        // A teacher's message (BR-50) comes from the noreply address, but replies go to the teacher.
        await mailer.send({ to, subject, text, ...(payload.replyTo ? { replyTo: payload.replyTo } : {}) });
        remove.run(...rowKey(row));
      }
    } catch (err) {
      const attempts = row.attempts + 1;
      const retryAt = attempts > MAX_RETRIES
        ? null
        : toIso(new Date(now().getTime() + FIRST_RETRY_MS * 2 ** (attempts - 1)));
      const message = String(err?.message ?? err).slice(0, 500);
      recordFailure.run(attempts, message, retryAt, ...rowKey(row));
      // The mail server's message can hold the recipient's address (§9, item 10), so the log gets
      // only the error codes; the full message is in email_outbox.last_error.
      const codes = [err?.code, err?.responseCode].filter((code) => code !== undefined && code !== null);
      console.error(`Email ${row.id} (${row.kind}) could not be sent${codes.length ? `: ${codes.join(' ')}` : ''}`);
    }
  }

  // Sends every due email the per-minute limit allows. Re-reads the queue after each one,
  // so an email with a lower priority number queued meanwhile goes next.
  async function runOnce() {
    while (!stopping && underLimit()) {
      const row = nextDue.get(toIso(now()));
      if (!row) break;
      await deliver(row);
    }
  }

  function tick() {
    if (running) return;
    running = runOnce()
      .catch((err) => console.error(`Outbox worker failed: ${err?.name ?? 'Error'}${err?.code ? ` ${err.code}` : ''}`))
      .finally(() => {
        running = null;
      });
  }

  return {
    runOnce,
    start(intervalMs = 5000) {
      timer = setInterval(tick, intervalMs);
    },
    // Waits for the email being sent, but at most timeoutMs, so a mail server that does not answer
    // cannot keep the process running. An email cut off this way stays queued and is sent on the
    // next start. In the rare case that the mail server had already accepted a code email, that
    // code never works (its hash was not stored yet), and the next email brings a working one.
    async stop(timeoutMs = 5000) {
      stopping = true;
      clearInterval(timer);
      let timeout;
      await Promise.race([running, new Promise((resolve) => { timeout = setTimeout(resolve, timeoutMs); })]);
      clearTimeout(timeout);
    },
  };
}
