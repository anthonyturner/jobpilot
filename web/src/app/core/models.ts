/** Mirrors server/src/domain. Keep in sync when the API contract changes. */

export type SourceId =
  | 'indeed'
  | 'remotive'
  | 'remoteok'
  | 'arbeitnow'
  | 'themuse'
  | 'adzuna'
  | 'usajobs'
  | 'jsearch'
  | 'greenhouse'
  | 'lever';

export const JOB_STATUSES = ['new', 'saved', 'applying', 'applied', 'interviewing', 'offer', 'rejected', 'hidden'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type RemoteType = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type SalaryPeriod = 'year' | 'month' | 'week' | 'day' | 'hour';

export interface ScoreBreakdown {
  total: number;
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

export interface JobSummary {
  id: string;
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
  applyUrl: string;
  tags: string[];
  primarySource: SourceId;
  sources: JobSourceRef[];
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  status: JobStatus;
  starred: boolean;
  notes: string;
  updatedAt: string;
  snippet: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: 'user' | 'scheduler' | 'ingest' | 'agent';
  action: string;
  jobId: string | null;
  detail: string;
}

export interface JobDetail extends Omit<JobSummary, 'snippet'> {
  descriptionHtml: string;
  descriptionText: string;
  history: AuditEntry[];
}

export interface JobPage {
  items: JobSummary[];
  total: number;
}

export interface JobQuery {
  q?: string;
  status?: JobStatus | 'active' | 'all';
  source?: SourceId;
  remoteType?: RemoteType;
  minScore?: number;
  starred?: boolean;
  sinceDays?: number;
  sort?: 'score' | 'posted' | 'seen';
  limit?: number;
  offset?: number;
}

export interface SourceRunStats {
  fetched: number;
  kept: number;
  inserted: number;
  updated: number;
  discarded: number;
  durationMs: number;
  error?: string;
  skipped?: string;
}

export interface RunRecord {
  id: number;
  trigger: 'schedule' | 'manual' | 'ingest';
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted';
  startedAt: string;
  finishedAt: string | null;
  sources: Partial<Record<SourceId, SourceRunStats>>;
  error: string | null;
}

export interface Stats {
  active: number;
  newToday: number;
  strongMatches: number;
  averageScore: number;
  remote: number;
  byStatus: Partial<Record<JobStatus, number>>;
  bySource: Partial<Record<SourceId, number>>;
  lastRun: RunRecord | null;
  activeRunId: number | null;
}

export interface Skill {
  name: string;
  aliases: string[];
  weight: number;
}

export interface Profile {
  fullName: string;
  headline: string;
  primaryLocation: string;
  preferredLocations: string[];
  remotePreference: 'remote-only' | 'remote-or-hybrid' | 'any';
  searchQueries: string[];
  targetTitles: string[];
  skills: Skill[];
  excludeKeywords: string[];
  minSalary: number | null;
  minScoreToKeep: number;
  maxAgeDays: number;
  enabledSources: Partial<Record<SourceId, boolean>>;
  companyBoards: { greenhouse: string[]; lever: string[] };
}

export interface Schedule {
  id: string;
  label: string;
  cron: string;
  enabled: boolean;
  nextRunAt?: string | null;
}

export interface ScheduleSettings {
  timezone: string;
  schedules: Schedule[];
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  homepage: string;
  kind: 'api' | 'agent';
  notes: string;
  enabled: boolean;
  configured: boolean;
  detail: string;
}

// ---- Phase 2: assisted applying -------------------------------------------

export type AtsId = 'greenhouse' | 'lever';
export type AtsMode = 'off' | 'preview' | 'submit';

export type ApplicationStatus = 'preparing' | 'review' | 'approved' | 'previewed' | 'needs_attention' | 'submitted' | 'failed' | 'cancelled';

export interface ResumeSelection {
  summary: string;
  skillOrder: string[];
  experience: Array<{ roleId: string; bulletIds: string[] }>;
  projectIds: string[];
}

export interface Packet {
  resume: ResumeSelection;
  coverLetter: { paragraphs: string[] };
  fitNotes: string[];
  concerns: string[];
  ungrounded: string[];
}

export interface OpenQuestion {
  key: string;
  label: string;
  required: boolean;
  kind: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'combobox';
  options: string[];
}

export interface FillReport {
  url: string;
  ats: AtsId | null;
  filled: Array<{ label: string; value: string; source: string }>;
  open: OpenQuestion[];
  blockers: string[];
  screenshot: string | null;
  at: string;
}

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  ats: AtsId | null;
  applyUrl: string;
  packet: Packet | null;
  answers: Record<string, string>;
  files: { resume: string | null; coverLetter: string | null; screenshots: string[] };
  report: FillReport | null;
  mode: 'automated' | 'manual' | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  submittedAt: string | null;
  job: Omit<JobDetail, 'history'> | null;
}

export interface ResumeDoc {
  name: string;
  headline: string;
  contact: { email: string; phone: string; location: string };
  summary: string;
  skills: Array<{ category: string; items: string }>;
  highlights: { title: string; bullets: Array<{ id: string; text: string }> } | null;
  experience: Array<{ id: string; title: string; company: string; dates: string; bullets: Array<{ id: string; text: string }> }>;
  projects: Array<{ id: string; name: string; text: string }>;
  education: Array<{ degree: string; school: string; year: string }>;
  sourceFile: string;
  importedAt: string;
}

export interface Applicant {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  currentCompany: string;
  currentTitle: string;
  linkedin: string;
  github: string;
  portfolio: string;
  workAuthorizedUS: boolean | null;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
  salaryExpectation: string;
  availability: string;
  howDidYouHear: string;
  eeo: { gender: string; race: string; veteran: string; disability: string };
  acceptDataConsent: boolean;
  answerBank: Array<{ question: string; answer: string }>;
}

export interface Automation {
  enabled: boolean;
  modes: Record<AtsId, AtsMode>;
  dailySubmitCap: number;
  sameCompanyGapHours: number;
}

// ---- First-run setup and credentials ------------------------------------------

export interface SetupStatus {
  complete: boolean;
  hasResume: boolean;
  resumeName: string | null;
  claudeAvailable: boolean;
  chromeAvailable: boolean;
}

export interface ProfileSuggestions {
  fullName: string;
  headline: string;
  primaryLocation: string;
  skills: Skill[];
  targetTitles: string[];
  searchQueries: string[];
}

export type CredentialName = 'ADZUNA_APP_ID' | 'ADZUNA_APP_KEY' | 'USAJOBS_API_KEY' | 'CONTACT_EMAIL' | 'JSEARCH_API_KEY' | 'INDEED_VIA_CLAUDE';

export interface CredentialStatus {
  name: CredentialName;
  label: string;
  secret: boolean;
  helpUrl: string;
  set: boolean;
  origin: 'env' | 'app' | null;
  value: string | null;
}
