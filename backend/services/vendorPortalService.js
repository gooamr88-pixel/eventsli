const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { hashIp } = require('../utils/crypto');
const signatures = require('./signatureService');
const stripeSvc = require('./stripeService');
const emails = require('./vendorEmails');
const S = require('./sponsorshipService');
const P = require('./sponsorPortalService');
const V = require('./vendorService');
const R = require('./vendorRules');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDORS — THE VENDOR'S SIDE (2026-11-20), the public page and its form, and
 * the public directory.
 *
 * WHO MAY SEE AN APPLICATION: the person signed in with its contact address
 * (verified at sign-in), or a member of the company it belongs to — the same
 * rule as sponsorships. Anyone else gets "does not exist".
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { fail } = R;
const text = (v, max) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

async function appForUser(user, appId) {
  const { data, error } = await supabase.from('vendor_applications').select(V.APP_COLUMNS).eq('id', appId).maybeSingle();
  if (error) throw new Error(error.message);
  const companies = data ? await P.companiesOf(user.id) : [];
  if (!data || !P.mayAccess(user, data, companies)) throw fail('NOT_FOUND', 'That vendor application does not exist.');
  return data;
}

/** The vendor's view: no notes, no internal history. */
function shapeForVendor(a, event, { boothName = null, card = null, program = null } = {}) {
  const confirmed = a.stage === 'confirmed';
  return {
    id: a.id,
    stage: a.stage,
    status: R.status(a),
    expired: R.isExpired(a),
    event,
    businessName: a.business_name,
    contactName: a.contact_name,
    contactEmail: a.contact_email,
    category: a.category,
    description: a.description,
    website: a.website,
    answers: Array.isArray(a.answers) ? a.answers : [],
    boothName,
    boothLabel: a.booth_label,
    amountCents: Number(a.amount_cents),
    paidCents: Number(a.paid_cents),
    currency: a.currency,
    staffPasses: a.staff_passes,
    includes: Array.isArray(a.includes) ? a.includes : [],
    terms: ['offered', 'confirmed'].includes(a.stage) || a.accepted_at ? a.terms : null,
    offerSentAt: a.offer_sent_at,
    offerExpiresAt: a.offer_expires_at,
    acceptedAt: a.accepted_at,
    signerName: a.signer_name,
    signatureSvg: a.signature_svg,
    signatureSha256: a.signature_sha256,
    paidAt: a.paid_at,
    paidMethod: a.paid_method,
    staff: Array.isArray(a.staff) ? a.staff : [],
    logoUrl: a.logo_url,
    listed: a.listed,
    closeReason: ['rejected', 'cancelled'].includes(a.stage) ? a.close_reason : null,
    payment: confirmed && !a.paid_at && Number(a.amount_cents) > 0
      ? { card, instructions: program?.payment_instructions || null }
      : null,
    // What to know for the day, once booked.
    vendorInfo: confirmed ? program?.vendor_info || null : null,
  };
}

async function listForUser(user) {
  const companies = await P.companiesOf(user.id);
  const email = String(user.email || '').toLowerCase();
  const reads = [supabase.from('vendor_applications').select(V.APP_COLUMNS).eq('contact_email', email)];
  if (companies.length) reads.push(supabase.from('vendor_applications').select(V.APP_COLUMNS).in('company_id', companies));
  const byId = new Map();
  for (const r of await Promise.all(reads)) {
    if (r.error) throw new Error(r.error.message);
    for (const a of r.data || []) if (P.mayAccess(user, a, companies)) byId.set(a.id, a);
  }
  // A lapsed reservation is nobody's business; a draft or a live hold is shown so it can be finished.
  const apps = [...byId.values()].filter((a) => a.stage !== 'expired').sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const [events, names] = await Promise.all([P.eventsById(apps.map((a) => a.event_id)), V.boothNames(apps.map((a) => a.booth_type_id))]);
  return apps.map((a) => {
    const s = shapeForVendor(a, events.get(a.event_id) || null, { boothName: names.get(a.booth_type_id) || null });
    return {
      id: s.id, stage: s.stage, status: s.status, expired: s.expired, event: s.event, businessName: s.businessName,
      boothName: s.boothName, boothLabel: s.boothLabel, amountCents: s.amountCents, currency: s.currency,
      offerExpiresAt: s.offerExpiresAt, paidAt: s.paidAt,
    };
  });
}

