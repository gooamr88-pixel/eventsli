const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const dispatcher = require('./dispatcher');
const campaigns = require('./campaigns');
const notifications = require('./notifications');
const providers = require('./providers');
const maintenance = require('./maintenance');

/**
 * The SMS background jobs, handed to services/scheduler.js, which runs each
 * one under its leader lease so only one worker does it at a time.
 *
 *   sms-dispatch   every 5s   drain the queue (45s budget per run)
 *   sms-campaigns  every 30s  start, expand and close campaigns
 *   sms-reminders  every 10m  queue event reminders
 *   sms-reconcile  every 5m   resolve UNKNOWN messages by positive lookup only
 *   sms-health     every 5m   log ERROR-level alerts: backlog, stuck sends, paused providers
 *   sms-retention  daily      redact old message bodies (when a retention period is set)
 */

/**
 * An uncertain send is resolved ONLY by evidence that it went out: a receipt
 * (handled by the webhook) or the provider listing it. Nothing here requeues.
 */
async function reconcileUnknown() {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const settled = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await supabase.from('sms_messages')
    .select('id, provider_id, to_e164, body, updated_at, created_at')
    .eq('status', 'unknown').is('provider_message_id', null)
    .gte('created_at', since).lte('updated_at', settled).limit(50);
  let resolved = 0;
  for (const msg of data || []) {
    const adapter = msg.provider_id && providers.get(msg.provider_id);
    if (!adapter?.lookup) continue;
    // eslint-disable-next-line no-await-in-loop
    const { found } = await adapter.lookup({ to: msg.to_e164, body: msg.body, since: msg.created_at });
    if (!found) continue;
    // eslint-disable-next-line no-await-in-loop
    await supabase.from('sms_messages').update({
      status: 'sent', provider_message_id: found, sent_at: new Date().toISOString(),
      last_error: 'Resolved: the provider confirms it was sent', updated_at: new Date().toISOString(),
    }).eq('id', msg.id).eq('status', 'unknown');
    resolved += 1;
  }
  if (resolved) logger.info({ resolved }, 'SMS unknown messages resolved by provider lookup');
  return resolved;
}

function jobs(withLeaderLock) {
  return [
    { name: 'sms-dispatch', everyMs: 5_000, immediate: false, run: () => withLeaderLock('sms-dispatch', () => dispatcher.runOnce(), 90) },
    { name: 'sms-campaigns', everyMs: 30_000, immediate: false, run: () => withLeaderLock('sms-campaigns', () => campaigns.runCampaigns(), 120) },
    { name: 'sms-reminders', everyMs: 600_000, immediate: false, run: () => withLeaderLock('sms-reminders', () => notifications.eventReminders(), 600) },
    { name: 'sms-reconcile', everyMs: 300_000, immediate: false, run: () => withLeaderLock('sms-reconcile', reconcileUnknown, 300) },
    { name: 'sms-health', everyMs: 300_000, immediate: false, run: () => withLeaderLock('sms-health', maintenance.checkHealth, 120) },
    { name: 'sms-retention', everyMs: 86_400_000, immediate: false, run: () => withLeaderLock('sms-retention', maintenance.applyRetention, 3600) },
  ];
}

module.exports = { jobs, reconcileUnknown };
