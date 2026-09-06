/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Reading a scanned code, before the network sees it.
 *
 * Two jobs, and the distinction between them is the important part:
 *
 *   extractToken()  — what came off the camera may not be exactly the token.
 *   peekTicket()    — what the token SAYS, which is not what it PROVES.
 *
 * `peekTicket` decodes the JWT payload and does not verify the signature. It
 * cannot: the signing key is QR_JWT_SECRET and it lives on the server, which is
 * the entire point — a browser that could verify a ticket could also mint one.
 *
 * So this is a SHAPE check, and it is used for exactly one thing: refusing,
 * offline, a code that the server would certainly refuse anyway — one that is
 * not a ticket at all, or is a ticket for a different event. That saves the
 * operator from queueing rubbish and then watching it fail an hour later.
 *
 * It is never used to admit anyone. An admission comes from the server, and
 * offline it does not come at all — see scanQueue.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What `GET /public/qr/:token` encodes is the bare token. A ticket URL is
 *  accepted too, because a person pasting from an email will paste the link. */
export function extractToken(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  // `/t/<token>` — our own ticket page. Also tolerates a trailing slash, a
  // query string, and a full origin, because all three arrive from a paste.
  const inUrl = text.match(/\/t\/([A-Za-z0-9._-]+)/);
  if (inUrl) return inUrl[1];

  return text;
}

/** base64url → the decoded string, or null. Not a general decoder: a JWT
 *  payload is ASCII JSON, so there is no UTF-8 handling to get wrong. */
function decodeSegment(segment) {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

/**
 * The claims a ticket token carries, UNVERIFIED.
 *
 * Returns `{ ticketId, eventId }`, or null if this is not shaped like one of
 * ours. Mirrors the server's `decodeQrToken` minus the only line that matters
 * for trust — `jwt.verify` — which is why the name says "peek".
 */
export function peekTicket(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const json = decodeSegment(parts[1]);
  if (!json) return null;

  let claims;
  try { claims = JSON.parse(json); } catch { return null; }

  if (claims?.typ !== 'ticket') return null;
  if (!claims.tid || !claims.eid) return null;

  return { ticketId: String(claims.tid), eventId: String(claims.eid) };
}

/**
 * The offline verdict, or null meaning "only the server can answer this".
 *
 * `null` is the common case and the honest one. A well-formed ticket for this
 * event is not an admission — it may already have been used, voided, or belong
 * to a cancelled event, and none of that is knowable here.
 */
export function offlineVerdict(token, eventId) {
  const claims = peekTicket(token);
  if (!claims) return 'invalid';
  if (eventId && claims.eventId !== eventId) return 'wrong_event';
  return null;
}
