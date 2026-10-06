import fs from 'node:fs';
import { loadConfig } from '../config.js';
import { openDatabase } from './index.js';

export const SCHEMA_VERSION = 1;

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current === SCHEMA_VERSION) return current;
  if (current !== 0) {
    throw new Error(`Unknown database schema version ${current}; expected 0 or ${SCHEMA_VERSION}.`);
  }
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db.transaction(() => {
    db.exec(sql);
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
