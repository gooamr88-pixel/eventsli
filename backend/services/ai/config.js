/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Eventsli AI — what this deployment is allowed to do, read from the
 * environment on every call (tests set it per case; nothing is captured at
 * import, the `placesService` convention).
 *
 * ABSENT IS A SUPPORTED STATE. With `AI_ENABLED` unset, or with no provider
 * key at all, `enabled` is false: the quota route says so, the organizer never
 * sees a "Create with AI" card, and nothing else changes. That is also the
 * whole rollback — flip the flag, `pm2 restart eventsli-backend`.
 *
 * Keys are server-side only. None of these is NEXT_PUBLIC_, none is logged,
 * and none ever leaves this process except in a request header to its own
 * provider (`aiHttp.js`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Two generations per organizer per rolling 24 hours, across every AI
 *  feature (owner decisions D-002, D-009). A constant, not a setting: the owner
 *  set the number, and an env var is how a number stops being a decision. */
const DAILY_LIMIT = 2;
const WINDOW = '24 hours';
/** A reservation older than this no longer counts — its worker died. Longer
 *  than the whole provider budget below, so a live request is never mistaken
 *  for a dead one. */
const STALE = '2 minutes';

/**
 * Per-provider deadlines, inside the browser's own 30 s (`apiClient.js`,
 * I-021). Primary plus fallback stays under it with room for the validation
 * and the two database round trips on either side.
 */
const TIMEOUTS = Object.freeze({ primary: 11_000, fallback: 9_000 });

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const str = (v) => String(v || '').trim();

const PROVIDERS = Object.freeze({
  gemini: {
    key: () => str(process.env.AI_GEMINI_API_KEY),
    // Read from Google's model list on 2026-10-18 (D-021). A setting, because
    // model IDs are retired on Google's schedule, not ours.
    model: () => str(process.env.AI_GEMINI_MODEL) || 'gemini-3.8-flash',
  },
  groq: {
    key: () => str(process.env.AI_GROQ_API_KEY),
    // One of the two Groq models documented for strict json_schema output.
    model: () => str(process.env.AI_GROQ_MODEL) || 'openai/gpt-oss-120b',
  },
});

/** The providers to try, in order, that actually have a key. */
function providerOrder() {
  const asked = str(process.env.AI_PROVIDER_ORDER || 'gemini,groq')
    .split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  return asked.filter((name) => {
    if (seen.has(name) || !PROVIDERS[name] || !PROVIDERS[name].key()) return false;
    seen.add(name);
    return true;
  });
}

/** A positive whole number, or null for "no ceiling". */
function globalCap() {
  const n = Number.parseInt(str(process.env.AI_GLOBAL_DAILY_CAP), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Why AI is off, in words an operator can act on — or null when it is on.
 *
 * Added after the first deploy: AI was "enabled in env" and the card did not
 * appear, and from the outside every cause looks the same. The boot log and the
 * quota route both say which one it is now.
 */
function disabledReason(order) {
  if (!truthy(process.env.AI_ENABLED)) return 'AI_ENABLED is not "true" in backend/.env';
  if (order.length === 0) {
    const asked = str(process.env.AI_PROVIDER_ORDER || 'gemini,groq');
    return `AI_ENABLED is on, but no provider in AI_PROVIDER_ORDER (${asked}) has a key — set AI_GEMINI_API_KEY and/or AI_GROQ_API_KEY`;
  }
  return null;
}

function aiConfig() {
  const order = providerOrder();
  const reason = disabledReason(order);
  return {
    enabled: reason === null,
    reason,
    order,
    limit: DAILY_LIMIT,
    window: WINDOW,
    stale: STALE,
    globalCap: globalCap(),
    timeouts: TIMEOUTS,
  };
}

module.exports = { aiConfig, PROVIDERS, DAILY_LIMIT, WINDOW, STALE, TIMEOUTS };
