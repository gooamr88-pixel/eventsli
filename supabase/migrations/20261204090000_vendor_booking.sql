-- ═══════════════════════════════════════════════════════════════════════════
-- Vendor booking (owner, 2026-11-21): the reference flow on top of the vendor
-- system in 20261203090000 (apply that first).
--
-- The owner sent screenshots of a vendor flow that books straight away:
--   booth page (photo, what is included) → booth add-ons and marketing add-ons
--   → business details, social links, documents → checkout with a cart timer.
-- They chose BOTH ways of working, per event:
--
--   booking_mode 'apply'    (default, today's behaviour) the vendor fills the
--                           same steps, then SENDS an application; the
--                           organizer reviews it and sends an offer as before.
--   booking_mode 'instant'  the vendor RESERVES: the booth is held for
--                           hold_minutes while they fill their details, then
--                           they sign and pay. Paid → confirmed, no review.
--
-- New stages:
--   draft    an application being filled in (apply mode). The organizer does
--            not see it; it holds nothing.
--   held     a reservation in progress (instant mode). It COUNTS against the
--            booth type's quantity and claims its floor-plan booth until
--            hold_expires_at. Paying turns it into 'confirmed'.
--   expired  a hold that ran out or was released. Holds nothing.
--
-- THE RULES, and where each one lives:
--   · a hold never takes a booth type past its quantity   vendor_hold, under a
--     (confirmed + live holds)                            row lock on the type
--   · an offer accepted never oversells a live hold       vendor_accept (redone)
--   · one floor-plan booth, one vendor                    vendor_applications_
--                                                         booth_once, now with
--                                                         'held'
--   · a hold is signed before it is paid, and only        vendor_sign_hold
--     while it lasts
--   · a card payment confirms a hold only for the         vendor_record_payment
--     session we opened                                   (redone)
--
-- DOCUMENTS live in a PRIVATE bucket, `vendor-documents` (licences, insurance
-- certificates). The API signs each upload and each read; nothing is public.
--
-- SAFE TO RUN BEFORE THE CODE: the defaults keep every existing program in
-- 'apply' mode and every new column empty; the redone functions behave as
-- before for the stages that already exist.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.vendor_applications') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261203090000_vendors.sql first.';
  END IF;
END $$;

-- ── The program: how vendors book, and what the public page shows ─────────
ALTER TABLE vendor_programs
  ADD COLUMN IF NOT EXISTS booking_mode TEXT NOT NULL DEFAULT 'apply',
  ADD COLUMN IF NOT EXISTS hold_minutes INT NOT NULL DEFAULT 20,
  -- What vendors must upload: [{ id, label, hint, required }], at most 8.
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The numbers on the public page ("80% of exhibitors…"): [{ value, label }], at most 3.
  ADD COLUMN IF NOT EXISTS highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Up to 3 photos for the public page: [{ url, path }] in event-media.
  ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE vendor_programs DROP CONSTRAINT IF EXISTS vendor_program_booking_shape;
ALTER TABLE vendor_programs ADD CONSTRAINT vendor_program_booking_shape CHECK (
  booking_mode IN ('apply', 'instant')
  AND hold_minutes BETWEEN 10 AND 60
  AND jsonb_typeof(documents) = 'array' AND jsonb_array_length(documents) <= 8 AND pg_column_size(documents) <= 8000
  AND jsonb_typeof(highlights) = 'array' AND jsonb_array_length(highlights) <= 3 AND pg_column_size(highlights) <= 4000
  AND jsonb_typeof(photos) = 'array' AND jsonb_array_length(photos) <= 3 AND pg_column_size(photos) <= 4000
);

-- ── A photo per booth type ────────────────────────────────────────────────
ALTER TABLE vendor_booth_types
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE vendor_booth_types DROP CONSTRAINT IF EXISTS vendor_booth_image_together;
ALTER TABLE vendor_booth_types ADD CONSTRAINT vendor_booth_image_together CHECK ((image_url IS NULL) = (image_path IS NULL));

-- ── Add-ons: extras a vendor adds to their booth ──────────────────────────
-- 'booth'      things for the space: an extra chair, a table cover, a rack
-- 'marketing'  promotion: a social post, a logo in the programme
-- The organizer delivers them; the price joins the booth fee.
CREATE TABLE IF NOT EXISTS vendor_addons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'booth' CHECK (kind IN ('booth', 'marketing')),
  name         TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description  TEXT CHECK (description IS NULL OR char_length(description) <= 300),
  price_cents  BIGINT NOT NULL CHECK (price_cents >= 0 AND price_cents <= 10000000000),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_addons_event_idx ON vendor_addons (event_id, kind, sort_order);
ALTER TABLE vendor_addons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vendor_addons FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_addons TO service_role;

-- ── The application: business details, add-ons, documents, the hold ───────
ALTER TABLE vendor_applications
  -- [{ id, name, kind, priceCents }] — copied at the time, so a later price
  -- change never moves a booking.
  ADD COLUMN IF NOT EXISTS addons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS address TEXT CHECK (address IS NULL OR char_length(address) <= 200),
  ADD COLUMN IF NOT EXISTS city TEXT CHECK (city IS NULL OR char_length(city) <= 80),
  ADD COLUMN IF NOT EXISTS postal_code TEXT CHECK (postal_code IS NULL OR char_length(postal_code) <= 20),
  -- { instagram, x, youtube, facebook, whatsapp, linkedin } — handles or links.
  ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ id, label, path, fileName, contentType, size, uploadedAt, status, note }]
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

