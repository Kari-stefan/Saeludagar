import { toIso } from '../db/index.js';
import { generateCode, hashCode } from '../services/codes.js';
import { renderEmail } from '../services/email.js';

const MAX_RETRIES = 5; // AGENT_START §8: a failed send is retried up to 5 times,
const FIRST_RETRY_MS = 60_000; // 1, 2, 4, 8 and 16 minutes later.
const MINUTE_MS = 60_000;

// The outbox worker (AGENT_START §8): sends due emails, priority 0 first, at most
// SMTP_MAX_PER_MINUTE a minute (BR-53). So far every kind is a login code, which is
// generated here at send time: generate the code, send the email, then store the hash.
export function createOutboxWorker({ db, mailer, config, now = () => new Date() }) {
  const nextDue = db.prepare(`SELECT id, kind, user_id, attempts FROM email_outbox
    WHERE next_try_at <= ? ORDER BY priority, id LIMIT 1`);
  const recipient = db.prepare('SELECT id, name, email, active FROM users WHERE id = ?');
  const remove = db.prepare('DELETE FROM email_outbox WHERE id = ?');
  const storeHash = db.prepare('UPDATE users SET code_hash = ?, updated_at = ? WHERE id = ?');
  const recordFailure = db.prepare('UPDATE email_outbox SET attempts = ?, last_error = ?, next_try_at = ? WHERE id = ?');
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
    // Only active accounts can log in (BR-03), so a code for a deactivated account is dropped unsent.
    if (!user?.active) {
      remove.run(row.id);
      return;
    }
    sendTimes.push(now().getTime());
    try {
      const code = generateCode();
      const codeHash = await hashCode(code);
      const { subject, text } = await renderEmail(row.kind, { name: user.name, code, loginUrl });
      await mailer.send({ to: { name: user.name, address: user.email }, subject, text });
      db.transaction(() => {
        storeHash.run(codeHash, toIso(now()), user.id);
        remove.run(row.id);
      })();
    } catch (err) {
      const attempts = row.attempts + 1;
      const retryAt = attempts > MAX_RETRIES
        ? null
        : toIso(new Date(now().getTime() + FIRST_RETRY_MS * 2 ** (attempts - 1)));
      const message = String(err?.message ?? err).slice(0, 500);
      recordFailure.run(attempts, message, retryAt, row.id);
      console.error(`Email ${row.id} (${row.kind}) could not be sent: ${message}`);
    }
  }

  // Sends every due email the per-minute limit allows. Re-reads the queue after each one,
  // so a priority-0 email queued meanwhile goes next.
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
      .catch((err) => console.error(`Outbox worker failed: ${err?.message ?? err}`))
      .finally(() => {
        running = null;
      });
  }

  return {
    runOnce,
    start(intervalMs = 5000) {
      timer = setInterval(tick, intervalMs);
    },
    // Waits for the email being sent, so the database can be closed safely afterwards.
    async stop() {
      stopping = true;
      clearInterval(timer);
      await running;
    },
  };
}
