#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Door-opening load on the LOCAL stack: many doors scanning at once.
 *
 *   node scripts/load-gate.js run [--rate 50] [--seconds 60] [--devices 20]
 *                                 [--tickets 2000] [--api http://127.0.0.1:5000/api/v1]
 *   node scripts/load-gate.js cleanup
 *
 * It builds its own event (real purchases through hold_seats / fulfill_checkout,
 * N real scan devices), then for --seconds fires scans at --rate per second,
 * spread over the devices the way a doors-open rush is:
 *
 *   ~85 %  a fresh ticket          → admitted
 *   ~10 %  a ticket already in     → duplicate (somebody scanning twice)
 *    ~5 %  a forged code           → invalid
 *   + every device uploads an offline batch of 20 every 10 s (/scan/sync)
 *   + every device refreshes its offline list every 15 s (/scan/manifest)
 *
 * Open loop: requests go out on schedule whether or not earlier ones have
 * answered, so a slow server shows up as latency, not as a politely lower rate.
 * Afterwards it checks the database: every admitted ticket admitted ONCE, and
 * no scan id recorded twice, under load.
 *
 * Targets (docs plan): p95 under 300 ms at 50 scans/s on the server. Numbers
 * from a laptop are indicative; the real run is against staging.
 *
 * LOCAL ONLY. It refuses a database or an API that is not on this machine or
 * its LAN, and never touches eventsli.com.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');
const crypto = require('node:crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/;
const dbHost = (() => { try { return new URL(process.env.SUPABASE_URL || '').hostname; } catch { return ''; } })();
if (!LOCAL.test(dbHost) || process.env.NODE_ENV === 'production') {
  console.error(`Refusing: SUPABASE_URL (${dbHost || 'unset'}) is not a local database.`);
  process.exit(1);
}

const { supabase } = require('../config/supabase');
const pricing = require('../services/pricingService');
const ticketSvc = require('../services/ticketService');
const scanSvc = require('../services/scanService');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const MARK = { org: 'Eventsli Load Test (local)', slug: 'load-gate-', stripe: 'acct_load_local_gate' };
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
const iso = (ms) => new Date(Date.now() + ms).toISOString();

// ── Setup and cleanup ───────────────────────────────────────────────────────
async function cleanup({ quiet = false } = {}) {
  const orgs = must(await supabase.from('organizers').select('id').eq('display_name', MARK.org), 'orgs');
  for (const org of orgs) {
    const evs = must(await supabase.from('events').select('id').eq('organizer_id', org.id), 'events');
    for (const { id } of evs) {
      await supabase.from('scans').delete().eq('event_id', id);
      await supabase.from('scan_devices').delete().eq('event_id', id);
      const orders = must(await supabase.from('orders').select('id').eq('event_id', id), 'orders');
      for (let i = 0; i < orders.length; i += 100) {
        const ids = orders.slice(i, i + 100).map((o) => o.id);
        await supabase.from('tickets').delete().in('order_id', ids);
        await supabase.from('order_items').delete().in('order_id', ids);
      }
      await supabase.from('orders').delete().eq('event_id', id);
      const rs = must(await supabase.from('reservations').select('id').eq('event_id', id), 'reservations');
      for (let i = 0; i < rs.length; i += 100) {
        await supabase.from('reservation_items').delete().in('reservation_id', rs.slice(i, i + 100).map((r) => r.id));
      }
      await supabase.from('reservations').delete().eq('event_id', id);
      const maps = must(await supabase.from('venue_maps').select('id').eq('event_id', id), 'maps');
      for (const m of maps) await supabase.from('seats').delete().eq('venue_map_id', m.id);
      await supabase.from('venue_maps').delete().eq('event_id', id);
      await supabase.from('ticket_tiers').delete().eq('event_id', id);
      const del = await supabase.from('events').delete().eq('id', id);
      if (del.error) await supabase.from('events').update({ status: 'archived', title: '[removed load test]' }).eq('id', id);
    }
    const del = await supabase.from('organizers').delete().eq('id', org.id);
    if (del.error) await supabase.from('organizers').update({ display_name: `${MARK.org} [removed]`, stripe_account_id: null }).eq('id', org.id);
  }
  if (!quiet) console.log(`Removed ${orgs.length} load-test organizer(s) and their events.`);
}

async function setup({ tickets, devices }) {
  await cleanup({ quiet: true });
  // A throwaway owner per run: an account owns one organizer, and a parked
  // organizer from an earlier run (its event kept by the ledger) keeps its own.
  const owner = must(await supabase.from('profiles').insert({
    email: `load-owner-${Date.now()}@load.eventsli.invalid`, full_name: 'Load Test Owner', role: 'organizer',
  }).select('id').single(), 'owner');
  const org = must(await supabase.from('organizers').insert({
    stripe_account_id: MARK.stripe, owner_user_id: owner.id, display_name: MARK.org, country: 'CA',
  }).select('id').single(), 'organizer');
  const terms = must(await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single(), 'terms');
  const ev = must(await supabase.from('events').insert({
    organizer_id: org.id, slug: `${MARK.slug}${Date.now().toString(36)}`, title: 'Load test (local)',
    country: 'CA', timezone: 'America/Toronto', currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_only', venue_name: 'Load Hall', city: 'Toronto', starts_at: iso(48 * 3600e3), ends_at: iso(54 * 3600e3),
  }).select('id').single(), 'event');
  const map = must(await supabase.from('venue_maps').insert({ event_id: ev.id, layout_json: {} }).select('id').single(), 'map');
  const tier = must(await supabase.from('ticket_tiers').insert({ event_id: ev.id, name: 'General Admission', price_cents: 2500 }).select('id').single(), 'tier');
  const seatRows = Array.from({ length: tickets }, (_, i) => ({
    venue_map_id: map.id, tier_id: tier.id, section_key: 'Floor', row_label: `R${Math.floor(i / 50)}`, seat_number: String((i % 50) + 1),
  }));
  const seats = [];
  for (let i = 0; i < seatRows.length; i += 500) seats.push(...must(await supabase.from('seats').insert(seatRows.slice(i, i + 500)).select('id'), 'seats'));

  // Orders of 10 (the purchase limit), six at a time.
  process.stdout.write(`Selling ${tickets} tickets`);
  const batches = [];
  for (let i = 0; i < seats.length; i += 10) batches.push(seats.slice(i, i + 10));
  const codes = [];
  const buyOne = async (batch, n) => {
    const held = await supabase.rpc('hold_seats', { p_event_id: ev.id, p_user_id: null, p_seat_ids: batch.map((s) => s.id), p_ttl_minutes: 35 });
    if (held.error || !held.data?.reservation_id) throw new Error(`hold: ${held.error?.message || JSON.stringify(held.data)}`);
    const q = await pricing.quoteReservation(held.data.reservation_id);
    const filled = await supabase.rpc('fulfill_checkout', {
      p_reservation_id: held.data.reservation_id, p_channel: 'stripe', p_breakdown: q.breakdown,
      p_buyer: { user_id: null, name: `Load Buyer ${n}`, email: `load-${n}@load.eventsli.invalid` },
      p_stripe: { account_id: MARK.stripe, session_id: `cs_load_${crypto.randomUUID()}` },
    });
    if (filled.error || !filled.data?.order_id) throw new Error(`fulfil: ${filled.error?.message || JSON.stringify(filled.data)}`);
    codes.push(...(await ticketSvc.forOrder(filled.data.order_id)).map((t) => ({ id: t.id, qr: t.qr })));
    if (n % 20 === 0) process.stdout.write('.');
  };
  for (let i = 0; i < batches.length; i += 6) {
    await Promise.all(batches.slice(i, i + 6).map((b, k) => buyOne(b, i + k)));
  }
  console.log(' done');
  must(await supabase.from('events').update({ starts_at: iso(-3600e3), ends_at: iso(5 * 3600e3) }).eq('id', ev.id), 'doors open');

  const tokens = [];
  for (let i = 0; i < devices; i += 1) {
    const d = await scanSvc.registerDevice({ eventId: ev.id, label: `Load door ${i + 1}`, pin: '424242' });
    tokens.push((await scanSvc.authenticateDevice({ deviceId: d.id, pin: '424242' })).token);
  }
  return { eventId: ev.id, codes, tokens };
}

// ── The run ─────────────────────────────────────────────────────────────────
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function run() {
  const api = String(arg('api', 'http://127.0.0.1:5000/api/v1')).replace(/\/+$/, '');
  const apiHost = new URL(api).hostname;
  if (!LOCAL.test(apiHost)) {
    console.error(`Refusing: ${apiHost} is not this machine or its LAN. Point --api at the local API.`);
    process.exit(1);
  }
  const rate = Number(arg('rate', 50));
  const seconds = Number(arg('seconds', 60));
  const devices = Number(arg('devices', 20));
  const tickets = Number(arg('tickets', 2000));
  if (rate * seconds * 0.9 > tickets) {
    console.error(`Not enough tickets: ${rate}/s for ${seconds}s needs about ${Math.ceil(rate * seconds * 0.9)}. Raise --tickets.`);
    process.exit(1);
  }

  const { eventId, codes, tokens } = await setup({ tickets, devices });
  const stats = { scan: [], sync: [], manifest: [] };
  const results = {};
  const errors = {};
  let inflight = 0;
  let peakInflight = 0;
  const admitted = new Set();
  let next = 0;

  async function call(kind, method, p, token, body) {
    const started = performance.now();
    inflight += 1;
    peakInflight = Math.max(peakInflight, inflight);
    try {
      const res = await fetch(`${api}${p}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-eventsli-client': 'load-gate/1' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await res.json().catch(() => null);
      stats[kind].push(performance.now() - started);
      if (!res.ok && res.status !== 403) errors[`${kind} ${res.status}`] = (errors[`${kind} ${res.status}`] || 0) + 1;
      return json?.data;
    } catch (err) {
      errors[`${kind} ${err.cause?.code || err.message}`] = (errors[`${kind} ${err.cause?.code || err.message}`] || 0) + 1;
      return null;
    } finally {
      inflight -= 1;
    }
  }

  function oneScan(i) {
    const token = tokens[i % tokens.length];
    const roll = Math.random();
    let qr;
    if (roll < 0.05) qr = `${codes[0].qr.slice(0, -6)}AAAAAA`;
    else if (roll < 0.15 && admitted.size) qr = codes[[...admitted][Math.floor(Math.random() * admitted.size)]].qr;
    else {
      const idx = next;
      next += 1;
      admitted.add(idx);
      qr = codes[idx].qr;
    }
    return call('scan', 'POST', '/scan/verify', token, { qr, clientScanId: crypto.randomUUID(), occurredAt: new Date().toISOString() })
      .then((d) => { if (d?.result) results[d.result] = (results[d.result] || 0) + 1; });
  }

  // Offline batches reuse codes already admitted online, plus a few new ones:
  // replays and duplicates, the uploads a reconnecting door sends.
  function oneSync(token) {
    const scans = Array.from({ length: 20 }, () => {
      const pool = [...admitted];
      const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 0;
      return { qr: codes[idx].qr, clientScanId: crypto.randomUUID(), occurredAt: new Date().toISOString(), method: 'offline' };
    });
    return call('sync', 'POST', '/scan/sync', token, { scans });
  }

  async function oneManifest(token) {
    let cursor = null;
    for (let i = 0; i < 10; i += 1) {
      const d = await call('manifest', 'GET', `/scan/manifest${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, token);
      if (!d || d.done) return;
      cursor = d.cursor;
    }
  }

  console.log(`Running: ${rate} scans/s for ${seconds}s over ${devices} doors, against ${api}`);
  const pending = [];
  const t0 = performance.now();
  const total = rate * seconds;
  const timers = [
    setInterval(() => tokens.forEach((t, i) => setTimeout(() => pending.push(oneSync(t)), i * 37)), 10_000),
    setInterval(() => tokens.forEach((t, i) => setTimeout(() => pending.push(oneManifest(t)), i * 53)), 15_000),
  ];
  for (let i = 0; i < total; i += 1) {
    const due = t0 + (i * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    pending.push(oneScan(i));
  }
  timers.forEach(clearInterval);
  await Promise.all(pending);
  const elapsed = (performance.now() - t0) / 1000;

  const line = (kind) => {
    const s = [...stats[kind]].sort((a, b) => a - b);
    return `${kind.padEnd(9)} n=${String(s.length).padEnd(6)} p50 ${pct(s, 50).toFixed(0).padStart(4)} ms  p95 ${pct(s, 95).toFixed(0).padStart(4)} ms  p99 ${pct(s, 99).toFixed(0).padStart(4)} ms  max ${(s.at(-1) || 0).toFixed(0)} ms`;
  };
  console.log(`\nSent ${total} scans in ${elapsed.toFixed(1)} s (${(total / elapsed).toFixed(1)}/s achieved), peak ${peakInflight} requests in flight.`);
  console.log(line('scan'));
  console.log(line('sync'));
  console.log(line('manifest'));
  console.log(`Scan answers: ${JSON.stringify(results)}`);
  console.log(`Errors: ${Object.keys(errors).length ? JSON.stringify(errors) : 'none'}`);

  // Exactly once, from the database.
  const scans = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await supabase.from('scans').select('ticket_id, result, client_scan_id').eq('event_id', eventId).range(from, from + 999), 'scans');
    scans.push(...page);
    if (page.length < 1000) break;
  }
  const perTicket = new Map();
  for (const s of scans) if (s.result === 'admitted') perTicket.set(s.ticket_id, (perTicket.get(s.ticket_id) || 0) + 1);
  const twice = [...perTicket.values()].filter((n) => n > 1).length;
  const ids = scans.map((s) => s.client_scan_id).filter(Boolean);
  const dupIds = ids.length - new Set(ids).size;
  const { count: scannedCount, error: countError } = await supabase
    .from('tickets').select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('status', 'scanned');
  if (countError) throw new Error(countError.message);
  const ok = twice === 0 && dupIds === 0 && scannedCount === perTicket.size;
  console.log(`Database: ${perTicket.size} tickets admitted, ${scannedCount} marked scanned, ${twice} admitted twice, ${dupIds} scan ids recorded twice.`);
  console.log(ok ? 'EXACTLY-ONCE UNDER LOAD: OK' : 'EXACTLY-ONCE UNDER LOAD: VIOLATION');

  const p95 = pct([...stats.scan].sort((a, b) => a - b), 95);
  console.log(p95 < 300 ? `Target met: scan p95 ${p95.toFixed(0)} ms < 300 ms.` : `Target MISSED: scan p95 ${p95.toFixed(0)} ms ≥ 300 ms.`);
  if (!arg('keep', null) && !process.argv.includes('--keep')) await cleanup({ quiet: true });
  if (!ok || p95 >= 300 || Object.keys(errors).length) process.exitCode = 1;
}

const commands = { run, cleanup: () => cleanup() };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.log('Usage: node scripts/load-gate.js run [--rate 50] [--seconds 60] [--devices 20] [--tickets 2000] [--api URL] [--keep] | cleanup');
  process.exit(1);
}
commands[cmd]().catch((err) => {
  console.error(err);
  process.exit(1);
});
