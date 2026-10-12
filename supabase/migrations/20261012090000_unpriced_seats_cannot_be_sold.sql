-- ═══════════════════════════════════════════════════════════════════════════
-- A SEAT WITH NO PRICE IS NOT A FREE SEAT.
--
-- `seat_price_cents` ends in COALESCE(override, tier.price_cents, 0), and that
-- final zero has two completely different meanings behind it:
--
--   · the seat is priced at zero — a genuinely free event, which is a product
--     feature and must keep working;
--   · the seat has NO PRICE AT ALL — no override, and no ticket type attached —
--     which is an unfinished seat map, and selling it is giving the room away.
--
-- The second one happened in production. An organizer drew a map, created one
-- $100 ticket type, and never attached it to the seats. The listing advertised
-- "From $100" (the tier) and the checkout charged $0.00 (the seats) — two
-- numbers for one event, from two different tables, neither of them wrong on
-- its own. Thirty seats were on sale for nothing.
--
-- The delete path was already guarded: `tierController.remove` refuses to
-- delete a tier that seats point at, with a comment naming this exact COALESCE.
-- That closes the door on a priced map BECOMING unpriced. It does nothing about
-- a map that was never priced in the first place, which is the common case,
-- because a map is drawn before the tiers are wired to it.
--
-- `seat_price_cents` ITSELF IS LEFT ALONE. Making it return NULL would be the
-- tidier change and it would break four other call sites — `order_items`
-- copies in 20260830020000 and 20260915120000, and both fulfilment paths —
-- whose columns are NOT NULL. The sale is where the money is decided, so the
-- sale is where this is refused.
--
-- The organizer is stopped earlier too, in `submissionBlockers`: an event
-- cannot be submitted for review while any seat on its map is unpriced. This
-- function is the backstop for maps that were published before that check
-- existed — including, right now, live ones.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- The predicate, named once.
-- ───────────────────────────────────────────────────────────────────────────
-- A seat is priced when it carries an override, or when it points at a ticket
-- type that still exists. `price_cents` on that type may be 0 — that is a free
-- seat, and it passes.
CREATE OR REPLACE FUNCTION unpriced_seat_count(p_seat_ids UUID[])
RETURNS INT AS $$
  SELECT COUNT(*)::INT
    FROM seats s
   WHERE s.id = ANY(p_seat_ids)
     AND s.price_override_cents IS NULL
     AND NOT EXISTS (SELECT 1 FROM ticket_tiers t WHERE t.id = s.tier_id);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION unpriced_seat_count(UUID[]) IS
  'Seats among these that resolve to no price at all — no override and no '
  'surviving ticket type. Distinct from a seat priced at zero, which is free '
  'on purpose and is not counted here.';

-- ───────────────────────────────────────────────────────────────────────────
-- hold_seats — one new check, otherwise the version from 20260917120000.
-- ───────────────────────────────────────────────────────────────────────────
-- The check sits AFTER the seats are locked (so it reads the rows the hold is
-- actually about) and BEFORE the reservation row is written (so a refusal
-- leaves nothing behind). `SELECT ... FOR UPDATE` has already run by then; a
-- plain RETURN releases those locks at commit with no rows changed, which is
-- how every other refusal in this function behaves.
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

  -- The ticket type behind these seats has to be on sale.
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

  -- ── NEW: no price, no sale ──
  -- Refusing is the conservative side of this trade and it is not a close
  -- call. The alternative is selling admission for nothing, which cannot be
  -- undone by fixing the map afterwards: the tickets are already issued and
  -- the organizer owes the holders a room. A buyer who is turned away here
  -- comes back in ten minutes; a buyer charged zero never does.
  --
  -- The message says nothing about the organizer's configuration. "This event
  -- has no prices set" tells a stranger the event is misconfigured and invites
  -- them to retry until it is.
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
-- THE WHOLE-TABLE PATH IS DELIBERATELY NOT CHANGED.
-- ───────────────────────────────────────────────────────────────────────────
-- A table carries its OWN `price_cents` rather than resolving one through a
-- tier, and `reservation_items.unit_price_cents` is NOT NULL — so an unpriced
-- table already cannot be sold. `hold_table` fails loudly on the insert instead
-- of quietly charging zero, which is the behaviour this migration is adding
-- everywhere else. Re-emitting a hundred and twenty lines of it to turn that
-- into a prettier error would be a second copy of the function to keep in step,
-- bought with no change in what anyone can be charged.

-- The same lock-down every other function in this schema gets: the API reaches
-- these through the service role, and nothing in the browser may call them.
REVOKE ALL ON FUNCTION unpriced_seat_count(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION unpriced_seat_count(UUID[]) TO service_role;
