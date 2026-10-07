import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

// Timestamps are ISO-8601 UTC without milliseconds, e.g. 2027-03-11T10:00:00Z (AGENT_START §7).
export function toIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
