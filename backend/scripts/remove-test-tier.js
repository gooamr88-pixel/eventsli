#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REMOVE A TEST TICKET TYPE FROM A LIVE EVENT — and the test sale on it
 * (2026-11-25, owner: "we ran a test purchase, everything works, now delete
 * the test category, the event goes live with real people").
 *
 * The organizer's Delete button refuses a ticket type that has sold, and the
 * seat page lists every type that still has seats on the map, so hiding it is
 * not enough. This does the whole job, in ONE transaction:
 *
 *   1. voids every order that holds tickets of that type
 *        · Manual (door / offline): through order_void_offline, the function
 *          the Orders › Void button uses — commission reversed, credit note
 *          if invoiced, payment audit written;
 *        · card: only once it has been REFUNDED IN STRIPE (the webhook voids
 *          the tickets); this then frees the seats. It never moves money.
 *          With --no-refund (owner, 2026-11-25: "forget the refund") an
 *          unrefunded card order's tickets are voided and the money stays;
 *        · free: tickets voided, order cancelled;
 *      tickets already scanned at the gate (a door test) are voided too;
 *   2. frees the seats those orders took;
 *   3. moves every table and seat priced by the test type to --move-to;
 *   4. deletes the ticket type.
 *
 * The orders themselves stay, as "cancelled" / "refunded": the money ledger
 * is append-only by design and pins them. They no longer count as sales.
 *
 * WITHOUT --apply IT CHANGES NOTHING: it runs every step, prints what it did,
 * and rolls the transaction back. Read that output, then add --apply.
 *
 *   node scripts/remove-test-tier.js <event slug or title> --tier "test" --move-to "GOLD"
 *   node scripts/remove-test-tier.js <event slug or title> --tier "test" --move-to "GOLD" --apply --project <ref>
 *
 * --move-to is needed only when seats or tables on the map use the test type.
 * --project must name the Supabase project in backend/.env, so --apply cannot
 * run against the wrong database. Connects like inspect-event.js:
 * DATABASE_URL if set, else backend/.env.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const REASON = 'Test order — removed before launch';
// Foreign keys to ticket_tiers this script knows how to clear.
const HANDLED = new Set(['tickets.tier_id', 'order_items.tier_id', 'seats.tier_id', 'tables.tier_id', 'reservation_items.tier_id']);

function parseArgs(argv) {
  const out = { term: [], apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--no-refund') out.noRefund = true;
    else if (a === '--tier') { out.tier = argv[i + 1]; i += 1; }
    else if (a === '--move-to') { out.moveTo = argv[i + 1]; i += 1; }
    else if (a === '--project') { out.project = argv[i + 1]; i += 1; }
    else if (a.startsWith('--')) { console.error(`Unknown option ${a}`); process.exit(2); }
    else out.term.push(a);
  }
  out.term = out.term.join(' ').trim();
  return out;
}

async function connect() {
  if (process.env.DATABASE_URL) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    return { client: c, where: 'DATABASE_URL' };
  }
  const { connect: viaSupabase } = require('./db');
  return { client: await viaSupabase(), where: process.env.SUPABASE_URL };
}

