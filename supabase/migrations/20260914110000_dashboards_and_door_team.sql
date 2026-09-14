-- ═══════════════════════════════════════════════════════════════════════════
-- The organizer dashboard, the admin console, and the door team.
--
-- Three read-only reporting functions and one table. Nothing existing changes
-- shape: one nullable column is added to scan_devices.
--
-- WHY THE NUMBERS ARE SQL FUNCTIONS. A dashboard that pulls every paid order
-- across the wire to add them up in JavaScript is fine for the first organizer
-- and a timeout for the thousandth; one that makes a query per event is an N+1
-- on the busiest page. Each function below is one round trip, and each is
-- SECURITY INVOKER — they read with the caller's rights, and the only caller
-- that has any is the service role (grants at the bottom).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── The door team ─────────────────────────────────────────────────────────
-- A person, with their own Eventsli account, allowed to scan for ONE event.
-- Beside the PIN-protected devices, not instead of them: a shared tablet is
-- still the right answer for a volunteer on a shift; a named account is the
-- right answer for the head of security who has to be accountable for a scan.
--
-- No new role. A door-team member is whatever they already were (usually an
-- attendee), plus this row. So the permission is per event by construction —
-- there is no global "scanner" role that could reach every event's door.
CREATE TABLE IF NOT EXISTS event_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Revoked, never deleted: the scans they recorded must keep a name on them.
  revoked_at  TIMESTAMPTZ,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS event_staff_user_idx ON event_staff (user_id) WHERE revoked_at IS NULL;

ALTER TABLE event_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_staff FROM PUBLIC, anon, authenticated;
GRANT ALL ON event_staff TO service_role;

-- A signed-in staff member scans THROUGH a device row of their own, so the
-- check-in function, the scan log, undo and revocation all work unchanged —
-- `scans.device_id` names who admitted whom either way. PIN login refuses any
-- device that has a staff_id (enforced in scanService).
ALTER TABLE scan_devices
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES event_staff(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS scan_devices_one_per_staff
  ON scan_devices (staff_id) WHERE staff_id IS NOT NULL;

-- ─── One event's numbers ───────────────────────────────────────────────────
-- Days are bucketed in the EVENT's time zone: "sold on Friday" means the
-- organizer's Friday, not UTC's.
CREATE OR REPLACE FUNCTION event_sales_summary(p_event_id UUID, p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH ev AS (
    SELECT id, currency, timezone FROM events WHERE id = p_event_id
  ),
  win AS (SELECT LEAST(GREATEST(p_days, 1), 366) AS n),
  paid AS (
    SELECT * FROM orders WHERE event_id = p_event_id AND status = 'paid'
  ),
  sold AS (
    SELECT t.tier_id, t.status FROM tickets t JOIN paid o ON o.id = t.order_id
  ),
  days AS (
    SELECT generate_series(
      (now() AT TIME ZONE (SELECT timezone FROM ev))::date - ((SELECT n FROM win) - 1),
      (now() AT TIME ZONE (SELECT timezone FROM ev))::date,
      interval '1 day'
    )::date AS d
  ),
  daily AS (
    SELECT (paid_at AT TIME ZONE (SELECT timezone FROM ev))::date AS d,
           count(*) AS orders, sum(quantity) AS tickets, sum(buyer_total_cents) AS gross
      FROM paid WHERE paid_at IS NOT NULL GROUP BY 1
  )
  SELECT jsonb_build_object(
    'currency',        (SELECT currency FROM ev),
    'orders',          (SELECT count(*) FROM paid),
    'tickets',         (SELECT COALESCE(sum(quantity), 0) FROM paid),
    'grossCents',      (SELECT COALESCE(sum(buyer_total_cents), 0) FROM paid),
    'netCents',        (SELECT COALESCE(sum(organizer_net_cents), 0) FROM paid),
    'commissionCents', (SELECT COALESCE(sum(commission_cents + commission_tax_cents), 0) FROM paid),
    'byChannel', jsonb_build_object(
      'stripe', (SELECT jsonb_build_object('orders', count(*), 'grossCents', COALESCE(sum(buyer_total_cents), 0))
                   FROM paid WHERE channel = 'stripe'),
      'manual', (SELECT jsonb_build_object('orders', count(*), 'grossCents', COALESCE(sum(buyer_total_cents), 0))
                   FROM paid WHERE channel = 'manual')
    ),
    'tiers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', tt.id, 'name', tt.name, 'priceCents', tt.price_cents, 'quantity', tt.quantity,
               'sold', (SELECT count(*) FROM sold s WHERE s.tier_id = tt.id AND s.status <> 'void'))
             ORDER BY tt.sort_order, tt.created_at)
        FROM ticket_tiers tt WHERE tt.event_id = p_event_id
    ), '[]'::jsonb),
    'seats', (
      SELECT jsonb_build_object(
               'total',   count(*),
               'sold',    count(*) FILTER (WHERE s.status = 'sold'),
               'held',    count(*) FILTER (WHERE s.status = 'held'),
               'blocked', count(*) FILTER (WHERE s.status = 'blocked'))
        FROM seats s JOIN venue_maps vm ON vm.id = s.venue_map_id
       WHERE vm.event_id = p_event_id
    ),
    'admissions', (
      SELECT jsonb_build_object(
               'issued',   count(*) FILTER (WHERE status <> 'void'),
               'admitted', count(*) FILTER (WHERE status = 'scanned'),
               'void',     count(*) FILTER (WHERE status = 'void'))
        FROM sold
    ),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'date', days.d,
               'orders', COALESCE(daily.orders, 0),
               'tickets', COALESCE(daily.tickets, 0),
               'grossCents', COALESCE(daily.gross, 0))
             ORDER BY days.d)
        FROM days LEFT JOIN daily ON daily.d = days.d
    ), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM ev);
