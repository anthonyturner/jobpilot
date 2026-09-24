import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup, transferArrayItem } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { STATUS_META, formatSalary, timeAgo } from '../../core/format';
import type { JobStatus, JobSummary } from '../../core/models';
import { RunTracker } from '../../core/run-tracker.service';
import { CompanyAvatar } from '../../shared/company-avatar';
import { Icon, type IconName } from '../../shared/icon';
import { ScoreRing } from '../../shared/score-ring';

interface Column {
  status: JobStatus;
  icon: IconName;
  accent: string;
  hint: string;
}

const COLUMNS: Column[] = [
  { status: 'saved', icon: 'star', accent: '#38bdf8', hint: 'Shortlisted to look at properly' },
  { status: 'applying', icon: 'send', accent: '#fbbf24', hint: 'Tailoring resume and cover letter' },
  { status: 'applied', icon: 'check', accent: '#34d399', hint: 'Submitted, waiting to hear back' },
  { status: 'interviewing', icon: 'calendar', accent: '#a78bfa', hint: 'In conversation' },
  { status: 'offer', icon: 'sparkles', accent: '#f472b6', hint: 'Offer on the table' },
  { status: 'rejected', icon: 'x', accent: '#94a3b8', hint: 'Closed out' },
];

@Component({
  selector: 'app-pipeline-page',
  imports: [CdkDropListGroup, CdkDropList, CdkDrag, CompanyAvatar, ScoreRing, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pipeline-page.html',
  styleUrl: './pipeline-page.scss',
})
export class PipelinePage {
  private readonly api = inject(ApiService);
  private readonly tracker = inject(RunTracker);

  protected readonly columns = COLUMNS;
  protected readonly meta = STATUS_META;
  protected readonly lanes = signal<Partial<Record<JobStatus, JobSummary[]>>>({});
  protected readonly loading = signal(true);
  protected readonly totalTracked = computed(() => Object.values(this.lanes()).reduce((n, l) => n + l.length, 0));
  protected readonly appliedCount = computed(() => {
    const l = this.lanes();
    return (l.applied?.length ?? 0) + (l.interviewing?.length ?? 0) + (l.offer?.length ?? 0);
  });

  constructor() {
    forkJoin(
      Object.fromEntries(COLUMNS.map((c) => [c.status, this.api.listJobs({ status: c.status, sort: 'score', limit: 200 })])),
    ).subscribe((pages) => {
      this.lanes.set(Object.fromEntries(Object.entries(pages).map(([status, page]) => [status, page.items])));
      this.loading.set(false);
    });
  }

  protected drop(event: CdkDragDrop<JobSummary[]>, status: JobStatus): void {
    if (event.previousContainer === event.container) return;
    const job = event.previousContainer.data[event.previousIndex]!;
    transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
    this.lanes.update((l) => ({ ...l }));
    this.api.updateJob(job.id, { status }).subscribe({
      next: () => this.tracker.refreshStats(),
      // Put the card back if the server refused the move.
      error: () =>
        transferArrayItem(event.container.data, event.previousContainer.data, event.currentIndex, event.previousIndex),
    });
  }

  protected salary(job: JobSummary): string | null {
    return formatSalary(job);
  }

  protected ago(job: JobSummary): string {
    return timeAgo(job.updatedAt);
  }
}
