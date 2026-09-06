-- ═══════════════════════════════════════════════════════════════════════════
-- sync_table_status_from_seats could never actually run.
--
-- The CASE returned untyped string literals, which Postgres resolves to `text`,
-- while tables.status is the enum `table_status`. Every branch therefore failed
-- with:
--
--   column "status" is of type table_status but expression is of type text
--
-- The trigger fires on any INSERT or UPDATE of seats.status, so this made it
-- impossible to insert a single seat that belongs to a table. It survived the
-- schema verifier because that only checks the trigger EXISTS — and a trigger
-- that exists and always throws looks identical to one that works, right up
-- until the first row goes in.
--
-- Found by the first concurrency test that created real seats. The lesson kept
-- rather than the fix alone: "the object is present" is not "the object works",
-- and only exercising it tells them apart.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_table_status_from_seats()
RETURNS TRIGGER AS $$
DECLARE
  v_table_id UUID := COALESCE(NEW.table_id, OLD.table_id);
  v_total    INT;
  v_free     INT;
BEGIN
  IF v_table_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'available')
    INTO v_total, v_free
    FROM seats WHERE table_id = v_table_id;

  UPDATE tables SET status = (CASE
    -- An admin block outranks stock: it is a decision, not a count.
    WHEN status = 'blocked' THEN 'blocked'
    WHEN v_total = 0        THEN 'available'   -- no seats yet: still placeable
    WHEN v_free = 0         THEN 'sold'
    WHEN v_free = v_total   THEN 'available'   -- untouched, so sellable whole
    -- BRD §25 — one seat gone individually closes the whole-table option.
    ELSE 'partial'
  END)::table_status
  WHERE id = v_table_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
