import type { SourceId } from '../domain/job.js';
import type { JobSource } from './job-source.js';

export class SourceRegistry {
  private readonly byId = new Map<SourceId, JobSource>();

  constructor(sources: JobSource[]) {
    for (const source of sources) {
      if (this.byId.has(source.descriptor.id)) throw new Error(`Duplicate source ${source.descriptor.id}`);
      this.byId.set(source.descriptor.id, source);
    }
  }

  all(): JobSource[] {
    return [...this.byId.values()];
  }

  get(id: SourceId): JobSource | undefined {
    return this.byId.get(id);
  }

  /** Every host any source may contact; the HTTP client allowlist is built from this. */
  allowedHosts(): string[] {
    return this.all().flatMap((s) => s.hosts);
  }
}
