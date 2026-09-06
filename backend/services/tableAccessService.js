const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { hashPassword, verifyPassword } = require('../utils/crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Password-protected tables (BRD §27).
 *
 * An organizer marks a table private and sets a password. Only someone given
 * that password may see the table or buy it.
 *
 * TWO THINGS MAKE THIS ACTUALLY PRIVATE, and only one of them is the password:
 *
 *   1. A private table is OMITTED from the public seat map entirely — not
 *      returned with a `locked: true` flag. A flag hides it from the rendered
 *      page and from nobody else: the row is still in the JSON, and its label,
 *      price and seat count are one DevTools panel away. Someone who was not
 *      given the password is not supposed to know the table is there.
 *
 *   2. Verification happens here, on the server, against a stretched hash.
 *      Comparing on the client would mean shipping the answer to be checked.
 *
 * Unlocking returns a short-lived signed token scoped to one table. Guests have
 * no session to hang the unlocked state on, and a token needs no server-side
 * store — but it is deliberately narrow: one table, one event, twenty minutes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Long enough to choose seats and reach checkout, short enough that a token
// pasted into a group chat stops working before the event does.
const ACCESS_TTL_MINUTES = 20;

// A distinct `typ` so a table token can never be mistaken for a session token
// by any future verifier — same secret, different purpose, and the difference
// has to be checkable.
const TOKEN_TYPE = 'table_access';

/** Hash a table password for storage. Never store or log the password itself. */
async function hashTablePassword(plain) {
  return hashPassword(plain);
}

/**
 * Check a password against a table.
 *
 * Returns a plain false for every failure — wrong password, no password set,
 * table is not private, table does not exist. A caller that could tell those
 * apart would be an oracle for which tables exist and which are protected,
 * which is the thing point 1 above is protecting.
 */
async function verifyTablePassword(tableId, password) {
  const { data: table } = await supabase
    .from('tables')
    .select('id, is_private, password_hash, venue_map_id')
    .eq('id', tableId)
    .maybeSingle();

  if (!table || !table.is_private || !table.password_hash) return false;

  const { ok } = await verifyPassword(String(password || ''), table.password_hash);
  return ok;
}

/** Mint a token that unlocks exactly one table on one event. */
function issueAccessToken({ eventId, tableId }) {
  return jwt.sign(
    { typ: TOKEN_TYPE, eventId, tableId },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${ACCESS_TTL_MINUTES}m` },
  );
}

/**
 * Which tables has this request unlocked?
 *
 * Takes the raw token list a client sent and returns the ids that genuinely
 * verify for THIS event. Anything malformed, expired, for another event, or of
 * another token type is dropped silently — a client holding a stale token
 * should see the map without that table, not an error page.
 */
function unlockedTableIds(tokens, eventId) {
  const list = Array.isArray(tokens) ? tokens : (tokens ? [tokens] : []);
  const ids = new Set();

  for (const raw of list.slice(0, 20)) {   // bounded: a request cannot ask us to verify 10,000 signatures
    try {
      const claims = jwt.verify(String(raw), process.env.JWT_SECRET, { algorithms: ['HS256'] });
      // The type check is what stops a session cookie being replayed here as a
      // table key. Both are signed with the same secret.
      if (claims.typ !== TOKEN_TYPE) continue;
      if (claims.eventId !== eventId) continue;
      if (claims.tableId) ids.add(claims.tableId);
    } catch {
      // Expired or forged — simply not unlocked.
    }
  }
  return ids;
}

module.exports = {
  hashTablePassword,
  verifyTablePassword,
  issueAccessToken,
  unlockedTableIds,
  ACCESS_TTL_MINUTES,
  TOKEN_TYPE,
};
