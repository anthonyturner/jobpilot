import fs from 'node:fs';
import path from 'node:path';
import type { Applicant, Automation } from '../../domain/applicant.js';
import { questionKey, type Application, type ApplicationStatus, type Packet, type ResumeSelection } from '../../domain/application.js';
import { conflict, forbidden, notFound } from '../../domain/errors.js';
import type { Job } from '../../domain/job.js';
import { resumeCorpus, type Resume } from '../../domain/resume.js';
import type { ApplicationRepository } from '../../persistence/application-repository.js';
import type { AuditRepository } from '../../persistence/audit-repository.js';
import type { JobRepository } from '../../persistence/job-repository.js';
import type { Logger } from '../aggregation-service.js';
import type { ApplicantStore } from '../applicant-store.js';
import type { PdfRenderer } from '../documents/pdf-renderer.js';
import { coverLetterText, renderCoverLetterHtml, renderResumeHtml } from '../documents/templates.js';
import { parseDocxResume } from '../resume/docx-resume-parser.js';
import { findUngroundedTerms } from '../tailoring/grounding.js';
import type { ResumeTailor } from '../tailoring/tailor.js';
import type { AutomationOutcome, FormAutomation } from './playwright-automation.js';

export interface ApplicationServiceDeps {
  jobs: JobRepository;
  applications: ApplicationRepository;
  audit: AuditRepository;
  store: ApplicantStore;
  tailor: ResumeTailor;
  pdf: PdfRenderer;
  automation: FormAutomation;
  dataDir: string;
  log: Logger;
}

export interface PacketEdit {
  summary?: string | undefined;
  skillOrder?: string[] | undefined;
  experience?: ResumeSelection['experience'] | undefined;
  projectIds?: string[] | undefined;
  coverLetter?: string[] | undefined;
}

const EDITABLE: ApplicationStatus[] = ['review', 'approved', 'previewed', 'needs_attention'];
const FILLABLE: ApplicationStatus[] = ['approved', 'previewed', 'needs_attention'];
const HOUR_MS = 3_600_000;

/** How a board is named in "how did you hear about us" dropdowns. */
const SOURCE_NAMES: Record<Job['primarySource'], string> = {
  indeed: 'Indeed',
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  arbeitnow: 'Arbeitnow',
  themuse: 'The Muse',
  adzuna: 'Adzuna',
  usajobs: 'USAJOBS',
  jsearch: 'Job board',
  greenhouse: 'Company website',
  lever: 'Company website',
};

/**
 * Owns the application lifecycle and every phase-2 guardrail (see AGENTS.md):
 * packets must be approved (and re-approved after any edit), automation obeys
 * the kill switch and per-ATS modes, automated submission needs a clean preview,
 * a typed company confirmation, the daily cap and the same-company gap, and is
 * attempted at most once.
 */
export class ApplicationService {
  private readonly busy = new Set<string>();

  constructor(private readonly deps: ApplicationServiceDeps) {}

  // ---- Resume ----------------------------------------------------------

  importResume(filePath: string): Resume {
    const resolved = path.resolve(filePath);
    if (!/\.docx$/i.test(resolved)) throw conflict('Choose a .docx file');
    if (!fs.existsSync(resolved)) throw notFound(`File not found: ${resolved}`);
    const resume = this.deps.store.saveResume(parseDocxResume(fs.readFileSync(resolved), resolved));
    this.seedApplicant(resume);
    this.deps.audit.record('user', 'resume.imported', null, path.basename(resolved));
    return resume;
  }

  /** Imports a .docx uploaded through the browser (setup wizard or Settings). */
  importResumeUpload(buffer: Uint8Array, fileName: string): Resume {
    const name = path.basename(fileName || 'resume.docx').replace(/[^\w .()-]/g, '').slice(0, 120) || 'resume.docx';
    const resume = this.deps.store.saveResume(parseDocxResume(buffer, `uploaded: ${name}`));
    this.seedApplicant(resume);
    this.deps.audit.record('user', 'resume.imported', null, `uploaded ${name}`);
    return resume;
  }

