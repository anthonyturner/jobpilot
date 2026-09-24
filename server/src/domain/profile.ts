import cron from 'node-cron';
import { z } from 'zod';
import { SOURCE_IDS } from './job.js';

const shortText = (max: number) => z.string().trim().min(1).max(max);
const boardSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'Board slugs may only contain letters, digits and dashes');

export const SkillSchema = z.object({
  name: shortText(60),
  aliases: z.array(shortText(60)).max(10).default([]),
  /** 1 = nice to have, 2 = core, 3 = signature skill. */
  weight: z.number().int().min(1).max(3).default(2),
});
export type Skill = z.infer<typeof SkillSchema>;

export const ProfileSchema = z.object({
  fullName: shortText(120),
  headline: z.string().trim().max(200).default(''),
  primaryLocation: shortText(120),
  preferredLocations: z.array(shortText(120)).max(20).default([]),
  remotePreference: z.enum(['remote-only', 'remote-or-hybrid', 'any']).default('remote-or-hybrid'),
  searchQueries: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
  targetTitles: z.array(shortText(80)).max(30).default([]),
  skills: z.array(SkillSchema).max(80).default([]),
  excludeKeywords: z.array(shortText(60)).max(40).default([]),
  minSalary: z.number().int().min(0).max(2_000_000).nullable().default(null),
  /** Listings scoring below this are discarded at ingest so the board stays signal, not noise. */
  minScoreToKeep: z.number().int().min(0).max(100).default(30),
  maxAgeDays: z.number().int().min(1).max(120).default(30),
  enabledSources: z.partialRecord(z.enum(SOURCE_IDS), z.boolean()).default({}),
  companyBoards: z
    .object({
      greenhouse: z.array(boardSlug).max(50).default([]),
      lever: z.array(boardSlug).max(50).default([]),
    })
    .default({ greenhouse: [], lever: [] }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ScheduleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: shortText(60),
  cron: z.string().trim().refine((expr) => cron.validate(expr), 'Not a valid cron expression'),
  enabled: z.boolean(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;
export const SchedulesSchema = z.array(ScheduleSchema).max(12);
