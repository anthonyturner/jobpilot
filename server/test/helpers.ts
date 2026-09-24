import type { RawJob } from '../src/domain/job.js';
import { SAMPLE_PROFILE } from './fixtures.js';
import type { Profile } from '../src/domain/profile.js';

export function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: 'remotive',
    sourceJobId: '1',
    title: 'Senior Full Stack Engineer (Angular / .NET)',
    company: 'Acme Inc.',
    location: 'Remote',
    applyUrl: 'https://example.com/jobs/1',
    descriptionHtml: '<p>We use Angular, TypeScript, C#, ASP.NET Core, SQL Server and Azure.</p>',
    postedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function profile(overrides: Partial<Profile> = {}): Profile {
  return structuredClone({ ...SAMPLE_PROFILE, ...overrides });
}
