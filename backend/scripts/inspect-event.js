#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS WRONG WITH THIS EVENT? — a READ-ONLY health check (2026-11-24, for
 * "investigate the issue with the first Adel event created for the client").
 *
 *   node scripts/inspect-event.js adel            # every event whose title or slug matches
 *   node scripts/inspect-event.js adel-ogla-houston
 *
 * For each match, oldest first (so "the first one" is #1), it prints what an
 * organizer, a buyer and the listings each see, and flags what usually breaks
 * an event:
 *   · the time — a time zone that does not fit the venue, a morning start
 *     that runs past midnight (an AM/PM slip), an end before the start;
 *   · whether it can be seen — status, private without a password, archived,
 *     cancelled, suspended, coming soon;
 *   · whether it can be bought — ticket types, prices, quantities, the map's
 *     unpriced or blocked seats, the payment options and methods;
 *   · what already happened — orders, offline reservations, live holds.
 *
 * It changes nothing. Fix what it finds in the admin console
 * (/admin/events/<id>/edit) — or tell Claude what it printed.
 *
 * Connects like erase-account.js: DATABASE_URL if set, else backend/.env.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const term = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
if (!term) {
  console.error('Usage: node scripts/inspect-event.js <title or slug>');
  process.exit(1);
}

async function connect() {
  if (process.env.DATABASE_URL) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    return c;
  }
  const { connect: viaSupabase } = require('./db');
  return viaSupabase();
}

const OK = '  ✔';
const WARN = '  ⚠';
const BAD = '  ✖';

/** The zone's UTC offset at an instant, in hours (−6 for Chicago in winter). */
function offsetHours(zone, at) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, timeZoneName: 'longOffset', year: 'numeric',
    }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
    const m = parts.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60);
  } catch { return null; }
}

function local(at, zone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(at);
  } catch { return at.toISOString(); }
}

function localHour(at, zone) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(at));
  } catch { return null; }
}

// Cities a client has run events in, and the zone each is in — a second check
// beside the map pin, for an event saved without one.
const CITY_ZONES = {
  houston: 'America/Chicago', dallas: 'America/Chicago', austin: 'America/Chicago', 'san antonio': 'America/Chicago',
  chicago: 'America/Chicago', atlanta: 'America/New_York', duluth: 'America/New_York', 'new york': 'America/New_York',
  detroit: 'America/Detroit', dearborn: 'America/Detroit', 'los angeles': 'America/Los_Angeles', anaheim: 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles', phoenix: 'America/Phoenix', denver: 'America/Denver', toronto: 'America/Toronto',
  mississauga: 'America/Toronto', ottawa: 'America/Toronto', montreal: 'America/Toronto', calgary: 'America/Edmonton',
  edmonton: 'America/Edmonton', vancouver: 'America/Vancouver', cairo: 'Africa/Cairo', dubai: 'Asia/Dubai',
};

