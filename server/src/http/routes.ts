import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JOB_STATUSES, REMOTE_TYPES, SOURCE_IDS } from '../domain/job.js';
import { ProfileSchema, SchedulesSchema } from '../domain/profile.js';
import type { AuditRepository } from '../persistence/audit-repository.js';
import type { JobRepository } from '../persistence/job-repository.js';
import type { RunRepository } from '../persistence/run-repository.js';
import type { AggregationService } from '../services/aggregation-service.js';
import type { ProfileStore } from '../services/profile-store.js';
import type { SchedulerService } from '../services/scheduler-service.js';
import { ListingSchema, listingToRaw } from '../sources/indeed-via-claude.js';
import type { SourceRegistry } from '../sources/source-registry.js';
import { parseOrThrow } from './validation.js';

export interface RouteDeps {
  jobs: JobRepository;
  runs: RunRepository;
  audit: AuditRepository;
  profiles: ProfileStore;
  registry: SourceRegistry;
  aggregation: AggregationService;
  scheduler: SchedulerService;
}

const IdParams = z.object({ id: z.uuid() });
const RunIdParams = z.object({ id: z.coerce.number().int().positive() });

const JobListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...JOB_STATUSES, 'active', 'all']).optional(),
  source: z.enum(SOURCE_IDS).optional(),
  remoteType: z.enum(REMOTE_TYPES).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  starred: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
  sort: z.enum(['score', 'posted', 'seen']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

const JobPatchBody = z
  .object({
    status: z.enum(JOB_STATUSES).optional(),
    starred: z.boolean().optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const StartRunBody = z.object({ sources: z.array(z.enum(SOURCE_IDS)).max(SOURCE_IDS.length).optional() }).default({});

const IngestBody = z.object({
  source: z.enum(SOURCE_IDS),
  jobs: z.array(ListingSchema).min(1).max(300),
});

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { jobs, runs, audit, profiles, registry, aggregation, scheduler } = deps;

  app.get('/api/health', async () => ({ ok: true, activeRunId: aggregation.currentRunId }));

  // ---- Jobs -------------------------------------------------------------
  app.get('/api/jobs', async (req) => jobs.list(parseOrThrow(JobListQuery, req.query)));

  app.get('/api/jobs/:id', async (req, reply) => {
    const { id } = parseOrThrow(IdParams, req.params);
    const job = jobs.get(id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return { ...job, history: audit.forJob(id) };
  });

  app.patch('/api/jobs/:id', async (req, reply) => {
    const { id } = parseOrThrow(IdParams, req.params);
    const patch = parseOrThrow(JobPatchBody, req.body);
    const before = jobs.get(id);
    if (!before) return reply.code(404).send({ error: 'Job not found' });
    const after = jobs.update(id, patch)!;
    if (patch.status && patch.status !== before.status) {
      audit.record('user', 'job.status', id, `${before.status} -> ${patch.status}`);
    }
    if (patch.starred !== undefined && patch.starred !== before.starred) {
      audit.record('user', patch.starred ? 'job.starred' : 'job.unstarred', id);
    }
    if (patch.notes !== undefined && patch.notes !== before.notes) audit.record('user', 'job.notes', id);
    return after;
  });

  app.get('/api/stats', async () => {
    const lastRun = runs.list(1)[0] ?? null;
    return { ...jobs.stats(), lastRun, activeRunId: aggregation.currentRunId };
  });

  // ---- Runs -------------------------------------------------------------
  app.get('/api/runs', async () => runs.list(40));

  app.get('/api/runs/:id', async (req, reply) => {
    const { id } = parseOrThrow(RunIdParams, req.params);
    return runs.get(id) ?? reply.code(404).send({ error: 'Run not found' });
  });

  app.post('/api/runs', async (req, reply) => {
    const body = parseOrThrow(StartRunBody, req.body ?? {});
    const { runId, alreadyRunning } = aggregation.startRun('manual', body.sources);
    return reply.code(alreadyRunning ? 200 : 202).send({ runId, alreadyRunning });
  });

  // ---- Profile, schedules, sources -------------------------------------
  app.get('/api/profile', async () => profiles.getProfile());

  app.put('/api/profile', async (req) => {
    const saved = profiles.saveProfile(parseOrThrow(ProfileSchema, req.body));
    const rescored = aggregation.rescoreAll(saved);
    audit.record('user', 'profile.updated', null, `Rescored ${rescored} jobs`);
    return saved;
  });

  app.get('/api/schedules', async () => ({
    timezone: scheduler.timezone,
    schedules: scheduler.describe(profiles.getSchedules()),
  }));

  app.put('/api/schedules', async (req) => {
    const saved = profiles.saveSchedules(parseOrThrow(SchedulesSchema, req.body));
    scheduler.apply(saved);
    audit.record('user', 'schedules.updated', null, saved.map((s) => `${s.id}:${s.enabled ? s.cron : 'off'}`).join(', '));
    return { timezone: scheduler.timezone, schedules: scheduler.describe(saved) };
  });

  app.get('/api/sources', async () => {
    const profile = profiles.getProfile();
    return registry.all().map((s) => ({
      ...s.descriptor,
      enabled: profile.enabledSources[s.descriptor.id] !== false,
      ...s.status(profile),
    }));
  });

  // ---- Ingest (bearer token; used by the /find-jobs Claude Code command) --
  app.post('/api/ingest', async (req) => {
    const body = parseOrThrow(IngestBody, req.body);
    return aggregation.ingest(
      body.source,
      body.jobs.map((j) => listingToRaw(j, body.source)),
    );
  });
}