async function getForUser(user, appId) {
  const app = await appForUser(user, appId);
  const [events, names, program, floorPlan] = await Promise.all([
    P.eventsById([app.event_id]), V.boothNames([app.booth_type_id]), V.readProgram(app.event_id),
    // Their booth on the map, once they have one.
    app.booth_key && ['offered', 'confirmed'].includes(app.stage)
      ? V.floorPlanFor(app.event_id, { audience: 'vendor', mine: app.booth_key }) : null,
  ]);
  let card = null;
  if (app.stage === 'confirmed' && !app.paid_at && Number(app.amount_cents) > 0) {
    const { available, reason } = await P.cardAvailability(await S.eventFor(app.event_id));
    card = { available, reason: reason || null };
  }
  return { ...shapeForVendor(app, events.get(app.event_id) || null, { boothName: names.get(app.booth_type_id) || null, card, program }), floorPlan };
}

/** The vendor accepts the offer by signing its terms. */
async function accept(user, appId, { signature, signerName, accept: agreed }, req) {
  if (agreed !== true) throw fail('VALIDATION_ERROR', 'Tick the box to confirm you agree to the vendor terms.');
  const name = String(signerName || '').trim();
  if (name.length < 2 || name.length > 120) throw fail('VALIDATION_ERROR', 'Enter your full name as the person signing.');
  const app = await appForUser(user, appId);
  const sig = signatures.normalize(signature);
  const { error } = await supabase.rpc('vendor_accept', {
    p_application_id: app.id, p_user_id: user.id, p_email: user.email, p_signer_name: name,
    p_method: sig.method, p_svg: signatures.toSvg(sig), p_sha256: signatures.fingerprint(sig),
    p_ip_hash: req ? hashIp(req.ip) : null,
  });
  if (error) throw R.fromDb(error);
  try {
    const [fresh, event] = await Promise.all([V.loadApp(app.event_id, app.id), S.eventFor(app.event_id)]);
    const contact = await V.organizerContact(event);
    await emails.acceptedToOrganizer({ to: contact.email, organizerName: contact.name, event: { ...event, venue: event.venue_name }, app: fresh });
    if (fresh.paid_at) await S.revalidateEvent(event.slug);
  } catch (err) {
    logger.warn({ err: err.message, appId }, 'vendor accepted notice failed');
  }
  return getForUser(user, appId);
}

/** The vendor pulls out before they have accepted. */
async function withdraw(user, appId, reason) {
  const app = await appForUser(user, appId);
  const { error } = await supabase.rpc('vendor_close', {
    p_application_id: app.id, p_actor: user.id, p_outcome: 'withdrawn', p_reason: text(reason, 500),
  });
  if (error) throw R.fromDb(error);
  return getForUser(user, appId);
}

/** What the vendor manages themselves: staff names, the directory listing, logo, description. */
async function updateProfile(user, appId, body) {
  const app = await appForUser(user, appId);
  if (['rejected', 'withdrawn', 'cancelled'].includes(app.stage)) {
    throw fail('VENDOR_WRONG_STAGE', 'This application is closed.');
  }
  const row = { updated_at: new Date().toISOString() };
  if (body.staff !== undefined) {
    if (app.stage !== 'confirmed') throw fail('VENDOR_WRONG_STAGE', 'Add your staff once you have accepted your space.');
    row.staff = R.cleanStaff(body.staff, app.staff_passes);
  }
  if (body.description !== undefined) row.description = text(body.description, 1000);
  if (body.listed !== undefined) row.listed = body.listed === true;
  if (body.logoPath !== undefined) {
    if (!body.logoPath) Object.assign(row, { logo_path: null, logo_url: null });
    else if (R.ownVendorLogo(app.event_id, body.logoPath)) {
      Object.assign(row, { logo_path: body.logoPath, logo_url: require('./mediaService').publicUrl(body.logoPath) });
    } else throw fail('VALIDATION_ERROR', 'That logo does not belong to this event.');
  }
  const { error } = await supabase.from('vendor_applications').update(row).eq('id', app.id);
  if (error) throw new Error(error.message);
  await supabase.from('vendor_application_events').insert({ application_id: app.id, kind: 'profile_updated', actor_id: user.id });
  if (app.paid_at) {
    const event = await S.eventFor(app.event_id);
    await S.revalidateEvent(event.slug);
  }
  return getForUser(user, appId);
}

async function signLogoUpload(user, appId, contentType) {
  const app = await appForUser(user, appId);
  return V.signLogoUpload(app.event_id, contentType);
}
async function confirmLogo(user, appId, path) {
  const app = await appForUser(user, appId);
  return V.confirmLogo(app.event_id, path);
}

// ── Card payment ──────────────────────────────────────────────────────────
async function vendorFeeBps() {
  const { data, error } = await supabase.from('platform_settings').select('value').eq('key', 'vendors').maybeSingle();
  if (error) {
    logger.warn({ err: error.message }, 'vendor fee setting unreadable — charging no platform fee');
    return 0;
  }
  return Number(data?.value?.feeBps) || 0;
}

