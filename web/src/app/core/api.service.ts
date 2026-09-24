import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  Applicant,
  CredentialName,
  CredentialStatus,
  ProfileSuggestions,
  SetupStatus,
  Application,
  Automation,
  JobDetail,
  JobPage,
  JobQuery,
  JobStatus,
  JobSummary,
  Profile,
  ResumeDoc,
  ResumeSelection,
  RunRecord,
  Schedule,
  ScheduleSettings,
  SourceId,
  SourceInfo,
  Stats,
} from './models';

/** Thin typed wrapper over the REST API. No state lives here. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  listJobs(query: JobQuery): Observable<JobPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<JobPage>('/api/jobs', { params });
  }

  getJob(id: string): Observable<JobDetail> {
    return this.http.get<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`);
  }

  updateJob(id: string, patch: { status?: JobStatus; starred?: boolean; notes?: string }): Observable<JobSummary> {
    return this.http.patch<JobSummary>(`/api/jobs/${encodeURIComponent(id)}`, patch);
  }

  stats(): Observable<Stats> {
    return this.http.get<Stats>('/api/stats');
  }

  runs(): Observable<RunRecord[]> {
    return this.http.get<RunRecord[]>('/api/runs');
  }

  run(id: number): Observable<RunRecord> {
    return this.http.get<RunRecord>(`/api/runs/${id}`);
  }

  startRun(sources?: SourceId[]): Observable<{ runId: number; alreadyRunning: boolean }> {
    return this.http.post<{ runId: number; alreadyRunning: boolean }>('/api/runs', sources ? { sources } : {});
  }

  profile(): Observable<Profile> {
    return this.http.get<Profile>('/api/profile');
  }

  saveProfile(profile: Profile): Observable<Profile> {
    return this.http.put<Profile>('/api/profile', profile);
  }

  schedules(): Observable<ScheduleSettings> {
    return this.http.get<ScheduleSettings>('/api/schedules');
  }

  saveSchedules(schedules: Schedule[]): Observable<ScheduleSettings> {
    const body = schedules.map(({ id, label, cron, enabled }) => ({ id, label, cron, enabled }));
    return this.http.put<ScheduleSettings>('/api/schedules', body);
  }

  sources(): Observable<SourceInfo[]> {
    return this.http.get<SourceInfo[]>('/api/sources');
  }

  // ---- Phase 2 ----
  resume(): Observable<{ resume: ResumeDoc | null; defaultPath: string }> {
    return this.http.get<{ resume: ResumeDoc | null; defaultPath: string }>('/api/resume');
  }

  importResume(path: string): Observable<ResumeDoc> {
    return this.http.post<ResumeDoc>('/api/resume/import', { path });
  }

  applicant(): Observable<Applicant> {
    return this.http.get<Applicant>('/api/applicant');
  }

  saveApplicant(applicant: Applicant): Observable<Applicant> {
    return this.http.put<Applicant>('/api/applicant', applicant);
  }

  automation(): Observable<Automation> {
    return this.http.get<Automation>('/api/automation');
  }

  saveAutomation(automation: Automation): Observable<Automation> {
    return this.http.put<Automation>('/api/automation', automation);
  }

  applications(): Observable<Application[]> {
    return this.http.get<Application[]>('/api/applications');
  }

  application(id: string): Observable<Application> {
    return this.http.get<Application>(`/api/applications/${encodeURIComponent(id)}`);
  }

  startApplication(jobId: string): Observable<Application> {
    return this.http.post<Application>(`/api/jobs/${encodeURIComponent(jobId)}/application`, {});
  }

  editPacket(id: string, edit: Partial<ResumeSelection> & { coverLetter?: string[] }): Observable<Application> {
    return this.http.patch<Application>(`/api/applications/${encodeURIComponent(id)}/packet`, edit);
  }

  applicationAction(id: string, action: 'regenerate' | 'approve' | 'preview' | 'open' | 'mark-submitted' | 'cancel', body: object = {}): Observable<Application> {
    return this.http.post<Application>(`/api/applications/${encodeURIComponent(id)}/${action}`, body);
  }

  submitApplication(id: string, confirmCompany: string): Observable<Application> {
    return this.http.post<Application>(`/api/applications/${encodeURIComponent(id)}/submit`, { confirmCompany });
  }

  saveAnswers(id: string, answers: Record<string, string>, saveToBank: boolean): Observable<Application> {
    return this.http.put<Application>(`/api/applications/${encodeURIComponent(id)}/answers`, { answers, saveToBank });
  }

  fileUrl(id: string, name: string): string {
    return `/api/applications/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`;
  }

  // ---- Setup and credentials ----
  setupStatus(): Observable<SetupStatus> {
    return this.http.get<SetupStatus>('/api/setup');
  }

  suggestions(): Observable<ProfileSuggestions | null> {
    return this.http.get<ProfileSuggestions | null>('/api/setup/suggestions');
  }

  completeSetup(): Observable<SetupStatus> {
    return this.http.post<SetupStatus>('/api/setup/complete', {});
  }

  /** Sends the .docx as the raw request body; the server size-limits and validates it. */
  uploadResume(file: File): Observable<ResumeDoc> {
    return this.http.post<ResumeDoc>(`/api/resume/upload?name=${encodeURIComponent(file.name)}`, file, {
      headers: { 'content-type': 'application/octet-stream' },
    });
  }

  credentials(): Observable<CredentialStatus[]> {
    return this.http.get<CredentialStatus[]>('/api/credentials');
  }

  saveCredentials(values: Partial<Record<CredentialName, string | null>>): Observable<CredentialStatus[]> {
    return this.http.put<CredentialStatus[]>('/api/credentials', { values });
  }
}
