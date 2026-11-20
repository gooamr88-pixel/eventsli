#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The App Store review account, made and removed in one command.
 *
 *   node scripts/review-account.js check                 what it would do; writes nothing
 *   node scripts/review-account.js create   [--email a@b] [--days 14] [--yes]
 *   node scripts/review-account.js status
 *   node scripts/review-account.js password [--yes]      a new password, if the old one is lost
 *   node scripts/review-account.js remove   [--yes]
 *
 * Runs against whatever database backend/.env names: on the server, that is
 * PRODUCTION. Made for it (store/REVIEW.md): Apple's reviewers and the owner's
 * screenshots use the store build, which only talks to eventsli.com.
 *
 * WHAT `create` MAKES, all of it marked so `remove` touches nothing else:
 *   · an organizer account (default appreview@eventsli.com), email verified,
 *     with a fresh random password printed ONCE and stored nowhere;
 *   · its organizer profile, "Eventsli App Review";
 *   · one event, "App Review Demo", on now and for --days days, with a General
 *     Admission and a VIP ticket type, both FREE;
 *   · 20 free tickets for 14 guests, issued through the same database
 *     functions a free checkout uses, every order on the review account — so
 *     the account's "My tickets" page on eventsli.com shows every QR code, to
 *     scan from a second screen;
 *   · a shared door device, "Main Door", and 9 tickets already checked in at
 *     it over the last 90 minutes, so the dashboard and analytics have numbers;
 *   · door settings: offline check-in on, names included, guest list shared.
 *
 * HIDDEN FROM THE PUBLIC: the event is published only while its tickets are
 * issued (the database sells nothing otherwise), then ARCHIVED. The website
 * lists and opens published events only; the check-in app and the scanner
 * accept archived ones (staffService SCANNABLE, check_in_ticket_v2).
 *
 * NOTHING IS SENT: no ticket email, no SMS. Those are sent by the checkout
 * controller, which this does not go through; the database functions send
 * nothing.
 *
 * WHAT `remove` CANNOT DELETE: each free order wrote one 0.00 sale line to the
 * money ledger, and the ledger refuses deletes by design (append-only,
 * 20260829233000). Those lines pin their orders, the event, the organizer and
 * the account in place. So `remove` deletes everything else — tickets, scans,
 * devices, seats, ticket types, sessions — and RETIRES the rest: orders
 * cancelled, event cancelled and renamed "[removed] …", the account renamed to
 * an address that cannot receive mail, its password erased. Nothing of it can
 * sign in, be found on the site, or count as a sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { supabase } = require('../config/supabase');
const { hashPassword } = require('../utils/crypto');

const MARK = {
  org: 'Eventsli App Review',
  title: 'App Review Demo',
  slug: 'app-review-demo-',
  retired: 'retired.review.invalid',
};
const DEFAULT_EMAIL = 'appreview@eventsli.com';
const SITE = 'https://eventsli.com';

// ── small helpers ────────────────────────────────────────────────────────────
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
const MIN = 60e3;
const H = 60 * MIN;
const D = 24 * H;

const email = String(arg('email', DEFAULT_EMAIL)).trim().toLowerCase();

function target() {
  try { return new URL(process.env.SUPABASE_URL || '').hostname || '(none)'; } catch { return '(none)'; }
}

/** 18 random characters, with every character class a password rule could ask for. */
function newPassword() {
  const body = crypto.randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  return `Rv-${body}-7k`;
}

