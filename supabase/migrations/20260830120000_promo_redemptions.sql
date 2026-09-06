-- ═══════════════════════════════════════════════════════════════════════════
-- Promo codes: the half that was missing.
--
-- `promo_codes` has existed since the baseline with a `used_count` column and
-- nothing to increment it. A counter with no ledger behind it cannot answer
-- "who used it?", cannot be corrected without guessing, and — worse — cannot be
-- incremented safely: `used_count = used_count + 1` from application code lets
-- two simultaneous checkouts both read 9 of a 10-use code and both write 10.
--
-- The redemption ROW is the truth. The counter is derived from it, and the
-- max-uses check and the insert are the same statement, so the eleventh buyer
-- loses to a unique constraint rather than to a race.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE promo_redemptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id    UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Claimed at HOLD time, before payment: a code has to be reserved while the
  -- buyer is at the checkout screen, or a limited code oversells exactly as a
  -- seat would.
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,

  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email       CITEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX promo_redemptions_promo_idx ON promo_redemptions (promo_id);
-- One claim per hold. Without this a buyer refreshing the checkout page could
-- consume a limited code several times over.
CREATE UNIQUE INDEX promo_redemptions_reservation_uniq
  ON promo_redemptions (reservation_id) WHERE reservation_id IS NOT NULL;

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS promo_id UUID REFERENCES promo_codes(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_id UUID REFERENCES promo_codes(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT;

/**
 * Validates a code and claims one use, atomically.
 *
 * Row-locks the promo, counts live redemptions, and inserts — all inside one
 * transaction. The count is taken UNDER the lock, so two buyers arriving on the
 * last use of a code cannot both see it as available.
 */
CREATE OR REPLACE FUNCTION claim_promo_code(
  p_code           TEXT,
  p_event_id       UUID,
  p_reservation_id UUID,
  p_subtotal_cents BIGINT
) RETURNS JSONB AS $$
DECLARE
  v_promo    RECORD;
  v_used     INT;
  v_discount BIGINT;
BEGIN
  SELECT * INTO v_promo FROM promo_codes
   WHERE upper(code) = upper(btrim(p_code))
     -- A code belongs to one event, or to the whole platform.
     AND (event_id = p_event_id OR event_id IS NULL)
   FOR UPDATE;

  IF v_promo IS NULL OR NOT v_promo.is_active THEN
    -- One answer for "no such code" and "disabled". Telling them apart lets
    -- someone map which codes exist by trying strings.
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code is not valid.');
  END IF;

  IF v_promo.valid_from IS NOT NULL AND v_promo.valid_from > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code is not valid.');
  END IF;
  IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code has expired.');
  END IF;

  IF v_promo.max_uses IS NOT NULL THEN
    -- Counted under the lock taken above. A cached `used_count` read outside it
    -- is exactly how a limited code oversells.
    SELECT count(*) INTO v_used FROM promo_redemptions WHERE promo_id = v_promo.id;
    IF v_used >= v_promo.max_uses THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
        'message', 'That code has been fully used.');
    END IF;
  END IF;

  IF v_promo.discount_type = 'percentage' THEN
    v_discount := round(p_subtotal_cents * v_promo.discount_value / 100.0);
  ELSE
    v_discount := round(v_promo.discount_value * 100);
  END IF;

  -- Never more than the order. A discount larger than the subtotal would make
  -- the total negative, and a negative charge is a refund nobody authorised.
  v_discount := LEAST(GREATEST(v_discount, 0), p_subtotal_cents);

  INSERT INTO promo_redemptions (promo_id, reservation_id, amount_cents)
  VALUES (v_promo.id, p_reservation_id, v_discount)
  ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL
  DO UPDATE SET promo_id = EXCLUDED.promo_id, amount_cents = EXCLUDED.amount_cents;

  UPDATE reservations SET promo_id = v_promo.id WHERE id = p_reservation_id;

  -- Kept in step for reporting, but never read as the authority.
  UPDATE promo_codes
     SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo.id)
   WHERE id = v_promo.id;

  RETURN jsonb_build_object('ok', true, 'promo_id', v_promo.id,
    'code', v_promo.code, 'discount_cents', v_discount,
    'discount_type', v_promo.discount_type, 'discount_value', v_promo.discount_value);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/** Releasing a hold releases its claim, or a limited code leaks a use per abandoned checkout. */
CREATE OR REPLACE FUNCTION release_promo_claim(p_reservation_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_promo UUID;
BEGIN
  DELETE FROM promo_redemptions
   WHERE reservation_id = p_reservation_id AND order_id IS NULL
  RETURNING promo_id INTO v_promo;

  IF v_promo IS NOT NULL THEN
    UPDATE promo_codes
       SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo)
     WHERE id = v_promo;
  END IF;

  UPDATE reservations SET promo_id = NULL WHERE id = p_reservation_id;
  RETURN v_promo IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON TABLE promo_redemptions IS
  'One row per use. The authority for how many times a code has been used; promo_codes.used_count is derived from this and never read as the truth.';
