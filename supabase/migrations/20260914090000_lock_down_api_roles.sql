-- ═══════════════════════════════════════════════════════════════════════════
-- Close the Supabase Data API to the `anon` and `authenticated` roles.
--
-- WHAT WAS OPEN (measured on the live project, 2026-09-14, read-only):
--
--   • 23 SECURITY DEFINER functions were EXECUTE-able by `anon` — among them
--     settle_invoice, fulfill_checkout, ledger_write, record_manual_sale,
--     check_in_ticket, undo_check_in, save_venue_map, raise_commission_invoice,
--     hold_seats and consume_password_reset. A SECURITY DEFINER function runs
--     with its owner's rights, so row-level security does not apply inside it.
--     Anyone holding the project's anon key — a key Supabase designs to be
--     public — could call `POST /rest/v1/rpc/fulfill_checkout` and mint paid
--     orders and tickets, settle a commission invoice, or admit a ticket at the
--     door, without ever touching this API or its authorisation.
--   • Every table granted `anon` and `authenticated` full privileges. Tables
--     were saved only by RLS being switched on with no policies — and that RLS
--     came from a project-level event trigger (`ensure_rls`), NOT from these
--     migrations, so a database rebuilt from this folder had no RLS at all.
--   • Default privileges re-granted all of the above to every new object.
--
-- WHY REVOKING IS SAFE: the API uses the service-role key exclusively and the
-- browser never talks to Supabase. `anon` and `authenticated` have no
-- legitimate caller. Trigger functions are not EXECUTE-checked when they fire,
-- and SECURITY DEFINER functions call their helpers as their owner.
--
-- Only objects this project OWNS are touched. Extension functions (citext) are
-- left alone: they are pure comparison operators with no data behind them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Tables and sequences ──────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel, c.relkind
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
      AND pg_get_userbyid(c.relowner) = current_user
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated', r.rel);
    IF r.relkind IN ('r', 'p') THEN
      -- Explicit here, so RLS no longer depends on a project setting.
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.rel);
      EXECUTE format('GRANT ALL ON %s TO service_role', r.rel);
    ELSIF r.relkind = 'S' THEN
      EXECUTE format('GRANT USAGE, SELECT, UPDATE ON %s TO service_role', r.rel);
    END IF;
  END LOOP;
END $$;

-- ─── Functions ─────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND pg_get_userbyid(p.proowner) = current_user
      AND NOT EXISTS (                       -- not part of an extension
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.fn);
  END LOOP;
END $$;

-- ─── Future objects ────────────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ─── Proof, inside the same transaction ────────────────────────────────────
-- A lockdown that only LOOKS applied is worse than none. If anything owned here
-- is still reachable by the API roles, the whole migration rolls back.
DO $$
DECLARE leaks text;
BEGIN
  SELECT string_agg(name, ', ') INTO leaks FROM (
    SELECT c.relname::text AS name FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND pg_get_userbyid(c.relowner) = current_user
      AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT')
        OR NOT c.relrowsecurity)
    UNION ALL
    SELECT p.proname::text FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND pg_get_userbyid(p.proowner) = current_user
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) x;
  IF leaks IS NOT NULL THEN
    RAISE EXCEPTION 'API roles can still reach: %', leaks;
  END IF;
END $$;
