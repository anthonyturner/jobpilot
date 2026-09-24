import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { combineLatest, debounceTime, switchMap, tap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { SOURCE_LABELS, greeting } from '../../core/format';
import type { JobQuery, JobSummary, SourceId } from '../../core/models';
import { RunTracker } from '../../core/run-tracker.service';
import { Icon } from '../../shared/icon';
import { JobCard } from './job-card';
import { JobDetailPanel } from './job-detail';

type View = 'all' | 'new' | 'starred' | 'saved' | 'hidden';

const PAGE = 40;

@Component({
  selector: 'app-jobs-page',
  imports: [FormsModule, Icon, JobCard, JobDetailPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './jobs-page.html',
  styleUrl: './jobs-page.scss',
})
export class JobsPage {
  private readonly api = inject(ApiService);
  protected readonly tracker = inject(RunTracker);

  protected readonly greeting = greeting();
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly sourceIds = Object.keys(SOURCE_LABELS) as SourceId[];

  // Filters
  protected readonly search = signal('');
  protected readonly view = signal<View>('all');
  protected readonly remote = signal<'' | 'remote' | 'hybrid' | 'onsite'>('');
  protected readonly minScore = signal(0);
  protected readonly source = signal<SourceId | ''>('');
  protected readonly sort = signal<'score' | 'posted' | 'seen'>('score');

  // Data
  protected readonly jobs = signal<JobSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly selectedId = signal<string | null>(null);

  protected readonly views: Array<{ id: View; label: string }> = [
    { id: 'all', label: 'All matches' },
    { id: 'new', label: 'New' },
    { id: 'starred', label: 'Starred' },
    { id: 'saved', label: 'Saved' },
    { id: 'hidden', label: 'Hidden' },
  ];

  protected readonly firstName = signal('there');
  protected readonly stats = computed(() => this.tracker.stats());
  protected readonly hasMore = computed(() => this.jobs().length < this.total());
  protected readonly filtersActive = computed(
    () => !!this.search() || !!this.remote() || this.minScore() > 0 || !!this.source() || this.view() !== 'all',
  );

  private readonly query = computed<JobQuery>(() => {
    const view = this.view();
    return {
      q: this.search().trim() || undefined,
      status: view === 'new' ? 'new' : view === 'saved' ? 'saved' : view === 'hidden' ? 'hidden' : 'active',
      starred: view === 'starred' ? true : undefined,
      remoteType: this.remote() || undefined,
      minScore: this.minScore() || undefined,
      source: this.source() || undefined,
      sort: this.sort(),
      limit: PAGE,
    };
  });

  constructor() {
    this.api.profile().subscribe((p) => this.firstName.set(p.fullName.split(' ')[0] ?? 'there'));

    combineLatest([toObservable(this.query), toObservable(this.tracker.revision)])
      .pipe(
        debounceTime(180),
        tap(() => this.loading.set(true)),
        switchMap(([query]) => this.api.listJobs(query)),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (page) => {
          this.jobs.set(page.items);
          this.total.set(page.total);
          this.loading.set(false);
          const selected = untracked(this.selectedId);
          if (!selected || !page.items.some((j) => j.id === selected)) {
            this.selectedId.set(window.innerWidth > 1100 ? (page.items[0]?.id ?? null) : null);
          }
        },
        error: () => this.loading.set(false),
      });

    // Keep header numbers current when the list changes because of an action here.
    effect(() => {
      this.jobs();
      untracked(() => this.tracker.refreshStats());
    });
  }

  protected loadMore(): void {
    this.loadingMore.set(true);
    this.api.listJobs({ ...this.query(), offset: this.jobs().length }).subscribe((page) => {
      this.jobs.update((list) => [...list, ...page.items]);
      this.total.set(page.total);
      this.loadingMore.set(false);
    });
  }

  protected clearFilters(): void {
    this.search.set('');
    this.view.set('all');
    this.remote.set('');
    this.minScore.set(0);
    this.source.set('');
  }

  protected onChanged(updated: JobSummary): void {
    const view = this.view();
    const stillVisible =
      (view === 'hidden' ? updated.status === 'hidden' : updated.status !== 'hidden') &&
      (view !== 'new' || updated.status === 'new') &&
      (view !== 'saved' || updated.status === 'saved') &&
      (view !== 'starred' || updated.starred);

    if (stillVisible) {
      this.jobs.update((list) => list.map((j) => (j.id === updated.id ? { ...j, ...updated, snippet: j.snippet } : j)));
    } else {
      const list = this.jobs();
      const index = list.findIndex((j) => j.id === updated.id);
      const next = list[index + 1] ?? list[index - 1] ?? null;
      this.jobs.set(list.filter((j) => j.id !== updated.id));
      this.total.update((n) => n - 1);
      this.selectedId.set(next?.id ?? null);
    }
  }

  /** j/k to move, Escape to close. Ignored while typing in a field. */
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || event.metaKey || event.ctrlKey) return;
    const list = this.jobs();
    const index = list.findIndex((j) => j.id === this.selectedId());
    if (event.key === 'j' || event.key === 'ArrowDown') {
      const next = list[Math.min(list.length - 1, index + 1)];
      if (next) this.select(next.id, event);
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      const prev = list[Math.max(0, index - 1)];
      if (prev) this.select(prev.id, event);
    } else if (event.key === 'Escape') {
      this.selectedId.set(null);
    }
  }

  protected select(id: string, event?: Event): void {
    event?.preventDefault();
    this.selectedId.set(id);
    queueMicrotask(() => document.getElementById(`job-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
}
