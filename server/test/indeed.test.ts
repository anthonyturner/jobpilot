import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseClaudeJobs, parseCompensation } from '../src/sources/indeed-via-claude.js';

const envelope = (result: string, isError = false) => JSON.stringify({ type: 'result', is_error: isError, result });

describe('parseClaudeJobs', () => {
  it('reads a fenced JSON array out of the result envelope', () => {
    const jobs = parseClaudeJobs(
      envelope('```json\n[{"title":"Full Stack Developer","company":"Initech","location":"Remote","url":"https://to.indeed.com/abc123example"}]\n```'),
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.company, 'Initech');
  });

  it('drops items that fail validation instead of storing them', () => {
    const jobs = parseClaudeJobs(
      envelope(
        JSON.stringify([
          { title: 'Good', company: 'A', url: 'https://to.indeed.com/x' },
          { title: 'Bad url', company: 'B', url: 'javascript:alert(1)' },
          { title: '', company: 'C', url: 'https://to.indeed.com/y' },
          'not an object',
        ]),
      ),
    );
    assert.deepEqual(
      jobs.map((j) => j.title),
      ['Good'],
    );
  });

  it('surfaces errors reported by Claude Code', () => {
    assert.throws(() => parseClaudeJobs(envelope('Rate limited', true)), /reported an error/);
  });

  it('fails clearly when no array is returned', () => {
    assert.throws(() => parseClaudeJobs(envelope('I could not find any jobs.')), /did not return a JSON array/);
  });
});

describe('parseCompensation', () => {
  it('parses annual ranges', () => {
    assert.deepEqual(parseCompensation('$120,000 - $140,000 a year'), { salaryMin: 120000, salaryMax: 140000, salaryPeriod: 'year' });
  });

  it('parses hourly and single figures', () => {
    assert.deepEqual(parseCompensation('$65 an hour'), { salaryMin: 65, salaryMax: 65, salaryPeriod: 'hour' });
  });

  it('ignores missing values', () => {
    assert.deepEqual(parseCompensation('N/A'), {});
    assert.deepEqual(parseCompensation(undefined), {});
  });
});
