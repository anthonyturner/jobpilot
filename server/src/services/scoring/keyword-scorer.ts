import type { NormalizedJob, ScoreBreakdown } from '../../domain/job.js';
import type { Profile, Skill } from '../../domain/profile.js';
import { annualize } from '../normalize.js';
import type { JobScorer } from './job-scorer.js';

const MAX = { skills: 50, title: 25, location: 15, recency: 10 } as const;
/** Matching this much skill weight earns the full skills score; a posting never lists everything. */
const SKILL_WEIGHT_FOR_FULL_MARKS = 12;
/** Listings with less text than this (e.g. Indeed search results) cannot be skill-matched fairly. */
const MIN_DESCRIPTION_CHARS = 200;
const NEUTRAL_SKILL_SHARE = 0.3;

const DAY_MS = 86_400_000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const termCache = new Map<string, RegExp>();
/** Whole-term match that also works for terms like "C#", ".NET" and "Node.js". */
export function containsTerm(haystack: string, term: string): boolean {
  const key = term.toLowerCase();
  let re = termCache.get(key);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9])${escapeRegex(key)}(?![a-z0-9#+])`, 'i');
    termCache.set(key, re);
  }
  return re.test(haystack);
}

function skillMatches(skill: Skill, haystack: string): boolean {
  return [skill.name, ...skill.aliases].some((term) => containsTerm(haystack, term));
}

function cityOf(location: string): string {
  return (location.split(',')[0] ?? '').trim().toLowerCase();
}

export class KeywordJobScorer implements JobScorer {
  score(job: NormalizedJob, profile: Profile, now: Date = new Date()): ScoreBreakdown {
    const title = job.title.toLowerCase();
    const haystack = `${job.title}\n${job.tags.join(' ')}\n${job.descriptionText}`.toLowerCase();

    const skills = this.scoreSkills(profile.skills, title, haystack, job.descriptionText.length < MIN_DESCRIPTION_CHARS);
    const titleScore = this.scoreTitle(profile, title);
    const location = this.scoreLocation(job, profile);
    const recency = this.scoreRecency(job.postedAt, now);
    const penalties = this.scorePenalties(job, profile, title, haystack);

    const total = Math.max(
      0,
      Math.min(100, Math.round(skills.points + titleScore.points + location.points + recency.points + penalties.points)),
    );
    return { total, skills, title: titleScore, location, recency, penalties };
  }

  private scoreSkills(skills: Skill[], title: string, haystack: string, limitedData: boolean): ScoreBreakdown['skills'] {
    const matched: string[] = [];
    const missing: string[] = [];
    let weight = 0;
    for (const skill of skills) {
      if (skillMatches(skill, haystack)) {
        matched.push(skill.name);
        // A skill in the title is a stronger signal than one buried in the body.
        weight += skill.weight + (skillMatches(skill, title) ? 1 : 0);
      } else if (skill.weight >= 2) {
        missing.push(skill.name);
      }
    }
    let points = Math.min(1, weight / SKILL_WEIGHT_FOR_FULL_MARKS) * MAX.skills;
    // Without a description, absence of a skill says nothing; give neutral credit instead of zero.
    if (limitedData) points = Math.max(points, MAX.skills * NEUTRAL_SKILL_SHARE);
    return { points: Math.round(points), max: MAX.skills, matched, missing: limitedData ? [] : missing, limitedData };
  }

  private scoreTitle(profile: Profile, title: string): ScoreBreakdown['title'] {
    const direct = profile.targetTitles.find((t) => containsTerm(title, t));
    if (direct) return { points: MAX.title, max: MAX.title, matchedTerm: direct };
    const skill = profile.skills.find((s) => s.weight >= 2 && skillMatches(s, title));
    if (skill) return { points: Math.round(MAX.title * 0.5), max: MAX.title, matchedTerm: skill.name };
    if (/\b(engineer|developer|programmer)\b/.test(title)) {
      return { points: Math.round(MAX.title * 0.3), max: MAX.title, matchedTerm: null };
    }
    return { points: 0, max: MAX.title, matchedTerm: null };
  }

  private scoreLocation(job: NormalizedJob, profile: Profile): ScoreBreakdown['location'] {
    const preferredCities = profile.preferredLocations.map(cityOf).filter((c) => c && c !== 'remote');
    const jobLocation = job.location.toLowerCase();
    const isPreferredPlace = preferredCities.some((city) => jobLocation.includes(city));
    const max = MAX.location;

    if (job.remoteType === 'remote') {
      return { points: max, max, reason: 'Remote' };
    }
    if (profile.remotePreference === 'remote-only') {
      return { points: 0, max, reason: 'Not remote' };
    }
    if (job.remoteType === 'hybrid') {
      return isPreferredPlace
        ? { points: max, max, reason: 'Hybrid near you' }
        : { points: Math.round(max * 0.3), max, reason: 'Hybrid, outside your area' };
    }
    if (job.remoteType === 'unknown') {
      return { points: Math.round(max * 0.4), max, reason: 'Work arrangement not stated' };
    }
    if (isPreferredPlace) {
      const points = profile.remotePreference === 'any' ? max : Math.round(max * 0.7);
      return { points, max, reason: 'On-site in a preferred area' };
    }
    return { points: 0, max, reason: 'On-site outside your area' };
  }

  private scoreRecency(postedAt: string | null, now: Date): ScoreBreakdown['recency'] {
    const max = MAX.recency;
    if (!postedAt) return { points: Math.round(max * 0.4), max };
    const ageDays = (now.getTime() - new Date(postedAt).getTime()) / DAY_MS;
    if (ageDays <= 3) return { points: max, max };
    if (ageDays <= 7) return { points: 7, max };
    if (ageDays <= 14) return { points: 4, max };
    if (ageDays <= 30) return { points: 2, max };
    return { points: 0, max };
  }

  private scorePenalties(
    job: NormalizedJob,
    profile: Profile,
    title: string,
    haystack: string,
  ): ScoreBreakdown['penalties'] {
    const reasons: string[] = [];
    let points = 0;
    for (const keyword of profile.excludeKeywords) {
      if (containsTerm(title, keyword)) {
        points -= 40;
        reasons.push(`Title mentions "${keyword}"`);
      } else if (containsTerm(haystack, keyword)) {
        points -= 10;
        reasons.push(`Description mentions "${keyword}"`);
      }
    }
    if (profile.minSalary !== null) {
      const top = job.salaryMax ?? job.salaryMin;
      if (top !== null && annualize(top, job.salaryPeriod) < profile.minSalary) {
        points -= 15;
        reasons.push('Pay is below your floor');
      }
    }
    return { points: Math.max(points, -60), reasons };
  }
}
