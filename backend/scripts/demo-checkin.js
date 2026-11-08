#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A local demo for testing the Eventsli Check-in app on a real phone.
 *
 *   node scripts/demo-checkin.js seed   [--site http://<LAN-IP>:3000]
 *   node scripts/demo-checkin.js status
 *   node scripts/demo-checkin.js rearm
 *   node scripts/demo-checkin.js smoke  [--api  http://<LAN-IP>:5000/api/v1] [--keep]
 *   node scripts/demo-checkin.js door-scan "<ticket label>"   (a second door)
 *   node scripts/demo-checkin.js reset
 *
 * LOCAL ONLY. It refuses to run unless SUPABASE_URL points at a local stack
 * (127.0.0.1 / localhost) and NODE_ENV is not production. Everything it makes
 * is marked — emails @demo.eventsli.test, organizer "Eventsli Demo (local)",
 * event slugs demo-checkin-* — and `reset` removes exactly that.
 *
 * `seed` writes .demo/checkin-demo.html at the repo root: every test ticket as
 * a scannable QR code with what the phone should say, the sign-in accounts,
 * and the pairing code for the shared door device. Open it on this computer's
 * screen and scan from the phone.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ── The guard: before anything touches a database ───────────────────────────
{
  const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', 'host.docker.internal']);
  let host = '';
  try { host = new URL(process.env.SUPABASE_URL || '').hostname; } catch { /* reported below */ }
  if (!LOCAL.has(host)) {
    console.error(`Refusing to run: SUPABASE_URL points at "${host || 'nothing'}", not a local Supabase stack.`);
    process.exit(2);
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run with NODE_ENV=production.');
    process.exit(2);
  }
}

const QRCode = require('qrcode');
const { supabase } = require('../config/supabase');
const { hashPassword } = require('../utils/crypto');
const pricing = require('../services/pricingService');
const ticketSvc = require('../services/ticketService');
const scanSvc = require('../services/scanService');

const MARK = {
  domain: 'demo.eventsli.test',
  org: 'Eventsli Demo (local)',
  slug: 'demo-checkin-',
  stripe: 'acct_demo_local_checkin',
};
const PASSWORD = 'Demo-Checkin-2026';
const PIN = '482193';
const OUT_DIR = path.join(__dirname, '..', '..', '.demo');
const MANIFEST = path.join(OUT_DIR, 'checkin-demo.json');
const SHEET = path.join(OUT_DIR, 'checkin-demo.html');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const H = 3600e3;

// ═══ reset ═══════════════════════════════════════════════════════════════════
async function reset({ quiet = false } = {}) {
  const { data: orgs } = await supabase.from('organizers').select('id').eq('display_name', MARK.org);
  const orgIds = (orgs || []).map((o) => o.id);
  const { data: evs } = orgIds.length
    ? await supabase.from('events').select('id').in('organizer_id', orgIds)
    : { data: [] };
  const eventIds = (evs || []).map((e) => e.id);

  for (const id of eventIds) {
    await supabase.from('scans').delete().eq('event_id', id);
    await supabase.from('scan_devices').delete().eq('event_id', id);
    await supabase.from('event_staff').delete().eq('event_id', id);
    await supabase.from('event_gate_settings').delete().eq('event_id', id);
    await supabase.from('scanner_access').delete().eq('event_id', id);
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', id);
    for (const o of orders || []) {
      await supabase.from('tickets').delete().eq('order_id', o.id);
      await supabase.from('order_items').delete().eq('order_id', o.id);
    }
    await supabase.from('orders').delete().eq('event_id', id);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', id);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', id);
    const { data: maps } = await supabase.from('venue_maps').select('id').eq('event_id', id);
    for (const m of maps || []) await supabase.from('seats').delete().eq('venue_map_id', m.id);
    await supabase.from('venue_maps').delete().eq('event_id', id);
    await supabase.from('ticket_tiers').delete().eq('event_id', id);
    // Ledger rows from fulfilment are append-only by trigger; the demo's go
    // with their event only where the schema allows. Leftovers are harmless
    // local rows under a deleted demo event id.
    const del = await supabase.from('events').delete().eq('id', id);
    if (del.error) {
      // An append-only ledger row still points at it: park it, archived and
      // renamed, rather than leave a live demo event behind.
      await supabase.from('events').update({ status: 'archived', title: '[removed demo]' }).eq('id', id);
    }
  }
  for (const id of orgIds) {
    const del = await supabase.from('organizers').delete().eq('id', id);
    if (del.error) await supabase.from('organizers').update({ display_name: `${MARK.org} [removed]`, stripe_account_id: null }).eq('id', id);
  }

  const { data: people } = await supabase.from('profiles').select('id').like('email', `%@${MARK.domain}`);
  for (const p of people || []) {
    await supabase.from('app_auth_codes').delete().eq('user_id', p.id);
    await supabase.from('sessions').delete().eq('user_id', p.id);
    await supabase.from('terms_acceptances').delete().eq('user_id', p.id);
    await supabase.from('event_staff').delete().eq('user_id', p.id);
    await supabase.from('profiles').delete().eq('id', p.id);
  }
  if (!quiet) console.log(`Removed ${eventIds.length} demo event(s), ${orgIds.length} organizer(s), ${(people || []).length} account(s).`);
}

// ═══ seed ════════════════════════════════════════════════════════════════════
async function person(local, fullName, role = 'attendee') {
  const email = `${local}@${MARK.domain}`;
  const row = must(await supabase.from('profiles').insert({
    email, full_name: fullName, role,
    password_hash: await hashPassword(PASSWORD),
    email_verified_at: new Date().toISOString(),
  }).select('id').single(), `account ${email}`);
  return { id: row.id, email };
}

async function makeEvent(ctx, { key, title, city, venue, seats }) {
  const ev = must(await supabase.from('events').insert({
    organizer_id: ctx.orgId, slug: `${MARK.slug}${key}-${Date.now().toString(36)}`, title,
    country: 'CA', timezone: 'America/Toronto', currency: 'CAD', status: 'published',
    terms_accepted_id: ctx.termsId, purchase_mode: 'seat_only',
    venue_name: venue, venue_address: '100 Demo Street', city,
    // The website's own share image, served by the local frontend. The path
    // only satisfies the url-and-path-together check; no storage object exists.
    cover_url: ctx.site ? `${ctx.site}/og-default.png` : null,
    cover_path: ctx.site ? `demo-local/${key}.png` : null,
    // On sale and in the future while tickets are issued; moved afterwards.
    starts_at: iso(48 * H), ends_at: iso(54 * H),
  }).select('id').single(), `event ${title}`);

  const map = must(await supabase.from('venue_maps').insert({ event_id: ev.id, layout_json: {} }).select('id').single(), 'map');
  const tiers = {};
  for (const [name, price] of [['General Admission', 4500], ['VIP', 12000]]) {
    tiers[name] = must(await supabase.from('ticket_tiers').insert({ event_id: ev.id, name, price_cents: price }).select('id').single(), 'tier').id;
  }
  const rows = [];
  for (let i = 0; i < seats.ga; i += 1) {
    rows.push({ venue_map_id: map.id, tier_id: tiers['General Admission'], section_key: 'Floor', row_label: String.fromCharCode(65 + Math.floor(i / 10)), seat_number: String((i % 10) + 1) });
  }
  for (let i = 0; i < seats.vip; i += 1) {
    rows.push({ venue_map_id: map.id, tier_id: tiers.VIP, section_key: 'VIP', row_label: 'V', seat_number: String(i + 1) });
  }
  const seatRows = must(await supabase.from('seats').insert(rows).select('id, tier_id'), 'seats');
  return {
    id: ev.id, title,
    free: { ga: seatRows.filter((s) => s.tier_id === tiers['General Admission']).map((s) => s.id), vip: seatRows.filter((s) => s.tier_id === tiers.VIP).map((s) => s.id) },
  };
}

/** A real purchase through the same functions checkout uses. */
async function buy(ctx, event, name, { ga = 0, vip = 0 }) {
  const seatIds = [...event.free.ga.splice(0, ga), ...event.free.vip.splice(0, vip)];
  const held = await supabase.rpc('hold_seats', { p_event_id: event.id, p_user_id: null, p_seat_ids: seatIds, p_ttl_minutes: 35 });
  if (held.error || !held.data?.reservation_id) throw new Error(`hold for ${name}: ${held.error?.message || JSON.stringify(held.data)}`);
  const q = await pricing.quoteReservation(held.data.reservation_id);
  const email = `${name.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '.')}@${MARK.domain}`;
  const filled = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.data.reservation_id, p_channel: 'stripe', p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name, email },
    p_stripe: { account_id: MARK.stripe, session_id: `cs_demo_${crypto.randomUUID()}` },
  });
  if (filled.error || !filled.data?.order_id) throw new Error(`purchase for ${name}: ${filled.error?.message || JSON.stringify(filled.data)}`);
  return { orderId: filled.data.order_id, tickets: await ticketSvc.forOrder(filled.data.order_id) };
}

