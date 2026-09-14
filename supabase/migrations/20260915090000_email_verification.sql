-- ═══════════════════════════════════════════════════════════════════════════
-- Email verification by one-time code.
--
-- `profiles.email_verified_at` has existed since identity moved into this
-- application, and nothing ever set it for a password sign-up. So any address
-- could be registered by anyone — including someone else's — and tickets,
-- receipts and organizer mail went to whatever was typed.
--
-- A NEW password account now confirms its address with a 6-digit code before it
-- can sign in. Codes are stored as an HMAC keyed with a server secret, never as
-- the code: six digits is a million possibilities, so a plain hash in a leaked
-- table would be reversed in seconds.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  -- Wrong guesses against THIS code. At the limit the code dies and a new one
  -- has to be sent, so a code cannot be walked through a million values.
  attempts    INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx
  ON email_verifications (user_id, created_at DESC);

ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_verifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON email_verifications TO service_role;

-- ─── Nobody already here is locked out ─────────────────────────────────────
-- Every account that exists today was created before verification existed and
-- has been signing in normally. They are treated as verified, from the moment
-- they were created, rather than being stopped at their next sign-in by a rule
-- they never agreed to.
UPDATE profiles
   SET email_verified_at = COALESCE(created_at, now())
 WHERE email_verified_at IS NULL;

-- ─── Checking a code, in one statement ─────────────────────────────────────
-- The attempt counter and the comparison happen under one row lock. A read in
-- the API followed by a write would let a burst of parallel guesses all read
-- `attempts = 0` and each get a free try.
CREATE OR REPLACE FUNCTION verify_email_code(
  p_user_id      UUID,
  p_code_hash    TEXT,
  p_max_attempts INT DEFAULT 5
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT * INTO v
    FROM email_verifications
   WHERE user_id = p_user_id AND consumed_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND OR v.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_EXPIRED');
  END IF;

  IF v.code_hash <> p_code_hash THEN
    UPDATE email_verifications
       SET attempts = attempts + 1,
           consumed_at = CASE WHEN attempts + 1 >= p_max_attempts THEN now() ELSE NULL END
     WHERE id = v.id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', CASE WHEN v.attempts + 1 >= p_max_attempts THEN 'CODE_EXPIRED' ELSE 'INVALID_CODE' END,
      'remaining', GREATEST(p_max_attempts - v.attempts - 1, 0)
    );
  END IF;

  UPDATE email_verifications SET consumed_at = now() WHERE id = v.id;
  UPDATE profiles
     SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION verify_email_code(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_email_code(UUID, TEXT, INT) TO service_role;
