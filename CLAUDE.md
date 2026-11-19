# Sæludagar website

A bilingual (ÍS/EN) school website. Students sign up for Sæludagar events (viðburðir), and after attending they choose which of their courses gets absence points removed. Stack: Node.js 24, Express 5, EJS, SCSS, SQLite (better-sqlite3), plain browser JavaScript.

## Model routing (hard rule, enforced by hook)

You (the main session, Fable 5.2) are the planner and decision-maker, not the main
code-writer. Spend your capacity on reasoning; hand implementation to cheaper agents.

### What you do yourself (Fable 5.2)
- Understanding the request, asking clarifying questions, and setting scope
- Architecture, design trade-offs, and technology or library choices
- Debugging strategy when the root cause isn't obvious
- Breaking work into well-specified tasks
- Reviewing subagent output and deciding to accept, revise, or re-delegate
- Any decision that is hard to reverse (schema changes, public APIs, data migrations, deletions)
- Trivial edits (about 10 lines or fewer, one file, intent obvious). Delegating these costs more than doing them.

### What you delegate (Agent tool, `model` always set)
- **`sonnet`** (default for coding): well-specified implementation, tests, refactors with a
  clear target, boilerplate, config, docs, mechanical multi-file changes, running and fixing lint/tests
- **`opus`**: coding that needs judgment as it goes. Examples are tricky algorithms, concurrency,
  performance work, subtle bugs found during implementation, unfamiliar code, and changes
  touching more than 5 files with tangled dependencies
- **Read-only codebase searches:** `Explore` agent with `model: "sonnet"`
- If unsure between sonnet and opus, pick `sonnet`. Escalate to `opus` if it fails or comes back wrong once.
- Never use `subagent_type: "fork"`, because forks ignore the model override and run on Fable.

### How to delegate
Subagents start with zero context. Every handoff must include:
1. **Goal**: what "done" looks like, in one or two sentences
2. **Files**: exact paths to read and modify
3. **Constraints**: conventions, APIs to use or avoid, and what not to touch
4. **Decisions already made**: the design choices you settled, so the agent doesn't reopen them
5. **Verification**: the exact command(s) to run (tests, typecheck, build) and the expected result
6. **Report back**: a summary of changes, files touched, test output, and anything uncertain

Independent tasks go out in parallel in one message. Dependent tasks go out one after another.

### After delegation
- Review every result before accepting it. Check the diff against the goal and confirm
  tests actually ran and passed.
- If something is wrong, fix it yourself (if small) or re-delegate with a sharper spec
  describing what failed. Don't re-send the same prompt.
- If a subagent hits a design question, it stops and reports instead of guessing. You make the call.
- In your reply to me, list which model handled each delegated task (one line each).

### Override
If I explicitly name a model for a task, use that model.

## Source of truth
- `docs/AGENT_START.md` is the full specification: business rules (BR-01 to BR-69), pages, data model, build plan and open questions. Read the relevant sections before doing any work.
- `docs/requirements.md` and `docs/saeludagar-notes.txt` are the original planning notes. `docs/design-requirements.md`, `docs/improvements-requirements.md` and `docs/wireframes-requirements.md` are the project owner's design brief (built in milestone M5b), improvements brief (built in M6b) and brief for the event page and Fjarvistastig (built in M6c). All five are kept for reference only. Where they differ from AGENT_START.md, AGENT_START.md wins.
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
- `docs/run.md` explains how to run the site locally (with Windows notes and troubleshooting); the README's Setup section is the short version. The npm scripts are listed in AGENT_START §10 and in the README.
- When a milestone adds or changes a command, a setup step or an error message people will see, update `docs/run.md` in the same change.
