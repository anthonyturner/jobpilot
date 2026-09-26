import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { AutomationSchema, DEFAULT_AUTOMATION, type Automation } from '../src/domain/applicant.js';
import type { Packet } from '../src/domain/application.js';
import type { Job, ScoreBreakdown } from '../src/domain/job.js';
import { buildApp } from '../src/http/app.js';
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
import { SchedulerService } from '../src/services/scheduler-service.js';
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
  let gate: Promise<void> | null;

  const addJob = (company: string, total: number, options: { title?: string; limitedData?: boolean } = {}): string => {
    const job = normalizeJob(rawJob({ company, title: options.title ?? 'Senior Angular Engineer', sourceJobId: `${company}-${options.title ?? ''}` }))!;
    return jobs.upsert(job, score(total, options.limitedData)).id;
  };

  const configure = (autoPrepareSettings: Partial<Automation['autoPrepare']>, rest: Partial<Automation> = {}): void => {
    store.saveAutomation({ ...store.getAutomation(), ...rest, autoPrepare: { ...store.getAutomation().autoPrepare, ...autoPrepareSettings } });
  };

  const audit = (): AuditRow[] => db.prepare('SELECT actor, action, job_id, detail FROM audit_log ORDER BY id').all() as unknown as AuditRow[];

  /** Simulates a row last touched some minutes ago, e.g. by a process that was killed mid-draft. */
  const backdate = (applicationId: string, minutes: number): void => {
    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(new Date(Date.now() - minutes * 60_000).toISOString(), applicationId);
  };

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
    gate = null;
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
          await gate;
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

  it('skips a company that still has an application being prepared or waiting for review from an earlier run', async () => {
    configure({ enabled: true, topN: 5 });
    const reviewing = service.create(addJob('Globex', 60, { title: 'Angular Developer' }));
    await service.whenPrepared(reviewing.id);
    applications.create(addJob('Initech', 60, { title: 'Angular Developer' }), 'https://example.com/apply');
    const cancelled = service.create(addJob('Hooli', 60, { title: 'Angular Developer' }));
    await service.whenPrepared(cancelled.id);
    service.cancel(cancelled.id);
    const globex = addJob('Globex', 95);
    const initech = addJob(' initech ', 90);
    const hooli = addJob('Hooli', 85);

    const result = await autoPrepare.run();

    assert.deepEqual(result.prepared.map((p) => p.jobId), [hooli]);
    for (const jobId of [globex, initech]) {
      assert.ok(result.skipped.some((s) => s.jobId === jobId && /already has an application/.test(s.reason)), `skipped ${jobId}`);
    }
  });

  it('moves an application stuck in preparing for over 30 minutes to failed before counting the queue', async () => {
    configure({ enabled: true, topN: 1 });
    const stuckJob = addJob('Globex', 70, { title: 'Angular Developer' });
    const stuck = applications.create(stuckJob, 'https://example.com/apply');
    backdate(stuck.id, 31);
    const fresh = addJob('Initech', 90);

    const result = await autoPrepare.run();

    assert.equal(result.outcome, 'finished');
    assert.deepEqual(result.prepared.map((p) => p.jobId), [fresh]);
    const recovered = applications.get(stuck.id)!;
    assert.equal(recovered.status, 'failed');
    assert.match(recovered.note, /interrupted/);
    assert.equal(recovered.approvedAt, null);
    const entry = audit().find((r) => r.action === 'autoprepare.recovered')!;
    assert.equal(entry.actor, 'scheduler');
    assert.equal(entry.job_id, stuckJob);
    assert.equal(automation.calls.length, 0);
  });

  it('leaves a recent preparing application and every other status exactly as it was', async () => {
    configure({ enabled: true, topN: 1 });
    const recent = applications.create(addJob('Globex', 60), 'https://example.com/apply');
    backdate(recent.id, 29);
    const others = (['review', 'approved', 'previewed', 'needs_attention', 'cancelled', 'submitted', 'failed'] as const).map((status) => {
      const app = applications.create(addJob(`Company ${status}`, 60), 'https://example.com/apply');
      applications.update(app.id, { status });
      backdate(app.id, 120);
      return { id: app.id, status };
    });
    addJob('Initech', 90);

    const result = await autoPrepare.run();

    assert.equal(result.outcome, 'queue-full');
    assert.equal(applications.get(recent.id)!.status, 'preparing');
    for (const { id, status } of others) assert.equal(applications.get(id)!.status, status);
    assert.ok(!audit().some((r) => r.action === 'autoprepare.recovered'));
  });

  it('recovers nothing while the run is not allowed to go ahead', async () => {
    const stuck = applications.create(addJob('Globex', 70), 'https://example.com/apply');
    backdate(stuck.id, 60);

    assert.equal((await autoPrepare.run()).outcome, 'disabled');
    configure({ enabled: true }, { enabled: false });
    assert.equal((await autoPrepare.run()).outcome, 'stopped');
    configure({}, { enabled: true });
    setupDone = false;
    assert.equal((await autoPrepare.run()).outcome, 'blocked');

    assert.equal(applications.get(stuck.id)!.status, 'preparing');
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

  it('a manual run ignores the unattended switch and records every step under the owner', async () => {
    configure({ enabled: false, topN: 1 });
    const jobId = addJob('Globex', 90);

    const result = await autoPrepare.run({ trigger: 'manual' });

    assert.equal(result.outcome, 'finished');
    assert.deepEqual(result.prepared.map((p) => p.jobId), [jobId]);
    const rows = audit().filter((r) => r.action.startsWith('autoprepare.') || r.action === 'application.created');
    assert.ok(rows.length >= 3);
    assert.ok(rows.every((r) => r.actor === 'user'), JSON.stringify(rows));
    assert.equal(rows.find((r) => r.action === 'autoprepare.started')!.detail, 'manual');
    assert.equal(applications.get(result.prepared[0]!.applicationId)!.approvedAt, null);
    assert.equal(jobs.get(jobId)!.status, 'new');
  });

  it('an unattended run records its trigger and still respects the feature switch', async () => {
    addJob('Globex', 90);
    assert.equal((await autoPrepare.run()).outcome, 'disabled');
    const started = audit().find((r) => r.action === 'autoprepare.started')!;
    assert.deepEqual([started.actor, started.detail], ['scheduler', 'unattended']);
  });

  it('refuses to start a manual run while the kill switch is off or setup is unfinished', () => {
    addJob('Globex', 90);
    configure({}, { enabled: false });
    assert.throws(() => autoPrepare.start('manual'), /kill switch/);
    configure({}, { enabled: true });
    setupDone = false;
    assert.throws(() => autoPrepare.start('manual'), /setup wizard/);
    assert.equal(applications.list().length, 0);
    assert.equal(autoPrepare.status().running, false);
  });

  it('a manual run re-checks the kill switch before each job', async () => {
    configure({ topN: 3 });
    addJob('Globex', 95);
    addJob('Initech', 90);
    onTailor = () => configure({}, { enabled: false });

    const result = await autoPrepare.start('manual').done;
    assert.equal(result.outcome, 'stopped');
    assert.deepEqual(tailored, ['Globex']);
  });

  it('runs one manual pass at a time and reports progress while it works', async () => {
    configure({ topN: 2 });
    const first = addJob('Globex', 95);
    addJob('Initech', 90);
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));

    const started = autoPrepare.start('manual');
    assert.equal(started.alreadyRunning, false);
    const again = autoPrepare.start('manual');
    assert.equal(again.alreadyRunning, true);
    const live = autoPrepare.status();
    assert.equal(live.running, true);
    assert.equal(live.trigger, 'manual');
    assert.equal(live.finishedAt, null);
    assert.deepEqual(live.result!.started.map((s) => s.jobId), [first]);

    release();
    await started.done;
    const done = autoPrepare.status();
    assert.equal(done.running, false);
    assert.ok(done.finishedAt);
    assert.equal(done.result!.outcome, 'finished');
    assert.equal(done.result!.prepared.length, 2);
    assert.ok(applications.list().every((a) => a.status === 'review' && a.approvedAt === null));
    assert.equal(automation.calls.length, 0);
    const next = autoPrepare.start('manual');
    assert.equal(next.alreadyRunning, false, 'a new run may start once the last one finished');
    assert.equal((await next.done).outcome, 'queue-full', 'topN still means "top the queue up to N"');
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

describe('Prepare top matches over HTTP', () => {
  const HOST = { host: '127.0.0.1:7317' };
  const WEB = { ...HOST, 'x-jobpilot-client': 'web' };
  const URL = '/api/auto-prepare';
  let app: FastifyInstance;
  let db: DatabaseSync;
  let store: ApplicantStore;
  let applications: ApplicationRepository;
  let autoPrepare: AutoPrepareService;
  let automation: RecordingAutomation;
  let setupDone: boolean;
  let release: () => void;

  beforeEach(async () => {
    db = openInMemoryDatabase();
    const settings = new SettingsRepository(db);
    const jobs = new JobRepository(db);
    const runs = new RunRepository(db);
    const audit = new AuditRepository(db);
    const profiles = new ProfileStore(settings);
    applications = new ApplicationRepository(db);
    store = new ApplicantStore(settings);
    store.saveResume(parseDocxResume(SAMPLE));
    for (const [company, total] of [['Globex', 95], ['Initech', 90]] as const) {
      const job = normalizeJob(rawJob({ company, sourceJobId: company }))!;
      jobs.upsert(job, score(total));
    }
    automation = new RecordingAutomation();
    setupDone = true;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const log = { info() {}, warn() {}, error() {} };
    const service = new ApplicationService({
      jobs,
      applications,
      audit,
      store,
      tailor: {
        tailor: async () => {
          await gate;
          return packet();
        },
      },
      pdf: { render: async (_html, out) => fs.writeFileSync(out, '%PDF-fake') },
      automation,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-test-')),
      log,
    });
    autoPrepare = new AutoPrepareService({ jobs, applications, applying: service, store, audit, log, blocked: () => (setupDone ? null : 'Finish the setup wizard before preparing applications.') });
    const registry = new SourceRegistry([]);
    const aggregation = new AggregationService({ registry, jobs, runs, audit, profiles, scorer: new KeywordJobScorer(), http: { getJson: () => Promise.reject(new Error('offline')) }, log });
    app = await buildApp(
      { port: 7317, ingestToken: 'x'.repeat(64), logLevel: 'silent', webDistDir: null },
      { jobs, runs, audit, profiles, registry, aggregation, scheduler: new SchedulerService('UTC', () => {}), applications: service, applicantStore: store, autoPrepare },
    );
  });

  afterEach(async () => {
    release();
    await app.close();
  });

  it('refuses the request from a foreign host, a foreign origin or without the client header', async () => {
    const foreignHost = await app.inject({ method: 'POST', url: URL, headers: { ...WEB, host: 'evil.example:7317' }, payload: {} });
    assert.equal(foreignHost.statusCode, 421);
    const foreignOrigin = await app.inject({ method: 'POST', url: URL, headers: { ...WEB, origin: 'https://evil.example' }, payload: {} });
    assert.equal(foreignOrigin.statusCode, 403);
    const noHeader = await app.inject({ method: 'POST', url: URL, headers: HOST, payload: {} });
    assert.equal(noHeader.statusCode, 403);
    const statusFromElsewhere = await app.inject({ method: 'GET', url: URL, headers: { ...HOST, origin: 'https://evil.example' } });
    assert.equal(statusFromElsewhere.statusCode, 403);
    assert.equal(applications.list().length, 0);
    assert.equal(autoPrepare.status().running, false);
  });

  it('rejects a body with options it does not take', async () => {
    const res = await app.inject({ method: 'POST', url: URL, headers: WEB, payload: { topN: 10 } });
    assert.equal(res.statusCode, 400);
    assert.equal(applications.list().length, 0);
  });

  it('explains why it cannot start while the kill switch is off or setup is unfinished', async () => {
    store.saveAutomation({ ...store.getAutomation(), enabled: false });
    const killed = await app.inject({ method: 'POST', url: URL, headers: WEB, payload: {} });
    assert.equal(killed.statusCode, 409);
    assert.match(killed.json().error, /kill switch/);

    store.saveAutomation({ ...store.getAutomation(), enabled: true });
    setupDone = false;
    const unfinished = await app.inject({ method: 'POST', url: URL, headers: WEB, payload: {} });
    assert.equal(unfinished.statusCode, 409);
    assert.match(unfinished.json().error, /setup wizard/);
    assert.equal(applications.list().length, 0);
  });

  it('answers straight away, refuses a second run while one is going, and stops every draft at review', async () => {
    const first = await app.inject({ method: 'POST', url: URL, headers: WEB });
    assert.equal(first.statusCode, 202);
    assert.deepEqual(first.json(), { alreadyRunning: false });
    const second = await app.inject({ method: 'POST', url: URL, headers: WEB, payload: {} });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), { alreadyRunning: true });

    const live = (await app.inject({ method: 'GET', url: URL, headers: HOST })).json();
    assert.equal(live.running, true);
    assert.equal(live.result.started.length, 1);
    assert.equal(applications.list()[0]!.status, 'preparing');

    release();
    await autoPrepare.start('manual').done;
    const done = (await app.inject({ method: 'GET', url: URL, headers: HOST })).json();
    assert.equal(done.running, false);
    assert.equal(done.result.outcome, 'finished');
    assert.equal(done.result.prepared.length, 2);
    assert.ok(applications.list().every((a) => a.status === 'review' && a.approvedAt === null));
    assert.equal(automation.calls.length, 0);
    const actors = db.prepare(`SELECT DISTINCT actor FROM audit_log WHERE action LIKE 'autoprepare.%'`).all() as Array<{ actor: string }>;
    assert.deepEqual(actors.map((r) => r.actor), ['user']);
  });
});
