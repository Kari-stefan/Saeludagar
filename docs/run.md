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
7. [Get the team's latest code](#7-get-the-teams-latest-code)
8. [Reset your local database](#8-reset-your-local-database)
9. [Troubleshooting](#9-troubleshooting)
10. [Where things are](#10-where-things-are)

## 1. What you need

- **Node.js 24 LTS, a recent version.** Install it from [nodejs.org](https://nodejs.org), then check:
  - `node -v` prints `v24.something`
  - `npm -v` prints **11.16 or newer**

  An older npm tries to compile one of the packages and fails (see [Troubleshooting](#9-troubleshooting)). Installing the current Node.js 24 LTS gives you a new enough npm.
- **Git.** Install it from [git-scm.com](https://git-scm.com); on Windows this also installs Git Bash. On a Mac, typing `git` in Terminal offers to install it.
- **A copy of the repository**, and your own branch:
  ```
  git clone https://github.com/Kari-stefan/Saeludagar.git
  cd Saeludagar
  git switch -c your-name
  ```
  If your branch already exists on GitHub, use `git switch your-name` instead. Work on your own branch, never on `main` (see [How we work](../README.md#how-we-work)).
- **A terminal in the project folder.** In VS Code, use File → Open Folder, pick the `Saeludagar` folder, then Terminal → New Terminal. Run every command in this guide there.

You don't need any build tools or a separate database server. SQLite runs inside the app.

## 2. Windows: let PowerShell run npm

On a new Windows machine, the first `npm` command in PowerShell often fails like this:

```
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system.
```

Windows blocks the small `npm.ps1` launcher that Node installs. There is nothing wrong with the project. Pick one fix:

- **Fix it once (recommended).** This allows scripts installed on your computer for your user account; scripts downloaded from the internet must still be signed. Run it in PowerShell:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```
  If it asks "Do you want to change the execution policy?", type `Y` and press Enter. Then open a new terminal.
- **Change nothing.** Type `npm.cmd` instead of `npm` each time, for example `npm.cmd run dev`.
- **Use another terminal.** Command Prompt and Git Bash are not affected. In VS Code, press `Ctrl+Shift+P`, run **Terminal: Select Default Profile**, and pick one.

## 3. First-time setup

Run these from the project folder.

**1. Install the packages:**
```
npm install
```
Nothing needs compiling: better-sqlite3 and the Sass file watcher come with prebuilt binaries for Windows, macOS and Linux, and `package.json` turns off their compile scripts. If you see `gyp ERR!`, see [Troubleshooting](#9-troubleshooting).

**2. Create your `.env` file** from the example. **Skip this step if you already have a `.env`**: copying again overwrites it without asking.

| Terminal | Command |
|---|---|
| PowerShell | `Copy-Item .env.example .env` |
| Command Prompt | `copy .env.example .env` |
| Git Bash / macOS / Linux | `cp .env.example .env` |

`.env` holds your private settings. Git ignores it; never commit it or share it.

**3. Generate the secrets.** This prints three lines with random values. It works in all three terminals:
```
node -e "for (const k of ['SESSION_SECRET','KENNITALA_ENC_KEY','KENNITALA_HMAC_KEY']) console.log(k + '=' + require('node:crypto').randomBytes(32).toString('base64'))"
```
Open `.env` and **replace** the three empty lines (`SESSION_SECRET=`, `KENNITALA_ENC_KEY=`, `KENNITALA_HMAC_KEY=`) with the printed lines. Don't add them as extra lines: if a name appears twice, the last line wins, so an empty line further down would undo your value.

- Only `SESSION_SECRET` is used so far; the two kennitala keys are needed from milestone 2.
- Every developer generates their own values, once, and keeps them.
- From milestone 2, changing the kennitala keys makes the kennitölur already in your local database unreadable. If you ever change them, [reset the database](#8-reset-your-local-database).

You can leave the other settings as they are; [README → Environment variables](../README.md#environment-variables) explains each one.

**4. Create the database:**
```
npm run migrate
```
You should see `Database ready at …saeludagar.db (schema version 1).` Running it again is safe.

**5. Build the CSS:**
```
npm run build:css
```
This creates `public/css/main.css`. Without it the pages load but have no styling.

## 4. Start the site

```
npm run dev
```

When you see `Sæludagar is running at http://localhost:3000`, open **http://localhost:3000** in your browser.

To stop the server, press `Ctrl+C` in its terminal. If you started it with `npm.cmd` or from Command Prompt, Windows then asks `Terminate batch job (Y/N)?`. The server has already stopped; type `Y` and press Enter.

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

The full list of pages is in section 6 of [AGENT_START.md](AGENT_START.md). Student, teacher and admin pages have no login check yet; that arrives in milestone 2.

To use a different port, set `PORT` in `.env` (and `BASE_URL` to match). The server restarts on the new port by itself; open that port instead.

## 5. Working on the code

Keep `npm run dev` running in one terminal. If you are changing styles, run this in a **second** terminal (in VS Code, use the split-terminal button):
```
npm run watch:css
```

What you need to do after a change depends on the file:

| You changed | What to do |
|---|---|
| JavaScript in `src/` | Nothing. The server restarts by itself (you'll see `Restarting 'src/server.js'`). |
| `.env` | Nothing. The server restarts by itself with the new values (you'll see `Change detected in '….env'`). |
| A view in `src/views/` (`.ejs`) | Refresh the browser. |
| Text in `src/i18n/is.json` or `en.json` | Restart the server (`Ctrl+C`, then `npm run dev`). These files are only read when the server starts. |
| Styles in `scss/` | With `npm run watch:css` running, refresh the browser. Otherwise run `npm run build:css` first. |

Every restart resets the language to Icelandic, because sessions are kept in memory until milestone 2 moves them into the database.

Keep `NODE_ENV=development` in your `.env`. In production mode, views are cached until the server restarts, and the session cookie only works over HTTPS, so the ÍS/EN switch stops working on `http://localhost`.

## 6. Run the tests

```
npm test
```

All tests should pass: the summary at the end shows `ℹ fail 0`. The tests use their own temporary databases. They never touch `data/` or your `.env`, so you can run them while `npm run dev` is running.

Some tests check error handling on purpose, so error messages and stack traces in the output are normal as long as the summary says `fail 0`.

## 7. Get the team's latest code

Everyone's finished work is merged into `main` through pull requests. To bring it into your branch:

1. Stop `npm run dev` and `npm run watch:css` (`Ctrl+C`). On Windows, npm can't replace packages while the server is using them.
2. Pull `main` into your branch:
   ```
   git pull --no-rebase origin main
   ```
   A plain `git pull` on your own branch only fetches your own branch from GitHub, not `main`.
3. Then, depending on what changed:
   - **`package.json` or `package-lock.json`:** run `npm install`.
   - **Anything in `scss/`:** run `npm run build:css`.
   - **`src/db/schema.sql`:** your local database is out of date. [Reset it](#8-reset-your-local-database).
   - **`.env.example`:** compare it with your `.env` and add any new settings by hand. Don't copy it over your `.env`.
4. Start `npm run dev` again.

## 8. Reset your local database

This deletes everything in your **local development** database and starts empty. Only do this on your own computer, never on the school's server, where the data is real.

1. Stop the server (`Ctrl+C`).
2. Delete the database files:

   | Terminal | Command |
   |---|---|
   | PowerShell | `Remove-Item data\saeludagar.db*` |
   | Command Prompt | `del data\saeludagar.db*` |
   | Git Bash / macOS / Linux | `rm -f data/saeludagar.db*` |

   SQLite keeps up to three files: `saeludagar.db`, `saeludagar.db-wal` and `saeludagar.db-shm`. The `*` removes all of them. If the files can't be deleted ("being used by another process" or "Device or resource busy"), the server is still running somewhere; stop it and try again.
3. Run `npm run migrate`, then `npm run dev`.

   From milestone 2, a fresh database has no admin account, so also run `npm run create-admin` again.

## 9. Troubleshooting

Find the message you see in the left column.

| You see | What it means | Fix |
|---|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled on this system` | PowerShell blocks npm's launcher | See [section 2](#2-windows-let-powershell-run-npm). |
| `Could not read package.json` or `ENOENT … package.json` | The terminal isn't in the project folder | `cd Saeludagar`, or open that folder in VS Code ([section 1](#1-what-you-need)). |
| `node: .env: not found` | `npm run dev` needs a `.env` file | Do [steps 2 and 3](#3-first-time-setup) of the setup. |
| `SESSION_SECRET is not set. Copy .env.example to .env and fill it in` | `SESSION_SECRET` in `.env` is empty | Paste a generated value ([step 3](#3-first-time-setup)) and save `.env`; the server restarts by itself. Check that `SESSION_SECRET=` doesn't appear twice. |
| `The database is not set up. Run: npm run migrate` | The database hasn't been created yet, or was made by a different version of the code | Run `npm run migrate`, then restart `npm run dev` (it doesn't restart by itself after a migrate). If migrate says `Unknown database schema version`, see that row. |
| `Unknown database schema version …` | Your database was made by a different version of the code | [Reset your local database](#8-reset-your-local-database). |
| `Port 3000 is already in use. Stop the other server, or set PORT in .env to a free port.` | Something else is using the port | If it's your own `npm run dev` in another terminal, the site is already running there: press `Ctrl+C` in this terminal and use the other one. If another program uses the port, set `PORT=3001` (and `BASE_URL`) in `.env`. |
| `Failed running 'src/server.js'. Waiting for file changes before restarting...` | The server stopped because of an error | Read the error above it. If it's a message from this table, follow that row. Otherwise it's usually a mistake in code you just changed: the first lines of the error name the file and line. Fix it and save; the server restarts by itself. |
| `Terminate batch job (Y/N)?` | You stopped a server started with `npm.cmd` or from Command Prompt | Type `Y` and press Enter. The server has already stopped. |
| The page has no colours or layout | The CSS hasn't been built | Run `npm run build:css`, then refresh with `Ctrl+F5` (`Cmd+Shift+R` on a Mac). |
| Changed text in `is.json` / `en.json` doesn't appear | Translation files are read when the server starts | Restart `npm run dev`. |
| The page switched back to Icelandic | The server restarted (after a code or `.env` change), which clears sessions until milestone 2 | Click **EN** again. |
| `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '…'` | Packages are missing or out of date | Stop `npm run dev`, then run `npm install`. |
| `'sass' is not recognized as an internal or external command` (macOS/Linux: `sass: command not found` or `sass: not found`) | The packages aren't installed | Run `npm install`. |
| `Error: Cannot find module '…scripts\create-admin.js'` (or `backup.js`, `loadtest.js`, `seed-dev.js`) | That script isn't written yet | See [Not covered yet](#not-covered-yet). |
| `gyp ERR!` or `node-gyp` during `npm install` | Your npm is older than 11.16, so it ignores the `allowScripts` setting in `package.json` and tries to compile better-sqlite3 | Install the current Node.js 24 LTS (check `npm -v`), then run `npm install` again. Quick workaround: `npm install --ignore-scripts`. |
| `npm error code EPERM`, `being used by another process` or `Device or resource busy` | A running server (maybe in another terminal) is using the files you're installing or deleting | Stop it with `Ctrl+C`, then run the command again. If `npm install` stopped halfway, just run it again. |
| `node: bad option: --env-file-if-exists=.env`, or `EBADENGINE` warnings | Your Node.js is too old | Install the current Node.js 24 LTS, then run `npm install` again. |

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

### Not covered yet

- **Scripts not written yet:**

  | Script | Arrives in |
  |---|---|
  | `npm run create-admin` | milestone 2 |
  | `npm run backup` | milestone 8 |
  | `npm run loadtest` | milestone 8 |
  | `npm run seed:dev` | when needed |

  Running one of them now gives `Error: Cannot find module`.
- **Email** arrives in milestone 2. As long as `SMTP_HOST` in your `.env` is empty (keep it empty on your own computer), emails are printed in the `npm run dev` terminal instead of being sent.
- **Deployment notes** for the school's server (a Linux guide in the README) arrive in milestone 8. The deployment itself happens separately, once it is approved.

This guide will be updated as those milestones land.
