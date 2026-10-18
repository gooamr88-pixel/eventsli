/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The two model providers, behind one shape (D-003, D-011, D-019).
 *
 *   call({ system, user, jsonSchema, geminiSchema, timeoutMs })
 *     → { json, model, usage: { input, output } }
 *     ✗ an Error whose `code` is one of FAILURES below
 *
 * Every failure has a code because the orchestrator decides from it whether
 * the next provider is worth trying, and because the code is what gets logged
 * and stored — never the upstream body, which can quote the prompt back.
 *
 * Gemini: `models/{model}:generateContent` with `responseMimeType` and
 * `responseSchema` (the OpenAPI-subset dialect — see schema.js). Groq: the
 * OpenAI-compatible chat endpoint with a strict `json_schema`, which Groq
 * documents as non-streaming, so neither call streams.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { postJson, aiError } = require('./aiHttp');
const { PROVIDERS } = require('./config');
const logger = require('../../utils/logger');

const FAILURES = Object.freeze([
  'AI_TIMEOUT', 'AI_NETWORK', 'AI_RESPONSE_TOO_LARGE',
  'AI_RATE_LIMITED', 'AI_AUTH', 'AI_REQUEST_REJECTED', 'AI_UPSTREAM',
  'AI_BLOCKED', 'AI_TRUNCATED', 'AI_EMPTY', 'AI_BAD_JSON',
]);

/** A model id goes into a URL path. Only the characters model ids use. */
const SAFE_MODEL = /^[A-Za-z0-9._/-]{1,80}$/;

/** Map an HTTP failure to a code; log the provider's own words for the operator. */
function httpFailure(provider, res) {
  const upstream = res.json?.error?.message || res.json?.error?.status || null;
  logger.warn(
    { provider, status: res.status, upstream: upstream ? String(upstream).slice(0, 200) : null },
    'ai provider refused the request',
  );
  if (res.status === 429) return aiError('AI_RATE_LIMITED', 'The provider is rate limiting us.', { retryAfter: res.retryAfter });
  if (res.status === 401 || res.status === 403) return aiError('AI_AUTH', 'The provider rejected our key.');
  if (res.status >= 400 && res.status < 500) return aiError('AI_REQUEST_REJECTED', 'The provider rejected the request.');
  return aiError('AI_UPSTREAM', 'The provider failed.');
}

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw aiError('AI_EMPTY', 'The provider returned nothing.');
  // Some models wrap JSON in a code fence even in JSON mode. Unwrap, then parse.
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    throw aiError('AI_BAD_JSON', 'The provider returned something that is not JSON.');
  }
}

async function gemini({ system, user, geminiSchema, timeoutMs }) {
  const model = PROVIDERS.gemini.model();
  if (!SAFE_MODEL.test(model)) throw aiError('AI_REQUEST_REJECTED', 'The Gemini model setting is not a model id.');

  const res = await postJson({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    // In a header, never the query string: URLs end up in access logs.
    headers: { 'x-goog-api-key': PROVIDERS.gemini.key() },
    timeoutMs,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: geminiSchema,
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    },
  });
  if (!res.ok) throw httpFailure('gemini', res);

  const data = res.json || {};
  if (data.promptFeedback?.blockReason) throw aiError('AI_BLOCKED', 'The provider declined the description.');
  const candidate = data.candidates?.[0];
  if (!candidate) throw aiError('AI_EMPTY', 'The provider returned no answer.');
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(candidate.finishReason)) {
    throw aiError('AI_BLOCKED', 'The provider declined the description.');
  }
  if (candidate.finishReason === 'MAX_TOKENS') throw aiError('AI_TRUNCATED', 'The answer was cut off.');

  const text = (candidate.content?.parts || []).map((p) => p.text || '').join('');
  return {
    json: parseJson(text),
    model,
    usage: {
      input: data.usageMetadata?.promptTokenCount ?? null,
      output: data.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

async function groq({ system, user, jsonSchema, timeoutMs }) {
  const model = PROVIDERS.groq.model();
  if (!SAFE_MODEL.test(model)) throw aiError('AI_REQUEST_REJECTED', 'The Groq model setting is not a model id.');

  const res = await postJson({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    headers: { Authorization: `Bearer ${PROVIDERS.groq.key()}` },
    timeoutMs,
    body: {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name: 'event_draft', strict: true, schema: jsonSchema } },
      temperature: 0.2,
      max_completion_tokens: 4096,
      // The gpt-oss models reason before answering; at "low" they spend
      // seconds rather than the whole budget on a form-filling task.
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    },
  });
  if (!res.ok) throw httpFailure('groq', res);

  const choice = res.json?.choices?.[0];
  if (!choice) throw aiError('AI_EMPTY', 'The provider returned no answer.');
  if (choice.finish_reason === 'length') throw aiError('AI_TRUNCATED', 'The answer was cut off.');
  if (choice.finish_reason === 'content_filter') throw aiError('AI_BLOCKED', 'The provider declined the description.');

  return {
    json: parseJson(choice.message?.content),
    model,
    usage: {
      input: res.json?.usage?.prompt_tokens ?? null,
      output: res.json?.usage?.completion_tokens ?? null,
    },
  };
}

const CALLERS = Object.freeze({ gemini, groq });

module.exports = { CALLERS, FAILURES, parseJson };
