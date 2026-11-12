const { supabase } = require('../../config/supabase');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { writeAudit } = require('../../services/auditService');
const { parsePagination, buildMeta } = require('../../middleware/pagination');
const { hasRole } = require('../../services/rbacService');
const config = require('../../services/sms/config');
const queue = require('../../services/sms/queue');
const consent = require('../../services/sms/consent');
const phone = require('../../services/sms/phone');
const providers = require('../../services/sms/providers');
const auth = require('../../services/sms/webhookAuth');
const { countryStats } = require('./smsConfigController');
const shape = require('./smsShape');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SMS operations: the overview, analytics, the delivery log, test sends, the
 * suppression list and consent records.
 *
 * Retrying an UNKNOWN message is the one action here that can text someone
 * twice, so it is a super admin's call and needs an explicit acknowledgement
 * in the request (`acceptDuplicateRisk: true`), which the audit records.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const audit = (req, action, payload) => writeAudit(req, { action: `sms.${action}`, targetType: 'sms', payload });
const fail = (res, status, error, message) => sendFail(res, { status, error, message });
const DAY = 86_400_000;

async function analyticsFor(since, until = new Date()) {
  const { data, error } = await supabase.rpc('sms_analytics', { p_since: since.toISOString(), p_until: until.toISOString() });
  if (error) throw new Error(error.message);
  return data;
}

async function overview(req, res, next) {
  try {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY);
    const [current, previous, stats, cfg, activity, campaigns] = await Promise.all([
      analyticsFor(since, now),
      analyticsFor(new Date(since.getTime() - days * DAY), since),
      countryStats(),
      config.load({ fresh: true }),
      supabase.from('admin_audit').select('id, action, payload, created_at, actor_id')
        .like('action', 'sms.%').order('created_at', { ascending: false }).limit(8),
      supabase.from('sms_campaigns').select('id, name, status, started_at, completed_at, recipients_queued')
        .order('updated_at', { ascending: false }).limit(5),
    ]);
    const configuredProviders = [...cfg.providers.values()].filter((p) => providers.ADAPTERS[p.id]?.configured());
    const verifiedRoutes = cfg.routes.filter((r) => r.verified && r.active).length;
    const { data: topCountries } = await supabase.from('sms_countries').select('*')
      .order('verified_at', { ascending: false, nullsFirst: false }).order('name').limit(6);
    const routes = cfg.routes.filter((r) => (topCountries || []).some((c) => c.iso2 === r.country));

    return sendOk(res, {
      days,
      current, previous,
      countries: stats,
      topCountries: (topCountries || []).map((c) => shape.country(c, routes.filter((r) => r.country === c.iso2), cfg)),
      categories: [...cfg.categories.values()].map(shape.category),
      settings: shape.settings(cfg.settings),
      readiness: {
        sendingEnabled: Boolean(cfg.settings?.sending_enabled),
        providersConfigured: configuredProviders.length,
        providersEnabled: [...cfg.providers.values()].filter((p) => p.enabled).length,
        sendersActive: cfg.senders.filter((s) => s.active).length,
        verifiedRoutes,
        countriesEnabled: stats.enabled,
        webhooksConfigured: Boolean(auth.webhookBase()),
        dryRun: providers.dryRun(),
      },
      activity: (activity.data || []).map((a) => ({ id: a.id, action: a.action, payload: a.payload, at: a.created_at })),
      campaigns: (campaigns.data || []).map((c) => ({ id: c.id, name: c.name, status: c.status, at: c.completed_at || c.started_at, recipients: c.recipients_queued })),
    });
  } catch (err) { return next(err); }
}

async function analytics(req, res, next) {
  try {
    const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY);
    const [current, previous] = await Promise.all([
      analyticsFor(since, now), analyticsFor(new Date(since.getTime() - days * DAY), since),
    ]);
    return sendOk(res, { days, current, previous });
  } catch (err) { return next(err); }
}

// ─── Messages ──────────────────────────────────────────────────────────────

async function listMessages(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['created_at'], defaultSort: 'created_at' });
    let q = supabase.from('sms_messages').select('*', { count: 'exact' });
    for (const [param, col] of [['status', 'status'], ['category', 'category'], ['country', 'country'], ['provider', 'provider_id'], ['campaignId', 'campaign_id']]) {
      if (req.query[param]) q = q.eq(col, req.query[param]);
    }
    if (req.query.phone) {
      const cfg = await config.load();
      const parsed = phone.normalize(req.query.phone, { matcher: cfg.matcher });
      if (!parsed) return sendOk(res, [], { pagination: buildMeta(p, 0) });
      q = q.eq('to_e164', parsed.e164);
    }
    const { data, count, error } = await q.order('created_at', { ascending: false }).range(p.from, p.to);
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map((m) => shape.message(m)), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

