-- ═══════════════════════════════════════════════════════════════════════════
-- order_items was designed, documented, and never created.
--
-- It appears in the schema design and `fulfill_checkout` writes to it, but no
-- migration ever declared it. Fulfilment therefore failed at the last step with
-- `relation "order_items" does not exist` — after the order, the tickets and
-- the stock updates had already been written. The transaction rolled all of
-- that back, so nothing was corrupted; the buyer simply could not be given
-- anything.
--
-- The schema verifier reported "Schema verified" throughout, because its table
-- list was written from the same design and inherited the same omission. That
-- is the second time a checking tool has agreed with the mistake it was meant
-- to catch: the trigger it confirmed existed could never run, and now a table
-- it never thought to look for. A verifier derived from the intent cannot catch
-- an error in the intent — only exercising the path can.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tier_id          UUID REFERENCES ticket_tiers(id) ON DELETE SET NULL,
  seat_id          UUID REFERENCES seats(id) ON DELETE SET NULL,
  table_id         UUID REFERENCES tables(id) ON DELETE SET NULL,

  -- Snapshotted at purchase. Prices are frozen after a sale (BRD §13), but a
  -- tier can still be renamed or deleted, and the line on a past receipt must
  -- keep saying what was actually charged.
  label            TEXT,
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  quantity         INT NOT NULL DEFAULT 1 CHECK (quantity >= 1),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_items_order_idx ON order_items (order_id);

COMMENT ON TABLE order_items IS
  'The lines of a paid order, snapshotted. reservation_items are the ephemeral hold; these are the permanent record.';

-- `fulfill_checkout` copies whole-table holds too, which name a table and no
-- seat — so the insert has to carry table_id.
CREATE OR REPLACE FUNCTION copy_reservation_items_to_order(
  p_reservation_id UUID,
  p_order_id       UUID
) RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  INSERT INTO order_items (order_id, tier_id, seat_id, table_id, label, unit_price_cents)
  SELECT
    p_order_id,
    ri.tier_id,
    ri.seat_id,
    ri.table_id,
    COALESCE(
      t.label,
      CASE WHEN s.id IS NOT NULL
        THEN s.section_key || ' ' || s.row_label || s.seat_number END,
      'Ticket'
    ),
    ri.unit_price_cents
  FROM reservation_items ri
  LEFT JOIN tables t ON t.id = ri.table_id
  LEFT JOIN seats  s ON s.id = ri.seat_id
  WHERE ri.reservation_id = p_reservation_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
