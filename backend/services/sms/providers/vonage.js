const { networkOutcome, toMicros } = require('./httpOutcome');
const { verifyVonage } = require('../webhookAuth');
const credentials = require('../credentials');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Vonage (Nexmo) SMS API.
 *
 * Credentials, from the environment ONLY:
 *   VONAGE_API_KEY, VONAGE_API_SECRET       required
 *   VONAGE_SIGNATURE_SECRET                 optional; verifies signed webhooks
 *   VONAGE_SIGNATURE_METHOD                 md5hash (default) | md5 | sha1 | sha256 | sha512
 *   VONAGE_CURRENCY                         the account's billing currency (default EUR)
 *
 * `client-ref` carries OUR message id, and Vonage echoes it on every delivery
 * receipt — so a receipt resolves its message even when the send itself
 * ended uncertain and we never learned Vonage's id.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API = 'https://rest.nexmo.com/sms/json';
const PRICING = 'https://rest.nexmo.com/account/get-pricing/outbound/sms';
const TIMEOUT_MS = 15_000;

/** Environment variables first, then credentials stored from the console (credentials.js). */
const env = (override = null) => {
  const c = override || credentials.resolve('vonage');
  return {
    key: c.apiKey,
    secret: c.apiSecret,
    sigSecret: c.signatureSecret,
    sigMethod: c.signatureMethod || 'md5hash',
    currency: String(c.currency || 'EUR').toUpperCase(),
  };
};

const credentialStatus = () => credentials.status('vonage');
const configured = () => credentialStatus().configured;

// https://developer.vonage.com/messaging/sms/guides/troubleshooting-sms
const RECIPIENT_FINAL = new Set(['2', '3', '6', '7', '12', '22', '33']);
const RETRYABLE = new Set(['1', '5', '10']);
const SUPPRESS = { 33: 'invalid_number', 7: 'carrier_opt_out' };
const UNHEALTHY = new Set(['4', '8', '9', '11', '14', '32']);

function classifyStatus(status, text) {
  const s = String(status);
  const base = { errorCode: `VONAGE_${s}`, errorMessage: String(text || '').slice(0, 300), httpStatus: 200 };
  if (RETRYABLE.has(s)) return { ...base, outcome: 'retryable', providerHealthy: s !== '5' };
  if (RECIPIENT_FINAL.has(s)) return { ...base, outcome: 'rejected', scope: 'recipient', suppress: SUPPRESS[s] || null, providerHealthy: true };
  return { ...base, outcome: 'rejected', scope: 'provider', providerHealthy: !UNHEALTHY.has(s) };
}

async function send({ to, body, sender, callbackUrl, clientRef, encoding }) {
  const e = env();
  const payload = {
    api_key: e.key,
    api_secret: e.secret,
    from: sender.value.replace(/^\+/, ''),
    to: to.replace(/^\+/, ''),
    text: body,
    type: encoding === 'UCS-2' ? 'unicode' : 'text',
    'client-ref': clientRef,
    'status-report-req': true,
  };
  if (callbackUrl) payload.callback = callbackUrl;

  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return networkOutcome(err);
  }
  if (res.status === 429) return { outcome: 'retryable', httpStatus: 429, errorCode: 'HTTP_429', errorMessage: 'Throttled', providerHealthy: true };
  if (res.status >= 500) return { outcome: 'uncertain', httpStatus: res.status, errorCode: `HTTP_${res.status}`, providerHealthy: false };
  const json = await res.json().catch(() => null);
  const parts = Array.isArray(json?.messages) ? json.messages : [];
  if (!res.ok || parts.length === 0) {
    return classifyStatus(json?.status ?? 'unknown', json?.['error-text'] || `HTTP ${res.status}`);
  }

  const ok = parts.filter((p) => String(p.status) === '0');
  if (ok.length === 0) return classifyStatus(parts[0].status, parts[0]['error-text']);
  // Some parts accepted: the recipient will receive SOMETHING, so this is a
  // send — retrying would duplicate the parts that went.
  const price = ok.reduce((sum, p) => sum + (toMicros(p['message-price']) || 0), 0);
  return {
    outcome: 'accepted',
    httpStatus: res.status,
    providerMessageId: ok[0]['message-id'],
    partIds: ok.map((p) => p['message-id']),
    segments: parts.length,
    priceMicros: price || null,
    currency: e.currency,
    errorMessage: ok.length < parts.length ? `${parts.length - ok.length} part(s) refused` : null,
    providerHealthy: true,
  };
}

