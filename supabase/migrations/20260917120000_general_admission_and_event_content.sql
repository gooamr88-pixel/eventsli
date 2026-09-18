-- ═══════════════════════════════════════════════════════════════════════════
-- GENERAL ADMISSION, FREE EVENTS, TICKET RULES, AND EVENT CONTENT.
--
-- Four things land together because the organizer experience needs all four to
-- make sense, and three of them are load-bearing for the fourth.
--
--
-- 1. GENERAL ADMISSION — tickets with no seat behind them.
--
-- Until now every ticketed event needed a venue map. `purchase_mode` chooses
-- between selling seats and selling whole tables; there was no way to say "a
-- thousand tickets, no map", which is how most events in the world are sold.
-- An organizer running a conference or a club night had to draw a fictional
-- seating plan to sell anything.
--
-- GA STOCK IS THE TIER'S `quantity`, and nothing else. The alternative —
-- generating a `seats` row per GA ticket — was rejected: `seats` already
-- supports `table_id IS NULL`, so it would have worked with no new hold path at
-- all, but a 5,000-capacity GA event means 5,000 rows standing for nothing
-- physical, each carrying a seat number that is a lie to whoever reads their
-- ticket. The allocation machinery added in 20260915131000 already counts sold
-- and held against `quantity` under a row lock; GA reuses exactly that.
--
-- Which makes `reservation_items` three-sided instead of two. An item was a
-- seat XOR a table; it is now a seat, a table, or a QUANTITY of a tier. The
-- constraint is rewritten rather than dropped, because the thing it was
-- protecting — an item that is nothing at all, or two things at once — is still
-- worth refusing.
--
--
-- 2. FREE EVENTS. Nothing here stores "this event is free": it is derived from
-- the tiers, every time, because a stored flag and a price list drift apart and
-- only one of them is what the buyer is charged. The API computes it and the
-- organizer's launch checklist stops demanding a payment method when the answer
-- is yes. The DB's part is only to keep allowing `price_cents = 0`, which it
-- always did.
--
--
-- 3. TICKET RULES. Per-tier sale windows, per-tier order caps and hidden tiers.
-- All three are enforced in the hold functions, not in a controller — the same
-- reason the allocation check moved into the database: a rule in a controller
-- is one code path away from not existing, and this codebase has three paths
-- that take stock (seats, tables, door sales).
--
-- HIDDEN IS NOT CLOSED. A hidden tier is omitted from the public listing and
-- bought through a direct link, which is what makes comp and press tickets
-- work. It is deliberately NOT refused by the hold functions — refusing it
-- would make the link it exists for useless.
--
--
-- 4. EVENT CONTENT — logo, gallery, video, sponsors, policies, schedule,
-- highlights, coordinates. All additive, none of it on the money path.
--
-- Note the existing `sponsors` table is the PLATFORM homepage's and has no
-- `event_id`. Event sponsors are a separate table rather than a nullable column
-- bolted onto that one: they are edited by a different person, in a different
-- place, under different permissions, and the homepage's sponsor list must not
-- be reachable from an event's editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. ADMISSION TYPE
-- ───────────────────────────────────────────────────────────────────────────

