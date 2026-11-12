const { supabase } = require('../../config/supabase');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { writeAudit } = require('../../services/auditService');
const config = require('../../services/sms/config');
const providers = require('../../services/sms/providers');
const credentials = require('../../services/sms/credentials');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider credentials, connection tests and number import. Super admin only.
 *
 * WRITE-ONLY SECRETS. A save stores ciphertext (credentials.js) and answers
 * with the status — which fields are set, from where — never a value. The
 * audit records the field NAMES that changed.
 *
 * NOTHING HERE SENDS A MESSAGE. "Test" reads the account (Twilio: account
 * status; Vonage: balance); "Numbers" lists the account's numbers. Imported
 * numbers become senders that are OFF until an admin checks their registration
 * and turns them on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const audit = (req, action, payload) => writeAudit(req, { action: `sms.${action}`, targetType: 'sms', payload });
const fail = (res, status, error, message) => sendFail(res, { status, error, message });

function adapterOr404(req, res) {
  const adapter = providers.ADAPTERS[req.params.provider];
  if (!adapter || !credentials.FIELDS[req.params.provider]) {
    fail(res, 404, 'NOT_FOUND', 'Unknown provider.');
    return null;
  }
  return adapter;
}

async function saveCredentials(req, res, next) {
  try {
    if (!adapterOr404(req, res)) return undefined;
    await config.load({ fresh: true });
    if (!credentials.keyConfigured()) {
      return fail(res, 409, 'CONFLICT', 'Set SMS_CREDENTIALS_KEY on the server (32 random bytes, base64) before storing credentials here, or set the provider’s environment variables instead.');
    }
    const prepared = credentials.prepare(req.params.provider, req.body || {});
    if (prepared.error) return fail(res, 400, 'VALIDATION_ERROR', prepared.error);
    const sealed = credentials.encrypt(prepared.values);
    const { error } = await supabase.from('sms_provider_credentials').upsert({
      provider_id: req.params.provider, ...sealed, fields: prepared.fields, hints: prepared.hints,
      updated_by: req.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'provider_id' });
    if (error) throw new Error(error.message);
    config.invalidate();
    await config.load({ fresh: true });
    const changed = Object.keys(req.body || {}).filter((k) => typeof req.body[k] === 'string' && req.body[k].trim());
    await audit(req, 'provider.credentials_saved', { provider: req.params.provider, fields: changed });
    return sendOk(res, credentials.status(req.params.provider));
  } catch (err) { return next(err); }
}

async function deleteCredentials(req, res, next) {
  try {
    if (!adapterOr404(req, res)) return undefined;
    const { error } = await supabase.from('sms_provider_credentials').delete().eq('provider_id', req.params.provider);
    if (error) throw new Error(error.message);
    config.invalidate();
    await config.load({ fresh: true });
    const status = credentials.status(req.params.provider);
    // A provider left with no credentials at all is switched off rather than left "enabled" and failing.
    if (!status.configured) await supabase.from('sms_providers').update({ enabled: false }).eq('id', req.params.provider);
    config.invalidate();
    await audit(req, 'provider.credentials_deleted', { provider: req.params.provider });
    return sendOk(res, status);
  } catch (err) { return next(err); }
}

/** Tests the saved credentials, or candidates typed in the form (before saving). Read-only. */
async function testConnection(req, res, next) {
  try {
    const adapter = adapterOr404(req, res);
    if (!adapter) return undefined;
    await config.load({ fresh: true });
    const typed = Object.values(req.body || {}).some((v) => typeof v === 'string' && v.trim());
    let override = null;
    if (typed) {
      const c = credentials.candidate(req.params.provider, req.body);
      if (c.error) return fail(res, 400, 'VALIDATION_ERROR', c.error);
      override = c.values;
    }
    const result = await adapter.testConnection(override);
    const lastTest = { ok: result.ok, at: new Date().toISOString(), candidate: typed, detail: result.ok ? (result.account || (result.balance ?? null)) : result.error };
    if (!typed) {
      const { data: p } = await supabase.from('sms_providers').select('settings').eq('id', req.params.provider).single();
      await supabase.from('sms_providers').update({ settings: { ...(p?.settings || {}), lastTest } }).eq('id', req.params.provider);
      config.invalidate();
    }
    await audit(req, 'provider.connection_tested', { provider: req.params.provider, ok: result.ok, candidate: typed });
    return sendOk(res, result);
  } catch (err) { return next(err); }
}

async function listNumbers(req, res, next) {
  try {
    const adapter = adapterOr404(req, res);
    if (!adapter) return undefined;
    await config.load({ fresh: true });
    if (!adapter.credentialStatus().configured) return fail(res, 409, 'CONFLICT', 'Add credentials for this provider first.');
    let numbers;
    try {
      numbers = await adapter.listNumbers();
    } catch (err) {
      return fail(res, 409, 'CONFLICT', `The provider would not list numbers: ${err.message}`);
    }
    const { data: existing } = await supabase.from('sms_senders').select('value').eq('provider_id', req.params.provider);
    const have = new Set((existing || []).map((s) => s.value));
    return sendOk(res, numbers.map((n) => ({ ...n, imported: have.has(n.value) })));
  } catch (err) { return next(err); }
}

/** Numbers become senders that are OFF, with registration to be confirmed by an admin. */
async function importNumbers(req, res, next) {
  try {
    if (!adapterOr404(req, res)) return undefined;
    const rows = (req.body.numbers || []).map((n) => ({
      provider_id: req.params.provider,
      kind: n.kind,
      value: String(n.value).trim(),
      label: n.label ? String(n.label).slice(0, 80) : null,
      countries: n.country && /^[A-Za-z]{2}$/.test(n.country) ? [String(n.country).toUpperCase()] : [],
      registration_status: 'not_required',
      active: false,
      notes: `Imported from ${req.params.provider} on ${new Date().toISOString().slice(0, 10)}. Check its registration before turning it on.`,
    }));
    const { data, error } = await supabase.from('sms_senders')
      .upsert(rows, { onConflict: 'provider_id,value', ignoreDuplicates: true }).select('id');
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'Some numbers could not be imported. Check their format.');
    config.invalidate();
    await audit(req, 'provider.numbers_imported', { provider: req.params.provider, count: (data || []).length });
    return sendOk(res, { imported: (data || []).length, skipped: rows.length - (data || []).length });
  } catch (err) { return next(err); }
}

module.exports = { saveCredentials, deleteCredentials, testConnection, listNumbers, importNumbers };
