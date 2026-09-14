/**
 * Schema doctor — confirms the database actually matches what the migrations say.
 *
 *   node scripts/verify-schema.js
 *
 * Introspects over a real Postgres connection rather than through PostgREST,
 * because PostgREST answers from a cached view of the schema: immediately after
 * a migration it will report a table as missing that plainly exists, and — worse
 * — a HEAD probe against it succeeds for a table that does NOT exist. Neither
 * failure mode is acceptable in the tool you reach for to answer "did that
 * migration land?".
 */
require('dotenv').config();
const { connect } = require('./db');

const TABLES = [
  'profiles', 'organizers', 'platform_settings',
  'terms_versions', 'terms_acceptances',
  'events', 'ticket_tiers',
  'venue_maps', 'table_categories', 'tables', 'seats',
  'reservations', 'reservation_items',
  'orders', 'order_items', 'tickets',
  'ledger_entries', 'invoices',
  'scanner_access', 'scan_devices', 'scans',
  'sessions', 'webhook_events', 'admin_audit', 'promo_codes',
  'event_staff', 'email_verifications',
];

// Business rules that live in the database. If one of these is absent, the rule
// it encodes is not being enforced — regardless of what the application does.
const TRIGGERS = [
  'trg_lock_tier_price',      // BRD §13 — price frozen after first sale
  'trg_lock_event_currency',  // BRD §07 — currency frozen after first payment
  'trg_sync_table_status',    // BRD §25 — table/seat availability stay in step
  'trg_set_invoice_due_at',   // BRD §18 — due date fixed at issue, with a floor
  'trg_ledger_no_update',     // the ledger is append-only, loudly
  'trg_ledger_no_delete',
];

const FUNCTIONS = [
  'ledger_balance_cents', 'compute_invoice_due_at', 'purge_expired_sessions',
  'hold_seats', 'hold_table', 'release_reservation', 'expire_stale_reservations',
  'fulfill_checkout', 'ledger_write', 'copy_reservation_items_to_order', 'seat_price_cents',
  'check_in_ticket', 'undo_check_in', 'scanner_is_locked', 'event_checkin_stats',
  'record_manual_sale', 'raise_commission_invoice', 'settle_invoice',
  'manual_commission_owed', 'mark_overdue_invoices',
  // The dashboards — one round trip each.
  'event_sales_summary', 'organizer_dashboard_summary', 'platform_overview',
  'verify_email_code',
];

const COLUMNS = [
  ['events', 'payment_fee_mode'],
  ['orders', 'payment_fee_mode'],
  ['orders', 'stripe_cost_cents'],
  ['orders', 'platform_net_cents'],
  ['tables', 'password_hash'],
  ['tickets', 'transfer_count'],
  // Sprint 02 — identity is ours, not Supabase Auth's.
  ['profiles', 'password_hash'],
  ['profiles', 'failed_login_count'],
  ['profiles', 'locked_until'],
  ['sessions', 'revoked_reason'],
  ['sessions', 'last_seen_at'],
  // Sprints 07-08 - the gate and the manual channel.
  ['scans', 'client_scan_id'],
  ['scans', 'occurred_at'],
  ['orders', 'manual_method'],
  ['invoices', 'covers_to'],
  // BRD §21 — a guest's acceptance is recordable.
  ['terms_acceptances', 'email'],
  ['terms_acceptances', 'reservation_id'],
  // A door-team member scans through a device row of their own.
  ['scan_devices', 'staff_id'],
];

