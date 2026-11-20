const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { hashIp } = require('../utils/crypto');
const signatures = require('./signatureService');
const stripeSvc = require('./stripeService');
const emails = require('./sponsorshipEmails');
const S = require('./sponsorshipService');
const R = require('./sponsorshipRules');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SPONSORSHIPS — THE SPONSOR'S SIDE (2026-11-20), and the public page.
 *
 * WHO MAY SEE A DEAL. The person signed in with the deal's contact address —
 * addresses are verified before anyone can sign in, so holding the session is
 * holding the inbox the proposal went to — or a member of the company the
 * deal belongs to (whoever signed first becomes its owner). Anyone else gets
 * "does not exist", never "not yours": the second confirms a deal is there.
 *
 * What a sponsor never sees: the organizer's notes, the lead's internal
 * history, other sponsors.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { fail } = R;

async function companiesOf(userId) {
  const { data, error } = await supabase.from('partner_members').select('company_id').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data || []).map((m) => m.company_id);
}

function mayAccess(user, deal, companyIds) {
  if (!user?.email) return false;
  if (String(deal.contact_email).toLowerCase() === String(user.email).toLowerCase()) return true;
  return !!deal.company_id && companyIds.includes(deal.company_id);
}

async function dealForUser(user, dealId) {
  const { data, error } = await supabase.from('sponsorship_deals').select(S.DEAL_COLUMNS).eq('id', dealId).maybeSingle();
  if (error) throw new Error(error.message);
  const companies = data ? await companiesOf(user.id) : [];
  if (!data || !mayAccess(user, data, companies)) throw fail('NOT_FOUND', 'That sponsorship does not exist.');
  return data;
}

async function eventsById(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('events')
    .select('id, title, slug, starts_at, timezone, city, venue_name, cover_url, organizer_id').in('id', unique);
  if (error) throw new Error(error.message);
  const orgIds = [...new Set((data || []).map((e) => e.organizer_id))];
  const { data: orgs } = orgIds.length
    ? await supabase.from('organizers').select('id, display_name').in('id', orgIds)
    : { data: [] };
  const orgName = new Map((orgs || []).map((o) => [o.id, o.display_name]));
  return new Map((data || []).map((e) => [e.id, {
    id: e.id, title: e.title, slug: e.slug, startsAt: e.starts_at, timezone: e.timezone,
    city: e.city, venueName: e.venue_name, coverUrl: e.cover_url || null, organizerName: orgName.get(e.organizer_id) || null,
  }]));
}

/** The sponsor's view of a deal: no notes, no internal history. */
function shapeForSponsor(d, event, { installments = [], card = null, paymentInstructions = null } = {}) {
  const status = R.status(d);
  return {
    id: d.id,
    stage: d.stage,
    status,
    expired: R.isExpired(d),
    event,
    companyName: d.company_name,
    contactName: d.contact_name,
    contactEmail: d.contact_email,
    level: d.level,
    amountCents: Number(d.amount_cents),
    paidCents: Number(d.paid_cents),
    currency: d.currency,
    benefits: Array.isArray(d.benefits) ? d.benefits : [],
    // The agreement is shown once there is one to read.
    terms: d.stage === 'lead' ? null : d.terms,
    proposalSentAt: d.proposal_sent_at,
    proposalExpiresAt: d.proposal_expires_at,
    signedAt: d.signed_at,
    signerName: d.signer_name,
    signatureSvg: d.signature_svg,
    signatureSha256: d.signature_sha256,
    displayName: d.display_name,
    logoUrl: d.logo_url,
    linkUrl: d.link_url,
    website: d.website,
    published: !!d.event_sponsor_id,
    closedAt: d.closed_at,
    installments: installments.map(S.shapeInstallment),
    payment: d.stage === 'signed' ? { card, instructions: paymentInstructions } : null,
  };
}

