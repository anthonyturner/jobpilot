import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApplicantSchema } from '../src/domain/applicant.js';
import { decide, pickOption, type FormField, type MatchContext } from '../src/services/apply/field-matcher.js';

const applicant = ApplicantSchema.parse({
  firstName: 'Jane',
  lastName: 'Dev',
  email: 'jane@example.com',
  phone: '555-123-4567',
  location: 'Denver, CO',
  github: 'https://github.com/jane',
  workAuthorizedUS: true,
  requiresSponsorship: false,
  answerBank: [{ question: 'years of experience with angular', answer: '8' }],
});
const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ applicant, answers: {}, coverLetterText: 'Dear team…', hasCoverLetterFile: true, ...over });
const field = (label: string, kind: FormField['kind'] = 'text', options: string[] = [], required = true): FormField => ({ key: 'k', kind, label, required, options });

describe('decide', () => {
  it('fills identity fields from the applicant profile', () => {
    assert.deepEqual(decide(field('First Name *'), ctx()), { type: 'value', value: 'Jane', source: 'First name' });
    assert.equal((decide(field('Email'), ctx()) as { value: string }).value, 'jane@example.com');
    assert.equal((decide(field('Phone'), ctx()) as { value: string }).value, '555-123-4567');
    assert.equal((decide(field('GitHub URL'), ctx()) as { value: string }).value, 'https://github.com/jane');
  });

  it('uploads the tailored resume and cover letter', () => {
    assert.deepEqual(decide(field('Resume/CV', 'file'), ctx()), { type: 'file', file: 'resume', source: 'Tailored resume' });
    assert.equal((decide(field('Cover Letter', 'file'), ctx()) as { file: string }).file, 'coverLetter');
  });

  it('maps yes/no facts onto the form options', () => {
    const auth = decide(field('Are you legally authorized to work in the United States?', 'select', ['Yes', 'No']), ctx());
    assert.deepEqual(auth, { type: 'value', value: 'Yes', source: 'Work authorization' });
    const sponsor = decide(field('Will you now or in the future require sponsorship?', 'radio', ['Yes', 'No']), ctx());
    assert.equal((sponsor as { value: string }).value, 'No');
  });

  it('never guesses unanswered facts: it asks', () => {
    const unknown = ApplicantSchema.parse({ firstName: 'Jane' });
    assert.equal(decide(field('Are you authorized to work in the US?', 'select', ['Yes', 'No']), ctx({ applicant: unknown })).type, 'ask');
    assert.equal(decide(field('Willing to relocate?', 'radio', ['Yes', 'No']), ctx()).type, 'ask');
    assert.equal(decide(field('Describe your experience with Kubernetes'), ctx()).type, 'ask');
  });

  it('skips unknown optional questions instead of inventing answers', () => {
    assert.equal(decide(field('Favourite colour', 'text', [], false), ctx()).type, 'skip');
  });

  it('declines voluntary self-identification by default', () => {
    const gender = decide(field('Gender', 'select', ['Male', 'Female', 'Decline To Self Identify'], false), ctx());
    assert.deepEqual(gender, { type: 'value', value: 'Decline To Self Identify', source: 'Voluntary question: declined' });
    const veteran = decide(field('Veteran Status', 'select', ['I am a veteran', 'I am not a veteran', "I don't wish to answer"], false), ctx());
    assert.equal((veteran as { value: string }).value, "I don't wish to answer");
    const noDecline = decide(field('Race', 'select', ['A', 'B'], true), ctx());
    assert.equal(noDecline.type, 'ask');
  });

  it('only ticks consent boxes when the owner allowed it', () => {
    assert.equal(decide(field('I agree to the privacy policy', 'checkbox'), ctx()).type, 'ask');
    const allowed = ApplicantSchema.parse({ ...applicant, acceptDataConsent: true });
    assert.deepEqual(decide(field('I agree to the privacy policy', 'checkbox'), ctx({ applicant: allowed })), {
      type: 'check',
      value: true,
      source: 'Data-processing consent (allowed in Settings)',
    });
  });

  it('prefers the owner’s own answers, then the answer bank', () => {
    const own = decide(field('Years of experience with Angular?'), ctx({ answers: { 'years of experience with angular': '9' } }));
    assert.equal((own as { value: string }).value, '9');
    const banked = decide(field('Years of experience with Angular?'), ctx());
    assert.deepEqual(banked, { type: 'value', value: '8', source: 'Answer bank' });
  });

  it('asks when the saved answer is not one of the options', () => {
    const d = decide(field('How many years of Angular?', 'select', ['0-2', '3-5', '6+']), ctx({ answers: { 'how many years of angular': 'ten' } }));
    assert.equal(d.type, 'ask');
  });
});

describe('pickOption', () => {
  it('matches exact, prefix, then substring', () => {
    assert.equal(pickOption(['Yes', 'No'], 'yes'), 'Yes');
    assert.equal(pickOption(['LinkedIn', 'Job board (Indeed)'], 'job board'), 'Job board (Indeed)');
    assert.equal(pickOption(['A', 'B'], 'c'), null);
  });
});
