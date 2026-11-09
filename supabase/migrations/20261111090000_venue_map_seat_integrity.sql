-- ═══════════════════════════════════════════════════════════════════════════
-- Venue map seat integrity (TECH-AUDIT-LOG T-017 and T-086), 2026-11-09.
--
-- 1. T-017: a table booked WHOLE could be grown in the editor. The new seats
--    were `available`, could be sold to someone else, and fulfill_checkout
--    issued the whole-table order by table membership, so one chair got two
--    tickets. save_venue_map now refuses to add seats to a table that has an
--    active or converted whole-table reservation, and fulfill_checkout issues
--    a table's seats only where this reservation holds them.
--
-- 2. T-086: save_venue_map never wrote `tier_id` or `price_override_cents`
--    for an EXISTING table. Assigning a ticket type (or a seat price) to a
--    table after its first save returned 200 and changed nothing. Now applied
--    to the table's available seats; held and sold seats keep what was bought.
--
-- Both functions are the live definitions (20260915120000 and
-- 20261106090000) with only the marked changes. CREATE OR REPLACE keeps their
-- grants. No data is changed.
--
-- DEPLOY ORDER: any. The API does not change shape.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_venue_map(p_event_id uuid, p_layout jsonb, p_tables jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map_id     UUID;
  v_version    INT;
  v_keep       UUID[];
  v_blocked    TEXT[];
  t            JSONB;
  v_table_id   UUID;
  v_prior      RECORD;
  v_count      INT;
  v_label      TEXT;
  v_seats      INT;
  n            INT;
BEGIN
  INSERT INTO venue_maps (event_id, layout_json)
  VALUES (p_event_id, COALESCE(p_layout, '{}'::JSONB))
  ON CONFLICT (event_id) DO UPDATE
    SET layout_json = EXCLUDED.layout_json, updated_at = now()
  RETURNING id, version INTO v_map_id, v_version;

  -- Hold this map's tables for the whole save, in id order — the same order
  -- hold_seats and hold_table take them — so the booked-or-not checks below
  -- cannot be overtaken by a hold or a door sale before the DELETE runs.
  PERFORM 1 FROM tables WHERE venue_map_id = v_map_id ORDER BY id FOR UPDATE;

  SELECT COALESCE(array_agg((e->>'id')::UUID), ARRAY[]::UUID[])
    INTO v_keep
    FROM jsonb_array_elements(p_tables) e
   WHERE e->>'id' IS NOT NULL;

  -- ── Every id must be a table ON THIS MAP ──
  -- Refused before anything is written, and the whole save rolls back.
  SELECT count(*) INTO v_count
    FROM unnest(v_keep) AS k(id)
   WHERE NOT EXISTS (
     SELECT 1 FROM tables tb WHERE tb.id = k.id AND tb.venue_map_id = v_map_id
   );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'MAP_CONFLICT: % of the tables in this save are not on this map — reload the editor and try again',
      v_count;
  END IF;

  -- ── Ticket types and categories must belong to THIS event ──
  SELECT count(*) INTO v_count
    FROM jsonb_array_elements(p_tables) e
   WHERE NULLIF(e->>'tierId', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM ticket_tiers tt
        WHERE tt.id = (e->>'tierId')::UUID AND tt.event_id = p_event_id
     );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'MAP_INVALID: a ticket type on this map belongs to a different event';
  END IF;

  SELECT count(*) INTO v_count
    FROM jsonb_array_elements(p_tables) e
   WHERE NULLIF(e->>'categoryId', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM table_categories tc
        WHERE tc.id = (e->>'categoryId')::UUID AND tc.event_id = p_event_id
     );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'MAP_INVALID: a table category on this map belongs to a different event';
  END IF;

  -- ── Refuse before touching the tables ──
  -- Collected as a list rather than failing on the first one, so the organizer
  -- is told about every blocked table at once instead of discovering them one
  -- save at a time.
  SELECT COALESCE(array_agg(label ORDER BY label), ARRAY[]::TEXT[])
    INTO v_blocked
    FROM tables
   WHERE venue_map_id = v_map_id
     AND NOT (id = ANY(v_keep))
     AND status <> 'available';

  IF array_length(v_blocked, 1) > 0 THEN
    RAISE EXCEPTION 'MAP_CONFLICT: these tables have been booked and cannot be removed: %',
      array_to_string(v_blocked, ', ');
  END IF;

  DELETE FROM seats  WHERE table_id IN (
    SELECT id FROM tables WHERE venue_map_id = v_map_id AND NOT (id = ANY(v_keep)));
  DELETE FROM tables WHERE venue_map_id = v_map_id AND NOT (id = ANY(v_keep));

  -- ── Create or update each table ──
  FOR t IN SELECT * FROM jsonb_array_elements(p_tables)
  LOOP
    v_label := btrim(t->>'label');
    v_seats := (t->>'seatCount')::INT;

    IF t->>'id' IS NULL THEN
      INSERT INTO tables (
        venue_map_id, label, seat_count, price_cents, is_private, password_hash,
        position_x, position_y, rotation, shape, category_id
      ) VALUES (
        v_map_id, v_label, v_seats,
        NULLIF(t->>'priceCents', '')::BIGINT,
        COALESCE((t->>'isPrivate')::BOOLEAN, false),
        NULLIF(t->>'passwordHash', ''),
        COALESCE((t#>>'{position,x}')::NUMERIC, 0),
        COALESCE((t#>>'{position,y}')::NUMERIC, 0),
        COALESCE((t#>>'{position,rotation}')::NUMERIC, 0),
        COALESCE(t->>'shape', 'round'),
        NULLIF(t->>'categoryId', '')::UUID
      ) RETURNING id INTO v_table_id;

      FOR n IN 1..v_seats LOOP
        INSERT INTO seats (venue_map_id, table_id, tier_id, section_key, row_label,
                           seat_number, price_override_cents)
        VALUES (v_map_id, v_table_id, NULLIF(t->>'tierId', '')::UUID, v_label, 'A',
                n::TEXT, NULLIF(t->>'seatPriceCents', '')::BIGINT);
      END LOOP;

    ELSE
      v_table_id := (t->>'id')::UUID;
      -- Scoped to this map. Checked above as well; repeated here so the row
      -- this loop rewrites can never be one the check did not cover.
      SELECT seat_count INTO v_prior
        FROM tables WHERE id = v_table_id AND venue_map_id = v_map_id;

      IF v_prior IS NULL THEN
        RAISE EXCEPTION 'MAP_CONFLICT: table % is no longer on this map', v_label;
      END IF;

      -- Shrinking: check the SEATS individually, not the table's summary
      -- status. A table can read `available` while one specific seat is held,
      -- if the hold landed between the two reads.
      IF v_prior.seat_count > v_seats THEN
        SELECT count(*) INTO v_count
          FROM seats
         WHERE table_id = v_table_id
           AND seat_number::INT > v_seats
           AND status <> 'available';

        IF v_count > 0 THEN
          RAISE EXCEPTION 'MAP_CONFLICT: "%" cannot be made smaller: % of the seats being removed have been booked',
            v_label, v_count;
        END IF;

        DELETE FROM seats
         WHERE table_id = v_table_id AND seat_number::INT > v_seats
           AND status = 'available';

      ELSIF v_prior.seat_count < v_seats THEN
        -- T-017. A table booked WHOLE is one item on its reservation, and the
        -- order is issued for the table's seats. A seat added now is
        -- `available`, so it could be sold to someone else as well — two
        -- tickets for one chair. Growing a table whose seats were sold one
        -- by one is still fine: those orders name their seats.
        IF EXISTS (
          SELECT 1 FROM reservation_items ri
            JOIN reservations r ON r.id = ri.reservation_id
           WHERE ri.table_id = v_table_id AND r.state IN ('active', 'converted')
        ) THEN
          RAISE EXCEPTION 'MAP_CONFLICT: "%" has been booked as a whole table, so seats cannot be added to it',
            v_label;
        END IF;

        FOR n IN (v_prior.seat_count + 1)..v_seats LOOP
          INSERT INTO seats (venue_map_id, table_id, tier_id, section_key, row_label,
                             seat_number, price_override_cents)
          VALUES (v_map_id, v_table_id, NULLIF(t->>'tierId', '')::UUID, v_label, 'A',
                  n::TEXT, NULLIF(t->>'seatPriceCents', '')::BIGINT);
        END LOOP;
      END IF;

      UPDATE tables SET
        label = v_label,
        seat_count = v_seats,
        price_cents = NULLIF(t->>'priceCents', '')::BIGINT,
        is_private = COALESCE((t->>'isPrivate')::BOOLEAN, false),
        -- The hash is rewritten ONLY when a new password was actually typed.
        -- Sending the editor's state back without one must not silently
        -- unprotect a table. `clearPassword` is the explicit way to remove it.
        password_hash = CASE
          WHEN COALESCE((t->>'clearPassword')::BOOLEAN, false) THEN NULL
          WHEN NULLIF(t->>'passwordHash', '') IS NOT NULL THEN t->>'passwordHash'
          ELSE password_hash
        END,
        position_x = COALESCE((t#>>'{position,x}')::NUMERIC, 0),
        position_y = COALESCE((t#>>'{position,y}')::NUMERIC, 0),
        rotation = COALESCE((t#>>'{position,rotation}')::NUMERIC, 0),
        shape = COALESCE(t->>'shape', 'round'),
        category_id = NULLIF(t->>'categoryId', '')::UUID
      WHERE id = v_table_id AND venue_map_id = v_map_id;

      -- Section keys follow the label, or a renamed table's seats keep the old
      -- name and the (map, section, row, number) uniqueness stops matching what
      -- the buyer is shown.
      UPDATE seats SET section_key = v_label WHERE table_id = v_table_id;

      -- The ticket type and seat price, which this branch never wrote: only a
      -- NEW table's seats got them, so assigning a ticket type to a table
      -- after its first save was accepted and silently ignored, and its seats
      -- stayed unpriced ("not on sale yet") or at the old price. Available
      -- seats only — a held or sold seat keeps the type it was bought as.
      UPDATE seats
         SET tier_id = NULLIF(t->>'tierId', '')::UUID,
             price_override_cents = NULLIF(t->>'seatPriceCents', '')::BIGINT
       WHERE table_id = v_table_id
         AND status = 'available'
         AND (tier_id IS DISTINCT FROM NULLIF(t->>'tierId', '')::UUID
              OR price_override_cents IS DISTINCT FROM NULLIF(t->>'seatPriceCents', '')::BIGINT);
    END IF;
  END LOOP;

  UPDATE venue_maps
     SET version = v_version + 1, updated_at = now()
   WHERE id = v_map_id;

  SELECT count(*) INTO v_count FROM tables WHERE venue_map_id = v_map_id;

  RETURN jsonb_build_object('ok', true, 'map_id', v_map_id,
    'tables', v_count, 'version', v_version + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION fulfill_checkout(p_reservation_id uuid, p_channel payment_channel, p_breakdown jsonb, p_buyer jsonb, p_stripe jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res RECORD; v_event RECORD; v_order_id UUID; v_existing UUID;
  v_currency CHAR(3); v_seat_ids UUID[]; v_table_ids UUID[];
  v_tickets INT := 0; v_general INT := 0; v_key TEXT;
  v_promo_id UUID; v_promo_code TEXT;
  -- COALESCE, never a bare comparison: a breakdown with no chargeModel — every
  -- call from the release running before this one — compares to NULL, and
  -- `IF NOT NULL` is not true, so the legacy payment_fee and transfer rows were
  -- silently skipped (caught by the T-076 rehearsal test, 2026-11-06).
  v_direct BOOLEAN := COALESCE((p_breakdown->>'chargeModel') = 'direct', false);
  v_account TEXT := NULLIF(p_stripe->>'account_id', '');
  v_org_account TEXT;
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_NOT_FOUND',
      'message', 'That reservation no longer exists.');
  END IF;

  IF v_res.state = 'converted' THEN
    SELECT id INTO v_existing FROM orders WHERE reservation_id = p_reservation_id LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'already_fulfilled', true, 'order_id', v_existing);
  END IF;

  IF v_res.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_EXPIRED',
      'message', 'That hold had already been released when the payment arrived.',
      'state', v_res.state);
  END IF;

  SELECT id, organizer_id, currency, fee_bearer, payment_fee_mode, status
    INTO v_event FROM events WHERE id = v_res.event_id;

  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false,
      'error', CASE v_event.status
                 WHEN 'cancelled' THEN 'EVENT_CANCELLED'
                 WHEN 'suspended' THEN 'EVENT_SUSPENDED'
                 ELSE 'EVENT_NOT_PUBLISHED'
               END,
      'message', 'This event is no longer on sale, so the payment did not issue tickets. It needs review.',
      'event_status', v_event.status);
  END IF;

  -- DIRECT: the money was collected on a connected account. It must be THIS
  -- event's organizer's account — otherwise one organizer's charge could issue
  -- tickets for another organizer's event (organizer isolation).
  IF v_direct THEN
    SELECT stripe_account_id INTO v_org_account FROM organizers WHERE id = v_event.organizer_id;
    IF v_account IS NULL OR v_org_account IS NULL OR v_account <> v_org_account THEN
      RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN',
        'message', 'That payment was not collected on this event organizer''s account.');
    END IF;
  END IF;

  v_currency := v_event.currency;

  SELECT pr.promo_id, pc.code INTO v_promo_id, v_promo_code
    FROM promo_redemptions pr
    JOIN promo_codes pc ON pc.id = pr.promo_id
   WHERE pr.reservation_id = p_reservation_id;

  INSERT INTO orders (
    event_id, organizer_id, user_id, reservation_id, channel, status, currency,
    quantity, subtotal_cents, discount_cents, event_tax_cents,
    commission_cents, commission_tax_cents, payment_fee_cents, fee_bearer,
    buyer_total_cents, organizer_net_cents,
    payment_fee_mode, stripe_cost_cents, platform_net_cents,
    guest_name, guest_email, guest_phone,
    stripe_session_id, stripe_payment_intent_id, paid_at,
    promo_id, promo_code,
    charge_model, stripe_account_id                                    -- DIRECT
  ) VALUES (
    v_res.event_id, v_event.organizer_id,
    NULLIF(p_buyer->>'user_id', '')::UUID,
    p_reservation_id, p_channel, 'paid', v_currency,
    (p_breakdown->>'quantity')::INT,
    (p_breakdown->>'subtotalCents')::BIGINT,
    COALESCE((p_breakdown->>'discountCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'eventTaxCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'paymentFeeCents')::BIGINT, 0),
    (p_breakdown->>'feeBearer')::fee_bearer,
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    (p_breakdown->>'organizerNetCents')::BIGINT,
    v_event.payment_fee_mode,
    COALESCE((p_breakdown->>'stripeCostCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'platformNetCents')::BIGINT, 0),
    p_buyer->>'name', NULLIF(p_buyer->>'email', ''), p_buyer->>'phone',
    NULLIF(p_stripe->>'session_id', ''), NULLIF(p_stripe->>'payment_intent_id', ''),
    now(),
    v_promo_id, v_promo_code,
    CASE WHEN v_direct THEN 'direct' ELSE 'destination' END,
    CASE WHEN v_direct THEN v_account ELSE NULL END
  ) RETURNING id INTO v_order_id;

  IF v_promo_id IS NOT NULL THEN
    UPDATE promo_redemptions SET order_id = v_order_id WHERE reservation_id = p_reservation_id;
  END IF;

  PERFORM copy_reservation_items_to_order(p_reservation_id, v_order_id);

  SELECT array_agg(seat_id) FILTER (WHERE seat_id IS NOT NULL),
         array_agg(table_id) FILTER (WHERE table_id IS NOT NULL)
    INTO v_seat_ids, v_table_ids
    FROM reservation_items WHERE reservation_id = p_reservation_id;

  IF v_table_ids IS NOT NULL THEN
    -- Only the seats this reservation holds (hold_table marks every one).
    -- By table membership alone, a seat added to the table after the hold —
    -- and perhaps sold to someone else — was issued here too (T-017).
    SELECT COALESCE(v_seat_ids, ARRAY[]::UUID[]) || COALESCE(array_agg(s.id), ARRAY[]::UUID[])
      INTO v_seat_ids FROM seats s
     WHERE s.table_id = ANY(v_table_ids) AND s.held_by_reservation = p_reservation_id;
    UPDATE tables SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_table_ids);
  END IF;

  UPDATE seats SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_seat_ids);

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order_id, v_res.event_id, s.id, s.table_id, s.tier_id, NULL
    FROM seats s WHERE s.id = ANY(v_seat_ids);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order_id, v_res.event_id, NULL, NULL, ri.tier_id, NULL
    FROM reservation_items ri
   CROSS JOIN generate_series(1, ri.quantity)
   WHERE ri.reservation_id = p_reservation_id
     AND ri.seat_id IS NULL
     AND ri.table_id IS NULL;
  GET DIAGNOSTICS v_general = ROW_COUNT;
  v_tickets := v_tickets + v_general;

  v_key := v_order_id::TEXT;
  -- The organizer's sale.
  PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
    'sale', 'credit', (p_breakdown->>'buyerTotalCents')::BIGINT, v_currency, 'sale_' || v_key);
  -- Eventsli's application fee: commission, and the tax on it.
  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission','debit',(p_breakdown->>'commissionCents')::BIGINT,v_currency,'commission_'||v_key);
  END IF;
  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission_tax','debit',(p_breakdown->>'commissionTaxCents')::BIGINT,v_currency,'commission_tax_'||v_key);
  END IF;
  -- DIRECT: no `payment_fee` row (a buyer-paid service fee stays in the
  -- organizer's balance to offset the Stripe fee THEY pay) and no `transfer`
  -- row (nothing is transferred — the money was always theirs).
  IF NOT v_direct THEN
    IF COALESCE((p_breakdown->>'paymentFeeCents')::BIGINT,0) > 0 THEN
      PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
        'payment_fee','debit',(p_breakdown->>'paymentFeeCents')::BIGINT,v_currency,'payment_fee_'||v_key);
    END IF;
    IF p_channel = 'stripe' THEN
      PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
        'transfer','debit',(p_breakdown->>'organizerNetCents')::BIGINT,v_currency,'transfer_'||v_key);
    END IF;
  END IF;

  UPDATE reservations SET state = 'converted' WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets, 'currency', v_currency);
END;
$function$;
