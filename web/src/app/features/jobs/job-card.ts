import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { REMOTE_LABELS, SOURCE_COLORS, SOURCE_LABELS, STATUS_META, formatSalary, timeAgo } from '../../core/format';
import type { JobSummary } from '../../core/models';
import { CompanyAvatar } from '../../shared/company-avatar';
import { Icon } from '../../shared/icon';
import { ScoreRing } from '../../shared/score-ring';

@Component({
  selector: 'app-job-card',
  imports: [CompanyAvatar, ScoreRing, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'option',
    tabindex: '0',
    '[class.selected]': 'selected()',
    '[class.is-new]': "job().status === 'new'",
    '[attr.aria-selected]': 'selected()',
    '(click)': 'pick.emit()',
    '(keydown.enter)': 'pick.emit()',
  },
  template: `
    <app-company-avatar [name]="job().company" [logo]="job().companyLogo" [size]="44" />
    <div class="body">
      <div class="top">
        <h3 class="title">{{ job().title }}</h3>
        @if (job().starred) {
          <app-icon class="star" name="star" [size]="14" [filled]="true" />
        }
      </div>
      <p class="company">
        {{ job().company }}
        <span class="dot">•</span>
        <span class="loc">{{ job().location }}</span>
      </p>
      <div class="meta">
        <span class="chip" [class.good]="job().remoteType === 'remote'" [class.info]="job().remoteType === 'hybrid'">
          <app-icon name="globe" [size]="11" /> {{ remote() }}
        </span>
        @if (salary(); as s) {
          <span class="chip"><app-icon name="dollar" [size]="11" /> {{ s }}</span>
        }
        <span class="chip ghost"><app-icon name="clock" [size]="11" /> {{ posted() }}</span>
        @if (job().status !== 'new') {
          <span class="chip {{ status().tone }}">{{ status().label }}</span>
        }
      </div>
      @if (skills().length) {
        <div class="skills">
          @for (skill of skills(); track skill) {
            <span class="skill">{{ skill }}</span>
          }
          @if (extraSkills() > 0) {
            <span class="skill more">+{{ extraSkills() }}</span>
          }
        </div>
      }
    </div>
    <div class="side">
      <app-score-ring [score]="job().score" [size]="50" />
      <div class="sources" [attr.aria-label]="'Found on ' + sourceNames()">
        @for (src of job().sources; track src.source) {
          <span class="src" [style.background]="colors[src.source]" [title]="labels[src.source]"></span>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 14px;
      padding: 16px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface);
      cursor: pointer;
      transition: transform 0.25s var(--ease), border-color 0.2s, box-shadow 0.25s, background 0.2s;
      outline: none;
    }
    :host(:hover) { transform: translateY(-2px); border-color: var(--border-strong); background: var(--surface-strong); }
    :host(:focus-visible) { box-shadow: 0 0 0 2px var(--accent); }
    :host(.selected) { border-color: transparent; box-shadow: var(--glow); background: var(--surface-strong); }
    :host(.is-new)::after {
      content: ''; position: absolute; top: 18px; left: -1px; width: 3px; height: 22px; border-radius: 0 3px 3px 0; background: var(--accent-grad);
    }
    .body { min-width: 0; }
    .top { display: flex; align-items: flex-start; gap: 6px; }
    .title { font: 600 15px/1.3 var(--font-display); letter-spacing: -0.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .star { color: var(--warn); margin-top: 2px; }
    .company { margin: 3px 0 10px; font-size: 13px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dot { margin: 0 5px; color: var(--muted); }
    .loc { color: var(--muted); }
    .meta { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip.ghost { background: transparent; }
    .skills { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
    .skill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; color: var(--text-2); background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent); }
    .skill.more { background: transparent; color: var(--muted); }
    .side { display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 8px; }
    .sources { display: flex; gap: 4px; }
    .src { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); }
    @media (max-width: 520px) { :host { grid-template-columns: minmax(0, 1fr) auto; } app-company-avatar { display: none; } }
  `,
})
export class JobCard {
  readonly job = input.required<JobSummary>();
  readonly selected = input(false);
  readonly pick = output<void>();

  protected readonly colors = SOURCE_COLORS;
  protected readonly labels = SOURCE_LABELS;
  protected readonly remote = computed(() => REMOTE_LABELS[this.job().remoteType]);
  protected readonly salary = computed(() => formatSalary(this.job()));
  protected readonly posted = computed(() => timeAgo(this.job().postedAt ?? this.job().firstSeenAt));
  protected readonly status = computed(() => STATUS_META[this.job().status]);
  protected readonly skills = computed(() => this.job().scoreBreakdown.skills?.matched.slice(0, 5) ?? []);
  protected readonly extraSkills = computed(() => (this.job().scoreBreakdown.skills?.matched.length ?? 0) - this.skills().length);
  protected readonly sourceNames = computed(() => this.job().sources.map((s) => SOURCE_LABELS[s.source]).join(', '));
}
