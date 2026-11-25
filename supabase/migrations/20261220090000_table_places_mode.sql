-- ═══════════════════════════════════════════════════════════════════════════
-- PLACES AT A TABLE — a fourth way for buyers to choose (2026-11-25).
--
-- "Reserve tickets at a specific table without selecting or being assigned
-- individual seats." The buyer chooses a table and how many places; nobody
-- picks, sees or is told a seat number. The guests sit anywhere at their table.
--
-- The three existing modes stay exactly as they are:
--   seat_only       buyers pick seats one by one
--   table_only      buyers book a whole table
--   seat_and_table  either
--   table_places    NEW: buyers book N places at a table
--
-- WHY THIS IS ITS OWN MIGRATION: `ALTER TYPE ... ADD VALUE` cannot be used in
-- the transaction that adds it (see 20260917115000_free_payment_channel.sql).
-- Everything that uses 'table_places' is in 20261220090100.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE purchase_mode ADD VALUE IF NOT EXISTS 'table_places';
