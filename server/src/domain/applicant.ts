import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).default('');
const httpUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Must be an http(s) link')
  .default('');
/** null means "not answered yet": questions about it stop automation and ask the owner. */
const triState = z.boolean().nullable().default(null);

/**
 * Facts used to fill application forms. Stored only in the local database.
 * Anything left blank or null is never guessed; a required question about it
 * pauses the application for the owner.
 */
export const ApplicantSchema = z.object({
  firstName: optionalText(60),
  lastName: optionalText(60),
  email: optionalText(200),
  phone: optionalText(40),
  location: optionalText(120),
  country: optionalText(80),
  currentCompany: optionalText(120),
  currentTitle: optionalText(120),
  linkedin: httpUrl,
  github: httpUrl,
  portfolio: httpUrl,
  workAuthorizedUS: triState,
  requiresSponsorship: triState,
  willingToRelocate: triState,
  salaryExpectation: optionalText(120),
  availability: optionalText(120),
  howDidYouHear: optionalText(120),
  /** Voluntary self-identification questions are answered "decline" unless the owner opts in to a value. */
  eeo: z
    .object({
      gender: optionalText(60),
      race: optionalText(80),
      veteran: optionalText(80),
      disability: optionalText(80),
    })
    .default({ gender: '', race: '', veteran: '', disability: '' }),
  /** Allows ticking required privacy / data-processing consent boxes. Off until the owner turns it on. */
  acceptDataConsent: z.boolean().default(false),
  answerBank: z
    .array(z.object({ question: z.string().trim().min(3).max(200), answer: z.string().trim().min(1).max(2000) }))
    .max(100)
    .default([]),
});
export type Applicant = z.infer<typeof ApplicantSchema>;

export const ATS_IDS = ['greenhouse', 'lever'] as const;
export type AtsId = (typeof ATS_IDS)[number];
export type AtsMode = 'off' | 'preview' | 'submit';

/** Unattended preparation (`npm run auto-prepare`): tailors the best matches and stops at review. */
export const AutoPrepareSchema = z.object({
  enabled: z.boolean().default(false),
  /** The run tops the waiting-for-review queue up to this many; each tailoring can cost up to about $2. */
  topN: z.number().int().min(1).max(10).default(3),
  minScore: z.number().int().min(0).max(100).default(75),
});

export const AutomationSchema = z.object({
  /** Master kill switch. Off stops every browser automation, including runs in progress. */
  enabled: z.boolean().default(true),
  modes: z
    .object({
      greenhouse: z.enum(['off', 'preview', 'submit']).default('preview'),
      lever: z.enum(['off', 'preview', 'submit']).default('preview'),
    })
    .default({ greenhouse: 'preview', lever: 'preview' }),
  dailySubmitCap: z.number().int().min(0).max(50).default(10),
  sameCompanyGapHours: z.number().int().min(0).max(24 * 30).default(72),
  autoPrepare: AutoPrepareSchema.default({ enabled: false, topN: 3, minScore: 75 }),
});
export type Automation = z.infer<typeof AutomationSchema>;

export const DEFAULT_AUTOMATION: Automation = AutomationSchema.parse({});
export const EMPTY_APPLICANT: Applicant = ApplicantSchema.parse({});
