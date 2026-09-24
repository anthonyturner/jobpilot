---
name: grill-me
description: A relentless round-based interview that stress-tests a plan, decision or idea before it becomes a JobPilot issue. Use ONLY when the user invokes $grill-me or asks to be grilled by name. Never start a session on your own initiative, and never as a precondition for filing an issue.
---

# Grill a request (Codex)

Read `docs/agent-workflows/grilling.md` completely and run the session it
defines. It is authoritative; this file adds only what is specific to Codex.
The technique it describes is adapted from
[mattpocock/skills](https://github.com/mattpocock/skills) (MIT).

## Codex specifics

- Run the session in this conversation with the user. A subagent cannot
  interview a person, so never delegate it.

## Scope

Write no files, create no branch, and file no issue as part of this skill. The
session ends when the user confirms the understanding is shared. If they then
want an issue filed, hand the settled decisions to $plan-issue. That is their
call, not a step of this skill.
