-- ─────────────────────────────────────────────────────────────────────────────
-- The event overview's four figure cards: a trend badge and a sparkline each.
--
-- `event_sales_summary` answers the totals and a daily revenue timeline. The
-- cards also say "+32% vs. the 30 days before" and draw the last 30 days as a
-- line, for four flows — page views of `/e/<slug>`, tickets sold, gross, and
-- tickets admitted at the door — so this counts each over two back-to-back
-- windows, plus one value per day of the current window (in the event's own
-- time zone, as the summary's timeline is). `firstSaleAt` is the timeline's
-- "Ticket sales started".
--
-- SAFE TO DEPLOY IN EITHER ORDER. The API leaves `trends` out when this is
-- missing; the cards then show their totals with no badge and no line.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION event_overview_trends(p_event_id UUID, p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH ev AS (SELECT id, slug, timezone FROM events WHERE id = p_event_id),
  win AS (
    SELECT n,
           now() - make_interval(days => n)     AS cur_from,
           now() - make_interval(days => 2 * n) AS prev_from,
           (now() AT TIME ZONE (SELECT timezone FROM ev))::date AS today
      FROM (SELECT LEAST(GREATEST(p_days, 1), 366) AS n) w
  ),
  days AS (
    SELECT generate_series((SELECT today - (n - 1) FROM win), (SELECT today FROM win), interval '1 day')::date AS d
  ),
  paid AS (SELECT * FROM orders WHERE event_id = p_event_id AND status = 'paid'),
  scans AS (
    SELECT t.scanned_at FROM tickets t JOIN paid o ON o.id = t.order_id
     WHERE t.status = 'scanned' AND t.scanned_at IS NOT NULL
  ),
  views AS (
    SELECT v.day, v.views FROM site_visits v, ev WHERE v.path = '/e/' || ev.slug
  )
  SELECT jsonb_build_object(
    'firstSaleAt', (SELECT min(paid_at) FROM paid),
    'views', jsonb_build_object(
      'total',    (SELECT COALESCE(sum(views), 0) FROM views),
      'current',  (SELECT COALESCE(sum(views), 0) FROM views, win WHERE day >  win.cur_from::date),
      'previous', (SELECT COALESCE(sum(views), 0) FROM views, win WHERE day <= win.cur_from::date AND day > win.prev_from::date),
      'daily',    (SELECT jsonb_agg(COALESCE((SELECT sum(views) FROM views WHERE views.day = days.d), 0) ORDER BY days.d) FROM days)
    ),
    'tickets', jsonb_build_object(
      'current',  (SELECT COALESCE(sum(quantity), 0) FROM paid, win WHERE paid_at >= win.cur_from),
      'previous', (SELECT COALESCE(sum(quantity), 0) FROM paid, win WHERE paid_at <  win.cur_from AND paid_at >= win.prev_from),
      'daily',    (SELECT jsonb_agg(COALESCE((SELECT sum(quantity) FROM paid
                     WHERE (paid_at AT TIME ZONE (SELECT timezone FROM ev))::date = days.d), 0) ORDER BY days.d) FROM days)
    ),
    'grossCents', jsonb_build_object(
      'current',  (SELECT COALESCE(sum(buyer_total_cents), 0) FROM paid, win WHERE paid_at >= win.cur_from),
      'previous', (SELECT COALESCE(sum(buyer_total_cents), 0) FROM paid, win WHERE paid_at <  win.cur_from AND paid_at >= win.prev_from),
      'daily',    (SELECT jsonb_agg(COALESCE((SELECT sum(buyer_total_cents) FROM paid
                     WHERE (paid_at AT TIME ZONE (SELECT timezone FROM ev))::date = days.d), 0) ORDER BY days.d) FROM days)
    ),
    'attendees', jsonb_build_object(
      'current',  (SELECT count(*) FROM scans, win WHERE scanned_at >= win.cur_from),
      'previous', (SELECT count(*) FROM scans, win WHERE scanned_at <  win.cur_from AND scanned_at >= win.prev_from),
      'daily',    (SELECT jsonb_agg((SELECT count(*) FROM scans
                     WHERE (scanned_at AT TIME ZONE (SELECT timezone FROM ev))::date = days.d) ORDER BY days.d) FROM days)
    )
  )
  WHERE EXISTS (SELECT 1 FROM ev);
$$;

REVOKE ALL ON FUNCTION event_overview_trends(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION event_overview_trends(UUID, INT) TO service_role;
