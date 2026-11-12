const { supabase } = require('../../config/supabase');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { writeAudit } = require('../../services/auditService');
const { parsePagination, buildMeta } = require('../../middleware/pagination');
const { safeSearch } = require('../../utils/search');
const logger = require('../../utils/logger');
const config = require('../../services/sms/config');
const providers = require('../../services/sms/providers');
const pricing = require('../../services/sms/pricing');
const auth = require('../../services/sms/webhookAuth');
const shape = require('./smsShape');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SMS configuration: countries, routes, providers, senders, categories,
 * platform settings. Reads are open to every admin; writes are SUPER admin
 * (routes/admin/smsRoutes.js) and every write is audited.
 *
 * Credentials never leave the server. A provider is reported as
 * `configured: true/false` with the NAMES of any missing variables — never a
 * value, never a prefix of one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const audit = (req, action, payload) => writeAudit(req, { action: `sms.${action}`, targetType: 'sms', payload });
const fail = (res, status, error, message) => sendFail(res, { status, error, message });

async function routesFor(isos) {
  if (!isos.length) return [];
  const { data, error } = await supabase.from('sms_routes').select('*').in('country', isos);
  if (error) throw new Error(error.message);
  return data || [];
}

// ─── Countries ─────────────────────────────────────────────────────────────

async function countryStats() {
  const { data, error } = await supabase.from('sms_countries').select('status');
  if (error) throw new Error(error.message);
  const stats = { total: 0, enabled: 0, unverified: 0, disabled: 0, blocked: 0 };
  for (const row of data || []) { stats.total += 1; stats[row.status] += 1; }
  return stats;
}

async function listCountries(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['name', 'iso2', 'status', 'updated_at'], defaultSort: 'name' });
    let q = supabase.from('sms_countries').select('*', { count: 'exact' });
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.region) q = q.eq('region', req.query.region);
    const term = safeSearch(req.query.q);
    if (term) {
      const digits = term.replace(/[^0-9]/g, '');
      q = q.or([`name.ilike.%${term}%`, `iso2.ilike.${term.slice(0, 2)}`, digits ? `dial_code.eq.${digits}` : null].filter(Boolean).join(','));
    }
    // Verified countries first unless a sort was asked for: those are the ones that send
    // (an enum sort would put 'unverified' first — it is the enum's first label).
    if (!req.query.sort) q = q.order('verified_at', { ascending: false, nullsFirst: false });
    const { data, count, error } = await q.order(p.sort, { ascending: req.query.sort ? p.order === 'asc' : true }).range(p.from, p.to);
    if (error) throw new Error(error.message);
    const routes = await routesFor((data || []).map((c) => c.iso2));
    const cfg = await config.load();
    return sendOk(res, (data || []).map((c) => shape.country(c, routes.filter((r) => r.country === c.iso2), cfg)), {
      pagination: buildMeta(p, count), meta: { stats: await countryStats() },
    });
  } catch (err) { return next(err); }
}

async function countryDetail(req, res, next) {
  try {
    const { data: c } = await supabase.from('sms_countries').select('*').eq('iso2', req.params.iso2).maybeSingle();
    if (!c) return fail(res, 404, 'NOT_FOUND', 'No such country.');
    const cfg = await config.load();
    const routes = await routesFor([c.iso2]);
    const out = shape.country(c, routes, cfg);
    out.guidelines = Object.values(providers.ADAPTERS).map((a) => ({ providerId: a.id, url: a.docs(c.iso2) }));
    return sendOk(res, out);
  } catch (err) { return next(err); }
}

const COUNTRY_FIELDS = {
  name: 'name', dialCode: 'dial_code', prefixes: 'prefixes', dialPrimary: 'dial_primary', region: 'region',
  timezone: 'timezone', senderIdSupport: 'sender_id_support', requiresSenderRegistration: 'requires_sender_registration',
  marketingAllowed: 'marketing_allowed', doubleOptInRequired: 'double_opt_in_required',
  quietHoursStart: 'quiet_hours_start', quietHoursEnd: 'quiet_hours_end', restrictions: 'restrictions',
  notes: 'notes', maxDailyMessages: 'max_daily_messages',
};
const pick = (body, map) => Object.fromEntries(Object.entries(map)
  .filter(([k]) => body[k] !== undefined).map(([k, col]) => [col, body[k] === '' ? null : body[k]]));

function validTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

async function createCountry(req, res, next) {
  try {
    const row = { iso2: String(req.body.iso2).toUpperCase(), ...pick(req.body, COUNTRY_FIELDS) };
    if (row.timezone && !validTimezone(row.timezone)) return fail(res, 400, 'VALIDATION_ERROR', 'That time zone is not recognised.');
    const { data, error } = await supabase.from('sms_countries').insert(row).select('*').single();
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'CONFLICT', 'That country already exists.');
      return fail(res, 400, 'VALIDATION_ERROR', 'The country could not be saved. Check the dial code and prefixes.');
    }
    config.invalidate();
    await audit(req, 'country.created', { iso2: row.iso2 });
    return sendOk(res, shape.country(data, [], await config.load()), { status: 201 });
  } catch (err) { return next(err); }
}

async function updateCountry(req, res, next) {
  try {
    const patch = pick(req.body, COUNTRY_FIELDS);
    if (patch.timezone && !validTimezone(patch.timezone)) return fail(res, 400, 'VALIDATION_ERROR', 'That time zone is not recognised.');
    if (Object.keys(patch).length === 0) return fail(res, 400, 'VALIDATION_ERROR', 'Nothing to update.');
    const { data: before } = await supabase.from('sms_countries').select('*').eq('iso2', req.params.iso2).maybeSingle();
    if (!before) return fail(res, 404, 'NOT_FOUND', 'No such country.');
    // Going back to "unknown" sender rules un-verifies the country: its record no longer says what was checked.
    if (patch.sender_id_support === 'unknown' && before.status === 'enabled') {
      return fail(res, 409, 'CONFLICT', 'Disable the country before clearing its sender-ID rules.');
    }
    const { data, error } = await supabase.from('sms_countries').update(patch).eq('iso2', req.params.iso2).select('*').single();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The country could not be saved. Check the values.');
    config.invalidate();
    await audit(req, 'country.updated', {
      iso2: req.params.iso2,
      before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])),
      after: Object.fromEntries(Object.keys(patch).map((k) => [k, data[k]])),
    });
    return sendOk(res, shape.country(data, await routesFor([data.iso2]), await config.load()));
  } catch (err) { return next(err); }
}

/** Records that a person checked this country's rules. Required before enabling. */
async function verifyCountry(req, res, next) {
  try {
    const { data: c } = await supabase.from('sms_countries').select('*').eq('iso2', req.params.iso2).maybeSingle();
    if (!c) return fail(res, 404, 'NOT_FOUND', 'No such country.');
    if (c.sender_id_support === 'unknown') {
      return fail(res, 409, 'CONFLICT', 'Record the sender-ID rules for this country before verifying it.');
    }
    const routes = await routesFor([c.iso2]);
    if (!routes.some((r) => r.verified && r.active)) {
      return fail(res, 409, 'CONFLICT', 'Verify at least one provider route for this country first.');
    }
    const { data, error } = await supabase.from('sms_countries').update({
      verified_at: new Date().toISOString(), verified_by: req.user.id,
      verification_source: req.body.source, notes: req.body.notes ?? c.notes,
    }).eq('iso2', c.iso2).select('*').single();
    if (error) throw new Error(error.message);
    config.invalidate();
    await audit(req, 'country.verified', { iso2: c.iso2, source: req.body.source });
    return sendOk(res, shape.country(data, routes, await config.load()));
  } catch (err) { return next(err); }
}

async function setCountryStatus(req, res, next) {
  try {
    const status = req.body.status;
    const { data: before } = await supabase.from('sms_countries').select('status').eq('iso2', req.params.iso2).maybeSingle();
    if (!before) return fail(res, 404, 'NOT_FOUND', 'No such country.');
    const patch = { status };
    if (status === 'enabled') Object.assign(patch, { paused_until: null, paused_reason: null });
    const { data, error } = await supabase.from('sms_countries').update(patch).eq('iso2', req.params.iso2).select('*').single();
    if (error) {
      // The database refuses an unverified country (CHECK + trigger). Say why.
      if (/SMS_COUNTRY_UNVERIFIED|sms_country_enabled_is_verified/.test(error.message)) {
        return fail(res, 409, 'CONFLICT',
          'This country cannot be enabled yet: it needs its sender-ID rules, a verification record, and a verified route through an enabled provider.');
      }
      throw new Error(error.message);
    }
    config.invalidate();
    await audit(req, `country.${status}`, { iso2: req.params.iso2, from: before.status, reason: req.body.reason || null });
    return sendOk(res, shape.country(data, await routesFor([data.iso2]), await config.load()));
  } catch (err) { return next(err); }
}

