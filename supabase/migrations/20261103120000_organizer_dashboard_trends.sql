-- ─────────────────────────────────────────────────────────────────────────────
-- The organizer dashboard's trend badges: this window against the one before.
--
-- `organizer_dashboard_summary` answers "how much, in all"; the stat cards also
-- say "+32% vs. last 30 days", which needs the same flows counted over two
-- back-to-back windows. A separate function rather than another key on the
-- summary, so the summary's 110 lines are not copied into a second migration
-- to change one thing.
--
-- Each figure is a FLOW inside the window, never a running total:
--   events     created in the window
--   sales      tickets and gross per currency, by `paid_at`
--   attendees  tickets admitted at the door, by `scanned_at`
--
-- SAFE TO DEPLOY IN EITHER ORDER. The API calls this beside the summary and
-- leaves `trends` out when it is missing, so the cards just show no badge.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION organizer_dashboard_trends(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH win AS (
    SELECT now() - make_interval(days => n)     AS cur_from,
           now() - make_interval(days => 2 * n) AS prev_from
      FROM (SELECT LEAST(GREATEST(p_days, 1), 366) AS n) w
  ),
  paid AS (
    SELECT o.currency, o.quantity, o.buyer_total_cents, o.paid_at >= win.cur_from AS is_cur
      FROM orders o, win
     WHERE o.organizer_id = p_organizer_id
       AND o.status = 'paid'
       AND o.paid_at >= win.prev_from
  )
  SELECT jsonb_build_object(
    'events', (
      SELECT jsonb_build_object(
               'current',  count(*) FILTER (WHERE e.created_at >= win.cur_from),
               'previous', count(*) FILTER (WHERE e.created_at <  win.cur_from))
        FROM events e, win
       WHERE e.organizer_id = p_organizer_id AND e.created_at >= win.prev_from
    ),
    'attendees', (
      SELECT jsonb_build_object(
               'current',  count(*) FILTER (WHERE t.scanned_at >= win.cur_from),
               'previous', count(*) FILTER (WHERE t.scanned_at <  win.cur_from))
        FROM tickets t JOIN events e ON e.id = t.event_id, win
       WHERE e.organizer_id = p_organizer_id
         AND t.status = 'scanned'
         AND t.scanned_at >= win.prev_from
    ),
    'sales', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'tickets',    jsonb_build_object('current', cur_tickets, 'previous', prev_tickets),
               'grossCents', jsonb_build_object('current', cur_gross,   'previous', prev_gross)))
        FROM (
          SELECT currency,
                 COALESCE(sum(quantity)          FILTER (WHERE is_cur), 0)     AS cur_tickets,
                 COALESCE(sum(quantity)          FILTER (WHERE NOT is_cur), 0) AS prev_tickets,
                 COALESCE(sum(buyer_total_cents) FILTER (WHERE is_cur), 0)     AS cur_gross,
                 COALESCE(sum(buyer_total_cents) FILTER (WHERE NOT is_cur), 0) AS prev_gross
            FROM paid GROUP BY currency
        ) s
    ), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION organizer_dashboard_trends(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION organizer_dashboard_trends(UUID, INT) TO service_role;
