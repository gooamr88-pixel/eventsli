-- ─────────────────────────────────────────────────────────────────────────────
-- Eventsli AI — the launch kit joins the daily allowance.
--
-- `ai_generations.feature` is CHECKed against the features that exist. The
-- launch kit (social posts, email and share images for a saved event) spends
-- from the same two-a-day allowance as the Smart Event Creator and the Seating
-- Designer (D-002), so its rows need a name the CHECK accepts.
--
-- Nothing else changes: the reserve, finish and status functions count by
-- organizer, not by feature, which is exactly what makes the allowance shared.
--
-- SAFE TO DEPLOY IN EITHER ORDER. Code that ships before this migration answers
-- the launch kit with "not set up yet" and logs which migration is missing; the
-- event creator and the Seating Designer are unaffected (I-023 pattern).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ai_generations DROP CONSTRAINT IF EXISTS ai_generations_feature;
ALTER TABLE ai_generations
  ADD CONSTRAINT ai_generations_feature
  CHECK (feature IN ('event_creator', 'seating_designer', 'launch_kit'));
