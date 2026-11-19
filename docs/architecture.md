# Architecture

This file explains how the code is put together: what runs, how a request travels, which layer does what, and where new code goes. The rules and the data model are in [AGENT_START.md](AGENT_START.md) (§4 and §7), setup and environment variables are in [run.md](run.md), and coding conventions and testing are in [conventions.md](conventions.md).

## What runs

One Node process, started by `src/server.js`, and nothing else. It runs these parts:

- **The Express app**, built by `createApp` in `src/app.js` and listening on `PORT`.
- **The outbox worker** (`src/jobs/outbox.js`). A timer ticks every 5 seconds and sends the emails that are due, at most `SMTP_MAX_PER_MINUTE` per minute.
- **Session cleanup** (`src/jobs/sessionCleanup.js`). It deletes expired session rows every 15 minutes.
- **The auto-purge check** is not built yet (milestone 8). There is no purge service and no purge job.

Both jobs start only after the port is bound. The SQLite file is `DATABASE_PATH` (default `data/saeludagar.db`), opened by `src/db/index.js` with `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000` and `synchronous = NORMAL`. Event images are files in `UPLOAD_DIR` (default `uploads/`). Sessions are rows in the `sessions` table, kept by `src/db/sessionStore.js`.

At startup `src/server.js` never migrates. If the database file is missing it is created empty, and if `PRAGMA user_version` differs from `SCHEMA_VERSION` (`src/db/migrate.js`) the process prints "Run: npm run migrate" and exits with code 1. It also exits with code 1 when `createApp` or `createMailer` throws, for example for a missing `SESSION_SECRET`, a missing or invalid kennitala key, or an SMTP host without `MAIL_FROM`. On SIGINT or SIGTERM it stops session cleanup, waits up to 5 seconds for the email being sent and for open requests, closes the database and exits. A second signal exits at once.

## How a request is handled

The middleware order in `src/app.js`:

1. `helmet` sets security headers and the Content-Security-Policy. HSTS is on only in production.
2. `express.static` serves `public/`.
3. `GET /uploads/:file` serves an image from `UPLOAD_DIR` only if the name matches `IMAGE_NAME`, otherwise it falls through.
4. `express-session` (cookie `sid`, rolling, store `SqliteSessionStore`).
5. `languageMiddleware` puts `t`, the date and fee formatters and `theme` in `res.locals`.
6. `loadUser(db)` reads the user row on every request and sets `req.user` (or `null`). An inactive user's session keys are removed.
7. `csrfToken` adds `csrfToken()` to `res.locals`, creating the session token on first use.
8. `flash` adds `takeFlash()` to `res.locals`.
9. `express.urlencoded` parses form bodies (limit 100 kb).
10. `verifyCsrfUnlessUpload` checks the CSRF token on every non-GET request, except multipart requests to the upload routes.
11. The five routers, below.
12. `notFound` renders the 404 page.
13. `errorHandler` renders the 403, 404 or 500 page.

Routers and their guards (guards are in `src/middleware/auth.js`; a guest is redirected to `/login`, a user without the role gets the 403 page):

| Router | Mounted at | Guard |
|---|---|---|
| `src/routes/public.js` | `/` | none. Front page, `/info`, `/events/:id`, sign-up and cancel, `/language`, `/theme`. Sign-up checks `req.user` inside the route. |
| `src/routes/auth.js` | `/` | none. `/login`, `/login/new-code`, `/logout`. |
| `src/routes/student.js` | `/` | `requireStudent` on each route: `/points`, `/my-events` (a redirect). |
| `src/routes/teacher.js` | `/teacher` | `requireTeacher` on the whole router (event manager or admin), plus `requireEventAccess(db, 'editor' or 'owner')` on `/events/:id/...`. |
| `src/routes/admin.js` | `/admin` | `requireAdmin` on the whole router. |

Inside `/admin`, only `/purge` is still a placeholder page: `src/views/admin/purge.ejs` shows just the page title. It is not built yet (milestone 8).

The error path: a route that throws, or calls `next(err)`, reaches `errorHandler` in `src/middleware/errors.js`. It uses `err.status` when it is 400 to 599, otherwise 500, and logs only the stack of server errors. Routes create such errors with `Object.assign(new Error('HTTP 400'), { status: 400 })`. A failed CSRF check renders the 403 page directly.

## Layers

