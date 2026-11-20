const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const media = require('./mediaService');
const emails = require('./sponsorshipEmails');
const R = require('./sponsorshipRules');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SPONSORSHIPS — THE ORGANIZER'S SIDE (owner, 2026-11-20).
 *
 * The sponsorship page settings, the packages, and the pipeline of deals for
 * one event. Every function takes `eventId` and filters on it: the route has
 * run `verifyEventOwner`, and the service-role client has no row-level
 * security underneath, so that filter is what keeps one organizer's deals
 * from another's.
 *
 * Whatever touches money or stock — sending a proposal with its schedule,
 * recording a payment, closing a deal — is ONE database function (migration
 * 20261202090000) that locks, checks the stage and writes the history. This
 * module validates, calls it, and sends the email.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { fail } = R;

const PACKAGE_COLUMNS = 'id, event_id, name, level, description, price_cents, quantity, benefits, is_public, is_active, sort_order, created_at, updated_at';
const DEAL_COLUMNS = [
  'id', 'event_id', 'package_id', 'company_id', 'stage', 'source', 'company_name', 'contact_name', 'contact_email',
  'contact_phone', 'website', 'message', 'level', 'amount_cents', 'currency', 'benefits', 'terms',
  'proposal_sent_at', 'proposal_expires_at', 'signed_at', 'signer_name', 'signer_email', 'signature_method',
  'signature_svg', 'signature_sha256', 'display_name', 'logo_url', 'logo_path', 'link_url', 'paid_cents', 'paid_at',
  'event_sponsor_id', 'closed_at', 'close_reason', 'notes', 'created_at', 'updated_at',
].join(', ');
const INSTALLMENT_COLUMNS = 'id, deal_id, seq, label, amount_cents, due_at, status, paid_at, method, reference, platform_fee_cents, created_at';

// ── Shapes ────────────────────────────────────────────────────────────────
function shapePackage(p, { taken = 0, pending = 0 } = {}) {
  return {
    id: p.id,
    name: p.name,
    level: p.level,
    description: p.description || null,
    priceCents: Number(p.price_cents),
    quantity: p.quantity ?? null,
    taken,
    pending,
    remaining: p.quantity === null || p.quantity === undefined ? null : Math.max(0, p.quantity - taken),
    benefits: Array.isArray(p.benefits) ? p.benefits : [],
    isPublic: p.is_public,
    isActive: p.is_active,
    sortOrder: p.sort_order,
  };
}

function shapeInstallment(i) {
  return {
    id: i.id,
    seq: i.seq,
    label: i.label,
    amountCents: Number(i.amount_cents),
    dueAt: i.due_at,
    status: i.status,
    overdue: i.status === 'open' && new Date(i.due_at).getTime() < Date.now(),
    paidAt: i.paid_at,
    method: i.method,
    reference: i.reference,
    platformFeeCents: Number(i.platform_fee_cents || 0),
  };
}

