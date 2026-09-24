import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, it } from 'node:test';
import { AutomationSchema, DEFAULT_AUTOMATION, type Automation } from '../src/domain/applicant.js';
import type { Packet } from '../src/domain/application.js';
import type { Job, ScoreBreakdown } from '../src/domain/job.js';
import { ApplicationRepository } from '../src/persistence/application-repository.js';
import { AuditRepository } from '../src/persistence/audit-repository.js';
import { openInMemoryDatabase } from '../src/persistence/database.js';
import { JobRepository } from '../src/persistence/job-repository.js';
import { RunRepository } from '../src/persistence/run-repository.js';
import { SettingsRepository } from '../src/persistence/settings-repository.js';
import { AggregationService } from '../src/services/aggregation-service.js';
import { ApplicantStore } from '../src/services/applicant-store.js';
import { ApplicationService } from '../src/services/apply/application-service.js';
import { AutoPrepareService } from '../src/services/apply/auto-prepare-service.js';
import type { AutomationOutcome, AutomationRequest, FormAutomation } from '../src/services/apply/playwright-automation.js';
import { normalizeJob } from '../src/services/normalize.js';
import { ProfileStore } from '../src/services/profile-store.js';
import { parseDocxResume } from '../src/services/resume/docx-resume-parser.js';
import { KeywordJobScorer } from '../src/services/scoring/keyword-scorer.js';
import { SourceRegistry } from '../src/sources/source-registry.js';
import { rawJob } from './helpers.js';
import { SAMPLE } from './resume-tailoring.test.js';

/** Records every request so a test can prove the run never touched a form. */
class RecordingAutomation implements FormAutomation {
  calls: AutomationRequest[] = [];
  async run(request: AutomationRequest): Promise<AutomationOutcome> {
    this.calls.push(request);
    return { ats: 'greenhouse', url: request.applyUrl, filled: [], open: [], blockers: [], screenshot: null, submitted: false, confirmed: false };
  }
  async closeAll() {}
}

const packet = (): Packet => ({
  resume: { summary: 'Engineer with 8 years in C# and Angular.', skillOrder: [], experience: [], projectIds: [] },
  coverLetter: { paragraphs: ['Paragraph one about Angular.', 'Paragraph two about C#.'] },
  fitNotes: [],
  concerns: [],
  ungrounded: [],
});

const score = (total: number, limitedData = false): ScoreBreakdown => ({
  total,
  skills: { points: 40, max: 50, matched: [], missing: [], limitedData },
  title: { points: 20, max: 25, matchedTerm: null },
  location: { points: 10, max: 15, reason: '' },
  recency: { points: 5, max: 10 },
  penalties: { points: 0, reasons: [] },
});

interface AuditRow {
  actor: string;
  action: string;
  job_id: string | null;
  detail: string;
}

