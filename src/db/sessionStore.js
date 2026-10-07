import session from 'express-session';

// express-session store backed by the sessions table (AGENT_START §8).
// Expiry is checked here on the server, so an old cookie cannot bring a session back (BR-09).
export class SqliteSessionStore extends session.Store {
  #get;
  #set;
  #touch;
  #destroy;
  #clearExpired;

  constructor(db) {
    super();
    this.#get = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires_at > ?');
    this.#set = db.prepare(`INSERT INTO sessions (sid, user_id, sess, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (sid) DO UPDATE SET user_id = excluded.user_id, sess = excluded.sess, expires_at = excluded.expires_at`);
    this.#touch = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this.#destroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.#clearExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  }

  get(sid, callback) {
    let sess = null;
    try {
      const row = this.#get.get(sid, Date.now());
      if (row) sess = JSON.parse(row.sess);
    } catch (err) {
      return callback(err);
    }
    callback(null, sess);
  }

  // user_id lets deactivation (and the purge later) delete a user's sessions.
  set(sid, sess, callback) {
    run(callback, () => this.#set.run(sid, sess.userId ?? null, JSON.stringify(sess), expiresAt(sess)));
  }

  touch(sid, sess, callback) {
    run(callback, () => this.#touch.run(expiresAt(sess), sid));
  }

  destroy(sid, callback) {
    run(callback, () => this.#destroy.run(sid));
  }

  // Called every 15 minutes by src/jobs/sessionCleanup.js. Returns the number of rows deleted.
  clearExpired() {
    return this.#clearExpired.run(Date.now()).changes;
  }
}

// Every session cookie has a maxAge (src/app.js), so expires is always set.
function expiresAt(sess) {
  return new Date(sess.cookie.expires).getTime();
}

function run(callback, statement) {
  try {
    statement();
  } catch (err) {
    return callback?.(err);
  }
  callback?.(null);
}