(async () => {
  const client = await connect();
  let missing = 0;
  const report = (ok, label, detail = '') => {
    if (!ok) missing += 1;
    console.log(`  ${ok ? 'ok     ' : 'MISSING'} ${label}${detail ? '  ' + detail : ''}`);
  };

  try {
    console.log('── tables ──');
    const { rows: tRows } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const present = new Set(tRows.map((r) => r.table_name));
    for (const t of TABLES) report(present.has(t), t);

    console.log('\n── columns added by later migrations ──');
    const { rows: cRows } = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const cols = new Set(cRows.map((r) => `${r.table_name}.${r.column_name}`));
    for (const [t, c] of COLUMNS) report(cols.has(`${t}.${c}`), `${t}.${c}`);

    console.log('\n── triggers (business rules) ──');
    const { rows: gRows } = await client.query(
      `SELECT DISTINCT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public'`,
    );
    const trigs = new Set(gRows.map((r) => r.trigger_name));
    for (const t of TRIGGERS) report(trigs.has(t), t);

    console.log('\n── functions ──');
    const { rows: fRows } = await client.query(
      `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public'`,
    );
    const fns = new Set(fRows.map((r) => r.routine_name));
    for (const f of FUNCTIONS) report(fns.has(f), f);

    console.log('\n── the Data API roles reach nothing ──');
    // The browser never talks to Supabase, so `anon` and `authenticated` have no
    // legitimate caller. Until 2026-09-14 both could EXECUTE every SECURITY
    // DEFINER function here — fulfill_checkout and settle_invoice included —
    // with the public anon key. Checked against privileges, not by calling
    // anything: a probe that invoked settle_invoice would be the exploit.
    const { rows: leaks } = await client.query(`
      SELECT 'table ' || c.relname AS what FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
         AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
           OR has_table_privilege('authenticated', c.oid, 'SELECT') OR NOT c.relrowsecurity)
      UNION ALL
      SELECT 'function ' || p.proname FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
         AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    report(leaks.length === 0, 'anon/authenticated locked out, RLS on everywhere',
      leaks.length ? leaks.map((l) => l.what).join(', ') : '');

    console.log('\n── the ledger is genuinely append-only ──');
    // Exercised, not merely present. A trigger that exists and a trigger that
    // fires are indistinguishable until something tries to get past it, and
    // this project has already shipped one trigger that could never run.
    const { rows: led } = await client.query('SELECT id FROM ledger_entries LIMIT 1')
      .catch(() => ({ rows: [] }));
    if (led.length === 0) {
      console.log('  skipped no ledger rows yet to test against');
    } else {
      const probes = [
        ['UPDATE refused', 'UPDATE ledger_entries SET amount_cents = amount_cents + 1 WHERE id = $1'],
        ['DELETE refused', 'DELETE FROM ledger_entries WHERE id = $1'],
      ];
      for (const [label, sql] of probes) {
        let refused = false;
        try {
          await client.query('BEGIN');
          await client.query(sql, [led[0].id]);
        } catch { refused = true; } finally { await client.query('ROLLBACK'); }
        report(refused, label);
      }
    }

    console.log('\n── invoice due date always leaves a payable window ──');
    // A manual sale 12 hours before doors would otherwise compute a due date in
    // the past and lock the scanner before the organizer could ever pay.
    const { rows: [due] } = await client.query(
      `SELECT compute_invoice_due_at(now(), now() + interval '12 hours') AS d,
              compute_invoice_due_at(now(), now() + interval '12 hours') > now() AS future`,
    );
    report(due.future, 'a sale 12h before the event', `due ${new Date(due.d).toISOString()}`);

    console.log('\n── applied migrations ──');
    const { rows: mig } = await client.query(
      `SELECT name FROM schema_migrations ORDER BY name`,
    ).catch(() => ({ rows: [] }));
    if (mig.length === 0) console.log('  (schema_migrations is empty — the baseline was applied by hand)');
    for (const m of mig) console.log(`  ok      ${m.name}`);

    console.log(missing === 0
      ? '\nSchema verified.'
      : `\n${missing} item(s) missing — the database does not match the migrations.`);
    process.exitCode = missing === 0 ? 0 : 1;
  } finally {
    await client.end().catch(() => {});
  }
})().catch((e) => {
  console.error('verify failed:', e.message);
  process.exit(1);
});
