-- ═══════════════════════════════════════════════════════════════════════════
-- Table, seat, ticket-type and category ids are scoped to THE EVENT they are
-- used on.
--
-- Two functions trusted ids that arrive in the request body:
--
--   • save_venue_map looked an existing table up by id alone and rewrote it —
--     price, password, privacy, seat count — and wrote tier and category ids
--     without checking which event they belonged to;
--   • record_manual_sale locked and SOLD seats and tables by id alone.
--
-- Those ids are public: every published seat map carries them. So one
-- organizer could reprice, unprotect, shrink or sell another organizer's stock
-- from their own dashboard. `verifyEventOwner` proves the caller owns the event
-- in the URL; it says nothing about the ids in the body, and these functions
-- are SECURITY DEFINER on a service-role connection, so nothing else stood in
-- the way.
--
-- Also here:
--   • save_venue_map now locks its own map's tables for the whole save, so a
--     hold or a door sale cannot land between "is this table booked?" and the
--     DELETE that follows it;
--   • a trigger, so a seat can never again point at a table on another map;
--   • a read-only report (RAISE NOTICE) of any rows already crossed. It changes
--     nothing — whether any exist, and what to do with them, is a decision for a
--     person with the numbers in front of them.
--
-- Signatures are unchanged, so CREATE OR REPLACE keeps the existing grants
-- (service_role only, since 20260914090000_lock_down_api_roles.sql).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── What has already crossed, if anything ─────────────────────────────────
DO $$
DECLARE
  v_seats_on_foreign_table   INT;
  v_seats_on_foreign_tier    INT;
  v_tables_foreign_category  INT;
  v_tickets_on_foreign_seat  INT;
BEGIN
  SELECT count(*) INTO v_seats_on_foreign_table
    FROM seats s JOIN tables t ON t.id = s.table_id
   WHERE s.venue_map_id <> t.venue_map_id;

  SELECT count(*) INTO v_seats_on_foreign_tier
    FROM seats s
    JOIN venue_maps vm ON vm.id = s.venue_map_id
    JOIN ticket_tiers tt ON tt.id = s.tier_id
   WHERE tt.event_id <> vm.event_id;

  SELECT count(*) INTO v_tables_foreign_category
    FROM tables t
    JOIN venue_maps vm ON vm.id = t.venue_map_id
    JOIN table_categories tc ON tc.id = t.category_id
   WHERE tc.event_id <> vm.event_id;

  SELECT count(*) INTO v_tickets_on_foreign_seat
    FROM tickets tk
    JOIN seats s ON s.id = tk.seat_id
    JOIN venue_maps vm ON vm.id = s.venue_map_id
   WHERE vm.event_id <> tk.event_id;

  RAISE NOTICE 'cross-event audit: seats on another map''s table = %, seats on another event''s ticket type = %, tables in another event''s category = %, tickets on another event''s seat = %',
    v_seats_on_foreign_table, v_seats_on_foreign_tier, v_tables_foreign_category, v_tickets_on_foreign_seat;
END $$;