/** One live Checkout per booking; a new "Pay" expires the previous one first (as for sponsorships). */
async function startCardPayment(user, appId, origin) {
  const app = await appForUser(user, appId);
  if (app.stage !== 'confirmed') throw fail('VENDOR_WRONG_STAGE', 'Accept your offer before paying.');
  if (app.paid_at) throw fail('VENDOR_ALREADY_PAID', 'Your booth fee is already paid.');
  if (Number(app.amount_cents) <= 0) throw fail('VENDOR_WRONG_STAGE', 'There is nothing to pay for this space.');
  const event = await S.eventFor(app.event_id);
  const card = await P.cardAvailability(event);
  if (!card.available) {
    throw fail(card.reason === 'FEATURE_DISABLED' ? 'FEATURE_DISABLED' : 'CARD_NOT_AVAILABLE',
      'Card payment is not available for this booking. Use the payment instructions on this page instead.');
  }
  if (app.pending_session_id) {
    try {
      const previous = await stripeSvc.retrieveSession(app.pending_session_id, app.pending_account_id);
      if (previous?.status === 'complete') {
        throw fail('VENDOR_PAYMENT_PENDING', 'Your payment went through and is being recorded. Refresh this page in a minute.');
      }
      if (previous?.status === 'open') await stripeSvc.expireSession(app.pending_session_id, app.pending_account_id);
    } catch (err) {
      if (err.code === 'VENDOR_PAYMENT_PENDING') throw err;
      logger.warn({ err: err.message, appId }, 'could not check the previous vendor session');
      throw fail('VENDOR_PAYMENT_PENDING', 'We could not confirm your previous payment attempt. Try again in a minute.');
    }
  }
  const names = await V.boothNames([app.booth_type_id]);
  const session = await stripeSvc.createVendorSession({
    app, event, accountId: card.accountId, origin, boothName: names.get(app.booth_type_id) || 'Vendor space',
    feeCents: R.feeFor(app.amount_cents, await vendorFeeBps()), customerEmail: user.email,
    idempotencyKey: `vendor:${app.id}:${crypto.randomUUID()}`,
  });
  const { error } = await supabase.from('vendor_applications')
    .update({ pending_session_id: session.id, pending_account_id: card.accountId })
    .eq('id', app.id).is('paid_at', null);
  if (error) {
    await stripeSvc.expireSession(session.id, card.accountId).catch(() => {});
    throw new Error(error.message);
  }
  return { url: session.url };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isVendorSession = (session) => UUID.test(String(session?.metadata?.vendor_application_id || ''));

/** The webhook's half. → { ok, alreadyPaid?, error?, message?, permanent? } */
async function fulfilFromSession(session, { account }) {
  const appId = session.metadata.vendor_application_id;
  const { data: app, error } = await supabase.from('vendor_applications').select('id, event_id, amount_cents').eq('id', appId).maybeSingle();
  if (error) return { ok: false, error: 'INTERNAL_ERROR', message: error.message };
  if (!app) return { ok: false, error: 'NOT_FOUND', message: 'no such vendor application', permanent: true };
  if (Number(session.amount_total) !== Number(app.amount_cents)) {
    return { ok: false, error: 'FORBIDDEN', message: 'vendor session amount does not match the booth fee', permanent: true };
  }
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const { data: result, error: rpcError } = await supabase.rpc('vendor_record_payment', {
    p_application_id: app.id, p_method: 'card', p_amount_cents: Number(app.amount_cents), p_reference: pi,
    p_actor: null, p_session: session.id, p_account: account, p_payment_intent: pi,
    p_fee_cents: Number(session.payment_intent?.application_fee_amount ?? 0) || 0,
  });
  if (rpcError) {
    const mapped = R.fromDb(rpcError);
    const permanent = ['VENDOR_PAYMENT_MISMATCH', 'VENDOR_ALREADY_PAID', 'VENDOR_NOT_CONFIRMED', 'VENDOR_BAD_AMOUNT', 'VENDOR_NOT_FOUND']
      .includes(mapped.dbCode);
    return { ok: false, error: mapped.code || 'INTERNAL_ERROR', message: mapped.message, permanent };
  }
  if (!result?.alreadyPaid) await V.notifyPaid(app.event_id, app.id);
  return { ok: true, alreadyPaid: !!result?.alreadyPaid };
}

// ── Public page, application form, directory ──────────────────────────────
async function eventBySlug(slug) {
  const { data, error } = await supabase.from('events')
    .select('id, title, slug, starts_at, ends_at, timezone, city, venue_name, cover_url, currency, organizer_id, status')
    .eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== 'published') throw fail('EVENT_NOT_FOUND', 'That event does not exist.');
  return data;
}

