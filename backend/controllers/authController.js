const { supabase } = require('../config/supabase');
const { hashPassword, verifyPassword } = require('../utils/crypto');
const sessions = require('../services/sessionService');
const rbac = require('../services/rbacService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const verification = require('../services/emailVerificationService');
const accessTokens = require('../services/accessTokens');
const logger = require('../utils/logger');

/**
 * After this many consecutive failures the account is frozen for a while.
 *
 * This sits ALONGSIDE the IP rate limiter, not instead of it. The limiter is
 * keyed by address, and an attacker with a botnet simply spreads attempts
 * across thousands of them; this counter follows the account and does not care
 * where the attempts came from.
 */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

/**
 * ONE message for every credential failure.
 *
 * Not politeness — anti-enumeration. "No account with that email" tells an
 * attacker which addresses are worth attacking, and it tells anyone who can
 * type an email address which of their acquaintances have accounts here.
 */
const CREDENTIALS_REJECTED = 'That email or password is not right.';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE SOMEBODY LANDS AFTER PROVING WHO THEY ARE — one rule, one place.
 *
 * `landingFor` reads the account's TYPES, never its role: an organizer account
 * opens on the dashboard, a buyer's on their tickets, and an account that is
 * both opens on the dashboard. `utils/accountTypes.js` holds the rule and
 * argues why type and permission are separate things.
 *
 * It used to live in three places that disagreed. `activate` sent an organizer
 * sign-up to /organizer and everybody else to the storefront; sign-in had no
 * opinion at all and fell through to the frontend's default; the six-digit code
 * returned nothing for the client to act on. The same person landed somewhere
 * different depending on which way in they happened to use.
 *
 * `?next=` STILL WINS, and has to: it is what carries somebody back to the
 * checkout, the event or the ticket they were bounced off. This is only the
 * answer when nothing else was asked for, and the client applies that order.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { landingFor, fromSignupChoice, normalise: normaliseTypes } = require('../utils/accountTypes');

/** The account fields every "who is this" response shares. */
function shapeIdentity(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    // The authorization ladder. Reported so the client can show an admin link;
    // never derived from anything the client sent.
    role: user.role,
    // What the account is FOR. Sent so the interface can offer the right
    // surfaces — and deliberately separate from `role` above.
    accountTypes: normaliseTypes(user.account_types),
    next: landingFor(user),
  };
}

// ─── POST /auth/register ────────────────────────────────────────────────────
/**
 * `accountType: 'organizer'` is the organizer sign-up: the organization name and
 * a phone number are required, and so is agreeing to the terms and the privacy
 * policy (the route validates all of it). It does NOT make them an organizer —
 * that still happens on the setup step, where the country that decides their
 * Stripe entity is asked. What it records is the intent, so activation lands
 * them on the organizer dashboard rather than the storefront.
 */
