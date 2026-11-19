/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One request → one usable answer, from whichever provider can give one
 * (D-011). Shared by every Eventsli AI feature: the Smart Event Creator (text
 * and poster), the Seating Designer and the launch kit.
 *
 * THE ORDER. Providers are tried in `order` (Gemini, then Groq). The next one
 * is tried after ANY failure of the previous — a timeout, a 429 from a free
 * tier that has run out for the minute, a refusal, JSON that does not parse,
 * or an answer the caller's `accept` cannot use. The same provider is not
 * retried — a second 429 is the likeliest answer to a first — with ONE
 * exception: a fast 503 "high demand" (`OVERLOAD_RETRY`). Google sheds
 * free-tier load in short bursts; production logged exactly that on
 * 2026-11-03, three times in four minutes, each answered in 1–3 s (I-024). One
 * retry a second later is cheap, and is made only while there is time left for
 * the fallback after it.
 *
 * THE CLOCK. `clock` is `{ primary, fallback, lastStart, total }`. The primary
 * gets its own deadline; a fallback gets at least its own and more when the
 * primary failed fast; no fallback starts after `lastStart`. All of it stays
 * inside the browser's 30 s (I-021).
 *
 * FINAL ANSWERS. An error whose code is in `final` (e.g. AI_NOT_AN_EVENT) is
 * an answer about the INPUT, not a provider failure: it ends the loop at once,
 * with no fallback, carrying the metadata to record.
 *
 * WHAT COMES BACK. `{ result, meta }` — whatever `accept` returned, and the
 * metadata for `ai_generations`: provider, model, attempts, tokens, latency.
 * Never the prompt or the raw answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { CALLERS } = require('./providers');
const { aiError } = require('./aiHttp');
const logger = require('../../utils/logger');

const OVERLOAD_RETRY = Object.freeze({ before: 5_000, wait: 1_000, minTimeout: 3_000 });

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/**
 * A provider that is up but busy or briefly unreachable: Google's 503 "high
 * demand", a 502/504 from its gateway, and Cloudflare's 522/524 in front of
 * Groq (the seating-map reader met both on 2026-11-19). Worth trying the same
 * provider again; a 500 is a fault and is not.
 */
const RETRYABLE = new Set([502, 503, 504, 522, 524]);
const overloaded = (err) => err?.code === 'AI_UPSTREAM' && RETRYABLE.has(err.status);

/**
 * @param {object}   o
 * @param {object}   o.request   `{ system, user, jsonSchema, geminiSchema }`
 * @param {object}   [o.image]   `{ mimeType, data }` — switches providers to their vision model
 * @param {string[]} o.order     provider names, in order
 * @param {object}   o.clock     `{ primary, fallback, lastStart, total }`
 * @param {Function} o.accept    `(answer) → result`; throws to reject the answer
 * @param {number}   o.inputChars  for the usage row
 * @param {string}   o.label     what is being generated, for the log
 * @param {string[]} [o.final]   error codes that end the loop without a fallback
 */
async function runProviders({
  request, image = null, order, clock, accept, inputChars = 0, label, final = [], callers = CALLERS,
}) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const deadline = (i) => (i === 0 ? clock.primary : Math.max(clock.fallback, clock.total - elapsed()));
  const tried = [];
  let last = null;

  for (const [i, name] of order.entries()) {
    if (i > 0 && elapsed() > clock.lastStart) break;
    const call = callers[name];
    if (!call) continue;
    const at = Date.now();
    try {
      let answer;
      // How many busy-retries this provider gets, and until when: one, in the
      // first 5 s, unless the caller's clock allows more (the seating-map
      // reader, with ~50 s, waits 2 s, 4 s, 6 s between up to three).
      const retries = clock.overloadRetries ?? 1;
      const before = clock.retryBefore ?? OVERLOAD_RETRY.before;
      for (let attempt = 0; ; attempt += 1) {
        try {
          answer = attempt === 0
            ? await call({ ...request, image, timeoutMs: deadline(i) })
            : await call({ ...request, image, timeoutMs: Math.max(OVERLOAD_RETRY.minTimeout, Math.min(deadline(i), clock.lastStart - elapsed())) });
          break;
        } catch (err) {
          const wait = clock.overloadRetries ? 2_000 * (attempt + 1) : OVERLOAD_RETRY.wait;
          // Leave the next provider its start: never retry past `lastStart`.
          const room = clock.lastStart - elapsed() - wait;
          if (!overloaded(err) || attempt >= retries || elapsed() > before || room < OVERLOAD_RETRY.minTimeout) throw err;
          tried.push({ provider: name, ok: false, code: 'AI_OVERLOADED', ms: Date.now() - at, status: err.status });
          await sleep(wait);
        }
      }
      const result = accept(answer);
      tried.push({ provider: name, ok: true, ms: Date.now() - at });
      logger.info({ provider: name, attempts: tried.length, ms: elapsed(), label }, 'ai generation answered');
      return {
        result,
        meta: {
          provider: name,
          model: answer.model,
          attempts: tried.length,
          input_chars: inputChars,
          input_tokens: answer.usage?.input ?? null,
          output_tokens: answer.usage?.output ?? null,
          latency_ms: elapsed(),
        },
      };
    } catch (err) {
      last = err;
      tried.push({
        provider: name, ok: false, code: err.code || 'AI_ERROR', ms: Date.now() - at,
        ...(err.status ? { status: err.status } : {}), ...(err.detail ? { detail: err.detail } : {}),
      });
      if (final.includes(err.code)) {
        logger.info({ provider: name, code: err.code, label }, 'ai generation: a final answer about the input');
        throw aiError(err.code, err.message, {
          meta: {
            provider: name, attempts: tried.length, input_chars: inputChars,
            latency_ms: elapsed(), failure_code: err.code,
          },
        });
      }
      // A bug of ours (a TypeError in a validator) must not look like an
      // outage forever: it is logged loudly with its stack, then falls back.
      if (!err.code) logger.error({ err, provider: name, label }, 'ai provider call threw without a code');
    }
  }

  logger.warn({ tried, label }, 'ai generation: every provider failed');
  throw aiError('AI_UNAVAILABLE', 'No provider could answer.', {
    meta: {
      provider: tried.at(-1)?.provider || null,
      attempts: tried.length,
      input_chars: inputChars,
      latency_ms: elapsed(),
      failure_code: last?.code || 'AI_NO_PROVIDER',
    },
    // Every attempt, not just the last: the organizer's "Reason:" line names
    // each provider's failure (2026-11-19). Kept out of `meta`, which is stored.
    tried: tried.filter((t) => !t.ok),
  });
}

module.exports = { runProviders, OVERLOAD_RETRY };