const seatLabel = (t) => (t.seat ? `${t.seat.section} ${t.seat.row}${t.seat.number}` : null);

async function seed() {
  const site = (arg('site') || '').replace(/\/+$/, '') || null;
  await reset({ quiet: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const owner = await person('organizer', 'Demo Organizer', 'organizer');
  const door = await person('door', 'Sara Door');
  const outsider = await person('outsider', 'No Events Person');

  const org = must(await supabase.from('organizers').insert({
    stripe_account_id: MARK.stripe, owner_user_id: owner.id, display_name: MARK.org, country: 'CA',
  }).select('id').single(), 'organizer');
  const terms = must(await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single(), 'terms');
  must(await supabase.from('terms_acceptances').insert({ user_id: owner.id, terms_id: terms.id }), 'terms acceptance');
  const ctx = { orgId: org.id, termsId: terms.id, site };

  const gala = await makeEvent(ctx, { key: 'gala', title: 'Annual Gala 2026 (Demo)', city: 'Toronto', venue: 'Demo Hall', seats: { ga: 30, vip: 10 } });
  const meetup = await makeEvent(ctx, { key: 'meetup', title: 'Tech Meetup (Demo)', city: 'Ottawa', venue: 'Demo Loft', seats: { ga: 6, vip: 0 } });
  const launch = await makeEvent(ctx, { key: 'launch', title: 'Product Launch (Demo)', city: 'Montreal', venue: 'Demo Studio', seats: { ga: 6, vip: 0 } });

  const tickets = [];
  const add = (group, label, expected, t, name, extra = {}) => tickets.push({
    group, label, expected, name, tier: t.tierName, seat: seatLabel(t), ticketId: t.id, qr: t.qr, ...extra,
  });

  // ── The gala: who is coming ──
  const john = await buy(ctx, gala, 'John Smith', { ga: 2 });
  const sara = await buy(ctx, gala, 'Sara Ahmed', { vip: 1 });
  const ahmed = await buy(ctx, gala, 'Ahmed Ali', { ga: 2 });
  const emily = await buy(ctx, gala, 'Emily Chen', { ga: 1 });
  const michael = await buy(ctx, gala, 'Michael Brown', { ga: 3 });
  const olivia = await buy(ctx, gala, 'Olivia Martin', { vip: 1 });
  const daniel = await buy(ctx, gala, 'Daniel Garcia', { ga: 2 });
  const priya = await buy(ctx, gala, 'Priya Patel', { vip: 1 });
  const lucas = await buy(ctx, gala, 'Lucas Tremblay', { ga: 2 });
  const chloe = await buy(ctx, gala, 'Chloé Roy', { ga: 1 });
  const noah = await buy(ctx, gala, 'Noah Wilson', { ga: 1 });
  const ava = await buy(ctx, gala, 'Ava Thompson', { ga: 1 });
  const mia = await buy(ctx, gala, 'Mia Johnson', { ga: 1 });

  const ok = 'Check-in Successful';
  add('normal', 'John Smith · ticket 1 of 2', ok, john.tickets[0], 'John Smith');
  add('normal', 'John Smith · ticket 2 of 2', ok, john.tickets[1], 'John Smith');
  add('normal', 'Sara Ahmed · VIP', ok, sara.tickets[0], 'Sara Ahmed');
  add('normal', 'Ahmed Ali · ticket 1 of 2', ok, ahmed.tickets[0], 'Ahmed Ali');
  add('normal', 'Ahmed Ali · ticket 2 of 2', ok, ahmed.tickets[1], 'Ahmed Ali');
  add('normal', 'Emily Chen', ok, emily.tickets[0], 'Emily Chen');
  add('normal', 'Olivia Martin · VIP', ok, olivia.tickets[0], 'Olivia Martin');
  add('normal', 'Daniel Garcia · ticket 1 of 2', ok, daniel.tickets[0], 'Daniel Garcia');
  add('spare', 'Daniel Garcia · ticket 2 of 2', ok, daniel.tickets[1], 'Daniel Garcia');
  add('spare', 'Lucas Tremblay · ticket 2 of 2', ok, lucas.tickets[1], 'Lucas Tremblay');
  add('spare', 'Chloé Roy', ok, chloe.tickets[0], 'Chloé Roy');
  michael.tickets.forEach((t, i) => add('offline', `Michael Brown · ticket ${i + 1} of 3`, 'Held for upload → admitted on reconnect', t, 'Michael Brown'));
  add('manual', 'Priya Patel · VIP (find by name, no QR)', 'Check in by hand → Check-in Successful', priya.tickets[0], 'Priya Patel', { qr: null });

  // Refunded: the void path a full refund takes.
  must(await supabase.from('tickets').update({ status: 'void' }).eq('id', noah.tickets[0].id), 'void');
  add('refuse', 'Noah Wilson · refunded', 'Cancelled ticket', noah.tickets[0], 'Noah Wilson');
  // An order no longer paid (cancelled after the sale).
  must(await supabase.from('orders').update({ status: 'cancelled' }).eq('id', ava.orderId), 'cancel order');
  add('refuse', 'Ava Thompson · order cancelled', 'Cancelled ticket (order cancelled or refunded)', ava.tickets[0], 'Ava Thompson');
  // Transferred: the seller keeps the old code; the recipient gets a new one.
  const oldQr = mia.tickets[0].qr;
  await ticketSvc.transfer({ ticketId: mia.tickets[0].id, tokenOrderId: mia.orderId, toEmail: `mia.friend@${MARK.domain}` });
  const received = await ticketSvc.receivedBy(`mia.friend@${MARK.domain}`);
  const newQr = received[0].tickets[0].qr;
  add('refuse', 'Mia Johnson · OLD code from before the transfer', 'Ticket was given away', { ...mia.tickets[0], qr: oldQr }, 'Mia Johnson');
  add('normal', 'Mia’s friend · NEW code after the transfer', `${ok} (no name shown)`, { ...mia.tickets[0], qr: newQr }, '(transferred)');
  // Forged: a real code with its signature broken.
  const forged = `${john.tickets[0].qr.slice(0, -8)}AAAAAAAA`;
  tickets.push({ group: 'refuse', label: 'Forged code (signature broken)', expected: 'Not an Eventsli ticket', name: '—', tier: null, seat: null, ticketId: null, qr: forged });

  // ── The other two events ──
  const grace = await buy(ctx, meetup, 'Grace Lee', { ga: 2 });
  add('refuse', 'Grace Lee · Tech Meetup ticket', 'Wrong event', grace.tickets[0], 'Grace Lee');
  const launchBuyers = await buy(ctx, launch, 'Henry Clark', { ga: 4 });

  // ── Doors open: the gala is on now ──
  must(await supabase.from('events').update({ starts_at: iso(-1 * H), ends_at: iso(5 * H) }).eq('id', gala.id), 'gala times');
  must(await supabase.from('events').update({ starts_at: iso(5 * 24 * H), ends_at: iso(5 * 24 * H + 3 * H) }).eq('id', meetup.id), 'meetup times');

  // The shared door tablet, and the door-team member.
  const device = await scanSvc.registerDevice({ eventId: gala.id, label: 'North Door (demo)', pin: PIN });
  must(await supabase.from('event_staff').insert({ event_id: gala.id, user_id: door.id, added_by: owner.id }), 'door team');

  // Already inside: Lucas was scanned at the North Door 25 minutes ago.
  const prescanId = `demo-prescan-${crypto.randomUUID()}`;
  const pre = await supabase.rpc('check_in_ticket_v2', {
    p_event_id: gala.id, p_ticket_id: lucas.tickets[0].id, p_qr_version: 0, p_device_id: device.id,
    p_client_scan_id: prescanId, p_occurred_at: iso(-25 * 60e3), p_method: 'scan', p_offline_admitted: false,
  });
  if (pre.error || pre.data?.result !== 'admitted') throw new Error(`pre-scan: ${pre.error?.message || JSON.stringify(pre.data)}`);
  add('refuse', 'Lucas Tremblay · already scanned', 'Already checked in (at the North Door)', lucas.tickets[0], 'Lucas Tremblay');

  // The finished event, three of four admitted, then closed.
  for (const t of launchBuyers.tickets.slice(0, 3)) {
    await supabase.rpc('check_in_ticket_v2', {
      p_event_id: launch.id, p_ticket_id: t.id, p_qr_version: 0, p_device_id: null,
      p_client_scan_id: null, p_occurred_at: null, p_method: 'scan', p_offline_admitted: false,
    });
  }
  must(await supabase.from('events').update({ status: 'completed', starts_at: iso(-3 * 24 * H), ends_at: iso(-3 * 24 * H + 3 * H) }).eq('id', launch.id), 'launch closed');

  const manifest = {
    createdAt: new Date().toISOString(),
    site,
    password: PASSWORD,
    accounts: { organizer: owner.email, door: door.email, outsider: outsider.email },
    device: { id: device.id, label: 'North Door (demo)', pin: PIN, pairing: `eventsli-checkin://pair?device=${device.id}` },
    events: { gala: gala.id, meetup: meetup.id, launch: launch.id },
    prescanId,
    tickets,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  await writeSheet(manifest);

  console.log('Demo ready (local database only).');
  console.log(`  Ticket sheet : ${SHEET}`);
  console.log(`  Organizer    : ${owner.email}   password ${PASSWORD}`);
  console.log(`  Door team    : ${door.email}         password ${PASSWORD}`);
  console.log(`  No events    : ${outsider.email}     password ${PASSWORD}`);
  console.log(`  Shared device: North Door (demo)  id ${device.id}  PIN ${PIN}`);
  console.log(`  Events       : Annual Gala 2026 (Demo) is ongoing; Tech Meetup upcoming; Product Launch past.`);
}

// ═══ the printable sheet ═════════════════════════════════════════════════════
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function writeSheet(m) {
  const qr = (text) => QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 300 });
  const groups = [
    ['normal', 'Should be admitted', 'Scan each once: “Check-in Successful”. Scan one again: “Already checked in”.'],
    ['refuse', 'Should be refused', 'Each must be refused with the answer shown. None may admit.'],
    ['offline', 'Offline test', 'Turn on airplane mode, scan these three, then turn it off.'],
    ['spare', 'Spares', 'For undo, concurrency and re-testing.'],
    ['manual', 'Manual check-in', 'No code: search the guest list by name.'],
  ];
  const cards = async (group) => (await Promise.all(m.tickets.filter((t) => t.group === group).map(async (t) => `
    <figure class="card">
      ${t.qr ? `<img alt="QR for ${esc(t.label)}" src="${await qr(t.qr)}">` : '<div class="noqr">No QR — search by name</div>'}
      <figcaption>
        <strong>${esc(t.label)}</strong>
        <span>${esc([t.tier, t.seat].filter(Boolean).join(' · '))}</span>
        <em>Expect: ${esc(t.expected)}</em>
      </figcaption>
    </figure>`))).join('');

  const sections = [];
  for (const [g, title, note] of groups) {
    sections.push(`<section><h2>${esc(title)}</h2><p>${esc(note)}</p><div class="grid">${await cards(g)}</div></section>`);
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Check-in demo tickets</title>
<style>
  :root { --teal:#0d5b5e; --ink:#0b1617; --muted:#45585b; --bg:#ffffff; --sunken:#f2f4f5; }
  body { margin:0; font:16px/1.45 system-ui, sans-serif; color:var(--ink); background:var(--bg); }
  header { background:var(--teal); color:#fff; padding:24px 16px; }
  header h1 { margin:0 0 4px; font-size:24px; }
  main { max-width:1200px; margin:0 auto; padding:16px; }
  .warn { background:#fdf3e2; color:#92400e; padding:12px 16px; border-radius:12px; }
  .accounts { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
  .box { background:var(--sunken); border-radius:12px; padding:12px 16px; }
  code { font:14px ui-monospace, monospace; word-break:break-all; }
  h2 { margin:32px 0 4px; color:var(--teal); }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
  .card { margin:0; border:1px solid #e2e7e8; border-radius:16px; padding:12px; background:#fff; }
  .card img { width:100%; height:auto; display:block; image-rendering:pixelated; }
  .noqr { aspect-ratio:1; display:grid; place-items:center; background:var(--sunken); border-radius:8px; color:var(--muted); }
  figcaption { display:grid; gap:2px; margin-top:8px; }
  figcaption span { color:var(--muted); font-size:14px; }
  figcaption em { color:var(--teal); font-style:normal; font-weight:600; font-size:14px; }
  .pair { max-width:260px; }
</style></head><body>
<header><h1>Eventsli Check-in · local demo tickets</h1>
<div>Created ${esc(new Date(m.createdAt).toLocaleString())}. Local database only — these codes do nothing in production.</div></header>
<main>
  <p class="warn">Turn this screen’s brightness up. Scan from 20–40 cm. Run <code>node scripts/demo-checkin.js rearm</code> to reset and scan again.</p>
  <div class="accounts">
    <div class="box"><strong>Organizer</strong> (sees everything)<br><code>${esc(m.accounts.organizer)}</code><br>Password <code>${esc(m.password)}</code></div>
    <div class="box"><strong>Door team member</strong> (no guest list by default)<br><code>${esc(m.accounts.door)}</code><br>Password <code>${esc(m.password)}</code></div>
    <div class="box"><strong>Account with no events</strong><br><code>${esc(m.accounts.outsider)}</code><br>Password <code>${esc(m.password)}</code></div>
    <div class="box"><strong>Shared device: ${esc(m.device.label)}</strong><br>PIN <code>${esc(m.device.pin)}</code><br>ID <code>${esc(m.device.id)}</code>
      <figure class="card pair"><img alt="Pairing code" src="${await qr(m.device.pairing)}"><figcaption><em>Pairing code — scan from “Using a shared door device?”</em></figcaption></figure></div>
  </div>
  ${sections.join('\n')}
</main></body></html>`;
  fs.writeFileSync(SHEET, html);
}

// ═══ status ══════════════════════════════════════════════════════════════════
function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('No demo found. Run: node scripts/demo-checkin.js seed --site http://<LAN-IP>:3000');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

/**
 * Exactly-once, checked from the database rather than from what the phone
 * says: every ticket's admissions minus undos is 0 or 1 and agrees with its
 * status, and no scan id was recorded twice.
 */
async function exactlyOnce(eventId) {
  const scans = must(await supabase.from('scans')
    .select('ticket_id, result, client_scan_id, method, conflict, occurred_at').eq('event_id', eventId), 'scans');
  const tix = must(await supabase.from('tickets').select('id, status').eq('event_id', eventId), 'tickets');
  const problems = [];
  for (const t of tix) {
    const mine = scans.filter((s) => s.ticket_id === t.id);
    const net = mine.filter((s) => s.result === 'admitted').length - mine.filter((s) => s.result === 'undone').length;
    const expected = t.status === 'scanned' ? 1 : 0;
    if (net !== expected) problems.push(`ticket ${t.id.slice(0, 8)}: ${net} net admissions but status ${t.status}`);
  }
  const ids = scans.map((s) => s.client_scan_id).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) problems.push(`scan ids recorded twice: ${[...new Set(dupes)].join(', ')}`);
  return { scans, tix, problems };
}

async function status() {
  const m = loadManifest();
  const ids = m.tickets.map((t) => t.ticketId).filter(Boolean);
  const rows = must(await supabase.from('tickets').select('id, status, scanned_at, qr_version').in('id', ids), 'tickets');
  const byId = new Map(rows.map((r) => [r.id, r]));
  console.log('Demo tickets (Annual Gala 2026 unless noted):');
  for (const t of m.tickets) {
    const r = t.ticketId ? byId.get(t.ticketId) : null;
    const state = !r ? '—' : r.status === 'scanned' ? `IN at ${new Date(r.scanned_at).toLocaleTimeString()}` : r.status;
    console.log(`  ${t.label.padEnd(52)} ${state}`);
  }
  const { scans, problems } = await exactlyOnce(m.events.gala);
  const by = (k) => scans.reduce((acc, s) => ({ ...acc, [s[k]]: (acc[s[k]] || 0) + 1 }), {});
  console.log(`\nDoor log: ${scans.length} rows · by result ${JSON.stringify(by('result'))} · by method ${JSON.stringify(by('method'))} · conflicts ${scans.filter((s) => s.conflict).length}`);
  console.log(problems.length ? `EXACTLY-ONCE: VIOLATION\n  ${problems.join('\n  ')}` : 'EXACTLY-ONCE: OK — every admission recorded once, no scan id twice.');
  if (problems.length) process.exitCode = 1;
}

// ═══ rearm ═══════════════════════════════════════════════════════════════════
async function rearm() {
  const m = loadManifest();
  const gala = m.events.gala;
  // Keep only the seeded "already scanned" row; the rest of the log goes.
  must(await supabase.from('scans').delete().eq('event_id', gala).neq('client_scan_id', m.prescanId), 'clear log');
  must(await supabase.from('scans').delete().eq('event_id', gala).is('client_scan_id', null), 'clear log');
  const fresh = m.tickets.filter((t) => ['normal', 'offline', 'spare', 'manual'].includes(t.group) && t.ticketId).map((t) => t.ticketId);
  must(await supabase.from('tickets').update({ status: 'valid', scanned_at: null }).in('id', fresh), 'reset tickets');
  await supabase.from('event_gate_settings').delete().eq('event_id', gala);
  console.log(`Re-armed: ${new Set(fresh).size} tickets valid again, door log cleared, door settings back to defaults.`);
}

// ═══ smoke: the app's own calls, over HTTP ═══════════════════════════════════
async function smoke() {
  const m = loadManifest();
  const api = (arg('api') || 'http://127.0.0.1:5000/api/v1').replace(/\/+$/, '');
  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, ok: Boolean(cond) });
    console.log(`${cond ? '  ✔' : '  ✖'} ${name}${!cond && detail ? `\n      ${detail}` : ''}`);
  };
  const call = async (method, p, { body, token } = {}) => {
    const res = await fetch(`${api}${p}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-eventsli-client': 'demo-smoke/1.0.0+0', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const T = (label) => m.tickets.find((t) => t.label.startsWith(label));

  console.log(`Smoke test against ${api}`);
  const health = await call('GET', '/health');
  check('API reachable', health.status === 200, JSON.stringify(health.body));
  const cfg = await call('GET', '/app/config');
  check('app config served', /^\d+\.\d+\.\d+$/.test(cfg.body?.data?.minSupportedVersion?.android || ''));

  const login = await call('POST', '/auth/app/login', { body: { email: m.accounts.organizer, password: m.password, deviceName: 'Smoke test' } });
  check('organizer signs in (token in body)', login.status === 200 && login.body?.data?.token, JSON.stringify(login.body));
  const account = login.body?.data?.token;

  const picker = await call('GET', '/scan/assignments?scope=all', { token: account });
  const g = picker.body?.data || {};
  check('picker: gala ongoing, meetup upcoming, launch past',
    g.ongoing?.some((e) => e.id === m.events.gala) && g.upcoming?.some((e) => e.id === m.events.meetup)
    && g.past?.some((e) => e.id === m.events.launch && !e.scannable), JSON.stringify(g).slice(0, 300));

  const open = await call('POST', '/scan/staff-login', { token: account, body: { eventId: m.events.gala } });
  const door = open.body?.data?.token;
  check('door opens for the gala', open.status === 200 && door, JSON.stringify(open.body));
  const me = await call('GET', '/scan/me', { token: door });
  check('organizer phone is role owner with the guest list', me.body?.data?.role === 'owner' && me.body?.data?.permissions?.viewGuests);

  const expectResult = async (label, want, extra = () => true) => {
    const t = T(label);
    const r = await call('POST', '/scan/verify', { token: door, body: { qr: t.qr, clientScanId: crypto.randomUUID(), occurredAt: new Date().toISOString() } });
    check(`${label} → ${want}`, r.status === 200 && r.body?.data?.result === want && extra(r.body.data), JSON.stringify(r.body).slice(0, 300));
    return r.body?.data;
  };
  await expectResult('Forged code', 'invalid');
  await expectResult('Grace Lee', 'wrong_event');
  await expectResult('Noah Wilson', 'void');
  await expectResult('Ava Thompson', 'void');
  await expectResult('Mia Johnson · OLD', 'transferred');
  await expectResult('Lucas Tremblay · already', 'duplicate', (d) => d.first_scan?.device === 'North Door (demo)');
  await expectResult('John Smith · ticket 1', 'admitted', (d) => d.attendee === 'John Smith' && d.tier === 'General Admission');
  await expectResult('John Smith · ticket 1', 'duplicate');
  await expectResult('Mia’s friend', 'admitted', (d) => d.attendee === null);

  // Offline queue: uploaded, uploaded again, and uploaded twice at once.
  const queue = m.tickets.filter((t) => t.group === 'offline').map((t) => ({
    qr: t.qr, clientScanId: crypto.randomUUID(), occurredAt: new Date(Date.now() - 5 * 60e3).toISOString(), method: 'offline',
  }));
  const s1 = await call('POST', '/scan/sync', { token: door, body: { scans: queue } });
  check('offline queue: 3 admitted on first upload', s1.body?.data?.summary?.admitted === 3, JSON.stringify(s1.body?.data?.summary));
  const s2 = await call('POST', '/scan/sync', { token: door, body: { scans: queue } });
  check('offline queue: re-upload is 3 replays, 0 new', s2.body?.data?.summary?.replayed === 3 && s2.body?.data?.summary?.admitted === 0, JSON.stringify(s2.body?.data?.summary));
  const pair = ['Daniel Garcia · ticket 2', 'Chloé Roy'].map((l) => ({ qr: T(l).qr, clientScanId: crypto.randomUUID(), occurredAt: new Date().toISOString(), method: 'offline' }));
  const [c1, c2] = await Promise.all([1, 2].map(() => call('POST', '/scan/sync', { token: door, body: { scans: pair } })));
  const all = [...(c1.body?.data?.results || []), ...(c2.body?.data?.results || [])];
  check('two uploads at the same instant: no error, admitted once each',
    all.length === 4 && all.every((r) => r.result === 'admitted') && all.filter((r) => !r.replay).length === 2, JSON.stringify(all.map((r) => [r.result, r.replay])));
  const mixed = await call('POST', '/scan/sync', { token: door, body: { scans: [
    { qr: 'not.a.ticket-code-at-all', clientScanId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
    { qr: T('Lucas Tremblay · ticket 2').qr, clientScanId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
  ] } });
  const mr = mixed.body?.data?.results || [];
  check('one bad scan does not sink the batch', mr[0]?.result === 'invalid' && mr[1]?.result === 'admitted', JSON.stringify(mr.map((r) => r.result)));

  const undo = await call('POST', '/scan/undo', { token: door, body: { ticketId: T('John Smith · ticket 1').ticketId } });
  check('undo a mistaken admission', undo.status === 200 && undo.body?.data?.result === 'undone');
  await expectResult('John Smith · ticket 1', 'admitted');

  const find = await call('GET', '/scan/attendees?q=priya&status=out', { token: door });
  check('guest list finds Priya by name', find.status === 200 && find.body?.data?.[0]?.holder === 'Priya Patel', JSON.stringify(find.body).slice(0, 200));
  const manual = await call('POST', '/scan/manual-check-in', { token: door, body: { ticketId: T('Priya Patel').ticketId, clientScanId: crypto.randomUUID() } });
  check('manual check-in admits', manual.body?.data?.result === 'admitted' && manual.body?.data?.method === 'manual');

  const staffLogin = await call('POST', '/auth/app/login', { body: { email: m.accounts.door, password: m.password, deviceName: 'Smoke test' } });
  const staffDoor = (await call('POST', '/scan/staff-login', { token: staffLogin.body?.data?.token, body: { eventId: m.events.gala } })).body?.data?.token;
  const sMe = await call('GET', '/scan/me', { token: staffDoor });
  check('door-team phone is role staff without the guest list', sMe.body?.data?.role === 'staff' && sMe.body?.data?.permissions?.viewGuests === false);
  check('door team cannot search guests by default', (await call('GET', '/scan/attendees', { token: staffDoor })).status === 403);
  const sRecent = await call('GET', '/scan/recent', { token: staffDoor });
  check('door team sees shortened names', (sRecent.body?.data || []).some((r) => r.holder === 'John S.'), JSON.stringify(sRecent.body?.data?.map((r) => r.holder)));

  const pin = await call('POST', '/scan/login', { body: { deviceId: m.device.id, pin: m.device.pin } });
  const pMe = await call('GET', '/scan/me', { token: pin.body?.data?.token });
  check('shared device signs in with its PIN', pMe.body?.data?.role === 'pin' && pMe.body?.data?.device?.label === 'North Door (demo)');

  const outsider = await call('POST', '/auth/app/login', { body: { email: m.accounts.outsider, password: m.password } });
  const empty = await call('GET', '/scan/assignments?scope=all', { token: outsider.body?.data?.token });
  const e = empty.body?.data || {};
  check('an account with no events sees an empty picker', (e.upcoming?.length || 0) + (e.ongoing?.length || 0) + (e.past?.length || 0) === 0);

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const auth = await call('POST', '/auth/app/authorize', { token: account, body: { codeChallenge: challenge, redirectUri: 'eventsli-checkin://auth/callback' } });
  const tok = await call('POST', '/auth/app/token', { body: { code: auth.body?.data?.code, codeVerifier: verifier, redirectUri: 'eventsli-checkin://auth/callback' } });
  check('Sign in with Eventsli (PKCE) round trip', tok.status === 200 && tok.body?.data?.token, JSON.stringify(tok.body).slice(0, 200));

  const stats = await call('GET', '/scan/status', { token: door });
  const ana = await call('GET', '/scan/analytics', { token: door });
  check('analytics agree with the gate', ana.body?.data?.stats?.admitted === stats.body?.data?.stats?.admitted, `${ana.body?.data?.stats?.admitted} vs ${stats.body?.data?.stats?.admitted}`);

  const { problems } = await exactlyOnce(m.events.gala);
  check('database: every admission recorded exactly once', problems.length === 0, problems.join('; '));

  // The smoke run's own sessions are ended, so the phone's list stays clean.
  for (const t of [account, staffLogin.body?.data?.token, outsider.body?.data?.token, tok.body?.data?.token]) {
    if (t) await call('POST', '/auth/logout', { token: t });
  }
  if (!flag('keep')) await rearm();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed.${failed ? ' FAILURES ABOVE.' : ''}`);
  if (failed) process.exitCode = 1;
}

// ═══ door-scan: another door, from this computer ═════════════════════════════
/**
 * Scans one demo ticket as the "North Door (demo)" tablet, through the API —
 * a second door for the device test: watch the phone's dashboard move, get a
 * duplicate "first scanned at the North Door", or admit a ticket the phone is
 * holding offline.
 *
 *   node scripts/demo-checkin.js door-scan "Chloé Roy" [--api URL]
 */
async function doorScan() {
  const m = loadManifest();
  const label = process.argv[3];
  const t = label && m.tickets.find((x) => x.label.toLowerCase().startsWith(label.toLowerCase()) && x.qr);
  if (!t) {
    console.error(`No demo ticket with a code starts with "${label || ''}". Labels:\n  ${m.tickets.filter((x) => x.qr).map((x) => x.label).join('\n  ')}`);
    process.exit(1);
  }
  const api = (arg('api') || 'http://127.0.0.1:5000/api/v1').replace(/\/+$/, '');
  const post = (p, body, token) => fetch(`${api}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const login = await post('/scan/login', { deviceId: m.device.id, pin: m.device.pin });
  if (!login.success) throw new Error(`North Door sign-in failed: ${login.message}`);
  const res = await post('/scan/verify', { qr: t.qr, clientScanId: crypto.randomUUID(), occurredAt: new Date().toISOString() }, login.data.token);
  const d = res.data || {};
  console.log(`North Door scanned "${t.label}": ${d.result || res.error}${d.message ? ` — ${d.message}` : ''}`);
}

const commands = { seed, status, rearm, reset: () => reset(), smoke, 'door-scan': doorScan };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.log('Usage: node scripts/demo-checkin.js seed [--site URL] | status | rearm | smoke [--api URL] [--keep] | door-scan "<label>" [--api URL] | reset');
  process.exit(1);
}
commands[cmd]().catch((err) => {
  console.error(err);
  process.exit(1);
});
