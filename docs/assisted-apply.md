# Phase 2: assisted-apply rules

Read this file before touching anything under `server/src/services/apply/`,
`tailoring/`, `documents/`, or the applications UI. These rules are implemented in
`server/src/services/apply/application-service.ts` and covered by
`test/application-service.test.ts`. Keep them true.

1. **Human in the loop.** `preparing → review → approved → previewed → submitted`. Any edit to the
   packet sends it back to `review`. Approval is per application; there is no "approve all".
2. **Fill only by default.** Each ATS mode is `off`, `preview` (fill, screenshot, never submit) or
   `submit`. The default is `preview`. "Open filled form" leaves a visible window for the owner
   to press submit themselves.
3. **Site allowlist.** Only Greenhouse and Lever forms are automated (`ats.ts`). Anything else
   stops with "apply on their site" and the prepared documents.
4. **Stop conditions.** A visible CAPTCHA, a login prompt, an unrecognised required question, a
   dead link or an unparseable page stops automation and hands over to the owner.
5. **Truthful answers only.** `field-matcher.ts` answers only from the applicant profile, the
   answer bank or the owner's per-application answers. Unset yes/no facts (work authorisation,
   sponsorship, relocation) always ask. Voluntary self-ID questions choose "decline" unless the
   owner stored a preference. Consent boxes are ticked only if the owner allowed it.
6. **Caps.** Daily automatic-submission cap (default 10) and a minimum gap between applications
   to the same company (default 72 hours).
7. **Explicit submit.** Automatic submission needs: automation on, ATS in `submit` mode, a clean
   preview, and the company name typed exactly. It is attempted **at most once**: the attempt is
   recorded before the click, and an unconfirmed submit is never retried.
8. **Evidence.** The exact PDFs and screenshots (preview, before/after submit) are stored per
   application under `data/applications/<id>/`, and every step is in the audit log.
9. **Kill switch.** Turning automation off closes every browser JobPilot opened and blocks all
   fills and submits until it is turned back on.
10. **Browser isolation.** Automation uses `data/browser-profile`, never the owner's own profile.
11. **Documents** come from the base resume (`RESUME_PATH`, re-importable in Settings) and only
    select, reorder or trim true content. The UI shows exactly what will be sent.
12. **Unattended preparation stops at `review`.** `npm run auto-prepare` (`AutoPrepareService`) may
    create and tailor applications with nobody watching, and nothing more. Every application it
    creates ends in `review` or `failed`, with `approvedAt` null. It never approves, previews, fills,
    opens or submits, and never opens a job-board or employer page. It is off until the owner turns it
    on. It only runs once first-run setup is finished, and it re-checks the kill switch before each job.
    It never selects a job that has had any application before, and it leaves the job's status alone
    until the owner approves. Everything it does is in the audit log under the `scheduler` actor.