async function resumeCountry(req, res, next) {
  try {
    const { error } = await supabase.from('sms_countries').update({ paused_until: null, paused_reason: null }).eq('iso2', req.params.iso2);
    if (error) throw new Error(error.message);
    config.invalidate();
    await audit(req, 'country.resumed', { iso2: req.params.iso2 });
    return sendOk(res, { resumed: true });
  } catch (err) { return next(err); }
}

// ─── Routes ────────────────────────────────────────────────────────────────

async function upsertRoute(req, res, next) {
  try {
    const { iso2, provider } = req.params;
    if (!providers.ADAPTERS[provider]) return fail(res, 404, 'NOT_FOUND', 'Unknown provider.');
    const { data: existing } = await supabase.from('sms_routes').select('*').eq('country', iso2).eq('provider_id', provider).maybeSingle();
    const row = { country: iso2, provider_id: provider, updated_at: new Date().toISOString() };
    for (const [k, col] of Object.entries({ priority: 'priority', senderId: 'sender_id', active: 'active', notes: 'notes', currency: 'currency' })) {
      if (req.body[k] !== undefined) row[col] = req.body[k] === '' ? null : req.body[k];
    }
    if (req.body.costMicros !== undefined) {
      row.cost_micros = req.body.costMicros;
      row.cost_source = req.body.costMicros == null ? null : 'manual';
    }
    if (row.currency) row.currency = String(row.currency).toUpperCase();
    if (req.body.verified === true && !existing?.verified) Object.assign(row, { verified: true, verified_at: new Date().toISOString(), verified_by: req.user.id });
    if (req.body.verified === false) Object.assign(row, { verified: false, verified_at: null, verified_by: null });
    if (row.sender_id) {
      const { data: s } = await supabase.from('sms_senders').select('provider_id').eq('id', row.sender_id).maybeSingle();
      if (!s || s.provider_id !== provider) return fail(res, 400, 'VALIDATION_ERROR', 'That sender belongs to another provider.');
    }
    const { data, error } = await supabase.from('sms_routes').upsert(row, { onConflict: 'country,provider_id' }).select('*').single();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The route could not be saved.');
    config.invalidate();
    await audit(req, 'route.saved', { iso2, provider, changes: req.body });
    return sendOk(res, shape.route(data));
  } catch (err) { return next(err); }
}

async function deleteRoute(req, res, next) {
  try {
    const { iso2, provider } = req.params;
    const { data: c } = await supabase.from('sms_countries').select('status').eq('iso2', iso2).maybeSingle();
    const { data: others } = await supabase.from('sms_routes').select('provider_id')
      .eq('country', iso2).eq('verified', true).eq('active', true).neq('provider_id', provider);
    if (c?.status === 'enabled' && !(others || []).length) {
      return fail(res, 409, 'CONFLICT', 'This is the country’s last verified route. Disable the country first.');
    }
    const { error } = await supabase.from('sms_routes').delete().eq('country', iso2).eq('provider_id', provider);
    if (error) throw new Error(error.message);
    config.invalidate();
    await audit(req, 'route.deleted', { iso2, provider });
    return sendOk(res, { deleted: true });
  } catch (err) { return next(err); }
}

// ─── Providers ─────────────────────────────────────────────────────────────

async function listProviders(req, res, next) {
  try {
    const cfg = await config.load({ fresh: true });
    const counts = {};
    for (const r of cfg.routes) {
      counts[r.provider_id] ??= { routes: 0, verified: 0, available: 0 };
      counts[r.provider_id].routes += 1;
      if (r.verified) counts[r.provider_id].verified += 1;
      if (r.available) counts[r.provider_id].available += 1;
    }
    const list = [...cfg.providers.values()].sort((a, b) => a.priority - b.priority).map((p) => {
      const adapter = providers.ADAPTERS[p.id];
      return {
        ...shape.provider(p),
        credentials: adapter ? adapter.credentialStatus() : { configured: false, missing: ['no adapter in this build'] },
        routes: counts[p.id] || { routes: 0, verified: 0, available: 0 },
        senders: cfg.senders.filter((s) => s.provider_id === p.id).length,
        webhooks: {
          status: auth.webhookBase() ? `${auth.webhookBase()}/api/v1/sms/webhooks/${p.id}/status` : null,
          inbound: auth.inboundUrl(p.id, { withToken: false }),
          inboundNeedsToken: p.id !== 'twilio',
        },
      };
    });
    return sendOk(res, list, { meta: { dryRun: providers.dryRun(), webhookBaseConfigured: Boolean(auth.webhookBase()) } });
  } catch (err) { return next(err); }
}

