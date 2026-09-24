/**
 * One-off sweep without the web server, e.g. from Windows Task Scheduler:
 *   npm run sync
 * Exits non-zero when every source failed, so schedulers can alert on it.
 */
import { loadConfig } from '../config/env.js';
import { compose } from '../composition.js';

const config = loadConfig();
const log = { info: console.log, warn: console.warn, error: console.error };
const { aggregation, db } = compose(config, log);

const record = await aggregation.startRun('manual').done;
for (const [source, stats] of Object.entries(record.sources)) {
  const detail = stats.skipped ?? stats.error ?? `${stats.inserted} new, ${stats.updated} updated, ${stats.discarded} discarded`;
  console.log(`${source.padEnd(12)} ${detail}`);
}
db.close();
process.exit(record.status === 'failed' ? 1 : 0);
