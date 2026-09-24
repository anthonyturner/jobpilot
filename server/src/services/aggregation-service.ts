import type { RawJob, SourceId } from '../domain/job.js';
import type { Profile } from '../domain/profile.js';
import type { AuditRepository } from '../persistence/audit-repository.js';
import type { JobRepository } from '../persistence/job-repository.js';
import type { RunRecord, RunRepository, RunTrigger, SourceRunStats } from '../persistence/run-repository.js';
import type { HttpClient } from '../sources/http-client.js';
import type { JobSource } from '../sources/job-source.js';
import type { SourceRegistry } from '../sources/source-registry.js';
import { normalizeJob } from './normalize.js';
import type { ProfileStore } from './profile-store.js';
import type { JobScorer } from './scoring/job-scorer.js';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface AggregationDeps {
  registry: SourceRegistry;
  jobs: JobRepository;
  runs: RunRepository;
  audit: AuditRepository;
  profiles: ProfileStore;
  scorer: JobScorer;
  http: HttpClient;
  log: Logger;
  /** Returns a reason when sweeps must not run yet (e.g. setup unfinished), otherwise null. */
  blocked?: () => string | null;
}

export type StoreStats = Omit<SourceRunStats, 'durationMs' | 'error' | 'skipped'>;

/** Hard ceiling per source per run, whatever a board returns. */
const MAX_JOBS_PER_SOURCE = 600;
const DAY_MS = 86_400_000;

/**
 * Runs enabled sources, then cleans, de-duplicates, scores and stores what they return.
 * Only one sweep runs at a time; a second request joins the one in flight.
 */
export class AggregationService {
  private activeRunId: number | null = null;
  private activeRun: Promise<RunRecord> | null = null;

  constructor(private readonly deps: AggregationDeps) {}

  get currentRunId(): number | null {
    return this.activeRunId;
  }

  startRun(trigger: RunTrigger, only?: SourceId[]): { runId: number; alreadyRunning: boolean; done: Promise<RunRecord> } {
    if (this.activeRun && this.activeRunId !== null) {
      return { runId: this.activeRunId, alreadyRunning: true, done: this.activeRun };
    }
    const runId = this.deps.runs.start(trigger);
    const blocked = this.deps.blocked?.();
    if (blocked) {
      this.deps.runs.finish(runId, 'failed', {}, blocked);
      return { runId, alreadyRunning: false, done: Promise.resolve(this.deps.runs.get(runId)!) };
    }
    this.activeRunId = runId;
    this.activeRun = this.execute(runId, trigger, only).finally(() => {
      this.activeRun = null;
      this.activeRunId = null;
    });
    return { runId, alreadyRunning: false, done: this.activeRun };
  }

  /** Stores listings pushed from outside (the /find-jobs command) as their own run. */
  ingest(source: SourceId, raw: RawJob[]): StoreStats & { runId: number } {
    const runId = this.deps.runs.start('ingest');
    const t0 = Date.now();
    const stats = this.store(raw, this.deps.profiles.getProfile());
    this.deps.runs.finish(runId, 'succeeded', { [source]: { ...stats, durationMs: Date.now() - t0 } });
    this.deps.audit.record('ingest', 'jobs.ingested', null, `${source}: ${stats.inserted} new, ${stats.updated} updated`);
    return { ...stats, runId };
  }

  /** Re-applies the current profile to every stored listing (after the profile changes). */
  rescoreAll(profile: Profile = this.deps.profiles.getProfile()): number {
    let count = 0;
    for (const { id, job } of this.deps.jobs.iterateForScoring()) {
      this.deps.jobs.updateScore(id, this.deps.scorer.score(job, profile));
      count++;
    }
    return count;
  }