// ── The portal ────────────────────────────────────────────────────────────
async function listForUser(user) {
  const companies = await companiesOf(user.id);
  const email = String(user.email || '').toLowerCase();
  // Two narrow reads rather than one OR over user input in a filter string.
  // Contact addresses are stored lower-cased (sponsorshipService, submitInquiry).
  const reads = [supabase.from('sponsorship_deals').select(S.DEAL_COLUMNS).eq('contact_email', email)];
  if (companies.length) reads.push(supabase.from('sponsorship_deals').select(S.DEAL_COLUMNS).in('company_id', companies));
  const results = await Promise.all(reads);
  const byId = new Map();
  for (const r of results) {
    if (r.error) throw new Error(r.error.message);
    for (const d of r.data || []) if (mayAccess(user, d, companies)) byId.set(d.id, d);
  }
  const deals = [...byId.values()].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const [events, plans] = await Promise.all([
    eventsById(deals.map((d) => d.event_id)),
    S.installmentsOf(deals.map((d) => d.id)),
  ]);
  return deals.map((d) => {
    const s = shapeForSponsor(d, events.get(d.event_id) || null, { installments: plans.get(d.id) || [] });
    const next = (plans.get(d.id) || []).find((i) => i.status === 'open');
    return {
      id: s.id, stage: s.stage, status: s.status, expired: s.expired, event: s.event, companyName: s.companyName,
      level: s.level, amountCents: s.amountCents, paidCents: s.paidCents, currency: s.currency,
      proposalExpiresAt: s.proposalExpiresAt, published: s.published,
      nextDue: next ? { amountCents: Number(next.amount_cents), dueAt: next.due_at } : null,
    };
  });
}

/** Whether this deal can be paid by card right now. Never throws. */
async function cardAvailability(event) {
  if (!stripeSvc.enabled()) return { available: false, reason: 'FEATURE_DISABLED' };
  try {
    const verdict = await stripeSvc.organizerCanReceive(event.organizer_id);
    return verdict.ok ? { available: true, accountId: verdict.accountId } : { available: false, reason: verdict.reason };
  } catch {
    return { available: false, reason: 'STRIPE_NOT_ACTIVE' };
  }
}

async function getForUser(user, dealId) {
  const deal = await dealForUser(user, dealId);
  const [events, plans, event] = await Promise.all([
    eventsById([deal.event_id]), S.installmentsOf([deal.id]), S.eventFor(deal.event_id),
  ]);
  let card = null;
  let instructions = null;
  if (deal.stage === 'signed') {
    const { data: program } = await supabase.from('sponsorship_programs').select('payment_instructions')
      .eq('event_id', deal.event_id).maybeSingle();
    instructions = program?.payment_instructions || null;
    // The account id stays on the server.
    const { available, reason } = await cardAvailability(event);
    card = { available, reason: reason || null };
  }
  return shapeForSponsor(deal, events.get(deal.event_id) || null, {
    installments: plans.get(deal.id) || [], card, paymentInstructions: instructions,
  });
}

/** The sponsor signs the agreement. */
async function sign(user, dealId, { signature, signerName, accept }, req) {
  if (accept !== true) throw fail('VALIDATION_ERROR', 'Tick the box to confirm you agree to the sponsorship terms.');
  const name = String(signerName || '').trim();
  if (name.length < 2 || name.length > 120) throw fail('VALIDATION_ERROR', 'Enter your full name as the person signing.');
  const deal = await dealForUser(user, dealId);
  const sig = signatures.normalize(signature); // throws SIGNATURE_REQUIRED / SIGNATURE_INVALID

  const { error } = await supabase.rpc('sponsorship_sign', {
    p_deal_id: deal.id,
    p_user_id: user.id,
    p_email: user.email,
    p_signer_name: name,
    p_method: sig.method,
    p_svg: signatures.toSvg(sig),
    p_sha256: signatures.fingerprint(sig),
    p_ip_hash: req ? hashIp(req.ip) : null,
  });
  if (error) throw R.fromDb(error);

  const fresh = await S.loadDeal(deal.event_id, deal.id);
  try {
    const event = await S.eventFor(deal.event_id);
    const contact = await S.organizerContact(event);
    await emails.signedToOrganizer({ to: contact.email, organizerName: contact.name, event: { ...event, venue: event.venue_name }, deal: fresh });
    if (fresh.event_sponsor_id) await S.revalidateEvent(event.slug);
  } catch (err) {
    logger.warn({ err: err.message, dealId }, 'sponsorship signed notice failed');
  }
  return getForUser(user, dealId);
}

