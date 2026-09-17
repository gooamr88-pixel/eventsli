-- ═══════════════════════════════════════════════════════════════════════════
-- The organizer experience, end to end:
--
--   sign up as an organizer → activate by email LINK → set up the organization
--   → set up payment methods → create an event → archive it or ask Eventsli to
--   cancel it.
--
-- Everything here is additive. No existing column changes meaning, and every
-- existing event keeps selling exactly as it did (`accepts_stripe` defaults on).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Signing up as an organizer ────────────────────────────────────────────
-- What the person told us at sign-up, before an organizer row can exist. The
-- organizer row needs a country (it decides the Stripe entity), which is asked
-- on the setup step rather than on the sign-up form — so the organization name
-- waits here and pre-fills that step.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS signup_intent        TEXT CHECK (signup_intent IN ('attendee', 'organizer')),
  ADD COLUMN IF NOT EXISTS organization_name    TEXT CHECK (char_length(organization_name) <= 160),
  ADD COLUMN IF NOT EXISTS terms_accepted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at  TIMESTAMPTZ;

-- ─── Activation by link ────────────────────────────────────────────────────
-- The same email now carries a link as well as the six digits. The link token
-- is 256 random bits, so a plain SHA-256 is safe to store (unlike the code,
-- which is HMAC'd — see emailCodes.js). It lives longer than the code: a code is
-- typed while the email is open, a link is often clicked the next morning.
ALTER TABLE email_verifications
  ADD COLUMN IF NOT EXISTS link_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS link_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS email_verifications_link_token_idx
  ON email_verifications (link_token_hash) WHERE link_token_hash IS NOT NULL;

-- One statement, under a row lock, like verify_email_code: two tabs opening the
-- same link must not both succeed.
CREATE OR REPLACE FUNCTION activate_email_link(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_verified TIMESTAMPTZ;
BEGIN
  SELECT * INTO v
    FROM email_verifications
   WHERE link_token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  END IF;

  SELECT email_verified_at INTO v_verified FROM profiles WHERE id = v.user_id;
  IF v_verified IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_VERIFIED', 'user_id', v.user_id);
  END IF;

  IF v.consumed_at IS NOT NULL OR v.link_expires_at IS NULL OR v.link_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOKEN_EXPIRED');
  END IF;

  UPDATE email_verifications SET consumed_at = now() WHERE id = v.id;
  UPDATE profiles
     SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
   WHERE id = v.user_id;

  RETURN jsonb_build_object('ok', true, 'user_id', v.user_id);
END;
$$;

REVOKE ALL ON FUNCTION activate_email_link(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_email_link(TEXT) TO service_role;

-- ─── The organization ──────────────────────────────────────────────────────
-- `display_name` stays what buyers see (the BRAND). `legal_name` is the
-- organization behind it. Setup is complete when both, a description and the
-- policy acceptance exist — derived, not a flag that can disagree with them.
ALTER TABLE organizers
  ADD COLUMN IF NOT EXISTS legal_name            TEXT CHECK (char_length(legal_name) <= 160),
  ADD COLUMN IF NOT EXISTS description           TEXT CHECK (char_length(description) <= 2000),
  ADD COLUMN IF NOT EXISTS policies_accepted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── Manual payment methods ────────────────────────────────────────────────
-- Ways an organizer takes money outside Stripe: an Interac e-Transfer address,
-- bank details, cash. The instructions are what a buyer is shown.
CREATE TABLE IF NOT EXISTS organizer_payment_methods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('e_transfer', 'bank_transfer', 'cash', 'other')),
  label         TEXT NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  instructions  TEXT NOT NULL CHECK (char_length(instructions) BETWEEN 5 AND 1000),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organizer_payment_methods_org_idx
  ON organizer_payment_methods (organizer_id, created_at);

ALTER TABLE organizer_payment_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organizer_payment_methods FROM PUBLIC, anon, authenticated;
GRANT ALL ON organizer_payment_methods TO service_role;

-- ─── Per event: which of those this event takes, and archiving ─────────────
-- Existing events were all card events; they stay that way.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS accepts_stripe  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accepts_manual  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ,
  -- Where a restore returns it to. Kept, not guessed: a draft restored as
  -- "published" would skip review.
  ADD COLUMN IF NOT EXISTS archived_from   event_status;

-- A listing sells nothing, so it takes no payments.
UPDATE events SET accepts_stripe = false, accepts_manual = false
 WHERE listing_type = 'display_only' AND (accepts_stripe OR accepts_manual);

-- ─── Cancellation requests ─────────────────────────────────────────────────
-- BRD §17 stands: only an admin cancels. The organizer ASKS, with a reason, and
-- a super admin approves (which cancels the event) or rejects (with a note the
-- organizer sees).
CREATE TABLE IF NOT EXISTS event_cancellation_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organizer_id  UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  requested_by  UUID NOT NULL REFERENCES profiles(id),
  reason        TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 2000),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decision_note TEXT CHECK (char_length(decision_note) <= 2000),
  decided_by    UUID REFERENCES profiles(id),
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open request per event. A second click, or a second tab, is refused by
-- the database rather than by hoping the API checked first.
CREATE UNIQUE INDEX IF NOT EXISTS event_cancellation_one_pending
  ON event_cancellation_requests (event_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS event_cancellation_requests_status_idx
  ON event_cancellation_requests (status, created_at);

ALTER TABLE event_cancellation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_cancellation_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON event_cancellation_requests TO service_role;
