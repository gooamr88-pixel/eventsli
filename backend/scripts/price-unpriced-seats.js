/**
 * Attaches an event's single ticket type to every seat on its map that has no
 * price of its own, and un-hides that type.
 *
 *   node scripts/price-unpriced-seats.js <event-id>           # report only
 *   node scripts/price-unpriced-seats.js <event-id> --apply   # write
 *
 * WHY THIS EXISTS. `seat_price_cents` is
 * `COALESCE(price_override_cents, tier.price_cents, 0)`, so a seat with no
 * override and no ticket type resolves to ZERO — indistinguishable, at the
 * till, from a seat that is free on purpose. A seat map is drawn before the
 * tiers are wired to it, so "no tier on any seat" is the normal state of a
 * half-built event, and an organizer who publishes at that moment sells the
 * whole room for nothing. It happened on CRUISE MEETING: one $100 type, marked
 * hidden, attached to nothing; the listing read "From $100" and the checkout
 * charged $0.00.
 *
 * `hold_seats` refuses that sale now (migration 20261012090000) and
 * `submissionBlockers` stops the event being submitted at all. This script is
 * for the maps that were published before either existed.
 *
 * IT REFUSES TO GUESS. With more than one ticket type, which one prices which
 * seat is a decision about the organizer's own pricing, and a script that
 * picked the cheapest would quietly reprice a room. Those go to the seating
 * map, by hand.
 *
 * A seat with a `price_override_cents` is left exactly as it is, including an
 * override of 0 — that is a deliberately free seat.
 *
 * It does NOT touch orders that have already been fulfilled at the wrong
 * price. Re-pricing a completed sale is a decision about somebody's money.
 */
require('dotenv').config();
const { connect } = require('./db');

const eventId = process.argv[2];
const APPLY = process.argv.includes('--apply');

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId || '')) {
  console.error('usage: node scripts/price-unpriced-seats.js <event-id> [--apply]');
  process.exit(1);
}

const money = (cents, currency) => `${(cents / 100).toFixed(2)} ${currency}`;

(async () => {
  const client = await connect({ quiet: false });

  try {
    const { rows: events } = await client.query(
      'SELECT id, title, status, currency, purchase_mode, admission_type FROM events WHERE id = $1',
      [eventId],
    );
    if (!events.length) throw new Error('No event with that id.');
    const event = events[0];
    console.log(`\nevent: ${event.title} — ${event.status}, ${event.admission_type}, ${event.purchase_mode}`);

    if (event.admission_type === 'general') {
      throw new Error('This is a general-admission event. It has no seats to price.');
    }
    if (event.purchase_mode === 'table_only') {
      throw new Error('This event sells whole tables, which carry their own price. '
        + 'Seats here are not sold individually and do not need a ticket type.');
    }

    const { rows: tiers } = await client.query(
      'SELECT id, name, price_cents, quantity, is_hidden FROM ticket_tiers WHERE event_id = $1 ORDER BY price_cents',
      [eventId],
    );
    if (!tiers.length) throw new Error('This event has no ticket types. Create one first.');
    if (tiers.length > 1) {
      throw new Error(`${tiers.length} ticket types on this event. Which one prices which seat `
        + 'is a pricing decision, not something a script may guess — assign them on the seating map.');
    }
    const tier = tiers[0];
    console.log(`tier:  ${tier.name} — ${money(tier.price_cents, event.currency)}, `
      + `${tier.quantity ?? 'unlimited'} available, hidden: ${tier.is_hidden}`);

    // `venue_maps` is the join: seats carry a map id, and the map carries the
    // event. Going straight from seats to the event would price another
    // event's map if an id were ever mistyped.
    const { rows: counts } = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (
                WHERE s.price_override_cents IS NULL AND s.tier_id IS NULL
              )::int AS unpriced,
              count(*) FILTER (WHERE s.status <> 'available')::int AS taken
         FROM seats s
         JOIN venue_maps vm ON vm.id = s.venue_map_id
        WHERE vm.event_id = $1`,
      [eventId],
    );
    const { total, unpriced, taken } = counts[0];
    if (total === 0) throw new Error('This event has no seating map, or no seats on it.');
    console.log(`seats: ${total} total, ${unpriced} with no price, ${taken} already held or sold`);

    if (unpriced === 0 && !tier.is_hidden) {
      console.log('\nNothing to do.');
      return;
    }

    if (!APPLY) {
      console.log(`\nDRY RUN — nothing written. With --apply this would:`);
      if (unpriced > 0) {
        console.log(`  · price ${unpriced} seats at ${money(tier.price_cents, event.currency)}`);
      }
      if (tier.is_hidden) console.log('  · un-hide the ticket type');
      return;
    }

    // One transaction. Half-priced is the state this script exists to get out
    // of, and it is worse than either end of it.
    await client.query('BEGIN');

    const priced = await client.query(
      `UPDATE seats s
          SET tier_id = $2
         FROM venue_maps vm
        WHERE vm.id = s.venue_map_id
          AND vm.event_id = $1
          AND s.price_override_cents IS NULL
          AND s.tier_id IS NULL`,
      [eventId, tier.id],
    );
    if (tier.is_hidden) {
      await client.query('UPDATE ticket_tiers SET is_hidden = false WHERE id = $1', [tier.id]);
    }

    await client.query('COMMIT');

    console.log(`\npriced ${priced.rowCount} seats at ${money(tier.price_cents, event.currency)}`);
    if (tier.is_hidden) console.log('the ticket type is now visible on the event page and the listing');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nFAILED — nothing was written.\n${e.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
