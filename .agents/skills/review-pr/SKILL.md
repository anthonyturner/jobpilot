---
name: review-pr
description: Review a JobPilot pull request against its linked GitHub issue, acceptance criteria, the project's standards, scope, and check evidence, then return an approve or request-changes verdict. Use when the user asks for a PR review, a QA review, or acceptance-criteria validation. Do not use for implementing an issue ($implement-issue) or for fixing what the review finds - a fix is separate work with its own issue.
---

# Review a pull request (Codex)

Read `AGENTS.md`, `docs/rules.md` and `docs/agent-workflows/qa-review.md`
completely and run the review qa-review.md defines. Those documents are
authoritative; this file adds only what is specific to Codex.

## Codex specifics

- Run the review as the `qa` agent from `.codex/agents/`.
- Use the available GitHub integration or read-only `gh` commands to resolve the
  pull request and gather the issue, its comments, the diff, the commits and the
  check evidence.
- Post the verdict as a pull-request comment yourself. GitHub does not let
  anyone approve their own pull request, so the verdict is a comment, never an
  Approve review.

## Scope

Read-only. Do not modify files, commit, push, or merge.

A QA verdict never changes the pull request's state by itself. What happens
next, leaving it in draft for the requester or merging it, is set by the
autonomy mode in `AGENTS.md` and `docs/rules.md` and is not this skill's step.
Never close the issue: the merge closes it through `Closes #n`.
