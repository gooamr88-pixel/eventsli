-- ═══════════════════════════════════════════════════════════════════════════
-- THE ORGANIZER IS TOLD WHEN TICKETS SELL (2026-11-23).
--
-- The owner: "the organizer must get an email when tickets are bought —
-- professionally". Until now an organizer learned of a sale only by opening
-- the dashboard (offline reservations aside).
--
--   organizers.sale_email_mode          each  — an email for every order (default)
--                                       daily — one summary a day, at 8 am in the
--                                               zone of their latest event
--                                       off   — no sale emails
--   organizers.sale_email_owner         the account owner's own address receives them
--   organizers.sale_email_recipients    up to five more addresses (a partner, a
--                                       box office, a shared inbox)
--   organizers.sale_digest_last_at      when the last daily summary went out
--   orders.organizer_notified_at        this order's sale email went out (once)
--
-- Door sales are not emailed: the organizer's own team rang them up.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE organizers ADD COLUMN IF NOT EXISTS sale_email_mode TEXT NOT NULL DEFAULT 'each';
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS sale_email_owner BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS sale_email_recipients TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS sale_digest_last_at TIMESTAMPTZ;

ALTER TABLE organizers DROP CONSTRAINT IF EXISTS organizers_sale_email_mode_kind;
ALTER TABLE organizers ADD CONSTRAINT organizers_sale_email_mode_kind
  CHECK (sale_email_mode IN ('each', 'daily', 'off'));
ALTER TABLE organizers DROP CONSTRAINT IF EXISTS organizers_sale_email_recipients_bounded;
ALTER TABLE organizers ADD CONSTRAINT organizers_sale_email_recipients_bounded
  CHECK (cardinality(sale_email_recipients) <= 5);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS organizer_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN organizers.sale_email_mode IS 'Sale emails: each (every order), daily (a summary at 8 am), off. services/saleNoticeService.js.';
COMMENT ON COLUMN organizers.sale_email_recipients IS 'Extra addresses for sale emails, beyond the owner (at most five).';
COMMENT ON COLUMN orders.organizer_notified_at IS 'The organizer was emailed about this sale (claimed once, so never twice).';

NOTIFY pgrst, 'reload schema';
