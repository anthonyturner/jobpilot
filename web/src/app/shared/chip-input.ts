import { ChangeDetectionStrategy, Component, input, model, signal } from '@angular/core';
import { Icon } from './icon';

@Component({
  selector: 'app-chip-input',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="box" (click)="field.focus()">
      @for (value of values(); track value; let i = $index) {
        <span class="token">
          {{ value }}
          <button type="button" (click)="remove(i); $event.stopPropagation()" [attr.aria-label]="'Remove ' + value">
            <app-icon name="x" [size]="11" [stroke]="2.5" />
          </button>
        </span>
      }
      <input #field [placeholder]="values().length ? '' : placeholder()" [value]="draft()" (input)="draft.set(field.value)"
             (keydown)="onKey($event)" (blur)="commit()" [attr.maxlength]="maxLength()" [attr.aria-label]="placeholder()" />
    </div>
  `,
  styles: `
    .box { display: flex; flex-wrap: wrap; gap: 6px; min-height: 42px; padding: 6px 8px; border-radius: 11px; border: 1px solid var(--border); background: var(--surface-hover); cursor: text; transition: border-color .2s, box-shadow .2s; }
    .box:focus-within { border-color: rgba(139,92,246,.6); box-shadow: 0 0 0 4px rgba(139,92,246,.15); }
    .token { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 4px 0 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600; background: color-mix(in srgb, var(--accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 26%, transparent); }
    .token button { display: grid; place-items: center; width: 20px; height: 20px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
    .token button:hover { color: var(--text); background: var(--surface-hover); }
    input { flex: 1; min-width: 140px; border: 0; outline: 0; background: transparent; color: var(--text); font: 500 13px var(--font-sans); }
    input::placeholder { color: var(--muted); }
  `,
})
export class ChipInput {
  readonly values = model.required<string[]>();
  readonly placeholder = input('Type and press Enter');
  readonly maxLength = input(80);
  readonly max = input(50);
  protected readonly draft = signal('');

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Backspace' && !this.draft() && this.values().length) {
      this.remove(this.values().length - 1);
    }
  }

  protected commit(): void {
    const value = this.draft().trim();
    this.draft.set('');
    if (!value || this.values().length >= this.max()) return;
    if (this.values().some((v) => v.toLowerCase() === value.toLowerCase())) return;
    this.values.set([...this.values(), value]);
  }

  protected remove(index: number): void {
    this.values.set(this.values().filter((_, i) => i !== index));
  }
}