/** The deal as the organizer sees it. `full` adds the agreement, signature and notes. */
function shapeDeal(d, { packageName = null, installments = null, full = false } = {}) {
  const base = {
    id: d.id,
    stage: d.stage,
    status: R.status(d),
    column: R.boardColumn(d),
    source: d.source,
    packageId: d.package_id,
    packageName,
    companyName: d.company_name,
    contactName: d.contact_name,
    contactEmail: d.contact_email,
    level: d.level,
    amountCents: Number(d.amount_cents),
    paidCents: Number(d.paid_cents),
    currency: d.currency,
    proposalSentAt: d.proposal_sent_at,
    proposalExpiresAt: d.proposal_expires_at,
    expired: R.isExpired(d),
    signedAt: d.signed_at,
    paidAt: d.paid_at,
    published: !!d.event_sponsor_id,
    closedAt: d.closed_at,
    logoUrl: d.logo_url,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
  if (installments) {
    const next = installments.find((i) => i.status === 'open');
    base.nextDue = next ? { amountCents: Number(next.amount_cents), dueAt: next.due_at } : null;
  }
  if (!full) return base;
  return {
    ...base,
    contactPhone: d.contact_phone,
    website: d.website,
    message: d.message,
    benefits: Array.isArray(d.benefits) ? d.benefits : [],
    terms: d.terms,
    signerName: d.signer_name,
    signerEmail: d.signer_email,
    signatureMethod: d.signature_method,
    // Rendered by us from checked points (signatureService), never markup a
    // browser sent, so the dashboard may draw it.
    signatureSvg: d.signature_svg,
    signatureSha256: d.signature_sha256,
    displayName: d.display_name,
    linkUrl: d.link_url,
    closeReason: d.close_reason,
    notes: d.notes,
    installments: (installments || []).map(shapeInstallment),
  };
}

// ── Reads shared with the sponsor portal ──────────────────────────────────
async function eventFor(eventId) {
  const { data, error } = await supabase.from('events')
    .select('id, title, slug, starts_at, ends_at, timezone, city, venue_name, currency, organizer_id, status')
    .eq('id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('EVENT_NOT_FOUND', 'That event does not exist.');
  return data;
}

/** Who to write to about an event: the program's address, else the organizer account's. */
async function organizerContact(event) {
  const [{ data: org }, { data: program }] = await Promise.all([
    supabase.from('organizers').select('id, display_name, owner_user_id').eq('id', event.organizer_id).maybeSingle(),
    supabase.from('sponsorship_programs').select('contact_email').eq('event_id', event.id).maybeSingle(),
  ]);
  let email = program?.contact_email || null;
  let name = org?.display_name || null;
  if (org?.owner_user_id) {
    const { data: owner } = await supabase.from('profiles').select('email, full_name').eq('id', org.owner_user_id).maybeSingle();
    email = email || owner?.email || null;
    name = name || owner?.full_name || null;
  }
  return { email, name };
}

async function loadDeal(eventId, dealId) {
  const { data, error } = await supabase.from('sponsorship_deals').select(DEAL_COLUMNS)
    .eq('id', dealId).eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That sponsorship does not exist.');
  return data;
}

async function installmentsOf(dealIds) {
  if (!dealIds.length) return new Map();
  const { data, error } = await supabase.from('sponsorship_installments').select(INSTALLMENT_COLUMNS)
    .in('deal_id', dealIds).order('seq');
  if (error) throw new Error(error.message);
  const by = new Map();
  for (const i of data || []) {
    if (!by.has(i.deal_id)) by.set(i.deal_id, []);
    by.get(i.deal_id).push(i);
  }
  return by;
}

async function packageNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('sponsorship_packages').select('id, name').in('id', unique);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((p) => [p.id, p.name]));
}

// ── The sponsorship page settings ─────────────────────────────────────────
function shapeProgram(p) {
  return {
    isOpen: !!p?.is_open,
    headline: p?.headline || null,
    intro: p?.intro || null,
    contactEmail: p?.contact_email || null,
    defaultTerms: p?.default_terms || null,
    paymentInstructions: p?.payment_instructions || null,
  };
}

async function getProgram(eventId) {
  const { data, error } = await supabase.from('sponsorship_programs').select('*').eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  return shapeProgram(data);
}

async function saveProgram(eventId, body) {
  const row = { event_id: eventId, updated_at: new Date().toISOString() };
  const text = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
  if (body.isOpen !== undefined) row.is_open = body.isOpen === true;
  if (body.headline !== undefined) row.headline = text(body.headline);
  if (body.intro !== undefined) row.intro = text(body.intro);
  if (body.contactEmail !== undefined) row.contact_email = text(body.contactEmail)?.toLowerCase() || null;
  if (body.defaultTerms !== undefined) row.default_terms = text(body.defaultTerms);
  if (body.paymentInstructions !== undefined) row.payment_instructions = text(body.paymentInstructions);
  const { data, error } = await supabase.from('sponsorship_programs')
    .upsert(row, { onConflict: 'event_id' }).select('*').single();
  if (error) throw new Error(error.message);
  // The event page's "Become a sponsor" follows the switch.
  if (body.isOpen !== undefined) {
    const { data: ev } = await supabase.from('events').select('slug').eq('id', eventId).maybeSingle();
    await revalidateEvent(ev?.slug);
  }
  return shapeProgram(data);
}

