# Sæludagar website

A bilingual (ÍS/EN) school website. Students sign up for Sæludagar events (viðburðir), and after attending they choose which of their courses gets absence points removed. Stack: Node.js 24, Express 5, EJS, SCSS, SQLite (better-sqlite3), plain browser JavaScript.

`README.md` (Status) says which milestones are built and which is next. Read it before you start.

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

### Enforcement
- `.claude/settings.json` runs `.claude/hooks/require-agent-model.py` before every Agent call. The hook blocks a call that has no `model` or that uses `subagent_type: "fork"`. It does not check which model you named.
- The `spec-reviewer` agent (`/review`, `/milestone`) is an Agent call like any other, so it needs a `model` too.
- The hook needs `python` on the PATH. If it cannot run, or cannot read its input, the call goes ahead. The rule above applies whether or not the hook speaks.
- A session keeps the hooks it started with. After changing the hook or its settings, start a new session.

## Hard rules

These have no exceptions. If a task seems to need one, stop and ask.

**Privacy**
- Never read, print or commit `.env`, anything in `data/` (the database) or anything in `backups/`.
- Never use real kennitölur or real student data. Tests, seeds and examples use fake ones such as `0000000001`.
- Never show a kennitala in the UI, in a URL or in a log. It is decrypted only to build the office export (AGENT_START §8).

**Ask first**

Stop and ask the project owner before any of these. Never leave one of them to a subagent.
- Adding a dependency that is not in the table in AGENT_START §10
- Changing the data model (`src/db/schema.sql`, `src/db/migrate.js`)
- Deleting files
- Running migrations on real data
- Deploying

**Scope**
- Build only what `docs/AGENT_START.md` specifies. Do not add features, abstractions or dependencies beyond it.
- When the project owner asks for something the specification does not have, write it into `docs/AGENT_START.md` first, then build it. The specification stays the source of truth.
- Build one milestone at a time (AGENT_START §13) and do not build ahead. After a milestone, report "✅ [what was completed]" and how to verify it, then wait for the go-ahead.
- If the spec is unclear or contradicts itself, or an open question (AGENT_START §15) blocks the work, stop and ask. Do not guess.
- Ask with AskUserQuestion. Write the questions in Icelandic, put the recommended option first and mark it "(mælt með)". Write everything else in English.

**Git**
- `main` is the main branch. Never commit to it directly. Work on a personal branch (for example `kari`) and open a pull request into `main`; a teammate reviews and merges it.
- Do not commit or push unless asked.
- No `Co-Authored-By` lines or other Claude attribution in commits or pull requests. `.claude/settings.json` turns it off as well.

**Docs**
- Any change that makes a doc inaccurate must update that doc in the same commit. For `CLAUDE.md` and `.claude/`, see "Never touch".

## Never touch

| Path | Rule |
|---|---|
| `.env` | Secrets. Never read, print or commit it. `.env.example` is the committed template. |
| `data/`, `backups/` | The database and its backups. Never read or commit their contents. |
| `uploads/` | Event images written by the running site. Never add, edit or commit files there. |
| `public/css/` | Generated from `scss/` by `npm run build:css`, and git-ignored. Edit `scss/` instead. |
| `node_modules/`, `package-lock.json` | Written by npm. Never edit them by hand. Whether to upgrade a package, or to run `npm audit fix`, is the project owner's decision: ask. |
| `.gitkeep` files | Leave them in place. They keep otherwise empty folders in git. |
| `docs/requirements.md`, `docs/saeludagar-notes.txt`, `docs/design-requirements.md`, `docs/improvements-requirements.md`, `docs/wireframes-requirements.md` | The original notes and the project owner's briefs, kept as a record. Do not build from them and do not edit them to match the code. `docs/AGENT_START.md` is the specification. |
| `CLAUDE.md`, `.claude/` | The project owner's instructions to agents. Change them only when the project owner asks. If your change would make one of them inaccurate, say so in your report and ask. |

## Commands

```
npm test                                                       # all tests, about 20 seconds
npm test -- test/points.test.js                                # one test file
npm test -- --test-name-pattern="BR-69" test/points.test.js    # only the tests whose name matches
npm run build:css                                              # rebuild public/css/main.css after changing scss/
npm run dev                                                    # the site at http://localhost:3000
npm run migrate                                                # create or upgrade the local database
```

- The tests pass when the summary at the end says `fail 0`. They use temporary databases and never touch `.env` or `data/`.
- `npm run dev`, `npm run migrate`, `npm run create-admin` and `npm run seed:dev` use the developer's `.env` and the database in `data/`. `docs/run.md` has the first-time setup, every npm script and every environment variable.
- There is no linter, formatter, type checker, coverage tool or CI. `npm test` is the only automated check.
- There is no deploy command. Deployment arrives in milestone 8 and is on the "Ask first" list.

## Definition of done

A change is finished when all of these hold:
1. `npm test` ends with `fail 0`.
2. Every business rule (BR) the change touches has a test whose name includes the BR ID (AGENT_START §13). `docs/conventions.md` (Tests) shows how.
3. Every text the site shows is in both `src/i18n/is.json` and `src/i18n/en.json`, under the same key.
4. If you changed `scss/`, `npm run build:css` finishes without an error.
5. Every doc the change made inaccurate is updated in the same commit.
6. Nothing on the "Ask first" list was done without approval, and nothing under "Never touch" changed.
7. Your report says what you changed, which commands you ran and what they printed.

A milestone also needs these:
- The read-only `spec-reviewer` agent has reviewed it. `/milestone N` runs the reviewer as its fifth step, and `/review` runs it on its own.
- Its Blocking findings are fixed or reported.
- You have given the "✅" report from "Scope" above and are waiting for the go-ahead.

Run `/review` before every pull request.

## When rules conflict

1. A hard rule beats everything else in this file and in `docs/`.
2. If an instruction is unclear, or two instructions contradict each other, stop and ask. Do not pick one.
3. `docs/AGENT_START.md` beats the five reference files listed under "Never touch".
4. When a doc and the code disagree about a fact (a command, a path, a version), the code is right: fix the doc. When the specification and the code disagree about what the site should do, stop and ask.
5. "Build only what the spec specifies" does not rule out tests for the rules you touch or the doc updates your change needs. Both are part of the change.

## Where the detail lives

| Read | When |
|---|---|
| `README.md` (Status) | Before you start: what is built and what is next. |
| `docs/AGENT_START.md` | The specification. Read the sections your task touches before you write code: §4 business rules (BR-01 to BR-69), §6 pages, §7 data model, §8 login, import, email, export and uploads, §9 security requirements, §10 allowed packages, §11 design, §13 build plan, §15 open questions. |
| `docs/architecture.md` | Before changing code you have not seen: what runs, how a request is handled, the layers, where each kind of new code goes, and why things are built the way they are. |
| `docs/conventions.md` | Before writing code or tests: the patterns, a file to copy from for each kind of change, how to write and run tests, and the traps. |
| `docs/run.md` | To set up or run the site, for every npm script and environment variable, and when a command fails. |
| `.claude/commands/milestone.md`, `.claude/commands/review.md`, `.claude/agents/spec-reviewer.md` | What `/milestone N` and `/review` do, and what the reviewer checks. |
