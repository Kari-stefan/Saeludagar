import fs from 'node:fs';
import { loadConfig } from '../config.js';
import { openDatabase } from './index.js';

export const SCHEMA_VERSION = 4;

// Each step takes a database from one version to the next and keeps its data. schema.sql is what
// a new database gets, so a step must leave the same tables and indexes as it describes.
const STEPS = {
  // #52: the event-manager role, which every teacher account starts with (BR-67).
  1(db) {
    db.exec(`ALTER TABLE users
      ADD COLUMN is_event_manager INTEGER NOT NULL DEFAULT 0 CHECK (is_event_manager IN (0,1))`);
    db.exec("UPDATE users SET is_event_manager = 1 WHERE role = 'teacher'");
    db.exec('CREATE INDEX users_event_manager_active ON users(is_event_manager, active)');
  },
  // M6c: up to 5 images per event (BR-27), each event's one image moved over; and every teacher
  // account has the event-manager role again, since it can no longer be taken from one (BR-67).
  2(db) {
    db.exec(`CREATE TABLE event_images (
      id        INTEGER PRIMARY KEY,
      event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      file      TEXT    NOT NULL UNIQUE,
      position  INTEGER NOT NULL
    )`);
    db.exec('CREATE INDEX event_images_event ON event_images(event_id, position)');
    db.exec('INSERT INTO event_images (event_id, file, position) SELECT id, image_file, 0 FROM events WHERE image_file IS NOT NULL');
    db.exec('ALTER TABLE events DROP COLUMN image_file');
    db.exec("UPDATE users SET is_event_manager = 1 WHERE role = 'teacher'");
  },
  // M9: the signup_added email (BR-37). SQLite cannot change a CHECK, so email_outbox is rebuilt
  // with the new list of kinds and every row copied over as it is.
  3(db) {
    db.exec(`CREATE TABLE email_outbox_new (
      id           INTEGER PRIMARY KEY,
      kind         TEXT    NOT NULL CHECK (kind IN
                     ('student_code','new_code','teacher_code','teacher_message','event_changed','event_deleted','signup_added')),
      priority     INTEGER NOT NULL DEFAULT 0,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      payload      TEXT,
      created_at   TEXT    NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      next_try_at  TEXT
    )`);
    db.exec(`INSERT INTO email_outbox_new (id, kind, priority, user_id, payload, created_at, attempts, last_error, next_try_at)
      SELECT id, kind, priority, user_id, payload, created_at, attempts, last_error, next_try_at FROM email_outbox`);
    db.exec('DROP TABLE email_outbox');
    db.exec('ALTER TABLE email_outbox_new RENAME TO email_outbox');
    db.exec('CREATE INDEX email_outbox_due ON email_outbox(priority, next_try_at)');
  },
};

export function migrate(db) {
  let current = db.pragma('user_version', { simple: true });
  if (current === SCHEMA_VERSION) return current;
  if (current === 0) {
    const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
    return SCHEMA_VERSION;
  }
  if (!Object.hasOwn(STEPS, current)) {
    throw new Error(`Unknown database schema version ${current}; expected 0 to ${SCHEMA_VERSION}.`);
  }
  db.transaction(() => {
    for (; current < SCHEMA_VERSION; current += 1) STEPS[current](db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
  return SCHEMA_VERSION;
}

if (import.meta.main) {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  migrate(db);
  console.log(`Database ready at ${config.databasePath} (schema version ${SCHEMA_VERSION}).`);
  db.close();
}