- **Routes** (`src/routes/`) read the request, call services, and choose a redirect, a flash message or a view. They do not hold business rules. They hold almost no SQL: the only query in a route is a count in `src/routes/teacher.js` (the attendance save), and `src/middleware/auth.js` reads the user row.
- **Services** (`src/services/`) hold the rules and nearly all SQL. Each takes `db` (and `kt`, the kennitala crypto, where needed) as its first argument or in a factory. Rules that must not race (sign-up, attendance, giving points, event save and delete, import) run in a single transaction inside the service, so a route cannot skip a check. Services render no views and read no request objects. `src/services/accounts.js` is a factory, `createAccounts({ db, kt, newCodeLimit })`.
- **DB** (`src/db/`) opens the connection, defines the schema (`schema.sql`), runs migrations (`migrate.js`) and holds the session store. `SCHEMA_VERSION` is 3 and `STEPS` in `migrate.js` upgrade version 1 and 2 data.
- **Views** (`src/views/`) are EJS files assembled from partials in `src/views/partials/`. There is no layout engine and no database access in views. `src/views/emails/` holds the plain-text email templates, rendered by `renderEmail` in `src/services/email.js`.
- **i18n** (`src/i18n/index.js`) loads `is.json` and `en.json`, and provides `t()`, the date, time and fee formatters, and `eventText`. A missing English string falls back to Icelandic, then to the key.
- **Browser scripts** (`public/js/`) only enhance pages that already work as plain forms. They send the same forms the page would send, and the server stays the source of truth.
- **Styles** are `scss/main.scss`, which `@use`s the partials in `scss/` and is compiled to `public/css/main.css` (generated, not in git).

Dependencies are passed in, not imported as globals. `createApp({ config, db, sessionStore })` builds `kt` and `accounts` and hands each router only what it needs: `publicRouter({ db })`, `authRouter({ accounts })`, `studentRouter({ db })`, `teacherRouter({ config, db })` and `adminRouter({ config, db, kt, accounts })`. `createOutboxWorker({ db, mailer, config })` is built in `src/server.js`. Tests build the same pieces from `test/helpers.js` (`testConfig`, `tempDatabase`, `insertUser`, `insertEvent`).

## How data flows

**a) Logging in with kennitala and code.**
1. `POST /login` (`src/routes/auth.js`) normalises the kennitala (`src/services/crypto.js`) and checks the code is 6 digits.
2. `accounts.login` (`src/services/accounts.js`) finds `users.kennitala_hmac`. In one transaction it counts the attempt in `users.failed_logins` and sets `users.locked_until` on the 5th, and refuses a locked account.
3. `verifyCode` (`src/services/codes.js`) always runs one scrypt check against `users.code_hash`, with a dummy hash if there is no account or no code. An inactive account fails like a wrong code.
4. On success the route regenerates the session, stores `userId`, `role`, `isAdmin`, `lang` and `theme`, and sets the cookie length to 2 hours (student) or 12 hours (teacher and admin). The session is a row in `sessions`.

**b) The student CSV import** (`/admin/import`, `src/services/import.js`).
1. `readUpload` (multer, memory storage, 5 MB) reads the file, then `verifyCsrf` runs.
2. `readStudentCsv` decodes (UTF-8, or Windows-1252 if invalid), checks every line and collects all errors.
3. `holdImport` keeps the checked students in this process's memory for 10 minutes under a token stored in `req.session.importToken`. `previewImport` shows the counts.
4. The confirm post calls `takeImport` and `applyImport`, one transaction. It writes `users` (kennitala as `kennitala_enc` and `kennitala_hmac`) and `student_courses`. Students missing from the file get `active = 0`, their `sessions` rows are deleted, and their sign-ups without attendance are deleted. Both the sign-up removals and `choice.clear` entries (`registrations.course_code` cleared) are written to `audit_log`.

**c) An event from draft to published, with images** (`src/routes/teacher.js`, `src/services/events.js`, `src/services/images.js`).
1. `POST /teacher/events/new` runs multer (`images` field, up to 5 files of 2 MB, memory), then `verifyCsrf`, then `validateEvent`.
2. `imageType` reads each file's first bytes. `saveImage` writes `<uuid>.<ext>` to `UPLOAD_DIR`.
3. `createEvent` inserts `events` (status `draft`), `event_brautir` and `event_images`, in one transaction. If it fails the saved files are deleted.
4. `POST /teacher/events/:id/edit` can add images and remove saved ones. If date, time or location change, `updateEvent` queues an `event_changed` row in `email_outbox` for each signed-up student.
5. `POST /teacher/events/:id` with `action=publish` calls `publishEvent`, which sets `events.status = 'published'`. Students then see it through `publishedEvents`.
6. Deleting (owner or admin) calls `deleteEvent`: it is refused once attendance is marked, otherwise it queues `event_deleted`, writes `signup.delete` rows to `audit_log`, deletes the event, and its rows in `event_brautir`, `event_coteachers`, `event_images` and `registrations` go with it (`ON DELETE CASCADE`). The route then deletes the image files.

