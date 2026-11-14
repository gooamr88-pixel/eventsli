-- ═══════════════════════════════════════════════════════════════════════════
-- Seating, ticket types and selling: the database half of the 2026-11-09 audit
-- (docs/TECH-AUDIT-LOG.md, "Seating, pricing and checkout audit", S-01..S-21).
--
--  S-02  A table's ticket type and seat price live ON THE TABLE. They used to
--        be inferred from "the first seat", and seats are read in id order, so
--        after a partial sale the editor could read back the old type and the
--        next unrelated save reapplied it to every available seat.
--  S-03  save_venue_map takes the version the editor loaded and refuses a save
--        made from a stale copy (MAP_STALE). It was a silent last-writer-wins
--        full replace that deleted another tab's new tables.
--  S-04  On a live event a save cannot leave seats with no price. A whole-table
--        price never priced the seats (seat_price_cents is override → type → 0).
--  S-05  hold_table checks the ticket types' sale windows and refuses a
--        general-admission event, as hold_seats already did.
--  S-06  hold_seats enforces a ticket type's `max_per_order`, which the form
--        offered and nothing read on a reserved event.
--  S-08  Seats the organizer BLOCKED are not "booked": a table of blocked seats
--        can be removed or shrunk, and blocked seats follow the table's type.
--  S-09  A save writes only the tables that changed, and locks only those (and
--        the ones it deletes) — it locked every table and rewrote every seat,
--        so on a big live map every buyer's hold queued behind each save.
--  S-10  A cancelled or completed event's map cannot change; a general-admission
--        or listing-only event has none.
--  S-11  event_from_prices: the cheapest thing a buyer can actually buy.
--  S-12  A whole table sold at the door is one receipt line at the table price.
--  S-14  Two tables can swap names in one save (seat section keys used to
--        collide on the seat uniqueness rule and surface a raw Postgres error).
--  S-15  hold_table says why a table cannot be booked whole: taken seats versus
--        seats that are not on sale; it locks a table's seats before counting.
--  S-19  A theatre row's section and row are stored on the table and written to
--        its seats, so tickets read "Section Gold · Row C · Seat 5".
--  ---   Seats blocked or released in the Studio preview are saved WITH the map
--        (`p_availability`), in this transaction — one save model.
--
-- Owner decisions of 2026-11-10, at the end of the file:
--  S-18  A ticket type's price may change after a sale. Sold orders and order
--        lines can never change their amounts (`sale_prices_are_final`).
--  S-10  Price changes on a live event need no review; every one is written to
--        admin_audit by trigger, with the actor where the API passes one.
--  S-16  A ticket keeps the table name and seat it was issued with (an
--        immutable snapshot); the door's four functions read it first.
--
-- Every function below is the live definition with only the marked changes.
--
-- DEPLOY ORDER: this migration FIRST, then the API. The old API calls
-- save_venue_map with three arguments, which the new six-argument definition
-- still accepts (the rest default to NULL: no version check, no blocks, no
-- actor); the new API sends six, which the old definition does not have. The
-- old API's tier PATCH also keeps working: with the price lock gone it simply
-- succeeds, logged without an actor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT: the migrations this one builds on.
--
-- This file re-issues functions created by the four check-in migrations and
-- the venue-map one before it. Run on a database without them it used to fail
-- near its end ("function door_fold(text) does not exist", 2026-11-10) — after
-- the reader had to work out from a line number which file was missing. It
-- now stops HERE, before changing anything, and names every one.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  fn TEXT;
BEGIN
  FOR fn IN SELECT unnest(ARRAY['check_in_ticket_v2', 'ticket_door_detail', 'door_fold', 'event_door_manifest'])
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = fn AND pronamespace = 'public'::regnamespace) THEN
      v_missing := v_missing || CASE fn
        WHEN 'check_in_ticket_v2'  THEN '20261108090000_checkin_v2.sql'
        WHEN 'ticket_door_detail'  THEN '20261108100000_checkin_app_api.sql'
        WHEN 'door_fold'           THEN '20261109090000_door_list_search.sql'
        WHEN 'event_door_manifest' THEN '20261110090000_offline_manifest.sql'
      END;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fulfill_checkout'
                  AND prosrc LIKE '%held_by_reservation = p_reservation_id%') THEN
    v_missing := v_missing || '20261111090000_venue_map_seat_integrity.sql'::TEXT;
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'PREREQUISITES MISSING — nothing was changed. Apply these migrations first, in this order, then run this one again: %',
      array_to_string(v_missing, ', ');
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- S-02: the table's ticket type and seat price, stored on the table.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS tier_id UUID REFERENCES ticket_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seat_price_cents BIGINT;

ALTER TABLE tables DROP CONSTRAINT IF EXISTS table_seat_price_nonneg;
ALTER TABLE tables
  ADD CONSTRAINT table_seat_price_nonneg CHECK (seat_price_cents IS NULL OR seat_price_cents >= 0);

CREATE INDEX IF NOT EXISTS tables_tier_idx ON tables (tier_id) WHERE tier_id IS NOT NULL;

COMMENT ON COLUMN tables.tier_id IS
  'The ticket type the organizer chose for this table. Its available and blocked seats carry it; held and sold seats keep what was bought.';
COMMENT ON COLUMN tables.seat_price_cents IS
  'Per-seat price override for this table''s seats. Distinct from price_cents, which is the WHOLE-table price and never prices a seat.';

-- Backfill from the seats, choosing deterministically: an available (or
-- blocked) seat before a held or sold one, then the lowest seat number. That is
-- the seat that reflects the organizer's latest choice. Only tables that have
-- neither value yet, so a re-run changes nothing the editor has since written.
WITH pick AS (
  SELECT DISTINCT ON (s.table_id) s.table_id, s.tier_id, s.price_override_cents
    FROM seats s
   WHERE s.table_id IS NOT NULL
   ORDER BY s.table_id,
            (s.status IN ('available', 'blocked')) DESC,
            CASE WHEN s.seat_number ~ '^[0-9]{1,9}$' THEN s.seat_number::INT END NULLS LAST,
            s.seat_number
)
UPDATE tables t
   SET tier_id = p.tier_id, seat_price_cents = p.price_override_cents
  FROM pick p
 WHERE p.table_id = t.id
   AND t.tier_id IS NULL AND t.seat_price_cents IS NULL
   AND (p.tier_id IS NOT NULL OR p.price_override_cents IS NOT NULL);

-- ───────────────────────────────────────────────────────────────────────────
-- S-19: a theatre row's SECTION and ROW, stored on the table, written to its
-- seats. A row of a Studio section is a `tables` row of shape 'row'; its seats
-- were addressed (section_key = the table's label, row_label = 'A'), so every
-- ticket, email, door list and check-in screen read "Gold C · seat 5" or
-- "row A" for what the buyer chose as "Section Gold · Row C · Seat 5". The
-- names lived only in layout_json, which nothing downstream reads.
--
-- A seat's address is now (COALESCE(section_name, label), COALESCE(row_name,
-- 'A'), number). A table that is not part of a section keeps its label and
-- row 'A', exactly as before.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS section_name TEXT,
  ADD COLUMN IF NOT EXISTS row_name TEXT;

