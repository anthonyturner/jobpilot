import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE jobs (
    id               TEXT PRIMARY KEY,
    dedupe_key       TEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    company          TEXT NOT NULL,
    company_logo     TEXT,
    location         TEXT NOT NULL,
    remote_type      TEXT NOT NULL,
    employment_type  TEXT,
    salary_min       REAL,
    salary_max       REAL,
    salary_currency  TEXT,
    salary_period    TEXT,
    salary_text      TEXT,
    description_html TEXT NOT NULL,
    description_text TEXT NOT NULL,
    apply_url        TEXT NOT NULL,
    tags_json        TEXT NOT NULL DEFAULT '[]',
    primary_source   TEXT NOT NULL,
    sources_json     TEXT NOT NULL,
    posted_at        TEXT,
    first_seen_at    TEXT NOT NULL,
    last_seen_at     TEXT NOT NULL,
    score            INTEGER NOT NULL,
    score_json       TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'new',
    starred          INTEGER NOT NULL DEFAULT 0,
    notes            TEXT NOT NULL DEFAULT '',
    updated_at       TEXT NOT NULL
  );
  CREATE INDEX idx_jobs_score ON jobs(score DESC);
  CREATE INDEX idx_jobs_status ON jobs(status);
  CREATE INDEX idx_jobs_first_seen ON jobs(first_seen_at DESC);

  CREATE TABLE runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger      TEXT NOT NULL,
    status       TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    stats_json   TEXT NOT NULL DEFAULT '{}',
    error        TEXT
  );

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Append-only record of every state change; the auto-apply phase depends on it.
  CREATE TABLE audit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      TEXT NOT NULL,
    actor   TEXT NOT NULL,
    action  TEXT NOT NULL,
    job_id  TEXT,
    detail  TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_audit_job ON audit_log(job_id);
  `,
  `
  CREATE TABLE applications (
    id            TEXT PRIMARY KEY,
    job_id        TEXT NOT NULL REFERENCES jobs(id),
    status        TEXT NOT NULL,
    ats           TEXT,
    apply_url     TEXT NOT NULL,
    packet_json   TEXT,
    answers_json  TEXT NOT NULL DEFAULT '{}',
    files_json    TEXT NOT NULL DEFAULT '{"resume":null,"coverLetter":null,"screenshots":[]}',
    report_json   TEXT,
    mode          TEXT,
    note          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    approved_at   TEXT,
    submit_attempted_at TEXT,
    submitted_at  TEXT
  );
  CREATE INDEX idx_applications_job ON applications(job_id);
  CREATE INDEX idx_applications_status ON applications(status);
  `,
];

export function openDatabase(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'jobpilot.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function openInMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
