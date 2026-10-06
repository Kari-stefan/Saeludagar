# Running Sæludagar on your computer

This guide gets the site running locally for development, and covers what to do when something goes wrong. Commands are shown for **PowerShell** (the default terminal in VS Code on Windows), **Command Prompt**, and **Git Bash / macOS / Linux** wherever they differ.

As of milestone 1 the site is only a shell: every page exists and shows its title, and the ÍS/EN switch works. Nobody can log in yet.

## Contents
1. [What you need](#1-what-you-need)
2. [Windows: let PowerShell run npm](#2-windows-let-powershell-run-npm)
3. [First-time setup](#3-first-time-setup)
4. [Start the site](#4-start-the-site)
5. [Working on the code](#5-working-on-the-code)
6. [Run the tests](#6-run-the-tests)
7. [After pulling new code](#7-after-pulling-new-code)
8. [Reset your local database](#8-reset-your-local-database)
9. [Troubleshooting](#9-troubleshooting)
10. [Where things are](#10-where-things-are)

## 1. What you need

- **Node.js 24 LTS.** Check with `node -v`; it should print `v24.something`. Older versions do not work. Install it from [nodejs.org](https://nodejs.org).
- **Git**, and a copy of the repository:
  ```
  git clone https://github.com/Kari-stefan/Saeludagar.git
  cd Saeludagar
  ```
  Work on your own branch, never on `main` (see "How we work" in the [README](../README.md)).

You don't need any build tools or a separate database server. SQLite runs inside the app.

## 2. Windows: let PowerShell run npm

On a new Windows machine, the first `npm` command in PowerShell often fails like this:

```
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system.
```

Windows blocks the small `npm.ps1` launcher that Node installs. There is nothing wrong with the project. Pick one fix:

- **Fix it once (recommended).** This allows scripts installed on your computer for your user account; scripts downloaded from the internet must still be signed. Run it in PowerShell, then open a new terminal:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```
- **Change nothing.** Type `npm.cmd` instead of `npm` each time, for example `npm.cmd run dev`.
- **Use another terminal.** Command Prompt and Git Bash are not affected. In VS Code, press `Ctrl+Shift+P`, run **Terminal: Select Default Profile**, and pick one.

## 3. First-time setup

Run these from the project folder.

**1. Install the packages.**
```
npm install
```
Nothing needs compiling: better-sqlite3 and the Sass file watcher come with prebuilt binaries for Windows, macOS and Linux. If you see `gyp ERR!` here, see [Troubleshooting](#9-troubleshooting).

**2. Create your `.env` file** from the example:

| Terminal | Command |
|---|---|
| PowerShell | `Copy-Item .env.example .env` |
| Command Prompt | `copy .env.example .env` |
| Git Bash / macOS / Linux | `cp .env.example .env` |

`.env` holds your private settings. Git ignores it; never commit it or share it.

**3. Generate the secrets.** This prints three lines with random values (it works in all three terminals):
```
node -e "for (const k of ['SESSION_SECRET','KENNITALA_ENC_KEY','KENNITALA_HMAC_KEY']) console.log(k + '=' + require('node:crypto').randomBytes(32).toString('base64'))"
```
Open `.env` and **replace** the three empty lines (`SESSION_SECRET=`, `KENNITALA_ENC_KEY=`, `KENNITALA_HMAC_KEY=`) with the printed lines. Don't add them as extra lines: if a name appears twice, the last line wins, so an empty line further down would undo your value.

Only `SESSION_SECRET` is used so far; the two kennitala keys are needed from milestone 2. Every developer generates their own values. You can leave the other settings as they are; [README → Environment variables](../README.md#environment-variables) explains each one.

**4. Create the database:**
```
npm run migrate
```
You should see `Database ready at …\data\saeludagar.db (schema version 1).` Running it again is safe.

**5. Build the CSS:**
```
npm run build:css
```
This creates `public/css/main.css`. Without it the pages load but have no styling.

## 4. Start the site

```
npm run dev
```

When you see `Sæludagar is running at http://localhost:3000`, open **http://localhost:3000** in your browser. To stop the server, press `Ctrl+C` in its terminal.

**What you should see (milestone 1):**
- A header with "Sæludagar" (followed by the school's name, if `SCHOOL_NAME` is set in `.env`), an "Innskráning" link and **ÍS / EN** buttons.
- The front page heading "Viðburðir á Sæludögum".
- **EN** switches the whole page to English ("Log in", "Sæludagar events"). **ÍS** switches back. The choice is kept as you move between pages.
- Every planned page already exists and shows only its title. Try:

| Page | Address |
|---|---|
| Front page | http://localhost:3000/ |
| Log in | http://localhost:3000/login |
| My events (students) | http://localhost:3000/my-events |
| Teacher area | http://localhost:3000/teacher |
| New event | http://localhost:3000/teacher/events/new |
| Admin area | http://localhost:3000/admin |
| Send codes | http://localhost:3000/admin/codes |

The full list of pages is in section 6 of [AGENT_START.md](AGENT_START.md). Teacher and admin pages have no login check yet; that arrives in milestone 2.

To use a different port, set `PORT` in `.env` (and `BASE_URL` to match), then open that port instead.

## 5. Working on the code

Keep `npm run dev` running in one terminal. If you are changing styles, run this in a **second** terminal (in VS Code, use the split-terminal button):
```
npm run watch:css
```

What you need to do after a change depends on the file:

| You changed | What to do |
|---|---|
| JavaScript in `src/` | Nothing. The server restarts by itself (you'll see `Restarting 'src/server.js'`). |
| A view in `src/views/` (`.ejs`) | Refresh the browser. |
| Text in `src/i18n/is.json` or `en.json` | Restart the server (`Ctrl+C`, then `npm run dev`). These files are only read when the server starts. |
| Styles in `scss/` | With `npm run watch:css` running, refresh the browser. Otherwise run `npm run build:css` first. |
| `.env` | Restart the server. |

Every restart resets the language to Icelandic, because sessions are kept in memory until milestone 2 moves them into the database.

Templates update without a restart unless `NODE_ENV=production`; in production they are cached until the server restarts.

## 6. Run the tests

```
npm test
```

All tests should pass (`ℹ fail 0` at the end). The tests use their own temporary databases. They never touch `data/` or your `.env`, so you can run them while `npm run dev` is running.

Some tests check error handling on purpose, so error messages and stack traces in the output are normal as long as the summary says `fail 0`.

## 7. After pulling new code

```
git pull
```
Then, depending on what changed:
- **`package.json` or `package-lock.json`:** run `npm install`.
- **Anything in `scss/`:** run `npm run build:css` (or keep `watch:css` running).
- **`src/db/schema.sql`:** your local database is out of date. [Reset it](#8-reset-your-local-database).
- **`.env.example`:** compare it with your `.env` and add any new settings.

Then restart `npm run dev`.

## 8. Reset your local database

This deletes everything in your **local development** database and starts empty. Only do this on your own computer, never on the school's server, where the data is real.

1. Stop the server (`Ctrl+C`).
2. Delete the database files:

   | Terminal | Command |
   |---|---|
   | PowerShell | `Remove-Item data\saeludagar.db*` |
   | Command Prompt | `del data\saeludagar.db*` |
   | Git Bash / macOS / Linux | `rm -f data/saeludagar.db*` |

   SQLite keeps up to three files (`saeludagar.db`, `-wal` and `-shm`); the `*` removes all of them.
3. Run `npm run migrate`, then `npm run dev`.

## 9. Troubleshooting

Find the message you see in the left column.

| You see | What it means | Fix |
|---|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled on this system` | PowerShell blocks npm's launcher | See [section 2](#2-windows-let-powershell-run-npm). |
| `node: .env: not found` | `npm run dev` needs a `.env` file | Do [steps 2 and 3](#3-first-time-setup) of the setup. |
| `SESSION_SECRET is not set. Copy .env.example to .env and fill it in` | `SESSION_SECRET` in `.env` is empty | Paste a generated value ([step 3](#3-first-time-setup)). Check that `SESSION_SECRET=` doesn't appear twice. |
| `The database is not set up. Run: npm run migrate` | The database tables don't exist yet | Run `npm run migrate`. |
| `Port 3000 is already in use. Stop the other server, or set PORT in .env to a free port.` | Another server, often a second `npm run dev`, is using the port | Stop the other one with `Ctrl+C` in its terminal, or set `PORT=3001` in `.env`. |
| `Failed running 'src/server.js'. Waiting for file changes before restarting...` | The server stopped because of an error | Read the line just above it; it is one of the messages in this table. Fix the cause, then save a file or restart `npm run dev`. |
| `Unknown database schema version …` | Your database was made by a different version of the code | [Reset your local database](#8-reset-your-local-database). |
| The page has no colours or layout | The CSS hasn't been built | Run `npm run build:css`, then refresh with `Ctrl+F5`. |
| Changed text in `is.json` / `en.json` doesn't appear | Translation files are read when the server starts | Restart `npm run dev`. |
| The page switched back to Icelandic | The server restarted, which clears sessions (until milestone 2) | Click **EN** again. |
| `gyp ERR!` or `node-gyp` during `npm install` | npm is trying to compile better-sqlite3 | Pull the latest code; `package.json` turns this off with `allowScripts`. If your computer has no prebuilt binary (unusual), see [README → Setup](../README.md#setup). |
| `node: bad option: --env-file-if-exists=.env`, or `EBADENGINE` warnings | Your Node.js is too old | Install Node.js 24 LTS and run `npm install` again. |
| `Error: Cannot find module …` | Packages are missing or out of date | Run `npm install`. |

If you're still stuck, copy the whole error from the terminal into a message to the team. Never include your `.env`.

## 10. Where things are

| Path | What it is | In git? |
|---|---|---|
| `.env` | Your private settings and secrets | No, never commit |
| `data/saeludagar.db` | Your local database | No |
| `public/css/main.css` | Built from `scss/` by `build:css` / `watch:css` | No |
| `uploads/`, `backups/` | Event images and backups (used from later milestones) | No |
| `src/` | Server code, views and translations | Yes |
| `scss/` | Styles; brand colours are in `scss/_tokens.scss` | Yes |
| `test/` | Tests | Yes |
| `docs/` | Specification ([AGENT_START.md](AGENT_START.md)), original notes and this guide | Yes |

**Not covered yet:**
- Creating the first admin account (`npm run create-admin`) arrives in milestone 2.
- Email also arrives in milestone 2. Until the school's mail server is set, emails are printed in the `npm run dev` terminal instead of being sent.
- Deploying to the school's server comes in milestone 8.

This guide will be updated as those milestones land.
