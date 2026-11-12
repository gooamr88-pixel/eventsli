const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const config = require('./config');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SMS housekeeping: retention, queue health, and boot-time configuration checks.
 *
 * RETENTION. `sms_settings.message_retention_days` (NULL = keep; the owner
 * decides). Past it, message bodies and raw provider payloads are redacted.
 * Rows, numbers, statuses and costs stay, so analytics and the audit of what
 * was sent when are kept; the words are not. Consent evidence
 * (`sms_consent_log`) is never touched — it is what proves a text was allowed.
 *
 * HEALTH. Logged at ERROR level so log-based alerting (pm2 logs, a log
 * shipper) can page someone: a backlog that is not draining, messages stuck
 * mid-send, a provider paused by its circuit breaker. Nothing here changes data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const REDACTED = '[redacted after retention period]';
const DAY = 86_400_000;

async function applyRetention() {
  const cfg = await config.load();
  const days = cfg.settings?.message_retention_days;
  if (!days) return { skipped: 'retention not configured' };
  const cutoff = new Date(Date.now() - days * DAY).toISOString();
  const finished = ['sent', 'delivered', 'undelivered', 'failed', 'blocked', 'cancelled', 'unknown'];
  let messages = 0;
  // In pages, so a first run over a large backlog does not hold one long transaction.
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('sms_messages').select('id')
      .lt('created_at', cutoff).in('status', finished).neq('body', REDACTED).limit(500);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    // eslint-disable-next-line no-await-in-loop
    const { error: upErr } = await supabase.from('sms_messages')
      .update({ body: REDACTED, metadata: {}, last_error: null, updated_at: new Date().toISOString() })
      .in('id', data.map((m) => m.id));
    if (upErr) throw new Error(upErr.message);
    messages += data.length;
    if (data.length < 500) break;
  }
  const [{ error: rErr }, { error: iErr }] = await Promise.all([
    supabase.from('sms_receipts').update({ payload: {} }).lt('received_at', cutoff).neq('payload', '{}'),
    supabase.from('sms_inbound').update({ body: null }).lt('received_at', cutoff).not('body', 'is', null),
  ]);
  if (rErr || iErr) throw new Error((rErr || iErr).message);
  if (messages) logger.info({ messages, days }, 'SMS retention: message bodies redacted');
  return { messages };
}

async function checkHealth() {
  const cfg = await config.load();
  const now = Date.now();
  const findings = {};
  if (cfg.settings?.sending_enabled) {
    const { data: oldest } = await supabase.from('sms_messages').select('next_attempt_at')
      .eq('status', 'queued').lte('next_attempt_at', new Date(now).toISOString())
      .order('next_attempt_at', { ascending: true }).limit(1);
    const lagMin = oldest?.[0] ? Math.round((now - new Date(oldest[0].next_attempt_at).getTime()) / 60_000) : 0;
    if (lagMin >= 10) {
      findings.backlogMinutes = lagMin;
      logger.error({ lagMinutes: lagMin }, 'SMS ALERT: queued messages are not being dispatched');
    }
  }
  const { count: stuck } = await supabase.from('sms_messages').select('id', { count: 'exact', head: true })
    .eq('status', 'sending').lt('lease_until', new Date(now - 10 * 60_000).toISOString());
  if (stuck) {
    findings.stuckSending = stuck;
    logger.error({ stuck }, 'SMS ALERT: messages stuck mid-send (worker crash?)');
  }
  const { count: unknown } = await supabase.from('sms_messages').select('id', { count: 'exact', head: true })
    .eq('status', 'unknown').gte('updated_at', new Date(now - 3_600_000).toISOString());
  if (unknown) {
    findings.unknownLastHour = unknown;
    logger.warn({ unknown }, 'SMS: messages with an unknown outcome need an admin decision (Delivery log → Unknown)');
  }
  for (const p of cfg.providers.values()) {
    if (p.enabled && p.circuit_open_until && new Date(p.circuit_open_until).getTime() > now) {
      findings.circuitOpen = [...(findings.circuitOpen || []), p.id];
      logger.error({ provider: p.id, lastError: p.last_error }, 'SMS ALERT: provider paused after repeated failures');
    }
  }
  return findings;
}

const { bootWarnings } = require('./bootCheck');

module.exports = { applyRetention, checkHealth, bootWarnings, REDACTED };