-- 'reserved' is the default so every existing event keeps behaving exactly as
-- it does today. There is no backfill and there cannot be one: an event with a
-- map is reserved, and that is what the default says.
DO $$ BEGIN
  CREATE TYPE admission_type AS ENUM ('reserved', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS admission_type admission_type NOT NULL DEFAULT 'reserved';

COMMENT ON COLUMN events.admission_type IS
  'reserved = tickets are bound to seats or tables on a venue map. '
  'general = tickets are stock counted against ticket_tiers.quantity, no map.';

-- `purchase_mode` only means anything for a reserved event — it chooses between
-- seats and whole tables, and a GA event has neither. Left as it is rather than
-- made nullable: a GA event keeps whatever value it had, every reader is
-- already required to check `admission_type` first, and a nullable column would
-- make three existing hold paths handle a NULL they never see.


-- ───────────────────────────────────────────────────────────────────────────
-- 2. TICKET TYPE RULES
-- ───────────────────────────────────────────────────────────────────────────

-- A label, not a rule. VIP and Early Bird differ from Standard in price and in
-- when they sell, both of which are already columns — what this adds is the
-- badge a buyer recognises and the defaults the editor offers. Nothing in the
-- money path branches on it, and that is deliberate: the day it does, renaming
-- a tier changes what somebody is charged.
--
-- 'complimentary' is the one with a meaning attached, and even then only a
-- suggested one: comp tickets default to free and hidden, because a guest list
-- that appears on the public page is not a guest list.
DO $$ BEGIN
  CREATE TYPE ticket_tier_kind AS ENUM ('standard', 'general', 'vip', 'early_bird', 'complimentary');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ticket_tiers
  ADD COLUMN IF NOT EXISTS kind           ticket_tier_kind NOT NULL DEFAULT 'standard',
  -- NULL at either end means "no limit at that end". Both NULL — the default —
  -- is a tier that sells for as long as the event is published, which is what
  -- every tier does today.
  ADD COLUMN IF NOT EXISTS sales_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sales_end_at   TIMESTAMPTZ,
  -- NULL = fall back to the event's `max_tickets_per_order`. A per-tier cap can
  -- only ever be TIGHTER than the event's: the event cap is checked first and
  -- separately, so a tier cannot be used to raise it.
  ADD COLUMN IF NOT EXISTS max_per_order  INT,
  -- Omitted from the public listing, still buyable through a direct link.
  ADD COLUMN IF NOT EXISTS is_hidden      BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ticket_tiers DROP CONSTRAINT IF EXISTS tier_sale_window_ordered;
ALTER TABLE ticket_tiers DROP CONSTRAINT IF EXISTS tier_max_per_order_sane;

ALTER TABLE ticket_tiers
  ADD CONSTRAINT tier_sale_window_ordered
    CHECK (sales_start_at IS NULL OR sales_end_at IS NULL OR sales_end_at > sales_start_at),
  ADD CONSTRAINT tier_max_per_order_sane
    CHECK (max_per_order IS NULL OR max_per_order BETWEEN 1 AND 100);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. RESERVATION ITEMS BECOME THREE-SIDED
-- ───────────────────────────────────────────────────────────────────────────

-- Every existing row is a seat or a table, and both are one ticket, so the
-- default is right for all of them and the backfill is nothing.
ALTER TABLE reservation_items
  ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 1);

ALTER TABLE reservation_items DROP CONSTRAINT IF EXISTS item_is_seat_xor_table;

-- Exactly one of the three shapes. Spelled out rather than shortened, because
-- the thing being refused is an item that is NOTHING — no seat, no table and no
-- tier — which would hold no stock, charge for nothing and issue a ticket to
-- nowhere.
ALTER TABLE reservation_items DROP CONSTRAINT IF EXISTS item_is_seat_table_or_general;
ALTER TABLE reservation_items DROP CONSTRAINT IF EXISTS item_quantity_only_for_general;

ALTER TABLE reservation_items
  ADD CONSTRAINT item_is_seat_table_or_general CHECK (
    (seat_id IS NOT NULL AND table_id IS NULL)
    OR (table_id IS NOT NULL AND seat_id IS NULL)
    OR (seat_id IS NULL AND table_id IS NULL AND tier_id IS NOT NULL)
  );

-- A seat or a table is one item. Only a general-admission line may carry more,
-- because only it has nothing physical to count.
ALTER TABLE reservation_items
  ADD CONSTRAINT item_quantity_only_for_general CHECK (
    quantity = 1 OR (seat_id IS NULL AND table_id IS NULL)
  );


-- ───────────────────────────────────────────────────────────────────────────
-- 4. THE ALLOCATION AND SALE-WINDOW CHECKS FOR GENERAL ADMISSION
-- ───────────────────────────────────────────────────────────────────────────

