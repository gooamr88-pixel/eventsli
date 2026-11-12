const { supabase } = require('../../config/supabase');
const config = require('./config');
const phone = require('./phone');
const queue = require('./queue');
const { readUnsubscribeToken } = require('./webhookAuth');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Marketing consent: recorded with evidence, withdrawn in one step.
 *
 * Every change lands in `sms_consents` (the current answer) and, by trigger, in
 * `sms_consent_log` (every answer ever given, with what it was based on). An
 * opt-out is never overwritten by an import: a list somebody uploads cannot
 * re-subscribe a person who said stop.
 *
 * DOUBLE OPT-IN: where a country requires it, a new consent is 'pending' until
 * the person replies YES/START to a confirmation text. Pending is not consent;
 * the policy refuses to market to it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SCOPE = /^(platform|[0-9a-f-]{36})$/;

async function setConsent({ e164, scope = 'platform', status, source, evidence = {}, userId = null }) {
  if (!SCOPE.test(scope)) throw new Error('invalid consent scope');
  const { error } = await supabase.from('sms_consents').upsert({
    phone_e164: e164, scope, status, source, evidence, user_id: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'phone_e164,scope' });
  if (error) throw new Error(`could not record consent: ${error.message}`);
}

/**
 * A signed-in person turning marketing texts on or off for their own number.
 * @returns {{ status, e164, country, confirmationSent? } | { error }}
 */
async function updateOwnPreference({ userId, rawPhone, optIn, evidence }) {
  const cfg = await config.load();
  const parsed = phone.normalize(rawPhone, { matcher: cfg.matcher });
  if (!parsed) return { error: 'Enter the number in international format, starting with + and the country code.' };

  if (!optIn) {
    await setConsent({ e164: parsed.e164, status: 'opted_out', source: 'account', evidence, userId });
    return { status: 'opted_out', ...parsed };
  }
  const country = cfg.countryByIso.get(parsed.country);
  const doubleOptIn = Boolean(country?.double_opt_in_required);
  await setConsent({ e164: parsed.e164, status: doubleOptIn ? 'pending' : 'opted_in', source: 'account', evidence, userId });
  if (!doubleOptIn) return { status: 'opted_in', ...parsed };

  const confirmation = await queue.enqueue({
    category: 'participant',
    e164: parsed.e164,
    country: parsed.country,
    body: `${cfg.settings?.brand_name || 'Eventsli'}: Reply YES to get event offers by text. Msg & data rates may apply. Reply STOP to opt out.`,
    idempotencyKey: `consent:${parsed.e164}:${new Date().toISOString().slice(0, 10)}`,
    userId,
    metadata: { purpose: 'double_opt_in' },
  });
  return { status: 'pending', ...parsed, confirmationSent: confirmation.queued };
}

async function preferencesFor(userId) {
  const { data } = await supabase.from('sms_consents')
    .select('phone_e164, scope, status, source, updated_at').eq('user_id', userId).eq('scope', 'platform');
  return (data || []).map((c) => ({ phone: c.phone_e164, status: c.status, source: c.source, updatedAt: c.updated_at }));
}

/** The link in a marketing text from an alphanumeric sender. */
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
    .eq('phone_e164', msg.to_e164).neq('status', 'opted_out');
  return { ok: true, masked: phone.mask(msg.to_e164) };
}

/**
 * Consent collected elsewhere (an event's own sign-up sheet, a previous
 * system). The admin states where it came from; that statement is the evidence
 * stored on every row.
 */
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
      .eq('scope', scope).in('phone_e164', all.slice(i, i + 200).map((p) => p.e164));
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
    rows.push({ phone_e164: p.e164, scope, status, source: 'import', evidence, updated_at: evidence.importedAt });
  }
  for (let i = 0; i < rows.length; i += 500) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.from('sms_consents').upsert(rows.slice(i, i + 500), { onConflict: 'phone_e164,scope' });
    if (error) throw new Error(`could not import consents: ${error.message}`);
  }
  return { received: phones.length, invalid, recorded: rows.length, pending, keptOptOut, alreadyOptedIn: all.length - rows.length - keptOptOut };
}

module.exports = { setConsent, updateOwnPreference, preferencesFor, unsubscribeByToken, importConsents };
