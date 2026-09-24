import type { AtsId } from './applicant.js';

/**
 * preparing → review → approved → previewed → submitted
 *                 ↑_______|  (any packet edit sends it back to review)
 * Side exits: needs_attention (a stop condition), failed, cancelled.
 */
export const APPLICATION_STATUSES = [
  'preparing',
  'review',
  'approved',
  'previewed',
  'needs_attention',
  'submitted',
  'failed',
  'cancelled',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** A tailored resume is a selection over base-resume ids, never new text (except the summary). */
export interface ResumeSelection {
  summary: string;
  skillOrder: string[];
  experience: Array<{ roleId: string; bulletIds: string[] }>;
  projectIds: string[];
}

export interface CoverLetter {
  paragraphs: string[];
}

export interface Packet {
  resume: ResumeSelection;
  coverLetter: CoverLetter;
  fitNotes: string[];
  concerns: string[];
  /** Terms in generated text that don't appear anywhere in the base resume. The owner must check these. */
  ungrounded: string[];
}

export interface FilledField {
  label: string;
  value: string;
  source: string;
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
  filled: FilledField[];
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
}

/** Normalised question text, used as the key for per-application answers. */
export function questionKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 160);
}
