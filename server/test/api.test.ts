import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { RawJob } from '../src/domain/job.js';
import { buildApp } from '../src/http/app.js';
import { AuditRepository } from '../src/persistence/audit-repository.js';
import { openInMemoryDatabase } from '../src/persistence/database.js';
import { JobRepository } from '../src/persistence/job-repository.js';
import { RunRepository } from '../src/persistence/run-repository.js';
import { SettingsRepository } from '../src/persistence/settings-repository.js';
import { AggregationService } from '../src/services/aggregation-service.js';
import { ProfileStore } from '../src/services/profile-store.js';
import { SchedulerService } from '../src/services/scheduler-service.js';
import { KeywordJobScorer } from '../src/services/scoring/keyword-scorer.js';
import type { HttpClient } from '../src/sources/http-client.js';
import type { JobSource } from '../src/sources/job-source.js';
import { SourceRegistry } from '../src/sources/source-registry.js';
import { SAMPLE_PROFILE } from './fixtures.js';
import { rawJob } from './helpers.js';

const PORT = 7317;
const TOKEN = 'a'.repeat(64);
const HOST = { host: `127.0.0.1:${PORT}` };
const WEB = { ...HOST, 'x-jobpilot-client': 'web' };

class FakeSource implements JobSource {
  readonly descriptor = { id: 'remotive', name: 'Fake', homepage: 'https://example.com', kind: 'api', notes: '' } as const;
  readonly hosts = [];
  constructor(private readonly jobs: RawJob[]) {}
  status() {
    return { configured: true, detail: '' };
  }
  async fetchJobs() {
    return this.jobs;
  }
}

const noHttp: HttpClient = {
  getJson: () => Promise.reject(new Error('no network in tests')),
};
const quiet = { info() {}, warn() {}, error() {} };

describe('HTTP API', () => {
  let app: FastifyInstance;
  let aggregation: AggregationService;
  let scheduler: SchedulerService;

  before(async () => {
    const db = openInMemoryDatabase();
    const jobs = new JobRepository(db);
    const runs = new RunRepository(db);
    const audit = new AuditRepository(db);
    const profiles = new ProfileStore(new SettingsRepository(db));
    profiles.saveProfile(SAMPLE_PROFILE);
    const registry = new SourceRegistry([
      new FakeSource([
        rawJob(),
        // Same job from the same board twice: stored once.
        rawJob({ sourceJobId: '2' }),
        rawJob({ sourceJobId: '3', title: 'Registered Nurse', company: 'Hospital', descriptionHtml: '<p>Patient care</p>', location: 'Dallas, TX' }),
      ]),
    ]);
    aggregation = new AggregationService({ registry, jobs, runs, audit, profiles, scorer: new KeywordJobScorer(), http: noHttp, log: quiet });
    scheduler = new SchedulerService('America/New_York', () => {});
    app = await buildApp(
      { port: PORT, ingestToken: TOKEN, logLevel: 'silent', webDistDir: null },
      { jobs, runs, audit, profiles, registry, aggregation, scheduler },
    );
  });

  after(async () => {
    scheduler.stopAll();
    await app.close();
  });

  it('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:7317' } });
    assert.equal(res.statusCode, 421);
  });

  it('rejects cross-origin requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jobs', headers: { ...HOST, origin: 'https://evil.example' } });
    assert.equal(res.statusCode, 403);
  });

  it('rejects browser writes without the client header (CSRF)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs', headers: HOST, payload: {} });
    assert.equal(res.statusCode, 403);
  });

  it('runs a sweep that keeps strong matches and drops weak ones', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs', headers: WEB, payload: {} });
    assert.equal(res.statusCode, 202);
    const { runId } = res.json() as { runId: number };
    await aggregation.startRun('manual').done;

    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: HOST })).json();
    assert.equal(run.status, 'succeeded');
    assert.equal(run.sources.remotive.inserted, 1);
    assert.equal(run.sources.remotive.discarded, 2);

    const list = (await app.inject({ method: 'GET', url: '/api/jobs', headers: HOST })).json();
    assert.equal(list.total, 1);
    assert.match(list.items[0].title, /Full Stack/);
  });

  it('updates status and records it in the audit trail', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/jobs', headers: HOST })).json();
    const id = list.items[0].id as string;
    const patch = await app.inject({ method: 'PATCH', url: `/api/jobs/${id}`, headers: WEB, payload: { status: 'saved' } });
    assert.equal(patch.statusCode, 200);
    const job = (await app.inject({ method: 'GET', url: `/api/jobs/${id}`, headers: HOST })).json();
    assert.equal(job.status, 'saved');
    assert.equal(job.history[0].action, 'job.status');
  });

  it('validates input and never echoes internals', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/jobs/not-a-uuid', headers: WEB, payload: { status: 'saved' } });
    assert.equal(res.statusCode, 400);
    const bad = await app.inject({ method: 'PUT', url: '/api/schedules', headers: WEB, payload: [{ id: 'x', label: 'x', cron: 'nope', enabled: true }] });
    assert.equal(bad.statusCode, 400);
  });

  it('requires the bearer token for ingest', async () => {
    const payload = { source: 'indeed', jobs: [{ title: 'Full Stack .NET Developer', company: 'Globex', location: 'Remote', url: 'https://to.indeed.com/abc' }] };
    const denied = await app.inject({ method: 'POST', url: '/api/ingest', headers: HOST, payload });
    assert.equal(denied.statusCode, 401);
    const wrong = await app.inject({ method: 'POST', url: '/api/ingest', headers: { ...HOST, authorization: `Bearer ${'b'.repeat(64)}` }, payload });
    assert.equal(wrong.statusCode, 401);
    const ok = await app.inject({ method: 'POST', url: '/api/ingest', headers: { ...HOST, authorization: `Bearer ${TOKEN}` }, payload });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().inserted, 1);
  });

  it('rescores stored jobs when the profile changes', async () => {
    const profile = (await app.inject({ method: 'GET', url: '/api/profile', headers: HOST })).json();
    const before = (await app.inject({ method: 'GET', url: '/api/jobs?q=Angular', headers: HOST })).json().items[0].score as number;
    profile.skills = profile.skills.filter((s: { name: string }) => !['Angular', 'C#', '.NET', 'TypeScript'].includes(s.name));
    const put = await app.inject({ method: 'PUT', url: '/api/profile', headers: WEB, payload: profile });
    assert.equal(put.statusCode, 200);
    const afterScore = (await app.inject({ method: 'GET', url: '/api/jobs?q=Angular', headers: HOST })).json().items[0].score as number;
    assert.ok(afterScore < before, `expected ${afterScore} < ${before}`);
  });
});
