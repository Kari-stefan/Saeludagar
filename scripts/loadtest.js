// npm run loadtest: the 1,000-student sign-up load test (AGENT_START §13, M8). Fake data only.
//
// Isolation: the script never uses the developer's settings. `npm run loadtest` reads .env, but
// DATABASE_PATH, UPLOAD_DIR, BACKUP_DIR, the kennitala keys, SESSION_SECRET and every SMTP_* value
// in the environment are ignored. The script makes its own temporary folder under the OS temp
// directory, with a fresh database and fresh random keys, and removes it when it finishes, fails or
// is interrupted (Ctrl+C, SIGTERM).
//
// The server under test is the real entry point (src/server.js) in its own process, in production
// mode as on the school's server. The script plays nginx: every request says it came over HTTPS.
//   1. Seeding: N fake students sharing one login code, one teacher, E published events over 3
//      Sæludagar days with fewer places than the students ask for, and an open sign-up window.
//   2. Login: every student logs in (GET /login, POST /login), a few at a time.
//   3. The sign-up minute: every student starts at a random moment inside the window, loads the
//      front page and sends 6 sign-ups to 6 different events, more than the limit of 4 (BR-32).
//   4. Checks, on the database after the server has stopped: no event over its maximum (BR-35), no
//      student over 4 sign-ups (BR-32) or over 2 on one day (BR-65); and no 5xx responses.
// Usage: npm run loadtest -- [--students 1000] [--events 40] [--window 20]
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MAX_SIGNUPS_PER_DAY, MAX_SIGNUPS_PER_STUDENT, ROOT_DIR } from '../src/config.js';
import { openDatabase, toIso } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { hashCode } from '../src/services/codes.js';
import { kennitalaCrypto } from '../src/services/crypto.js';

const USAGE = 'Usage: npm run loadtest -- [--students 1000] [--events 40] [--window 20]';
const LOGIN_CONCURRENCY = 25;
const SIGNUPS_PER_STUDENT = 6; // more than MAX_SIGNUPS_PER_STUDENT on purpose
// Requests in flight at once in the sign-up minute, to stay under the open-file limits of
// developer machines. Time spent waiting for a free slot counts in the response time.
const MAX_IN_FLIGHT = 128;
const PHASE_LIMIT_MS = 60_000;
const PLACES_PER_STUDENT = 1.5; // total places, well below the 4 each student asks for
const BRAUTIR = ['Rafmagnsbraut', 'Náttúrufræðibraut', 'Starfsbraut', 'Listabraut'];
const SLOTS = [['09:00', '11:00'], ['10:00', '12:00'], ['11:00', '12:00'], ['13:00', '15:00'], ['14:00', '16:00'], ['15:00', '16:30']];
const SERVER_START_MS = 15_000;
const SERVER_STOP_MS = 10_000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function positiveInteger(name, value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) fail(`--${name} must be a positive whole number\n${USAGE}`);
  return Number(value);
}

let args;
try {
  ({ values: args } = parseArgs({
    options: { students: { type: 'string' }, events: { type: 'string' }, window: { type: 'string' } },
  }));
} catch (err) {
  fail(`${err.message}\n${USAGE}`);
}
const STUDENTS = positiveInteger('students', args.students, 1000);
const EVENTS = positiveInteger('events', args.events, 40);
const WINDOW_S = positiveInteger('window', args.window, 20);
if (WINDOW_S >= 60) fail(`--window must be under 60 seconds\n${USAGE}`);

// --- Temporary folder, server process and cleanup ---

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-loadtest-'));
const dbFile = path.join(tempDir, 'loadtest.db');
let server = null;
let serverExited = null; // resolves with { code, signal } once the server process has ended
let serverOutput = '';
let stopping = null;
let interrupted = false;

