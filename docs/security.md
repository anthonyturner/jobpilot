# Security principles

Read this file before touching auth, validation, sanitising, secrets, outbound
requests, the HTTP layer, the Claude runner or the audit log. These describe how
JobPilot is built. Keep them true. Security-relevant behaviour **always** has
tests (see rule 8 in [rules.md](rules.md)).

1. **Loopback only.** The API binds to `127.0.0.1`; `HOST` accepts only loopback values. Never add
   a way to bind `0.0.0.0` or expose the app through a tunnel.
2. **Browser-attack defences** (`server/src/http/security.ts`): Host header allowlist (DNS
   rebinding), Origin allowlist, and a required `x-jobpilot-client` header on writes (CSRF).
   Don't weaken or bypass these, and don't add CORS.
3. **Machine-to-machine writes** (`POST /api/ingest`) need the bearer token in `data/ingest-token`
   (or `INGEST_TOKEN`), compared in constant time. Never log it, print it or commit it.
4. **Untrusted content.** Job descriptions are HTML from third parties. They're sanitised
   server-side with an allowlist (`sanitizeDescription`) and rendered only through Angular's
   sanitising `[innerHTML]`. Never use `bypassSecurityTrust*`. Only `http(s)` links are stored.
5. **Outbound requests** go only through `PoliteHttpClient`: HTTPS, host allowlist built from
   registered sources, timeouts, a response-size cap, per-host rate limiting and backoff.
6. **Secrets** live in `.env` or `data/credentials.json` (both git-ignored). The credentials API is
   write-only for secrets: it reports whether a key is set, never its value. Logs redact auth
   headers. Errors returned to the client are generic; details stay in the server log.
7. **First run is gated.** Until the setup wizard is finished, every sweep is refused, so no job
   board is ever queried with placeholder details.
8. **Strict CSP** on the served UI (`script-src 'self'`). Don't add inline scripts or new
   third-party origins without updating the CSP deliberately.
9. **Least-privilege agents.** Claude Code is launched as `claude.exe` directly (never through a
   shell), with the prompt on stdin and no user or project settings. The Indeed run gets exactly
   one tool (Indeed search); tailoring gets **no tools at all** (`--tools ""`, `--strict-mcp-config`)
   and a `--max-budget-usd` cap. Every reply is validated against a schema before use.
10. **Grounded documents.** Tailored resumes are selections of base-resume ids (checked
    mechanically). Generated prose (summary, cover letter) is scanned for technologies, numbers and
    names absent from the base resume; the owner must acknowledge any flags before approving.
11. **Test against fixtures, not employers.** Never fill or submit a real employer's form while
    developing. Use the local fixtures in `test/form-fill.integration.test.ts`, or a read-only probe
    (`readFields` + `decide`, no typing) when checking a live ATS page.
12. **Auditability.** Every status change and profile change is written to `audit_log`, which is
    append-only. Never add update or delete paths for it.
13. **Dependencies.** Prefer the platform (`node:sqlite`, `fetch`, `node:test`) over new packages.
    Justify any new dependency in the PR description.
