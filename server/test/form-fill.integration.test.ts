/**
 * Drives real Chrome against LOCAL fixture forms shaped like Greenhouse and Lever.
 * Nothing leaves this machine. Skipped when Chrome/Edge is not installed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright-core';
import { ApplicantSchema } from '../src/domain/applicant.js';
import { findChrome } from '../src/integrations/chrome.js';
import type { AtsAdapter } from '../src/services/apply/ats.js';
import { PlaywrightFormAutomation } from '../src/services/apply/playwright-automation.js';

const GREENHOUSE_LIKE = `<!doctype html><html><body>
<h1>Senior Angular Engineer</h1>
<form id="application_form" method="post" action="/thanks" enctype="multipart/form-data">
  <div class="field"><label for="first_name">First Name *</label><input id="first_name" name="first_name" required></div>
  <div class="field"><label for="last_name">Last Name *</label><input id="last_name" name="last_name" required></div>
  <div class="field"><label for="email">Email *</label><input id="email" type="email" name="email" required></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" name="phone"></div>
  <div class="field"><label>Resume/CV *</label><button type="button">Attach</button><input type="file" id="resume" name="resume" style="display:none" required></div>
  <div class="field"><label for="cover_letter_text">Cover Letter</label><textarea id="cover_letter_text" name="cover_letter_text"></textarea></div>
  <div class="field"><label for="q1">LinkedIn Profile</label><input id="q1" name="q1"></div>
  <div class="field"><label for="auth">Are you legally authorized to work in the United States? *</label>
    <select id="auth" name="auth" required><option value="">Select…</option><option>Yes</option><option>No</option></select></div>
  <fieldset><legend>Will you now or in the future require visa sponsorship? *</legend>
    <label><input type="radio" name="sponsor" value="1" required> Yes</label>
    <label><input type="radio" name="sponsor" value="0"> No</label></fieldset>
  <div class="field"><label for="k8s">How many years have you used Kubernetes? *</label><input id="k8s" name="k8s" required></div>
  <div class="field"><label for="gender">Gender</label>
    <select id="gender" name="gender"><option value="">Select…</option><option>Male</option><option>Female</option><option>Decline To Self Identify</option></select></div>
  <div class="field"><label><input type="checkbox" name="consent" required> I agree to the privacy policy *</label></div>
  <button type="submit" id="submit_app">Submit Application</button>
</form></body></html>`;

const THANKS = `<!doctype html><html><body><h1>Thank you for applying!</h1><p>Your application has been submitted.</p></body></html>`;

const CAPTCHA_PAGE = `<!doctype html><html><body><form><label for="e">Email</label><input id="e" type="email">
  <iframe src="https://www.google.com/recaptcha/api2/anchor?k=x" style="width:304px;height:78px"></iframe></form></body></html>`;

/** Treats the local fixture server as a Greenhouse board. */
const localAdapter: AtsAdapter = {
  id: 'greenhouse',
  name: 'Greenhouse (fixture)',
  confirmation: /thank you for applying|has been submitted/i,
  matches: (url) => url.hostname === '127.0.0.1' && url.pathname.startsWith('/jobs/'),
  openForm: async (page: Page) => {
    await page.locator('form').first().waitFor();
  },
  submit: async (page: Page) => {
    await page.locator('#submit_app').click();
  },
};

const chrome = findChrome(process.env.CHROME_PATH);

