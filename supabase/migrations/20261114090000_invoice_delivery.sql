-- ═══════════════════════════════════════════════════════════════════════════
-- COMMISSION INVOICES: getting one raised, delivered, and through to settled.
--
-- An audit of the door-sale invoice workflow (2026-11-11) found the pieces in
-- place and the chain between them broken. This migration is the database
-- half of the repair; the API and console carry the rest.
--
-- ─── 1. A RECEIPT SENT ON AN OVERDUE INVOICE WAS LOST WITHIN THE HOUR ──────
--
-- `mark_overdue_invoices` moved BOTH 'open' and 'submitted' invoices to
-- 'overdue' once their due date passed. So:
--
--   · an organizer whose invoice was overdue uploaded their receipt — the
--     invoice became 'submitted' — and the next hourly run moved it straight
--     back to 'overdue'. The receipt dropped out of the admin's "Receipt sent"
--     queue (the one place anyone checks receipts), and the organizer's page
--     offered the upload form again as though nothing had been sent;
--   · the job emailed "Scanning disabled" for every invoice it moved, so each
--     receipt submitted on an overdue invoice earned the organizer ANOTHER
--     "Scanning disabled" email an hour later.
--
-- Now only 'open' is relabelled. A submitted invoice stays submitted — still
-- unpaid, still shutting the gate (`scanner_is_locked` reads `due_at`, not the
-- label), but in the review queue where its receipt can be checked. The
-- overdue email is sent ONCE per invoice, recorded in `overdue_notified_at`.
--
-- ─── 2. NOTHING LISTED WHAT WAS READY TO INVOICE ───────────────────────────
--
-- Invoices are raised by an admin (`POST /admin/events/:id/invoices`), and no
-- screen called that endpoint — so no invoice was ever raised, no organizer was
-- ever invoiced, and door commission accrued as a receivable nobody collected.
-- `admin_uninvoiced_commission()` is the queue the console now shows: every
-- event whose door commission is not yet covered by an unpaid invoice.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN invoices.overdue_notified_at IS
  'When the organizer was told this invoice is overdue and scanning is off. Set once, so the email is sent once.';

-- Everything already past due has already been through the old job, which
-- emailed it. Do not email it again on the first run after this deploy.
UPDATE invoices
   SET overdue_notified_at = COALESCE(overdue_notified_at, now())
 WHERE status IN ('open', 'submitted', 'overdue') AND due_at < now();

-- Give back the receipts the old job took away. A proof can only be attached
-- while an invoice is unpaid, so an 'overdue' invoice carrying one is an
-- invoice whose receipt is still waiting for an admin.
UPDATE invoices
   SET status = 'submitted'
 WHERE status = 'overdue' AND proof_submitted_at IS NOT NULL;

-- ─── The overdue sweep ─────────────────────────────────────────────────────
-- Kept for anything that still calls it, now labelling 'open' only.
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  UPDATE invoices SET status = 'overdue'
   WHERE status = 'open' AND due_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/**
 * Claims every invoice that has just fallen due and not yet been announced:
 * labels the open ones 'overdue' and stamps `overdue_notified_at` on all of
 * them, in ONE statement — so the rows returned are exactly the ones to email,
 * none is emailed twice, and none that falls due mid-run is missed.
 *
 * (The job used to SELECT the crossing invoices and then run the update
 * separately; an invoice falling due between the two was labelled and never
 * announced.)
 */
CREATE OR REPLACE FUNCTION claim_overdue_invoices()
RETURNS TABLE (invoice_id UUID, invoice_status invoice_status) AS $$
  UPDATE invoices
     SET status = CASE WHEN status = 'open' THEN 'overdue'::invoice_status ELSE status END,
         overdue_notified_at = now()
   WHERE status IN ('open', 'submitted', 'overdue')
     AND due_at < now()
     AND overdue_notified_at IS NULL
  RETURNING id, status;
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public;

-- ─── What is ready to invoice ──────────────────────────────────────────────
/**
 * Every event whose door commission is not yet covered by an unpaid invoice,
 * soonest event first — the due date is capped before doors, so those are the
 * ones where waiting costs the organizer the most time to pay.
 *
 * `unpaid_invoice_id` is set when an invoice is still open for the event:
 * `raise_commission_invoice` allows one at a time, so that event's newer sales
 * wait for the current invoice to be settled.
 */
CREATE OR REPLACE FUNCTION admin_uninvoiced_commission()
RETURNS TABLE (
  event_id UUID, title TEXT, slug TEXT, starts_at TIMESTAMPTZ, timezone TEXT,
  organizer_id UUID, organizer_name TEXT, currency CHAR(3),
  owed_cents BIGINT, unpaid_invoice_cents BIGINT, uninvoiced_cents BIGINT,
  unpaid_invoice_id UUID, door_sales BIGINT, last_sale_at TIMESTAMPTZ
) AS $$
  WITH owed AS (
    SELECT l.event_id, l.currency,
           SUM(CASE WHEN l.direction = 'credit' THEN l.amount_cents ELSE -l.amount_cents END)::BIGINT AS cents
      FROM ledger_entries l
     WHERE l.channel = 'manual'
     GROUP BY l.event_id, l.currency
  ), unpaid AS (
    SELECT i.event_id, i.currency, SUM(i.amount_cents)::BIGINT AS cents,
           (array_agg(i.id ORDER BY i.issued_at DESC))[1] AS invoice_id
      FROM invoices i
     WHERE i.status IN ('open', 'submitted', 'overdue')
     GROUP BY i.event_id, i.currency
  ), sales AS (
    SELECT o.event_id, count(*)::BIGINT AS n, max(o.created_at) AS last_at
      FROM orders o
     WHERE o.channel = 'manual'
     GROUP BY o.event_id
  )
  SELECT e.id, e.title, e.slug, e.starts_at, e.timezone,
         org.id, org.display_name, ow.currency,
         ow.cents, COALESCE(u.cents, 0), GREATEST(ow.cents - COALESCE(u.cents, 0), 0),
         u.invoice_id, COALESCE(s.n, 0), s.last_at
    FROM owed ow
    JOIN events e ON e.id = ow.event_id
    JOIN organizers org ON org.id = e.organizer_id
    LEFT JOIN unpaid u ON u.event_id = ow.event_id AND u.currency = ow.currency
    LEFT JOIN sales s ON s.event_id = ow.event_id
   WHERE ow.cents - COALESCE(u.cents, 0) > 0
   ORDER BY e.starts_at, e.id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION mark_overdue_invoices() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_overdue_invoices() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_uninvoiced_commission() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_overdue_invoices() TO service_role;
GRANT EXECUTE ON FUNCTION claim_overdue_invoices() TO service_role;
GRANT EXECUTE ON FUNCTION admin_uninvoiced_commission() TO service_role;
