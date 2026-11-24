-- ═══════════════════════════════════════════════════════════════════════════
-- FIRST AND LAST NAME ON EVERY TICKET, WHEN THE ORGANIZER ASKS FOR IT
-- (owner, 2026-11-24: "make in ticket first and last name required — with
-- control from the organizer").
--
-- events.holder_details gains 'full': the first AND last name of every ticket
-- holder are required at checkout. The other choices are unchanged:
--   'required'  first name required (the default, as before)
--   'optional'  asked, optional
--   'off'       not asked
-- Enforced by the API (services/ticketHolders.js); the database only has to
-- accept the new value.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_holder_details_check;
ALTER TABLE events ADD CONSTRAINT events_holder_details_check
  CHECK (holder_details IN ('full', 'required', 'optional', 'off'));
