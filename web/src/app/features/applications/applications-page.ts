import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { APPLICATION_META, APPLICATION_STEPS, timeAgo } from '../../core/format';
import type { Application } from '../../core/models';
import { CompanyAvatar } from '../../shared/company-avatar';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-applications-page',
  imports: [RouterLink, CompanyAvatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head rise">
      <div>
        <p class="eyebrow"><app-icon name="send" [size]="13" /> Applications</p>
        <h1>Assisted applications</h1>
        <p class="sub">JobPilot tailors, you approve, JobPilot fills the form, and nothing is sent without your say-so.</p>
      </div>
      <a class="btn" routerLink="/jobs"><app-icon name="sparkles" [size]="14" /> Pick a job to apply to</a>
    </header>

    <section class="lanes rise" style="animation-delay: 60ms">
      @for (lane of lanes(); track lane.label) {
        <article class="lane glass" [class.hot]="lane.hot && lane.count > 0">
          <p class="lane-label">{{ lane.label }}</p>
          <p class="lane-count">{{ lane.count }}</p>
        </article>
      }
    </section>

    <section class="list">
      @for (app of apps(); track app.id; let i = $index) {
        <a class="row glass rise" [routerLink]="['/applications', app.id]" [style.animation-delay.ms]="80 + i * 30">
          <app-company-avatar [name]="app.job?.company ?? '?'" [logo]="app.job?.companyLogo ?? null" [size]="42" />
          <div class="row-text">
            <h3>{{ app.job?.title ?? 'Job removed' }}</h3>
            <p>{{ app.job?.company }} · updated {{ ago(app.updatedAt) }}</p>
          </div>
          <ol class="steps" aria-label="Progress">
            @for (step of steps; track step; let s = $index) {
              <li [class.done]="meta[app.status].step > s || app.status === 'submitted'" [class.current]="meta[app.status].step === s && app.status !== 'submitted'" [title]="step"></li>
            }
          </ol>
          <span class="chip {{ meta[app.status].tone }}">
            @if (app.status === 'preparing') { <app-icon name="refresh" [size]="11" class="spin" /> }
            {{ meta[app.status].label }}
          </span>
          <app-icon class="chev" name="chevronRight" [size]="16" />
        </a>
      } @empty {
        @if (!loading()) {
          <div class="empty glass">
            <div class="empty-art"><app-icon name="send" [size]="26" /></div>
            <h3>No applications yet</h3>
            <p class="muted">Open a job on the Matches page and choose <b>Prepare application</b>. JobPilot drafts a tailored resume and cover letter for you to review.</p>
            <a class="btn primary" routerLink="/jobs">Browse matches</a>
          </div>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .page-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding: 10px 4px 22px; h1 { font-size: clamp(26px, 3.2vw, 36px); line-height: 1.1; } }
    .eyebrow { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #a78bfa; }
    .sub { margin: 8px 0 0; color: var(--text-2); font-size: 15px; }
    .lanes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .lane { padding: 14px 16px; border-radius: var(--radius); box-shadow: none; }
    .lane.hot { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 8%, var(--surface)); }
    .lane-label { margin: 0; font-size: 12px; font-weight: 600; color: var(--muted); }
    .lane-count { margin: 4px 0 0; font: 700 26px/1 var(--font-display); }
    .list { display: grid; gap: 10px; }
    .row { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: var(--radius); text-decoration: none; box-shadow: none; transition: transform .2s var(--ease), border-color .2s; }
    .row:hover { transform: translateY(-1px); border-color: var(--border-strong); }
    .row-text { flex: 1; min-width: 0; h3 { font: 600 15px var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } p { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); } }
    .steps { display: flex; gap: 4px; list-style: none; margin: 0; padding: 0; }
    .steps li { width: 22px; height: 5px; border-radius: 3px; background: var(--border); }
    .steps li.done { background: var(--accent-grad); }
    .steps li.current { background: color-mix(in srgb, var(--accent) 55%, transparent); animation: pulse-bar 1.6s ease-in-out infinite; }
    @keyframes pulse-bar { 50% { opacity: .45; } }
    .chev { color: var(--muted); }
    .empty { display: grid; justify-items: center; gap: 8px; padding: 56px 24px; text-align: center; h3 { font-size: 19px; } p { max-width: 420px; margin: 0 0 12px; } }
    .empty-art { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; color: #fff; background: var(--accent-grad); box-shadow: 0 14px 40px -12px rgba(139,92,246,.8); }
    @media (max-width: 800px) { .lanes { grid-template-columns: repeat(2, 1fr); } .steps { display: none; } }
  `,
})
export class ApplicationsPage {
  private readonly api = inject(ApiService);
  protected readonly apps = signal<Application[]>([]);
  protected readonly loading = signal(true);
  protected readonly meta = APPLICATION_META;
  protected readonly steps = APPLICATION_STEPS;

  protected readonly lanes = computed(() => {
    const count = (...s: string[]) => this.apps().filter((a) => s.includes(a.status)).length;
    return [
      { label: 'Being tailored', count: count('preparing'), hot: false },
      { label: 'Waiting for your review', count: count('review'), hot: true },
      { label: 'Approved', count: count('approved', 'previewed'), hot: false },
      { label: 'Needs you', count: count('needs_attention', 'failed'), hot: true },
      { label: 'Submitted', count: count('submitted'), hot: false },
    ];
  });

  constructor() {
    this.api.applications().subscribe((apps) => {
      this.apps.set(apps.filter((a) => a.status !== 'cancelled'));
      this.loading.set(false);
    });
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }
}
