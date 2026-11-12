const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const config = require('./config');
const phone = require('./phone');
const { compose } = require('./compose');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Putting a message in the queue. Every SMS the platform sends enters here.
 *
 * IDEMPOTENT BY KEY. The caller names the message ("order:<id>:confirmation",
 * "campaign:<id>:<phone>"); a second enqueue with the same key is a no-op, so a
 * webhook delivered twice, a resend button pressed twice, or a campaign job
 * restarted halfway cannot produce a second text.
 *
 * Enqueueing never sends and never throws into business code: a ticket that
 * was issued stands whether or not its SMS could be queued.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PRIORITY = { transactional: 10, marketing: 50 };

function estimate(cfg, country, segments) {
  const route = (cfg.routesByCountry.get(country) || [])
    .filter((r) => r.active && r.verified && r.cost_micros != null)
    .sort((a, b) => a.priority - b.priority)[0];
  return route ? { est: route.cost_micros * segments, currency: route.currency } : { est: null, currency: null };
}

/** Builds the row, or explains why there is none. Shared by single and bulk enqueue. */
function buildRow(cfg, input) {
  const category = cfg.categories.get(input.category);
  if (!category) return { error: 'category_unknown' };
  const parsed = input.e164 && input.country
    ? { e164: input.e164, country: input.country }
    : phone.normalize(input.to, { defaultCountry: input.defaultCountry, matcher: cfg.matcher });
  if (!parsed) return { error: 'invalid_number' };

  const text = compose({ baseBody: input.body, category, settings: cfg.settings });
  if (text.segments > category.max_segments) return { error: 'too_long', segments: text.segments };
  const { est, currency } = estimate(cfg, parsed.country, text.segments);

  return {
    row: {
      idempotency_key: input.idempotencyKey,
      category: category.key,
      traffic_class: category.traffic_class,
      to_e164: parsed.e164,
      country: parsed.country,
      body: text.body,
      encoding: text.encoding,
      segments: text.segments,
      priority: input.priority ?? PRIORITY[category.traffic_class],
      consent_scope: input.consentScope || (category.traffic_class === 'marketing' ? 'platform' : null),
      campaign_id: input.campaignId || null,
      event_id: input.eventId || null,
      order_id: input.orderId || null,
      user_id: input.userId || null,
      created_by: input.createdBy || null,
      est_cost_micros: est,
      currency,
      next_attempt_at: input.notBefore ? new Date(input.notBefore).toISOString() : new Date().toISOString(),
      metadata: { ...(input.metadata || {}), baseBody: String(input.body).trim() },
    },
  };
}

/**
 * @returns {Promise<{ queued: boolean, duplicate?: boolean, id?: string, reason?: string }>}
 */
async function enqueue(input) {
  try {
    const cfg = await config.load();
    const built = buildRow(cfg, input);
    if (built.error) return { queued: false, reason: built.error, segments: built.segments };

    const { data, error } = await supabase
      .from('sms_messages')
      .upsert(built.row, { onConflict: 'idempotency_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return { queued: false, duplicate: true };
    return { queued: true, id: data[0].id, country: built.row.country, segments: built.row.segments };
  } catch (err) {
    logger.error({ err: err.message, key: input.idempotencyKey, category: input.category }, 'SMS could not be queued');
    return { queued: false, reason: 'error' };
  }
}

/** Many at once (campaigns). Rows that cannot be built are counted, not thrown. */
async function enqueueMany(inputs) {
  const cfg = await config.load();
  const rows = [];
  const skipped = {};
  for (const input of inputs) {
    const built = buildRow(cfg, input);
    if (built.error) skipped[built.error] = (skipped[built.error] || 0) + 1;
    else rows.push(built.row);
  }
  let queued = 0;
  for (let i = 0; i < rows.length; i += 500) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase
      .from('sms_messages')
      .upsert(rows.slice(i, i + 500), { onConflict: 'idempotency_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`could not queue campaign messages: ${error.message}`);
    queued += (data || []).length;
  }
  return { queued, duplicates: rows.length - queued, skipped };
}

module.exports = { enqueue, enqueueMany, buildRow, PRIORITY };
