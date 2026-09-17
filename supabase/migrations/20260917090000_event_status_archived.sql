-- ═══════════════════════════════════════════════════════════════════════════
-- An organizer can archive an event.
--
-- On its own file because Postgres refuses to USE an enum value inside the
-- transaction that added it, and apply-migration.js runs each file in one
-- transaction. The next migration is the one that uses it.
--
-- A STATUS, not an `archived_at` flag beside `published`. Every function that
-- creates a sale — hold_seats, hold_table, record_manual_sale, fulfill_checkout —
-- already refuses anything that is not `published`, and every public query
-- already filters on it. A flag would have to be added to each of those, and the
-- one that was missed would keep selling tickets for an archived event.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'archived';