describe('AutoPrepareService', () => {
  let db: DatabaseSync;
  let jobs: JobRepository;
  let applications: ApplicationRepository;
  let store: ApplicantStore;
  let service: ApplicationService;
  let automation: RecordingAutomation;
  let autoPrepare: AutoPrepareService;
  let setupDone: boolean;
  let failFor: Set<string>;
  let onTailor: (job: Job) => void;
  let tailored: string[];

  const addJob = (company: string, total: number, options: { title?: string; limitedData?: boolean } = {}): string => {
    const job = normalizeJob(rawJob({ company, title: options.title ?? 'Senior Angular Engineer', sourceJobId: `${company}-${options.title ?? ''}` }))!;
    return jobs.upsert(job, score(total, options.limitedData)).id;
  };

  const configure = (autoPrepareSettings: Partial<Automation['autoPrepare']>, rest: Partial<Automation> = {}): void => {
    store.saveAutomation({ ...store.getAutomation(), ...rest, autoPrepare: { ...store.getAutomation().autoPrepare, ...autoPrepareSettings } });
  };

  const audit = (): AuditRow[] => db.prepare('SELECT actor, action, job_id, detail FROM audit_log ORDER BY id').all() as unknown as AuditRow[];

  beforeEach(() => {
    db = openInMemoryDatabase();
    jobs = new JobRepository(db);
    applications = new ApplicationRepository(db);
    store = new ApplicantStore(new SettingsRepository(db));
    store.saveResume(parseDocxResume(SAMPLE));
    automation = new RecordingAutomation();
    setupDone = true;
    failFor = new Set();
    onTailor = () => {};
    tailored = [];
    const log = { info() {}, warn() {}, error() {} };
    service = new ApplicationService({
      jobs,
      applications,
      audit: new AuditRepository(db),
      store,
      tailor: {
        tailor: async (_resume, job) => {
          tailored.push(job.company);
          onTailor(job);
          if (failFor.has(job.company)) throw new Error('Claude is not logged in');
          return packet();
        },
      },
      pdf: { render: async (_html, out) => fs.writeFileSync(out, '%PDF-fake') },
      automation,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-test-')),
      log,
    });
    autoPrepare = new AutoPrepareService({
      jobs,
      applications,
      applying: service,
      store,
      audit: new AuditRepository(db),
      log,
      blocked: () => (setupDone ? null : 'Finish the setup wizard before sweeping job boards.'),
    });
  });

  it('is off by default and creates nothing until the owner turns it on', async () => {
    addJob('Globex', 90);
    const result = await autoPrepare.run();
    assert.equal(result.outcome, 'disabled');
    assert.equal(applications.list().length, 0);
  });

  it('prepares the top N matches and leaves each one in review, unapproved and untouched by a browser', async () => {
    configure({ enabled: true, topN: 2, minScore: 75 });
    const best = addJob('Globex', 95);
    const second = addJob('Initech', 85);
    addJob('Umbrella', 80);
    addJob('Hooli', 60);

    const result = await autoPrepare.run();

    assert.equal(result.outcome, 'finished');
    assert.deepEqual(result.prepared.map((p) => p.jobId), [best, second]);
    const created = applications.list();
    assert.equal(created.length, 2);
    for (const app of created) {
      assert.equal(app.status, 'review');
      assert.equal(app.approvedAt, null);
      assert.equal(app.submittedAt, null);
      assert.equal(applications.submitAttempted(app.id), false);
      assert.ok(app.files.resume && app.files.coverLetter, 'both PDFs rendered');
    }
    assert.equal(automation.calls.length, 0, 'no form was opened');
  });

  it('leaves the job status alone until the owner approves, then moves it to applying', async () => {
    configure({ enabled: true, topN: 1 });
    const jobId = addJob('Globex', 90);
    const [prepared] = (await autoPrepare.run()).prepared;
    assert.equal(jobs.get(jobId)!.status, 'new');

    service.approve(prepared!.applicationId, false);
    assert.equal(jobs.get(jobId)!.status, 'applying');
  });

  it('records every step under a non-user actor', async () => {
    configure({ enabled: true, topN: 1 });
    const jobId = addJob('Globex', 90);
    addJob('Globex', 88, { title: 'Staff Angular Engineer' });
    await autoPrepare.run();

    const rows = audit();
    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes('application.created'));
    assert.ok(actions.includes('application.prepared'));
    assert.ok(actions.includes('autoprepare.finished'));
    assert.ok(rows.every((r) => r.actor !== 'user'), `unexpected user entries: ${JSON.stringify(rows.filter((r) => r.actor === 'user'))}`);
    assert.equal(rows.find((r) => r.action === 'application.created')!.job_id, jobId);
  });

  it('records the owner turning unattended preparation on in the audit log', async () => {
    const current = store.getAutomation();
    await service.saveAutomation({ ...current, autoPrepare: { ...current.autoPrepare, enabled: true } });
    const entry = audit().find((r) => r.action === 'automation.updated')!;
    assert.equal(entry.actor, 'user');
    assert.match(entry.detail, /"autoPrepare":\{"enabled":true/);
  });

  it('tops the review queue up to N instead of adding N every run', async () => {
    configure({ enabled: true, topN: 3 });
    const manual = addJob('Globex', 70);
    service.create(manual);
    await service.whenPrepared(applications.list()[0]!.id);
    addJob('Initech', 90);
    addJob('Umbrella', 85);
    addJob('Hooli', 80);

    const first = await autoPrepare.run();
    assert.equal(first.prepared.length, 2);

    const second = await autoPrepare.run();
    assert.equal(second.outcome, 'queue-full');
    assert.equal(second.prepared.length, 0);
    assert.equal(applications.list().length, 3);
  });

  it('never selects a job that had any earlier application, including cancelled and failed ones', async () => {
    configure({ enabled: true, topN: 3 });
    const cancelled = addJob('Globex', 95);
    const failed = addJob('Initech', 93);
    const fresh = addJob('Umbrella', 80);

    const first = service.create(cancelled);
    await service.whenPrepared(first.id);
    service.cancel(first.id);
    failFor.add('Initech');
    const second = service.create(failed);
    assert.equal((await service.whenPrepared(second.id)).status, 'failed');
    failFor.clear();

    const result = await autoPrepare.run();
    assert.deepEqual(result.prepared.map((p) => p.jobId), [fresh]);
  });

  it('prepares at most one job per company per run', async () => {
    configure({ enabled: true, topN: 3 });
    const top = addJob('Globex', 95);
    const sibling = addJob('Globex', 90, { title: 'Staff Angular Engineer' });
    const other = addJob('Initech', 80);

    const result = await autoPrepare.run();
    assert.deepEqual(result.prepared.map((p) => p.jobId), [top, other]);
    assert.ok(result.skipped.some((s) => s.jobId === sibling && /this run/.test(s.reason)));
    assert.ok(audit().some((r) => r.action === 'autoprepare.skipped' && r.job_id === sibling));
  });

  it('skips a company inside the same-company gap', async () => {
    configure({ enabled: true, topN: 3 }, { sameCompanyGapHours: 72 });
    const earlier = addJob('Globex', 60, { title: 'Angular Developer' });
    const app = service.create(earlier);
    await service.whenPrepared(app.id);
    service.approve(app.id, false);
    service.markSubmitted(app.id);
    const blockedJob = addJob('Globex', 95);
    const other = addJob('Initech', 80);

    const result = await autoPrepare.run();
    assert.deepEqual(result.prepared.map((p) => p.jobId), [other]);
    assert.ok(result.skipped.some((s) => s.jobId === blockedJob && /72 hours/.test(s.reason)));
  });

  it('skips listings without a usable description and those under the threshold', async () => {
    configure({ enabled: true, topN: 3, minScore: 75 });
    const limited = addJob('Globex', 95, { limitedData: true });
    addJob('Initech', 74);
    const good = addJob('Umbrella', 75);

    const result = await autoPrepare.run();
    assert.deepEqual(result.prepared.map((p) => p.jobId), [good]);
    assert.ok(result.skipped.some((s) => s.jobId === limited && /description/.test(s.reason)));
  });

  it('creates nothing while first-run setup is unfinished', async () => {
    configure({ enabled: true, topN: 3 });
    addJob('Globex', 95);
    setupDone = false;
    const result = await autoPrepare.run();
    assert.equal(result.outcome, 'blocked');
    assert.equal(applications.list().length, 0);
    assert.deepEqual(tailored, []);
  });

  it('does nothing while the automation kill switch is off', async () => {
    configure({ enabled: true, topN: 3 }, { enabled: false });
    addJob('Globex', 95);
    const result = await autoPrepare.run();
    assert.equal(result.outcome, 'stopped');
    assert.equal(applications.list().length, 0);
  });

  it('re-checks the kill switch before each job and stops before the next one', async () => {
    configure({ enabled: true, topN: 3 });
    addJob('Globex', 95);
    addJob('Initech', 90);
    addJob('Umbrella', 85);
    onTailor = () => configure({}, { enabled: false });

    const result = await autoPrepare.run();
    assert.equal(result.outcome, 'stopped');
    assert.deepEqual(tailored, ['Globex']);
    assert.equal(applications.list().length, 1);
  });

  it('stops before the next job when unattended preparation is turned off mid-run', async () => {
    configure({ enabled: true, topN: 3 });
    addJob('Globex', 95);
    addJob('Initech', 90);
    onTailor = () => configure({ enabled: false });

    const result = await autoPrepare.run();
    assert.equal(result.outcome, 'stopped');
    assert.deepEqual(tailored, ['Globex']);
  });

  it('counts failed tailoring towards N and reports it', async () => {
    configure({ enabled: true, topN: 2 });
    addJob('Globex', 95);
    addJob('Initech', 90);
    addJob('Umbrella', 85);
    failFor = new Set(['Globex', 'Initech', 'Umbrella']);

    const result = await autoPrepare.run();
    assert.equal(result.prepared.length, 0);
    assert.equal(result.failed.length, 2);
    assert.match(result.failed[0]!.error, /not logged in/);
    assert.deepEqual(tailored, ['Globex', 'Initech']);
    assert.ok(applications.list().every((a) => a.status === 'failed' && a.approvedAt === null));
    assert.ok(audit().some((r) => r.action === 'application.failed'));
  });

  it('refuses every form and submit action on an application the owner never approved', async () => {
    configure({ enabled: true, topN: 1 });
    addJob('Globex', 95);
    const [prepared] = (await autoPrepare.run()).prepared;
    const id = prepared!.applicationId;

    await assert.rejects(service.preview(id), /Approve the packet/);
    await assert.rejects(service.openInBrowser(id), /Approve the packet/);
    await assert.rejects(service.submit(id, 'Globex'), /clean preview/);
    assert.throws(() => service.markSubmitted(id), /Approve the packet/);
    assert.equal(automation.calls.length, 0);
  });
});

