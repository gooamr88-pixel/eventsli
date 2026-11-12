#!/usr/bin/env node
/**
 * Finds events saved in the WRONG time zone and, with --apply, repairs them.
 *
 *   node scripts/fix-event-timezones.js                     # report only
 *   node scripts/fix-event-timezones.js --apply             # repair what it found
 *   node scripts/fix-event-timezones.js --all               # include past events
 *   node scripts/fix-event-timezones.js --event <id> --zone Australia/Sydney [--apply]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVENTS ARE WRONG.
 *
 * Until the zone list went worldwide, the create and edit forms offered only
 * Canadian and US zones (by the event's MARKET country), and anything else fell
 * back to America/Toronto. An event at a Sydney venue was therefore stored with
 * a North American zone: the organizer typed "8 pm", the API stored 8 pm
 * TORONTO, and every page has shown "8:00 PM EST" since — the right clock
 * digits, the wrong instant, about sixteen hours from the real show.
 *
 * HOW THE RIGHT ZONE IS KNOWN. For an event whose venue was picked from venue
 * search, `venue_place_id` is resolved through Google Places, which returns the
 * venue's IANA zone (one Place Details call per event — billed). An event with
 * no place id cannot be checked automatically; it is listed so somebody can
 * pass its zone explicitly with --event/--zone.
 *
 * WHAT A REPAIR DOES. It moves the zone and KEEPS THE WALL CLOCK: 8 pm in
 * Toronto becomes 8 pm in Sydney (utils/zonedTime.reanchor). That is the
 * instant the organizer meant and the time every buyer has already been shown.
 * The event's start and end move, and so does its running order
 * (`event_schedule`), which is entered on the same venue clock.
 *
 * Ticket sale windows are NOT moved: the tiers screen takes those on the
 * organizer's own clock as absolute instants (see Tiers.jsx), so they were
 * never anchored to the event's zone and are not wrong.
 *
 * Without --apply nothing is written. Run the report first and read it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { supabase } = require('../config/supabase');
const places = require('../services/placesService');
const { reanchor } = require('../utils/zonedTime');

const has = (flag) => process.argv.includes(`--${flag}`);
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

const APPLY = has('apply');

/** The zone this event should have, and how it was found — or null. */
async function rightZone(event, override) {
  if (override) return { zone: override, source: 'given' };
  if (!event.venue_place_id) return null;
  if (!places.isEnabled()) return null;
  try {
    const place = await places.details({ placeId: event.venue_place_id });
    return place.timeZone ? { zone: place.timeZone, source: 'venue' } : null;
  } catch (err) {
    return { error: err.message };
  }
}

async function repair(event, zone) {
  const startsAt = reanchor(event.starts_at, event.timezone, zone);
  const endsAt = reanchor(event.ends_at, event.timezone, zone);
  if (!startsAt || !endsAt) throw new Error('could not re-anchor the event times');

  const items = must(
    await supabase.from('event_schedule').select('id, starts_at, ends_at').eq('event_id', event.id),
    'schedule',
  ) || [];
  const moved = items.map((s) => ({
    id: s.id,
    starts_at: s.starts_at ? reanchor(s.starts_at, event.timezone, zone) : null,
    ends_at: s.ends_at ? reanchor(s.ends_at, event.timezone, zone) : null,
  }));

  console.log(`    starts ${event.starts_at} → ${startsAt}`);
  console.log(`    ends   ${event.ends_at} → ${endsAt}`);
  if (moved.length) console.log(`    ${moved.length} schedule item(s) move by the same clock`);
  if (!APPLY) return;

  must(
    await supabase.from('events').update({ timezone: zone, starts_at: startsAt, ends_at: endsAt }).eq('id', event.id),
    'event update',
  );
  for (const s of moved) {
    must(
      await supabase.from('event_schedule').update({ starts_at: s.starts_at, ends_at: s.ends_at }).eq('id', s.id),
      'schedule update',
    );
  }
  console.log('    repaired');
}

async function main() {
  const eventId = arg('event');
  const override = arg('zone');
  if (override) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: override }).format(0);
    } catch {
      console.error(`Unknown time zone: ${override}`);
      process.exit(1);
    }
    if (!eventId) {
      console.error('--zone needs --event <id>: one explicit zone is never right for every event.');
      process.exit(1);
    }
  }
  if (!override && !places.isEnabled()) {
    console.error('GOOGLE_PLACES_API_KEY is not set, so venue zones cannot be looked up.');
    console.error('Set it, or repair one event at a time with --event <id> --zone <IANA zone>.');
    process.exit(1);
  }

  let query = supabase.from('events')
    .select('id, slug, title, status, timezone, starts_at, ends_at, venue_name, city, venue_place_id')
    .order('starts_at');
  if (eventId) query = query.eq('id', eventId);
  else if (!has('all')) query = query.gte('ends_at', new Date().toISOString());
  const events = must(await query, 'events') || [];

  let wrong = 0;
  const unchecked = [];
  console.log(`${APPLY ? 'REPAIRING' : 'REPORT (nothing is written without --apply)'} — ${events.length} event(s)\n`);

  for (const event of events) {
    const found = await rightZone(event, override);
    if (!found) { unchecked.push(event); continue; }
    if (found.error) { console.log(`! ${event.slug}: lookup failed — ${found.error}`); continue; }
    if (found.zone === event.timezone) continue;

    wrong += 1;
    console.log(`✗ ${event.slug} [${event.status}] “${event.title}” — ${event.venue_name || '?'}, ${event.city || '?'}`);
    console.log(`    zone   ${event.timezone} → ${found.zone} (from ${found.source})`);
    await repair(event, found.zone);
  }

  console.log(`\n${wrong} event(s) in the wrong zone${APPLY ? ', repaired' : ''}.`);
  if (unchecked.length) {
    console.log(`${unchecked.length} event(s) have no venue from search and could not be checked:`);
    for (const e of unchecked) console.log(`    ${e.id}  ${e.slug}  ${e.timezone}  ${e.venue_name || '—'}, ${e.city || '—'}`);
    console.log('  Repair one with: node scripts/fix-event-timezones.js --event <id> --zone <IANA zone> --apply');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
