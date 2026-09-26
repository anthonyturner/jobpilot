import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { APPLICATION_META, APPLICATION_STEPS, timeAgo } from '../../core/format';
import type { Application, AutoPrepareResult } from '../../core/models';
import { PrepareTracker } from '../../core/prepare-tracker.service';
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
      <div class="head-actions">
        <a class="btn" routerLink="/jobs"><app-icon name="search" [size]="14" /> Pick a job to apply to</a>
        <button class="btn primary" type="button" (click)="tracker.start()" [disabled]="tracker.running()" aria-describedby="prepare-hint" [title]="hint">
          <app-icon [name]="tracker.running() ? 'refresh' : 'sparkles'" [size]="14" [class.spin]="tracker.running()" />
          {{ tracker.running() ? 'Preparing…' : 'Prepare top matches' }}
        </button>
        <span id="prepare-hint" class="sr-only">{{ hint }}</span>
      </div>
    </header>

    @if (tracker.error(); as error) {
      <div class="banner bad rise" role="alert">
        <app-icon name="alert" [size]="16" />
        <span class="banner-text">Could not prepare top matches: {{ error }}</span>
        <button class="btn ghost sm icon" type="button" aria-label="Dismiss" (click)="tracker.dismiss()"><app-icon name="x" [size]="14" /></button>
      </div>
    }

    @if (summary(); as s) {
      <section class="prep glass rise" aria-labelledby="prep-title">
        <div class="prep-head">
          <span class="prep-icon"><app-icon [name]="s.icon" [size]="16" [class.spin]="s.running" /></span>
          <div class="prep-text" role="status">
            <h2 id="prep-title">{{ s.title }}</h2>
            <p>{{ s.detail }}</p>
          </div>
          @if (!s.running) {
            <button class="btn ghost sm icon" type="button" aria-label="Dismiss summary" (click)="tracker.dismiss()"><app-icon name="x" [size]="14" /></button>
          }
        </div>
        @if (s.started.length) {
          <h3 class="prep-label">Started</h3>
          <ul class="prep-list">
            @for (item of s.started; track item.applicationId) {
              <li>
                <a [routerLink]="['/applications', item.applicationId]">{{ item.title }}</a>
                <span class="muted">at {{ item.company }}</span>
                <span class="chip {{ item.tone }}">{{ item.label }}</span>
                @if (item.error) {
                  <span class="prep-reason">{{ item.error }}</span>
                }
              </li>
            }
          </ul>
        }
        @if (s.skipped.length) {
          <details class="prep-skipped">
            <summary>Skipped {{ s.skipped.length }} {{ s.skipped.length === 1 ? 'match' : 'matches' }}</summary>
            <ul class="prep-list">
              @for (item of s.skipped; track item.jobId) {
                <li>
                  <a [routerLink]="['/jobs', item.jobId]">{{ item.title }}</a>
                  <span class="muted">at {{ item.company }}</span>
                  <span class="prep-reason">{{ item.reason }}</span>
                </li>
              }
            </ul>
          </details>
        }
      </section>
    }

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
            <p class="muted">Press <b>Prepare top matches</b>, or open a job on the Matches page and choose <b>Prepare application</b>. JobPilot drafts a tailored resume and cover letter for you to review.</p>
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
    .head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .banner { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 12px 10px 16px; border-radius: var(--radius); font-weight: 600; border: 1px solid; }
    .banner.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); background: color-mix(in srgb, var(--bad) 10%, transparent); }
    .banner-text { flex: 1; min-width: 0; }
    .prep { display: grid; gap: 10px; margin-bottom: 18px; padding: 16px 18px; border-radius: var(--radius); box-shadow: none; }
    .prep-head { display: flex; align-items: flex-start; gap: 12px; }
    .prep-icon { display: grid; place-items: center; flex-shrink: 0; width: 32px; height: 32px; border-radius: 10px; color: #fff; background: var(--accent-grad); }
    .prep-text { flex: 1; min-width: 0; h2 { font: 600 15px var(--font-display); } p { margin: 3px 0 0; font-size: 13px; color: var(--text-2); } }
    .prep-label { margin: 4px 0 0; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
    .prep-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
    .prep-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; }
    .prep-list a { color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
    .prep-reason { flex-basis: 100%; font-size: 12.5px; color: var(--muted); }
    .prep-skipped summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-2); }
    .prep-skipped[open] summary { margin-bottom: 8px; }
    .lanes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .lane { padding: 14px 16px; border-radius: var(--radius); box-shadow: none; }
    .lane.hot { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 8%, var(--surface)); }
    .lane-label { margin: 0; font-size: 12px; font-weight: 600; color: var(--muted); }
    .lane-count { margin: 4px 0 0; font: 700 26px/1 var(--font-display); }
    .list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
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
    @media (max-width: 520px) { .head-actions { width: 100%; } .head-actions > .btn { flex: 1 1 auto; } }
  `,
})
export class ApplicationsPage {
  private readonly api = inject(ApiService);
  protected readonly tracker = inject(PrepareTracker);
  protected readonly hint = 'Drafts a tailored resume and cover letter for your best new matches, up to your review limit in Settings. Nothing is approved or sent.';
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

  protected readonly summary = computed(() => {
    const status = this.tracker.status();
    if (!this.tracker.watching() || !status?.result) return null;
    return prepareSummary(status.running, status.result);
  });

  constructor() {
    toObservable(this.tracker.revision)
      .pipe(
        switchMap(() => this.api.applications()),
        takeUntilDestroyed(),
      )
      .subscribe((apps) => {
        this.apps.set(apps.filter((a) => a.status !== 'cancelled'));
        this.loading.set(false);
      });
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The "Prepare top matches" panel as ready-to-render text, so the template only reads properties. */
function prepareSummary(running: boolean, result: AutoPrepareResult) {
  const ready = new Set(result.prepared.map((p) => p.applicationId));
  const errors = new Map(result.failed.map((f) => [f.applicationId, f.error]));
  const started = result.started.map((item) => {
    const error = errors.get(item.applicationId) ?? null;
    const state = ready.has(item.applicationId)
      ? { label: 'Ready for review', tone: 'good' }
      : error !== null
        ? { label: 'Failed', tone: 'bad' }
        : { label: 'Tailoring…', tone: 'info' };
    return { ...item, ...state, error };
  });

  let title: string;
  let detail: string;
  if (running) {
    title = 'Preparing your top matches…';
    detail = 'Each draft takes a few minutes and appears in the list below when it is ready. Nothing is approved or sent.';
  } else if (result.outcome === 'finished') {
    title = result.prepared.length ? `${plural(result.prepared.length, 'draft')} ready for your review` : 'No new drafts this time';
    detail = result.failed.length
      ? `${plural(result.failed.length, 'draft')} failed to tailor. Open it to see why.`
      : result.started.length
        ? 'Review each one before anything is filled or sent.'
        : 'No new matches at or above your minimum score were left to prepare.';
  } else if (result.outcome === 'queue-full') {
    title = 'Your review queue is already full';
    detail = `${result.reason ?? ''} Review or cancel some drafts, or raise the limit in Settings.`.trim();
  } else {
    title = result.outcome === 'stopped' ? 'Preparation stopped' : 'Preparation could not start';
    detail = result.reason ?? '';
  }
  const icon = running ? 'refresh' : result.outcome === 'finished' ? 'check' : 'alert';
  return { running, icon, title, detail, started, skipped: result.skipped } as const;
}