async function messageDetail(req, res, next) {
  try {
    const { data: m } = await supabase.from('sms_messages').select('*').eq('id', req.params.id).maybeSingle();
    if (!m) return fail(res, 404, 'NOT_FOUND', 'No such message.');
    const [attempts, receipts] = await Promise.all([
      supabase.from('sms_attempts').select('*').eq('message_id', m.id).order('attempt_no'),
      supabase.from('sms_receipts').select('id, provider_id, status_raw, status, error_code, received_at').eq('message_id', m.id).order('received_at'),
    ]);
    return sendOk(res, {
      ...shape.message(m, { full: true }),
      attempts: (attempts.data || []).map((a) => ({
        attemptNo: a.attempt_no, providerId: a.provider_id, senderValue: a.sender_value, outcome: a.outcome,
        providerMessageId: a.provider_message_id, httpStatus: a.http_status, errorCode: a.error_code,
        errorMessage: a.error_message, startedAt: a.started_at, finishedAt: a.finished_at,
      })),
      receipts: (receipts.data || []).map((r) => ({
        providerId: r.provider_id, statusRaw: r.status_raw, status: r.status, errorCode: r.error_code, at: r.received_at,
      })),
    });
  } catch (err) { return next(err); }
}

async function retryMessage(req, res, next) {
  try {
    const { data: m } = await supabase.from('sms_messages').select('*').eq('id', req.params.id).maybeSingle();
    if (!m) return fail(res, 404, 'NOT_FOUND', 'No such message.');
    if (!['failed', 'unknown', 'blocked'].includes(m.status)) return fail(res, 409, 'CONFLICT', `A ${m.status} message cannot be retried.`);
    if (m.status === 'unknown' && req.body.acceptDuplicateRisk !== true) {
      return fail(res, 409, 'CONFLICT', 'This message may already have been delivered. Confirm the duplicate risk to retry it.');
    }
    const { data, error } = await supabase.from('sms_messages').update({
      status: 'queued', next_attempt_at: new Date().toISOString(), block_reason: null, tried_providers: [],
      max_attempts: Math.min(20, (m.attempts || 0) + 3), lease_until: null, lease_holder: null, finished_at: null,
      metadata: { ...m.metadata, manualRetryBy: req.user.id, manualRetryAt: new Date().toISOString(), avoid: null },
      updated_at: new Date().toISOString(),
    }).eq('id', m.id).eq('status', m.status).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail(res, 409, 'CONFLICT', 'This message changed. Reload and try again.');
    await audit(req, 'message.retried', { id: m.id, from: m.status, acceptDuplicateRisk: m.status === 'unknown' });
    return sendOk(res, shape.message(data));
  } catch (err) { return next(err); }
}