$$;

-- ─── An organizer's whole account ──────────────────────────────────────────
-- Money is grouped BY CURRENCY and never summed across one: an organizer with
-- a Toronto event and a Denver event has CAD and USD, and adding them produces
-- a number that is simply wrong.
CREATE OR REPLACE FUNCTION organizer_dashboard_summary(p_organizer_id UUID, p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH win AS (SELECT LEAST(GREATEST(p_days, 1), 366) AS n),
  evs AS (
    SELECT id, title, slug, status, starts_at, ends_at, timezone, venue_name
      FROM events WHERE organizer_id = p_organizer_id
  ),
  paid AS (
    SELECT * FROM orders WHERE organizer_id = p_organizer_id AND status = 'paid'
  ),
  tix AS (
    SELECT t.status, t.event_id FROM tickets t JOIN paid o ON o.id = t.order_id
  ),
  days AS (
    SELECT generate_series(current_date - ((SELECT n FROM win) - 1), current_date, interval '1 day')::date AS d
  ),
  daily AS (
    SELECT day, jsonb_object_agg(currency, jsonb_build_object(
             'orders', orders, 'tickets', tickets, 'grossCents', gross)) AS by_currency
      FROM (
        SELECT (paid_at AT TIME ZONE 'UTC')::date AS day, currency,
               count(*) AS orders, sum(quantity) AS tickets, sum(buyer_total_cents) AS gross
          FROM paid
         WHERE paid_at >= now() - make_interval(days => (SELECT n FROM win))
         GROUP BY 1, 2
      ) g
     GROUP BY day
  )
  SELECT jsonb_build_object(
    'events', (
      SELECT jsonb_build_object(
               'total', count(*),
               'draft', count(*) FILTER (WHERE status = 'draft'),
               'pendingReview', count(*) FILTER (WHERE status = 'pending_review'),
               'rejected', count(*) FILTER (WHERE status = 'rejected'),
               'published', count(*) FILTER (WHERE status = 'published'),
               'suspended', count(*) FILTER (WHERE status = 'suspended'),
               'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
               'completed', count(*) FILTER (WHERE status = 'completed'))
        FROM evs
    ),
    'sales', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'orders', orders, 'tickets', tickets, 'grossCents', gross,
               'netCents', net, 'commissionCents', commission))
        FROM (
          SELECT currency, count(*) AS orders, sum(quantity) AS tickets,
                 sum(buyer_total_cents) AS gross, sum(organizer_net_cents) AS net,
                 sum(commission_cents + commission_tax_cents) AS commission
            FROM paid GROUP BY currency
        ) s
    ), '{}'::jsonb),
    'admissions', (
      SELECT jsonb_build_object(
               'issued', count(*) FILTER (WHERE status <> 'void'),
               'admitted', count(*) FILTER (WHERE status = 'scanned'))
        FROM tix
    ),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', days.d, 'byCurrency', COALESCE(daily.by_currency, '{}'::jsonb))
             ORDER BY days.d)
        FROM days LEFT JOIN daily ON daily.day = days.d
    ), '[]'::jsonb),
    'upcoming', COALESCE((
      SELECT jsonb_agg(q.j ORDER BY q.k)
        FROM (
          SELECT e.starts_at AS k, jsonb_build_object(
                   'id', e.id, 'title', e.title, 'slug', e.slug, 'startsAt', e.starts_at,
                   'timezone', e.timezone, 'venue', e.venue_name,
                   'ticketsSold', (SELECT count(*) FROM tix WHERE tix.event_id = e.id AND tix.status <> 'void')) AS j
            FROM evs e
           WHERE e.status = 'published' AND e.starts_at > now()
           ORDER BY e.starts_at
           LIMIT 5
        ) q
    ), '[]'::jsonb),
    'recentOrders', COALESCE((
      SELECT jsonb_agg(q.j ORDER BY q.k DESC)
        FROM (
          SELECT COALESCE(o.paid_at, o.created_at) AS k, jsonb_build_object(
                   'id', o.id, 'eventId', o.event_id, 'eventTitle', e.title,
                   'buyerName', COALESCE(p.full_name, o.guest_name),
                   'buyerEmail', COALESCE(p.email::text, o.guest_email::text),
                   'tickets', o.quantity, 'totalCents', o.buyer_total_cents,
                   'currency', o.currency, 'channel', o.channel,
                   'paidAt', COALESCE(o.paid_at, o.created_at)) AS j
            FROM paid o
            JOIN evs e ON e.id = o.event_id
            LEFT JOIN profiles p ON p.id = o.user_id
           ORDER BY COALESCE(o.paid_at, o.created_at) DESC
           LIMIT 8
        ) q
    ), '[]'::jsonb),
    'invoices', (
      SELECT jsonb_build_object(
               'open', count(*) FILTER (WHERE status IN ('open', 'submitted', 'overdue')),
               'overdue', count(*) FILTER (WHERE status = 'overdue'
                                           OR (status IN ('open', 'submitted') AND due_at < now())))
        FROM invoices WHERE organizer_id = p_organizer_id
    )
  );