  /** Fills blank applicant fields from the resume header. Never overwrites what the owner typed. */
  private seedApplicant(resume: Resume): void {
    const current = this.deps.store.getApplicant();
    const [first, ...rest] = resume.name.split(/\s+/);
    const github = resumeCorpus(resume).match(/github\.com\/([a-z0-9-]+)/)?.[1];
    this.deps.store.saveApplicant({
      ...current,
      firstName: current.firstName || first || '',
      lastName: current.lastName || rest.join(' '),
      email: current.email || resume.contact.email,
      phone: current.phone || resume.contact.phone,
      location: current.location || resume.contact.location,
      // "City, ST" with a US state code means the United States.
      country: current.country || (/,\s*(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/.test(resume.contact.location) ? 'United States' : ''),
      github: current.github || (github ? `https://github.com/${github}` : ''),
    });
  }

  // ---- Lifecycle -------------------------------------------------------

  list(): Array<Application & { job: Job | null }> {
    return this.deps.applications.list().map((a) => ({ ...a, job: this.deps.jobs.get(a.jobId) ?? null }));
  }

  get(id: string): Application & { job: Job | null } {
    const app = this.deps.applications.get(id);
    if (!app) throw notFound('Application not found');
    return { ...app, job: this.deps.jobs.get(app.jobId) ?? null };
  }

  /** Starts (or returns the existing) application for a job. Tailoring runs in the background. */
  create(jobId: string): Application {
    const job = this.deps.jobs.get(jobId);
    if (!job) throw notFound('Job not found');
    const existing = this.deps.applications.activeForJob(jobId);
    if (existing) return existing;
    if (!this.deps.store.getResume()) throw conflict('Import your base resume in Settings first.');

    const app = this.deps.applications.create(jobId, job.applyUrl);
    if (job.status === 'new' || job.status === 'saved') {
      this.deps.jobs.update(jobId, { status: 'applying' });
      this.deps.audit.record('user', 'job.status', jobId, `${job.status} -> applying`);
    }
    this.deps.audit.record('user', 'application.created', jobId);
    void this.prepare(app.id);
    return app;
  }

  regenerate(id: string): Application {
    const app = this.require(id, EDITABLE, 'Only an unsent application can be regenerated.');
    this.deps.applications.update(app.id, { status: 'preparing', approvedAt: null, note: '' });
    void this.prepare(app.id);
    return this.deps.applications.get(id)!;
  }

  /** Any edit invalidates approval: the owner must approve exactly what will be sent. */
  async editPacket(id: string, edit: PacketEdit): Promise<Application> {
    const app = this.require(id, EDITABLE, 'This application can no longer be edited.');
    const resume = this.resume();
    const job = this.job(app.jobId);
    const packet = structuredClone(app.packet!);

    if (edit.summary !== undefined) packet.resume.summary = edit.summary.trim();
    if (edit.coverLetter !== undefined) packet.coverLetter.paragraphs = edit.coverLetter.map((p) => p.trim()).filter(Boolean);
    if (edit.skillOrder) packet.resume.skillOrder = edit.skillOrder.filter((c) => resume.skills.some((s) => s.category === c));
    if (edit.projectIds) packet.resume.projectIds = edit.projectIds.filter((pid) => resume.projects.some((p) => p.id === pid));
    if (edit.experience) {
      // Only ids that exist in the base resume survive; every role keeps at least one bullet.
      packet.resume.experience = resume.experience.map((role) => {
        const chosen = edit.experience!.find((e) => e.roleId === role.id)?.bulletIds.filter((b) => role.bullets.some((x) => x.id === b)) ?? [];
        return { roleId: role.id, bulletIds: chosen.length ? chosen : [role.bullets[0]!.id] };
      });
    }
    packet.ungrounded = findUngroundedTerms([packet.resume.summary, ...packet.coverLetter.paragraphs].join('\n'), resumeCorpus(resume), [job.company, job.title, job.location]);

    const files = await this.renderDocuments(app, resume, packet, job);
    this.deps.audit.record('user', 'application.edited', app.jobId);
    return this.deps.applications.update(id, { packet, files, status: 'review', approvedAt: null, report: null });
  }

  approve(id: string, acknowledgeFlags: boolean): Application {
    const app = this.require(id, ['review'], 'Only a packet waiting for review can be approved.');
    if (app.packet!.ungrounded.length > 0 && !acknowledgeFlags) {
      throw conflict('Check the flagged terms first, then approve with them acknowledged.');
    }
    this.deps.audit.record('user', 'application.approved', app.jobId, app.packet!.ungrounded.length ? `flags acknowledged: ${app.packet!.ungrounded.join(', ')}` : '');
    return this.deps.applications.update(id, { status: 'approved', approvedAt: new Date().toISOString() });
  }

  /** Answers the owner gave for open questions. Changing answers means the preview must be re-run. */
  setAnswers(id: string, answers: Record<string, string>, saveToBank: boolean): Application {
    const app = this.require(id, EDITABLE, 'This application can no longer be edited.');
    const merged = { ...app.answers };
    for (const [label, value] of Object.entries(answers)) {
      const key = questionKey(label);
      if (value.trim()) merged[key] = value.trim();
      else delete merged[key];
    }
    if (saveToBank) {
      const applicant = this.deps.store.getApplicant();
      const bank = [...applicant.answerBank];
      for (const [label, value] of Object.entries(answers)) {
        const question = label.replace(/\*/g, '').trim().slice(0, 200);
        if (!value.trim() || question.length < 3) continue;
        const index = bank.findIndex((b) => b.question.toLowerCase() === question.toLowerCase());
        if (index >= 0) bank[index] = { question, answer: value.trim() };
        else bank.push({ question, answer: value.trim() });
      }
      this.deps.store.saveApplicant({ ...applicant, answerBank: bank.slice(-100) });
    }
    const status: ApplicationStatus = app.status === 'previewed' ? 'approved' : app.status;
    return this.deps.applications.update(id, { answers: merged, status });
  }

  cancel(id: string): Application {
    const app = this.require(id, ['preparing', ...EDITABLE, 'failed'], 'A submitted application cannot be cancelled here.');
    const job = this.deps.jobs.get(app.jobId);
    if (job?.status === 'applying') {
      this.deps.jobs.update(app.jobId, { status: 'saved' });
      this.deps.audit.record('user', 'job.status', app.jobId, 'applying -> saved');
    }
    this.deps.audit.record('user', 'application.cancelled', app.jobId);
    return this.deps.applications.update(id, { status: 'cancelled' });
  }

  /** The owner pressed submit themselves (in the visible browser or on the employer's site). */
  markSubmitted(id: string): Application {
    const app = this.require(id, ['approved', 'previewed', 'needs_attention'], 'Approve the packet before marking it submitted.');
    this.markJobApplied(app.jobId, 'manual');
    return this.deps.applications.update(id, { status: 'submitted', mode: 'manual', submittedAt: new Date().toISOString(), note: 'Submitted by you.' });
  }

  // ---- Browser automation ---------------------------------------------

  /** Dry run: fills the form in a hidden browser and screenshots it. Never presses submit. */
  async preview(id: string): Promise<Application> {
    const app = this.require(id, FILLABLE, 'Approve the packet before previewing the form.');
    this.assertAutomationOn();
    const outcome = await this.runAutomation(app, { headed: false, submit: false });
    return this.recordOutcome(app, outcome, 'preview');
  }

  /** Opens a visible browser with the form filled in. The owner reviews and presses submit. */
  async openInBrowser(id: string): Promise<Application> {
    const app = this.require(id, FILLABLE, 'Approve the packet before opening the form.');
    this.assertAutomationOn();
    const outcome = await this.runAutomation(app, { headed: true, submit: false });
    const updated = this.recordOutcome(app, outcome, 'open');
    return this.deps.applications.update(updated.id, {
      note: outcome.blockers.length ? updated.note : 'The form is filled in the JobPilot browser window. Check it, press Submit there, then click "I submitted it".',
    });
  }

  /** Automated submission. Every guardrail is checked here, in order, before anything is clicked. */
  async submit(id: string, confirmCompany: string): Promise<Application> {
    const app = this.require(id, ['previewed'], 'Run a clean preview before submitting.');
    const automation = this.assertAutomationOn();
    const job = this.job(app.jobId);

    if (!app.ats) throw forbidden('JobPilot can only submit on Greenhouse or Lever forms.');
    if (automation.modes[app.ats] !== 'submit') throw forbidden(`Automatic submission is off for ${app.ats}. Turn it on in Settings, or submit it yourself.`);
    if (app.report?.blockers.length || app.report?.open.some((q) => q.required)) throw conflict('The preview still has open questions or blockers.');
    if (this.deps.applications.submitAttempted(id)) throw conflict('JobPilot already tried to submit this application and will not try again.');
    if (confirmCompany.trim().toLowerCase() !== job.company.trim().toLowerCase()) throw forbidden(`Type the company name exactly ("${job.company}") to confirm.`);

    const since = new Date(Date.now() - 24 * HOUR_MS).toISOString();
    if (this.deps.applications.countAutomatedSubmissionsSince(since) >= automation.dailySubmitCap) {
      throw forbidden(`Daily limit reached (${automation.dailySubmitCap} automatic submissions in 24 hours).`);
    }
    const last = this.deps.applications.lastSubmissionToCompany(job.company, id);
    if (last && Date.now() - new Date(last).getTime() < automation.sameCompanyGapHours * HOUR_MS) {
      throw forbidden(`You applied to ${job.company} recently. The minimum gap is ${automation.sameCompanyGapHours} hours.`);
    }

    this.deps.audit.record('user', 'application.submit-approved', app.jobId, `confirmed "${confirmCompany}"`);
    const outcome = await this.runAutomation(app, {
      headed: false,
      submit: true,
      beforeSubmit: () => {
        this.deps.applications.update(id, { submitAttemptedAt: new Date().toISOString(), mode: 'automated' });
      },
    });
    const updated = this.recordOutcome(app, outcome, 'submit');

    if (outcome.submitted && outcome.confirmed) {
      this.markJobApplied(app.jobId, 'automated');
      return this.deps.applications.update(id, { status: 'submitted', submittedAt: new Date().toISOString(), note: 'Submitted by JobPilot. Confirmation page captured.' });
    }
    if (outcome.submitted) {
      this.deps.audit.record('agent', 'application.submit-unconfirmed', app.jobId);
      return this.deps.applications.update(id, {
        status: 'needs_attention',
        note: "Submit was pressed but no confirmation appeared. Check your email or the employer's site. JobPilot will not retry.",
      });
    }
    return updated;
  }

  /** Kill switch and policy changes. Turning automation off closes every automated browser immediately. */
  async saveAutomation(automation: Automation): Promise<Automation> {
    const saved = this.deps.store.saveAutomation(automation);
    if (!saved.enabled) {
      await this.deps.automation.closeAll();
      this.deps.audit.record('user', 'automation.disabled', null, 'Kill switch engaged');
    } else {
      this.deps.audit.record('user', 'automation.updated', null, JSON.stringify(saved.modes));
    }
    return saved;
  }

  saveApplicant(applicant: Applicant): Applicant {
    const saved = this.deps.store.saveApplicant(applicant);
    this.deps.audit.record('user', 'applicant.updated');
    return saved;
  }

  /** Resolves a file belonging to an application; only names recorded on it are served. */
  filePath(id: string, name: string): string {
    const app = this.get(id);
    const allowed = [app.files.resume, app.files.coverLetter, ...app.files.screenshots].filter(Boolean);
    if (!allowed.includes(name) || name !== path.basename(name)) throw notFound('File not found');
    const full = path.join(this.dir(id), name);
    if (!fs.existsSync(full)) throw notFound('File not found');
    return full;
  }

  // ---- Internals -------------------------------------------------------

  private async prepare(id: string): Promise<void> {
    const app = this.deps.applications.get(id)!;
    try {
      const resume = this.resume();
      const job = this.job(app.jobId);
      const packet = await this.deps.tailor.tailor(resume, job);
      const files = await this.renderDocuments(app, resume, packet, job);
      this.deps.applications.update(id, { packet, files, status: 'review', note: '' });
      this.deps.audit.record('agent', 'application.prepared', app.jobId, packet.ungrounded.length ? `${packet.ungrounded.length} terms flagged` : 'no flags');
    } catch (error) {
      this.deps.log.warn(`Preparing application ${id} failed: ${(error as Error).message}`);
      this.deps.applications.update(id, { status: 'failed', note: (error as Error).message.slice(0, 400) });
    }
  }

  private async renderDocuments(app: Application, resume: Resume, packet: Packet, job: Job): Promise<Application['files']> {
    const dir = this.dir(app.id);
    fs.mkdirSync(dir, { recursive: true });
    const applicant = this.deps.store.getApplicant();
    const company = job.company.replace(/[^A-Za-z0-9]+/g, '').slice(0, 40) || 'Company';
    const person = resume.name.replace(/[^A-Za-z0-9]+/g, '_');
    const resumeName = `${person}_Resume_${company}.pdf`;
    const letterName = `Cover_Letter_${company}.pdf`;
    await this.deps.pdf.render(renderResumeHtml(resume, packet.resume, applicant), path.join(dir, resumeName));
    await this.deps.pdf.render(renderCoverLetterHtml(resume, applicant, packet.coverLetter, job.company), path.join(dir, letterName));
    return { resume: resumeName, coverLetter: letterName, screenshots: app.files.screenshots };
  }

  private async runAutomation(
    app: Application,
    options: { headed: boolean; submit: boolean; beforeSubmit?: () => void },
  ): Promise<AutomationOutcome> {
    if (this.busy.has(app.id)) throw conflict('JobPilot is already working on this application.');
    this.busy.add(app.id);
    try {
      const resume = this.resume();
      const job = this.job(app.jobId);
      const automation = this.deps.store.getAutomation();
      const dir = this.dir(app.id);
      return await this.deps.automation.run({
        applicationId: app.id,
        applyUrl: app.applyUrl,
        headed: options.headed,
        submit: options.submit,
        ctx: {
          applicant: this.deps.store.getApplicant(),
          answers: app.answers,
          coverLetterText: coverLetterText(resume, app.packet!.coverLetter, job.company),
          hasCoverLetterFile: !!app.files.coverLetter,
          sourceName: SOURCE_NAMES[job.primarySource],
        },
        files: {
          resume: path.join(dir, app.files.resume!),
          coverLetter: app.files.coverLetter ? path.join(dir, app.files.coverLetter) : null,
        },
        outDir: dir,
        // Re-read at decision time so a kill switch flipped mid-run is honoured.
        allowAts: (ats) => this.deps.store.getAutomation().enabled && automation.modes[ats] !== 'off',
        ...(options.beforeSubmit ? { beforeSubmit: options.beforeSubmit } : {}),
      });
    } finally {
      this.busy.delete(app.id);
    }
  }

  private recordOutcome(app: Application, outcome: AutomationOutcome, kind: string): Application {
    const report = { url: outcome.url, ats: outcome.ats, filled: outcome.filled, open: outcome.open, blockers: outcome.blockers, screenshot: outcome.screenshot, at: new Date().toISOString() };
    const clean = outcome.blockers.length === 0 && !outcome.open.some((q) => q.required);
    this.deps.audit.record('agent', `application.${kind}`, app.jobId, clean ? `filled ${outcome.filled.length} fields` : [...outcome.blockers, ...outcome.open.filter((q) => q.required).map((q) => `needs: ${q.label}`)].join('; ').slice(0, 1000));
    return this.deps.applications.update(app.id, {
      ats: outcome.ats,
      report,
      status: clean ? 'previewed' : 'needs_attention',
      note: clean ? '' : outcome.blockers[0] ?? 'Some required questions need your answer.',
      files: { ...app.files, screenshots: outcome.screenshot ? [...app.files.screenshots, outcome.screenshot].slice(-20) : app.files.screenshots },
    });
  }

  private markJobApplied(jobId: string, how: 'manual' | 'automated'): void {
    const job = this.deps.jobs.get(jobId);
    if (job && job.status !== 'applied') {
      this.deps.jobs.update(jobId, { status: 'applied' });
      this.deps.audit.record(how === 'manual' ? 'user' : 'agent', 'job.status', jobId, `${job.status} -> applied`);
    }
    this.deps.audit.record(how === 'manual' ? 'user' : 'agent', 'application.submitted', jobId, how);
  }

  private assertAutomationOn(): Automation {
    const automation = this.deps.store.getAutomation();
    if (!automation.enabled) throw forbidden('Automation is switched off (kill switch). Turn it on in Settings.');
    return automation;
  }

  private require(id: string, allowed: ApplicationStatus[], message: string): Application {
    const app = this.deps.applications.get(id);
    if (!app) throw notFound('Application not found');
    if (!allowed.includes(app.status)) throw conflict(message);
    if (allowed.some((s) => s !== 'preparing' && s !== 'failed') && app.status !== 'preparing' && app.status !== 'failed' && !app.packet) {
      throw conflict('The packet is not ready yet.');
    }
    return app;
  }

  private resume(): Resume {
    const resume = this.deps.store.getResume();
    if (!resume) throw conflict('Import your base resume in Settings first.');
    return resume;
  }

  private job(id: string): Job {
    const job = this.deps.jobs.get(id);
    if (!job) throw notFound('Job not found');
    return job;
  }

  private dir(id: string): string {
    return path.join(this.deps.dataDir, 'applications', id);
  }
}
