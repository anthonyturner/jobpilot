import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { companyGradient, initials } from '../core/format';

@Component({
  selector: 'app-company-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()', '[style.border-radius.px]': 'size() * 0.28' },
  template: `
    @if (logo() && !failed()) {
      <img [src]="logo()" [alt]="''" referrerpolicy="no-referrer" loading="lazy" (error)="failed.set(true)" />
    } @else {
      <span class="initials" [style.background]="gradient()" [style.font-size.px]="size() * 0.36">{{ letters() }}</span>
    }
  `,
  styles: `
    :host { display: inline-grid; flex-shrink: 0; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px var(--border), 0 6px 16px -8px rgba(0,0,0,.5); }
    img { width: 100%; height: 100%; object-fit: contain; padding: 12%; }
    .initials { display: grid; place-items: center; color: #fff; font-family: var(--font-display); font-weight: 700; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
  `,
})
export class CompanyAvatar {
  readonly name = input.required<string>();
  readonly logo = input<string | null>(null);
  readonly size = input(44);

  protected readonly failed = signal(false);
  protected readonly letters = computed(() => initials(this.name()));
  protected readonly gradient = computed(() => companyGradient(this.name()));
}
