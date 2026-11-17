-- ═══════════════════════════════════════════════════════════════════════════
-- Ticket add-ons (owner request 2026-11-17).
--
-- Extras an organizer sells with a ticket — "Photo with the headliner", a
-- meet & greet — priced on top of the ticket, chosen by the buyer at checkout,
-- and delivered by the ORGANIZER, who alone is responsible for them. Eventsli
-- takes the payment under the same fees as the tickets.
--
-- THE RULES, and where each one lives:
--   · never more of an add-on than tickets in the order      set_reservation_addons
--   · never more than the organizer's stock, across everyone  set_reservation_addons,
--     under a row lock, counting live holds and sold tickets
--   · the price is the one the buyer saw                      unit price frozen on
--                                                              the hold, quoted from it
--   · paid add-ons reach the tickets, on every way to pay     the trigger below, in
--                                                              the fulfilment transaction
--
-- THE MONEY NEEDS NO CHANGE. Every fulfilment (card, free claim, offline)
-- writes the order and the ledger from the price quote it is handed, and the
-- quote now includes the hold's add-ons (backend pricingService). This file
-- only has to say which tickets carry which add-on.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_addons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  price_cents  BIGINT NOT NULL,
  -- Total available across all buyers; NULL is unlimited.
  quantity     INT,
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT event_addon_name_shape CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT event_addon_description_bounded CHECK (description IS NULL OR length(description) <= 300),
  CONSTRAINT event_addon_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT event_addon_quantity_positive CHECK (quantity IS NULL OR quantity >= 1)
);
CREATE INDEX IF NOT EXISTS event_addons_event_idx ON event_addons (event_id, sort_order);

-- What a hold carries, at the price it was chosen at.
CREATE TABLE IF NOT EXISTS reservation_addons (
  reservation_id   UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  addon_id         UUID NOT NULL REFERENCES event_addons(id) ON DELETE RESTRICT,
  quantity         INT NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, addon_id),
  CONSTRAINT reservation_addon_quantity_positive CHECK (quantity >= 1),
  CONSTRAINT reservation_addon_price_non_negative CHECK (unit_price_cents >= 0)
);
CREATE INDEX IF NOT EXISTS reservation_addons_addon_idx ON reservation_addons (addon_id);

-- What a paid ticket includes: one row per ticket per add-on.
CREATE TABLE IF NOT EXISTS ticket_addons (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  addon_id         UUID NOT NULL REFERENCES event_addons(id) ON DELETE RESTRICT,
  unit_price_cents BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticket_addon_once UNIQUE (ticket_id, addon_id)
);
CREATE INDEX IF NOT EXISTS ticket_addons_addon_idx ON ticket_addons (addon_id);
CREATE INDEX IF NOT EXISTS ticket_addons_order_idx ON ticket_addons (order_id);

ALTER TABLE event_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_addons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_addons, reservation_addons, ticket_addons FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_addons, reservation_addons, ticket_addons TO service_role;

-- ── How many tickets a hold will become ────────────────────────────────────
-- Seats are one each, a general-admission line its quantity, a whole table
-- the seats it holds. The add-on cap is this number.
CREATE OR REPLACE FUNCTION reservation_admits(p_reservation_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT SUM(CASE WHEN ri.seat_id IS NOT NULL THEN 1
                    WHEN ri.table_id IS NULL AND ri.tier_id IS NOT NULL THEN GREATEST(ri.quantity, 1)
                    ELSE 0 END)
    FROM reservation_items ri WHERE ri.reservation_id = p_reservation_id
  ), 0)::INT
  + COALESCE((
    SELECT COUNT(*) FROM seats s WHERE s.held_by_reservation = p_reservation_id
      AND EXISTS (SELECT 1 FROM reservation_items ri WHERE ri.reservation_id = p_reservation_id AND ri.table_id = s.table_id)
  ), 0)::INT;
$$;

