#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WRITE AN EVENT'S PAGE FROM A FILE (2026-11-24: "fill in his event
 * professionally"). Description, highlights and policies, from a JSON file
 * written for that event (scripts/content/<slug>.json).
 *
 *   node scripts/fill-event-content.js scripts/content/adel-ogla-houston.json            # preview
 *   node scripts/fill-event-content.js scripts/content/adel-ogla-houston.json --commit   # write it
 *
 * PREVIEW BY DEFAULT: it prints what the page says now beside what it will
 * say, and changes nothing. With --commit it writes everything in ONE
 * transaction — all of it or none of it — then refreshes the cached event page.
 *
 * A policy replaces the event's policy of the same kind and title; any other
 * policy the organizer wrote is left alone. Prices, seats, dates, privacy and
 * payments are never touched.
 *
 * "venue" fills ONLY the venue fields that are empty — an address the
 * organizer chose is never overwritten. "schedule" is the evening's
 * timeline, times local to the event ("20:30", "day": 1 for after midnight;
 * no time for an item that has none). It is added to an event with no
 * schedule; an existing one is replaced only with --replace-schedule.
 *
 * Connects like erase-account.js: DATABASE_URL if set, else backend/.env.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const commit = args.includes('--commit');
const replaceSchedule = args.includes('--replace-schedule');
const VENUE_FIELDS = {
  address: 'venue_address', line2: 'venue_address_line2', region: 'venue_region',
  postalCode: 'venue_postal_code', directions: 'venue_directions', city: 'city',
};
if (!file) {
  console.error('Usage: node scripts/fill-event-content.js <content.json> [--commit]');
  process.exit(1);
}

const KINDS = ['terms', 'privacy', 'refund', 'other'];

