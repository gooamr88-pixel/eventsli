-- ═══════════════════════════════════════════════════════════════════════════
-- Payment fee: automatic or manual — and the invoice due-date floor.
--
-- Decision: BOTH modes exist, and the choice is explicit rather than implied.
--
--   auto   — the system derives the fee that recovers exactly what Stripe bills
--            us for that specific order. The stored pct/fixed are ignored. This
--            is the default, because the correct number is not one a person can
--            hold in their head: Stripe charges its percentage on the FULL buyer
--            total, which includes the tax and the fee itself, so the fee is on
--            both sides of its own equation.
--
--   manual — an admin sets pct and fixed by hand, deliberately. Used to run a
--            promotional rate, to match a competitor's published fee, or to
--            absorb cost on a strategic event. The system never silently
--            "corrects" these numbers; it reports what they actually earn.
--
-- In BOTH modes the platform's real margin is computed and stored per order, so
-- a shortfall shows up in the row that caused it rather than in a monthly total
-- three weeks later.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE payment_fee_mode AS ENUM ('auto', 'manual');

ALTER TABLE events
  ADD COLUMN payment_fee_mode payment_fee_mode NOT NULL DEFAULT 'auto';

COMMENT ON COLUMN events.payment_fee_mode IS
  'auto: fee derived per order to match the real Stripe cost. manual: uses payment_fee_pct/fixed as entered by an admin.';
COMMENT ON COLUMN events.payment_fee_pct IS
  'Used only when payment_fee_mode = manual. Ignored in auto mode.';
COMMENT ON COLUMN events.payment_fee_fixed_cents IS
  'Used only when payment_fee_mode = manual. Per ORDER, not per ticket — it mirrors Stripe''s per-charge fixed cost.';

-- ─── Per-order margin, recorded ────────────────────────────────────────────
-- Without these, "did that sale make money?" can only be answered by
-- recomputing history against today's rates — which gives the wrong answer the
-- moment a rate changes.
ALTER TABLE orders
  ADD COLUMN payment_fee_mode   payment_fee_mode NOT NULL DEFAULT 'auto',
  ADD COLUMN stripe_cost_cents  BIGINT NOT NULL DEFAULT 0 CHECK (stripe_cost_cents >= 0),
  -- May be NEGATIVE: an under-set manual fee means we paid Stripe more than we
  -- collected. That is the number this column exists to make visible.
  ADD COLUMN platform_net_cents BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.stripe_cost_cents IS
  'What Stripe actually billed the platform for this charge.';
COMMENT ON COLUMN orders.platform_net_cents IS
  'application_fee minus stripe_cost. Negative means this order lost money.';

-- ─── Invoice due date ──────────────────────────────────────────────────────
-- The rule is MIN(issued + 7 days, event start - 24h) — but a manual sale made
-- 12 hours before doors open would compute a due date in the PAST, making the
-- invoice overdue at the instant it is issued and locking the scanner for an
-- organizer who was never given a chance to pay. A floor of 2 hours from issue
-- guarantees there is always a payable window.
CREATE OR REPLACE FUNCTION compute_invoice_due_at(
  p_issued_at      TIMESTAMPTZ,
  p_event_start    TIMESTAMPTZ,
  p_due_days       INT DEFAULT 7,
  p_hours_before   INT DEFAULT 24,
  p_min_hours      INT DEFAULT 2
) RETURNS TIMESTAMPTZ AS $$
  SELECT GREATEST(
    p_issued_at + make_interval(hours => p_min_hours),
    LEAST(
      p_issued_at   + make_interval(days  => p_due_days),
      p_event_start - make_interval(hours => p_hours_before)
    )
  );
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION compute_invoice_due_at IS
  'MIN(issued + due_days, event_start - hours_before), floored at issued + min_hours so an invoice is never born overdue.';

-- Applied on insert so the due date is fixed at issue time. Recomputing it on
-- read would silently move a deadline the organizer was already told.
CREATE OR REPLACE FUNCTION set_invoice_due_at()
RETURNS TRIGGER AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_cfg   JSONB;
BEGIN
  IF NEW.due_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT starts_at INTO v_start FROM events WHERE id = NEW.event_id;
  SELECT value INTO v_cfg FROM platform_settings WHERE key = 'manual_invoice';

  NEW.due_at := compute_invoice_due_at(
    NEW.issued_at,
    v_start,
    COALESCE((v_cfg->>'due_days')::INT, 7),
    COALESCE((v_cfg->>'min_hours_before_event')::INT, 24),
    COALESCE((v_cfg->>'min_hours_from_issue')::INT, 2)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- due_at is NOT NULL, so the trigger must run BEFORE the constraint is checked.
ALTER TABLE invoices ALTER COLUMN due_at DROP NOT NULL;

CREATE TRIGGER trg_set_invoice_due_at
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_invoice_due_at();

UPDATE platform_settings
   SET value = value || '{"min_hours_from_issue": 2}'::jsonb
 WHERE key = 'manual_invoice';

UPDATE platform_settings
   SET value = value || '{"default_mode": "auto"}'::jsonb
 WHERE key = 'payment_fee';
