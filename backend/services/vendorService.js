const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const media = require('./mediaService');
const emails = require('./vendorEmails');
const S = require('./sponsorshipService');
const R = require('./vendorRules');

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

const BOOTH_COLUMNS = 'id, event_id, name, description, size_label, price_cents, quantity, staff_passes, includes, is_public, is_active, sort_order';
const APP_COLUMNS = [
  'id', 'event_id', 'company_id', 'stage', 'source', 'business_name', 'contact_name', 'contact_email', 'contact_phone',
  'website', 'category', 'description', 'answers', 'requested_booth_type_id', 'booth_type_id', 'booth_label',
  'amount_cents', 'currency', 'staff_passes', 'includes', 'terms', 'offer_sent_at', 'offer_expires_at', 'accepted_at',
  'signer_name', 'signer_email', 'signature_method', 'signature_svg', 'signature_sha256', 'paid_cents', 'paid_at',
  'paid_method', 'paid_reference', 'platform_fee_cents', 'staff', 'logo_url', 'logo_path', 'listed', 'closed_at',
  'close_reason', 'notes', 'created_at', 'updated_at',
].join(', ');

const text = (v, max) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

// ── Shapes ────────────────────────────────────────────────────────────────
function shapeBooth(b, { taken = 0, offered = 0 } = {}) {
  return {
    id: b.id,
    name: b.name,
    description: b.description || null,
    sizeLabel: b.size_label || null,
    priceCents: Number(b.price_cents),
    quantity: b.quantity ?? null,
    taken,
    offered,
    remaining: b.quantity === null || b.quantity === undefined ? null : Math.max(0, b.quantity - taken),
    staffPasses: b.staff_passes,
    includes: Array.isArray(b.includes) ? b.includes : [],
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
  };
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
  if (!ids.length) return { taken, offered };
  const { data, error } = await supabase.from('vendor_applications').select('booth_type_id, stage')
    .in('booth_type_id', ids).in('stage', ['confirmed', 'offered']);
  if (error) throw new Error(error.message);
  for (const a of data || []) {
    const m = a.stage === 'confirmed' ? taken : offered;
    m.set(a.booth_type_id, (m.get(a.booth_type_id) || 0) + 1);
  }
  return { taken, offered };
}

async function listBooths(eventId, { publicOnly = false } = {}) {
  let q = supabase.from('vendor_booth_types').select(BOOTH_COLUMNS).eq('event_id', eventId);
  if (publicOnly) q = q.eq('is_public', true).eq('is_active', true);
  const { data, error } = await q.order('sort_order').order('price_cents', { ascending: false });
  if (error) throw new Error(error.message);
  const { taken, offered } = await boothCounts((data || []).map((b) => b.id));
  return (data || []).map((b) => shapeBooth(b, { taken: taken.get(b.id) || 0, offered: offered.get(b.id) || 0 }));
}

function boothRow(body, { partial = false } = {}) {
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
  if (body.isPublic !== undefined) row.is_public = body.isPublic === true;
  if (body.isActive !== undefined) row.is_active = body.isActive === true;
  if (body.sortOrder !== undefined) row.sort_order = Number(body.sortOrder);
  return row;
}

async function createBooth(eventId, body) {
  const { data, error } = await supabase.from('vendor_booth_types')
    .insert({ event_id: eventId, ...boothRow(body) }).select(BOOTH_COLUMNS).single();
  if (error) throw new Error(error.message);
  return shapeBooth(data);
}

async function updateBooth(eventId, boothId, body) {
  const row = boothRow(body, { partial: true });
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
    .eq('event_id', eventId).order('updated_at', { ascending: false });
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
  const { data: booth } = await supabase.from('vendor_booth_types').select(BOOTH_COLUMNS)
    .eq('id', body.boothTypeId).eq('event_id', eventId).maybeSingle();
  if (!booth) throw fail('NOT_FOUND', 'Choose a booth type from this event.');
  const amount = body.amountCents === undefined || body.amountCents === null ? Number(booth.price_cents) : Number(body.amountCents);
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
    p_booth_label: text(body.boothLabel, 40),
    p_staff_passes: passes,
    p_includes: includes,
    p_terms: terms,
    p_expires_at: expires ? expires.toISOString() : null,
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
  recordOfflinePayment, doorList,
};
