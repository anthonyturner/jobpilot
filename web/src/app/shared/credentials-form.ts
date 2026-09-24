import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import type { CredentialName, CredentialStatus } from '../core/models';
import { Icon } from './icon';

/**
 * API keys and integration switches. Secrets are write-only: the server says
 * whether each is set but never sends the value back, so this form only ever
 * holds what the user is typing right now.
 */
@Component({
  selector: 'app-credentials-form',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loaded()) {
      <div class="keys">
        @for (c of keys(); track c.name) {
          <div class="key">
            <div class="key-head">
              <span class="label">{{ c.label }}</span>
              @if (c.set) {
                <span class="chip good"><app-icon name="check" [size]="11" /> {{ c.origin === 'env' ? 'Set in .env' : 'Saved' }}</span>
              }
              @if (c.helpUrl) {
                <a class="help" [href]="c.helpUrl" target="_blank" rel="noopener noreferrer">Get a key <app-icon name="external" [size]="11" /></a>
              }
            </div>
            @if (c.origin === 'env') {
              <p class="hint">Managed in your .env file.</p>
            } @else {
              <div class="key-row">
                <input class="input" [type]="c.secret ? 'password' : 'text'" autocomplete="off" spellcheck="false"
                       [placeholder]="c.set ? (c.secret ? '•••••••• (saved; type to replace)' : (c.value ?? '')) : 'Not set'"
                       [ngModel]="drafts()[c.name] ?? ''" (ngModelChange)="setDraft(c.name, $event)" maxlength="200" [attr.aria-label]="c.label" />
                @if (c.set) {
                  <button class="btn ghost sm danger" type="button" (click)="setDraft(c.name, null)" [attr.aria-label]="'Remove ' + c.label">Remove</button>
                }
              </div>
            }
          </div>
        }
      </div>

      @if (indeed(); as flag) {
        <label class="toggle" [class.disabled]="flag.origin === 'env'">
          <button type="button" class="switch" [class.on]="indeedOn()" (click)="toggleIndeed()" [disabled]="flag.origin === 'env'" aria-label="Search Indeed through Claude Code"></button>
          <span>
            <b>Search Indeed through Claude Code on every sweep</b><br />
            <span class="muted">
              Needs Claude Code installed and signed in, with the Indeed connector enabled on claude.ai. Uses about $0.07 of Claude usage per search.
              @if (claudeAvailable() === false) { <b class="warn-text">Claude Code was not found on this computer.</b> }
            </span>
          </span>
        </label>
      }

      @if (showSave()) {
        <div class="actions">
          @if (error()) { <span class="err"><app-icon name="alert" [size]="13" /> {{ error() }}</span> }
          @if (saved()) { <span class="ok"><app-icon name="check" [size]="13" /> Saved</span> }
          <button class="btn primary sm" type="button" (click)="save()" [disabled]="!dirty() || saving()">{{ saving() ? 'Saving…' : 'Save keys' }}</button>
        </div>
      }
    } @else {
      <div class="skeleton" style="height: 160px"></div>
    }
  `,
  styles: `
    .keys { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .key-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; .label { margin: 0; } }
    .help { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 600; color: var(--accent-2); text-decoration: none; }
    .key-row { display: flex; gap: 6px; }
    .hint { margin: 0; font-size: 12px; color: var(--muted); }
    .toggle { display: flex; gap: 12px; align-items: flex-start; margin-top: 18px; padding: 14px; border-radius: var(--radius); background: var(--surface-hover); border: 1px solid var(--border); font-size: 13px; cursor: pointer; .switch { margin-top: 2px; } &.disabled { opacity: .6; cursor: default; } }
    .warn-text { color: var(--warn); }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px; font-size: 12.5px; font-weight: 600; }
    .err { color: var(--bad); display: inline-flex; gap: 4px; align-items: center; }
    .ok { color: var(--good); display: inline-flex; gap: 4px; align-items: center; }
    @media (max-width: 800px) { .keys { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class CredentialsForm {
  private readonly api = inject(ApiService);

  /** The setup wizard saves on "Next" instead of showing its own button. */
  readonly showSave = input(true);
  readonly claudeAvailable = input<boolean | null>(null);
  readonly changed = output<CredentialStatus[]>();

  protected readonly status = signal<CredentialStatus[]>([]);
  protected readonly drafts = signal<Partial<Record<CredentialName, string | null>>>({});
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly keys = computed(() => this.status().filter((c) => c.name !== 'INDEED_VIA_CLAUDE'));
  protected readonly indeed = computed(() => this.status().find((c) => c.name === 'INDEED_VIA_CLAUDE') ?? null);
  protected readonly indeedOn = computed(() => {
    const draft = this.drafts().INDEED_VIA_CLAUDE;
    return draft !== undefined ? draft === 'true' : this.indeed()?.value === 'true';
  });
  readonly dirty = computed(() => Object.keys(this.drafts()).length > 0);

  constructor() {
    this.api.credentials().subscribe((s) => {
      this.status.set(s);
      this.loaded.set(true);
    });
  }

  protected setDraft(name: CredentialName, value: string | null): void {
    this.saved.set(false);
    this.drafts.update((d) => {
      const next = { ...d };
      if (value === '') delete next[name];
      else next[name] = value;
      return next;
    });
  }

  protected toggleIndeed(): void {
    this.setDraft('INDEED_VIA_CLAUDE', this.indeedOn() ? 'false' : 'true');
  }

  /** Saves pending changes. Returns a promise so the wizard can wait for it. */
  save(): Promise<void> {
    if (!this.dirty()) return Promise.resolve();
    this.saving.set(true);
    this.error.set(null);
    return new Promise((resolve, reject) => {
      this.api.saveCredentials(this.drafts()).subscribe({
        next: (status) => {
          this.status.set(status);
          this.drafts.set({});
          this.saving.set(false);
          this.saved.set(true);
          this.changed.emit(status);
          resolve();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set((err.error as { error?: string })?.error ?? 'Could not save keys.');
          reject(err);
        },
      });
    });
  }
}
