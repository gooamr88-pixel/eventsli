-- ═══════════════════════════════════════════════════════════════════════════
-- A cash sale at the door could not be recorded.
--
-- `buyer_identified` required user_id OR guest_email on every order. That is
-- right for an online sale — the ticket has to REACH someone, and an email is
-- the only channel we have. It is wrong for a walk-up: someone pays cash, is
-- handed a ticket on the spot, and has no reason to give an address. The
-- constraint refused the most ordinary transaction at a door.
--
-- Relaxed per channel rather than dropped:
--
--   stripe → user_id or guest_email, unchanged. We must be able to deliver.
--   manual → a NAME is enough. The organizer handed the ticket over in person
--            and holds the relationship; a name is what makes the row mean
--            something on their own list.
--
-- The trade is real and worth naming: a manual buyer with no email cannot
-- retrieve a lost ticket through us, and any refund conversation is with the
-- organizer anyway (BRD §09). The organizer can still record an email when they
-- have one, and should be encouraged to.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders DROP CONSTRAINT IF EXISTS buyer_identified;

ALTER TABLE orders ADD CONSTRAINT buyer_identified CHECK (
  CASE channel
    WHEN 'manual' THEN
      user_id IS NOT NULL
      OR guest_email IS NOT NULL
      OR NULLIF(btrim(guest_name), '') IS NOT NULL
    ELSE
      user_id IS NOT NULL OR guest_email IS NOT NULL
  END
);

COMMENT ON CONSTRAINT buyer_identified ON orders IS
  'An order must identify its buyer. Online needs a deliverable address; a door sale needs only a name, because the ticket was handed over in person.';
