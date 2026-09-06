-- ═══════════════════════════════════════════════════════════════════════════
-- A refused map save must UNDO itself.
--
-- `save_venue_map` reported its refusals by RETURNing { ok: false, ... }. In
-- plpgsql a RETURN is not a rollback — the function's work is part of the
-- caller's transaction and commits with it. So a refusal committed everything
-- the function had already done before it noticed the problem:
--
--   • the layout, which is written at the very top, before any check;
--   • the DELETE of every table the organizer had dropped;
--   • every table the loop had already reached.
--
-- Which is exactly the half-saved map the single transaction exists to
-- prevent. The integration test caught it on the first run: the save was
-- correctly refused for a held seat, and the `layout.width = 9999` bundled
-- into the same payload had landed anyway.
--
-- Refusals now RAISE. The transaction unwinds, and the code travels in the
-- message prefix the way the schema's other guards already do
-- (PRICE_LOCKED_AFTER_SALE, CURRENCY_LOCKED_AFTER_SALE).
-- ═══════════════════════════════════════════════════════════════════════════

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

  SELECT COALESCE(array_agg((e->>'id')::UUID), ARRAY[]::UUID[])
    INTO v_keep
    FROM jsonb_array_elements(p_tables) e
   WHERE e->>'id' IS NOT NULL;

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
      SELECT seat_count INTO v_prior FROM tables WHERE id = v_table_id;

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
         WHERE table_id = v_table_id AND seat_number::INT > v_seats;

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
      WHERE id = v_table_id;

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
  'Replaces a venue map in one transaction. Raises MAP_CONFLICT — which rolls the whole save back — rather than removing or shrinking tables holding sold or held seats, and names every blocked table at once.';
