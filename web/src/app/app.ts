import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './core/api.service';
import { timeAgo, timeUntil } from './core/format';
import type { Schedule } from './core/models';
import { RunTracker } from './core/run-tracker.service';
import { ThemeService } from './core/theme.service';
import { Icon, type IconName } from './shared/icon';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  badge?: () => number | null;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly tracker = inject(RunTracker);
  protected readonly theme = inject(ThemeService);
  private readonly api = inject(ApiService);

  private readonly schedules = signal<Schedule[]>([]);
  private readonly now = signal(Date.now());

  protected readonly nav: NavItem[] = [
    { path: '/jobs', label: 'Matches', icon: 'sparkles', badge: () => this.tracker.stats()?.active ?? null },
    {
      path: '/pipeline',
      label: 'Pipeline',
      icon: 'kanban',
      badge: () => {
        const s = this.tracker.stats()?.byStatus;
        return s ? (s.saved ?? 0) + (s.applying ?? 0) + (s.applied ?? 0) + (s.interviewing ?? 0) + (s.offer ?? 0) : null;
      },
    },
    { path: '/applications', label: 'Applications', icon: 'send' },
    { path: '/runs', label: 'Sweeps', icon: 'activity' },
    { path: '/settings', label: 'Settings', icon: 'sliders' },
  ];

  protected readonly nextSweep = computed(() => {
    this.now();
    const next = this.schedules()
      .map((s) => s.nextRunAt)
      .filter((d): d is string => !!d)
      .sort()[0];
    return next ? timeUntil(next) : null;
  });

  protected readonly lastSweep = computed(() => {
    this.now();
    const run = this.tracker.stats()?.lastRun;
    return run ? timeAgo(run.finishedAt ?? run.startedAt) : null;
  });

  constructor() {
    const clock = setInterval(() => this.now.set(Date.now()), 30_000);
    // Load the schedule countdown, and refresh it after each sweep finishes.
    effect(() => {
      this.tracker.revision();
      this.api.schedules().subscribe((s) => this.schedules.set(s.schedules));
    });
    addEventListener('beforeunload', () => clearInterval(clock));
  }
}