async function cancelMessage(req, res, next) {
  try {
    const { data, error } = await supabase.from('sms_messages')
      .update({ status: 'cancelled', block_reason: 'manual_cancel', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('status', 'queued').select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail(res, 409, 'CONFLICT', 'Only a queued message can be cancelled.');
    await audit(req, 'message.cancelled', { id: data.id });
    return sendOk(res, shape.message(data));
  } catch (err) { return next(err); }
}

/** A test text from the console. Goes through the full pipeline: policy, routing, receipts. */
async function sendTest(req, res, next) {
  try {
    const cfg = await config.load();
    const category = cfg.categories.get(req.body.category || 'participant');
    if (!category) return fail(res, 400, 'VALIDATION_ERROR', 'Unknown category.');
    if (!hasRole(req.user.access, category.min_role)) return fail(res, 403, 'FORBIDDEN', 'Your role cannot send in this category.');
    const parsed = phone.normalize(req.body.to, { matcher: cfg.matcher });
    if (!parsed) return fail(res, 400, 'VALIDATION_ERROR', 'Enter the number in international format, starting with + and the country code.');
    const result = await queue.enqueue({
      category: category.key, e164: parsed.e164, country: parsed.country,
      body: req.body.body, consentScope: category.traffic_class === 'marketing' ? 'platform' : null,
      idempotencyKey: `test:${req.user.id}:${Date.now()}`, createdBy: req.user.id,
      metadata: { purpose: 'console_test' },
    });
    if (!result.queued) {
      const why = { too_long: `Too long for this category (${result.segments} segments).`, invalid_number: 'That number is not valid.' };
      return fail(res, 400, 'VALIDATION_ERROR', why[result.reason] || 'The test message could not be queued.');
    }
    await audit(req, 'test.sent', { id: result.id, country: parsed.country, category: category.key });
    return sendOk(res, { id: result.id, country: parsed.country, segments: result.segments }, { status: 201 });
  } catch (err) { return next(err); }
}

// ─── Suppressions and consent ──────────────────────────────────────────────

async function listSuppressions(req, res, next) {
  try {
    const p = parsePagination(req, { sortable: ['created_at'], defaultSort: 'created_at' });
    let q = supabase.from('sms_suppressions').select('*', { count: 'exact' });
    if (req.query.reason) q = q.eq('reason', req.query.reason);
    if (req.query.phone) {
      const parsed = phone.normalize(req.query.phone, { matcher: (await config.load()).matcher });
      q = q.eq('phone_e164', parsed?.e164 || '+0');
    }
    const { data, count, error } = await q.order('created_at', { ascending: false }).range(p.from, p.to);
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map((s) => ({
      phone: phone.mask(s.phone_e164), scope: s.scope, reason: s.reason, note: s.note, providerId: s.provider_id, createdAt: s.created_at,
      key: Buffer.from(s.phone_e164).toString('base64url'),
    })), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

async function addSuppression(req, res, next) {
  try {
    const parsed = phone.normalize(req.body.phone, { matcher: (await config.load()).matcher });
    if (!parsed) return fail(res, 400, 'VALIDATION_ERROR', 'Enter the number in international format.');
    const { error } = await supabase.from('sms_suppressions').upsert({
      phone_e164: parsed.e164, scope: req.body.scope, reason: req.body.reason || 'admin', note: req.body.note || null, created_by: req.user.id,
    }, { onConflict: 'phone_e164' });
    if (error) throw new Error(error.message);
    await audit(req, 'suppression.added', { phone: phone.mask(parsed.e164), scope: req.body.scope, reason: req.body.reason || 'admin' });
    return sendOk(res, { phone: phone.mask(parsed.e164) }, { status: 201 });
  } catch (err) { return next(err); }
}

/** A person's own STOP or unsubscribe is theirs to undo, by replying START — never an admin's. */
async function removeSuppression(req, res, next) {
  try {
    const e164 = Buffer.from(String(req.params.key), 'base64url').toString('utf8');
    const { data: s } = await supabase.from('sms_suppressions').select('*').eq('phone_e164', e164).maybeSingle();
    if (!s) return fail(res, 404, 'NOT_FOUND', 'Not on the list.');
    if (['stop_keyword', 'opt_out_link', 'carrier_opt_out'].includes(s.reason)) {
      return fail(res, 409, 'CONFLICT', 'This number opted out itself. Only the person can undo that, by replying START.');
    }
    await supabase.from('sms_suppressions').delete().eq('phone_e164', e164);
    await audit(req, 'suppression.removed', { phone: phone.mask(e164), reason: s.reason });
    return sendOk(res, { removed: true });
  } catch (err) { return next(err); }
}

async function lookupConsent(req, res, next) {
  try {
    const parsed = phone.normalize(req.query.phone, { matcher: (await config.load()).matcher });
    if (!parsed) return fail(res, 400, 'VALIDATION_ERROR', 'Enter the number in international format.');
    const [current, history, suppression] = await Promise.all([
      supabase.from('sms_consents').select('scope, status, source, updated_at').eq('phone_e164', parsed.e164),
      supabase.from('sms_consent_log').select('scope, status, source, evidence, created_at').eq('phone_e164', parsed.e164)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('sms_suppressions').select('scope, reason, created_at').eq('phone_e164', parsed.e164).maybeSingle(),
    ]);
    return sendOk(res, {
      phone: phone.mask(parsed.e164), country: parsed.country,
      consents: (current.data || []).map((c) => ({ scope: c.scope, status: c.status, source: c.source, updatedAt: c.updated_at })),
      history: (history.data || []).map((h) => ({ scope: h.scope, status: h.status, source: h.source, evidence: h.evidence, at: h.created_at })),
      suppression: suppression.data ? { scope: suppression.data.scope, reason: suppression.data.reason, at: suppression.data.created_at } : null,
    });
  } catch (err) { return next(err); }
}

async function importConsents(req, res, next) {
  try {
    const result = await consent.importConsents({
      phones: req.body.phones, scope: req.body.scope || 'platform', defaultCountry: req.body.defaultCountry || null,
      evidenceStatement: req.body.evidence, actorId: req.user.id,
    });
    await audit(req, 'consent.imported', { scope: req.body.scope || 'platform', evidence: req.body.evidence, ...result });
    return sendOk(res, result);
  } catch (err) { return next(err); }
}

module.exports = {
  overview, analytics, listMessages, messageDetail, retryMessage, cancelMessage, sendTest,
  listSuppressions, addSuppression, removeSuppression, lookupConsent, importConsents,
};
