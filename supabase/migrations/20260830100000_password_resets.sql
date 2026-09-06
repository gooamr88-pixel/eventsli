-- ═══════════════════════════════════════════════════════════════════════════
-- Password reset.
--
-- Owed since identity moved out of Supabase Auth. Until now, anyone who forgot
-- their password was locked out permanently — there was no path back into the
-- account at all.
--
-- The token is stored ONLY as its SHA-256 digest. A reset token is a bearer
-- credential: whoever holds it can take the account. Storing the digest means a
-- leaked database cannot be used to reset anyone's password. No salt and no
-- stretching, deliberately — unlike a password the input already carries 256
-- bits of entropy, so there is nothing to guess and a slow hash would only make
-- every verification slower.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The digest, never the token.
  token_hash  TEXT NOT NULL UNIQUE,

  -- Short. A reset link sits in an inbox, and an inbox is exactly what an
  -- attacker who already has some access will go looking through.
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,

  -- For the "someone requested a reset from this location" line in the email,
  -- and for spotting a spray across many accounts. Hashed like every other IP.
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);
CREATE INDEX password_resets_live_idx ON password_resets (expires_at)
  WHERE used_at IS NULL;

/**
 * Requesting a new reset invalidates the outstanding ones.
 *
 * Otherwise every request leaves another live key to the account lying in the
 * inbox, and someone who clicks "forgot password" five times has five working
 * links — four of which they will never think about again.
 */
CREATE OR REPLACE FUNCTION invalidate_password_resets(p_user_id UUID)
RETURNS INT AS $$
DECLARE v_n INT;
BEGIN
  UPDATE password_resets SET used_at = now()
   WHERE user_id = p_user_id AND used_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * Spends a token and changes the password, in one transaction.
 *
 * The single-use check is in the WHERE clause, not a read followed by a write:
 * two requests arriving together would both pass a read-then-check, and the
 * second would reset the password a second time — which matters if an attacker
 * is racing the real owner with a stolen link.
 */
CREATE OR REPLACE FUNCTION consume_password_reset(
  p_token_hash TEXT,
  p_new_hash   TEXT
) RETURNS JSONB AS $$
DECLARE
  v_reset RECORD;
  v_n     INT;
BEGIN
  UPDATE password_resets
     SET used_at = now()
   WHERE token_hash = p_token_hash
     AND used_at IS NULL
     AND expires_at > now()
  RETURNING user_id INTO v_reset;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    -- One answer for expired, already used, and never existed. Distinguishing
    -- them tells someone holding a stale link whether it was ever real.
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN',
      'message', 'That reset link is no longer valid. Request a new one.');
  END IF;

  UPDATE profiles
     SET password_hash = p_new_hash,
         password_updated_at = now(),
         -- A reset is what someone does when they are locked out, sometimes
         -- BECAUSE of the failed attempts. Clearing the lock is the point.
         failed_login_count = 0,
         locked_until = NULL
   WHERE id = v_reset.user_id;

  -- Every other live session dies. A reset is what you do after a scare, and it
  -- has to actually evict whoever you are worried about.
  UPDATE sessions
     SET revoked_at = now(), revoked_reason = 'password_reset'
   WHERE user_id = v_reset.user_id AND revoked_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'user_id', v_reset.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON TABLE password_resets IS
  'Reset tokens, stored as SHA-256 digests only. A leaked database cannot be used to take an account.';
