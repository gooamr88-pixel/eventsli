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

/**
 * Reading a poster takes longer than reading a paragraph — the model looks at
 * the image, transcribes it and then fills the form — and the browser has
 * already spent part of its 30 s uploading the image. So the primary gets a
 * little more, the fallback a little less, and no fallback starts after 14 s:
 * 14 + 8 leaves the upload and the database round trips room inside 30.
 */
const VISION_TIMEOUTS = Object.freeze({ primary: 13_000, fallback: 8_000, lastStart: 14_000 });

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const str = (v) => String(v || '').trim();

const PROVIDERS = Object.freeze({
  gemini: {
    key: () => str(process.env.AI_GEMINI_API_KEY),
    // Read from Google's model list on 2026-10-18 (D-021). A setting, because
    // model IDs are retired on Google's schedule, not ours.
    model: () => str(process.env.AI_GEMINI_MODEL) || 'gemini-3.8-flash',
    // Gemini Flash models read images natively, so posters use the same model
    // unless an operator names another. `off` keeps this provider for text only.
    visionModel: () => str(process.env.AI_GEMINI_VISION_MODEL) || PROVIDERS.gemini.model(),
  },
  groq: {
    key: () => str(process.env.AI_GROQ_API_KEY),
    // One of the two Groq models documented for strict json_schema output.
    model: () => str(process.env.AI_GROQ_MODEL) || 'openai/gpt-oss-120b',
    // gpt-oss reads text only; Groq's image-capable models are the Llama 4
    // family (base64 images up to 4 MB). They support JSON mode but strict
    // json_schema is not documented for them, so `providers.groq` asks for a
    // JSON object and the server validator stays the guarantee.
    visionModel: () => str(process.env.AI_GROQ_VISION_MODEL) || 'meta-llama/llama-4-scout-17b-16e-instruct',
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

/**
 * The providers that can read a poster: the text order, minus any whose
 * vision model an operator has switched `off`.
 */
function visionOrder(order) {
  return order.filter((name) => !/^(off|none|false)$/i.test(PROVIDERS[name].visionModel()));
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
  const vision = visionOrder(order);
  return {
    enabled: reason === null,
    reason,
    order,
    visionOrder: vision,
    // Poster import is on with AI unless AI_POSTER_ENABLED is set to false, or
    // no configured provider can read images.
    poster: reason === null && vision.length > 0 && !/^(0|false|no|off)$/i.test(str(process.env.AI_POSTER_ENABLED)),
    limit: DAILY_LIMIT,
    window: WINDOW,
    stale: STALE,
    globalCap: globalCap(),
    timeouts: TIMEOUTS,
    visionTimeouts: VISION_TIMEOUTS,
  };
}

module.exports = {
  aiConfig, PROVIDERS, DAILY_LIMIT, WINDOW, STALE, TIMEOUTS, VISION_TIMEOUTS,
};
