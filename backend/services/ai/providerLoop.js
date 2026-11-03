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
const overloaded = (err) => err?.code === 'AI_UPSTREAM' && err.status === 503;

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
      try {
        answer = await call({ ...request, image, timeoutMs: deadline(i) });
      } catch (err) {
        if (!overloaded(err) || elapsed() > OVERLOAD_RETRY.before) throw err;
        tried.push({ provider: name, ok: false, code: 'AI_OVERLOADED', ms: Date.now() - at });
        await sleep(OVERLOAD_RETRY.wait);
        // Leave the next provider its start: finish before `lastStart`.
        const room = clock.lastStart - elapsed() - OVERLOAD_RETRY.wait;
        answer = await call({ ...request, image, timeoutMs: Math.max(OVERLOAD_RETRY.minTimeout, Math.min(deadline(i), room)) });
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
      tried.push({ provider: name, ok: false, code: err.code || 'AI_ERROR', ms: Date.now() - at });
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
  });
}

module.exports = { runProviders, OVERLOAD_RETRY };
