import type { AppConfig } from './config/env.js';
import { REPO_ROOT } from './config/env.js';
import { AuditRepository } from './persistence/audit-repository.js';
import { openDatabase } from './persistence/database.js';
import { JobRepository } from './persistence/job-repository.js';
import { RunRepository } from './persistence/run-repository.js';
import { SettingsRepository } from './persistence/settings-repository.js';
import { AggregationService, type Logger } from './services/aggregation-service.js';
import { ProfileStore } from './services/profile-store.js';
import { KeywordJobScorer } from './services/scoring/keyword-scorer.js';
import { ArbeitnowSource, RemoteOkSource, RemotiveSource, TheMuseSource } from './sources/remote-boards.js';
import { GreenhouseSource, LeverSource } from './sources/company-boards.js';
import { PoliteHttpClient } from './sources/http-client.js';
import { ClaudeCliRunner } from './integrations/claude-cli.js';
import { IndeedViaClaudeSource } from './sources/indeed-via-claude.js';
import { AdzunaSource, JSearchSource, UsaJobsSource } from './sources/keyed-apis.js';
import { SourceRegistry } from './sources/source-registry.js';
import path from 'node:path';
import { findChrome } from './integrations/chrome.js';
import { ApplicationRepository } from './persistence/application-repository.js';
import { ApplicantStore } from './services/applicant-store.js';
import { ApplicationService } from './services/apply/application-service.js';
import { AutoPrepareService } from './services/apply/auto-prepare-service.js';
import { PlaywrightFormAutomation } from './services/apply/playwright-automation.js';
import { ChromePdfRenderer } from './services/documents/pdf-renderer.js';
import { ClaudeResumeTailor } from './services/tailoring/tailor.js';
import { CredentialStore } from './services/credential-store.js';
import { SetupService } from './services/setup/setup-service.js';

export interface ComposeOptions {
  /**
   * Marks runs left "running" by a crash as interrupted. Only the server does this: a
   * command-line process can start while the server is mid-sweep, and must not mark that sweep.
   */
  recoverInterruptedRuns?: boolean;
}

/**
 * Composition root: the only place concrete classes are wired together.
 * Everything else depends on interfaces handed in here (Dependency Inversion).
 */
export function compose(config: AppConfig, log: Logger, options: ComposeOptions = {}) {
  const db = openDatabase(config.DATA_DIR);
  const jobs = new JobRepository(db);
  const runs = new RunRepository(db);
  const audit = new AuditRepository(db);
  const settings = new SettingsRepository(db);
  const profiles = new ProfileStore(settings);
  const claude = new ClaudeCliRunner(config.CLAUDE_BIN, config.DATA_DIR);
  const credentials = new CredentialStore(config.DATA_DIR, {
    ADZUNA_APP_ID: config.ADZUNA_APP_ID,
    ADZUNA_APP_KEY: config.ADZUNA_APP_KEY,
    USAJOBS_API_KEY: config.USAJOBS_API_KEY,
    CONTACT_EMAIL: config.CONTACT_EMAIL,
    JSEARCH_API_KEY: config.JSEARCH_API_KEY,
    INDEED_VIA_CLAUDE: config.INDEED_VIA_CLAUDE ? 'true' : undefined,
  });
  const cred = (name: Parameters<CredentialStore['get']>[0]) => credentials.get(name);

  const registry = new SourceRegistry([
    new IndeedViaClaudeSource(() => credentials.flag('INDEED_VIA_CLAUDE'), claude),
    new RemotiveSource(),
    new RemoteOkSource(),
    new TheMuseSource(),
    new ArbeitnowSource(),
    new AdzunaSource(() => ({ appId: cred('ADZUNA_APP_ID'), appKey: cred('ADZUNA_APP_KEY') })),
    new UsaJobsSource(() => ({ apiKey: cred('USAJOBS_API_KEY'), email: cred('CONTACT_EMAIL') })),
    new JSearchSource(() => cred('JSEARCH_API_KEY')),
    new GreenhouseSource(),
    new LeverSource(),
  ]);

  const http = new PoliteHttpClient({
    allowedHosts: registry.allowedHosts(),
    userAgent: () => `JobPilot/0.1 (personal job search${cred('CONTACT_EMAIL') ? `; ${cred('CONTACT_EMAIL')}` : ''})`,
  });

  const chromePath = findChrome(config.CHROME_PATH);
  const applicantStore = new ApplicantStore(settings);
  const setup = new SetupService(settings, applicantStore, { claudeBin: config.CLAUDE_BIN, chromePath });

  const aggregation = new AggregationService({
    registry,
    jobs,
    runs,
    audit,
    profiles,
    scorer: new KeywordJobScorer(),
    http,
    log,
    blocked: () => (setup.isComplete() ? null : 'Finish the setup wizard before sweeping job boards.'),
  });

  // Phase 2: assisted applying.
  if (!chromePath) log.warn('Chrome/Edge not found: PDF rendering and form filling are unavailable. Set CHROME_PATH.');
  const applicationRepository = new ApplicationRepository(db);
  const applications = new ApplicationService({
    jobs,
    applications: applicationRepository,
    audit,
    store: applicantStore,
    tailor: new ClaudeResumeTailor(claude, config.TAILOR_MODEL, config.TAILOR_MAX_BUDGET_USD),
    pdf: new ChromePdfRenderer(chromePath),
    automation: new PlaywrightFormAutomation(chromePath, path.join(config.DATA_DIR, 'browser-profile')),
    dataDir: config.DATA_DIR,
    log,
  });
  if (!applicantStore.getResume() && config.RESUME_PATH) {
    try {
      applications.importResume(config.RESUME_PATH);
      log.info(`Imported base resume from ${config.RESUME_PATH}`);
    } catch (error) {
      log.warn(`Could not import RESUME_PATH: ${(error as Error).message}`);
    }
  }

  const autoPrepare = new AutoPrepareService({
    jobs,
    applications: applicationRepository,
    applying: applications,
    store: applicantStore,
    audit,
    log,
    blocked: () => (setup.isComplete() ? null : 'Finish the setup wizard before preparing applications.'),
  });

  setup.adoptExistingInstall(!!applicantStore.getResume() || jobs.list({ status: 'all', limit: 1 }).total > 0);
  if (options.recoverInterruptedRuns ?? true) runs.markInterrupted();
  return { db, jobs, runs, audit, profiles, registry, aggregation, applications, autoPrepare, applicantStore, credentials, settings, setup, repoRoot: REPO_ROOT };
}
