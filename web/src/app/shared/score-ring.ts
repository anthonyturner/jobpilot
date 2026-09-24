import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SCORE_COLORS, scoreTone } from '../core/format';

let nextId = 0;

@Component({
  selector: 'app-score-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 100 100" role="img" [attr.aria-label]="score() + '% match'">
      <defs>
        <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" [attr.stop-color]="color()" />
          <stop offset="1" [attr.stop-color]="color()" stop-opacity="0.55" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="42" class="track" />
      <circle cx="50" cy="50" r="42" class="value" [attr.stroke]="'url(#' + gradId + ')'"
              [attr.stroke-dasharray]="circumference" [attr.stroke-dashoffset]="offset()"
              [style.filter]="'drop-shadow(0 0 6px ' + color() + '66)'" />
    </svg>
    <div class="label">
      <span class="num" [style.font-size.px]="size() * 0.3">{{ score() }}</span>
      @if (showCaption()) {
        <span class="cap">match</span>
      }
    </div>
  `,
  styles: `
    :host { position: relative; display: inline-grid; place-items: center; flex-shrink: 0; }
    svg { transform: rotate(-90deg); display: block; }
    .track { fill: none; stroke: var(--border); stroke-width: 9; }
    .value { fill: none; stroke-width: 9; stroke-linecap: round; transition: stroke-dashoffset 0.9s var(--ease); }
    .label { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1; }
    .num { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; }
    .cap { margin-top: 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  `,
})
export class ScoreRing {
  readonly score = input.required<number>();
  readonly size = input(52);
  readonly showCaption = input(false);

  protected readonly gradId = `ring-${nextId++}`;
  protected readonly circumference = 2 * Math.PI * 42;
  protected readonly color = computed(() => SCORE_COLORS[scoreTone(this.score())]);
  protected readonly offset = computed(() => this.circumference * (1 - Math.max(0, Math.min(100, this.score())) / 100));
}