**d) Sign-up, attendance, then points to a course.**
1. `POST /events/:id` calls `signUp` (`src/services/signups.js`), a `BEGIN IMMEDIATE` transaction that checks the window in `settings`, capacity, braut, and the limits from `src/config.js`, then inserts `registrations` and `audit_log` (`signup.create`).
2. On the event day `POST /teacher/events/:id/attendance` calls `setAttendance` (`src/services/attendance.js`), which sets `registrations.attended`, `attendance_marked_by` and `attendance_marked_at`, and writes `attendance.set` or `attendance.unset`. Unmarking also clears `course_code` and `course_chosen_at`.
3. `POST /points` calls `givePoints` or `takePoints` (`src/services/choices.js`). Giving uses the earliest attended `registrations` row with no `course_code`, checks the course is in `student_courses` and under its maximum, sets `course_code`, and writes `choice.set`. Taking back writes `choice.clear`.

**e) An email from queue to sent or printed.**
1. A service calls `queueEmail` (`src/services/email.js`), which inserts `email_outbox` with `kind`, `priority`, `user_id`, `payload`, `next_try_at`. Login codes are queued with no code (`queueCode`, `sendStudentCodes` in `accounts.js`).
2. The worker picks the due row with the lowest `priority`, then `id`. For `student_code`, `new_code` and `teacher_code` it generates the code, renders the template, sends, and only then stores `users.code_hash` and deletes the row. Other kinds are rendered from `payload`.
3. `createMailer` sends through nodemailer if `SMTP_HOST` is set. Without it, outside production, the email is printed to the console. In production the send throws.
4. A failure updates `attempts`, `last_error` and `next_try_at` (1, 2, 4, 8, 16 minutes). After 5 retries `next_try_at` is `NULL` and the row stays. An email to an inactive user is deleted unsent.

**f) The office export.**
1. `GET /admin/export` renders the page with `exportSummary` (`src/services/export.js`), which counts the `registrations` rows with `attended = 1`, counts those with no `course_code`, and reads the course-choice deadline through `choiceWindow`.
2. `GET /admin/export.csv` calls `exportRows` and passes the rows to `exportCsv`, which builds the file text. The file's format is in `docs/AGENT_START.md` §8 "Absence-system handoff (office export)", not here.
3. `exportRows` selects one row for each `registrations` row with `attended = 1`, joined to `users` (`student_id`) and `events` (`event_id`). It does not filter on `users.active`. It reads `users.kennitala_enc`, `users.name`, `users.braut`, `registrations.course_code`, `events.title_is` and `events.event_date`. It is the only place in `src/` that calls `decrypt` on a kennitala.
4. The route sets `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment` with the file name from `exportFileName`, and `Cache-Control: no-store`.

The audit log (`src/services/audit.js`, table `audit_log`) is written by `signups.js`, `attendance.js`, `choices.js`, `import.js` and `accounts.js` (event-manager grant and revoke), and directly by SQL in `deleteEvent` and `applyImport`. The page that shows it is `/admin/audit`, which reads the log with `auditEntries` (one filtered page of entries, newest first) and `auditEvents` (the events for the filter list) from the same file.

## Directory map

