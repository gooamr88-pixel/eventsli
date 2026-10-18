/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One organizer request → one validated draft, from whichever provider can
 * give one (D-011).
 *
 * THE ORDER. Providers are tried in `AI_PROVIDER_ORDER` (Gemini, then Groq).
 * The next one is tried after ANY failure of the previous — a timeout, a 429
 * from a free tier that has run out for the minute, a refusal, JSON that does
 * not parse, or an answer the validator cannot use. The same provider is never
 * retried: on a free tier a second attempt is the request most likely to be
 * rate limited, and the organizer is waiting.
 *
 * THE CLOCK. Each provider has its own deadline (config.TIMEOUTS) and the
 * whole thing has one more: a fallback is not started once the request is
 * nearly out of the browser's 30 s, because an answer that arrives after the
 * browser has given up is a generation spent on nothing (I-021).
 *
 * WHAT COMES BACK. The draft, and metadata for `ai_generations`: provider,
 * model, attempts, tokens, latency. Never the prompt or the raw answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { buildRequest } = require('./eventDraftPrompt');
const { validateDraft } = require('./eventDraftValidate');
const { CALLERS } = require('./providers');
const { aiError } = require('./aiHttp');
const logger = require('../../utils/logger');

/** No fallback starts after this much of the request has gone. */
const LAST_START_MS = 15_000;

async function generateEventDraft({
  text, listingType, country, currency, timezone, categories, cfg, now = new Date(), callers = CALLERS,
}) {
  const request = buildRequest({ text, listingType, country, currency, timezone, categories, now });
  const started = Date.now();
  const tried = [];
  let last = null;

  for (const [i, name] of cfg.order.entries()) {
    if (i > 0 && Date.now() - started > LAST_START_MS) break;
    const call = callers[name];
    if (!call) continue;
    const at = Date.now();
    try {
      const answer = await call({ ...request, timeoutMs: i === 0 ? cfg.timeouts.primary : cfg.timeouts.fallback });
      const { draft, dropped } = validateDraft(answer.json, {
        text, listingType, timezone, categories: categories.map((c) => c.slug), now,
      });
      tried.push({ provider: name, ok: true, ms: Date.now() - at });
      logger.info({ provider: name, attempts: tried.length, ms: Date.now() - started, dropped }, 'ai event draft generated');
      return {
        draft,
        meta: {
          provider: name,
          model: answer.model,
          attempts: tried.length,
          input_chars: text.length,
          input_tokens: answer.usage.input,
          output_tokens: answer.usage.output,
          latency_ms: Date.now() - started,
        },
      };
    } catch (err) {
      last = err;
      tried.push({ provider: name, ok: false, code: err.code || 'AI_ERROR', ms: Date.now() - at });
      // A bug of ours (a TypeError in the validator) must not look like an
      // outage forever: it is logged loudly with its stack, then falls back.
      if (!err.code) logger.error({ err, provider: name }, 'ai provider call threw without a code');
    }
  }

  logger.warn({ tried }, 'ai event draft: every provider failed');
  throw aiError('AI_UNAVAILABLE', 'No provider could write a draft.', {
    meta: {
      provider: tried.at(-1)?.provider || null,
      attempts: tried.length,
      input_chars: text.length,
      latency_ms: Date.now() - started,
      failure_code: last?.code || 'AI_NO_PROVIDER',
    },
  });
}

module.exports = { generateEventDraft, LAST_START_MS };
