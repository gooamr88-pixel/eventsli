-- ═══════════════════════════════════════════════════════════════════════════
-- PLACES AT A TABLE — the stock, the tickets and the hold (2026-11-25).
--
-- The mode was added in 20261220090000. A buyer at a `table_places` event
-- asks for "4 places at table 12"; nobody chooses a seat.
--
--
-- THE STOCK IS STILL SEATS. A table's places ARE its seats: the map already
-- has one row per chair, with its own status, ticket type and price, and
-- every rule about selling one — holds that expire, the per-order caps, sale
-- windows, allocations, private tables, the race between two buyers — is
-- written against seats and has been audited there. So the hold below
-- chooses N free seats at the table ITSELF and hands them to `hold_seats`.
-- Nothing about capacity is new, so nothing about capacity can be wrong in a
-- new way.
--
-- THE TICKET HAS NO SEAT. What makes it "no seat assigned" is the ticket: it
-- is issued with the TABLE and without `seat_id`, and the seat it used is
-- kept out of sight in `place_seat_id`. Every place a ticket is shown — the
-- ticket page, the emails, the wallet pass, the door list, the check-in app
-- and its offline manifest — already reads a ticket with a table and no seat
-- as "Table 12", because that is how they read whatever has no seat. None of
-- them had to change, and none of them can leak a seat number.
--
-- Done by a trigger on INSERT, so every path that issues a ticket — online
-- checkout, a free claim, an offline payment confirmed, a door sale — issues
-- it the same way, without any of those functions being rewritten.
--
-- A PLACE GIVEN BACK IS ON SALE AGAIN. When one of these tickets is voided
-- (a void or refund in Orders, a refund in Stripe, a lost dispute), its seat
-- returns to the table. The void functions free seats through
-- `tickets.seat_id`, which these tickets do not have, so the trigger below
-- does it for them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Where the place is kept ───────────────────────────────────────────
-- NO FOREIGN KEY, deliberately. A second key from tickets to seats gives the
-- API (PostgREST) two ways to embed `seats` in a ticket, and it then refuses
-- every `tickets → seats ( … )` read in the product as ambiguous — the ticket
-- page, the emails, the orders list. The integrity that matters is enforced
-- here: one live ticket per place (the index below), and the hold and the
-- release only ever touch a seat of this event's map.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS place_seat_id UUID;

COMMENT ON COLUMN tickets.place_seat_id IS
  'Places-at-a-table events: the seat this ticket takes up at its table. Stock only — never shown. '
  'seat_id is NULL on these tickets so no screen can name a seat.';

-- One live ticket per place, as 20261216090000 guarantees for seat_id.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_per_place
  ON tickets (place_seat_id) WHERE place_seat_id IS NOT NULL AND status <> 'void';


-- ─── 2. Issued with the table, not the seat ───────────────────────────────
-- Named so it fires AFTER trg_apply_ticket_holder (which matches the buyer's
-- holder details by seat) and BEFORE trg_snapshot_ticket_place (which then
-- snapshots the table name and no seat). Same-event triggers fire in name
-- order: trg_apply… < trg_b… < trg_snapshot…
--
-- A seat in a seating ROW (its table has a section name) keeps its seat: a
-- theatre row's place IS its seat number, and a row has no table to name.
CREATE OR REPLACE FUNCTION table_place_ticket() RETURNS TRIGGER AS $$
DECLARE
  v_mode    purchase_mode;
  v_table   UUID;
  v_section TEXT;
BEGIN
  IF NEW.seat_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT purchase_mode INTO v_mode FROM events WHERE id = NEW.event_id;
  IF v_mode IS DISTINCT FROM 'table_places' THEN
    RETURN NEW;
  END IF;

  SELECT s.table_id, tb.section_name INTO v_table, v_section
    FROM seats s LEFT JOIN tables tb ON tb.id = s.table_id
   WHERE s.id = NEW.seat_id;

  IF v_table IS NOT NULL AND v_section IS NULL THEN
    NEW.place_seat_id := NEW.seat_id;
    NEW.table_id := v_table;
    NEW.seat_id := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION table_place_ticket() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_b_table_place ON tickets;
CREATE TRIGGER trg_b_table_place
  BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION table_place_ticket();


