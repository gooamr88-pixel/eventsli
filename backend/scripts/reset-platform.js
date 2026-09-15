/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A clean slate: delete every row of BUSINESS data, keep the schema and the
 * things that are configuration rather than history.
 *
 *   node scripts/reset-platform.js                          # dry run — reports, changes nothing
 *   node scripts/reset-platform.js --commit --project=<ref> # actually does it
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
 *                       CHECK that refuses to publish without one.
 *   platform_settings   Admin-set defaults — currencies, commission, fees.
 *   schema_migrations   The migration ledger.
 *   job_leases          Scheduler leases. Machinery, not data.
 *
 * CASCADE REACHES KEPT TABLES TOO. It follows foreign-key definitions, not
 * data: `platform_settings.updated_by` references `profiles`, so wiping people
 * emptied the settings — and with no currencies configured, no event can be
 * created anywhere. The script now reads the foreign keys, snapshots every kept
 * table CASCADE would reach, clears the columns that pointed at wiped rows,
 * restores them inside the same transaction, and refuses to COMMIT unless every
 * kept table has exactly the rows it started with (utils/resetPlan.js).
 *
 * This is irreversible. There is no undo and no backup taken here — Supabase's
 * own point-in-time recovery is the safety net, and it is worth knowing whether
 * your plan has it BEFORE running this with --commit.
 * ═══════════════════════════════════════════════════════════════════════════ */
require('dotenv').config();
const { connect } = require('./db');
const { planKeep } = require('../utils/resetPlan');

/**
 * Listed explicitly rather than relying on CASCADE to reach them, so a table
 * added later is NOT silently included: it shows up in the dry run's "not
 * listed" section and somebody has to decide about it.
 */
const WIPE = [
  // the door
  'scans', 'scan_devices', 'scanner_access', 'event_staff',
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
  'organizers', 'sessions', 'password_resets', 'email_verifications', 'profiles',
  // logs
  'admin_audit', 'webhook_events',
];

const KEEP = ['terms_versions', 'platform_settings', 'schema_migrations', 'job_leases'];

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function countRows(db, table) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${q(table)}`);
  return rows[0].n;
}

async function readForeignKeys(db) {
  const { rows } = await db.query(`
    SELECT cl.relname  AS "table",
           att.attname AS "column",
           att.attnotnull AS "notNull",
           rcl.relname AS "references"
      FROM pg_constraint c
      JOIN pg_class cl       ON cl.oid = c.conrelid
      JOIN pg_namespace n    ON n.oid = cl.relnamespace
      JOIN pg_class rcl      ON rcl.oid = c.confrelid
      CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum)
      JOIN pg_attribute att  ON att.attrelid = c.conrelid AND att.attnum = k.attnum
     WHERE c.contype = 'f' AND n.nspname = 'public'`);
  return rows;
}

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

  const plan = planKeep({ wipe: WIPE, keep: KEEP, foreignKeys: await readForeignKeys(db) });

  console.log(`\n${commit ? '── COMMITTING ──' : '── DRY RUN (nothing will change) ──'}\n`);

  let total = 0;
  console.log('to be emptied:');
  for (const t of WIPE) {
    // eslint-disable-next-line no-await-in-loop
    const n = await countRows(db, t);
    total += n;
    if (n) console.log(`  ${String(n).padStart(6)}  ${t}`);
  }
  console.log(`  ${String(total).padStart(6)}  TOTAL ROWS`);

  console.log('\nkept:');
  for (const t of KEEP) {
    // eslint-disable-next-line no-await-in-loop
    console.log(`  ${String(await countRows(db, t)).padStart(6)}  ${t}`);
  }

  if (plan.restoreOrder.length) {
    console.log('\nkept tables CASCADE would also empty — snapshotted and restored:');
    for (const p of plan.restoreOrder) {
      console.log(`      ${p.table}${p.nullColumns.length ? `  (cleared: ${p.nullColumns.join(', ')})` : ''}`);
    }
  }

  const refusals = [];
  if (unlisted.length) {
    console.log('\n⚠️  tables in this database that this script does not mention:');
    for (const t of unlisted) console.log(`      ${t}`);
    console.log('    Decide about each, then add it to WIPE or KEEP. Refusing to guess.');
    refusals.push('unlisted tables');
  }
  if (plan.blocked.length) {
    console.log('\n⚠️  kept rows that reference wiped rows through a NOT NULL column:');
    for (const b of plan.blocked) console.log(`      ${b}`);
    refusals.push('kept rows that cannot be preserved');
  }
  if (plan.unresolved.length) {
    console.log(`\n⚠️  kept tables with no safe restore order: ${plan.unresolved.join(', ')}`);
    refusals.push('an unresolvable restore order');
  }

  if (!commit) {
    console.log(refusals.length
      ? `\n--commit would refuse: ${refusals.join('; ')}.`
      : '\nRun again with --commit --project=<ref> to apply.');
    await db.end();
    return;
  }
  if (refusals.length) {
    console.error(`\nRefusing to commit: ${refusals.join('; ')}.`);
    await db.end();
    process.exit(1);
  }

  // One transaction. Either the platform is empty afterwards and every kept
  // table is exactly as it was, or nothing changed.
  await db.query('BEGIN');
  try {
    const keptBefore = {};
    for (const t of KEEP) {
      // eslint-disable-next-line no-await-in-loop
      keptBefore[t] = await countRows(db, t);
    }

    for (const p of plan.restoreOrder) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(`CREATE TEMP TABLE ${q(`_keep_${p.table}`)} ON COMMIT DROP AS SELECT * FROM ${q(p.table)}`);
      for (const column of p.nullColumns) {
        // eslint-disable-next-line no-await-in-loop
        await db.query(`UPDATE ${q(`_keep_${p.table}`)} SET ${q(column)} = NULL`);
      }
    }

    await db.query(`TRUNCATE TABLE ${WIPE.map(q).join(', ')} CASCADE`);

    for (const p of plan.restoreOrder) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(`INSERT INTO ${q(p.table)} SELECT * FROM ${q(`_keep_${p.table}`)}`);
    }

    for (const t of KEEP) {
      // eslint-disable-next-line no-await-in-loop
      const after = await countRows(db, t);
      if (after !== keptBefore[t]) {
        throw new Error(`${t} had ${keptBefore[t]} rows and would have ${after} — nothing was committed`);
      }
    }

    await db.query('COMMIT');
    console.log(`\n✓ ${total} rows deleted across ${WIPE.length} tables; every kept table is intact.`);
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
           (SELECT count(*) FROM terms_versions) AS terms,
           (SELECT count(*) FROM platform_settings) AS settings`);
  console.log(`  events ${after[0].events} · profiles ${after[0].profiles} `
    + `· orders ${after[0].orders} · terms kept ${after[0].terms} · settings kept ${after[0].settings}`);

  await db.end();
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
