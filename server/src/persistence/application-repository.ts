import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { AtsId } from '../domain/applicant.js';
import type { Application, ApplicationStatus, FillReport, Packet } from '../domain/application.js';

interface Row {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  ats: AtsId | null;
  apply_url: string;
  packet_json: string | null;
  answers_json: string;
  files_json: string;
  report_json: string | null;
  mode: Application['mode'];
  note: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  submit_attempted_at: string | null;
  submitted_at: string | null;
}

export type ApplicationPatch = Partial<{
  status: ApplicationStatus;
  ats: AtsId | null;
  packet: Packet | null;
  answers: Record<string, string>;
  files: Application['files'];
  report: FillReport | null;
  mode: Application['mode'];
  note: string;
  approvedAt: string | null;
  submitAttemptedAt: string;
  submittedAt: string;
}>;

const COLUMN: Record<keyof ApplicationPatch, [string, (v: never) => SQLInputValue]> = {
  status: ['status', (v) => v],
  ats: ['ats', (v) => v],
  packet: ['packet_json', (v) => (v === null ? null : JSON.stringify(v))],
  answers: ['answers_json', (v) => JSON.stringify(v)],
  files: ['files_json', (v) => JSON.stringify(v)],
  report: ['report_json', (v) => (v === null ? null : JSON.stringify(v))],
  mode: ['mode', (v) => v],
  note: ['note', (v) => v],
  approvedAt: ['approved_at', (v) => v],
  submitAttemptedAt: ['submit_attempted_at', (v) => v],
  submittedAt: ['submitted_at', (v) => v],
};

export class ApplicationRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(jobId: string, applyUrl: string): Application {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO applications (id, job_id, status, apply_url, created_at, updated_at) VALUES (?, ?, 'preparing', ?, ?, ?)`)
      .run(id, jobId, applyUrl, now, now);
    return this.get(id)!;
  }

  get(id: string): Application | undefined {
    const row = this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row | undefined;
    return row ? toApplication(row) : undefined;
  }

  /** The live (not cancelled or failed) application for a job, if any. */
  activeForJob(jobId: string): Application | undefined {
    const row = this.db
      .prepare(`SELECT * FROM applications WHERE job_id = ? AND status NOT IN ('cancelled', 'failed') ORDER BY created_at DESC LIMIT 1`)
      .get(jobId) as Row | undefined;
    return row ? toApplication(row) : undefined;
  }

  /** Applications being tailored or waiting for the owner's review. */
  countWaitingForReview(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM applications WHERE status IN ('preparing', 'review')`).get() as { n: number }).n;
  }

  /**
   * Moves every application still `preparing` since before the cutoff to `failed`, and returns them.
   * One statement, so a draft that finishes at the same moment is never overwritten.
   */
  failStalePreparing(cutoffIso: string, note: string, nowIso: string): Array<{ id: string; jobId: string }> {
    const rows = this.db
      .prepare(`UPDATE applications SET status = 'failed', note = ?, updated_at = ? WHERE status = 'preparing' AND updated_at < ? RETURNING id, job_id`)
      .all(note, nowIso, cutoffIso) as Array<{ id: string; job_id: string }>;
    return rows.map((row) => ({ id: row.id, jobId: row.job_id }));
  }

  /** Whether a job at this company has an application being tailored or waiting for review. */
  hasOpenDraftAtCompany(company: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE lower(trim(j.company)) = lower(trim(?)) AND a.status IN ('preparing', 'review') LIMIT 1`,
      )
      .get(company);
    return row !== undefined;
  }

  list(): Application[] {
    return (this.db.prepare('SELECT * FROM applications ORDER BY updated_at DESC LIMIT 300').all() as unknown as Row[]).map(toApplication);
  }

  update(id: string, patch: ApplicationPatch): Application {
    const sets = ['updated_at = ?'];
    const values: SQLInputValue[] = [new Date().toISOString()];
    for (const [key, value] of Object.entries(patch) as Array<[keyof ApplicationPatch, never]>) {
      if (value === undefined) continue;
      const [column, encode] = COLUMN[key];
      sets.push(`${column} = ?`);
      values.push(encode(value));
    }
    this.db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    return this.get(id)!;
  }

  /** Automated submissions since the given time (for the daily cap). */
  countAutomatedSubmissionsSince(sinceIso: string): number {
    return (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM applications WHERE mode = 'automated' AND submit_attempted_at >= ?`)
        .get(sinceIso) as { n: number }
    ).n;
  }

  /** Most recent submission (any mode) to the same company, for the minimum gap rule. */
  lastSubmissionToCompany(company: string, excludeId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(COALESCE(a.submitted_at, a.submit_attempted_at)) AS at FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE lower(j.company) = lower(?) AND a.id != ? AND (a.submitted_at IS NOT NULL OR a.submit_attempted_at IS NOT NULL)`,
      )
      .get(company, excludeId) as { at: string | null };
    return row.at;
  }

  submitAttempted(id: string): boolean {
    return (this.db.prepare('SELECT submit_attempted_at FROM applications WHERE id = ?').get(id) as { submit_attempted_at: string | null } | undefined)?.submit_attempted_at != null;
  }
}

function toApplication(row: Row): Application {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    ats: row.ats,
    applyUrl: row.apply_url,
    packet: row.packet_json ? (JSON.parse(row.packet_json) as Packet) : null,
    answers: JSON.parse(row.answers_json) as Record<string, string>,
    files: JSON.parse(row.files_json) as Application['files'],
    report: row.report_json ? (JSON.parse(row.report_json) as FillReport) : null,
    mode: row.mode,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    submittedAt: row.submitted_at,
  };
}