async function confirm(question) {
  if (flag('yes')) return true;
  if (!process.stdin.isTTY) {
    console.error('Not a terminal: add --yes to go ahead.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${question} Type yes to go ahead: `, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

// ── finding what is ours ─────────────────────────────────────────────────────
/**
 * The review account and its organizer, or nulls. An account at this address
 * that does NOT own an organizer named MARK.org is someone's real account:
 * `mine` is false and nothing here will change it.
 */
async function find() {
  const profile = must(await supabase.from('profiles').select('id, email, full_name').eq('email', email).maybeSingle(), 'account');
  if (!profile) return { profile: null, org: null, events: [], mine: false };
  const org = must(await supabase.from('organizers').select('id, display_name')
    .eq('owner_user_id', profile.id).maybeSingle(), 'organizer');
  const mine = Boolean(org && org.display_name === MARK.org);
  const events = mine
    ? must(await supabase.from('events').select('id, title, slug, status, starts_at, ends_at').eq('organizer_id', org.id), 'events')
    : [];
  return { profile, org, events, mine };
}

// ═══ check ═══════════════════════════════════════════════════════════════════
/** Reads only. Confirms every table, column and function `create` needs. */
async function check() {
  console.log(`Database : ${target()}`);
  console.log(`Account  : ${email}`);
  const problems = [];
  const probe = async (what, q) => {
    const { error } = await q;
    if (error) problems.push(`${what}: ${error.message}`);
  };
  await probe('profiles', supabase.from('profiles').select('id, email, full_name, role, password_hash, email_verified_at').limit(1));
  await probe('organizers', supabase.from('organizers').select('id, owner_user_id, display_name, country, stripe_account_id').limit(1));
  await probe('events', supabase.from('events').select('id, organizer_id, slug, title, country, timezone, currency, status, terms_accepted_id, purchase_mode, venue_name, venue_address, city, cover_url, cover_path, starts_at, ends_at').limit(1));
  await probe('ticket types', supabase.from('ticket_tiers').select('id, event_id, name, price_cents').limit(1));
  await probe('seats', supabase.from('seats').select('id, venue_map_id, tier_id, section_key, row_label, seat_number').limit(1));
  await probe('door devices', supabase.from('scan_devices').select('id, event_id, label').limit(1));
  await probe('door settings', supabase.from('event_gate_settings').select('event_id, door_team_can_view_guests, offline_admission, offline_show_names').limit(1));
  await probe('scans', supabase.from('scans').select('id, event_id, ticket_id').limit(1));
  const terms = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).maybeSingle();
  if (terms.error || !terms.data) problems.push(`current organizer terms: ${terms.error?.message || 'none is current'}`);
  // A function that exists answers a call with a nonsense id with its own
  // refusal; one that does not exist fails to resolve.
  for (const [fn, params] of [
    ['hold_seats', { p_event_id: crypto.randomUUID(), p_user_id: null, p_seat_ids: [crypto.randomUUID()], p_ttl_minutes: 1 }],
    ['check_in_ticket_v2', { p_event_id: crypto.randomUUID(), p_ticket_id: crypto.randomUUID(), p_qr_version: 0, p_device_id: null, p_client_scan_id: null, p_occurred_at: null, p_method: 'scan', p_offline_admitted: false }],
  ]) {
    const { error } = await supabase.rpc(fn, params);
    if (error && /function|schema cache/i.test(error.message)) problems.push(`${fn}: ${error.message}`);
  }
  // The server's own code, which may be older than this script.
  for (const [mod, ok] of [
    ['../services/pricingService', (m) => typeof m.quoteReservation === 'function'],
    ['../services/ticketService', (m) => typeof m.forOrder === 'function'],
    ['../services/scanService', (m) => typeof m.registerDevice === 'function'],
    ['../utils/money', (m) => Boolean(m.CHARGE_MODEL?.DESTINATION)],
  ]) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      if (!ok(require(mod))) problems.push(`${mod.slice(3)}.js is older than this script needs`);
    } catch (e) {
      problems.push(`${mod.slice(3)}.js: ${e.message}`);
    }
  }
  const found = await find();
  if (found.profile && !found.mine) problems.push(`${email} is already someone's account (not made by this script). Use --email with another address.`);
  if (found.mine) console.log(`Found    : the review account already exists, with ${found.events.length} event(s). Run status, or remove first.`);

  if (problems.length) {
    console.log('\nNot ready:');
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nReady: everything create needs is there. Nothing was written.');
  }
}

