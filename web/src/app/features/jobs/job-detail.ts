import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../core/api.service';
import {
  REMOTE_LABELS,
  SCORE_COLORS,
  SOURCE_COLORS,
  SOURCE_LABELS,
  STATUS_META,
  formatSalary,
  scoreTone,
  timeAgo,
} from '../../core/format';
import { JOB_STATUSES, type JobDetail, type JobStatus, type JobSummary } from '../../core/models';
import { CompanyAvatar } from '../../shared/company-avatar';
import { Icon } from '../../shared/icon';
import { ScoreRing } from '../../shared/score-ring';

@Component({
  selector: 'app-job-detail',
  imports: [CompanyAvatar, ScoreRing, Icon, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './job-detail.html',
  styleUrl: './job-detail.scss',
})
export class JobDetailPanel {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly jobId = input.required<string>();
  readonly changed = output<JobSummary>();
  readonly closed = output<void>();

  protected readonly job = signal<JobDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly notes = signal('');
  protected readonly notesSaved = signal(false);
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | null>(null);
  private readonly notes$ = new Subject<string>();

  protected readonly statuses = JOB_STATUSES.filter((s) => s !== 'new');
  protected readonly statusMeta = STATUS_META;
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly sourceColors = SOURCE_COLORS;

  protected readonly salary = computed(() => (this.job() ? formatSalary(this.job()!) : null));
  protected readonly remote = computed(() => (this.job() ? REMOTE_LABELS[this.job()!.remoteType] : ''));
  protected readonly posted = computed(() => timeAgo(this.job()?.postedAt ?? this.job()?.firstSeenAt));
  protected readonly firstSeen = computed(() => timeAgo(this.job()?.firstSeenAt));
  protected readonly toneColor = computed(() => SCORE_COLORS[scoreTone(this.job()?.score ?? 0)]);
  protected readonly verdict = computed(() => {
    const s = this.job()?.score ?? 0;
    return s >= 80 ? 'Excellent match' : s >= 65 ? 'Strong match' : s >= 45 ? 'Worth a look' : 'Long shot';
  });
  protected readonly bars = computed(() => {
    const b = this.job()?.scoreBreakdown;
    if (!b) return [];
    return [
      { label: 'Skills', points: b.skills.points, max: b.skills.max, note: b.skills.limitedData ? 'Estimated (no description)' : `${b.skills.matched.length} matched` },
      { label: 'Title', points: b.title.points, max: b.title.max, note: b.title.matchedTerm ? `“${b.title.matchedTerm}”` : 'No direct match' },
      { label: 'Location', points: b.location.points, max: b.location.max, note: b.location.reason },
      { label: 'Freshness', points: b.recency.points, max: b.recency.max, note: this.posted() },
    ];
  });

  constructor() {
    effect(() => {
      const id = this.jobId();
      untracked(() => this.load(id));
    });
    this.notes$.pipe(debounceTime(700), takeUntilDestroyed()).subscribe((notes) => this.patch({ notes }, true));
  }

  protected setStatus(status: JobStatus): void {
    this.patch({ status });
  }

  /** Starts (or reopens) the assisted application for this job. */
  protected prepareApplication(): void {
    const id = this.job()?.id;
    if (!id) return;
    this.starting.set(true);
    this.startError.set(null);
    this.api.startApplication(id).subscribe({
      next: (app) => void this.router.navigate(['/applications', app.id]),
      error: (err: HttpErrorResponse) => {
        this.starting.set(false);
        this.startError.set((err.error as { error?: string })?.error ?? 'Could not start the application.');
      },
    });
  }

  protected toggleStar(): void {
    this.patch({ starred: !this.job()?.starred });
  }

  protected onNotes(value: string): void {
    this.notes.set(value);
    this.notesSaved.set(false);
    this.notes$.next(value);
  }

  protected historyLabel(action: string, detail: string): string {
    switch (action) {
      case 'job.status':
        return `Moved ${detail.replace('->', '→')}`;
      case 'job.starred':
        return 'Starred';
      case 'job.unstarred':
        return 'Unstarred';
      case 'job.notes':
        return 'Notes updated';
      default:
        return action;
    }
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.api.getJob(id).subscribe({
      next: (job) => {
        this.job.set(job);
        this.notes.set(job.notes);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private patch(patch: { status?: JobStatus; starred?: boolean; notes?: string }, quiet = false): void {
    const id = this.job()?.id;
    if (!id) return;
    this.api.updateJob(id, patch).subscribe((updated) => {
      if (quiet) this.notesSaved.set(true);
      this.changed.emit({ ...updated, snippet: '' });
      // Reload for fresh history, keeping in-progress notes untouched.
      this.api.getJob(id).subscribe((job) => this.job.set({ ...job, notes: this.notes() }));
    });
  }
}
