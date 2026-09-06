const { supabase } = require('../config/supabase');
const { randomToken, hashToken, hashIp, hashPassword } = require('../utils/crypto');
const email = require('./emailService');
const rbac = require('./rbacService');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Getting back into an account.
 *
 * THE ANSWER IS ALWAYS THE SAME. Requesting a reset for an address that has no
 * account returns exactly what a real one returns — same status, same message,
 * and as close to the same timing as we can manage. Anything else turns this
 * endpoint into a directory: type an address, learn whether that person has an
 * account here. That is worth something to an attacker and worth something to
 * anyone curious about a colleague.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// An hour. The link sits in an inbox, and an inbox is exactly what someone who
// already has partial access will go looking through.
const TTL_MINUTES = 60;

/**
 * @returns {Promise<{token?: string}>} — the token ONLY when a real account
 *   matched, for the caller to email. Never returned to the requester.
 */
async function request({ emailAddress, req }) {
  const normalised = String(emailAddress || '').trim().toLowerCase();

  const { data: user } = await supabase
    .from('profiles')
    .select('id, email, full_name, is_blocked')
    .eq('email', normalised)
    .maybeSingle();

  // No account, or a suspended one. The caller cannot tell the difference from
  // the outside, and neither can anyone probing.
  if (!user || user.is_blocked) {
    logger.info({ hit: false }, 'password reset requested');
    return {};
  }

  // Every outstanding link for this account stops working. Otherwise clicking
  // "forgot password" five times leaves five live keys in an inbox, four of
  // which nobody will think about again.
  await supabase.rpc('invalidate_password_resets', { p_user_id: user.id });

  const token = randomToken(32);
  const { error } = await supabase.from('password_resets').insert({
    user_id: user.id,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + TTL_MINUTES * 60_000).toISOString(),
    ip_hash: req ? hashIp(req.ip) : null,
  });

  if (error) {
    // Fail closed: without a stored row the token would be unusable anyway, and
    // sending a link that cannot work is worse than sending nothing.
    logger.error({ err: error.message }, 'could not store a password reset');
    return {};
  }

  logger.info({ userId: user.id }, 'password reset issued');
  return { token, user };
}

/** Builds the link and sends it. Separate so the token never crosses a boundary twice. */
async function sendResetEmail({ user, token, origin }) {
  const url = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

  return email.send({
    to: user.email,
    subject: 'Reset your Eventsli password',
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0E1613">
  <h1 style="font-size:20px;margin:0 0 20px;color:#047857">Reset your password</h1>
  <p>Hi ${email.escapeHtml(user.full_name || 'there')},</p>
  <p>Use the link below to choose a new password. It works once and expires in ${TTL_MINUTES} minutes.</p>
  <p style="margin:24px 0">
    <a href="${url}" style="background:#047857;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">
      Choose a new password
    </a>
  </p>
  <p style="font-size:13px;color:#5E6D66">
    If you did not ask for this, you can ignore it — your password has not changed,
    and this link stops working on its own.
  </p>
  <p style="font-size:12px;color:#8A9791;word-break:break-all">${url}</p>
</div>`,
  });
}

/**
 * Spends the token and sets the new password.
 *
 * The single-use check lives in the SQL, in the same statement that marks the
 * token spent — a read-then-write here would let two requests with the same
 * stolen link both succeed.
 */
async function complete({ token, newPassword }) {
  const { data, error } = await supabase.rpc('consume_password_reset', {
    p_token_hash: hashToken(String(token || '')),
    p_new_hash: await hashPassword(newPassword),
  });

  if (error) {
    logger.error({ err: error.message }, 'password reset failed');
    throw Object.assign(new Error('That reset could not be completed.'), { code: 'CONFLICT' });
  }
  if (!data?.ok) {
    throw Object.assign(new Error(data?.message || 'That reset link is no longer valid.'),
      { code: data?.error || 'INVALID_TOKEN' });
  }

  // The role and ban flags are cached for a few seconds; the sessions this just
  // revoked would otherwise keep resolving from a stale context.
  rbac.invalidate(data.user_id);
  return { userId: data.user_id };
}

module.exports = { request, sendResetEmail, complete, TTL_MINUTES };
