#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A complete showcase event, built in someone's organizer account.
 *
 *   node scripts/showcase-event.js --email someone@example.com [--publish]
 *                                  [--api http://127.0.0.1:5000/api/v1]
 *
 * Everything an organizer can set up, through the same API the dashboard uses
 * (so every rule the dashboard meets is met here too):
 *
 *   details, highlights, map pin · cover, logo, gallery, sponsors (images)
 *   ticket types · table categories · a full Venue Studio map: stage, VIP round
 *   tables, a private sponsor table, fanned orchestra sections, a balcony ring,
 *   accessible row, bars, entrances, screens · venue card with photo · 3D scene
 *   · four real 360° views linked to rows · production-held seats · schedule ·
 *   policies · promo codes · a door device and door settings.
 *
 * WHO IT ACTS AS. The account named by --email, through a one-hour session the
 * script opens for it and closes at the end. The account must already be an
 * organizer with its organization set up (that step is the account holder's
 * own agreement to the organizer terms, so the script does not do it).
 *
 * --publish ALSO accepts this event's organizer terms on the account's behalf
 * and submits it. Leave it off to get a finished draft that the account holder
 * submits from the dashboard. If the platform holds new events for review, the
 * submission is approved with a super admin's session.
 *
 * Images: photos from Unsplash (Unsplash License) and 360° panoramas from Poly
 * Haven (CC0), fetched when the script runs; logos are drawn here. Uses `sharp`
 * (installed with Next.js) to size them; without it the panoramas over the 5 MB
 * upload limit and the drawn logos are skipped.
 *
 * On failure the half-built draft is deleted, so it can simply be run again.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');
const crypto = require('node:crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { supabase } = require('../config/supabase');
const sessions = require('../services/sessionService');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional: see the header */ }

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const EMAIL = String(arg('email') || '').trim().toLowerCase();
const API = (arg('api') || `http://127.0.0.1:${process.env.PORT || 5000}/api/v1`).replace(/\/+$/, '');
const SITE = String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/+$/, '');
const PUBLISH = flag('publish');

const log = (...a) => console.log(...a);
const warn = (msg) => console.log(`  ! ${msg}`);

// ═══ The API, as the account ════════════════════════════════════════════════
function client(token) {
  return async function call(method, p, body) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await fetch(`${API}${p}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          'user-agent': 'eventsli-showcase-script/1.0',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
        continue;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        const err = new Error(`${method} ${p} → ${res.status} ${json?.error || ''}: ${json?.message || 'no message'}`);
        err.status = res.status;
        err.code = json?.error;
        err.body = json;
        throw err;
      }
      return json?.data;
    }
    throw new Error(`${method} ${p}: rate limited`);
  };
}

// ═══ Images ═════════════════════════════════════════════════════════════════
const unsplash = (id, w = 2000, h = null) => `https://images.unsplash.com/photo-${id}?w=${w}${h ? `&h=${h}&fit=crop` : ''}&q=80&fm=jpg`;
const polyhaven = (name) => `https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/${name}.jpg`;
const MAX_BYTES = 5 * 1024 * 1024;

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'eventsli-showcase-script/1.0' } });
  if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** A JPEG no larger than the upload limit, resized to fit `maxWidth` when sharp is there. */
