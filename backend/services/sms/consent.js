const { supabase } = require('../../config/supabase');
const config = require('./config');
const phone = require('./phone');
const queue = require('./queue');
const { render } = require('./consentText');
const { readUnsubscribeToken } = require('./webhookAuth');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SMS consent: two kinds, recorded with evidence, withdrawn in one step.
 *
 *   transactional  "text me about MY tickets and events" — always platform-wide
 *   marketing      "send me offers" — per sender: 'platform' or an organizer id
 *
 * They are separate rows (`sms_consents.kind`) and are never inferred from one
 * another. Every change also lands in `sms_consent_log` with the exact words
 * the person saw (consentText.js), by trigger.
 *
 * WHERE CONSENT COMES FROM
 *   checkout      ticked boxes, captured on the reservation and recorded when
 *                 the order is fulfilled (an abandoned checkout records nothing)
 *   registration  ticked boxes on the sign-up forms
 *   account       the person's own preferences page
 *   keyword       STOP / START / YES replies (receipts.js)
 *   link          the unsubscribe link
 *   import        an admin's upload, with a statement of where it came from
 *
 * An opt-out is never overwritten by an import. A fresh, explicit opt-in by the
 * person themselves (checkout, account, START) does replace an earlier opt-out.
 * DOUBLE OPT-IN: marketing consent in a country that requires it is 'pending'
 * until the person replies YES.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SCOPE = /^(platform|[0-9a-f-]{36})$/;
const KINDS = new Set(['transactional', 'marketing']);

async function setConsent({ e164, scope = 'platform', kind, status, source, evidence = {}, userId = null }) {
  if (!SCOPE.test(scope)) throw new Error('invalid consent scope');
  if (!KINDS.has(kind)) throw new Error('invalid consent kind');
  if (kind === 'transactional' && scope !== 'platform') throw new Error('transactional consent is platform-wide');
  const { error } = await supabase.from('sms_consents').upsert({
    phone_e164: e164, scope, kind, status, source, evidence, user_id: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'phone_e164,scope,kind' });
  if (error) throw new Error(`could not record consent: ${error.message}`);
}

/** Marketing opt-in honours the country's double opt-in rule; returns the status recorded. */
async function marketingStatus(cfg, country) {
  return cfg.countryByIso.get(country)?.double_opt_in_required ? 'pending' : 'opted_in';
}

/** The YES/STOP confirmation text for double opt-in. Exempt from consent: it IS the consent request. */
async function sendDoubleOptIn(cfg, parsed, { userId = null, sender = 'Eventsli' } = {}) {
  return queue.enqueue({
    category: 'participant',
    e164: parsed.e164,
    country: parsed.country,
    body: `${cfg.settings?.brand_name || 'Eventsli'}: Reply YES to get news and offers from ${sender} by text. Msg & data rates may apply. Reply STOP to opt out.`,
    idempotencyKey: `consent:${parsed.e164}:${sender}:${new Date().toISOString().slice(0, 10)}`,
    userId,
    metadata: { purpose: 'double_opt_in', consentExempt: 'double_opt_in' },
  });
}

/**
 * Records the consents a person gave on one form. `choices` keys:
 * transactional, marketingPlatform, marketingOrganizer (with organizerId).
 * Unticked boxes record nothing — silence is not an opt-out, and recording one
 * would erase consent the person gave somewhere else.
 */
async function recordChoices({ parsed, choices, source, versions, vars = {}, userId = null, organizerId = null, extraEvidence = {} }) {
  const cfg = await config.load();
  const at = new Date().toISOString();
  const evidence = (version) => ({ version, text: render(version, vars), source, at, ...extraEvidence });
  const recorded = [];

  if (choices.transactional === true) {
    await setConsent({ e164: parsed.e164, kind: 'transactional', status: 'opted_in', source, evidence: evidence(versions.transactional), userId });
    recorded.push('transactional');
  }
  const doubleOptIns = [];
  if (choices.marketingPlatform === true) {
    const status = await marketingStatus(cfg, parsed.country);
    await setConsent({ e164: parsed.e164, kind: 'marketing', scope: 'platform', status, source, evidence: evidence(versions.marketingPlatform), userId });
    recorded.push(`marketing:platform:${status}`);
    if (status === 'pending') doubleOptIns.push('Eventsli');
  }
  if (choices.marketingOrganizer === true && organizerId) {
    const status = await marketingStatus(cfg, parsed.country);
    await setConsent({ e164: parsed.e164, kind: 'marketing', scope: organizerId, status, source, evidence: evidence(versions.marketingOrganizer), userId });
    recorded.push(`marketing:organizer:${status}`);
    if (status === 'pending') doubleOptIns.push(vars.organizer || 'the organizer');
  }
  for (const who of doubleOptIns) await sendDoubleOptIn(cfg, parsed, { userId, sender: who });
  return recorded;
}

