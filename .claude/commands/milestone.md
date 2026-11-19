---
description: Build one milestone from docs/AGENT_START.md, then stop for review
argument-hint: <milestone, for example 7 or 6c>
---

Build milestone **$ARGUMENTS** from `docs/AGENT_START.md`, and nothing else.

1. **Check the input.**
   - If no milestone number was given, ask for one (`CLAUDE.md`, Hard rules, says how to ask).
   - If `README.md` (Status) does not list the previous milestone as built, ask before starting.
2. **Read the spec.**
   - Read the whole §13 entry for this milestone, every section and BR it references, §10 (allowed packages) and §15 (open questions).
   - Read `docs/architecture.md` and `docs/conventions.md` for where code goes and how it is written here.
   - If an open question blocks this milestone, ask about it with AskUserQuestion before writing code.
3. **Build.**
   - Implement exactly the milestone's "Do" list.
   - Follow `CLAUDE.md`: the hard rules, the never-touch list and the definition of done.
4. **Verify.** Run `npm test` and the milestone's acceptance checks, and fix failures that are within scope.
5. **Review.**
   - Have the `spec-reviewer` agent review the changes for this milestone. Launch it with `model: "opus"` (`CLAUDE.md`, Model routing).
   - Fix its Blocking findings if they are within scope. Report anything you did not fix.
6. **Stop.**
   - Give the "✅" report that `CLAUDE.md` (Hard rules, Scope) asks for, with how to verify the milestone and the reviewer's verdict.
   - Then wait for the go-ahead.
