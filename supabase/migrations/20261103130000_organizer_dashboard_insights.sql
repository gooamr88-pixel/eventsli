-- ─────────────────────────────────────────────────────────────────────────────
-- The organizer dashboard's lower panels: Your events, Event performance,
-- Tickets by type and Attendees by location.
--
-- Every figure is counted, none is estimated:
--   eventList    each event with tickets sold and its capacity — seats on its
--                map plus every tier with a fixed quantity (a NULL quantity is
--                seat-map bound and already counted as seats)
--   performance  this window and the one before, for page views of `/e/<slug>`
--                (`site_visits`, written by the event page's VisitBeacon),
--                checkouts started (`reservations`) and paid orders
--   ticketTypes  sold tickets by tier name, table seats as "Table", top three
--                and the rest as "Other"
--   locations    sold tickets by the event's city, top three and the rest
--
-- SAFE TO DEPLOY IN EITHER ORDER. The API leaves `insights` out when this is
-- missing, and the panels say there is nothing to show yet.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION organizer_dashboard_insights(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH win AS (
    SELECT n,
           now() - make_interval(days => n)     AS cur_from,
           now() - make_interval(days => 2 * n) AS prev_from
      FROM (SELECT LEAST(GREATEST(p_days, 1), 366) AS n) w
  ),
  evs AS (
    SELECT id, slug, title, status, starts_at, ends_at, timezone, city, venue_name, cover_url
      FROM events WHERE organizer_id = p_organizer_id
  ),
  sold AS (
    SELECT t.event_id, t.tier_id, t.table_id
      FROM tickets t JOIN orders o ON o.id = t.order_id
     WHERE o.organizer_id = p_organizer_id AND o.status = 'paid' AND t.status <> 'void'
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
  ),
  sold_by_event AS (SELECT event_id, count(*) AS n FROM sold GROUP BY event_id),
  types AS (
    SELECT CASE WHEN s.table_id IS NOT NULL THEN 'Table' ELSE COALESCE(tt.name, 'General') END AS label,
           count(*) AS n
      FROM sold s LEFT JOIN ticket_tiers tt ON tt.id = s.tier_id
     GROUP BY 1
  ),
  places AS (
    SELECT COALESCE(NULLIF(btrim(e.city), ''), 'Other') AS label, count(*) AS n
      FROM sold s JOIN evs e ON e.id = s.event_id
     GROUP BY 1
  ),
  -- Top three by count, everything else folded into one row.
  types_top AS (
    SELECT CASE WHEN rk <= 3 THEN label ELSE 'Other' END AS label, sum(n) AS n
      FROM (SELECT label, n, row_number() OVER (ORDER BY n DESC, label) AS rk FROM types) r
     GROUP BY 1
  ),
  places_top AS (
    SELECT CASE WHEN rk <= 3 THEN label ELSE 'Others' END AS label, sum(n) AS n
      FROM (SELECT label, n, row_number() OVER (ORDER BY n DESC, label) AS rk FROM places) r
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'eventList', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'slug', e.slug, 'title', e.title, 'status', e.status,
               'startsAt', e.starts_at, 'endsAt', e.ends_at, 'timezone', e.timezone,
               'city', e.city, 'venue', e.venue_name, 'coverUrl', e.cover_url,
               'sold', COALESCE(sb.n, 0),
               'capacity', NULLIF(COALESCE(sc.n, 0) + COALESCE(tc.n, 0), 0))
             ORDER BY e.starts_at DESC)
        FROM evs e
        LEFT JOIN sold_by_event sb ON sb.event_id = e.id
        LEFT JOIN seat_cap sc ON sc.event_id = e.id
        LEFT JOIN tier_cap tc ON tc.event_id = e.id
       WHERE e.status <> 'archived'
    ), '[]'::jsonb),
    'performance', jsonb_build_object(
      'views', (
        SELECT jsonb_build_object(
                 'current',  COALESCE(sum(v.views) FILTER (WHERE v.day >  (win.cur_from)::date), 0),
                 'previous', COALESCE(sum(v.views) FILTER (WHERE v.day <= (win.cur_from)::date), 0))
          FROM site_visits v JOIN evs e ON v.path = '/e/' || e.slug, win
         WHERE v.day > (win.prev_from)::date
      ),
      'checkouts', (
        SELECT jsonb_build_object(
                 'current',  count(*) FILTER (WHERE r.created_at >= win.cur_from),
                 'previous', count(*) FILTER (WHERE r.created_at <  win.cur_from))
          FROM reservations r JOIN evs e ON e.id = r.event_id, win
         WHERE r.created_at >= win.prev_from
      ),
      'orders', (
        SELECT jsonb_build_object(
                 'current',  count(*) FILTER (WHERE o.paid_at >= win.cur_from),
                 'previous', count(*) FILTER (WHERE o.paid_at <  win.cur_from))
          FROM orders o, win
         WHERE o.organizer_id = p_organizer_id AND o.status = 'paid' AND o.paid_at >= win.prev_from
      )
    ),
    'ticketTypes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'count', n)
             ORDER BY (label = 'Other'), n DESC)
        FROM types_top
    ), '[]'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'count', n)
             ORDER BY (label = 'Others'), n DESC)
        FROM places_top
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION organizer_dashboard_insights(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION organizer_dashboard_insights(UUID, INT) TO service_role;
