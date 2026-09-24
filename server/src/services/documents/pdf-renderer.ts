import { chromium } from 'playwright-core';

export interface PdfRenderer {
  render(html: string, outFile: string): Promise<void>;
}

/**
 * Prints HTML to PDF with the locally installed Chrome. The page runs with
 * JavaScript disabled and every network request blocked, so rendering can only
 * ever use the markup we generated.
 */
export class ChromePdfRenderer implements PdfRenderer {
  constructor(private readonly chromePath: string | null) {}

  async render(html: string, outFile: string): Promise<void> {
    if (!this.chromePath) throw new Error('Chrome or Edge was not found. Set CHROME_PATH in .env.');
    const browser = await chromium.launch({ executablePath: this.chromePath, headless: true });
    try {
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.pdf({ path: outFile, format: 'Letter', printBackground: true, preferCSSPageSize: true });
    } finally {
      await browser.close();
    }
  }
}
