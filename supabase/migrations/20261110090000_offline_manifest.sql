-- ═══════════════════════════════════════════════════════════════════════════
-- Offline admission, part 1: the event's ticket list a door keeps on the phone.
--
-- A phone with no signal decides from its own copy of the event's tickets: is
-- this ticket ours, is it still good, is this code the current one, has it
-- been used. GET /scan/manifest serves that copy, the whole list on first
-- open and then only what changed, keyed on tickets.updated_at
-- (20261108090000).
--
-- One gap closed here: a ticket stops admitting when its ORDER is no longer
-- paid (check_in_ticket_v2, T-023), but a cancelled or refunded order did not
-- touch its tickets, so a device's copy would never hear of it. The orders
-- trigger below makes every status change on an order count as a change to
-- each of its tickets.
--
-- DEPLOY ORDER: apply BEFORE the API that serves /scan/manifest.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION touch_tickets_on_order_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- tickets_touch_updated_at sets the time; this only gives it a reason to.
    UPDATE tickets SET updated_at = now() WHERE order_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS orders_touch_tickets ON orders;
CREATE TRIGGER orders_touch_tickets
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION touch_tickets_on_order_status();

-- ─── The list ──────────────────────────────────────────────────────────────
-- One page of an event's tickets in (updated_at, id) order: every ticket when
-- p_since is NULL, otherwise those changed after it. p_after_* continues a
-- page. The status is the door's view, decided as check_in_ticket_v2 decides
-- it: a ticket on an order that is no longer paid is `void`. Names only when
-- p_names (the organizer's "include names offline").
--
-- `now` is returned so the API can set the next "since" from the database's
-- clock, not the server's.
CREATE OR REPLACE FUNCTION event_door_manifest(
  p_event_id UUID,
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_after_at TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 1000,
  p_names BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
  WITH page AS (
    SELECT t.id, t.qr_version, t.status, o.status AS order_status, t.scanned_at, t.updated_at,
           t.attendee_name, t.transfer_count, o.guest_name, p.full_name,
           tt.name AS tier, s.section_key, s.row_label, s.seat_number, tb.label AS table_label
      FROM tickets t
      JOIN orders o             ON o.id = t.order_id
      LEFT JOIN profiles p      ON p.id = o.user_id
      LEFT JOIN ticket_tiers tt ON tt.id = t.tier_id
      LEFT JOIN seats s         ON s.id = t.seat_id
      LEFT JOIN tables tb       ON tb.id = t.table_id
     WHERE t.event_id = p_event_id
       AND (p_since IS NULL OR t.updated_at > p_since)
       AND (p_after_at IS NULL OR (t.updated_at, t.id) > (p_after_at, p_after_id))
     ORDER BY t.updated_at, t.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 2000)
  )
  SELECT jsonb_build_object(
    'now', now(),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ticketId', id,
               'v', qr_version,
               'status', CASE WHEN status = 'void' OR order_status <> 'paid' THEN 'void' ELSE status::TEXT END,
               'scannedAt', scanned_at,
               'updatedAt', updated_at,
               'tier', tier,
               'seat', CASE WHEN seat_number IS NOT NULL
                         THEN concat_ws(' ', section_key, concat(row_label, seat_number)) END,
               'table', table_label,
               'holder', CASE WHEN p_names
                           THEN door_holder(attendee_name, transfer_count, guest_name, full_name) END)
             ORDER BY updated_at, id)
        FROM page), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── Privileges ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION touch_tickets_on_order_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION event_door_manifest(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION event_door_manifest(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT, BOOLEAN) TO service_role;
