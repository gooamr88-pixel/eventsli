const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const media = require('./mediaService');
const emails = require('./vendorEmails');
const S = require('./sponsorshipService');
const R = require('./vendorRules');
const FP = require('./vendorFloorPlan');
const { fetchAll } = require('../utils/fetchAll');
const { publicLayout } = require('./venueStudio');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDORS — THE ORGANIZER'S SIDE (owner, 2026-11-20).
 *
 * The vendor program (public page settings, deadline, categories, questions),
 * the booth types, and the applications for one event. Every function takes
 * `eventId` and filters on it: the route has run `verifyEventOwner`, and the
 * service-role client has no row-level security underneath.
 *
 * Whatever touches money or stock — sending an offer, recording the booth fee,
 * closing an application — is ONE database function (migration
 * 20261203090000). This module validates, calls it, and sends the email.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { fail } = R;

const BOOTH_COLUMNS = 'id, event_id, name, description, size_label, price_cents, quantity, staff_passes, includes, color, is_public, is_active, sort_order, image_url, image_path';
const APP_COLUMNS = [
  'id', 'event_id', 'company_id', 'stage', 'source', 'business_name', 'contact_name', 'contact_email', 'contact_phone',
  'website', 'category', 'description', 'answers', 'requested_booth_type_id', 'booth_type_id', 'booth_label', 'booth_key',
  'amount_cents', 'currency', 'staff_passes', 'includes', 'terms', 'offer_sent_at', 'offer_expires_at', 'accepted_at',
  'signer_name', 'signer_email', 'signature_method', 'signature_svg', 'signature_sha256', 'paid_cents', 'paid_at',
  'paid_method', 'paid_reference', 'platform_fee_cents', 'staff', 'logo_url', 'logo_path', 'listed', 'closed_at',
  'close_reason', 'notes', 'created_at', 'updated_at',
  // The booking flow (20261204090000).
  'addons', 'address', 'city', 'postal_code', 'socials', 'documents', 'hold_expires_at',
].join(', ');

const text = (v, max) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

// ── Shapes ────────────────────────────────────────────────────────────────
function shapeBooth(b, { taken = 0, offered = 0, held = 0 } = {}) {
  return {
    id: b.id,
    name: b.name,
    description: b.description || null,
    sizeLabel: b.size_label || null,
    priceCents: Number(b.price_cents),
    quantity: b.quantity ?? null,
    taken,
    offered,
    // Reservations being paid for right now (instant booking): they count
    // against what is left until they are paid or run out.
    held,
    remaining: b.quantity === null || b.quantity === undefined ? null : Math.max(0, b.quantity - taken - held),
    imageUrl: b.image_url || null,
    imagePath: b.image_path || null,
    staffPasses: b.staff_passes,
    includes: Array.isArray(b.includes) ? b.includes : [],
    color: b.color || null,
    isPublic: b.is_public,
    isActive: b.is_active,
    sortOrder: b.sort_order,
  };
}

function shapeApp(a, { boothNames = new Map(), full = false } = {}) {
  const base = {
    id: a.id,
    stage: a.stage,
    status: R.status(a),
    column: R.boardColumn(a),
    source: a.source,
    businessName: a.business_name,
    contactName: a.contact_name,
    contactEmail: a.contact_email,
    category: a.category,
    requestedBoothTypeId: a.requested_booth_type_id,
    requestedBoothName: boothNames.get(a.requested_booth_type_id) || null,
    boothTypeId: a.booth_type_id,
    boothName: boothNames.get(a.booth_type_id) || null,
    boothLabel: a.booth_label,
    boothKey: a.booth_key || null,
    amountCents: Number(a.amount_cents),
    paidCents: Number(a.paid_cents),
    currency: a.currency,
    offerExpiresAt: a.offer_expires_at,
    expired: R.isExpired(a),
    acceptedAt: a.accepted_at,
    paidAt: a.paid_at,
    staffCount: Array.isArray(a.staff) ? a.staff.length : 0,
    staffPasses: a.staff_passes,
    logoUrl: a.logo_url,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
  if (!full) return base;
  return {
    ...base,
    contactPhone: a.contact_phone,
    website: a.website,
    description: a.description,
    answers: Array.isArray(a.answers) ? a.answers : [],
    includes: Array.isArray(a.includes) ? a.includes : [],
    terms: a.terms,
    offerSentAt: a.offer_sent_at,
    signerName: a.signer_name,
    signerEmail: a.signer_email,
    signatureMethod: a.signature_method,
    signatureSvg: a.signature_svg,
    signatureSha256: a.signature_sha256,
    paidMethod: a.paid_method,
    paidReference: a.paid_reference,
    platformFeeCents: Number(a.platform_fee_cents || 0),
    staff: Array.isArray(a.staff) ? a.staff : [],
    listed: a.listed,
    closeReason: a.close_reason,
    notes: a.notes,
    addons: Array.isArray(a.addons) ? a.addons : [],
    address: a.address || null,
    city: a.city || null,
    postalCode: a.postal_code || null,
    socials: a.socials && typeof a.socials === 'object' ? a.socials : {},
    // The storage key stays on the server; a file opens through a signed link.
    documents: (Array.isArray(a.documents) ? a.documents : []).map(({ path, ...d }) => ({ ...d, uploaded: !!path })),
  };
}

// ── Shared reads ──────────────────────────────────────────────────────────
async function loadApp(eventId, appId) {
  const { data, error } = await supabase.from('vendor_applications').select(APP_COLUMNS)
    .eq('id', appId).eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That vendor application does not exist.');
  return data;
}

async function boothNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('vendor_booth_types').select('id, name').in('id', unique);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((b) => [b.id, b.name]));
}