// ─── Checkout ──────────────────────────────────────────────────────────────

/**
 * What the buyer ticked, normalised. Throws a user-facing message when a box is
 * ticked without a number we can text.
 */
async function parseCheckoutChoices(body, { defaultCountry }) {
  const sms = body?.sms && typeof body.sms === 'object' ? body.sms : {};
  const choices = {
    transactional: sms.transactional === true,
    marketingPlatform: sms.marketingPlatform === true,
    marketingOrganizer: sms.marketingOrganizer === true,
  };
  const any = choices.transactional || choices.marketingPlatform || choices.marketingOrganizer;
  if (!any) return null;
  const cfg = await config.load();
  const parsed = phone.normalize(body.phone, { defaultCountry, matcher: cfg.matcher });
  if (!parsed) {
    const err = new Error('Enter a mobile number we can text, or untick the text message options.');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return { ...choices, e164: parsed.e164, country: parsed.country };
}

/**
 * Stores the buyer's choices on the reservation. Recorded as consent only when
 * the order is fulfilled (applyCheckoutConsent), so an abandoned checkout
 * leaves no consent behind.
 */
async function captureCheckoutIntent({ reservationId, choices, ipHash }) {
  const { data: r } = await supabase.from('reservations').select('attendee_data').eq('id', reservationId).maybeSingle();
  const { error } = await supabase.from('reservations').update({
    attendee_data: { ...(r?.attendee_data || {}), smsConsent: choices ? { ...choices, ipHash, at: new Date().toISOString() } : null },
  }).eq('id', reservationId);
  if (error) throw new Error(`could not store SMS choices: ${error.message}`);
}

/** At fulfilment: the reservation's captured choices become consent records, once. */
async function applyCheckoutConsent(order, event) {
  if (!order?.reservation_id) return [];
  const { data: r } = await supabase.from('reservations').select('attendee_data').eq('id', order.reservation_id).maybeSingle();
  const intent = r?.attendee_data?.smsConsent;
  if (!intent?.e164 || intent.appliedOrder === order.id) return [];
  const { data: org } = await supabase.from('organizers').select('id, display_name').eq('id', event.organizer_id).maybeSingle();
  const recorded = await recordChoices({
    parsed: { e164: intent.e164, country: intent.country },
    choices: intent,
    source: 'checkout',
    versions: {
      transactional: 'checkout.transactional.v1',
      marketingPlatform: 'checkout.marketing_platform.v1',
      marketingOrganizer: 'checkout.marketing_organizer.v1',
    },
    vars: { organizer: org?.display_name },
    userId: order.user_id || null,
    organizerId: org?.id || null,
    extraEvidence: { orderId: order.id, eventId: event.id, ipHash: intent.ipHash || null },
  });
  await supabase.from('reservations').update({
    attendee_data: { ...r.attendee_data, smsConsent: { ...intent, appliedOrder: order.id } },
  }).eq('id', order.reservation_id);
  return recorded;
}

// ─── Registration ──────────────────────────────────────────────────────────

/** Sign-up form choices. Throws a user-facing message when a box is ticked without a usable number. */
async function parseRegistrationChoices(body) {
  const sms = body?.sms && typeof body.sms === 'object' ? body.sms : {};
  const choices = { transactional: sms.transactional === true, marketingPlatform: sms.marketing === true };
  if (!choices.transactional && !choices.marketingPlatform) return null;
  const cfg = await config.load();
  const parsed = phone.normalize(body.phone, { matcher: cfg.matcher });
  if (!parsed) {
    const err = new Error('To get texts, enter your mobile number with its country code, starting with + (for example +1 416 555 0199).');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return { choices, parsed };
}

async function recordRegistrationConsent({ userId, parsedChoices, ipHash }) {
  if (!parsedChoices) return [];
  return recordChoices({
    parsed: parsedChoices.parsed,
    choices: parsedChoices.choices,
    source: 'registration',
    versions: { transactional: 'registration.transactional.v1', marketingPlatform: 'registration.marketing.v1' },
    userId,
    extraEvidence: { ipHash },
  });
}

// ─── A person's own preferences ────────────────────────────────────────────

async function preferencesFor(userId) {
  const cfg = await config.load();
  const { data: profile } = await supabase.from('profiles').select('phone').eq('id', userId).maybeSingle();
  const parsed = profile?.phone ? phone.normalize(profile.phone, { matcher: cfg.matcher }) : null;
  // Consent belongs to a NUMBER (that is what a provider texts), so with a
  // usable number on the profile, that number's records are the answer.
  let q = supabase.from('sms_consents').select('phone_e164, scope, kind, status, source, updated_at');
  q = parsed ? q.eq('phone_e164', parsed.e164) : q.eq('user_id', userId);
  const { data: rows } = await q;
  const mine = rows || [];
  const pick = (kind, scope) => mine.find((r) => r.kind === kind && r.scope === scope) || null;
  const organizerIds = [...new Set(mine.filter((r) => r.kind === 'marketing' && r.scope !== 'platform').map((r) => r.scope))];
  const { data: orgs } = organizerIds.length
    ? await supabase.from('organizers').select('id, display_name').in('id', organizerIds)
    : { data: [] };
  const { data: suppression } = parsed
    ? await supabase.from('sms_suppressions').select('scope, reason').eq('phone_e164', parsed.e164).maybeSingle()
    : { data: null };
  const shapeRow = (r) => (r ? { status: r.status, source: r.source, updatedAt: r.updated_at } : null);
  return {
    phone: profile?.phone || '',
    phoneE164: parsed?.e164 || null,
    phoneUsable: Boolean(parsed),
    transactional: shapeRow(pick('transactional', 'platform')),
    marketing: shapeRow(pick('marketing', 'platform')),
    organizers: organizerIds.map((id) => {
      const r = pick('marketing', id);
      return { organizerId: id, name: (orgs || []).find((o) => o.id === id)?.display_name || 'Organizer', ...shapeRow(r) };
    }),
    suppression: suppression ? { scope: suppression.scope, reason: suppression.reason } : null,
  };
}

/**
 * The preferences page. `transactional` and `marketing` are explicit booleans:
 * here an unticked box IS an answer, because the person is looking at the
 * current state and changing it.
 */
async function updatePreferences({ userId, rawPhone, transactional, marketing, organizers = [], ipHash }) {
  const cfg = await config.load();
  const parsed = phone.normalize(rawPhone, { matcher: cfg.matcher });
  if (!parsed) return { error: 'Enter your mobile number with its country code, starting with + (for example +1 416 555 0199).' };

  const { data: profile } = await supabase.from('profiles').select('phone').eq('id', userId).maybeSingle();
  if ((profile?.phone || '') !== String(rawPhone).trim()) {
    await supabase.from('profiles').update({ phone: String(rawPhone).trim(), updated_at: new Date().toISOString() }).eq('id', userId);
  }
  const current = await preferencesFor(userId);
  const at = new Date().toISOString();
  const ev = (version) => ({ version, text: render(version), source: 'account', at, ipHash });
  const result = { transactional: null, marketing: null, confirmationSent: false };

  const samePhone = current.phoneE164 === parsed.e164;
  if (typeof transactional === 'boolean') {
    const status = transactional ? 'opted_in' : 'opted_out';
    const had = samePhone ? current.transactional?.status : null;
    // "Off" with nothing on record is no change: an opt-out is only written to
    // withdraw something, so the history holds real decisions, not saves.
    if (had !== status && (transactional || had)) {
      await setConsent({ e164: parsed.e164, kind: 'transactional', status, source: 'account', evidence: ev('account.transactional.v1'), userId });
    }
    result.transactional = status;
  }
  if (typeof marketing === 'boolean') {
    const was = samePhone ? current.marketing?.status : null;
    let status = marketing ? await marketingStatus(cfg, parsed.country) : 'opted_out';
    if (marketing && was === 'opted_in') status = 'opted_in';
    if (was !== status && (marketing || was)) {
      await setConsent({ e164: parsed.e164, kind: 'marketing', scope: 'platform', status, source: 'account', evidence: ev('account.marketing.v1'), userId });
      if (status === 'pending') result.confirmationSent = (await sendDoubleOptIn(cfg, parsed, { userId })).queued;
    }
    result.marketing = status;
  }
  // Organizer marketing can only be WITHDRAWN here; opting in to an organizer happens at their checkout.
  for (const o of organizers) {
    if (o?.marketing === false && SCOPE.test(String(o.organizerId)) && o.organizerId !== 'platform') {
      await setConsent({
        e164: parsed.e164, kind: 'marketing', scope: o.organizerId, status: 'opted_out', source: 'account',
        evidence: { source: 'account', at, ipHash, statement: 'Withdrew organizer marketing consent from account settings' }, userId,
      });
    }
  }
  return { ...result, e164: parsed.e164, country: parsed.country };
}

// ─── Unsubscribe link and imports ──────────────────────────────────────────

/** The link in a marketing text sent from an alphanumeric sender. Marketing only. */
async function unsubscribeByToken(token, { ipHash = null } = {}) {
  const messageId = readUnsubscribeToken(token);
  if (!messageId) return { ok: false };
  const { data: msg } = await supabase.from('sms_messages')
    .select('id, to_e164, consent_scope').eq('id', messageId).maybeSingle();
  if (!msg) return { ok: false };
  const evidence = { link: true, messageId, ipHash };
  await supabase.from('sms_suppressions').upsert({
    phone_e164: msg.to_e164, scope: 'marketing', reason: 'opt_out_link', note: 'Unsubscribe link',
  }, { onConflict: 'phone_e164', ignoreDuplicates: true });
  await supabase.from('sms_consents').update({ status: 'opted_out', source: 'link', evidence, updated_at: new Date().toISOString() })
    .eq('phone_e164', msg.to_e164).eq('kind', 'marketing').neq('status', 'opted_out');
  return { ok: true, masked: phone.mask(msg.to_e164) };
}

/** Marketing consent collected elsewhere, with a statement of where it came from. */
async function importConsents({ phones, scope = 'platform', defaultCountry = null, evidenceStatement, actorId }) {
  const cfg = await config.load();
  const parsed = new Map();
  let invalid = 0;
  for (const raw of phones) {
    const p = phone.normalize(raw, { defaultCountry, matcher: cfg.matcher });
    if (p) parsed.set(p.e164, p); else invalid += 1;
  }
  const all = [...parsed.values()];
  const existing = new Map();
  for (let i = 0; i < all.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await supabase.from('sms_consents').select('phone_e164, status')
      .eq('scope', scope).eq('kind', 'marketing').in('phone_e164', all.slice(i, i + 200).map((p) => p.e164));
    for (const row of data || []) existing.set(row.phone_e164, row.status);
  }
  const evidence = { statement: evidenceStatement, actorId, importedAt: new Date().toISOString() };
  const rows = [];
  let keptOptOut = 0;
  let pending = 0;
  for (const p of all) {
    if (existing.get(p.e164) === 'opted_out') { keptOptOut += 1; continue; }
    if (existing.get(p.e164) === 'opted_in') continue;
    const status = cfg.countryByIso.get(p.country)?.double_opt_in_required ? 'pending' : 'opted_in';
    if (status === 'pending') pending += 1;
    rows.push({ phone_e164: p.e164, scope, kind: 'marketing', status, source: 'import', evidence, updated_at: evidence.importedAt });
  }
  for (let i = 0; i < rows.length; i += 500) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.from('sms_consents').upsert(rows.slice(i, i + 500), { onConflict: 'phone_e164,scope,kind' });
    if (error) throw new Error(`could not import consents: ${error.message}`);
  }
  return { received: phones.length, invalid, recorded: rows.length, pending, keptOptOut, alreadyOptedIn: all.length - rows.length - keptOptOut };
}

module.exports = {
  setConsent, recordChoices, parseCheckoutChoices, captureCheckoutIntent, applyCheckoutConsent,
  parseRegistrationChoices, recordRegistrationConsent, preferencesFor, updatePreferences,
  unsubscribeByToken, importConsents,
};
