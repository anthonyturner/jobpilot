/** unattended: `npm run auto-prepare` with nobody watching. manual: the owner pressed "Prepare top matches". */
export type AutoPrepareTrigger = 'unattended' | 'manual';

/**
 * finished: went through the candidates. queue-full: enough applications already wait for review.
 * disabled: the owner has not turned unattended preparation on. blocked: setup or the base resume is missing.
 * stopped: the kill switch (or, for an unattended run, the feature switch) was off before a job.
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
  /** Every application the run created, including the one being tailored right now. */
  started: PreparedJob[];
  prepared: PreparedJob[];
  failed: Array<PreparedJob & { error: string }>;
  skipped: Array<{ jobId: string; title: string; company: string; reason: string }>;
}

/** The run in flight in this server process, or the last one it finished. */
export interface AutoPrepareStatus {
  running: boolean;
  trigger: AutoPrepareTrigger | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: AutoPrepareResult | null;
}
