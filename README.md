# JobPilot

**A self-hosted job-search copilot.** JobPilot finds jobs that match your resume on a schedule,
ranks them, and helps you apply, without sending anything to an employer unless you approve it.

- **Finds jobs** from Indeed (via Claude Code's official connector), Remotive, Remote OK,
  The Muse, Adzuna, USAJOBS, JSearch (LinkedIn, Glassdoor, ZipRecruiter) and the Greenhouse/Lever
  career pages of companies you follow. Official APIs only, no scraping.
- **Ranks every job 0–100** against your skills, target titles, location and salary floor, and
  shows why it scored the way it did.
- **Tracks your pipeline** on a drag-and-drop board, from saved to offer.
- **Helps you apply**: drafts a tailored resume and cover letter from *your own* resume, fills
  Greenhouse and Lever forms, and submits only with your explicit, per-application approval.

Everything runs on your computer. There's no account, no cloud database and no telemetry.

## Requirements

| Needed for | Requirement |
|---|---|
| Everything | [Node.js 24+](https://nodejs.org) |
| PDFs and form filling | Google Chrome or Microsoft Edge (found automatically) |
| Indeed search, resume tailoring *(optional)* | [Claude Code](https://claude.com/claude-code), signed in. For Indeed, enable the Indeed connector on claude.ai |
| More job boards *(optional)* | Free API keys for Adzuna, USAJOBS and/or JSearch |

## Get started

```bash
git clone https://github.com/anthonyturner/jobpilot.git
cd jobpilot
npm install
npm start
```

Open **http://127.0.0.1:7317**. A setup wizard walks you through it:

1. **Upload your resume** (.docx). JobPilot suggests your skills, job titles and searches from it.
2. **About you**: your location, remote preference and salary floor.
3. **What to look for**: review the suggested searches, titles and skills.
4. **Job sources**: add any API keys you have. Keys are stored on your computer only and never
   shown again after saving.

Finishing the wizard runs your first sweep. After that, sweeps run on a schedule (weekdays at
7:30am and 3:30pm by default, in your computer's time zone). You can change it in Settings.

### Keep it running in the background (Windows)

Scheduled sweeps only run while JobPilot is running. To start it hidden at login:

```powershell
.\scripts\install-startup-task.ps1          # add
.\scripts\install-startup-task.ps1 -Remove  # remove
```

On macOS or Linux, run `npm run serve` from a login item, `launchd` or a `systemd --user` service.

## Configuration

Most settings live in the app (**Settings**). For headless or scripted setups you can also use a
`.env` file; copy `.env.example` and fill in what you need. Values in `.env` override the app.

| Variable | Purpose |
|---|---|
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | [Adzuna](https://developer.adzuna.com) API (free) |
| `USAJOBS_API_KEY`, `CONTACT_EMAIL` | [USAJOBS](https://developer.usajobs.gov) API (free) |
| `JSEARCH_API_KEY` | [JSearch on RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) (small free tier) |
| `INDEED_VIA_CLAUDE` | `true` to search Indeed through Claude Code on every sweep |
| `RESUME_PATH` | Import a resume from a path on first start instead of uploading it |
| `PORT`, `TIMEZONE`, `CHROME_PATH`, `TAILOR_MODEL` | Advanced overrides |

## Applying with JobPilot

1. Fill in **Settings → Applying**: contact details, screening answers (work authorization,
   sponsorship and so on) and automation preferences. Anything left unset is never guessed.
2. On a job, choose **Prepare application**. Claude, running with no tools, picks and orders your
   real resume bullets and drafts a summary and cover letter. JobPilot renders both as PDFs.
3. **Review and edit.** Any technology, number or name that isn't in your resume is flagged.
   Approve when it's right.
4. **Preview form** fills the employer's Greenhouse or Lever form in a hidden browser and shows
   you a screenshot and any questions it couldn't answer. It never presses submit.
5. **Send it yourself** from the filled form, or, if you've allowed it for that site, let
   JobPilot submit after you type the company name to confirm.

Other application sites fall back to the prepared documents and a link to the posting.

## Privacy and security

- The server listens only on `127.0.0.1` and rejects requests from other websites (Host and
  Origin checks plus CSRF protection).
- Your profile, jobs, resume and documents live in `data/` (git-ignored). API keys live in `.env`
  or `data/credentials.json`, and the API never returns them.
- Tailoring sends your resume and the job description to Claude through **your own** Claude Code
  login. Nothing else leaves your machine except search queries to job boards and applications
  you approve.
- Job descriptions from the internet are sanitised before display, and are treated as untrusted
  data by every AI step.

See [SECURITY.md](SECURITY.md) to report a vulnerability, and
[AGENTS.md](AGENTS.md#security-principles) for the full design.

## Development

```bash
npm run dev        # API with reload on :7317 + Angular dev server on :4200
npm test           # server tests (browser tests use local fixture pages only)
npm run typecheck
```

Architecture, coding standards, SOLID guidelines and the guardrails for AI coding agents are in
[AGENTS.md](AGENTS.md). Contributions are welcome. Please read it first.

## License

[MIT](LICENSE)
