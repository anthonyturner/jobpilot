import type { Applicant } from '../../domain/applicant.js';
import { questionKey } from '../../domain/application.js';

export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'checkbox-group'
  | 'file'
  | 'combobox'
  /** A custom dropdown whose options were read by opening it. */
  | 'combobox-select';

/** A form control as read from the page. */
export interface FormField {
  key: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  options: string[];
}

export type Decision =
  | { type: 'value'; value: string; source: string }
  | { type: 'file'; file: 'resume' | 'coverLetter'; source: string }
  | { type: 'check'; value: boolean; source: string }
  | { type: 'skip'; reason: string }
  | { type: 'ask'; reason: string };

export interface MatchContext {
  applicant: Applicant;
  /** Per-application answers the owner typed, keyed by questionKey(label). */
  answers: Record<string, string>;
  coverLetterText: string;
  hasCoverLetterFile: boolean;
  /** The board the job was found on (e.g. "Indeed"): the truthful answer to "how did you hear about us". */
  sourceName?: string;
}

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (answer|disclose|say)|choose not|rather not|not specified|i don.?t want/i;

/** Picks the option that best matches the wanted text; null when nothing matches confidently. */
export function pickOption(options: string[], wanted: string): string | null {
  const w = wanted.trim().toLowerCase();
  if (!w) return null;
  const clean = options.map((o) => o.trim());
  return (
    clean.find((o) => o.toLowerCase() === w) ??
    clean.find((o) => o.toLowerCase().startsWith(w)) ??
    clean.find((o) => o.toLowerCase().includes(w)) ??
    null
  );
}

function yesNoOption(options: string[], yes: boolean): string | null {
  return options.find((o) => (yes ? /^\s*yes\b/i : /^\s*no\b/i).test(o)) ?? null;
}

const isChoice = (f: FormField) =>
  f.kind === 'select' || f.kind === 'radio' || f.kind === 'combobox' || f.kind === 'combobox-select' || f.kind === 'checkbox-group';
const isText = (f: FormField) => ['text', 'email', 'tel', 'url', 'number', 'date', 'textarea'].includes(f.kind);

/** Converts a known answer into a decision appropriate for the control type. */
function answer(field: FormField, value: string, source: string): Decision {
  if (!value.trim()) return missing(field, `No ${source} saved`);
  if (field.kind === 'checkbox') {
    const yes = /^(y|yes|true|1|checked|agree)$/i.test(value.trim());
    return { type: 'check', value: yes, source };
  }
  if (isChoice(field) && field.kind !== 'combobox') {
    const option = pickOption(field.options, value);
    return option ? { type: 'value', value: option, source } : missing(field, `"${value}" is not one of the options`);
  }
  return { type: 'value', value, source };
}

function triState(field: FormField, value: boolean | null, source: string): Decision {
  if (value === null) return { type: 'ask', reason: `Tell JobPilot your answer for "${source}" in Settings or here` };
  if (field.kind === 'checkbox') return { type: 'check', value, source };
  if (isChoice(field) && field.kind !== 'combobox') {
    const option = yesNoOption(field.options, value);
    return option ? { type: 'value', value: option, source } : { type: 'ask', reason: 'Could not map yes/no onto the options' };
  }
  return { type: 'value', value: value ? 'Yes' : 'No', source };
}

function missing(field: FormField, reason: string): Decision {
  return field.required ? { type: 'ask', reason } : { type: 'skip', reason };
}

function eeo(field: FormField, preferred: string, source: string): Decision {
  if (preferred) {
    const option = isChoice(field) ? pickOption(field.options, preferred) : preferred;
    if (option) return { type: 'value', value: option, source };
  }
  const decline = field.options.find((o) => DECLINE.test(o));
  if (decline) return { type: 'value', value: decline, source: 'Voluntary question: declined' };
  // Never guess identity questions. Optional ones are left blank.
  return field.required ? { type: 'ask', reason: 'Required self-identification question with no "decline" option' } : { type: 'skip', reason: 'Voluntary, left blank' };
}

interface Rule {
  test: RegExp;
  kinds?: (f: FormField) => boolean;
  resolve: (field: FormField, ctx: MatchContext) => Decision;
}

