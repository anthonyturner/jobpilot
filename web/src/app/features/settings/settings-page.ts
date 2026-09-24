import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import { SOURCE_COLORS, timeUntil } from '../../core/format';
import type { Profile, Schedule, Skill, SourceId, SourceInfo } from '../../core/models';
import { RunTracker } from '../../core/run-tracker.service';
import { ChipInput } from '../../shared/chip-input';
import { ApplySettings } from './apply-settings';
import { CredentialsForm } from '../../shared/credentials-form';
import { Icon } from '../../shared/icon';

const CRON_PRESETS = [
  { cron: '30 7 * * 1-5', label: 'Weekdays 7:30am' },
  { cron: '30 15 * * 1-5', label: 'Weekdays 3:30pm' },
  { cron: '0 9 * * *', label: 'Every day 9am' },
  { cron: '0 */4 * * *', label: 'Every 4 hours' },
  { cron: '0 10 * * 6', label: 'Saturdays 10am' },
];

const WEIGHT_LABELS = ['', 'Nice to have', 'Core', 'Signature'];

@Component({
  selector: 'app-settings-page',
  imports: [FormsModule, ChipInput, Icon, ApplySettings, CredentialsForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly api = inject(ApiService);
  private readonly tracker = inject(RunTracker);

  protected readonly profile = signal<Profile | null>(null);
  protected readonly sources = signal<SourceInfo[]>([]);
  protected readonly schedules = signal<Schedule[]>([]);
  protected readonly timezone = signal('');
  protected readonly dirty = signal(false);
  protected readonly schedulesDirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly toast = signal<{ kind: 'good' | 'bad'; text: string } | null>(null);
  protected readonly newSkill = signal('');

  protected readonly presets = CRON_PRESETS;
  protected readonly weightLabels = WEIGHT_LABELS;
  protected readonly colors = SOURCE_COLORS;

  protected readonly sortedSkills = computed(() =>
    [...(this.profile()?.skills ?? [])].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)),
  );

  constructor() {
    this.api.profile().subscribe((p) => this.profile.set(p));
    this.api.sources().subscribe((s) => this.sources.set(s));
    this.loadSchedules();
  }

  /** Immutable update helper so signals notice every change. */
  protected edit<K extends keyof Profile>(key: K, value: Profile[K]): void {
    const current = this.profile();
    if (!current) return;
    this.profile.set({ ...current, [key]: value });
    this.dirty.set(true);
  }

  protected setMinSalary(value: string | number | null): void {
    const n = Number(value);
    this.edit('minSalary', value === '' || value === null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)));
  }

  protected cycleWeight(skill: Skill): void {
    const weight = skill.weight >= 3 ? 1 : skill.weight + 1;
    this.edit('skills', this.profile()!.skills.map((s) => (s.name === skill.name ? { ...s, weight } : s)));
  }

  protected removeSkill(skill: Skill): void {
    this.edit('skills', this.profile()!.skills.filter((s) => s.name !== skill.name));
  }

  protected addSkill(): void {
    const name = this.newSkill().trim();
    this.newSkill.set('');
    const skills = this.profile()?.skills ?? [];
    if (!name || skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    this.edit('skills', [...skills, { name, aliases: [], weight: 2 }]);
  }

  protected toggleSource(id: SourceId): void {
    const current = this.profile()!.enabledSources;
    this.edit('enabledSources', { ...current, [id]: current[id] === false });
  }

  protected sourceOn(id: SourceId): boolean {
    return this.profile()?.enabledSources[id] !== false;
  }

  protected setBoards(kind: 'greenhouse' | 'lever', slugs: string[]): void {
    const boards = this.profile()!.companyBoards;
    this.edit('companyBoards', { ...boards, [kind]: slugs.map((s) => s.toLowerCase().replace(/[^a-z0-9-]/g, '')) });
  }

  protected save(): void {
    const profile = this.profile();
    if (!profile) return;
    this.saving.set(true);
    this.api.saveProfile(profile).subscribe({
      next: (saved) => {
        this.profile.set(saved);
        this.dirty.set(false);
        this.saving.set(false);
        this.flash('good', 'Profile saved. Every job has been rescored.');
        this.tracker.revision.update((n) => n + 1);
        this.api.sources().subscribe((s) => this.sources.set(s));
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.flash('bad', this.describe(err));
      },
    });
  }

  protected refreshSources(): void {
    this.api.sources().subscribe((s) => this.sources.set(s));
    this.flash('good', 'Keys saved.');
  }

  // ---- Schedules ----
  protected updateSchedule(index: number, patch: Partial<Schedule>): void {
    this.schedules.update((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    this.schedulesDirty.set(true);
  }

  protected addSchedule(): void {
    const id = `sweep-${Date.now().toString(36)}`;
    this.schedules.update((list) => [...list, { id, label: 'New sweep', cron: '0 12 * * 1-5', enabled: true }]);
    this.schedulesDirty.set(true);
  }

  protected removeSchedule(index: number): void {
    this.schedules.update((list) => list.filter((_, i) => i !== index));
    this.schedulesDirty.set(true);
  }

  protected saveSchedules(): void {
    this.api.saveSchedules(this.schedules()).subscribe({
      next: (s) => {
        this.schedules.set(s.schedules);
        this.schedulesDirty.set(false);
        this.flash('good', 'Schedule updated. It takes effect immediately.');
      },
      error: (err: HttpErrorResponse) => this.flash('bad', this.describe(err)),
    });
  }

  protected until(iso: string | null | undefined): string {
    return timeUntil(iso);
  }

  private loadSchedules(): void {
    this.api.schedules().subscribe((s) => {
      this.schedules.set(s.schedules);
      this.timezone.set(s.timezone);
    });
  }

  private describe(err: HttpErrorResponse): string {
    const issues = (err.error as { issues?: Array<{ path: string; message: string }> })?.issues;
    return issues?.length ? `Check ${issues[0]!.path || 'your input'}: ${issues[0]!.message}` : 'Could not save. Is the server running?';
  }

  protected flash(kind: 'good' | 'bad', text: string): void {
    this.toast.set({ kind, text });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