const STATUS_MAP = {
  delivered: 'delivered', accepted: 'sent', buffered: 'sent',
  expired: 'undelivered', failed: 'failed', rejected: 'failed',
};

function parseStatus(params) {
  const raw = String(params.status || '').toLowerCase();
  const errCode = params['err-code'] != null && String(params['err-code']) !== '0' ? String(params['err-code']) : null;
  return {
    providerMessageId: params.messageId || params['message-id'] || null,
    clientRef: params['client-ref'] || null,
    statusRaw: raw,
    status: STATUS_MAP[raw] || null,
    errorCode: errCode,
    suppress: errCode === '1' ? 'invalid_number' : null,   // DLR err-code 1: unknown subscriber
    priceMicros: toMicros(params.price),
    currency: params.price != null ? env().currency : null,
  };
}

function parseInbound(params) {
  return {
    providerMessageId: params.messageId || params['message-id'] || null,
    from: params.msisdn ? `+${String(params.msisdn).replace(/^\+/, '')}` : '',
    to: params.to || '',
    text: params.text || '',
    optOutType: null,
  };
}

/** Vonage's own signature, when the account signs webhooks. Our URL token is checked by the caller either way. */
function verifyWebhook({ params }) {
  const e = env();
  if (!e.sigSecret) return true;
  return verifyVonage({ params, secret: e.sigSecret, method: e.sigMethod });
}

const inboundReply = () => ({ contentType: 'text/plain', body: '' });
/** Whether Vonage webhooks carry a signature we can check (a secret is configured, env or stored). */
const signsWebhooks = () => Boolean(env().sigSecret);

/** READ-ONLY account check: the balance. Sends nothing. */
async function testConnection(override = null) {
  const e = env(override);
  if (!e.key || !e.secret) return { ok: false, error: 'API key and secret are required.' };
  try {
    const q = new URLSearchParams({ api_key: e.key, api_secret: e.secret });
    const res = await fetch(`https://rest.nexmo.com/account/get-balance?${q}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Vonage refused these credentials.' };
    if (!res.ok) return { ok: false, error: `Vonage answered ${res.status}.` };
    const json = await res.json().catch(() => ({}));
    return { ok: true, balance: json.value != null ? Number(json.value) : null, currency: e.currency, autoReload: Boolean(json.autoReload) };
  } catch (err) {
    return { ok: false, error: `Could not reach Vonage (${err.name === 'TimeoutError' ? 'timeout' : 'network'}).` };
  }
}

/** READ-ONLY: the account's numbers with the SMS feature, to import as senders. */
async function listNumbers(override = null) {
  const e = env(override);
  const q = new URLSearchParams({ api_key: e.key, api_secret: e.secret, size: '100' });
  const res = await fetch(`https://rest.nexmo.com/account/numbers?${q}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Vonage answered ${res.status}`);
  const json = await res.json();
  return (json.numbers || []).map((n) => ({
    value: `+${String(n.msisdn).replace(/^\+/, '')}`,
    kind: String(n.type || '').includes('toll-free') ? 'toll_free' : 'long_code',
    label: n.country ? `${n.country} number` : null,
    country: n.country || null,
    sms: (n.features || []).includes('SMS'),
  }));
}

async function pricing(iso2) {
  const e = env();
  const q = new URLSearchParams({ api_key: e.key, api_secret: e.secret, country: iso2 });
  const res = await fetch(`${PRICING}?${q}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404 || res.status === 400) return { available: false, costMicros: null, currency: null };
  if (!res.ok) throw new Error(`Vonage pricing answered ${res.status}`);
  const json = await res.json();
  let max = toMicros(json.defaultPrice);
  for (const n of json.networks || []) {
    const v = toMicros(n.price);
    if (v != null && (max == null || v > max)) max = v;
  }
  return { available: max != null && max > 0, costMicros: max, currency: (json.currency || e.currency).toUpperCase() };
}

module.exports = {
  id: 'vonage', displayName: 'Vonage', repliesSupported: true,
  configured, credentialStatus, send, parseStatus, parseInbound, verifyWebhook, inboundReply, pricing,
  testConnection, listNumbers, classifyStatus, signsWebhooks, repliesInline: false,
  lookup: async () => ({ found: null }),
  docs: () => 'https://api.support.vonage.com/hc/en-us/sections/200622473-Country-Specific-Features-and-Restrictions',
};
