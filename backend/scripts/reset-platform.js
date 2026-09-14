/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A clean slate: delete every row of BUSINESS data, keep the schema and the
 * things that are configuration rather than history.
 *
 *   node scripts/reset-platform.js            # dry run — reports, changes nothing
 *   node scripts/reset-platform.js --commit   # actually does it
 *
 * WHY A DEDICATED SCRIPT AND NOT A HANDFUL OF DELETEs. Four tables reference
 * `events` with ON DELETE RESTRICT — orders, tickets, invoices, ledger_entries
 * — so a plain `DELETE FROM events` fails, and the order you delete children in
 * is not obvious from the schema. `TRUNCATE … CASCADE` inside one transaction
 * gets the order right by construction and is atomic: it either all goes or
 * none of it does.
 *
 * WHAT IS KEPT, and each is kept for a reason rather than by omission:
 *
 *   terms_versions      The published legal documents. Acceptance is recorded
 *                       against a VERSION ID (BRD §21), and `events` has a
 *                       CHECK that refuses to publish without one. Truncating
 *                       these would make the platform unable to publish
 *                       anything until they were re-seeded.
 *   platform_settings   Admin-set defaults — commission, fees, limits.
 *   schema_migrations   The migration ledger. Losing it makes the next
 *                       migration run think nothing has been applied.
 *   job_leases          Scheduler leases. Harmless either way; left alone
 *                       because it is machinery, not data.
 *
 * This is irreversible. There is no undo and no backup taken here — Supabase's
 * own point-in-time recovery is the safety net, and it is worth knowing whether
 * your plan has it BEFORE running this with --commit.
 * ═══════════════════════════════════════════════════════════════════════════ */
require('dotenv').config();
const { connect } = require('./db');

/**
 * Ordered for readability only — TRUNCATE … CASCADE resolves dependencies
 * itself. Listing them all explicitly rather than relying on CASCADE to reach
 * them means a table added later is NOT silently included: it shows up in the
 * dry run's "not listed" section and somebody has to decide about it.
 */
const WIPE = [
  // the door
  'scans', 'scan_devices', 'scanner_access',
  // tickets and money
  'tickets', 'order_items', 'orders', 'ledger_entries', 'invoices',
  'promo_redemptions', 'promo_codes',
  // holds
  'reservation_items', 'reservations',
  // the room
  'seats', 'tables', 'table_categories', 'ticket_tiers', 'venue_maps',
  // the events themselves
  'terms_acceptances', 'events',
  // people
  'organizers', 'sessions', 'password_resets', 'profiles',
  // logs
  'admin_audit', 'webhook_events',
];

const KEEP = ['terms_versions', 'platform_settings', 'schema_migrations', 'job_leases'];

(async () => {
  const commit = process.argv.includes('--commit');

  // `--commit` alone is one remembered flag from wiping production. Committing
  // also requires naming the project being wiped, so the command cannot be
  // pasted from shell history into a terminal whose .env points elsewhere.
  if (commit) {
    const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    const named = process.argv.find((a) => a.startsWith('--project='))?.slice('--project='.length);
    if (!ref || named !== ref) {
      console.error(`Refusing to commit: pass --project=${ref || '<project ref>'} to confirm which database is wiped.`);
      process.exit(1);
    }
  }

  const db = await connect({ quiet: false });

  const { rows: all } = await db.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`);
  const known = new Set([...WIPE, ...KEEP]);
  const unlisted = all.map((r) => r.table_name).filter((t) => !known.has(t));

  console.log(`\n${commit ? '── COMMITTING ──' : '── DRY RUN (nothing will change) ──'}\n`);

  let total = 0;
  console.log('to be emptied:');
  for (const t of WIPE) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${t}"`);
    total += rows[0].n;
    if (rows[0].n) console.log(`  ${String(rows[0].n).padStart(6)}  ${t}`);
  }
  console.log(`  ${String(total).padStart(6)}  TOTAL ROWS`);

  console.log('\nkept:');
  for (const t of KEEP) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${t}"`);
    console.log(`  ${String(rows[0].n).padStart(6)}  ${t}`);
  }

  if (unlisted.length) {
    console.log('\n⚠️  tables in this database that this script does not mention:');
    for (const t of unlisted) console.log(`      ${t}`);
    console.log('    Decide about each, then add it to WIPE or KEEP. Refusing to guess.');
    if (commit) { await db.end(); process.exit(1); }
  }

  if (!commit) {
    console.log('\nRun again with --commit to apply.');
    await db.end();
    return;
  }

  // One transaction. Either the platform is empty afterwards or it is exactly
  // as it was; there is no state in between worth being in.
  await db.query('BEGIN');
  try {
    await db.query(`TRUNCATE TABLE ${WIPE.map((t) => `"${t}"`).join(', ')} CASCADE`);
    await db.query('COMMIT');
    console.log(`\n✓ ${total} rows deleted across ${WIPE.length} tables.`);
  } catch (err) {
    await db.query('ROLLBACK');
    console.error(`\n✗ rolled back, nothing changed: ${err.message}`);
    await db.end();
    process.exit(1);
  }

  const { rows: after } = await db.query(`
    SELECT (SELECT count(*) FROM events) AS events,
           (SELECT count(*) FROM profiles) AS profiles,
           (SELECT count(*) FROM orders) AS orders,
           (SELECT count(*) FROM terms_versions) AS terms`);
  console.log(`  events ${after[0].events} · profiles ${after[0].profiles} `
    + `· orders ${after[0].orders} · terms kept ${after[0].terms}`);

  await db.end();
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
