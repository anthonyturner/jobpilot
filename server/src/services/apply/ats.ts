import type { Page } from 'playwright-core';
import type { AtsId } from '../../domain/applicant.js';

/**
 * One applicant-tracking system. Adapters only know how to recognise their pages,
 * reach the form, and press submit; the generic filler does the rest. Add a new
 * ATS by adding an adapter to ADAPTERS (Open/Closed).
 */
export interface AtsAdapter {
  readonly id: AtsId;
  readonly name: string;
  matches(url: URL): boolean;
  /** Navigates from a posting page to the actual application form. */
  openForm(page: Page): Promise<void>;
  submit(page: Page): Promise<void>;
  readonly confirmation: RegExp;
}

const CONFIRMATION = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(submitted|received)|we('ve| have) received your application/i;

export class GreenhouseAdapter implements AtsAdapter {
  readonly id = 'greenhouse' as const;
  readonly name = 'Greenhouse';
  readonly confirmation = CONFIRMATION;

  matches(url: URL): boolean {
    return /(^|\.)greenhouse\.io$/.test(url.hostname) && /\/jobs\/\d+|job_app|embed/.test(url.pathname + url.search);
  }

  async openForm(page: Page): Promise<void> {
    // Newer boards show the form behind an "Apply" button; older ones inline it.
    if ((await page.locator('input[type="file"], #first_name').count()) === 0) {
      const apply = page.getByRole('button', { name: /^apply/i }).or(page.getByRole('link', { name: /^apply/i })).first();
      if (await apply.count()) await apply.click();
    }
    await page.locator('form').first().waitFor({ timeout: 15_000 });
  }

  async submit(page: Page): Promise<void> {
    await page.locator('#submit_app, button[type="submit"], input[type="submit"]').filter({ hasText: /submit|apply/i }).or(page.getByRole('button', { name: /submit application/i })).first().click();
  }
}

export class LeverAdapter implements AtsAdapter {
  readonly id = 'lever' as const;
  readonly name = 'Lever';
  readonly confirmation = CONFIRMATION;

  matches(url: URL): boolean {
    return /(^|\.)lever\.co$/.test(url.hostname) && url.hostname.startsWith('jobs');
  }

  async openForm(page: Page): Promise<void> {
    const url = new URL(page.url());
    if (!/\/apply\/?$/.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/apply`;
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    }
    await page.locator('form').first().waitFor({ timeout: 15_000 });
  }

  async submit(page: Page): Promise<void> {
    await page.locator('#btn-submit, button[type="submit"]').first().click();
  }
}

export const ADAPTERS: AtsAdapter[] = [new GreenhouseAdapter(), new LeverAdapter()];

export function adapterFor(url: string, adapters: AtsAdapter[] = ADAPTERS): AtsAdapter | null {
  try {
    const parsed = new URL(url);
    return adapters.find((a) => a.matches(parsed)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Follows a job link to a supported application form: the page itself, an embedded
 * ATS iframe, or an "Apply" link pointing at a supported ATS. It never clicks
 * arbitrary buttons or leaves for unknown sites.
 */
export async function locateForm(page: Page, applyUrl: string, adapters: AtsAdapter[] = ADAPTERS): Promise<AtsAdapter | null> {
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

  const direct = adapterFor(page.url(), adapters);
  if (direct) return direct;

  const candidates = await page.evaluate(() => [
    ...[...document.querySelectorAll('iframe')].map((f) => f.src),
    ...[...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
  ]);
  const target = candidates.find((href) => adapterFor(href, adapters));
  if (!target) return null;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  return adapterFor(page.url(), adapters);
}
