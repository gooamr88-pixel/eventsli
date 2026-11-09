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
  // The organizer journey (20260917091000).
  'organizer_payment_methods', 'event_cancellation_requests',
  // Eventsli AI — the daily allowance (20261018090000).
  'ai_generations',
];

// Business rules that live in the database. If one of these is absent, the rule
// it encodes is not being enforced — regardless of what the application does.
const TRIGGERS = [
  // trg_lock_tier_price was dropped by 20261112090000 (owner decision S-18): a
  // type's price may change after a sale. What protects buyers is these:
  'trg_order_prices_final',      // a sold order's amounts never change (S-18)
  'trg_order_item_prices_final', // nor a sold line's price
  'trg_snapshot_ticket_place',   // a ticket keeps the table and seat it was issued with (S-16)
  'trg_log_tier_price',          // every price change is in the audit log (S-10)
  'trg_log_table_price',
  'trg_lock_event_currency',  // BRD §07 — currency frozen after first payment
  'trg_sync_table_status',    // BRD §25 — table/seat availability stay in step
  'trg_set_invoice_due_at',   // BRD §18 — due date fixed at issue, with a floor
  'trg_ledger_no_update',     // the ledger is append-only, loudly
  'trg_ledger_no_delete',
  'trg_seats_same_map_as_table', // a seat's table is on the seat's own map
  'trg_sync_tier_sold_count',    // sold_count follows the paid tickets
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
  'verify_email_code', 'activate_email_link',
  // Ids in a request body are scoped to their event (20260915120000).
  'save_venue_map', 'seats_same_map_as_table',
  // Ticket-type allocations and discount-code claims (20260915130000/131000).
  'sync_tier_sold_count', 'tier_allocation_exceeded', 'claim_promo_code', 'release_promo_claim',
  // Sums in the database, and the door PIN lockout (20260915140000).
  'event_order_totals', 'admin_event_sales', 'admin_organizer_sales', 'record_device_pin_failure',
  // Eventsli AI: two drafts a day, counted under a row lock (20261018090000).
  'ai_reserve_generation', 'ai_finish_generation', 'ai_generation_status',
  // Organizer dashboards (20261103120000, 20261103130000, 20261103140000, 20261104090000).
  'organizer_dashboard_trends', 'organizer_dashboard_insights', 'organizer_event_figures',
  'event_overview_trends',
  // Direct charges: what happens after the sale (20261106090000).
  'record_stripe_refund', 'record_application_fee_refund', 'record_stripe_dispute',
  // Seating and pricing integrity (20261112090000, TECH-AUDIT-LOG S-11).
  'event_from_prices',
  'set_tier_price', 'log_price_change', 'sale_prices_are_final', 'snapshot_ticket_place',
];

// Rules the database enforces as CHECKs (20260915140000).
const CONSTRAINTS = [
  'organizers_country_supported',     // BRD §07 — CA and US only
  'events_country_supported',
  'events_currency_follows_country',  // CAD in Canada, USD in the US
  'terms_versions_audience_version_key',
  'ai_generations_request',           // a retried request is never charged twice
  // Direct charges (20261106090000).
  'orders_charge_model_known', 'orders_direct_has_account', 'orders_refund_within_total',
  'orders_fee_refund_within_fee', 'orders_disputed_non_negative',
];

/**
 * DEFINITIONS, not names (TECH-AUDIT-LOG DB-04). Three of the November
 * migrations change something that already exists — a CHECK's expression, a
 * function's body — so a name check passes whether or not they ran. Each entry
 * is [label, SQL returning one boolean `ok`, what it proves].
 */
