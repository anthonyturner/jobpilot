/**
 * One unattended pass without the web server, e.g. from Windows Task Scheduler:
 *   npm run auto-prepare
 * Sweeps, then tailors a resume and cover letter for the best new matches and
 * leaves them in `review`. Nothing is approved, filled or submitted.
 * Exits non-zero when the sweep failed, preparation could not start (setup or
 * resume missing), or every tailoring attempt failed, so schedulers can alert on it.
 */
import { loadConfig } from '../config/env.js';
import { compose } from '../composition.js';

/** A sweep marked running for longer than this is a leftover from a crash, not a live one. */
const LIVE_SWEEP_MS = 60 * 60_000;

const config = loadConfig();
const log = { info: console.log, warn: console.warn, error: console.error };
const { aggregation, autoPrepare, runs, db } = compose(config, log, { recoverInterruptedRuns: false });

let failed = false;
try {
  const live = runs.runningSince(new Date(Date.now() - LIVE_SWEEP_MS).toISOString());
  if (live) {
    // Two processes storing the same listings at once can collide on the unique dedupe key.
    console.log(`Sweep #${live.id} is already running in another process; preparing from the jobs already stored.`);
  } else {
    const record = await aggregation.startRun('unattended').done;
    for (const [source, stats] of Object.entries(record.sources)) {
      const detail = stats.skipped ?? stats.error ?? `${stats.inserted} new, ${stats.updated} updated, ${stats.discarded} discarded`;
      console.log(`${source.padEnd(12)} ${detail}`);
    }
    if (record.error) console.log(`Sweep: ${record.error}`);
    failed = record.status === 'failed';
  }

  const result = await autoPrepare.run();
  for (const item of result.prepared) console.log(`prepared    ${item.title} at ${item.company}`);
  for (const item of result.failed) console.log(`failed      ${item.title} at ${item.company}: ${item.error}`);
  for (const item of result.skipped) console.log(`skipped     ${item.title} at ${item.company}: ${item.reason}`);
  if (result.outcome === 'blocked' || (result.failed.length > 0 && result.prepared.length === 0)) failed = true;
} finally {
  db.close();
}
process.exit(failed ? 1 : 0);