ALTER TABLE tables DROP CONSTRAINT IF EXISTS table_section_row_sane;
ALTER TABLE tables
  ADD CONSTRAINT table_section_row_sane CHECK (
    (section_name IS NULL OR length(btrim(section_name)) BETWEEN 1 AND 40)
    AND (row_name IS NULL OR length(btrim(row_name)) BETWEEN 1 AND 8)
    AND (row_name IS NULL OR section_name IS NOT NULL)
  );

COMMENT ON COLUMN tables.section_name IS
  'For a row of a seating section: the section''s name. Its seats'' section_key. NULL for an ordinary table (seats use the label).';
COMMENT ON COLUMN tables.row_name IS
  'For a row of a seating section: the row''s name ("C"). Its seats'' row_label. NULL means row ''A''.';

-- Backfill from the Studio's sections in layout_json, defensively: the blob
-- has no schema, so anything that is not the expected shape is skipped.
UPDATE tables t
   SET section_name = left(btrim(sec->>'name'), 40),
       row_name = NULLIF(left(btrim(r->>'row'), 8), '')
  FROM venue_maps vm,
       jsonb_array_elements(CASE WHEN jsonb_typeof(vm.layout_json->'sections') = 'array'
                                 THEN vm.layout_json->'sections' ELSE '[]'::JSONB END) sec,
       jsonb_array_elements(CASE WHEN jsonb_typeof(sec->'rows') = 'array'
                                 THEN sec->'rows' ELSE '[]'::JSONB END) r
 WHERE t.venue_map_id = vm.id
   AND jsonb_typeof(sec) = 'object' AND jsonb_typeof(r) = 'object'
   AND r->>'table' = t.label
   AND length(btrim(COALESCE(sec->>'name', ''))) > 0
   AND t.section_name IS NULL;

-- Two tables that would share an address keep their labels instead: seats are
-- unique on (map, section, row, number), and a backfill must not fail a deploy.
UPDATE tables t SET section_name = NULL, row_name = NULL
 WHERE t.section_name IS NOT NULL
   AND t.id IN (
     SELECT id FROM (
       SELECT t2.id, count(*) OVER (
         PARTITION BY t2.venue_map_id, COALESCE(t2.section_name, t2.label), COALESCE(t2.row_name, 'A')
       ) AS n
         FROM tables t2
     ) x WHERE x.n > 1
   );

-- The seats follow, in two steps so no intermediate state collides: aside to
-- a key no real section can have, then to the real address.
UPDATE seats s SET section_key = '~' || s.table_id::TEXT
  FROM tables t
 WHERE s.table_id = t.id AND t.section_name IS NOT NULL
   AND (s.section_key, s.row_label) IS DISTINCT FROM (t.section_name, COALESCE(t.row_name, 'A'));
UPDATE seats s SET section_key = t.section_name, row_label = COALESCE(t.row_name, 'A')
  FROM tables t
 WHERE s.table_id = t.id AND s.section_key = '~' || t.id::TEXT;

-- Correct the comment that sent everyone the wrong way (S-04): the table's
-- price is not in a seat's resolution.
COMMENT ON COLUMN seats.price_override_cents IS
  'Per-seat price. A seat resolves override → ticket type, and a seat with neither is unpriced and cannot be sold. The table''s whole-table price never prices a seat.';


-- ───────────────────────────────────────────────────────────────────────────
-- save_venue_map — S-02, S-03, S-04, S-08, S-09, S-10, S-14.
-- From 20261111090000. A new argument, so the old signature is dropped and the
-- grants restated.
-- ───────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS save_venue_map(uuid, jsonb, jsonb);
-- An earlier local draft of this migration had a four-argument version.
DROP FUNCTION IF EXISTS save_venue_map(uuid, jsonb, jsonb, int);
DROP FUNCTION IF EXISTS save_venue_map(uuid, jsonb, jsonb, int, jsonb);

-- `p_availability` = { "block": [seat ids], "release": [seat ids] } — the seats
-- the organizer blocked or released in the Studio preview, saved with the map
-- in this one transaction rather than written the moment they were pressed.
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
  IF v_event.admission_type = 'general' THEN
    RAISE EXCEPTION 'MAP_INVALID: this event is general admission, so it has no seat map. Switch it to reserved seating in Event details first';
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


-- ───────────────────────────────────────────────────────────────────────────
-- hold_seats — S-06. From 20261012090000, plus the per-type order limit.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hold_seats(
  p_event_id   UUID,
  p_user_id    UUID,
  p_seat_ids   UUID[],
  p_ttl_minutes INT DEFAULT 35
) RETURNS JSONB AS $$
DECLARE
  v_requested   INT;
  v_event       RECORD;
  v_table_ids   UUID[];
  v_locked      UUID[];
  v_locked_n    INT;
  v_res_id      UUID;
  v_expires     TIMESTAMPTZ;
  v_total       BIGINT := 0;
  v_full_tier   TEXT;
  v_closed      TEXT;
  v_unpriced    INT;
  v_cap         RECORD;
