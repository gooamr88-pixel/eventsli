/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The one way Eventsli AI talks to a model provider: a JSON POST over
 * `node:https`, IPv4 only, with a hard deadline.
 *
 * WHY NOT `fetch` (I-019, D-021). This box has both an A and an AAAA record and
 * Node races them; IPv6 usually wins. A Google API key restricted to the
 * server's IP then sees an address that is not on its allow list and refuses
 * — and to the organizer that looks like "AI is down", with nothing in the
 * error that says why. `placesService.js` hit exactly this with the Places
 * key and solved it the same way; this is that solution, not a new one. Forcing
 * the family through `fetch` needs an undici Agent, and undici is not
 * importable here without adding a dependency (D-013).
 *
 * WHAT IS RETURNED, AND WHAT IS NEVER RETURNED. The caller gets the status,
 * the parsed body and Retry-After. The request headers — which carry the key —
 * are never logged, never attached to an error, and never echoed.
 *
 * TESTS NEVER CALL A PROVIDER. `setTransport` swaps the network out for a
 * function, so the unit suite proves the fallback and validation logic against
 * recorded answers and needs no key at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const https = require('node:https');

const agent = new https.Agent({ family: 4, keepAlive: true, maxSockets: 16 });

/** Bodies above this are not a draft; they are a fault. Stops a misbehaving
 *  upstream from holding a worker while it streams megabytes. */
const MAX_RESPONSE_BYTES = 512 * 1024;

function aiError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function httpsTransport({ url, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      agent,
      family: 4,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(aiError('AI_RESPONSE_TOO_LARGE', 'The provider answer was too large.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
        retryAfter: res.headers['retry-after'] || null,
      }));
    });

    // `timeout` only emits; without the destroy the socket outlives its deadline.
    req.on('timeout', () => req.destroy(aiError('AI_TIMEOUT', 'The provider did not answer in time.')));
    req.on('error', (err) => reject(err.code && String(err.code).startsWith('AI_')
      ? err
      : aiError('AI_NETWORK', 'The provider could not be reached.', { cause: err.code || null })));
    req.write(payload);
    req.end();
  });
}

let transport = httpsTransport;

/** Tests only: replace the network with `fn({ url, headers, body, timeoutMs })`. */
function setTransport(fn) { transport = fn || httpsTransport; }

/**
 * POST `body` as JSON. Resolves `{ status, ok, json, retryAfter }`; rejects only
 * with an `AI_*` code (timeout, network, oversize). A non-2xx answer RESOLVES
 * — deciding whether a 429 means "fall back" is the caller's job, not this one's.
 */
async function postJson({ url, headers = {}, body, timeoutMs }) {
  const res = await transport({ url, headers, body, timeoutMs });
  let json = null;
  try { json = res.text ? JSON.parse(res.text) : null; } catch { json = null; }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    json,
    retryAfter: res.retryAfter || null,
  };
}

module.exports = { postJson, setTransport, aiError };
