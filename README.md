# Sæludagar

A website for the school's Sæludagar: the few days in the school year when attendance is optional and the school runs events (viðburðir).

- **Students** log in with their kennitala and a personal code, sign up for up to 4 events, and after attending choose which of their courses gets 4 absence points (fjarvistarstig) removed.
- **Teachers** create events, manage participant lists, email participants and mark attendance.
- **An admin** imports student data, sets the dates, and exports a file for the school office to enter into Inna.

The site is bilingual (Icelandic and English) and will run at saeludagar.is.

## Status

Milestones 1 to 7 are built. Milestones 1 to 6 gave the project scaffold and data model; login, accounts and email; the admin settings, student CSV import and sending codes to every student; events (drafts, preview, publishing, images, co-teachers, and the public front page with the braut filter); student sign-up and cancelling within the sign-up window; and the teacher tools (participants, copying emails, messages, the attendance checklist and the printable list). Milestone M5b, added from the project owner's design brief, gave the site the school's logo and red-and-white colours, light and dark mode, a phone menu, search and sorting on the front page, and an Upplýsingar page. Milestone M6b, from the owner's improvements brief, made the front page the one place to work: sign-up on the event cards, every filter and order, a "2/4" counter and a limit of 2 sign-ups a day, and the "Nýr viðburður" dialog. Milestone M6c, from the owner's wireframes brief, rebuilt the event page (up to 5 images with arrows, who runs the event, and "Hópur" for those who manage it) and added the "Fjarvistastig" page, where students give the 4 points of each attendance to one of their courses. Milestone 7 added the office export, a CSV file for the school office with one row per attendance, and the audit log page. Until the school's mail server details arrive, emails are printed in the terminal unless SMTP is set up. The next step is milestone 8 (the purge, backups, the load test, an accessibility and browser pass, and deployment notes). Target: finished and approved by 1 February 2027, for Sæludagar in March 2027.

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

1. Run `/milestone` with the next milestone from the Status section above, for example `/milestone 7`. Claude builds that milestone only, then stops.
2. Run `/review` to have the `spec-reviewer` agent check the changes against the business rules, the security requirements and the milestone's scope.
3. Check the result yourself using the "how to verify" steps Claude gives.
4. Commit, push your branch and open a pull request into `main`.
5. After it is merged, move on to the next milestone.

`.claude/settings.json` makes Claude Code ask before `npm install`, `npm uninstall` and `git push`, blocks its Read tool from `.env`, `data/` and `backups/`, and runs the model-routing hook (see [CLAUDE.md](CLAUDE.md), Model routing). The other rules, such as asking before deleting files or changing the data model, are instructions in [CLAUDE.md](CLAUDE.md), not settings.

## Setup

Follow **[docs/run.md](docs/run.md)**. It covers what you need, the first-time setup, starting the site, running the tests, every npm script and environment variable, and troubleshooting.

## Data protection

The site handles students' kennitölur, names and emails, and many students are under 18. The rules that follow from that are in [CLAUDE.md](CLAUDE.md) under Hard rules, Privacy, and they apply to people as well as to Claude Code.
