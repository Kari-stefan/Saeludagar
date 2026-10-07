import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toIso } from '../src/db/index.js';
import { createOutboxWorker } from '../src/jobs/outbox.js';
import { queueEmail } from '../src/services/email.js';
import { verifyCode } from '../src/services/codes.js';
import { kennitalaCrypto } from '../src/services/crypto.js';
import { codeFrom, insertUser, tempDatabase, testConfig } from './helpers.js';

describe('email outbox worker (AGENT_START §8)', () => {
  let database;
  let db;
  let config;
  let users;
  let clock;
  const now = () => new Date(clock);

  before(async () => {
    database = tempDatabase();
    db = database.db;
    config = testConfig({ SMTP_MAX_PER_MINUTE: '3' });
    const kt = kennitalaCrypto(config);
    users = [];
    for (let i = 1; i <= 5; i += 1) {
      users.push(await insertUser(db, kt, {
        kennitala: String(i).padStart(10, '0'), name: `Kennari ${i}`, email: `kennari${i}@example.is`, code: '111111',
      }));
    }
  });

  afterEach(() => db.exec('DELETE FROM email_outbox'));

  after(() => database.remove());

  // Timestamps are stored to the second, so the worker's clock starts just ahead of the queue's.
  function worker(send) {
    clock = Date.now() + 1000;
    return createOutboxWorker({ db, config, now, mailer: { send } });
  }

  const rows = () => db.prepare('SELECT id, kind, user_id, attempts, last_error, next_try_at FROM email_outbox ORDER BY id').all();
  const codeHash = (id) => db.prepare('SELECT code_hash FROM users WHERE id = ?').pluck().get(id);

  test('§8: generates the code at send time, sends it, stores only its hash, and deletes the row', async () => {
    const sent = [];
    const outbox = worker(async (message) => {
      sent.push(message);
      assert.equal(await verifyCode(codeFrom(message), codeHash(users[0].id)), false, 'the hash is stored after sending');
    });
    queueEmail(db, { kind: 'teacher_code', userId: users[0].id });
    assert.equal(db.prepare('SELECT payload FROM email_outbox').pluck().get(), null, 'the queue never holds a code');
    await outbox.runOnce();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, { name: 'Kennari 1', address: 'kennari1@example.is' });
    assert.equal(await verifyCode(codeFrom(sent[0]), codeHash(users[0].id)), true);
    assert.equal(await verifyCode('111111', codeHash(users[0].id)), false, 'the previous code stops working');
    assert.deepEqual(rows(), []);
  });

  test('§8: priority 0 goes first', async () => {
    const order = [];
    const outbox = worker(async (message) => order.push(message.to.address));
    const insert = db.prepare(`INSERT INTO email_outbox (kind, priority, user_id, created_at, next_try_at)
      VALUES ('new_code', ?, ?, ?, ?)`);
    insert.run(1, users[0].id, toIso(now()), toIso(now()));
    insert.run(0, users[1].id, toIso(now()), toIso(now()));
    await outbox.runOnce();
    assert.deepEqual(order, ['kennari2@example.is', 'kennari1@example.is']);
  });

  test('BR-53: sends at most SMTP_MAX_PER_MINUTE emails a minute', async () => {
    const sent = [];
    const outbox = worker(async (message) => sent.push(message));
    for (const user of users) queueEmail(db, { kind: 'new_code', userId: user.id });
    await outbox.runOnce();
    assert.equal(sent.length, 3);
    clock += 59_000;
    await outbox.runOnce();
    assert.equal(sent.length, 3, 'still within the same minute');
    clock += 2000;
    await outbox.runOnce();
    assert.equal(sent.length, 5);
  });

  test('§8: a failed send is retried up to 5 times with increasing delay, then kept with last_error', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    let attempts = 0;
    const outbox = worker(async () => {
      attempts += 1;
      throw new Error('Connection refused');
    });
    queueEmail(db, { kind: 'teacher_code', userId: users[0].id });
    const hashBefore = codeHash(users[0].id);
    const delays = [];
    for (let i = 1; i <= 6; i += 1) {
      await outbox.runOnce();
      const [row] = rows();
      assert.equal(row.attempts, i);
      assert.equal(row.last_error, 'Connection refused');
      if (row.next_try_at) {
        delays.push((Date.parse(row.next_try_at) - clock) / 60_000);
        await outbox.runOnce();
        assert.equal(rows()[0].attempts, i, 'not retried before next_try_at');
        clock = Date.parse(row.next_try_at);
      }
    }
    assert.deepEqual(delays.map(Math.round), [1, 2, 4, 8, 16]);
    assert.equal(rows()[0].next_try_at, null, 'gives up after the first try and 5 retries');
    clock += 24 * 60 * 60 * 1000;
    await outbox.runOnce();
    assert.equal(attempts, 6);
    assert.equal(codeHash(users[0].id), hashBefore, 'a failed send changes no code');
    for (const call of errors.mock.calls) {
      assert.match(call.arguments[0], /^Email \d+ \(teacher_code\) could not be sent: Connection refused$/);
    }
  });

  test('§9 item 10: a failed send logs no code and no email address', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    let text;
    const outbox = worker(async (message) => {
      text = message.text;
      throw new Error('Mailbox unavailable');
    });
    queueEmail(db, { kind: 'new_code', userId: users[1].id });
    await outbox.runOnce();
    const logged = errors.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
    assert.doesNotMatch(logged, new RegExp(codeFrom({ text })));
    assert.doesNotMatch(logged, /kennari2@example\.is/);
  });

  test('BR-03: a code is not sent to an account that is no longer active', async () => {
    const sent = [];
    const outbox = worker(async (message) => sent.push(message));
    queueEmail(db, { kind: 'new_code', userId: users[2].id });
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(users[2].id);
    await outbox.runOnce();
    assert.deepEqual(sent, []);
    assert.deepEqual(rows(), []);
    db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(users[2].id);
  });

  test('stop() waits for the email being sent', async () => {
    let finish;
    const outbox = worker(() => new Promise((resolve) => {
      finish = resolve;
    }));
    queueEmail(db, { kind: 'new_code', userId: users[3].id });
    outbox.start(10);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 5));
    let stopped = false;
    const stopping = outbox.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(stopped, false);
    finish();
    await stopping;
    assert.deepEqual(rows(), []);
  });
});
