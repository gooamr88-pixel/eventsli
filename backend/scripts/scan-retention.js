#!/usr/bin/env node
/**
 * The check-in log retention report, and — only when asked — the cleanup.
 *
 *   node scripts/scan-retention.js                 report, 90 days (DRY RUN)
 *   node scripts/scan-retention.js --days 120      report, 120 days
 *   node scripts/scan-retention.js --event <uuid>  report for one event
 *   node scripts/scan-retention.js --days 90 --execute --confirm-host <db host>
 *
 * A report changes nothing but a row in scan_retention_runs. Deleting needs
 * BOTH --execute and --confirm-host naming the database host in SUPABASE_URL,
 * so a command copied between environments cannot delete in the wrong one.
 * Run the report first, have it approved, then execute.
 */
require('dotenv').config();
const { policy, run, MIN_DAYS } = require('../services/scanRetention');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const days = arg('--days') !== undefined
    ? Number.parseInt(arg('--days'), 10)
    : policy().days;
  if (!Number.isFinite(days) || days < MIN_DAYS) {
    console.error(`--days must be a number of at least ${MIN_DAYS}.`);
    process.exit(2);
  }

  const host = (() => {
    try { return new URL(process.env.SUPABASE_URL).host; } catch { return null; }
  })();
  if (execute && (!host || arg('--confirm-host') !== host)) {
    console.error(`Refusing to delete: pass --confirm-host ${host || '<SUPABASE_URL host>'} to confirm the database.`);
    process.exit(2);
  }

  // --event <uuid>: one event only (a pilot before the first full run).
  const one = arg('--event');
  const r = await run({ days, dryRun: !execute, eventIds: one ? [one] : null });
  console.log(`${execute ? 'DELETED' : 'DRY RUN'} — database ${host}, events ended more than ${days} days ago`);
  console.log(`  events with a check-in log due: ${r.events}`);
  console.log(`  kept, held:                     ${r.held.length}`);
  for (const h of r.held) console.log(`    ${h.eventId} (ended ${h.endedAt}): ${h.because}`);
  console.log(`  scan rows ${execute ? 'deleted' : 'that would be deleted'}: ${execute ? r.deleted : r.eligible}`);
  console.log(`  conflict rows kept (unresolved): ${r.conflictsKept}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
