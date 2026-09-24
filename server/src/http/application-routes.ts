import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApplicantSchema, AutomationSchema } from '../domain/applicant.js';
import type { ApplicantStore } from '../services/applicant-store.js';
import type { ApplicationService } from '../services/apply/application-service.js';
import { parseOrThrow } from './validation.js';

const IdParams = z.object({ id: z.uuid() });
const FileParams = z.object({ id: z.uuid(), name: z.string().regex(/^[A-Za-z0-9_.-]{1,160}$/) });

const PacketEditBody = z
  .object({
    summary: z.string().max(1200).optional(),
    skillOrder: z.array(z.string().max(80)).max(30).optional(),
    experience: z.array(z.object({ roleId: z.string().max(40), bulletIds: z.array(z.string().max(60)).max(20) })).max(30).optional(),
    projectIds: z.array(z.string().max(40)).max(20).optional(),
    coverLetter: z.array(z.string().max(2000)).min(1).max(6).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');

const AnswersBody = z.object({
  answers: z.record(z.string().max(300), z.string().max(2000)).refine((a) => Object.keys(a).length <= 50, 'Too many answers'),
  saveToBank: z.boolean().default(false),
});

const ApproveBody = z.object({ acknowledgeFlags: z.boolean().default(false) }).default({ acknowledgeFlags: false });
const SubmitBody = z.object({ confirmCompany: z.string().trim().min(1).max(120) });
const ImportBody = z.object({ path: z.string().trim().min(5).max(400) });

export function registerApplicationRoutes(app: FastifyInstance, deps: { service: ApplicationService; store: ApplicantStore; defaultResumePath: string }): void {
  const { service, store } = deps;

  // ---- Resume, applicant facts, automation policy -----------------------
  app.get('/api/resume', async () => ({ resume: store.getResume(), defaultPath: deps.defaultResumePath }));
  app.post('/api/resume/import', async (req) => service.importResume(parseOrThrow(ImportBody, req.body).path));

  app.get('/api/applicant', async () => store.getApplicant());
  app.put('/api/applicant', async (req) => service.saveApplicant(parseOrThrow(ApplicantSchema, req.body)));

  app.get('/api/automation', async () => store.getAutomation());
  app.put('/api/automation', async (req) => service.saveAutomation(parseOrThrow(AutomationSchema, req.body)));

  // ---- Applications ------------------------------------------------------
  app.get('/api/applications', async () => service.list());
  app.get('/api/applications/:id', async (req) => service.get(parseOrThrow(IdParams, req.params).id));

  app.post('/api/jobs/:id/application', async (req, reply) => {
    const created = service.create(parseOrThrow(IdParams, req.params).id);
    return reply.code(201).send(created);
  });

  app.patch('/api/applications/:id/packet', async (req) => service.editPacket(parseOrThrow(IdParams, req.params).id, parseOrThrow(PacketEditBody, req.body)));
  app.post('/api/applications/:id/regenerate', async (req) => service.regenerate(parseOrThrow(IdParams, req.params).id));
  app.post('/api/applications/:id/approve', async (req) => service.approve(parseOrThrow(IdParams, req.params).id, parseOrThrow(ApproveBody, req.body ?? {}).acknowledgeFlags));
  app.put('/api/applications/:id/answers', async (req) => {
    const body = parseOrThrow(AnswersBody, req.body);
    return service.setAnswers(parseOrThrow(IdParams, req.params).id, body.answers, body.saveToBank);
  });
  app.post('/api/applications/:id/preview', async (req) => service.preview(parseOrThrow(IdParams, req.params).id));
  app.post('/api/applications/:id/open', async (req) => service.openInBrowser(parseOrThrow(IdParams, req.params).id));
  app.post('/api/applications/:id/submit', async (req) => service.submit(parseOrThrow(IdParams, req.params).id, parseOrThrow(SubmitBody, req.body).confirmCompany));
  app.post('/api/applications/:id/mark-submitted', async (req) => service.markSubmitted(parseOrThrow(IdParams, req.params).id));
  app.post('/api/applications/:id/cancel', async (req) => service.cancel(parseOrThrow(IdParams, req.params).id));

  // Documents and screenshots: only names recorded on the application are served.
  app.get('/api/applications/:id/files/:name', async (req, reply) => {
    const { id, name } = parseOrThrow(FileParams, req.params);
    const full = service.filePath(id, name);
    const type = name.endsWith('.pdf') ? 'application/pdf' : 'image/png';
    reply.header('Content-Type', type).header('Content-Disposition', `inline; filename="${name}"`).header('Cache-Control', 'no-store');
    const { createReadStream } = await import('node:fs');
    return reply.send(createReadStream(full));
  });
}
