-- ═══════════════════════════════════════════════════════════════════════════
-- Ticket type details: what a buyer reads about a ticket type before buying it
-- (owner request 2026-11-10, with a mockup of a "VIP Table Experience" card).
--
-- One JSONB column rather than four tables, because nothing queries inside it:
-- it is written whole by the organizer's form and read whole by the buyer's
-- page. Its shape is owned by `backend/services/ticketDetails.js`, which cleans
-- every write and re-derives the photo's URL from its path on every read, so a
-- client can never put a URL of its choosing on the public page.
--
--   {
--     "tagline":   "A premium, all-inclusive dining experience",
--     "image":     { "path": "events/<event>/tier-<hex>.jpg" },
--     "included":  [{ "icon": "dinner", "title": "A luxurious dinner", "text": "…" }],
--     "notes":     [{ "icon": "tag", "text": "All tickets are final sale." }],
--     "priceUnit": "person" | "ticket" | "table" | "group",
--     "showBeforeBuying": true
--   }
--
-- NOTHING IN THE MONEY PATH READS IT. It is presentation: the same rule the
-- tier's `kind` follows, for the same reason (a price that depended on a label
-- would change when the label did).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ticket_tiers
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ticket_tiers DROP CONSTRAINT IF EXISTS tier_details_is_object;
ALTER TABLE ticket_tiers DROP CONSTRAINT IF EXISTS tier_details_size;

ALTER TABLE ticket_tiers
  ADD CONSTRAINT tier_details_is_object CHECK (jsonb_typeof(details) = 'object'),
  -- The service caps every field well under this; the constraint is the floor
  -- for any other writer, so a public payload cannot be inflated through it.
  ADD CONSTRAINT tier_details_size CHECK (octet_length(details::text) <= 16384);