// ── Packages ──────────────────────────────────────────────────────────────
/** Signed deals per package (what is taken) and open proposals (what may be). */
async function packageCounts(packageIds) {
  const taken = new Map();
  const pending = new Map();
  if (!packageIds.length) return { taken, pending };
  const { data, error } = await supabase.from('sponsorship_deals').select('package_id, stage')
    .in('package_id', packageIds).in('stage', ['signed', 'proposal']);
  if (error) throw new Error(error.message);
  for (const d of data || []) {
    const map = d.stage === 'signed' ? taken : pending;
    map.set(d.package_id, (map.get(d.package_id) || 0) + 1);
  }
  return { taken, pending };
}

async function listPackages(eventId, { publicOnly = false } = {}) {
  let q = supabase.from('sponsorship_packages').select(PACKAGE_COLUMNS).eq('event_id', eventId);
  if (publicOnly) q = q.eq('is_public', true).eq('is_active', true);
  const { data, error } = await q.order('sort_order').order('price_cents', { ascending: false });
  if (error) throw new Error(error.message);
  const ids = (data || []).map((p) => p.id);
  const { taken, pending } = await packageCounts(ids);
  return (data || []).map((p) => shapePackage(p, { taken: taken.get(p.id) || 0, pending: pending.get(p.id) || 0 }));
}

function packageRow(body, { partial = false } = {}) {
  const row = {};
  if (!partial || body.name !== undefined) row.name = String(body.name || '').trim();
  if (!partial || body.level !== undefined) row.level = R.LEVELS.includes(body.level) ? body.level : 'partner';
  if (!partial || body.description !== undefined) row.description = body.description ? String(body.description).trim() : null;
  if (!partial || body.priceCents !== undefined) row.price_cents = Number(body.priceCents);
  if (!partial || body.quantity !== undefined) {
    row.quantity = body.quantity === null || body.quantity === '' || body.quantity === undefined ? null : Number(body.quantity);
  }
  if (!partial || body.benefits !== undefined) row.benefits = R.cleanBenefits(body.benefits);
  if (body.isPublic !== undefined) row.is_public = body.isPublic === true;
  if (body.isActive !== undefined) row.is_active = body.isActive === true;
  if (body.sortOrder !== undefined) row.sort_order = Number(body.sortOrder);
  return row;
}

async function createPackage(eventId, body) {
  const { data, error } = await supabase.from('sponsorship_packages')
    .insert({ event_id: eventId, ...packageRow(body) }).select(PACKAGE_COLUMNS).single();
  if (error) throw new Error(error.message);
  return shapePackage(data);
}

/**
 * An edit. A signed deal keeps the price and benefits it signed (they are
 * copied onto the deal), so a package may be repriced freely — but its
 * quantity may not go below what is already signed.
 */
