-- ═══════════════════════════════════════════════════════════════════════════
-- Dashboard audit, phase 4: money that means one thing on every screen, sums
-- done in the database, the indexes the hot paths were missing, a lockout for
-- door PINs, and the default that keeps the next function private.
--
-- Additive. No row is deleted or rewritten. Constraints are added NOT VALID and
-- then validated, so a row that breaks one stops the migration (and rolls the
-- whole thing back) instead of being changed to fit.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. The next function is private by default (M29) ─────────────────────
-- 20260914090000 revoked EXECUTE per schema. A schema-level default can only
-- ADD to the global one, and the global default grants EXECUTE to PUBLIC — so
-- a function created without its own REVOKE was still callable with the anon
-- key. This removes it from the global default of the role that creates our
-- functions. First in the file, so the functions below are born private too.
DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', current_user);
END $$;

-- ─── 2. The settings event creation cannot work without (M2) ──────────────
-- The base schema seeds these and the code falls back to the same numbers.
-- A database with no rows refuses to create an event in any country
-- ("Supported: none configured"). Never over a value an admin has saved.
INSERT INTO platform_settings (key, value) VALUES
  ('commission',     '{"default_pct": 1.50, "default_tax_pct": 0}'),
  ('payment_fee',    '{"default_pct": 2.90, "default_fixed_cents": 30}'),
  ('stripe_cost',    '{"pct": 2.90, "fixed_cents": 30}'),
  ('currencies',     '{"allowed": ["CAD", "USD"], "by_country": {"CA": "CAD", "US": "USD"}}'),
  ('manual_invoice', '{"due_days": 7, "min_hours_before_event": 24}')
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Door PINs lock after repeated failures (M21) ──────────────────────
-- Per device, in the database: the sign-in limiter is per address and per
-- process, so rotating addresses bought unlimited guesses at a known device.
ALTER TABLE scan_devices
  ADD COLUMN IF NOT EXISTS failed_pin_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

-- One statement, so two wrong PINs at once both count.
CREATE OR REPLACE FUNCTION record_device_pin_failure(p_device_id UUID, p_max_failures INT, p_lock_minutes INT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE scan_devices
     SET failed_pin_count = CASE WHEN failed_pin_count + 1 >= GREATEST(p_max_failures, 1)
                                 THEN 0 ELSE failed_pin_count + 1 END,
         pin_locked_until = CASE WHEN failed_pin_count + 1 >= GREATEST(p_max_failures, 1)
                                 THEN now() + make_interval(mins => GREATEST(p_lock_minutes, 1))
                                 ELSE pin_locked_until END
   WHERE id = p_device_id
  RETURNING pin_locked_until;
$$;

-- ─── 4. Sums in the database (M20) ────────────────────────────────────────
-- Three endpoints pulled every matching paid order across the wire and added
-- them up in Node, ignoring errors. Past PostgREST's row cap the totals were
-- silently low.
--
-- WHAT "NET" MEANS, everywhere below (M27): what the organizer keeps. A card
-- order's organizer_net_cents already has our commission taken off. A door
-- sale's is the whole amount — they collected it — and they owe us the
-- commission, so it is taken off here. Before this, the organizer dashboard
-- added door sales at gross and called it net.

CREATE OR REPLACE FUNCTION event_order_totals(p_event_id UUID, p_status TEXT DEFAULT 'paid', p_channel TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH o AS (
    SELECT * FROM orders
     WHERE event_id = p_event_id
       AND (p_status = 'all' OR status::text = p_status)
       AND (p_channel IS NULL OR channel::text = p_channel)
  )
  SELECT jsonb_build_object(
    'totals', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'orders', n, 'tickets', tickets, 'grossCents', gross,
               'netCents', net, 'commissionCents', commission))
        FROM (
          SELECT currency, count(*) AS n, COALESCE(sum(quantity), 0) AS tickets,
                 COALESCE(sum(buyer_total_cents), 0) AS gross,
                 COALESCE(sum(organizer_net_cents
                   - CASE WHEN channel = 'manual' THEN commission_cents + commission_tax_cents ELSE 0 END), 0) AS net,
                 COALESCE(sum(commission_cents + commission_tax_cents), 0) AS commission
            FROM o GROUP BY currency
        ) t
    ), '{}'::jsonb),
    'byChannel', jsonb_build_object(
      'stripe', (SELECT count(*) FROM o WHERE channel = 'stripe'),
      'manual', (SELECT count(*) FROM o WHERE channel = 'manual')
    )
  );
$$;

