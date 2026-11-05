-- ═══════════════════════════════════════════════════════════════════════════
-- READ-ONLY. Is anything in `public` reachable by the anon key or a signed-in
-- Supabase session — around the API and its authorisation?
--
-- Safe on PRODUCTION: one SELECT, no writes, no locks. Paste it into the
-- Supabase SQL editor (or psql) and run it.
--
-- EXPECTED RESULT: ZERO ROWS. Every row is a leak to fix before launch.
--
-- Why it matters: the API uses the service-role key, which bypasses RLS, and
-- enforces ownership itself (verifyEventOwner, role checks). The anon key is
-- public by design. So any table readable by `anon`/`authenticated`, any table
-- without RLS, or any function they may EXECUTE, is a way to read or change
-- data with no ownership check at all — 20260914090000_lock_down_api_roles.sql
-- records SECURITY DEFINER functions that could mint paid orders this way.
--
-- This is that migration's own closing assertion, as a SELECT that lists what
-- it finds instead of raising. Its migration only checked the objects that
-- existed on 2026-09-14; this checks what is in the database TODAY.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'table' AS kind, c.relname::text AS name,
       concat_ws(', ',
         CASE WHEN NOT c.relrowsecurity THEN 'RLS is OFF' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'anon can SELECT' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') THEN 'anon can WRITE' END,
         CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'authenticated can SELECT' END,
         CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') THEN 'authenticated can WRITE' END
       ) AS problem
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind IN ('r', 'p')
  AND (NOT c.relrowsecurity
       OR has_table_privilege('anon', c.oid, 'SELECT')
       OR has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', c.oid, 'SELECT')
       OR has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE'))

UNION ALL

SELECT 'function', p.oid::regprocedure::text,
       concat_ws(', ',
         CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon can EXECUTE' END,
         CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'authenticated can EXECUTE' END,
         CASE WHEN p.prosecdef THEN 'SECURITY DEFINER (runs with owner rights, RLS does not apply)' END)
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND NOT EXISTS (SELECT 1 FROM pg_depend d                 -- not part of an extension
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))

ORDER BY 1, 2;
