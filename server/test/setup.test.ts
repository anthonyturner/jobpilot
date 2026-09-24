import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
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
import { CredentialStore } from '../src/services/credential-store.js';
import { ProfileStore } from '../src/services/profile-store.js';
import { SchedulerService } from '../src/services/scheduler-service.js';
import { KeywordJobScorer } from '../src/services/scoring/keyword-scorer.js';
import { parseDocxResume } from '../src/services/resume/docx-resume-parser.js';
import { splitSkillList, suggestFromResume } from '../src/services/setup/suggest.js';
import { SetupService } from '../src/services/setup/setup-service.js';
import { SourceRegistry } from '../src/sources/source-registry.js';
import { SAMPLE } from './resume-tailoring.test.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-setup-'));

describe('CredentialStore', () => {
  it('stores keys in a local file and never reports secret values', () => {
    const dir = tmp();
    const store = new CredentialStore(dir, {});
    store.update({ ADZUNA_APP_KEY: 'secret-123', CONTACT_EMAIL: 'me@example.com' });
    const status = Object.fromEntries(store.status().map((s) => [s.name, s]));
    assert.equal(status.ADZUNA_APP_KEY!.set, true);
    assert.equal(status.ADZUNA_APP_KEY!.value, null);
    assert.equal(status.CONTACT_EMAIL!.value, 'me@example.com');
    assert.equal(new CredentialStore(dir, {}).get('ADZUNA_APP_KEY'), 'secret-123', 'persisted to disk');
  });

  it('lets .env values win and refuses to overwrite them', () => {
    const store = new CredentialStore(tmp(), { JSEARCH_API_KEY: 'from-env' });
    store.update({ JSEARCH_API_KEY: 'from-ui' });
    assert.equal(store.get('JSEARCH_API_KEY'), 'from-env');
    assert.equal(store.status().find((s) => s.name === 'JSEARCH_API_KEY')!.origin, 'env');
  });

  it('rejects unknown names and values with whitespace or control characters', () => {
    const store = new CredentialStore(tmp(), {});
    assert.throws(() => store.update({ NOPE: 'x' } as never), /Unknown credential/);
    assert.throws(() => store.update({ ADZUNA_APP_KEY: 'has space' }), /not allowed/);
    assert.throws(() => store.update({ ADZUNA_APP_KEY: 'line\nbreak' }), /not allowed/);
  });

  it('clears a value when given null or empty', () => {
    const store = new CredentialStore(tmp(), {});
    store.update({ USAJOBS_API_KEY: 'k' });
    store.update({ USAJOBS_API_KEY: null });
    assert.equal(store.get('USAJOBS_API_KEY'), undefined);
  });
});

describe('suggestFromResume', () => {
  it('splits skill lists into individual skills', () => {
    assert.deepEqual(splitSkillList('Angular 19, TypeScript, RxJS (Signals), Observables/AsyncPipe'), ['Angular', 'TypeScript', 'RxJS', 'Observables', 'AsyncPipe']);
  });

  it('derives skills, titles and queries from the resume', () => {
    const s = suggestFromResume(parseDocxResume(SAMPLE));
    assert.equal(s.fullName, 'Jane Dev');
    assert.equal(s.primaryLocation, 'Denver, CO');
    assert.ok(s.skills.some((k) => k.name === 'Angular' && k.weight === 3));
    assert.ok(s.targetTitles.includes('software engineer'));
    assert.ok(s.searchQueries.length >= 1);
    assert.ok(!s.searchQueries.some((q) => /^(engineer|developer)$/i.test(q)), 'no one-word generic searches');
    assert.ok(!s.targetTitles.includes('developer'));
  });
});

