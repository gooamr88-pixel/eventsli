-- ═══════════════════════════════════════════════════════════════════════════
-- The ledger's append-only protection blocked its own idempotency.
--
-- ledger_entries was made append-only with two RULEs (`ON UPDATE DO INSTEAD
-- NOTHING`, same for DELETE). Postgres then refuses any INSERT on that table
-- that carries ON CONFLICT:
--
--   INSERT with ON CONFLICT clause cannot be used with table that has
--   INSERT or UPDATE rules
--
-- and ON CONFLICT on the idempotency key is exactly what makes a retried
-- webhook write nothing instead of doubling the revenue. Two correct-looking
-- protections, mutually exclusive.
--
-- Replaced with BEFORE triggers that RAISE. That is not merely a workaround —
-- it is the better guarantee. `DO INSTEAD NOTHING` swallowed the write
-- SILENTLY: code that believed it had corrected a ledger row received success
-- and changed nothing, and the mistake would surface much later as a report
-- that would not reconcile. A trigger makes the same attempt fail loudly, at
-- the line that made it.
-- ═══════════════════════════════════════════════════════════════════════════

DROP RULE IF EXISTS ledger_no_update ON ledger_entries;
DROP RULE IF EXISTS ledger_no_delete ON ledger_entries;

CREATE OR REPLACE FUNCTION ledger_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only: % is not permitted. To correct an entry, write a reversing one.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

CREATE TRIGGER trg_ledger_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

COMMENT ON FUNCTION ledger_is_append_only IS
  'Refuses UPDATE and DELETE on ledger_entries, loudly. Triggers rather than rules, so INSERT ... ON CONFLICT still works for idempotent writes.';
