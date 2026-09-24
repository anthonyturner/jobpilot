import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseDocxResume } from '../src/services/resume/docx-resume-parser.js';
import { findUngroundedTerms } from '../src/services/tailoring/grounding.js';
import { parseDraft, validateDraft, type TailorDraft } from '../src/services/tailoring/tailor.js';
import { resumeCorpus } from '../src/domain/resume.js';

function docx(paragraphs: Array<string | { bullet: string }>): Uint8Array {
  const body = paragraphs
    .map((p) =>
      typeof p === 'string'
        ? `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/\t/g, '</w:t><w:tab/><w:t>')}</w:t></w:r></w:p>`
        : `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>${p.bullet}</w:t></w:r></w:p>`,
    )
    .join('');
  return zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`) });
}

export const SAMPLE = docx([
  'Jane Dev',
  'Senior Engineer | Angular + .NET',
  'jane@example.com  |  555-123-4567  |  Denver, CO  |  LinkedIn',
  'PROFESSIONAL SUMMARY',
  'Engineer with 8 years in C# and Angular.',
  'TECHNICAL SKILLS',
  'Front End: Angular, TypeScript',
  'Back End: C#, ASP.NET Core',
  'PROFESSIONAL EXPERIENCE',
  'Software Engineer  |  Acme Corp\tJan 2020 – Present',
  { bullet: 'Built Angular dashboards used by 200 analysts.' },
  { bullet: 'Wrote ASP.NET Core APIs.' },
  'Developer  |  Beta LLC\tJan 2018 – Dec 2019',
  { bullet: 'Maintained SQL Server reports.' },
  'FEATURED PROJECTS',
  { bullet: 'Tracker (github.com/jane/tracker): A tool for tracking.' },
  'EDUCATION',
  'BS, Computer Science  |  State University\t2017',
]);

describe('parseDocxResume', () => {
  const resume = parseDocxResume(SAMPLE);

  it('reads the header', () => {
    assert.equal(resume.name, 'Jane Dev');
    assert.deepEqual(resume.contact, { email: 'jane@example.com', phone: '555-123-4567', location: 'Denver, CO' });
  });

  it('reads skills, roles with bullets, projects and education', () => {
    assert.deepEqual(resume.skills.map((s) => s.category), ['Front End', 'Back End']);
    assert.equal(resume.experience.length, 2);
    assert.equal(resume.experience[0]!.company, 'Acme Corp');
    assert.equal(resume.experience[0]!.dates, 'Jan 2020 – Present');
    assert.deepEqual(resume.experience[0]!.bullets.map((b) => b.id), ['acme-corp-b1', 'acme-corp-b2']);
    assert.equal(resume.projects[0]!.name, 'Tracker');
    assert.equal(resume.education[0]!.school, 'State University');
  });

  it('rejects files that are not .docx', () => {
    assert.throws(() => parseDocxResume(strToU8('hello')), /valid \.docx/);
  });
});

describe('findUngroundedTerms', () => {
  const corpus = resumeCorpus(parseDocxResume(SAMPLE));

  it('flags technologies and numbers the resume does not support', () => {
    const flags = findUngroundedTerms('I have shipped Kubernetes clusters and cut costs by 40% using AWS.', corpus);
    assert.deepEqual(flags.sort(), ['40%', 'AWS', 'Kubernetes'].sort());
  });

  it('checks slash-joined terms separately and ignores contractions', () => {
    assert.deepEqual(findUngroundedTerms("I've shipped C#/Angular apps. We'd use Go/Rust too.", corpus), ['Go', 'Rust']);
  });

  it('accepts terms that are in the resume or the job', () => {
    const flags = findUngroundedTerms('At Acme Corp I built Angular dashboards with ASP.NET Core APIs for Globex.', corpus, ['Globex']);
    assert.deepEqual(flags, []);
  });
});

describe('tailoring validation', () => {
  const resume = parseDocxResume(SAMPLE);
  const job = { title: 'Angular Engineer', company: 'Globex', location: 'Remote' };
  const draft: TailorDraft = {
    summary: 'Engineer with 8 years in C# and Angular, focused on dashboards and APIs.',
    skillOrder: ['Back End', 'Made Up Category'],
    experience: [{ roleId: 'acme-corp', bulletIds: ['acme-corp-b2', 'invented-bullet'] }],
    projectIds: ['tracker', 'ghost-project'],
    coverLetter: { paragraphs: ['I built Angular dashboards at Acme Corp — used daily.', 'I also led a Kubernetes migration at Acme Corp.'] },
    fitNotes: [],
    concerns: [],
  };

  it('keeps only real resume ids and restores missing roles', () => {
    const packet = validateDraft(resume, job, draft);
    assert.deepEqual(packet.resume.skillOrder, ['Back End', 'Front End']);
    assert.deepEqual(packet.resume.experience[0], { roleId: 'acme-corp', bulletIds: ['acme-corp-b2'] });
    assert.deepEqual(packet.resume.experience[1]!.bulletIds, ['beta-llc-b1']);
    assert.deepEqual(packet.resume.projectIds, ['tracker']);
  });

  it('flags invented claims in the cover letter and removes em dashes', () => {
    const packet = validateDraft(resume, job, draft);
    assert.ok(packet.ungrounded.includes('Kubernetes'));
    assert.ok(!packet.coverLetter.paragraphs[0]!.includes('—'));
  });

  it('parses the Claude envelope and rejects malformed replies', () => {
    const ok = parseDraft(JSON.stringify({ result: `Here you go:\n${JSON.stringify(draft)}` }));
    assert.equal(ok.summary, draft.summary);
    assert.throws(() => parseDraft(JSON.stringify({ result: '{"summary":"too short"}' })), /schema/);
    assert.throws(() => parseDraft(JSON.stringify({ is_error: true, result: 'budget exceeded' })), /reported an error/);
  });
});