const RULES: Rule[] = [
  { test: /\b(resume|cv|curriculum)\b/, kinds: (f) => f.kind === 'file', resolve: () => ({ type: 'file', file: 'resume', source: 'Tailored resume' }) },
  {
    test: /cover\s*letter/,
    kinds: (f) => f.kind === 'file',
    resolve: (f, c) => (c.hasCoverLetterFile ? { type: 'file', file: 'coverLetter', source: 'Tailored cover letter' } : missing(f, 'No cover letter file')),
  },
  { test: /.*/, kinds: (f) => f.kind === 'file', resolve: (f) => missing(f, 'Unrecognised file upload') },

  { test: /(gender|pronoun|sex\b|sexual orientation|transgender)/, resolve: (f, c) => eeo(f, c.applicant.eeo.gender, 'Gender preference') },
  { test: /(race|ethnic|hispanic|latin)/, resolve: (f, c) => eeo(f, c.applicant.eeo.race, 'Race/ethnicity preference') },
  { test: /veteran|military status|protected veteran/, resolve: (f, c) => eeo(f, c.applicant.eeo.veteran, 'Veteran-status preference') },
  { test: /disabilit/, resolve: (f, c) => eeo(f, c.applicant.eeo.disability, 'Disability preference') },

  { test: /(authori[sz]ed|legally (eligible|permitted|able)|eligible|right) to work|work authori[sz]ation/, resolve: (f, c) => triState(f, c.applicant.workAuthorizedUS, 'Work authorization') },
  { test: /sponsor/, resolve: (f, c) => triState(f, c.applicant.requiresSponsorship, 'Visa sponsorship') },
  { test: /relocat/, resolve: (f, c) => triState(f, c.applicant.willingToRelocate, 'Relocation') },

  { test: /first\s*name|given name|preferred (first )?name/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.firstName, 'First name') },
  { test: /last\s*name|surname|family name/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.lastName, 'Last name') },
  { test: /^(your |full |legal )?(full )?name$/, kinds: isText, resolve: (f, c) => answer(f, `${c.applicant.firstName} ${c.applicant.lastName}`.trim(), 'Full name') },
  { test: /e-?mail/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.email, 'Email') },
  { test: /phone|mobile|telephone|cell/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.phone, 'Phone') },
  { test: /linked\s*in/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.linkedin, 'LinkedIn') },
  { test: /git\s*hub/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.github, 'GitHub') },
  {
    test: /portfolio|personal (web)?site|website|blog|other (link|url|website)|^url$/,
    kinds: isText,
    resolve: (f, c) => answer(f, c.applicant.portfolio || c.applicant.github, c.applicant.portfolio ? 'Portfolio' : 'GitHub'),
  },
  { test: /current (company|employer)|^(company|organi[sz]ation|employer)$/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.currentCompany, 'Current company') },
  { test: /current (job )?(title|role|position)/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.currentTitle, 'Current title') },
  { test: /salary|compensation|pay expectation|desired pay|expected pay|rate expectation/, resolve: (f, c) => answer(f, c.applicant.salaryExpectation, 'Salary expectation') },
  { test: /start date|notice period|when can you start|earliest (start|available)|availability/, resolve: (f, c) => answer(f, c.applicant.availability, 'Availability') },
  {
    test: /how did you (hear|find|learn)|where did you (hear|find|learn|see)|referral source|^source$/,
    resolve: (f, c) => {
      const wanted = c.applicant.howDidYouHear || c.sourceName || 'Job board';
      if (isChoice(f) && f.kind !== 'combobox') {
        const option =
          pickOption(f.options, wanted) ??
          (c.sourceName ? pickOption(f.options, c.sourceName) : null) ??
          pickOption(f.options, 'job board') ??
          pickOption(f.options, 'online job') ??
          pickOption(f.options, 'other');
        return option ? { type: 'value', value: option, source: 'How you heard' } : missing(f, 'No matching source option');
      }
      return { type: 'value', value: wanted, source: 'How you heard' };
    },
  },
  { test: /cover\s*letter/, kinds: (f) => f.kind === 'textarea', resolve: (f, c) => answer(f, c.coverLetterText, 'Cover letter') },
  {
    test: /additional information|anything else|comments|message to (the )?hiring|why (are you|do you want)/,
    kinds: (f) => f.kind === 'textarea',
    resolve: (f, c) => answer(f, c.coverLetterText, 'Cover letter'),
  },
  { test: /country/, resolve: (f, c) => answer(f, c.applicant.country, 'Country') },
  { test: /\b(location|city|where are you (based|located)|current address|address)\b/, kinds: isText, resolve: (f, c) => answer(f, c.applicant.location, 'Location') },
  {
    test: /privacy|consent|agree|acknowledg|terms|gdpr|data (processing|protection)|retain my/,
    kinds: (f) => f.kind === 'checkbox',
    resolve: (f, c) =>
      c.applicant.acceptDataConsent
        ? { type: 'check', value: true, source: 'Data-processing consent (allowed in Settings)' }
        : missing(f, 'Consent box: allow it in Settings, or tick it yourself'),
  },
];

/**
 * Decides what to put in one field. Precedence: the owner's per-application
 * answers, then the saved answer bank, then built-in rules. Anything without a
 * confident, truthful answer is returned as "ask" (if required) or "skip".
 */
export function decide(field: FormField, ctx: MatchContext): Decision {
  const label = field.label.toLowerCase().replace(/[*✱]/g, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return missing(field, 'Field has no label');

  const own = ctx.answers[questionKey(field.label)];
  if (own !== undefined && field.kind !== 'file') return answer(field, own, 'Your answer');

  if (field.kind !== 'file') {
    const banked = ctx.applicant.answerBank.find((a) => label.includes(a.question.toLowerCase()));
    if (banked) return answer(field, banked.answer, 'Answer bank');
  }

  for (const rule of RULES) {
    if ((rule.kinds ? rule.kinds(field) : true) && rule.test.test(label)) return rule.resolve(field, ctx);
  }
  return missing(field, 'No saved answer for this question');
}
