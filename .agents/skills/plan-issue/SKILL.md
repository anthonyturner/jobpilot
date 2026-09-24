---
name: plan-issue
description: Take a substantial JobPilot request from words to a filed GitHub issue, running the Product Manager, Engineering Refinement and optional UX Design stages. Use when the user invokes $plan-issue, or asks to scope, refine or formalize substantial work into an issue ready to implement. Do not use for implementing an issue ($implement-issue), for reviewing a pull request ($review-pr), or for a small well-understood fix, which needs an issue but not the planning stages.
---

# Plan an issue (Codex)

Read `AGENTS.md`, `docs/rules.md` and `docs/agent-workflows/planning.md`
completely and run the workflow planning.md defines. Those documents are
authoritative; this file adds only what is specific to Codex.

## Codex specifics

- Run each stage as its own agent from `.codex/agents/`: `pm`, then
  `refinement`, then `pm` again to file, then `ux_design` when the workflow
  calls for it.
- Use the available GitHub integration or the `gh` CLI to confirm
  authentication, search for duplicates, and read the repository's real labels
  before selecting any.
- `refinement` and `ux_design` run read-only, without network, and cannot
  reach GitHub. Give them the draft or the issue text, and post their output
  as issue comments yourself, as planning.md describes for read-only stages.
- A grilling session runs in this conversation, never in a subagent, and only
  when the user asked for it by name ($grill-me).

## Scope

Stops at the filed issue. Never create a branch, edit repository files, commit,
push, or open a pull request as part of this skill, and never close an issue.

Close with a handoff pointer:

```text
Use $implement-issue to implement issue #<number>.
```