async function asJpeg(buffer, maxWidth) {
  if (!sharp) {
    if (buffer.length > MAX_BYTES) throw new Error('image is over 5 MB and sharp is not installed to shrink it');
    return buffer;
  }
  return sharp(buffer).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

async function svgToPng(svg) {
  if (!sharp) throw new Error('sharp is not installed, so drawn logos are skipped');
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Sign → PUT → the stored path. `sign` is the route's own signing call. */
async function upload(sign, buffer, contentType) {
  let signed;
  try {
    signed = await sign(contentType);
  } catch (err) {
    // The deployment cannot sign uploads at all (no bucket, storage off): one
    // warning for the whole image step, not one per image.
    if (err.status >= 500) err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: buffer });
  if (!res.ok) throw new Error(`storage refused the upload: ${res.status} ${await res.text().catch(() => '')}`);
  return signed.path;
}

const FONT = "'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";

function eventLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#1c2b5a"/><stop offset="1" stop-color="#070b1f"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e3a1"/><stop offset="0.5" stop-color="#d4a843"/><stop offset="1" stop-color="#9c7322"/></linearGradient>
  </defs>
  <rect width="800" height="800" rx="400" fill="url(#bg)"/>
  <circle cx="400" cy="400" r="360" fill="none" stroke="url(#gold)" stroke-width="6"/>
  <circle cx="400" cy="400" r="340" fill="none" stroke="url(#gold)" stroke-width="1.5" opacity="0.6"/>
  <path d="M400 150 L428 262 L540 270 L452 338 L482 448 L400 386 L318 448 L348 338 L260 270 L372 262 Z" fill="url(#gold)"/>
  <text x="400" y="560" text-anchor="middle" font-family="${FONT}" font-size="74" font-weight="700" letter-spacing="10" fill="url(#gold)">STARLIGHT</text>
  <text x="400" y="620" text-anchor="middle" font-family="${FONT}" font-size="30" letter-spacing="14" fill="#e9dcb4">SYMPHONY GALA</text>
  <text x="400" y="680" text-anchor="middle" font-family="${FONT}" font-size="26" letter-spacing="8" fill="#b9a978">2027</text>
</svg>`;
}

function sponsorSvg({ name, tagline, color, mark }) {
  const marks = {
    ring: `<circle cx="150" cy="200" r="70" fill="none" stroke="${color}" stroke-width="22"/><circle cx="150" cy="200" r="22" fill="${color}"/>`,
    peak: `<path d="M80 270 L150 130 L220 270 Z" fill="${color}"/><path d="M135 270 L195 175 L255 270 Z" fill="${color}" opacity="0.55"/>`,
    wave: `<path d="M75 200 Q112 140 150 200 T225 200" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round"/><path d="M75 250 Q112 190 150 250 T225 250" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round" opacity="0.5"/>`,
    leaf: `<path d="M150 120 C230 160 230 260 150 290 C70 260 70 160 150 120 Z" fill="${color}"/><path d="M150 140 L150 285" stroke="#fff" stroke-width="8"/>`,
    bars: `<rect x="85" y="210" width="30" height="70" rx="6" fill="${color}"/><rect x="135" y="160" width="30" height="120" rx="6" fill="${color}"/><rect x="185" y="120" width="30" height="160" rx="6" fill="${color}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
  <rect width="800" height="400" fill="#ffffff"/>
  ${marks[mark]}
  <text x="290" y="215" font-family="${FONT}" font-size="64" font-weight="700" fill="#14182b">${name}</text>
  <text x="292" y="262" font-family="${FONT}" font-size="26" letter-spacing="4" fill="#6b7088">${tagline}</text>
</svg>`;
}

// ═══ The venue: a 55 m × 41 m concert hall, stage at the top ════════════════
const SEAT_PITCH = 24;                       // seatingGeometry.SEAT_PITCH
const ROW_GAP = Math.round(SEAT_PITCH * 1.75); // sectionBuilder.ROW_GAP
const WORLD = { width: 2400, height: 1800 };
const STAGE = { x: 1200, y: 110 };
const round3 = (n) => Math.round(n * 1000) / 1000;
const pct = (x, y) => ({ x: round3((x / WORLD.width) * 100), y: round3((y / WORLD.height) * 100) });
const rowLabel = (i) => String.fromCharCode(65 + i);
const sid = () => `s${crypto.randomBytes(4).toString('hex')}`;
const zid = () => `z${crypto.randomBytes(4).toString('hex')}`;

/** sectionBuilder.buildSection's wedge: rows on arcs about the stage, facing it. */
function wedge({ name, rows, seats, addPerRow, angle, from, tierFor }) {
  const bearing = ((90 + angle) * Math.PI) / 180;
  const tables = [];
  const sectionRows = [];
  for (let i = 0; i < rows; i += 1) {
    const row = rowLabel(i);
    const d = from + i * ROW_GAP;
    const c = { x: STAGE.x + Math.cos(bearing) * d, y: STAGE.y + Math.sin(bearing) * d };
    const label = `${name} ${row}`;
    tables.push({
      label, shape: 'row', seatCount: Math.min(60, seats + i * addPerRow),
      tierId: tierFor(i), section: name, row,
      position: { ...pct(c.x, c.y), rotation: round3(angle) },
    });
    sectionRows.push({ table: label, row });
  }
  return { tables, section: { id: sid(), name, rows: sectionRows } };
}

function zone(kind, label, x, y, w, h, rotation = 0) {
  return { id: zid(), kind, label, ...pct(x, y), w, h, rotation, color: null };
}

function buildMap({ tiers, categories, sponsorPassword }) {
  const sections = [];
  const tables = [];
  const add = (built) => { tables.push(...built.tables); sections.push(built.section); };

  // VIP floor: six round tables of ten, plus the sponsor's private table and the press table.
  const vip = [[960, 300], [1200, 300], [1440, 300], [960, 470], [1200, 470], [1440, 470]];
  vip.forEach(([x, y], i) => tables.push({
    label: `VIP ${i + 1}`, shape: 'round', seatCount: 10, tierId: tiers.vip, priceCents: tiers.vipTableCents,
    categoryId: i < 3 ? categories.front : categories.vip, position: { ...pct(x, y), rotation: 0 },
  }));
  tables.push({
    label: 'Sponsor Table', shape: 'round', seatCount: 10, tierId: tiers.vip, priceCents: tiers.vipTableCents,
    categoryId: categories.sponsor, isPrivate: true, password: sponsorPassword, position: { ...pct(720, 385), rotation: 0 },
  });
  tables.push({
    label: 'Press Table', shape: 'rect', seatCount: 8, tierId: tiers.vip, priceCents: null,
    categoryId: categories.sponsor, position: { ...pct(1680, 385), rotation: 0 },
  });

  // Accessible row in front of the orchestra, with companion seats.
  tables.push({
    label: 'Accessible W', shape: 'row', seatCount: 10, tierId: tiers.accessible, section: 'Accessible', row: 'W',
    position: { ...pct(1200, 640), rotation: 0 },
  });
  sections.push({ id: sid(), name: 'Accessible', rows: [{ table: 'Accessible W', row: 'W' }] });

  // The orchestra: three fanned sections, twelve rows each, widening to the back.
  add(wedge({ name: 'Orchestra C', rows: 12, seats: 18, addPerRow: 1, angle: 0, from: 720, tierFor: (i) => (i < 6 ? tiers.premium : tiers.orchestra) }));
  add(wedge({ name: 'Orchestra L', rows: 12, seats: 14, addPerRow: 1, angle: 40, from: 720, tierFor: () => tiers.orchestra }));
  add(wedge({ name: 'Orchestra R', rows: 12, seats: 14, addPerRow: 1, angle: -40, from: 720, tierFor: () => tiers.orchestra }));

  // The balcony ring behind the cross aisle.
  add(wedge({ name: 'Balcony 2', rows: 6, seats: 22, addPerRow: 1, angle: 0, from: 1300, tierFor: () => tiers.balcony }));
  add(wedge({ name: 'Balcony 1', rows: 6, seats: 18, addPerRow: 1, angle: 40, from: 1300, tierFor: () => tiers.balcony }));
  add(wedge({ name: 'Balcony 3', rows: 6, seats: 18, addPerRow: 1, angle: -40, from: 1300, tierFor: () => tiers.balcony }));

  const zones = [
    zone('stage', 'Main Stage', 1200, 110, 600, 150),
    zone('barrier', 'Stage barrier', 1200, 205, 600, 20),
    zone('screen', 'LED screen', 760, 80, 200, 30, 345),
    zone('screen', 'LED screen', 1640, 80, 200, 30, 15),
    zone('lounge', 'VIP Lounge', 270, 210, 280, 190),
    zone('bar', 'Champagne Bar', 270, 430, 220, 60),
    zone('bar', 'Cocktail Bar', 2130, 300, 220, 60),
    zone('coat_check', 'Coat check', 2130, 430, 160, 60),
    zone('accessible', 'Wheelchair spaces', 990, 640, 90, 44),
    zone('accessible', 'Wheelchair spaces', 1410, 640, 90, 44),
    zone('aisle', 'Cross aisle', 1200, 1352, 900, 26),
    zone('entrance', 'Main Entrance', 1200, 1765, 220, 44),
    zone('entrance', 'Side Entrance', 50, 1000, 90, 40, 90),
    zone('entrance', 'Side Entrance', 2350, 1000, 90, 40, 90),
    zone('welcome_desk', 'Box office', 900, 1740, 150, 50),
    zone('photo_booth', 'Photo booth', 1500, 1735, 130, 70),
    zone('restroom', 'Restrooms', 110, 1700, 120, 90),
    zone('restroom', 'Restrooms', 2290, 1700, 120, 90),
    zone('bar', 'Lobby Bar', 600, 1740, 200, 60),
    zone('buffet', 'Dessert bar', 1800, 1740, 180, 60),
  ];

  return { tables, sections, zones };
}

// ═══ The event's words ══════════════════════════════════════════════════════
const DESCRIPTION = `One night, one hall, and a full symphony orchestra under a canopy of light.

Starlight Symphony Gala 2027 brings together a 60-piece orchestra, a live choir and three guest vocalists for an evening that moves from the great film scores to modern pop reimagined for strings, brass and voice. The hall is transformed with a custom lighting design, twin LED screens and a stage built for the occasion.

The evening opens with a champagne reception in the foyer, followed by two acts of music and a midnight finale with a confetti drop over the orchestra floor.

VIP table guests enjoy a three-course chef's tasting menu served at their table, wine pairings, early entry, access to the VIP Lounge and the Champagne Bar, and a reserved table for the whole evening.

Choose your exact seat on the interactive venue map: switch between the 2D plan, a 3D model of the hall, and a 360° view from your row before you buy.

Dress code: black tie optional. Doors open at 6:00 PM; the concert begins at 7:30 PM sharp. Latecomers are seated at the first suitable break.`;

const HIGHLIGHTS = [
  '60-piece symphony orchestra with live choir',
  'Three guest vocalists and a midnight finale',
  'VIP tables with a three-course tasting menu',
  'Champagne reception in the grand foyer',
  'Choose your seat in 2D, 3D or 360°',
  'Fully accessible venue with companion seating',
];

const POLICIES = [
  {
    kind: 'refund', title: 'Refunds and exchanges', showAtCheckout: true,
    body: 'Tickets are refundable up to 14 days before the event, less the service fee. Within 14 days, tickets cannot be refunded but may be transferred to another guest from your account at no charge. If the event is cancelled, every ticket is refunded in full, including fees, to the original payment method.',
  },
  {
    kind: 'terms', title: 'Entry conditions', showAtCheckout: true,
    body: 'Every guest needs their own ticket, shown on a phone or printed. Each ticket admits one person once. Guests under 16 must be accompanied by an adult. Bags may be searched at the door. Professional cameras and recording equipment are not permitted during the performance.',
  },
  {
    kind: 'other', title: 'Accessibility',
    body: 'The venue is step-free from the street to every seating area. Wheelchair spaces with a companion seat are in the Accessible row. A hearing loop covers the orchestra and balcony, and accessible restrooms are on every level. Contact the organizer before the event if you need anything else; we are glad to help.',
  },
  {
    kind: 'privacy', title: 'Photography and privacy',
    body: 'The event is photographed and filmed for promotional use. By attending, you agree that you may appear in these images. Your contact details are used only to deliver your tickets and event updates, and are never sold.',
  },
];

// ═══ Run ════════════════════════════════════════════════════════════════════
async function main() {
  if (!EMAIL || !EMAIL.includes('@')) {
    console.error('Usage: node scripts/showcase-event.js --email someone@example.com [--publish] [--api URL]');
    process.exit(1);
  }

  // ── The account ──
  const { data: profile, error: pErr } = await supabase
    .from('profiles').select('id, email, role, is_blocked').ilike('email', EMAIL).maybeSingle();
  if (pErr) throw new Error(`profile lookup: ${pErr.message}`);
  if (!profile) throw new Error(`No Eventsli account uses ${EMAIL}. Sign up with that address first, then run this again.`);
  if (profile.is_blocked) throw new Error(`${EMAIL} is blocked.`);
  if (!['organizer', 'admin', 'super_admin'].includes(profile.role)) {
    throw new Error(`${EMAIL} is not an organizer yet. Sign in as that account and finish "Become an organizer" (organization name, description, organizer agreement), then run this again.`);
  }
  const { data: org } = await supabase.from('organizers')
    .select('id, display_name, legal_name, description, policies_accepted_at, country, stripe_onboarding_complete, stripe_payouts_enabled, is_banned')
    .eq('owner_user_id', profile.id).maybeSingle();
  if (!org) throw new Error(`${EMAIL} has no organization yet. Sign in as that account and set up the organization first.`);
  const { isSetupComplete } = require('../controllers/organizerController');
  if (!isSetupComplete(org)) throw new Error(`${EMAIL}'s organization setup is not finished (name, legal name, description, organizer agreement). Finish it in the dashboard, then run this again.`);

  const US = org.country === 'US';
  const place = US
    ? { country: 'US', timezone: 'America/New_York', city: 'New York', venueName: 'Hudson Grand Hall', venueAddress: '500 West 34th Street, New York, NY 10001', venueLat: 40.7536, venueLng: -73.9989 }
    : { country: 'CA', timezone: 'America/Toronto', city: 'Toronto', venueName: 'Harbourfront Grand Hall', venueAddress: '88 Harbour Street, Toronto, ON M5J 0B4', venueLat: 43.6418, venueLng: -79.3779 };

  log(`Account   : ${profile.email} (${profile.role}) · organization "${org.display_name}" · ${place.country}`);
  log(`API       : ${API}`);

  const opened = [];
  const open = async (who, role) => {
    const s = await sessions.issue(null, {
      userId: who.id, email: who.email, role, cookie: false, ttlHours: 1, deviceName: 'Showcase event script',
    });
    opened.push(s.jti);
    return client(s.token);
  };

  let api;
  let eventId = null;
  let published = false;
  try {
    api = await open(profile, profile.role);
    await api('GET', '/organizer/me');

    // ── How buyers pay ──
    const stripeReady = !!(org.stripe_onboarding_complete && org.stripe_payouts_enabled);
    const { count: manualCount } = await supabase.from('organizer_payment_methods')
      .select('id', { count: 'exact', head: true }).eq('organizer_id', org.id).eq('is_active', true);
    if (!manualCount) {
      await api('POST', '/organizer/payment-methods', US
        ? { kind: 'bank_transfer', label: 'Bank transfer (Zelle)', instructions: 'Send the total by Zelle to the email on your order confirmation, with your order number in the memo. Tickets are issued when the payment arrives.' }
        : { kind: 'e_transfer', label: 'Interac e-Transfer', instructions: 'Send the total by Interac e-Transfer to the email on your order confirmation, with your order number in the message. Tickets are issued when the payment arrives.' });
      log('  + added a manual payment method to the organization (none was set up)');
    }
    const paymentOption = stripeReady ? 'both' : 'manual';

    // ── The event ──
    let category;
    try {
      const cats = await require('../services/categoryService').list({ enabledOnly: true });
      const slugs = cats.map((c) => c.slug);
      category = ['concert', 'music', 'concerts', 'performing-arts', 'gala', 'nightlife'].find((s) => slugs.includes(s));
    } catch { /* optional */ }

    const event = await api('POST', '/events', {
      title: 'Starlight Symphony Gala 2027',
      description: DESCRIPTION,
      ...place,
      startsAt: `2027-02-13T19:00:00-05:00`,
      endsAt: `2027-02-13T23:59:00-05:00`,
      listingType: 'ticketed',
      admissionType: 'reserved',
      purchaseMode: 'seat_and_table',
      maxTicketsPerOrder: 10,
      allowTicketTransfer: true,
      feeBearer: 'buyer',
      paymentOption,
      ...(category ? { category } : {}),
    });
    eventId = event.id;
    log(`Event     : ${event.title} (${event.slug})`);
    await api('PATCH', `/events/${eventId}`, { highlights: HIGHLIGHTS });

    // ── Ticket types ──
    const tier = async (body) => (await api('POST', `/events/${eventId}/tiers`, body)).id;
    const tiers = {
      vip: await tier({ name: 'VIP Table Experience', kind: 'vip', priceCents: 25000, sortOrder: 0, description: 'A seat at a VIP table: three-course tasting menu, wine pairings, early entry and VIP Lounge access.' }),
      premium: await tier({ name: 'Premium Orchestra', kind: 'standard', priceCents: 14500, sortOrder: 1, description: 'The first six rows of the centre orchestra: the best sound in the hall.' }),
      orchestra: await tier({ name: 'Orchestra', kind: 'standard', priceCents: 9500, sortOrder: 2, description: 'Reserved seating on the orchestra floor.' }),
      balcony: await tier({ name: 'Balcony', kind: 'general', priceCents: 6500, sortOrder: 3, description: 'Raked balcony seating with a full view of the stage and lights.' }),
      accessible: await tier({ name: 'Accessible Seating', kind: 'standard', priceCents: 6500, sortOrder: 4, maxPerOrder: 4, description: 'Wheelchair spaces and companion seats in the Accessible row, step-free from the entrance.' }),
      vipTableCents: 230000,
    };
    log('  + 5 ticket types');

    const category_ = async (name, color, sortOrder) => (await api('POST', `/events/${eventId}/table-categories`, { name, color, sortOrder })).id;
    const categories = {
      front: await category_('Front row VIP', '#d4a843', 0),
      vip: await category_('VIP', '#8a5568', 1),
      sponsor: await category_('Sponsors & press', '#35597f', 2),
    };
    log('  + 3 table categories');

    // ── Images ──
    const images = { gallery: 0, sponsors: 0, panoramas: [], venuePhoto: null, cover: false, logo: false };
    const tryImage = async (what, fn) => {
      try { return await fn(); } catch (err) {
        if (err.code === 'STORAGE_NOT_CONFIGURED') throw err;
        warn(`${what} skipped: ${err.message}`);
        return null;
      }
    };
    try {
      const coverPath = await tryImage('cover', async () => upload(
        (contentType) => api('POST', `/events/${eventId}/cover-upload`, { contentType, slot: 'cover' }),
        await asJpeg(await fetchImage(unsplash('1470229722913-7c0e2dbbafd3', 2400, 1350)), 2400), 'image/jpeg',
      ));
      if (coverPath) { await api('PUT', `/events/${eventId}/cover`, { path: coverPath }); images.cover = true; }

      const logoPath = await tryImage('logo', async () => upload(
        (contentType) => api('POST', `/events/${eventId}/cover-upload`, { contentType, slot: 'logo' }),
        await svgToPng(eventLogoSvg()), 'image/png',
      ));
      if (logoPath) { await api('PUT', `/events/${eventId}/logo`, { path: logoPath }); images.logo = true; }

      const gallery = [
        ['1514525253161-7a46d19cd819', 'The confetti finale over the orchestra floor'],
        ['1492684223066-81342ee5ff30', 'The second act opens'],
        ['1501281668745-f7f57925c3b4', 'Front-row energy at last year\'s gala'],
        ['1519167758481-83f550bb49b3', 'The VIP dinner floor before doors open'],
        ['1511795409834-ef04bbd61622', 'The chef\'s tasting menu at the VIP tables'],
        ['1459749411175-04bf5292ceea', 'Lights up on the main stage'],
        ['1506157786151-b8491531f063', 'Thousands of lights, one night'],
        ['1516450360452-9312f5e86fc7', 'Guest vocalists take the stage'],
      ];
      for (const [id, caption] of gallery) {
        const p = await tryImage(`gallery image ${id}`, async () => upload(
          (contentType) => api('POST', `/events/${eventId}/content/upload`, { contentType, kind: 'gallery' }),
          await asJpeg(await fetchImage(unsplash(id, 1800)), 1800), 'image/jpeg',
        ));
        if (p) { await api('POST', `/events/${eventId}/media`, { kind: 'image', path: p, caption }); images.gallery += 1; }
      }

      const sponsors = [
        { display: 'Aurelia Private Bank', name: 'Aurelia', tagline: 'PRIVATE BANKING', color: '#1f3b73', mark: 'ring', level: 'headline' },
        { display: 'Northpeak Motors', name: 'Northpeak', tagline: 'MOTORS', color: '#9c2f2f', mark: 'peak', level: 'gold' },
        { display: 'Lumenwave Audio & Light', name: 'Lumenwave', tagline: 'AUDIO &amp; LIGHT', color: '#0d7a8a', mark: 'wave', level: 'silver' },
        { display: 'Maple & Oak Catering', name: 'Maple &amp; Oak', tagline: 'FINE CATERING', color: '#2f6b3a', mark: 'leaf', level: 'bronze' },
        { display: 'Citycast Radio', name: 'Citycast', tagline: 'RADIO 101.9', color: '#6a3fa0', mark: 'bars', level: 'partner' },
      ];
      for (const s of sponsors) {
        const p = await tryImage(`sponsor logo ${s.name}`, async () => upload(
          (contentType) => api('POST', `/events/${eventId}/content/upload`, { contentType, kind: 'sponsor' }),
          await svgToPng(sponsorSvg(s)), 'image/png',
        ));
        await api('POST', `/events/${eventId}/sponsors`, { name: s.display, level: s.level, ...(p ? { path: p } : {}) });
        if (p) images.sponsors += 1;
      }

      const studio = async (kind, buffer) => {
        const p = await upload((contentType) => api('POST', `/events/${eventId}/venue-map/upload`, { contentType, kind }), buffer, 'image/jpeg');
        return api('POST', `/events/${eventId}/venue-map/assets`, { path: p });
      };
      images.venuePhoto = await tryImage('venue photo', async () => studio('venue', await asJpeg(await fetchImage(unsplash('1540575467063-178a50c2df87', 2000)), 2000)));
      for (const view of [
        { file: 'theater_01', name: 'Orchestra centre', kind: 'seat', tables: (t) => t.section === 'Orchestra C' && t.row <= 'F' },
        { file: 'music_hall_01', name: 'VIP floor', kind: 'seat', tables: (t) => t.label.startsWith('VIP') || t.label === 'Sponsor Table' },
        { file: 'theater_02', name: 'Balcony', kind: 'upper', tables: (t) => String(t.section || '').startsWith('Balcony') },
        { file: 'music_hall_02', name: 'Grand foyer', kind: 'entrance', tables: () => false },
      ]) {
        const asset = await tryImage(`360° view "${view.name}"`, async () => studio('panorama', await asJpeg(await fetchImage(polyhaven(view.file)), 4096)));
        if (asset) images.panoramas.push({ ...view, path: asset.path });
      }
    } catch (err) {
      if (err.code !== 'STORAGE_NOT_CONFIGURED') throw err;
      warn('image uploads are not configured on this deployment: the event is built without images');
    }
    log(`  + images: cover ${images.cover ? 'yes' : 'no'}, logo ${images.logo ? 'yes' : 'no'}, gallery ${images.gallery}, sponsor logos ${images.sponsors}, venue photo ${images.venuePhoto ? 'yes' : 'no'}, 360° views ${images.panoramas.length}`);

    // ── The seating map ──
    const sponsorPassword = `GALA-${crypto.randomInt(1000, 9999)}`;
    const map = buildMap({ tiers, categories, sponsorPassword });
    const layout = {
      world: WORLD,
      zones: map.zones,
      sections: map.sections,
      venue: {
        name: place.venueName,
        type: 'theatre',
        standingCapacity: 0,
        access: ['wheelchair', 'step_free', 'hearing_loop', 'accessible_restroom', 'companion'],
        notes: US
          ? 'Step-free entry on West 34th Street. Coat check and box office in the foyer. The VIP Lounge opens at 6:00 PM for VIP table guests. Nearest subway: 34 St–Hudson Yards, 4 minutes on foot.'
          : 'Step-free entry on Harbour Street. Coat check and box office in the foyer. The VIP Lounge opens at 6:00 PM for VIP table guests. Nearest transit: Union Station, 8 minutes on foot.',
        ...(images.venuePhoto ? { photo: { path: images.venuePhoto.path } } : {}),
      },
      scene: { rake: 14, stageHeight: 1.4, mood: 'gala', screens: true, roof: true },
      views: images.panoramas.map((v) => ({
        id: `v${crypto.randomBytes(4).toString('hex')}`,
        path: v.path, name: v.name, kind: v.kind, heading: 0,
        tables: map.tables.filter(v.tables).map((t) => t.label),
      })),
    };
    const saved = await api('PUT', `/events/${eventId}/venue-map`, { layout, tables: map.tables });
    const full = await api('GET', `/events/${eventId}/venue-map`);
    const seats = full.tables.flatMap((t) => (t.seats || []).map((s) => ({ ...s, table: t.label })));
    log(`  + seating map: ${full.tables.length} tables and rows, ${seats.length} seats, ${map.sections.length} sections, ${map.zones.length} areas (version ${saved.version})`);

    // Production holds: the camera platform in the balcony's front row.
    const holds = seats.filter((s) => s.table === 'Balcony 2 A' && ['11', '12', '13'].includes(String(s.number)));
    if (holds.length) {
      await api('PUT', `/events/${eventId}/venue-map/availability`, { seatIds: holds.map((s) => s.id), blocked: true });
      log(`  + ${holds.length} seats held for the camera platform (Balcony 2, row A)`);
    }

    // ── Schedule, policies, promo codes ──
    const at = (hhmm) => `2027-02-13T${hhmm}:00-05:00`;
    for (const item of [
      { title: 'Doors open & champagne reception', startsAt: at('18:00'), endsAt: at('19:15'), location: 'Grand Foyer', description: 'Welcome champagne, canapés and live jazz trio in the foyer.' },
      { title: 'VIP dinner service', startsAt: at('18:30'), endsAt: at('19:20'), location: 'VIP floor', description: 'First and second courses served at the VIP tables.' },
      { title: 'Act I: The Great Film Scores', startsAt: at('19:30'), endsAt: at('20:30'), location: 'Main Stage', description: 'The orchestra and choir perform landmark scores from eight decades of cinema.' },
      { title: 'Intermission', startsAt: at('20:30'), endsAt: at('20:55'), location: 'Bars & foyer', description: 'Bars open. Dessert served at the VIP tables.' },
      { title: 'Act II: Pop Reimagined', startsAt: at('20:55'), endsAt: at('22:15'), location: 'Main Stage', description: 'Three guest vocalists join the orchestra for modern hits arranged for strings, brass and voice.' },
      { title: 'Midnight finale & after-party', startsAt: at('22:15'), endsAt: at('23:59'), location: 'Orchestra floor', description: 'The confetti finale, then DJ and late bar in the foyer.' },
    ]) await api('POST', `/events/${eventId}/schedule`, item);
    for (const p of POLICIES) await api('POST', `/events/${eventId}/policies`, p);
    const promos = [
      { code: 'EARLYBIRD', discountType: 'percentage', discountValue: 15, maxUses: 150, validUntil: '2026-12-31T23:59:00-05:00' },
      { code: 'GALAFRIENDS', discountType: 'fixed', discountValue: 20, maxUses: 50 },
    ];
    for (const p of promos) await api('POST', `/events/${eventId}/promos`, p);
    log('  + 6 schedule items, 4 policies, 2 promo codes');

    // ── The door ──
    const pin = String(crypto.randomInt(100000, 999999));
    await api('POST', `/events/${eventId}/scan-devices`, { label: 'Main Entrance', pin });
    await api('PATCH', `/events/${eventId}/gate-settings`, { offlineAdmission: true, offlineShowNames: true, doorTeamCanViewGuests: false, legacyQrOffline: 'allow' });
    log('  + door device "Main Entrance" and door settings');

    // ── Ready? ──
    const preview = await api('GET', `/events/${eventId}/submission-preview`);
    // Accepting the terms is the one step --publish takes on the account's behalf.
    const blockers = (preview?.blockers || []).filter((b) => (b.code || b.error) !== 'TERMS_NOT_ACCEPTED');
    if (blockers.length) {
      log('\nStill needed before it can be submitted:');
      for (const b of blockers) log(`  - ${b.message}`);
    }

    let status = 'draft';
    if (PUBLISH && !blockers.length) {
      await api('POST', `/events/${eventId}/accept-terms`);
      const submitted = await api('POST', `/events/${eventId}/submit`);
      status = submitted?.status || submitted?.event?.status || 'submitted';
      if (status === 'pending_review') {
        const { data: admin } = await supabase.from('profiles').select('id, email, role')
          .in('role', ['super_admin', 'admin']).eq('is_blocked', false).order('role', { ascending: false }).limit(1).maybeSingle();
        if (admin) {
          const adminApi = await open(admin, admin.role);
          await adminApi('POST', `/admin/events/${eventId}/approve`);
          status = 'published';
          log(`  + approved with ${admin.email}'s admin session`);
        } else {
          warn('no admin account found to approve it: approve it in the admin console');
        }
      }
      published = status === 'published';
    }

    log('\n══════════════════════════════════════════════════════════════');
    log(`Done. "${event.title}" is ${published ? 'LIVE' : status === 'pending_review' ? 'waiting for review' : 'a finished DRAFT'}.`);
    if (SITE) {
      log(`  Public page   : ${SITE}/e/${event.slug}`);
      log(`  Seat picker   : ${SITE}/e/${event.slug}/seats`);
      log(`  Dashboard     : ${SITE}/organizer/events/${eventId}`);
      log(`  Venue Studio  : ${SITE}/organizer/events/${eventId}/map`);
    }
    log(`  Sponsor Table password : ${sponsorPassword}`);
    log(`  Door device PIN        : ${pin}  (device "Main Entrance")`);
    log('  Promo codes            : EARLYBIRD (15% off until 31 Dec 2026), GALAFRIENDS ($20 off)');
    if (!published && status === 'draft') {
      log(`\nTo put it live: sign in as ${profile.email}, open the dashboard link above and press Submit`);
      log('(or run this script again with --publish to accept the event terms and submit for that account).');
    }
  } catch (err) {
    if (eventId && !published) {
      try {
        await api('DELETE', `/events/${eventId}`);
        console.error('\nFailed; the half-built draft was deleted, so it is safe to run again.');
      } catch { console.error(`\nFailed; the draft ${eventId} could not be deleted automatically.`); }
    }
    throw err;
  } finally {
    for (const jti of opened) await sessions.revoke(jti, 'script_done').catch(() => {});
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { buildMap, eventLogoSvg, sponsorSvg, asJpeg };