function removeTempDir() {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// SIGTERM, as systemd stops the site; SIGKILL if it does not stop in time.
function stopServer() {
  if (!server) return Promise.resolve(null);
  stopping ??= (async () => {
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), SERVER_STOP_MS);
    const result = await serverExited;
    clearTimeout(timer);
    return result;
  })();
  return stopping;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (interrupted) return;
    interrupted = true;
    console.error(`\n${signal}: stopping the test server and removing the temporary folder.`);
    await stopServer();
    removeTempDir();
    process.exit(130);
  });
}
// A last resort if the script ends some other way.
process.on('exit', () => {
  if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  removeTempDir();
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(env) {
  server = spawn(process.execPath, ['src/server.js'], { cwd: ROOT_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverExited = new Promise((resolve) => server.on('exit', (code, signal) => resolve({ code, signal })));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The test server did not start within 15 seconds.')), SERVER_START_MS);
    const collect = (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-20_000);
      if (/ is running at /.test(serverOutput)) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    serverExited.then(({ code, signal }) => {
      clearTimeout(timer);
      reject(new Error(`The test server stopped (${signal ?? `exit code ${code}`}).`));
    });
  });
}

// --- Seeding (fake data only) ---

async function seed() {
  const keys = { kennitalaEncKey: crypto.randomBytes(32).toString('base64'), kennitalaHmacKey: crypto.randomBytes(32).toString('base64') };
  const kt = kennitalaCrypto(keys);
  // One code and one hash for everyone: 1,000 scrypt hashes would take most of a minute. The
  // server still checks the code with a full scrypt computation on every login.
  const code = '123456';
  const codeHash = await hashCode(code);
  const now = new Date();
  const days = [30, 31, 32].map((offset) => toIso(new Date(now.getTime() + offset * 86_400_000)).slice(0, 10));

  const db = openDatabase(dbFile);
  migrate(db);
  const insertUser = db.prepare(`INSERT INTO users
    (role, is_event_manager, kennitala_hmac, kennitala_enc, name, email, braut, code_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEvent = db.prepare(`INSERT INTO events (owner_id, status, title_is, description_is, host, capacity,
    event_date, start_time, end_time, location, created_at, updated_at)
    VALUES (?, 'published', ?, 'Viðburður fyrir álagsprófun.', 'Gestgjafi', ?, ?, ?, ?, ?, ?, ?)`);
  const stamp = toIso(now);
  const students = [];
  const events = [];

  db.transaction(() => {
    for (let i = 1; i <= STUDENTS; i += 1) {
      const kennitala = String(i).padStart(10, '0');
      const number = String(i).padStart(4, '0');
      insertUser.run('student', 0, kt.hmac(kennitala), kt.encrypt(kennitala), `Nemandi ${number}`,
        `nemandi${number}@example.is`, BRAUTIR[i % BRAUTIR.length], codeHash, stamp, stamp);
      students.push({ kennitala, code, sid: null });
    }
    const teacherKennitala = String(STUDENTS + 1).padStart(10, '0');
    const teacherId = Number(insertUser.run('teacher', 1, kt.hmac(teacherKennitala), kt.encrypt(teacherKennitala),
      'Kennari Prófunar', 'kennari@example.is', null, codeHash, stamp, stamp).lastInsertRowid);

    for (const day of days) db.prepare('INSERT INTO saeludagar_days (day) VALUES (?)').run(day);
    // Capacities vary (weights 0.5 to 1.5) and add up to about 1.5 places per student.
    const weights = Array.from({ length: EVENTS }, (_, i) => 0.5 + (i % 5) * 0.25);
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < EVENTS; i += 1) {
      const [start, end] = SLOTS[Math.floor(i / days.length) % SLOTS.length];
      const capacity = Math.max(1, Math.round((STUDENTS * PLACES_PER_STUDENT * weights[i]) / weightSum));
      const id = Number(insertEvent.run(teacherId, `Viðburður ${i + 1}`, capacity, days[i % days.length], start, end,
        `Stofa ${101 + i}`, stamp, stamp).lastInsertRowid);
      events.push({ id, capacity });
    }
    db.prepare('UPDATE settings SET signup_opens_at = ?, signup_closes_at = ?, updated_at = ? WHERE id = 1')
      .run(toIso(new Date(now.getTime() - 3_600_000)), toIso(new Date(now.getTime() + 86_400_000)), stamp);
  })();
  db.close(); // the server owns the file from here
  return { keys, students, events, days };
}

// --- HTTP, timing and counting ---

let baseUrl = '';
const statusCounts = new Map();
const unexpected = new Map();
let networkErrors = 0;
const times = { login: [], 'front page': [], 'sign-up': [] };

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// One request as the student's browser would send it, through nginx. Keeps the newest sid cookie,
// since the session is renewed on every request. Returns null on a network error.
async function send(student, method, url, form) {
  const headers = { 'x-forwarded-proto': 'https' };
  if (student.sid) headers.cookie = `sid=${student.sid}`;
  try {
    const res = await fetch(baseUrl + url, {
      method, redirect: 'manual', headers, body: form ? new URLSearchParams(form) : undefined,
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      if (pair.slice(0, eq) === 'sid') student.sid = pair.slice(eq + 1);
    }
    const html = await res.text();
    bump(statusCounts, res.status);
    return { status: res.status, location: res.headers.get('location'), html };
  } catch {
    networkErrors += 1;
    return null;
  }
}

// Whether a response is the one this scenario should give; anything else is counted as unexpected.
function expect(label, res, status, location) {
  if (!res) return false;
  if (res.status === status && (location === undefined || res.location === location)) return true;
  bump(unexpected, `${label}: ${res.status}${res.location ? ` to ${res.location.replace(/\?.*/, '')}` : ''}`);
  return false;
}

function csrfFrom(html) {
  return /name="_csrf" value="([^"]+)"/.exec(html ?? '')?.[1] ?? null;
}

// Nearest-rank percentile of sorted times.
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

// A counting semaphore that remembers the most requests it let through at once.
class Limiter {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.peak = 0;
    this.waiting = [];
  }

  async acquire() {
    if (this.active >= this.max) await new Promise((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    this.peak = Math.max(this.peak, this.active);
  }

  release() {
    const next = this.waiting.shift();
    if (next) next(); // the slot passes straight to the next request
    else this.active -= 1;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Phase 1: logging in ---

async function loginAll(students) {
  const queue = [...students];
  const started = performance.now();
  let failed = 0;
  async function worker() {
    for (let student = queue.shift(); student; student = queue.shift()) {
      const page = await send(student, 'GET', '/login');
      const token = expect('login page', page, 200) ? csrfFrom(page.html) : null;
      if (!token) {
        failed += 1;
        continue;
      }
      const t0 = performance.now();
      const res = await send(student, 'POST', '/login', { _csrf: token, kennitala: student.kennitala, code: student.code });
      times.login.push(performance.now() - t0);
      if (expect('login', res, 303, '/')) student.loggedIn = true;
      else failed += 1;
    }
  }
  await Promise.all(Array.from({ length: LOGIN_CONCURRENCY }, worker));
  return { failed, ms: performance.now() - started };
}

// --- Phase 2: the sign-up minute ---

function pickEvents(events, count) {
  const ids = events.map((event) => event.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

async function signupMinute(students, events) {
  const limiter = new Limiter(MAX_IN_FLIGHT);
  const sent = { first: Infinity, last: -Infinity };
  const start = performance.now();
  let posts = 0;

  // The response time runs from when the request was due until its whole body has been read.
  async function timed(kind, due, student, method, url, form) {
    await limiter.acquire();
    const now = performance.now();
    sent.first = Math.min(sent.first, now);
    sent.last = Math.max(sent.last, now);
    let res;
    try {
      res = await send(student, method, url, form);
    } finally {
      limiter.release();
    }
    times[kind].push(performance.now() - due);
    return res;
  }

  async function run(student) {
    const due = start + Math.random() * WINDOW_S * 1000;
    await sleep(Math.max(0, due - performance.now()));
    const page = await timed('front page', due, student, 'GET', '/');
    const token = expect('front page', page, 200) ? csrfFrom(page.html) : null;
    if (!token) return;
    for (const id of pickEvents(events, SIGNUPS_PER_STUDENT)) {
      posts += 1;
      const res = await timed('sign-up', performance.now(), student, 'POST', `/events/${id}`, { _csrf: token, action: 'signup' });
      expect('sign-up', res, 303, `/events/${id}`);
    }
  }

  await Promise.all(students.map(run));
  return {
    posts,
    sendSpanMs: Number.isFinite(sent.first) ? sent.last - sent.first : 0,
    totalMs: performance.now() - start,
    peak: limiter.peak,
  };
}

// --- Checks on the database ---

function checkDatabase() {
  const db = openDatabase(dbFile);
  try {
    const perEvent = db.prepare(`SELECT e.id, e.capacity, COUNT(r.id) AS taken
      FROM events e LEFT JOIN registrations r ON r.event_id = e.id GROUP BY e.id`).all();
    return {
      registrations: db.prepare('SELECT COUNT(*) FROM registrations').pluck().get(),
      full: perEvent.filter((event) => event.taken >= event.capacity).length,
      overCapacity: perEvent.filter((event) => event.taken > event.capacity).length,
      overTotal: db.prepare(`SELECT COUNT(*) FROM (SELECT student_id FROM registrations
        GROUP BY student_id HAVING COUNT(*) > ?)`).pluck().get(MAX_SIGNUPS_PER_STUDENT),
      overDay: db.prepare(`SELECT COUNT(*) FROM (SELECT r.student_id FROM registrations r
        JOIN events e ON e.id = r.event_id GROUP BY r.student_id, e.event_date HAVING COUNT(*) > ?)`).pluck().get(MAX_SIGNUPS_PER_DAY),
    };
  } finally {
    db.close();
  }
}

// --- The run ---

function timingLine(kind) {
  const sorted = [...times[kind]].sort((a, b) => a - b);
  const ms = (value) => `${Math.round(value)} ms`.padStart(8);
  return `  ${kind.padEnd(11)} count ${String(sorted.length).padStart(6)}   p50 ${ms(percentile(sorted, 50))}   p95 ${ms(percentile(sorted, 95))}   max ${ms(sorted.at(-1) ?? 0)}`;
}

async function main() {
  console.log('Sæludagar load test (fake data, temporary database)');
  const { keys, students, events, days } = await seed();
  const places = events.reduce((sum, event) => sum + event.capacity, 0);
  console.log(`Students: ${STUDENTS}, events: ${EVENTS} on ${days.length} days, places: ${places}, sign-up window: ${WINDOW_S} s`);

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  await startServer({
    PATH: process.env.PATH ?? '',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    NODE_ENV: 'production',
    PORT: String(port),
    BASE_URL: baseUrl,
    TRUST_PROXY: '1',
    DATABASE_PATH: dbFile,
    UPLOAD_DIR: path.join(tempDir, 'uploads'),
    BACKUP_DIR: path.join(tempDir, 'backups'),
    SESSION_SECRET: crypto.randomBytes(32).toString('base64'),
    KENNITALA_ENC_KEY: keys.kennitalaEncKey,
    KENNITALA_HMAC_KEY: keys.kennitalaHmacKey,
    SCHOOL_NAME: 'Prófunarskóli',
    CONTACT_EMAIL: 'sambandi@example.is',
    PRIVACY_EMAIL: 'personuvernd@example.is',
  });

  const login = await loginAll(students);
  console.log(`Phase 1, login: ${STUDENTS - login.failed} of ${STUDENTS} students logged in, in ${(login.ms / 1000).toFixed(1)} s`);
  const minute = await signupMinute(students.filter((student) => student.loggedIn), events);
  console.log(`Phase 2, sign-up minute: requests sent over ${(minute.sendSpanMs / 1000).toFixed(1)} s (limit 60 s), last response after ${(minute.totalMs / 1000).toFixed(1)} s, peak in flight ${minute.peak} (cap ${MAX_IN_FLIGHT})`);

  const stopped = await stopServer();
  // Windows has no SIGTERM: kill() ends the process at once, so it cannot exit with code 0. There the stop is
  // clean when the server ended because of our own kill('SIGTERM') (reported as { code: null, signal: 'SIGTERM' }).
  // A crash or an early exit reports an exit code instead, so it still fails.
  const stoppedCleanly = process.platform === 'win32' ? stopped?.signal === 'SIGTERM' : stopped?.code === 0;
  if (interrupted) return;
  const db = checkDatabase();

  const fiveXx = [...statusCounts].filter(([status]) => status >= 500).reduce((sum, [, n]) => sum + n, 0);
  const unexpectedTotal = [...unexpected.values()].reduce((sum, n) => sum + n, 0);
  const checks = [
    [`all ${STUDENTS} students logged in`, login.failed === 0],
    ['no 5xx responses', fiveXx === 0],
    ['no network errors', networkErrors === 0],
    ['no unexpected responses', unexpectedTotal === 0],
    ['all requests of the sign-up minute sent within 60 s', minute.sendSpanMs <= PHASE_LIMIT_MS],
    ['at least one sign-up created', db.registrations > 0],
    ['BR-35: no event over its maximum', db.overCapacity === 0],
    [`BR-32: no student over ${MAX_SIGNUPS_PER_STUDENT} sign-ups`, db.overTotal === 0],
    [`BR-65: no student over ${MAX_SIGNUPS_PER_DAY} sign-ups on one day`, db.overDay === 0],
    ['the server stopped cleanly', stoppedCleanly],
  ];
  const passed = checks.every(([, ok]) => ok);

  console.log('');
  console.log('Response times:');
  for (const kind of Object.keys(times)) console.log(timingLine(kind));
  console.log('');
  console.log(`Statuses: ${[...statusCounts].sort(([a], [b]) => a - b).map(([status, n]) => `${status}: ${n}`).join(', ')}`);
  console.log(`5xx responses: ${fiveXx}, network errors: ${networkErrors}, unexpected responses: ${unexpectedTotal}`);
  for (const [what, n] of unexpected) console.log(`  unexpected ${what} (${n})`);
  console.log(`Sign-ups: ${minute.posts} posts, ${db.registrations} sign-ups created, ${db.full} of ${EVENTS} events full`);
  console.log(`Events over their maximum: ${db.overCapacity}, students over ${MAX_SIGNUPS_PER_STUDENT}: ${db.overTotal}, students over ${MAX_SIGNUPS_PER_DAY} on one day: ${db.overDay}`);
  console.log('');
  console.log('Checks:');
  for (const [what, ok] of checks) console.log(`  ${ok ? 'OK    ' : 'FAILED'} ${what}`);
  if (!passed && serverOutput.trim()) {
    console.log('');
    console.log('Server output (last lines):');
    console.log(serverOutput.trim().split('\n').slice(-30).map((line) => `  ${line}`).join('\n'));
  }
  console.log('');
  console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);
  return passed;
}

let passed = false;
try {
  passed = await main();
} catch (err) {
  console.error(err.message);
  if (serverOutput.trim()) console.error(serverOutput.trim().split('\n').slice(-30).join('\n'));
  console.log('Result: FAIL');
} finally {
  await stopServer();
}
if (!interrupted) {
  removeTempDir();
  process.exit(passed ? 0 : 1);
}
