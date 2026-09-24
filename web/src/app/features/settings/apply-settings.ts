import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { timeAgo } from '../../core/format';
import type { Applicant, AtsId, AtsMode, Automation, ResumeDoc } from '../../core/models';
import { Icon } from '../../shared/icon';

type TriKey = 'workAuthorizedUS' | 'requiresSponsorship' | 'willingToRelocate';

/** Phase-2 settings: base resume, facts used to fill forms, and the automation policy. */
@Component({
  selector: 'app-apply-settings',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './apply-settings.html',
  styleUrl: './settings-page.scss',
})
export class ApplySettings {
  private readonly api = inject(ApiService);
  readonly notify = output<{ kind: 'good' | 'bad'; text: string }>();

  protected readonly resume = signal<ResumeDoc | null>(null);
  protected readonly resumePath = signal('');
  protected readonly importing = signal(false);
  protected readonly applicant = signal<Applicant | null>(null);
  protected readonly applicantDirty = signal(false);
  protected readonly automation = signal<Automation | null>(null);

  protected readonly triFields: Array<{ key: TriKey; label: string }> = [
    { key: 'workAuthorizedUS', label: 'Authorized to work in the US without restriction' },
    { key: 'requiresSponsorship', label: 'Need visa sponsorship now or in the future' },
    { key: 'willingToRelocate', label: 'Willing to relocate' },
  ];
  protected readonly atsList: Array<{ id: AtsId; name: string }> = [
    { id: 'greenhouse', name: 'Greenhouse' },
    { id: 'lever', name: 'Lever' },
  ];

  constructor() {
    this.api.resume().subscribe((r) => {
      this.resume.set(r.resume);
      this.resumePath.set(r.resume?.sourceFile || r.defaultPath);
    });
    this.api.applicant().subscribe((a) => this.applicant.set(a));
    this.api.automation().subscribe((a) => this.automation.set(a));
  }

  protected uploadResume(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.importing.set(true);
    this.api.uploadResume(file).subscribe({
      next: (resume) => this.imported(resume),
      error: (err: HttpErrorResponse) => {
        this.importing.set(false);
        this.notify.emit({ kind: 'bad', text: (err.error as { error?: string })?.error ?? 'That file could not be read.' });
      },
    });
  }

  private imported(resume: ResumeDoc): void {
    this.resume.set(resume);
    this.importing.set(false);
    this.api.applicant().subscribe((a) => this.applicant.set(a));
    this.notify.emit({ kind: 'good', text: `Imported ${resume.experience.length} roles and ${resume.projects.length} projects.` });
  }

  protected importResume(): void {
    this.importing.set(true);
    this.api.importResume(this.resumePath()).subscribe({
      next: (resume) => this.imported(resume),
      error: (err: HttpErrorResponse) => {
        this.importing.set(false);
        this.notify.emit({ kind: 'bad', text: (err.error as { error?: string })?.error ?? 'Import failed.' });
      },
    });
  }

  protected edit<K extends keyof Applicant>(key: K, value: Applicant[K]): void {
    const current = this.applicant();
    if (!current) return;
    this.applicant.set({ ...current, [key]: value });
    this.applicantDirty.set(true);
  }

  protected setTri(key: TriKey, value: string): void {
    this.edit(key, value === 'yes' ? true : value === 'no' ? false : null);
  }

  protected tri(key: TriKey): string {
    const v = this.applicant()?.[key];
    return v === true ? 'yes' : v === false ? 'no' : '';
  }

  protected setEeo(key: keyof Applicant['eeo'], value: string): void {
    this.edit('eeo', { ...this.applicant()!.eeo, [key]: value });
  }

  protected setBank(index: number, part: 'question' | 'answer', value: string): void {
    this.edit('answerBank', this.applicant()!.answerBank.map((b, i) => (i === index ? { ...b, [part]: value } : b)));
  }

  protected addBank(): void {
    this.edit('answerBank', [...this.applicant()!.answerBank, { question: '', answer: '' }]);
  }

  protected removeBank(index: number): void {
    this.edit('answerBank', this.applicant()!.answerBank.filter((_, i) => i !== index));
  }

  protected saveApplicant(): void {
    const applicant = this.applicant();
    if (!applicant) return;
    const cleaned = { ...applicant, answerBank: applicant.answerBank.filter((b) => b.question.trim().length >= 3 && b.answer.trim()) };
    this.api.saveApplicant(cleaned).subscribe({
      next: (saved) => {
        this.applicant.set(saved);
        this.applicantDirty.set(false);
        this.notify.emit({ kind: 'good', text: 'Application details saved.' });
      },
      error: (err: HttpErrorResponse) => {
        const issue = (err.error as { issues?: Array<{ path: string; message: string }> })?.issues?.[0];
        this.notify.emit({ kind: 'bad', text: issue ? `${issue.path}: ${issue.message}` : 'Could not save.' });
      },
    });
  }

  /** Automation changes save immediately; the kill switch in particular must take effect at once. */
  protected updateAutomation(patch: Partial<Automation>): void {
    const current = this.automation();
    if (!current) return;
    const next = { ...current, ...patch };
    this.automation.set(next);
    this.api.saveAutomation(next).subscribe({
      next: (saved) => {
        this.automation.set(saved);
        if (patch.enabled === false) this.notify.emit({ kind: 'good', text: 'Automation stopped. Any open JobPilot browser windows were closed.' });
      },
      error: () => this.notify.emit({ kind: 'bad', text: 'Could not save automation settings.' }),
    });
  }

  protected setMode(ats: AtsId, mode: AtsMode): void {
    this.updateAutomation({ modes: { ...this.automation()!.modes, [ats]: mode } });
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }
}
