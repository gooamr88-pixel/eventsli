-- ─────────────────────────────────────────────────────────────────────────────
-- The three figures on each card of "Your events": tickets sold, capacity and
-- gross revenue, per event, in one round trip.
--
-- The events list itself (`GET /events`) is a plain table read shared with the
-- event switcher; joining tickets and orders into it would make every page of
-- the organizer shell pay for numbers only this page shows. So this is its own
-- call, keyed by event id, and the page draws "—" until it answers.
--
-- Capacity counts the same way as `organizer_dashboard_insights`: seats on the
-- event's map plus every tier with a fixed quantity (a NULL quantity is
-- seat-map bound, so already counted as seats). NULL when neither exists.
--
-- SAFE TO DEPLOY IN EITHER ORDER. Before this exists the endpoint answers an
-- empty map and the cards show their figures as "—".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION organizer_event_figures(p_organizer_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH evs AS (
    SELECT id, currency FROM events WHERE organizer_id = p_organizer_id
  ),
  sold AS (
    SELECT t.event_id, count(*) AS n
      FROM tickets t JOIN orders o ON o.id = t.order_id
     WHERE o.organizer_id = p_organizer_id AND o.status = 'paid' AND t.status <> 'void'
     GROUP BY t.event_id
  ),
  gross AS (
    SELECT event_id, sum(buyer_total_cents) AS cents
      FROM orders
     WHERE organizer_id = p_organizer_id AND status = 'paid'
     GROUP BY event_id
  ),
  seat_cap AS (
    SELECT vm.event_id, count(s.id) AS n
      FROM venue_maps vm JOIN evs e ON e.id = vm.event_id JOIN seats s ON s.venue_map_id = vm.id
     GROUP BY vm.event_id
  ),
  tier_cap AS (
    SELECT tt.event_id, sum(tt.quantity) AS n
      FROM ticket_tiers tt JOIN evs e ON e.id = tt.event_id
     WHERE tt.quantity IS NOT NULL
     GROUP BY tt.event_id
  )
  SELECT COALESCE(jsonb_object_agg(e.id, jsonb_build_object(
           'sold', COALESCE(s.n, 0),
           'capacity', NULLIF(COALESCE(sc.n, 0) + COALESCE(tc.n, 0), 0),
           'grossCents', COALESCE(g.cents, 0),
           'currency', e.currency)), '{}'::jsonb)
    FROM evs e
    LEFT JOIN sold s ON s.event_id = e.id
    LEFT JOIN gross g ON g.event_id = e.id
    LEFT JOIN seat_cap sc ON sc.event_id = e.id
    LEFT JOIN tier_cap tc ON tc.event_id = e.id;
$$;

REVOKE ALL ON FUNCTION organizer_event_figures(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION organizer_event_figures(UUID) TO service_role;
