import sanitizeHtml from 'sanitize-html';
import type { NormalizedJob, RawJob, RemoteType } from '../domain/job.js';

const MAX_DESCRIPTION_CHARS = 60_000;

/**
 * Job descriptions come from third parties and are rendered in the UI, so they are
 * treated as hostile: only a small formatting allowlist survives, and every link is
 * forced to open in a new tab without an opener reference.
 */
export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html.slice(0, MAX_DESCRIPTION_CHARS * 2), {
    allowedTags: [
      'p', 'br', 'hr', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'span', 'div',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
      h1: 'h4',
      h2: 'h4',
      h3: 'h5',
    },
    allowedSchemesAppliedToAttributes: ['href'],
  }).slice(0, MAX_DESCRIPTION_CHARS);
}

export function htmlToText(html: string): string {
  const text = sanitizeHtml(html.replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n'), {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function inferRemoteType(location: string, title: string, description: string): RemoteType {
  const loc = location.toLowerCase();
  const head = `${title} ${loc}`.toLowerCase();
  if (/\bhybrid\b/.test(head)) return 'hybrid';
  if (/\b(remote|anywhere|work from home|wfh)\b/.test(head)) return 'remote';
  const body = description.slice(0, 4000).toLowerCase();
  if (/\bhybrid\b/.test(body)) return 'hybrid';
  if (/\b(fully remote|100% remote|remote-first|remote position)\b/.test(body)) return 'remote';
  if (/\b(on-?site|in office|in-office)\b/.test(body)) return 'onsite';
  return loc.length > 0 ? 'onsite' : 'unknown';
}

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh)\b\.?/g;

function normalizeKeyPart(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9#+.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Two listings are the same job when the company, title and place match after
 * normalisation. Remote roles collapse to one key regardless of the city a board lists.
 */
export function buildDedupeKey(company: string, title: string, location: string, remoteType: RemoteType): string {
  const companyKey = normalizeKeyPart(company).replace(COMPANY_SUFFIXES, '').replace(/\s+/g, ' ').trim();
  const titleKey = normalizeKeyPart(title).replace(/\b(remote|hybrid)\b/g, '').replace(/\s+/g, ' ').trim();
  const place = remoteType === 'remote' ? 'remote' : normalizeKeyPart(location.split(',')[0] ?? '');
  return `${companyKey}|${titleKey}|${place}`;
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Boards sometimes post-date listings; clamp to now so recency scoring stays honest.
  return new Date(Math.min(date.getTime(), Date.now())).toISOString();
}

function clampText(value: string | undefined, max: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function positiveOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Returns null when the listing is unusable (no title, company or safe apply link). */
export function normalizeJob(raw: RawJob): NormalizedJob | null {
  const title = clampText(raw.title, 200);
  const company = clampText(raw.company, 120);
  const applyUrl = safeHttpUrl(raw.applyUrl);
  if (!title || !company || !applyUrl) return null;

  const plainText = (raw.descriptionText ?? '').trim().slice(0, MAX_DESCRIPTION_CHARS);
  const descriptionHtml = raw.descriptionHtml ? sanitizeDescription(raw.descriptionHtml) : textToHtml(plainText);
  const descriptionText = raw.descriptionHtml ? htmlToText(descriptionHtml) : plainText;
  const location = clampText(raw.location, 160) || 'Unspecified';
  const remoteType = raw.remoteType && raw.remoteType !== 'unknown' ? raw.remoteType : inferRemoteType(location, title, descriptionText);

  let salaryMin = positiveOrNull(raw.salaryMin);
  let salaryMax = positiveOrNull(raw.salaryMax);
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) [salaryMin, salaryMax] = [salaryMax, salaryMin];

  return {
    source: raw.source,
    sourceJobId: clampText(raw.sourceJobId, 200) || applyUrl,
    dedupeKey: buildDedupeKey(company, title, location, remoteType),
    title,
    company,
    companyLogo: safeHttpUrl(raw.companyLogo),
    location,
    remoteType,
    employmentType: clampText(raw.employmentType, 60) || null,
    salaryMin,
    salaryMax,
    salaryCurrency: clampText(raw.salaryCurrency, 8) || (salaryMin || salaryMax ? 'USD' : null),
    salaryPeriod: raw.salaryPeriod ?? (salaryMin || salaryMax ? 'year' : null),
    salaryText: clampText(raw.salaryText, 120) || null,
    descriptionHtml,
    descriptionText,
    applyUrl,
    postedAt: toIsoDate(raw.postedAt),
    tags: (raw.tags ?? []).map((t) => clampText(t, 40)).filter(Boolean).slice(0, 20),
  };
}

/** Converts a pay figure to an annual equivalent so salary floors compare like with like. */
export function annualize(amount: number, period: NormalizedJob['salaryPeriod']): number {
  switch (period) {
    case 'hour':
      return amount * 2080;
    case 'day':
      return amount * 260;
    case 'week':
      return amount * 52;
    case 'month':
      return amount * 12;
    default:
      return amount;
  }
}
