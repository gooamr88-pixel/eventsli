const { supabase } = require('../../config/supabase');
const rules = require('../../services/eventRules');
const { describeFeeConfig, FEE_BEARER, PAYMENT_FEE_MODE } = require('../../utils/money');
const { stripeCostModel } = require('../../services/pricingService');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { hashIp } = require('../../utils/crypto');
const logger = require('../../utils/logger');

/**
 * BRD §19 — the settings only an admin may touch.
 *
 * The commission, the tax and the payment fee are the admin's alone (BRD §05,
 * §06); an organizer who could set their own commission would set it to zero.
 * `eventRules.partitionPatch` already enforces that on the organizer's endpoint
 * — this is the other side of the same rule, and it deliberately reuses the
 * SAME map rather than keeping a second list that can drift.
 */

// ─── PATCH /admin/events/:eventId/fees ─────────────────────────────────────
async function updateEventFees(req, res, next) {
  try {
    const { allowed, denied } = rules.partitionPatch(req.body, { isAdmin: true });

    if (denied.length > 0) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: `Not a fee setting: ${denied.join(', ')}.`,
        meta: { deniedFields: denied },
      });
    }
    // Only the money fields belong on this endpoint. Letting it write a title
    // would make "who changed the event?" unanswerable from the audit trail.
    const feeColumns = new Set(Object.values(rules.ADMIN_EDITABLE));
    const stray = Object.keys(allowed).filter((k) => !feeColumns.has(k));
    if (stray.length > 0) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: `Use the event endpoint for: ${stray.join(', ')}.`,
      });
    }
    if (Object.keys(allowed).length === 0) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'Nothing to update.' });
    }

    const { data: before } = await supabase
      .from('events')
      .select('id, title, commission_pct, commission_tax_pct, payment_fee_mode, payment_fee_pct, payment_fee_fixed_cents, event_tax_pct')
      .eq('id', req.params.eventId)
      .maybeSingle();

    if (!before) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }

    const { data, error } = await supabase
      .from('events')
      .update({ ...allowed, updated_at: new Date().toISOString() })
      .eq('id', req.params.eventId)
      .select('id, commission_pct, commission_tax_pct, payment_fee_mode, payment_fee_pct, payment_fee_fixed_cents, event_tax_pct, fee_bearer, currency')
      .single();

    if (error) throw new Error(error.message);

    // Both values recorded, not just the new one. "The commission is 3%" is not
    // the question anyone asks six months later; "who changed it from 1.5, and
    // when" is.
    await supabase.from('admin_audit').insert({
      actor_id: req.user.id,
      action: 'event.fees_changed',
      target_type: 'event',
      target_id: req.params.eventId,
      payload: { before: pick(before, Object.keys(allowed)), after: pick(data, Object.keys(allowed)) },
      ip_hash: hashIp(req.ip),
    });

    logger.warn({ eventId: req.params.eventId, by: req.user.id, changed: Object.keys(allowed) },
      'event fees changed by admin');

    // BRD §13 freezes the PRICE after a sale, not the rates — an admin can
    // still renegotiate a commission mid-event. Said out loud so nobody assumes
    // historical orders move: they carry their own snapshot.
    return sendOk(res, {
      ...shapeFees(data),
      note: 'Applies to tickets sold from now on. Orders already placed keep the rates they were sold at.',
    });
  } catch (err) { return next(err); }
}

// ─── GET /admin/events/:eventId/fees/preview ───────────────────────────────
/**
 * What a fee configuration actually earns, priced across a range.
 *
 * `describeFeeConfig` has existed since the money module was written and had no
 * way to be seen. An admin typing "2.9% + $0.30" has no way to know from those
 * numbers that a $20 ticket earns a different margin from a $200 one, or that
 * turning on a 13% tax quietly moves both — and the shortfall is systematic,
 * not occasional.
 */
