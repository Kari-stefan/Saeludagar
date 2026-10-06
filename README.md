# Sæludagar

A website for the school's Sæludagar: the few days in the school year when attendance is optional and the school runs events (viðburðir).

- **Students** log in with their kennitala and a personal code, sign up for up to 4 events, and after attending choose which of their courses gets 4 absence points (fjarvistarstig) removed.
- **Teachers** create events, manage participant lists, email participants and mark attendance.
- **An admin** imports student data, sets the dates, and exports a file for the school office to enter into Inna.

The site is bilingual (Icelandic and English) and will run at saeludagar.is.

## Status

Milestone 1 (project scaffold and data model) is built. The next step is milestone 2 (login, accounts and email). Target: finished and approved by 1 February 2027, for Sæludagar in March 2027.

## Documentation

| File | What it is |
|---|---|
| [docs/AGENT_START.md](docs/AGENT_START.md) | **The full specification**: business rules, pages, data model, build plan, open questions |
| [docs/run.md](docs/run.md) | **How to run the site on your computer**, with Windows notes and troubleshooting |
| [docs/requirements.md](docs/requirements.md) | Original requirements (reference only) |
| [docs/saeludagar-notes.txt](docs/saeludagar-notes.txt) | Original meeting notes (reference only) |
| [CLAUDE.md](CLAUDE.md) | Instructions Claude Code loads automatically in this repo |

Where the original notes and AGENT_START.md disagree, AGENT_START.md wins. Unresolved items, such as SMTP access and the school's logo, are listed in section 15 of AGENT_START.md.

## Tech stack

Node.js 24 LTS, Express 5, EJS, SCSS compiled to CSS, SQLite (better-sqlite3) and plain JavaScript in the browser. The full package list and versions are in section 10 of AGENT_START.md.

## Repository layout

```
docs/          specification and original planning notes
src/           server code: routes, services, database, i18n, views
scss/          styles, compiled to public/css/
public/        static files (compiled CSS, browser JS, images)
scripts/       admin and maintenance scripts (create-admin, backup, load test)
test/          tests (node:test)
data/          SQLite database (not committed)
uploads/       event images (not committed)
backups/       local backups (not committed)
.claude/       shared Claude Code settings, review agent and commands
```

Folders that are still empty hold a `.gitkeep` file so git keeps them.

## How we work

### Branches
- `main` is the main branch. Nobody works on it directly.
- Each person works on their own branch (for example `kari`), then opens a pull request into `main`. A teammate reviews it before it is merged.

### Building with Claude Code
The site is built one milestone at a time from [docs/AGENT_START.md](docs/AGENT_START.md):

1. Run `/milestone 1` (or the next number). Claude builds that milestone only, then stops.
2. Run `/review` to have the `spec-reviewer` agent check the changes against the business rules, the security requirements and the milestone's scope.
3. Check the result yourself using the "how to verify" steps Claude gives.
4. Commit, push your branch and open a pull request into `main`.
5. After it is merged, move on to the next milestone.

Claude Code asks before installing packages, pushing, or anything else section 14 of AGENT_START.md lists. It cannot read `.env`, the database or the backups. These rules are in `.claude/settings.json`.

## Setup

The quick version is below. For a step-by-step guide covering what you should see, Windows PowerShell notes and troubleshooting, see **[docs/run.md](docs/run.md)**.

You need **Node.js 24 LTS**. Check with `node -v`.

1. **Install the packages:**
   ```
   npm install
   ```
   better-sqlite3 and the Sass file watcher ship prebuilt binaries for Windows, macOS and Linux (x64 and arm64), so nothing is compiled and no build tools are needed. `package.json` turns off their install scripts (`allowScripts`), because npm 11 otherwise tries to compile better-sqlite3 from source and fails on machines without build tools. On a platform with no prebuilt binary, run `npm install-scripts approve better-sqlite3` to compile it; that needs Python and a C++ compiler.
2. **Create your `.env`** from the example:
   ```
   cp .env.example .env              # PowerShell: Copy-Item .env.example .env
   ```
3. **Generate the secrets.** Run this once for each of `SESSION_SECRET`, `KENNITALA_ENC_KEY` and `KENNITALA_HMAC_KEY`, and paste each result into `.env`:
   ```
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```
   Only `SESSION_SECRET` is used so far; the kennitala keys are needed from milestone 2. Never commit `.env`. If the kennitala keys are lost, stored kennitölur can't be read or matched. The student CSV then has to be imported again, and every teacher account, the admin's included, created again. Keep a copy of the keys somewhere other than the database backups.
4. **Create the database** (in `data/saeludagar.db`):
   ```
   npm run migrate
   ```
5. **Build the CSS and start the site:**
   ```
   npm run build:css
   npm run dev
   ```
   Open http://localhost:3000. To rebuild the CSS whenever you change it, run `npm run watch:css` in a second terminal.
6. **Run the tests:**
   ```
   npm test
   ```

### Scripts

| Script | What it does | Works from |
|---|---|---|
| `npm run dev` | Starts the site and restarts it when files change | Milestone 1 |
| `npm run watch:css` | Rebuilds `public/css/main.css` when SCSS changes | Milestone 1 |
| `npm run build:css` | Builds the CSS once, compressed | Milestone 1 |
| `npm start` | Starts the site (production) | Milestone 1 |
| `npm run migrate` | Creates the database tables | Milestone 1 |
| `npm test` | Runs the tests | Milestone 1 |
| `npm run create-admin` | Creates the first admin account | Milestone 2 |
| `npm run seed:dev` | Fills the database with fake development data | When needed |
| `npm run backup` | Backs up the database and uploads | Milestone 8 |
| `npm run loadtest` | 1,000-student sign-up load test | Milestone 8 |

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development` or `production` | `development` |
| `PORT` | Port the site listens on | `3000` |
| `BASE_URL` | Public address of the site, used in emails | `http://localhost:3000` |
| `SCHOOL_NAME` | Shown in the title: "Sæludagar – {SCHOOL_NAME}" | empty |
| `DATABASE_PATH` | SQLite database file | `./data/saeludagar.db` |
| `UPLOAD_DIR` | Event images | `./uploads` |
| `BACKUP_DIR` | Database backups | `./backups` |
| `SESSION_SECRET` | **Required.** Signs the session cookie | none |
| `KENNITALA_ENC_KEY` | Encrypts kennitölur (milestone 2) | none |
| `KENNITALA_HMAC_KEY` | Separate key for kennitala lookups (milestone 2) | none |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | The school's mail server (milestone 2). If `SMTP_HOST` is empty, emails are printed to the console instead of sent | empty, `587`, `false` |
| `SMTP_MAX_PER_MINUTE` | Sending limit for bulk email | `30` |
| `TRUST_PROXY` | Set to `1` behind nginx in production | `0` |

## Data protection

The site handles students' kennitölur, names and emails, and many students are under 18. Never commit real student data, `.env` or database files. Tests and development data use fake kennitölur such as `0000000001`.
