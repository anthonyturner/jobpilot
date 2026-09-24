# ADR-0003: Agent autonomy

- **Status:** Accepted
- **Date:** Accepted when this playbook was installed
- **Deciders:** Project maintainers, by choosing an autonomy mode when installing the agent playbook
- **Related:** [pipeline.md](../agent-workflows/pipeline.md), [implementation.md](../agent-workflows/implementation.md), [refinement.md](../agent-workflows/refinement.md), [ADR-0001](0001-record-refinement-on-the-issue.md), [ADR-0002](0002-track-work-in-github-only.md)

## Context

An agent workflow has to decide where a person stands in the loop. The
playbook this project adopted started with approval gates everywhere, and they
did not do the job they were written for.

**Approval gates stopped everything, several times per change.** Agents were
told to get explicit approval of the approach before editing and of the final
diff before any commit, push, issue or pull request. Ordinary work stopped two
or three times before anything reached GitHub.

**The gate sat in the worst place to review code.** A diff pasted into a chat
transcript has no file tree, no syntax highlighting, no line comments, no CI
result, and no record afterwards. And the gate came after the code was
written, so it never prevented wasted work; it only delayed publishing work
already done.

**Opening the pull request last left the work invisible and unsafe.** When the
pull request is the final step, a whole feature can be written into the default
branch's working tree across a session, with the branch created seconds before
the commit. Nothing is reviewable or tracked while it happens, and a context
switch or a mistake wanting a clean revert has nothing to fall back on.

**The pipeline ran on a magic word.** When the full pipeline runs only if the
requester remembers to invoke it by name, it gets skipped on exactly the work
that needed it.

**Refinement ended in a sign-off nobody wanted to staff.** Refinement's
assessment went to the requester, who answered its questions before the product
manager filed the issue. The reasons were sound: assumptions exist to be
challenged, and the requester usually knows at least one answer; sizing and
splitting are priority decisions; a misunderstanding caught in the assessment
costs a paragraph instead of an issue, a branch and a review. But a
single maintainer does not want to be interrupted mid-pipeline with a document
to read at the moment they have the least context — before the work exists. A
gate nobody wants to staff is not a control; it is a queue.

## Decision

**Work runs without stopping for approval, and review happens on the pull
request, where review tools are.**

These parts hold in every project:

- Standing authorization for the outward-facing actions of the workflow:
  filing and updating issues, commenting on issues and pull requests, creating
  branches, committing, and pushing.
- The branch and a **draft** pull request are created **as soon as the issue
  exists and before implementation begins**. A pull request needs one commit
  ahead of base, so an empty scaffold commit opens it.
- The pipeline runs on the merits of the work, not on a magic word. The
  `plan-issue` and `ship-feature` skills force it; they are not the only way to
  get it.
- **The refinement assessment goes to the product manager**, who files the
  issue against it directly. Its open assumptions and unknowns are filed on the
  issue as an explicit *Open questions* section; its proposed split is acted
  on; and neither stage sets priority — the requester applies it when they
  triage, except on a defect, where priority comes from triage.
- Escalation signals still reach the requester, on the issue and in the
  pull-request body. They were never a sign-off mechanism and they do not
  disappear with one.
- Never force-push, rewrite history, delete branches, or commit directly to the
  default branch. Never close an issue by hand.

This project chose **stop at the draft pull request**:

- Agents carry work to a **draft** pull request and stop there. They never mark
  a pull request ready for review and never merge.
- **The draft pull request is the review gate.** The requester reads the diff
  there, marks it ready, and merges. An agent's own verification, and a QA
  agent's review, are never a substitute for that reading.

## Alternatives considered

- **Keep the approval gates.** Rejected on what they actually bought. The gate
  sat at the end, after the code was written, so it never prevented wasted
  work. The real protection against a wrong approach is earlier — refinement,
  before the issue is filed.
- **Require the pipeline to be invoked by name.** Rejected: it makes the
  workflow depend on remembering a word rather than on the nature of the work,
  and the word gets forgotten.
- **Branch at the start but open the pull request at the end.** Fixes the
  "work sitting on the default branch" problem, but keeps the work invisible
  until it is finished. A branch with no pull request does not show up where
  people follow progress.
- **Non-draft pull requests from the start.** Rejected. Draft is what
  distinguishes "this exists and you can watch it" from "this is ready for your
  time". Losing that distinction makes the notification worthless.
- **Keep the refinement sign-off, or make it non-blocking.** A blocking
  sign-off is the queue described above. A non-blocking one — file now, send the
  assessment for comment in parallel — is the worst of both: the issue is filed
  against unreviewed assumptions, so the comment arrives too late to prevent
  anything, while still costing the interruption. A team with a product owner
  distinct from the requester should reinstate the blocking sign-off; the
  arguments for it remain the right ones for that team.
- **Have refinement decide priority, since it reaches nobody else.** Rejected.
  Priority is a statement about what matters to the people running the project,
  and no reading of the code produces it. An invented priority label is worse
  than an absent one, because it looks like a decision.
- **Let agents review and merge their own pull requests.** The other mode this
  playbook offers. Rejected here: this project wants a person to read every
  diff before it lands.

## Consequences

- **What this makes easier.** A change is visible in GitHub from the moment it
  starts. Where the project has CI, it runs against each push instead of one
  large diff at the end. Work is never uncommitted on the default branch, so
  abandoning or reverting it costs nothing. The pipeline runs from request to
  pull request with no human input, and nothing queues behind a reply.

- **What this makes harder, and what it costs.** Real, not nominal:
  - **There is no checkpoint before code.** A wrong approach is found at the
    pull request, after the code exists. A misunderstanding that would have
    cost a paragraph now costs an issue, a branch, an implementation and a
    review. Refinement is the mitigation, and it only works if it actually
    runs.
  - **Assumptions are recorded rather than resolved.** An *Open questions*
    section is strictly weaker than an answer. The work proceeds on a guess
    that is at least visible.
  - **The assessment is read by an agent that will act on it**, not by a person
    who will question it. A vague assumption is no longer a prompt for a
    conversation; it is an instruction.
  - **More pull requests, some of them abandoned.** Anything started leaves a
    visible artifact, and the product manager's duplicate search must cover
    open pull requests, not just issues.
  - **The requester is the only real reviewer.** If a draft is not read
    carefully, nothing else catches the problem. The draft genuinely has to be
    read; with this decision there is nothing behind it.

- **What now has to be true.** Every piece of work has an issue, a branch and a
  draft pull request before implementation begins, and the pull-request body
  is filled in properly rather than left as a scaffold stub. Nothing is ever
  committed to the default branch. Every assumption and unknown from an
  assessment appears on its issue as an open question, and no issue is filed
  with an invented priority.
  No agent marks a pull request ready for review or merges one.

## Compliance

Look at any branch: its first commit should predate its implementation commits,
and a draft pull request should exist from that point. A branch whose pull
request appeared only after the work was finished, or a session whose edits
happened on the default branch, is what this decision exists to prevent.

Look at any issue filed against a refinement assessment: it should carry an
*Open questions* section whenever the assessment left anything open, and no
priority label unless it is a defect.

Look at any merged pull request: a person, not an agent, marked it ready and
merged it.

An instruction file that tells an agent to wait for approval before committing,
pushing or opening a pull request, or to stop and hand the refinement
assessment to the requester, contradicts this ADR and should be corrected
rather than followed.