/** Who to write to about an event's vendors: the program's address, else the organizer account's. */
async function organizerContact(event) {
  const contact = await S.organizerContact(event);
  const { data: program } = await supabase.from('vendor_programs').select('contact_email').eq('event_id', event.id).maybeSingle();
  return { ...contact, email: program?.contact_email || contact.email };
}

// ── The program ───────────────────────────────────────────────────────────
function shapeProgram(p) {
  return {
    isOpen: !!p?.is_open,
    headline: p?.headline || null,
    intro: p?.intro || null,
    applicationsCloseAt: p?.applications_close_at || null,
    acceptingApplications: R.applicationsOpen(p),
    categories: Array.isArray(p?.categories) ? p.categories : [],
    questions: Array.isArray(p?.questions) ? p.questions : [],
    contactEmail: p?.contact_email || null,
    defaultTerms: p?.default_terms || null,
    paymentInstructions: p?.payment_instructions || null,
    vendorInfo: p?.vendor_info || null,
    bookingMode: p?.booking_mode === 'instant' ? 'instant' : 'apply',
    holdMinutes: Number(p?.hold_minutes) || 20,
    documents: Array.isArray(p?.documents) ? p.documents : [],
    highlights: Array.isArray(p?.highlights) ? p.highlights : [],
    photos: Array.isArray(p?.photos) ? p.photos : [],
  };
}

/** An image the organizer uploaded for this event's vendors (booth photo, page photo). */
function ownImage(eventId, path) {
  if (!R.ownVendorLogo(eventId, path)) throw fail('VALIDATION_ERROR', 'That image does not belong to this event.');
  return { url: media.publicUrl(path), path };
}

async function readProgram(eventId) {
  const { data, error } = await supabase.from('vendor_programs').select('*').eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getProgram(eventId) {
  return shapeProgram(await readProgram(eventId));
}

async function saveProgram(eventId, body) {
  const row = { event_id: eventId, updated_at: new Date().toISOString() };
  if (body.isOpen !== undefined) row.is_open = body.isOpen === true;
  if (body.headline !== undefined) row.headline = text(body.headline, 120);
  if (body.intro !== undefined) row.intro = text(body.intro, 3000);
  if (body.applicationsCloseAt !== undefined) {
    const at = body.applicationsCloseAt ? new Date(body.applicationsCloseAt) : null;
    if (at && Number.isNaN(at.getTime())) throw fail('VALIDATION_ERROR', 'Enter a valid closing date.');
    row.applications_close_at = at ? at.toISOString() : null;
  }
  if (body.categories !== undefined) row.categories = R.cleanList(body.categories, { max: R.MAX_CATEGORIES, each: 60, what: 'categories' });
  if (body.questions !== undefined) row.questions = R.cleanQuestions(body.questions);
  if (body.contactEmail !== undefined) row.contact_email = text(body.contactEmail, 254)?.toLowerCase() || null;
  if (body.defaultTerms !== undefined) row.default_terms = text(body.defaultTerms, 20000);
  if (body.paymentInstructions !== undefined) row.payment_instructions = text(body.paymentInstructions, 2000);
  if (body.vendorInfo !== undefined) row.vendor_info = text(body.vendorInfo, 4000);
  if (body.bookingMode !== undefined) {
    if (!R.BOOKING_MODES.includes(body.bookingMode)) throw fail('VALIDATION_ERROR', 'Choose how vendors book.');
    row.booking_mode = body.bookingMode;
  }
  if (body.holdMinutes !== undefined) {
    const m = Number(body.holdMinutes);
    if (!Number.isInteger(m) || m < 10 || m > 60) throw fail('VALIDATION_ERROR', 'Hold a booth for 10 to 60 minutes.');
    row.hold_minutes = m;
  }
  if (body.documents !== undefined) row.documents = R.cleanDocumentSpec(body.documents);
  if (body.highlights !== undefined) row.highlights = R.cleanHighlights(body.highlights);
  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > 3) throw fail('VALIDATION_ERROR', 'Up to 3 photos.');
    row.photos = body.photos.map((p) => ownImage(eventId, typeof p === 'string' ? p : p?.path));
  }
  const { data, error } = await supabase.from('vendor_programs').upsert(row, { onConflict: 'event_id' }).select('*').single();
  if (error) throw new Error(error.message);
  if (body.isOpen !== undefined) {
    const { data: ev } = await supabase.from('events').select('slug').eq('id', eventId).maybeSingle();
    await S.revalidateEvent(ev?.slug);
  }
  return shapeProgram(data);
}

