-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT AN ACCOUNT IS FOR — buying tickets, running events, or both.
--
-- THIS IS NOT A PERMISSION, and the separation is the whole point of the
-- column. `profiles.role` is the authorization ladder — attendee < organizer <
-- admin < super_admin — and it is the ONLY thing `rbacService` and every
-- `requireRole` guard read. Nothing in this migration touches it.
--
-- `account_types` is a product fact: which surfaces this person signed up for
-- and uses. It decides where they land after signing in and which parts of the
-- interface are offered. Granting somebody 'organizer' here gives them exactly
-- one thing: the organizer dashboard is where they arrive. It does not let them
-- publish an event, take a payment, or read another organizer's orders — all of
-- that still runs through `role`, which is granted server-side when an
-- organizer PROFILE is created and never from anything a browser sends.
--
-- Conflating the two is the bug this shape exists to prevent: an `accountType`
-- field posted by a sign-up form must never be able to widen what an account
-- can do.
--
-- WHY A SET AND NOT A SECOND ENUM. Somebody who sells tickets also buys them.
-- A single "type" column forces that person to be miscategorised the day they
-- become both, and the usual repair — a third enum value, 'buyer_and_organizer'
-- — turns every read into a three-way branch that grows with the product. A set
-- answers "is this account an organizer?" the same way whether or not it is
-- also a buyer, and adding a future surface is a new element, not a new column
-- and not a migration of the existing rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The column ────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_types TEXT[] NOT NULL DEFAULT ARRAY['buyer']::TEXT[];

-- A CHECK cannot contain a subquery, and "no duplicates" needs one to express.
-- The way round it is an IMMUTABLE function: the restriction is on the CHECK
-- expression, not on what a function it calls does internally.
CREATE OR REPLACE FUNCTION account_types_distinct(t TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT cardinality(t) = (SELECT count(DISTINCT x) FROM unnest(t) AS x);
$$;

-- Constrained in the database, not only in the API. The API is the only writer
-- today; this is what keeps that true if a script, a console session or a
-- second service ever writes here.
--
-- Three separate claims, deliberately, so a violation says which one broke:
--   · every element is a type this product actually has
--   · the set is never empty — an account with no surface has nowhere to land
--   · no duplicates, so `account_types` compares and counts as a set
--
-- `cardinality`, NOT `array_length`. `array_length('{}', 1)` is NULL, and a
-- CHECK that evaluates to NULL PASSES — so the obvious spelling of "not empty"
-- is one that lets an empty array straight through. `cardinality` returns 0.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_types_known'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_account_types_known
      CHECK (account_types <@ ARRAY['buyer', 'organizer']::TEXT[]);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_types_present'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_account_types_present
      CHECK (cardinality(account_types) >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_types_distinct'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_account_types_distinct
      CHECK (account_types_distinct(account_types));
  END IF;
END $$;

-- Answering "is this an organizer account" without a sequential scan once the
-- table is large. GIN is the index type for array containment.
CREATE INDEX IF NOT EXISTS profiles_account_types_idx
  ON profiles USING GIN (account_types);

-- ─── Nobody already here is misfiled ───────────────────────────────────────
-- Every account predates this column, so the set is derived from what the
-- database already knows rather than defaulted and left wrong:
--
--   · an organizer PROFILE exists            → they run events, beyond doubt
--   · role is organizer or above             → the ladder already says so
--   · signup_intent = 'organizer'            → they asked for it at sign-up,
--                                              even if setup was never finished
--
-- 'buyer' is added to everyone, including organizers. It is true of every
-- account — anyone can buy a ticket — and it is what makes "both" the ordinary
-- state rather than a special case the code has to discover later.
--
-- Written as one statement per shape so re-running is harmless.
UPDATE profiles p
   SET account_types = ARRAY['buyer', 'organizer']::TEXT[]
 WHERE NOT ('organizer' = ANY (p.account_types))
   AND (
     -- `owner_user_id`, not `id`: an organizer row has its own UUID primary
     -- key and points AT the profile. Joining on `id` would match nothing and
     -- quietly leave every existing organizer filed as a buyer.
     EXISTS (SELECT 1 FROM organizers o WHERE o.owner_user_id = p.id)
     OR p.role IN ('organizer', 'admin', 'super_admin')
     OR p.signup_intent = 'organizer'
   );

UPDATE profiles
   SET account_types = ARRAY['buyer']::TEXT[]
 WHERE account_types IS NULL
    OR cardinality(account_types) = 0;

-- ─── Becoming an organizer adds the surface, it does not replace it ─────────
-- Creating an organizer profile is the moment somebody becomes one, and it is
-- the same moment `role` is raised to 'organizer' in organizerController. The
-- API does that write; this trigger does the set, so the two cannot come apart
-- because a future code path forgot one of them.
--
-- ADDITIVE on purpose: a buyer who starts selling is now both, and their
-- tickets do not stop being theirs.
CREATE OR REPLACE FUNCTION add_organizer_account_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NEW.owner_user_id, not NEW.id — an organizer row's own primary key is a
  -- fresh UUID, and the profile it belongs to is the column it references.
  UPDATE profiles
     SET account_types = array_append(account_types, 'organizer')
   WHERE id = NEW.owner_user_id
     AND NOT ('organizer' = ANY (account_types));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS organizers_grant_account_type ON organizers;
CREATE TRIGGER organizers_grant_account_type
  AFTER INSERT ON organizers
  FOR EACH ROW
  EXECUTE FUNCTION add_organizer_account_type();

-- ─── Reachable only by the API ─────────────────────────────────────────────
-- `20260914090000_lock_down_api_roles.sql` revokes every table from PUBLIC,
-- anon and authenticated, enables RLS and grants service_role. A new column on
-- an existing table inherits that, and `profiles` carries no policy at all — so
-- no browser-held key can read or write this, with or without a session.
-- Repeated here because a column that decides where somebody lands is exactly
-- the kind a later migration might casually expose.
REVOKE ALL ON FUNCTION add_organizer_account_type() FROM PUBLIC, anon, authenticated;
-- The CHECK helper stays callable, because a constraint evaluates it as the
-- writing role and a revoke here would refuse every INSERT into profiles.
GRANT EXECUTE ON FUNCTION account_types_distinct(TEXT[]) TO service_role;

COMMENT ON COLUMN profiles.account_types IS
  'Product surfaces this account uses (buyer, organizer). NOT a permission — '
  'authorization is profiles.role and rbacService alone.';
