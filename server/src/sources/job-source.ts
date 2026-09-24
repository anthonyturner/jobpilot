import type { RawJob, SourceId } from '../domain/job.js';
import type { Profile } from '../domain/profile.js';
import type { HttpClient } from './http-client.js';

export interface SourceContext {
  profile: Profile;
  http: HttpClient;
  log: { info(msg: string): void; warn(msg: string): void };
}

export interface SourceStatus {
  /** True when the source has everything it needs (keys, board slugs, ...). */
  configured: boolean;
  detail: string;
}

export interface SourceDescriptor {
  id: SourceId;
  name: string;
  homepage: string;
  kind: 'api' | 'agent';
  /** Short description of how listings arrive and any terms the source asks us to follow. */
  notes: string;
}

/**
 * One job board. Adding a board means adding a class that implements this and
 * registering it; nothing else in the pipeline changes (Open/Closed).
 */
export interface JobSource {
  readonly descriptor: SourceDescriptor;
  /** Hostnames this source may call. The HTTP client refuses everything else. */
  readonly hosts: readonly string[];
  status(profile: Profile): SourceStatus;
  fetchJobs(ctx: SourceContext): Promise<RawJob[]>;
}

/** Search queries capped per source so free API quotas survive a daily schedule. */
export function queriesFor(profile: Profile, max: number): string[] {
  return profile.searchQueries.slice(0, max);
}

export function isoFromEpochSeconds(epoch: number | undefined): string | undefined {
  return typeof epoch === 'number' && epoch > 0 ? new Date(epoch * 1000).toISOString() : undefined;
}
