import type { RawJob, SalaryPeriod } from '../domain/job.js';
import { queriesFor, type JobSource, type SourceContext, type SourceStatus } from './job-source.js';

/** Adzuna: large US aggregator with a free developer key (250 calls a day). */
export class AdzunaSource implements JobSource {
  readonly descriptor = {
    id: 'adzuna',
    name: 'Adzuna',
    homepage: 'https://developer.adzuna.com',
    kind: 'api',
    notes: 'US aggregator. Free key at developer.adzuna.com; add it under Settings > API keys.',
  } as const;
  readonly hosts = ['api.adzuna.com'];

  /** Keys are read on use, so keys saved in Settings apply without a restart. */
  constructor(private readonly keys: () => { appId?: string | undefined; appKey?: string | undefined }) {}

  status(): SourceStatus {
    const { appId, appKey } = this.keys();
    return appId && appKey
      ? { configured: true, detail: 'API key set' }
      : { configured: false, detail: 'Add your Adzuna app ID and key under Settings > API keys' };
  }

  async fetchJobs({ profile, http }: SourceContext): Promise<RawJob[]> {
    const jobs: RawJob[] = [];
    const keys = this.keys();
    const searches = queriesFor(profile, 4).flatMap((q) => [
      { what: q, where: profile.primaryLocation, distance: '60' },
      { what: `${q} remote`, where: '', distance: '' },
    ]);
    for (const s of searches) {
      const params = new URLSearchParams({
        app_id: keys.appId ?? '',
        app_key: keys.appKey ?? '',
        results_per_page: '50',
        what: s.what,
        max_days_old: String(profile.maxAgeDays),
        sort_by: 'date',
        'content-type': 'application/json',
      });
      if (s.where) {
        params.set('where', s.where);
        params.set('distance', s.distance);
      }
      const data = await http.getJson<{ results?: AdzunaJob[] }>(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`);
      for (const j of data.results ?? []) {
        jobs.push({
          source: 'adzuna',
          sourceJobId: String(j.id),
          title: stripTags(j.title),
          company: j.company?.display_name ?? '',
          location: j.location?.display_name ?? '',
          employmentType: [j.contract_time, j.contract_type].filter(Boolean).join(', ').replace(/_/g, ' '),
          salaryMin: j.salary_is_predicted === '1' ? undefined : j.salary_min,
          salaryMax: j.salary_is_predicted === '1' ? undefined : j.salary_max,
          descriptionText: stripTags(j.description ?? ''),
          applyUrl: j.redirect_url,
          postedAt: j.created,
        });
      }
    }
    return jobs;
  }
}
interface AdzunaJob {
  id: string;
  title: string;
  description?: string;
  created?: string;
  redirect_url: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  contract_time?: string;
  contract_type?: string;
}

/** USAJOBS: official US federal government listings. */
export class UsaJobsSource implements JobSource {
  readonly descriptor = {
    id: 'usajobs',
    name: 'USAJOBS',
    homepage: 'https://developer.usajobs.gov',
    kind: 'api',
    notes: 'US federal roles. Free key at developer.usajobs.gov; add it and a contact email under Settings > API keys.',
  } as const;
  readonly hosts = ['data.usajobs.gov'];

  constructor(private readonly keys: () => { apiKey?: string | undefined; email?: string | undefined }) {}

  status(): SourceStatus {
    const { apiKey, email } = this.keys();
    return apiKey && email
      ? { configured: true, detail: 'API key set' }
      : { configured: false, detail: 'Add a USAJOBS API key and contact email under Settings > API keys' };
  }

  async fetchJobs({ profile, http }: SourceContext): Promise<RawJob[]> {
    const jobs: RawJob[] = [];
    const { apiKey, email } = this.keys();
    const headers = { 'Authorization-Key': apiKey ?? '', 'User-Agent': email ?? '' };
    for (const query of queriesFor(profile, 3)) {
      const params = new URLSearchParams({
        Keyword: query,
        ResultsPerPage: '50',
        DatePosted: String(Math.min(profile.maxAgeDays, 60)),
        RemoteIndicator: 'True',
      });
      const data = await http.getJson<UsaJobsResponse>(`https://data.usajobs.gov/api/search?${params}`, { headers });
      for (const item of data.SearchResult?.SearchResultItems ?? []) {
        const d = item.MatchedObjectDescriptor;
        const pay = d.PositionRemuneration?.[0];
        jobs.push({
          source: 'usajobs',
          sourceJobId: d.PositionID,
          title: d.PositionTitle,
          company: d.OrganizationName ?? d.DepartmentName ?? 'U.S. Federal Government',
          location: d.PositionLocationDisplay ?? '',
          remoteType: 'remote',
          employmentType: d.PositionSchedule?.[0]?.Name,
          salaryMin: Number(pay?.MinimumRange) || undefined,
          salaryMax: Number(pay?.MaximumRange) || undefined,
          salaryPeriod: pay?.RateIntervalCode === 'PH' ? 'hour' : 'year',
          descriptionText: [d.UserArea?.Details?.JobSummary, d.QualificationSummary].filter(Boolean).join('\n\n'),
          applyUrl: d.ApplyURI?.[0] ?? d.PositionURI,
          postedAt: d.PublicationStartDate,
        });
      }
    }
    return jobs;
  }
}
interface UsaJobsResponse {
  SearchResult?: {
    SearchResultItems?: Array<{
      MatchedObjectDescriptor: {
        PositionID: string;
        PositionTitle: string;
        PositionURI: string;
        ApplyURI?: string[];
        OrganizationName?: string;
        DepartmentName?: string;
        PositionLocationDisplay?: string;
        PositionSchedule?: Array<{ Name?: string }>;
        PositionRemuneration?: Array<{ MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }>;
        PublicationStartDate?: string;
        QualificationSummary?: string;
        UserArea?: { Details?: { JobSummary?: string } };
      };
    }>;
  };
}

/**
 * JSearch (RapidAPI) reads Google for Jobs, which covers listings from Indeed,
 * LinkedIn, Glassdoor and ZipRecruiter through a licensed API rather than scraping.
 * The free tier is small, so only the top two queries run.
 */
export class JSearchSource implements JobSource {
  readonly descriptor = {
    id: 'jsearch',
    name: 'JSearch (LinkedIn, Glassdoor, ZipRecruiter)',
    homepage: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    kind: 'api',
    notes: 'Google for Jobs via RapidAPI, covering LinkedIn, Glassdoor, ZipRecruiter and more. Add a key under Settings > API keys. Free tier is small, so only 2 queries run each sweep.',
  } as const;
  readonly hosts = ['jsearch.p.rapidapi.com'];