function readContent(p) {
  // A file saved on Windows may start with a byte-order mark; JSON refuses it.
  const c = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8').replace(/^﻿/, ''));
  const errors = [];
  if (!c.slug) errors.push('slug is required.');
  if (c.description !== undefined && (typeof c.description !== 'string' || c.description.length > 5000)) errors.push('description must be text of at most 5000 characters.');
  if (c.highlights !== undefined) {
    if (!Array.isArray(c.highlights) || c.highlights.length > 12) errors.push('highlights: at most 12.');
    for (const h of c.highlights || []) if (typeof h !== 'string' || !h.trim() || h.trim().length > 120) errors.push(`highlight too long or empty: "${h}"`);
  }
  for (const p of c.policies || []) {
    if (!KINDS.includes(p.kind)) errors.push(`policy kind must be one of ${KINDS.join(', ')}: ${p.kind}`);
    if (!p.title || p.title.length > 120) errors.push(`policy title missing or over 120 characters: ${p.title}`);
    if (!p.body || p.body.length > 20000) errors.push(`policy body missing or too long: ${p.title}`);
  }
  for (const s of c.schedule || []) {
    if (!s.title || s.title.length > 160) errors.push(`schedule title missing or over 160 characters: ${s.title}`);
    if (s.description && s.description.length > 2000) errors.push(`schedule description too long: ${s.title}`);
    if (s.time !== undefined && s.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) errors.push(`schedule time must be HH:MM: ${s.time}`);
  }
  for (const k of Object.keys(c.venue || {})) if (!VENUE_FIELDS[k]) errors.push(`unknown venue field: ${k}`);
  if (errors.length) {
    console.error(`The content file is not valid:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  return c;
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

const indent = (text) => String(text || '— empty —').split('\n').map((l) => `      | ${l}`).join('\n');

async function main() {
  const content = readContent(file);
  const db = await connect();
  try {
    const { rows: [event] } = await db.query(
      `SELECT id, slug, title, status, description, highlights, timezone,
              to_char(starts_at AT TIME ZONE timezone, 'YYYY-MM-DD') AS local_day,
              venue_name, venue_address, venue_address_line2, venue_region, venue_postal_code, venue_directions, city
         FROM events WHERE slug = $1`, [content.slug],
    );
    if (!event) throw new Error(`No event with the slug "${content.slug}".`);
    const { rows: policies } = await db.query(
      'SELECT id, kind, title, body, show_at_checkout, sort_order FROM event_policies WHERE event_id = $1 ORDER BY sort_order', [event.id],
    );

    const { rows: schedule } = await db.query(
      'SELECT title FROM event_schedule WHERE event_id = $1 ORDER BY sort_order', [event.id],
    );
    // The venue fields that are empty now, and only those.
    const venueFill = Object.entries(content.venue || {})
      .filter(([k, v]) => v && !String(event[VENUE_FIELDS[k]] || '').trim())
      .map(([k, v]) => [VENUE_FIELDS[k], String(v).trim()]);
    const venueKept = Object.entries(content.venue || {}).filter(([k]) => String(event[VENUE_FIELDS[k]] || '').trim());
    const writeSchedule = Array.isArray(content.schedule) && content.schedule.length > 0
      && (schedule.length === 0 || replaceSchedule);

    console.log(`\n${commit ? 'WRITING' : 'PREVIEW (nothing is changed — add --commit to write)'}: ${event.title} (${event.slug}) · ${event.status}\n`);
    if (content.venue) {
      console.log(`  Venue: ${event.venue_name || '—'}`);
      for (const [col, v] of venueFill) console.log(`      fill  ${col}: ${v}`);
      for (const [k] of venueKept) console.log(`      keep  ${VENUE_FIELDS[k]}: ${event[VENUE_FIELDS[k]]}`);
      console.log('');
    }
    if (content.description !== undefined) {
      console.log('  Description — now:');
      console.log(indent(event.description));
      console.log('  Description — will be:');
      console.log(indent(content.description));
    }
    if (content.highlights !== undefined) {
      console.log(`\n  Highlights — now: ${(event.highlights || []).length ? '' : '— none —'}`);
      for (const h of event.highlights || []) console.log(`      • ${h}`);
      console.log('  Highlights — will be:');
      for (const h of content.highlights) console.log(`      • ${h.trim()}`);
    }
    const plan = (content.policies || []).map((p) => ({
      ...p,
      existing: policies.find((x) => x.kind === p.kind && x.title.trim().toLowerCase() === p.title.trim().toLowerCase()),
    }));
    if (plan.length) {
      console.log('\n  Policies:');
      for (const p of plan) console.log(`      ${p.existing ? 'replace' : 'add    '} [${p.kind}] ${p.title}${p.showAtCheckout ? ' (shown at checkout)' : ''}`);
      const kept = policies.filter((x) => !plan.some((p) => p.existing?.id === x.id));
      for (const k of kept) console.log(`      keep    [${k.kind}] ${k.title}`);
    }
    if (content.schedule) {
      console.log(`\n  Schedule (${event.timezone}, ${event.local_day}):`);
      if (!writeSchedule) console.log(`      kept as it is — the event already has ${schedule.length} item(s). Add --replace-schedule to replace them.`);
      else for (const s of content.schedule) console.log(`      ${s.time ? `${s.time}${s.day ? ' (+1 day)' : ''}` : '  —  '}  ${s.title}${s.description ? ` — ${s.description}` : ''}`);
    }

    if (!commit) {
      console.log('\nNothing was changed. Run again with --commit to write it.\n');
      return;
    }

    await db.query('BEGIN');
    const sets = [];
    const values = [];
    if (content.description !== undefined) { values.push(content.description.trim()); sets.push(`description = $${values.length}`); }
    if (content.highlights !== undefined) { values.push(content.highlights.map((h) => h.trim())); sets.push(`highlights = $${values.length}`); }
    for (const [col, v] of venueFill) { values.push(v); sets.push(`${col} = $${values.length}`); }
    if (sets.length) {
      values.push(event.id);
      await db.query(`UPDATE events SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
    }
    let order = policies.reduce((m, p) => Math.max(m, p.sort_order), -1);
    for (const p of plan) {
      if (p.existing) {
        await db.query('UPDATE event_policies SET title = $1, body = $2, show_at_checkout = $3 WHERE id = $4',
          [p.title.trim(), p.body.trim(), p.showAtCheckout === true, p.existing.id]);
      } else {
        order += 1;
        await db.query(
          'INSERT INTO event_policies (event_id, kind, title, body, show_at_checkout, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
          [event.id, p.kind, p.title.trim(), p.body.trim(), p.showAtCheckout === true, order],
        );
      }
    }
    if (writeSchedule) {
      await db.query('DELETE FROM event_schedule WHERE event_id = $1', [event.id]);
      for (const [i, s] of content.schedule.entries()) {
        // Wall-clock time on the event's own day, in the event's own zone.
        await db.query(
          `INSERT INTO event_schedule (event_id, starts_at, title, description, location, sort_order)
           VALUES ($1, CASE WHEN $2::text IS NULL THEN NULL
                            ELSE ((($3::date + $4::int) + $2::time) AT TIME ZONE $5) END, $6, $7, $8, $9)`,
          [event.id, s.time || null, event.local_day, Number(s.day) || 0, event.timezone, s.title.trim(), s.description?.trim() || null, s.location?.trim() || null, i],
        );
      }
    }
    await db.query('COMMIT');
    console.log('\nWritten.');

    // The event page is cached; drop it so the new words show now.
    try {
      const ok = await require('../services/revalidateService').revalidate([`event:${event.slug}`, 'events:published']);
      console.log(ok ? 'The event page was refreshed.' : 'The page cache could not be refreshed from here — it updates on its own within a few minutes.');
    } catch {
      console.log('The page cache could not be refreshed from here — it updates on its own within a few minutes.');
    }
    console.log(`Check it: https://eventsli.com/e/${event.slug}\n`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