const projectRef = () => (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || null;
const money = (cents, cur) => `${(Number(cents || 0) / 100).toFixed(2)} ${cur || ''}`.trim();

class Stop extends Error {}
const stop = (msg) => { throw new Stop(msg); };

async function findEvent(db, term) {
  let { rows } = await db.query('SELECT id, title, slug, status FROM events WHERE slug = $1', [term]);
  if (rows.length === 0) {
    ({ rows } = await db.query(
      `SELECT id, title, slug, status FROM events
        WHERE title ILIKE '%' || $1 || '%' OR slug ILIKE '%' || $1 || '%'
        ORDER BY created_at`, [term]));
  }
  if (rows.length === 0) stop(`No event matches "${term}".`);
  if (rows.length > 1) {
    stop(`"${term}" matches ${rows.length} events — run again with the exact slug:\n`
      + rows.map((e) => `    ${e.slug}   (${e.title}, ${e.status})`).join('\n'));
  }
  return rows[0];
}

async function findTier(db, eventId, name, what) {
  const { rows } = await db.query(
    `SELECT id, name, price_cents, quantity, sold_count, is_hidden FROM ticket_tiers
      WHERE event_id = $1 AND lower(btrim(name)) = lower(btrim($2))`, [eventId, name]);
  if (rows.length === 0) {
    const { rows: all } = await db.query('SELECT name FROM ticket_tiers WHERE event_id = $1 ORDER BY sort_order, name', [eventId]);
    stop(`No ${what} called "${name}" on this event. Its ticket types: ${all.map((t) => `"${t.name}"`).join(', ') || 'none'}.`);
  }
  if (rows.length > 1) stop(`${rows.length} ticket types are called "${name}" — rename one first.`);
  return rows[0];
}

async function exists(db, fn) {
  const { rows } = await db.query('SELECT to_regproc($1) IS NOT NULL AS ok', [fn]);
  return rows[0].ok;
}

/** Void a card / free order's tickets and free its seats (what order_void_offline does, minus the money). */
async function voidTicketsAndSeats(db, orderId) {
  const { rows } = await db.query(
    `UPDATE tickets SET status = 'void' WHERE order_id = $1 AND status IN ('valid', 'scanned')
     RETURNING seat_id`, [orderId]);
  const seats = await freeSeats(db, orderId);
  return { tickets: rows.length, seats };
}

async function freeSeats(db, orderId) {
  const { rowCount } = await db.query(
    `UPDATE seats s SET status = 'available', held_by_reservation = NULL
      WHERE s.id IN (SELECT seat_id FROM tickets WHERE order_id = $1 AND seat_id IS NOT NULL)
        AND s.status = 'sold'
        AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.seat_id = s.id AND t.status IN ('valid', 'scanned'))`,
    [orderId]);
  return rowCount;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.term || !args.tier) {
    console.error('Usage: node scripts/remove-test-tier.js <event slug or title> --tier "<name>" [--move-to "<name>"] [--no-refund] [--apply --project <ref>]');
    process.exit(2);
  }
  if (args.apply && !process.env.DATABASE_URL && args.project !== projectRef()) {
    console.error(`--apply needs --project ${projectRef() || '<ref>'} — the project in backend/.env — so this cannot run on the wrong database.`);
    process.exit(2);
  }

  const { client: db, where } = await connect();
  console.log(`Database: ${where}`);
  console.log(args.apply ? 'Mode: APPLY — changes will be committed.\n' : 'Mode: REHEARSAL — everything runs, then is rolled back. Nothing changes.\n');

  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout = '10s'");
    await db.query("SET LOCAL statement_timeout = '60s'");

    const event = await findEvent(db, args.term);
    console.log(`Event:       ${event.title}  (/e/${event.slug}, ${event.status})`);
    const tier = await findTier(db, event.id, args.tier, 'ticket type');
    console.log(`Remove:      "${tier.name}"  ${money(tier.price_cents)}  sold ${tier.sold_count}/${tier.quantity ?? '∞'}${tier.is_hidden ? '  (hidden)' : ''}`);
    const target = args.moveTo ? await findTier(db, event.id, args.moveTo, '--move-to ticket type') : null;
    if (target && target.id === tier.id) stop('--move-to must be a different ticket type.');
    if (target) console.log(`Move to:     "${target.name}"  ${money(target.price_cents)}`);

    // ── Every foreign key to ticket_tiers on THIS database, not the one in the repo ──
    const { rows: fks } = await db.query(
      `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'public.ticket_tiers'::regclass`);
    for (const fk of fks) {
      const key = `${fk.tbl.replace(/^public\./, '')}.${fk.col}`;
      if (HANDLED.has(key)) continue;
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${fk.tbl} WHERE ${fk.col} = $1`, [tier.id]);
      if (rows[0].n > 0) stop(`${rows[0].n} row(s) in ${key} point at this ticket type, which this script does not handle. Nothing was changed.`);
    }

    // ── Nobody mid-checkout on it ──
    const { rows: [holds] } = await db.query(
      `SELECT count(*)::int AS n FROM reservation_items ri JOIN reservations r ON r.id = ri.reservation_id
        WHERE ri.tier_id = $1 AND r.state = 'active'`, [tier.id]);
    if (holds.n > 0) stop(`${holds.n} checkout(s) are holding this ticket type right now. Try again in about 35 minutes.`);
    if ((await db.query("SELECT to_regclass('public.offline_payments') AS t")).rows[0].t) {
      const { rows: [waiting] } = await db.query(
        `SELECT count(*)::int AS n FROM offline_payments op
          WHERE op.status = 'awaiting'
            AND EXISTS (SELECT 1 FROM reservation_items ri WHERE ri.reservation_id = op.reservation_id AND ri.tier_id = $1)`, [tier.id]);
      if (waiting.n > 0) stop(`${waiting.n} offline payment(s) on this ticket type are still awaiting confirmation. Cancel them in Orders first.`);
    }

    // ── 1–2. The orders ──
    const { rows: orders } = await db.query(
      `SELECT o.id, o.channel::text AS channel, o.status::text AS status, o.organizer_id, o.currency,
              o.buyer_total_cents, COALESCE(o.refunded_cents, 0) AS refunded_cents, o.stripe_payment_intent_id,
              o.created_at, COALESCE(o.guest_name, p.full_name) AS name, COALESCE(o.guest_email, p.email)::text AS email,
              (SELECT count(*)::int FROM tickets t WHERE t.order_id = o.id) AS tickets,
              (SELECT count(*)::int FROM tickets t WHERE t.order_id = o.id AND t.tier_id IS DISTINCT FROM $1) AS other,
              (SELECT count(*)::int FROM tickets t WHERE t.order_id = o.id AND t.status = 'scanned') AS scanned,
              (SELECT count(*)::int FROM tickets t WHERE t.order_id = o.id AND t.status IN ('valid', 'scanned')) AS live
         FROM orders o LEFT JOIN profiles p ON p.id = o.user_id
        WHERE o.id IN (SELECT order_id FROM tickets WHERE tier_id = $1
                       UNION SELECT order_id FROM order_items WHERE tier_id = $1)
        ORDER BY o.created_at`, [tier.id]);

    console.log(`\nOrders with "${tier.name}" tickets: ${orders.length}`);
    for (const o of orders) {
      console.log(`  · ${o.id}  ${o.created_at.toISOString().slice(0, 16).replace('T', ' ')}  ${o.channel}/${o.status}`
        + `  ${money(o.buyer_total_cents, o.currency)}${Number(o.refunded_cents) ? ` (refunded ${money(o.refunded_cents, o.currency)})` : ''}`
        + `  ${o.name || '—'} <${o.email || '—'}>  tickets ${o.tickets}${o.scanned ? `, ${o.scanned} scanned` : ''}`);
      if (o.other > 0) stop(`Order ${o.id} also holds ${o.other} ticket(s) of OTHER types — that is not a test order. Nothing was changed.`);
    }
    const unrefundedCard = orders.filter((o) => o.channel === 'stripe' && o.status === 'paid'
      && Number(o.buyer_total_cents) > 0 && Number(o.refunded_cents) < Number(o.buyer_total_cents));
    if (unrefundedCard.length && !args.noRefund) {
      stop('These card orders have not been refunded. Refund each one in the Stripe dashboard first (full amount),\n'
        + 'wait a minute for Eventsli to record it, then run this again — or add --no-refund to keep the money\n'
        + 'and only cancel the tickets:\n'
        + unrefundedCard.map((o) => `    ${o.id}  ${money(o.buyer_total_cents, o.currency)}  payment ${o.stripe_payment_intent_id || '?'}`).join('\n'));
    }
    if (unrefundedCard.length) {
      console.log('  ! --no-refund: the card payment stays as it is (no money moves); the order stays "paid", its tickets are voided.');
    }

    const canVoidManual = await exists(db, 'public.order_void_offline');
    for (const o of orders) {
      if (o.live === 0) {
        const seats = await freeSeats(db, o.id);
        console.log(`  ✓ ${o.id}: already void${seats ? `, freed ${seats} seat(s)` : ''}`);
        continue;
      }
      // A door test leaves the ticket scanned; order_void_offline refuses a scanned
      // order, and it is a test, so those tickets go first.
      if (o.scanned) await db.query("UPDATE tickets SET status = 'void' WHERE order_id = $1 AND status = 'scanned'", [o.id]);

      if (o.channel === 'manual' && o.status === 'paid' && canVoidManual) {
        const { rows: [{ r }] } = await db.query(
          "SELECT order_void_offline($1, $2, NULL, 'admin', 'void', $3) AS r", [o.id, o.organizer_id, REASON]);
        if (!r?.ok) stop(`Voiding ${o.id} failed: ${r?.message || JSON.stringify(r)}`);
        console.log(`  ✓ ${o.id}: voided (${(r.tickets_voided || 0) + o.scanned} ticket(s)), commission reversed ${money(r.commission_reversed_cents, o.currency)}`);
      } else {
        const done = await voidTicketsAndSeats(db, o.id);
        // A card order stays "paid": the charge happened (refunded or not, as
        // Stripe's own webhook leaves it), and a lost dispute is recorded the
        // same way — tickets void, order paid. Only a free order is cancelled.
        if (o.channel !== 'stripe' && o.status === 'paid') await db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [o.id]);
        console.log(`  ✓ ${o.id}: ${done.tickets} ticket(s) voided, ${done.seats} seat(s) freed`
          + `${o.channel === 'manual' && !canVoidManual ? '  (order_void_offline missing: commission NOT reversed)' : ''}`);
      }
    }

    // ── 3. The map ──
    const { rows: onMap } = await db.query(
      `SELECT tb.label,
              (tb.tier_id = $1) AS table_typed,
              (SELECT count(*)::int FROM seats s WHERE s.table_id = tb.id AND s.tier_id = $1) AS seats,
              (SELECT count(*)::int FROM seats s WHERE s.table_id = tb.id AND s.tier_id = $1 AND s.status IN ('held', 'sold')) AS taken
         FROM tables tb
        WHERE tb.tier_id = $1 OR EXISTS (SELECT 1 FROM seats s WHERE s.table_id = tb.id AND s.tier_id = $1)
        ORDER BY tb.label`, [tier.id]);
    const { rows: [loose] } = await db.query(
      'SELECT count(*)::int AS n FROM seats WHERE tier_id = $1 AND table_id IS NULL', [tier.id]);
    console.log(`\nOn the map: ${onMap.length} table(s)${loose.n ? ` + ${loose.n} seat(s) outside tables` : ''} use "${tier.name}"`);
    for (const t of onMap) {
      console.log(`  · ${t.label}: ${t.table_typed ? 'table type' : 'seats only'}, ${t.seats} seat(s)${t.taken ? `, ${t.taken} still held/sold` : ''}`);
    }
    const takenLeft = onMap.reduce((n, t) => n + t.taken, 0);
    if (takenLeft > 0) stop(`${takenLeft} seat(s) of this type are still held or sold by orders that are not test orders. Nothing was changed.`);
    if ((onMap.length || loose.n) && !target) {
      stop(`Seats use "${tier.name}". Run again with --move-to "<ticket type>" to say what they become (e.g. --move-to "GOLD").`);
    }
    if (target) {
      const tb = await db.query('UPDATE tables SET tier_id = $2 WHERE tier_id = $1', [tier.id, target.id]);
      const st = await db.query('UPDATE seats SET tier_id = $2 WHERE tier_id = $1', [tier.id, target.id]);
      console.log(`  ✓ moved ${tb.rowCount} table(s) and ${st.rowCount} seat(s) to "${target.name}"`);
    }

    // ── 4. The ticket type ──
    // Past checkouts point at it with no ON DELETE rule; they finished long ago.
    const ri = await db.query('UPDATE reservation_items SET tier_id = NULL WHERE tier_id = $1', [tier.id]);
    const { rows: [after] } = await db.query('SELECT sold_count FROM ticket_tiers WHERE id = $1', [tier.id]);
    if (Number(after.sold_count) !== 0) stop(`"${tier.name}" still counts ${after.sold_count} sold after the voids. Nothing was changed.`);
    await db.query('DELETE FROM ticket_tiers WHERE id = $1', [tier.id]);
    console.log(`\n  ✓ cleared ${ri.rowCount} old checkout line(s)`);
    console.log(`  ✓ deleted ticket type "${tier.name}"`);

    if (args.apply) {
      await db.query('COMMIT');
      console.log('\nCOMMITTED. Refresh the event page (it can take up to a minute to update).');
    } else {
      await db.query('ROLLBACK');
      console.log('\nREHEARSAL OK — rolled back, nothing changed. Add --apply --project <ref> to do it for real.');
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    if (err instanceof Stop) {
      console.error(`\nSTOPPED: ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error(`\nFAILED (rolled back, nothing changed): ${err.message}`);
      process.exitCode = 1;
    }
  } finally {
    await db.end().catch(() => {});
  }
}

main();
