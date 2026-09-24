import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Resume } from '../../domain/resume.js';
import { resolveClaudeExecutable } from '../../integrations/claude-cli.js';
import type { SettingsRepository } from '../../persistence/settings-repository.js';
import type { ApplicantStore } from '../applicant-store.js';
import { suggestFromResume, type ProfileSuggestions } from './suggest.js';

const SetupStateSchema = z.object({ completedAt: z.string().nullable() });
type SetupState = z.infer<typeof SetupStateSchema>;

export interface SetupStatus {
  complete: boolean;
  hasResume: boolean;
  resumeName: string | null;
  claudeAvailable: boolean;
  chromeAvailable: boolean;
}

/**
 * First-run state. Until setup is complete the app shows the setup wizard and
 * refuses to sweep, so no job board is ever queried with placeholder details.
 */
export class SetupService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly store: ApplicantStore,
    private readonly env: { claudeBin: string; chromePath: string | null },
  ) {}

  isComplete(): boolean {
    return this.state().completedAt !== null;
  }

  status(): SetupStatus {
    const resume = this.store.getResume();
    return {
      complete: this.isComplete(),
      hasResume: !!resume,
      resumeName: resume?.name ?? null,
      claudeAvailable: this.claudeAvailable(),
      chromeAvailable: !!this.env.chromePath,
    };
  }

  suggestions(): ProfileSuggestions | null {
    const resume: Resume | null = this.store.getResume();
    return resume ? suggestFromResume(resume) : null;
  }

  complete(): SetupStatus {
    this.settings.set('setup', { completedAt: new Date().toISOString() } satisfies SetupState);
    return this.status();
  }

  /** Installs that predate the wizard (they already have jobs or a resume) count as set up. */
  adoptExistingInstall(hasData: boolean): void {
    if (!this.isComplete() && hasData) this.complete();
  }

  private state(): SetupState {
    return this.settings.get('setup', SetupStateSchema, { completedAt: null });
  }

  private claudeAvailable(): boolean {
    try {
      const resolved = resolveClaudeExecutable(this.env.claudeBin);
      if (path.isAbsolute(resolved)) return fs.existsSync(resolved);
      // On macOS/Linux the bare command name is returned; look it up on PATH.
      return (process.env.PATH ?? '').split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, resolved)));
    } catch {
      return false;
    }
  }
}
