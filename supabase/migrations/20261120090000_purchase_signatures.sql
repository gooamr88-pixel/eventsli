-- ═══════════════════════════════════════════════════════════════════════════
-- The buyer SIGNS before paying (owner request 2026-11-15).
--
-- The checkout's three agreements (terms, no refunds, entry rules) end in a
-- "Draw your signature" step, as the owner's reference does. A signature is
-- evidence, so it is kept the way evidence should be:
--
--   strokes   the pen as drawn: the points in a fixed 1000-wide box, so the
--             same signature reads the same on any screen. For a TYPED
--             signature (the keyboard alternative) this is NULL and
--             `typed_name` holds what was typed.
--   svg       the picture, rendered ONCE by the server from the strokes. It is
--             built from numbers alone (or escaped text), never from markup
--             the browser sent.
--   sha256    of the canonical strokes / typed name, so a later change to the
--             row is detectable.
--
-- Tied to the terms acceptance it seals, the reservation it preceded and the
-- event; the order is found through `orders.reservation_id`. An order whose
-- checkout started more than once (a retry, a second tab) has more than one
-- row — the honest record — and the latest is the one shown.
--
-- Private: service role only. The API decides who may see one (the buyer's
-- organizer, an admin), never a direct read.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS purchase_signatures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reservation_id      UUID REFERENCES reservations(id) ON DELETE SET NULL,
  terms_acceptance_id UUID REFERENCES terms_acceptances(id) ON DELETE SET NULL,
  user_id             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email               CITEXT NOT NULL,
  signer_name         TEXT,

  method      TEXT NOT NULL,
  strokes     JSONB,
  typed_name  TEXT,
  svg         TEXT NOT NULL,
  sha256      TEXT NOT NULL,

  ip_hash     TEXT,
  user_agent  TEXT,
  signed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT purchase_signature_method_known CHECK (method IN ('drawn', 'typed')),
  -- A drawn signature has its strokes and no typed name; a typed one the reverse.
  CONSTRAINT purchase_signature_has_ink CHECK (
    (method = 'drawn' AND strokes IS NOT NULL AND typed_name IS NULL)
    OR (method = 'typed' AND strokes IS NULL AND length(btrim(typed_name)) > 0)
  ),
  CONSTRAINT purchase_signature_svg_bounded CHECK (length(svg) <= 400000)
);

CREATE INDEX IF NOT EXISTS purchase_signatures_reservation_idx
  ON purchase_signatures (reservation_id, signed_at DESC) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_signatures_event_idx
  ON purchase_signatures (event_id);

ALTER TABLE purchase_signatures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON purchase_signatures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_signatures TO service_role;
