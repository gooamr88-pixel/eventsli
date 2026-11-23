-- ═══════════════════════════════════════════════════════════════════════════
-- THE EVENT MAP, FOR EVERY EVENT (2026-11-23).
--
-- The owner: "instead of seating map make it event map, include everything",
-- and chose one map for every event. A general-admission event can now save
-- its venue map — stage, bar, entrances, areas, decor — with its vendor booths
-- drawn on it, where until now save_venue_map refused it outright and its
-- booths lived on a separate floor plan.
--
-- What does NOT change: a general-admission event sells no seat and no table.
-- save_venue_map refuses a general-admission map that carries any (below), and
-- hold_seats / hold_table already refuse them for such an event.
--
-- save_venue_map is 20261112090000's definition with one block changed, marked
-- CHANGED. Same six-argument signature, so CREATE OR REPLACE is enough.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_venue_map(
  p_event_id uuid, p_layout jsonb, p_tables jsonb, p_expected_version int DEFAULT NULL,
  p_availability jsonb DEFAULT NULL, p_actor uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event      RECORD;
  v_map_id     UUID;
  v_version    INT;
  v_keep       UUID[];
  v_drop       UUID[];
  v_changed    UUID[];
  v_blocked    TEXT[];
  v_unpriced   TEXT[];
  t            JSONB;
  v_table_id   UUID;
  v_prior      RECORD;
  v_count      INT;
  v_label      TEXT;
  v_seats      INT;
  v_tier       UUID;
  v_seat_price BIGINT;
  v_sec        TEXT;
  v_row        TEXT;
  v_dupes      TEXT;
  v_ids        UUID[];
  v_blocked_n  INT := 0;
  v_released_n INT := 0;
  v_avail_tables UUID[];
BEGIN
  -- S-03: one save of this map at a time, including the very first one, when
  -- there is no venue_maps row yet to lock.
  -- S-10: who made this save, for the price-change log the table triggers write.
  PERFORM set_config('eventsli.actor_id', COALESCE(p_actor::TEXT, ''), true);

  PERFORM pg_advisory_xact_lock(hashtextextended('save_venue_map:' || p_event_id::TEXT, 0));

  -- S-10: which events have a map that may change.
  SELECT status, listing_type, admission_type, purchase_mode
    INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MAP_INVALID: that event does not exist';
  END IF;
  IF v_event.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'MAP_CONFLICT: a % event cannot be changed', v_event.status;
  END IF;
  IF v_event.listing_type = 'display_only' THEN
    RAISE EXCEPTION 'MAP_INVALID: this event is listed for information only. Make it a ticketed event before drawing a seat map';
  END IF;
  -- CHANGED (2026-11-23, the event map): a general-admission event has a map
  -- too — the stage, the bar, the entrances, the areas and the vendor booths —
  -- but nothing on it is sold, so it may hold no seats and no tables. Holds
  -- already refuse seats and tables on a general-admission event
  -- (hold_seats, hold_table), so this is the only rule that had to move.
  IF v_event.admission_type = 'general'
     AND jsonb_array_length(COALESCE(p_tables, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'MAP_INVALID: this event is general admission, so its map has no seats or tables to sell. Remove them, or switch to reserved seating in Event details';
  END IF;

  -- S-03: the save must be made from the map as it is now.
  SELECT id, version INTO v_map_id, v_version FROM venue_maps WHERE event_id = p_event_id FOR UPDATE;
  IF p_expected_version IS NOT NULL AND COALESCE(v_version, 0) <> p_expected_version THEN
    RAISE EXCEPTION 'MAP_STALE: this map was changed somewhere else after you opened it';
  END IF;

  INSERT INTO venue_maps (event_id, layout_json)
  VALUES (p_event_id, COALESCE(p_layout, '{}'::JSONB))
  ON CONFLICT (event_id) DO UPDATE
    SET layout_json = EXCLUDED.layout_json, updated_at = now()
  RETURNING id, version INTO v_map_id, v_version;

  SELECT COALESCE(array_agg((e->>'id')::UUID), ARRAY[]::UUID[])
    INTO v_keep
    FROM jsonb_array_elements(p_tables) e
   WHERE e->>'id' IS NOT NULL;

  -- ── Every id must be a table ON THIS MAP ──
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

  -- ── S-19: every seat address is unique ──
  -- A table's seats are (section, row, 1..n): two tables with the same section
  -- and row would collide on the seat uniqueness rule. Named, not a raw error.
  SELECT string_agg(format('%s (Section %s, Row %s)', d.labels, d.sec, d.rw), '; ')
    INTO v_dupes
    FROM (
      SELECT a.sec, a.rw, string_agg(a.label, ' and ' ORDER BY a.label) AS labels
        FROM (
          SELECT COALESCE(NULLIF(btrim(e->>'section'), ''), btrim(e->>'label')) AS sec,
                 CASE WHEN NULLIF(btrim(e->>'section'), '') IS NULL THEN 'A'
                      ELSE COALESCE(NULLIF(btrim(e->>'row'), ''), 'A') END AS rw,
                 btrim(e->>'label') AS label
            FROM jsonb_array_elements(p_tables) e
        ) a
       GROUP BY a.sec, a.rw
      HAVING count(*) > 1
    ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'MAP_INVALID: two rows would share the same seats: %. Give each row its own section or row name', v_dupes;
  END IF;

  -- ── S-09: what this save actually touches ──
  -- Tables it deletes, and existing tables whose incoming row differs from the
  -- stored one. Positions are compared at the precision they are stored at,
  -- or every save would see every table as moved.
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::UUID[])
    INTO v_drop
    FROM tables WHERE venue_map_id = v_map_id AND NOT (id = ANY(v_keep));

  SELECT COALESCE(array_agg(tb.id ORDER BY tb.id), ARRAY[]::UUID[])
    INTO v_changed
    FROM jsonb_array_elements(p_tables) e
    JOIN tables tb ON tb.id = (e->>'id')::UUID AND tb.venue_map_id = v_map_id
   WHERE tb.label IS DISTINCT FROM btrim(e->>'label')
      OR tb.seat_count IS DISTINCT FROM (e->>'seatCount')::INT
      OR tb.price_cents IS DISTINCT FROM NULLIF(e->>'priceCents', '')::BIGINT
      OR tb.is_private IS DISTINCT FROM COALESCE((e->>'isPrivate')::BOOLEAN, false)
      OR NULLIF(e->>'passwordHash', '') IS NOT NULL
      OR (COALESCE((e->>'clearPassword')::BOOLEAN, false) AND tb.password_hash IS NOT NULL)
      OR tb.position_x IS DISTINCT FROM round(COALESCE((e#>>'{position,x}')::NUMERIC, 0), 3)
      OR tb.position_y IS DISTINCT FROM round(COALESCE((e#>>'{position,y}')::NUMERIC, 0), 3)
      OR tb.rotation IS DISTINCT FROM round(COALESCE((e#>>'{position,rotation}')::NUMERIC, 0), 2)
      OR tb.shape IS DISTINCT FROM COALESCE(e->>'shape', 'round')
      OR tb.category_id IS DISTINCT FROM NULLIF(e->>'categoryId', '')::UUID
      OR tb.tier_id IS DISTINCT FROM NULLIF(e->>'tierId', '')::UUID
      OR tb.seat_price_cents IS DISTINCT FROM NULLIF(e->>'seatPriceCents', '')::BIGINT
      OR tb.section_name IS DISTINCT FROM NULLIF(btrim(e->>'section'), '')
      OR tb.row_name IS DISTINCT FROM CASE WHEN NULLIF(btrim(e->>'section'), '') IS NULL THEN NULL
                                           ELSE NULLIF(btrim(e->>'row'), '') END;

  -- Locked in id order — the order hold_seats and hold_table take them — so the
  -- booked-or-not checks below cannot be overtaken by a hold or a door sale.
  -- Only these: an untouched table is not written, so a buyer holding seats on
  -- it no longer waits for the save.
  --
  -- The tables of seats being blocked or released are locked HERE too, in the
  -- same id-ordered pass: changing a seat's status makes its table's status
  -- trigger lock the table, and hold_table locks the table and then its seats.
  -- Taking that table lock later — after the seat locks — could deadlock with a
  -- buyer booking the same table whole.
  IF p_availability IS NOT NULL AND jsonb_typeof(p_availability) = 'object' THEN
    SELECT COALESCE(array_agg(DISTINCT s.table_id), ARRAY[]::UUID[])
      INTO v_avail_tables
      FROM seats s
     WHERE s.venue_map_id = v_map_id AND s.table_id IS NOT NULL
       AND s.id::TEXT IN (
         SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_availability->'block') = 'array'
                                               THEN p_availability->'block' ELSE '[]'::JSONB END)
         UNION
         SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_availability->'release') = 'array'
                                               THEN p_availability->'release' ELSE '[]'::JSONB END));
  END IF;

  PERFORM 1 FROM tables
   WHERE id = ANY(v_drop || v_changed || COALESCE(v_avail_tables, ARRAY[]::UUID[]))
   ORDER BY id FOR UPDATE;

  -- ── Refuse before touching the tables ──
  -- S-08: a table is booked when a seat on it is HELD or SOLD — read from the
  -- seats, not the table's status, which the status trigger sets to `sold` for
  -- a table whose seats the organizer merely blocked. A whole-table hold or
  -- sale marks every seat, so it is caught here too.
  SELECT COALESCE(array_agg(DISTINCT tb.label ORDER BY tb.label), ARRAY[]::TEXT[])
    INTO v_blocked
    FROM tables tb
   WHERE tb.id = ANY(v_drop)
     AND EXISTS (SELECT 1 FROM seats s WHERE s.table_id = tb.id AND s.status IN ('held', 'sold'));

  IF array_length(v_blocked, 1) > 0 THEN
    RAISE EXCEPTION 'MAP_CONFLICT: these tables have been booked and cannot be removed: %',
      array_to_string(v_blocked, ', ');
  END IF;

  DELETE FROM seats  WHERE table_id = ANY(v_drop);
  DELETE FROM tables WHERE id = ANY(v_drop);

  -- S-14: seats whose address changes step aside first, so two tables can swap
  -- names (or one take an address another is giving up) without their seats
  -- colliding on (map, section, row, number) halfway through the loop.
  UPDATE seats s
     SET section_key = '~' || s.table_id::TEXT
    FROM jsonb_array_elements(p_tables) e
   WHERE e->>'id' IS NOT NULL
     AND s.table_id = (e->>'id')::UUID
     AND s.table_id = ANY(v_changed)
     AND (s.section_key, s.row_label) IS DISTINCT FROM (
       COALESCE(NULLIF(btrim(e->>'section'), ''), btrim(e->>'label')),
       CASE WHEN NULLIF(btrim(e->>'section'), '') IS NULL THEN 'A'
            ELSE COALESCE(NULLIF(btrim(e->>'row'), ''), 'A') END);

  -- ── Create or update each table ──
  FOR t IN SELECT * FROM jsonb_array_elements(p_tables)
  LOOP
    v_label      := btrim(t->>'label');
    v_seats      := (t->>'seatCount')::INT;
    v_tier       := NULLIF(t->>'tierId', '')::UUID;
    v_seat_price := NULLIF(t->>'seatPriceCents', '')::BIGINT;
    -- S-19: the seats' address. A section row is (section, row); any other
    -- table is (its label, 'A'), as before.
    v_sec := COALESCE(NULLIF(btrim(t->>'section'), ''), v_label);
    v_row := CASE WHEN NULLIF(btrim(t->>'section'), '') IS NULL THEN 'A'
                  ELSE COALESCE(NULLIF(btrim(t->>'row'), ''), 'A') END;

    IF t->>'id' IS NULL THEN
      INSERT INTO tables (
        venue_map_id, label, seat_count, price_cents, is_private, password_hash,
        position_x, position_y, rotation, shape, category_id, tier_id, seat_price_cents,
        section_name, row_name
      ) VALUES (
        v_map_id, v_label, v_seats,
        NULLIF(t->>'priceCents', '')::BIGINT,
        COALESCE((t->>'isPrivate')::BOOLEAN, false),
        NULLIF(t->>'passwordHash', ''),
        COALESCE((t#>>'{position,x}')::NUMERIC, 0),
        COALESCE((t#>>'{position,y}')::NUMERIC, 0),
        COALESCE((t#>>'{position,rotation}')::NUMERIC, 0),
        COALESCE(t->>'shape', 'round'),
        NULLIF(t->>'categoryId', '')::UUID,
        v_tier, v_seat_price,
        NULLIF(btrim(t->>'section'), ''),
        CASE WHEN NULLIF(btrim(t->>'section'), '') IS NULL THEN NULL ELSE NULLIF(btrim(t->>'row'), '') END
      ) RETURNING id INTO v_table_id;

      INSERT INTO seats (venue_map_id, table_id, tier_id, section_key, row_label,
                         seat_number, price_override_cents)
      SELECT v_map_id, v_table_id, v_tier, v_sec, v_row, g::TEXT, v_seat_price
        FROM generate_series(1, v_seats) AS g;

    ELSE
      v_table_id := (t->>'id')::UUID;
      -- S-09: an unchanged table is not written at all.
      CONTINUE WHEN NOT (v_table_id = ANY(v_changed));

      SELECT seat_count INTO v_prior
        FROM tables WHERE id = v_table_id AND venue_map_id = v_map_id;

      IF v_prior IS NULL THEN
        RAISE EXCEPTION 'MAP_CONFLICT: table % is no longer on this map', v_label;
      END IF;

      IF v_prior.seat_count > v_seats THEN
        -- Checked seat by seat: a table can read `available` while one seat is
        -- held. S-08: only held and sold seats stop a shrink.
        SELECT count(*) INTO v_count
          FROM seats
         WHERE table_id = v_table_id
           AND seat_number::INT > v_seats
           AND status IN ('held', 'sold');

        IF v_count > 0 THEN
          RAISE EXCEPTION 'MAP_CONFLICT: "%" cannot be made smaller: % of the seats being removed have been booked',
            v_label, v_count;
        END IF;

        DELETE FROM seats
         WHERE table_id = v_table_id AND seat_number::INT > v_seats
           AND status IN ('available', 'blocked');

      ELSIF v_prior.seat_count < v_seats THEN
        -- T-017: a table booked WHOLE cannot grow, or a new chair sells twice.
        IF EXISTS (
          SELECT 1 FROM reservation_items ri
            JOIN reservations r ON r.id = ri.reservation_id
           WHERE ri.table_id = v_table_id AND r.state IN ('active', 'converted')
        ) THEN
          RAISE EXCEPTION 'MAP_CONFLICT: "%" has been booked as a whole table, so seats cannot be added to it',
            v_label;
        END IF;

        INSERT INTO seats (venue_map_id, table_id, tier_id, section_key, row_label,
                           seat_number, price_override_cents)
        SELECT v_map_id, v_table_id, v_tier, v_sec, v_row, g::TEXT, v_seat_price
          FROM generate_series(v_prior.seat_count + 1, v_seats) AS g;
      END IF;

      UPDATE tables SET
        label = v_label,
        seat_count = v_seats,
        price_cents = NULLIF(t->>'priceCents', '')::BIGINT,
        is_private = COALESCE((t->>'isPrivate')::BOOLEAN, false),
        password_hash = CASE
          WHEN COALESCE((t->>'clearPassword')::BOOLEAN, false) THEN NULL
          WHEN NULLIF(t->>'passwordHash', '') IS NOT NULL THEN t->>'passwordHash'
          ELSE password_hash
        END,
        position_x = COALESCE((t#>>'{position,x}')::NUMERIC, 0),
        position_y = COALESCE((t#>>'{position,y}')::NUMERIC, 0),
        rotation = COALESCE((t#>>'{position,rotation}')::NUMERIC, 0),
        shape = COALESCE(t->>'shape', 'round'),
        category_id = NULLIF(t->>'categoryId', '')::UUID,
        tier_id = v_tier,
        seat_price_cents = v_seat_price,
        section_name = NULLIF(btrim(t->>'section'), ''),
        row_name = CASE WHEN NULLIF(btrim(t->>'section'), '') IS NULL THEN NULL ELSE NULLIF(btrim(t->>'row'), '') END
      WHERE id = v_table_id AND venue_map_id = v_map_id;

      -- Seat addresses follow the label, or the section and row (S-19).
      -- S-09: only where they differ.
      UPDATE seats SET section_key = v_sec, row_label = v_row
       WHERE table_id = v_table_id
         AND (section_key, row_label) IS DISTINCT FROM (v_sec, v_row);

      -- The table's ticket type and seat price reach its seats that are not a
      -- buyer's. S-08: blocked seats too, or they come back at the old price.
      UPDATE seats
         SET tier_id = v_tier,
             price_override_cents = v_seat_price
       WHERE table_id = v_table_id
         AND status IN ('available', 'blocked')
         AND (tier_id IS DISTINCT FROM v_tier
              OR price_override_cents IS DISTINCT FROM v_seat_price);
    END IF;
  END LOOP;

  -- ── Seats the organizer blocked or released in the Studio preview ──
  -- Saved WITH the map, in this transaction: one save model for the whole
  -- editor. Only `available` ⇄ `blocked` ever moves. A seat a buyer held or
  -- bought meanwhile is skipped and counted, never taken back.
  IF p_availability IS NOT NULL AND jsonb_typeof(p_availability) = 'object' THEN
    SELECT COALESCE(array_agg(x::UUID), ARRAY[]::UUID[]) INTO v_ids
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_availability->'block') = 'array'
                                          THEN p_availability->'block' ELSE '[]'::JSONB END) x
     WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    UPDATE seats SET status = 'blocked'
     WHERE venue_map_id = v_map_id AND status = 'available' AND id = ANY(v_ids);
    GET DIAGNOSTICS v_blocked_n = ROW_COUNT;

    SELECT COALESCE(array_agg(x::UUID), ARRAY[]::UUID[]) INTO v_ids
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_availability->'release') = 'array'
                                          THEN p_availability->'release' ELSE '[]'::JSONB END) x
     WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    UPDATE seats SET status = 'available'
     WHERE venue_map_id = v_map_id AND status = 'blocked' AND id = ANY(v_ids);
    GET DIAGNOSTICS v_released_n = ROW_COUNT;
  END IF;

  -- ── S-04: a live event's seats all have a price ──
  -- The submission check stops an unpriced map going live; nothing stopped a
  -- live map gaining unpriced seats, which the buyer saw as available and
  -- could never hold. Selling whole tables only, the table price is the price.
  IF v_event.status = 'published' AND v_event.purchase_mode <> 'table_only' THEN
    SELECT COALESCE(array_agg(DISTINCT tb.label ORDER BY tb.label), ARRAY[]::TEXT[])
      INTO v_unpriced
      FROM seats s
      JOIN tables tb ON tb.id = s.table_id
     WHERE s.venue_map_id = v_map_id
       AND s.status IN ('available', 'blocked')
       AND s.price_override_cents IS NULL
       AND NOT EXISTS (SELECT 1 FROM ticket_tiers tt WHERE tt.id = s.tier_id);

    IF array_length(v_unpriced, 1) > 0 THEN
      RAISE EXCEPTION 'MAP_INVALID: this event is on sale, so every seat needs a price. Choose a ticket type for %',
        array_to_string(v_unpriced[1:10], ', ')
        || CASE WHEN array_length(v_unpriced, 1) > 10
             THEN format(' and %s more', array_length(v_unpriced, 1) - 10) ELSE '' END;
    END IF;
  END IF;

  UPDATE venue_maps
     SET version = v_version + 1, updated_at = now()
   WHERE id = v_map_id;

  SELECT count(*) INTO v_count FROM tables WHERE venue_map_id = v_map_id;

  RETURN jsonb_build_object('ok', true, 'map_id', v_map_id,
    'tables', v_count, 'version', v_version + 1,
    'availability', jsonb_build_object('blocked', v_blocked_n, 'released', v_released_n));
END;
$function$;

REVOKE ALL ON FUNCTION save_venue_map(uuid, jsonb, jsonb, int, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_venue_map(uuid, jsonb, jsonb, int, jsonb, uuid) TO service_role;
