---
description: Review the current changes against docs/AGENT_START.md with the spec-reviewer agent
argument-hint: [milestone number] [git range]
---

Have the `spec-reviewer` agent review the current changes.

Pass these arguments on to the agent: **$ARGUMENTS**. They may contain a milestone number, a git range, or both. If they are empty, the agent reviews the current branch against `main` plus any uncommitted work, and works out the milestone itself.

Show the user the agent's verdict, findings and acceptance checklist as it reports them. Do not fix anything unless the user asks.
