import { strFromU8, unzipSync } from 'fflate';
import { ResumeSchema, type Resume } from '../../domain/resume.js';

interface Line {
  text: string;
  bullet: boolean;
}

const MAX_DOCX_BYTES = 5 * 1024 * 1024;

/** Reads the paragraphs of a .docx (Office Open XML) without any Office dependency. */
export function readDocxLines(buffer: Uint8Array): Line[] {
  if (buffer.byteLength > MAX_DOCX_BYTES) throw new Error('Resume file is larger than 5 MB');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer, { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new Error('Not a valid .docx file');
  }
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('Not a valid .docx file (no document body)');
  const body = strFromU8(xml);

  return [...body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map(([p]) => {
      const text = decodeXml(
        p
          .replace(/<w:tab\/>/g, '\t')
          .replace(/<w:br\/>/g, ' ')
          .match(/<w:t[^>]*>[^<]*<\/w:t>|\t/g)
          ?.map((t) => (t === '\t' ? '\t' : t.replace(/<[^>]+>/g, '')))
          .join('') ?? '',
      ).trim();
      return { text, bullet: p.includes('<w:numPr>') || /w:val="List/.test(p) };
    })
    .filter((l) => l.text.length > 0);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'item'
  );
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

const isHeading = (l: Line) => !l.bullet && l.text.length <= 40 && /^[A-Z0-9 &/,-]+$/.test(l.text) && /[A-Z]{3}/.test(l.text);

/**
 * Heuristic parser for a conventional one-column resume:
 *   Name / headline / contact line, then ALL-CAPS section headings.
 * Anything it cannot place is kept rather than dropped, so the owner can review it.
 */
export function parseResume(lines: Line[], sourceFile = ''): Resume {
  if (lines.length < 3) throw new Error('The resume looks empty');
  const [nameLine, headlineLine, contactLine] = lines;
  const contactParts = contactLine!.text.split(/\s*\|\s*/);
  const email = contactParts.find((p) => /\S+@\S+\.\S+/.test(p)) ?? '';
  const phone = contactParts.find((p) => /\+?\d[\d\s().-]{7,}\d/.test(p)) ?? '';
  const location = contactParts.find((p) => /^[A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(p)) ?? '';

  const ids = new Set<string>();
  const resume: Resume = {
    name: nameLine!.text,
    headline: headlineLine!.text,
    contact: { email: email.trim(), phone: phone.trim(), location: location.trim() },
    summary: '',
    skills: [],
    highlights: null,
    experience: [],
    projects: [],
    education: [],
    sourceFile,
    importedAt: new Date().toISOString(),
  };

  let section = '';
  for (const line of lines.slice(3)) {
    if (isHeading(line)) {
      section = line.text.toUpperCase();
      continue;
    }
    if (/SUMMARY|PROFILE|OBJECTIVE/.test(section)) {
      resume.summary = [resume.summary, line.text].filter(Boolean).join(' ');
    } else if (/SKILL/.test(section)) {
      const [category, ...rest] = line.text.split(':');
      if (rest.length) resume.skills.push({ category: category!.trim(), items: rest.join(':').trim() });
      else resume.skills.push({ category: 'Skills', items: line.text });
    } else if (/EXPERIENCE|EMPLOYMENT|WORK HISTORY/.test(section)) {
      if (!line.bullet) {
        const [left, dates = ''] = line.text.split('\t').map((s) => s.trim());
        const [title, company = ''] = left!.split(/\s*\|\s*|\s+at\s+/);
        const role = {
          id: uniqueId(slug(company || title!), ids),
          title: title!.trim(),
          company: company.trim() || '—',
          dates: dates.replace(/\s*[–-]\s*/, ' – '),
          bullets: [] as Array<{ id: string; text: string }>,
        };
        resume.experience.push(role);
      } else {
        const role = resume.experience.at(-1);
        if (role) role.bullets.push({ id: `${role.id}-b${role.bullets.length + 1}`, text: line.text });
      }
    } else if (/PROJECT/.test(section)) {
      const match = line.text.match(/^([^:(]{2,80})(\([^)]*\))?\s*:\s*([\s\S]+)$/);
      const name = (match?.[1] ?? line.text.slice(0, 60)).trim();
      resume.projects.push({ id: uniqueId(slug(name), ids), name, text: (match ? `${match[2] ? `${match[2]} ` : ''}${match[3]}` : line.text).trim() });
    } else if (/EDUCATION/.test(section)) {
      const [left, year = ''] = line.text.split('\t').map((s) => s.trim());
      const [degree, school = ''] = left!.split(/\s*\|\s*/);
      resume.education.push({ degree: degree!.trim(), school: school.trim(), year });
    } else if (section) {
      // Any other titled section with bullets (e.g. "HOW I WORK WITH AI") becomes the highlights block.
      resume.highlights ??= { title: toTitle(section), bullets: [] };
      resume.highlights.bullets.push({ id: `hl-${resume.highlights.bullets.length + 1}`, text: line.text });
    }
  }
  return ResumeSchema.parse(resume);
}

function toTitle(heading: string): string {
  return heading.toLowerCase().replace(/\b(\w)/g, (c) => c.toUpperCase()).replace(/\bAi\b/g, 'AI');
}

export function parseDocxResume(buffer: Uint8Array, sourceFile = ''): Resume {
  return parseResume(readDocxLines(buffer), sourceFile);
}