describe('form filling in a real browser (local fixtures)', { skip: chrome ? false : 'Chrome/Edge not installed' }, () => {
  let server: http.Server;
  let base: string;
  let dir: string;
  let resumePdf: string;
  const submissions: string[] = [];
  let automation: PlaywrightFormAutomation;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/thanks') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          submissions.push(body);
          res.writeHead(200, { 'content-type': 'text/html' }).end(THANKS);
        });
        return;
      }
      if (req.url === '/listing') return res.writeHead(200, { 'content-type': 'text/html' }).end(`<a href="${base}/jobs/42">Apply now</a>`);
      if (req.url === '/jobs/captcha') return res.writeHead(200, { 'content-type': 'text/html' }).end(CAPTCHA_PAGE);
      if (req.url === '/elsewhere') return res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Apply on our careers site</h1>');
      if (req.url?.startsWith('/jobs/')) return res.writeHead(200, { 'content-type': 'text/html' }).end(GREENHOUSE_LIKE);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-fill-'));
    resumePdf = path.join(dir, 'Jane_Dev_Resume_Globex.pdf');
    fs.writeFileSync(resumePdf, '%PDF-1.4 fixture');
    automation = new PlaywrightFormAutomation(chrome, path.join(dir, 'profile'), [localAdapter]);
  });

  after(async () => {
    await automation.closeAll();
    server.close();
  });

  const applicant = ApplicantSchema.parse({
    firstName: 'Jane',
    lastName: 'Dev',
    email: 'jane@example.com',
    phone: '555-123-4567',
    linkedin: 'https://linkedin.com/in/jane',
    workAuthorizedUS: true,
    requiresSponsorship: false,
  });

  const request = (over: Partial<Parameters<PlaywrightFormAutomation['run']>[0]> = {}) => ({
    applicationId: 'test',
    applyUrl: `${base}/listing`,
    headed: false,
    submit: false,
    ctx: { applicant, answers: {}, coverLetterText: 'Dear Hiring Team,\n\nI build Angular apps.', hasCoverLetterFile: false },
    files: { resume: resumePdf, coverLetter: null },
    outDir: dir,
    allowAts: () => true,
    ...over,
  });

  it('follows the listing to the form, fills what it knows, and reports what it does not', async () => {
    const outcome = await automation.run(request());
    assert.equal(outcome.ats, 'greenhouse');
    const filled = Object.fromEntries(outcome.filled.map((f) => [f.label.replace(/\s*\*$/, ''), f.value]));
    assert.equal(filled['First Name'], 'Jane');
    assert.equal(filled['Email'], 'jane@example.com');
    assert.equal(filled['Resume/CV'], 'Jane_Dev_Resume_Globex.pdf');
    assert.equal(filled['Are you legally authorized to work in the United States?'], 'Yes');
    assert.equal(filled['Will you now or in the future require visa sponsorship?'], 'No');
    assert.equal(filled['Gender'], 'Decline To Self Identify');
    assert.match(filled['Cover Letter']!, /I build Angular apps/);
    const open = outcome.open.map((q) => q.label);
    assert.ok(open.some((l) => /Kubernetes/.test(l)), 'unknown question is handed to the owner');
    assert.ok(open.some((l) => /privacy policy/.test(l)), 'consent is not ticked without permission');
    assert.equal(outcome.submitted, false);
    assert.ok(outcome.screenshot && fs.existsSync(path.join(dir, outcome.screenshot)));
  });

  it('does not press submit while required questions are open, even when asked to', async () => {
    const outcome = await automation.run(request({ submit: true }));
    assert.equal(outcome.submitted, false);
    assert.equal(submissions.length, 0);
  });

  it('submits once everything is answered and sees the confirmation', async () => {
    let attempts = 0;
    const outcome = await automation.run(
      request({
        submit: true,
        ctx: {
          applicant: { ...applicant, acceptDataConsent: true },
          answers: { 'how many years have you used kubernetes': '0' },
          coverLetterText: 'Dear Hiring Team,\n\nI build Angular apps.',
          hasCoverLetterFile: false,
        },
        beforeSubmit: () => attempts++,
      }),
    );
    assert.deepEqual(outcome.blockers, []);
    assert.equal(outcome.submitted, true);
    assert.equal(outcome.confirmed, true);
    assert.equal(attempts, 1);
    assert.equal(submissions.length, 1);
    assert.match(submissions[0]!, /jane@example\.com/);
    assert.match(submissions[0]!, /Decline To Self Identify/);
  });

  it('stops at a CAPTCHA', async () => {
    const outcome = await automation.run(request({ applyUrl: `${base}/jobs/captcha`, submit: true }));
    assert.ok(outcome.blockers.some((b) => /CAPTCHA/.test(b)));
    assert.equal(outcome.submitted, false);
  });

  it('respects a disabled ATS', async () => {
    const outcome = await automation.run(request({ allowAts: () => false }));
    assert.ok(outcome.blockers.some((b) => /turned off/.test(b)));
    assert.equal(outcome.filled.length, 0);
  });

  it('refuses sites that are not a supported ATS', async () => {
    const outcome = await automation.run(request({ applyUrl: `${base}/elsewhere` }));
    assert.equal(outcome.ats, null);
    assert.ok(outcome.blockers[0]!.includes("doesn't use Greenhouse or Lever"));
  });

  it('turns a dead link into a message instead of crashing', async () => {
    const outcome = await automation.run(request({ applyUrl: `${base}/nowhere` }));
    assert.equal(outcome.ats, null);
    assert.ok(outcome.blockers[0]!.includes("couldn't work with this page") || outcome.blockers[0]!.includes("doesn't use Greenhouse or Lever"));
  });
});
