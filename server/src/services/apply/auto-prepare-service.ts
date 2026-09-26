import type { AutoPrepareOutcome, AutoPrepareResult, AutoPrepareStatus, AutoPrepareTrigger } from '../../domain/auto-prepare.js';
import { conflict } from '../../domain/errors.js';
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

export interface AutoPrepareRunOptions {
  /** Defaults to `unattended`, which is what `npm run auto-prepare` runs. */
  trigger?: AutoPrepareTrigger;
}

interface RunContext {
  trigger: AutoPrepareTrigger;
  actor: AuditActor;
}

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
 * Picks the strongest new matches and tailors a packet for each, one at a time,
 * through ApplicationService: unattended from the CLI, or on demand when the owner
 * presses "Prepare top matches". It never approves, fills or submits anything, so
 * every application it creates ends in `review` or `failed` (assisted-apply rule 12).
 */
export class AutoPrepareService {
  private active: Promise<AutoPrepareResult> | null = null;
  private current: Omit<AutoPrepareStatus, 'running'> | null = null;

  constructor(private readonly deps: AutoPrepareDeps) {}

  /**
   * Starts a run in the background, at most one at a time in this process. Refuses up
   * front, with the owner-facing reason, when setup, the resume or the kill switch rules it out.
   */
  start(trigger: AutoPrepareTrigger): { alreadyRunning: boolean; done: Promise<AutoPrepareResult> } {
    if (this.active) return { alreadyRunning: true, done: this.active };
    const refused = this.refusal(trigger);
    if (refused) throw conflict(refused.reason);

    const done = this.run({ trigger }).finally(() => {
      this.active = null;
    });
    done.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log.error(`Preparing top matches crashed: ${message}`);
      if (this.current?.result) {
        Object.assign(this.current.result, { outcome: 'stopped', reason: 'Preparation stopped unexpectedly. The server log has the details.' });
        this.current.finishedAt = this.isoNow();
      }
    });
    this.active = done;
    return { alreadyRunning: false, done };
  }

  status(): AutoPrepareStatus {
    const current = this.current;
    return {
      running: this.active !== null,
      trigger: current?.trigger ?? null,
      startedAt: current?.startedAt ?? null,
      finishedAt: current?.finishedAt ?? null,
      result: current?.result ? structuredClone(current.result) : null,
    };
  }

  async run(options: AutoPrepareRunOptions = {}): Promise<AutoPrepareResult> {
    const trigger = options.trigger ?? 'unattended';
    const ctx: RunContext = { trigger, actor: trigger === 'manual' ? 'user' : 'scheduler' };
    const result: AutoPrepareResult = { outcome: 'finished', reason: null, started: [], prepared: [], failed: [], skipped: [] };
    this.current = { trigger, startedAt: this.isoNow(), finishedAt: null, result };
    this.deps.audit.record(ctx.actor, 'autoprepare.started', null, trigger);

    const refused = this.refusal(trigger);
    if (refused) return this.finish(ctx, result, refused.outcome, refused.reason);

    this.recoverStalePreparing(ctx);
    const settings = this.deps.store.getAutomation().autoPrepare;
    const room = settings.topN - this.deps.applications.countWaitingForReview();
    if (room <= 0) return this.finish(ctx, result, 'queue-full', `${settings.topN} or more applications already wait for your review.`);

    const companies = new Set<string>();
    for (const job of this.deps.jobs.listPrepareCandidates(settings.minScore, CANDIDATE_POOL)) {
      if (result.prepared.length + result.failed.length >= room) break;
      const stop = this.stopReason(trigger);
      if (stop) return this.finish(ctx, result, 'stopped', stop.reason);

      const skip = this.skipReason(job, companies);
      if (skip) {
        result.skipped.push({ jobId: job.id, title: job.title, company: job.company, reason: skip });
        this.deps.audit.record(ctx.actor, 'autoprepare.skipped', job.id, skip);
        continue;
      }
      companies.add(companyKey(job.company));
      await this.prepareOne(ctx, job, result);
    }
    return this.finish(ctx, result, 'finished', null);
  }

  private async prepareOne(ctx: RunContext, job: Job, result: AutoPrepareResult): Promise<void> {
    const item = { applicationId: '', jobId: job.id, title: job.title, company: job.company };
    try {
      const created = this.deps.applying.create(job.id, { actor: ctx.actor, keepJobStatus: true });
      item.applicationId = created.id;
      result.started.push(item);
      this.deps.log.info(`Tailoring "${job.title}" at ${job.company} (score ${job.score})`);
      const done = await this.deps.applying.whenPrepared(created.id);
      if (done.status === 'review') result.prepared.push(item);
      else result.failed.push({ ...item, error: done.note || `Ended in ${done.status}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ ...item, error: message });
      this.deps.audit.record(ctx.actor, 'autoprepare.failed', job.id, message.slice(0, 400));
    }
  }

  /** Frees the review queue from drafts whose process died, so they stop counting against topN. */
  private recoverStalePreparing(ctx: RunContext): void {
    const now = this.deps.now?.() ?? Date.now();
    const cutoff = new Date(now - STALE_PREPARING_MS).toISOString();
    for (const app of this.deps.applications.failStalePreparing(cutoff, STALE_NOTE, new Date(now).toISOString())) {
      this.deps.audit.record(ctx.actor, 'autoprepare.recovered', app.jobId, `Application ${app.id}: preparing -> failed (interrupted)`);
      this.deps.log.warn(`Application ${app.id} was still preparing after 30 minutes; marked it failed.`);
    }
  }

  private refusal(trigger: AutoPrepareTrigger): { outcome: AutoPrepareOutcome; reason: string } | null {
    const blocked = this.deps.blocked() ?? (this.deps.store.getResume() ? null : 'Import your base resume in Settings first.');
    if (blocked) return { outcome: 'blocked', reason: blocked };
    return this.stopReason(trigger);
  }

  /**
   * Re-read on every call: the owner may flip a switch in the running app while this process works.
   * The feature switch governs unattended runs only; the kill switch stops every run.
   */
  private stopReason(trigger: AutoPrepareTrigger): { outcome: 'stopped' | 'disabled'; reason: string } | null {
    const automation = this.deps.store.getAutomation();
    if (!automation.enabled) return { outcome: 'stopped', reason: 'Automation is switched off (kill switch).' };
    if (trigger === 'unattended' && !automation.autoPrepare.enabled) return { outcome: 'disabled', reason: 'Unattended preparation is off in Settings.' };
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

  private finish(ctx: RunContext, result: AutoPrepareResult, outcome: AutoPrepareOutcome, reason: string | null): AutoPrepareResult {
    result.outcome = outcome;
    result.reason = reason;
    if (this.current?.result === result) this.current.finishedAt = this.isoNow();
    const summary = `${outcome}: ${result.prepared.length} prepared, ${result.failed.length} failed, ${result.skipped.length} skipped${reason ? `. ${reason}` : ''}`;
    this.deps.audit.record(ctx.actor, 'autoprepare.finished', null, summary);
    this.deps.log.info(`${ctx.trigger === 'manual' ? 'On-demand' : 'Unattended'} preparation ${summary}`);
    return result;
  }

  private isoNow(): string {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString();
  }
}

function companyKey(company: string): string {
  return company.trim().toLowerCase();
}
