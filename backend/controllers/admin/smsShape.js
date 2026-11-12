const { mask } = require('../../services/sms/phone');
const { REASON_LABELS } = require('../../services/sms/policy');

/**
 * Database rows → what the console reads. camelCase, and nothing secret: no
 * row here carries a credential, and phone numbers in lists are masked.
 */

function route(r) {
  return {
    country: r.country, providerId: r.provider_id, priority: r.priority, senderId: r.sender_id,
    costMicros: r.cost_micros, currency: r.currency, costSource: r.cost_source, costSyncedAt: r.cost_synced_at,
    available: r.available, verified: r.verified, verifiedAt: r.verified_at, active: r.active, notes: r.notes,
  };
}

/** A country, with its routes and what is still missing before it can be enabled. */
function country(c, routes = [], cfg = null) {
  const shaped = routes.map(route).sort((a, b) => a.priority - b.priority);
  const usable = shaped.filter((r) => r.verified && r.active && cfg?.providers.get(r.providerId)?.enabled);
  const missing = [];
  if (c.sender_id_support === 'unknown') missing.push('sender_rules');
  if (!usable.length) missing.push('verified_route');
  if (!c.verified_at) missing.push('verification');
  const cheapest = usable.filter((r) => r.costMicros != null).sort((a, b) => a.costMicros - b.costMicros)[0] || null;
  return {
    iso2: c.iso2, name: c.name, dialCode: c.dial_code, prefixes: c.prefixes, dialPrimary: c.dial_primary,
    region: c.region, timezone: c.timezone, status: c.status,
    senderIdSupport: c.sender_id_support, requiresSenderRegistration: c.requires_sender_registration,
    marketingAllowed: c.marketing_allowed, doubleOptInRequired: c.double_opt_in_required,
    quietHoursStart: c.quiet_hours_start, quietHoursEnd: c.quiet_hours_end,
    restrictions: c.restrictions, notes: c.notes, maxDailyMessages: c.max_daily_messages,
    pausedUntil: c.paused_until && new Date(c.paused_until) > new Date() ? c.paused_until : null, pausedReason: c.paused_reason,
    verifiedAt: c.verified_at, verificationSource: c.verification_source, updatedAt: c.updated_at,
    routes: shaped,
    estimatedCost: cheapest ? { micros: cheapest.costMicros, currency: cheapest.currency, providerId: cheapest.providerId } : null,
    readyToEnable: missing.length === 0,
    missing,
  };
}

function provider(p) {
  return {
    id: p.id, displayName: p.display_name, enabled: p.enabled, priority: p.priority, maxTps: p.max_tps,
    trafficClasses: p.traffic_classes, consecutiveFailures: p.consecutive_failures,
    circuitOpenUntil: p.circuit_open_until && new Date(p.circuit_open_until) > new Date() ? p.circuit_open_until : null,
    lastSuccessAt: p.last_success_at, lastFailureAt: p.last_failure_at, lastError: p.last_error,
    pricingSync: p.pricing_sync || {},
  };
}

function sender(s) {
  return {
    id: s.id, providerId: s.provider_id, kind: s.kind, value: s.value, label: s.label,
    trafficClasses: s.traffic_classes, countries: s.countries, registrationStatus: s.registration_status,
    registrationReference: s.registration_reference, approvedAt: s.approved_at, expiresAt: s.expires_at,
    active: s.active, notes: s.notes, createdAt: s.created_at,
  };
}

function category(c) {
  return {
    key: c.key, label: c.label, description: c.description, enabled: c.enabled, trafficClass: c.traffic_class,
    requiresConsent: c.requires_consent, requiresApproval: c.requires_approval, minRole: c.min_role,
    perRecipientDailyLimit: c.per_recipient_daily_limit, respectQuietHours: c.respect_quiet_hours,
    appendOptOut: c.append_opt_out, maxSegments: c.max_segments, updatedAt: c.updated_at,
  };
}

function settings(s) {
  if (!s) return null;
  return {
    sendingEnabled: s.sending_enabled, brandName: s.brand_name, optOutText: s.opt_out_text, helpText: s.help_text,
    replyToHelp: s.reply_to_help, defaultQuietStart: s.default_quiet_start, defaultQuietEnd: s.default_quiet_end,
    countryHourlyLimit: s.country_hourly_limit, dailyMarketingCapMicros: s.daily_marketing_cap_micros,
    spendCurrency: s.spend_currency, reminderHoursBefore: s.reminder_hours_before,
    maxCampaignRecipients: s.max_campaign_recipients, updatedAt: s.updated_at,
  };
}

function message(m, { full = false } = {}) {
  return {
    id: m.id, category: m.category, trafficClass: m.traffic_class,
    to: full ? m.to_e164 : mask(m.to_e164), country: m.country, status: m.status,
    blockReason: m.block_reason, blockReasonLabel: m.block_reason ? (REASON_LABELS[m.block_reason] || m.block_reason) : null,
    providerId: m.provider_id, senderValue: m.sender_value, providerMessageId: full ? m.provider_message_id : undefined,
    segments: m.segments, encoding: m.encoding, attempts: m.attempts,
    estCostMicros: m.est_cost_micros, costMicros: m.cost_micros, currency: m.currency,
    lastErrorCode: m.last_error_code, lastError: m.last_error,
    campaignId: m.campaign_id, eventId: m.event_id, orderId: m.order_id,
    body: full ? m.body : undefined,
    purpose: m.metadata?.purpose || null,
    createdAt: m.created_at, sentAt: m.sent_at, deliveredAt: m.delivered_at, nextAttemptAt: m.next_attempt_at,
  };
}

function campaign(c, extra = {}) {
  return {
    id: c.id, name: c.name, category: c.category, body: c.body, segmentId: c.segment_id, consentScope: c.consent_scope,
    status: c.status, scheduledAt: c.scheduled_at, createdBy: c.created_by, approvedBy: c.approved_by,
    submittedAt: c.submitted_at, approvedAt: c.approved_at, decisionNote: c.decision_note,
    startedAt: c.started_at, completedAt: c.completed_at, cancelledAt: c.cancelled_at,
    recipientsQueued: c.recipients_queued, recipientsSkipped: c.recipients_skipped, skippedReasons: c.skipped_reasons,
    expansionDone: c.expansion_done, createdAt: c.created_at, ...extra,
  };
}

function segment(s, describe) {
  return {
    id: s.id, name: s.name, description: s.description, definition: s.definition,
    summary: describe(s.definition || {}), lastCount: s.last_count, lastCountedAt: s.last_counted_at,
    createdAt: s.created_at, updatedAt: s.updated_at,
  };
}

module.exports = { route, country, provider, sender, category, settings, message, campaign, segment };