async function updatePackage(eventId, packageId, body) {
  const row = packageRow(body, { partial: true });
  const { taken } = await packageCounts([packageId]);
  const signed = taken.get(packageId) || 0;
  if (row.quantity !== undefined && row.quantity !== null && row.quantity < signed) {
    throw fail('CONFLICT', `${signed} ${signed === 1 ? 'sponsor has' : 'sponsors have'} already signed for this package, so it cannot offer fewer than ${signed}.`);
  }
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('sponsorship_packages').update(row)
    .eq('id', packageId).eq('event_id', eventId).select(PACKAGE_COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail('NOT_FOUND', 'That package does not exist.');
  return shapePackage(data, { taken: signed });
}

/** Removes a package nobody has dealt on; one with deals is taken off sale instead. */
async function removePackage(eventId, packageId) {
  const { count, error: countError } = await supabase.from('sponsorship_deals')
    .select('id', { count: 'exact', head: true }).eq('package_id', packageId);
  if (countError) throw new Error(countError.message);
  if (count > 0) {
    const { error } = await supabase.from('sponsorship_packages')
      .update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', packageId).eq('event_id', eventId);
    if (error) throw new Error(error.message);
    return { removed: false, deactivated: true };
  }
  const { data, error } = await supabase.from('sponsorship_packages').delete()
    .eq('id', packageId).eq('event_id', eventId).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw fail('NOT_FOUND', 'That package does not exist.');
  return { removed: true, deactivated: false };
}

// ── Deals ─────────────────────────────────────────────────────────────────
function money(deals, pick) {
  return deals.filter(pick).reduce((s, d) => s + Number(d.amount_cents), 0);
}

/** The pipeline: every deal, the board's columns, and the totals over them. */
async function listDeals(eventId) {
  const { data, error } = await supabase.from('sponsorship_deals').select(DEAL_COLUMNS)
    .eq('event_id', eventId).order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const deals = data || [];
  const [names, plans] = await Promise.all([
    packageNames(deals.map((d) => d.package_id)),
    installmentsOf(deals.filter((d) => d.stage === 'signed').map((d) => d.id)),
  ]);
  const signed = deals.filter((d) => d.stage === 'signed');
  const event = await eventFor(eventId);
  return {
    currency: event.currency,
    columns: R.BOARD,
    totals: {
      pipelineCents: money(deals, (d) => d.stage === 'proposal'),
      signedCents: money(signed, () => true),
      paidCents: signed.reduce((s, d) => s + Number(d.paid_cents), 0),
      outstandingCents: signed.reduce((s, d) => s + Math.max(0, Number(d.amount_cents) - Number(d.paid_cents)), 0),
      leads: deals.filter((d) => d.stage === 'lead').length,
      sponsors: signed.length,
    },
    deals: deals.map((d) => shapeDeal(d, { packageName: names.get(d.package_id) || null, installments: plans.get(d.id) || [] })),
  };
}

async function dealHistory(dealId) {
  const { data, error } = await supabase.from('sponsorship_deal_events')
    .select('id, kind, actor_id, detail, created_at').eq('deal_id', dealId).order('created_at');
  if (error) throw new Error(error.message);
  const actorIds = [...new Set((data || []).map((e) => e.actor_id).filter(Boolean))];
  const names = new Map();
  if (actorIds.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name, email').in('id', actorIds);
    for (const p of people || []) names.set(p.id, p.full_name || p.email);
  }
  return (data || []).map((e) => ({
    id: e.id, kind: e.kind, at: e.created_at, by: e.actor_id ? names.get(e.actor_id) || null : null, detail: e.detail || {},
  }));
}

async function getDeal(eventId, dealId) {
  const deal = await loadDeal(eventId, dealId);
  const [names, plans, history] = await Promise.all([
    packageNames([deal.package_id]), installmentsOf([deal.id]), dealHistory(deal.id),
  ]);
  return { ...shapeDeal(deal, { packageName: names.get(deal.package_id) || null, installments: plans.get(deal.id) || [], full: true }), history };
}

const text = (v, max) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

function contactRow(body, { partial = false } = {}) {
  const row = {};
  if (!partial || body.companyName !== undefined) row.company_name = String(body.companyName || '').trim().slice(0, 120);
  if (!partial || body.contactEmail !== undefined) row.contact_email = String(body.contactEmail || '').trim().toLowerCase();
  if (!partial || body.contactName !== undefined) row.contact_name = text(body.contactName, 120);
  if (!partial || body.contactPhone !== undefined) row.contact_phone = text(body.contactPhone, 30);
  if (!partial || body.website !== undefined) row.website = text(body.website, 2000);
  return row;
}

/** A lead the organizer adds by hand (met them at a trade show, an email). */
async function createDeal(eventId, body, actorId) {
  const event = await eventFor(eventId);
  const row = {
    event_id: eventId, source: 'organizer', currency: event.currency, ...contactRow(body),
    notes: text(body.notes, 4000),
  };
  if (body.packageId) {
    const { data: pkg } = await supabase.from('sponsorship_packages').select('id, level, price_cents')
      .eq('id', body.packageId).eq('event_id', eventId).maybeSingle();
    if (!pkg) throw fail('NOT_FOUND', 'That package does not exist on this event.');
    Object.assign(row, { package_id: pkg.id, level: pkg.level, amount_cents: Number(pkg.price_cents) });
  }
  const { data, error } = await supabase.from('sponsorship_deals').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  await supabase.from('sponsorship_deal_events').insert({ deal_id: data.id, kind: 'created', actor_id: actorId || null });
  return getDeal(eventId, data.id);
}

/**
 * Edits that change no money: contact details (until signed — after that the
 * agreement names them), the sponsor's display on the event page, the notes.
 */
async function updateDeal(eventId, dealId, body) {
  const deal = await loadDeal(eventId, dealId);
  const row = {};
  const contact = contactRow(body, { partial: true });
  if (Object.keys(contact).length && !['lead', 'proposal'].includes(deal.stage)) {
    throw fail('SPONSORSHIP_WRONG_STAGE', 'The agreement is signed, so the company and contact on it can no longer change.');
  }
  Object.assign(row, contact);
  if (body.notes !== undefined) row.notes = text(body.notes, 4000);
  if (body.displayName !== undefined) row.display_name = text(body.displayName, 120);
  if (body.linkUrl !== undefined) row.link_url = text(body.linkUrl, 2000);
  if (body.logoPath !== undefined) {
    if (!body.logoPath) Object.assign(row, { logo_path: null, logo_url: null });
    else if (R.ownSponsorLogo(eventId, body.logoPath)) Object.assign(row, { logo_path: body.logoPath, logo_url: media.publicUrl(body.logoPath) });
    else throw fail('VALIDATION_ERROR', 'That logo does not belong to this event.');
  }
  if (!Object.keys(row).length) return getDeal(eventId, dealId);
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from('sponsorship_deals').update(row).eq('id', dealId).eq('event_id', eventId);
  if (error) throw new Error(error.message);
  await syncPublished(eventId, { ...deal, ...row });
  return getDeal(eventId, dealId);
}

/** A sponsor already on the event page follows the deal's display details. */
async function syncPublished(eventId, deal) {
  if (!deal.event_sponsor_id) return;
  const { error } = await supabase.from('event_sponsors').update({
    name: (deal.display_name || deal.company_name).slice(0, 120),
    logo_url: deal.logo_url || null,
    logo_path: deal.logo_path || null,
    link_url: deal.link_url || deal.website || null,
  }).eq('id', deal.event_sponsor_id).eq('event_id', eventId);
  if (error) logger.warn({ err: error.message, dealId: deal.id }, 'could not update the published sponsor');
}

/** Send the proposal (or send a revised one). Emails the contact. */
async function sendProposal(eventId, dealId, body, actorId) {
  const deal = await loadDeal(eventId, dealId);
  const event = await eventFor(eventId);
  const amount = Number(body.amountCents);
  const schedule = R.cleanSchedule(amount, body.installments);
  const benefits = R.cleanBenefits(body.benefits);
  const level = R.LEVELS.includes(body.level) ? body.level : deal.level;
  const expires = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expires && (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now())) {
    throw fail('VALIDATION_ERROR', 'The reply-by date has to be in the future.');
  }
  const terms = text(body.terms, 20000);
  if (!terms) throw fail('VALIDATION_ERROR', 'Write the agreement the sponsor will sign.');

  const { error } = await supabase.rpc('sponsorship_send_proposal', {
    p_deal_id: dealId,
    p_actor: actorId || null,
    p_package_id: body.packageId || null,
    p_level: level,
    p_amount_cents: amount,
    p_currency: event.currency,
    p_benefits: benefits,
    p_terms: terms,
    p_expires_at: expires ? expires.toISOString() : null,
    p_installments: schedule,
  });
  if (error) throw R.fromDb(error);

  const fresh = await loadDeal(eventId, dealId);
  const contact = await organizerContact(event);
  await emails.proposal({
    to: fresh.contact_email,
    contactName: fresh.contact_name,
    event: { ...event, venue: event.venue_name },
    organizerName: contact.name,
    deal: fresh,
    revised: deal.stage === 'proposal',
  });
  return getDeal(eventId, dealId);
}

