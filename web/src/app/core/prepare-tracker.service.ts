import type { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { AutoPrepareStatus } from './models';

/** Tailoring takes minutes per job, so a slower poll than RunTracker's loses nothing. */
const POLL_MS = 3000;

/**
 * "Prepare top matches": starts the server's run, polls it until it ends, and bumps
 * `revision` whenever drafts may have changed so the applications list can reload.
 */
@Injectable({ providedIn: 'root' })
export class PrepareTracker {
  private readonly api = inject(ApiService);
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Fingerprint of the last status seen; null until the first poll answers. */
  private seen: string | null = null;

  readonly status = signal<AutoPrepareStatus | null>(null);
  /** Only a run started or seen running in this session gets a summary, not one from hours ago. */
  readonly watching = signal(false);
  readonly error = signal<string | null>(null);
  private readonly starting = signal(false);
  readonly revision = signal(0);
  readonly running = computed(() => this.starting() || this.status()?.running === true);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    this.poll();
  }

  start(): void {
    if (this.running()) return;
    this.error.set(null);
    this.starting.set(true);
    this.api.startAutoPrepare().subscribe({
      next: () => {
        this.starting.set(false);
        this.watching.set(true);
        this.poll();
      },
      error: (err: HttpErrorResponse) => {
        this.starting.set(false);
        const body = err.error as { error?: string; issues?: Array<{ message: string }> } | null;
        this.error.set(body?.issues?.[0]?.message ?? body?.error ?? 'Could not start. Is the server running?');
      },
    });
  }

  dismiss(): void {
    this.error.set(null);
    if (!this.status()?.running) this.watching.set(false);
  }

  private poll(): void {
    this.stop();
    this.api.autoPrepareStatus().subscribe({
      next: (status) => {
        const result = status.result;
        const fingerprint = result ? `${status.startedAt}|${status.running}|${result.started.length}|${result.prepared.length}|${result.failed.length}` : '';
        if (this.seen !== null && fingerprint !== this.seen) this.revision.update((n) => n + 1);
        this.seen = fingerprint;
        this.status.set(status);
        if (status.running) {
          this.watching.set(true);
          this.timer = setTimeout(() => this.poll(), POLL_MS);
        }
      },
      error: () => this.status.update((s) => (s ? { ...s, running: false } : s)),
    });
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
