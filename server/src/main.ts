import { loadConfig } from './config/env.js';
import { compose } from './composition.js';
import { buildApp } from './http/app.js';
import { resolveIngestToken } from './http/security.js';
import { SchedulerService } from './services/scheduler-service.js';

const config = loadConfig();
const consoleLog = {
  info: (m: string) => console.log(`[jobpilot] ${m}`),
  warn: (m: string) => console.warn(`[jobpilot] ${m}`),
  error: (m: string) => console.error(`[jobpilot] ${m}`),
};

const services = compose(config, consoleLog);
const scheduler = new SchedulerService(config.TIMEZONE, (schedule) => {
  consoleLog.info(`Schedule "${schedule.label}" fired`);
  services.aggregation.startRun('schedule');
});
scheduler.apply(services.profiles.getSchedules());

const app = await buildApp(
  {
    port: config.PORT,
    ingestToken: resolveIngestToken(config.DATA_DIR, config.INGEST_TOKEN),
    logLevel: config.LOG_LEVEL,
    webDistDir: config.webDistDir,
    defaultResumePath: config.RESUME_PATH,
  },
  { ...services, scheduler },
);

const shutdown = async (signal: string) => {
  consoleLog.info(`${signal} received, shutting down`);
  scheduler.stopAll();
  await app.close();
  services.db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
consoleLog.info(`API ready at http://${config.HOST}:${config.PORT}`);
