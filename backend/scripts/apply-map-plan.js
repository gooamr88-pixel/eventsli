#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REPLACE AN EVENT'S SEATING MAP WITH A PLAN (2026-11-24: "change the current
 * map with the one I uploaded"). The plan is a JSON file — scripts/maps/<slug>.json
 * — with every table's number, shape, seat count, colour group and position
 * (in pixels of the reference picture it was read from).
 *
 *   node scripts/apply-map-plan.js scripts/maps/adel-ogla-houston.json              # preview
 *   node scripts/apply-map-plan.js scripts/maps/adel-ogla-houston.json --commit     # replace the map
 *   … --password <word>   the password for a private table that has none yet
 *
 * PREVIEW BY DEFAULT: what is kept, moved, added and removed, the ticket type
 * of every colour group, and anything that stops it. Changes nothing.
 *
 * KEEPS WHAT IS ALREADY SOLD. A table whose number is on the current map
 * keeps its identity — its seats, its ticket type, its price, its private
 * password — and only moves, resizes and changes colour; holds and tickets on
 * its seats stay where they are. Saved through `save_venue_map`, the editor's
 * own one-transaction save: a table with sold or held seats cannot be removed
 * or shrunk under them, and if anything is refused, nothing changes.
 *
 * A NEW table takes the ticket type its colour group names (by name: "vip",
 * "gold", "silver"); a group with none it can find is reported, and the save
 * refuses to put unsellable tables on the map.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--password');
const commit = args.includes('--commit');
const pwAt = args.indexOf('--password');
const password = pwAt >= 0 ? args[pwAt + 1] : null;
if (!file) {
  console.error('Usage: node scripts/apply-map-plan.js <plan.json> [--commit] [--password <word>]');
  process.exit(1);
}

const norm = (label) => String(label || '').trim().toLowerCase().replace(/^table\s+/, '');
const round3 = (n) => Math.round(n * 1000) / 1000;