BEGIN
  v_requested := COALESCE(array_length(p_seat_ids, 1), 0);
  IF v_requested = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Select at least one seat.');
  END IF;

  SELECT id, status, listing_type, purchase_mode, admission_type,
         max_tickets_per_order, currency
    INTO v_event FROM events WHERE id = p_event_id;

  IF v_event IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'Tickets are not on sale for this event.');
  END IF;

  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is listed for information only. Tickets are not sold here.');
  END IF;

  IF v_event.admission_type = 'general' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event is general admission. Choose a ticket type instead of a seat.');
  END IF;

  IF v_event.purchase_mode = 'table_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event sells whole tables only.');
  END IF;

  IF v_requested > v_event.max_tickets_per_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PURCHASE_LIMIT_EXCEEDED',
      'message', format('You can buy at most %s tickets in one order.',
                        v_event.max_tickets_per_order));
  END IF;

  SELECT array_agg(DISTINCT s.table_id ORDER BY s.table_id)
    INTO v_table_ids
    FROM seats s
   WHERE s.id = ANY(p_seat_ids) AND s.table_id IS NOT NULL;

  IF v_table_ids IS NOT NULL THEN
    PERFORM 1 FROM tables WHERE id = ANY(v_table_ids) ORDER BY id FOR UPDATE;
  END IF;

  SELECT array_agg(locked.id) INTO v_locked
  FROM (
    SELECT s.id
      FROM seats s
      JOIN venue_maps vm ON vm.id = s.venue_map_id
     WHERE s.id = ANY(p_seat_ids)
       AND vm.event_id = p_event_id
       AND s.status = 'available'
     ORDER BY s.id
     FOR UPDATE OF s SKIP LOCKED
  ) AS locked;

  v_locked_n := COALESCE(array_length(v_locked, 1), 0);

  IF v_locked_n <> v_requested THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEAT_UNAVAILABLE',
      'message', 'One or more of those seats has just been taken. Refresh the map and try again.',
      'requested', v_requested, 'available', v_locked_n);
  END IF;

  SELECT tier_sale_window_closed(array_agg(DISTINCT s.tier_id))
    INTO v_closed
    FROM seats s WHERE s.id = ANY(v_locked) AND s.tier_id IS NOT NULL;

  IF v_closed IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_NOT_ON_SALE',
      'message', format('%s is not on sale right now.', v_closed));
  END IF;

  -- ── NEW (S-06): a ticket type's own per-order limit ──
  -- Only ever tighter than the event's, which is checked above.
  SELECT tt.name, tt.max_per_order INTO v_cap
    FROM seats s
    JOIN ticket_tiers tt ON tt.id = s.tier_id
   WHERE s.id = ANY(v_locked) AND tt.max_per_order IS NOT NULL
   GROUP BY tt.id, tt.name, tt.max_per_order
  HAVING count(*) > tt.max_per_order
   ORDER BY tt.name
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PURCHASE_LIMIT_EXCEEDED',
      'message', format('You can buy at most %s %s tickets in one order.', v_cap.max_per_order, v_cap.name));
  END IF;

  v_full_tier := tier_allocation_exceeded(v_locked);
  IF v_full_tier IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
      'message', format('%s tickets have sold out.', v_full_tier));
  END IF;

  v_unpriced := unpriced_seat_count(v_locked);
  IF v_unpriced > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEAT_NOT_PRICED',
      'message', 'These seats are not on sale yet. Please try again shortly, or contact the organizer.');
  END IF;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  INSERT INTO reservations (event_id, user_id, state, expires_at)
  VALUES (p_event_id, p_user_id, 'active', v_expires)
  RETURNING id INTO v_res_id;

  UPDATE seats
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = ANY(v_locked);

  INSERT INTO reservation_items (reservation_id, seat_id, tier_id, unit_price_cents)
  SELECT v_res_id, s.id, s.tier_id, seat_price_cents(s.id)
    FROM seats s WHERE s.id = ANY(v_locked);

  SELECT COALESCE(SUM(unit_price_cents * quantity), 0) INTO v_total
    FROM reservation_items WHERE reservation_id = v_res_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_res_id,
    'expires_at', v_expires,
    'seat_count', v_locked_n,
    'subtotal_cents', v_total,
    'currency', v_event.currency
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ───────────────────────────────────────────────────────────────────────────
-- hold_table — S-05, S-15. From 20260915131000.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hold_table(
  p_event_id    UUID,
  p_user_id     UUID,
  p_table_id    UUID,
  p_ttl_minutes INT DEFAULT 35
) RETURNS JSONB AS $$
DECLARE
  v_event     RECORD;
  v_table     RECORD;
  v_seats     UUID[];
  v_free      INT;
  v_taken     INT;
  v_total     INT;
  v_res_id    UUID;
  v_expires   TIMESTAMPTZ;
  v_full_tier TEXT;
  v_closed    TEXT;
BEGIN
  SELECT id, status, listing_type, purchase_mode, admission_type, currency
    INTO v_event FROM events WHERE id = p_event_id;

  IF v_event IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'Tickets are not on sale for this event.');
  END IF;

  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is listed for information only. Tickets are not sold here.');
  END IF;

  -- NEW (S-05): a general-admission event has no tables to sell, even if a map
  -- from before the switch is still stored.
  IF v_event.admission_type = 'general' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event is general admission. Choose a ticket type instead of a table.');
  END IF;

  IF v_event.purchase_mode = 'seat_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event sells individual seats only.');
  END IF;

  SELECT t.id, t.status, t.price_cents, t.seat_count, t.label, t.is_private
    INTO v_table
    FROM tables t
    JOIN venue_maps vm ON vm.id = t.venue_map_id
   WHERE t.id = p_table_id AND vm.event_id = p_event_id
     FOR UPDATE OF t;

  IF v_table IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That table is not part of this event.');
  END IF;

  IF v_table.status NOT IN ('available', 'partial') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_UNAVAILABLE',
      'message', 'That table is no longer available.');
  END IF;

  -- NEW: the seats are LOCKED before they are counted. Counted unlocked, a
  -- seat blocked by a map save in the same instant was then marked held by the
  -- UPDATE below — which does not re-check status — and a seat the organizer
  -- took off sale was sold with the table.
  PERFORM 1 FROM seats WHERE table_id = p_table_id ORDER BY id FOR UPDATE;

  SELECT array_agg(s.id ORDER BY s.id),
         count(*),
         count(*) FILTER (WHERE s.status = 'available'),
         count(*) FILTER (WHERE s.status IN ('held', 'sold'))
    INTO v_seats, v_total, v_free, v_taken
    FROM seats s WHERE s.table_id = p_table_id;

  IF COALESCE(v_total, 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_UNAVAILABLE',
      'message', 'That table has no seats.');
  END IF;

  -- CHANGED (S-15): say which of the two it is. "Sold individually … for good"
  -- was the answer for a seat that was only held, or blocked by the organizer.
  IF v_taken > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_PARTIALLY_SOLD',
      'message', 'Some seats at this table are already taken, so it cannot be booked whole right now.');
  END IF;

  IF v_free <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TABLE_UNAVAILABLE',
      'message', 'Some seats at this table are not on sale, so it cannot be booked whole.');
  END IF;

  IF v_table.price_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This table has no price set and cannot be booked whole.');
  END IF;

  -- NEW (S-05): the ticket types behind the table's seats have to be on sale.
  SELECT tier_sale_window_closed(array_agg(DISTINCT s.tier_id))
    INTO v_closed
    FROM seats s WHERE s.id = ANY(v_seats) AND s.tier_id IS NOT NULL;

  IF v_closed IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_NOT_ON_SALE',
      'message', format('%s is not on sale right now, so this table cannot be booked.', v_closed));
  END IF;

  v_full_tier := tier_allocation_exceeded(v_seats);
  IF v_full_tier IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
      'message', format('%s tickets have sold out, so this table cannot be booked whole.', v_full_tier));
  END IF;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  INSERT INTO reservations (event_id, user_id, state, expires_at)
  VALUES (p_event_id, p_user_id, 'active', v_expires)
  RETURNING id INTO v_res_id;

  UPDATE seats
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = ANY(v_seats);

  UPDATE tables
     SET status = 'held', held_by_reservation = v_res_id
   WHERE id = p_table_id;

  INSERT INTO reservation_items (reservation_id, table_id, unit_price_cents)
  VALUES (v_res_id, p_table_id, v_table.price_cents);

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_res_id,
    'expires_at', v_expires,
    'table_label', v_table.label,
    'seat_count', v_total,
    'subtotal_cents', v_table.price_cents,
    'currency', v_event.currency
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ───────────────────────────────────────────────────────────────────────────
-- record_manual_sale — S-12. From 20260915131000. A whole table is ONE line at
-- the table price, as the online path records it (copy_reservation_items_to_
-- order). It wrote a line per seat at the ticket-type price, which did not add
-- up to the order's subtotal.
-- ───────────────────────────────────────────────────────────────────────────
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
  v_event     RECORD;
  v_order_id  UUID;
  v_seats     UUID[] := COALESCE(p_seat_ids, ARRAY[]::UUID[]);
  v_locked    UUID[];
  v_tickets   INT := 0;
  v_count     INT;
  v_key       TEXT;
  v_full_tier TEXT;