// ═══ create ══════════════════════════════════════════════════════════════════
async function create() {
  const days = Math.max(1, Math.min(60, Number(arg('days', 14)) || 14));
  const existing = await find();
  if (existing.profile && !existing.mine) {
    console.error(`${email} already belongs to an account this script did not make. Nothing changed. Use --email with another address.`);
    process.exitCode = 1;
    return;
  }
  if (existing.mine) {
    console.error(`The review account already exists. Run "status" to see it, or "remove" first to start over.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Database : ${target()}`);
  console.log(`Creates  : the account ${email}, the organizer "${MARK.org}", and the hidden event "${MARK.title}" (${days} days), with 20 free tickets.`);
  if (!(await confirm('Write this to the database?'))) { console.log('Nothing changed.'); return; }

  // Loaded here: older checkouts on the server have them too, and `check`
  // should work even where they would not load.
  const pricing = require('../services/pricingService');
  const ticketSvc = require('../services/ticketService');
  const scanSvc = require('../services/scanService');
  const { CHARGE_MODEL } = require('../utils/money');

  const password = newPassword();
  try {
    const terms = must(await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single(), 'current organizer terms');
    const owner = must(await supabase.from('profiles').insert({
      email, full_name: 'App Review', role: 'organizer',
      password_hash: await hashPassword(password),
      email_verified_at: new Date().toISOString(),
    }).select('id').single(), 'account');
    must(await supabase.from('terms_acceptances').insert({ user_id: owner.id, terms_id: terms.id }), 'terms acceptance');
    // No Stripe account: every ticket here is free, and a made-up account id
    // would only give the payment jobs something to fail on.
    const org = must(await supabase.from('organizers').insert({
      owner_user_id: owner.id, display_name: MARK.org, country: 'CA', stripe_account_id: null,
    }).select('id').single(), 'organizer');

    // On sale, in the future, while the tickets are issued; moved afterwards.
    const ev = must(await supabase.from('events').insert({
      organizer_id: org.id, slug: `${MARK.slug}${Date.now().toString(36)}`, title: MARK.title,
      country: 'CA', timezone: 'America/Toronto', currency: 'CAD', status: 'published',
      terms_accepted_id: terms.id, purchase_mode: 'seat_only',
      venue_name: 'Demo Hall', venue_address: '100 Demo Street', city: 'Toronto',
      cover_url: `${SITE}/og-default.png`, cover_path: 'app-review/og-default.png',
      starts_at: iso(2 * D), ends_at: iso(2 * D + 6 * H),
    }).select('id, slug').single(), 'event');

    const map = must(await supabase.from('venue_maps').insert({ event_id: ev.id, layout_json: {} }).select('id').single(), 'venue map');
    const tiers = {};
    for (const name of ['General Admission', 'VIP']) {
      tiers[name] = must(await supabase.from('ticket_tiers').insert({ event_id: ev.id, name, price_cents: 0 }).select('id').single(), `ticket type ${name}`).id;
    }
    const rows = [];
    for (let i = 0; i < 30; i += 1) {
      rows.push({ venue_map_id: map.id, tier_id: tiers['General Admission'], section_key: 'Floor', row_label: String.fromCharCode(65 + Math.floor(i / 10)), seat_number: String((i % 10) + 1) });
    }
    for (let i = 0; i < 10; i += 1) {
      rows.push({ venue_map_id: map.id, tier_id: tiers.VIP, section_key: 'VIP', row_label: 'V', seat_number: String(i + 1) });
    }
    const seats = must(await supabase.from('seats').insert(rows).select('id, tier_id'), 'seats');
    const free = {
      ga: seats.filter((s) => s.tier_id === tiers['General Admission']).map((s) => s.id),
      vip: seats.filter((s) => s.tier_id === tiers.VIP).map((s) => s.id),
    };

    /** A free claim, through the functions the free checkout uses. */
    const claim = async (name, { ga = 0, vip = 0 }) => {
      const seatIds = [...free.ga.splice(0, ga), ...free.vip.splice(0, vip)];
      const held = await supabase.rpc('hold_seats', { p_event_id: ev.id, p_user_id: owner.id, p_seat_ids: seatIds, p_ttl_minutes: 35 });
      if (held.error || !held.data?.reservation_id) throw new Error(`hold for ${name}: ${held.error?.message || JSON.stringify(held.data)}`);
      // As the free checkout quotes it (checkoutController): DESTINATION, or
      // fulfill_checkout demands an organizer Stripe account. No money moves.
      const q = await pricing.quoteReservation(held.data.reservation_id, { chargeModel: CHARGE_MODEL.DESTINATION });
      const filled = await supabase.rpc('fulfill_checkout', {
        p_reservation_id: held.data.reservation_id, p_channel: 'free', p_breakdown: q.breakdown,
        p_buyer: { user_id: owner.id, name, email, phone: null },
        p_stripe: {},
      });
      if (filled.error || !filled.data?.order_id) throw new Error(`tickets for ${name}: ${filled.error?.message || JSON.stringify(filled.data)}`);
      return ticketSvc.forOrder(filled.data.order_id);
    };

    const guests = [
      ['John Smith', { ga: 2 }], ['Sara Ahmed', { vip: 1 }], ['Ahmed Ali', { ga: 2 }],
      ['Emily Chen', { ga: 1 }], ['Michael Brown', { ga: 3 }], ['Olivia Martin', { vip: 1 }],
      ['Daniel Garcia', { ga: 2 }], ['Priya Patel', { vip: 1 }], ['Lucas Tremblay', { ga: 2 }],
      ['Chloé Roy', { ga: 1 }], ['Noah Wilson', { ga: 1 }], ['Ava Thompson', { vip: 1 }],
      ['Mia Johnson', { ga: 1 }], ['Omar Hassan', { vip: 1 }],
    ];
    const issued = [];
    for (const [name, counts] of guests) {
      // In order: each claim takes the next free seats.
      // eslint-disable-next-line no-await-in-loop
      issued.push(...await claim(name, counts));
    }

    // Doors open: on now, for the review window. Then hidden from the site.
    must(await supabase.from('events').update({ starts_at: iso(-2 * H), ends_at: iso(days * D) }).eq('id', ev.id), 'event times');
    must(await supabase.from('event_gate_settings').upsert({
      event_id: ev.id, door_team_can_view_guests: true, offline_admission: true, offline_show_names: true,
      updated_by: owner.id,
    }), 'door settings');

    const pin = String(crypto.randomInt(100000, 1000000));
    const device = await scanSvc.registerDevice({ eventId: ev.id, label: 'Main Door', pin });

    // Nine already in, spread over the last 90 minutes, for the dashboard and
    // the arrivals chart. The rest are left to scan.
    const early = issued.filter((_, i) => i % 2 === 0).slice(0, 9);
    for (const [i, t] of early.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const r = await supabase.rpc('check_in_ticket_v2', {
        p_event_id: ev.id, p_ticket_id: t.id, p_qr_version: 0, p_device_id: device.id,
        p_client_scan_id: `app-review-${crypto.randomUUID()}`, p_occurred_at: iso(-(90 - i * 10) * MIN),
        p_method: 'scan', p_offline_admitted: false,
      });
      if (r.error || r.data?.result !== 'admitted') throw new Error(`check-in: ${r.error?.message || JSON.stringify(r.data)}`);
    }

    must(await supabase.from('events').update({ status: 'archived' }).eq('id', ev.id), 'hide the event');

    console.log('\nThe review account is ready.\n');
    console.log(`  Sign in      : ${email}`);
    console.log(`  Password     : ${password}`);
    console.log('                 Shown this once and stored nowhere. Copy it now.');
    console.log(`                 Lost it? node scripts/review-account.js password --email ${email}`);
    console.log(`  Event        : ${MARK.title} — on now until ${new Date(Date.now() + days * D).toDateString()}, hidden from the site`);
    console.log(`  Tickets      : ${issued.length} free, ${early.length} already checked in at Main Door`);
    console.log(`  QR codes     : sign in at ${SITE} with the account above → My tickets`);
    console.log(`  Door device  : Main Door, PIN ${pin}`);
  } catch (e) {
    console.error(`\nStopped: ${e.message}`);
    console.error('Cleaning up what was made...');
    await remove({ quiet: true, force: true }).catch((err) => console.error(`Clean-up failed too: ${err.message}. Run: node scripts/review-account.js remove`));
    process.exitCode = 1;
  }
}

// ═══ status ══════════════════════════════════════════════════════════════════
async function status() {
  const { profile, events, mine } = await find();
  console.log(`Database : ${target()}`);
  if (!profile) { console.log(`No account at ${email}.`); return; }
  if (!mine) { console.log(`${email} is an account this script did not make.`); return; }
  console.log(`Account  : ${email} (made by this script)`);
  for (const ev of events) {
    const tickets = must(await supabase.from('tickets').select('status').eq('event_id', ev.id), 'tickets');
    const inside = tickets.filter((t) => t.status === 'scanned').length;
    console.log(`Event    : ${ev.title} · ${ev.status} · ${new Date(ev.starts_at).toDateString()} – ${new Date(ev.ends_at).toDateString()}`);
    console.log(`Tickets  : ${tickets.length}, ${inside} checked in`);
  }
}

// ═══ password ════════════════════════════════════════════════════════════════
async function password() {
  const { profile, mine } = await find();
  if (!mine) { console.error(`No review account at ${email} made by this script. Nothing changed.`); process.exitCode = 1; return; }
  if (!(await confirm(`New password for ${email}? The old one stops working.`))) { console.log('Nothing changed.'); return; }
  const pw = newPassword();
  must(await supabase.from('profiles').update({ password_hash: await hashPassword(pw) }).eq('id', profile.id), 'password');
  await supabase.from('sessions').delete().eq('user_id', profile.id);
  console.log(`\n  Password : ${pw}\n  Shown this once. Every signed-in phone is signed out.`);
}

// ═══ remove ══════════════════════════════════════════════════════════════════
async function remove({ quiet = false, force = false } = {}) {
  const { profile, org, events, mine } = await find();
  if (!profile) { if (!quiet) console.log(`No account at ${email}. Nothing to remove.`); return; }
  if (!mine) {
    console.error(`${email} is an account this script did not make. Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  if (!force) {
    console.log(`Database : ${target()}`);
    console.log(`Removes  : ${email}, "${MARK.org}" and ${events.length} event(s), with every ticket and check-in.`);
    if (!(await confirm('Remove them?'))) { console.log('Nothing changed.'); return; }
  }

  const tolerate = async (q) => { await q; }; // tables an older schema may not have
  let retired = 0;
  for (const ev of events) {
    await tolerate(supabase.from('scans').delete().eq('event_id', ev.id));
    await tolerate(supabase.from('event_staff').delete().eq('event_id', ev.id));
    await tolerate(supabase.from('scanner_access').delete().eq('event_id', ev.id));
    await tolerate(supabase.from('event_gate_settings').delete().eq('event_id', ev.id));
    await tolerate(supabase.from('scan_devices').delete().eq('event_id', ev.id));
    must(await supabase.from('tickets').delete().eq('event_id', ev.id), 'tickets');
    const orders = must(await supabase.from('orders').select('id').eq('event_id', ev.id), 'orders');
    for (const o of orders) {
      await tolerate(supabase.from('order_items').delete().eq('order_id', o.id));
      const del = await supabase.from('orders').delete().eq('id', o.id);
      // Pinned by its 0.00 ledger line: no longer a sale.
      if (del.error) { await supabase.from('orders').update({ status: 'cancelled' }).eq('id', o.id); retired += 1; }
    }
    const res = must(await supabase.from('reservations').select('id').eq('event_id', ev.id), 'reservations');
    for (const r of res) await tolerate(supabase.from('reservation_items').delete().eq('reservation_id', r.id));
    await tolerate(supabase.from('reservations').delete().eq('event_id', ev.id));
    const maps = must(await supabase.from('venue_maps').select('id').eq('event_id', ev.id), 'venue maps');
    for (const m of maps) await tolerate(supabase.from('seats').delete().eq('venue_map_id', m.id));
    await tolerate(supabase.from('venue_maps').delete().eq('event_id', ev.id));
    await tolerate(supabase.from('ticket_tiers').delete().eq('event_id', ev.id));
    const del = await supabase.from('events').delete().eq('id', ev.id);
    if (del.error) {
      must(await supabase.from('events').update({ status: 'cancelled', title: `[removed] ${MARK.title}` }).eq('id', ev.id), 'retire event');
    }
  }

  await tolerate(supabase.from('app_auth_codes').delete().eq('user_id', profile.id));
  await tolerate(supabase.from('sessions').delete().eq('user_id', profile.id));
  await tolerate(supabase.from('event_staff').delete().eq('user_id', profile.id));
  const orgDel = await supabase.from('organizers').delete().eq('id', org.id);
  if (orgDel.error) {
    must(await supabase.from('organizers').update({ display_name: `${MARK.org} [removed]` }).eq('id', org.id), 'retire organizer');
  }
  if (!orgDel.error) await tolerate(supabase.from('terms_acceptances').delete().eq('user_id', profile.id));
  const profDel = orgDel.error ? { error: true } : await supabase.from('profiles').delete().eq('id', profile.id);
  if (profDel.error) {
    // Frees the address and ends every way in: no password, no mailbox.
    must(await supabase.from('profiles').update({
      email: `retired-${profile.id}@${MARK.retired}`, password_hash: null, full_name: 'Removed review account',
    }).eq('id', profile.id), 'retire account');
  }

  if (!quiet) {
    console.log(`Removed: ${events.length} event(s) with their tickets, check-ins and devices; the sign-in for ${email}.`);
    if (retired) {
      console.log(`Kept, retired: ${retired} cancelled 0.00 order(s), the cancelled event and the account renamed to`);
      console.log(`  retired-…@${MARK.retired}, held by their ledger lines (the ledger cannot be deleted). None can sign in or be seen.`);
    }
  }
}

// ═══ main ════════════════════════════════════════════════════════════════════
const commands = { check, create, status, password, remove: () => remove() };
const cmd = process.argv[2];
if (!commands[cmd]) {
  console.log('Usage: node scripts/review-account.js check | create | status | password | remove   [--email address] [--days 14] [--yes]');
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().then(() => process.exit(process.exitCode || 0), (e) => {
  console.error(e.message);
  process.exit(1);
});
