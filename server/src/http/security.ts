import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const DEV_UI_PORT = 4200;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CLIENT_HEADER = 'x-jobpilot-client';

/**
 * Local-app threat model: the API listens on loopback only, but any web page you
 * visit can still try to reach localhost. These hooks stop that:
 *  - Host must be localhost/127.0.0.1 on our port (blocks DNS-rebinding).
 *  - Origin, when present, must be this app (blocks cross-site requests).
 *  - Browser writes need a custom header, which forces a CORS preflight we never approve (blocks CSRF).
 *  - /api/ingest is for scripts and needs a bearer token instead.
 */
export function registerSecurity(app: FastifyInstance, opts: { port: number; ingestToken: string }): void {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const origins = new Set(
    [opts.port, DEV_UI_PORT].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]),
  );
  const expected = Buffer.from(opts.ingestToken, 'utf8');

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) {
      return reply.code(421).send({ error: 'Unrecognised host' });
    }
    const origin = req.headers.origin;
    if (origin && !origins.has(origin.toLowerCase())) {
      return reply.code(403).send({ error: 'Cross-origin requests are not allowed' });
    }
    if (!req.url.startsWith('/api/') || !MUTATING.has(req.method)) return;

    if (req.url.startsWith('/api/ingest')) {
      const header = String(req.headers.authorization ?? '');
      const presented = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '', 'utf8');
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
        return reply.code(401).send({ error: 'Missing or invalid ingest token' });
      }
      return;
    }
    if (req.headers[CLIENT_HEADER] !== 'web') {
      return reply.code(403).send({ error: `Writes require the ${CLIENT_HEADER} header` });
    }
  });
}

/**
 * The ingest token comes from INGEST_TOKEN, or is generated once and stored in
 * data/ingest-token (readable by your user account only on POSIX systems).
 */
export function resolveIngestToken(dataDir: string, fromEnv: string | undefined): string {
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, 'ingest-token');
  if (fs.existsSync(file)) {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}