BEGIN
  SELECT id, organizer_id, currency, status, listing_type INTO v_event FROM events WHERE id = p_event_id;
  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_FOUND');
  END IF;
  IF v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is not on sale.');
  END IF;
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is listed for information only. Tickets are not sold for it.');
  END IF;

  IF p_table_id IS NOT NULL THEN
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
    SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::UUID[]) INTO v_seats
      FROM unnest(v_seats) AS x;
  END IF;

  IF COALESCE(array_length(v_seats, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Choose the seats or the table that were sold.');
  END IF;

  SELECT count(*) INTO v_count
    FROM seats s
    JOIN venue_maps vm ON vm.id = s.venue_map_id
   WHERE s.id = ANY(v_seats) AND vm.event_id = p_event_id;

  IF v_count <> array_length(v_seats, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'Some of those seats are not part of this event.');
  END IF;

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

  v_full_tier := tier_allocation_exceeded(v_seats);
  IF v_full_tier IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
      'message', format('%s tickets have sold out.', v_full_tier));
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
    0,
    'organizer',
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    (p_breakdown->>'buyerTotalCents')::BIGINT,
    p_buyer->>'name', NULLIF(p_buyer->>'email', ''), p_buyer->>'phone',
    p_method, p_note, p_recorded_by, now()
  ) RETURNING id INTO v_order_id;

  UPDATE seats SET status = 'sold' WHERE id = ANY(v_seats);
  IF p_table_id IS NOT NULL THEN
    UPDATE tables SET status = 'sold' WHERE id = p_table_id;
  END IF;

  -- CHANGED (S-12): the receipt lines.
  IF p_table_id IS NOT NULL THEN
    INSERT INTO order_items (order_id, tier_id, seat_id, table_id, label, unit_price_cents)
    SELECT v_order_id, NULL, NULL, t.id, t.label, t.price_cents
      FROM tables t WHERE t.id = p_table_id;
  ELSE
    INSERT INTO order_items (order_id, tier_id, seat_id, table_id, label, unit_price_cents)
    SELECT v_order_id, s.tier_id, s.id, s.table_id,
           s.section_key || ' ' || s.row_label || s.seat_number,
           seat_price_cents(s.id)
      FROM seats s WHERE s.id = ANY(v_seats);
  END IF;

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id)
  SELECT v_order_id, p_event_id, s.id, s.table_id, s.tier_id
    FROM seats s WHERE s.id = ANY(v_seats);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

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


-- ───────────────────────────────────────────────────────────────────────────
-- event_from_prices — S-11.
-- ───────────────────────────────────────────────────────────────────────────
-- "From $X" was the cheapest visible ticket type, whether or not any seat used
-- it, it was on sale, or it had any left — the root of the production listing
-- that advertised "From $100" over seats that sold for nothing. This is the
-- cheapest thing a buyer can actually take:
--
--   general admission  a visible ticket type inside its sale window with stock
--   reserved seating   an available seat priced by such a type (or by its own
--                      override), not at a private table — unless the event
--                      sells whole tables only;
--                      and an available public table with a price, unless the
--                      event sells single seats only.
--
-- Holds are not subtracted: this is a listing figure, refreshed every minute.
-- An event with nothing buyable returns no row, and the listing says so.
CREATE OR REPLACE FUNCTION event_from_prices(p_event_ids UUID[])
RETURNS TABLE (event_id UUID, from_cents BIGINT) AS $$
  WITH ev AS (
    SELECT e.id, e.admission_type, e.purchase_mode
      FROM events e
     WHERE e.id = ANY(p_event_ids)
       AND e.listing_type IS DISTINCT FROM 'display_only'
  ),
  open_tiers AS (
    SELECT tt.id, tt.event_id, tt.price_cents
      FROM ticket_tiers tt
      JOIN ev ON ev.id = tt.event_id
     WHERE NOT tt.is_hidden
       AND (tt.sales_start_at IS NULL OR now() >= tt.sales_start_at)
       AND (tt.sales_end_at IS NULL OR now() < tt.sales_end_at)
       AND (tt.quantity IS NULL OR tt.sold_count < tt.quantity)
  ),
  ga AS (
    SELECT ot.event_id, min(ot.price_cents) AS c
      FROM open_tiers ot
      JOIN ev ON ev.id = ot.event_id AND ev.admission_type = 'general'
     GROUP BY ot.event_id
  ),
  seat_prices AS (
    SELECT vm.event_id, min(COALESCE(s.price_override_cents, ot.price_cents)) AS c
      FROM ev
      JOIN venue_maps vm ON vm.event_id = ev.id
      JOIN seats s ON s.venue_map_id = vm.id AND s.status = 'available'
      LEFT JOIN tables tb ON tb.id = s.table_id
      LEFT JOIN open_tiers ot ON ot.id = s.tier_id
     WHERE ev.admission_type = 'reserved'
       AND ev.purchase_mode <> 'table_only'
       AND NOT COALESCE(tb.is_private, false)
       AND (ot.id IS NOT NULL OR (s.tier_id IS NULL AND s.price_override_cents IS NOT NULL))
     GROUP BY vm.event_id
  ),
  table_prices AS (
    SELECT vm.event_id, min(tb.price_cents) AS c
      FROM ev
      JOIN venue_maps vm ON vm.event_id = ev.id
      JOIN tables tb ON tb.venue_map_id = vm.id
     WHERE ev.admission_type = 'reserved'
       AND ev.purchase_mode <> 'seat_only'
       AND tb.status = 'available'
       AND tb.price_cents IS NOT NULL
       AND NOT tb.is_private
     GROUP BY vm.event_id
  )
  SELECT ev.id, LEAST(ga.c, sp.c, tp.c)::BIGINT
    FROM ev
    LEFT JOIN ga ON ga.event_id = ev.id
    LEFT JOIN seat_prices sp ON sp.event_id = ev.id
    LEFT JOIN table_prices tp ON tp.event_id = ev.id
   WHERE COALESCE(ga.c, sp.c, tp.c) IS NOT NULL;
