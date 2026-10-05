---
description: Build one milestone from docs/AGENT_START.md, then stop for review
argument-hint: <milestone number 1-8>
---

Build milestone **$ARGUMENTS** from `docs/AGENT_START.md`, and nothing else.

1. **Check the input.**
   - If no milestone number was given, ask for one with AskUserQuestion (in Icelandic, recommended option first, marked "(mælt með)").
   - If the previous milestone does not look finished and approved, ask before starting.
2. **Read the spec.**
   - Read the whole §13 entry for this milestone, every section and BR it references, §10 (allowed packages and structure), §14 (agent rules) and §15 (open questions).
   - If an open question blocks this milestone, ask about it with AskUserQuestion before writing code.
3. **Build.**
   - Implement exactly the milestone's "Do" list.
   - Write `node:test` tests named after the BR IDs they cover.
   - Use only fake data, such as the kennitala `0000000001`.
   - Follow every rule in §14. In particular, stop and ask before adding a package outside §10, changing the data model after milestone 1, or deleting files.
4. **Verify.** Run the milestone's acceptance checks (at least `npm test` once `package.json` exists) and fix failures that are within scope.
5. **Review.**
   - Have the `spec-reviewer` agent review the changes for this milestone.
   - Fix its Blocking findings if they are within scope. Report anything you did not fix.
6. **Stop.**
   - Output "✅ [what was completed]", how to verify it, and the reviewer's verdict.
   - Then wait for the go-ahead.
   - Do not commit or push unless asked, and never add Claude attribution lines to commits.