-- ─── save_venue_map ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION save_venue_map(
  p_event_id UUID,
  p_layout   JSONB,
  p_tables   JSONB      -- array of { id?, label, seatCount, priceCents, isPrivate,
                        --            passwordHash?, clearPassword, position{x,y,rotation},
                        --            shape, categoryId, tierId, seatPriceCents }
) RETURNS JSONB AS $$
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
    END IF;
  END LOOP;

  UPDATE venue_maps
     SET version = v_version + 1, updated_at = now()
   WHERE id = v_map_id;

  SELECT count(*) INTO v_count FROM tables WHERE venue_map_id = v_map_id;

  RETURN jsonb_build_object('ok', true, 'map_id', v_map_id,
    'tables', v_count, 'version', v_version + 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION save_venue_map IS
  'Replaces a venue map in one transaction. Every table id must be on this map and every ticket type and category must belong to this event (MAP_CONFLICT / MAP_INVALID, which roll the save back). Refuses to remove or shrink tables holding sold or held seats, naming every blocked table at once.';

-- ─── record_manual_sale ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_manual_sale(
  p_event_id   UUID,
  p_seat_ids   UUID[],
  p_table_id   UUID,
  p_breakdown  JSONB,
  p_buyer      JSONB,
  p_method     TEXT,
  p_note       TEXT,
  p_recorded_by UUID
) RETURNS JSONB AS $$
DECLARE
  v_event    RECORD;
  v_order_id UUID;
  v_seats    UUID[] := COALESCE(p_seat_ids, ARRAY[]::UUID[]);
  v_locked   UUID[];
  v_tickets  INT := 0;
  v_count    INT;
  v_key      TEXT;
BEGIN
  SELECT id, organizer_id, currency, status INTO v_event FROM events WHERE id = p_event_id;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_FOUND');
  END IF;
  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is not on sale.');
  END IF;

  IF p_table_id IS NOT NULL THEN
    -- A whole table brings its seats with it — but only a table on THIS
    -- event's map.
    PERFORM 1
       FROM tables t
       JOIN venue_maps vm ON vm.id = t.venue_map_id
      WHERE t.id = p_table_id AND vm.event_id = p_event_id
        FOR UPDATE OF t;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
        'message', 'That table is not part of this event.');
    END IF;

    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO v_seats
      FROM seats WHERE table_id = p_table_id;
  ELSE
    -- A seat listed twice is one seat.
    SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::UUID[]) INTO v_seats
      FROM unnest(v_seats) AS x;
  END IF;

  IF COALESCE(array_length(v_seats, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Choose the seats or the table that were sold.');
  END IF;

  -- Every seat must be on THIS event's map. One foreign seat refuses the sale.
  SELECT count(*) INTO v_count
    FROM seats s
    JOIN venue_maps vm ON vm.id = s.venue_map_id
   WHERE s.id = ANY(v_seats) AND vm.event_id = p_event_id;

  IF v_count <> array_length(v_seats, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'Some of those seats are not part of this event.');
  END IF;

  -- Same locking discipline as the online path. A seat sold at the door and a
  -- seat sold on the website are the same piece of stock, and the door does not
  -- get to skip the check.
  SELECT array_agg(locked.id) INTO v_locked
  FROM (
    SELECT s.id FROM seats s
     WHERE s.id = ANY(v_seats) AND s.status = 'available'
     ORDER BY s.id FOR UPDATE OF s SKIP LOCKED
  ) AS locked;

  IF COALESCE(array_length(v_locked, 1), 0) <> array_length(v_seats, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEAT_UNAVAILABLE',
      'message', 'Some of those seats are already sold or held.');
  END IF;

  INSERT INTO orders (
    event_id, organizer_id, reservation_id, channel, status, currency,
    quantity, subtotal_cents, event_tax_cents,
    commission_cents, commission_tax_cents, payment_fee_cents, fee_bearer,
    buyer_total_cents, organizer_net_cents,
    guest_name, guest_email, guest_phone,
    manual_method, manual_note, recorded_by, paid_at
  ) VALUES (
    p_event_id, v_event.organizer_id, NULL, 'manual', 'paid', v_event.currency,
    array_length(v_seats, 1),
    (p_breakdown->>'subtotalCents')::BIGINT,
    COALESCE((p_breakdown->>'eventTaxCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0),
    COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0),
    0,                                    -- no card, no processing cost
    'organizer',
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    -- The organizer keeps everything: they collected it. What they owe us is
    -- the commission, and that is a debt, not a deduction from this order.
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    p_buyer->>'name', NULLIF(p_buyer->>'email', ''), p_buyer->>'phone',
    p_method, p_note, p_recorded_by, now()
  ) RETURNING id INTO v_order_id;

  UPDATE seats SET status = 'sold' WHERE id = ANY(v_seats);
  IF p_table_id IS NOT NULL THEN
    UPDATE tables SET status = 'sold' WHERE id = p_table_id;
  END IF;

  INSERT INTO order_items (order_id, tier_id, seat_id, table_id, label, unit_price_cents)
  SELECT v_order_id, s.tier_id, s.id, s.table_id,
         s.section_key || ' ' || s.row_label || s.seat_number,
         seat_price_cents(s.id)
    FROM seats s WHERE s.id = ANY(v_seats);

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id)
  SELECT v_order_id, p_event_id, s.id, s.table_id, s.tier_id
    FROM seats s WHERE s.id = ANY(v_seats);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  -- CREDIT, not debit: this is money we have EARNED and have NOT collected.
  v_key := v_order_id::TEXT;
  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(p_event_id, v_event.organizer_id, v_order_id, 'manual',
      'commission', 'credit', (p_breakdown->>'commissionCents')::BIGINT,
      v_event.currency, 'm_commission_' || v_key);
  END IF;
  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT, 0) > 0 THEN
    PERFORM ledger_write(p_event_id, v_event.organizer_id, v_order_id, 'manual',
      'commission_tax', 'credit', (p_breakdown->>'commissionTaxCents')::BIGINT,
      v_event.currency, 'm_commission_tax_' || v_key);
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets,
    'commission_owed_cents', manual_commission_owed(p_event_id, v_event.currency));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── A seat's table is always on the seat's own map ───────────────────────
-- Defence in depth. The two functions above are the paths that wrote crossed
-- rows; this refuses the next one, whatever writes it.
CREATE OR REPLACE FUNCTION seats_same_map_as_table() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tables t WHERE t.id = NEW.table_id AND t.venue_map_id = NEW.venue_map_id
  ) THEN
    RAISE EXCEPTION 'MAP_CONFLICT: a seat cannot belong to a table on another map';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION seats_same_map_as_table() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_seats_same_map_as_table ON seats;
CREATE TRIGGER trg_seats_same_map_as_table
  BEFORE INSERT OR UPDATE OF table_id, venue_map_id ON seats
  FOR EACH ROW EXECUTE FUNCTION seats_same_map_as_table();
