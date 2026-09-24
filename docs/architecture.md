# Architecture

Read this file before deciding where server or UI code belongs, and before adding
a job source. It adds JobPilot's own shape to the general rules in
[rules.md](rules.md) and [stack/](stack/).

## Layout

```
server/                 Node 24 + TypeScript API (Fastify, node:sqlite, node-cron, zod)
  src/config/           env parsing (zod); safe defaults; loopback-only binding
  src/domain/           types and schemas: Job, Profile, Schedule; neutral placeholder profile
  src/sources/          one class per job board, behind the JobSource interface
  src/services/         normalise → score → store pipeline, scheduler, profile store
    resume/             .docx → structured resume (the only facts tailoring may use)
    tailoring/          headless Claude (no tools) → packet; id validation + grounding check
    documents/          HTML templates → PDF via local Chrome (JS off, network blocked)
    apply/              application state machine + guardrails, unattended preparation, field matcher, form filler, ATS adapters
    setup/              first-run state and resume-based profile suggestions
    credential-store.ts API keys: .env first, else data/credentials.json; write-only over the API
  src/integrations/     claude.exe runner (no shell), Chrome discovery
  src/persistence/      SQLite repositories and migrations (append-only audit_log)
  src/http/             routes, security hooks, validation, app factory
  src/cli/              one-off commands for Task Scheduler: sync-once (sweep), prepare-once (sweep + tailor to review)
  src/composition.ts    composition root: the ONLY place concrete classes are wired
  test/                 node:test suites (run with tsx)
web/                    Angular 21 UI (standalone components, signals, zoneless)
  src/app/core/         API client, models (mirror server/src/domain), shared state
  src/app/shared/       presentational components (icon, score ring, avatar, chip input)
  src/app/features/     setup wizard, jobs, pipeline, applications, runs, settings pages
.claude/commands/       /find-jobs: pushes Indeed results from an interactive Claude session
data/                   SQLite DB, ingest token, credentials.json, generated PDFs/screenshots,
                        automation browser profile (all git-ignored, personal data)
```

## SOLID, as applied here

- **Single responsibility.** Sources fetch. `normalize.ts` cleans. Scorers score. Repositories
  persist. `AggregationService` orchestrates. Routes translate HTTP. Don't blur these lines.
- **Open/closed.** Add a job board by adding a `JobSource` class and registering it in
  `composition.ts`. You should not need to edit the pipeline, repositories or routes.
- **Liskov substitution.** Every `JobSource` must honour the contract: return `RawJob[]`, throw on
  failure (the service records it), never write to the DB, and only call hosts listed in `hosts`.
- **Interface segregation.** Keep interfaces small (`JobSource`, `JobScorer`, `HttpClient`,
  `ClaudeRunner`). Depend on the narrowest one you need.
- **Dependency inversion.** Services receive dependencies through constructors. Only
  `composition.ts` and `main.ts` call `new` on infrastructure. Tests substitute fakes (see `test/api.test.ts`).

## Code style

These add to [stack/typescript.md](stack/typescript.md) and
[stack/angular.md](stack/angular.md).

- TypeScript `strict` everywhere, plus `noUncheckedIndexedAccess` on the server. No `any`.
- Validate every external input with zod at the boundary: HTTP bodies, query strings, env vars,
  and anything an LLM returns. Inside the boundary, trust the types.
- Angular: standalone components, `input()`/`output()`/`model()`, signals and `computed`,
  new control flow (`@if`, `@for`), `OnPush`. No NgModules. No zone.js.
- Styling: use the design tokens in `web/src/styles.scss` (`--surface`, `--accent-grad`, etc.).
  Never hard-code a colour that has a token. Both themes must work.
- `web/src/app/core/models.ts` mirrors `server/src/domain`; change both together when the API
  contract changes.

## Adding a job source (checklist)

1. Confirm the board offers an **official API, feed or connector** and that its terms allow this
   use. If it doesn't, stop and ask the owner. Do not scrape (rule 16).
2. Create a class implementing `JobSource` in `server/src/sources/`. Declare every hostname in `hosts`.
3. Put API keys in `.env` (add to `.env.example` with a comment), read them in `config/env.ts`,
   and pass them in through the constructor. `status()` must report "needs setup" when a key is missing.
4. Keep quota in mind: use `queriesFor(profile, n)` to cap calls per sweep.
5. Register it in `composition.ts`, add its id to `SOURCE_IDS` and to the UI's `SOURCE_LABELS` and `SOURCE_COLORS`.
6. Add a test with a recorded response fixture (no live network in tests).
