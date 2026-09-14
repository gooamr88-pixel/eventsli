-- ═══════════════════════════════════════════════════════════════════════════
-- BRD §21 — the buyer accepts the terms before buying. Guests included.
--
-- terms_acceptances.user_id was NOT NULL, and guest checkout is a first-class
-- path. So every guest acceptance failed its insert — and the checkout
-- controller caught the error, logged a warning and took the payment anyway.
-- The rule read as enforced and was recorded for nobody without an account.
--
-- A guest is identified the way their order is: by email. The reservation is
-- kept too, so an acceptance can be tied to the exact checkout it preceded.
-- Purely additive: a column made nullable, two columns added, one CHECK that
-- every existing row already satisfies (they all have a user_id).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE terms_acceptances ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE terms_acceptances ADD COLUMN IF NOT EXISTS email CITEXT;

ALTER TABLE terms_acceptances
  ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL;

-- An acceptance nobody can be identified by is not a record of anything.
ALTER TABLE terms_acceptances
  ADD CONSTRAINT terms_acceptance_identifies_someone
  CHECK (user_id IS NOT NULL OR email IS NOT NULL);

CREATE INDEX IF NOT EXISTS terms_acceptances_reservation_idx
  ON terms_acceptances (reservation_id) WHERE reservation_id IS NOT NULL;