describe('setup API', () => {
  let app: FastifyInstance;
  const HOST = { host: '127.0.0.1:7317' };
  const WEB = { ...HOST, 'x-jobpilot-client': 'web' };

  before(async () => {
    const db = openInMemoryDatabase();
    const settings = new SettingsRepository(db);
    const jobs = new JobRepository(db);
    const runs = new RunRepository(db);
    const audit = new AuditRepository(db);
    const profiles = new ProfileStore(settings);
    const store = new ApplicantStore(settings);
    const setup = new SetupService(settings, store, { claudeBin: 'definitely-not-installed', chromePath: null });
    const credentials = new CredentialStore(tmp(), {});
    const registry = new SourceRegistry([]);
    const aggregation = new AggregationService({
      registry, jobs, runs, audit, profiles, scorer: new KeywordJobScorer(),
      http: { getJson: () => Promise.reject(new Error('offline')) },
      log: { info() {}, warn() {}, error() {} },
      blocked: () => (setup.isComplete() ? null : 'Finish the setup wizard before sweeping job boards.'),
    });
    const applications = new ApplicationService({
      jobs, applications: new ApplicationRepository(db), audit, store,
      tailor: { tailor: () => Promise.reject(new Error('unused')) },
      pdf: { render: async () => undefined },
      automation: { run: () => Promise.reject(new Error('unused')), closeAll: async () => undefined },
      dataDir: tmp(), log: { info() {}, warn() {}, error() {} },
    });
    app = await buildApp(
      { port: 7317, ingestToken: 'x'.repeat(64), logLevel: 'silent', webDistDir: null },
      { jobs, runs, audit, profiles, registry, aggregation, scheduler: new SchedulerService('UTC', () => {}), applications, applicantStore: store, setup, credentials },
    );
  });

  it('starts incomplete and refuses to sweep', async () => {
    const status = (await app.inject({ method: 'GET', url: '/api/setup', headers: HOST })).json();
    assert.equal(status.complete, false);
    assert.equal(status.claudeAvailable, false);
    const run = await app.inject({ method: 'POST', url: '/api/runs', headers: WEB, payload: {} });
    const record = (await app.inject({ method: 'GET', url: `/api/runs/${run.json().runId}`, headers: HOST })).json();
    assert.equal(record.status, 'failed');
    assert.match(record.error, /setup wizard/);
  });

  it('accepts a .docx upload and suggests a profile from it', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/resume/upload?name=jane.docx',
      headers: { ...WEB, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(SAMPLE),
    });
    assert.equal(upload.statusCode, 200);
    assert.equal(upload.json().name, 'Jane Dev');
    const suggestions = (await app.inject({ method: 'GET', url: '/api/setup/suggestions', headers: HOST })).json();
    assert.equal(suggestions.fullName, 'Jane Dev');
  });

  it('rejects uploads that are not .docx files, and uploads without the client header', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/resume/upload', headers: { ...WEB, 'content-type': 'application/octet-stream' }, payload: Buffer.from('not a zip') });
    assert.equal(bad.statusCode, 400);
    const csrf = await app.inject({ method: 'POST', url: '/api/resume/upload', headers: { ...HOST, 'content-type': 'application/octet-stream' }, payload: Buffer.from(SAMPLE) });
    assert.equal(csrf.statusCode, 403);
  });

  it('never returns secret values from the credentials API', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/credentials', headers: WEB, payload: { values: { JSEARCH_API_KEY: 'super-secret-key' } } });
    assert.equal(put.statusCode, 200);
    const body = (await app.inject({ method: 'GET', url: '/api/credentials', headers: HOST })).body;
    assert.ok(!body.includes('super-secret-key'));
    assert.ok(JSON.parse(body).find((c: { name: string; set: boolean }) => c.name === 'JSEARCH_API_KEY').set);
  });

  it('allows sweeps once setup is complete', async () => {
    await app.inject({ method: 'POST', url: '/api/setup/complete', headers: WEB, payload: {} });
    const run = await app.inject({ method: 'POST', url: '/api/runs', headers: WEB, payload: {} });
    await new Promise((r) => setTimeout(r, 50));
    const record = (await app.inject({ method: 'GET', url: `/api/runs/${run.json().runId}`, headers: HOST })).json();
    assert.doesNotMatch(record.error ?? '', /setup wizard/);
  });
});
