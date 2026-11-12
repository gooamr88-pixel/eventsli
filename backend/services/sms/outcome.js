/**
 * What happens to a message after one provider call. Pure, and the single
 * place the duplicate-prevention rule is written:
 *
 *   accepted    → sent; receipts take it from there
 *   uncertain   → UNKNOWN. Never retried, never handed to another provider.
 *                 A receipt (which carries our id) or a positive provider
 *                 lookup resolves it; otherwise an admin decides.
 *   rejected by the RECIPIENT side (invalid number, opted out at the carrier,
 *                 body refused) → failed; another provider would refuse too
 *   rejected by the PROVIDER (auth, region not enabled, sender refused, out of
 *                 credit) → definitely not sent: next provider, now
 *   retryable   (throttled, never connected) → definitely not sent: back off,
 *                 preferring another provider next time
 */

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;

function backoff(attempt) {
  const ms = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

function nextStep(result, { attempt, maxAttempts, otherCandidates }) {
  switch (result?.outcome) {
    case 'accepted':
      return { status: 'sent' };
    case 'uncertain':
      return { status: 'unknown' };
    case 'rejected':
      if (result.scope === 'recipient') return { status: 'failed', suppress: result.suppress || null };
      if (otherCandidates > 0 && attempt < maxAttempts) return { status: 'queued', delayMs: 0, exclude: true };
      return { status: 'failed' };
    case 'retryable':
      if (attempt >= maxAttempts) return { status: 'failed' };
      return { status: 'queued', delayMs: backoff(attempt), avoid: otherCandidates > 0 };
    default:
      // An adapter that returned nothing we recognise: treat as uncertain.
      return { status: 'unknown' };
  }
}

module.exports = { nextStep, backoff };
