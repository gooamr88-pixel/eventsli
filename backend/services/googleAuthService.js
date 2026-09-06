const { supabase } = require('../config/supabase');
// The token verification is pure and lives in a file with no I/O, so it can be
// tested without credentials. See googleTokens.js.
const { configured, verifyIdToken } = require('./googleTokens');

/**
 * Sign in with Google — the part that touches the database.
 *
 * Google establishes WHO someone is. We still mint our own session: the same
 * httpOnly cookie a password login produces, backed by the same revocable
 * `sessions` row. Google does not become a second session system, because two
 * systems that can disagree about whether someone is logged in is a bug
 * generator and the one that wins is not obvious from any single file.
 */

/**
 * Finds or creates the account.
 *
 * An existing account is matched BY EMAIL and signed in — which is exactly why
 * `verifyIdToken` refuses an unverified address.
 *
 * A new account gets NO password hash. `verifyPassword` returns false for a
 * null hash, so the password path is closed until they set one — and it fails
 * identically to a wrong password, so nobody can probe for which accounts are
 * OAuth-only.
 */
async function findOrCreate({ email, name }) {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_blocked')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    if (existing.is_blocked) throw fail('ACCOUNT_BANNED', 'This account has been suspended.');
    return { user: existing, created: false };
  }

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      email,
      full_name: name,
      role: 'attendee',
      email_verified_at: new Date().toISOString(),
    })
    .select('id, email, full_name, role')
    .single();

  if (error) {
    // Two simultaneous first sign-ins race on the unique email. The loser reads
    // the winner's row rather than failing — from the user's side both clicks
    // simply worked.
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('profiles').select('id, email, full_name, role').eq('email', email).single();
      return { user: raced, created: false };
    }
    throw new Error(error.message);
  }
  return { user: data, created: true };
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { configured, verifyIdToken, findOrCreate };
