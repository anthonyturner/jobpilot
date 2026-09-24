import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDedupeKey, inferRemoteType, normalizeJob, sanitizeDescription } from '../src/services/normalize.js';
import { rawJob } from './helpers.js';

describe('sanitizeDescription', () => {
  it('removes scripts, event handlers and javascript: links', () => {
    const html = sanitizeDescription(
      '<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>',
    );
    assert.doesNotMatch(html, /script|onclick|onerror|javascript:|<img/i);
    assert.match(html, /<p>Hi<\/p>/);
  });

  it('forces links to open safely in a new tab', () => {
    const html = sanitizeDescription('<a href="https://example.com">apply</a>');
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer nofollow"/);
  });
});

describe('normalizeJob', () => {
  it('rejects listings without a safe http(s) apply link', () => {
    assert.equal(normalizeJob(rawJob({ applyUrl: 'javascript:alert(1)' })), null);
    assert.equal(normalizeJob(rawJob({ applyUrl: 'not a url' })), null);
  });

  it('rejects listings without a title or company', () => {
    assert.equal(normalizeJob(rawJob({ title: '  ' })), null);
    assert.equal(normalizeJob(rawJob({ company: '' })), null);
  });

  it('clamps future posting dates to now', () => {
    const job = normalizeJob(rawJob({ postedAt: '2999-01-01T00:00:00Z' }))!;
    assert.ok(new Date(job.postedAt!).getTime() <= Date.now());
  });

  it('swaps an inverted salary range', () => {
    const job = normalizeJob(rawJob({ salaryMin: 150_000, salaryMax: 120_000 }))!;
    assert.equal(job.salaryMin, 120_000);
    assert.equal(job.salaryMax, 150_000);
  });

  it('escapes plain-text descriptions when building HTML', () => {
    const job = normalizeJob(rawJob({ descriptionHtml: undefined, descriptionText: 'Use <b>Angular</b>' }))!;
    assert.match(job.descriptionHtml, /&lt;b&gt;/);
  });
});

describe('inferRemoteType', () => {
  it('reads remote and hybrid signals', () => {
    assert.equal(inferRemoteType('Remote, US', 'Developer', ''), 'remote');
    assert.equal(inferRemoteType('Denver, CO', 'Developer (Hybrid)', ''), 'hybrid');
    assert.equal(inferRemoteType('Denver, CO', 'Developer', 'This is a fully remote position'), 'remote');
    assert.equal(inferRemoteType('Denver, CO', 'Developer', ''), 'onsite');
    assert.equal(inferRemoteType('', 'Developer', ''), 'unknown');
  });
});

describe('buildDedupeKey', () => {
  it('treats the same role at the same company as one job across boards', () => {
    const a = buildDedupeKey('Globex, LLC', 'Full Stack .NET Software Developer', 'Remote', 'remote');
    const b = buildDedupeKey('Globex LLC', 'Full Stack .NET Software Developer (Remote)', 'Anywhere in US', 'remote');
    assert.equal(a, b);
  });

  it('keeps on-site roles in different cities apart', () => {
    const a = buildDedupeKey('Acme', 'Developer', 'Denver, CO', 'onsite');
    const b = buildDedupeKey('Acme', 'Developer', 'Boston, MA', 'onsite');
    assert.notEqual(a, b);
  });
});