$$ LANGUAGE sql STABLE SET search_path = public;

REVOKE ALL ON FUNCTION event_from_prices(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION event_from_prices(UUID[]) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- OWNER DECISIONS, 2026-11-10 (TECH-AUDIT-LOG S-10, S-16, S-18).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- S-18: a ticket type's price may change after it has sold.
--
-- The lock existed to stop a price change rewriting what a buyer had agreed
-- to pay. Nothing reads the CURRENT ticket-type price for a past sale: a hold
-- freezes each line's price (reservation_items.unit_price_cents), fulfilment
-- copies it to the order (order_items.unit_price_cents) and the order keeps
-- its whole breakdown. The lock only forced organizers to create a second
-- type and re-map the room to change a price. What protects buyers now is
-- below: a sold price can never change.
-- ───────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_lock_tier_price ON ticket_tiers;
DROP FUNCTION IF EXISTS lock_tier_price_after_sale();

-- Sale prices are final: no UPDATE may change an order's money or a line's
-- price. Nothing in the product does; this makes it a guarantee rather than
-- a habit. Refunds and disputes live in their own columns and are untouched.
CREATE OR REPLACE FUNCTION sale_prices_are_final() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    IF (NEW.quantity, NEW.currency, NEW.subtotal_cents, NEW.discount_cents, NEW.event_tax_cents,
        NEW.commission_cents, NEW.commission_tax_cents, NEW.payment_fee_cents, NEW.fee_bearer,
        NEW.buyer_total_cents, NEW.organizer_net_cents)
       IS DISTINCT FROM
       (OLD.quantity, OLD.currency, OLD.subtotal_cents, OLD.discount_cents, OLD.event_tax_cents,
        OLD.commission_cents, OLD.commission_tax_cents, OLD.payment_fee_cents, OLD.fee_bearer,
        OLD.buyer_total_cents, OLD.organizer_net_cents) THEN
      RAISE EXCEPTION 'SALE_PRICE_IMMUTABLE: order % keeps the amounts it was sold at', OLD.id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (NEW.unit_price_cents, NEW.quantity) IS DISTINCT FROM (OLD.unit_price_cents, OLD.quantity) THEN
      RAISE EXCEPTION 'SALE_PRICE_IMMUTABLE: order line % keeps the price it was sold at', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION sale_prices_are_final() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_prices_final ON orders;
CREATE TRIGGER trg_order_prices_final
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION sale_prices_are_final();

DROP TRIGGER IF EXISTS trg_order_item_prices_final ON order_items;
CREATE TRIGGER trg_order_item_prices_final
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION sale_prices_are_final();


-- ───────────────────────────────────────────────────────────────────────────
-- S-10: price changes on a live event need no review, and every one is logged.
--
-- Written by TRIGGERS, so no path that changes a price can forget to log it.
-- The actor comes from the transaction setting `eventsli.actor_id`, which the
-- two API paths that change prices set (set_tier_price, save_venue_map); a
-- change made any other way is still logged, with no actor.
--
-- A table's TICKET TYPE is logged too: moving a table to another type
-- reprices its seats as surely as editing a number does.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_price_change() RETURNS TRIGGER AS $$
DECLARE
  v_actor  UUID := NULLIF(current_setting('eventsli.actor_id', true), '')::UUID;
  v_event  RECORD;
  v_kind   TEXT;
BEGIN
  IF TG_TABLE_NAME = 'ticket_tiers' THEN
    SELECT id, status INTO v_event FROM events WHERE id = NEW.event_id;
    INSERT INTO admin_audit (actor_id, action, target_type, target_id, payload)
    VALUES (v_actor, 'price.change', 'ticket_tier', NEW.id, jsonb_build_object(
      'eventId', NEW.event_id, 'eventStatus', v_event.status, 'name', NEW.name,
      'field', 'price', 'oldCents', OLD.price_cents, 'newCents', NEW.price_cents,
      'soldBefore', OLD.sold_count));
    RETURN NEW;
  END IF;

  SELECT e.id, e.status INTO v_event
    FROM venue_maps vm JOIN events e ON e.id = vm.event_id WHERE vm.id = NEW.venue_map_id;

  FOREACH v_kind IN ARRAY ARRAY['price', 'seatPrice', 'ticketType'] LOOP
    IF (v_kind = 'price' AND OLD.price_cents IS DISTINCT FROM NEW.price_cents)
       OR (v_kind = 'seatPrice' AND OLD.seat_price_cents IS DISTINCT FROM NEW.seat_price_cents)
       OR (v_kind = 'ticketType' AND OLD.tier_id IS DISTINCT FROM NEW.tier_id) THEN
      INSERT INTO admin_audit (actor_id, action, target_type, target_id, payload)
      VALUES (v_actor, 'price.change', 'table', NEW.id, jsonb_build_object(
        'eventId', v_event.id, 'eventStatus', v_event.status, 'label', NEW.label,
        'field', v_kind,
        'oldCents', CASE v_kind WHEN 'price' THEN OLD.price_cents WHEN 'seatPrice' THEN OLD.seat_price_cents END,
        'newCents', CASE v_kind WHEN 'price' THEN NEW.price_cents WHEN 'seatPrice' THEN NEW.seat_price_cents END,
        'oldTierId', CASE WHEN v_kind = 'ticketType' THEN OLD.tier_id END,
        'newTierId', CASE WHEN v_kind = 'ticketType' THEN NEW.tier_id END));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION log_price_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_tier_price ON ticket_tiers;
CREATE TRIGGER trg_log_tier_price
  AFTER UPDATE OF price_cents ON ticket_tiers
  FOR EACH ROW WHEN (OLD.price_cents IS DISTINCT FROM NEW.price_cents)
  EXECUTE FUNCTION log_price_change();

DROP TRIGGER IF EXISTS trg_log_table_price ON tables;
CREATE TRIGGER trg_log_table_price
  AFTER UPDATE OF price_cents, seat_price_cents, tier_id ON tables
  FOR EACH ROW WHEN (OLD.price_cents IS DISTINCT FROM NEW.price_cents
                     OR OLD.seat_price_cents IS DISTINCT FROM NEW.seat_price_cents
                     OR OLD.tier_id IS DISTINCT FROM NEW.tier_id)
  EXECUTE FUNCTION log_price_change();

-- A ticket type's price change, with who made it, in one transaction.
CREATE OR REPLACE FUNCTION set_tier_price(p_tier_id UUID, p_event_id UUID, p_price_cents BIGINT, p_actor UUID)
RETURNS BIGINT AS $$
DECLARE v_old BIGINT;
BEGIN
  IF p_price_cents IS NULL OR p_price_cents < 0 THEN
    RAISE EXCEPTION 'PRICE_INVALID: a price is a whole number of cents, zero or more';
  END IF;
  PERFORM set_config('eventsli.actor_id', COALESCE(p_actor::TEXT, ''), true);
  SELECT price_cents INTO v_old FROM ticket_tiers WHERE id = p_tier_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: no such ticket type'; END IF;
  UPDATE ticket_tiers SET price_cents = p_price_cents WHERE id = p_tier_id;
  RETURN v_old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION set_tier_price(UUID, UUID, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_tier_price(UUID, UUID, BIGINT, UUID) TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- S-16: an issued ticket keeps the table name and seat it was issued with.
--
-- A ticket read its table's label and its seat's section and row live, so
-- renaming a table after the sale renamed every ticket already in a buyer's
-- inbox, and the door list disagreed with the email the guest was holding.
-- The names are snapshotted when the ticket is issued — by a trigger, so every
-- path that issues one (online, free claim, door sale) does it — and cannot
-- change afterwards. A ticket issued after a rename carries the new name.
--
-- A theatre row's seat (its table has a section, S-19) is snapshotted with NO
-- table name: it is "Section Gold · Row C · Seat 5", not a table booking.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS issued_table_label TEXT,
  ADD COLUMN IF NOT EXISTS issued_section     TEXT,
  ADD COLUMN IF NOT EXISTS issued_row         TEXT,
  ADD COLUMN IF NOT EXISTS issued_seat_number TEXT;

COMMENT ON COLUMN tickets.issued_table_label IS
  'The table''s name when this ticket was issued. Immutable. NULL for a general-admission ticket or a seat in a seating section.';

-- The trigger first, then the backfill: a trigger created after the backfill
-- would refuse nothing, but the immutability check must not see the backfill
-- as a change, so the backfill runs while it does not exist yet.
DROP TRIGGER IF EXISTS trg_snapshot_ticket_place ON tickets;

-- Backfill: the best record there is of tickets already issued is the names
-- as they are now (after the S-19 correction above).
UPDATE tickets t
   SET issued_section = s.section_key, issued_row = s.row_label, issued_seat_number = s.seat_number
  FROM seats s
 WHERE s.id = t.seat_id AND t.issued_section IS NULL;
UPDATE tickets t
   SET issued_table_label = tb.label
  FROM tables tb
 WHERE tb.id = t.table_id AND tb.section_name IS NULL AND t.issued_table_label IS NULL;

CREATE OR REPLACE FUNCTION snapshot_ticket_place() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.seat_id IS NOT NULL AND NEW.issued_section IS NULL THEN
      SELECT s.section_key, s.row_label, s.seat_number
        INTO NEW.issued_section, NEW.issued_row, NEW.issued_seat_number
        FROM seats s WHERE s.id = NEW.seat_id;
    END IF;
    IF NEW.table_id IS NOT NULL AND NEW.issued_table_label IS NULL THEN
      SELECT CASE WHEN tb.section_name IS NULL THEN tb.label END
        INTO NEW.issued_table_label
        FROM tables tb WHERE tb.id = NEW.table_id;
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.issued_table_label, NEW.issued_section, NEW.issued_row, NEW.issued_seat_number)
     IS DISTINCT FROM
     (OLD.issued_table_label, OLD.issued_section, OLD.issued_row, OLD.issued_seat_number) THEN
    RAISE EXCEPTION 'TICKET_PLACE_IMMUTABLE: ticket % keeps the table and seat it was issued with', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION snapshot_ticket_place() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_snapshot_ticket_place
  BEFORE INSERT OR UPDATE OF issued_table_label, issued_section, issued_row, issued_seat_number ON tickets
  FOR EACH ROW EXECUTE FUNCTION snapshot_ticket_place();

-- The door, the check-in app and its offline manifest read the snapshot first.
-- Each is its live definition with only the seat and table expressions changed.

-- check_in_ticket_v2 — from 20261108090000_checkin_v2.sql, reading the issued snapshot first (S-16).
CREATE OR REPLACE FUNCTION check_in_ticket_v2(
  p_event_id         UUID,
  p_ticket_id        UUID,
  p_qr_version       INT,
  p_device_id        UUID,
  p_client_scan_id   TEXT,
  p_occurred_at      TIMESTAMPTZ DEFAULT NULL,
  p_method           TEXT        DEFAULT 'scan',
  p_offline_admitted BOOLEAN     DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_ticket   RECORD;
  v_event    RECORD;
  v_first    RECORD;
  v_gate     JSONB;
  v_card     JSONB;
  v_replay   JSONB;
  v_refusal  TEXT;
  v_message  TEXT;
  v_conflict BOOLEAN;
  v_method   TEXT := COALESCE(p_method, 'scan');
  -- The door's clock, within reason. A scan cannot have happened in the future,
  -- and nothing a device holds is older than its 48-hour queue.
  v_when     TIMESTAMPTZ := LEAST(
                GREATEST(COALESCE(p_occurred_at, now()), now() - interval '48 hours'),
                now());
BEGIN
  IF v_method NOT IN ('scan', 'manual', 'offline') THEN
    RAISE EXCEPTION 'unknown check-in method %', v_method USING ERRCODE = '22023';
  END IF;

  -- ── Replay, before anything else ──
  -- A re-uploaded offline scan must get its original answer, not be refused as
  -- a duplicate of itself.
  v_replay := check_in_replay(p_event_id, p_client_scan_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT t.id, t.status, t.scanned_at, t.qr_version, t.transfer_count,
         o.status AS order_status,
         -- Who the door should expect. The ticket's own name when it has one;
         -- otherwise the buyer — except after a transfer, when the buyer is
         -- precisely the person who should NOT be standing there.
         CASE
           WHEN NULLIF(btrim(t.attendee_name), '') IS NOT NULL THEN btrim(t.attendee_name)
           WHEN t.transfer_count > 0 THEN NULL
           ELSE COALESCE(NULLIF(btrim(o.guest_name), ''), NULLIF(btrim(p.full_name), ''))
         END AS holder,
         NULLIF(btrim(t.attendee_name), '') IS NULL AND t.transfer_count = 0 AS holder_is_buyer,
         tt.name AS tier_name, tt.kind::TEXT AS tier_kind,
         COALESCE(t.issued_section, s.section_key) AS section_key, COALESCE(t.issued_row, s.row_label) AS row_label, COALESCE(t.issued_seat_number, s.seat_number) AS seat_number, (CASE WHEN t.issued_section IS NOT NULL OR t.issued_table_label IS NOT NULL THEN t.issued_table_label ELSE tb.label END) AS table_label
    INTO v_ticket
    FROM tickets t
    JOIN orders o             ON o.id = t.order_id
    LEFT JOIN profiles p      ON p.id = o.user_id
    LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
    LEFT JOIN seats s         ON s.id = t.seat_id
    LEFT JOIN tables tb       ON tb.id = t.table_id
   WHERE t.id = p_ticket_id
     AND t.event_id = p_event_id
     FOR UPDATE OF t;   -- the lock that makes two doors take turns

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'result', 'not_found',
      'message', 'That ticket does not exist.');
  END IF;

  -- ── Replay, again, under the lock ──
  -- Two uploads of the same scan arriving together both miss the first check;
  -- the second one waits on the row lock above and, by the time it gets it,
  -- the first has committed and is visible here.
  v_replay := check_in_replay(p_event_id, p_client_scan_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT id, title, status, starts_at, timezone INTO v_event
    FROM events WHERE id = p_event_id;

  -- What the door shows about the ticket, whatever the answer.
  v_card := jsonb_build_object(
    'ticket_id',       v_ticket.id,
    'attendee',        v_ticket.holder,
    'holder_is_buyer', v_ticket.holder IS NOT NULL AND v_ticket.holder_is_buyer,
    'tier',            v_ticket.tier_name,
    'tier_kind',       v_ticket.tier_kind,
    'seat',            CASE WHEN v_ticket.seat_number IS NOT NULL
                         THEN concat_ws(' ', v_ticket.section_key, concat(v_ticket.row_label, v_ticket.seat_number)) END,
    'table',           v_ticket.table_label,
    'event_title',     v_event.title,
    'event_starts_at', v_event.starts_at,
    'event_timezone',  v_event.timezone,
    'method',          v_method);

  -- A locked gate is the gate's state, not a fact about this ticket: it is not
  -- logged, and it is answered before anything else about the event.
  v_gate := scanner_is_locked(p_event_id);
  IF (v_gate->>'locked')::BOOLEAN THEN
    RETURN jsonb_build_object('ok', false, 'result', 'scanner_locked',
      'reason', v_gate->>'reason',
      'message', 'Scanning is switched off for this event.');
  END IF;

  -- ── Refusals about the ticket or its event ──
  IF v_event.status = 'cancelled' THEN
    v_refusal := 'event_cancelled'; v_message := 'This event was cancelled.';
  ELSIF v_event.status NOT IN ('published', 'archived') THEN
    v_refusal := 'event_not_open'; v_message := 'This event is not open for entry.';
  ELSIF v_ticket.status = 'void' THEN
    v_refusal := 'void'; v_message := 'This ticket is no longer valid.';
  ELSIF v_ticket.order_status <> 'paid' THEN
    v_refusal := 'void'; v_message := 'The order for this ticket was cancelled or refunded.';
  ELSIF COALESCE(p_qr_version, 0) < v_ticket.qr_version THEN
    v_refusal := 'transferred';
    v_message := 'This ticket was transferred to someone else. This code no longer admits.';
  END IF;

  IF v_refusal IS NOT NULL THEN
    -- Logged so the organizer can see what was turned away, but WITHOUT the
    -- scan id: these answers can change (an event reopens, a transfer is
    -- corrected), and a re-upload should be judged again, not replayed.
    INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, method, detail)
    VALUES (p_ticket_id, p_event_id, p_device_id, v_refusal, v_when, v_method, v_message);
    RETURN jsonb_build_object('ok', false, 'result', v_refusal, 'message', v_message) || v_card;
  END IF;

  -- ── Already in ──
  IF v_ticket.status = 'scanned' THEN
    -- The refusal carries WHEN, and WHERE. "Already used" starts an argument at
    -- the door; "already used at 19:04 at the north door" ends one.
    SELECT sc.occurred_at, d.label AS device_label, pr.full_name AS staff_name
      INTO v_first
      FROM scans sc
      LEFT JOIN scan_devices d ON d.id = sc.device_id
      LEFT JOIN event_staff es ON es.id = d.staff_id
      LEFT JOIN profiles pr    ON pr.id = es.user_id
     WHERE sc.ticket_id = p_ticket_id AND sc.result = 'admitted'
     ORDER BY sc.scanned_at DESC
     LIMIT 1;

    -- A device that ALREADY let this person in while offline, uploading after
    -- another door admitted the same ticket: two people are inside on one
    -- ticket. Nothing to decide at the door any more — flagged for the organizer.
    v_conflict := v_method = 'offline' AND COALESCE(p_offline_admitted, false);

    BEGIN
      INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, client_scan_id, method, conflict, detail)
      VALUES (p_ticket_id, p_event_id, p_device_id, 'duplicate', v_when, p_client_scan_id, v_method, v_conflict,
              'already scanned at ' || v_ticket.scanned_at);
    EXCEPTION WHEN unique_violation THEN
      RETURN COALESCE(check_in_replay(p_event_id, p_client_scan_id),
        jsonb_build_object('ok', false, 'result', 'error', 'message', 'That scan id was already used.'));
    END;

    RETURN jsonb_build_object(
      'ok', false, 'result', 'duplicate',
      'scanned_at', v_ticket.scanned_at,
      'conflict', v_conflict,
      'first_scan', jsonb_build_object(
        'at', COALESCE(v_first.occurred_at, v_ticket.scanned_at),
        'device', v_first.device_label,
        'staff', v_first.staff_name),
      'message', 'Already scanned at '
        || to_char(v_ticket.scanned_at AT TIME ZONE COALESCE(v_event.timezone, 'UTC'), 'HH24:MI')
    ) || v_card;
  END IF;

  -- ── Admit ──
  BEGIN
    UPDATE tickets SET status = 'scanned', scanned_at = v_when WHERE id = p_ticket_id;
    INSERT INTO scans (ticket_id, event_id, device_id, result, occurred_at, client_scan_id, method)
    VALUES (p_ticket_id, p_event_id, p_device_id, 'admitted', v_when, p_client_scan_id, v_method);
  EXCEPTION WHEN unique_violation THEN
    -- The same scan id on a different ticket. Rolled back to the savepoint, so
    -- the ticket above is untouched.
    RETURN COALESCE(check_in_replay(p_event_id, p_client_scan_id),
      jsonb_build_object('ok', false, 'result', 'error', 'message', 'That scan id was already used.'));
  END;

  RETURN jsonb_build_object('ok', true, 'result', 'admitted', 'scanned_at', v_when) || v_card;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- event_door_list — from 20261109090000_door_list_search.sql, reading the issued snapshot first (S-16).
CREATE OR REPLACE FUNCTION event_door_list(
  p_event_id UUID, p_q TEXT DEFAULT NULL, p_status TEXT DEFAULT 'all',
  p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
) RETURNS JSONB AS $$
  WITH search AS (
    SELECT NULLIF(btrim(p_q), '') AS raw,
           ARRAY(SELECT w
                   FROM regexp_split_to_table(door_fold(btrim(p_q)), '[[:space:],;]+') AS w
                  WHERE w <> ''
                  LIMIT 8) AS words
  ),
  base AS (
    SELECT t.id, t.status, t.scanned_at,
           door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name) AS holder,
           NULLIF(btrim(t.attendee_name), '') IS NULL AND t.transfer_count = 0 AS holder_is_buyer,
           COALESCE(t.attendee_email::TEXT, o.guest_email::TEXT, p.email::TEXT) AS email,
           tt.name AS tier,
           CASE WHEN COALESCE(t.issued_seat_number, s.seat_number) IS NOT NULL
             THEN concat_ws(' ', COALESCE(t.issued_section, s.section_key), concat(COALESCE(t.issued_row, s.row_label), COALESCE(t.issued_seat_number, s.seat_number))) END AS seat,
           (CASE WHEN t.issued_section IS NOT NULL OR t.issued_table_label IS NOT NULL THEN t.issued_table_label ELSE tb.label END) AS table_label
      FROM tickets t
      JOIN orders o             ON o.id = t.order_id AND o.status = 'paid'
      LEFT JOIN profiles p      ON p.id = o.user_id
      LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
      LEFT JOIN seats s         ON s.id = t.seat_id
      LEFT JOIN tables tb       ON tb.id = t.table_id
     WHERE t.event_id = p_event_id
       AND t.status IN ('valid', 'scanned')
  ),
  filtered AS (
    SELECT b.*
      FROM base b, search q
     WHERE (COALESCE(p_status, 'all') = 'all'
            OR (p_status = 'in'  AND b.status = 'scanned')
            OR (p_status = 'out' AND b.status = 'valid'))
       AND (q.raw IS NULL
            OR b.id::TEXT LIKE lower(q.raw) || '%'
            OR (cardinality(q.words) > 0 AND NOT EXISTS (
                  SELECT 1
                    FROM unnest(q.words) AS w
                   WHERE strpos(door_fold(b.holder) || ' ' || door_fold(b.email), w) = 0)))
  ),
  page AS (
    SELECT * FROM filtered
     ORDER BY holder NULLS LAST, id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticketId', id, 'status', status, 'scannedAt', scanned_at,
               'holder', holder, 'holderIsBuyer', holder IS NOT NULL AND holder_is_buyer,
               'tier', tier, 'seat', seat, 'table', table_label)
             ORDER BY holder NULLS LAST, id)
        FROM page), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ticket_door_detail — from 20261108100000_checkin_app_api.sql, reading the issued snapshot first (S-16).