-- The name of the first tier that is outside its sale window, or NULL.
--
-- Shared by every path that takes stock, and NOT concerned with `is_hidden` —
-- a hidden tier is bought through a link, and refusing it here would make that
-- link useless. Hiding is a listing decision; the window is a selling one.
CREATE OR REPLACE FUNCTION tier_sale_window_closed(p_tier_ids UUID[])
RETURNS TEXT AS $$
  SELECT tt.name
    FROM ticket_tiers tt
   WHERE tt.id = ANY(p_tier_ids)
     AND (
       (tt.sales_start_at IS NOT NULL AND now() < tt.sales_start_at)
       OR (tt.sales_end_at IS NOT NULL AND now() >= tt.sales_end_at)
     )
   ORDER BY tt.name
   LIMIT 1;
$$ LANGUAGE sql STABLE SET search_path = public;

REVOKE ALL ON FUNCTION tier_sale_window_closed(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tier_sale_window_closed(UUID[]) TO service_role;


-- How much general-admission stock of a tier is currently held but not sold.
--
-- Counts every ACTIVE reservation, including one whose expiry has passed but
-- which the sweeper has not reached yet. That is the same conservative choice
-- the seat path makes — a seat stays `held` until it is swept — and it errs the
-- only way that is safe: towards refusing a sale for at most a minute, never
-- towards selling the same ticket twice.
CREATE OR REPLACE FUNCTION general_held_count(p_tier_id UUID, p_except_reservation UUID DEFAULT NULL)
RETURNS INT AS $$
  SELECT COALESCE(SUM(ri.quantity), 0)::INT
    FROM reservation_items ri
    JOIN reservations r ON r.id = ri.reservation_id
   WHERE ri.tier_id = p_tier_id
     AND ri.seat_id IS NULL
     AND ri.table_id IS NULL
     AND r.state = 'active'
     AND (p_except_reservation IS NULL OR r.id <> p_except_reservation);
$$ LANGUAGE sql STABLE SET search_path = public;

REVOKE ALL ON FUNCTION general_held_count(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION general_held_count(UUID, UUID) TO service_role;

-- The index that keeps the count above from scanning every reservation item on
-- the platform. It runs inside the tier row lock on the hottest path there is —
-- every competing GA checkout is queued behind it — so it has to be an index
-- hit rather than a scan that grows with lifetime sales.
--
-- Partial, on exactly the rows the function looks at: a seat or table item can
-- never satisfy that WHERE clause, and on a reserved-seating platform those are
-- most of the table.
CREATE INDEX IF NOT EXISTS reservation_items_general_idx
  ON reservation_items (tier_id)
  WHERE seat_id IS NULL AND table_id IS NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. hold_general — the GA equivalent of hold_seats
-- ───────────────────────────────────────────────────────────────────────────
--
-- `p_lines` is [{ "tierId": uuid, "quantity": int }].
--
-- ALL OR NOTHING, exactly like `hold_seats`, and for the same reason: partly
-- filling an order leaves a buyer paying for a group that cannot all get in.
--
-- The tiers are locked in id order before anything is counted. Without that
-- lock, ten buyers at the checkout all read "3 left" and all succeed — which is
-- the failure the allocation work in 20260915131000 was written to close, and
-- reopening it for GA would be worse, since GA is where the volume is.
CREATE OR REPLACE FUNCTION hold_general(
  p_event_id    UUID,
  p_user_id     UUID,          -- NULL for a guest checkout
  p_lines       JSONB,
  p_ttl_minutes INT DEFAULT 35
) RETURNS JSONB AS $$
DECLARE
  v_event      RECORD;
  v_tier       RECORD;
  v_total_qty  INT := 0;
  v_tier_ids   UUID[];
  v_quantities INT[];
  v_held       INT;
  v_i          INT;
  v_closed     TEXT;
  v_res_id     UUID;
  v_expires    TIMESTAMPTZ;
  v_total      BIGINT := 0;
BEGIN
  -- ── Shape of the request ──
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Choose at least one ticket.');
  END IF;

  SELECT id, status, listing_type, admission_type, max_tickets_per_order, currency
    INTO v_event FROM events WHERE id = p_event_id;

  IF v_event IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'Tickets are not on sale for this event.');
  END IF;

  -- BRD §12 — a listing with nothing behind it.
  IF v_event.listing_type = 'display_only' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_PUBLISHED',
      'message', 'This event is listed for information only. Tickets are not sold here.');
  END IF;

  IF v_event.admission_type <> 'general' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'This event has reserved seating. Choose your seats on the map.');
  END IF;

  -- ── Normalise the lines into two parallel arrays, in tier id order ──
  --
  -- COLLAPSING A TIER NAMED TWICE is the point. Sent as two lines of 3, a tier
  -- would otherwise be checked against its allocation twice with 3 each time
  -- and pass, when the 6 it actually asks for should not — which is an
  -- oversell reachable by anyone who can post their own request body.
  --
  -- Arrays rather than a temp table: this function is SECURITY DEFINER and may
  -- be called more than once in a transaction, where a temp table is shared
  -- state between calls that `IF NOT EXISTS` quietly reuses.
  --
  -- The two regex guards are not validation for its own sake — a malformed
  -- value here reaches a cast, and a cast that throws inside the money path
  -- turns a bad request into a 500. Filtering rather than failing means garbage
  -- is simply not a line, and an empty set is answered properly below.
  WITH lines AS (
    SELECT (l->>'tierId')::UUID AS tier_id,
           SUM((l->>'quantity')::INT)::INT AS qty
      FROM jsonb_array_elements(p_lines) l
     WHERE l->>'tierId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND l->>'quantity' ~ '^[0-9]{1,6}$'
     GROUP BY 1
    HAVING SUM((l->>'quantity')::INT) > 0
  )
  SELECT array_agg(tier_id ORDER BY tier_id),
         array_agg(qty ORDER BY tier_id),
         COALESCE(SUM(qty), 0)
    INTO v_tier_ids, v_quantities, v_total_qty
    FROM lines;

  IF v_total_qty = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'Choose at least one ticket.');
  END IF;

  IF v_total_qty > v_event.max_tickets_per_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PURCHASE_LIMIT_EXCEEDED',
      'message', format('You can buy at most %s tickets in one order.',
                        v_event.max_tickets_per_order));
  END IF;

  -- ── Every tier must belong to THIS event ──
  -- Checked before the lock, so a request naming another organizer's tier
  -- cannot take a lock on it at all.
  IF (SELECT count(*) FROM ticket_tiers
       WHERE id = ANY(v_tier_ids) AND event_id = p_event_id) <> array_length(v_tier_ids, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR',
      'message', 'One of those ticket types does not belong to this event.');
  END IF;

  v_closed := tier_sale_window_closed(v_tier_ids);
  IF v_closed IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_NOT_ON_SALE',
      'message', format('%s is not on sale right now.', v_closed));
  END IF;

  -- ── Lock the tiers, in id order, then count ──
  PERFORM 1 FROM ticket_tiers WHERE id = ANY(v_tier_ids) ORDER BY id FOR UPDATE;

  FOR v_i IN 1 .. array_length(v_tier_ids, 1) LOOP
    SELECT * INTO v_tier FROM ticket_tiers WHERE id = v_tier_ids[v_i];

    IF v_tier.max_per_order IS NOT NULL AND v_quantities[v_i] > v_tier.max_per_order THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PURCHASE_LIMIT_EXCEEDED',
        'message', format('You can buy at most %s %s tickets in one order.',
                          v_tier.max_per_order, v_tier.name));
    END IF;

    -- A NULL quantity is unlimited stock, which for a GA tier is a real and
    -- reasonable choice — an organizer who is not capping the room.
    IF v_tier.quantity IS NOT NULL THEN
      -- Read once. Called twice — in the test and again in the message — it is
      -- two scans of the same rows on the hottest path in the system, and the
      -- two answers can disagree.
      v_held := general_held_count(v_tier.id);

      IF v_tier.sold_count + v_held + v_quantities[v_i] > v_tier.quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
          'message', format('%s tickets have sold out.', v_tier.name),
          'tier_id', v_tier.id,
          'remaining', GREATEST(v_tier.quantity - v_tier.sold_count - v_held, 0));
      END IF;
    END IF;
  END LOOP;

  -- ── Take the hold ──
  v_expires := now() + make_interval(mins => p_ttl_minutes);

  INSERT INTO reservations (event_id, user_id, state, expires_at)
  VALUES (p_event_id, p_user_id, 'active', v_expires)
  RETURNING id INTO v_res_id;

  INSERT INTO reservation_items (reservation_id, tier_id, quantity, unit_price_cents)
  SELECT v_res_id, l.tier_id, l.qty, tt.price_cents
    FROM unnest(v_tier_ids, v_quantities) AS l(tier_id, qty)
    JOIN ticket_tiers tt ON tt.id = l.tier_id;

  -- The line total is unit price TIMES quantity. A seat item is always one
  -- ticket so every existing sum ignores the column; a GA line is not.
  SELECT COALESCE(SUM(unit_price_cents * quantity), 0) INTO v_total
    FROM reservation_items WHERE reservation_id = v_res_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_res_id,
    'expires_at', v_expires,
    'seat_count', v_total_qty,
    'subtotal_cents', v_total,
    'currency', v_event.currency
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION hold_general(UUID, UUID, JSONB, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hold_general(UUID, UUID, JSONB, INT) TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. THE SALE WINDOW APPLIES TO RESERVED SEATING TOO
-- ───────────────────────────────────────────────────────────────────────────
--
-- `hold_seats` gains one check and is otherwise byte-for-byte the version from
-- 20260915131000. A sale window that only held for GA would be a rule the
-- organizer sets on a reserved event and watches do nothing.
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

  -- A GA event has no map, so a request naming seats on one is either a stale
  -- page or a forged call. Both get the same answer.
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

  -- ── NEW: the ticket type behind these seats has to be on sale ──
  SELECT tier_sale_window_closed(array_agg(DISTINCT s.tier_id))
    INTO v_closed
    FROM seats s WHERE s.id = ANY(v_locked) AND s.tier_id IS NOT NULL;

  IF v_closed IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_NOT_ON_SALE',
      'message', format('%s is not on sale right now.', v_closed));
  END IF;

  v_full_tier := tier_allocation_exceeded(v_locked);
  IF v_full_tier IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TIER_SOLD_OUT',
      'message', format('%s tickets have sold out.', v_full_tier));
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
-- 7. FULFILMENT ISSUES GENERAL-ADMISSION TICKETS
-- ───────────────────────────────────────────────────────────────────────────

