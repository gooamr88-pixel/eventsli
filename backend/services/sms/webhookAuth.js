const crypto = require('node:crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Proving a webhook came from the provider, and signing our own links.
 *
 * TWO LAYERS for delivery receipts:
 *   1. Our own token in the callback URL we hand the provider per message:
 *      `?mid=<message id>&t=<HMAC(mid)>`. It works whatever the provider
 *      account's settings, and it binds the receipt to ONE message, so a
 *      forged receipt cannot flip another message's status.
 *   2. The provider's own signature where it has one: X-Twilio-Signature
 *      (always, keyed by the auth token), and Vonage's `sig` parameter when
 *      VONAGE_SIGNATURE_SECRET is set.
 *
 * Keys are DERIVED from SMS_WEBHOOK_SECRET (falling back to JWT_SECRET, which
 * the API refuses to boot without), one subkey per purpose, so a token minted
 * for one purpose never verifies for another.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function rootSecret() {
  return process.env.SMS_WEBHOOK_SECRET || process.env.JWT_SECRET || '';
}

function sign(purpose, length = 32) {
  const key = crypto.createHmac('sha256', rootSecret()).update('eventsli-sms-v1').digest();
  return crypto.createHmac('sha256', key).update(String(purpose)).digest('base64url').slice(0, length);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

const verify = (purpose, token, length = 32) => safeEqual(sign(purpose, length), token);

/** Twilio: HMAC-SHA1 over the full URL plus every POST param, sorted, name+value. */
function twilioSignature(url, params, authToken) {
  const data = Object.keys(params || {}).sort().reduce((acc, k) => acc + k + (params[k] ?? ''), url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

function verifyTwilio({ url, params, header, authToken }) {
  if (!authToken || !header) return false;
  return safeEqual(twilioSignature(url, params, authToken), header);
}

/**
 * Vonage signed webhooks: "&k=v" for every parameter but `sig`, sorted by key,
 * with & and = in values replaced by _, then md5(string + secret) or an HMAC.
 */
const VONAGE_ALGOS = { md5hash: null, md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha512: 'sha512' };

function vonageSignature(params, secret, method = 'md5hash') {
  const str = Object.keys(params || {})
    .filter((k) => k !== 'sig')
    .sort()
    .map((k) => `&${k}=${String(params[k] ?? '').replace(/[&=]/g, '_')}`)
    .join('');
  if (method === 'md5hash') return crypto.createHash('md5').update(str + secret).digest('hex');
  return crypto.createHmac(VONAGE_ALGOS[method] || 'sha256', secret).update(str).digest('hex');
}

function verifyVonage({ params, secret, method = 'md5hash', now = Date.now(), maxSkewSeconds = 300 }) {
  if (!secret || !params?.sig) return false;
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > maxSkewSeconds) return false;
  return safeEqual(vonageSignature(params, secret, method).toLowerCase(), String(params.sig).toLowerCase());
}

/** The public base URL providers call back. Unset locally: no callbacks, and the log says so. */
function webhookBase() {
  const base = process.env.SMS_WEBHOOK_BASE_URL || process.env.BACKEND_URL || '';
  return base.replace(/\/+$/, '');
}

function statusCallbackUrl(providerId, messageId) {
  const base = webhookBase();
  if (!base) return null;
  return `${base}/api/v1/sms/webhooks/${providerId}/status?mid=${messageId}&t=${sign(`status:${messageId}`)}`;
}

function inboundUrl(providerId, { withToken = true } = {}) {
  const base = webhookBase();
  if (!base) return null;
  const path = `${base}/api/v1/sms/webhooks/${providerId}/inbound`;
  return withToken ? `${path}?t=${sign(`inbound:${providerId}`)}` : path;
}

/**
 * Unsubscribe links: short, because they are paid for by the segment.
 * `<message id as base64url>.<10-char signature>` — the message carries the
 * phone and the consent scope, so the link itself holds no personal data.
 */
function unsubscribeToken(messageId) {
  const id = Buffer.from(String(messageId).replace(/-/g, ''), 'hex').toString('base64url');
  return `${id}.${sign(`unsub:${messageId}`, 10)}`;
}

function readUnsubscribeToken(token) {
  const [id, sig] = String(token || '').split('.');
  if (!id || !sig || id.length !== 22) return null;
  const hex = Buffer.from(id, 'base64url').toString('hex');
  if (hex.length !== 32) return null;
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return verify(`unsub:${uuid}`, sig, 10) ? uuid : null;
}

module.exports = {
  sign, verify, safeEqual, twilioSignature, verifyTwilio, vonageSignature, verifyVonage,
  webhookBase, statusCallbackUrl, inboundUrl, unsubscribeToken, readUnsubscribeToken,
};