async function register(req, res, next) {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const { password, fullName, phone } = req.body;
    const asOrganizer = req.body.accountType === 'organizer';
    const now = new Date().toISOString();

    const password_hash = await hashPassword(password);

    const { data, error } = await supabase
      .from('profiles')
      .insert({
        email,
        full_name: String(fullName).trim(),
        phone: phone ? String(phone).trim() : null,
        password_hash,
        password_updated_at: now,
        /**
         * ROLE IS NOT WHAT THE FORM ASKED FOR, and this is the line that stops
         * a sign-up from escalating itself. `accountType` is a posted string;
         * if it reached `role`, anybody could POST `"organizer"` and be granted
         * the permission ladder that goes with it. It reaches `account_types`
         * below instead, which decides which screen they open on and nothing
         * else. The role is raised to 'organizer' server-side, once, when an
         * organizer PROFILE is created — see organizerController.
         */
        role: 'attendee',
        // The immutable record of what they asked for on the day. Kept beside
        // `account_types`, which is the mutable current answer — they diverge
        // the moment a buyer starts selling, and both facts are worth having.
        signup_intent: asOrganizer ? 'organizer' : 'attendee',
        // Derived from the choice, never copied from it: `fromSignupChoice`
        // maps an arbitrary string onto the two values the CHECK constraint
        // allows, so a body that says `"admin"` stores a buyer.
        account_types: fromSignupChoice(req.body.accountType),
        ...(asOrganizer ? {
          organization_name: String(req.body.organizationName).trim(),
          // Validated `=== true` by the route; the timestamps are the record.
          terms_accepted_at: now,
          privacy_accepted_at: now,
        } : {}),
      })
      .select('id, email, full_name, role, account_types')
      .single();

    if (error) {
      // 23505 = unique violation on email. Answered with 409 and a message that
      // does not confirm the address — the honest alternative, silently
      // succeeding, would let someone lock a stranger out of signing up.
      if (error.code === '23505') {
        return sendFail(res, {
          status: 409, error: 'CONFLICT',
          message: 'That email is already registered. Try signing in instead.',
        });
      }
      throw new Error(error.message);
    }

    // NO SESSION YET. The address has to be confirmed first — otherwise anyone
    // can sign up as anyone, and tickets and receipts go to whatever was typed.
    // The code is sent without holding up the response; `issue` never throws.
    verification.issue({ user: data, req });

    return sendOk(res, {
      ...shapeIdentity(data),
      // No session yet, so `next` is where they WILL land once the address is
      // confirmed — the waiting screen shows it, and the verify step re-reads
      // it from the server rather than trusting this copy.
      verificationRequired: true,
      accountType: asOrganizer ? 'organizer' : 'attendee',
      // How the tab that submitted this form finds out when the address is
      // confirmed somewhere else — see `verificationStatus` below.
      watchToken: accessTokens.issueVerifyWatchToken(data.id),
    }, { status: 201 });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/verify-email ────────────────────────────────────────────────
/**
 * The code from the email. On success the account is confirmed AND signed in:
 * the person has just proved both the password (at sign-up or sign-in) and the
 * inbox, and making them type the password again straight after is friction
 * that buys nothing.
 */
async function verifyEmail(req, res, next) {
  try {
    const result = await verification.verify({ emailAddress: req.body.email, code: req.body.code });

    if (result.error === 'ALREADY_VERIFIED') {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: 'This email is already confirmed. Sign in instead.',
      });
    }
    if (!result.ok) {
      const expired = result.error === 'CODE_EXPIRED';
      return sendFail(res, {
        status: ERROR_STATUS[result.error] || 400,
        error: result.error,
        message: expired
          ? 'That code has expired. Send yourself a new one.'
          : `That code is not right.${result.remaining ? ` ${result.remaining} ${result.remaining === 1 ? 'try' : 'tries'} left.` : ''}`,
        ...(result.remaining !== undefined ? { meta: { remaining: result.remaining } } : {}),
      });
    }

    const { user } = result;
    rbac.invalidate(user.id);
    await supabase.from('profiles')
      .update({ last_login_at: new Date().toISOString(), failed_login_count: 0, locked_until: null })
      .eq('id', user.id);
    await sessions.issue(res, { userId: user.id, email: user.email, role: user.role, req });

    // `next`, which this did not return at all — so confirming by CODE fell
    // through to the client default while confirming by LINK was told where to
    // go. Both now read the one rule.
    return sendOk(res, shapeIdentity(user));
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/activate ────────────────────────────────────────────────────
/**
 * The activation link. Like the code, a success confirms the address AND signs
 * the person in — the link proves the inbox as much as the code does.
 *
 * `next` says where they belong: an organizer sign-up goes to the organizer
 * dashboard, where setup starts; anyone else goes home.
 *
 * Clicking twice is not an error to the person doing it: they are told the
 * account is active and sent to sign in — without a session, because a used
 * link must not keep minting them.
 */
async function activate(req, res, next) {
  try {
    const result = await verification.activateByLink({ token: req.body.token });

    if (result.error === 'ALREADY_VERIFIED') {
      return sendFail(res, {
        status: 409, error: 'ALREADY_VERIFIED',
        message: 'This account is already active. Sign in to continue.',
        meta: { next: landingFor(result.user) },
      });
    }
    if (!result.ok) {
      const banned = result.error === 'ACCOUNT_BANNED';
      return sendFail(res, {
        status: banned ? 403 : 400,
        error: result.error,
        message: banned
          ? 'This account has been suspended. Contact support if you think that is a mistake.'
          : result.error === 'TOKEN_EXPIRED'
            ? 'This activation link has expired or was replaced by a newer one.'
            : 'This activation link is not valid.',
      });
    }

    const { user } = result;
    rbac.invalidate(user.id);
    await supabase.from('profiles')
      .update({ last_login_at: new Date().toISOString(), failed_login_count: 0, locked_until: null })
      .eq('id', user.id);
    await sessions.issue(res, { userId: user.id, email: user.email, role: user.role, req });

    return sendOk(res, shapeIdentity(user));
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/resend-verification ─────────────────────────────────────────
/**
 * ALWAYS the same answer, like forgot-password — whether the address exists,
 * is already confirmed, or is inside the one-minute cooldown.
 */
async function resendVerification(req, res, next) {
  try {
    const { data: user } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_blocked, email_verified_at')
      .eq('email', String(req.body.email).trim().toLowerCase())
      .maybeSingle();

    if (user && !user.is_blocked && !user.email_verified_at) verification.issue({ user, req });

    return sendOk(res, {
      sent: true,
      message: 'If that email is waiting to be confirmed, a new code is on its way.',
      cooldownSeconds: 60,
    });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/verification-status ─────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "HAS IT BEEN CONFIRMED YET?" — asked by the tab that is waiting.
 *
 * THE BUG THIS EXISTS FOR. Somebody signs up on a laptop and opens the email on
 * their phone, which is what most people do. The phone taps the activation
 * link, the phone is signed in — and the laptop sits on "Check your inbox,
 * open the email, tap Activate" for as long as they leave it there. Nothing
 * ever told it. The person is left looking at a screen instructing them to do
 * a thing they have already done, on a device that has no way to find out.
 *
 * SO THE WAITING TAB ASKS, and when the answer is yes it is signed in too and
 * sent where it was going.
 *
 * WHY SIGNING IT IN IS SOUND. The watch token was handed to the browser that
 * submitted the sign-up (or a sign-in with the right password against an
 * unconfirmed address) — never emailed, never derivable from an address. It
 * answers "not yet" until somebody with the INBOX confirms the account. So the
 * pair of facts behind the session here is exactly the pair behind every other
 * one: this browser knew the password, and somebody proved the inbox.
 *
 * It grants nothing an attacker did not already have either: an account
 * registered against a stranger's address is one the registrant can already
 * sign into with their own password the moment that stranger clicks the link.
 *
 * THE TOKEN IS NOT A SESSION. It carries a user id and a purpose, expires in
 * 30 minutes, and is refused by every other endpoint — `readVerifyWatchToken`
 * checks `typ`, which is what stops it being replayed as an order key or a
 * reservation key, and stops those being replayed as this.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function verificationStatus(req, res, next) {
  try {
    const userId = accessTokens.readVerifyWatchToken(req.body.watchToken);
    // Expired, forged, or the wrong kind of token: one answer for all three.
    // Telling them apart says whether the token was ever real.
    if (!userId) return sendOk(res, { verified: false });

    const { data: user, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, account_types, is_blocked, email_verified_at, signup_intent')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!user || !user.email_verified_at) return sendOk(res, { verified: false });
    // Confirmed but suspended since: the address is fine, the account is not,
    // and a session must not be minted for it. Reported as verified so the
    // waiting page stops waiting and sends them to sign in, where the block is
    // explained properly.
    if (user.is_blocked) return sendOk(res, { verified: true, signedIn: false });

    rbac.invalidate(user.id);
    await supabase.from('profiles')
      .update({ last_login_at: new Date().toISOString(), failed_login_count: 0, locked_until: null })
      .eq('id', user.id);
    await sessions.issue(res, { userId: user.id, email: user.email, role: user.role, req });

    return sendOk(res, {
      verified: true,
      signedIn: true,
      user: shapeIdentity(user),
      next: landingFor(user),
    });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/login ───────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const { password } = req.body;

    const { data: user, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, account_types, password_hash, is_blocked, failed_login_count, locked_until, email_verified_at')
      .eq('email', email)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!user) {
      // Hash anyway, against a throwaway value. Without this, a missing account
      // returns in ~1ms while a real one takes ~200ms of PBKDF2, and the timing
      // difference is a working account-enumeration oracle.
      await verifyPassword(password, 'pbkdf2$210000$AAAA$AAAA');
      return sendFail(res, { status: 401, error: 'UNAUTHENTICATED', message: CREDENTIALS_REJECTED });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutes = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return sendFail(res, {
        status: 429, error: 'RATE_LIMITED',
        message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      });
    }

    if (user.is_blocked) {
      return sendFail(res, {
        status: 403, error: 'ACCOUNT_BANNED',
        message: 'This account has been suspended. Contact support if you think that is a mistake.',
      });
    }

    const { ok, needsRehash } = await verifyPassword(password, user.password_hash);

    if (!ok) {
      const failed = (user.failed_login_count || 0) + 1;
      const lock = failed >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
        : null;
      await supabase
        .from('profiles')
        .update({ failed_login_count: failed, ...(lock ? { locked_until: lock } : {}) })
        .eq('id', user.id);

      if (lock) logger.warn({ userId: user.id }, 'account locked after repeated failed logins');
      return sendFail(res, { status: 401, error: 'UNAUTHENTICATED', message: CREDENTIALS_REJECTED });
    }

    // The right password on an address that was never confirmed. Checked AFTER
    // the password, so this answer is only ever given to someone who already
    // proved they know it — it cannot be used to learn which addresses exist.
    if (!user.email_verified_at) {
      await supabase.from('profiles')
        .update({ failed_login_count: 0, locked_until: null })
        .eq('id', user.id);
      verification.issue({ user, req });
      return sendFail(res, {
        status: 403, error: 'EMAIL_NOT_VERIFIED',
        message: 'Confirm your email to finish signing in. We have sent you a code.',
        /**
         * A watch token is safe to hand out HERE, and only here and at sign-up,
         * because both are answers to somebody who has just proved they know
         * the password. `resendVerification` deliberately does not issue one:
         * it answers identically for every address by design, so minting a
         * token there would hand anybody a watcher on a stranger's account —
         * and a session the moment that stranger confirmed their own email.
         */
        meta: { email: user.email, watchToken: accessTokens.issueVerifyWatchToken(user.id) },
      });
    }

    // Success: clear the counter, and quietly upgrade the hash if the cost has
    // been raised since this password was set.
    const patch = {
      failed_login_count: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    };
    if (needsRehash) {
      patch.password_hash = await hashPassword(password);
      patch.password_updated_at = new Date().toISOString();
    }
    await supabase.from('profiles').update(patch).eq('id', user.id);

    await sessions.issue(res, {
      userId: user.id, email: user.email, role: user.role, req,
    });

    return sendOk(res, shapeIdentity(user));
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/logout ──────────────────────────────────────────────────────
async function logout(req, res, next) {
  try {
    // Revoke server-side FIRST. Clearing the cookie alone leaves a token that is
    // still valid to anyone who captured it.
    await sessions.revoke(req.user.jti, 'logout');
    sessions.clearCookie(res);
    return sendOk(res, { loggedOut: true });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/logout-all ──────────────────────────────────────────────────
async function logoutAll(req, res, next) {
  try {
    const count = await sessions.revokeAllForUser(req.user.id, 'logout_all');
    sessions.clearCookie(res);
    return sendOk(res, { loggedOut: true, sessionsEnded: count });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /auth/me ───────────────────────────────────────────────────────────
async function me(req, res) {
  const a = req.user.access;
  return sendOk(res, {
    id: a.userId,
    email: a.email,
    fullName: a.fullName,
    role: a.role,
    // What the account is FOR, beside what it MAY DO. `isOrganizer` below is
    // the permission fact — it is true only once an organizer profile exists —
    // while `accountTypes` can contain 'organizer' before that, which is
    // exactly the state of somebody who signed up to sell and has not finished
    // setting up. The shell needs both: one to route, one to authorize.
    accountTypes: a.accountTypes,
    next: landingFor({ account_types: a.accountTypes }),
    isOrganizer: a.isOrganizer,
    organizerId: a.organizerId,
    canReceivePayouts: a.canReceivePayouts,
    isAdmin: a.isAdmin,
    isSuperAdmin: a.isSuperAdmin,
  });
}

// ─── GET /auth/sessions ─────────────────────────────────────────────────────
async function listSessions(req, res, next) {
  try {
    const rows = await sessions.listForUser(req.user.id);
    return sendOk(res, rows.map((s) => ({
      id: s.jti,
      current: s.jti === req.user.jti,
      issuedAt: s.issued_at,
      expiresAt: s.expires_at,
      lastSeenAt: s.last_seen_at,
      device: s.user_agent,
    })));
  } catch (err) {
    return next(err);
  }
}

// ─── DELETE /auth/sessions/:jti ─────────────────────────────────────────────
async function endSession(req, res, next) {
  try {
    const { jti } = req.params;
    // Scoped to the caller's own sessions: without the ownership check this
    // endpoint would let anyone sign anyone else out by guessing a uuid.
    const owned = (await sessions.listForUser(req.user.id)).some((s) => s.jti === jti);
    if (!owned) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such session.' });
    }
    await sessions.revoke(jti, 'ended_by_user');
    if (jti === req.user.jti) sessions.clearCookie(res);
    return sendOk(res, { ended: jti });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/change-password ─────────────────────────────────────────────
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    const { data: user } = await supabase
      .from('profiles').select('password_hash').eq('id', req.user.id).single();

    const { ok } = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) {
      return sendFail(res, {
        status: 401, error: 'UNAUTHENTICATED', message: 'Your current password is not right.',
      });
    }

    await supabase
      .from('profiles')
      .update({
        password_hash: await hashPassword(newPassword),
        password_updated_at: new Date().toISOString(),
      })
      .eq('id', req.user.id);

    // Every other session dies. A password change is what someone does after a
    // scare, and it has to actually evict whoever they are worried about — then
    // a fresh session so the person who just changed it is not logged out.
    await sessions.revokeAllForUser(req.user.id, 'password_changed');
    rbac.invalidate(req.user.id);
    await sessions.issue(res, {
      userId: req.user.id, email: req.user.email, role: req.user.role, req,
    });

    return sendOk(res, { passwordChanged: true, otherSessionsEnded: true });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/forgot-password ─────────────────────────────────────────────
/**
 * ALWAYS answers the same, whether or not the address has an account.
 *
 * A different response for an unknown address turns this into a directory:
 * type an email, learn whether that person has an account here. The work
 * happens either way; only the sending differs.
 */
async function forgotPassword(req, res, next) {
  try {
    const reset = require('../services/passwordResetService');
    const result = await reset.request({ emailAddress: req.body.email, req });

    if (result.token) {
      // The reset link must point at OUR frontend, never at whatever origin the
      // request claimed — that would let someone mail a victim a link to their
      // own page wearing our domain.
      const allowed = String(process.env.FRONTEND_URL || '')
        .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
      const claimed = String(req.headers.origin || '').replace(/\/$/, '');
      const origin = allowed.includes(claimed) ? claimed : allowed[0] || 'http://localhost:3000';

      // Not awaited into the response: the reply must not take longer when the
      // account exists, or the timing itself answers the question.
      reset.sendResetEmail({ user: result.user, token: result.token, origin })
        .catch((e) => logger.error({ err: e.message }, 'reset email failed'));
    }

    return sendOk(res, {
      sent: true,
      message: 'If that email has an account, a reset link is on its way.',
    });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /auth/reset-password ──────────────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const reset = require('../services/passwordResetService');
    await reset.complete({ token: req.body.token, newPassword: req.body.password });

    // No session is issued here on purpose. Signing someone in straight off a
    // link that arrived by email means a stolen link is a session; making them
    // log in with the password they just chose proves they know it.
    return sendOk(res, {
      reset: true,
      message: 'Your password has been changed. Sign in with your new password.',
    });
  } catch (err) {
    if (err.code) {
      return sendFail(res, {
        status: err.code === 'INVALID_TOKEN' ? 400 : 409,
        error: err.code, message: err.message,
      });
    }
    return next(err);
  }
}

// ─── POST /auth/google ──────────────────────────────────────────────────────
/**
 * Google establishes WHO they are. We still mint our own session — the same
 * httpOnly cookie a password login produces, backed by the same revocable
 * `sessions` row. Google does not become a second session system.
 */
async function googleSignIn(req, res, next) {
  try {
    const google = require('../services/googleAuthService');

    if (!google.configured()) {
      return sendFail(res, {
        status: 503, error: 'FEATURE_DISABLED',
        message: 'Google sign-in is not available.',
      });
    }

    const profile = await google.verifyIdToken(req.body.idToken);
    const { user, created } = await google.findOrCreate(profile);

    await supabase.from('profiles')
      .update({ last_login_at: new Date().toISOString(), failed_login_count: 0, locked_until: null })
      .eq('id', user.id);

    await sessions.issue(res, {
      userId: user.id, email: user.email, role: user.role, req,
    });

    return sendOk(res, {
      ...shapeIdentity(user),
      newAccount: created,
    }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err.code) {
      const status = { INVALID_TOKEN: 401, ACCOUNT_BANNED: 403, FEATURE_DISABLED: 503 }[err.code] || 400;
      return sendFail(res, { status, error: err.code, message: err.message });
    }
    return next(err);
  }
}

module.exports = {
  register, verifyEmail, activate, resendVerification, verificationStatus,
  login, logout, logoutAll, me,
  listSessions, endSession, changePassword,
  forgotPassword, resetPassword, googleSignIn,
  MAX_FAILED_LOGINS, LOCKOUT_MINUTES,
};