/** How the sponsor appears on the event page: name, link, logo. */
async function updateBrand(user, dealId, body) {
  const deal = await dealForUser(user, dealId);
  if (!['proposal', 'signed'].includes(deal.stage)) {
    throw fail('SPONSORSHIP_WRONG_STAGE', 'Your logo and link can be set once you have a proposal.');
  }
  const row = { updated_at: new Date().toISOString() };
  const text = (v, max) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
  if (body.displayName !== undefined) row.display_name = text(body.displayName, 120);
  if (body.linkUrl !== undefined) row.link_url = text(body.linkUrl, 2000);
  if (body.logoPath !== undefined) {
    if (!body.logoPath) Object.assign(row, { logo_path: null, logo_url: null });
    else if (R.ownSponsorLogo(deal.event_id, body.logoPath)) {
      Object.assign(row, { logo_path: body.logoPath, logo_url: require('./mediaService').publicUrl(body.logoPath) });
    } else throw fail('VALIDATION_ERROR', 'That logo does not belong to this event.');
  }
  const { error } = await supabase.from('sponsorship_deals').update(row).eq('id', deal.id);
  if (error) throw new Error(error.message);
  await supabase.from('sponsorship_deal_events').insert({ deal_id: deal.id, kind: 'brand_updated', actor_id: user.id });
  if (deal.event_sponsor_id) {
    await S.syncPublished(deal.event_id, { ...deal, ...row });
    const event = await S.eventFor(deal.event_id);
    await S.revalidateEvent(event.slug);
  }
  return getForUser(user, dealId);
}

async function signLogoUpload(user, dealId, contentType) {
  const deal = await dealForUser(user, dealId);
  return S.signLogoUpload(deal.event_id, contentType);
}
async function confirmLogo(user, dealId, path) {
  const deal = await dealForUser(user, dealId);
  return S.confirmLogo(deal.event_id, path);
}

// ── Card payment ──────────────────────────────────────────────────────────
async function sponsorshipFeeBps() {
  const { data, error } = await supabase.from('platform_settings').select('value').eq('key', 'sponsorships').maybeSingle();
  if (error) {
    logger.warn({ err: error.message }, 'sponsorship fee setting unreadable — charging no platform fee');
    return 0;
  }
  return Number(data?.value?.feeBps) || 0;
}

/**
 * Opens a Stripe Checkout for one open instalment, on the organizer's account.
 *
 * ONE LIVE SESSION PER INSTALMENT. The session we record is the only one that
 * can settle it, so a second "Pay" first expires the previous session. If the
 * previous one has already been PAID (its webhook is on the way), expiring it
 * fails and no new session is opened — two payments for one instalment is the
 * thing this exists to prevent.
 */