-- The order line carries the quantity, so a GA line is ONE receipt row reading
-- "General × 4" rather than four identical rows.
CREATE OR REPLACE FUNCTION copy_reservation_items_to_order(
  p_reservation_id UUID,
  p_order_id       UUID
) RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  INSERT INTO order_items (order_id, tier_id, seat_id, table_id, label, unit_price_cents, quantity)
  SELECT
    p_order_id,
    ri.tier_id,
    ri.seat_id,
    ri.table_id,
    COALESCE(
      t.label,
      CASE WHEN s.id IS NOT NULL
        THEN s.section_key || ' ' || s.row_label || s.seat_number END,
      -- A GA line has neither a seat nor a table to name it, so the ticket type
      -- is the label. Snapshotted here like every other label, because the tier
      -- can be renamed or deleted and a past receipt has to keep saying what
      -- was actually bought.
      tt.name,
      'Ticket'
    ),
    ri.unit_price_cents,
    ri.quantity
  FROM reservation_items ri
  LEFT JOIN tables       t  ON t.id  = ri.table_id
  LEFT JOIN seats        s  ON s.id  = ri.seat_id
  LEFT JOIN ticket_tiers tt ON tt.id = ri.tier_id
  WHERE ri.reservation_id = p_reservation_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- `fulfill_checkout` as at 20260915130000, plus one block: a general-admission
