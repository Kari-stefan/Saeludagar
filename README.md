# Sæludagar

A website for the school's Sæludagar: the few days in the school year when attendance is optional and the school runs events (viðburðir).

- **Students** log in with their kennitala and a personal code, sign up for up to 4 events, and after attending choose which of their courses gets 4 absence points (fjarvistarstig) removed.
- **Teachers** create events, manage participant lists, email participants and mark attendance.
- **An admin** imports student data, sets the dates, and exports a file for the school office to enter into Inna.

The site is bilingual (Icelandic and English) and will run at saeludagar.is.

## Status

Milestones 1 to 9 are built, which is every milestone in the build plan. Milestones 1 to 6 gave the project scaffold and data model; login, accounts and email; the admin settings, student CSV import and sending codes to every student; events (drafts, preview, publishing, images, co-teachers, and the public front page with the braut filter); student sign-up and cancelling within the sign-up window; and the teacher tools (participants, copying emails, messages, the attendance checklist and the printable list). Milestone M5b, added from the project owner's design brief, gave the site the school's logo and red-and-white colours, light and dark mode, a phone menu, search and sorting on the front page, and an Upplýsingar page. Milestone M6b, from the owner's improvements brief, made the front page the one place to work: sign-up on the event cards, every filter and order, a "2/4" counter and a limit of 2 sign-ups a day, and the "Nýr viðburður" dialog. Milestone M6c, from the owner's wireframes brief, rebuilt the event page (up to 5 images with arrows, who runs the event, and "Hópur" for those who manage it) and added the "Fjarvistastig" page, where students give the 4 points of each attendance to one of their courses. Milestone 7 added the office export, a CSV file for the school office with one row per attendance, and the audit log page. Milestone 8 added the purge of all student data (by an admin, or by the site itself 30 days after the course-choice deadline), the nightly backup with 7-day rotation, the 1,000-student load test, an accessibility and browser pass, and the [deployment guide](#deployment) below. Milestone 9 fixed the findings of an external audit of 23 November 2026: a privacy notice page with the school's contact addresses, event images stored without their metadata (such as the GPS position of a phone photo), no session for a guest who only opens a page, login codes that no message or bulk send can delay, an email to a student who is added to an event by hand, a column in the office export that shows whether a teacher or a student marked the attendance, moving an event to another event manager, and a number of smaller fixes. It also added a check that runs the tests and the package audit on every pull request. Until the school's mail server details arrive, emails are printed in the terminal unless SMTP is set up.

What is left before launch is not new code: the checks in Firefox and Safari listed under [Accessibility and browser checks](#accessibility-and-browser-checks), the project owner's approval, the data protection officer's review of the privacy notice, the school's two contact addresses (`CONTACT_EMAIL` and `PRIVACY_EMAIL`), a copy of the backups and of the keys outside the server, the answers to the open questions in section 15 of AGENT_START.md (the mail server, the server and the domain among them), and the deployment itself. Target: finished and approved by 1 February 2027, for Sæludagar in March 2027.

## Documentation

| File | What it is |
|---|---|
| [docs/AGENT_START.md](docs/AGENT_START.md) | **The full specification**: business rules, pages, data model, build plan, open questions |
| [docs/run.md](docs/run.md) | **How to run the site on your computer**: setup, every npm script and environment variable, Windows notes and troubleshooting |
| [docs/architecture.md](docs/architecture.md) | **How the code is put together**: what runs, how a request is handled, the directory map, and the reasons behind the design |
| [docs/conventions.md](docs/conventions.md) | **How code and tests are written here**, with a file to copy from for each kind of change |
| [docs/requirements.md](docs/requirements.md) | Original requirements (reference only) |
| [docs/saeludagar-notes.txt](docs/saeludagar-notes.txt) | Original meeting notes (reference only) |
| [docs/design-requirements.md](docs/design-requirements.md) | The project owner's design brief, built in milestone M5b (reference only) |
| [docs/improvements-requirements.md](docs/improvements-requirements.md) | The project owner's improvements brief, built in milestone M6b (reference only) |
| [docs/wireframes-requirements.md](docs/wireframes-requirements.md) | The project owner's brief for the event page and Fjarvistastig, built in milestone M6c (reference only) |
| [CLAUDE.md](CLAUDE.md) | The rules for working in this repository, loaded automatically by Claude Code: the hard rules, the commands and the definition of done |

Where the original notes and AGENT_START.md disagree, AGENT_START.md wins. Unresolved items, such as SMTP access and the server details, are listed in section 15 of AGENT_START.md.

## Tech stack

Node.js 24 LTS, Express 5, EJS, SCSS compiled to CSS, SQLite (better-sqlite3) and plain JavaScript in the browser. The full package list and versions are in section 10 of AGENT_START.md.

## How we work

### Branches
The branch and pull-request rules are in [CLAUDE.md](CLAUDE.md) under Hard rules, Git. They apply to people as well as to Claude Code.

### Building with Claude Code
The site is built one milestone at a time from [docs/AGENT_START.md](docs/AGENT_START.md):

1. Run `/milestone` with the next milestone that the Status section above names, if one is left. Claude builds that milestone only, then stops.
2. Run `/review` to have the `spec-reviewer` agent check the changes against the business rules, the security requirements and the milestone's scope.
3. Check the result yourself using the "how to verify" steps Claude gives.
4. Commit, push your branch and open a pull request into `main`.
5. After it is merged, move on to the next milestone.

`.claude/settings.json` makes Claude Code ask before `npm install`, `npm uninstall` and `git push`, blocks its Read tool from `.env`, `data/` and `backups/`, and runs the model-routing hook (see [CLAUDE.md](CLAUDE.md), Model routing). The other rules, such as asking before deleting files or changing the data model, are instructions in [CLAUDE.md](CLAUDE.md), not settings.

## Setup

Follow **[docs/run.md](docs/run.md)**. It covers what you need, the first-time setup, starting the site, running the tests, every npm script and environment variable, and troubleshooting. To put the site on a server, see [Deployment](#deployment) below.

## Accessibility and browser checks

AGENT_START.md section 13 (milestone 8) asks for a keyboard-only walkthrough of the student, teacher and admin flows, and for checks in Chrome, Firefox and Safari. Only the Chromium part is done. **Firefox and Safari have not been checked yet.** The checklist at the end of this section is for a person to run.

### What was done

On 20 November 2026, in Chromium 157.0.8103.78 (through Playwright), driven by scripts. Every page of every role was loaded in light and dark mode, in Icelandic and English, at 1280, 768, 360 and 320 px and on a phone (Pixel 7 emulation with touch). The scripts ran against a throwaway copy of the data, never the real database.

### What was checked (AGENT_START.md section 11)

- Keyboard access everywhere, with a visible focus indicator.
- A label on every input, and a name on every link and button.
- Errors linked to their fields, and announced: a message that a page loads with takes keyboard focus.
- Alt text on images, the skip-to-content link, one `h1` per page and no skipped heading levels.
- Text contrast of at least 4.5:1 in both modes, and no information carried by colour alone.
- No sideways scrolling from 320 px wide.
- Tap targets of at least 44 px on the attendance list.
- The core flows with JavaScript turned off.
- No console errors and no Content-Security-Policy violations.

### Keyboard-only walkthroughs

- **Student:** log in; search, "Sía", "Raða", clearing a choice and "Hreinsa allt"; "Skrá" and "Afskrá" on a card and on the event page; stepping through an event's images; "Fjarvistastig" give and take back; ÍS/EN and light/dark; the mobile menu at 360 px (opens with Enter, focus stays inside, Escape closes it and returns focus); log out. Result: every step works.
- **Teacher:** the "Nýr viðburður" dialog (focus on the first field and inside the dialog, Escape returns focus to the button, a server error focuses the field); save a draft, preview, publish; add and remove a student; add and remove a co-teacher; edit with an error and then save; attendance with Space; the message form; the printable list. Result: every step works.
- **Admin:** add a day; times with an error and then saved; import the example CSV (upload, summary, confirm) and a bad file; send codes; create an event manager with an error and then correctly; all events; the export page; the audit log's filter and paging; the purge page (a wrong word gives an error that takes focus and is linked to the field, then the right word deletes the data). Result: every step works.
- The scripts also print a few FAIL lines. They are not faults in the site: the date and time fields show no focus ring on their date-picker parts (listed below), and the rest are expected 400 and 401 answers or checks in the script that were wrong and were verified by hand.

### Fixed in this pass

1. Sideways scrolling at 320 px on the event page and the teacher's event page (long values in the label and value list).
2. Sideways scrolling at 320 px on the on-screen participant list for printing. The printed list is unchanged.
3. The search field's placeholder had a contrast of 3.99:1 in dark mode. It uses the muted text colour now.
4. A disabled button changed colour on hover and looked clickable. It no longer does.
5. After a form came back with an error, a failed login or a refused action, focus stayed at the top of the page and the message was not reliably announced. The message now takes focus (`public/js/focus-message.js`).

The purge page (`/admin/purge`) needed no fix. It passed every check above with no deadline set, with a future deadline and with a past deadline.

### Known and not fixed

For the team to decide:

- Image files chosen in the event form are lost after a validation error when JavaScript is off.
- The date and time fields show no focus ring on their date-picker parts.
- On event cards, a long word can break in the middle.
- In the front page's tab order, "Nýr viðburður" comes in an unexpected place.
- After a post without JavaScript, the page does not jump to the section that changed.
- Without JavaScript the attendance page's help text still describes the autosave.

### Not checked

Firefox. Safari on macOS. Safari on iOS. Chrome on a real Android phone. Real screen-reader output (focus moves to the message, but nobody has listened to it). Print preview on paper. The 500 page.

### Checklist for Firefox and Safari

Run it in Firefox and in Safari, on a desktop and in each browser's responsive or phone mode. Tick each item that works.

- [ ] Student flow by keyboard only (the list above).
- [ ] Teacher flow by keyboard only.
- [ ] Admin flow by keyboard only.
- [ ] The `<details>` menus: the mobile menu, "Sía" and "Raða" open, close with Escape and close when you click outside.
- [ ] Focus stays inside the open mobile menu, and Escape returns it to the menu button.
- [ ] The "Nýr viðburður" dialog (`<dialog>`) opens, keeps focus inside and closes with Escape.
- [ ] The date and time fields can be used with the keyboard and show where focus is.
- [ ] The image gallery's arrows, and its sideways scrolling.
- [ ] The file field with several images, with a preview of each and a working remove button.
- [ ] Copying the participants' emails to the clipboard.
- [ ] The attendance checklist on a phone: ticking and the tap targets.
- [ ] Printing the participant list (print preview).
- [ ] Light and dark mode, including the placeholder text in the search field.
- [ ] After a failed login and after a form error, focus is on the message and it has a visible outline.

Write the result under this line: browser, version, date and name.

## Deployment

This is a guide for putting the site on a Linux server and keeping it running: Node.js under systemd, nginx in front of it, HTTPS from Let's Encrypt, a nightly backup, and how to restore and update. It is written for someone new to the project.

**Status of this guide.** The school's server is not confirmed yet (open question 5 in [AGENT_START.md](docs/AGENT_START.md)), so this guide assumes a Debian or Ubuntu LTS server with `apt` and systemd. It has not been run on the school's server. Nothing is deployed until the project owner approves it. Who controls the DNS for saeludagar.is (open question 6) and who maintains the site after launch (open question 7) are also not decided.

Run the commands as a user who may use `sudo`. Values in `<angle brackets>` are for you to fill in.

### 1. How it fits together

- **One Node process** runs the site, the email sender and the scheduled jobs (including the automatic purge). It listens on port 3000.
- **nginx** takes requests on ports 80 and 443, handles HTTPS and passes them to port 3000.
- **systemd** starts the site at boot and restarts it if it stops. It also runs the nightly backup.
- **Run exactly one copy of the site.** SQLite is written by one process. Do not start a second instance or use a cluster mode.
- **The data** is in three folders inside the code folder, and git ignores all three: `data/` (the database), `uploads/` (event images) and `backups/`.

### 2. Prepare the server

Install the packages that the rest of the guide needs:

```
sudo apt update
sudo apt install -y git nginx ufw curl xz-utils
```

**Install Node.js 24 LTS.** This downloads the official binary from nodejs.org, checks it against the published checksum and unpacks it into `/usr/local`. It is for a 64-bit x86 server; on an ARM server replace `linux-x64` with `linux-arm64` in the two places it appears.

```
cd /tmp
curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
FILE=$(grep -o 'node-v24[0-9.]*-linux-x64.tar.xz' SHASUMS256.txt | head -1)
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$FILE"
grep " $FILE\$" SHASUMS256.txt | sha256sum -c -
sudo tar -xJf "$FILE" -C /usr/local --strip-components=1 --no-same-owner --exclude='*.md' --exclude=LICENSE
node -v
npm -v
```

`sha256sum` must print `OK`. `node -v` should print `v24.something` and `npm -v` should print 11.16 or newer (see [docs/run.md](docs/run.md), section 1). The program is now `/usr/local/bin/node`; the unit files below use that path. If the school installs Node.js another way, run `command -v node` and use that path in the unit files instead.

**Create the service user and the folders.** The user has no password and no login shell:

```
sudo useradd --system --create-home --home-dir /var/lib/saeludagar --shell /usr/sbin/nologin saeludagar
sudo mkdir /opt/saeludagar
sudo chown saeludagar:saeludagar /opt/saeludagar
```

**Get the code.** If the repository is private, the server needs read access to it first, for example a read-only deploy key; ask the project owner.

```
cd /opt/saeludagar
sudo -u saeludagar git clone <repository URL> .
sudo -u saeludagar mkdir -p data uploads backups
sudo chmod 700 data uploads backups
```

The `chmod` closes the three folders to every other user on the server: the database and the backups hold personal data.

### 3. Set the environment variables

All settings live in `/opt/saeludagar/.env`. Git ignores it. Only the service user may read it:

```
cd /opt/saeludagar
sudo -u saeludagar cp .env.example .env
sudo chmod 600 .env
```

Generate the three secrets. This prints three lines with random values:

```
node -e "for (const k of ['SESSION_SECRET','KENNITALA_ENC_KEY','KENNITALA_HMAC_KEY']) console.log(k + '=' + require('node:crypto').randomBytes(32).toString('base64'))"
```

Open `.env` with `sudo -u saeludagar nano .env` and set these values. **Replace** the existing lines; do not add a second line with the same name, because the last one wins.

```
NODE_ENV=production
PORT=3000
BASE_URL=https://saeludagar.is
SCHOOL_NAME=Fjölbrautaskólinn í Breiðholti
CONTACT_EMAIL=<the school's contact for Sæludagar>
PRIVACY_EMAIL=<the school's data protection officer>
TRUST_PROXY=1
SESSION_SECRET=<the first printed value>
KENNITALA_ENC_KEY=<the second printed value>
KENNITALA_HMAC_KEY=<the third printed value>
SMTP_HOST=<from the kerfisstjóri>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<from the kerfisstjóri>
SMTP_PASS=<from the kerfisstjóri>
MAIL_FROM=<the noreply address, from the kerfisstjóri>
SMTP_MAX_PER_MINUTE=30
```

Leave `DATABASE_PATH`, `UPLOAD_DIR` and `BACKUP_DIR` as they are in `.env.example`: this guide, the unit files and the backup all assume the three folders inside `/opt/saeludagar`. Leave `NEW_CODE_LIMIT` empty.

What the important ones mean:

- **`TRUST_PROXY=1`** goes with nginx. The session cookie is marked Secure in production, so the site must know that a request came in over HTTPS even though nginx passes it on over plain HTTP. nginx tells it with the `X-Forwarded-Proto` header, and `TRUST_PROXY=1` makes the site believe that header. Never set it without a proxy that sets the header.
- **`CONTACT_EMAIL` and `PRIVACY_EMAIL`** are shown on the privacy page and on "Upplýsingar". The site refuses to start in production without both.
- **`HOST`** is not in the list above on purpose. Left empty, the site listens only on `127.0.0.1` in production, which is what nginx needs. Do not set it unless you know why.
- **The SMTP values** come from the school's kerfisstjóri (open question 4). `SMTP_MAX_PER_MINUTE` must not be above the school's mail limit.
- **Without SMTP, nobody gets a login code.** In production the site never prints emails in the terminal. With `SMTP_HOST` empty, emails stay queued and are not sent. Set the SMTP values before you send codes to students.
- **Keep a copy of the three secrets** somewhere other than this server and its backups, for example in the school's password manager. Where that copy goes is not decided (open question 8). Never put them in the repository or in an email.

[docs/run.md](docs/run.md), section 12, explains every variable, including `BASE_URL`, the SMTP port and `SMTP_SECURE` pairing, what losing the kennitala keys means and what `NEW_CODE_LIMIT` does.

### 4. Install and set up the site

Run these as the service user, in the code folder:

```
cd /opt/saeludagar
sudo -H -u saeludagar npm ci
sudo -H -u saeludagar npm run build:css
sudo -H -u saeludagar npm run migrate
sudo -H -u saeludagar npm run create-admin -- --name "<full name>" --email "<name@example.is>" --kennitala "<the admin's kennitala>"
```

- `-H` makes `sudo` use the service user's home folder, so npm keeps its cache there and not in yours.
- `npm ci` installs the exact versions in `package-lock.json`, including Sass. The CSS is not in git, so `npm run build:css` is needed on the server, and again after every update.
- `npm run migrate` creates the database in `data/`.
- `create-admin` prints the admin's login code **once**. Write it down before you clear the screen. If it is lost, use **Fá nýjan kóða** on the login page once the SMTP values work.
- The kennitala is typed into the command, so it can end up in the shell history. Before you log out, run `history -c` so it is not saved.

### 5. Run the site with systemd

Create `/etc/systemd/system/saeludagar.service` (for example with `sudo nano`):

```ini
[Unit]
Description=Saeludagar website
After=network-online.target
Wants=network-online.target

[Service]
User=saeludagar
Group=saeludagar
WorkingDirectory=/opt/saeludagar
ExecStart=/usr/local/bin/node --env-file=.env src/server.js
Restart=on-failure
RestartSec=5
# The app waits up to 5 seconds for open requests and for an email being sent.
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/saeludagar/data /opt/saeludagar/uploads /opt/saeludagar/backups

[Install]
WantedBy=multi-user.target
```

- The unit runs `node` directly, not through `npm`, so that systemd's stop signal reaches the site and it shuts down cleanly.
- `ProtectSystem=strict` makes the whole disk read-only for the site, except the three folders in `ReadWritePaths`. SQLite needs `data/` to be writable, also for its `-wal` and `-shm` files.
- `.env` is read from the working directory. Changing `.env` only takes effect after a restart.

Start it and check that it runs:

```
sudo systemctl daemon-reload
sudo systemctl enable --now saeludagar
sudo systemctl status saeludagar
sudo journalctl -u saeludagar -f
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

`status` should say `active (running)` and the log should say `Sæludagar is running at http://localhost:3000`. (The address in that line is always `localhost`; the real address is `BASE_URL`.) The last command should print `200`. Leave the log with `Ctrl+C`. If the service stops at once, the log says why; [docs/run.md](docs/run.md), section 9, explains the common messages.

### 6. Close port 3000 to the outside

In production the site listens on port 3000 only on `127.0.0.1`, so only nginx on the same machine can reach it (the `HOST` setting changes this; leave it empty). The firewall is a second layer: if `HOST` were ever set to another address, anyone who can reach the server could open `http://<server address>:3000` and bypass nginx and HTTPS. So the firewall must block everything except SSH, HTTP and HTTPS. Allow SSH **first**, or you lock yourself out:

```
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

If SSH listens on another port, allow that port instead of 22. Later, from a different computer, check that `http://<server address>:3000` does not answer. If the school's network already has a firewall in front of the server, it must block port 3000 too.

### 7. Put nginx in front

Create `/etc/nginx/sites-available/saeludagar.conf`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name saeludagar.is;

    # An event form can carry 5 images of 2 MB each, so allow a bit more than 10 MB.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`client_max_body_size 12m;` matters: nginx refuses request bodies above 1 MB by default (error 413), which would reject an event form with several images. The site itself still limits each image to 2 MB and an event to 5 images.

Turn the site on, remove nginx's default welcome site, check the file and reload:

```
sudo ln -s /etc/nginx/sites-available/saeludagar.conf /etc/nginx/sites-enabled/saeludagar.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` must say `syntax is ok` and `test is successful`.

### 8. HTTPS with Let's Encrypt

The site only works over HTTPS in production. First, **saeludagar.is must point at this server**: its DNS A record (and AAAA record, if the server has an IPv6 address) must have the server's public address, and ports 80 and 443 must be reachable from the internet. Who controls the DNS is open question 6; ask them to make this change. Let's Encrypt cannot give a certificate before it does.

Install Certbot with snap (the method the Certbot project recommends for Debian and Ubuntu). Ubuntu has snap; on Debian, run `sudo apt install -y snapd` first.

```
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d saeludagar.is
```

Certbot asks for an email address (for expiry warnings; use a shared school address, not a personal one) and for you to accept the terms. It then gets the certificate and changes `saeludagar.conf` to listen on port 443 and to send port 80 to HTTPS. It leaves `client_max_body_size` in place; check with `sudo grep client_max_body_size /etc/nginx/sites-enabled/saeludagar.conf`.

Renewal is automatic: the snap installs a timer that runs `certbot renew` twice a day. Test it:

```
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

The dry run should end with `Congratulations, all simulated renewals succeeded`. Now open `https://saeludagar.is` in a browser and log in with the admin code. If login does not work, the usual cause is `TRUST_PROXY=1` missing in `.env` (then run `sudo systemctl restart saeludagar`).

### 9. Backups

`npm run backup` gives you a copy of the database and the event images in a new folder in `backups/`, and keeps backups for 7 days; [docs/run.md](docs/run.md) describes it in full.

Run it every night with a systemd timer. The unit runs `scripts/backup.js` directly, which is the same script that `npm run backup` runs. Create `/etc/systemd/system/saeludagar-backup.service`:

```ini
[Unit]
Description=Saeludagar daily backup

[Service]
Type=oneshot
User=saeludagar
Group=saeludagar
WorkingDirectory=/opt/saeludagar
ExecStart=/usr/local/bin/node --env-file=.env scripts/backup.js
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/saeludagar/data /opt/saeludagar/backups
```

and `/etc/systemd/system/saeludagar-backup.timer`:

```ini
[Unit]
Description=Run the Saeludagar backup every night

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

`OnCalendar` uses the server's time zone. `Persistent=true` makes systemd run a backup that was missed because the server was off. Turn it on and try it once by hand:

```
sudo systemctl daemon-reload
sudo systemctl enable --now saeludagar-backup.timer
systemctl list-timers saeludagar-backup.timer
sudo systemctl start saeludagar-backup.service
sudo journalctl -u saeludagar-backup.service -n 5
sudo ls /opt/saeludagar/backups
```

The log should say `Backup written to … (N image files copied).` and `Removed 0 backups older than 7 days.`.

**Alternative: cron.** If the school prefers cron, skip the two backup unit files and add this line with `sudo crontab -u saeludagar -e`:

```
15 3 * * * cd /opt/saeludagar && /usr/local/bin/node --env-file=.env scripts/backup.js 2>&1 | logger -t saeludagar-backup
```

Three things to know about the backups:

- **They hold personal data** (kennitölur, names, emails). Keep the folder closed to other users. The 7-day rotation is what makes personal data leave the backups at most 7 days after a purge.
- **They are on the same disk as the site.** If the disk fails, the site and its backups are lost together. Where an off-server copy goes is not decided (open question 8), so until it is, there is none.
- **They do not contain the `.env` secrets.** Keep those separately, as section 3 says.

### 10. Restore from a backup

Use this when the database is damaged or lost. Replace `backup-<time>` with the folder you chose in `ls /opt/saeludagar/backups`. The `.env` must hold the same three secrets that were in use when the backup was made; with other keys, the kennitölur in the backup cannot be read.

```
sudo systemctl stop saeludagar
cd /opt/saeludagar
sudo mkdir -p /var/lib/saeludagar/before-restore
sudo mv data/saeludagar.db /var/lib/saeludagar/before-restore/
sudo rm -f data/saeludagar.db-wal data/saeludagar.db-shm
sudo cp backups/backup-<time>/saeludagar.db data/saeludagar.db
sudo mv uploads /var/lib/saeludagar/before-restore/uploads
sudo cp -a backups/backup-<time>/uploads uploads
sudo chown -R saeludagar:saeludagar data uploads
sudo chmod 700 data uploads
sudo systemctl start saeludagar
sudo systemctl status saeludagar
```

The `chmod` keeps `data` and `uploads` closed to other users, as section 2 set them. Remove the `-wal` and `-shm` files **before** you copy: SQLite would apply a leftover `-wal` file to the restored database and mix the old data into it. The old database and images are kept in `/var/lib/saeludagar/before-restore/` until you are sure; they hold personal data, so delete them afterwards. Then log in and check the front page and an event with images. If the backup was made by an older version of the code, run `sudo -H -u saeludagar npm run migrate` before `systemctl start`.

### 11. Update to a new version

Take a backup first, then fetch the new code:

```
cd /opt/saeludagar
sudo systemctl start saeludagar-backup.service
sudo -u saeludagar git pull
sudo -H -u saeludagar npm ci
sudo -H -u saeludagar npm run build:css
sudo -H -u saeludagar npm run migrate
sudo systemctl restart saeludagar
sudo systemctl status saeludagar
```

To install a tagged version instead of the newest code, run `sudo -u saeludagar git fetch --tags` and `sudo -u saeludagar git checkout <tag>` in place of `git pull`. Run `npm run migrate` before the restart: the site refuses to start when the database is older than the code. Compare `.env.example` with `.env` after an update and add any new settings by hand; do not copy it over `.env`. The site is unavailable for a few seconds while it restarts. Update outside Sæludagar and sign-up times.

### 12. Through the year

For whoever maintains the site (open question 7). Each step is a page under **Stjórnendasvæði**; [docs/run.md](docs/run.md), section 4, shows how each one works.

1. **Dates.** **Dagsetningar og frestir**: add the Sæludagar days, and set when sign-up opens and closes and the course-choice deadline.
2. **Import the student list.** **Innflutningur nemenda**: upload the CSV from the school office, read the summary and confirm. Import again whenever the office sends a newer file.
3. **Create the event managers.** **Viðburðastjórar**: add the teachers (their codes are emailed) and make students event managers where needed. Teachers can then create their events.
4. **Send the codes.** **Senda kóða**, before sign-up opens: every active student gets a new code by email. Watch the progress on the page. It needs working SMTP settings.
5. **During sign-up and Sæludagar.** **Allir viðburðir** lets you manage any event. Teachers take attendance on their phones.
6. **Export for the office.** **Útflutningur fyrir skrifstofu**, after the course-choice deadline: download the file and give it to the office, which enters the absence points into Inna. Download it again if anything changed.
7. **Purge.** **Hreinsun gagna** deletes all student data. If nobody purges it, the site does it by itself 30 days after the course-choice deadline. Events become drafts, ready for next year. Copies of the data stay in the backups for up to 7 more days.
8. **When needed.** **Aðgerðaskrá** shows who changed what; **Viðburðastjórar** deactivates or reactivates teachers.

Regular checks: `systemctl status saeludagar`, that a new folder appears in `backups/` every night, that `sudo certbot renew --dry-run` still works, and that the disk is not full (`df -h`). Run `sudo apt update && sudo apt upgrade` now and then. To move to a newer Node.js 24 release, repeat the Node.js commands of section 2 and run `sudo systemctl restart saeludagar`.

### 13. The load test

`npm run loadtest` tests sign-up with 1,000 students. It starts its own temporary server and database on a developer's computer. Never run it against the live site (open question 19). [docs/run.md](docs/run.md), section 11, has the options and what the report means.

The run of 20 November 2026 (a 4-core cloud machine, Node.js 24.20.0) passed: 1,000 students logged in and sent 6,000 sign-ups over 20 seconds, with no 5xx answer, no event over its maximum and no student over 4 sign-ups or over 2 on one day.

| Request | Count | p50 | p95 | Slowest |
|---|---|---|---|---|
| Login | 1,000 | 114 ms | 189 ms | 236 ms |
| Front page | 1,000 | 6 ms | 15 ms | 33 ms |
| Sign-up | 6,000 | 3 ms | 9 ms | 32 ms |

A harder run the same day, with every student starting within one second (`--window 1`), also passed, with no 5xx answer and no limit broken. The requests then queue: the front page took 1.3 s (p50) and 2.6 s (p95), and a sign-up 0.9 s (p50) and 2.3 s (p95). The school's server will give other numbers.

## Data protection

The site handles students' kennitölur, names and emails, and many students are under 18. The rules that follow from that are in [CLAUDE.md](CLAUDE.md) under Hard rules, Privacy, and they apply to people as well as to Claude Code.
