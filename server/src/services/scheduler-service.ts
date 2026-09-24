import cron, { type ScheduledTask } from 'node-cron';
import type { Schedule } from '../domain/profile.js';

export interface ScheduleState extends Schedule {
  nextRunAt: string | null;
}

/** Owns the cron timers. Re-applied whenever schedules are saved, so edits take effect without a restart. */
export class SchedulerService {
  private tasks = new Map<string, ScheduledTask>();

  constructor(
    readonly timezone: string,
    private readonly onTick: (schedule: Schedule) => void,
  ) {}

  apply(schedules: Schedule[]): void {
    this.stopAll();
    for (const schedule of schedules.filter((s) => s.enabled)) {
      const task = cron.schedule(schedule.cron, () => this.onTick(schedule), {
        timezone: this.timezone,
        name: `jobpilot-${schedule.id}`,
        noOverlap: true,
      });
      this.tasks.set(schedule.id, task);
    }
  }

  describe(schedules: Schedule[]): ScheduleState[] {
    return schedules.map((s) => {
      const next = this.tasks.get(s.id)?.getNextRun();
      return { ...s, nextRunAt: next ? next.toISOString() : null };
    });
  }

  stopAll(): void {
    for (const task of this.tasks.values()) void task.destroy();
    this.tasks.clear();
  }
}