ALTER TABLE vendor_applications DROP CONSTRAINT IF EXISTS vendor_app_booking_shape;
ALTER TABLE vendor_applications ADD CONSTRAINT vendor_app_booking_shape CHECK (
  jsonb_typeof(addons) = 'array' AND jsonb_array_length(addons) <= 30 AND pg_column_size(addons) <= 8000
  AND jsonb_typeof(socials) = 'object' AND pg_column_size(socials) <= 4000
  AND jsonb_typeof(documents) = 'array' AND jsonb_array_length(documents) <= 8 AND pg_column_size(documents) <= 12000
);

-- The new stages and the new source. Both CHECKs were written inline in
-- 20261203090000, so Postgres named them <table>_<column>_check.
ALTER TABLE vendor_applications DROP CONSTRAINT IF EXISTS vendor_applications_stage_check;
ALTER TABLE vendor_applications ADD CONSTRAINT vendor_applications_stage_check CHECK (stage IN (
  'draft', 'submitted', 'waitlisted', 'offered', 'held', 'confirmed', 'rejected', 'withdrawn', 'cancelled', 'expired'
));
ALTER TABLE vendor_applications DROP CONSTRAINT IF EXISTS vendor_applications_source_check;
ALTER TABLE vendor_applications ADD CONSTRAINT vendor_applications_source_check
  CHECK (source IN ('application', 'organizer', 'booking'));

-- A live hold claims its floor-plan booth like an offer does. A hold that ran
-- out still sits in this index until vendor_hold marks it 'expired' — which
-- it does for the whole event before it claims anything.
DROP INDEX IF EXISTS vendor_applications_booth_once;
CREATE UNIQUE INDEX vendor_applications_booth_once
  ON vendor_applications (event_id, booth_key)
  WHERE booth_key IS NOT NULL AND stage IN ('offered', 'held', 'confirmed');
CREATE INDEX IF NOT EXISTS vendor_applications_hold_idx
  ON vendor_applications (event_id, hold_expires_at) WHERE stage = 'held';

-- ── The documents bucket: private ─────────────────────────────────────────
-- Guarded on the table, as 20260905090000 explains (CI runs without storage).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'vendor-documents',
      'vendor-documents',
      false,
      10485760,                                            -- 10 MB
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE
      SET public             = EXCLUDED.public,
          file_size_limit    = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;


-- ═══ FUNCTIONS ═════════════════════════════════════════════════════════════

