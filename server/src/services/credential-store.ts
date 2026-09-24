import fs from 'node:fs';
import path from 'node:path';

export const CREDENTIALS = [
  { name: 'ADZUNA_APP_ID', label: 'Adzuna app ID', secret: false, helpUrl: 'https://developer.adzuna.com' },
  { name: 'ADZUNA_APP_KEY', label: 'Adzuna app key', secret: true, helpUrl: 'https://developer.adzuna.com' },
  { name: 'USAJOBS_API_KEY', label: 'USAJOBS API key', secret: true, helpUrl: 'https://developer.usajobs.gov/apirequest/' },
  { name: 'CONTACT_EMAIL', label: 'Contact email (sent to USAJOBS as required by its terms)', secret: false, helpUrl: '' },
  { name: 'JSEARCH_API_KEY', label: 'JSearch (RapidAPI) key', secret: true, helpUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch' },
  { name: 'INDEED_VIA_CLAUDE', label: 'Search Indeed through Claude Code on every sweep', secret: false, helpUrl: '' },
] as const;
export type CredentialName = (typeof CREDENTIALS)[number]['name'];

export interface CredentialStatus {
  name: CredentialName;
  label: string;
  secret: boolean;
  helpUrl: string;
  set: boolean;
  /** Where the value comes from. Values set in .env win and cannot be changed from the UI. */
  origin: 'env' | 'app' | null;
  /** Non-secret values only (e.g. the contact email). Secrets are never returned. */
  value: string | null;
}

const VALUE_PATTERN = /^[\x21-\x7e]{1,200}$/;

/**
 * API keys and integration switches. Values in the environment (.env) take
 * precedence; anything entered in the UI is stored in data/credentials.json,
 * which is git-ignored and created readable by the owner only (on POSIX).
 * Secrets are write-only through the API: it reports whether they are set, never what they are.
 */
export class CredentialStore {
  private readonly file: string;
  private cache: Partial<Record<CredentialName, string>>;

  constructor(
    dataDir: string,
    private readonly env: Partial<Record<CredentialName, string | undefined>>,
  ) {
    this.file = path.join(dataDir, 'credentials.json');
    this.cache = this.read();
  }

  get(name: CredentialName): string | undefined {
    return this.env[name] || this.cache[name] || undefined;
  }

  flag(name: CredentialName): boolean {
    return this.get(name) === 'true';
  }

  status(): CredentialStatus[] {
    return CREDENTIALS.map((c) => {
      const fromEnv = !!this.env[c.name];
      const value = this.get(c.name);
      return {
        name: c.name,
        label: c.label,
        secret: c.secret,
        helpUrl: c.helpUrl,
        set: !!value && value !== 'false',
        origin: fromEnv ? 'env' : this.cache[c.name] ? 'app' : null,
        value: c.secret ? null : (value ?? null),
      };
    });
  }

  /** Sets or clears (null/empty) values. Names set in .env are left alone. */
  update(values: Partial<Record<CredentialName, string | null>>): CredentialStatus[] {
    const next = { ...this.cache };
    for (const [name, raw] of Object.entries(values) as Array<[CredentialName, string | null]>) {
      if (!CREDENTIALS.some((c) => c.name === name)) throw new Error(`Unknown credential ${name}`);
      if (this.env[name]) continue;
      const value = raw?.trim() ?? '';
      if (!value) {
        delete next[name];
        continue;
      }
      if (!VALUE_PATTERN.test(value)) throw new Error(`${name} contains characters that are not allowed`);
      next[name] = value;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.cache = next;
    return this.status();
  }

  private read(): Partial<Record<CredentialName, string>> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter(([k, v]) => CREDENTIALS.some((c) => c.name === k) && typeof v === 'string'),
      ) as Partial<Record<CredentialName, string>>;
    } catch {
      return {};
    }
  }
}