async function updateProvider(req, res, next) {
  try {
    const patch = pick(req.body, { enabled: 'enabled', priority: 'priority', maxTps: 'max_tps', trafficClasses: 'traffic_classes' });
    if (patch.enabled === true) {
      const adapter = providers.ADAPTERS[req.params.provider];
      if (!adapter?.configured()) {
        return fail(res, 409, 'CONFLICT', `Set ${adapter ? adapter.credentialStatus().missing.join(', ') : 'credentials'} on the server before enabling this provider.`);
      }
    }
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('sms_providers').update(patch).eq('id', req.params.provider).select('*').maybeSingle();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The provider could not be saved.');
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Unknown provider.');
    config.invalidate();
    await audit(req, 'provider.updated', { provider: req.params.provider, changes: req.body });
    return sendOk(res, shape.provider(data));
  } catch (err) { return next(err); }
}

async function resetCircuit(req, res, next) {
  try {
    await supabase.from('sms_providers').update({ circuit_open_until: null, consecutive_failures: 0 }).eq('id', req.params.provider);
    config.invalidate();
    await audit(req, 'provider.circuit_reset', { provider: req.params.provider });
    return sendOk(res, { reset: true });
  } catch (err) { return next(err); }
}

async function syncPricing(req, res, next) {
  try {
    const { provider } = req.params;
    const adapter = providers.ADAPTERS[provider];
    if (!adapter) return fail(res, 404, 'NOT_FOUND', 'Unknown provider.');
    if (!adapter.configured()) return fail(res, 409, 'CONFLICT', `Set ${adapter.credentialStatus().missing.join(', ')} on the server first.`);
    if (req.body.country) {
      const result = await pricing.syncCountry(provider, String(req.body.country).toUpperCase());
      config.invalidate();
      return sendOk(res, result);
    }
    const { data: p } = await supabase.from('sms_providers').select('pricing_sync').eq('id', provider).single();
    if (p?.pricing_sync?.running && Date.now() - new Date(p.pricing_sync.startedAt).getTime() < 30 * 60_000) {
      return fail(res, 409, 'CONFLICT', 'A price sync for this provider is already running.');
    }
    pricing.syncAll(provider).catch((err) => logger.error({ err: err.message, provider }, 'SMS pricing sync failed'));
    await audit(req, 'provider.pricing_sync', { provider });
    return sendOk(res, { started: true }, { status: 202 });
  } catch (err) { return next(err); }
}

// ─── Senders ───────────────────────────────────────────────────────────────

const SENDER_FIELDS = {
  providerId: 'provider_id', kind: 'kind', value: 'value', label: 'label', trafficClasses: 'traffic_classes',
  countries: 'countries', registrationStatus: 'registration_status', registrationReference: 'registration_reference',
  approvedAt: 'approved_at', expiresAt: 'expires_at', active: 'active', notes: 'notes',
};

function normaliseSender(row) {
  if (row.countries) row.countries = [...new Set(row.countries.map((c) => String(c).toUpperCase()))];
  if (row.registration_status === 'approved' && !row.approved_at) row.approved_at = new Date().toISOString();
  return row;
}

async function listSenders(req, res, next) {
  try {
    const { data, error } = await supabase.from('sms_senders').select('*').order('provider_id').order('created_at');
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map(shape.sender));
  } catch (err) { return next(err); }
}

async function createSender(req, res, next) {
  try {
    const row = normaliseSender(pick(req.body, SENDER_FIELDS));
    const { data, error } = await supabase.from('sms_senders').insert(row).select('*').single();
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'CONFLICT', 'That sender already exists for this provider.');
      return fail(res, 400, 'VALIDATION_ERROR', 'Check the sender: phone numbers in +E.164, alphanumeric IDs up to 11 letters and digits.');
    }
    config.invalidate();
    await audit(req, 'sender.created', { id: data.id, provider: data.provider_id, kind: data.kind });
    return sendOk(res, shape.sender(data), { status: 201 });
  } catch (err) { return next(err); }
}

