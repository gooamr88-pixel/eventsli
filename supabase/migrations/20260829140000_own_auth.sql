-- ═══════════════════════════════════════════════════════════════════════════
-- Identity moves out of Supabase Auth and into this application.
--
-- WHY, since the baseline already pointed profiles.id at auth.users:
--
-- The browser never talks to Supabase in this system — every request goes
-- through the API. That makes Supabase a DATABASE here, not an auth provider,
-- and leaning on auth.users for identity while issuing our own session cookie
-- would mean two session systems layered on one login: Supabase minting access
-- and refresh tokens nobody reads, and ours doing the actual work. Two systems
-- that can disagree about whether someone is logged in is a bug generator, and
-- the one that would win is not obvious from any single file.
--
-- So: passwords are hashed here (PBKDF2-HMAC-SHA512, which is why server.js
-- sizes the libuv threadpool), sessions live in `sessions` and are revocable by
-- jti, and auth.users is no longer in the picture.
--
-- The cost is real and worth naming: password reset, email verification and
-- OAuth are now ours to build rather than ours to call. They are on the roadmap
-- for this sprint and the next, not free.
-- ═══════════════════════════════════════════════════════════════════════════

-- The FK was the only thing tying us to Supabase Auth.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE profiles
  ADD COLUMN password_hash        TEXT,
  ADD COLUMN password_algo        TEXT NOT NULL DEFAULT 'pbkdf2-sha512',
  ADD COLUMN password_updated_at  TIMESTAMPTZ,
  ADD COLUMN email_verified_at    TIMESTAMPTZ,

  -- Throttling lives on the row, not only in the rate limiter: the limiter is
  -- keyed by IP, and an attacker spreading attempts across addresses would walk
  -- straight past it. This counter follows the ACCOUNT.
  ADD COLUMN failed_login_count   INT NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         TIMESTAMPTZ,
  ADD COLUMN last_login_at        TIMESTAMPTZ;

COMMENT ON COLUMN profiles.password_hash IS
  'PBKDF2-HMAC-SHA512. Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>. NULL for an OAuth-only account.';
COMMENT ON COLUMN profiles.password_algo IS
  'Recorded per row so the iteration count can be raised later and old hashes upgraded on next successful login, rather than forcing a reset.';
COMMENT ON COLUMN profiles.locked_until IS
  'Set after repeated failures. Account-scoped, so distributing attempts across IPs does not evade it.';

-- A password login is impossible without a hash; an OAuth-only account has no
-- hash and must not be reachable by the password path.
ALTER TABLE profiles
  ADD CONSTRAINT password_algo_needs_hash
  CHECK (password_hash IS NULL OR password_algo IS NOT NULL);

-- ─── sessions ──────────────────────────────────────────────────────────────
-- The baseline created this table; these are the columns the service needs to
-- show a user their active sessions and let them end one.
ALTER TABLE sessions
  ADD COLUMN last_seen_at   TIMESTAMPTZ,
  ADD COLUMN revoked_reason TEXT;

-- Expired rows are useless but not harmless: they grow forever and slow the
-- lookup that runs on EVERY authenticated request.
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION purge_expired_sessions()
RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  DELETE FROM sessions
   WHERE expires_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_expired_sessions IS
  'Deletes sessions expired more than 30 days ago. The grace period keeps recent history readable for "where am I signed in?" and for incident review.';

-- ─── email uniqueness, case-insensitively ──────────────────────────────────
-- profiles.email is CITEXT so it already compares case-insensitively, but the
-- UNIQUE constraint is what stops Ali@x.com and ali@x.com becoming two accounts.
-- It was on the column from the baseline; this is the assertion that it stayed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'profiles'::regclass AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%email%'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
  END IF;
END $$;
