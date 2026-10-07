import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteSessionStore } from '../src/db/sessionStore.js';
import { tempDatabase } from './helpers.js';

const call = (store, method, ...args) => new Promise((resolve, reject) => {
  store[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
});

const session = (ms, data = {}) => ({
  cookie: { originalMaxAge: ms, expires: new Date(Date.now() + ms).toISOString(), httpOnly: true, path: '/' },
  ...data,
});

describe('SQLite session store (AGENT_START §8)', () => {
  let database;
  let store;

  before(() => {
    database = tempDatabase();
    store = new SqliteSessionStore(database.db);
  });

  after(() => database.remove());

  const row = (sid) => database.db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid);

  test('set and get round-trip the session; user_id is filled from the session', async () => {
    const sess = session(60_000, { userId: 7, role: 'teacher', isAdmin: false, lang: 'en' });
    await call(store, 'set', 'logged-in', sess);
    assert.deepEqual(await call(store, 'get', 'logged-in'), sess);
    assert.equal(row('logged-in').user_id, 7);
    assert.equal(row('logged-in').expires_at, Date.parse(sess.cookie.expires));

    await call(store, 'set', 'guest', session(60_000, { lang: 'en' }));
    assert.equal(row('guest').user_id, null);
  });

  test('set replaces an existing session', async () => {
    await call(store, 'set', 'replace', session(60_000, { lang: 'is' }));
    await call(store, 'set', 'replace', session(60_000, { lang: 'en', userId: 3 }));
    assert.equal((await call(store, 'get', 'replace')).lang, 'en');
    assert.equal(row('replace').user_id, 3);
  });

  test('BR-09: touch moves the expiry; an expired session is not returned even before cleanup', async () => {
    await call(store, 'set', 'touch', session(60_000));
    const later = session(3_600_000);
    await call(store, 'touch', 'touch', later);
    assert.equal(row('touch').expires_at, Date.parse(later.cookie.expires));

    await call(store, 'set', 'expired', session(-1000));
    assert.equal(await call(store, 'get', 'expired'), null);
    assert.ok(row('expired'), 'the row is still there until cleanup');
  });

  test('destroy deletes the session', async () => {
    await call(store, 'set', 'destroy', session(60_000));
    await call(store, 'destroy', 'destroy');
    assert.equal(row('destroy'), undefined);
    assert.equal(await call(store, 'get', 'destroy'), null);
  });

  test('clearExpired deletes only expired sessions', async () => {
    database.db.exec('DELETE FROM sessions');
    await call(store, 'set', 'old-1', session(-1000));
    await call(store, 'set', 'old-2', session(-1));
    await call(store, 'set', 'current', session(60_000));
    assert.equal(store.clearExpired(), 2);
    assert.deepEqual(database.db.prepare('SELECT sid FROM sessions').pluck().all(), ['current']);
  });
});
