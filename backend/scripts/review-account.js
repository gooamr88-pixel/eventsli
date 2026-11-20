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
 *   · six events, so the app looks the way an organizer's does (EVENTS below):
 *     the main one, "Annual Gala Night", on now and for --days days (the one
 *     the reviewer uses); a second one live today; three coming up; one that
 *     ended yesterday. Each has a cover (review-covers/, uploaded to the
 *     event-media bucket as an organizer's would be) and a General Admission
 *     and a VIP ticket type, both FREE;
 *   · free tickets for named guests, issued through the same database
 *     functions a free checkout uses, every order on the review account — so
 *     the account's "My tickets" page on eventsli.com shows every QR code, to
 *     scan from a second screen;
 *   · at the live and past events, a shared door device and some tickets
 *     already checked in, spread over time, so dashboards and analytics have
 *     numbers;
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
 * 20260829233000). Those lines pin their orders, the events, the organizer and
 * the account in place. So `remove` deletes everything else — tickets, scans,
 * devices, seats, ticket types, covers, sessions — and RETIRES the rest: orders
 * cancelled, events cancelled and renamed "[removed] …", the account renamed to
 * an address that cannot receive mail, its password erased. Nothing of it can
 * sign in, be found on the site, or count as a sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { supabase } = require('../config/supabase');
const { hashPassword } = require('../utils/crypto');

const MARK = {
  org: 'Eventsli App Review',
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
  // Covers: optional. Without the bucket the events get the app's plain header.
  const bucket = await supabase.storage.from('event-media').list('', { limit: 1 });
  if (bucket.error) console.log(`Note     : covers will be skipped — the event-media bucket answered: ${bucket.error.message}`);
  for (const key of ['gala', 'concert', 'tech', 'food', 'comedy', 'art']) {
    if (!fs.existsSync(path.join(__dirname, 'review-covers', `${key}.jpg`))) problems.push(`review-covers/${key}.jpg is missing`);
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
const ZONE = 'America/Toronto';
const BUCKET = 'event-media';
const COVERS = path.join(__dirname, 'review-covers');

/** UTC ms of `hour`:00 in Toronto, `days` from today there. Follows DST. */
function torontoAt(days, hour) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: ZONE }); // YYYY-MM-DD
  const [y, m, d] = today.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d + days, hour);
  // The zone's offset at that moment: what its wall clock reads, minus UTC.
  const wall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: ZONE }));
  const asUtc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return guess - (wall - asUtc);
}

/**
 * The account's events. `start`/`end` are UTC ms; `checkIns` tickets are
 * already in, spread from `from` to `to`. The FIRST is the reviewer's.
 */
function plan(days) {
  const now = Date.now();
  return [
    { key: 'gala', title: 'Annual Gala Night', venue: 'Grand Hall', address: '100 Front Street West', city: 'Toronto',
      start: now - 2 * H, end: torontoAt(days, 23), ga: 14, vip: 6, door: 'Main Door', checkIns: 9, from: now - 90 * MIN, to: now - 10 * MIN },
    { key: 'concert', title: 'Summer Music Night', venue: 'Harbour Stage', address: '235 Queens Quay West', city: 'Toronto',
      start: now - 1 * H, end: now + 4 * H, ga: 22, vip: 6, door: 'North Gate', checkIns: 14, from: now - 55 * MIN, to: now - 3 * MIN },
    { key: 'tech', title: 'Tech Summit 2026', venue: 'Metro Convention Centre', address: '255 Front Street West', city: 'Toronto',
      start: torontoAt(3, 9), end: torontoAt(3, 17), ga: 14, vip: 4 },
    { key: 'food', title: 'Food & Wine Festival', venue: 'Distillery District', address: '55 Mill Street', city: 'Toronto',
      start: torontoAt(9, 12), end: torontoAt(10, 22), ga: 10, vip: 4 },
    { key: 'comedy', title: 'Comedy Night Live', venue: 'The Laugh Lounge', address: '1234 Rue Sainte-Catherine', city: 'Montreal',
      start: torontoAt(16, 20), end: torontoAt(16, 23), ga: 8, vip: 2 },
    { key: 'art', title: 'Modern Art Expo', venue: 'Gallery 21', address: '21 Sussex Drive', city: 'Ottawa',
      start: torontoAt(-1, 10), end: torontoAt(-1, 18), ga: 10, vip: 2, door: 'Front Desk', checkIns: 10, past: true },
  ];
}