CREATE OR REPLACE FUNCTION ticket_door_detail(p_event_id UUID, p_ticket_id UUID)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'ticketId', t.id,
    'status', t.status,
    'orderPaid', o.status = 'paid',
    'scannedAt', t.scanned_at,
    'qrVersion', t.qr_version,
    'transferred', t.transfer_count > 0,
    'holder', door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name),
    'holderIsBuyer', NULLIF(btrim(t.attendee_name), '') IS NULL AND t.transfer_count = 0
                     AND door_holder(t.attendee_name, t.transfer_count, o.guest_name, p.full_name) IS NOT NULL,
    'tier', tt.name,
    'seat', CASE WHEN COALESCE(t.issued_seat_number, s.seat_number) IS NOT NULL
              THEN concat_ws(' ', COALESCE(t.issued_section, s.section_key), concat(COALESCE(t.issued_row, s.row_label), COALESCE(t.issued_seat_number, s.seat_number))) END,
    'table', (CASE WHEN t.issued_section IS NOT NULL OR t.issued_table_label IS NOT NULL THEN t.issued_table_label ELSE tb.label END),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'result', sc.result, 'method', sc.method, 'conflict', sc.conflict,
               'at', COALESCE(sc.occurred_at, sc.scanned_at), 'device', d.label,
               'staff', pr.full_name, 'detail', sc.detail)
             ORDER BY COALESCE(sc.occurred_at, sc.scanned_at) DESC, sc.id DESC)
        FROM scans sc
        LEFT JOIN scan_devices d ON d.id = sc.device_id
        LEFT JOIN event_staff es ON es.id = d.staff_id
        LEFT JOIN profiles pr    ON pr.id = es.user_id
       WHERE sc.ticket_id = t.id AND sc.event_id = p_event_id), '[]'::jsonb)
  )
  FROM tickets t
  JOIN orders o             ON o.id = t.order_id
  LEFT JOIN profiles p      ON p.id = o.user_id
  LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
  LEFT JOIN seats s         ON s.id = t.seat_id
  LEFT JOIN tables tb       ON tb.id = t.table_id
  WHERE t.id = p_ticket_id AND t.event_id = p_event_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- event_door_manifest — from 20261110090000_offline_manifest.sql, reading the issued snapshot first (S-16).
