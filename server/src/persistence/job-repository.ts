import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  Job,
  JobSourceRef,
  JobStatus,
  JobSummary,
  NormalizedJob,
  RemoteType,
  ScoreBreakdown,
  SourceId,
} from '../domain/job.js';

export interface JobQuery {
  q?: string | undefined;
  status?: JobStatus | 'active' | 'all' | undefined;
  source?: SourceId | undefined;
  remoteType?: RemoteType | undefined;
  minScore?: number | undefined;
  starred?: boolean | undefined;
  sinceDays?: number | undefined;
  sort?: 'score' | 'posted' | 'seen' | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface JobPatch {
  status?: JobStatus | undefined;
  starred?: boolean | undefined;
  notes?: string | undefined;
}

export interface UpsertResult {
  outcome: 'inserted' | 'updated';
  id: string;
}

type Row = Record<string, SQLInputValue>;

const SUMMARY_COLUMNS = `id, dedupe_key, title, company, company_logo, location, remote_type, employment_type,
  salary_min, salary_max, salary_currency, salary_period, salary_text, apply_url, tags_json, primary_source,
  sources_json, posted_at, first_seen_at, last_seen_at, score, score_json, status, starred, notes, updated_at,
  substr(description_text, 1, 280) AS snippet`;

export class JobRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Inserts a new listing (scored with `score`), or merges a duplicate into the existing row while keeping your status and notes. */
  upsert(job: NormalizedJob, score: ScoreBreakdown, now = new Date().toISOString()): UpsertResult {
    const existing = this.db.prepare('SELECT * FROM jobs WHERE dedupe_key = ?').get(job.dedupeKey) as Row | undefined;
    const ref: JobSourceRef = { source: job.source, sourceJobId: job.sourceJobId, url: job.applyUrl };

    if (!existing) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO jobs (id, dedupe_key, title, company, company_logo, location, remote_type, employment_type,
            salary_min, salary_max, salary_currency, salary_period, salary_text, description_html, description_text,
            apply_url, tags_json, primary_source, sources_json, posted_at, first_seen_at, last_seen_at, score, score_json,
            status, starred, notes, updated_at)
           VALUES (:id, :dedupeKey, :title, :company, :companyLogo, :location, :remoteType, :employmentType,
            :salaryMin, :salaryMax, :salaryCurrency, :salaryPeriod, :salaryText, :descriptionHtml, :descriptionText,
            :applyUrl, :tags, :source, :sources, :postedAt, :now, :now, :score, :scoreJson, 'new', 0, '', :now)`,
        )
        .run({
          id,
          dedupeKey: job.dedupeKey,
          title: job.title,
          company: job.company,
          companyLogo: job.companyLogo,
          location: job.location,
          remoteType: job.remoteType,
          employmentType: job.employmentType,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryCurrency: job.salaryCurrency,
          salaryPeriod: job.salaryPeriod,
          salaryText: job.salaryText,
          descriptionHtml: job.descriptionHtml,
          descriptionText: job.descriptionText,
          applyUrl: job.applyUrl,
          tags: JSON.stringify(job.tags),
          source: job.source,
          sources: JSON.stringify([ref]),
          postedAt: job.postedAt,
          now,
          score: score.total,
          scoreJson: JSON.stringify(score),
        });
      return { outcome: 'inserted', id };
    }

    const sources = JSON.parse(String(existing.sources_json)) as JobSourceRef[];
    const known = sources.findIndex((s) => s.source === ref.source);
    if (known >= 0) sources[known] = ref;
    else sources.push(ref);

    // Keep the richest version of each field across boards.
    const richer = job.descriptionText.length > String(existing.description_text).length;
    this.db
      .prepare(
        `UPDATE jobs SET
           sources_json = :sources,
           last_seen_at = :now,
           description_html = CASE WHEN :richer THEN :descriptionHtml ELSE description_html END,
           description_text = CASE WHEN :richer THEN :descriptionText ELSE description_text END,
           company_logo = COALESCE(company_logo, :companyLogo),
           employment_type = COALESCE(employment_type, :employmentType),
           salary_min = COALESCE(salary_min, :salaryMin),
           salary_max = COALESCE(salary_max, :salaryMax),
           salary_currency = COALESCE(salary_currency, :salaryCurrency),
           salary_period = COALESCE(salary_period, :salaryPeriod),
           salary_text = COALESCE(salary_text, :salaryText),
           posted_at = COALESCE(posted_at, :postedAt)
         WHERE id = :id`,
      )
      .run({
        id: existing.id as string,
        sources: JSON.stringify(sources),
        now,
        richer: richer ? 1 : 0,
        descriptionHtml: job.descriptionHtml,
        descriptionText: job.descriptionText,
        companyLogo: job.companyLogo,
        employmentType: job.employmentType,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        salaryPeriod: job.salaryPeriod,
        salaryText: job.salaryText,
        postedAt: job.postedAt,
      });
    // The caller rescores the merged row, since merged fields can change the score.
    return { outcome: 'updated', id: String(existing.id) };
  }

  hasDedupeKey(dedupeKey: string): boolean {
    return this.db.prepare('SELECT 1 FROM jobs WHERE dedupe_key = ?').get(dedupeKey) !== undefined;
  }

  list(query: JobQuery): { items: JobSummary[]; total: number } {
    const where: string[] = [];
    const params: Record<string, SQLInputValue> = {};

    const status = query.status ?? 'active';
    if (status === 'active') where.push(`status != 'hidden'`);
    else if (status !== 'all') {
      where.push('status = :status');
      params.status = status;
    }
    if (query.q) {
      where.push('(title LIKE :q ESCAPE \'\\\' OR company LIKE :q ESCAPE \'\\\' OR description_text LIKE :q ESCAPE \'\\\')');
      params.q = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }
    if (query.source) {
      where.push(`EXISTS (SELECT 1 FROM json_each(sources_json) WHERE json_extract(value, '$.source') = :source)`);
      params.source = query.source;
    }
    if (query.remoteType) {
      where.push('remote_type = :remoteType');
      params.remoteType = query.remoteType;
    }
    if (query.minScore !== undefined) {
      where.push('score >= :minScore');
      params.minScore = query.minScore;
    }
    if (query.starred) where.push('starred = 1');
    if (query.sinceDays !== undefined) {
      where.push('first_seen_at >= :since');
      params.since = new Date(Date.now() - query.sinceDays * 86_400_000).toISOString();
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = {
      score: 'score DESC, first_seen_at DESC',
      posted: 'COALESCE(posted_at, first_seen_at) DESC, score DESC',
      seen: 'first_seen_at DESC, score DESC',
    }[query.sort ?? 'score'];

    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM jobs ${whereSql}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM jobs ${whereSql} ORDER BY ${orderSql} LIMIT :limit OFFSET :offset`)
      .all({ ...params, limit: Math.min(query.limit ?? 50, 200), offset: query.offset ?? 0 }) as Row[];
    return { items: rows.map(toSummary), total };
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
    return row ? toJob(row) : undefined;
  }

  /** Open listings at or above `minScore` that have never had an application of any status, best first. */
  listPrepareCandidates(minScore: number, limit: number): Job[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM jobs WHERE status IN ('new', 'saved') AND score >= ?
           AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
         ORDER BY score DESC, first_seen_at DESC LIMIT ?`,
      )
      .all(minScore, limit) as Row[];
    return rows.map(toJob);
  }

  update(id: string, patch: JobPatch, now = new Date().toISOString()): Job | undefined {
    const sets: string[] = ['updated_at = :now'];
    const params: Record<string, SQLInputValue> = { id, now };
    if (patch.status !== undefined) {
      sets.push('status = :status');
      params.status = patch.status;
    }
    if (patch.starred !== undefined) {
      sets.push('starred = :starred');
      params.starred = patch.starred ? 1 : 0;
    }
    if (patch.notes !== undefined) {
      sets.push('notes = :notes');
      params.notes = patch.notes;
    }
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = :id`).run(params);
    return this.get(id);
  }

  /** Streams every listing for rescoring after the profile changes. */
  *iterateForScoring(): Generator<{ id: string; job: NormalizedJob }> {
    const rows = this.db.prepare('SELECT * FROM jobs').all() as Row[];
    for (const row of rows) {
      const job = toJob(row);
      yield { id: job.id, job: { ...job, source: job.primarySource, sourceJobId: job.sources[0]?.sourceJobId ?? job.id } };
    }
  }

  updateScore(id: string, score: ScoreBreakdown): void {
    this.db.prepare('UPDATE jobs SET score = ?, score_json = ? WHERE id = ?').run(score.total, JSON.stringify(score), id);
  }

  stats(now = new Date()) {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const scalar = (sql: string, ...args: SQLInputValue[]) =>
      Number((this.db.prepare(sql).get(...args) as { n: number | null }).n ?? 0);

    const byStatus = Object.fromEntries(
      (this.db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all() as Array<{ status: string; n: number }>).map(
        (r) => [r.status, r.n],
      ),
    );
    const bySource = Object.fromEntries(
      (
        this.db
          .prepare(
            `SELECT json_extract(value, '$.source') AS source, COUNT(*) AS n
             FROM jobs, json_each(jobs.sources_json) WHERE status != 'hidden' GROUP BY source`,
          )
          .all() as Array<{ source: string; n: number }>
      ).map((r) => [r.source, r.n]),
    );
    return {
      active: scalar(`SELECT COUNT(*) AS n FROM jobs WHERE status != 'hidden'`),
      newToday: scalar(`SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ?`, startOfDay.toISOString()),
      strongMatches: scalar(`SELECT COUNT(*) AS n FROM jobs WHERE score >= 75 AND status != 'hidden'`),
      averageScore: Math.round(scalar(`SELECT AVG(score) AS n FROM jobs WHERE status != 'hidden'`)),
      remote: scalar(`SELECT COUNT(*) AS n FROM jobs WHERE remote_type = 'remote' AND status != 'hidden'`),
      byStatus,
      bySource,
    };
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function toSummary(row: Row): JobSummary {
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    title: String(row.title),
    company: String(row.company),
    companyLogo: (row.company_logo as string | null) ?? null,
    location: String(row.location),
    remoteType: row.remote_type as RemoteType,
    employmentType: (row.employment_type as string | null) ?? null,
    salaryMin: (row.salary_min as number | null) ?? null,
    salaryMax: (row.salary_max as number | null) ?? null,
    salaryCurrency: (row.salary_currency as string | null) ?? null,
    salaryPeriod: (row.salary_period as Job['salaryPeriod']) ?? null,
    salaryText: (row.salary_text as string | null) ?? null,
    applyUrl: String(row.apply_url),
    tags: parseJson<string[]>(row.tags_json, []),
    primarySource: row.primary_source as SourceId,
    sources: parseJson<JobSourceRef[]>(row.sources_json, []),
    postedAt: (row.posted_at as string | null) ?? null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    score: Number(row.score),
    scoreBreakdown: parseJson<ScoreBreakdown>(row.score_json, {} as ScoreBreakdown),
    status: row.status as JobStatus,
    starred: Number(row.starred) === 1,
    notes: String(row.notes ?? ''),
    updatedAt: String(row.updated_at),
    snippet: String(row.snippet ?? String(row.description_text ?? '').slice(0, 280)),
  };
}

function toJob(row: Row): Job {
  const { snippet: _snippet, ...summary } = toSummary(row);
  return { ...summary, descriptionHtml: String(row.description_html), descriptionText: String(row.description_text) };
}
