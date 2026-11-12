/**
 * Shared by every adapter: what a network failure means for "was it sent?".
 *
 * A connection that was never opened (DNS failure, refused, bad certificate)
 * cannot have delivered a request — that is a definite NOT SENT, safe to retry
 * or to hand to another provider. A timeout or a reset after the request was
 * written is UNCERTAIN: the provider may have accepted it. Uncertain messages
 * are never resent automatically.
 */
const NEVER_CONNECTED = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkOutcome(err) {
  const code = err?.cause?.code || err?.code || null;
  if (code && NEVER_CONNECTED.has(code)) {
    return { outcome: 'retryable', errorCode: code, errorMessage: 'Could not reach the provider', providerHealthy: false };
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return {
    outcome: 'uncertain',
    errorCode: timeout ? 'TIMEOUT' : (code || 'NETWORK'),
    errorMessage: timeout ? 'The provider did not answer in time' : 'The connection failed mid-request',
    providerHealthy: false,
  };
}

/** "0.0075" (dollars) → 7500 (micros), exactly: no float multiplication. */
function toMicros(value) {
  if (value == null || value === '') return null;
  const m = /^(-?)([0-9]+)(?:\.([0-9]{1,12}))?$/.exec(String(value).trim());
  if (!m) return null;
  const frac = (m[3] || '').padEnd(6, '0').slice(0, 6);
  const micros = Number(m[2]) * 1_000_000 + Number(frac);
  return Math.abs(m[1] ? -micros : micros);
}

module.exports = { networkOutcome, toMicros };