async function updateSender(req, res, next) {
  try {
    const { providerId: _fixed, ...editable } = SENDER_FIELDS;   // a sender never moves provider
    const row = normaliseSender(pick(req.body, editable));
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('sms_senders').update(row).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The sender could not be saved. Check the values.');
    if (!data) return fail(res, 404, 'NOT_FOUND', 'No such sender.');
    config.invalidate();
    await audit(req, 'sender.updated', { id: data.id, changes: req.body });
    return sendOk(res, shape.sender(data));
  } catch (err) { return next(err); }
}

async function deleteSender(req, res, next) {
  try {
    const { error } = await supabase.from('sms_senders').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    config.invalidate();
    await audit(req, 'sender.deleted', { id: req.params.id });
    return sendOk(res, { deleted: true });
  } catch (err) { return next(err); }
}

// ─── Categories and settings ───────────────────────────────────────────────

async function listCategories(req, res, next) {
  try {
    const cfg = await config.load({ fresh: true });
    return sendOk(res, [...cfg.categories.values()].map(shape.category));
  } catch (err) { return next(err); }
}

async function updateCategory(req, res, next) {
  try {
    const patch = pick(req.body, {
      enabled: 'enabled', requiresApproval: 'requires_approval', minRole: 'min_role',
      perRecipientDailyLimit: 'per_recipient_daily_limit', respectQuietHours: 'respect_quiet_hours',
      maxSegments: 'max_segments', label: 'label', description: 'description',
    });
    patch.updated_at = new Date().toISOString();
    patch.updated_by = req.user.id;
    const { data, error } = await supabase.from('sms_categories').update(patch).eq('key', req.params.key).select('*').maybeSingle();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The category could not be saved.');
    if (!data) return fail(res, 404, 'NOT_FOUND', 'No such category.');
    config.invalidate();
    await audit(req, 'category.updated', { key: req.params.key, changes: req.body });
    return sendOk(res, shape.category(data));
  } catch (err) { return next(err); }
}

async function getSettings(req, res, next) {
  try {
    const cfg = await config.load({ fresh: true });
    return sendOk(res, shape.settings(cfg.settings));
  } catch (err) { return next(err); }
}

async function updateSettings(req, res, next) {
  try {
    const patch = pick(req.body, {
      sendingEnabled: 'sending_enabled', brandName: 'brand_name', optOutText: 'opt_out_text', helpText: 'help_text',
      replyToHelp: 'reply_to_help', defaultQuietStart: 'default_quiet_start', defaultQuietEnd: 'default_quiet_end',
      countryHourlyLimit: 'country_hourly_limit', dailyMarketingCapMicros: 'daily_marketing_cap_micros',
      spendCurrency: 'spend_currency', reminderHoursBefore: 'reminder_hours_before', maxCampaignRecipients: 'max_campaign_recipients',
    });
    if (patch.spend_currency) patch.spend_currency = String(patch.spend_currency).toUpperCase();
    // "STOP" must stay in the opt-out line: it is the word carriers act on.
    if (patch.opt_out_text && !/\bSTOP\b/.test(patch.opt_out_text)) {
      return fail(res, 400, 'VALIDATION_ERROR', 'The opt-out line must contain the word STOP.');
    }
    patch.updated_at = new Date().toISOString();
    patch.updated_by = req.user.id;
    const { data, error } = await supabase.from('sms_settings').update(patch).eq('id', 1).select('*').single();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The settings could not be saved. Check the values.');
    config.invalidate();
    await audit(req, 'settings.updated', { changes: req.body });
    return sendOk(res, shape.settings(data));
  } catch (err) { return next(err); }
}

module.exports = {
  listCountries, countryDetail, createCountry, updateCountry, verifyCountry, setCountryStatus, resumeCountry,
  upsertRoute, deleteRoute,
  listProviders, updateProvider, resetCircuit, syncPricing,
  listSenders, createSender, updateSender, deleteSender,
  listCategories, updateCategory, getSettings, updateSettings,
  countryStats,
};
