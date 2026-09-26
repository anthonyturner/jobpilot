import type { Job } from '../../domain/job.js';
import type { ApplicationRepository } from '../../persistence/application-repository.js';
import type { AuditActor, AuditRepository } from '../../persistence/audit-repository.js';
import type { JobRepository } from '../../persistence/job-repository.js';
import type { Logger } from '../aggregation-service.js';
import type { ApplicantStore } from '../applicant-store.js';
import type { ApplicationService } from './application-service.js';

export interface AutoPrepareDeps {
  jobs: JobRepository;
  applications: ApplicationRepository;
  applying: Pick<ApplicationService, 'create' | 'whenPrepared'>;
  store: ApplicantStore;
  audit: AuditRepository;
  log: Logger;
  /** Returns a reason when nothing may run yet (first-run setup unfinished), otherwise null. */
  blocked: () => string | null;
  now?: () => number;
}

/**
 * finished: went through the candidates. queue-full: enough applications already wait for review.
 * disabled: the owner has not turned the feature on. blocked: setup or the base resume is missing.
 * stopped: the kill switch (or the feature switch) was off before a job.
 */
export type AutoPrepareOutcome = 'finished' | 'queue-full' | 'disabled' | 'blocked' | 'stopped';

export interface PreparedJob {
  applicationId: string;
  jobId: string;
  title: string;
  company: string;
}

export interface AutoPrepareResult {
  outcome: AutoPrepareOutcome;
  reason: string | null;
  prepared: PreparedJob[];
  failed: Array<PreparedJob & { error: string }>;
  skipped: Array<{ jobId: string; title: string; company: string; reason: string }>;
}

const ACTOR: AuditActor = 'scheduler';
const HOUR_MS = 3_600_000;
/** How many top-scoring listings one run looks through before giving up on filling the queue. */
const CANDIDATE_POOL = 200;
/**
 * A draft takes up to about 8 minutes, so one still `preparing` after 30 was orphaned by a
 * process that was killed mid-draft. The margin keeps a slow but live draft from being failed.
 */
const STALE_PREPARING_MS = 30 * 60_000;
const STALE_NOTE = 'Preparation was interrupted before it finished (still preparing after 30 minutes). Start a new application for this job to try again.';

/**
 * Unattended preparation: picks the strongest new matches and tailors a packet for
 * each, one at a time, through ApplicationService. It never approves, fills or
 * submits anything, so every application it creates ends in `review` or `failed`
 * (assisted-apply rule 12).
 */
export class AutoPrepareService {
  constructor(private readonly deps: AutoPrepareDeps) {}

  async run(): Promise<AutoPrepareResult> {
    const result: AutoPrepareResult = { outcome: 'finished', reason: null, prepared: [], failed: [], skipped: [] };
    const blocked = this.deps.blocked() ?? (this.deps.store.getResume() ? null : 'Import your base resume in Settings first.');
    if (blocked) return this.finish(result, 'blocked', blocked);
    const initialStop = this.stopReason();
    if (initialStop) return this.finish(result, initialStop.outcome, initialStop.reason);

    this.recoverStalePreparing();
    const settings = this.deps.store.getAutomation().autoPrepare;
    const room = settings.topN - this.deps.applications.countWaitingForReview();
    if (room <= 0) return this.finish(result, 'queue-full', `${settings.topN} or more applications already wait for your review.`);

    const companies = new Set<string>();
    for (const job of this.deps.jobs.listPrepareCandidates(settings.minScore, CANDIDATE_POOL)) {
      if (result.prepared.length + result.failed.length >= room) break;
      const stop = this.stopReason();
      if (stop) return this.finish(result, 'stopped', stop.reason);

      const skip = this.skipReason(job, companies);
      if (skip) {
        result.skipped.push({ jobId: job.id, title: job.title, company: job.company, reason: skip });
        this.deps.audit.record(ACTOR, 'autoprepare.skipped', job.id, skip);
        continue;
      }
      companies.add(companyKey(job.company));
      await this.prepareOne(job, result);
    }
    return this.finish(result, 'finished', null);
  }

  private async prepareOne(job: Job, result: AutoPrepareResult): Promise<void> {
    const item = { applicationId: '', jobId: job.id, title: job.title, company: job.company };
    try {
      const created = this.deps.applying.create(job.id, { actor: ACTOR, keepJobStatus: true });
      item.applicationId = created.id;
      this.deps.log.info(`Tailoring "${job.title}" at ${job.company} (score ${job.score})`);
      const done = await this.deps.applying.whenPrepared(created.id);
      if (done.status === 'review') result.prepared.push(item);
      else result.failed.push({ ...item, error: done.note || `Ended in ${done.status}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ ...item, error: message });
      this.deps.audit.record(ACTOR, 'autoprepare.failed', job.id, message.slice(0, 400));
    }
  }

  /** Frees the review queue from drafts whose process died, so they stop counting against topN. */
  private recoverStalePreparing(): void {
    const now = this.deps.now?.() ?? Date.now();
    const cutoff = new Date(now - STALE_PREPARING_MS).toISOString();
    for (const app of this.deps.applications.failStalePreparing(cutoff, STALE_NOTE, new Date(now).toISOString())) {
      this.deps.audit.record(ACTOR, 'autoprepare.recovered', app.jobId, `Application ${app.id}: preparing -> failed (interrupted)`);
      this.deps.log.warn(`Application ${app.id} was still preparing after 30 minutes; marked it failed.`);
    }
  }

  /** Re-read on every call: the owner may flip a switch in the running app while this process works. */
  private stopReason(): { outcome: 'stopped' | 'disabled'; reason: string } | null {
    const automation = this.deps.store.getAutomation();
    if (!automation.enabled) return { outcome: 'stopped', reason: 'Automation is switched off (kill switch).' };
    if (!automation.autoPrepare.enabled) return { outcome: 'disabled', reason: 'Unattended preparation is off in Settings.' };
    return null;
  }

  private skipReason(job: Job, companies: Set<string>): string | null {
    if (job.scoreBreakdown.skills.limitedData) return 'No usable job description to tailor against.';
    if (companies.has(companyKey(job.company))) return 'Another job at this company was prepared in this run.';
    if (this.deps.applications.hasOpenDraftAtCompany(job.company)) return `${job.company} already has an application being prepared or waiting for your review.`;
    const gapHours = this.deps.store.getAutomation().sameCompanyGapHours;
    const last = this.deps.applications.lastSubmissionToCompany(job.company, '');
    const now = this.deps.now?.() ?? Date.now();
    if (last && now - new Date(last).getTime() < gapHours * HOUR_MS) {
      return `You applied to ${job.company} within the last ${gapHours} hours.`;
    }
    return null;
  }

  private finish(result: AutoPrepareResult, outcome: AutoPrepareOutcome, reason: string | null): AutoPrepareResult {
    const summary = `${outcome}: ${result.prepared.length} prepared, ${result.failed.length} failed, ${result.skipped.length} skipped${reason ? `. ${reason}` : ''}`;
    this.deps.audit.record(ACTOR, 'autoprepare.finished', null, summary);
    this.deps.log.info(`Unattended preparation ${summary}`);
    return { ...result, outcome, reason };
  }
}

function companyKey(company: string): string {
  return company.trim().toLowerCase();
}
