import type { ApplicationStatus, JobStatus, JobSummary, RemoteType, SourceId } from './models';

export const SOURCE_LABELS: Record<SourceId, string> = {
  indeed: 'Indeed',
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  arbeitnow: 'Arbeitnow',
  themuse: 'The Muse',
  adzuna: 'Adzuna',
  usajobs: 'USAJOBS',
  jsearch: 'JSearch',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
};

export const SOURCE_COLORS: Record<SourceId, string> = {
  indeed: '#2164f3',
  remotive: '#f43f5e',
  remoteok: '#f97316',
  arbeitnow: '#14b8a6',
  themuse: '#a855f7',
  adzuna: '#22c55e',
  usajobs: '#0ea5e9',
  jsearch: '#eab308',
  greenhouse: '#10b981',
  lever: '#6366f1',
};

export const STATUS_META: Record<JobStatus, { label: string; tone: string }> = {
  new: { label: 'New', tone: 'accent' },
  saved: { label: 'Saved', tone: 'info' },
  applying: { label: 'Applying', tone: 'warn' },
  applied: { label: 'Applied', tone: 'good' },
  interviewing: { label: 'Interviewing', tone: 'good' },
  offer: { label: 'Offer', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  hidden: { label: 'Hidden', tone: 'dim' },
};

export const REMOTE_LABELS: Record<RemoteType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Unspecified',
};

export function scoreTone(score: number): 'excellent' | 'good' | 'fair' | 'weak' {
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'weak';
}

export const SCORE_COLORS = { excellent: '#34d399', good: '#22d3ee', fair: '#fbbf24', weak: '#94a3b8' } as const;

function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

export function formatSalary(job: Pick<JobSummary, 'salaryMin' | 'salaryMax' | 'salaryPeriod' | 'salaryText' | 'salaryCurrency'>): string | null {
  const { salaryMin: min, salaryMax: max, salaryPeriod: period } = job;
  if (min === null && max === null) return job.salaryText;
  const symbol = !job.salaryCurrency || job.salaryCurrency === 'USD' ? '$' : `${job.salaryCurrency} `;
  const suffix = period === 'hour' ? '/hr' : period === 'month' ? '/mo' : period === 'week' ? '/wk' : period === 'day' ? '/day' : '';
  const fmt = (n: number) => (period === 'hour' ? n.toFixed(0) : compact(n));
  if (min !== null && max !== null && min !== max) return `${symbol}${fmt(min)}–${fmt(max)}${suffix}`;
  return `${symbol}${fmt((min ?? max)!)}${suffix}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function timeUntil(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const minutes = Math.max(0, (new Date(iso).getTime() - now) / 60000);
  if (minutes < 60) return `in ${Math.ceil(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `in ${Math.floor(hours)}h ${Math.round(minutes % 60)}m`;
  return `in ${Math.floor(hours / 24)}d`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

/** Stable pleasant gradient per company, so avatars are recognisable at a glance. */
export function companyGradient(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 75% 45%))`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const APPLICATION_META: Record<ApplicationStatus, { label: string; tone: string; step: number }> = {
  preparing: { label: 'Tailoring', tone: 'accent', step: 0 },
  review: { label: 'Ready for review', tone: 'warn', step: 1 },
  approved: { label: 'Approved', tone: 'info', step: 2 },
  previewed: { label: 'Form ready', tone: 'good', step: 3 },
  needs_attention: { label: 'Needs you', tone: 'bad', step: 3 },
  submitted: { label: 'Submitted', tone: 'good', step: 4 },
  failed: { label: 'Failed', tone: 'bad', step: 0 },
  cancelled: { label: 'Cancelled', tone: 'dim', step: 0 },
};

export const APPLICATION_STEPS = ['Tailor', 'Review', 'Approve', 'Fill form', 'Submit'];
