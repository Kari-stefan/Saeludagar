// Daily backup (AGENT_START §10, Hosting): a consistent copy of the database plus a copy of the
// uploaded images, in BACKUP_DIR/backup-<time>/. Deletes backups older than 7 days (§9, Retention).
// Usage: npm run backup
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { toIso } from '../src/db/index.js';

// Backups are kept for 7 days, so personal data leaves them at most 7 days after a purge
// (AGENT_START §9, Retention; §10, Backups).
const KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
// A nightly run meets last week's backup a few seconds either side of 7 days, and it must go that night.
const ROTATION_MARGIN_MS = 60 * 60 * 1000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The time in a backup folder's name, or null when the name is not one of ours.
function stampTime(name) {
  const match = /^backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z(\.partial)?$/.exec(name);
  if (!match) return null;
  const time = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(time.getTime()) ? null : time.getTime();
}

const config = loadConfig();
const now = new Date();
const name = `backup-${toIso(now).replaceAll(':', '-')}`;
const partial = path.join(config.backupDir, `${name}.partial`);
const final = path.join(config.backupDir, name);

let db;
try {
  // The database must already exist: a backup never creates an empty one.
  db = new Database(config.databasePath, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
} catch (err) {
  fail(`Cannot open the database at ${config.databasePath}: ${err.message}`);
}

let images = 0;
try {
  fs.rmSync(partial, { recursive: true, force: true });
  // Backups hold personal data, so only the user who runs the backup may open the folder.
  fs.mkdirSync(partial, { recursive: true, mode: 0o700 });
  // The online backup API gives a consistent copy while the site keeps running (the database is in WAL mode).
  await db.backup(path.join(partial, 'saeludagar.db'));
  const uploads = path.join(partial, 'uploads');
  if (fs.existsSync(config.uploadDir)) {
    fs.cpSync(config.uploadDir, uploads, { recursive: true });
    // The folder's .gitkeep is copied too, but it is not an image.
    images = fs.readdirSync(uploads, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== '.gitkeep').length;
  } else {
    fs.mkdirSync(uploads);
  }
  fs.renameSync(partial, final);
} catch (err) {
  fs.rmSync(partial, { recursive: true, force: true });
  fail(`Backup failed: ${err.message}`);
} finally {
  db.close();
}

// Rotation, only after the new backup succeeded. The age comes from the name, not from the file's date.
let removed = 0;
for (const entry of fs.readdirSync(config.backupDir)) {
  const time = stampTime(entry);
  if (time !== null && now.getTime() - time >= KEEP_DAYS * DAY_MS - ROTATION_MARGIN_MS) {
    fs.rmSync(path.join(config.backupDir, entry), { recursive: true, force: true });
    removed += 1;
  }
}

console.log(`Backup written to ${final} (${images} image files copied).`);
console.log(`Removed ${removed} backups older than ${KEEP_DAYS} days.`);