CREATE OR REPLACE FUNCTION event_door_manifest(
  p_event_id UUID,
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_after_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 1000,
  p_names BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
  WITH page AS (
    SELECT t.id, t.qr_version, t.status, o.status AS order_status, t.scanned_at, t.updated_at,
           t.attendee_name, t.transfer_count, o.guest_name, p.full_name,
           tt.name AS tier, COALESCE(t.issued_section, s.section_key) AS section_key, COALESCE(t.issued_row, s.row_label) AS row_label, COALESCE(t.issued_seat_number, s.seat_number) AS seat_number, (CASE WHEN t.issued_section IS NOT NULL OR t.issued_table_label IS NOT NULL THEN t.issued_table_label ELSE tb.label END) AS table_label
      FROM tickets t
      JOIN orders o             ON o.id = t.order_id
      LEFT JOIN profiles p      ON p.id = o.user_id
      LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
      LEFT JOIN seats s         ON s.id = t.seat_id
      LEFT JOIN tables tb       ON tb.id = t.table_id
     WHERE t.event_id = p_event_id
       AND (p_since IS NULL OR t.updated_at > p_since)
       AND (p_after_at IS NULL OR (t.updated_at, t.id) > (p_after_at, p_after_id))
     ORDER BY t.updated_at, t.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 2000)
  )
  SELECT jsonb_build_object(
    'now', now(),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticketId', id,
               'v', qr_version,
               'status', CASE WHEN status = 'void' OR order_status <> 'paid' THEN 'void' ELSE status::TEXT END,
               'scannedAt', scanned_at,
               'updatedAt', updated_at,
               'tier', tier,
               'seat', CASE WHEN seat_number IS NOT NULL
                         THEN concat_ws(' ', section_key, concat(row_label, seat_number)) END,
               'table', table_label,
               'holder', CASE WHEN p_names
                           THEN door_holder(attendee_name, transfer_count, guest_name, full_name) END)
             ORDER BY updated_at, id)
        FROM page), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
