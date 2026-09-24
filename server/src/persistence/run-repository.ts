import type { DatabaseSync } from 'node:sqlite';
import type { SourceId } from '../domain/job.js';

export type RunTrigger = 'schedule' | 'manual' | 'ingest';
export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted';

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
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  sources: Partial<Record<SourceId, SourceRunStats>>;
  error: string | null;
}

interface RunRow {
  id: number;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  stats_json: string;
  error: string | null;
}

export class RunRepository {
  constructor(private readonly db: DatabaseSync) {}

  start(trigger: RunTrigger, now = new Date().toISOString()): number {
    const result = this.db
      .prepare(`INSERT INTO runs (trigger, status, started_at) VALUES (?, 'running', ?)`)
      .run(trigger, now);
    return Number(result.lastInsertRowid);
  }

  saveProgress(id: number, sources: RunRecord['sources']): void {
    this.db.prepare('UPDATE runs SET stats_json = ? WHERE id = ?').run(JSON.stringify(sources), id);
  }

  finish(id: number, status: RunStatus, sources: RunRecord['sources'], error: string | null = null): void {
    this.db
      .prepare('UPDATE runs SET status = ?, finished_at = ?, stats_json = ?, error = ? WHERE id = ?')
      .run(status, new Date().toISOString(), JSON.stringify(sources), error, id);
  }

  /** A crash mid-run leaves rows stuck in "running"; mark them so the UI tells the truth. */
  markInterrupted(): void {
    this.db
      .prepare(`UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'`)
      .run(new Date().toISOString());
  }

  get(id: number): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  list(limit = 30): RunRecord[] {
    const rows = this.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(Math.min(limit, 200)) as unknown as RunRow[];
    return rows.map(toRecord);
  }
}

function toRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sources: JSON.parse(row.stats_json) as RunRecord['sources'],
    error: row.error,
  };
}