-- ─── 3. A voided place goes back on sale ──────────────────────────────────
CREATE OR REPLACE FUNCTION table_place_release() RETURNS TRIGGER AS $$
BEGIN
  UPDATE seats SET status = 'available', held_by_reservation = NULL
   WHERE id = NEW.place_seat_id AND status = 'sold'
     AND NOT EXISTS (
       SELECT 1 FROM tickets t
        WHERE t.id <> NEW.id AND t.status <> 'void'
          AND (t.place_seat_id = NEW.place_seat_id OR t.seat_id = NEW.place_seat_id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION table_place_release() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_table_place_release ON tickets;
CREATE TRIGGER trg_table_place_release
  AFTER UPDATE OF status ON tickets
  FOR EACH ROW
  WHEN (NEW.place_seat_id IS NOT NULL AND NEW.status = 'void' AND OLD.status IS DISTINCT FROM 'void')
  EXECUTE FUNCTION table_place_release();


-- ─── 4. The hold: N places at each chosen table ───────────────────────────
-- p_lines: [{ "tableId": uuid, "quantity": int }, …] — one line per table.
--
-- The seats are chosen here, locked as they are chosen (SKIP LOCKED: a seat
-- another buyer is holding this instant is not waited for, it is simply not
-- one of the free ones), and then held by `hold_seats` in the same
-- transaction. Rows this transaction has locked are not "locked" to it, so
-- `hold_seats` takes exactly these seats and runs every rule it always runs.
--
-- Lowest seat numbers first, so the price the buyer was shown (the page sums
-- the same seats in the same order) is the price they are held at even when a
-- table mixes ticket types.
CREATE OR REPLACE FUNCTION hold_table_places(
  p_event_id    UUID,
  p_user_id     UUID,
  p_lines       JSONB,
  p_ttl_minutes INT DEFAULT 35
) RETURNS JSONB AS $$
DECLARE
  v_mode    purchase_mode;
  v_line    JSONB;
  v_qty     INT;
  v_table   RECORD;
  v_seen    UUID[] := ARRAY[]::UUID[];
  v_ids     UUID[] := ARRAY[]::UUID[];
  v_pick    UUID[];
  v_got     INT;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Choose a table and how many places.');
  END IF;

  SELECT purchase_mode INTO v_mode FROM events WHERE id = p_event_id;
  IF v_mode IS DISTINCT FROM 'table_places' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event does not book places at a table. Choose seats on the map instead.');
  END IF;

  -- The tables first, in id order: the order hold_seats and hold_table take
  -- them in, so two buyers at the same tables queue rather than deadlock.
  PERFORM 1
     FROM tables t JOIN venue_maps vm ON vm.id = t.venue_map_id
    WHERE vm.event_id = p_event_id
      AND t.id IN (SELECT (l->>'tableId')::UUID FROM jsonb_array_elements(p_lines) l)
    ORDER BY t.id
      FOR UPDATE OF t;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_qty := NULLIF(v_line->>'quantity', '')::INT;
    IF v_qty IS NULL OR v_qty < 1 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
        'message', 'Choose at least one place at each table.');
    END IF;

    SELECT t.id, t.label INTO v_table
      FROM tables t JOIN venue_maps vm ON vm.id = t.venue_map_id
     WHERE t.id = (v_line->>'tableId')::UUID AND vm.event_id = p_event_id;
    IF v_table.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
        'message', 'That table is not part of this event.');
    END IF;
    IF v_table.id = ANY(v_seen) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
        'message', 'Each table can be chosen once. Change how many places instead.');
    END IF;
    v_seen := v_seen || v_table.id;

    SELECT array_agg(x.id) INTO v_pick
      FROM (
        SELECT s.id
          FROM seats s
         WHERE s.table_id = v_table.id AND s.status = 'available'
         ORDER BY (s.seat_number ~ '^[0-9]+$') DESC,
                  CASE WHEN s.seat_number ~ '^[0-9]+$' THEN s.seat_number::INT END,
                  s.seat_number
         LIMIT v_qty
           FOR UPDATE OF s SKIP LOCKED
      ) x;
    v_got := COALESCE(array_length(v_pick, 1), 0);

    IF v_got < v_qty THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SEAT_UNAVAILABLE',
        'message', CASE WHEN v_got = 0
          THEN format('Table %s has just filled up. Choose another table.', v_table.label)
          ELSE format('Only %s %s left at table %s. Choose fewer, or add another table.',
                      v_got, CASE WHEN v_got = 1 THEN 'place is' ELSE 'places are' END, v_table.label) END,
        'requested', v_qty, 'available', v_got, 'table_label', v_table.label);
    END IF;
    v_ids := v_ids || v_pick;
  END LOOP;

  -- Every rule a seat hold has: published, caps, sale windows, allocations,
  -- prices — and the reservation itself.
  RETURN hold_seats(p_event_id, p_user_id, v_ids, p_ttl_minutes);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION hold_table_places(UUID, UUID, JSONB, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hold_table_places(UUID, UUID, JSONB, INT) TO service_role;
