const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { addressLine } = require('../utils/venueAddress');
const logger = require('../utils/logger');
const { hashIp } = require('../utils/crypto');
const signatures = require('./signatureService');
const stripeSvc = require('./stripeService');
const media = require('./mediaService');
const emails = require('./vendorEmails');
const S = require('./sponsorshipService');
const P = require('./sponsorPortalService');
const V = require('./vendorService');
const R = require('./vendorRules');
const D = require('./vendorDocuments');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDOR BOOKING (owner, 2026-11-21) — the reference flow, migration
 * 20261204090000:
 *
 *   booth page → add-ons → [start] → business details, social links,
 *   documents → checkout (instant) or send (apply)
 *
 * START makes the application row the rest of the flow fills in:
 *   instant  vendor_hold — the booth is HELD for the program's hold_minutes
 *            and counts against the booth type's quantity while it lasts
 *   apply    a DRAFT — holds nothing, and the organizer does not see it until
 *            it is sent
 *
 * Every step needs a signed-in vendor: the row's contact address is the
 * account's, which is what the vendor portal's access rule already checks
 * (sponsorPortalService.mayAccess). Add-on prices and the booth fee are read
 * from the database at START and copied onto the row; the client sends ids.
 *
 * The organizer's half — add-ons and document review — is at the bottom.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { fail } = R;
const text = (v, max) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const ADDON_COLUMNS = 'id, event_id, kind, name, description, price_cents, is_active, sort_order';
const EDITABLE = ['draft', 'held'];

// ── Add-ons ───────────────────────────────────────────────────────────────
function shapeAddon(a) {
  return {
    id: a.id, kind: a.kind, name: a.name, description: a.description || null,
    priceCents: Number(a.price_cents), isActive: a.is_active, sortOrder: a.sort_order,
  };
}

async function readAddons(eventId, { activeOnly = false } = {}) {
  let q = supabase.from('vendor_addons').select(ADDON_COLUMNS).eq('event_id', eventId);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q.order('kind').order('sort_order').order('created_at');
  if (error) throw new Error(error.message);
  return data || [];
}

const listAddons = async (eventId, opts) => (await readAddons(eventId, opts)).map(shapeAddon);

function addonRow(body, { partial = false } = {}) {
  const row = {};
  if (!partial || body.name !== undefined) {
    row.name = String(body.name || '').trim().slice(0, 80);
    if (!row.name) throw fail('VALIDATION_ERROR', 'Name the add-on, e.g. Extra chair.');
  }
  if (!partial || body.kind !== undefined) {
    if (!R.ADDON_KINDS.includes(body.kind ?? 'booth')) throw fail('VALIDATION_ERROR', 'Choose booth or marketing.');
    row.kind = body.kind ?? 'booth';
  }
  if (!partial || body.description !== undefined) row.description = text(body.description, 300);
  if (!partial || body.priceCents !== undefined) {
    const p = Number(body.priceCents);
    if (!Number.isInteger(p) || p < 0) throw fail('VALIDATION_ERROR', 'The price must be a whole number of cents.');
    row.price_cents = p;
  }
  if (body.isActive !== undefined) row.is_active = body.isActive === true;
  if (body.sortOrder !== undefined) row.sort_order = Number(body.sortOrder) || 0;
  return row;
}

async function createAddon(eventId, body) {
  const { data, error } = await supabase.from('vendor_addons').insert({ event_id: eventId, ...addonRow(body) }).select(ADDON_COLUMNS).single();
  if (error) throw new Error(error.message);
  return shapeAddon(data);
}

