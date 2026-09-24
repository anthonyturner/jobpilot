import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import type { Packet } from '../src/domain/application.js';
import { AuditRepository } from '../src/persistence/audit-repository.js';
import { ApplicationRepository } from '../src/persistence/application-repository.js';
import { openInMemoryDatabase } from '../src/persistence/database.js';
import { JobRepository } from '../src/persistence/job-repository.js';
import { SettingsRepository } from '../src/persistence/settings-repository.js';
import { ApplicantStore } from '../src/services/applicant-store.js';
import { ApplicationService } from '../src/services/apply/application-service.js';
import type { AutomationOutcome, AutomationRequest, FormAutomation } from '../src/services/apply/playwright-automation.js';
import { normalizeJob } from '../src/services/normalize.js';
import { KeywordJobScorer } from '../src/services/scoring/keyword-scorer.js';
import { parseDocxResume } from '../src/services/resume/docx-resume-parser.js';
import { profile, rawJob } from './helpers.js';
import { SAMPLE } from './resume-tailoring.test.js';

class FakeAutomation implements FormAutomation {
  calls: AutomationRequest[] = [];
  outcome: Partial<AutomationOutcome> = {};
  closed = 0;
  async run(request: AutomationRequest): Promise<AutomationOutcome> {
    this.calls.push(request);
    const base: AutomationOutcome = { ats: 'greenhouse', url: request.applyUrl, filled: [{ label: 'Email', value: 'x', source: 'Email' }], open: [], blockers: [], screenshot: null, submitted: false, confirmed: false };
    const result = { ...base, ...this.outcome };
    if (request.submit && !result.blockers.length) {
      request.beforeSubmit?.();
      return { ...result, submitted: true, confirmed: this.outcome.confirmed ?? true };
    }
    return result;
  }
  async closeAll() {
    this.closed++;
  }
}

const packet = (ungrounded: string[] = []): Packet => ({
  resume: { summary: 'Engineer with 8 years in C# and Angular.', skillOrder: ['Front End', 'Back End'], experience: [], projectIds: [] },
  coverLetter: { paragraphs: ['Paragraph one about Angular.', 'Paragraph two about C#.'] },
  fitNotes: [],
  concerns: [],
  ungrounded,
});

