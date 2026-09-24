import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { AtsId } from '../../domain/applicant.js';
import type { FilledField, OpenQuestion } from '../../domain/application.js';
import { ADAPTERS, locateForm, type AtsAdapter } from './ats.js';
import type { MatchContext } from './field-matcher.js';
import { fillFields, findBlockers, readFields, type Files } from './form-page.js';

export interface AutomationRequest {
  applicationId: string;
  applyUrl: string;
  /** Visible browser left open for the owner (they press submit themselves). */
  headed: boolean;
  /** Press the ATS submit button after filling. Only ever true for an approved, confirmed request. */
  submit: boolean;
  ctx: MatchContext;
  files: Files;
  outDir: string;
  allowAts(id: AtsId): boolean;
  /** Called immediately before the submit click; lets the caller record the attempt (at-most-once). */
  beforeSubmit?(): void;
}

export interface AutomationOutcome {
  ats: AtsId | null;
  url: string;
  filled: FilledField[];
  open: OpenQuestion[];
  blockers: string[];
  screenshot: string | null;
  submitted: boolean;
  confirmed: boolean;
}

export interface FormAutomation {
  run(request: AutomationRequest): Promise<AutomationOutcome>;
  /** Kill switch: closes every browser this process opened, including visible ones. */
  closeAll(): Promise<void>;
}

const CONFIRM_WAIT_MS = 30_000;

/**
 * tsx/esbuild wraps named functions with a `__name` helper, which does not exist
 * inside the page when we pass functions to page.evaluate. Define a no-op there.
 */
const EVALUATE_SHIM = 'globalThis.__name = globalThis.__name || ((fn) => fn);';

export class PlaywrightFormAutomation implements FormAutomation {
  private readonly headed = new Map<string, BrowserContext>();
  private readonly headless = new Set<Browser>();

  constructor(
    private readonly chromePath: string | null,
    /** Dedicated profile directory, never the owner's everyday browser profile. */
    private readonly profileDir: string,
    private readonly adapters: AtsAdapter[] = ADAPTERS,
  ) {}

  async run(request: AutomationRequest): Promise<AutomationOutcome> {
    if (!this.chromePath) throw new Error('Chrome or Edge was not found. Set CHROME_PATH in .env.');
    const { page, close } = await this.openPage(request);
    const outcome: AutomationOutcome = { ats: null, url: request.applyUrl, filled: [], open: [], blockers: [], screenshot: null, submitted: false, confirmed: false };
    try {
      const adapter = await locateForm(page, request.applyUrl, this.adapters);
      outcome.url = page.url();
      if (!adapter) {
        outcome.blockers.push("This employer doesn't use Greenhouse or Lever, so JobPilot can't fill the form. Your documents are ready; apply on their site.");
        return outcome;
      }
      outcome.ats = adapter.id;
      if (!request.allowAts(adapter.id)) {
        outcome.blockers.push(`Automation for ${adapter.name} is turned off in Settings.`);
        return outcome;
      }

      await adapter.openForm(page);
      outcome.url = page.url();
      outcome.blockers.push(...(await findBlockers(page)));
      if (outcome.blockers.length) return outcome;

      const fields = await readFields(page);
      if (fields.length === 0) {
        outcome.blockers.push('No application form was found on the page.');
        return outcome;
      }
      const { filled, open } = await fillFields(page, fields, request.ctx, request.files);
      outcome.filled = filled;
      outcome.open = open;
      outcome.blockers.push(...(await findBlockers(page)));
      outcome.screenshot = await this.screenshot(page, request.outDir, request.submit ? 'before-submit' : 'preview');

      const ready = outcome.blockers.length === 0 && !open.some((q) => q.required);
      if (request.submit && ready) {
        request.beforeSubmit?.();
        await adapter.submit(page);
        outcome.submitted = true;
        outcome.confirmed = await this.waitForConfirmation(page, adapter, outcome);
        outcome.screenshot = await this.screenshot(page, request.outDir, 'after-submit');
      }
      return outcome;
    } catch (error) {
      // Dead links, timeouts and odd pages become a message for the owner, not a crash.
      // If submit was already pressed, `submitted` stays true so the caller never retries.
      const message = (error as Error).message.split('\n')[0]!.slice(0, 200);
      outcome.blockers.push(`JobPilot couldn't work with this page (${message}). Open the posting and apply yourself.`);
      outcome.screenshot ??= await this.screenshot(page, request.outDir, 'error').catch(() => null);
      return outcome;
    } finally {
      await close();
    }
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.headed.values()].map((c) => c.close()));
    await Promise.allSettled([...this.headless].map((b) => b.close()));
    this.headed.clear();
    this.headless.clear();
  }

  private async openPage(request: AutomationRequest): Promise<{ page: Page; close: () => Promise<void> }> {
    if (request.headed) {
      await this.headed.get(request.applicationId)?.close().catch(() => undefined);
      const context = await chromium.launchPersistentContext(this.profileDir, {
        executablePath: this.chromePath!,
        headless: false,
        viewport: null,
        acceptDownloads: false,
      });
      await context.addInitScript(EVALUATE_SHIM);
      this.headed.set(request.applicationId, context);
      context.on('close', () => this.headed.delete(request.applicationId));
      const page = context.pages()[0] ?? (await context.newPage());
      // The visible window stays open so the owner can review and press submit themselves.
      return { page, close: async () => undefined };
    }
    const browser = await chromium.launch({ executablePath: this.chromePath!, headless: true });
    this.headless.add(browser);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: false });
    await context.addInitScript(EVALUATE_SHIM);
    const page = await context.newPage();
    return {
      page,
      close: async () => {
        this.headless.delete(browser);
        await browser.close();
      },
    };
  }

  private async waitForConfirmation(page: Page, adapter: AtsAdapter, outcome: AutomationOutcome): Promise<boolean> {
    const deadline = Date.now() + CONFIRM_WAIT_MS;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      const body = await page.locator('body').innerText().catch(() => '');
      if (adapter.confirmation.test(body) || /\/(thanks|thank-you|confirmation|submitted)\b/i.test(page.url())) return true;
      const blockers = await findBlockers(page).catch(() => []);
      if (blockers.length) {
        outcome.blockers.push(...blockers);
        return false;
      }
    }
    return false;
  }

  private async screenshot(page: Page, outDir: string, name: string): Promise<string> {
    const file = path.join(outDir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return path.basename(file);
  }
}