/** A payment that arrived outside Eventsli (bank transfer, cheque, cash). */
async function recordOfflinePayment(eventId, dealId, installmentId, body, actorId) {
  const deal = await loadDeal(eventId, dealId);
  const { data: inst } = await supabase.from('sponsorship_installments').select('id, amount_cents')
    .eq('id', installmentId).eq('deal_id', deal.id).maybeSingle();
  if (!inst) throw fail('NOT_FOUND', 'That payment does not exist on this sponsorship.');
  if (!R.OFFLINE_METHODS.includes(body.method)) throw fail('VALIDATION_ERROR', 'Choose how the payment was made.');

  const { data: result, error } = await supabase.rpc('sponsorship_record_payment', {
    p_installment_id: inst.id,
    p_method: body.method,
    p_amount_cents: Number(inst.amount_cents),
    p_reference: text(body.reference, 120),
    p_actor: actorId || null,
    p_session: null,
    p_account: null,
    p_payment_intent: null,
    p_fee_cents: 0,
  });
  if (error) throw R.fromDb(error);
  await notifyPayment(eventId, dealId, Number(inst.amount_cents), result);
  return getDeal(eventId, dealId);
}

/** Both sides hear about a payment, however it arrived. */
async function notifyPayment(eventId, dealId, amountCents, result) {
  try {
    const [deal, event] = await Promise.all([loadDeal(eventId, dealId), eventFor(eventId)]);
    const contact = await organizerContact(event);
    const fullyPaid = Number(deal.paid_cents) >= Number(deal.amount_cents);
    const ev = { ...event, venue: event.venue_name };
    await Promise.all([
      emails.paymentRecorded({ to: contact.email, name: contact.name, event: ev, deal, amountCents, forOrganizer: true, fullyPaid }),
      emails.paymentRecorded({ to: deal.contact_email, name: deal.contact_name, event: ev, deal, amountCents, forOrganizer: false, fullyPaid }),
    ]);
    if (result?.published) await revalidateEvent(event.slug);
  } catch (err) {
    logger.warn({ err: err.message, dealId }, 'sponsorship payment notice failed');
  }
}

