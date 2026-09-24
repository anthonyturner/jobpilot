import type { Profile } from '../src/domain/profile.js';

/** A fictional user's profile, used wherever tests need realistic matching behaviour. */
export const SAMPLE_PROFILE: Profile = {
  fullName: 'Jane Dev',
  headline: 'Full-Stack Engineer | Angular + .NET',
  primaryLocation: 'Denver, CO',
  preferredLocations: ['Remote', 'Denver, CO', 'Boulder, CO'],
  remotePreference: 'remote-or-hybrid',
  searchQueries: ['Angular .NET developer', 'Full stack .NET engineer'],
  targetTitles: ['full stack', 'full-stack', 'software engineer', 'software developer', '.net developer', 'angular'],
  skills: [
    { name: 'Angular', aliases: ['AngularJS'], weight: 3 },
    { name: 'C#', aliases: ['csharp'], weight: 3 },
    { name: '.NET', aliases: ['ASP.NET', 'ASP.NET Core', '.NET Core', 'dotnet'], weight: 3 },
    { name: 'TypeScript', aliases: [], weight: 3 },
    { name: 'SQL Server', aliases: ['MSSQL', 'T-SQL'], weight: 2 },
    { name: 'Azure', aliases: ['Azure DevOps'], weight: 2 },
    { name: 'RxJS', aliases: [], weight: 2 },
    { name: 'REST APIs', aliases: ['REST', 'RESTful'], weight: 2 },
    { name: 'JavaScript', aliases: [], weight: 2 },
    { name: 'React', aliases: ['Next.js'], weight: 1 },
    { name: 'Python', aliases: ['Django'], weight: 1 },
  ],
  excludeKeywords: ['internship', 'unpaid', 'commission only'],
  minSalary: 100_000,
  minScoreToKeep: 30,
  maxAgeDays: 30,
  enabledSources: {},
  companyBoards: { greenhouse: [], lever: [] },
};
