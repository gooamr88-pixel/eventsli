-- ═══════════════════════════════════════════════════════════════════════════
-- Vendors (owner, 2026-11-20): the second of the two partner systems, after
-- Sponsorships (20261202090000, which this file builds on: partner_companies,
-- partner_members).
--
-- A VENDOR is a business that takes a space at an event — a food truck, a
-- merch stall, an artisan, an expo exhibitor. The organizer:
--
--   BOOTH TYPES   sells spaces: "10×10 stall", "Food truck pitch" — a price,
--                 how many, how many staff passes, what is included
--   PROGRAM       opens applications (with a deadline, categories and their
--                 own questions) on a public page
--   APPLICATIONS  reviews each one:
--                   submitted → (waitlisted) → offered → confirmed → (paid)
--                   or rejected / withdrawn / cancelled
--
-- An OFFER names the booth type, the price, the booth number, the staff passes
-- and the terms. The vendor ACCEPTS it by signing, then pays the booth fee —
-- by card on the ORGANIZER's own Stripe account (a direct charge, as tickets
-- and sponsorships are) or offline, recorded by the organizer. A confirmed,
-- paid vendor is listed in the event's public vendor directory.
--
-- THE ORGANIZER IS RESPONSIBLE for the space and what it includes; the vendor
-- for what they sell. Eventsli carries the paperwork and, for card, the
-- payment on the organizer's account.
--
-- THE RULES, and where each one lives:
--   · a booth type never confirms past its quantity    vendor_accept, under a
--                                                       row lock on the type
--   · an offer past its date cannot be accepted        vendor_accept
--   · nothing is paid before the offer is accepted     vendor_record_payment
--   · a card payment counts only for the session we    vendor_record_payment
--     opened, on the organizer's own account
--   · the booth fee is paid once                       row lock + unique
--                                                       Stripe session id
--
-- SAFE TO RUN BEFORE THE CODE: nothing existing reads these tables. Needs
-- 20261202090000 first (partner_companies).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.partner_companies') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261202090000_sponsorships.sql first: vendors use its partner_companies table.';
  END IF;
END $$;

-- ── The event's vendor program ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_programs (
  event_id              UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  -- Off until the organizer opens it: no public page, no applications.
  is_open               BOOLEAN NOT NULL DEFAULT false,
  headline              TEXT CHECK (headline IS NULL OR char_length(headline) <= 120),
  intro                 TEXT CHECK (intro IS NULL OR char_length(intro) <= 3000),
  -- After this, the page stays up (the directory) but the form closes.
  applications_close_at TIMESTAMPTZ,
  -- The kinds of vendor wanted: ["Food", "Drinks", "Merch", "Art"].
  categories            JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The organizer's own questions:
  --   [{ "id": "q1", "label": "Do you need power?", "type": "yesno", "required": true }]
  questions             JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_email         TEXT CHECK (contact_email IS NULL OR char_length(contact_email) BETWEEN 3 AND 254),
  default_terms         TEXT CHECK (default_terms IS NULL OR char_length(default_terms) <= 20000),
  payment_instructions  TEXT CHECK (payment_instructions IS NULL OR char_length(payment_instructions) <= 2000),
  -- What vendors are told about the day: load-in time, parking, power.
  vendor_info           TEXT CHECK (vendor_info IS NULL OR char_length(vendor_info) <= 4000),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vendor_program_categories_shape
    CHECK (jsonb_typeof(categories) = 'array' AND jsonb_array_length(categories) <= 20 AND pg_column_size(categories) <= 4000),
  CONSTRAINT vendor_program_questions_shape
    CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) <= 10 AND pg_column_size(questions) <= 8000)
);