/** The public event page shows sponsors; refresh it when the list changes. */
async function revalidateEvent(slug) {
  if (!slug) return;
  // Never throws (revalidateService); the change is already committed.
  await require('./revalidateService').revalidate([`event:${slug}`]).catch(() => {});
}

async function closeDeal(eventId, dealId, outcome, reason, actorId) {
  const deal = await loadDeal(eventId, dealId);
  const { error } = await supabase.rpc('sponsorship_close', {
    p_deal_id: deal.id, p_actor: actorId || null, p_outcome: outcome, p_reason: text(reason, 500),
  });
  if (error) throw R.fromDb(error);
  if (deal.event_sponsor_id) {
    const event = await eventFor(eventId);
    await revalidateEvent(event.slug);
  }
  return getDeal(eventId, dealId);
}

/** A lost lead comes back to life (they called again). */
async function reopenDeal(eventId, dealId, actorId) {
  const deal = await loadDeal(eventId, dealId);
  if (deal.stage !== 'lost') throw fail('SPONSORSHIP_WRONG_STAGE', 'Only a lost deal can be reopened.');
  const { error } = await supabase.from('sponsorship_deals')
    .update({ stage: 'lead', closed_at: null, close_reason: null, updated_at: new Date().toISOString() })
    .eq('id', dealId).eq('event_id', eventId).eq('stage', 'lost');
  if (error) throw new Error(error.message);
  await supabase.from('sponsorship_deal_events').insert({ deal_id: dealId, kind: 'reopened', actor_id: actorId || null });
  return getDeal(eventId, dealId);
}

/** A logo upload for a deal: the event's own `sponsor-…` object (mediaService). */
function signLogoUpload(eventId, contentType) {
  return media.signUpload({ eventId, contentType: String(contentType || '').toLowerCase(), kind: 'sponsor' });
}
async function confirmLogo(eventId, path) {
  if (!R.ownSponsorLogo(eventId, path)) throw fail('VALIDATION_ERROR', 'That logo does not belong to this event.');
  return media.attach({ eventId, path });
}

module.exports = {
  // shared with the sponsor portal and the public page
  eventFor, organizerContact, loadDeal, installmentsOf, shapeInstallment, shapePackage, syncPublished,
  notifyPayment, revalidateEvent, signLogoUpload, confirmLogo, DEAL_COLUMNS, INSTALLMENT_COLUMNS,
  // the organizer
  getProgram, saveProgram, listPackages, createPackage, updatePackage, removePackage,
  listDeals, getDeal, createDeal, updateDeal, sendProposal, recordOfflinePayment, closeDeal, reopenDeal,
};