describe('ApplicationService guardrails', () => {
  let service: ApplicationService;
  let automation: FakeAutomation;
  let store: ApplicantStore;
  let jobs: JobRepository;
  let jobId: string;
  let tailorResult: Packet;

  const ready = async () => {
    const app = service.create(jobId);
    await new Promise((r) => setTimeout(r, 20));
    return app.id;
  };

  beforeEach(() => {
    const db = openInMemoryDatabase();
    jobs = new JobRepository(db);
    const job = normalizeJob(rawJob({ company: 'Globex' }))!;
    jobId = jobs.upsert(job, new KeywordJobScorer().score(job, profile())).id;
    store = new ApplicantStore(new SettingsRepository(db));
    store.saveResume(parseDocxResume(SAMPLE));
    automation = new FakeAutomation();
    tailorResult = packet();
    service = new ApplicationService({
      jobs,
      applications: new ApplicationRepository(db),
      audit: new AuditRepository(db),
      store,
      tailor: { tailor: async () => structuredClone(tailorResult) },
      pdf: { render: async (_html, out) => fs.writeFileSync(out, '%PDF-fake') },
      automation,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-test-')),
      log: { info() {}, warn() {}, error() {} },
    });
  });

  it('prepares a packet, renders documents and moves the job to "applying"', async () => {
    const id = await ready();
    const app = service.get(id);
    assert.equal(app.status, 'review');
    assert.match(app.files.resume!, /_Resume_Globex\.pdf$/);
    assert.equal(jobs.get(jobId)!.status, 'applying');
  });

  it('refuses to fill a form before the packet is approved', async () => {
    const id = await ready();
    await assert.rejects(service.preview(id), /Approve the packet/);
    assert.equal(automation.calls.length, 0);
  });

  it('requires flagged terms to be acknowledged before approval', async () => {
    tailorResult = packet(['Kubernetes']);
    const id = await ready();
    assert.throws(() => service.approve(id, false), /flagged terms/);
    assert.equal(service.approve(id, true).status, 'approved');
  });

  it('sends the packet back to review after any edit', async () => {
    const id = await ready();
    service.approve(id, false);
    const edited = await service.editPacket(id, { coverLetter: ['A new first paragraph.', 'And a second one.'] });
    assert.equal(edited.status, 'review');
    assert.equal(edited.approvedAt, null);
  });

  it('previews without ever pressing submit', async () => {
    const id = await ready();
    service.approve(id, false);
    const app = await service.preview(id);
    assert.equal(app.status, 'previewed');
    assert.equal(automation.calls[0]!.submit, false);
  });

  it('marks the application for attention when required questions are open', async () => {
    const id = await ready();
    service.approve(id, false);
    automation.outcome = { open: [{ key: 'k', label: 'Years of Kubernetes?', required: true, kind: 'text', options: [] }] };
    const app = await service.preview(id);
    assert.equal(app.status, 'needs_attention');
    await assert.rejects(service.submit(id, 'Globex'), /clean preview/);
  });

  it('blocks automated submit while the ATS is in preview mode (the default)', async () => {
    const id = await ready();
    service.approve(id, false);
    await service.preview(id);
    await assert.rejects(service.submit(id, 'Globex'), /Automatic submission is off/);
  });

  it('requires the typed company name, then submits exactly once', async () => {
    const id = await ready();
    service.approve(id, false);
    await service.saveAutomation({ ...store.getAutomation(), modes: { greenhouse: 'submit', lever: 'preview' } });
    await service.preview(id);
    await assert.rejects(service.submit(id, 'Globe'), /Type the company name/);
    const done = await service.submit(id, 'globex');
    assert.equal(done.status, 'submitted');
    assert.equal(done.mode, 'automated');
    assert.equal(jobs.get(jobId)!.status, 'applied');
    await assert.rejects(service.submit(id, 'Globex'), /clean preview|already tried/);
  });

  it('never retries when submit was pressed but not confirmed', async () => {
    const id = await ready();
    service.approve(id, false);
    await service.saveAutomation({ ...store.getAutomation(), modes: { greenhouse: 'submit', lever: 'preview' } });
    await service.preview(id);
    automation.outcome = { confirmed: false };
    const app = await service.submit(id, 'Globex');
    assert.equal(app.status, 'needs_attention');
    assert.match(app.note, /will not retry/);
  });

  it('enforces the daily cap', async () => {
    await service.saveAutomation({ ...store.getAutomation(), dailySubmitCap: 0, modes: { greenhouse: 'submit', lever: 'preview' } });
    const id = await ready();
    service.approve(id, false);
    await service.preview(id);
    await assert.rejects(service.submit(id, 'Globex'), /Daily limit/);
  });

  it('kill switch blocks automation and closes open browsers', async () => {
    const id = await ready();
    service.approve(id, false);
    await service.saveAutomation({ ...store.getAutomation(), enabled: false });
    assert.equal(automation.closed, 1);
    await assert.rejects(service.preview(id), /kill switch/);
    await assert.rejects(service.openInBrowser(id), /kill switch/);
  });

  it('only serves files that belong to the application', async () => {
    const id = await ready();
    const app = service.get(id);
    assert.ok(service.filePath(id, app.files.resume!).endsWith('.pdf'));
    assert.throws(() => service.filePath(id, '../../jobpilot.db'), /not found/i);
    assert.throws(() => service.filePath(id, 'other.pdf'), /not found/i);
  });

  it('records a manual submission', async () => {
    const id = await ready();
    service.approve(id, false);
    const app = service.markSubmitted(id);
    assert.equal(app.status, 'submitted');
    assert.equal(app.mode, 'manual');
  });
});