-- ── Booth types ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_booth_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  size_label    TEXT,
  price_cents   BIGINT NOT NULL,
  -- How many vendors it can take; NULL is no limit.
  quantity      INT,
  staff_passes  INT NOT NULL DEFAULT 2,
  includes      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_public     BOOLEAN NOT NULL DEFAULT true,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vendor_booth_name_shape CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT vendor_booth_description_bounded CHECK (description IS NULL OR char_length(description) <= 600),
  CONSTRAINT vendor_booth_size_bounded CHECK (size_label IS NULL OR char_length(size_label) <= 40),
  CONSTRAINT vendor_booth_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT vendor_booth_quantity_positive CHECK (quantity IS NULL OR quantity >= 1),
  CONSTRAINT vendor_booth_passes_bounded CHECK (staff_passes BETWEEN 0 AND 50),
  CONSTRAINT vendor_booth_includes_shape
    CHECK (jsonb_typeof(includes) = 'array' AND jsonb_array_length(includes) <= 30 AND pg_column_size(includes) <= 8000)
);
CREATE INDEX IF NOT EXISTS vendor_booth_types_event_idx ON vendor_booth_types (event_id, sort_order);

-- ── Applications ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_applications (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  company_id                UUID REFERENCES partner_companies(id) ON DELETE SET NULL,
  stage                     TEXT NOT NULL DEFAULT 'submitted'
                              CHECK (stage IN ('submitted', 'waitlisted', 'offered', 'confirmed', 'rejected', 'withdrawn', 'cancelled')),
  source                    TEXT NOT NULL DEFAULT 'application' CHECK (source IN ('application', 'organizer')),

  -- Who the vendor is. The contact's address is the key to the vendor portal,
  -- as for sponsorships: addresses are verified at sign-in.
  business_name             TEXT NOT NULL CHECK (char_length(btrim(business_name)) BETWEEN 1 AND 120),
  contact_name              TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  contact_email             TEXT NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254),
  contact_phone             TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 30),
  website                   TEXT CHECK (website IS NULL OR (website ~* '^https?://[^[:space:]]+$' AND char_length(website) <= 2000)),
  category                  TEXT CHECK (category IS NULL OR char_length(category) <= 60),
  -- What they sell, in their words; shown in the public directory once paid.
  description               TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  -- Answers to the organizer's questions, with the label they saw:
  --   [{ "id": "q1", "label": "Do you need power?", "answer": "Yes" }]
  answers                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_booth_type_id   UUID REFERENCES vendor_booth_types(id) ON DELETE SET NULL,

  -- The offer, frozen when accepted. A booth type with offers on it is taken
  -- off sale, never deleted.
  booth_type_id             UUID REFERENCES vendor_booth_types(id) ON DELETE RESTRICT,
  booth_label               TEXT CHECK (booth_label IS NULL OR char_length(booth_label) <= 40),
  amount_cents              BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency                  TEXT NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  staff_passes              INT NOT NULL DEFAULT 0 CHECK (staff_passes BETWEEN 0 AND 50),
  includes                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  terms                     TEXT CHECK (terms IS NULL OR char_length(terms) <= 20000),
  offer_sent_at             TIMESTAMPTZ,
  offer_expires_at          TIMESTAMPTZ,

  -- The acceptance (signatureService renders the SVG from checked points).
  accepted_at               TIMESTAMPTZ,
  accepted_by               UUID REFERENCES profiles(id) ON DELETE SET NULL,
  signer_name               TEXT CHECK (signer_name IS NULL OR char_length(signer_name) <= 120),
  signer_email              TEXT,
  signature_method          TEXT CHECK (signature_method IS NULL OR signature_method IN ('drawn', 'typed')),
  signature_svg             TEXT,
  signature_sha256          TEXT,
  signed_ip_hash            TEXT,

  -- The booth fee: one payment.
  paid_cents                BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  paid_at                   TIMESTAMPTZ,
  paid_method               TEXT CHECK (paid_method IS NULL OR paid_method IN ('card', 'bank_transfer', 'cash', 'cheque', 'other')),
  paid_reference            TEXT CHECK (paid_reference IS NULL OR char_length(paid_reference) <= 120),
  pending_session_id        TEXT,
  pending_account_id        TEXT,
  stripe_session_id         TEXT,
  stripe_account_id         TEXT,
  stripe_payment_intent_id  TEXT,
  platform_fee_cents        BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),

  -- The vendor's staff for the door list, by name: ["Ana Ruiz", "Sam Lee"].
  staff                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  logo_url                  TEXT,
  logo_path                 TEXT,
  -- Shown in the public directory once confirmed and paid. The vendor may opt out.
  listed                    BOOLEAN NOT NULL DEFAULT true,

  closed_at                 TIMESTAMPTZ,
  close_reason              TEXT CHECK (close_reason IS NULL OR char_length(close_reason) <= 500),
  -- The organizer's own notes; never shown to the vendor.
  notes                     TEXT CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vendor_app_logo_together CHECK ((logo_url IS NULL) = (logo_path IS NULL)),
  CONSTRAINT vendor_app_answers_shape
    CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) <= 10 AND pg_column_size(answers) <= 12000),
  CONSTRAINT vendor_app_includes_shape
    CHECK (jsonb_typeof(includes) = 'array' AND jsonb_array_length(includes) <= 30 AND pg_column_size(includes) <= 8000),
  CONSTRAINT vendor_app_staff_shape
    CHECK (jsonb_typeof(staff) = 'array' AND jsonb_array_length(staff) <= 50 AND pg_column_size(staff) <= 8000),
  CONSTRAINT vendor_app_accepted_complete
    CHECK (accepted_at IS NULL OR (signature_sha256 IS NOT NULL AND signature_svg IS NOT NULL)),
  CONSTRAINT vendor_app_paid_complete
    CHECK (paid_at IS NULL OR paid_cents >= amount_cents)
);
CREATE INDEX IF NOT EXISTS vendor_applications_event_idx ON vendor_applications (event_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS vendor_applications_email_idx ON vendor_applications (lower(contact_email));
CREATE INDEX IF NOT EXISTS vendor_applications_company_idx ON vendor_applications (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_applications_booth_idx ON vendor_applications (booth_type_id) WHERE booth_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vendor_applications_session_once
  ON vendor_applications (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- ── History ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_application_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES vendor_applications(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 40),
  actor_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_application_events_app_idx ON vendor_application_events (application_id, created_at);

-- ── The API reads and writes all of this with the service role only ───────
ALTER TABLE vendor_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_booth_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_application_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vendor_programs, vendor_booth_types, vendor_applications, vendor_application_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_programs, vendor_booth_types, vendor_applications,
  vendor_application_events TO service_role;


-- ═══ FUNCTIONS ═════════════════════════════════════════════════════════════
-- Each raises a short code ('VENDOR_SOLD_OUT', …); the API maps it to words.

-- ── Send (or revise) the offer ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION vendor_send_offer(
  p_application_id UUID, p_actor UUID, p_booth_type_id UUID, p_amount_cents BIGINT,
  p_currency TEXT, p_booth_label TEXT, p_staff_passes INT, p_includes JSONB,
  p_terms TEXT, p_expires_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a vendor_applications%ROWTYPE;
BEGIN
  SELECT * INTO a FROM vendor_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;
  IF a.stage NOT IN ('submitted', 'waitlisted', 'offered') THEN RAISE EXCEPTION 'VENDOR_WRONG_STAGE'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RAISE EXCEPTION 'VENDOR_BAD_AMOUNT'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN RAISE EXCEPTION 'VENDOR_BAD_EXPIRY'; END IF;
  IF p_booth_type_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM vendor_booth_types WHERE id = p_booth_type_id AND event_id = a.event_id
  ) THEN RAISE EXCEPTION 'VENDOR_BOOTH_NOT_FOUND'; END IF;

  UPDATE vendor_applications
     SET stage = 'offered', booth_type_id = p_booth_type_id, amount_cents = p_amount_cents,
         currency = upper(p_currency), booth_label = NULLIF(btrim(p_booth_label), ''),
         staff_passes = GREATEST(0, LEAST(50, COALESCE(p_staff_passes, 0))),
         includes = COALESCE(p_includes, '[]'::jsonb), terms = p_terms,
         offer_sent_at = now(), offer_expires_at = p_expires_at, updated_at = now()
   WHERE id = a.id;

  INSERT INTO vendor_application_events (application_id, kind, actor_id, detail)
  VALUES (a.id, CASE WHEN a.stage = 'offered' THEN 'offer_revised' ELSE 'offer_sent' END, p_actor,
          jsonb_build_object('amountCents', p_amount_cents, 'boothTypeId', p_booth_type_id, 'boothLabel', p_booth_label));
END;
$$;

-- ── The vendor accepts (signs) ────────────────────────────────────────────
-- The booth type's quantity is enforced HERE, under a lock on its row.
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
     WHERE booth_type_id = a.booth_type_id AND stage = 'confirmed' AND id <> a.id;
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

-- ── The booth fee arrives ─────────────────────────────────────────────────
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
BEGIN
  SELECT * INTO a FROM vendor_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;
  IF a.paid_at IS NOT NULL THEN
    IF p_session IS NOT NULL AND a.stripe_session_id = p_session THEN
      RETURN jsonb_build_object('alreadyPaid', true);
    END IF;
    RAISE EXCEPTION 'VENDOR_ALREADY_PAID';
  END IF;
  IF a.stage <> 'confirmed' THEN RAISE EXCEPTION 'VENDOR_NOT_CONFIRMED'; END IF;
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
         updated_at = now()
   WHERE id = a.id;

  INSERT INTO vendor_application_events (application_id, kind, actor_id, detail)
  VALUES (a.id, 'payment_recorded', p_actor, jsonb_build_object('amountCents', a.amount_cents, 'method', p_method));
  RETURN jsonb_build_object('alreadyPaid', false);
END;
$$;

-- ── Close an application ──────────────────────────────────────────────────
-- 'rejected'  the organizer says no (before confirmation)
-- 'withdrawn' the vendor pulls out (before confirmation)
-- 'cancelled' a confirmed booking called off; money already received is the
--             organizer's to refund, in their own Stripe Dashboard or by hand
CREATE OR REPLACE FUNCTION vendor_close(
  p_application_id UUID, p_actor UUID, p_outcome TEXT, p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a vendor_applications%ROWTYPE;
BEGIN
  SELECT * INTO a FROM vendor_applications WHERE id = p_application_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;
  IF p_outcome IN ('rejected', 'withdrawn') AND a.stage NOT IN ('submitted', 'waitlisted', 'offered') THEN
    RAISE EXCEPTION 'VENDOR_WRONG_STAGE';
  END IF;
  IF p_outcome = 'cancelled' AND a.stage <> 'confirmed' THEN RAISE EXCEPTION 'VENDOR_WRONG_STAGE'; END IF;
  IF p_outcome NOT IN ('rejected', 'withdrawn', 'cancelled') THEN RAISE EXCEPTION 'VENDOR_WRONG_STAGE'; END IF;

  UPDATE vendor_applications
     SET stage = p_outcome, closed_at = now(), close_reason = left(p_reason, 500),
         pending_session_id = NULL, pending_account_id = NULL, updated_at = now()
   WHERE id = a.id;
  INSERT INTO vendor_application_events (application_id, kind, actor_id, detail)
  VALUES (a.id, p_outcome, p_actor, jsonb_build_object('reason', left(p_reason, 500), 'paidCents', a.paid_cents));
END;
$$;

REVOKE EXECUTE ON FUNCTION vendor_send_offer(UUID, UUID, UUID, BIGINT, TEXT, TEXT, INT, JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vendor_accept(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vendor_record_payment(UUID, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vendor_close(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vendor_send_offer(UUID, UUID, UUID, BIGINT, TEXT, TEXT, INT, JSONB, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION vendor_accept(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION vendor_record_payment(UUID, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION vendor_close(UUID, UUID, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
