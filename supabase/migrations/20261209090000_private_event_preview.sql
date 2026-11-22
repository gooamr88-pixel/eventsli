-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT A PRIVATE EVENT SHOWS BEFORE ITS PASSWORD (2026-11-22).
--
-- The owner: "blur all the details and images of a private event until it is
-- unlocked — and the organizer decides".
--
--   locked_preview   'blur' — the event page, blurred: placeholders where the
--                    details are and a blurred copy of the cover, under the
--                    password card. 'card' — the password card alone.
--   locked_reveal    what stays readable before the password, any of:
--                    title, organizer, cover, date, city. Everything else is
--                    never sent to a locked visitor at all (eventAccess.
--                    lockedTeaser) — the blur is drawn over placeholders, not
--                    over the real text, so it cannot be "un-blurred".
--
-- Defaults: blurred, with the title and the host readable. The cover was
-- shown sharp before this; it is now blurred unless the organizer reveals it.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_preview TEXT NOT NULL DEFAULT 'blur';
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_reveal TEXT[] NOT NULL DEFAULT ARRAY['title', 'organizer']::TEXT[];

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_locked_preview_kind;
ALTER TABLE events ADD CONSTRAINT events_locked_preview_kind
  CHECK (locked_preview IN ('blur', 'card'));

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_locked_reveal_known;
ALTER TABLE events ADD CONSTRAINT events_locked_reveal_known
  CHECK (locked_reveal <@ ARRAY['title', 'organizer', 'cover', 'date', 'city']::TEXT[]);

COMMENT ON COLUMN events.locked_preview IS
  'Private event, before the password: blur = blurred page preview; card = the password card alone.';
COMMENT ON COLUMN events.locked_reveal IS
  'Private event, before the password: what stays readable (title, organizer, cover, date, city). Nothing else is sent.';

NOTIFY pgrst, 'reload schema';
