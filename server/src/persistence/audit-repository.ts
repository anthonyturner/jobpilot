import type { DatabaseSync } from 'node:sqlite';

export type AuditActor = 'user' | 'scheduler' | 'ingest' | 'agent';

export interface AuditEntry {
  id: number;
  at: string;
  actor: AuditActor;
  action: string;
  jobId: string | null;
  detail: string;
}

/** Append-only. There is intentionally no update or delete method. */
export class AuditRepository {
  constructor(private readonly db: DatabaseSync) {}

  record(actor: AuditActor, action: string, jobId: string | null = null, detail = ''): void {
    this.db
      .prepare('INSERT INTO audit_log (at, actor, action, job_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), actor, action, jobId, detail.slice(0, 2000));
  }

  forJob(jobId: string): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT id, at, actor, action, job_id, detail FROM audit_log WHERE job_id = ? ORDER BY id DESC LIMIT 100')
      .all(jobId) as Array<{ id: number; at: string; actor: AuditActor; action: string; job_id: string | null; detail: string }>;
    return rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, jobId: r.job_id, detail: r.detail }));
  }
}
