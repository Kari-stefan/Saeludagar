# Running Sæludagar on your computer

This guide gets the site running locally for development, and covers what to do when something goes wrong. Commands are shown for **PowerShell** (the default terminal in VS Code on Windows), **Command Prompt**, and **Git Bash / macOS / Linux** wherever they differ.

What is built so far is listed in the [README](../README.md) under Status. Emails, such as login codes, are printed in the terminal instead of being sent.

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
11. [npm scripts](#11-npm-scripts)
12. [Environment variables](#12-environment-variables)
13. [Cloud sessions](#13-cloud-sessions)

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

You don't need any build tools, a separate database server or a mail server. SQLite runs inside the app, and emails are printed in the terminal.

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

- All three are required. The site doesn't start without them.
- Every developer generates their own values, once, and keeps them.
- Changing the kennitala keys later makes the kennitölur already in your local database unreadable, so nobody can log in. If you ever change them, [reset the database](#8-reset-your-local-database).

Also replace the empty `SCHOOL_NAME=` line with the school's name, so the header and page titles show it:
```
SCHOOL_NAME=Fjölbrautaskólinn í Breiðholti
```
Save `.env` as UTF-8 (the default in VS Code), or "ö" and "ð" show up garbled.

You can leave the other settings as they are; [section 12](#12-environment-variables) explains each one. Keep `SMTP_HOST` empty on your own computer, so emails are printed instead of sent.

**4. Create the database:**
```
npm run migrate
```
You should see `Database ready at …saeludagar.db (schema version 3).` Running it again is safe.

**5. Build the CSS:**
```
npm run build:css
```
This creates `public/css/main.css`. Without it the pages load but have no styling.

**6. Create your admin account.** Fill in your own name and email, and use a **fake** kennitala such as `0000000001`, never a real one:
```
npm run create-admin -- --name "Your Name" --email "you@example.is" --kennitala "0000000001"
```
The same command works in PowerShell, Command Prompt and Git Bash. Keep the `--` after `create-admin`, and the quotes around each value.

You should see:
```
Admin account created for Your Name (you@example.is).
Login code: 123456
This is the only time the code is shown. Log in at http://localhost:3000/login
```
Your code is a different 6-digit number. Write it down: this is the only time it is shown. If you lose it, use **Fá nýjan kóða** on the login page; the new code is printed in the `npm run dev` terminal (see [section 4](#4-start-the-site)). No email is sent, so the email address can be made up.

## 4. Start the site

```
npm run dev
```

When you see `Sæludagar is running at http://localhost:3000`, open **http://localhost:3000** in your browser.

To stop the server, press `Ctrl+C` in its terminal. It waits up to about 5 seconds for an email it is sending; press `Ctrl+C` again to stop at once. If you started it with `npm.cmd` or from Command Prompt, Windows then asks `Terminate batch job (Y/N)?`. The server has already stopped; type `Y` and press Enter.

**What you should see:**
- **The header:**
  - The red school logo on the left.
  - "Sæludagar" in the middle, with the school's name under it if `SCHOOL_NAME` is set in `.env`.
  - The links **Heimasíða** and **Upplýsingar**.
  - On the right: **Innskráning**, the **ÍS / EN** buttons and a sun/moon pair for light and dark mode. **EN** switches the whole site to English and **ÍS** switches back.
  - The site starts in light mode. The moon switches to dark mode, and the sun back, for the rest of the session, as the language buttons do.
  - In a narrow window (or on a phone) the links and buttons move into a menu behind the ☰ button.
- **The front page:** the events as cards, grouped by day. Above them are a search box, **Leita**, **Sía** (filters: price, braut, date, start time, before or after noon) and **Raða** (the order). What you choose shows under them, each with its own ✕ to clear it.
- **Logged in as a student,** you see **Þínir viðburðir** with a counter such as "2/4" (your sign-ups) above **Aðrir viðburðir** (the rest). While sign-up is open, the cards have **Skrá** and **Afskrá** buttons, and the event moves between the two lists without the page reloading.
- **Logged in as a teacher or admin,** you see **Viðburðir sem þú sérð um** and a floating **Nýr viðburður** button at the bottom right, which opens the event form over the page.
- **Upplýsingar:** how the site works, with the current dates.
- **Log in as a student.** In a second terminal (the server can keep running), create three fake students:
  ```
  npm run seed:dev
  ```
  It prints their kennitölur and new codes (your codes are different):
  ```
  Fake students for development. Log in at http://localhost:3000/login
    kennitala 0000000101  code 123456  Jóna Jónsdóttir (Rafmagnsbraut)
    kennitala 0000000102  code 654321  Páll Pálsson (Starfsbraut)
    kennitala 0000000103  code 112233  Sara Sigurðardóttir (Rafmagnsbraut)
  Run npm run seed:dev again to give them new codes.
  ```
  Log in with one of them. A student lands on the front page. Until an admin has added Sæludagar days (see Dates below) it only says the dates are not set; after that **Þínir viðburðir** shows, empty until they sign up. The header shows the student's name and **Útskráning**. A student's session ends after 2 hours without activity. `seed:dev` only makes fake data and refuses to run when `NODE_ENV=production`.
- **Log in as admin.** Click **Innskráning** and enter your fake kennitala (`0000000001` or `000000-0001`) and the code from [step 6](#3-first-time-setup). You land on the front page, with your events under **Viðburðir sem þú sérð um**. The header now shows your name, **Stjórnendasvæði** (the admin area) and **Útskráning** (log out).
- **Create a teacher.** Go to Stjórnendasvæði → **Viðburðastjórar**. Enter a name, an email and another fake kennitala, such as `0000000002`. Within a few seconds the teacher's code email appears in the `npm run dev` terminal:
  ```
  --- Email (not sent, because SMTP_HOST is empty) ---
  To: Jón Kennari <jon@example.is>
  Subject: Kóði fyrir Sæludagavefinn / Your code for the Sæludagar website

  Halló Jón Kennari,
  …
      123456
  …
  --- End of email ---
  ```
  Every email is written in Icelandic first, then English. Log out and log in as the teacher with that code. Teachers don't see Stjórnendasvæði.
- **On the Viðburðastjórar page** you can also send a teacher a new code, deactivate or reactivate them, and make them an admin or remove that. The same page makes an active student an event manager, or takes that role away. You can't deactivate yourself or remove your own admin rights; another admin can.
- **Fá nýjan kóða** on the login page prints a new code in the terminal; the old code stops working once the new one is printed. Each kennitala gets at most one new code every 10 minutes, counting codes an admin sends. The page shows the same message every time, even when no code is sent, on purpose. To test without the limit, add `NEW_CODE_LIMIT=off` to your `.env`; the terminal then says `NEW_CODE_LIMIT=off: "Fá nýjan kóða" has no 10-minute limit (development only).` It only works with `NODE_ENV=development`.
- **5 wrong codes** for the same kennitala lock it for 15 minutes. While it is locked, even the right code gives "Kennitala eða kóði er rangur".
- **Dates.** Stjórnendasvæði → **Dagsetningar og frestir**: add and remove Sæludagar days, and set when sign-up opens and closes and the course-choice deadline (each a date and a time, in Icelandic time). Stjórnendasvæði shows the current values.
- **Import students.** Save this as `nemendur.csv` (fake data; UTF-8, or Windows-1252 as Excel saves it):
  ```
  kennitala;nafn;netfang;braut;afangi
  0000000201;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;STÆR2BH05
  0000000201;Jóna Jónsdóttir;jona@example.is;Rafmagnsbraut;ÍSLE2MB05
  000000-0202;Páll Pálsson;pall@example.is;Starfsbraut;
  ```
  A longer example with 8 fake students is in [`docs/example-students.csv`](example-students.csv). Stjórnendasvæði → **Innflutningur nemenda** → choose the file → **Hlaða upp og yfirfara**. If any line is wrong, the page lists every error with its line number and saves nothing. Otherwise it shows what will change (new, updated, made inactive, sign-ups removed); nothing is saved until you click **Staðfesta innflutning**, within 10 minutes. Active students who are missing from the file become inactive, and that includes the `seed:dev` students (running `npm run seed:dev` again makes them active again).
- **Send codes.** Stjórnendasvæði → **Senda kóða** → confirm. Every active student gets a new code, printed in the terminal, at most `SMTP_MAX_PER_MINUTE` (30) a minute and after any other email. The page shows how many are queued, sent and failed; reload it to update the numbers. Each student's old code stops working once their new code is printed.
- **Create an event.** First add at least one Sæludagar day on Dagsetningar og frestir; events can only be on those days. Then, as a teacher or admin, click **Nýr viðburður** at the bottom right of the front page. Fill in the form on the left (the English fields are optional) and, under **Myndir fyrir viðburð** on the right, optionally attach up to 5 JPG, PNG or WebP images of at most 2 MB each. Each one shows before you save and has its own **Fjarlægja myndina** button; the first is the one on the event's card. **Vista drög** saves the event as a draft, which only you, its co-teachers and admins can see. It then appears under **Viðburðir sem þú sérð um**.
- **Preview and publish.** In that list or on the event's page, **Forskoða** shows its page and its card exactly as students will see them, and **Birta** publishes it. It then appears on the front page, grouped by day; brautir from the student list can be used to filter it. Events with no braut are for everyone and show under every braut.
- **Edit and delete.** **Breyta** edits the event, also after it is published. Under **Myndir (valfrjálst)** you add more images, up to 5 in all, and tick **Fjarlægja myndina** on a saved one to drop it. If the day, times or location of a published event change, every student signed up gets an email (printed in the terminal). On the edit page, the owner or an admin adds **meðviðburðastjórar** (co-teachers), who can do everything except delete the event and change the co-teachers. Deleting asks you to tick a box first, and isn't possible once attendance has been marked.
- **All events.** Stjórnendasvæði → **Allir viðburðir** lists every event with its owner; an admin can manage any of them.
- **Sign up as a student.** First set **Skráning opnar** and **Skráningu lýkur** on Dagsetningar og frestir so that now is in between; outside that window nobody can sign up or cancel. A student clicks **Skrá** on an event's card, or **Skrá mig** on its page. If it works, the event appears under **Þínir viðburðir** and the counter goes up ("1/4"); if not, the page says why: full ("Uppselt"), only for other brautir, already 4 sign-ups, already 2 sign-ups that day, or overlapping another event (named). **Afskrá** on the card, or **Afskrá mig** on the page, frees the place at once.
- **As a guest,** **Skrá** on a card and **Skrá mig** on a page both go to the login page, and after logging in you come back to the event.
- **The event's page.** **Nánar** on a card opens it. On a wide screen the images and the description are on the left; an event with several images has arrows to step through them (without JavaScript they scroll sideways). On the right are the sign-up box, **Viðburðastjóri** (the owner's name, and their email once you are logged in) and **Hópur**. Only the event's owner, its co-teachers and admins see the participants' names and emails in **Hópur**; everyone else sees how many are signed up. On a phone everything is in one column.
- **Participants.** On a published event's page (click its name under **Viðburðir sem þú sérð um**), under **Þátttakendur**:
  - **Add a student:** search by name and click **Bæta við**. You may go over the maximum, past the braut rule and outside the sign-up window, but not past a student's 4 sign-ups, or 2 on one day, or into an overlap.
  - **Remove a student:** **Fjarlægja**. A student whose attendance is marked can't be removed until it is unticked.
  - **Copy the emails:** **Netföng** jumps to every participant's email, with an **Afrita netföng** button, ready to paste into BCC.
- **Send a message.** **Senda póst** sends an email to everyone signed up. Each one is printed in the terminal with `Reply-To:` set to your address.
- **Take attendance.** **Mætingarlisti** opens a phone-friendly checklist, where each tick saves at once. It only opens from 00:00 on the event's date, so to try it, add today as a Sæludagar day and give an event today's date. Without a course-choice deadline it stays open; after the deadline it is read-only. Nobody ticks their own name: a student who manages an event they are signed up for sees their own row greyed out, and another manager of the event or an admin ticks it.
- **Give away absence points.** Log in as a student whose attendance has been ticked and click **Fjarvistastig** in the header. The counter at the top shows the points left and the points earned, such as "4/12": 4 for each ticked attendance. Each of the student's courses has **−** and **+**: **+** puts 4 points on the course and **−** takes them back. A course takes at most 4, and the buttons that can't be used are greyed out. After **Frestur til að velja áfanga** on Dagsetningar og frestir, the page is read-only. Of the `seed:dev` students, Jóna and Sara have courses and Páll has none, so he sees a message instead of a list. A student you import needs at least one course in the CSV to have a row here.
- **Download the office export.** Stjórnendasvæði → **Útflutningur fyrir skrifstofu**. The page shows how many rows the file has, how many of them have no course yet, and whether it is still a **Bráðabirgðaútgáfa** (before **Frestur til að velja áfanga**, or when none is set) or the **Lokaútgáfa**. **Sækja skrána (CSV)** downloads `saeludagar-fjarvistir-YYYY-MM-DD.csv`, with one row for each ticked attendance. It opens in Excel with Icelandic letters and the kennitölur intact. On your own computer the kennitölur in it are the fake ones you created.
- **Read the audit log.** Stjórnendasvæði → **Aðgerðaskrá** lists who changed sign-ups, attendance, course choices and event-manager rights, and when, newest first. Filter it by event or by part of a student's name.
- **Purge the student data.** Stjórnendasvæði → **Hreinsun gagna**. The page lists what is deleted (the students, their courses and login codes; sign-ups, attendance and course choices; student sessions; emails waiting for students; the audit log) and what is kept (teacher accounts, events and the Sæludagar days). It also says that an event owned by a student who is an event manager moves to you, and that every event becomes a draft. It links to the office export, because the office needs that file first. Before **Frestur til að velja áfanga** (or when none is set) a warning says the export is not final and points may be lost. The page also shows the date of the automatic purge and, once there has been one, the date of the last purge. To purge, type **EYÐA** (in English, **DELETE**) in the box and click **Eyða öllum nemendagögnum**. A message says how many students were deleted. A wrong word gives the page again and deletes nothing. The site also purges by itself 30 days after **Frestur til að velja áfanga**; while it runs, it checks once an hour. On your own computer this deletes your fake students: `npm run seed:dev` or a new import brings some back. How it works is in [architecture.md](architecture.md) (How data flows, g).
- **Print the list.** **Prenta lista** shows the participants with an empty box each. Your browser's print command (`Ctrl+P`) prints only the list.

Who can open which page:

| Page | Address | Who |
|---|---|---|
| Front page | http://localhost:3000/ | Everyone |
| An event | http://localhost:3000/events/1 | Everyone, once it is published |
| Log in | http://localhost:3000/login | Everyone |
| New event, as a page | http://localhost:3000/teacher/events/new | Teachers and admins; the front page's button opens it only without JavaScript |
| Managing an event | http://localhost:3000/teacher/events/1 | Its owner, co-teachers and admins |
| All events | http://localhost:3000/admin/events | Admins |
| Admin area | http://localhost:3000/admin | Admins |
| Teacher accounts | http://localhost:3000/admin/teachers | Admins |
| Dates and deadlines | http://localhost:3000/admin/settings | Admins |
| Office export | http://localhost:3000/admin/export | Admins |
| Audit log | http://localhost:3000/admin/audit | Admins |
| Student import | http://localhost:3000/admin/import | Admins |
| Send codes | http://localhost:3000/admin/codes | Admins |
| Purge the student data | http://localhost:3000/admin/purge | Admins |

If you aren't logged in, these pages send you to the login page; if you are logged in without the right role, you get "Aðgangur ekki leyfður" (access denied). The full list of pages is in section 6 of [AGENT_START.md](AGENT_START.md).

To use a different port, set `PORT` in `.env` (and `BASE_URL` to match, because it is the link in the emails). The server restarts on the new port by itself; open that port instead.

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
| A view in `src/views/` (`.ejs`), including the email templates in `src/views/emails/` | Refresh the browser. The next email uses the changed template. |
| Text in `src/i18n/is.json` or `en.json` | Restart the server (`Ctrl+C`, then `npm run dev`). These files are only read when the server starts. |
| Styles in `scss/` | With `npm run watch:css` running, refresh the browser. Otherwise run `npm run build:css` first. |

A restart doesn't log you out or reset the language: sessions are kept in the database.

Keep `NODE_ENV=development` in your `.env`. In production mode, views are cached until the server restarts, emails are no longer printed in the terminal, and the session cookie only works over HTTPS, so logging in and the ÍS/EN switch stop working on `http://localhost`.

## 6. Run the tests

```
npm test
```

All tests should pass: the summary at the end shows `ℹ fail 0`. The tests use their own temporary databases and fake kennitölur. They never touch `data/` or your `.env`, so you can run them while `npm run dev` is running. A full run takes about 20 seconds.

Some tests check error handling on purpose, so error messages in the output are normal as long as the summary says `fail 0`.

To run one test file or one test by name, use the commands in [CLAUDE.md](../CLAUDE.md) under Commands.

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
   - **`src/db/schema.sql` or `src/db/migrate.js`:** your local database is out of date. Run `npm run migrate`, which upgrades it and keeps your data. Until you do, the server stops with `The database is not set up. Run: npm run migrate`.
   - **`.env.example`:** compare it with your `.env` and add any new settings by hand. Don't copy it over your `.env`.
4. Start `npm run dev` again.

## 8. Reset your local database

This deletes everything in your **local development** database and starts empty. Only do this on your own computer, never on the school's server, where the data is real. Claude Code does not do this unless you ask it to: deleting files is on the "Ask first" list in [CLAUDE.md](../CLAUDE.md).

1. Stop the server (`Ctrl+C`).
2. Delete the database files:

   | Terminal | Command |
   |---|---|
   | PowerShell | `Remove-Item data\saeludagar.db*` |
   | Command Prompt | `del data\saeludagar.db*` |
   | Git Bash / macOS / Linux | `rm -f data/saeludagar.db*` |

   SQLite keeps up to three files: `saeludagar.db`, `saeludagar.db-wal` and `saeludagar.db-shm`. The `*` removes all of them. If the files can't be deleted ("being used by another process" or "Device or resource busy"), the server is still running somewhere; stop it and try again.

   Event images stay in `uploads/` but are no longer used. To remove them too, keeping the `.gitkeep` file:

   | Terminal | Command |
   |---|---|
   | PowerShell | `Remove-Item uploads\* -Exclude .gitkeep` |
   | Git Bash / macOS / Linux | `find uploads -type f ! -name .gitkeep -delete` |
3. Run `npm run migrate`.
4. A fresh database has no accounts, so [create your admin account](#3-first-time-setup) again (step 6), and run `npm run seed:dev` if you want the fake students. Then run `npm run dev`.

## 9. Troubleshooting

Find the message you see in the left column.

| You see | What it means | Fix |
|---|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled on this system` | PowerShell blocks npm's launcher | See [section 2](#2-windows-let-powershell-run-npm). |
| `Could not read package.json` or `ENOENT … package.json` | The terminal isn't in the project folder | `cd Saeludagar`, or open that folder in VS Code ([section 1](#1-what-you-need)). |
| `node: .env: not found` | `npm run dev` needs a `.env` file | Do [steps 2 and 3](#3-first-time-setup) of the setup. |
| `SESSION_SECRET is not set. Copy .env.example to .env and fill it in` | `SESSION_SECRET` in `.env` is empty | Paste a generated value ([step 3](#3-first-time-setup)) and save `.env`; the server restarts by itself. Check that `SESSION_SECRET=` doesn't appear twice. |
| `KENNITALA_ENC_KEY is not set. Copy .env.example to .env and fill it in` (or `KENNITALA_HMAC_KEY`) | That key in `.env` is empty. Both kennitala keys are required from milestone 2 | Paste generated values ([step 3](#3-first-time-setup)) and save `.env`. Check that the name doesn't appear twice. |
| `KENNITALA_ENC_KEY must be 32 random bytes, base64-encoded` (or `KENNITALA_HMAC_KEY`) | The value isn't a whole generated key. Often the `=` at the end is missing, or it has extra quotes or spaces | Generate new values ([step 3](#3-first-time-setup)) and paste the whole line. |
| `KENNITALA_ENC_KEY and KENNITALA_HMAC_KEY must be different` | The same value was pasted for both keys | Run the [step 3](#3-first-time-setup) command again; it prints a different value on each line. |
| `MAIL_FROM is not set. Set it to the school's noreply address` | `SMTP_HOST` is set in `.env`, so the site tries to send real email | On your own computer, leave `SMTP_HOST=` empty, so emails are printed in the terminal. |
| `SMTP_PORT is 465, so SMTP_SECURE must be true` (or `SMTP_PORT is 587, so SMTP_SECURE must be false`) | The port and `SMTP_SECURE` don't match, so every email would fail. Port 465 uses TLS from the start; 587 switches to TLS after connecting | Set `SMTP_SECURE=true` for 465 or `SMTP_SECURE=false` for 587. Check that `SMTP_SECURE=` appears only once in `.env`. |
| `The database is not set up. Run: npm run migrate` | The database hasn't been created yet, or was made by a different version of the code. `npm run create-admin` shows it too | Run `npm run migrate`, then restart `npm run dev` (it doesn't restart by itself after a migrate). If migrate says `Unknown database schema version`, see that row. |
| "Ekki tókst að ljúka aðgerðinni. Athugaðu nettenginguna og reyndu aftur." after pressing **Skrá** or **Afskrá** on a card, or "Ekki tókst að vista viðburðinn. Athugaðu nettenginguna og reyndu aftur." in the **Nýr viðburður** dialog | The page could not reach the server, or the server answered with an error. On your own computer that usually means `npm run dev` is stopped or restarting | Look at the `npm run dev` terminal, which shows the reason, then press the button again. Nothing you typed is lost. |
| "Innskráningin þín rann út, svo ekki tókst að vista viðburðinn" in the **Nýr viðburður** dialog | Your session ended (after 2 hours without activity for a student, 12 for a teacher), your right to manage events was taken away, or you logged in again in another tab | Copy what you typed, reload the page and log in again. |
| `Unknown database schema version …` | Your database was made by a different version of the code | [Reset your local database](#8-reset-your-local-database). |
| `Usage: npm run create-admin -- --name "Full name" --email "name@example.is" --kennitala "0000000000"` | An option is missing, or the `--` after `create-admin` is missing | Copy the command from [step 6](#3-first-time-setup) and fill in all three values. |
| `Unexpected argument '…'` from `create-admin` | A value with a space has no quotes around it | Put quotes around each value, for example `--name "Jón Jónsson"`. |
| `Kennitala must be 10 digits`, `Enter a valid email address` or `Enter a name` from `create-admin` | That value has the wrong format | The kennitala is 10 digits, with or without a hyphen after the 6th: `0000000001` or `000000-0001`. |
| `seed:dev only creates fake development data. It does not run when NODE_ENV=production.` | `NODE_ENV` in `.env` is `production` | Set `NODE_ENV=development` (see [section 5](#5-working-on-the-code)). |
| `Skipped 0000000103: it belongs to a teacher account.` from `seed:dev` | You created a teacher with one of the fake students' kennitölur | Log in with the other fake students, or [reset the database](#8-reset-your-local-database). |
| `This kennitala already has an account` from `create-admin` | You already created an account with that kennitala | Log in with it. If you've lost the code, use **Fá nýjan kóða** on the login page and read the new code in the `npm run dev` terminal. |
| "Kennitala eða kóði er rangur" with a code you know is right | 5 wrong codes have locked that kennitala for 15 minutes; or a newer code was sent, and only the newest works; or the account was deactivated; or the kennitala keys in `.env` have changed | Wait 15 minutes; or use the newest code in the terminal; or have another admin reactivate the account. If you changed the keys, [reset the database](#8-reset-your-local-database). |
| **Fá nýjan kóða** prints no email in the terminal | Each kennitala gets one new code every 10 minutes, counting codes an admin sends. Kennitölur without an active account get nothing. The page shows the same message either way, on purpose | Wait 10 minutes and try again, and check the kennitala. Emails appear within about 5 seconds. While testing on your own computer, `NEW_CODE_LIMIT=off` in `.env` removes the limit. |
| `Email 3 (new_code) could not be sent: Connection timeout` (or `Greeting never received`, `connect ETIMEDOUT`), especially on a server or VPS | The mail server can't be reached. Many hosting providers block outgoing mail ports (25, 465, 587) on new servers | Test from that machine: `timeout 5 bash -c '</dev/tcp/smtp.gmail.com/465' && echo open \|\| echo blocked` (and the same with 587). If both are blocked, ask the provider to unblock outgoing mail, or leave `SMTP_HOST=` empty so emails are printed in the terminal. |
| `Email 3 (teacher_code) could not be sent: …` in the terminal, or "Tókst ekki að senda: 1" / "Failed: 1" on Stjórnendasvæði | The site tried to send an email through `SMTP_HOST` and the mail server refused or didn't answer; the text after `could not be sent:` is the reason. A dropped or timed-out connection is tried once more a few seconds later before this message appears. A failed email is retried 5 times, 1, 2, 4, 8 and 16 minutes apart; after that it counts as failed | On your own computer, leave `SMTP_HOST=` empty, so emails are printed instead. On the server, check the `SMTP_` settings. A failed code email can be replaced with a new one: **Senda nýjan kóða** on the Viðburðastjórar page, or **Fá nýjan kóða**. |
| "Lína 3: kennitala verður að vera 10 tölustafir" (or another "Lína …" error) on Innflutningur nemenda | That line of the CSV file is wrong. Nothing was imported | Fix every listed line and upload the file again. The header must be `kennitala;nafn;netfang;braut;afangi`. In Excel, save as **CSV (semicolon delimited)** or **CSV UTF-8**. |
| "Lína …: kennitala verður að vera 10 tölustafir" for kennitölur that look right in Excel, or Excel shows `201` instead of `0000000201` | Excel and Google Sheets treat a kennitala without a hyphen as a number and drop its leading zeros. Saving from there writes the shortened value. Real kennitölur of people born on the 1st–9th of a month start with 0 | Don't save the CSV from a spreadsheet after only opening it. Write kennitölur with the hyphen (`000000-0201`), which spreadsheets keep as text, or import the CSV into Excel with the kennitala column set to **Text**. |
| "Skráning er ekki opin núna." when a student clicks **Skrá mig** or **Afskrá mig** | The time now is outside the sign-up window, or the window isn't set | As admin, set **Skráning opnar** and **Skráningu lýkur** on Dagsetningar og frestir. The times are Icelandic time (UTC). |
| "Ekki er hægt að afskrá sig eftir að mæting hefur verið skráð." | The student's attendance is already marked, so the sign-up is kept for the course choice and the office export | Nothing to fix. |
| No **Nýr viðburður** button or no **Þínir viðburðir** on the front page, or "Stjórnandi hefur ekki skráð Sæludaga enn, svo ekki er hægt að stofna viðburð" on `/teacher/events/new` | No Sæludagar days exist yet, and every event must be on one | As admin, add the days on Dagsetningar og frestir. |
| "Ekki er hægt að fjarlægja … því viðburðir eru á deginum" on Dagsetningar og frestir | Events are on that day, and every event must stay on a Sæludagar day | Move the listed events to another day (Breyta) or delete them, then remove the day. |
| "Myndin verður að vera JPG, PNG eða WebP." | The file isn't one of those image types (an iPhone photo is often HEIC), whatever its name says | Save or export the picture as JPG or PNG and choose it again. |
| "Myndin er of stór. Hámarkið er 2 MB." | The image is over 2 MB | Make it smaller (for example 1600 pixels wide) and choose it again. |
| "Hámarkið má ekki vera lægra en fjöldi skráðra" | The new maximum is below the number of students already signed up | Keep the maximum at or above the number signed up. |
| "Lína 1: fyrirsögnin verður að vera kennitala;nafn;netfang;braut;afangi" | The first line isn't the agreed header, or the file isn't CSV (for example an `.xlsx` file) | Make the first line exactly the header above and save the file as CSV. |
| "Innflutningurinn rann út eða var þegar staðfestur" | More than 10 minutes passed between the upload and **Staðfesta innflutning**, the import was already confirmed or cancelled, or it was uploaded in another browser | Upload the file again and confirm within 10 minutes. |
| "Skráin er of stór. Hámarkið er 5 MB." | The file is bigger than the 5 MB limit | Check that it is the student CSV; a full school list is far smaller. |
| Codes from **Senda kóða** appear slowly in the terminal | Emails go out at most `SMTP_MAX_PER_MINUTE` (30) a minute, on purpose, so the school's mail server doesn't block them | Wait; the Senda kóða page shows the progress. |
| "Eyðublaðið er útrunnið" / "This form has expired" | The page was open so long that your session ended (after 2 hours without activity, or 12 hours for teachers and admins) | Go back, reload the page and try again. If it happens every time, check that your browser allows cookies for `localhost`. |
| "Aðgangur ekki leyfður" / "Access denied" | You're logged in, but your account can't open that page, for example a teacher opening `/admin` | Log in with an admin account, or have an admin make you an admin. |
| `Port 3000 is already in use. Stop the other server, or set PORT in .env to a free port.` | Something else is using the port | If it's your own `npm run dev` in another terminal, the site is already running there: press `Ctrl+C` in this terminal and use the other one. If another program uses the port, set `PORT=3001` (and `BASE_URL`) in `.env`. |
| `Failed running 'src/server.js'. Waiting for file changes before restarting...` | The server stopped because of an error | Read the error above it. If it's a message from this table, follow that row. Otherwise it's usually a mistake in code you just changed: the first lines of the error name the file and line. Fix it and save; the server restarts by itself. |
| `Terminate batch job (Y/N)?` | You stopped a server started with `npm.cmd` or from Command Prompt | Type `Y` and press Enter. The server has already stopped. |
| The page has no colours or layout | The CSS hasn't been built | Run `npm run build:css`, then refresh with `Ctrl+F5` (`Cmd+Shift+R` on a Mac). |
| Changed text in `is.json` / `en.json` doesn't appear | Translation files are read when the server starts | Restart `npm run dev`. |
| `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '…'` | Packages are missing or out of date | Stop `npm run dev`, then run `npm install`. |
| `'sass' is not recognized as an internal or external command` (macOS/Linux: `sass: command not found` or `sass: not found`) | The packages aren't installed | Run `npm install`. |
| `gyp ERR!` or `node-gyp` during `npm install` | Your npm is older than 11.16, so it ignores the `allowScripts` setting in `package.json` and tries to compile better-sqlite3 | Install the current Node.js 24 LTS (check `npm -v`), then run `npm install` again. Quick workaround: `npm install --ignore-scripts`. On a platform with no prebuilt binary (rare), compile it yourself, which needs Python and a C++ compiler: delete the `"better-sqlite3": false` line from `allowScripts` in your local `package.json` (don't commit that change), then run `npm install-scripts approve better-sqlite3` and `npm rebuild better-sqlite3`. |
| `npm error code EPERM`, `being used by another process` or `Device or resource busy` | A running server (maybe in another terminal) is using the files you're installing or deleting | Stop it with `Ctrl+C`, then run the command again. If `npm install` stopped halfway, just run it again. |
| `node: bad option: --env-file-if-exists=.env`, or `EBADENGINE` warnings | Your Node.js is too old | Install the current Node.js 24 LTS, then run `npm install` again. |

If you're still stuck, copy the whole error from the terminal into a message to the team. Never include your `.env`, or a login code you still use.

## 10. Where things are

[architecture.md](architecture.md) has the directory map: what each folder holds, which paths git ignores, and where new code goes.

### Not covered here

- **Real email** needs the school's SMTP details (open question 4 in [AGENT_START.md](AGENT_START.md)). Until then, keep `SMTP_HOST` empty; emails are printed in the `npm run dev` terminal.
- **Deployment** to the school's server: the guide is in the [README](../README.md#deployment). The deployment itself happens separately, once it is approved.

## 11. npm scripts

| Script | What it does | Status |
|---|---|---|
| `npm run dev` | Starts the site and restarts it when JavaScript in `src/` or `.env` changes | Built |
| `npm run watch:css` | Rebuilds `public/css/main.css` when SCSS changes (not compressed, with a source map) | Built |
| `npm run build:css` | Builds the CSS once, compressed | Built |
| `npm start` | Starts the site (production) | Built |
| `npm run migrate` | Creates the database, or upgrades an older one and keeps its data | Built |
| `npm test` | Runs the tests | Built |
| `npm run create-admin` | Creates the first admin account | Built |
| `npm run seed:dev` | Creates fake students (with new codes) for trying student login. Development only | Built |
| `npm run backup` | Copies the database and the uploaded images into a new folder in `backups/`, and deletes backups older than 7 days | Built |
| `npm run loadtest` | Sign-up load test with fake students (1,000 by default), on its own temporary database | Built |

### Backup

```
npm run backup
```

It reads the database at `DATABASE_PATH` and the images in `UPLOAD_DIR`, and writes a new folder `backup-<UTC time>` in `BACKUP_DIR` (default `backups/`). The folder holds `saeludagar.db`, a consistent copy made while the site keeps running, and `uploads/`. It then deletes backup folders older than 7 days. It stops with an error if there is no database, and never creates an empty one. You should see:

```
Backup written to …/backups/backup-2026-11-20T14-05-00Z (0 image files copied).
Removed 0 backups older than 7 days.
```

The backups hold personal data, so never commit or share them. On the server a systemd timer runs it every night: see [README, Deployment, Backups](../README.md#9-backups).

### Load test

```
npm run loadtest
npm run loadtest -- --students 50 --events 8 --window 2
```

The options are `--students` (default 1000), `--events` (default 40) and `--window`, the seconds over which the students start (default 20, under 60). It makes its own temporary folder with a fresh database and random keys, starts the site (`src/server.js`) in production mode on a free port, logs in the fake students, and lets each one try 6 sign-ups, more than the limit of 4. It ignores the database, folders, keys and SMTP values in your `.env`, so it never touches your data, and it removes its folder when it ends. The full test takes about half a minute. Run it only on your own computer, never against the live site. A short run prints this (times will differ):

```
Sæludagar load test (fake data, temporary database)
Students: 50, events: 8 on 3 days, places: 75, sign-up window: 2 s
Phase 1, login: 50 of 50 students logged in, in 0.6 s
…
Response times:
  login       count     50   p50   123 ms   p95   277 ms   max   292 ms
  front page  count     50   p50     5 ms   p95    11 ms   max    13 ms
  sign-up     count    300   p50     3 ms   p95     6 ms   max    13 ms
…
Checks:
  OK     no 5xx responses
  OK     BR-35: no event over its maximum
  OK     BR-32: no student over 4 sign-ups
  OK     BR-65: no student over 2 sign-ups on one day
  …

Result: PASS
```

`Result: PASS` means every check is OK: among others, no 5xx response, no event over its maximum, no student over 4 sign-ups and none over 2 on one day. Otherwise it prints `Result: FAIL`, the checks that failed and the end of the server's output, and exits with code 1. See also [README, Deployment, The load test](../README.md#13-the-load-test).

## 12. Environment variables

`.env.example` is the template; copy it to `.env` as [section 3](#3-first-time-setup) describes. `src/config.js` reads every variable.

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development` or `production` | `development` |
| `PORT` | Port the site listens on | `3000` |
| `BASE_URL` | Public address of the site, used in emails | `http://localhost:3000` |
| `SCHOOL_NAME` | Shown in the header and the title: "Sæludagar – {SCHOOL_NAME}". Set it to `Fjölbrautaskólinn í Breiðholti` | empty |
| `DATABASE_PATH` | SQLite database file | `./data/saeludagar.db` |
| `UPLOAD_DIR` | Event images | `./uploads` |
| `BACKUP_DIR` | Database backups | `./backups` |
| `SESSION_SECRET` | **Required.** Signs the session cookie | none |
| `KENNITALA_ENC_KEY` | **Required.** Encrypts kennitölur. If the two kennitala keys are lost, stored kennitölur cannot be read or matched: the student CSV has to be imported again, and every teacher account, the admin's included, created again. On the server, keep a copy of the keys somewhere other than the database backups. | none |
| `KENNITALA_HMAC_KEY` | **Required.** A separate key for kennitala lookups | none |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | The school's mail server. `MAIL_FROM` (the noreply address) is required when `SMTP_HOST` is set. `SMTP_SECURE` is `true` for port 465 and `false` for port 587; the server won't start if they don't match. If `SMTP_HOST` is empty, development prints emails to the console instead of sending them; production never prints them, and they stay queued | empty, `587`, `false` |
| `SMTP_MAX_PER_MINUTE` | Sending limit for bulk email | `30` |
| `TRUST_PROXY` | Set to `1` behind nginx in production | `0` |
| `NEW_CODE_LIMIT` | `off` removes the 10-minute limit on "Fá nýjan kóða" (BR-08) for testing. Only works when `NODE_ENV=development`; never set it on the server | empty (limit on) |

## 13. Cloud sessions

Claude Code can also work on the repository in a cloud session (claude.ai/code, or `claude --cloud` in a terminal). The session clones the repository from GitHub, so it only sees what is pushed. Push your branch first.

- **What the session gets from the repository:** `CLAUDE.md`, and the settings, hooks, commands and reviewer agent in `.claude/`.
- **What it does not get:** your `.env`, your database in `data/`, the images in `uploads/`, and anything configured only on your own computer.
- **Node.js and packages:** `.claude/hooks/cloud-setup.sh` runs when a cloud session starts. It installs Node.js 24.20.0 (the cloud machines come with Node.js 20 to 22) after checking the download against its published checksum, puts it first on PATH for the commands Claude runs, and runs `npm ci`. On your own computer it does nothing.
- **Tests and the site:** `npm test` needs nothing else. To run the site there, do the first-time setup of section 3 in the session. It creates a `.env` with new secrets and an empty database that exist only in that session.
- **GitHub commands:** in a cloud session `gh pr` and `gh issue` do not work. Claude uses the session's built-in GitHub tools or `gh api` instead.
- **Branches:** the session can push to any branch except `main`. GitHub refuses a direct push there, so every change reaches `main` through a pull request ([CLAUDE.md](../CLAUDE.md), Hard rules, Git).
- **Projects and several repositories:** sessions with several repositories, and threads inside a claude.ai project, load only `CLAUDE.md`, not the hooks. There, start by asking Claude to run `bash .claude/hooks/cloud-setup.sh`. The script exits at once unless `CLAUDE_CODE_REMOTE` is `true`, which it is in every cloud session.
- **Other agents:** GitHub Copilot's coding agent reads `CLAUDE.md` too. `.github/workflows/copilot-setup-steps.yml` prepares its machine with Node.js 24.20.0 and `npm ci`. The hooks, permission prompts and commands in `.claude/` are Claude Code features and do not run for it.
