const { supabase } = require('../config/supabase');
const { hashIp } = require('../utils/crypto');
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
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Sends a fresh code, and kills every earlier one.
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
    const { error } = await supabase.from('email_verifications').insert({
      user_id: user.id,
      code_hash: codes.hashCode({ userId: user.id, code }),
      expires_at: new Date(Date.now() + codes.TTL_MINUTES * 60_000).toISOString(),
      ip_hash: req ? hashIp(req.ip) : null,
    });
    if (error) {
      // A code we cannot store is a code that cannot work; sending it anyway
      // would have somebody typing a number that is refused.
      logger.error({ err: error.message, userId: user.id }, 'could not store a verification code');
      return { sent: false, reason: 'store_failed' };
    }

    const result = await email.sendVerificationCode({
      to: user.email, name: user.full_name, code, minutes: codes.TTL_MINUTES,
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
    .select('id, email, full_name, role, is_blocked, email_verified_at')
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

module.exports = { issue, verify };
