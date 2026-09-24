import type { Skill } from '../../domain/profile.js';
import type { Resume } from '../../domain/resume.js';

export interface ProfileSuggestions {
  fullName: string;
  headline: string;
  primaryLocation: string;
  skills: Skill[];
  targetTitles: string[];
  searchQueries: string[];
}

/** Single words that would match nearly every job; not useful as searches or target titles. */
const TOO_GENERIC = new Set(['engineer', 'developer', 'programmer', 'consultant', 'analyst', 'specialist', 'manager']);

const SENIORITY = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|intern|internship|associate|i{1,3}|iv)\b/gi;

function unique(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, ' ').trim();
    const key = value.toLowerCase();
    if (value.length < 2 || value.length > 60 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** "Angular 19, TypeScript, RxJS (Signals)" -> ["Angular", "TypeScript", "RxJS"] */
export function splitSkillList(items: string): string[] {
  return items
    .replace(/\([^)]*\)/g, '')
    .split(/,|;|\s\/\s|\s&\s|\band\b/)
    .flatMap((s) => (/^[^\s/]+\/[^\s/]+$/.test(s.trim()) ? s.split('/') : [s]))
    .map((s) => s.replace(/\b\d+(\.\d+)?\b/g, '').replace(/^[\s.:-]+|[\s:-]+$/g, '').trim())
    .filter((s) => s.length >= 1 && s.split(' ').length <= 4);
}

/**
 * Turns an imported resume into starting values for the search profile. These are
 * only suggestions: the setup wizard shows them for the user to edit before saving.
 */
export function suggestFromResume(resume: Resume): ProfileSuggestions {
  const skillNames = unique(resume.skills.flatMap((s) => splitSkillList(s.items)), 30);
  // Skills listed first in the first two groups are usually the person's core stack.
  const core = new Set(resume.skills.slice(0, 2).flatMap((s) => splitSkillList(s.items).slice(0, 3)).map((s) => s.toLowerCase()));
  const skills: Skill[] = skillNames.map((name) => ({ name, aliases: [], weight: core.has(name.toLowerCase()) ? 3 : 2 }));

  const headlineTitle = resume.headline.split('|')[0]?.trim() ?? '';
  const roleTitles = resume.experience.map((e) => e.title);
  const targetTitles = unique(
    [headlineTitle, ...roleTitles]
      .map((t) => t.replace(SENIORITY, '').replace(/[|()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
      .filter((t) => !TOO_GENERIC.has(t)),
    8,
  );

  const topSkills = skills.filter((s) => s.weight === 3).slice(0, 2);
  const searchQueries = unique(
    [headlineTitle, ...roleTitles.slice(0, 2)]
      .map((t) => t.replace(SENIORITY, '').replace(/\s+/g, ' ').trim())
      .filter((t) => !TOO_GENERIC.has(t.toLowerCase()))
      .concat(topSkills.map((s) => `${s.name} developer`)),
    5,
  );

  return {
    fullName: resume.name,
    headline: resume.headline,
    primaryLocation: resume.contact.location || 'Remote',
    skills,
    targetTitles: targetTitles.length ? targetTitles : ['software engineer'],
    searchQueries: searchQueries.length ? searchQueries : ['Software engineer'],
  };
}