describe('Unattended preparation settings', () => {
  it('defaults to off, three jobs and a score of 75', () => {
    assert.deepEqual(DEFAULT_AUTOMATION.autoPrepare, { enabled: false, topN: 3, minScore: 75 });
  });

  it('fills the defaults into automation settings saved before the feature existed', () => {
    const stored = { enabled: true, modes: { greenhouse: 'preview', lever: 'preview' }, dailySubmitCap: 10, sameCompanyGapHours: 72 };
    assert.deepEqual(AutomationSchema.parse(stored).autoPrepare, { enabled: false, topN: 3, minScore: 75 });
  });

  it('rejects out-of-range values', () => {
    const withPrepare = (autoPrepare: Record<string, unknown>) => AutomationSchema.safeParse({ autoPrepare: { enabled: true, topN: 3, minScore: 75, ...autoPrepare } }).success;
    assert.equal(withPrepare({ topN: 10 }), true);
    assert.equal(withPrepare({ topN: 11 }), false);
    assert.equal(withPrepare({ topN: 0 }), false);
    assert.equal(withPrepare({ topN: 2.5 }), false);
    assert.equal(withPrepare({ minScore: 101 }), false);
    assert.equal(withPrepare({ minScore: -1 }), false);
  });
});

describe('Unattended sweep trigger', () => {
  it('records the sweep under its own trigger and a non-user actor', async () => {
    const db = openInMemoryDatabase();
    const settings = new SettingsRepository(db);
    const runs = new RunRepository(db);
    const aggregation = new AggregationService({
      registry: new SourceRegistry([]),
      jobs: new JobRepository(db),
      runs,
      audit: new AuditRepository(db),
      profiles: new ProfileStore(settings),
      scorer: new KeywordJobScorer(),
      http: { getJson: () => Promise.reject(new Error('offline')) },
      log: { info() {}, warn() {}, error() {} },
    });
    const record = await aggregation.startRun('unattended').done;
    assert.equal(record.trigger, 'unattended');
    const finished = db.prepare(`SELECT actor FROM audit_log WHERE action = 'run.finished'`).get() as { actor: string };
    assert.equal(finished.actor, 'scheduler');
  });

  it('finds a sweep another process is still running', () => {
    const runs = new RunRepository(openInMemoryDatabase());
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    assert.equal(runs.runningSince(hourAgo), undefined);
    runs.start('schedule', new Date(Date.now() - 2 * 3_600_000).toISOString());
    assert.equal(runs.runningSince(hourAgo), undefined, 'a stale row from a crash does not count');
    const id = runs.start('schedule');
    assert.equal(runs.runningSince(hourAgo)?.id, id);
    runs.finish(id, 'succeeded', {});
    assert.equal(runs.runningSince(hourAgo), undefined);
  });
});