async function previewFees(req, res, next) {
  try {
    const { data: event } = await supabase
      .from('events')
      .select('id, title, currency, commission_pct, commission_tax_pct, payment_fee_mode, payment_fee_pct, payment_fee_fixed_cents, event_tax_pct, fee_bearer')
      .eq('id', req.params.eventId)
      .maybeSingle();

    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }

    // Proposed values win, so the screen can preview an unsaved change. This is
    // the whole point: see what it does BEFORE saving it.
    const mode = req.query.paymentFeeMode || event.payment_fee_mode;
    const cfg = describeFeeConfig({
      mode: mode === 'manual' ? PAYMENT_FEE_MODE.MANUAL : PAYMENT_FEE_MODE.AUTO,
      paymentFeePct: num(req.query.paymentFeePct, event.payment_fee_pct),
      paymentFeeFixedCents: num(req.query.paymentFeeFixedCents, event.payment_fee_fixed_cents),
      commissionPct: num(req.query.commissionPct, event.commission_pct),
      commissionTaxPct: num(req.query.commissionTaxPct, event.commission_tax_pct),
      eventTaxPct: num(req.query.eventTaxPct, event.event_tax_pct),
      feeBearer: (req.query.feeBearer || event.fee_bearer) === 'organizer'
        ? FEE_BEARER.ORGANIZER : FEE_BEARER.BUYER,
      stripe: await stripeCostModel(),
    });

    return sendOk(res, {
      currency: event.currency,
      mode: cfg.mode,
      feeBearer: cfg.feeBearer,
      // Painted red by the admin screen, in the row that causes it — rather
      // than discovered in a monthly total three weeks later.
      anyBelowCost: cfg.anyBelowCost,
      anyLossMaking: cfg.anyLossMaking,
      rows: cfg.rows,
    });
  } catch (err) { return next(err); }
}

// ─── GET/PATCH /admin/settings ─────────────────────────────────────────────
const EDITABLE_SETTINGS = new Set(['commission', 'payment_fee', 'stripe_cost', 'currencies', 'manual_invoice']);

async function getSettings(req, res, next) {
  try {
    const { data } = await supabase.from('platform_settings').select('key, value, updated_at');
    return sendOk(res, Object.fromEntries((data || []).map((r) => [r.key, r.value])));
  } catch (err) { return next(err); }
}

async function updateSettings(req, res, next) {
  try {
    const { key } = req.params;
    if (!EDITABLE_SETTINGS.has(key)) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: `Not an editable setting: ${key}.`,
      });
    }

    const { data: before } = await supabase
      .from('platform_settings').select('value').eq('key', key).maybeSingle();

    const { data, error } = await supabase
      .from('platform_settings')
      .upsert({ key, value: req.body.value, updated_by: req.user.id, updated_at: new Date().toISOString() },
        { onConflict: 'key' })
      .select('key, value')
      .single();

    if (error) throw new Error(error.message);

    await supabase.from('admin_audit').insert({
      actor_id: req.user.id, action: 'settings.changed',
      target_type: 'platform_settings', target_id: null,
      payload: { key, before: before?.value ?? null, after: data.value },
      ip_hash: hashIp(req.ip),
    });

    logger.warn({ key, by: req.user.id }, 'platform settings changed');
    return sendOk(res, data);
  } catch (err) { return next(err); }
}

// ─── GET /admin/audit ──────────────────────────────────────────────────────
async function auditLog(req, res, next) {
  try {
    const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
    const p = parsePagination(req, { sortable: ['created_at'], defaultSort: 'created_at' });

    let query = supabase
      .from('admin_audit')
      .select('id, action, target_type, target_id, payload, created_at, profiles ( email, full_name )',
        { count: 'exact' });

    if (req.query.action) query = query.eq('action', req.query.action);

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map((r) => ({
      id: r.id,
      action: r.action,
      target: { type: r.target_type, id: r.target_id },
      actor: r.profiles ? { email: r.profiles.email, name: r.profiles.full_name } : null,
      payload: r.payload,
      at: r.created_at,
    })), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

const num = (v, fallback) => (v === undefined || v === '' ? Number(fallback) : Number(v));
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k]]));

function shapeFees(e) {
  return {
    id: e.id,
    currency: e.currency,
    commissionPct: Number(e.commission_pct),
    commissionTaxPct: Number(e.commission_tax_pct),
    paymentFeeMode: e.payment_fee_mode,
    paymentFeePct: Number(e.payment_fee_pct),
    paymentFeeFixedCents: e.payment_fee_fixed_cents,
    eventTaxPct: Number(e.event_tax_pct),
    feeBearer: e.fee_bearer,
  };
}

module.exports = { updateEventFees, previewFees, getSettings, updateSettings, auditLog };
