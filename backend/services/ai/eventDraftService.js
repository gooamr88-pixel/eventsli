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
const { buildRequest, buildPosterRequest } = require('./eventDraftPrompt');
const { validateDraft, clean } = require('./eventDraftValidate');
const { redact } = require('./redact');
const { CALLERS } = require('./providers');
const { aiError } = require('./aiHttp');
const logger = require('../../utils/logger');

/** No fallback starts after this much of the request has gone. */
const LAST_START_MS = 15_000;

/** Longer than any real poster; past this the "transcript" is not one. */
const MAX_POSTER_TEXT = 4000;
/** Fewer readable characters than this between poster and note is not an event. */
const MIN_EVIDENCE = 12;

/**
 * A poster answer → the text its facts are checked against.
 *
 * The transcript is bounded and then REDACTED exactly like a typed
 * description: an email or a phone number printed on a poster is still a
 * third party's, and it is not evidence for any field the draft has.
 *
 * Throws AI_NOT_AN_EVENT — which ends the attempt WITHOUT a fallback — when
 * the model says the image is not an event, or there is nothing to read. A
 * second provider asked the same question about a photo of a dog is a second
 * call spent on the same answer.
 */
function readPoster(json, notes) {
  if (!json || typeof json !== 'object') return null;   // validateDraft says why
  const posterText = redact(clean(json.posterText, MAX_POSTER_TEXT) || '').text;
  const evidence = [posterText, notes].filter(Boolean).join('\n\n');
  if (json.isEventPoster === false || evidence.replace(/\s+/g, '').length < MIN_EVIDENCE) {
    throw aiError('AI_NOT_AN_EVENT', 'The image does not show an event.');
  }
  return { posterText, evidence };
}

/**
 * One draft, from a description (`text`) or from a poster (`image`, with
 * `text` as the organizer's optional note). Same loop, same validator; a
 * poster only changes the prompt, the providers that can be asked, the clock,
 * and what the evidence is checked against.
 */
async function generateEventDraft({
  text, image = null, listingType, country, currency, timezone, categories, cfg, now = new Date(), callers = CALLERS,
}) {
  const poster = Boolean(image);
  const request = poster
    ? buildPosterRequest({ notes: text, listingType, country, currency, timezone, categories, now })
    : buildRequest({ text, listingType, country, currency, timezone, categories, now });
  const order = poster ? cfg.visionOrder : cfg.order;
  const clock = poster ? cfg.visionTimeouts : { ...cfg.timeouts, lastStart: LAST_START_MS };
  const started = Date.now();
  const tried = [];
  let last = null;

  for (const [i, name] of order.entries()) {
    if (i > 0 && Date.now() - started > clock.lastStart) break;
    const call = callers[name];
    if (!call) continue;
    const at = Date.now();
    try {
      const answer = await call({ ...request, image, timeoutMs: i === 0 ? clock.primary : clock.fallback });
      const read = poster ? readPoster(answer.json, text) : null;
      const evidence = read ? read.evidence : text;
      const { draft, dropped } = validateDraft(answer.json, {
        text: evidence, listingType, timezone, categories: categories.map((c) => c.slug), now,
      });
      tried.push({ provider: name, ok: true, ms: Date.now() - at });
      logger.info({
        provider: name, attempts: tried.length, ms: Date.now() - started, dropped, source: poster ? 'poster' : 'text',
      }, 'ai event draft generated');
      return {
        draft,
        posterText: read ? read.posterText : null,
        meta: {
          provider: name,
          model: answer.model,
          attempts: tried.length,
          input_chars: evidence.length,
          input_tokens: answer.usage.input,
          output_tokens: answer.usage.output,
          latency_ms: Date.now() - started,
        },
      };
    } catch (err) {
      last = err;
      tried.push({ provider: name, ok: false, code: err.code || 'AI_ERROR', ms: Date.now() - at });
      if (err.code === 'AI_NOT_AN_EVENT') {
        logger.info({ provider: name }, 'ai poster draft: the image is not an event');
        throw aiError('AI_NOT_AN_EVENT', err.message, {
          meta: {
            provider: name, attempts: tried.length, input_chars: text.length,
            latency_ms: Date.now() - started, failure_code: 'AI_NOT_AN_EVENT',
          },
        });
      }
      // A bug of ours (a TypeError in the validator) must not look like an
      // outage forever: it is logged loudly with its stack, then falls back.
      if (!err.code) logger.error({ err, provider: name }, 'ai provider call threw without a code');
    }
  }

  logger.warn({ tried, source: poster ? 'poster' : 'text' }, 'ai event draft: every provider failed');
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

module.exports = { generateEventDraft, readPoster, LAST_START_MS };