async function startCardPayment(user, dealId, installmentId, origin) {
  const deal = await dealForUser(user, dealId);
  if (deal.stage !== 'signed') throw fail('SPONSORSHIP_WRONG_STAGE', 'Sign the agreement before paying.');
  const { data: inst, error } = await supabase.from('sponsorship_installments')
    .select('id, deal_id, seq, label, amount_cents, status, pending_session_id, pending_account_id')
    .eq('id', installmentId).eq('deal_id', deal.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!inst) throw fail('NOT_FOUND', 'That payment does not exist on this sponsorship.');
  if (inst.status === 'paid') throw fail('SPONSORSHIP_ALREADY_PAID', 'This payment has already been made.');
  if (inst.status !== 'open') throw fail('SPONSORSHIP_WRONG_STAGE', 'This payment is no longer due.');

  const event = await S.eventFor(deal.event_id);
  const card = await cardAvailability(event);
  if (!card.available) {
    throw fail(card.reason === 'FEATURE_DISABLED' ? 'FEATURE_DISABLED' : 'CARD_NOT_AVAILABLE',
      'Card payment is not available for this sponsorship. Use the payment instructions on this page instead.');
  }
  const { accountId } = card;

  if (inst.pending_session_id) {
    try {
      const previous = await stripeSvc.retrieveSession(inst.pending_session_id, inst.pending_account_id);
      if (previous?.status === 'complete') {
        throw fail('SPONSORSHIP_PAYMENT_PENDING', 'Your payment went through and is being recorded. Refresh this page in a minute.');
      }
      if (previous?.status === 'open') await stripeSvc.expireSession(inst.pending_session_id, inst.pending_account_id);
    } catch (err) {
      if (err.code === 'SPONSORSHIP_PAYMENT_PENDING') throw err;
      logger.warn({ err: err.message, installmentId }, 'could not check the previous sponsorship session');
      throw fail('SPONSORSHIP_PAYMENT_PENDING', 'We could not confirm your previous payment attempt. Try again in a minute.');
    }
  }

  const feeCents = R.feeFor(inst.amount_cents, await sponsorshipFeeBps());
  const session = await stripeSvc.createSponsorshipSession({
    installment: inst,
    deal,
    event,
    accountId,
    origin,
    feeCents,
    customerEmail: user.email,
    // A fresh key per attempt: each "Pay" is a new session by design (above).
    idempotencyKey: `sponsorship:${inst.id}:${crypto.randomUUID()}`,
  });
  const { error: saveError } = await supabase.from('sponsorship_installments')
    .update({ pending_session_id: session.id, pending_account_id: accountId })
    .eq('id', inst.id).eq('status', 'open');
  if (saveError) {
    await stripeSvc.expireSession(session.id, accountId).catch(() => {});
    throw new Error(saveError.message);
  }
  return { url: session.url };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Shape only — whether it is really ours is decided by sponsorship_record_payment. */
const isSponsorshipSession = (session) => UUID.test(String(session?.metadata?.sponsorship_installment_id || ''));

/**
 * The webhook's half: a completed Checkout for an instalment.
 * → { ok, alreadyPaid?, error?, message?, permanent? }
 */
async function fulfilFromSession(session, { account }) {
  const installmentId = session.metadata.sponsorship_installment_id;
  const { data: inst, error } = await supabase.from('sponsorship_installments')
    .select('id, deal_id, amount_cents').eq('id', installmentId).maybeSingle();
  if (error) return { ok: false, error: 'INTERNAL_ERROR', message: error.message };
  if (!inst) return { ok: false, error: 'NOT_FOUND', message: 'no such sponsorship instalment', permanent: true };
  if (Number(session.amount_total) !== Number(inst.amount_cents)) {
    return { ok: false, error: 'FORBIDDEN', message: 'sponsorship session amount does not match the instalment', permanent: true };
  }
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const fee = Number(session.payment_intent?.application_fee_amount ?? 0) || 0;
  const { data: result, error: rpcError } = await supabase.rpc('sponsorship_record_payment', {
    p_installment_id: inst.id,
    p_method: 'card',
    p_amount_cents: Number(inst.amount_cents),
    p_reference: pi,
    p_actor: null,
    p_session: session.id,
    p_account: account,
    p_payment_intent: pi,
    p_fee_cents: fee,
  });
  if (rpcError) {
    const mapped = R.fromDb(rpcError);
    // A mismatch or a closed deal will never become payable by retrying.
    const permanent = ['SPONSORSHIP_PAYMENT_MISMATCH', 'SPONSORSHIP_ALREADY_PAID', 'SPONSORSHIP_NOT_SIGNED',
      'SPONSORSHIP_WRONG_STAGE', 'SPONSORSHIP_BAD_AMOUNT', 'SPONSORSHIP_NOT_FOUND'].includes(mapped.dbCode);
    return { ok: false, error: mapped.code || 'INTERNAL_ERROR', message: mapped.message, permanent };
  }
  if (!result?.alreadyPaid) {
    const { data: deal } = await supabase.from('sponsorship_deals').select('event_id').eq('id', inst.deal_id).maybeSingle();
    if (deal) await S.notifyPayment(deal.event_id, inst.deal_id, Number(inst.amount_cents), result);
  }
  return { ok: true, alreadyPaid: !!result?.alreadyPaid };
}

// ── The public "Become a sponsor" page ────────────────────────────────────
async function eventBySlug(slug) {
  const { data, error } = await supabase.from('events')
    .select('id, title, slug, starts_at, ends_at, timezone, city, venue_name, cover_url, currency, organizer_id, status')
    .eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  // Only a live event invites sponsors in public.
  if (!data || data.status !== 'published') throw fail('EVENT_NOT_FOUND', 'That event does not exist.');
  return data;
}

async function publicPage(slug) {
  const event = await eventBySlug(slug);
  const program = await S.getProgram(event.id);
  if (!program.isOpen) throw fail('NOT_FOUND', 'This event is not looking for sponsors right now.');
  const [packages, events] = await Promise.all([S.listPackages(event.id, { publicOnly: true }), eventsById([event.id])]);
  const { data: sponsors } = await supabase.from('event_sponsors').select('name, logo_url, level')
    .eq('event_id', event.id).order('level').order('sort_order');
  return {
    event: { ...events.get(event.id), currency: event.currency },
    headline: program.headline,
    intro: program.intro,
    packages: packages.map((p) => ({
      id: p.id, name: p.name, level: p.level, description: p.description, priceCents: p.priceCents,
      benefits: p.benefits, remaining: p.remaining, soldOut: p.remaining === 0,
    })),
    sponsors: (sponsors || []).map((s) => ({ name: s.name, logoUrl: s.logo_url, level: s.level })),
  };
}

/** A brand asks to sponsor. Becomes a lead on the organizer's board. */
async function submitInquiry(slug, body) {
  // A filled honeypot is a bot. Answered as a success so it learns nothing.
  if (body.website2) return { ok: true };
  const event = await eventBySlug(slug);
  const program = await S.getProgram(event.id);
  if (!program.isOpen) throw fail('NOT_FOUND', 'This event is not looking for sponsors right now.');

  let pkg = null;
  if (body.packageId) {
    const { data } = await supabase.from('sponsorship_packages').select('id, name, level, price_cents')
      .eq('id', body.packageId).eq('event_id', event.id).eq('is_public', true).eq('is_active', true).maybeSingle();
    pkg = data || null;
  }
  const email = String(body.contactEmail || '').trim().toLowerCase();
  // One open inquiry per address per event: a second press of Send, or a
  // second visit, adds to nothing.
  const { data: existing } = await supabase.from('sponsorship_deals').select('id')
    .eq('event_id', event.id).eq('contact_email', email).in('stage', ['lead', 'proposal']).limit(1);
  if (existing?.length) return { ok: true, duplicate: true };

  const text = (v, max) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
  const row = {
    event_id: event.id,
    source: 'inquiry',
    currency: event.currency,
    company_name: String(body.companyName || '').trim().slice(0, 120),
    contact_name: text(body.contactName, 120),
    contact_email: email,
    contact_phone: text(body.contactPhone, 30),
    website: text(body.website, 2000),
    message: text(body.message, 2000),
    package_id: pkg?.id || null,
    level: pkg?.level || 'partner',
    amount_cents: pkg ? Number(pkg.price_cents) : 0,
  };
  const { data: deal, error } = await supabase.from('sponsorship_deals').insert(row).select(S.DEAL_COLUMNS).single();
  if (error) throw new Error(error.message);
  await supabase.from('sponsorship_deal_events').insert({ deal_id: deal.id, kind: 'inquiry', detail: { packageId: pkg?.id || null } });

  const contact = await S.organizerContact(event);
  const ev = { ...event, venue: event.venue_name };
  await Promise.all([
    emails.inquiryToOrganizer({ to: contact.email, organizerName: contact.name, event: ev, deal, packageName: pkg?.name || null }),
    emails.inquiryReceipt({ to: deal.contact_email, contactName: deal.contact_name, event: ev, organizerName: contact.name }),
  ]);
  return { ok: true };
}

/** Whether the event page should show "Become a sponsor". Cheap; never throws. */
async function isOpen(eventId) {
  const { data } = await supabase.from('sponsorship_programs').select('is_open').eq('event_id', eventId).maybeSingle();
  return !!data?.is_open;
}

module.exports = {
  listForUser, getForUser, sign, updateBrand, signLogoUpload, confirmLogo, startCardPayment,
  isSponsorshipSession, fulfilFromSession, publicPage, submitInquiry, isOpen, mayAccess,
  // shared with the vendor portal (vendorPortalService)
  companiesOf, eventsById, cardAvailability,
};