-- ── Hold a booth (instant mode) ───────────────────────────────────────────
-- Creates the reservation, or refuses with VENDOR_SOLD_OUT / VENDOR_BOOTH_TAKEN.
-- Holds that ran out anywhere in the event are let go first, and so is this
-- vendor's own earlier hold here: one reservation per vendor per event.
CREATE OR REPLACE FUNCTION vendor_hold(
  p_event_id UUID, p_email TEXT, p_business_name TEXT, p_contact_name TEXT,
  p_booth_type_id UUID, p_booth_key TEXT, p_booth_label TEXT,
  p_amount_cents BIGINT, p_currency TEXT, p_addons JSONB, p_includes JSONB,
  p_staff_passes INT, p_terms TEXT, p_minutes INT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quantity INT;
  v_taken INT;
  v_id UUID;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RAISE EXCEPTION 'VENDOR_BAD_AMOUNT'; END IF;
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 120 THEN RAISE EXCEPTION 'VENDOR_BAD_EXPIRY'; END IF;

  SELECT quantity INTO v_quantity FROM vendor_booth_types
   WHERE id = p_booth_type_id AND event_id = p_event_id AND is_active AND is_public
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VENDOR_BOOTH_NOT_FOUND'; END IF;

  UPDATE vendor_applications
     SET stage = 'expired', closed_at = now(), updated_at = now()
   WHERE event_id = p_event_id AND stage = 'held'
     AND (hold_expires_at <= now() OR lower(contact_email) = lower(p_email));

  IF v_quantity IS NOT NULL THEN
    SELECT count(*) INTO v_taken FROM vendor_applications
     WHERE booth_type_id = p_booth_type_id
       AND (stage = 'confirmed' OR (stage = 'held' AND hold_expires_at > now()));
    IF v_taken >= v_quantity THEN RAISE EXCEPTION 'VENDOR_SOLD_OUT'; END IF;
  END IF;

  INSERT INTO vendor_applications (
    event_id, stage, source, business_name, contact_name, contact_email, currency,
    booth_type_id, requested_booth_type_id, booth_key, booth_label, amount_cents,
    addons, includes, staff_passes, terms, offer_sent_at, offer_expires_at, hold_expires_at
  ) VALUES (
    p_event_id, 'held', 'booking', left(btrim(p_business_name), 120), left(p_contact_name, 120), lower(p_email),
    upper(p_currency), p_booth_type_id, p_booth_type_id, NULLIF(btrim(p_booth_key), ''),
    NULLIF(btrim(p_booth_label), ''), p_amount_cents, COALESCE(p_addons, '[]'::jsonb),
    COALESCE(p_includes, '[]'::jsonb), GREATEST(0, LEAST(50, COALESCE(p_staff_passes, 0))), p_terms,
    now(), now() + make_interval(mins => p_minutes), now() + make_interval(mins => p_minutes)
  ) RETURNING id INTO v_id;

  INSERT INTO vendor_application_events (application_id, kind, detail)
  VALUES (v_id, 'held', jsonb_build_object('amountCents', p_amount_cents, 'boothTypeId', p_booth_type_id, 'boothKey', p_booth_key));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'VENDOR_BOOTH_TAKEN';
END;
$$;

-- ── Sign a hold (instant mode) ────────────────────────────────────────────
-- The vendor signs the terms while the hold lasts. `p_confirm` books it
-- without a card (the organizer takes the fee offline); a free booth is
-- booked and paid at once. Otherwise it stays 'held' until the card payment.
CREATE OR REPLACE FUNCTION vendor_sign_hold(
  p_application_id UUID, p_user_id UUID, p_email TEXT, p_signer_name TEXT,
  p_method TEXT, p_svg TEXT, p_sha256 TEXT, p_ip_hash TEXT, p_confirm BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a vendor_applications%ROWTYPE;
  v_company UUID;
  v_book BOOLEAN;
BEGIN
  SELECT * INTO a FROM vendor_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;
  IF lower(a.contact_email) <> lower(COALESCE(p_email, ''))
     AND NOT EXISTS (SELECT 1 FROM partner_members WHERE company_id = a.company_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND';
  END IF;
  IF a.stage <> 'held' THEN RAISE EXCEPTION 'VENDOR_WRONG_STAGE'; END IF;
  IF a.hold_expires_at IS NULL OR a.hold_expires_at <= now() THEN RAISE EXCEPTION 'VENDOR_HOLD_EXPIRED'; END IF;

  v_company := a.company_id;
  IF v_company IS NULL THEN
    INSERT INTO partner_companies (name, website, created_by)
    VALUES (a.business_name, a.website, p_user_id) RETURNING id INTO v_company;
  END IF;
  INSERT INTO partner_members (company_id, user_id, role)
  VALUES (v_company, p_user_id, 'owner') ON CONFLICT (company_id, user_id) DO NOTHING;

  v_book := COALESCE(p_confirm, false) OR a.amount_cents = 0;
  UPDATE vendor_applications
     SET company_id = v_company, accepted_at = now(), accepted_by = p_user_id,
         signer_name = left(p_signer_name, 120), signer_email = lower(p_email),
         signature_method = p_method, signature_svg = p_svg, signature_sha256 = p_sha256,
         signed_ip_hash = p_ip_hash,
         stage = CASE WHEN v_book THEN 'confirmed' ELSE stage END,
         hold_expires_at = CASE WHEN v_book THEN NULL ELSE hold_expires_at END,
         paid_at = CASE WHEN a.amount_cents = 0 THEN now() ELSE paid_at END,
         updated_at = now()
   WHERE id = a.id;

  INSERT INTO vendor_application_events (application_id, kind, actor_id, detail)
  VALUES (a.id, CASE WHEN v_book THEN 'booked' ELSE 'signed' END, p_user_id,
          jsonb_build_object('sha256', p_sha256, 'method', p_method));
  RETURN jsonb_build_object('companyId', v_company, 'booked', v_book);
END;
$$;

-- ── The vendor accepts an offer (redone) ──────────────────────────────────
-- As in 20261203090000, plus: live holds count against the quantity, so an
-- offer accepted while someone is paying for the last booth cannot oversell.
CREATE OR REPLACE FUNCTION vendor_accept(
  p_application_id UUID, p_user_id UUID, p_email TEXT, p_signer_name TEXT,
  p_method TEXT, p_svg TEXT, p_sha256 TEXT, p_ip_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a vendor_applications%ROWTYPE;
  v_quantity INT;
  v_taken INT;
  v_company UUID;
BEGIN
  SELECT * INTO a FROM vendor_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;
  IF lower(a.contact_email) <> lower(COALESCE(p_email, ''))
     AND NOT EXISTS (SELECT 1 FROM partner_members WHERE company_id = a.company_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND';
  END IF;
  IF a.stage <> 'offered' THEN RAISE EXCEPTION 'VENDOR_WRONG_STAGE'; END IF;
  IF a.offer_expires_at IS NOT NULL AND a.offer_expires_at <= now() THEN RAISE EXCEPTION 'VENDOR_OFFER_EXPIRED'; END IF;

  SELECT quantity INTO v_quantity FROM vendor_booth_types WHERE id = a.booth_type_id FOR UPDATE;
  IF v_quantity IS NOT NULL THEN
    SELECT count(*) INTO v_taken FROM vendor_applications
     WHERE booth_type_id = a.booth_type_id AND id <> a.id
       AND (stage = 'confirmed' OR (stage = 'held' AND hold_expires_at > now()));
    IF v_taken >= v_quantity THEN RAISE EXCEPTION 'VENDOR_SOLD_OUT'; END IF;
  END IF;

  v_company := a.company_id;
  IF v_company IS NULL THEN
    INSERT INTO partner_companies (name, website, created_by)
    VALUES (a.business_name, a.website, p_user_id) RETURNING id INTO v_company;
  END IF;
  INSERT INTO partner_members (company_id, user_id, role)
  VALUES (v_company, p_user_id, 'owner') ON CONFLICT (company_id, user_id) DO NOTHING;

  UPDATE vendor_applications
     SET stage = 'confirmed', company_id = v_company, accepted_at = now(), accepted_by = p_user_id,
         signer_name = left(p_signer_name, 120), signer_email = lower(p_email),
         signature_method = p_method, signature_svg = p_svg, signature_sha256 = p_sha256,
         signed_ip_hash = p_ip_hash,
         paid_at = CASE WHEN a.amount_cents = 0 THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = a.id;

  INSERT INTO vendor_application_events (application_id, kind, actor_id, detail)
  VALUES (a.id, 'accepted', p_user_id, jsonb_build_object('sha256', p_sha256, 'method', p_method));
  RETURN jsonb_build_object('companyId', v_company);
END;
$$;

-- ── The booth fee arrives (redone) ────────────────────────────────────────
-- As in 20261203090000, plus: a card payment for a signed HOLD confirms it.
-- 'expired' is accepted too, for the session we opened: the hold is stretched
-- past the Checkout's own expiry when payment starts, so this only happens if
-- Stripe is very late — and the vendor HAS paid. A booth someone else took in
-- between raises VENDOR_BOOTH_TAKEN for the operator to refund.
CREATE OR REPLACE FUNCTION vendor_record_payment(
  p_application_id UUID, p_method TEXT, p_amount_cents BIGINT, p_reference TEXT,
  p_actor UUID, p_session TEXT, p_account TEXT, p_payment_intent TEXT, p_fee_cents BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a vendor_applications%ROWTYPE;
  v_account TEXT;
  v_from_hold BOOLEAN;
BEGIN
  SELECT * INTO a FROM vendor_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;
  IF a.paid_at IS NOT NULL THEN
    IF p_session IS NOT NULL AND a.stripe_session_id = p_session THEN
      RETURN jsonb_build_object('alreadyPaid', true);
    END IF;
    RAISE EXCEPTION 'VENDOR_ALREADY_PAID';
  END IF;
  v_from_hold := a.stage IN ('held', 'expired') AND p_method = 'card' AND a.accepted_at IS NOT NULL;
  IF a.stage <> 'confirmed' AND NOT v_from_hold THEN RAISE EXCEPTION 'VENDOR_NOT_CONFIRMED'; END IF;
  IF p_amount_cents IS DISTINCT FROM a.amount_cents OR a.amount_cents <= 0 THEN RAISE EXCEPTION 'VENDOR_BAD_AMOUNT'; END IF;
  IF p_method NOT IN ('card', 'bank_transfer', 'cash', 'cheque', 'other') THEN RAISE EXCEPTION 'VENDOR_BAD_METHOD'; END IF;

  IF p_method = 'card' THEN
    SELECT o.stripe_account_id INTO v_account
      FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = a.event_id;
    IF p_session IS NULL OR a.pending_session_id IS DISTINCT FROM p_session
       OR p_account IS NULL OR a.pending_account_id IS DISTINCT FROM p_account
       OR v_account IS DISTINCT FROM p_account THEN
      RAISE EXCEPTION 'VENDOR_PAYMENT_MISMATCH';
    END IF;
  END IF;

  UPDATE vendor_applications
     SET paid_cents = a.amount_cents, paid_at = now(), paid_method = p_method,
         paid_reference = left(p_reference, 120),
         stripe_session_id = CASE WHEN p_method = 'card' THEN p_session END,
         stripe_account_id = CASE WHEN p_method = 'card' THEN p_account END,
         stripe_payment_intent_id = CASE WHEN p_method = 'card' THEN p_payment_intent END,
         platform_fee_cents = CASE WHEN p_method = 'card' THEN GREATEST(COALESCE(p_fee_cents, 0), 0) ELSE 0 END,
         stage = 'confirmed', hold_expires_at = NULL, closed_at = NULL,
         updated_at = now()
   WHERE id = a.id;

  INSERT INTO vendor_application_events (application_id, kind, actor_id, detail)
  VALUES (a.id, 'payment_recorded', p_actor,
          jsonb_build_object('amountCents', a.amount_cents, 'method', p_method, 'fromHold', v_from_hold));
  RETURN jsonb_build_object('alreadyPaid', false);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'VENDOR_BOOTH_TAKEN';
END;
$$;

REVOKE EXECUTE ON FUNCTION vendor_hold(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BIGINT, TEXT, JSONB, JSONB, INT, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vendor_sign_hold(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vendor_accept(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vendor_record_payment(UUID, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vendor_hold(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BIGINT, TEXT, JSONB, JSONB, INT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION vendor_sign_hold(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION vendor_accept(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION vendor_record_payment(UUID, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';