const GUESTS = [
  'John Smith', 'Sara Ahmed', 'Ahmed Ali', 'Emily Chen', 'Michael Brown', 'Olivia Martin', 'Daniel Garcia',
  'Priya Patel', 'Lucas Tremblay', 'Chloé Roy', 'Noah Wilson', 'Ava Thompson', 'Mia Johnson', 'Omar Hassan',
  'Sofia Rossi', 'Liam Murphy', 'Yuki Tanaka', 'Fatima Khan', 'Ethan Clarke', 'Grace Lee', 'Mateo López',
  'Hannah Fischer', 'Benjamin Wright', 'Layla Haddad', 'Jacob Nguyen', 'Isabelle Gagnon', 'Ryan O’Neill',
  'Amara Okafor', 'David Kim', 'Zoe Campbell',
];

async function create() {
  const days = Math.max(1, Math.min(60, Number(arg('days', 14)) || 14));
  const existing = await find();
  if (existing.profile && !existing.mine) {
    console.error(`${email} already belongs to an account this script did not make. Nothing changed. Use --email with another address.`);
    process.exitCode = 1;
    return;
  }
  if (existing.mine) {
    console.error('The review account already exists. Run "status" to see it, or "remove" first to start over.');
    process.exitCode = 1;
    return;
  }

  const events = plan(days);
  const total = events.reduce((n, e) => n + e.ga + e.vip, 0);
  console.log(`Database : ${target()}`);
  console.log(`Creates  : the account ${email}, the organizer "${MARK.org}", and ${events.length} hidden events with ${total} free tickets.`);
  if (!(await confirm('Write this to the database?'))) { console.log('Nothing changed.'); return; }

  // Loaded here: older checkouts on the server have them too, and `check`
  // should work even where they would not load.
  const pricing = require('../services/pricingService');
  const ticketSvc = require('../services/ticketService');
  const scanSvc = require('../services/scanService');
  const { CHARGE_MODEL } = require('../utils/money');

  const password = newPassword();
  const made = [];
  let coverTrouble = null;
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

    let guest = 0;
    for (const spec of events) {
      // In order, one event at a time: each step needs the one before it.
      /* eslint-disable no-await-in-loop */
      // On sale, a month out, while its tickets are issued; moved afterwards.
      const ev = must(await supabase.from('events').insert({
        organizer_id: org.id, slug: `${MARK.slug}${spec.key}-${Date.now().toString(36)}`, title: spec.title,
        country: 'CA', timezone: ZONE, currency: 'CAD', status: 'published',
        terms_accepted_id: terms.id, purchase_mode: 'seat_only',
        venue_name: spec.venue, venue_address: spec.address, city: spec.city,
        starts_at: iso(30 * D), ends_at: iso(30 * D + 6 * H),
      }).select('id').single(), `event ${spec.title}`);

      // The cover, stored where an organizer's upload goes. A deployment
      // without the bucket gets the app's plain header instead.
      if (!coverTrouble) {
        const coverPath = `events/${ev.id}/cover-${crypto.randomBytes(8).toString('hex')}.jpg`;
        const up = await supabase.storage.from(BUCKET).upload(coverPath, fs.readFileSync(path.join(COVERS, `${spec.key}.jpg`)), { contentType: 'image/jpeg' });
        if (up.error) {
          coverTrouble = up.error.message;
        } else {
          const url = supabase.storage.from(BUCKET).getPublicUrl(coverPath).data.publicUrl;
          must(await supabase.from('events').update({ cover_url: url, cover_path: coverPath }).eq('id', ev.id), 'cover');
        }
      }

      const map = must(await supabase.from('venue_maps').insert({ event_id: ev.id, layout_json: {} }).select('id').single(), 'venue map');
      const tiers = {};
      for (const name of ['General Admission', 'VIP']) {
        tiers[name] = must(await supabase.from('ticket_tiers').insert({ event_id: ev.id, name, price_cents: 0 }).select('id').single(), `ticket type ${name}`).id;
      }
      const rows = [];
      for (let i = 0; i < spec.ga; i += 1) {
        rows.push({ venue_map_id: map.id, tier_id: tiers['General Admission'], section_key: 'Floor', row_label: String.fromCharCode(65 + Math.floor(i / 10)), seat_number: String((i % 10) + 1) });
      }
      for (let i = 0; i < spec.vip; i += 1) {
        rows.push({ venue_map_id: map.id, tier_id: tiers.VIP, section_key: 'VIP', row_label: 'V', seat_number: String(i + 1) });
      }
      const seats = must(await supabase.from('seats').insert(rows).select('id, tier_id'), 'seats');
      const free = {
        ga: seats.filter((s) => s.tier_id === tiers['General Admission']).map((s) => s.id),
        vip: seats.filter((s) => s.tier_id === tiers.VIP).map((s) => s.id),
      };

      // Guests take 1–3 tickets each, VIPs one, until the seats run out.
      const issued = [];
      for (let n = 0; free.vip.length || free.ga.length; n += 1) {
        const name = GUESTS[guest % GUESTS.length];
        guest += 1;
        const vip = free.vip.length && n % 2 === 1 ? 1 : 0;
        const ga = vip ? 0 : Math.min(free.ga.length, 1 + (n % 3));
        const seatIds = [...free.ga.splice(0, ga), ...free.vip.splice(0, vip || (free.ga.length ? 0 : 1))];
        if (!seatIds.length) continue;
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
        issued.push(...await ticketSvc.forOrder(filled.data.order_id));
      }

      // Its real times, and the door settings.
      must(await supabase.from('events').update({ starts_at: new Date(spec.start).toISOString(), ends_at: new Date(spec.end).toISOString() }).eq('id', ev.id), 'event times');
      must(await supabase.from('event_gate_settings').upsert({
        event_id: ev.id, door_team_can_view_guests: true, offline_admission: true, offline_show_names: true,
        updated_by: owner.id,
      }), 'door settings');

      // Arrivals: every other ticket, spread across the window.
      let pin = null;
      if (spec.checkIns) {
        pin = String(crypto.randomInt(100000, 1000000));
        const device = await scanSvc.registerDevice({ eventId: ev.id, label: spec.door, pin });
        const from = spec.from ?? spec.start + 10 * MIN;
        const to = spec.to ?? Math.min(spec.end, spec.start + 3 * H);
        const early = issued.filter((_, i) => i % 2 === 0).concat(issued.filter((_, i) => i % 2 === 1)).slice(0, spec.checkIns);
        for (const [i, t] of early.entries()) {
          const at = from + ((to - from) * i) / Math.max(1, early.length - 1);
          const r = await supabase.rpc('check_in_ticket_v2', {
            p_event_id: ev.id, p_ticket_id: t.id, p_qr_version: 0, p_device_id: device.id,
            p_client_scan_id: `app-review-${crypto.randomUUID()}`, p_occurred_at: new Date(at).toISOString(),
            p_method: 'scan', p_offline_admitted: false,
          });
          if (r.error || r.data?.result !== 'admitted') throw new Error(`check-in at ${spec.title}: ${r.error?.message || JSON.stringify(r.data)}`);
        }
      }

      // Hidden from the site. A finished event is closed as the site closes one.
      must(await supabase.from('events').update({ status: spec.past ? 'completed' : 'archived' }).eq('id', ev.id), 'hide the event');
      made.push({ ...spec, tickets: issued.length, pin });
      /* eslint-enable no-await-in-loop */
    }

    const when = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    console.log('\nThe review account is ready.\n');
    console.log(`  Sign in      : ${email}`);
    console.log(`  Password     : ${password}`);
    console.log('                 Shown this once and stored nowhere. Copy it now.');
    console.log(`                 Lost it? node scripts/review-account.js password --email ${email}`);
    console.log(`  QR codes     : sign in at ${SITE} with the account above → My tickets`);
    console.log('  Events       : all hidden from the site (Toronto time)');
    for (const e of made) {
      const state = e.past ? 'ended' : e.start <= Date.now() ? 'live now' : 'upcoming';
      const door = e.pin ? ` · ${e.checkIns} checked in · ${e.door} PIN ${e.pin}` : '';
      console.log(`    ${e.title.padEnd(22)} ${state.padEnd(9)} ${when(e.start)} – ${when(e.end)} · ${e.tickets} tickets${door}`);
    }
    if (coverTrouble) console.log(`\n  Covers       : not uploaded (${coverTrouble}); the app shows a plain header instead.`);
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
    // Its cover, and anything else under the event's storage folder.
    const stored = await supabase.storage.from('event-media').list(`events/${ev.id}`);
    if (!stored.error && stored.data?.length) {
      await supabase.storage.from('event-media').remove(stored.data.map((o) => `events/${ev.id}/${o.name}`));
    }
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
      must(await supabase.from('events').update({ status: 'cancelled', title: `[removed] ${ev.title}` }).eq('id', ev.id), 'retire event');
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
