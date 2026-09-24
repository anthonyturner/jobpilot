import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import type { Profile, ResumeDoc, SetupStatus, Skill } from '../../core/models';
import { RunTracker } from '../../core/run-tracker.service';
import { markSetupComplete } from '../../core/setup.guard';
import { ChipInput } from '../../shared/chip-input';
import { CredentialsForm } from '../../shared/credentials-form';
import { Icon, type IconName } from '../../shared/icon';

interface Step {
  title: string;
  icon: IconName;
}

/** First-run wizard: resume → about you → what to look for → job sources → done. */
@Component({
  selector: 'app-setup-page',
  imports: [FormsModule, ChipInput, CredentialsForm, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setup-page.html',
  styleUrl: './setup-page.scss',
})
export class SetupPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly tracker = inject(RunTracker);
  private readonly credentialsForm = viewChild(CredentialsForm);

  protected readonly steps: Step[] = [
    { title: 'Welcome', icon: 'sparkles' },
    { title: 'Your resume', icon: 'briefcase' },
    { title: 'About you', icon: 'target' },
    { title: 'What to look for', icon: 'search' },
    { title: 'Job sources', icon: 'globe' },
  ];
  protected readonly step = signal(0);
  protected readonly status = signal<SetupStatus | null>(null);
  protected readonly profile = signal<Profile | null>(null);
  protected readonly resume = signal<ResumeDoc | null>(null);
  protected readonly uploading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dragOver = signal(false);

  constructor() {
    this.api.setupStatus().subscribe((s) => this.status.set(s));
    this.api.profile().subscribe((p) => this.profile.set(p));
    this.api.resume().subscribe((r) => this.resume.set(r.resume));
  }

  protected next(): void {
    this.error.set(null);
    this.step.update((s) => Math.min(this.steps.length - 1, s + 1));
    window.scrollTo({ top: 0 });
  }

  protected back(): void {
    this.error.set(null);
    this.step.update((s) => Math.max(0, s - 1));
  }

  protected onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.upload(file);
  }

  protected edit<K extends keyof Profile>(key: K, value: Profile[K]): void {
    const p = this.profile();
    if (p) this.profile.set({ ...p, [key]: value });
  }

  protected skillNames(): string[] {
    return this.profile()?.skills.map((s) => s.name) ?? [];
  }

  /** Keeps weights for skills that stay; new ones start as "core". */
  protected setSkills(names: string[]): void {
    const current = this.profile()?.skills ?? [];
    const skills: Skill[] = names.map((name) => current.find((s) => s.name === name) ?? { name, aliases: [], weight: 2 });
    this.edit('skills', skills);
  }

  protected setMinSalary(value: string | number | null): void {
    const n = Number(value);
    this.edit('minSalary', value === '' || value === null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)));
  }

  protected canContinue(): boolean {
    const p = this.profile();
    switch (this.step()) {
      case 2:
        return !!p && p.fullName.trim().length > 0 && p.primaryLocation.trim().length > 0;
      case 3:
        return !!p && p.searchQueries.length > 0;
      default:
        return true;
    }
  }

  /** Saves keys and profile, marks setup complete, and kicks off the first sweep. */
  protected async finish(): Promise<void> {
    const profile = this.profile();
    if (!profile) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.credentialsForm()?.save();
      await new Promise<void>((resolve, reject) => this.api.saveProfile(profile).subscribe({ next: () => resolve(), error: reject }));
      await new Promise<void>((resolve, reject) => this.api.completeSetup().subscribe({ next: () => resolve(), error: reject }));
      markSetupComplete();
      this.tracker.start();
      await this.router.navigate(['/jobs']);
    } catch (err) {
      const body = (err as HttpErrorResponse).error as { error?: string; issues?: Array<{ path: string; message: string }> } | undefined;
      const issue = body?.issues?.[0];
      this.error.set(issue ? `${issue.path}: ${issue.message}` : (body?.error ?? 'Could not finish setup. Is the server running?'));
      this.busy.set(false);
    }
  }

  private upload(file: File): void {
    if (!/\.docx$/i.test(file.name)) {
      this.error.set('Please choose a Word (.docx) file. You can export one from Google Docs or Word.');
      return;
    }
    this.uploading.set(true);
    this.error.set(null);
    this.api.uploadResume(file).subscribe({
      next: (resume) => {
        this.resume.set(resume);
        this.uploading.set(false);
        this.applySuggestions();
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.error.set((err.error as { error?: string })?.error ?? 'That file could not be read.');
      },
    });
  }

  /** Pre-fills the profile from the resume; the user reviews everything on the next steps. */
  private applySuggestions(): void {
    this.api.suggestions().subscribe((s) => {
      const p = this.profile();
      if (!s || !p) return;
      this.profile.set({
        ...p,
        fullName: s.fullName || p.fullName,
        headline: s.headline || p.headline,
        primaryLocation: s.primaryLocation || p.primaryLocation,
        preferredLocations: [...new Set(['Remote', s.primaryLocation].filter(Boolean))],
        skills: s.skills.length ? s.skills : p.skills,
        targetTitles: s.targetTitles.length ? s.targetTitles : p.targetTitles,
        searchQueries: s.searchQueries.length ? s.searchQueries : p.searchQueries,
      });
    });
  }
}
