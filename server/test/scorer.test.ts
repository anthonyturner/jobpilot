import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeJob } from '../src/services/normalize.js';
import { containsTerm, KeywordJobScorer } from '../src/services/scoring/keyword-scorer.js';
import { profile, rawJob } from './helpers.js';

const scorer = new KeywordJobScorer();
const score = (overrides: Parameters<typeof rawJob>[0], p = profile()) => scorer.score(normalizeJob(rawJob(overrides))!, p);

describe('containsTerm', () => {
  it('matches symbol-heavy skills as whole terms', () => {
    assert.ok(containsTerm('experience with c# and .net', 'C#'));
    assert.ok(containsTerm('asp.net core apis', 'ASP.NET Core'));
    assert.ok(containsTerm('built on node.js', 'Node.js'));
  });

  it('does not match inside other words', () => {
    assert.ok(!containsTerm('vb.net only', '.NET'));
    assert.ok(!containsTerm('reactive programming', 'React'));
    assert.ok(!containsTerm('c++ developer', 'C'));
  });
});

describe('KeywordJobScorer', () => {
  it('scores a strong Angular/.NET remote role highly', () => {
    const result = score({});
    assert.ok(result.total >= 80, `expected >= 80, got ${result.total}`);
    assert.ok(result.skills.matched.includes('Angular'));
    assert.ok(result.skills.matched.includes('C#'));
    assert.equal(result.location.reason, 'Remote');
  });

  it('scores an unrelated role low', () => {
    const result = score({
      title: 'Registered Nurse',
      descriptionHtml: '<p>Patient care in a hospital setting.</p>',
      location: 'Dallas, TX',
    });
    assert.ok(result.total < 30, `expected < 30, got ${result.total}`);
  });

  it('penalises excluded keywords in the title', () => {
    const result = score({ title: 'Software Engineering Internship' });
    assert.ok(result.penalties.points <= -40);
    assert.ok(result.penalties.reasons.some((r) => r.includes('internship')));
  });

  it('penalises pay below the floor, comparing hourly pay as annual', () => {
    const low = score({ salaryMin: 30, salaryMax: 40, salaryPeriod: 'hour' });
    const fine = score({ salaryMin: 70, salaryMax: 80, salaryPeriod: 'hour' });
    assert.ok(low.penalties.reasons.includes('Pay is below your floor'));
    assert.ok(!fine.penalties.reasons.includes('Pay is below your floor'));
  });

  it('rewards on-site roles only in preferred places', () => {
    const near = score({ location: 'Boulder, CO', title: 'Software Engineer' });
    const far = score({ location: 'Dallas, TX', title: 'Software Engineer' });
    assert.ok(near.location.points > far.location.points);
    assert.equal(far.location.points, 0);
  });

  it('gives nothing for location to non-remote roles when remote-only', () => {
    const result = score({ location: 'Boulder, CO' }, profile({ remotePreference: 'remote-only' }));
    assert.equal(result.location.points, 0);
  });

  it('gives neutral skills credit when a listing has no description', () => {
    const result = score({ title: 'Full Stack Developer', descriptionHtml: undefined, descriptionText: undefined });
    assert.equal(result.skills.limitedData, true);
    assert.equal(result.skills.points, 15);
    assert.deepEqual(result.skills.missing, []);
  });

  it('always stays within 0-100', () => {
    const result = score({ title: 'Unpaid internship, commission only', descriptionHtml: '<p>unpaid internship</p>', salaryMax: 10 });
    assert.ok(result.total >= 0 && result.total <= 100);
  });
});