-- ── Choosing add-ons on a hold ─────────────────────────────────────────────
-- p_lines: [{ "addonId": uuid, "quantity": int }]. The WHOLE choice: an add-on
-- not listed, or listed at 0, is taken off. Answers { ok, error?, message?,
-- available?, lines }.
CREATE OR REPLACE FUNCTION set_reservation_addons(p_reservation_id UUID, p_lines JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res RECORD;
  v_admits INT;
  v_line JSONB;
  v_addon RECORD;
  v_qty INT;
  v_taken INT;
  v_wanted UUID[] := ARRAY[]::UUID[];
BEGIN
  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_res IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_NOT_FOUND', 'message', 'That hold no longer exists.');
  END IF;
  IF v_res.state <> 'active' OR v_res.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESERVATION_EXPIRED', 'message', 'Your hold has expired. Please choose your tickets again.');
  END IF;

  v_admits := reservation_admits(p_reservation_id);

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_qty := GREATEST(COALESCE((v_line->>'quantity')::INT, 0), 0);
    -- Locked: two buyers asking for the last slot are answered one at a time.
    SELECT * INTO v_addon FROM event_addons WHERE id = (v_line->>'addonId')::UUID FOR UPDATE;
    IF v_addon IS NULL OR v_addon.event_id <> v_res.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND', 'message', 'That add-on is not offered for this event.');
    END IF;

    IF v_qty = 0 THEN
      DELETE FROM reservation_addons WHERE reservation_id = p_reservation_id AND addon_id = v_addon.id;
      CONTINUE;
    END IF;
    IF NOT v_addon.is_active THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT', 'message', v_addon.name || ' is no longer offered.');
    END IF;
    IF v_qty > v_admits THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PURCHASE_LIMIT_EXCEEDED',
        'message', 'You can add at most one ' || v_addon.name || ' per ticket (' || v_admits || ').',
        'available', v_admits);
    END IF;

    IF v_addon.quantity IS NOT NULL THEN
      SELECT
        COALESCE((SELECT COUNT(*) FROM ticket_addons ta JOIN tickets t ON t.id = ta.ticket_id
                  WHERE ta.addon_id = v_addon.id AND t.status <> 'void'), 0)
        + COALESCE((SELECT SUM(ra.quantity) FROM reservation_addons ra JOIN reservations r ON r.id = ra.reservation_id
                    WHERE ra.addon_id = v_addon.id AND ra.reservation_id <> p_reservation_id
                      AND r.state = 'active' AND r.expires_at > now()), 0)
      INTO v_taken;
      IF v_taken + v_qty > v_addon.quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ADDON_SOLD_OUT',
          'message', CASE WHEN v_addon.quantity - v_taken <= 0
                          THEN v_addon.name || ' is sold out.'
                          ELSE 'Only ' || (v_addon.quantity - v_taken) || ' of ' || v_addon.name || ' left.' END,
          'available', GREATEST(v_addon.quantity - v_taken, 0));
      END IF;
    END IF;

    INSERT INTO reservation_addons (reservation_id, addon_id, quantity, unit_price_cents)
    VALUES (p_reservation_id, v_addon.id, v_qty, v_addon.price_cents)
    ON CONFLICT (reservation_id, addon_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, unit_price_cents = EXCLUDED.unit_price_cents;
    v_wanted := array_append(v_wanted, v_addon.id);
  END LOOP;

  -- The list is the whole choice: anything not in it comes off.
  DELETE FROM reservation_addons
   WHERE reservation_id = p_reservation_id AND NOT (addon_id = ANY (v_wanted));

  RETURN jsonb_build_object('ok', true, 'admits', v_admits, 'lines', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('addonId', addon_id, 'quantity', quantity, 'unitPriceCents', unit_price_cents))
    FROM reservation_addons WHERE reservation_id = p_reservation_id
  ), '[]'::jsonb));
END;
$$;

-- ── Paid: the add-ons reach the tickets ────────────────────────────────────
-- Fires inside every fulfilment, after the order and its tickets exist and
-- the hold is marked converted — card, free claim and offline alike — so a
-- paid add-on can never be missing from the tickets it was paid for. Each
-- add-on goes on the first N tickets of the order, in issue order.
CREATE OR REPLACE FUNCTION attach_reservation_addons()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order UUID;
  v_ra RECORD;
BEGIN
  SELECT id INTO v_order FROM orders WHERE reservation_id = NEW.id ORDER BY created_at DESC LIMIT 1;
  IF v_order IS NULL THEN RETURN NEW; END IF;

  FOR v_ra IN SELECT * FROM reservation_addons WHERE reservation_id = NEW.id LOOP
    INSERT INTO ticket_addons (ticket_id, order_id, addon_id, unit_price_cents)
    SELECT t.id, v_order, v_ra.addon_id, v_ra.unit_price_cents
      FROM tickets t
     WHERE t.order_id = v_order
     ORDER BY t.created_at, t.id
     LIMIT v_ra.quantity
    ON CONFLICT (ticket_id, addon_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_attach_addons ON reservations;
CREATE TRIGGER reservations_attach_addons
  AFTER UPDATE OF state ON reservations
  FOR EACH ROW
  WHEN (NEW.state = 'converted' AND OLD.state IS DISTINCT FROM 'converted')
  EXECUTE FUNCTION attach_reservation_addons();