CREATE OR REPLACE FUNCTION admin_event_sales(p_event_ids UUID[])
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(event_id, jsonb_build_object(
           'orders', n, 'tickets', tickets, 'grossCents', gross)), '{}'::jsonb)
    FROM (
      SELECT event_id, count(*) AS n, COALESCE(sum(quantity), 0) AS tickets,
             COALESCE(sum(buyer_total_cents), 0) AS gross
        FROM orders
       WHERE status = 'paid' AND event_id = ANY(p_event_ids)
       GROUP BY event_id
    ) s;
$$;

CREATE OR REPLACE FUNCTION admin_organizer_sales(p_organizer_ids UUID[])
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH ids AS (SELECT DISTINCT unnest(p_organizer_ids) AS id),
  ev AS (
    SELECT organizer_id, count(*) AS total,
           count(*) FILTER (WHERE status = 'published') AS published,
           count(*) FILTER (WHERE status = 'pending_review') AS pending_review
      FROM events WHERE organizer_id = ANY(p_organizer_ids)
     GROUP BY organizer_id
  ),
  sa AS (
    SELECT organizer_id, jsonb_object_agg(currency, jsonb_build_object('orders', n, 'grossCents', gross)) AS by_currency
      FROM (
        SELECT organizer_id, currency, count(*) AS n, COALESCE(sum(buyer_total_cents), 0) AS gross
          FROM orders WHERE status = 'paid' AND organizer_id = ANY(p_organizer_ids)
         GROUP BY organizer_id, currency
      ) g
     GROUP BY organizer_id
  )
  SELECT COALESCE(jsonb_object_agg(ids.id, jsonb_build_object(
           'events', jsonb_build_object(
             'total', COALESCE(ev.total, 0),
             'published', COALESCE(ev.published, 0),
             'pendingReview', COALESCE(ev.pending_review, 0)),
           'sales', COALESCE(sa.by_currency, '{}'::jsonb))), '{}'::jsonb)
    FROM ids
    LEFT JOIN ev ON ev.organizer_id = ids.id
    LEFT JOIN sa ON sa.organizer_id = ids.id;
$$;

