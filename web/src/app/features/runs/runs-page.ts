import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SOURCE_COLORS, SOURCE_LABELS, formatDuration, timeAgo, timeUntil } from '../../core/format';
import type { RunRecord, ScheduleSettings, SourceId, SourceRunStats } from '../../core/models';
import { RunTracker } from '../../core/run-tracker.service';
import { Icon } from '../../shared/icon';

interface SourceRow {
  id: SourceId;
  stats: SourceRunStats;
}

@Component({
  selector: 'app-runs-page',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './runs-page.html',
  styleUrl: './runs-page.scss',
})
export class RunsPage {
  private readonly api = inject(ApiService);
  protected readonly tracker = inject(RunTracker);

  protected readonly runs = signal<RunRecord[]>([]);
  protected readonly schedule = signal<ScheduleSettings | null>(null);
  protected readonly expanded = signal<number | null>(null);
  protected readonly labels = SOURCE_LABELS;
  protected readonly colors = SOURCE_COLORS;

  protected readonly totals = computed(() => {
    const runs = this.runs().filter((r) => r.trigger !== 'ingest');
    const found = this.runs().reduce((n, r) => n + this.sum(r, 'inserted'), 0);
    const ok = runs.filter((r) => r.status === 'succeeded').length;
    return { runs: this.runs().length, found, successRate: runs.length ? Math.round((ok / runs.length) * 100) : null };
  });

  constructor() {
    effect(() => {
      this.tracker.revision();
      this.tracker.activeRun();
      this.load();
    });
    this.api.schedules().subscribe((s) => this.schedule.set(s));
  }

  protected rows(run: RunRecord): SourceRow[] {
    return (Object.entries(run.sources) as Array<[SourceId, SourceRunStats]>)
      .map(([id, stats]) => ({ id, stats }))
      .sort((a, b) => Number(!!a.stats.skipped) - Number(!!b.stats.skipped) || b.stats.inserted - a.stats.inserted);
  }

  protected sum(run: RunRecord, key: 'inserted' | 'fetched' | 'kept' | 'updated'): number {
    return Object.values(run.sources).reduce((n, s) => n + (s?.[key] ?? 0), 0);
  }

  protected failures(run: RunRecord): number {
    return Object.values(run.sources).filter((s) => s?.error).length;
  }

  protected duration(run: RunRecord): string {
    if (!run.finishedAt) return 'running';
    return formatDuration(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }

  protected until(iso: string | null | undefined): string {
    return timeUntil(iso);
  }

  protected ms(value: number): string {
    return formatDuration(value);
  }

  protected toggle(id: number): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  private load(): void {
    this.api.runs().subscribe((runs) => {
      this.runs.set(runs);
      if (this.expanded() === null && runs[0]) this.expanded.set(runs[0].id);
    });
  }
}