async function main() {
  const plan = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^﻿/, ''));
  const { supabase } = require('../config/supabase');
  const venue = require('../services/venueService');

  const { data: event, error } = await supabase
    .from('events').select('id, slug, title, status, admission_type').eq('slug', plan.slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) throw new Error(`No event with the slug "${plan.slug}".`);

  const [current, { data: tiers }] = await Promise.all([
    venue.getMapForOrganizer(event.id),
    supabase.from('ticket_tiers').select('id, name, price_cents').eq('event_id', event.id).order('sort_order'),
  ]);
  const existing = new Map((current?.tables || []).map((t) => [norm(t.label), t]));
  const tierName = new Map((tiers || []).map((t) => [t.id, t.name]));

  // A colour group's ticket type: the first whose name contains one of its
  // words ("vip" never matches "VVIP": whole words).
  const tierForGroup = (group) => {
    for (const word of group.tiers || []) {
      const re = new RegExp(`(^|[^a-z])${word.toLowerCase()}([^a-z]|$)`, 'i');
      const t = (tiers || []).find((x) => re.test(x.name));
      if (t) return t;
    }
    return null;
  };

  const sx = (px) => round3((px / plan.reference.width) * 100);
  const sy = (py) => round3((py / plan.reference.height) * 100);
  const problems = [];
  const rows = [];
  const styles = {};
  const tables = plan.tables.map((p) => {
    const group = plan.groups[p.group];
    if (!group) throw new Error(`Table ${p.label}: no colour group "${p.group}".`);
    const cur = existing.get(norm(p.label));
    const label = cur ? cur.label : p.label;
    const tier = cur?.tierId ? { id: cur.tierId, name: tierName.get(cur.tierId) } : tierForGroup(group);
    const isPrivate = p.private ?? cur?.isPrivate ?? false;
    const needsPassword = isPrivate && !cur?.hasPassword;
    if (needsPassword && !password) problems.push(`Table ${label} is private and has no password yet — add --password <word>.`);
    if (!tier && !(cur?.priceCents > 0)) problems.push(`Table ${label} (${p.group}) has no ticket type: none of [${(group.tiers || []).join(', ') || 'nothing'}] matches a ticket type on this event.`);
    const sold = (cur?.seats || []).filter((s) => s.status === 'sold' || s.status === 'held').length;
    rows.push({ label, group: p.group, kept: Boolean(cur), tier: tier?.name || (cur?.priceCents ? 'table price' : '—'), isPrivate, sold, seats: p.seats, was: cur?.seatCount });
    styles[norm(label)] = {
      fill: group.fill,
      labelColor: group.labelColor,
      ...(group.scale ? { scale: group.scale } : {}),
      ...(p.shape === 'rect' && group.sides ? { sides: group.sides } : {}),
    };
    return {
      ...(cur ? { id: cur.id } : {}),
      label,
      seatCount: p.seats,
      shape: p.shape,
      position: { x: sx(p.x), y: sy(p.y), rotation: 0 },
      tierId: tier?.id || null,
      priceCents: cur ? cur.priceCents : null,
      seatPriceCents: cur ? cur.seatPriceCents : null,
      categoryId: cur ? cur.categoryId : null,
      isPrivate,
      ...(needsPassword && password ? { password } : {}),
    };
  });

  const planned = new Set(plan.tables.map((p) => norm(p.label)));
  const removed = (current?.tables || []).filter((t) => !planned.has(norm(t.label)));
  for (const t of removed) {
    const sold = t.seats.filter((s) => s.status === 'sold' || s.status === 'held').length;
    if (sold) problems.push(`Table ${t.label} is not in the plan but has ${sold} sold or held seat(s) — it cannot be removed.`);
  }

  const layout = {
    ...(current?.layout && typeof current.layout === 'object' ? current.layout : {}),
    world: plan.world,
    tableStyles: styles,
    zones: plan.stage ? [{
      id: 'stage-main', kind: 'stage', label: plan.stage.label || 'Stage',
      x: sx(plan.stage.x), y: sy(plan.stage.y), w: plan.stage.w, h: plan.stage.h, rotation: 0,
    }] : [],
  };

  // ── The preview ──
  console.log(`\n${commit ? 'REPLACING THE MAP' : 'PREVIEW (nothing is changed — add --commit to replace the map)'}: ${event.title} (${event.slug})`);
  console.log(`  now: ${current ? `${current.tables.length} tables, ${current.tables.reduce((n, t) => n + t.seatCount, 0)} seats` : 'no map'}`);
  console.log(`  plan: ${tables.length} tables, ${tables.reduce((n, t) => n + t.seatCount, 0)} seats, room ${plan.world.width}×${plan.world.height}, stage at the top\n`);
  const byGroup = {};
  for (const r of rows) (byGroup[r.group] ||= []).push(r);
  for (const [g, list] of Object.entries(byGroup)) {
    const tierNames = [...new Set(list.map((r) => r.tier))].join(' / ');
    console.log(`  ${g.padEnd(5)} ${plan.groups[g].fill}  tables ${list.map((r) => r.label).join(', ')}  → ${tierNames}`);
  }
  console.log('');
  const kept = rows.filter((r) => r.kept);
  console.log(`  kept and moved: ${kept.length}  · new: ${rows.length - kept.length}  · removed: ${removed.length}${removed.length ? ` (${removed.map((t) => t.label).join(', ')})` : ''}`);
  const resized = rows.filter((r) => r.kept && r.was !== r.seats);
  if (resized.length) console.log(`  seat count changes: ${resized.map((r) => `${r.label}: ${r.was}→${r.seats}`).join(', ')}`);
  const withSales = rows.filter((r) => r.sold);
  if (withSales.length) console.log(`  tables with sold/held seats (kept, untouched seats): ${withSales.map((r) => `${r.label} (${r.sold})`).join(', ')}`);
  console.log(`  private: ${rows.filter((r) => r.isPrivate).map((r) => r.label).join(', ') || 'none'}`);
  if (problems.length) {
    console.log('\n  Stops the save:');
    for (const p of problems) console.log(`   ✖ ${p}`);
  }

  if (!commit) {
    console.log(`\nNothing was changed.${problems.length ? ' Fix the above first.' : ' Run again with --commit to replace the map.'}\n`);
    return;
  }
  if (problems.length) throw new Error('Not saved — fix the problems above first.');

  const result = await venue.saveMap(event.id, { layout, tables, expectedVersion: current?.version ?? null });
  console.log(`\nSaved: ${result.tables?.length ?? tables.length} tables · map version ${result.version}.`);
  try {
    await require('../services/revalidateService').revalidate([`event:${event.slug}`]);
  } catch { /* the seat map itself is never cached */ }
  console.log(`Check it: https://eventsli.com/e/${event.slug}/seats  ·  editor: /organizer/events/${event.id}/map\n`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(`\n${err.message}\n`); process.exit(1); });
