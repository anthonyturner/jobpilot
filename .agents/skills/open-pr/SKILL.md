---
name: open-pr
description: Turn already-written, uncommitted changes plus an existing tracked JobPilot GitHub issue into a verified pull request. Use when the user says "create a PR for issue <n>" or "open a PR for this" and the code changes already exist in the working tree. Do not use for implementing an issue from scratch ($implement-issue), or when no issue has been filed yet ($plan-issue).
---

# Open a pull request for work already written (Codex)

Read `AGENTS.md`, `docs/rules.md` and `docs/agent-workflows/implementation.md`
completely, and run implementation.md from its section on work written before
the pull request existed. Those documents are authoritative; this file adds
only what is specific to Codex.

This is the recovery path. The normal order is to branch and open the pull
request *before* implementing; use this skill when that did not happen and the
work is already sitting in the working tree.

## Codex specifics

- Run it in this conversation rather than delegating to the `developer` agent.
  The changes are already written, so what is left is verifying, committing
  and publishing them.
- Stage only the files the issue covers, by name. Never stage everything with a
  wildcard: a working tree that predates the branch is the most likely place
  for unrelated changes to be sitting.

## Scope

Follow the autonomy mode in `AGENTS.md` and `docs/rules.md`: it decides whether
this skill stops at a draft pull request or goes on to review and merge.