async function main() {
  const db = await connect();
  const like = `%${term.toLowerCase()}%`;
  const { rows: events } = await db.query(
    `SELECT e.*, o.display_name AS organizer_name, o.id AS org_id
       FROM events e JOIN organizers o ON o.id = e.organizer_id
      WHERE lower(e.title) LIKE $1 OR lower(e.slug) LIKE $1
      ORDER BY e.created_at`,
    [like],
  );
  if (events.length === 0) {
    console.log(`No event's title or slug contains "${term}".`);
    await db.end();
    return;
  }
  const { rows: [offlineSetting] } = await db.query("SELECT value FROM platform_settings WHERE key = 'offline_checkout'");

  console.log(`\n${events.length} event(s) match "${term}", oldest first:\n`);
  for (const [i, e] of events.entries()) {
    const issues = [];
    const say = (mark, text) => { console.log(`${mark} ${text}`); if (mark !== OK) issues.push(text); };
    const start = e.starts_at ? new Date(e.starts_at) : null;
    const end = e.ends_at ? new Date(e.ends_at) : null;
    const zone = e.timezone;

    console.log('─'.repeat(78));
    console.log(`#${i + 1}  ${e.title}   (${e.slug})`);
    console.log(`    id ${e.id} · organizer ${e.organizer_name} · created ${new Date(e.created_at).toISOString()}`);
    console.log(`    https://eventsli.com/e/${e.slug}   admin: /admin/events/${e.id}/edit`);
    console.log(`    status ${e.status}${e.listing_type ? ` · ${e.listing_type}` : ''} · ${e.admission_type || 'reserved'} / ${e.purchase_mode || '—'} · ${e.country} ${e.currency}`);

    // ── The time ──
    console.log('\n  When');
    if (!start) say(BAD, 'No start time.');
    else {
      console.log(`    starts ${local(start, zone)}  (${start.toISOString()})`);
      if (end) console.log(`    ends   ${local(end, zone)}  (${end.toISOString()})`);
      console.log(`    zone   ${zone}`);
      if (end && end <= start) say(BAD, 'The end is not after the start.');
      const h = localHour(start, zone);
      const hours = end ? (end - start) / 3600e3 : 0;
      if (h !== null && h >= 5 && h < 12 && end && localHour(end, zone) <= 6 && hours > 12) {
        say(WARN, `Starts at ${h}:xx in the MORNING and runs ${hours.toFixed(1)} hours, past midnight — very likely meant ${h + 12}:xx (PM). Fix the start time.`);
      } else if (hours > 16) {
        say(WARN, `Runs ${hours.toFixed(1)} hours — check the start and end.`);
      }
      const expected = CITY_ZONES[String(e.city || '').trim().toLowerCase()];
      if (expected && expected !== zone && offsetHours(expected, start) !== offsetHours(zone, start)) {
        say(WARN, `The city is ${e.city}, which is ${expected}, but the event is set to ${zone}. Every time on the site, the tickets and the emails is in ${zone}.`);
      } else if (e.venue_lng !== null && e.venue_lng !== undefined) {
        const byPin = Number(e.venue_lng) / 15;
        const off = offsetHours(zone, start);
        if (off !== null && Math.abs(off - byPin) >= 2) say(WARN, `The venue pin (longitude ${Number(e.venue_lng).toFixed(2)}) is about UTC${byPin >= 0 ? '+' : ''}${byPin.toFixed(0)}, but ${zone} is UTC${off >= 0 ? '+' : ''}${off} — the time zone may be wrong.`);
        else say(OK, 'The time zone fits the venue.');
      }
      if (start < new Date()) say(WARN, 'It has already started (or is in the past).');
    }

    // ── Who can see it ──
    console.log('\n  Who can see it');
    if (e.status !== 'published') say(WARN, `Not published (status: ${e.status}) — buyers cannot see it.`);
    else say(OK, 'Published.');
    if (e.cancelled_at) say(BAD, `Cancelled ${new Date(e.cancelled_at).toISOString()}: ${e.cancelled_reason || ''}`);
    if (e.suspended_at) say(BAD, `Suspended ${new Date(e.suspended_at).toISOString()}: ${e.suspended_reason || ''}`);
    if (e.archived_at) say(WARN, `Archived ${new Date(e.archived_at).toISOString()}.`);
    if (e.coming_soon) say(WARN, 'Coming soon — nothing is sold until ticket sales are opened.');
    if (e.is_private) {
      say(e.access_password_hash ? OK : BAD, e.access_password_hash
        ? `Private, with a password (set ${e.access_password_set_at ? new Date(e.access_password_set_at).toISOString() : '?'}) · preview "${e.locked_preview || 'blur'}" · shows: ${(e.locked_reveal || []).join(', ') || 'nothing'}`
        : 'Private with NO password — nobody can unlock it.');
    } else console.log('    Public.');

    // ── Can it be bought ──
    console.log('\n  Can it be bought');
    const { rows: tiers } = await db.query(
      'SELECT name, price_cents, quantity, sold_count, is_hidden FROM ticket_tiers WHERE event_id = $1 ORDER BY sort_order, created_at', [e.id],
    );
    if (tiers.length === 0) say(BAD, 'No ticket types.');
    for (const t of tiers) {
      const left = t.quantity === null ? 'unlimited' : `${Math.max(0, t.quantity - (t.sold_count || 0))} of ${t.quantity} left`;
      console.log(`    · ${t.name}: ${t.price_cents === null ? 'no price' : `${(t.price_cents / 100).toFixed(2)} ${e.currency}`} · ${left}${t.is_hidden ? ' · HIDDEN' : ''}`);
      if (t.quantity !== null && t.quantity - (t.sold_count || 0) <= 0) say(WARN, `"${t.name}" is sold out.`);
    }
    const { rows: [map] } = await db.query('SELECT id FROM venue_maps WHERE event_id = $1', [e.id]);
    if ((e.admission_type || 'reserved') === 'reserved') {
      if (!map) say(BAD, 'Reserved seating but no map.');
      else {
        const { rows: [s] } = await db.query(
          `SELECT count(*)::int AS seats,
                  count(*) FILTER (WHERE s.status = 'available')::int AS open,
                  count(*) FILTER (WHERE s.status = 'sold')::int AS sold,
                  count(*) FILTER (WHERE s.status = 'held')::int AS held,
                  count(*) FILTER (WHERE s.status NOT IN ('available', 'sold', 'held'))::int AS other,
                  count(*) FILTER (WHERE s.tier_id IS NULL AND s.price_override_cents IS NULL)::int AS unpriced
             FROM seats s WHERE s.venue_map_id = $1`, [map.id],
        );
        console.log(`    map: ${s.seats} seats · ${s.open} open · ${s.sold} sold · ${s.held} held · ${s.other} blocked/other`);
        if (s.seats === 0) say(BAD, 'The map has no seats.');
        if (s.unpriced > 0) say(WARN, `${s.unpriced} seat(s) have no ticket type or price — they cannot be sold.`);
        if (s.seats > 0 && s.open === 0) say(WARN, 'No seat is open for sale.');
      }
    }
    if (!e.accepts_stripe && !e.accepts_manual) say(BAD, 'No payment option is switched on for this event.');
    else {
      if (e.accepts_stripe) console.log('    card: on');
      if (e.accepts_manual) {
        const { rows: [m] } = await db.query(
          'SELECT count(*) FILTER (WHERE is_active)::int AS active, count(*)::int AS total FROM organizer_payment_methods WHERE organizer_id = $1', [e.org_id],
        );
        console.log(`    pay the organizer: on · ${m.active} active method(s) · offline checkout ${offlineSetting?.value?.enabled ? 'ON' : 'OFF'} platform-wide`);
        if (m.active === 0) say(BAD, 'Pay-the-organizer is on, but the organizer has no active payment method.');
        if (!offlineSetting?.value?.enabled && !e.accepts_stripe) say(WARN, 'Offline checkout is OFF platform-wide and card is off — buyers cannot pay online.');
      }
    }
    console.log(`    commission: ${e.commission_pct}%${Number(e.commission_fixed_cents) ? ` + ${(e.commission_fixed_cents / 100).toFixed(2)} ${e.currency} per ticket` : ''}`);

    // ── What already happened ──
    console.log('\n  What already happened');
    const { rows: orders } = await db.query(
      'SELECT status, channel, count(*)::int AS n, sum(buyer_total_cents)::bigint AS total FROM orders WHERE event_id = $1 GROUP BY 1, 2 ORDER BY 1, 2', [e.id],
    );
    if (orders.length === 0) console.log('    no orders');
    for (const o of orders) console.log(`    orders ${o.status}/${o.channel}: ${o.n} · ${(Number(o.total || 0) / 100).toFixed(2)} ${e.currency}`);
    const { rows: offline } = await db.query(
      'SELECT status, count(*)::int AS n FROM offline_payments WHERE event_id = $1 GROUP BY 1 ORDER BY 1', [e.id],
    );
    for (const o of offline) console.log(`    offline reservations ${o.status}: ${o.n}`);
    const { rows: [holds] } = await db.query(
      "SELECT count(*)::int AS n FROM reservations WHERE event_id = $1 AND state = 'active' AND expires_at > now()", [e.id],
    );
    if (holds.n) console.log(`    live holds: ${holds.n}`);
    const { rows: [tix] } = await db.query("SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status <> 'void'", [e.id]);
    console.log(`    live tickets: ${tix.n}`);
    if (tix.n > 0 && issues.some((x) => /time|MORNING|zone/i.test(x))) {
      say(WARN, `${tix.n} ticket(s) already issued — after fixing the time, tell those buyers (their tickets show the old time until re-sent).`);
    }

    console.log(`\n  ${issues.length === 0 ? 'Nothing wrong found.' : `${issues.length} thing(s) to look at.`}\n`);
  }
  await db.end();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
