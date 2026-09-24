import type { RawJob } from '../domain/job.js';
import type { Profile } from '../domain/profile.js';
import type { JobSource, SourceContext, SourceStatus } from './job-source.js';

/**
 * Greenhouse and Lever host the career pages of thousands of companies and publish
 * them through public, documented JSON APIs. You list the companies you care about
 * on the Settings page; slugs are validated so they cannot alter the request path.
 */
export class GreenhouseSource implements JobSource {
  readonly descriptor = {
    id: 'greenhouse',
    name: 'Greenhouse company boards',
    homepage: 'https://developers.greenhouse.io/job-board.html',
    kind: 'api',
    notes: 'Career pages of companies you follow (boards.greenhouse.io/<slug>). Add slugs in Settings.',
  } as const;
  readonly hosts = ['boards-api.greenhouse.io'];

  status(profile: Profile): SourceStatus {
    const count = profile.companyBoards.greenhouse.length;
    return count > 0
      ? { configured: true, detail: `${count} compan${count === 1 ? 'y' : 'ies'} followed` }
      : { configured: false, detail: 'Add company board slugs in Settings' };
  }

  async fetchJobs({ profile, http, log }: SourceContext): Promise<RawJob[]> {
    const jobs: RawJob[] = [];
    for (const slug of profile.companyBoards.greenhouse) {
      try {
        const data = await http.getJson<{ jobs?: GreenhouseJob[] }>(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
        );
        for (const j of data.jobs ?? []) {
          jobs.push({
            source: 'greenhouse',
            sourceJobId: `${slug}:${j.id}`,
            title: j.title,
            company: j.company_name ?? prettySlug(slug),
            location: j.location?.name ?? '',
            // Greenhouse double-encodes content; decode once so the sanitizer sees real tags.
            descriptionHtml: decodeHtmlEntities(j.content ?? ''),
            applyUrl: j.absolute_url,
            postedAt: j.first_published ?? j.updated_at,
          });
        }
      } catch (error) {
        log.warn(`Greenhouse board "${slug}" failed: ${(error as Error).message}`);
      }
    }
    return jobs;
  }
}
interface GreenhouseJob {
  id: number;
  title: string;
  company_name?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
  first_published?: string;
}

export class LeverSource implements JobSource {
  readonly descriptor = {
    id: 'lever',
    name: 'Lever company boards',
    homepage: 'https://github.com/lever/postings-api',
    kind: 'api',
    notes: 'Career pages of companies you follow (jobs.lever.co/<slug>). Add slugs in Settings.',
  } as const;
  readonly hosts = ['api.lever.co'];

  status(profile: Profile): SourceStatus {
    const count = profile.companyBoards.lever.length;
    return count > 0
      ? { configured: true, detail: `${count} compan${count === 1 ? 'y' : 'ies'} followed` }
      : { configured: false, detail: 'Add company board slugs in Settings' };
  }

  async fetchJobs({ profile, http, log }: SourceContext): Promise<RawJob[]> {
    const jobs: RawJob[] = [];
    for (const slug of profile.companyBoards.lever) {
      try {
        const data = await http.getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
        for (const j of data) {
          jobs.push({
            source: 'lever',
            sourceJobId: j.id,
            title: j.text,
            company: prettySlug(slug),
            location: j.categories?.location ?? '',
            remoteType: j.workplaceType === 'remote' ? 'remote' : j.workplaceType === 'hybrid' ? 'hybrid' : undefined,
            employmentType: j.categories?.commitment,
            descriptionHtml: [j.description, ...(j.lists ?? []).map((l) => `<h4>${l.text}</h4><ul>${l.content}</ul>`), j.additional]
              .filter(Boolean)
              .join(''),
            applyUrl: j.hostedUrl,
            postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
            tags: j.categories?.team ? [j.categories.team] : undefined,
          });
        }
      } catch (error) {
        log.warn(`Lever board "${slug}" failed: ${(error as Error).message}`);
      }
    }
    return jobs;
  }
}
interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  workplaceType?: string;
  description?: string;
  additional?: string;
  lists?: Array<{ text: string; content: string }>;
  categories?: { location?: string; commitment?: string; team?: string };
}

function prettySlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