| Path | What lives there | New code of this kind goes here |
|---|---|---|
| `src/server.js` | Entry point: config, database check, jobs, shutdown | Only process start and stop code |
| `src/app.js`, `src/config.js` | Middleware order and router mounting; reading the environment and the fixed constants | A new middleware step or router mount; a new setting |
| `src/routes/` | The five routers | A new page or form handler, in the router for its audience |
| `src/services/` | Rules, queries, email, images, CSV | New business logic and SQL |
| `src/middleware/` | Auth guards, CSRF, flash, language, errors | New cross-request behaviour |
| `src/db/` | Connection, `schema.sql`, `migrate.js`, `sessionStore.js` | Schema changes: edit `schema.sql` and add a `STEPS` entry, raise `SCHEMA_VERSION` |
| `src/jobs/` | `outbox.js`, `sessionCleanup.js` | A new timed job, started in `src/server.js` |
| `src/i18n/` | `index.js`, `is.json`, `en.json` | New text, in both JSON files |
| `src/views/` | EJS: `public/`, `student/`, `teacher/`, `admin/`, `partials/`, `emails/`, `errors/` | A new page in the folder for its audience; shared pieces in `partials/` |
| `public/js/` | One script per enhanced page | A new enhancement script |
| `public/img/` | `logo.svg`, `default-event.svg` | Static images |
| `public/css/` | `main.css`, built from `scss/` (git-ignored, generated by `npm run build:css`) | Nothing; edit `scss/` |
| `scss/` | `main.scss` and partials `_tokens`, `_base`, `_layout`, `_forms`, `_tables`, `_events`, `_pages`, `_teacher` | Styles, in the matching partial, then add a `@use` in `main.scss` for a new file |
| `scripts/` | `create-admin.js`, `seed-dev.js`; `backup.js` and `loadtest.js` are not built yet (milestone 8), though `package.json` has scripts for them | Command-line tools |
| `test/` | `*.test.js` and `helpers.js`, run by `node --test` | Tests, see [conventions.md](conventions.md) |
| `docs/` | `AGENT_START.md` (the specification), `run.md`, this file, `conventions.md`, the five reference files (the original notes and the project owner's briefs) and `example-students.csv` | Documentation. [../CLAUDE.md](../CLAUDE.md) says which file is the home of which topic |
| `data/`, `uploads/`, `backups/` | Runtime files: database, event images, backups. Only `.gitkeep` is tracked; contents are git-ignored | Nothing; runtime only |
| `.claude/` | Claude Code settings, the `/milestone` and `/review` commands, the `spec-reviewer` agent and the model-routing hook | Nothing, unless the project owner asks (see [../CLAUDE.md](../CLAUDE.md)) |
| `.github/workflows/` | `copilot-setup-steps.yml`, which prepares a GitHub Copilot agent's machine (Node.js 24, `npm ci`). It is not a CI check: nothing here tests a change | Nothing else, unless you are asked. The repository has no CI |
| Root | `package.json`, `.env.example`, `.gitignore`, `README.md`, `CLAUDE.md` (the `.env` file is git-ignored) | See [../README.md](../README.md) and [../CLAUDE.md](../CLAUDE.md) |

## Decisions and their reasons

| Decision | Reason | Source |
|---|---|---|
| One Node process, no cluster mode | SQLite is written from a single process; WAL mode with `busy_timeout` handles concurrent reads | `AGENT_START.md` §10 (hosting) |
| Scheduled jobs run inside the app process | The spec places the outbox worker and session cleanup there; backups are the exception and run outside | `AGENT_START.md` §8, `src/server.js` |
| Locked stack, and Node built-ins instead of extra packages | The spec fixes the packages and lists the built-in that replaces each missing one (dotenv, nodemon, test framework, i18n library); no further reason is given | `AGENT_START.md` §10 |
| A custom SQLite session store | Expiry is checked on the server so an old cookie cannot revive a session; `sessions.user_id` lets deactivation delete a user's sessions | `src/db/sessionStore.js` |
| Login codes stored as scrypt hashes, generated when the email is sent | The plaintext code is never stored; an unknown, locked or inactive account still costs one scrypt check, so every failure looks the same | `AGENT_START.md` §8, `src/services/accounts.js` |
| Kennitala stored as AES-256-GCM ciphertext plus an HMAC | The HMAC column (`kennitala_hmac`, unique) is for lookups; decryption is only for the office export | `AGENT_START.md` §8, `src/db/schema.sql` |
| Lockout and new-code limit counted per account, not per IP | Most students share the school's public IP | `AGENT_START.md` §9 item 7 |
| Email goes through the `email_outbox` table, with a per-minute limit | The limit defaults to 30, the usual Microsoft 365 per-mailbox limit | `AGENT_START.md` §8 |
| Console email only outside production | Emails contain login codes | `src/services/email.js` |
| Images stored outside `public/` under random names | Only names matching `IMAGE_NAME` are served, so nothing else can be asked for under `/uploads`; the file type comes from the first bytes, never the name or browser | `src/services/images.js`, `src/app.js` |
| Multipart routes verify CSRF after multer | Only multer can read a multipart body, so the token cannot be checked earlier | `src/middleware/csrf.js` |
| Scripts only enhance pages that work without JavaScript | The server stays the only source of truth | `public/js/card-signup.js`, `public/js/points.js` |
| `audit_log.event_id` has no foreign key | Entries survive event deletion until the purge | `src/db/schema.sql` |
