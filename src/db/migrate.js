import fs from 'node:fs';
import { loadConfig } from '../config.js';
import { openDatabase } from './index.js';

export const SCHEMA_VERSION = 2;

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current === SCHEMA_VERSION) return current;
  if (current === 0) {
    const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
    return SCHEMA_VERSION;
  }
  if (current === 1) {
    db.transaction(() => {
      db.exec(`ALTER TABLE users
        ADD COLUMN is_event_manager INTEGER NOT NULL DEFAULT 0 CHECK (is_event_manager IN (0,1))`);
      db.exec("UPDATE users SET is_event_manager = 1 WHERE role = 'teacher'");
      db.exec('CREATE INDEX users_event_manager_active ON users(is_event_manager, active)');
      db.pragma('user_version = 2');
    })();
    return SCHEMA_VERSION;
  }
  throw new Error(`Unknown database schema version ${current}; expected 0 to ${SCHEMA_VERSION}.`);
}

if (import.meta.main) {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  migrate(db);
  console.log(`Database ready at ${config.databasePath} (schema version ${SCHEMA_VERSION}).`);
  db.close();
}