-- line issues `quantity` tickets carrying the tier and no seat.
--
-- The `sold_count` trigger from 20260915131000 recounts from paid, non-void
-- tickets, so GA allocations start being enforced against real sales the moment
-- these rows land. Nothing else needed changing for that, which is the whole
-- argument for GA reusing the tier allocation rather than inventing a counter.
CREATE OR REPLACE FUNCTION fulfill_checkout(
  p_reservation_id UUID, p_channel payment_channel,
  p_breakdown JSONB, p_buyer JSONB, p_stripe JSONB
) RETURNS JSONB AS $$
DECLARE
  v_res RECORD; v_event RECORD; v_order_id UUID; v_existing UUID;
  v_currency CHAR(3); v_seat_ids UUID[]; v_table_ids UUID[];
  v_tickets INT := 0; v_general INT := 0; v_key TEXT;
  v_promo_id UUID; v_promo_code TEXT;
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
    promo_id, promo_code
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
    v_promo_id, v_promo_code
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
    SELECT COALESCE(v_seat_ids, ARRAY[]::UUID[]) || COALESCE(array_agg(s.id), ARRAY[]::UUID[])
      INTO v_seat_ids FROM seats s WHERE s.table_id = ANY(v_table_ids);
    UPDATE tables SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_table_ids);
  END IF;

  UPDATE seats SET status = 'sold', held_by_reservation = NULL WHERE id = ANY(v_seat_ids);

  INSERT INTO tickets (order_id, event_id, seat_id, table_id, tier_id, attendee_name)
  SELECT v_order_id, v_res.event_id, s.id, s.table_id, s.tier_id, NULL
    FROM seats s WHERE s.id = ANY(v_seat_ids);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  -- ── General admission: one ticket per unit of quantity ──
  -- Every attendee needs their own QR code, so the row that says "4" becomes
  -- four tickets. `generate_series` rather than a loop: it is one statement, and
  -- a loop here would issue them one INSERT at a time on the busiest path in the
  -- system.
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
  PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
    'sale', 'credit', (p_breakdown->>'buyerTotalCents')::BIGINT, v_currency, 'sale_' || v_key);
  IF COALESCE((p_breakdown->>'commissionCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission','debit',(p_breakdown->>'commissionCents')::BIGINT,v_currency,'commission_'||v_key);
  END IF;
  IF COALESCE((p_breakdown->>'commissionTaxCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'commission_tax','debit',(p_breakdown->>'commissionTaxCents')::BIGINT,v_currency,'commission_tax_'||v_key);
  END IF;
  IF COALESCE((p_breakdown->>'paymentFeeCents')::BIGINT,0) > 0 THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'payment_fee','debit',(p_breakdown->>'paymentFeeCents')::BIGINT,v_currency,'payment_fee_'||v_key);
  END IF;
  IF p_channel = 'stripe' THEN
    PERFORM ledger_write(v_res.event_id, v_event.organizer_id, v_order_id, p_channel,
      'transfer','debit',(p_breakdown->>'organizerNetCents')::BIGINT,v_currency,'transfer_'||v_key);
  END IF;

  UPDATE reservations SET state = 'converted' WHERE id = p_reservation_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id,
    'ticket_count', v_tickets, 'currency', v_currency);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ───────────────────────────────────────────────────────────────────────────
-- 8. EVENT BRANDING AND CONTENT
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE events
  -- Same two-column pattern as the cover, for the same reason: the path is kept
  -- so the old object can be deleted when a new one replaces it. Deriving the
  -- key by parsing it back out of the URL works right up until a CDN goes in
  -- front, and then every delete silently targets nothing.
  ADD COLUMN IF NOT EXISTS logo_url  TEXT,
  ADD COLUMN IF NOT EXISTS logo_path TEXT,
  -- Short selling points — "Free parking", "18+", "Doors at 7". A TEXT[] rather
  -- than a table because they have no identity of their own: nothing links to a
  -- highlight, nothing sorts by one, and the whole list is always written at
  -- once by the same form.
  ADD COLUMN IF NOT EXISTS highlights TEXT[] NOT NULL DEFAULT '{}',
  -- For the map on the event page. Nullable and independent of the address: a
  -- venue can be findable by name with no coordinates, and geocoding is the
  -- organizer's choice to make rather than something to guess at.
  ADD COLUMN IF NOT EXISTS venue_lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS venue_lng NUMERIC(9,6);

/**
 * Every highlight is a non-blank phrase of at most 120 characters.
 *
 * A FUNCTION, BECAUSE A CHECK CANNOT HOLD A SUBQUERY. The obvious spelling of
 * this rule is `NOT EXISTS (SELECT 1 FROM unnest(highlights) ...)`, and
 * PostgreSQL refuses it outright — `0A000: cannot use subquery in check
 * constraint` — because a constraint has to be decidable from the row alone,
 * and the planner will not promise that of a subquery. A function call is
 * allowed, and `unnest` inside the function body is fine.
 *
 * IMMUTABLE is a promise, not a check: the constraint is only ever evaluated on
 * write, so redefining this function later would NOT revalidate existing rows.
 * That is acceptable for a bound on display text — the worst outcome is an old
 * row with a long highlight — and would not be acceptable for anything on the
 * money path, which is why nothing there is written this way.
 */
CREATE OR REPLACE FUNCTION highlights_are_phrases(p_highlights TEXT[])
RETURNS BOOLEAN AS $$
  SELECT p_highlights IS NULL
      OR NOT EXISTS (
           SELECT 1 FROM unnest(p_highlights) h
            WHERE length(btrim(h)) = 0 OR length(h) > 120
         );
$$ LANGUAGE sql IMMUTABLE;

-- DELIBERATELY NOT REVOKED, unlike every other function in this file.
--
-- A CHECK constraint is evaluated with the privileges of whoever is running the
-- INSERT, so revoking EXECUTE from PUBLIC here would not harden anything — it
-- would make writes fail with "permission denied for function" for any role
-- that lacks it. The others are revoked because they are RPC targets reachable
-- from outside; this one is only ever reached through the constraint, takes its
-- whole input as an argument the caller already holds, and reads no table.

ALTER TABLE events DROP CONSTRAINT IF EXISTS logo_url_and_path_together;
ALTER TABLE events DROP CONSTRAINT IF EXISTS highlights_bounded;
ALTER TABLE events DROP CONSTRAINT IF EXISTS venue_coords_together;
ALTER TABLE events DROP CONSTRAINT IF EXISTS venue_coords_on_earth;

ALTER TABLE events
  ADD CONSTRAINT logo_url_and_path_together
    CHECK ((logo_url IS NULL) = (logo_path IS NULL)),
  -- A dozen is already more than anybody reads, and each one is a phrase rather
  -- than a paragraph — the column is bounded here so no writer has to remember.
  ADD CONSTRAINT highlights_bounded CHECK (
    cardinality(highlights) <= 12 AND highlights_are_phrases(highlights)
  ),
  ADD CONSTRAINT venue_coords_together
    CHECK ((venue_lat IS NULL) = (venue_lng IS NULL)),
  ADD CONSTRAINT venue_coords_on_earth CHECK (
    venue_lat IS NULL OR (venue_lat BETWEEN -90 AND 90 AND venue_lng BETWEEN -180 AND 180)
  );


-- ─── Gallery and video ──────────────────────────────────────────────────────
-- One table for both, because they are one list to the organizer: a strip of
-- media under the description that they order themselves. `kind` decides how a
-- row renders, not where it lives.
DO $$ BEGIN
  CREATE TYPE event_media_kind AS ENUM ('image', 'video');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS event_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind       event_media_kind NOT NULL DEFAULT 'image',
  url        TEXT NOT NULL,
  -- The storage key, for images we host. A video is a link to somebody else's
  -- player, so it has no path and nothing of ours to clean up.
  path       TEXT,
  caption    TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT media_caption_length CHECK (caption IS NULL OR length(caption) <= 200),
  -- Whatever is here, the event page embeds or loads. `javascript:` and `data:`
  -- are refused at the door rather than in a controller, because a rule in a
  -- controller is one code path away from not existing.
  CONSTRAINT media_url_is_http CHECK (url ~* '^https?://[^[:space:]]{3,2000}$'),
  CONSTRAINT media_video_has_no_path CHECK (kind = 'image' OR path IS NULL)
);