const DEFINITIONS = [
  ['24 browse categories (20261015090000, I-003)',
    `SELECT count(*) >= 24 AS ok FROM event_categories`],
  ['media URL check accepts any http(s) URL (20261016090000, I-004)',
    `SELECT pg_get_constraintdef(oid) LIKE '%[:space:]%' AS ok FROM pg_constraint WHERE conname = 'media_url_is_http'`],
  ['sponsor link check accepts any http(s) URL (20261016090000, I-004)',
    `SELECT pg_get_constraintdef(oid) LIKE '%[:space:]%' AS ok FROM pg_constraint WHERE conname = 'event_sponsor_link_is_http'`],
  ['AI feature list includes the launch kit (20261103090000)',
    `SELECT pg_get_constraintdef(oid) LIKE '%launch_kit%' AS ok FROM pg_constraint WHERE conname = 'ai_generations_feature'`],
  ['fulfill_checkout is the direct-charge version (20261106090000)',
    `SELECT prosrc LIKE '%chargeModel%' AND prosrc LIKE '%v_org_account%' AS ok FROM pg_proc WHERE proname = 'fulfill_checkout'`],
  ['success-page session lookup index (20261106090000)',
    `SELECT to_regclass('public.reservations_stripe_session_idx') IS NOT NULL AS ok`],
  ['save_venue_map refuses growing a whole-booked table and writes seat tiers (20261111090000, T-017/T-086)',
    `SELECT prosrc LIKE '%booked as a whole table%' AND prosrc LIKE '%SET tier_id%' AS ok FROM pg_proc WHERE proname = 'save_venue_map'`],
  ['fulfill_checkout issues only the seats its hold holds (20261111090000, T-017)',
    `SELECT prosrc LIKE '%held_by_reservation = p_reservation_id%' AND prosrc LIKE '%v_org_account%' AS ok FROM pg_proc WHERE proname = 'fulfill_checkout'`],
  ['save_venue_map checks the version and lets blocked seats go (20261112090000, S-03/S-08)',
    `SELECT prosrc LIKE '%MAP_STALE%' AND prosrc LIKE '%step aside%' AS ok FROM pg_proc WHERE proname = 'save_venue_map' AND pronargs = 6`],
  ['save_venue_map saves seat blocks and section rows with the map (20261112090000, S-19)',
    `SELECT prosrc LIKE '%p_availability%' AND prosrc LIKE '%two rows would share the same seats%' AS ok
       FROM pg_proc WHERE proname = 'save_venue_map' AND pronargs = 6`],
  ['the type price lock is gone, and sale prices are final instead (20261112090000, S-18)',
    `SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lock_tier_price')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_order_prices_final') AS ok`],
  ['the door reads each ticket as issued (20261112090000, S-16)',
    `SELECT count(*) = 4 AS ok FROM pg_proc
      WHERE proname IN ('check_in_ticket_v2', 'event_door_list', 'ticket_door_detail', 'event_door_manifest')
        AND prosrc LIKE '%issued_section%'`],
  ['hold_table checks the sale window; hold_seats the per-type limit (20261112090000, S-05/S-06)',
    `SELECT (SELECT prosrc LIKE '%tier_sale_window_closed%' FROM pg_proc WHERE proname = 'hold_table')
        AND (SELECT prosrc LIKE '%max_per_order%' FROM pg_proc WHERE proname = 'hold_seats') AS ok`],
  ['a door table sale is one receipt line (20261112090000, S-12)',
    `SELECT prosrc LIKE '%CHANGED (S-12)%' AS ok FROM pg_proc WHERE proname = 'record_manual_sale'`],
];

const INDEXES = [
  'reservation_items_reservation_idx', 'orders_one_per_reservation', 'orders_paid_at_idx',
  'orders_user_idx', 'invoices_event_idx', 'admin_audit_created_idx', 'admin_audit_action_idx',
  'scan_devices_event_idx', 'seats_tier_idx', 'tickets_tier_idx', 'scans_device_idx',
];

const COLUMNS = [
  ['events', 'payment_fee_mode'],
  ['orders', 'payment_fee_mode'],
  ['orders', 'stripe_cost_cents'],
  ['orders', 'platform_net_cents'],
  ['tables', 'password_hash'],
  // A table's own ticket type and seat price (20261112090000, S-02).
  ['tables', 'tier_id'],
  ['tables', 'seat_price_cents'],
  // A theatre row's section and row (S-19), and the ticket's issued snapshot (S-16).
  ['tables', 'section_name'],
  ['tables', 'row_name'],
  ['tickets', 'issued_table_label'],
  ['tickets', 'issued_section'],
  ['tickets', 'issued_row'],
  ['tickets', 'issued_seat_number'],
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
  // Door PINs lock after repeated failures (20260915140000).
  ['scan_devices', 'failed_pin_count'],
  ['scan_devices', 'pin_locked_until'],
  // Direct charges: whose charge, and what happened after (20261106090000).
  ['orders', 'charge_model'],
  ['orders', 'stripe_account_id'],
  ['orders', 'stripe_charge_id'],
  ['orders', 'refunded_cents'],
  ['orders', 'application_fee_refunded_cents'],
  ['orders', 'dispute_status'],
  ['orders', 'disputed_cents'],
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

    console.log('\n── constraints ──');
    const { rows: kRows } = await client.query(
      `SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace`,
    );
    const cons = new Set(kRows.map((r) => r.conname));
    for (const k of CONSTRAINTS) report(cons.has(k), k);

    console.log('\n── definitions (a name check cannot see these) ──');
    for (const [label, sql] of DEFINITIONS) {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await client.query(sql).catch((e) => ({ rows: [], err: e }));
      report(rows[0]?.ok === true, label);
    }

    console.log('\n── indexes on the hot paths ──');
    const { rows: iRows } = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const idx = new Set(iRows.map((r) => r.indexname));
    for (const i of INDEXES) report(idx.has(i), i);

    console.log('\n── a new function is private by default ──');
    // A schema-level default cannot remove the global PUBLIC EXECUTE, so a
    // function created without its own REVOKE was callable with the anon key.
    const { rows: [acl] } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_default_acl d
         WHERE d.defaclrole = current_user::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'
           AND NOT EXISTS (SELECT 1 FROM unnest(d.defaclacl) a WHERE a::text LIKE '=%')
      ) AS private_by_default`);
    report(acl.private_by_default, 'global default revokes EXECUTE from PUBLIC');

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
