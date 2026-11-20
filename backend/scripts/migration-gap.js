/**
 * READ-ONLY: which recent migrations does this database actually have?
 *
 *   cd backend && node scripts/migration-gap.js
 *
 * Connects with the same settings as apply-migration.js (SUPABASE_URL +
 * SUPABASE_DB_PASSWORD in backend/.env) and changes NOTHING: every statement
 * is a SELECT inside a READ ONLY transaction that is rolled back.
 *
 * Two answers per migration, because they can disagree:
 *   recorded     its file name is in `schema_migrations` (what apply-migration.js wrote)
 *   present      an object only that migration creates exists (a column,
 *                table, constraint or a snippet of a function it redefined)
 *
 * "present but not recorded" usually means it was pasted into the SQL editor.
 * "recorded but not present" means something was undone by hand — investigate.
 * Anything NOT present is missing, and the code from commit 40a630b on needs it.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./db');

const col = (table, column) => ({
  label: `${table}.${column}`,
  sql: `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
});
const con = (name) => ({ label: `constraint ${name}`, sql: `SELECT 1 FROM pg_constraint WHERE conname = '${name}'` });
const tab = (name) => ({ label: `table ${name}`, sql: `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${name}'` });
const fn = (name) => ({ label: `function ${name}`, sql: `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${name}'` });
const body = (name, snippet) => ({
  label: `function ${name} (new version)`,
  sql: `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${name}' AND pg_get_functiondef(p.oid) LIKE '%${snippet.replace(/'/g, "''")}%'`,
});
const setting = (label, sql) => ({ label, sql });

// In apply order. Fingerprints checked against a database with each applied.
const MIGRATIONS = [
  ['20261108090000_checkin_v2.sql', col('tickets', 'qr_version')],
  ['20261108100000_checkin_app_api.sql', col('sessions', 'client')],
  ['20261109090000_door_list_search.sql', fn('door_fold')],
  ['20261110090000_offline_manifest.sql', fn('event_door_manifest')],
  ['20261111090000_venue_map_seat_integrity.sql', body('save_venue_map', 'of the tables in this save are not on this map')],
  ['20261112090000_seating_pricing_integrity.sql', col('tables', 'seat_price_cents')],
  ['20261113090000_ticket_type_details.sql', col('ticket_tiers', 'details')],
  ['20261114090000_invoice_delivery.sql', col('invoices', 'overdue_notified_at')],
  ['20261115090000_invoice_and_gate_control.sql', col('invoices', 'paid_cents')],
  ['20261116090000_sms_platform.sql', tab('sms_countries')],
  ['20261117090000_sms_consent_kinds_and_organizers.sql', con('sms_consent_kind')],
  ['20261118090000_scan_attribution_and_retention.sql', col('scans', 'uploaded_by_device_id')],
  ['20261119090000_vip_events.sql', col('events', 'vip_rank')],
  ['20261119100000_sponsor_logo_size.sql', col('sponsors', 'logo_size')],
  ['20261120090000_purchase_signatures.sql', tab('purchase_signatures')],
  ['20261121090000_global_markets.sql', tab('markets')],
  ['20261121100000_invoice_payment_idempotency.sql', col('invoice_payments', 'idempotency_key')],
  ['20261122090000_offline_checkout.sql', tab('offline_payments')],
  ['20261123090000_ticket_terms_v2.sql', setting('buyer terms version 2 is current', "SELECT 1 FROM terms_versions WHERE audience = 'buyer' AND version = 2 AND is_current")],
  ['20261123100000_invoice_document.sql', col('invoices', 'sales_count')],
  ['20261123110000_credit_notes_and_billing_details.sql', col('invoices', 'credited_cents')],
  ['20261124090000_coming_soon.sql', col('events', 'coming_soon')],
  // Without these two the price quote fails, so EVERY checkout fails, and so
  // do ticket pages and the door scan (2026-11-18 production 500s).
  ['20261125090000_ticket_addons.sql', tab('reservation_addons')],
  ['20261126090000_addon_images.sql', col('event_addons', 'image_path')],
  ['20261127090000_organizer_public_profile.sql', tab('organizer_messages')],
  // Sponsorships (2026-11-20): every Sponsors screen and the sponsor portal read these.
  ['20261202090000_sponsorships.sql', tab('sponsorship_deals')],
];

const EXTRA = [
  setting('currencies setting opens > 2 countries (global markets ran its UPDATE)',
    "SELECT 1 FROM platform_settings WHERE key = 'currencies' AND (SELECT count(*) FROM jsonb_object_keys(value -> 'by_country')) > 2"),
  setting('offline_checkout setting exists and is OFF',
    "SELECT 1 FROM platform_settings WHERE key = 'offline_checkout' AND COALESCE((value ->> 'enabled')::boolean, false) = false"),
];

(async () => {
  const onDisk = fs.readdirSync(path.join(__dirname, '..', '..', 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const client = await connect();
  try {
    await client.query('BEGIN READ ONLY');
    const recorded = new Set((await client.query('SELECT name FROM schema_migrations').catch(() => ({ rows: [] }))).rows.map((r) => r.name));
    const probe = async (sql) => (await client.query(sql)).rowCount > 0;

    console.log('migration'.padEnd(52), 'recorded  present   fingerprint');
    const missing = [];
    for (const [file, check] of MIGRATIONS) {
      const isRecorded = recorded.has(file);
      const isPresent = await probe(check.sql);
      if (!isPresent) missing.push(file);
      console.log(file.padEnd(52), String(isRecorded).padEnd(9), String(isPresent).padEnd(9), check.label);
    }
    console.log('\n── settings ──');
    for (const s of EXTRA) console.log(String(await probe(s.sql)).padEnd(6), s.label);

    const older = onDisk.filter((f) => f < MIGRATIONS[0][0] && !recorded.has(f));
    if (older.length) {
      console.log(`\n${older.length} older migration file(s) are not recorded (they may have been applied by hand; verify-schema.js checks their objects):`);
      for (const f of older) console.log('  ', f);
    }
    console.log(missing.length
      ? `\nMISSING (${missing.length}), in apply order:\n${missing.map((f) => `  ${f}`).join('\n')}`
      : '\nEvery recent migration is present.');
    await client.query('ROLLBACK');
  } finally {
    await client.end().catch(() => {});
  }
})().catch((e) => {
  console.error('migration-gap failed:', e.message);
  process.exit(1);
});
