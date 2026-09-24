# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security tab → "Report a vulnerability"). Include steps to reproduce and the
impact you expect. You'll get an acknowledgement as soon as possible.

## Threat model in brief

JobPilot is a single-user app that runs on the user's own computer.

- **Other websites in the user's browser** are the main threat to a local server. The API binds
  to loopback only, checks the Host header (DNS rebinding) and Origin, and requires a custom
  header on every write (CSRF). Machine-to-machine ingest uses a random bearer token.
- **Third-party content** (job descriptions, application pages) is untrusted. HTML is sanitised
  with an allowlist, links are restricted to http(s), and AI steps treat it as data, never as
  instructions.
- **Secrets** (API keys) live in `.env` or `data/credentials.json`, are never logged, and the API
  never returns them.
- **AI agents** run with the least privilege possible: tailoring runs with no tools at all,
  Indeed search runs with one tool, both with a spend cap, and every reply is schema-validated.
- **Automation** never submits an application without the user's explicit approval, and stops
  at CAPTCHAs, logins and unknown questions.

Details are in [AGENTS.md](AGENTS.md#security-principles).

## Scope

In scope: this repository's code. Out of scope: vulnerabilities in the job boards, applicant
tracking systems or Claude Code themselves (report those to their owners).
