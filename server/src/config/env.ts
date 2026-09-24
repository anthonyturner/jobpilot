import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repository root (two levels above server/src/config). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  // .env is optional; every setting has a safe default or disables its feature.
}

const optionalSecret = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(7317),
  // Guardrail: the API only ever binds to loopback. There is deliberately no option for 0.0.0.0.
  HOST: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),
  DATA_DIR: z.string().default(path.join(REPO_ROOT, 'data')),
  // Defaults to this computer's time zone, so schedules fire at local times.
  TIMEZONE: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CONTACT_EMAIL: optionalSecret,

  INGEST_TOKEN: optionalSecret,

  ADZUNA_APP_ID: optionalSecret,
  ADZUNA_APP_KEY: optionalSecret,
  USAJOBS_API_KEY: optionalSecret,
  JSEARCH_API_KEY: optionalSecret,

  INDEED_VIA_CLAUDE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CLAUDE_BIN: z.string().default('claude'),

  // Phase 2: assisted applying
  RESUME_PATH: z.string().trim().default(''),
  CHROME_PATH: optionalSecret,
  TAILOR_MODEL: z.string().trim().regex(/^[a-z0-9.\[\]-]+$/i).default('sonnet'),
  TAILOR_MAX_BUDGET_USD: z.string().regex(/^\d+(\.\d{1,2})?$/).default('1.00'),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>> & { readonly webDistDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return Object.freeze({
    ...parsed.data,
    webDistDir: path.join(REPO_ROOT, 'web', 'dist', 'web', 'browser'),
  });
}
