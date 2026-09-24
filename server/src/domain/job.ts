export const SOURCE_IDS = [
  'indeed',
  'remotive',
  'remoteok',
  'arbeitnow',
  'themuse',
  'adzuna',
  'usajobs',
  'jsearch',
  'greenhouse',
  'lever',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const JOB_STATUSES = [
  'new',
  'saved',
  'applying',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'hidden',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const REMOTE_TYPES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export type SalaryPeriod = 'year' | 'month' | 'week' | 'day' | 'hour';

/** A listing exactly as a source hands it over, before cleaning. */
export interface RawJob {
  source: SourceId;
  sourceJobId: string;
  title: string;
  company: string;
  companyLogo?: string | undefined;
  location: string;
  remoteType?: RemoteType | undefined;
  employmentType?: string | undefined;
  salaryMin?: number | undefined;
  salaryMax?: number | undefined;
  salaryCurrency?: string | undefined;
  salaryPeriod?: SalaryPeriod | undefined;
  salaryText?: string | undefined;
  descriptionHtml?: string | undefined;
  descriptionText?: string | undefined;
  applyUrl: string;
  postedAt?: string | undefined;
  tags?: string[] | undefined;
}

/** A cleaned listing: sanitized HTML, inferred remote type, validated URL. */
export interface NormalizedJob {
  source: SourceId;
  sourceJobId: string;
  dedupeKey: string;
  title: string;
  company: string;
  companyLogo: string | null;
  location: string;
  remoteType: RemoteType;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryText: string | null;
  descriptionHtml: string;
  descriptionText: string;
  applyUrl: string;
  postedAt: string | null;
  tags: string[];
}

export interface ScoreBreakdown {
  total: number;
  /** limitedData: the listing had no real description, so skills got neutral credit. */
  skills: { points: number; max: number; matched: string[]; missing: string[]; limitedData: boolean };
  title: { points: number; max: number; matchedTerm: string | null };
  location: { points: number; max: number; reason: string };
  recency: { points: number; max: number };
  penalties: { points: number; reasons: string[] };
}

export interface JobSourceRef {
  source: SourceId;
  sourceJobId: string;
  url: string;
}

export interface Job extends Omit<NormalizedJob, 'source' | 'sourceJobId'> {
  id: string;
  primarySource: SourceId;
  sources: JobSourceRef[];
  score: number;
  scoreBreakdown: ScoreBreakdown;
  status: JobStatus;
  starred: boolean;
  notes: string;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export type JobSummary = Omit<Job, 'descriptionHtml' | 'descriptionText'> & { snippet: string };