CREATE INDEX IF NOT EXISTS event_media_by_event ON event_media (event_id, sort_order, created_at);


-- ─── Sponsors ───────────────────────────────────────────────────────────────
-- Separate from the platform `sponsors` table on purpose. That one is the
-- homepage's, edited by an admin; this one belongs to an event and is edited by
-- its organizer. A shared table with a nullable `event_id` would put the
-- homepage's sponsor list one missing WHERE clause away from an organizer's
-- editor.
DO $$ BEGIN
  CREATE TYPE sponsor_level AS ENUM ('headline', 'gold', 'silver', 'bronze', 'partner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS event_sponsors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  logo_url   TEXT,
  logo_path  TEXT,
  link_url   TEXT,
  level      sponsor_level NOT NULL DEFAULT 'partner',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT event_sponsor_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT event_sponsor_logo_url_and_path_together
    CHECK ((logo_url IS NULL) = (logo_path IS NULL)),
  CONSTRAINT event_sponsor_link_is_http
    CHECK (link_url IS NULL OR link_url ~* '^https?://[^[:space:]]{3,2000}$')
);

CREATE INDEX IF NOT EXISTS event_sponsors_by_event ON event_sponsors (event_id, level, sort_order);


-- ─── Policies ───────────────────────────────────────────────────────────────
-- A table rather than three columns on `events`, because "Event-specific
-- policies" is open-ended by definition — an over-18 rule, a bag policy, a
-- weather clause. Three named columns plus a fourth catch-all is the shape that
-- gets a fifth policy stuffed into the catch-all and rendered under the wrong
-- heading.
--
-- These are the ORGANIZER's terms for their event. They neither replace nor
-- amend the platform's `terms_versions`, which is what the organizer accepted in
-- order to publish, and which BRD §21 enforces separately.
DO $$ BEGIN
  CREATE TYPE event_policy_kind AS ENUM ('terms', 'privacy', 'refund', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS event_policies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind       event_policy_kind NOT NULL DEFAULT 'other',
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  -- Shown at the checkout as well as on the event page. A refund policy nobody
  -- saw before paying is a refund policy that will be argued about after.
  show_at_checkout BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT policy_title_present CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT policy_body_present  CHECK (length(btrim(body)) BETWEEN 1 AND 20000)
);

