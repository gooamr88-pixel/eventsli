const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const config = require('./config');
const { classify } = require('./keywords');
const phone = require('./phone');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Delivery receipts and inbound replies — what providers tell us afterwards.
 *
 * RECEIPTS ARRIVE TWICE AND OUT OF ORDER. Providers retry webhooks, and a
 * 'sent' can land after 'delivered'. So every receipt is stored once (by a
 * dedupe key), and a status only ever moves FORWARD: queued → sent → a final
 * state. A late 'sent' never undoes 'delivered'.
 *
 * A receipt also RESOLVES an 'unknown' message: if the provider is reporting
 * on it, the provider has it, and it was sent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RANK = { queued: 0, sending: 0, unknown: 1, sent: 2, delivered: 3, undelivered: 3, failed: 3 };

function canMove(from, to) {
  if (!to || !(to in RANK)) return false;
  if (['blocked', 'cancelled'].includes(from)) return false;
  return RANK[to] > (RANK[from] ?? 0);
}

async function findMessage(providerId, { messageId, providerMessageId, clientRef }) {
  const id = messageId || clientRef;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const { data } = await supabase.from('sms_messages').select('*').eq('id', id).maybeSingle();
    if (data) return data;
  }
  if (providerMessageId) {
    const { data } = await supabase.from('sms_messages').select('*')
      .eq('provider_id', providerId).eq('provider_message_id', providerMessageId).maybeSingle();
    if (data) return data;
    // Vonage: a multi-part message reports each part under its own id.
    const { data: part } = await supabase.from('sms_messages').select('*')
      .eq('provider_id', providerId).contains('metadata', { partIds: [providerMessageId] }).maybeSingle();
    if (part) return part;
  }
  return null;
}

/**
 * @param {string} providerId
 * @param {object} parsed  adapter.parseStatus() output
 * @param {{ messageId?: string }} opts  the message id from a VERIFIED callback URL
 */
async function applyReceipt(providerId, parsed, { messageId = null, payload = {} } = {}) {
  const msg = await findMessage(providerId, { messageId, providerMessageId: parsed.providerMessageId, clientRef: parsed.clientRef });
  const ref = parsed.providerMessageId || parsed.clientRef || messageId || 'none';
  const { data: stored, error } = await supabase.from('sms_receipts').upsert({
    provider_id: providerId,
    provider_message_id: parsed.providerMessageId,
    message_id: msg?.id || null,
    status_raw: parsed.statusRaw,
    status: parsed.status,
    error_code: parsed.errorCode,
    payload,
    dedupe_key: `${providerId}:${ref}:${parsed.statusRaw}:${parsed.errorCode || ''}`,
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id');
  if (error) throw new Error(`could not store receipt: ${error.message}`);
  if (!stored || stored.length === 0) return { duplicate: true };
  if (!msg) {
    logger.warn({ provider: providerId, ref }, 'SMS receipt for a message we do not know');
    return { matched: false };
  }

  const patch = {};
  if (canMove(msg.status, parsed.status)) {
    patch.status = parsed.status;
    const now = new Date().toISOString();
    if (parsed.status === 'sent' || !msg.sent_at) patch.sent_at = msg.sent_at || now;
    if (parsed.status === 'delivered') patch.delivered_at = now;
    if (['delivered', 'undelivered', 'failed'].includes(parsed.status)) patch.finished_at = now;
    if (parsed.errorCode) patch.last_error_code = parsed.errorCode;
  }
  // An 'unknown' message learns its provider id from the receipt that resolves it.
  if (!msg.provider_message_id && parsed.providerMessageId) {
    patch.provider_message_id = parsed.providerMessageId;
    patch.provider_id = providerId;
  }
  if (parsed.priceMicros != null && msg.cost_micros == null) {
    patch.cost_micros = parsed.priceMicros;
    if (parsed.currency) patch.currency = parsed.currency;
  }
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error: upErr } = await supabase.from('sms_messages').update(patch).eq('id', msg.id);
    if (upErr) throw new Error(`could not apply receipt: ${upErr.message}`);
  }
  if (parsed.suppress) {
    await supabase.from('sms_suppressions').upsert({
      phone_e164: msg.to_e164, scope: 'all', reason: parsed.suppress, provider_id: providerId,
      note: `Delivery receipt error ${parsed.errorCode || ''}`.trim(),
    }, { onConflict: 'phone_e164', ignoreDuplicates: true });
  }
  return { matched: true, status: patch.status || msg.status };
}

const OPT_OUT_TYPES = { stop: 'stop', start: 'start', help: 'help' };

/**
 * An inbound SMS. STOP suppresses everything to that number and records the
 * opt-out against every consent it had; START undoes a keyword stop and
 * confirms pending (double opt-in) consent; HELP may be answered.
 *
 * @returns {Promise<{ keyword: string|null, reply: string|null }>}
 */
async function handleInbound(providerId, parsed) {
  const cfg = await config.load();
  const normalized = phone.normalize(parsed.from, { matcher: cfg.matcher });
  const keyword = OPT_OUT_TYPES[parsed.optOutType] || classify(parsed.text);
  const from = normalized?.e164 || null;

  const { data: inserted } = await supabase.from('sms_inbound').upsert({
    provider_id: providerId, provider_message_id: parsed.providerMessageId,
    from_e164: from || String(parsed.from).slice(0, 20), to_value: parsed.to, body: String(parsed.text).slice(0, 1600), keyword,
  }, { onConflict: 'provider_id,provider_message_id', ignoreDuplicates: true }).select('id');
  if (parsed.providerMessageId && (!inserted || inserted.length === 0)) return { keyword, reply: null, duplicate: true };
  if (!from) return { keyword, reply: null };

  const evidence = { inbound: inserted?.[0]?.id || null, provider: providerId, text: String(parsed.text).slice(0, 160) };
  const now = new Date().toISOString();

  if (keyword === 'stop') {
    await supabase.from('sms_suppressions').upsert({
      phone_e164: from, scope: 'all', reason: 'stop_keyword', provider_id: providerId, note: 'Replied STOP',
    }, { onConflict: 'phone_e164' });
    await supabase.from('sms_consents').update({ status: 'opted_out', source: 'keyword', evidence, updated_at: now })
      .eq('phone_e164', from).neq('status', 'opted_out');
    logger.info({ from: phone.mask(from), provider: providerId }, 'SMS opt-out by keyword');
  } else if (keyword === 'start') {
    await supabase.from('sms_suppressions').delete()
      .eq('phone_e164', from).in('reason', ['stop_keyword', 'carrier_opt_out']);
    await supabase.from('sms_consents').update({ status: 'opted_in', source: 'keyword', evidence, updated_at: now })
      .eq('phone_e164', from).neq('status', 'opted_in');
  }

  const reply = keyword === 'help' && cfg.settings?.reply_to_help ? cfg.settings.help_text : null;
  return { keyword, reply };
}

module.exports = { applyReceipt, handleInbound, canMove };
