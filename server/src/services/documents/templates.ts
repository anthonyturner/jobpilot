import type { Applicant } from '../../domain/applicant.js';
import type { CoverLetter, ResumeSelection } from '../../domain/application.js';
import type { Resume } from '../../domain/resume.js';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const BASE_CSS = `
  @page { size: Letter; margin: 0.55in 0.6in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.38; color: #1a1d24; }
  h1 { margin: 0; font-size: 22pt; letter-spacing: -0.01em; color: #111; }
  .headline { margin: 2px 0 6px; font-size: 11pt; color: #4338ca; font-weight: 600; }
  .contact { font-size: 9.5pt; color: #444; }
  .contact span + span::before { content: '  |  '; color: #aaa; }
  h2 { margin: 14px 0 5px; padding-bottom: 3px; font-size: 10.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: #4338ca; border-bottom: 1.2px solid #c7c9f5; }
  p { margin: 0 0 6px; }
  ul { margin: 3px 0 7px; padding-left: 16px; }
  li { margin: 0 0 2.5px; }
  .role { display: flex; justify-content: space-between; gap: 12px; margin-top: 7px; font-weight: 700; }
  .role .dates { font-weight: 400; color: #555; white-space: nowrap; }
  .company { font-weight: 400; color: #333; }
  .skill b { font-weight: 700; }
  .edu { display: flex; justify-content: space-between; }
`;

function contactLine(resume: Resume, applicant: Applicant): string {
  const parts = [
    applicant.email || resume.contact.email,
    applicant.phone || resume.contact.phone,
    applicant.location || resume.contact.location,
    applicant.linkedin.replace(/^https?:\/\/(www\.)?/, ''),
    applicant.github.replace(/^https?:\/\/(www\.)?/, ''),
    applicant.portfolio.replace(/^https?:\/\/(www\.)?/, ''),
  ].filter(Boolean);
  return parts.map((p) => `<span>${escapeHtml(p)}</span>`).join('');
}

/** ATS-friendly single column: real text, standard headings, no tables or images. */
export function renderResumeHtml(resume: Resume, selection: ResumeSelection, applicant: Applicant): string {
  const skills = selection.skillOrder
    .map((category) => resume.skills.find((s) => s.category === category))
    .filter((s): s is Resume['skills'][number] => !!s)
    .map((s) => `<p class="skill"><b>${escapeHtml(s.category)}:</b> ${escapeHtml(s.items)}</p>`)
    .join('');

  const experience = selection.experience
    .map(({ roleId, bulletIds }) => {
      const role = resume.experience.find((r) => r.id === roleId);
      if (!role) return '';
      const bullets = bulletIds
        .map((id) => role.bullets.find((b) => b.id === id))
        .filter((b): b is { id: string; text: string } => !!b)
        .map((b) => `<li>${escapeHtml(b.text)}</li>`)
        .join('');
      return `<div class="role"><span>${escapeHtml(role.title)} <span class="company">| ${escapeHtml(role.company)}</span></span><span class="dates">${escapeHtml(role.dates)}</span></div><ul>${bullets}</ul>`;
    })
    .join('');

  const projects = selection.projectIds
    .map((id) => resume.projects.find((p) => p.id === id))
    .filter((p): p is Resume['projects'][number] => !!p)
    .map((p) => `<li><b>${escapeHtml(p.name)}</b> ${escapeHtml(p.text)}</li>`)
    .join('');

  const highlights = resume.highlights?.bullets.length
    ? `<h2>${escapeHtml(resume.highlights.title)}</h2><ul>${resume.highlights.bullets.map((b) => `<li>${escapeHtml(b.text)}</li>`).join('')}</ul>`
    : '';

  const education = resume.education
    .map((e) => `<div class="edu"><span><b>${escapeHtml(e.degree)}</b>${e.school ? ` | ${escapeHtml(e.school)}` : ''}</span><span>${escapeHtml(e.year)}</span></div>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(resume.name)} Resume</title><style>${BASE_CSS}</style></head><body>
    <h1>${escapeHtml(resume.name)}</h1>
    <p class="headline">${escapeHtml(resume.headline)}</p>
    <p class="contact">${contactLine(resume, applicant)}</p>
    <h2>Professional Summary</h2><p>${escapeHtml(selection.summary)}</p>
    <h2>Technical Skills</h2>${skills}
    ${highlights}
    <h2>Professional Experience</h2>${experience}
    ${projects ? `<h2>Featured Projects</h2><ul>${projects}</ul>` : ''}
    ${education ? `<h2>Education</h2>${education}` : ''}
  </body></html>`;
}

export function renderCoverLetterHtml(
  resume: Resume,
  applicant: Applicant,
  letter: CoverLetter,
  company: string,
  date = new Date(),
): string {
  const today = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const paragraphs = letter.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cover Letter</title><style>${BASE_CSS}
    body { font-size: 11pt; line-height: 1.55; } p { margin: 0 0 12px; } .date { margin: 22px 0 18px; color: #444; }</style></head><body>
    <h1>${escapeHtml(resume.name)}</h1>
    <p class="headline">${escapeHtml(resume.headline)}</p>
    <p class="contact">${contactLine(resume, applicant)}</p>
    <p class="date">${escapeHtml(today)}</p>
    <p>Dear Hiring Team at ${escapeHtml(company)},</p>
    ${paragraphs}
    <p style="margin-top: 18px">Sincerely,<br>${escapeHtml(resume.name)}</p>
  </body></html>`;
}

/** Plain-text cover letter for forms that want pasted text instead of a file. */
export function coverLetterText(resume: Resume, letter: CoverLetter, company: string): string {
  return [`Dear Hiring Team at ${company},`, ...letter.paragraphs, `Sincerely,\n${resume.name}`].join('\n\n');
}
