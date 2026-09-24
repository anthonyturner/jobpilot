import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import type { ApplicationService } from '../services/apply/application-service.js';
import { CREDENTIALS, type CredentialStore } from '../services/credential-store.js';
import type { SetupService } from '../services/setup/setup-service.js';
import { parseOrThrow } from './validation.js';

const DOCX_TYPES = ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const CredentialsBody = z.object({
  values: z.partialRecord(
    z.enum(CREDENTIALS.map((c) => c.name) as [(typeof CREDENTIALS)[number]['name'], ...Array<(typeof CREDENTIALS)[number]['name']>]),
    z.string().max(200).nullable(),
  ),
});
const UploadQuery = z.object({ name: z.string().max(200).default('resume.docx') });

export function registerSetupRoutes(
  app: FastifyInstance,
  deps: { setup: SetupService; credentials: CredentialStore; applications: ApplicationService },
): void {
  const { setup, credentials, applications } = deps;

  // Raw .docx bodies for resume upload. Size-capped; the parser validates the zip itself.
  app.addContentTypeParser(DOCX_TYPES, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));

  app.get('/api/setup', async () => setup.status());
  app.get('/api/setup/suggestions', async () => setup.suggestions());
  app.post('/api/setup/complete', async () => setup.complete());

  app.post('/api/resume/upload', async (req) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError(400, 'Send the .docx file as the request body');
    const { name } = parseOrThrow(UploadQuery, req.query);
    try {
      return applications.importResumeUpload(req.body, name);
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }
  });

  // Write-only secrets: the response says which keys are set, never their values.
  app.get('/api/credentials', async () => credentials.status());
  app.put('/api/credentials', async (req) => {
    const body = parseOrThrow(CredentialsBody, req.body);
    try {
      return credentials.update(body.values);
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }
  });
}
