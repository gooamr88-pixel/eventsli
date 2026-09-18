const { supabase } = require('../config/supabase');
const { randomToken, hashToken, hashIp, hashPassword } = require('../utils/crypto');
const email = require('./emailService');
const T = require('./emailTemplates');
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

  /**
   * ON THE SHARED TEMPLATE, like every other message.
   *
   * This one built its own HTML, and had done since before the brand moved
   * from emerald to blue — so it arrived with a GREEN heading, a GREEN button
   * and no logo at all, while the other twelve were blue and branded. It is
   * also the email somebody receives when they are already anxious about their
   * account, which is the worst possible one to look unlike the product.
   *
   * A second copy of the markup is how that happened, so there is no longer a
   * second copy: `emailTemplates` owns the masthead, the button and the
   * footer, and this file owns only the words.
   */
  return email.send({
    to: user.email,
    subject: 'Reset your Eventsli password',
    html: T.layout({
      title: 'Reset your password',
      preheader: `The link works once and expires in ${TTL_MINUTES} minutes.`,
      reason: 'You are receiving this because a password reset was requested for this address on Eventsli.',
      body: `
        ${T.p(`Hi ${T.escapeHtml(user.full_name || 'there')},`)}
        ${T.p(`Use the button below to choose a new password. It works <strong>once</strong> and expires in ${TTL_MINUTES} minutes.`)}
        ${T.button(url, 'Choose a new password')}
        ${T.note('info', `
          <strong>If you did not ask for this,</strong> you can ignore it — your password has not
          changed, and the link stops working on its own.`)}
        ${T.p(`If the button does not open, paste this into your browser:<br><span style="word-break:break-all">${T.escapeHtml(url)}</span>`, { small: true, color: T.MUTED })}`,
    }),
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