CREATE INDEX IF NOT EXISTS event_policies_by_event ON event_policies (event_id, sort_order);


-- ─── Schedule / lineup ──────────────────────────────────────────────────────
-- `starts_at` is a timestamp, not a free-text "8pm". A festival runs across
-- midnight and across time zones, and the page has to render every row in the
-- event's zone — which it cannot do from a string somebody typed.
CREATE TABLE IF NOT EXISTS event_schedule (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  title       TEXT NOT NULL,
  description TEXT,
  -- "Main stage", "Hall B". Free text: a lineup's stages are the organizer's
  -- own vocabulary and an enum would be wrong for the second event that used it.
  location    TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT schedule_title_present CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT schedule_description_length CHECK (description IS NULL OR length(description) <= 2000),
  CONSTRAINT schedule_location_length CHECK (location IS NULL OR length(location) <= 120),
  CONSTRAINT schedule_ends_after_start CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at
  )
);

CREATE INDEX IF NOT EXISTS event_schedule_by_event ON event_schedule (event_id, starts_at, sort_order);


-- ───────────────────────────────────────────────────────────────────────────
-- 9. LOCKDOWN
-- ───────────────────────────────────────────────────────────────────────────
--
-- Same treatment every table in this schema gets (20260914090000): no direct
-- access for `anon` or `authenticated`, RLS on, and the API's `service_role`
-- the only way in. The API is where "does this organizer own this event" is
-- decided, and a table reachable around it is that check not existing.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['event_media', 'event_sponsors', 'event_policies', 'event_schedule']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r);
  END LOOP;
END $$;
