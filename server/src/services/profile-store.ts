import { DEFAULT_PROFILE, DEFAULT_SCHEDULES } from '../domain/default-profile.js';
import { ProfileSchema, SchedulesSchema, type Profile, type Schedule } from '../domain/profile.js';
import type { SettingsRepository } from '../persistence/settings-repository.js';

/** Typed access to the profile and schedules, which live in the settings table. */
export class ProfileStore {
  constructor(private readonly settings: SettingsRepository) {}

  getProfile(): Profile {
    return this.settings.get('profile', ProfileSchema, DEFAULT_PROFILE);
  }

  saveProfile(profile: Profile): Profile {
    const valid = ProfileSchema.parse(profile);
    this.settings.set('profile', valid);
    return valid;
  }

  getSchedules(): Schedule[] {
    return this.settings.get('schedules', SchedulesSchema, DEFAULT_SCHEDULES);
  }

  saveSchedules(schedules: Schedule[]): Schedule[] {
    const valid = SchedulesSchema.parse(schedules);
    this.settings.set('schedules', valid);
    return valid;
  }
}
