import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { APPLICATION_META, APPLICATION_STEPS, formatSalary, timeAgo } from '../../core/format';
import type { Application, Automation, ResumeDoc } from '../../core/models';
import { CompanyAvatar } from '../../shared/company-avatar';
import { Icon } from '../../shared/icon';

type Tab = 'resume' | 'letter' | 'form';

interface RoleView {
  id: string;
  title: string;
  company: string;
  dates: string;
  bullets: Array<{ id: string; text: string; included: boolean }>;
}

@Component({
  selector: 'app-application-detail',
  imports: [FormsModule, RouterLink, CompanyAvatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './application-detail.html',
  styleUrl: './application-detail.scss',
})
export class ApplicationDetail {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  /** Bound from the route (:id). */
  readonly id = input.required<string>();

  protected readonly app = signal<Application | null>(null);
  protected readonly resume = signal<ResumeDoc | null>(null);
  protected readonly automation = signal<Automation | null>(null);
  protected readonly tab = signal<Tab>('resume');
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  // Editable drafts
  protected readonly summary = signal('');
  protected readonly paragraphs = signal<string[]>([]);
  protected readonly roles = signal<RoleView[]>([]);
  protected readonly projects = signal<Array<{ id: string; name: string; included: boolean }>>([]);
  protected readonly dirty = signal(false);
  protected readonly flagsChecked = signal(false);
  protected readonly answers = signal<Record<string, string>>({});
  protected readonly saveToBank = signal(true);
  protected readonly confirmCompany = signal('');
  protected readonly showSubmit = signal(false);

  protected readonly meta = APPLICATION_META;
  protected readonly steps = APPLICATION_STEPS;

  protected readonly status = computed(() => this.app()?.status ?? 'preparing');
  protected readonly editable = computed(() => ['review', 'approved', 'previewed', 'needs_attention'].includes(this.status()));
  protected readonly salary = computed(() => (this.app()?.job ? formatSalary(this.app()!.job!) : null));
  protected readonly submitAllowed = computed(() => {
    const a = this.app();
    const auto = this.automation();
    return !!a?.ats && !!auto?.enabled && auto.modes[a.ats] === 'submit' && a.status === 'previewed';
  });
  /** False only once the settings have loaded with the kill switch engaged; the server enforces it either way. */
  protected readonly fillingOn = computed(() => this.automation()?.enabled !== false);
  protected readonly openQuestions = computed(() => this.app()?.report?.open ?? []);
  protected readonly answersComplete = computed(() =>
    this.openQuestions().filter((q) => q.required).every((q) => (this.answers()[q.label] ?? '').trim().length > 0),
  );

  private poll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.api.resume().subscribe((r) => this.resume.set(r.resume));
    this.api.automation().subscribe((a) => this.automation.set(a));
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
    inject(DestroyRef).onDestroy(() => this.poll && clearTimeout(this.poll));
  }

  // ---- Packet editing ----
  protected toggleBullet(roleId: string, bulletId: string): void {
    this.roles.update((roles) =>
      roles.map((r) => (r.id !== roleId ? r : { ...r, bullets: r.bullets.map((b) => (b.id === bulletId ? { ...b, included: !b.included } : b)) })),
    );
    this.dirty.set(true);
  }

  protected moveBullet(roleId: string, index: number, delta: -1 | 1): void {
    this.roles.update((roles) =>
      roles.map((r) => {
        if (r.id !== roleId) return r;
        const bullets = [...r.bullets];
        const target = index + delta;
        if (target < 0 || target >= bullets.length) return r;
        [bullets[index], bullets[target]] = [bullets[target]!, bullets[index]!];
        return { ...r, bullets };
      }),
    );
    this.dirty.set(true);
  }

  protected toggleProject(id: string): void {
    this.projects.update((ps) => ps.map((p) => (p.id === id ? { ...p, included: !p.included } : p)));
    this.dirty.set(true);
  }

  protected setParagraph(index: number, value: string): void {
    this.paragraphs.update((ps) => ps.map((p, i) => (i === index ? value : p)));
    this.dirty.set(true);
  }

  protected addParagraph(): void {
    this.paragraphs.update((ps) => [...ps, '']);
    this.dirty.set(true);
  }

  protected removeParagraph(index: number): void {
    this.paragraphs.update((ps) => ps.filter((_, i) => i !== index));
    this.dirty.set(true);
  }

  protected saveEdits(): void {
    this.run('save', this.api.editPacket(this.id(), {
      summary: this.summary(),
      coverLetter: this.paragraphs().filter((p) => p.trim()),
      experience: this.roles().map((r) => ({ roleId: r.id, bulletIds: r.bullets.filter((b) => b.included).map((b) => b.id) })),
      projectIds: this.projects().filter((p) => p.included).map((p) => p.id),
    }));
  }

  protected discardEdits(): void {
    const app = this.app();
    if (app) this.hydrate(app);
  }

  // ---- Lifecycle actions ----
  protected approve(): void {
    this.run('approve', this.api.applicationAction(this.id(), 'approve', { acknowledgeFlags: this.flagsChecked() }));
  }

  protected approveAndFill(): void {
    const id = this.id();
    // The approval can stand even when the fill after it fails, so reload to show the real state.
    this.run('approve-fill', this.api.applicationAction(id, 'approve-and-preview', { acknowledgeFlags: this.flagsChecked() }), () => this.tab.set('form'), () => this.load(id));
  }

  protected regenerate(): void {
    this.run('regenerate', this.api.applicationAction(this.id(), 'regenerate'));
  }

  protected preview(): void {
    this.run('preview', this.api.applicationAction(this.id(), 'preview'), () => this.tab.set('form'));
  }

  protected openInBrowser(): void {
    this.run('open', this.api.applicationAction(this.id(), 'open'), () => this.tab.set('form'));
  }

  protected markSubmitted(): void {
    this.run('mark', this.api.applicationAction(this.id(), 'mark-submitted'));
  }

  protected submit(): void {
    this.run('submit', this.api.submitApplication(this.id(), this.confirmCompany()), () => this.showSubmit.set(false));
  }

  protected cancel(): void {
    this.run('cancel', this.api.applicationAction(this.id(), 'cancel'), () => void this.router.navigate(['/applications']));
  }

  protected setAnswer(label: string, value: string): void {
    this.answers.update((a) => ({ ...a, [label]: value }));
  }

  protected saveAnswers(): void {
    this.run('answers', this.api.saveAnswers(this.id(), this.answers(), this.saveToBank()), () => this.preview());
  }

  protected fileUrl(name: string | null): string | null {
    return name ? this.api.fileUrl(this.id(), name) : null;
  }

  protected ago(iso: string | null): string {
    return timeAgo(iso);
  }

  private run(label: string, request: Observable<Application>, after?: () => void, afterError?: () => void): void {
    this.busy.set(label);
    this.error.set(null);
    request.subscribe({
      next: (app) => {
        this.busy.set(null);
        this.apply(app);
        after?.();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(null);
        const body = err.error as { error?: string; issues?: Array<{ message: string }> } | null;
        this.error.set(body?.issues?.[0]?.message ?? body?.error ?? 'Something went wrong. Is the server running?');
        afterError?.();
      },
    });
  }

  private load(id: string): void {
    this.api.application(id).subscribe({
      next: (app) => this.apply(app),
      error: () => this.error.set('Application not found.'),
    });
  }

  private apply(app: Application): void {
    const statusChanged = this.app()?.status !== app.status || this.app()?.updatedAt !== app.updatedAt;
    this.app.set(app);
    if (statusChanged && !this.dirty()) this.hydrate(app);
    if (this.poll) clearTimeout(this.poll);
    if (app.status === 'preparing') this.poll = setTimeout(() => this.load(app.id), 3000);
  }

  private hydrate(app: Application): void {
    const resume = this.resume();
    const packet = app.packet;
    this.dirty.set(false);
    this.flagsChecked.set(false);
    if (!packet) return;
    this.summary.set(packet.resume.summary);
    this.paragraphs.set([...packet.coverLetter.paragraphs]);
    this.answers.set(Object.fromEntries((app.report?.open ?? []).map((q) => [q.label, ''])));
    if (!resume) {
      // The resume loads in parallel; hydrate again once it arrives.
      this.api.resume().subscribe((r) => {
        this.resume.set(r.resume);
        if (r.resume) this.hydrate(app);
      });
      return;
    }
    this.roles.set(
      resume.experience.map((role) => {
        const chosen = packet.resume.experience.find((e) => e.roleId === role.id)?.bulletIds ?? [];
        const ordered = [
          ...chosen.map((id) => role.bullets.find((b) => b.id === id)).filter((b): b is { id: string; text: string } => !!b).map((b) => ({ ...b, included: true })),
          ...role.bullets.filter((b) => !chosen.includes(b.id)).map((b) => ({ ...b, included: false })),
        ];
        return { id: role.id, title: role.title, company: role.company, dates: role.dates, bullets: ordered };
      }),
    );
    this.projects.set([
      ...packet.resume.projectIds.map((id) => resume.projects.find((p) => p.id === id)).filter((p): p is ResumeDoc['projects'][number] => !!p).map((p) => ({ id: p.id, name: p.name, included: true })),
      ...resume.projects.filter((p) => !packet.resume.projectIds.includes(p.id)).map((p) => ({ id: p.id, name: p.name, included: false })),
    ]);
  }
}