async function updateAddon(eventId, addonId, body) {
  const row = { ...addonRow(body, { partial: true }), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('vendor_addons').update(row).eq('id', addonId).eq('event_id', eventId).select(ADDON_COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That add-on does not exist.');
  return shapeAddon(data);
}

/** Bookings keep their own copy of what they bought, so an add-on can simply go. */
async function removeAddon(eventId, addonId) {
  const { data, error } = await supabase.from('vendor_addons').delete().eq('id', addonId).eq('event_id', eventId).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw fail('NOT_FOUND', 'That add-on does not exist.');
  return { removed: true };
}

// ── Reading a booking ─────────────────────────────────────────────────────
async function eventBySlug(slug) {
  const { data, error } = await supabase.from('events')
    .select('id, title, slug, status, currency, organizer_id').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== 'published') throw fail('EVENT_NOT_FOUND', 'That event does not exist.');
  return data;
}

async function eventCard(eventId) {
  const { data, error } = await supabase.from('events')
    .select('id, title, slug, starts_at, ends_at, timezone, venue_name, venue_address, city, venue_address_line2, venue_region, venue_postal_code, venue_directions, cover_url, currency, organizer_id')
    .eq('id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('EVENT_NOT_FOUND', 'That event does not exist.');
  const { data: org } = await supabase.from('organizers').select('display_name').eq('id', data.organizer_id).maybeSingle();
  return {
    id: data.id, title: data.title, slug: data.slug, startsAt: data.starts_at, endsAt: data.ends_at, timezone: data.timezone,
    venue: data.venue_name, venueAddress: data.venue_address, city: data.city, venueAddressFull: addressLine(data), coverUrl: data.cover_url || null,
    currency: data.currency, organizerName: org?.display_name || null,
  };
}

async function ownApp(user, appId) {
  const { data, error } = await supabase.from('vendor_applications').select(V.APP_COLUMNS).eq('id', appId).maybeSingle();
  if (error) throw new Error(error.message);
  const companies = data ? await P.companiesOf(user.id) : [];
  if (!data || !P.mayAccess(user, data, companies)) throw fail('NOT_FOUND', 'That booking does not exist.');
  return data;
}

const holdLive = (a, now = Date.now()) => a.stage === 'held' && !!a.hold_expires_at && new Date(a.hold_expires_at).getTime() > now;

/** What is still missing before the vendor can send or pay. Words, for the screen. */
function missing(app, program) {
  const out = [];
  if (!text(app.business_name, 120)) out.push('Company / organization');
  if (!text(app.address, 200)) out.push('Address');
  if (!text(app.city, 80)) out.push('City');
  if (!text(app.postal_code, 20)) out.push('Postal code');
  const categories = Array.isArray(program?.categories) ? program.categories : [];
  if (categories.length && !app.category) out.push('Category');
  const answers = new Map((Array.isArray(app.answers) ? app.answers : []).map((a) => [a.id, a.answer]));
  for (const q of Array.isArray(program?.questions) ? program.questions : []) {
    if (q.required && !answers.get(q.id)) out.push(q.label);
  }
  for (const d of R.missingDocuments(program?.documents, app.documents)) out.push(d.label);
  return out;
}

async function getBooking(user, appId) {
  const app = await ownApp(user, appId);
  const [event, program, booths] = await Promise.all([
    eventCard(app.event_id), V.readProgram(app.event_id), app.booth_type_id || app.requested_booth_type_id
      ? supabase.from('vendor_booth_types').select(V.BOOTH_COLUMNS).eq('id', app.booth_type_id || app.requested_booth_type_id).maybeSingle()
      : { data: null },
  ]);
  const booth = booths.data;
  const addons = Array.isArray(app.addons) ? app.addons : [];
  let card = null;
  if (app.stage === 'held' && Number(app.amount_cents) > 0) {
    const verdict = await P.cardAvailability(await S.eventFor(app.event_id));
    card = { available: verdict.available, reason: verdict.reason || null };
  }
  const shaped = V.shapeProgram(program);
  return {
    id: app.id,
    stage: app.stage,
    status: R.status(app),
    mode: app.stage === 'held' || app.source === 'booking' ? 'instant' : 'apply',
    holdExpiresAt: app.stage === 'held' ? app.hold_expires_at : null,
    holdLive: holdLive(app),
    signed: !!app.accepted_at,
    event,
    booth: booth ? {
      id: booth.id, name: booth.name, sizeLabel: booth.size_label, imageUrl: booth.image_url || null,
      priceCents: Number(booth.price_cents), includes: Array.isArray(booth.includes) ? booth.includes : [],
    } : null,
    boothLabel: app.booth_label,
    addons,
    // The booth's share: what was charged for the booth itself at START.
    boothCents: Math.max(0, Number(app.amount_cents) - R.addonsTotal(addons)),
    amountCents: Number(app.amount_cents),
    currency: app.currency,
    business: {
      businessName: app.business_name, contactName: app.contact_name, contactPhone: app.contact_phone,
      website: app.website, category: app.category, description: app.description,
      address: app.address, city: app.city, postalCode: app.postal_code,
      socials: app.socials || {}, logoUrl: app.logo_url, logoPath: app.logo_path,
    },
    answers: Array.isArray(app.answers) ? app.answers : [],
    documents: (Array.isArray(app.documents) ? app.documents : []).map(({ path, ...d }) => ({ ...d, uploaded: !!path })),
    program: {
      categories: shaped.categories, questions: shaped.questions, documents: shaped.documents,
      terms: app.terms || shaped.defaultTerms, paymentInstructions: shaped.paymentInstructions,
    },
    missing: missing(app, program),
    card,
  };
}

// ── Start: hold (instant) or draft (apply) ────────────────────────────────
async function start(user, slug, body) {
  const event = await eventBySlug(slug);
  const program = await V.readProgram(event.id);
  if (!program?.is_open) throw fail('NOT_FOUND', 'This event is not taking vendors right now.');
  if (!R.applicationsOpen(program)) throw fail('VENDOR_APPLICATIONS_CLOSED', 'This event is no longer taking vendors.');
  const instant = program.booking_mode === 'instant';
  const email = String(user.email || '').toLowerCase();

  // Already booked, or an application already with the organizer: one per event.
  const { data: open } = await supabase.from('vendor_applications').select('id, stage')
    .eq('event_id', event.id).eq('contact_email', email).in('stage', ['submitted', 'waitlisted', 'offered', 'confirmed']).limit(1);
  if (open?.length) {
    throw Object.assign(fail('CONFLICT', open[0].stage === 'confirmed'
      ? 'You already have a booth at this event. Find it under Account › Vendor bookings.'
      : 'You already applied to this event. Follow it under Account › Vendor bookings.'), { meta: { applicationId: open[0].id } });
  }

  let booth = null;
  if (body.boothTypeId) {
    const { data } = await supabase.from('vendor_booth_types').select(V.BOOTH_COLUMNS)
      .eq('id', body.boothTypeId).eq('event_id', event.id).eq('is_public', true).eq('is_active', true).maybeSingle();
    if (!data) throw fail('NOT_FOUND', 'That booth is no longer offered. Choose another.');
    booth = data;
  }
  if (instant && !booth) throw fail('VALIDATION_ERROR', 'Choose a booth to reserve.');

  let spot = null;
  if (body.boothKey) {
    const plan = await V.floorPlanFor(event.id, { audience: 'public', withVenue: false });
    const el = plan?.plan?.elements?.find((e) => e.id === body.boothKey && e.kind === 'booth');
    if (!el) throw fail('NOT_FOUND', 'That booth is not on the floor plan any more. Reload and choose again.');
    if (booth && el.boothTypeId && el.boothTypeId !== booth.id) throw fail('VALIDATION_ERROR', 'That spot is a different kind of booth.');
    if (plan.booths[el.id]?.status !== 'available') throw fail('VENDOR_BOOTH_TAKEN', 'That booth is taken. Choose another spot.');
    spot = el;
  }

  const addons = R.pickAddons(await readAddons(event.id, { activeOnly: true }), body.addonIds);
  const amount = (booth ? Number(booth.price_cents) : 0) + R.addonsTotal(addons);
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  // Last time's business details, so a returning vendor types them once.
  const { data: previous } = await supabase.from('vendor_applications')
    .select('business_name, contact_name, contact_phone, website, category, description, address, city, postal_code, socials, logo_url, logo_path')
    .eq('contact_email', email).not('address', 'is', null).order('updated_at', { ascending: false }).limit(1);
  const last = previous?.[0] || null;
  const carry = (row) => {
    if (!last) return row;
    const keep = { contact_phone: last.contact_phone, website: last.website, description: last.description,
      address: last.address, city: last.city, postal_code: last.postal_code, socials: last.socials || {} };
    return { ...row, ...keep };
  };

  if (instant) {
    await releaseOpenCheckout(event.id, email);
    const { data: id, error } = await supabase.rpc('vendor_hold', {
      p_event_id: event.id, p_email: email, p_business_name: last?.business_name || 'My business',
      p_contact_name: profile?.full_name || last?.contact_name || null, p_booth_type_id: booth.id,
      p_booth_key: spot ? spot.id : null, p_booth_label: spot ? String(spot.code || '').slice(0, 40) : null,
      p_amount_cents: amount, p_currency: event.currency, p_addons: addons, p_includes: booth.includes || [],
      p_staff_passes: booth.staff_passes, p_terms: program.default_terms || null, p_minutes: Number(program.hold_minutes) || 20,
    });
    if (error) throw R.fromDb(error);
    if (last) {
      await supabase.from('vendor_applications').update(carry({})).eq('id', id);
    }
    return { id, mode: 'instant' };
  }

  // Apply mode: one draft per vendor per event, reused.
  const row = carry({
    requested_booth_type_id: booth?.id || null, booth_key: null, addons, amount_cents: amount,
    business_name: last?.business_name || 'My business',
    contact_name: profile?.full_name || last?.contact_name || null, currency: event.currency,
    booth_label: spot ? String(spot.code || '').slice(0, 40) : null, updated_at: new Date().toISOString(),
  });
  const { data: draft } = await supabase.from('vendor_applications').select('id')
    .eq('event_id', event.id).eq('contact_email', email).eq('stage', 'draft').limit(1);
  if (draft?.length) {
    const { error } = await supabase.from('vendor_applications').update(row).eq('id', draft[0].id).eq('stage', 'draft');
    if (error) throw new Error(error.message);
    return { id: draft[0].id, mode: 'apply' };
  }
  const { data: created, error } = await supabase.from('vendor_applications')
    .insert({ ...row, event_id: event.id, stage: 'draft', source: 'application', contact_email: email })
    .select('id').single();
  if (error) throw new Error(error.message);
  await supabase.from('vendor_application_events').insert({ application_id: created.id, kind: 'draft_started', actor_id: user.id });
  return { id: created.id, mode: 'apply' };
}

/** A vendor starting over: their previous hold's open Stripe page is closed first. */
async function releaseOpenCheckout(eventId, email) {
  const { data } = await supabase.from('vendor_applications').select('id, pending_session_id, pending_account_id')
    .eq('event_id', eventId).eq('contact_email', email).eq('stage', 'held').not('pending_session_id', 'is', null);
  for (const a of data || []) await closeSession(a);
}

async function closeSession(a) {
  if (!a.pending_session_id) return;
  let previous;
  try {
    previous = await stripeSvc.retrieveSession(a.pending_session_id, a.pending_account_id);
  } catch (err) {
    logger.warn({ err: err.message, appId: a.id }, 'could not check a vendor hold session');
    throw fail('VENDOR_PAYMENT_PENDING', 'We could not confirm your previous payment attempt. Try again in a minute.');
  }
  if (previous?.status === 'complete') {
    throw fail('VENDOR_PAYMENT_PENDING', 'Your payment went through and is being recorded. Refresh in a minute.');
  }
  if (previous?.status === 'open') await stripeSvc.expireSession(a.pending_session_id, a.pending_account_id).catch(() => {});
}

// ── Business details ──────────────────────────────────────────────────────
async function saveDetails(user, appId, body) {
  const app = await ownApp(user, appId);
  if (!EDITABLE.includes(app.stage)) throw fail('VENDOR_WRONG_STAGE', 'These details can no longer change here. Ask the organizer.');
  if (app.stage === 'held' && !holdLive(app)) throw fail('VENDOR_HOLD_EXPIRED', 'Your booth was released.');
  const program = await V.readProgram(app.event_id);
  const row = { updated_at: new Date().toISOString() };
  if (body.businessName !== undefined) {
    row.business_name = String(body.businessName || '').trim().slice(0, 120);
    if (!row.business_name) throw fail('VALIDATION_ERROR', 'Business name is required.');
  }
  if (body.contactName !== undefined) row.contact_name = text(body.contactName, 120);
  if (body.contactPhone !== undefined) row.contact_phone = text(body.contactPhone, 30);
  if (body.website !== undefined) {
    const w = text(body.website, 2000);
    if (w && !/^https?:\/\/\S+$/i.test(w)) throw fail('VALIDATION_ERROR', 'Enter your website as a full address starting with https://');
    row.website = w;
  }
  if (body.category !== undefined) {
    const c = text(body.category, 60);
    const cats = Array.isArray(program?.categories) ? program.categories : [];
    if (c && cats.length && !cats.includes(c)) throw fail('VALIDATION_ERROR', 'Choose a category from the list.');
    row.category = c;
  }
  if (body.description !== undefined) row.description = text(body.description, 1000);
  if (body.address !== undefined) row.address = text(body.address, 200);
  if (body.city !== undefined) row.city = text(body.city, 80);
  if (body.postalCode !== undefined) row.postal_code = text(body.postalCode, 20);
  if (body.socials !== undefined) row.socials = R.cleanSocials(body.socials);
  if (body.answers !== undefined) {
    // Required answers are checked when the vendor sends or pays, not on every save.
    const questions = (Array.isArray(program?.questions) ? program.questions : []).map((q) => ({ ...q, required: false }));
    row.answers = R.cleanAnswers(questions, body.answers);
  }
  if (body.logoPath !== undefined) {
    if (!body.logoPath) Object.assign(row, { logo_path: null, logo_url: null });
    else if (R.ownVendorLogo(app.event_id, body.logoPath)) Object.assign(row, { logo_path: body.logoPath, logo_url: media.publicUrl(body.logoPath) });
    else throw fail('VALIDATION_ERROR', 'That logo does not belong to this event.');
  }
  const { error } = await supabase.from('vendor_applications').update(row).eq('id', app.id).in('stage', EDITABLE);
  if (error) throw new Error(error.message);
  return getBooking(user, appId);
}

// ── Documents ─────────────────────────────────────────────────────────────
/** Vendors may upload until the booking is closed: a rejected file is replaced later too. */
const DOC_STAGES = ['draft', 'held', 'submitted', 'waitlisted', 'offered', 'confirmed'];

async function signDocument(user, appId, docId, contentType) {
  const app = await ownApp(user, appId);
  if (!DOC_STAGES.includes(app.stage)) throw fail('VENDOR_WRONG_STAGE', 'This booking is closed.');
  const program = await V.readProgram(app.event_id);
  if (!(program?.documents || []).some((d) => d.id === docId)) throw fail('VALIDATION_ERROR', 'The organizer does not ask for that document.');
  return D.signUpload({ eventId: app.event_id, appId: app.id, docId, contentType });
}

async function confirmDocument(user, appId, docId, { path, fileName }) {
  const app = await ownApp(user, appId);
  if (!DOC_STAGES.includes(app.stage)) throw fail('VENDOR_WRONG_STAGE', 'This booking is closed.');
  const existing = (app.documents || []).find((d) => d.id === docId);
  if (existing?.status === 'approved') throw fail('VENDOR_WRONG_STAGE', 'The organizer already approved this document.');
  const program = await V.readProgram(app.event_id);
  const found = await D.confirm({ eventId: app.event_id, appId: app.id, docId, path });
  const { list, previous } = D.withUpload(app.documents, program?.documents, { docId, path, fileName, ...found });
  const { error } = await supabase.from('vendor_applications').update({ documents: list, updated_at: new Date().toISOString() }).eq('id', app.id);
  if (error) throw new Error(error.message);
  if (previous?.path && previous.path !== path) await D.remove(previous.path);
  await supabase.from('vendor_application_events').insert({ application_id: app.id, kind: 'document_uploaded', actor_id: user.id, detail: { docId } });
  return getBooking(user, appId);
}

async function removeDocument(user, appId, docId) {
  const app = await ownApp(user, appId);
  if (!EDITABLE.includes(app.stage)) throw fail('VENDOR_WRONG_STAGE', 'Replace the file instead: this booking was already sent.');
  const doc = (app.documents || []).find((d) => d.id === docId);
  if (!doc) return getBooking(user, appId);
  const { error } = await supabase.from('vendor_applications')
    .update({ documents: (app.documents || []).filter((d) => d.id !== docId), updated_at: new Date().toISOString() }).eq('id', app.id);
  if (error) throw new Error(error.message);
  await D.remove(doc.path);
  return getBooking(user, appId);
}

async function documentLink(app, docId) {
  const doc = (app.documents || []).find((d) => d.id === docId);
  if (!doc?.path) throw fail('NOT_FOUND', 'That document was not uploaded.');
  return D.readUrl(doc.path);
}

const vendorDocumentUrl = async (user, appId, docId) => documentLink(await ownApp(user, appId), docId);

// ── Ending: send (apply) or release (either) ──────────────────────────────
async function submit(user, appId) {
  const app = await ownApp(user, appId);
  if (app.stage !== 'draft') throw fail('VENDOR_WRONG_STAGE', 'This application was already sent.');
  const program = await V.readProgram(app.event_id);
  if (!R.applicationsOpen(program)) throw fail('VENDOR_APPLICATIONS_CLOSED', 'Applications for this event have closed.');
  const gaps = missing(app, program);
  if (gaps.length) throw Object.assign(fail('VALIDATION_ERROR', `Still needed: ${gaps.join(', ')}.`), { meta: { missing: gaps } });
  const questions = Array.isArray(program?.questions) ? program.questions : [];
  const given = Object.fromEntries((app.answers || []).map((a) => [a.id, a.answer]));
  const answers = R.cleanAnswers(questions, given);
  const { data, error } = await supabase.from('vendor_applications')
    .update({ stage: 'submitted', answers, updated_at: new Date().toISOString() }).eq('id', app.id).eq('stage', 'draft').select(V.APP_COLUMNS);
  if (error) throw new Error(error.message);
  if (!data?.length) throw fail('VENDOR_WRONG_STAGE', 'This application changed; reload it.');
  await supabase.from('vendor_application_events').insert({ application_id: app.id, kind: 'applied', actor_id: user.id });
  try {
    const event = await S.eventFor(app.event_id);
    const contact = await V.organizerContact(event);
    const ev = { ...event, venue: event.venue_name };
    await Promise.all([
      emails.applicationToOrganizer({ to: contact.email, organizerName: contact.name, event: ev, app: data[0] }),
      emails.applicationReceipt({ to: data[0].contact_email, contactName: data[0].contact_name, event: ev, organizerName: contact.name }),
    ]);
  } catch (err) {
    logger.warn({ err: err.message, appId }, 'vendor application notice failed');
  }
  return getBooking(user, appId);
}

async function release(user, appId) {
  const app = await ownApp(user, appId);
  if (app.stage === 'draft') {
    for (const d of app.documents || []) await D.remove(d.path);
    await supabase.from('vendor_applications').delete().eq('id', app.id).eq('stage', 'draft');
    return { released: true };
  }
  if (app.stage !== 'held') throw fail('VENDOR_WRONG_STAGE', 'This booking can no longer be released here.');
  await closeSession(app);
  await supabase.from('vendor_applications')
    .update({ stage: 'expired', closed_at: new Date().toISOString(), pending_session_id: null, pending_account_id: null, updated_at: new Date().toISOString() })
    .eq('id', app.id).eq('stage', 'held');
  await supabase.from('vendor_application_events').insert({ application_id: app.id, kind: 'released', actor_id: user.id });
  return { released: true };
}

// ── Checkout (instant) ────────────────────────────────────────────────────
/**
 * Sign, then pay. `method` 'offline' books without a card — only when card
 * payment is not available for this organizer — and the organizer records
 * the fee when it arrives. A free booth is booked on signing.
 * Coming back from Stripe's page without paying skips the signature: the hold
 * is already signed.
 */
async function checkout(user, appId, body, req, origin) {
  const app = await ownApp(user, appId);
  if (app.stage !== 'held') throw fail('VENDOR_WRONG_STAGE', app.stage === 'confirmed' ? 'This booth is already booked.' : 'This booking is not waiting for payment.');
  if (!holdLive(app)) throw fail('VENDOR_HOLD_EXPIRED', 'Your booth was released.');
  const program = await V.readProgram(app.event_id);
  const gaps = missing(app, program);
  if (gaps.length) throw Object.assign(fail('VALIDATION_ERROR', `Still needed: ${gaps.join(', ')}.`), { meta: { missing: gaps } });
  const questions = Array.isArray(program?.questions) ? program.questions : [];
  R.cleanAnswers(questions, Object.fromEntries((app.answers || []).map((a) => [a.id, a.answer])));

  const event = await S.eventFor(app.event_id);
  const paid = Number(app.amount_cents) > 0;
  const card = paid ? await P.cardAvailability(event) : { available: false };
  const offline = paid && !card.available;
  if (body.method === 'offline' && card.available) throw fail('VALIDATION_ERROR', 'Pay by card to book this booth.');

  if (!app.accepted_at) {
    if (body.accept !== true) throw fail('VALIDATION_ERROR', 'Tick the box to confirm you agree to the vendor terms.');
    const name = String(body.signerName || '').trim();
    if (name.length < 2 || name.length > 120) throw fail('VALIDATION_ERROR', 'Enter your full name as the person signing.');
    const sig = signatures.normalize(body.signature);
    const { data, error } = await supabase.rpc('vendor_sign_hold', {
      p_application_id: app.id, p_user_id: user.id, p_email: user.email, p_signer_name: name,
      p_method: sig.method, p_svg: signatures.toSvg(sig), p_sha256: signatures.fingerprint(sig),
      p_ip_hash: req ? hashIp(req.ip) : null, p_confirm: offline,
    });
    if (error) throw R.fromDb(error);
    if (data?.booked) {
      await notifyBooked(app.event_id, app.id, { paid: !paid });
      return { booked: true, id: app.id };
    }
  }
  if (!paid) return { booked: true, id: app.id };
  return startHoldPayment(user, app, event, card, origin);
}

async function startHoldPayment(user, app, event, card, origin) {
  await closeSession(app);
  // The hold outlives Stripe's page (60 min) so a payment never lands on a released booth.
  const until = new Date(Date.now() + 65 * 60 * 1000).toISOString();
  const { data: stretched, error: holdError } = await supabase.from('vendor_applications')
    .update({ hold_expires_at: until, updated_at: new Date().toISOString() })
    .eq('id', app.id).eq('stage', 'held').gt('hold_expires_at', new Date().toISOString()).select('id');
  if (holdError) throw new Error(holdError.message);
  if (!stretched?.length) throw fail('VENDOR_HOLD_EXPIRED', 'Your booth was released.');
  const fresh = await V.loadApp(app.event_id, app.id);
  const names = await V.boothNames([fresh.booth_type_id]);
  const back = `${origin}/e/${encodeURIComponent(event.slug)}/vendors/book/${app.id}`;
  const session = await stripeSvc.createVendorSession({
    app: fresh, event, accountId: card.accountId, origin, boothName: names.get(fresh.booth_type_id) || 'Vendor space',
    feeCents: R.feeFor(fresh.amount_cents, await P_vendorFeeBps()), customerEmail: user.email,
    idempotencyKey: `vendor-hold:${app.id}:${crypto.randomUUID()}`,
    successUrl: `${origin}/account/vendors/${app.id}?paid=1`, cancelUrl: back,
  });
  const { error } = await supabase.from('vendor_applications')
    .update({ pending_session_id: session.id, pending_account_id: card.accountId }).eq('id', app.id).is('paid_at', null);
  if (error) {
    await stripeSvc.expireSession(session.id, card.accountId).catch(() => {});
    throw new Error(error.message);
  }
  return { url: session.url };
}

// Late-bound: vendorPortalService requires this module's neighbours.
const P_vendorFeeBps = () => require('./vendorPortalService').vendorFeeBps();

async function notifyBooked(eventId, appId, { paid }) {
  try {
    if (paid) return await V.notifyPaid(eventId, appId);
    const [app, event] = await Promise.all([V.loadApp(eventId, appId), S.eventFor(eventId)]);
    const contact = await V.organizerContact(event);
    await emails.acceptedToOrganizer({ to: contact.email, organizerName: contact.name, event: { ...event, venue: event.venue_name }, app });
  } catch (err) {
    logger.warn({ err: err.message, appId }, 'vendor booking notice failed');
  }
  return undefined;
}

// ── The organizer's half: documents ───────────────────────────────────────
const organizerDocumentUrl = async (eventId, appId, docId) => documentLink(await V.loadApp(eventId, appId), docId);

async function reviewDocument(eventId, appId, docId, { status, note }, actorId) {
  if (!['approved', 'rejected', 'pending'].includes(status)) throw fail('VALIDATION_ERROR', 'Approve or reject the document.');
  const app = await V.loadApp(eventId, appId);
  const docs = Array.isArray(app.documents) ? app.documents : [];
  if (!docs.some((d) => d.id === docId)) throw fail('NOT_FOUND', 'That document was not uploaded.');
  const next = docs.map((d) => (d.id === docId ? { ...d, status, note: status === 'rejected' ? text(note, 300) : null } : d));
  const { error } = await supabase.from('vendor_applications').update({ documents: next, updated_at: new Date().toISOString() })
    .eq('id', app.id).eq('event_id', eventId);
  if (error) throw new Error(error.message);
  await supabase.from('vendor_application_events').insert({ application_id: app.id, kind: `document_${status}`, actor_id: actorId || null, detail: { docId } });
  return V.getApplication(eventId, appId);
}

module.exports = {
  listAddons, readAddons, createAddon, updateAddon, removeAddon, shapeAddon,
  start, getBooking, saveDetails, signDocument, confirmDocument, removeDocument, vendorDocumentUrl,
  submit, release, checkout, organizerDocumentUrl, reviewDocument, missing,
};
