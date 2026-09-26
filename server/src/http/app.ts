import fs from 'node:fs';
import path from 'node:path';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerApplicationRoutes } from './application-routes.js';
import { registerRoutes, type RouteDeps } from './routes.js';
import { registerSetupRoutes } from './setup-routes.js';
import type { CredentialStore } from '../services/credential-store.js';
import type { SetupService } from '../services/setup/setup-service.js';
import { registerSecurity } from './security.js';
import { ValidationError } from './validation.js';
import type { ApplicantStore } from '../services/applicant-store.js';
import type { ApplicationService } from '../services/apply/application-service.js';
import type { AutoPrepareService } from '../services/apply/auto-prepare-service.js';

export interface AppOptions {
  port: number;
  ingestToken: string;
  logLevel: string;
  webDistDir: string | null;
  defaultResumePath?: string;
}

export async function buildApp(
  options: AppOptions,
  deps: RouteDeps & {
    applications?: ApplicationService;
    applicantStore?: ApplicantStore;
    autoPrepare?: AutoPrepareService;
    setup?: SetupService;
    credentials?: CredentialStore;
  },
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.logLevel,
      // Never write credentials or tokens to logs.
      redact: ['req.headers.authorization', 'req.headers["x-rapidapi-key"]', 'req.headers["authorization-key"]'],
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // The app is served over plain http on loopback; upgrading would break it.
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  registerSecurity(app, { port: options.port, ingestToken: options.ingestToken });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ValidationError) {
      return reply.code(400).send({ error: 'Invalid request', issues: error.issues });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    // Internal details stay in the log; the client gets a generic message.
    return reply.code(status).send({ error: status >= 500 ? 'Internal error' : (error as Error).message });
  });

  registerRoutes(app, deps);
  if (deps.applications && deps.applicantStore) {
    registerApplicationRoutes(app, {
      service: deps.applications,
      store: deps.applicantStore,
      autoPrepare: deps.autoPrepare,
      defaultResumePath: options.defaultResumePath ?? '',
    });
  }
  if (deps.setup && deps.credentials && deps.applications) {
    registerSetupRoutes(app, { setup: deps.setup, credentials: deps.credentials, applications: deps.applications });
  }

  if (options.webDistDir && fs.existsSync(path.join(options.webDistDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: options.webDistDir, wildcard: false });
    // Client-side routes fall back to index.html; unknown API paths still 404 as JSON.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
