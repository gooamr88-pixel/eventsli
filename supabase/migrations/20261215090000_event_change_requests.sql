-- ═══════════════════════════════════════════════════════════════════════════
-- EDITS TO A LIVE EVENT, REVIEWED (owner, 2026-11-24: "add ability for the
-- organizer to edit event details, but after review from us").
--
-- An event on sale was approved as it was; until now an organizer's edit to
-- its title, dates, venue or category was simply refused ("contact us").
-- Now the edit is kept here as a CHANGE REQUEST, the event stays exactly as
-- approved, and an admin approves (the changes are applied to the event) or
-- declines it (with a reason the organizer is emailed).
--
-- `changes`  column → new value, only the reviewed columns
--             (backend/services/eventRules.js LIVE_EDITABLE says which are not).
-- `previous` column → the value when it was asked for, so the reviewer sees
--             a before-and-after, and the organizer's later edits merge in.
--
-- One pending request per event: a second edit merges into it.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_change_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organizer_id  UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  requested_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  changes       JSONB NOT NULL CHECK (jsonb_typeof(changes) = 'object'),
  previous      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(previous) = 'object'),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decision_note TEXT CHECK (char_length(decision_note) <= 2000),
  decided_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_change_one_pending
  ON event_change_requests (event_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS event_change_requests_status_idx
  ON event_change_requests (status, created_at);

ALTER TABLE event_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_change_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON event_change_requests TO service_role;
