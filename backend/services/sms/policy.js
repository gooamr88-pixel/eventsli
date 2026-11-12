const { quietUntil } = require('./quietHours');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * May this message be sent NOW? The compliance gate, evaluated at dispatch.
 *
 * At dispatch, not at enqueue: a campaign queued at noon is sent over the next
 * hour, and someone who texts STOP at 12:05 must not receive it at 12:30.
 * Consent, suppression, country status and category switches are all read from
 * the state of the world when the provider is about to be called.
 *
 * Returns one of:
 *   { action: 'send' }
 *   { action: 'block', reason }          final; the message is never sent
 *   { action: 'defer', reason, until }   try again later (quiet hours, caps)
 *     (+ pauseCountry: true when the deferral is a fraud signal)
 *
 * Pure. Every input is passed in, so every rule has a test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const HOUR = 3_600_000;

/**
 * Transactional texts that may go without transactional consent, and why:
 *   double_opt_in  the "reply YES" request IS the consent step, started by the person
 *   console_test   an admin testing a number from the console (rate limited, audited)
 *   keyword_reply  the answer to the person's own HELP text
 * Neither bypasses suppression: a STOP still stops them.
 */
const CONSENT_EXEMPT = new Set(['double_opt_in', 'console_test', 'keyword_reply', 'stop_confirmation']);

/**
 * The only texts a suppressed number may still receive, both answers to the
 * person's own message: the one confirmation that a STOP worked, and the
 * reply to HELP (carriers expect HELP to be answered even after STOP).
 */
const SUPPRESSION_EXEMPT = new Set(['stop_confirmation', 'keyword_reply']);

function nextUtcDay(now) {
  const d = new Date(now);
  d.setUTCHours(24, 5, 0, 0);
  return d;
}

function evaluate({ msg, settings, category, country, suppression, consent, counts = {}, now = new Date() }) {
  const expiresAt = msg.metadata?.expiresAt ? new Date(msg.metadata.expiresAt) : null;
  if (expiresAt && expiresAt <= now) return { action: 'block', reason: 'expired' };

  if (!settings?.sending_enabled) {
    return { action: 'defer', reason: 'sending_paused', until: new Date(now.getTime() + 15 * 60_000) };
  }
  if (!category) return { action: 'block', reason: 'category_unknown' };
  if (!category.enabled) return { action: 'block', reason: 'category_disabled' };

  if (!country) return { action: 'block', reason: 'country_unknown' };
  if (country.status !== 'enabled') return { action: 'block', reason: 'country_not_enabled' };
  if (country.paused_until && new Date(country.paused_until) > now) {
    return { action: 'defer', reason: 'country_paused', until: new Date(country.paused_until) };
  }

  const marketing = msg.traffic_class === 'marketing';
  const replyExempt = !marketing && SUPPRESSION_EXEMPT.has(msg.metadata?.consentExempt);
  if (suppression && !replyExempt && (suppression.scope === 'all' || marketing)) return { action: 'block', reason: 'suppressed' };

  if (marketing) {
    if (!country.marketing_allowed) return { action: 'block', reason: 'marketing_not_allowed' };
    // Always, whatever the category row says: marketing without consent is
    // never a configuration choice (the schema's CHECK says the same).
    if (!consent || consent.status === 'opted_out') return { action: 'block', reason: 'no_consent' };
    if (consent.status !== 'opted_in') return { action: 'block', reason: 'consent_pending' };
  } else if (category.requires_consent && !CONSENT_EXEMPT.has(msg.metadata?.consentExempt)) {
    // Transactional consent, checked separately from marketing: `consent` is
    // the row for this message's own kind (the dispatcher looks it up by kind).
    if (!consent || consent.status !== 'opted_in') return { action: 'block', reason: 'no_transactional_consent' };
  }

  if ((counts.recipient || 0) >= category.per_recipient_daily_limit) {
    return { action: 'block', reason: 'recipient_rate_limited' };
  }

  if (country.max_daily_messages && (counts.countryDay || 0) >= country.max_daily_messages) {
    return { action: 'defer', reason: 'country_daily_cap', until: nextUtcDay(now) };
  }

  // SMS pumping: a burst of non-campaign traffic to one country. Campaigns are
  // excluded — a campaign IS a planned burst, approved by two people.
  if (!msg.campaign_id && (counts.countryHour || 0) >= settings.country_hourly_limit) {
    return { action: 'defer', reason: 'country_velocity', until: new Date(now.getTime() + HOUR), pauseCountry: true };
  }

  if (marketing && settings.daily_marketing_cap_micros != null
      && (msg.currency || settings.spend_currency) === settings.spend_currency
      && (counts.marketingSpendToday || 0) + (msg.est_cost_micros || 0) > settings.daily_marketing_cap_micros) {
    return { action: 'defer', reason: 'marketing_spend_cap', until: nextUtcDay(now) };
  }

  if (category.respect_quiet_hours) {
    const start = country.quiet_hours_start ?? settings.default_quiet_start;
    const end = country.quiet_hours_end ?? settings.default_quiet_end;
    const until = quietUntil(now, country.timezone || 'UTC', start, end);
    if (until) return { action: 'defer', reason: 'quiet_hours', until };
  }

  return { action: 'send' };
}

/** Plain-language labels for the console. One place, so the log and the analytics agree. */
const REASON_LABELS = Object.freeze({
  expired: 'Expired before it could be sent',
  sending_paused: 'Sending is paused platform-wide',
  category_unknown: 'Unknown category',
  category_disabled: 'Category is turned off',
  country_unknown: 'Number is not in a known country',
  country_not_enabled: 'Country is not enabled',
  country_paused: 'Country paused (unusual traffic)',
  suppressed: 'Number is on the suppression list',
  marketing_not_allowed: 'Marketing not allowed in this country',
  no_consent: 'No marketing consent',
  no_transactional_consent: 'No consent to texts about orders and events',
  consent_pending: 'Consent not yet confirmed',
  recipient_rate_limited: 'Daily limit for this number reached',
  country_daily_cap: 'Country daily cap reached',
  country_velocity: 'Unusual volume to this country',
  marketing_spend_cap: 'Daily marketing budget reached',
  quiet_hours: 'Recipient’s quiet hours',
  invalid_number: 'Invalid phone number',
  no_route: 'No verified route for this country',
  no_sender: 'No registered sender for this country',
  route_sender_unusable: 'The route’s pinned sender cannot be used',
  manual_cancel: 'Cancelled by an admin',
  campaign_cancelled: 'Campaign was cancelled',
  organizer_access_revoked: 'Organizer no longer has SMS access',
});

module.exports = { evaluate, REASON_LABELS, nextUtcDay };
