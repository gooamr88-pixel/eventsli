-- ═══════════════════════════════════════════════════════════════════════════
-- A buyer refreshing the checkout page was told their own code was used up.
--
-- The max-uses check counted every redemption for the code — including the one
-- THIS reservation already held. So re-applying a single-use code to the same
-- hold, which is what a page refresh or a double-click does, compared 1 against
-- a limit of 1 and answered "that code has been fully used".
--
-- The ON CONFLICT below was written specifically to make re-applying harmless,
-- and the count above it made sure the statement was never reached. The fix is
-- to exclude the caller's own claim: a hold cannot use a code twice, so its own
-- row is not competition.
-- ═══════════════════════════════════════════════════════════════════════════

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
     AND (event_id = p_event_id OR event_id IS NULL)
   FOR UPDATE;

  IF v_promo IS NULL OR NOT v_promo.is_active THEN
    -- One answer for "no such code" and "disabled": telling them apart lets
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
    SELECT count(*) INTO v_used
      FROM promo_redemptions
     WHERE promo_id = v_promo.id
       -- This hold's own claim is not competition for itself. Counting it means
       -- a refresh of the checkout page reports the buyer's own code exhausted.
       AND reservation_id IS DISTINCT FROM p_reservation_id;

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

  -- Never more than the order: a negative total is a refund nobody authorised.
  v_discount := LEAST(GREATEST(v_discount, 0), p_subtotal_cents);

  INSERT INTO promo_redemptions (promo_id, reservation_id, amount_cents)
  VALUES (v_promo.id, p_reservation_id, v_discount)
  ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL
  DO UPDATE SET promo_id = EXCLUDED.promo_id, amount_cents = EXCLUDED.amount_cents;

  UPDATE reservations SET promo_id = v_promo.id WHERE id = p_reservation_id;

  UPDATE promo_codes
     SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo.id)
   WHERE id = v_promo.id;

  RETURN jsonb_build_object('ok', true, 'promo_id', v_promo.id,
    'code', v_promo.code, 'discount_cents', v_discount,
    'discount_type', v_promo.discount_type, 'discount_value', v_promo.discount_value);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
