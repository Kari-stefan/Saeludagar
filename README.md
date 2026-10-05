# Sæludagar

A website for the school's Sæludagar: the few days in the school year when attendance is optional and the school runs events (viðburðir).

- **Students** log in with their kennitala and a personal code, sign up for up to 4 events, and after attending choose which of their courses gets 4 absence points (fjarvistarstig) removed.
- **Teachers** create events, manage participant lists, email participants and mark attendance.
- **An admin** imports student data, sets the dates, and exports a file for the school office to enter into Inna.

The site is bilingual (Icelandic and English) and will run at saeludagar.is.

## Status

Planning is finished and the build has not started yet. The next step is milestone 1 (project scaffold and data model). Target: finished and approved by 1 February 2027, for Sæludagar in March 2027.

## Documentation

| File | What it is |
|---|---|
| [docs/AGENT_START.md](docs/AGENT_START.md) | **The full specification**: business rules, pages, data model, build plan, open questions |
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

The folders are empty for now; each holds a `.gitkeep` so git keeps it.

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

Added in milestone 1. You will need Node.js 24 LTS.

## Data protection

The site handles students' kennitölur, names and emails, and many students are under 18. Never commit real student data, `.env` or database files. Tests and development data use fake kennitölur such as `0000000001`.