/** Booked vendors shown to the public: accepted, paid (or free), and not opted out. */
async function directory(eventId) {
  const { data, error } = await supabase.from('vendor_applications')
    .select('id, business_name, category, description, website, logo_url, booth_label')
    .eq('event_id', eventId).eq('stage', 'confirmed').eq('listed', true).not('paid_at', 'is', null)
    .order('business_name');
  if (error) throw new Error(error.message);
  return (data || []).map((a) => ({
    id: a.id, name: a.business_name, category: a.category, description: a.description,
    website: a.website, logoUrl: a.logo_url, booth: a.booth_label,
  }));
}

async function publicPage(slug) {
  const event = await eventBySlug(slug);
  const program = await V.readProgram(event.id);
  if (!program?.is_open) throw fail('NOT_FOUND', 'This event is not taking vendors right now.');
  const shaped = V.shapeProgram(program);
  const [booths, events, vendors, floorPlan, addons] = await Promise.all([
    V.listBooths(event.id, { publicOnly: true }), P.eventsById([event.id]), directory(event.id),
    V.floorPlanFor(event.id, { audience: 'public' }),
    // Late-bound: the booking service requires this module.
    require('./vendorBookingService').listAddons(event.id, { activeOnly: true }),
  ]);
  return {
    event: { ...events.get(event.id), currency: event.currency },
    headline: shaped.headline,
    intro: shaped.intro,
    acceptingApplications: shaped.acceptingApplications,
    applicationsCloseAt: shaped.applicationsCloseAt,
    categories: shaped.categories,
    questions: shaped.questions,
    booths: booths.map((b) => ({
      id: b.id, name: b.name, description: b.description, sizeLabel: b.sizeLabel, priceCents: b.priceCents,
      staffPasses: b.staffPasses, includes: b.includes, remaining: b.remaining, soldOut: b.remaining === 0,
      imageUrl: b.imageUrl,
    })),
    // The booking flow (2026-11-21).
    bookingMode: shaped.bookingMode,
    holdMinutes: shaped.holdMinutes,
    documents: shaped.documents.map((d) => ({ id: d.id, label: d.label, required: d.required })),
    highlights: shaped.highlights,
    photos: shaped.photos.map((p) => p.url),
    addons: addons.map(({ id, kind, name, description, priceCents }) => ({ id, kind, name, description, priceCents })),
    vendors,
    floorPlan,
  };
}

/** A business applies. Becomes a "New" application on the organizer's board. */
async function apply(slug, body) {
  if (body.website2) return { ok: true }; // honeypot
  const event = await eventBySlug(slug);
  const program = await V.readProgram(event.id);
  if (!program?.is_open) throw fail('NOT_FOUND', 'This event is not taking vendors right now.');
  if (!R.applicationsOpen(program)) throw fail('VENDOR_APPLICATIONS_CLOSED', 'Applications for this event have closed.');

  const questions = Array.isArray(program.questions) ? program.questions : [];
  const answers = R.cleanAnswers(questions, body.answers);
  const categories = Array.isArray(program.categories) ? program.categories : [];
  const category = text(body.category, 60);
  if (categories.length && category && !categories.includes(category)) throw fail('VALIDATION_ERROR', 'Choose a category from the list.');

  let booth = null;
  if (body.boothTypeId) {
    const { data } = await supabase.from('vendor_booth_types').select('id')
      .eq('id', body.boothTypeId).eq('event_id', event.id).eq('is_public', true).eq('is_active', true).maybeSingle();
    booth = data || null;
  }
  const email = String(body.contactEmail || '').trim().toLowerCase();
  const { data: existing } = await supabase.from('vendor_applications').select('id')
    .eq('event_id', event.id).eq('contact_email', email).in('stage', [...R.OPEN_STAGES, 'confirmed']).limit(1);
  if (existing?.length) return { ok: true, duplicate: true };

  const { data: app, error } = await supabase.from('vendor_applications').insert({
    event_id: event.id, source: 'application', currency: event.currency,
    business_name: String(body.businessName || '').trim().slice(0, 120),
    contact_name: text(body.contactName, 120), contact_email: email, contact_phone: text(body.contactPhone, 30),
    website: text(body.website, 2000), category, description: text(body.description, 1000), answers,
    requested_booth_type_id: booth?.id || null,
  }).select(V.APP_COLUMNS).single();
  if (error) throw new Error(error.message);
  await supabase.from('vendor_application_events').insert({ application_id: app.id, kind: 'applied' });

  const contact = await V.organizerContact(event);
  const ev = { ...event, venue: event.venue_name };
  await Promise.all([
    emails.applicationToOrganizer({ to: contact.email, organizerName: contact.name, event: ev, app }),
    emails.applicationReceipt({ to: app.contact_email, contactName: app.contact_name, event: ev, organizerName: contact.name }),
  ]);
  return { ok: true };
}

module.exports = {
  listForUser, getForUser, accept, withdraw, updateProfile, signLogoUpload, confirmLogo, startCardPayment,
  isVendorSession, fulfilFromSession, publicPage, apply, directory, vendorFeeBps,
};
