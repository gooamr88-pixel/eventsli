const { networkOutcome, toMicros } = require('./httpOutcome');
const { verifyTwilio } = require('../webhookAuth');
const credentials = require('../credentials');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Twilio Programmable Messaging, over its REST API (no SDK: one POST, and the
 * repo already talks to Brevo and Google the same way).
 *
 * Credentials, from the environment ONLY — never the database, never the
 * browser:
 *   TWILIO_ACCOUNT_SID   required
 *   TWILIO_AUTH_TOKEN    required (it is also the webhook signing key)
 *   TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET   optional; used for API calls
 *                        when set, so the auth token can stay off the wire.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API = 'https://api.twilio.com/2010-04-01';
const PRICING = 'https://pricing.twilio.com/v1/Messaging/Countries';
const TIMEOUT_MS = 15_000;

/** Environment variables first, then credentials stored from the console (credentials.js). */
const env = (override = null) => {
  const c = override || credentials.resolve('twilio');
  return { sid: c.accountSid, token: c.authToken, keySid: c.apiKeySid, keySecret: c.apiKeySecret };
};

const credentialStatus = () => credentials.status('twilio');
const configured = () => credentialStatus().configured;

function authHeader(override = null) {
  const e = env(override);
  const [user, pass] = e.keySid && e.keySecret ? [e.keySid, e.keySecret] : [e.sid, e.token];
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

// Twilio error codes → what they mean for this message. Anything unlisted in
// the 4xx range is a definite refusal BY THIS PROVIDER: another may succeed.
const RECIPIENT_FINAL = new Set(['21211', '21214', '21612', '21614', '21610', '21602', '21617', '21619', '21635']);
const RETRYABLE = new Set(['20429', '21611', '30001']);
const SUPPRESS = { 21610: 'carrier_opt_out', 21614: 'invalid_number', 21211: 'invalid_number' };

function classifyError(httpStatus, code, message) {
  const c = code == null ? '' : String(code);
  const base = { httpStatus, errorCode: c || `HTTP_${httpStatus}`, errorMessage: String(message || '').slice(0, 300) };
  if (httpStatus === 429 || RETRYABLE.has(c)) return { ...base, outcome: 'retryable', providerHealthy: true };
  if (httpStatus >= 500) return { ...base, outcome: 'uncertain', providerHealthy: false };
  if (RECIPIENT_FINAL.has(c)) {
    return { ...base, outcome: 'rejected', scope: 'recipient', suppress: SUPPRESS[c] || null, providerHealthy: true };
  }
  // 401/403 and account-level codes mean THIS provider cannot send right now.
  const unhealthy = httpStatus === 401 || httpStatus === 403 || c === '20003' || c === '20005';
  return { ...base, outcome: 'rejected', scope: 'provider', providerHealthy: !unhealthy };
}

async function send({ to, body, sender, callbackUrl }) {
  const e = env();
  const form = new URLSearchParams({ To: to, Body: body });
  if (sender.kind === 'messaging_service') form.set('MessagingServiceSid', sender.value);
  else form.set('From', sender.value);
  if (callbackUrl) form.set('StatusCallback', callbackUrl);

  let res;
  try {
    res = await fetch(`${API}/Accounts/${encodeURIComponent(e.sid)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return networkOutcome(err);
  }
  const json = await res.json().catch(() => null);
  if (res.status === 201 || res.status === 200) {
    if (!json?.sid) return { outcome: 'uncertain', httpStatus: res.status, errorCode: 'NO_SID', errorMessage: 'Accepted without a message id' };
    return {
      outcome: 'accepted',
      httpStatus: res.status,
      providerMessageId: json.sid,
      segments: Number(json.num_segments) || null,
      priceMicros: json.price ? toMicros(String(json.price).replace('-', '')) : null,
      currency: json.price_unit || null,
      providerHealthy: true,
    };
  }
  return classifyError(res.status, json?.code, json?.message);
}

const STATUS_MAP = {
  queued: 'sent', accepted: 'sent', scheduled: 'sent', sending: 'sent', sent: 'sent',
  delivered: 'delivered', read: 'delivered',
  undelivered: 'undelivered', failed: 'failed', canceled: 'failed',
};
const DLR_SUPPRESS = { 30005: 'invalid_number', 30006: 'invalid_number' };

function parseStatus(params) {
  const raw = String(params.MessageStatus || params.SmsStatus || '').toLowerCase();
  return {
    providerMessageId: params.MessageSid || params.SmsSid || null,
    clientRef: null,
    statusRaw: raw,
    status: STATUS_MAP[raw] || null,
    errorCode: params.ErrorCode ? String(params.ErrorCode) : null,
    suppress: DLR_SUPPRESS[params.ErrorCode] || null,
    priceMicros: null,
    currency: null,
  };
}

function parseInbound(params) {
  return {
    providerMessageId: params.MessageSid || params.SmsSid || null,
    from: params.From || '',
    to: params.To || '',
    text: params.Body || '',
    // Twilio Advanced Opt-Out tells us directly when it handled a keyword.
    optOutType: params.OptOutType ? String(params.OptOutType).toLowerCase() : null,
  };
}

const verifyWebhook = ({ url, params, headers }) => verifyTwilio({
  url, params, header: headers['x-twilio-signature'], authToken: env().token,
});

/** TwiML: an empty response, or one reply. */
function inboundReply(text) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    contentType: 'text/xml',
    body: text ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(text)}</Message></Response>`
      : '<?xml version="1.0" encoding="UTF-8"?><Response/>',
  };
}

/**
 * After an UNCERTAIN send: did Twilio create it after all? Only a POSITIVE
 * match resolves anything. Twilio can hold a message in its queue for hours,
 * so "not listed" is never treated as "not sent".
 */
async function lookup({ to, body, since }) {
  const e = env();
  const q = new URLSearchParams({ To: to, PageSize: '50' });
  try {
    const res = await fetch(`${API}/Accounts/${encodeURIComponent(e.sid)}/Messages.json?${q}`, {
      headers: { authorization: authHeader(), accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { found: null };
    const json = await res.json();
    const after = since ? new Date(since).getTime() - 120_000 : 0;
    const hit = (json.messages || []).find((m) => m.direction?.startsWith('outbound')
      && m.body === body && new Date(m.date_created).getTime() >= after);
    return { found: hit ? hit.sid : null };
  } catch {
    return { found: null };
  }
}

/**
 * READ-ONLY account check: the account's name and status. Sends nothing.
 * `override`: candidate credentials typed in the console, tested before saving.
 */
async function testConnection(override = null) {
  const e = env(override);
  if (!e.sid || !e.token) return { ok: false, error: 'Account SID and auth token are required.' };
  try {
    const res = await fetch(`${API}/Accounts/${encodeURIComponent(e.sid)}.json`, {
      headers: { authorization: authHeader(override), accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Twilio refused these credentials.' };
    if (!res.ok) return { ok: false, error: `Twilio answered ${res.status}.` };
    const active = json.status === 'active';
    return {
      ok: active, account: json.friendly_name || null, status: json.status, type: json.type || null,
      error: active ? null : `The account is ${json.status}.`,
    };
  } catch (err) {
    return { ok: false, error: `Could not reach Twilio (${err.name === 'TimeoutError' ? 'timeout' : 'network'}).` };
  }
}

const TOLL_FREE = /^\+1(800|833|844|855|866|877|888)/;

/** READ-ONLY: the account's SMS-capable numbers and messaging services, to import as senders. */
async function listNumbers(override = null) {
  const e = env(override);
  const get = async (url) => {
    const res = await fetch(url, { headers: { authorization: authHeader(override), accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Twilio answered ${res.status}`);
    return res.json();
  };
  const [numbers, services] = await Promise.all([
    get(`${API}/Accounts/${encodeURIComponent(e.sid)}/IncomingPhoneNumbers.json?PageSize=200`),
    get('https://messaging.twilio.com/v1/Services?PageSize=50').catch(() => ({ services: [] })),
  ]);
  return [
    ...(services.services || []).map((s) => ({ value: s.sid, kind: 'messaging_service', label: s.friendly_name || null, sms: true })),
    ...(numbers.incoming_phone_numbers || []).map((n) => ({
      value: n.phone_number, kind: TOLL_FREE.test(n.phone_number) ? 'toll_free' : 'long_code',
      label: n.friendly_name || null, sms: n.capabilities?.sms !== false,
    })),
  ];
}

async function pricing(iso2) {
  const res = await fetch(`${PRICING}/${encodeURIComponent(iso2)}`, {
    headers: { authorization: authHeader(), accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return { available: false, costMicros: null, currency: null };
  if (!res.ok) throw new Error(`Twilio pricing answered ${res.status}`);
  const json = await res.json();
  let max = null;
  for (const carrier of json.outbound_sms_prices || []) {
    for (const p of carrier.prices || []) {
      const v = toMicros(p.current_price ?? p.base_price);
      if (v != null && (max == null || v > max)) max = v;
    }
  }
  // The highest carrier price: an estimate should not flatter the budget.
  return { available: max != null, costMicros: max, currency: json.price_unit ? String(json.price_unit).toUpperCase() : 'USD' };
}

module.exports = {
  id: 'twilio', displayName: 'Twilio', repliesSupported: true,
  configured, credentialStatus, send, parseStatus, parseInbound, verifyWebhook, inboundReply, lookup, pricing,
  testConnection, listNumbers, classifyError, signsWebhooks: () => true, repliesInline: true,
  docs: (iso2) => `https://www.twilio.com/en-us/guidelines/${String(iso2).toLowerCase()}/sms`,
};
