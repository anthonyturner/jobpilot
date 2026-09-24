import {
  ApplicantSchema,
  AutomationSchema,
  DEFAULT_AUTOMATION,
  EMPTY_APPLICANT,
  type Applicant,
  type Automation,
} from '../domain/applicant.js';
import { ResumeSchema, type Resume } from '../domain/resume.js';
import type { SettingsRepository } from '../persistence/settings-repository.js';

/** Typed access to the phase-2 settings: applicant facts, automation policy and the base resume. */
export class ApplicantStore {
  constructor(private readonly settings: SettingsRepository) {}

  getApplicant(): Applicant {
    return this.settings.get('applicant', ApplicantSchema, EMPTY_APPLICANT);
  }

  saveApplicant(applicant: Applicant): Applicant {
    const valid = ApplicantSchema.parse(applicant);
    this.settings.set('applicant', valid);
    return valid;
  }

  getAutomation(): Automation {
    return this.settings.get('automation', AutomationSchema, DEFAULT_AUTOMATION);
  }

  saveAutomation(automation: Automation): Automation {
    const valid = AutomationSchema.parse(automation);
    this.settings.set('automation', valid);
    return valid;
  }

  getResume(): Resume | null {
    return this.settings.get('resume', ResumeSchema.nullable(), null);
  }

  saveResume(resume: Resume): Resume {
    const valid = ResumeSchema.parse(resume);
    this.settings.set('resume', valid);
    return valid;
  }
}
