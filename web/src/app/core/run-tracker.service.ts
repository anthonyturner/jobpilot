import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { RunRecord, Stats } from './models';

const POLL_MS = 1500;

/**
 * App-wide view of sweeps: current stats, the run in flight (polled until it ends),
 * and a revision counter pages watch to reload when new jobs land.
 */
@Injectable({ providedIn: 'root' })
export class RunTracker {
  private readonly api = inject(ApiService);
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly stats = signal<Stats | null>(null);
  readonly activeRun = signal<RunRecord | null>(null);
  readonly lastFinished = signal<RunRecord | null>(null);
  /** Bumps whenever stored jobs may have changed. */
  readonly revision = signal(0);
  readonly running = computed(() => this.activeRun() !== null);

  readonly progress = computed(() => {
    const run = this.activeRun();
    if (!run) return null;
    const entries = Object.values(run.sources);
    const attempted = entries.filter((s) => s && !s.skipped);
    const done = attempted.filter((s) => s && (s.durationMs > 0 || s.error)).length;
    const found = attempted.reduce((n, s) => n + (s?.inserted ?? 0), 0);
    return { done, total: attempted.length, found };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    this.refreshStats();
  }

  refreshStats(): void {
    this.api.stats().subscribe({
      next: (stats) => {
        this.stats.set(stats);
        if (stats.activeRunId && !this.activeRun()) this.watch(stats.activeRunId);
      },
      error: () => this.stats.set(null),
    });
  }

  start(): void {
    if (this.running()) return;
    this.api.startRun().subscribe(({ runId }) => this.watch(runId));
  }

  private watch(runId: number): void {
    this.stop();
    const tick = () =>
      this.api.run(runId).subscribe({
        next: (run) => {
          this.activeRun.set(run.status === 'running' ? run : null);
          if (run.status === 'running') {
            this.timer = setTimeout(tick, POLL_MS);
          } else {
            this.lastFinished.set(run);
            this.revision.update((n) => n + 1);
            this.refreshStats();
          }
        },
        error: () => this.activeRun.set(null),
      });
    tick();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
