import type { Profile, Schedule } from './profile.js';

/**
 * Neutral placeholder profile for a fresh install. The first-run setup wizard
 * replaces it with the user's own details (usually suggested from their resume),
 * and sweeps are blocked until setup is complete.
 */
export const DEFAULT_PROFILE: Profile = {
  fullName: 'New User',
  headline: '',
  primaryLocation: 'Remote',
  preferredLocations: ['Remote'],
  remotePreference: 'remote-or-hybrid',
  searchQueries: ['Software engineer'],
  targetTitles: ['software engineer', 'software developer', 'developer', 'engineer'],
  skills: [],
  excludeKeywords: ['internship', 'unpaid', 'commission only'],
  minSalary: null,
  minScoreToKeep: 30,
  maxAgeDays: 30,
  enabledSources: {
    indeed: true,
    remotive: true,
    remoteok: true,
    arbeitnow: false,
    themuse: true,
    adzuna: true,
    usajobs: true,
    jsearch: true,
    greenhouse: true,
    lever: true,
  },
  companyBoards: { greenhouse: [], lever: [] },
};

export const DEFAULT_SCHEDULES: Schedule[] = [
  { id: 'morning', label: 'Weekday morning sweep', cron: '30 7 * * 1-5', enabled: true },
  { id: 'afternoon', label: 'Weekday afternoon sweep', cron: '30 15 * * 1-5', enabled: true },
  { id: 'weekend', label: 'Saturday catch-up', cron: '0 10 * * 6', enabled: false },
];
