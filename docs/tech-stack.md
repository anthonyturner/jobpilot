# Tech stack

What JobPilot is built on. Keep it to a short list: the language, the
framework, the main libraries, where data lives, and how it is built and
deployed. Agents read this to avoid proposing a tool the project does not use,
so a missing line costs more than a long one.

- Node.js 24 and strict TypeScript, npm workspaces (`server`, `web`). Rules in
  [stack/typescript.md](stack/typescript.md).
- **Server:** Fastify 5 (with `@fastify/helmet`, `@fastify/static`), zod for every
  boundary, node-cron for schedules, sanitize-html for job descriptions,
  playwright-core driving the owner's local Chrome (PDFs and form filling), fflate
  for .docx parsing. Run with `tsx`; tests use `node:test`.
- **Logging:** Fastify's built-in pino logger (`server/src/http/app.ts`), with auth
  headers redacted. There is no logger in the UI; don't scatter `console.log`.
- **UI:** Angular 21, standalone, signals, zoneless, OnPush; selector prefix `app`;
  unit tests with Vitest (`ng test`). Conventions in
  [stack/angular.md](stack/angular.md) and [stack/ui-components.md](stack/ui-components.md).
- **Styling:** plain SCSS with the design tokens in `web/src/styles.scss`, light and
  dark themes. No Bootstrap and no BEM convention, so skip the optional Styling
  section of ui-components.md; the token rule in [architecture.md](architecture.md) applies.
- **Data:** SQLite through `node:sqlite` in `data/jobpilot.db` (WAL, migrations in
  `server/src/persistence/database.ts`), plus files under `data/`. All git-ignored
  personal data.
- **External services:** job-board APIs (Adzuna, USAJOBS, JSearch, and Indeed through
  the official Claude connector) and Claude Code (`claude.exe`) for tailoring. See
  [security.md](security.md) for how each is constrained.
- **Build and run:** `npm start` builds the UI and serves UI + API on
  `127.0.0.1:7317`; `npm run dev` for watch mode. Self-hosted on the owner's own
  machine only, with no deployment.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`): `npm ci`, `npm run typecheck`,
  `npm test` (including real-Chrome form tests against local fixtures), `npm run build`.