$$;

-- ─── The whole platform ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION platform_overview(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH win AS (SELECT LEAST(GREATEST(p_days, 1), 366) AS n),
  paid AS (SELECT * FROM orders WHERE status = 'paid'),
  days AS (
    SELECT generate_series(current_date - ((SELECT n FROM win) - 1), current_date, interval '1 day')::date AS d
  ),
  daily AS (
    SELECT day, jsonb_object_agg(currency, jsonb_build_object(
             'orders', orders, 'tickets', tickets, 'grossCents', gross, 'commissionCents', commission)) AS by_currency
      FROM (
        SELECT (paid_at AT TIME ZONE 'UTC')::date AS day, currency, count(*) AS orders,
               sum(quantity) AS tickets, sum(buyer_total_cents) AS gross,
               sum(commission_cents + commission_tax_cents) AS commission
          FROM paid
         WHERE paid_at >= now() - make_interval(days => (SELECT n FROM win))
         GROUP BY 1, 2
      ) g
     GROUP BY day
  )
  SELECT jsonb_build_object(
    'people', (
      SELECT jsonb_build_object(
               'total', count(*),
               'blocked', count(*) FILTER (WHERE is_blocked),
               'staff', count(*) FILTER (WHERE role IN ('admin', 'super_admin')),
               'newInWindow', count(*) FILTER (WHERE created_at >= now() - make_interval(days => (SELECT n FROM win))))
        FROM profiles
    ),
    'organizers', (
      SELECT jsonb_build_object(
               'total', count(*),
               'banned', count(*) FILTER (WHERE is_banned),
               'payoutReady', count(*) FILTER (WHERE stripe_onboarding_complete AND stripe_payouts_enabled))
        FROM organizers
    ),
    'events', (
      SELECT jsonb_build_object(
               'total', count(*),
               'draft', count(*) FILTER (WHERE status = 'draft'),
               'pendingReview', count(*) FILTER (WHERE status = 'pending_review'),
               'rejected', count(*) FILTER (WHERE status = 'rejected'),
               'published', count(*) FILTER (WHERE status = 'published'),
               'suspended', count(*) FILTER (WHERE status = 'suspended'),
               'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
               'completed', count(*) FILTER (WHERE status = 'completed'))
        FROM events
    ),
    'sales', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'orders', orders, 'tickets', tickets, 'grossCents', gross,
               'commissionCents', commission, 'platformNetCents', platform_net,
               'stripeOrders', stripe_orders, 'manualOrders', manual_orders))
        FROM (
          SELECT currency, count(*) AS orders, sum(quantity) AS tickets,
                 sum(buyer_total_cents) AS gross,
                 sum(commission_cents + commission_tax_cents) AS commission,
                 sum(COALESCE(platform_net_cents, 0)) AS platform_net,
                 count(*) FILTER (WHERE channel = 'stripe') AS stripe_orders,
                 count(*) FILTER (WHERE channel = 'manual') AS manual_orders
            FROM paid GROUP BY currency
        ) s
    ), '{}'::jsonb),
    -- BRD §20 — what organizers owe Eventsli on the manual channel.
    'receivables', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'openCents', open_cents, 'overdueCents', overdue_cents, 'overdueCount', overdue_count))
        FROM (
          SELECT currency,
                 COALESCE(sum(amount_cents) FILTER (WHERE status IN ('open', 'submitted', 'overdue')), 0) AS open_cents,
                 COALESCE(sum(amount_cents) FILTER (WHERE status = 'overdue'
                   OR (status IN ('open', 'submitted') AND due_at < now())), 0) AS overdue_cents,
                 count(*) FILTER (WHERE status = 'overdue'
                   OR (status IN ('open', 'submitted') AND due_at < now())) AS overdue_count
            FROM invoices GROUP BY currency
        ) r
    ), '{}'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', days.d, 'byCurrency', COALESCE(daily.by_currency, '{}'::jsonb))
             ORDER BY days.d)
        FROM days LEFT JOIN daily ON daily.day = days.d
    ), '[]'::jsonb),
    'topEvents', COALESCE((
      SELECT jsonb_agg(q.j ORDER BY q.k DESC)
        FROM (
          SELECT sum(o.buyer_total_cents) AS k, jsonb_build_object(
                   'id', e.id, 'title', e.title, 'organizer', org.display_name,
                   'currency', o.currency, 'grossCents', sum(o.buyer_total_cents),
                   'tickets', sum(o.quantity)) AS j
            FROM paid o
            JOIN events e ON e.id = o.event_id
            JOIN organizers org ON org.id = e.organizer_id
           WHERE o.paid_at >= now() - make_interval(days => (SELECT n FROM win))
           GROUP BY e.id, e.title, org.display_name, o.currency
           ORDER BY sum(o.buyer_total_cents) DESC
           LIMIT 5
        ) q
    ), '[]'::jsonb)
  );
$$;

-- ─── Only the API may call them ────────────────────────────────────────────
REVOKE ALL ON FUNCTION event_sales_summary(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION organizer_dashboard_summary(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform_overview(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION event_sales_summary(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION organizer_dashboard_summary(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION platform_overview(INT) TO service_role;
