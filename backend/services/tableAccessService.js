const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { hashPassword, verifyPassword } = require('../utils/crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Password-protected tables (BRD §27).
 *
 * An organizer marks a table private and sets a password. Only someone given
 * that password may book the table or any seat at it.
 *
 * VISIBLE, NOT HIDDEN (owner, 2026-11-24). A private table used to be omitted
 * from the public seat map entirely. The owner changed the rule: everyone sees
 * it on the map, marked Private, and the password gates selecting, reserving
 * and buying it. So the public map returns it with `locked: true` and without
 * its prices or ticket types (seatMapController.publicMap), and what keeps it
 * private is what always did the real work:
 *
 *   1. The HOLD refuses a private table, or a seat at one, without a token
 *      for it (placeHold.js) — the server decides, not the page.
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
