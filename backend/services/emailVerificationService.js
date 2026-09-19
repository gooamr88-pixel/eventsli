const { supabase } = require('../config/supabase');
const { hashIp, randomToken, hashToken } = require('../utils/crypto');
const { frontendOrigin } = require('../utils/frontendOrigin');
const codes = require('./emailCodes');
const email = require('./emailService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Confirming that an address belongs to the person who typed it.
 *
 * Asked for at sign-up, and again at sign-in for any password account that
 * never finished. Google accounts arrive already confirmed — Google refuses an
 * unverified address before we ever see it.
 *
 * ONE EMAIL, TWO WAYS IN. It carries an activation LINK — the main path, one
 * tap from the inbox — and the six digits beside it, for someone who opened the
 * email on a different device from the sign-up form. Both belong to the same
 * row, so using either one uses up both, and a resend kills both.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** How long an activation link works. A code is typed while the email is open;
 *  a link is often clicked the next morning. */
const LINK_TTL_HOURS = 48;

/**
 * Sends a fresh code and link, and kills every earlier one.
 *
 * At most one code a minute per account. Without the cooldown, "resend" is a
 * button that mails a stranger as often as someone can click it.
 *
 * @returns {Promise<{sent: boolean, reason?: string}>} — never throws.
 */
async function issue({ user, req }) {
  try {
    const { data: latest } = await supabase
      .from('email_verifications')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest && Date.now() - new Date(latest.created_at).getTime() < codes.RESEND_COOLDOWN_SECONDS * 1000) {
      return { sent: false, reason: 'cooldown' };
    }

    await supabase
      .from('email_verifications')
      .update({ consumed_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('consumed_at', null);

    const code = codes.generateCode();
    // 256 bits, so a plain hash is safe to store (a code is HMAC'd instead —
    // six digits are not). Only the hash is kept; the token exists in the email.
    const token = randomToken(32);
    const { error } = await supabase.from('email_verifications').insert({
      user_id: user.id,
      code_hash: codes.hashCode({ userId: user.id, code }),
      expires_at: new Date(Date.now() + codes.TTL_MINUTES * 60_000).toISOString(),
      link_token_hash: hashToken(token),
      link_expires_at: new Date(Date.now() + LINK_TTL_HOURS * 3_600_000).toISOString(),
      ip_hash: req ? hashIp(req.ip) : null,
    });
    if (error) {
      // A code we cannot store is a code that cannot work; sending it anyway
      // would have somebody typing a number that is refused.
      logger.error({ err: error.message, userId: user.id }, 'could not store a verification code');
      return { sent: false, reason: 'store_failed' };
    }

    const link = `${frontendOrigin(req?.headers?.origin)}/activate?token=${encodeURIComponent(token)}`;
    const result = await email.sendVerificationCode({
      to: user.email, name: user.full_name, code, minutes: codes.TTL_MINUTES,
      link, linkHours: LINK_TTL_HOURS,
    });
    return { sent: result.sent, reason: result.reason };
  } catch (err) {
    logger.error({ err: err.message, userId: user?.id }, 'verification code not issued');
    return { sent: false, reason: 'error' };
  }
}

/**
 * Checks a code. `{ ok: true, user }` or `{ ok: false, error, remaining? }`.
 *
 * An address with no account and a code that is simply wrong get the same
 * answer, so this cannot be used to test which addresses exist.
 */
async function verify({ emailAddress, code }) {
  const clean = codes.normaliseCode(code);
  if (!clean) return { ok: false, error: 'INVALID_CODE' };

  const { data: user, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, account_types, is_blocked, email_verified_at')
    .eq('email', String(emailAddress || '').trim().toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!user || user.is_blocked) return { ok: false, error: 'INVALID_CODE' };
  if (user.email_verified_at) return { ok: false, error: 'ALREADY_VERIFIED', user };

  const { data, error: rpcError } = await supabase.rpc('verify_email_code', {
    p_user_id: user.id,
    p_code_hash: codes.hashCode({ userId: user.id, code: clean }),
    p_max_attempts: codes.MAX_ATTEMPTS,
  });
  if (rpcError) throw new Error(rpcError.message);

  if (!data?.ok) {
    return { ok: false, error: data?.error || 'INVALID_CODE', remaining: data?.remaining };
  }
  return { ok: true, user };
}

/**
 * The link from the email. `{ ok: true, user }` or `{ ok: false, error, user? }`.
 *
 * The token is the whole credential, so there is no email to match against and
 * no attempt counter: 256 random bits are not guessed, and a wrong token finds
 * no row at all.
 */
async function activateByLink({ token }) {
  const raw = String(token || '').trim();
  // randomToken(32) is 43 base64url characters; anything wildly different is
  // not one of ours and is not worth a database round trip.
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(raw)) return { ok: false, error: 'INVALID_TOKEN' };

  const { data, error } = await supabase.rpc('activate_email_link', { p_token_hash: hashToken(raw) });
  if (error) throw new Error(error.message);

  const userId = data?.user_id || null;
  let user = null;
  if (userId) {
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, account_types, is_blocked, signup_intent')
      .eq('id', userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    user = profile;
  }

  if (!data?.ok) return { ok: false, error: data?.error || 'INVALID_TOKEN', user };
  // Activated, but a suspended account still does not get a session.
  if (!user || user.is_blocked) return { ok: false, error: 'ACCOUNT_BANNED', user: null };
  return { ok: true, user };
}

module.exports = { issue, verify, activateByLink, LINK_TTL_HOURS };