// ── Booth types ───────────────────────────────────────────────────────────
async function boothCounts(ids) {
  const taken = new Map();
  const offered = new Map();
  const held = new Map();
  if (!ids.length) return { taken, offered, held };
  const { data, error } = await supabase.from('vendor_applications').select('booth_type_id, stage, hold_expires_at')
    .in('booth_type_id', ids).in('stage', ['confirmed', 'offered', 'held']);
  if (error) throw new Error(error.message);
  const now = Date.now();
  for (const a of data || []) {
    // A hold past its time counts for nothing, whether or not it has been marked.
    if (a.stage === 'held' && !(a.hold_expires_at && new Date(a.hold_expires_at).getTime() > now)) continue;
    const m = a.stage === 'confirmed' ? taken : a.stage === 'held' ? held : offered;
    m.set(a.booth_type_id, (m.get(a.booth_type_id) || 0) + 1);
  }
  return { taken, offered, held };
}

async function listBooths(eventId, { publicOnly = false } = {}) {
  let q = supabase.from('vendor_booth_types').select(BOOTH_COLUMNS).eq('event_id', eventId);
  if (publicOnly) q = q.eq('is_public', true).eq('is_active', true);
  const { data, error } = await q.order('sort_order').order('price_cents', { ascending: false });
  if (error) throw new Error(error.message);
  const { taken, offered, held } = await boothCounts((data || []).map((b) => b.id));
  return (data || []).map((b) => shapeBooth(b, { taken: taken.get(b.id) || 0, offered: offered.get(b.id) || 0, held: held.get(b.id) || 0 }));
}

function boothRow(body, { partial = false, eventId = null } = {}) {
  const row = {};
  if (!partial || body.name !== undefined) row.name = String(body.name || '').trim();
  if (!partial || body.description !== undefined) row.description = text(body.description, 600);
  if (!partial || body.sizeLabel !== undefined) row.size_label = text(body.sizeLabel, 40);
  if (!partial || body.priceCents !== undefined) row.price_cents = Number(body.priceCents);
  if (!partial || body.quantity !== undefined) {
    row.quantity = body.quantity === null || body.quantity === '' || body.quantity === undefined ? null : Number(body.quantity);
  }
  if (!partial || body.staffPasses !== undefined) row.staff_passes = body.staffPasses === undefined ? 2 : Number(body.staffPasses);
  if (!partial || body.includes !== undefined) row.includes = R.cleanList(body.includes, { what: 'inclusions' });
  if (body.color !== undefined) row.color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? String(body.color).toLowerCase() : null;
  if (body.isPublic !== undefined) row.is_public = body.isPublic === true;
  if (body.isActive !== undefined) row.is_active = body.isActive === true;
  if (body.sortOrder !== undefined) row.sort_order = Number(body.sortOrder);
  if (body.imagePath !== undefined) {
    if (!body.imagePath) Object.assign(row, { image_url: null, image_path: null });
    else {
      const img = ownImage(eventId, body.imagePath);
      Object.assign(row, { image_url: img.url, image_path: img.path });
    }
  }
  return row;
}

async function createBooth(eventId, body) {
  const { data, error } = await supabase.from('vendor_booth_types')
    .insert({ event_id: eventId, ...boothRow(body, { eventId }) }).select(BOOTH_COLUMNS).single();
  if (error) throw new Error(error.message);
  return shapeBooth(data);
}