  private async execute(runId: number, trigger: RunTrigger, only?: SourceId[]): Promise<RunRecord> {
    const { registry, runs, audit, log } = this.deps;
    const profile = this.deps.profiles.getProfile();
    const results: RunRecord['sources'] = {};
    const runnable: JobSource[] = [];

    for (const source of registry.all()) {
      const id = source.descriptor.id;
      if (only && !only.includes(id)) continue;
      const status = source.status(profile);
      if (profile.enabledSources[id] === false) results[id] = skipped('Turned off in Settings');
      else if (!status.configured) results[id] = skipped(status.detail);
      else runnable.push(source);
    }
    runs.saveProgress(runId, results);
    log.info(`Run #${runId} (${trigger}) starting ${runnable.length} sources`);

    await Promise.all(
      runnable.map(async (source) => {
        const id = source.descriptor.id;
        const t0 = Date.now();
        try {
          const raw = await source.fetchJobs({ profile, http: this.deps.http, log: prefixed(log, id) });
          results[id] = { ...this.store(raw, profile), durationMs: Date.now() - t0 };
        } catch (error) {
          const message = (error as Error).message.slice(0, 300);
          log.warn(`Source ${id} failed: ${message}`);
          results[id] = { fetched: 0, kept: 0, inserted: 0, updated: 0, discarded: 0, durationMs: Date.now() - t0, error: message };
        }
        runs.saveProgress(runId, results);
      }),
    );

    const attempted = runnable.map((s) => results[s.descriptor.id]!);
    const failures = attempted.filter((r) => r.error).length;
    const status = attempted.length > 0 && failures === attempted.length ? 'failed' : failures > 0 ? 'partial' : 'succeeded';
    const error = attempted.length === 0 ? 'No sources are enabled and configured' : null;
    runs.finish(runId, attempted.length === 0 ? 'failed' : status, results, error);

    const inserted = attempted.reduce((n, r) => n + r.inserted, 0);
    audit.record(trigger === 'schedule' ? 'scheduler' : 'user', 'run.finished', null, `Run #${runId}: ${status}, ${inserted} new`);
    log.info(`Run #${runId} ${status}: ${inserted} new listings`);
    return runs.get(runId)!;
  }

  /** Normalise → drop stale → score → drop weak (unless already tracked) → upsert. Synchronous and transactional in effect. */
  private store(raw: RawJob[], profile: Profile): StoreStats {
    const { jobs, scorer } = this.deps;
    const stats: StoreStats = { fetched: raw.length, kept: 0, inserted: 0, updated: 0, discarded: 0 };
    const cutoff = Date.now() - profile.maxAgeDays * DAY_MS;
    const seen = new Set<string>();

    for (const item of raw.slice(0, MAX_JOBS_PER_SOURCE)) {
      const job = normalizeJob(item);
      if (!job || seen.has(job.dedupeKey) || (job.postedAt && new Date(job.postedAt).getTime() < cutoff)) {
        stats.discarded++;
        continue;
      }
      seen.add(job.dedupeKey);

      const score = scorer.score(job, profile);
      if (score.total < profile.minScoreToKeep && !jobs.hasDedupeKey(job.dedupeKey)) {
        stats.discarded++;
        continue;
      }
      const { outcome, id } = jobs.upsert(job, score);
      if (outcome === 'updated') {
        const merged = jobs.get(id)!;
        jobs.updateScore(id, scorer.score({ ...merged, source: job.source, sourceJobId: job.sourceJobId }, profile));
      }
      stats.kept++;
      stats[outcome]++;
    }
    stats.discarded += Math.max(0, raw.length - MAX_JOBS_PER_SOURCE);
    return stats;
  }
}

function skipped(reason: string): SourceRunStats {
  return { fetched: 0, kept: 0, inserted: 0, updated: 0, discarded: 0, durationMs: 0, skipped: reason };
}

function prefixed(log: Logger, id: string) {
  return { info: (m: string) => log.info(`[${id}] ${m}`), warn: (m: string) => log.warn(`[${id}] ${m}`) };
}
