/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The SMS console's vocabulary: how money in micros reads, what a status is
 * called and which tone it wears, and the live segment counter.
 *
 * `analyzeSegments` mirrors backend/services/sms/segments.js character for
 * character; test/smsFormat.test.js reads the backend file off disk and fails
 * if the two alphabets drift, because a preview that says "1 segment" while
 * the provider bills 2 is a budget surprise on every campaign.
 *
 * Pure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
export const GSM_EXTENDED = '^{}\\[~]|€\f';
const BASIC = new Set(Array.from(GSM_BASIC));
const EXTENDED = new Set(Array.from(GSM_EXTENDED));

export function analyzeSegments(text) {
  const s = String(text ?? '');
  let units = 0;
  for (const ch of s) {
    if (BASIC.has(ch)) units += 1;
    else if (EXTENDED.has(ch)) units += 2;
    else {
      const u = s.length;
      return { encoding: 'UCS-2', units: u, segments: u <= 70 ? 1 : Math.ceil(u / 67), perSegment: u <= 70 ? 70 : 67 };
    }
  }
  return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153), perSegment: units <= 160 ? 160 : 153 };
}

/** 7500 micros, USD → "$0.0075". Small per-message prices keep four decimals. */
export function formatMicros(micros, currency = 'USD', { precise } = {}) {
  if (micros == null || !Number.isFinite(Number(micros))) return '—';
  const value = Number(micros) / 1_000_000;
  const digits = precise ?? (Math.abs(value) < 1 ? 4 : 2);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency || 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency || ''}`.trim();
  }
}

/** "0.0075" typed by an admin → 7500. Strings only, no float maths. */
export function parseMicros(text) {
  const m = /^\s*([0-9]+)(?:\.([0-9]{1,6}))?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  return Number(m[1]) * 1_000_000 + Number((m[2] || '').padEnd(6, '0'));
}

export function microsToInput(micros) {
  if (micros == null) return '';
  const whole = Math.floor(micros / 1_000_000);
  const frac = String(micros % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export const formatCount = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);

/** Percentage change, or null when there is nothing to compare with. */
export function delta(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c === 0 ? 0 : null;
  return ((c - p) / p) * 100;
}

export function deliveryRate(totals) {
  const sent = Number(totals?.sent) || 0;
  return sent === 0 ? null : (Number(totals.delivered) / sent) * 100;
}

export const COUNTRY_STATUS = {
  enabled: { label: 'Enabled', tone: 'success' },
  unverified: { label: 'Unverified', tone: 'muted' },
  disabled: { label: 'Disabled', tone: 'danger' },
  blocked: { label: 'Blocked', tone: 'danger' },
};

export const MESSAGE_STATUS = {
  queued: { label: 'Queued', tone: 'muted' },
  sending: { label: 'Sending', tone: 'info' },
  sent: { label: 'Sent', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  undelivered: { label: 'Undelivered', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
  unknown: { label: 'Outcome unknown', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const CAMPAIGN_STATUS = {
  draft: { label: 'Draft', tone: 'muted' },
  pending_approval: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  sending: { label: 'Sending', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const SENDER_SUPPORT = {
  unknown: 'Not yet checked',
  supported: 'Sender ID supported',
  registration_required: 'Sender ID registration required',
  not_supported: 'Sender ID not supported (numbers only)',
};

export const CATEGORY_ICON = {
  participant: 'ticket', event_notification: 'bell', marketing: 'send', segmentation: 'target',
};

export const MISSING_LABEL = {
  sender_rules: 'Record the sender-ID rules',
  verified_route: 'Verify a route through an enabled provider',
  verification: 'Record who verified it, and against what',
};

export const EXCLUSION_LABEL = {
  invalid_number: 'Invalid number',
  filtered_country: 'Outside the chosen countries',
  country_not_enabled: 'Country not enabled',
  marketing_not_allowed: 'Marketing not allowed there',
  suppressed: 'On the suppression list',
  no_consent: 'No marketing consent',
  consent_pending: 'Consent not confirmed',
  recipient_cap: 'Over the campaign cap',
  too_long: 'Message too long',
};

/** Regional-indicator flag, or the code itself where the font has no flags. */
export function flagOf(iso2) {
  const code = String(iso2 || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...Array.from(code).map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** An audit action ("sms.country.enabled") as a sentence. */
export function describeActivity(action, payload = {}) {
  const what = String(action || '').replace(/^sms\./, '');
  const iso = payload?.iso2 ? ` (${payload.iso2})` : '';
  const map = {
    'country.enabled': `Country enabled${iso}`, 'country.disabled': `Country disabled${iso}`,
    'country.blocked': `Country blocked${iso}`, 'country.verified': `Country verified${iso}`,
    'country.updated': `Country rules updated${iso}`, 'country.created': `Country added${iso}`,
    'country.resumed': `Country resumed${iso}`,
    'route.saved': `Route saved${iso}${payload?.provider ? ` via ${payload.provider}` : ''}`,
    'route.deleted': `Route removed${iso}`,
    'provider.updated': `Provider ${payload?.provider || ''} updated`.replace('  ', ' '),
    'provider.pricing_sync': `Price sync started for ${payload?.provider || 'a provider'}`,
    'provider.circuit_reset': `Provider ${payload?.provider || ''} resumed`,
    'sender.created': 'Sender added', 'sender.updated': 'Sender updated', 'sender.deleted': 'Sender removed',
    'category.updated': `Category “${payload?.key || ''}” updated`, 'settings.updated': 'SMS settings updated',
    'campaign.created': `Campaign “${payload?.name || ''}” drafted`, 'campaign.submitted': `Campaign “${payload?.name || ''}” submitted`,
    'campaign.approved': `Campaign “${payload?.name || ''}” approved`, 'campaign.rejected': `Campaign “${payload?.name || ''}” rejected`,
    'campaign.cancelled': 'Campaign cancelled', 'campaign.updated': `Campaign “${payload?.name || ''}” edited`,
    'consent.imported': `Consent imported for ${formatCount(payload?.recorded)} numbers`,
    'suppression.added': 'Number suppressed', 'suppression.removed': 'Suppression removed',
    'test.sent': `Test message queued${payload?.country ? ` to ${payload.country}` : ''}`,
    'message.retried': 'Message retried', 'message.cancelled': 'Message cancelled',
    'segment.created': 'Audience segment created', 'segment.updated': 'Audience segment edited', 'segment.deleted': 'Audience segment deleted',
  };
  return map[what] || what.replace(/[._]/g, ' ');
}
