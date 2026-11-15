-- ═══════════════════════════════════════════════════════════════════════════
-- VIP events: the homepage hero's slider (owner request 2026-11-15).
--
-- The hero used to be a collage of whatever covers came first. The owner wants
-- a slider of events THEY choose, in the order they choose, from the admin
-- dashboard. One nullable column carries both facts:
--
--   vip_rank IS NULL   not on the slider
--   vip_rank = 1..12   on the slider, in this position
--
-- A column rather than a join table because an event is on the slider at most
-- once and the list is short; the public read is one indexed filter.
--
-- WHO SEES IT. The public endpoint still filters status = 'published' and an
-- end date in the future, so ranking a draft, a cancelled or a finished event
-- can never put it on the homepage: it simply drops off until it qualifies.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS vip_rank SMALLINT;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_vip_rank_range;
ALTER TABLE events
  ADD CONSTRAINT events_vip_rank_range CHECK (vip_rank IS NULL OR vip_rank BETWEEN 1 AND 12);

CREATE INDEX IF NOT EXISTS events_vip_rank_idx ON events (vip_rank) WHERE vip_rank IS NOT NULL;

-- ── set_vip_events: replace the whole list, in order, in one transaction ──
-- The console saves the list as a list. Doing it as N separate updates from the
-- API would leave the homepage half-saved if one failed — two events at rank 1,
-- or yesterday's list mixed with today's. Here it is all or nothing.
--
-- Unknown ids are ignored rather than raised: the API has already validated
-- them, and an event deleted between loading the console and pressing Save is
-- not a reason to refuse the rest of the list.
CREATE OR REPLACE FUNCTION set_vip_events(p_event_ids UUID[])
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_ids IS NULL THEN
    p_event_ids := ARRAY[]::UUID[];
  END IF;
  IF cardinality(p_event_ids) > 12 THEN
    RAISE EXCEPTION 'At most 12 VIP events' USING ERRCODE = '22023';
  END IF;

  UPDATE events SET vip_rank = NULL
   WHERE vip_rank IS NOT NULL
     AND NOT (id = ANY (p_event_ids));

  RETURN QUERY
  UPDATE events e
     SET vip_rank = x.ord
    FROM unnest(p_event_ids) WITH ORDINALITY AS x(id, ord)
   WHERE e.id = x.id
  RETURNING e.id;
END;
$$;

REVOKE ALL ON FUNCTION set_vip_events(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_vip_events(UUID[]) TO service_role;
