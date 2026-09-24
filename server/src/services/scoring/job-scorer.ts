import type { NormalizedJob, ScoreBreakdown } from '../../domain/job.js';
import type { Profile } from '../../domain/profile.js';

/**
 * Ranks a listing against the profile. Kept behind an interface so a model-based
 * scorer can replace the keyword scorer without touching aggregation or storage.
 */
export interface JobScorer {
  score(job: NormalizedJob, profile: Profile, now?: Date): ScoreBreakdown;
}