-- ─── 5. The dashboards, with one meaning of net (M27, M15, L25) ───────────
-- Same shapes as 20260914110000, with three changes called out inline.

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
    -- CHANGED: door sales count net of the commission the organizer owes.
    'netCents',        (SELECT COALESCE(sum(organizer_net_cents
                          - CASE WHEN channel = 'manual' THEN commission_cents + commission_tax_cents ELSE 0 END), 0)
                          FROM paid),
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
  -- CHANGED: a sale lands on the calendar day at ITS OWN event, as it does on
  -- the event's page. It was bucketed in UTC here, so "sold on Friday" could
  -- differ between the two screens for the same order.
  daily AS (
    SELECT day, jsonb_object_agg(currency, jsonb_build_object(
             'orders', orders, 'tickets', tickets, 'grossCents', gross)) AS by_currency
      FROM (
        SELECT (o.paid_at AT TIME ZONE e.timezone)::date AS day, o.currency,
               count(*) AS orders, sum(o.quantity) AS tickets, sum(o.buyer_total_cents) AS gross
          FROM paid o JOIN evs e ON e.id = o.event_id
         WHERE o.paid_at >= now() - make_interval(days => (SELECT n FROM win) + 1)
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
                 sum(buyer_total_cents) AS gross,
                 -- CHANGED: door sales net of the commission owed on them.
                 sum(organizer_net_cents
                   - CASE WHEN channel = 'manual' THEN commission_cents + commission_tax_cents ELSE 0 END) AS net,
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
                   'eventTimezone', e.timezone,
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
  ),
  -- CHANGED: what Eventsli keeps includes the commission on door sales. A card
  -- order records it in platform_net_cents; a door sale has none recorded, and
  -- was left out entirely.
  money AS (
    SELECT currency, paid_at, quantity, buyer_total_cents, channel,
           commission_cents + commission_tax_cents AS commission,
           CASE WHEN channel = 'manual' AND platform_net_cents IS NULL
                THEN commission_cents + commission_tax_cents
                ELSE COALESCE(platform_net_cents, 0) END AS platform_net
      FROM paid
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
    -- All time, as before.
    'sales', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'orders', orders, 'tickets', tickets, 'grossCents', gross,
               'commissionCents', commission, 'platformNetCents', platform_net,
               'stripeOrders', stripe_orders, 'manualOrders', manual_orders))
        FROM (
          SELECT currency, count(*) AS orders, sum(quantity) AS tickets,
                 sum(buyer_total_cents) AS gross, sum(commission) AS commission,
                 sum(platform_net) AS platform_net,
                 count(*) FILTER (WHERE channel = 'stripe') AS stripe_orders,
                 count(*) FILTER (WHERE channel = 'manual') AS manual_orders
            FROM money GROUP BY currency
        ) s
    ), '{}'::jsonb),
    -- CHANGED (M15): the same figures for the chosen period, so the 7/30/90
    -- switch beside the money cards actually changes them.
    'salesInWindow', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'orders', orders, 'tickets', tickets, 'grossCents', gross,
               'commissionCents', commission, 'platformNetCents', platform_net))
        FROM (
          SELECT currency, count(*) AS orders, sum(quantity) AS tickets,
                 sum(buyer_total_cents) AS gross, sum(commission) AS commission,
                 sum(platform_net) AS platform_net
            FROM money
           WHERE paid_at >= now() - make_interval(days => (SELECT n FROM win))
           GROUP BY currency
        ) s
    ), '{}'::jsonb),
    -- BRD §20 — what organizers owe Eventsli on the manual channel.
    -- CHANGED: `uninvoicedCents` is commission accrued on door sales that no
    -- invoice covers yet — the manual ledger's balance less what open invoices
    -- already ask for. It was invisible until an invoice was raised.
    'receivables', COALESCE((
      SELECT jsonb_object_agg(currency, jsonb_build_object(
               'openCents', open_cents, 'overdueCents', overdue_cents, 'overdueCount', overdue_count,
               'uninvoicedCents', GREATEST(owed_cents - open_cents, 0)))
        FROM (
          SELECT cur.currency,
                 COALESCE(inv.open_cents, 0) AS open_cents,
                 COALESCE(inv.overdue_cents, 0) AS overdue_cents,
                 COALESCE(inv.overdue_count, 0) AS overdue_count,
                 COALESCE(led.owed_cents, 0) AS owed_cents
            FROM (SELECT currency FROM invoices
                  UNION SELECT currency FROM ledger_entries WHERE channel = 'manual') cur
            LEFT JOIN (
              SELECT currency,
                     COALESCE(sum(amount_cents) FILTER (WHERE status IN ('open', 'submitted', 'overdue')), 0) AS open_cents,
                     COALESCE(sum(amount_cents) FILTER (WHERE status = 'overdue'
                       OR (status IN ('open', 'submitted') AND due_at < now())), 0) AS overdue_cents,
                     count(*) FILTER (WHERE status = 'overdue'
                       OR (status IN ('open', 'submitted') AND due_at < now())) AS overdue_count
                FROM invoices GROUP BY currency
            ) inv ON inv.currency = cur.currency
            LEFT JOIN (
              SELECT currency,
                     sum(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END) AS owed_cents
                FROM ledger_entries WHERE channel = 'manual' GROUP BY currency
            ) led ON led.currency = cur.currency
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

-- ─── 6. Markets the platform actually sells in (M18, M28) ─────────────────
-- Any two letters were accepted and became a Stripe account's country. The
-- currency follows the country (BRD §07) and is never chosen separately.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizers_country_supported') THEN
    ALTER TABLE organizers ADD CONSTRAINT organizers_country_supported
      CHECK (country IN ('CA', 'US')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_country_supported') THEN
    ALTER TABLE events ADD CONSTRAINT events_country_supported
      CHECK (country IN ('CA', 'US')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_currency_follows_country') THEN
    ALTER TABLE events ADD CONSTRAINT events_currency_follows_country
      CHECK ((country = 'CA' AND currency = 'CAD') OR (country = 'US' AND currency = 'USD')) NOT VALID;
  END IF;
END $$;

ALTER TABLE organizers VALIDATE CONSTRAINT organizers_country_supported;
ALTER TABLE events VALIDATE CONSTRAINT events_country_supported;
ALTER TABLE events VALIDATE CONSTRAINT events_currency_follows_country;

-- ─── 7. Indexes on the hot paths (M28) ────────────────────────────────────
-- Plain CREATE INDEX: the apply script runs each migration in a transaction,
-- where CONCURRENTLY is not allowed, and these tables are small today.
CREATE INDEX IF NOT EXISTS reservation_items_reservation_idx ON reservation_items (reservation_id);
-- fulfill_checkout already returns the existing order for a converted hold;
-- this makes "one order per hold" a fact rather than a habit.
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_per_reservation ON orders (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_paid_at_idx ON orders (paid_at) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_event_idx ON invoices (event_id, status);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit (action, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_devices_event_idx ON scan_devices (event_id);
CREATE INDEX IF NOT EXISTS seats_tier_idx ON seats (tier_id) WHERE tier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_tier_idx ON tickets (tier_id) WHERE tier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scans_device_idx ON scans (device_id) WHERE device_id IS NOT NULL;

-- ─── 8. Only the API may call the new functions ───────────────────────────
REVOKE ALL ON FUNCTION record_device_pin_failure(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_order_totals(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_event_sales(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_organizer_sales(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_device_pin_failure(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION event_order_totals(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_event_sales(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION admin_organizer_sales(UUID[]) TO service_role;
