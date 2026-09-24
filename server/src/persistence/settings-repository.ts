import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';

export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Reads a setting, validating it; falls back to (and stores) the default when missing or invalid. */
  get<S extends z.ZodType>(key: string, schema: S, fallback: z.infer<S>): z.infer<S> {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined;
    if (row) {
      const parsed = schema.safeParse(JSON.parse(row.value_json));
      if (parsed.success) return parsed.data;
    }
    this.set(key, fallback);
    return fallback;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }
}
