# Conventions

How code and tests are written in this repository, so that a first change looks like the code around it. Business rules and the data model are in [AGENT_START.md](AGENT_START.md), setup and npm scripts in [run.md](run.md), the architecture in [architecture.md](architecture.md), and the rules about asking first and the definition of done in [../CLAUDE.md](../CLAUDE.md).

There is no linter, formatter, type checker, coverage tool or CI in this repository. The only automatic check is `npm test`. Where the code is inconsistent, this file says "most files do X": match the file you are editing.

## Copy from these files

| To add or change | Start from | Also touch |
|---|---|---|
| A page with a form | `src/routes/student.js` (route), `src/views/student/points.ejs` (view) | `src/i18n/is.json` and `src/i18n/en.json`; mount the router in `src/app.js`; a test in `test/` |
| A plain form that searches or filters a list | `src/views/teacher/event.ejs` (the student search, a GET form), `src/views/partials/browse-controls.ejs` (the front page's search, filters and `<select>`) | a helper in the service that turns the query value into a known one (`searchTerm`, `sortOrder` in `src/services/events.js`); texts in both i18n files; a test |
| A business rule in a service | `src/services/signups.js` | the BR comment above the function; `test/signups.test.js` |
| A database write that must be atomic | `src/services/choices.js` (`givePoints`) | `audit()` call inside the transaction; `test/points.test.js` |
| A UI text | `src/i18n/is.json` | the same key in `src/i18n/en.json`; restart the server |
| A browser script | `public/js/points.js` | `<script src="/js/NAME.js" defer></script>` in the view; `public/js/menu.js` for a script every page loads |
| A style | `scss/_forms.scss` | `@use` line in `scss/main.scss` only for a new partial; `npm run build:css` |
| An email template | `src/views/emails/new_code.ejs` | `emails.<kind>.*` in both i18n files; `queueEmail` in `src/services/email.js`; `test/email.test.js` |
| An admin page | `src/routes/admin.js` (`/settings`), `src/views/admin/settings.ejs`; for a page with a GET filter and paging, `src/routes/admin.js` (`/audit`), `src/views/admin/audit.ejs` | `pages.*` and `admin.*` texts; `test/settings.test.js` |
| A command-line script | `scripts/create-admin.js` | an entry in `package.json` `scripts`; `test/create-admin.test.js` |
| A test | `test/points.test.js` | `test/helpers.js` only if several files need the new helper |

## JavaScript on the server

- Use ES modules (`"type": "module"` in `package.json`). Always write the `.js` extension in relative imports. Use named exports only; no file has a default export and none uses `require`.
- Order imports as in `src/app.js`: `node:` modules, then packages, then your own files.
- Check a package's current documentation before you use its API. Several packages in the table in [AGENT_START.md](AGENT_START.md) §10 had recent major releases, so an API you remember may have changed.
- Pass dependencies in; do not import a shared database. `createApp({ config, db })` in `src/app.js` builds the app, and every router is a factory called with what it needs: `studentRouter({ db })`, `adminRouter({ config, db, kt, accounts })`. Services take `db` as their first argument. Reason: tests build a site with a temporary database (`test/helpers.js`).
- Name files in lower camelCase or one lower-case word (`src/db/sessionStore.js`, `src/services/signups.js`). Scripts and browser scripts use kebab-case (`scripts/create-admin.js`, `public/js/card-signup.js`).
- Name functions in camelCase. Router factories end in `Router`; factories that close over dependencies start with `create` (`createApp`, `createAccounts`, `createMailer`). Constants are `UPPER_SNAKE` (`POINTS_PER_ATTENDANCE`).
- Keep the absence-point and sign-up limits (BR-47) in `src/config.js`. Limits of one feature sit at the top of its own file with the BR in a comment (`MAX_FAILED_LOGINS = 5; // BR-05` in `src/services/accounts.js`).
- Format as the existing files do: 2-space indent, single quotes, semicolons, trailing commas in multi-line literals, `const` unless reassigned. Most SQL sits in template literals. There is no line-length rule: most lines are under 120 characters and some are longer. Match the file.
- Write comments in English, above the function or block, saying what it does and which rule it serves. Cite the rule by ID (`BR-31`) or the spec section (`AGENT_START §8`, `§9 item 6`). See the comment above `givePoints` in `src/services/choices.js`.
- Signal an HTTP error by passing an error with a `status` to `next`: `next(Object.assign(new Error('HTTP 400'), { status: 400 }))` (`src/routes/student.js`; `src/routes/admin.js` wraps it as `httpError(status)`). `src/middleware/errors.js` renders the 403, 404 or 500 page from `err.status`. A guard renders `errors/403` or `errors/404` directly (`src/middleware/auth.js`).
- Get the time with `toIso(date)` from `src/db/index.js`. Stored times are UTC ISO strings without milliseconds. A function that depends on the clock takes `now = new Date()` as its last parameter, so a test can pass a fixed date (`choiceWindow`, `signUp`, `setAttendance`).

## Routes

- A route reads the request, calls a service, then redirects or renders. It holds no SQL and no business rule; the service owns those. The one query in a route today is a count in `src/routes/teacher.js`; do not add more.
- Guard a router with `router.use(requireAdmin)` (`src/routes/admin.js`, `src/routes/teacher.js`) or per route with `requireStudent` (`src/routes/student.js`). Guests go to `/login` with 303; a wrong role gets the 403 page. Use `requireEventAccess(db, 'editor' | 'owner')` for `/:id` event routes. Check on the server, never only by hiding a button.
- Read the body as `req.body ?? {}` (it is `undefined` when a request has no form body in Express 5). Check every value before use: `typeof course !== 'string'`, `['give', 'take'].includes(action)`, `Number.isSafeInteger(id)` for an id in a form, and `parseEventId` (`src/services/events.js`) for the event number in an address. Query values can be arrays (`?q=a&q=b`), so treat them as untrusted too: `searchTerm` and `sortOrder` in `src/services/events.js` return a safe default for anything that is not a known string (test: `BR-63: unknown or repeated query values are ignored` in `test/design.test.js`).
- Post, redirect, get. After a successful POST call `setFlash(req, 'success', 'some.key', params)` and `res.redirect(303, path)`. Flash types in use are `success`, `error` and `info`. The view shows it with `<%- include('../partials/flash') %>`. Reason: a reload must not resubmit the form.
- On a validation error do not redirect. Render the same view again with `res.status(400)`, the entered values and `errors` as an object of field name to i18n key (`renderSettings` in `src/routes/admin.js`). Never put a kennitala back into the form. A bad action or id is a 400 or 404 through `next(...)`.
- A route that a script calls with `fetch` still returns the normal page or redirect; the script reads the page that comes back (`public/js/points.js`). Only routes that need it also answer JSON when the request has `Accept: application/json` (`wantsJson` in `src/routes/teacher.js`).

## Services

- One file per area: `attendance.js`, `signups.js`, `events.js`, `choices.js` and so on. Put a new function in the file of the area it belongs to, and start a new file only for a new area. If two files could hold it, choose the one named for what the function returns: a count of attendances goes in `attendance.js`. A helper that reads or checks a request value lives there too, as `searchTerm` and `sortOrder` do in `src/services/events.js` and `isValidDay` in `src/services/settings.js`. There is no `utils` folder.
- Name a function for what it returns or does: `eventParticipants`, `studentPoints`, `attendanceWindow`, `setAttendance`.
- Take `db` first, then the actor or subject id, then the rest, then `now = new Date()` last: `givePoints(db, studentId, course, now)`.
- Return a result, do not throw, for failures a user can cause: `{ ok: true }` or `{ error: 'points.errors.closed', params }`, where `error` is an i18n key and `params` fills its placeholders. Validators return `{ values, errors }` with `errors` keyed by field (`validateTeacher`, `saveTimes`). The route turns the key into a flash or a field error.
- Wrap changes that must stand or fall together in `db.transaction(() => { ... })`. Add `.immediate()` when the function checks something and then writes, and two simultaneous requests could both pass the check: `signUp`, `cancelSignup`, `givePoints`, `takePoints`, `setAttendance`. Put every check inside the transaction, not in the route. Transactions in `src/services/accounts.js`, `events.js` and `import.js` are plain `db.transaction` (most files do not use `.immediate()`; match the file).
- Use prepared statements with `?` placeholders only. Never build SQL from input. `src/services/import.js` passes a list as one JSON value to `json_each(?)`.
- Call `audit(db, action, actorId, eventId, studentId, details)` from `src/services/audit.js` inside the same transaction as the change, for a change to a sign-up, an attendance, a course choice or the event-manager role (BR-56). The action names are listed in the comment on `audit_log.action` in `src/db/schema.sql`. Do not call it from a route.

## Views and texts

- Escape all data with `<%= %>`. Use `<%- %>` only to include your own partials: every use under `src/views/` is an `include(...)`. Reason: AGENT_START §9 item 5.
- Start a view with `<%- include('../partials/header', { pageTitle: t('pages.points') }) %>` and end it with `<%- include('../partials/footer') %>`. Put a `<%# ... -%>` comment at the top saying what the page is and which rule it serves. Use the field partial `src/views/partials/field.ejs` for labelled inputs and `form-errors.ejs` plus `flash.ejs` for messages.
- Views get `t`, `lang`, `formatDate`, `formatDateTime`, `formatFee`, `eventText`, `currentUser`, `csrfToken` and `takeFlash` from middleware (`applyLanguage` in `src/middleware/language.js`), not from the route. A route passes only page data: `res.render('student/points', { points })`. The view path has no extension and is relative to `src/views/`.
- Put the CSRF field in every form that changes state:

```html
<input type="hidden" name="_csrf" value="<%= csrfToken() %>">
```

- Never write an inline `<script>`, a `style="..."` attribute or an event-handler attribute such as `onclick`. The CSP is `script-src 'self'; style-src 'self'`. Test: `security headers: strict CSP without inline styles or scripts` in `test/smoke.test.js` checks the header. No test scans the views for inline styles or handlers, so check by hand. Use a class and a `data-` attribute for script hooks (`data-points-form`).
- Put every text in both `src/i18n/is.json` and `src/i18n/en.json` under the same key. Test: `BR-59: is.json and en.json contain exactly the same keys` in `test/smoke.test.js`. Never hard-code text in a view, route or service. Missing English falls back to Icelandic, but the test fails.
- Name keys in camelCase, nested by area: `pages.points`, `points.errors.closed`, `admin.settings.errors.day`. Page titles are `pages.*`, a service's failure keys are `<area>.errors.*`. Email sections are `emails.<kind>` with the snake_case file name (`emails.new_code`). Placeholders are `{name}`, filled by `t('nav.signedIn', { name })`.
- Write "viðburður" in Icelandic, never "atburður". Tests: `BR-61: Icelandic strings say "viðburður", never "atburður"` in `test/smoke.test.js` and one in `test/design.test.js`.
- Texts are read once at server start (`src/i18n/index.js`). Restart the server after editing them.
- Email templates in `src/views/emails/` are plain text rendered once per language, Icelandic first (BR-52). They get `languages`, so loop with `languages.forEach(({ t }, index) => ...)` as `new_code.ejs` does. `<%= %>` does not HTML-escape there.

## Browser scripts

- Write classic scripts in `public/js/`, one per feature, and load them with `<script src="/js/NAME.js" defer></script>`. No modules, no build step, no libraries, no `import`.
- Make each script only enhance a page that already works as a plain form (AGENT_START §11). Find your page with a `data-` attribute and stop if it is missing: `const pointsPage = document.querySelector('[data-points]'); if (pointsPage) { ... }`.
- Scripts on one page share one global scope, so no two files may declare the same top-level `const`, `let`, `class` or `function` name. Test: `§9 item 2, §11: no two page scripts declare the same top-level name` in `test/smoke.test.js`. Reason: the second script would not run at all. Put code inside the `if` block, as `public/js/points.js` does.
- Send the CSRF token in the `X-CSRF-Token` request header, taken from the form's `_csrf` field: `headers: { 'X-CSRF-Token': body.get('_csrf') }` (`public/js/points.js`, `attendance.js`, `card-signup.js`, `event-dialog.js`).
- Take texts from `data-` attributes the view fills with `t(...)` (`data-network-error` in `points.ejs`), not from strings in the script.

## Styles

- Write SCSS in `scss/`. `scss/main.scss` is only a list of `@use` lines. Each partial holds one area: `_tokens.scss` (custom properties), `_base.scss` (element defaults), `_layout.scss` (header, footer, drawer), `_forms.scss` (forms, buttons, messages), `_tables.scss`, `_events.scss` (front page, cards, event pages), `_pages.scss` (login and info pages), `_teacher.scss` (attendance, print list).
- Take every colour from a token: `var(--color-primary)`. Hex and `rgb()` values appear only in `scss/_tokens.scss`. No test enforces this; keep it by hand. Reason: both modes get the same tokens.
- Light and dark mode: `:root` takes the light tokens and `:root[data-theme="dark"]` the dark ones (mixins `light` and `dark` in `scss/_tokens.scss`). The site does not follow `prefers-color-scheme`. Add a new colour to both mixins.
- Use `rem` for sizes and spacing, `var(--space-1)` to `var(--space-5)` for gaps, and `px` for borders, radii and `--tap-target` (44px). Write mobile first with `min-width` queries in `rem` (22.5, 30, 36, 40, 48, 56, 72). Name classes in BEM style (`points__counter`, `button--small`).
- Rebuild with `npm run build:css` after a change (compressed, no source map). `npm run watch:css` rebuilds on every save without those flags. See [run.md](run.md).

## Database changes

These need the project owner's approval first; see [../CLAUDE.md](../CLAUDE.md). When approved, change these together:

1. `src/db/schema.sql`: what a new database gets.
2. `src/db/migrate.js`: raise `SCHEMA_VERSION` by one and add `STEPS[<old version>](db)`, which upgrades an old database and keeps its data. A step must leave exactly the tables and indexes `schema.sql` describes.
3. The SQL block in `docs/AGENT_START.md` §7 and its schema-version line, so the spec matches.
4. `test/smoke.test.js`, in the `database (§7)` block: update the table and index lists and the `SCHEMA_VERSION` assertion, and add a test that builds the old version (`databaseAt(n)`), calls `migrate`, checks the data and compares `shape(...)` with a new database. Copy the two `migrate upgrades a version ...` tests. Update `databaseAt` too, so it can still undo the new change.

## Tests

- Put tests in `test/`, one file per feature, named `<topic>.test.js` in kebab-case (`test/new-code.test.js`). `test/helpers.js` is shared setup. Use `node:test` and `node:assert/strict`, import from `../src/...` and `./helpers.js`.
- Add a test to the file that already covers the page or rule: search `test/` for the page's address or the BR ID. Inside the file, put it in the `describe` block whose setup it needs. Start a new file only for a new feature.
- A new test must pass when run alone. Create what it checks (`insertEvent`, `site.addUser`) instead of building on what an earlier test left behind, and run it by name before you report. `test/points.test.js` shows the pattern: it empties its tables in `beforeEach`. Some older blocks build on each other and fail when run alone, such as `co-teachers and who manages what` in `test/events.test.js`. Do not copy that.
- A syntax error in a test file shows as one failing test for the whole file, and the pass count drops by the number of tests in that file.
- Helpers in `test/helpers.js`:
  - `startSite(env)` starts the app on a random port with a temporary database and upload folder. Call `site.close()` in `after`.
  - `site.addUser({ role, name, email, isAdmin, code })` inserts an account with a known code and returns `{ id, kennitala, code }`. Kennitölur count up from `0000000001`.
  - `site.browser()` returns a `Browser` with a cookie jar. `browser.login(kennitala, code)`, `get(url)`, `post(url, form)` (adds the CSRF token from the session's page), `request(method, url, form)` (adds none, for testing a missing token). Each returns `{ status, location, html }`.
  - `browser.postForm(url, fields, files)` posts a multipart form such as the event form. `browser.upload(url, bytes, { token, filename })` posts a CSV file.
  - `site.sendEmails()` runs the outbox worker once and returns the emails sent. `codeFrom(email)` reads the 6-digit code from one.
  - `insertEvent(db, ownerId, fields)` inserts an event and its Sæludagar day and returns its id.
  - `tempDatabase()` gives a migrated temporary database (`{ db, remove() }`) for tests without a server. `testConfig(env)` builds a config with test keys.
- Skeleton, modelled on `test/points.test.js`:

```js
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { insertEvent, startSite } from './helpers.js';

let site;
const as = {};

before(async () => {
  site = await startSite();
  const teacher = await site.addUser({ name: 'Kennari' });
  insertEvent(site.db, teacher.id);
  as.guest = site.browser();
});

after(() => site.close());

describe('the info page (§6)', () => {
  test('§6: a guest can open the info page', async () => {
    const res = await as.guest.get('/info');
    assert.equal(res.status, 200);
  });
});
```

- Start the title with the ID of what it covers, then a colon and a plain sentence: `BR-69: nobody can give away more points than they have earned`, `BR-31: students can sign up and cancel only while the window is open`, `§9 item 2, §11: no two page scripts declare the same top-level name`. Most titles start this way. A test that covers no single rule, such as `unknown paths get the 404 page`, has a plain title. Put the milestone and the rules in a comment at the top of the file. If a change touches no business rule, start the title with the spec section the behaviour belongs to (`§6:` for a page) or leave it plain. Never borrow the ID of a rule that does not state the behaviour.
- Write a test for every business rule a change touches (the definition of done in [../CLAUDE.md](../CLAUDE.md) requires it), and test the rule through the service as well as the page (`BR-69: the service refuses on its own, without the route`). To find the rule a piece of code serves, read the comment above it and look the ID up in [AGENT_START.md](AGENT_START.md) §4.
- Give a bug fix a test that fails without the fix: write the test first and run it to see it fail, then fix, and say in your report that you saw it fail. The fixes in this repository's history came with tests: commits `59995b5` and `b8e6c70` each changed `test/` together with the fix. A refactor that changes no behaviour needs no new test; the existing tests must still pass.
- Use only fake data: kennitölur like `0000000001`, emails at `example.is` (`kennari@example.is`). Never real student data.
- Tests never touch `data/` or `.env`: `startSite` and `tempDatabase` use a folder under the OS temp directory, and `testConfig` sets its own keys.
- The tests read the HTML the server sends. The repository has no browser test tool. If your change affects how a page looks or behaves in a browser and you did not look at it in one, say so in your report.
- The commands for all tests, one file and one test by name, and how to read the result, are in [../CLAUDE.md](../CLAUDE.md) under Commands. Some tests check error handling on purpose, so error messages above the summary are normal.

## Commits and pull requests

Commit or push only when you are asked to; the rules are in [../CLAUDE.md](../CLAUDE.md) under Hard rules, Git. Write the subject as one line that says what changed, as the history does: `Milestone 6c: event page and Fjarvistastig`, `Show a clear error when the port is already in use`.

## Traps

- Every text file has LF line endings, in the repository and in every checkout: `.gitattributes` sets `* text=auto eol=lf`. Do not save a file with CRLF. A cloud session runs `.claude/hooks/cloud-setup.sh` on Linux, where a CRLF script fails.
- For a one-off script, use `node`, the one runtime every checkout has. On Windows, `python3` can be the Microsoft Store placeholder, which hangs instead of running.
- Page scripts share one global scope. A repeated top-level name stops the second script (see Browser scripts).
- The CSP blocks inline scripts and `style=` attributes. They fail silently in the browser, so a page can look right in a test and be broken for a user.
- Multipart forms are CSRF-checked inside the route, after multer, with `verifyCsrf`. Add the route's path to `UPLOAD_ROUTES` in `src/middleware/csrf.js`, or the global check refuses the form because it cannot read the body. See `/admin/import` in `src/routes/admin.js`.
- `npm install` can print an audit notice that suggests `npm audit fix`. Do not act on it yourself: upgrading a package and running `npm audit fix` are on the "Ask first" list in [../CLAUDE.md](../CLAUDE.md).
- Stored times are UTC ISO strings. Iceland is UTC+0 all year, so stored time is local time; the formatters in `src/i18n/index.js` still name `Atlantic/Reykjavik`.
- The error handler logs only the stack of an error, never its body, because body-parser errors carry the raw form, which can hold a kennitala or a code (`src/middleware/errors.js`). Keep it that way. The privacy rules are in [../CLAUDE.md](../CLAUDE.md).
- Emails never carry a login code in the outbox payload (`src/services/email.js`); codes are made when the email is sent.
- Names sort in Icelandic order with `new Intl.Collator('is')`, not with SQL `ORDER BY` or `localeCompare` (`src/services/signups.js`).
- A session cookie named `sid` is the only cookie (BR-57). The language and theme live in the session, so do not add a cookie for a new preference.
