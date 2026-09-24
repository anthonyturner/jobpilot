import type { RawJob } from '../domain/job.js';
import type { Profile } from '../domain/profile.js';
import { isoFromEpochSeconds, queriesFor, type JobSource, type SourceContext, type SourceStatus } from './job-source.js';

const ALWAYS_READY: SourceStatus = { configured: true, detail: 'No key needed' };

/** Remotive public API. Terms: link back to the listing and keep calls to a few per day. */
export class RemotiveSource implements JobSource {
  readonly descriptor = {
    id: 'remotive',
    name: 'Remotive',
    homepage: 'https://remotive.com',
    kind: 'api',
    notes: 'Remote-only board. Public API; terms ask for links back to Remotive and no more than a few calls a day.',
  } as const;
  readonly hosts = ['remotive.com'];

  status(): SourceStatus {
    return ALWAYS_READY;
  }

  async fetchJobs({ profile, http }: SourceContext): Promise<RawJob[]> {
    const jobs: RawJob[] = [];
    for (const query of queriesFor(profile, 3)) {
      const url = `https://remotive.com/api/remote-jobs?limit=50&search=${encodeURIComponent(query)}`;
      const data = await http.getJson<{ jobs?: RemotiveJob[] }>(url);
      for (const j of data.jobs ?? []) {
        jobs.push({
          source: 'remotive',
          sourceJobId: String(j.id),
          title: j.title,
          company: j.company_name,
          companyLogo: j.company_logo,
          location: j.candidate_required_location ? `Remote (${j.candidate_required_location})` : 'Remote',
          remoteType: 'remote',
          employmentType: j.job_type?.replace(/_/g, ' '),
          salaryText: j.salary || undefined,
          descriptionHtml: j.description,
          applyUrl: j.url,
          postedAt: j.publication_date,
          tags: j.tags,
        });
      }
    }
    return jobs;
  }
}
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  company_logo?: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  tags?: string[];
}

/** Remote OK public feed. Terms: credit Remote OK as the source and link to the listing. */
export class RemoteOkSource implements JobSource {
  readonly descriptor = {
    id: 'remoteok',
    name: 'Remote OK',
    homepage: 'https://remoteok.com',
    kind: 'api',
    notes: 'Remote-only feed of recent listings, filtered locally by your match score. Terms require crediting Remote OK and linking back.',
  } as const;
  readonly hosts = ['remoteok.com'];

  status(): SourceStatus {
    return ALWAYS_READY;
  }

  async fetchJobs({ http }: SourceContext): Promise<RawJob[]> {
    const data = await http.getJson<Array<RemoteOkJob | { legal?: string }>>('https://remoteok.com/api');
    return data
      .filter((j): j is RemoteOkJob => 'position' in j && typeof j.position === 'string')
      .map((j) => ({
        source: 'remoteok' as const,
        sourceJobId: String(j.id),
        title: j.position,
        company: j.company,
        companyLogo: j.company_logo || j.logo,
        location: j.location ? `Remote (${j.location})` : 'Remote',
        remoteType: 'remote' as const,
        salaryMin: j.salary_min,
        salaryMax: j.salary_max,
        descriptionHtml: j.description,
        applyUrl: j.url,
        postedAt: j.date ?? isoFromEpochSeconds(j.epoch),
        tags: j.tags,
      }));
  }
}
interface RemoteOkJob {
  id: string | number;
  epoch?: number;
  date?: string;
  company: string;
  company_logo?: string;
  logo?: string;
  position: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url: string;
}

/** Arbeitnow public feed (mostly Europe; off by default). */
export class ArbeitnowSource implements JobSource {
  readonly descriptor = {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    homepage: 'https://www.arbeitnow.com',
    kind: 'api',
    notes: 'Free public feed, mostly European roles. Filtered locally by your match score.',
  } as const;
  readonly hosts = ['www.arbeitnow.com'];

  status(): SourceStatus {
    return ALWAYS_READY;
  }

  async fetchJobs({ http }: SourceContext): Promise<RawJob[]> {
    const data = await http.getJson<{ data?: ArbeitnowJob[] }>('https://www.arbeitnow.com/api/job-board-api');
    return (data.data ?? []).map((j) => ({
      source: 'arbeitnow' as const,
      sourceJobId: j.slug,
      title: j.title,
      company: j.company_name,
      location: j.location,
      remoteType: j.remote ? ('remote' as const) : undefined,
      employmentType: j.job_types?.join(', '),
      descriptionHtml: j.description,
      applyUrl: j.url,
      postedAt: isoFromEpochSeconds(j.created_at),
      tags: j.tags,
    }));
  }
}
interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location: string;
  created_at?: number;
}

/** The Muse public API (no key needed at low volume). */
export class TheMuseSource implements JobSource {
  readonly descriptor = {
    id: 'themuse',
    name: 'The Muse',
    homepage: 'https://www.themuse.com',
    kind: 'api',
    notes: 'Software Engineering category, remote plus your primary location. Public API, rate limited to 500 calls an hour without a key.',
  } as const;
  readonly hosts = ['www.themuse.com'];

  status(): SourceStatus {
    return ALWAYS_READY;
  }

  async fetchJobs({ profile, http }: SourceContext): Promise<RawJob[]> {
    const locations = ['Flexible / Remote', ...this.museLocations(profile)];
    const params = new URLSearchParams({ category: 'Software Engineering', page: '0', descending: 'true' });
    for (const loc of locations) params.append('location', loc);
    const jobs: RawJob[] = [];
    for (const page of [0, 1]) {
      params.set('page', String(page));
      const data = await http.getJson<{ results?: MuseJob[] }>(`https://www.themuse.com/api/public/jobs?${params}`);
      for (const j of data.results ?? []) {
        const location = j.locations?.map((l) => l.name).join(' / ') || 'Unspecified';
        jobs.push({
          source: 'themuse',
          sourceJobId: String(j.id),
          title: j.name,
          company: j.company?.name ?? '',
          location,
          remoteType: /remote|flexible/i.test(location) ? 'remote' : undefined,
          employmentType: j.type,
          descriptionHtml: j.contents,
          applyUrl: j.refs?.landing_page ?? '',
          postedAt: j.publication_date,
          tags: j.levels?.map((l) => l.name),
        });
      }
    }
    return jobs;
  }

  /** The Muse expects "City, ST" strings; skip "Remote" since it is covered above. */
  private museLocations(profile: Profile): string[] {
    return [profile.primaryLocation, ...profile.preferredLocations]
      .filter((l) => !/remote/i.test(l))
      .slice(0, 4);
  }
}
interface MuseJob {
  id: number;
  name: string;
  type?: string;
  contents?: string;
  publication_date?: string;
  locations?: Array<{ name: string }>;
  levels?: Array<{ name: string }>;
  company?: { name: string };
  refs?: { landing_page?: string };
}
