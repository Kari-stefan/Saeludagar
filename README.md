# Sæludagar

A website for the school's Sæludagar: the few days in the school year when attendance is optional and the school runs events (viðburðir).

- **Students** log in with their kennitala and a personal code, sign up for up to 4 events, and after attending choose which of their courses gets 4 absence points (fjarvistarstig) removed.
- **Teachers** create events, manage participant lists, email participants and mark attendance.
- **An admin** imports student data, sets the dates, and exports a file for the school office to enter into Inna.

The site is bilingual (Icelandic and English) and will run at saeludagar.is.

## Status

Milestones 1 and 2 are built: the project scaffold and data model, then login, accounts and email. Until the school's mail server details arrive, emails are printed in the terminal instead of sent. The next step is milestone 3 (admin settings, student import, sending codes). Target: finished and approved by 1 February 2027, for Sæludagar in March 2027.

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

You need **Node.js 24 LTS**, a recent version: `node -v` prints `v24.something` and `npm -v` prints **11.16 or newer**.

1. **Install the packages:**
   ```
   npm install
   ```
   better-sqlite3 and the Sass file watcher ship prebuilt binaries for Windows, macOS and Linux (x64 and arm64), so nothing is compiled and no build tools are needed.

   `package.json` turns off their install scripts (`allowScripts`), because npm otherwise tries to compile better-sqlite3 from source and fails on machines without build tools. npm older than 11.16 ignores `allowScripts`; see the troubleshooting in [docs/run.md](docs/run.md).

   On a platform with no prebuilt binary (rare), compile it yourself, which needs Python and a C++ compiler. First delete the `"better-sqlite3": false` line from `allowScripts` in your local `package.json` (don't commit that change). Then run `npm install-scripts approve better-sqlite3` and `npm rebuild better-sqlite3`.
2. **Create your `.env`** from the example. Skip this if you already have one, because copying overwrites it:
   ```
   cp .env.example .env              # PowerShell: Copy-Item .env.example .env
   ```
3. **Generate the secrets.** This prints three lines; replace the three empty lines in `.env` with them:
   ```
   node -e "for (const k of ['SESSION_SECRET','KENNITALA_ENC_KEY','KENNITALA_HMAC_KEY']) console.log(k + '=' + require('node:crypto').randomBytes(32).toString('base64'))"
   ```
   All three are required. Never commit `.env`. If the kennitala keys are lost, stored kennitölur can't be read or matched. The student CSV then has to be imported again, and every teacher account, the admin's included, created again. Keep a copy of the keys somewhere other than the database backups.
4. **Create the database** (in `data/saeludagar.db`):
   ```
   npm run migrate
   ```
5. **Create your admin account.** On your own computer, use a fake kennitala such as `0000000001`, never a real one:
   ```
   npm run create-admin -- --name "Your Name" --email "you@example.is" --kennitala "0000000001"
   ```
   It prints your login code. This is the only time the code is shown. To try a student login, `npm run seed:dev` creates three fake students and prints their codes.
6. **Build the CSS and start the site:**
   ```
   npm run build:css
   npm run dev
   ```
   Open http://localhost:3000 and log in with the kennitala and the code. To rebuild the CSS whenever you change it, run `npm run watch:css` in a second terminal.

   While `SMTP_HOST` in `.env` is empty, emails (such as the codes of teachers you create) are printed in the `npm run dev` terminal instead of sent.
7. **Run the tests:**
   ```
   npm test
   ```

### Scripts

| Script | What it does | Works from |
|---|---|---|
| `npm run dev` | Starts the site and restarts it when JavaScript in `src/` or `.env` changes | Milestone 1 |
| `npm run watch:css` | Rebuilds `public/css/main.css` when SCSS changes | Milestone 1 |
| `npm run build:css` | Builds the CSS once, compressed | Milestone 1 |
| `npm start` | Starts the site (production) | Milestone 1 |
| `npm run migrate` | Creates the database tables | Milestone 1 |
| `npm test` | Runs the tests | Milestone 1 |
| `npm run create-admin` | Creates the first admin account | Milestone 2 |
| `npm run seed:dev` | Creates fake students (with new codes) for trying student login. Development only | Milestone 2 |
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
| `KENNITALA_ENC_KEY` | **Required.** Encrypts kennitölur | none |
| `KENNITALA_HMAC_KEY` | **Required.** A separate key for kennitala lookups | none |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | The school's mail server. `MAIL_FROM` (the noreply address) is required when `SMTP_HOST` is set. If `SMTP_HOST` is empty, development prints emails to the console instead of sending them; production never prints them, and they stay queued | empty, `587`, `false` |
| `SMTP_MAX_PER_MINUTE` | Sending limit for bulk email | `30` |
| `TRUST_PROXY` | Set to `1` behind nginx in production | `0` |

## Data protection

The site handles students' kennitölur, names and emails, and many students are under 18. Never commit real student data, `.env` or database files. Tests and development data use fake kennitölur such as `0000000001`.
