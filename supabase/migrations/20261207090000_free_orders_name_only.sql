-- ═══════════════════════════════════════════════════════════════════════════
-- Free tickets on a name alone (owner, 2026-11-22: "Name only").
--
-- A free claim answers with the tickets themselves, so the buyer has them on
-- the screen the moment they book; an email is now optional and, when given,
-- is where a copy goes. Three rules insisted on an email and are relaxed for
-- that case only:
--
--   orders.buyer_identified   'free' joins 'manual': a NAME identifies it.
--                             Card and offline orders are unchanged — we must
--                             be able to deliver what was paid for.
--   terms_acceptances         may be tied to the reservation instead.
--   purchase_signatures.email nullable; the signature then names its signer.
--
-- The trade, named as 20260830030000 named it for door sales: a free buyer
-- who gave no email cannot ask us to resend a lost ticket. They were shown
-- the tickets, and told to save them.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders DROP CONSTRAINT IF EXISTS buyer_identified;

ALTER TABLE orders ADD CONSTRAINT buyer_identified CHECK (
  CASE
    WHEN channel IN ('manual', 'free') THEN
      user_id IS NOT NULL
      OR guest_email IS NOT NULL
      OR NULLIF(btrim(guest_name), '') IS NOT NULL
    ELSE
      user_id IS NOT NULL OR guest_email IS NOT NULL
  END
);

COMMENT ON CONSTRAINT buyer_identified ON orders IS
  'An order must identify its buyer. Paid online needs a deliverable address; a door sale or a free claim needs only a name, because the tickets were handed over on the spot.';

ALTER TABLE terms_acceptances DROP CONSTRAINT IF EXISTS terms_acceptance_identifies_someone;
ALTER TABLE terms_acceptances
  ADD CONSTRAINT terms_acceptance_identifies_someone
  CHECK (user_id IS NOT NULL OR email IS NOT NULL OR reservation_id IS NOT NULL);

ALTER TABLE purchase_signatures ALTER COLUMN email DROP NOT NULL;
ALTER TABLE purchase_signatures DROP CONSTRAINT IF EXISTS purchase_signature_identifies_signer;
ALTER TABLE purchase_signatures
  ADD CONSTRAINT purchase_signature_identifies_signer
  CHECK (user_id IS NOT NULL OR email IS NOT NULL OR NULLIF(btrim(signer_name), '') IS NOT NULL);
