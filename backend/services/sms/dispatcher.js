const crypto = require('node:crypto');
const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const config = require('./config');
const policy = require('./policy');
const routing = require('./routing');
const providers = require('./providers');
const { compose } = require('./compose');
const { nextStep } = require('./outcome');
const { mask } = require('./phone');
const { statusCallbackUrl, unsubscribeToken } = require('./webhookAuth');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The sender. Claims due messages, applies the compliance policy, routes each
 * one, calls the provider, and records exactly what happened.
 *
 * THE ORDER OF WRITES IS THE DUPLICATE GUARANTEE:
 *   1. the message row records attempt N and the provider about to be called;
 *   2. an attempt row N is written as 'pending';
 *   3. the provider is called;
 *   4. the attempt and the message record the outcome.
 * A worker that dies between 2 and 4 leaves a 'pending' attempt, and
 * `sms_release_stale` turns that message 'unknown' rather than queueing it
 * again. Dying before 2 leaves no attempt, so the message is safely requeued.
 *
 * Claims use SKIP LOCKED, so more than one worker can run this; the scheduler
 * runs it on one leader with a per-provider pace (`max_tps`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const HOLDER = `sms-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const CONCURRENCY = 8;
const nextFree = new Map();

async function pace(provider) {
  const tps = Math.max(1, provider?.max_tps || 1);
  const now = Date.now();
  const at = Math.max(now, nextFree.get(provider.id) || 0);
  nextFree.set(provider.id, at + 1000 / tps);
  if (at > now) await new Promise((r) => { setTimeout(r, at - now); });
}

function frontendBase() {
  return String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/+$/, '');
}

async function update(id, patch) {
  const { error } = await supabase.from('sms_messages')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) logger.error({ err: error.message, id }, 'SMS message update failed');
}

const finish = (msg, patch) => update(msg.id, {
  ...patch, lease_until: null, lease_holder: null, finished_at: new Date().toISOString(),
});

const requeue = (msg, at, patch = {}) => update(msg.id, {
  ...patch, status: 'queued', next_attempt_at: new Date(at).toISOString(), lease_until: null, lease_holder: null,
});

async function suppress(e164, reason, providerId) {
  await supabase.from('sms_suppressions').upsert({
    phone_e164: e164, scope: 'all', reason, provider_id: providerId, note: 'Set automatically from a provider response',
  }, { onConflict: 'phone_e164', ignoreDuplicates: true });
}

async function pauseCountry(iso2, reason) {
  const until = new Date(Date.now() + 3_600_000).toISOString();
  await supabase.from('sms_countries').update({ paused_until: until, paused_reason: reason }).eq('iso2', iso2);
  config.invalidate();
  logger.warn({ country: iso2, reason }, 'SMS country paused automatically');
}

/** Picks the first candidate route that also has a usable sender. */
function chooseRoute(cfg, msg, country) {
  const adapters = providers.adapters();
  const list = routing.candidates({
    routes: cfg.routesByCountry.get(country.iso2), providers: cfg.providers, adapters,
    country: country.iso2, trafficClass: msg.traffic_class,
    exclude: msg.tried_providers || [], avoid: msg.metadata?.avoid || null,
  });
  let senderError = null;
  for (let i = 0; i < list.length; i += 1) {
    const pick = routing.pickSender({ route: list[i], senders: cfg.senders, country, trafficClass: msg.traffic_class });
    if (pick.sender) return { route: list[i], sender: pick.sender, adapter: adapters[list[i].provider_id], others: list.length - i - 1 };
    senderError = pick.error;
  }
  return { error: list.length === 0 ? 'no_route' : senderError };
}

async function sendOne(msg, env) {
  const { cfg, ctx, suppressions, consents } = env;
  const country = cfg.countryByIso.get(msg.country) || null;
  const category = cfg.categories.get(msg.category);
  const recipientKey = `${msg.to_e164}|${msg.category}`;
  const decision = policy.evaluate({
    msg, settings: cfg.settings, category, country,
    suppression: suppressions.get(msg.to_e164) || null,
    consent: msg.consent_scope ? consents.get(`${msg.to_e164}|${msg.consent_scope}`) || null : null,
    counts: {
      recipient: ctx.recipients[recipientKey] || 0,
      countryHour: ctx.countryHour[msg.country] || 0,
      countryDay: ctx.countryDay[msg.country] || 0,
      marketingSpendToday: ctx.marketingSpendToday || 0,
    },
  });

  if (decision.action === 'block') return finish(msg, { status: 'blocked', block_reason: decision.reason });
  if (decision.action === 'defer') {
    if (decision.pauseCountry) await pauseCountry(msg.country, decision.reason);
    return requeue(msg, decision.until, { last_error: policy.REASON_LABELS[decision.reason] || decision.reason });
  }

  const choice = chooseRoute(cfg, msg, country);
  if (choice.error) {
    // Every provider already refused it for provider reasons: that is a failure, not a config gap.
    if ((msg.tried_providers || []).length > 0) return finish(msg, { status: 'failed', block_reason: choice.error });
    return finish(msg, { status: 'blocked', block_reason: choice.error });
  }
  const { route, sender, adapter, others } = choice;
  const provider = cfg.providers.get(route.provider_id);

  const unsubscribeUrl = frontendBase() ? `${frontendBase()}/sms/stop/${unsubscribeToken(msg.id)}` : null;
  const text = compose({ baseBody: msg.metadata?.baseBody || msg.body, category, settings: cfg.settings, sender, unsubscribeUrl });
  if (text.segments > category.max_segments) return finish(msg, { status: 'blocked', block_reason: 'too_long' });

  const attempt = (msg.attempts || 0) + 1;
  await update(msg.id, {
    attempts: attempt, provider_id: route.provider_id, sender_value: sender.value,
    body: text.body, encoding: text.encoding, segments: text.segments,
    est_cost_micros: route.cost_micros != null ? route.cost_micros * text.segments : msg.est_cost_micros,
    currency: route.currency || msg.currency,
  });
  const { data: attemptRow, error: attemptError } = await supabase.from('sms_attempts')
    .insert({ message_id: msg.id, attempt_no: attempt, provider_id: route.provider_id, sender_value: sender.value })
    .select('id').single();
  if (attemptError) {
    logger.error({ err: attemptError.message, id: msg.id }, 'SMS attempt could not be recorded; not sending');
    return requeue(msg, Date.now() + 60_000);
  }

  await pace(provider);
  let result;
  try {
    result = await adapter.send({
      to: msg.to_e164, body: text.body, sender, encoding: text.encoding,
      callbackUrl: statusCallbackUrl(route.provider_id, msg.id), clientRef: msg.id,
    });
  } catch (err) {
    result = { outcome: 'uncertain', errorCode: 'ADAPTER_THREW', errorMessage: err.message, providerHealthy: false };
  }

  await supabase.from('sms_attempts').update({
    outcome: result.outcome, provider_message_id: result.providerMessageId || null,
    http_status: result.httpStatus || null, error_code: result.errorCode || null,
    error_message: result.errorMessage || null, finished_at: new Date().toISOString(),
  }).eq('id', attemptRow.id);
  supabase.rpc('sms_provider_result', {
    p_id: route.provider_id, p_ok: result.providerHealthy !== false, p_error: result.errorMessage || result.errorCode || null,
  }).then(undefined, () => {});

  const step = nextStep(result, { attempt, maxAttempts: msg.max_attempts, otherCandidates: others });
  const errorPatch = { last_error_code: result.errorCode || null, last_error: result.errorMessage || null };

  if (step.status === 'sent') {
    ctx.recipients[recipientKey] = (ctx.recipients[recipientKey] || 0) + 1;
    if (!msg.campaign_id) ctx.countryHour[msg.country] = (ctx.countryHour[msg.country] || 0) + 1;
    ctx.countryDay[msg.country] = (ctx.countryDay[msg.country] || 0) + 1;
    const facts = {
      lease_until: null, lease_holder: null,
      provider_message_id: result.providerMessageId,
      segments: result.segments || text.segments,
      ...(result.priceMicros != null ? { cost_micros: result.priceMicros, currency: result.currency || route.currency } : {}),
      metadata: { ...msg.metadata, ...(result.partIds ? { partIds: result.partIds } : {}) },
      last_error: result.errorMessage || null,
      updated_at: new Date().toISOString(),
    };
    // A fast provider can deliver a receipt before this line runs. 'sent' is
    // written only over 'sending', so a 'delivered' that arrived first stands.
    const { data: moved } = await supabase.from('sms_messages')
      .update({ ...facts, status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', msg.id).eq('status', 'sending').select('id');
    if (!moved || moved.length === 0) await supabase.from('sms_messages').update(facts).eq('id', msg.id);
    return undefined;
  }
  if (step.status === 'unknown') {
    logger.warn({ id: msg.id, provider: route.provider_id, to: mask(msg.to_e164), code: result.errorCode },
      'SMS outcome UNKNOWN; not retrying to avoid a duplicate');
    return update(msg.id, { status: 'unknown', lease_until: null, lease_holder: null, ...errorPatch });
  }
  if (step.status === 'failed') {
    if (step.suppress) await suppress(msg.to_e164, step.suppress, route.provider_id);
    return finish(msg, { status: 'failed', ...errorPatch });
  }
  return requeue(msg, Date.now() + step.delayMs, {
    ...errorPatch,
    tried_providers: step.exclude ? [...(msg.tried_providers || []), route.provider_id] : msg.tried_providers,
    metadata: { ...msg.metadata, avoid: step.avoid ? route.provider_id : null },
  });
}

async function lookupMaps(batch) {
  const phones = [...new Set(batch.map((m) => m.to_e164))];
  const marketingPhones = [...new Set(batch.filter((m) => m.consent_scope).map((m) => m.to_e164))];
  const [sup, con] = await Promise.all([
    supabase.from('sms_suppressions').select('phone_e164, scope').in('phone_e164', phones),
    marketingPhones.length
      ? supabase.from('sms_consents').select('phone_e164, scope, status').in('phone_e164', marketingPhones)
      : Promise.resolve({ data: [] }),
  ]);
  if (sup.error || con.error) throw new Error(`SMS compliance lookup failed: ${(sup.error || con.error).message}`);
  return {
    suppressions: new Map((sup.data || []).map((s) => [s.phone_e164, s])),
    consents: new Map((con.data || []).map((c) => [`${c.phone_e164}|${c.scope}`, c])),
  };
}

async function processBatch(batch) {
  const cfg = await config.load();
  const { data: ctx, error } = await supabase.rpc('sms_dispatch_context', {
    p_phones: [...new Set(batch.map((m) => m.to_e164))],
    p_countries: [...new Set(batch.map((m) => m.country).filter(Boolean))],
    p_currency: cfg.settings?.spend_currency || 'USD',
    // The batch itself is 'sending' under this holder; it must not count
    // against its own per-recipient limit.
    p_holder: HOLDER,
  });
  if (error) throw new Error(`SMS dispatch context failed: ${error.message}`);
  const env = { cfg, ctx: { recipients: {}, countryHour: {}, countryDay: {}, ...ctx }, ...(await lookupMaps(batch)) };

  const queue = [...batch];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const msg = queue.shift();
      try {
        // eslint-disable-next-line no-await-in-loop
        await sendOne(msg, env);
      } catch (err) {
        // Before the provider call (no attempt row) this is safe to retry; after
        // it, sms_release_stale makes the message 'unknown' when its lease ends.
        logger.error({ err: err.message, id: msg.id }, 'SMS dispatch failed for one message');
      }
    }
  });
  await Promise.all(workers);
}

let running = false;

/** One dispatch run: keeps claiming until the queue is empty or the budget is spent. */
async function runOnce({ budgetMs = 45_000, batchSize = 50 } = {}) {
  if (running) return 0;
  running = true;
  try {
    const { error: staleError } = await supabase.rpc('sms_release_stale');
    if (staleError) logger.error({ err: staleError.message }, 'sms_release_stale failed');

    const started = Date.now();
    let processed = 0;
    while (Date.now() - started < budgetMs) {
      // eslint-disable-next-line no-await-in-loop
      const { data: batch, error } = await supabase.rpc('sms_claim_batch', {
        p_holder: HOLDER, p_limit: batchSize, p_lease_seconds: 120,
      });
      if (error) {
        logger.error({ err: error.message }, 'SMS claim failed');
        break;
      }
      if (!batch || batch.length === 0) break;
      // eslint-disable-next-line no-await-in-loop
      await processBatch(batch);
      processed += batch.length;
    }
    return processed;
  } finally {
    running = false;
  }
}

module.exports = { runOnce, sendOne, chooseRoute, HOLDER };