async function updateBooth(eventId, boothId, body) {
  const row = boothRow(body, { partial: true, eventId });
  const { taken } = await boothCounts([boothId]);
  const confirmed = taken.get(boothId) || 0;
  if (row.quantity !== undefined && row.quantity !== null && row.quantity < confirmed) {
    throw fail('CONFLICT', `${confirmed} ${confirmed === 1 ? 'vendor has' : 'vendors have'} already booked this, so it cannot offer fewer than ${confirmed}.`);
  }
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('vendor_booth_types').update(row)
    .eq('id', boothId).eq('event_id', eventId).select(BOOTH_COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That booth type does not exist.');
  return shapeBooth(data, { taken: confirmed });
}

/** A booth type with offers or bookings is taken off sale, never deleted. */
async function removeBooth(eventId, boothId) {
  const { count, error: countError } = await supabase.from('vendor_applications')
    .select('id', { count: 'exact', head: true }).eq('booth_type_id', boothId);
  if (countError) throw new Error(countError.message);
  if (count > 0) {
    const { error } = await supabase.from('vendor_booth_types')
      .update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', boothId).eq('event_id', eventId);
    if (error) throw new Error(error.message);
    return { removed: false, deactivated: true };
  }
  const { data, error } = await supabase.from('vendor_booth_types').delete().eq('id', boothId).eq('event_id', eventId).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw fail('NOT_FOUND', 'That booth type does not exist.');
  return { removed: true, deactivated: false };
}

// ── Applications ──────────────────────────────────────────────────────────
async function listApplications(eventId) {
  const { data, error } = await supabase.from('vendor_applications').select(APP_COLUMNS)
    .eq('event_id', eventId)
    // Drafts, reservations in progress and lapsed ones are the vendor's, not applications.
    .not('stage', 'in', '(draft,held,expired)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const apps = data || [];
  const names = await boothNames(apps.flatMap((a) => [a.booth_type_id, a.requested_booth_type_id]));
  const event = await S.eventFor(eventId);
  const confirmed = apps.filter((a) => a.stage === 'confirmed');
  return {
    currency: event.currency,
    columns: R.BOARD,
    totals: {
      newCount: apps.filter((a) => a.stage === 'submitted').length,
      booked: confirmed.length,
      paidCents: confirmed.reduce((s, a) => s + Number(a.paid_cents), 0),
      outstandingCents: confirmed.reduce((s, a) => s + (a.paid_at ? 0 : Number(a.amount_cents)), 0),
      offeredCents: apps.filter((a) => a.stage === 'offered').reduce((s, a) => s + Number(a.amount_cents), 0),
    },
    applications: apps.map((a) => shapeApp(a, { boothNames: names })),
  };
}

async function history(appId) {
  const { data, error } = await supabase.from('vendor_application_events')
    .select('id, kind, actor_id, detail, created_at').eq('application_id', appId).order('created_at');
  if (error) throw new Error(error.message);
  const ids = [...new Set((data || []).map((e) => e.actor_id).filter(Boolean))];
  const names = new Map();
  if (ids.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
    for (const p of people || []) names.set(p.id, p.full_name || p.email);
  }
  return (data || []).map((e) => ({ id: e.id, kind: e.kind, at: e.created_at, by: e.actor_id ? names.get(e.actor_id) || null : null, detail: e.detail || {} }));
}

async function getApplication(eventId, appId) {
  const app = await loadApp(eventId, appId);
  const [names, events] = await Promise.all([boothNames([app.booth_type_id, app.requested_booth_type_id]), history(app.id)]);
  return { ...shapeApp(app, { boothNames: names, full: true }), history: events };
}

/** A vendor the organizer adds by hand (a regular from last year). */
async function createApplication(eventId, body, actorId) {
  const event = await S.eventFor(eventId);
  const row = {
    event_id: eventId,
    source: 'organizer',
    currency: event.currency,
    business_name: String(body.businessName || '').trim().slice(0, 120),
    contact_email: String(body.contactEmail || '').trim().toLowerCase(),
    contact_name: text(body.contactName, 120),
    contact_phone: text(body.contactPhone, 30),
    website: text(body.website, 2000),
    category: text(body.category, 60),
    description: text(body.description, 1000),
    notes: text(body.notes, 4000),
  };
  const { data, error } = await supabase.from('vendor_applications').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  await supabase.from('vendor_application_events').insert({ application_id: data.id, kind: 'created', actor_id: actorId || null });
  return getApplication(eventId, data.id);
}

/** Edits that change no money: contact (until accepted), booth number, notes, directory display. */
async function updateApplication(eventId, appId, body) {
  const app = await loadApp(eventId, appId);
  const row = {};
  const contact = {};
  if (body.businessName !== undefined) contact.business_name = String(body.businessName || '').trim().slice(0, 120);
  if (body.contactEmail !== undefined) contact.contact_email = String(body.contactEmail || '').trim().toLowerCase();
  if (body.contactName !== undefined) contact.contact_name = text(body.contactName, 120);
  if (body.contactPhone !== undefined) contact.contact_phone = text(body.contactPhone, 30);
  if (body.website !== undefined) contact.website = text(body.website, 2000);
  if (Object.keys(contact).length && !R.OPEN_STAGES.includes(app.stage)) {
    throw fail('VENDOR_WRONG_STAGE', 'The vendor has accepted, so the business and contact on the booking can no longer change.');
  }
  Object.assign(row, contact);
  if (body.category !== undefined) row.category = text(body.category, 60);
  if (body.description !== undefined) row.description = text(body.description, 1000);
  if (body.boothLabel !== undefined) row.booth_label = text(body.boothLabel, 40);
  if (body.notes !== undefined) row.notes = text(body.notes, 4000);
  if (body.listed !== undefined) row.listed = body.listed === true;
  if (body.logoPath !== undefined) {
    if (!body.logoPath) Object.assign(row, { logo_path: null, logo_url: null });
    else if (R.ownVendorLogo(eventId, body.logoPath)) Object.assign(row, { logo_path: body.logoPath, logo_url: media.publicUrl(body.logoPath) });
    else throw fail('VALIDATION_ERROR', 'That logo does not belong to this event.');
  }
  if (!Object.keys(row).length) return getApplication(eventId, appId);
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from('vendor_applications').update(row).eq('id', appId).eq('event_id', eventId);
  if (error) throw new Error(error.message);
  return getApplication(eventId, appId);
}

/** Put an application on the waitlist (or back to new). No money, no lock needed beyond the stage. */
async function setWaitlist(eventId, appId, waitlisted, actorId) {
  const app = await loadApp(eventId, appId);
  const from = waitlisted ? 'submitted' : 'waitlisted';
  if (app.stage !== from) throw fail('VENDOR_WRONG_STAGE', waitlisted ? 'Only a new application can be waitlisted.' : 'This application is not on the waitlist.');
  const { data, error } = await supabase.from('vendor_applications')
    .update({ stage: waitlisted ? 'waitlisted' : 'submitted', updated_at: new Date().toISOString() })
    .eq('id', appId).eq('event_id', eventId).eq('stage', from).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw fail('VENDOR_WRONG_STAGE', 'The application changed; reload it.');
  await supabase.from('vendor_application_events').insert({ application_id: appId, kind: waitlisted ? 'waitlisted' : 'unwaitlisted', actor_id: actorId || null });
  return getApplication(eventId, appId);
}

/** Offer a space (or revise the offer). Emails the vendor. */
async function sendOffer(eventId, appId, body, actorId) {
  const app = await loadApp(eventId, appId);
  const event = await S.eventFor(eventId);
  // A booth picked on the floor plan brings its code and, unless the organizer
  // chose otherwise, its booth type.
  let spot = null;
  if (body.boothKey) {
    const { plan } = await readFloorPlan(eventId);
    spot = FP.findBooth(plan, body.boothKey);
    if (!spot) throw fail('NOT_FOUND', 'That booth is not on the floor plan any more. Reload and choose again.');
    if (spot.blocked) throw fail('VENDOR_BOOTH_TAKEN', 'That booth is marked unavailable on the floor plan.');
  }
  const boothTypeId = body.boothTypeId || spot?.boothTypeId;
  if (!boothTypeId) throw fail('VALIDATION_ERROR', 'Choose a booth type, or give this booth a type on the floor plan.');
  const { data: booth } = await supabase.from('vendor_booth_types').select(BOOTH_COLUMNS)
    .eq('id', boothTypeId).eq('event_id', eventId).maybeSingle();
  if (!booth) throw fail('NOT_FOUND', 'Choose a booth type from this event.');
  // The add-ons the vendor asked for join the booth fee unless the organizer sets the amount.
  const amount = body.amountCents === undefined || body.amountCents === null
    ? Number(booth.price_cents) + R.addonsTotal(app.addons) : Number(body.amountCents);
  if (!Number.isInteger(amount) || amount < 0) throw fail('VALIDATION_ERROR', 'The booth fee must be a whole number of cents.');
  const expires = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expires && (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now())) {
    throw fail('VALIDATION_ERROR', 'The reply-by date has to be in the future.');
  }
  const terms = text(body.terms, 20000);
  if (!terms) throw fail('VALIDATION_ERROR', 'Write the vendor terms they will sign.');
  const passes = body.staffPasses === undefined || body.staffPasses === null ? booth.staff_passes : Number(body.staffPasses);
  const includes = body.includes === undefined ? (booth.includes || []) : R.cleanList(body.includes, { what: 'inclusions' });

  const { error } = await supabase.rpc('vendor_send_offer', {
    p_application_id: app.id,
    p_actor: actorId || null,
    p_booth_type_id: booth.id,
    p_amount_cents: amount,
    p_currency: event.currency,
    p_booth_label: text(body.boothLabel, 40) || (spot ? text(spot.code, 40) : null),
    p_staff_passes: passes,
    p_includes: includes,
    p_terms: terms,
    p_expires_at: expires ? expires.toISOString() : null,
    p_booth_key: spot ? spot.id : null,
  });
  if (error) throw R.fromDb(error);

  const fresh = await loadApp(eventId, appId);
  const contact = await organizerContact(event);
  await emails.offer({
    to: fresh.contact_email, contactName: fresh.contact_name, event: { ...event, venue: event.venue_name },
    organizerName: contact.name, app: fresh, boothName: booth.name, revised: app.stage === 'offered',
  });
  return getApplication(eventId, appId);
}

async function recordOfflinePayment(eventId, appId, body, actorId) {
  const app = await loadApp(eventId, appId);
  if (!R.OFFLINE_METHODS.includes(body.method)) throw fail('VALIDATION_ERROR', 'Choose how the payment was made.');
  const { error } = await supabase.rpc('vendor_record_payment', {
    p_application_id: app.id, p_method: body.method, p_amount_cents: Number(app.amount_cents),
    p_reference: text(body.reference, 120), p_actor: actorId || null,
    p_session: null, p_account: null, p_payment_intent: null, p_fee_cents: 0,
  });
  if (error) throw R.fromDb(error);
  await notifyPaid(eventId, appId);
  return getApplication(eventId, appId);
}

/** Both sides hear the booth fee arrived; the directory may now list the vendor. */
async function notifyPaid(eventId, appId) {
  try {
    const [app, event, program] = await Promise.all([loadApp(eventId, appId), S.eventFor(eventId), readProgram(eventId)]);
    const contact = await organizerContact(event);
    const ev = { ...event, venue: event.venue_name };
    await Promise.all([
      emails.paid({ to: contact.email, name: contact.name, event: ev, app, forOrganizer: true }),
      emails.paid({ to: app.contact_email, name: app.contact_name, event: ev, app, forOrganizer: false, vendorInfo: program?.vendor_info || null }),
    ]);
    await S.revalidateEvent(event.slug);
  } catch (err) {
    logger.warn({ err: err.message, appId }, 'vendor payment notice failed');
  }
}

async function close(eventId, appId, outcome, reason, actorId, { notify = true } = {}) {
  const app = await loadApp(eventId, appId);
  const { error } = await supabase.rpc('vendor_close', {
    p_application_id: app.id, p_actor: actorId || null, p_outcome: outcome, p_reason: text(reason, 500),
  });
  if (error) throw R.fromDb(error);
  const event = await S.eventFor(eventId);
  if (notify && outcome !== 'withdrawn') {
    const contact = await organizerContact(event);
    await emails.closed({
      to: app.contact_email, contactName: app.contact_name, event: { ...event, venue: event.venue_name },
      organizerName: contact.name, outcome, reason: text(reason, 500),
    });
  }
  if (app.paid_at) await S.revalidateEvent(event.slug);
  return getApplication(eventId, appId);
}

/** The door list: every booked vendor and the staff they named. */
async function doorList(eventId) {
  const { data, error } = await supabase.from('vendor_applications')
    .select('id, business_name, booth_label, booth_type_id, staff, staff_passes, contact_name, contact_phone, paid_at, amount_cents')
    .eq('event_id', eventId).eq('stage', 'confirmed').order('booth_label', { nullsFirst: false }).order('business_name');
  if (error) throw new Error(error.message);
  const names = await boothNames((data || []).map((a) => a.booth_type_id));
  return (data || []).map((a) => ({
    id: a.id,
    businessName: a.business_name,
    boothLabel: a.booth_label,
    boothName: names.get(a.booth_type_id) || null,
    contactName: a.contact_name,
    contactPhone: a.contact_phone,
    staff: Array.isArray(a.staff) ? a.staff : [],
    staffPasses: a.staff_passes,
    paid: !!a.paid_at,
  }));
}

// ── The floor plan ────────────────────────────────────────────────────────
/** Applications holding a booth on the plan: offered or accepted. */
async function boothClaims(eventId) {
  const { data, error } = await supabase.from('vendor_applications')
    .select('id, booth_key, stage, paid_at, business_name, category, listed, hold_expires_at')
    .eq('event_id', eventId).not('booth_key', 'is', null).in('stage', ['offered', 'held', 'confirmed']);
  if (error) throw new Error(error.message);
  const now = Date.now();
  // A reservation claims its booth only while its hold lasts.
  return (data || []).filter((c) => c.stage !== 'held' || (c.hold_expires_at && new Date(c.hold_expires_at).getTime() > now));
}

async function readFloorPlan(eventId) {
  const { data, error } = await supabase.from('vendor_floor_plans').select('plan, version, updated_at').eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  const plan = data?.plan && Array.isArray(data.plan.elements) ? data.plan : { ...FP.DEFAULT_SIZE, elements: [] };
  return { plan, version: data?.version || 0, updatedAt: data?.updated_at || null };
}

/**
 * THE SEAT MAP UNDER THE BOOTHS (2026-11-22). A reserved-seating event's booths
 * are drawn on its venue map (`plan.onSeatMap`), so whoever looks at them —
 * the public vendor page, a vendor's booking, the organizer's booth picker —
 * sees the room they stand in: the map's world, its zones (stage, walls,
 * doors) and its tables. Never prices, seats or who bought them.
 *
 * `null` for an event with no map: a listing-only event cannot have one
 * (save_venue_map refuses), and its floor plan stands alone. A
 * general-admission event has one since 2026-11-23 — the room without seats. Private tables are drawn
 * for everyone, flagged `isPrivate` (2026-11-24); they were left out of the public plan before.
 */
async function seatMapContext(eventId, { includePrivate = false } = {}) {
  const { data: event, error: eventError } = await supabase.from('events')
    .select('admission_type, listing_type').eq('id', eventId).maybeSingle();
  if (eventError) throw new Error(eventError.message);
  if (!event || !hasSeatMap(event)) return null;
  const { data: map, error: mapError } = await supabase.from('venue_maps')
    .select('id, layout_json').eq('event_id', eventId).maybeSingle();
  if (mapError) throw new Error(mapError.message);
  if (!map) return { world: null, zones: [], look: null, tableStyles: null, tables: [] };
  const tables = await fetchAll(({ from, to }, first) => supabase.from('tables')
    .select('id, label, seat_count, shape, position_x, position_y, rotation, is_private', first ? { count: 'exact' } : undefined)
    .eq('venue_map_id', map.id).order('id').range(from, to), { what: 'tables' });
  // PRIVATE TABLES ARE SHOWN, MARKED (owner, 2026-11-24): on every map a
  // private table stays visible as Private — here, scenery with no price or
  // stock in it. `includePrivate` is kept for its callers; it no longer
  // changes what is drawn.
  void includePrivate;
  const visible = tables;
  const layout = publicLayout(map.layout_json || {}, visible.map((t) => t.label)) || {};
  return {
    world: layout.world || null,
    zones: Array.isArray(layout.zones) ? layout.zones : [],
    look: layout.look || null,
    tableStyles: layout.tableStyles || null,
    tables: visible.map((t) => ({
      label: t.label,
      seatCount: t.seat_count,
      shape: t.shape,
      ...(t.is_private ? { isPrivate: true } : {}),
      position: { x: Number(t.position_x), y: Number(t.position_y), rotation: Number(t.rotation) || 0 },
    })),
  };
}

/**
 * Whether a vendor can book a booth from the buyers' map right now
 * (2026-11-23): the program is open and still taking vendors, and which booth
 * types — public, active, not sold out — a tapped booth may be booked as.
 * The map shows "Reserve this booth" only for those; the booking itself is
 * checked again by vendorBookingService.start.
 */
async function bookingInfo(eventId) {
  const program = await readProgram(eventId);
  if (!program?.is_open || !R.applicationsOpen(program)) return { open: false, mode: null, types: [] };
  const booths = await listBooths(eventId, { publicOnly: true });
  return {
    open: true,
    mode: program.booking_mode === 'instant' ? 'instant' : 'apply',
    types: booths.filter((b) => b.remaining !== 0).map((b) => b.id),
  };
}

/**
 * True for an event that may have an event map (the rule save_venue_map
 * applies). Every ticketed event since 2026-11-23 (migration
 * 20261212090000): a general-admission event's map has its stage, areas and
 * vendor booths, and no seats. Only a listing-only event has none.
 */
function hasSeatMap(event) {
  return event.listing_type !== 'display_only';
}

/**
 * The organizer's view: the plan, every booth's state with vendor names, and
 * the booth types. `seatMap` says whether this event's booths belong on its
 * venue map (a reserved-seating event) — the Floor plan tab then sends the
 * organizer there — and `venue` is that map, when the booths are on it.
 */
async function getFloorPlan(eventId) {
  const [{ plan, version, updatedAt }, claims, booths, event] = await Promise.all([
    readFloorPlan(eventId), boothClaims(eventId), listBooths(eventId),
    supabase.from('events').select('admission_type, listing_type').eq('id', eventId).maybeSingle()
      .then(({ data, error }) => { if (error) throw new Error(error.message); return data; }),
  ]);
  const seatMap = !!event && hasSeatMap(event);
  const venue = seatMap && plan.onSeatMap ? await seatMapContext(eventId, { includePrivate: true }) : null;
  return {
    plan, version, updatedAt, booths: FP.boothStatuses(plan, claims, { audience: 'organizer' }), boothTypes: booths, seatMap, venue,
  };
}

/**
 * Save the whole plan. `version` is the one the editor loaded: a plan saved
 * from another tab in between is refused rather than overwritten. A booth an
 * application still holds cannot be deleted.
 */
async function saveFloorPlan(eventId, body, actorId) {
  const plan = FP.cleanPlan(body.plan);
  if (plan.onSeatMap) {
    const { data: ev, error: evError } = await supabase.from('events')
      .select('admission_type, listing_type').eq('id', eventId).maybeSingle();
    if (evError) throw new Error(evError.message);
    if (!ev || !hasSeatMap(ev)) {
      throw fail('VALIDATION_ERROR', 'This event is listed for information only, so it has no event map. Its booths are drawn on the floor plan instead.');
    }
  }
  const current = await readFloorPlan(eventId);
  const stale = 'The floor plan was saved somewhere else since you opened it. Reload it, then make your change again.';
  if (Number(body.version) !== current.version) throw fail('CONFLICT', stale);
  const lost = FP.removedClaimedBooths(plan, await boothClaims(eventId));
  if (lost.length) {
    const names = lost.slice(0, 5).map((c) => c.business_name).join(', ');
    const what = lost.length === 1 ? 'a booth' : `${lost.length} booths`;
    throw fail('CONFLICT', `You removed ${what} offered to or booked by a vendor (${names}). Move the booth instead, or close the offer first.`);
  }
  const row = { event_id: eventId, plan, version: current.version + 1, updated_by: actorId || null, updated_at: new Date().toISOString() };
  const q = current.version === 0
    ? supabase.from('vendor_floor_plans').insert(row)
    : supabase.from('vendor_floor_plans').update(row).eq('event_id', eventId).eq('version', current.version);
  const { data, error } = await q.select('version');
  if (error) {
    if (error.code === '23505') throw fail('CONFLICT', stale);
    throw new Error(error.message);
  }
  if (!data?.length) throw fail('CONFLICT', stale);
  const { data: ev } = await supabase.from('events').select('slug').eq('id', eventId).maybeSingle();
  await S.revalidateEvent(ev?.slug);
  return getFloorPlan(eventId);
}

/** The plan for the public page or a vendor: names only where the audience may see them. */
async function floorPlanFor(eventId, { audience = 'public', mine = null, withVenue = true } = {}) {
  const { plan } = await readFloorPlan(eventId);
  if (!FP.boothsOf(plan).length) return null;
  const [claims, booths, venue] = await Promise.all([
    boothClaims(eventId), listBooths(eventId),
    // Booths on the seat map are shown in their room (seatMapContext).
    withVenue && plan.onSeatMap ? seatMapContext(eventId) : null,
  ]);
  return {
    plan,
    booths: FP.boothStatuses(plan, claims, { audience, mine }),
    boothTypes: booths.map((b) => ({ id: b.id, name: b.name, color: b.color, priceCents: b.priceCents, sizeLabel: b.sizeLabel })),
    ...(venue ? { venue } : {}),
  };
}

function signLogoUpload(eventId, contentType) {
  return media.signUpload({ eventId, contentType: String(contentType || '').toLowerCase(), kind: 'vendor' });
}
async function confirmLogo(eventId, path) {
  if (!R.ownVendorLogo(eventId, path)) throw fail('VALIDATION_ERROR', 'That logo does not belong to this event.');
  return media.attach({ eventId, path });
}

module.exports = {
  APP_COLUMNS, BOOTH_COLUMNS, loadApp, boothNames, organizerContact, readProgram, shapeProgram, shapeBooth,
  notifyPaid, signLogoUpload, confirmLogo, close,
  getProgram, saveProgram, listBooths, createBooth, updateBooth, removeBooth,
  listApplications, getApplication, createApplication, updateApplication, setWaitlist, sendOffer,
  recordOfflinePayment, doorList, getFloorPlan, saveFloorPlan, floorPlanFor, seatMapContext, bookingInfo,
};
