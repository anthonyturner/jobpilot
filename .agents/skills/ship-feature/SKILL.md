---
name: ship-feature
description: Run a substantial JobPilot feature end to end - planning, implementation and QA review - by chaining the plan, implement and review stages in one pass. Use when the user invokes $ship-feature or asks to take a feature from request all the way to a reviewed pull request without stopping between stages. Do not use for a small fix, for a stage on its own ($plan-issue, $implement-issue, $review-pr), or when the issue already exists.
---

# Ship a feature (Codex)

Read `AGENTS.md`, `docs/rules.md` and `docs/agent-workflows/pipeline.md`
completely, then run the three workflows pipeline.md names for an end-to-end
run, in order:

1. `docs/agent-workflows/planning.md`, which ends at a filed issue.
2. `docs/agent-workflows/implementation.md`, which ends at a pull request.
3. `docs/agent-workflows/qa-review.md`, which ends at a verdict.

Each one starts from the previous one's finished output. Those documents are
authoritative; this file adds only what is specific to Codex.

## Codex specifics

- Run each stage as its own agent from `.codex/agents/`: `pm`, `refinement`,
  `ux_design` (when the workflow calls for it), `developer`, then `qa`.
- `refinement` and `ux_design` run read-only, without network, and cannot
  reach GitHub. Give them the draft or the issue text, and post their output
  as issue comments yourself. `qa` returns its verdict; post it on the pull
  request.
- A grilling session runs in this conversation, never in a subagent, and only
  when the user asked for it by name.

## Handoffs are the stop conditions

Stop and report if a stage does not return what the next one needs: a missing
issue number after planning, or a missing pull-request URL after
implementation. A failed handoff is reported, never worked around.

## Scope

Follow the autonomy mode in `AGENTS.md` and `docs/rules.md`: it decides whether
the run ends at the QA verdict on a draft pull request or goes on to merge.
Never close an issue by hand; the merge closes it through `Closes #n`.