  constructor(private readonly apiKey: () => string | undefined) {}

  status(): SourceStatus {
    return this.apiKey()
      ? { configured: true, detail: 'API key set' }
      : { configured: false, detail: 'Add a JSearch key under Settings > API keys' };
  }

  async fetchJobs({ profile, http }: SourceContext): Promise<RawJob[]> {
    const headers = { 'X-RapidAPI-Key': this.apiKey() ?? '', 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' };
    const jobs: RawJob[] = [];
    const datePosted = profile.maxAgeDays <= 3 ? '3days' : profile.maxAgeDays <= 7 ? 'week' : 'month';
    for (const query of queriesFor(profile, 2)) {
      const where = profile.remotePreference === 'remote-only' ? '' : ` in ${profile.primaryLocation}`;
      const params = new URLSearchParams({ query: `${query}${where}`, page: '1', num_pages: '1', date_posted: datePosted, country: 'us' });
      if (profile.remotePreference === 'remote-only') params.set('work_from_home', 'true');
      const data = await http.getJson<{ data?: JSearchJob[] }>(`https://jsearch.p.rapidapi.com/search?${params}`, { headers });
      for (const j of data.data ?? []) {
        jobs.push({
          source: 'jsearch',
          sourceJobId: j.job_id,
          title: j.job_title,
          company: j.employer_name,
          companyLogo: j.employer_logo ?? undefined,
          location: [j.job_city, j.job_state].filter(Boolean).join(', ') || (j.job_is_remote ? 'Remote' : ''),
          remoteType: j.job_is_remote ? 'remote' : undefined,
          employmentType: j.job_employment_type ?? undefined,
          salaryMin: j.job_min_salary ?? undefined,
          salaryMax: j.job_max_salary ?? undefined,
          salaryPeriod: toPeriod(j.job_salary_period),
          descriptionText: j.job_description,
          applyUrl: j.job_apply_link,
          postedAt: j.job_posted_at_datetime_utc ?? undefined,
          tags: j.job_publisher ? [`via ${j.job_publisher}`] : undefined,
        });
      }
    }
    return jobs;
  }
}
interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  employer_logo?: string | null;
  job_publisher?: string;
  job_apply_link: string;
  job_description?: string;
  job_is_remote?: boolean;
  job_city?: string | null;
  job_state?: string | null;
  job_employment_type?: string | null;
  job_posted_at_datetime_utc?: string | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
}

function toPeriod(value: string | null | undefined): SalaryPeriod | undefined {
  switch (value?.toUpperCase()) {
    case 'HOUR':
      return 'hour';
    case 'DAY':
      return 'day';
    case 'WEEK':
      return 'week';
    case 'MONTH':
      return 'month';
    case 'YEAR':
      return 'year';
    default:
      return undefined;
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}
