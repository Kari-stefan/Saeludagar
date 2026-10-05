# Sæludagar website

A bilingual (ÍS/EN) school website. Students sign up for Sæludagar events (viðburðir), and after attending they choose which of their courses gets absence points removed. Stack: Node.js 24, Express 5, EJS, SCSS, SQLite (better-sqlite3), plain browser JavaScript.

## Source of truth
- `docs/AGENT_START.md` is the full specification: business rules (BR-01 to BR-61), pages, data model, build plan and open questions. Read the relevant sections before doing any work.
- `docs/requirements.md` and `docs/saeludagar-notes.txt` are the original planning notes, kept for reference only. Where they differ from AGENT_START.md, AGENT_START.md wins.
- `README.md` is the overview for people. Milestone 1 fills in its Setup section.

## Current phase
- The project is in an early phase. Build one milestone at a time (AGENT_START §13), starting with milestone 1 (scaffold and data model only). Do not build ahead.

## Rules
These three rules repeat AGENT_START §14:
- "Only build what this document specifies. Do not add features, abstractions, or dependencies beyond it."
- "Stop and ask before: adding a dependency not listed in section 10, changing the data model after milestone 1, deleting files, running migrations on real data, or deploying."
- "After each milestone output: ✅ [what was completed] and how to verify it, then wait for my go-ahead."

Also:
- If something is unclear, or an open question (AGENT_START §15) blocks the current milestone, ask with AskUserQuestion. Write the questions in Icelandic, put the recommended option first and mark it "(mælt með)". Write everything else in English.
- Never use real kennitölur or real student data. Tests and seeds use fake data such as `0000000001`.
- Never read or commit `.env`, the database (`data/`) or backups (`backups/`).

## Workflow
- `/milestone N` builds one milestone and stops.
- `/review` has the read-only `spec-reviewer` agent (`.claude/agents/`) check the changes against the business rules, §9 security requirements and the milestone's scope. Run it before every pull request.

## Git
- `main` is the main branch. Never commit to it directly. Work on a personal branch (for example `kari`) and open a pull request into `main`; a teammate reviews and merges it.
- Do not commit or push unless asked.
- No `Co-Authored-By` lines or other Claude attribution in commits or PRs. `.claude/settings.json` turns this off as well.
- Leave the `.gitkeep` files in place.

## Conventions
- All UI text goes through `src/i18n/is.json` and `en.json`. The Icelandic UI says "viðburður", never "atburður".
- Name tests after the BR IDs they cover.
- Check a library's current documentation before using its API; several packages in AGENT_START §10 had recent major releases.

## Commands
The npm scripts (`dev`, `watch:css`, `build:css`, `test`, `migrate`, `create-admin`, `backup`, `loadtest`, `seed:dev`) are created in milestone 1. They are listed in AGENT_START §10. Until milestone 1 is done there is nothing to run.
