-- ═══════════════════════════════════════════════════════════════════════════
-- Sponsorships (owner, 2026-11-20): "we need to build two professional
-- systems, Vendors and Sponsors" — Sponsors first.
--
-- An organizer sells sponsorship of their event the way the trade does it:
--
--   PACKAGES   the prospectus — tier, price, how many, what is included
--   DEALS      one brand's way through the pipeline:
--                lead → proposal → signed → (paid)      or  lost / cancelled
--   INSTALMENTS how a signed deal is paid: one payment or a schedule, by card
--              on the ORGANIZER's own Stripe account (direct charge, as
--              tickets are — TECH-AUDIT-LOG T-074) or recorded as paid offline
--   COMPANIES  the sponsor as a business, with the people who act for it
--
-- THE ORGANIZER IS RESPONSIBLE for delivering what a package promises, as they
-- are for add-ons. Eventsli carries the paperwork and, for card, the payment
-- on the organizer's account.
--
-- THE RULES, and where each one lives:
--   · a package never sells past its quantity        sponsorship_sign, under a
--                                                     row lock on the package
--   · a deal is paid only after it is signed         sponsorship_record_payment
--   · a card payment counts only for the session we  sponsorship_record_payment
--     opened, on the organizer's own account         (pending session + account)
--   · a payment is recorded once                     instalment row lock, and a
--                                                     unique Stripe session id
--   · the price signed is the price paid             instalments are written
--                                                     with the proposal and
--                                                     frozen once it is signed
--   · signed + fully paid → on the event page        sponsorship_publish, in
--                                                     the same transaction
--
-- One public display, not two: a paid deal becomes an ordinary `event_sponsors`
-- row, so the event page, the editor and the live preview need no change, and
-- a cancelled deal takes its row away again.
--
-- SAFE TO RUN BEFORE THE CODE: nothing existing reads these tables. The code
-- must NOT run before it: every sponsorship screen reads them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The event's sponsorship page ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsorship_programs (
  event_id       UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  -- Off until the organizer opens it: the public "Become a sponsor" page and
  -- its inquiry form exist only while this is true.
  is_open        BOOLEAN NOT NULL DEFAULT false,
  headline       TEXT CHECK (headline IS NULL OR char_length(headline) <= 120),
  intro          TEXT CHECK (intro IS NULL OR char_length(intro) <= 3000),
  -- Where inquiries are sent. NULL is the organizer account's own address.
  contact_email  TEXT CHECK (contact_email IS NULL OR char_length(contact_email) BETWEEN 3 AND 254),
  -- The agreement text every new proposal starts from; editable per deal.
  default_terms  TEXT CHECK (default_terms IS NULL OR char_length(default_terms) <= 20000),
  -- How to pay without a card (bank transfer details, who to make a cheque
  -- out to). Shown to signed sponsors; the organizer records what arrives.
  payment_instructions TEXT CHECK (payment_instructions IS NULL OR char_length(payment_instructions) <= 2000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Packages (the prospectus) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsorship_packages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- The tier the sponsor is shown at on the event page once paid.
  level        sponsor_level NOT NULL DEFAULT 'partner',
  description  TEXT,
  price_cents  BIGINT NOT NULL,
  -- How many brands can take it; NULL is no limit.
  quantity     INT,
  -- What is included, in the organizer's words: ["Logo on the event page", …].
  benefits     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Shown on the public sponsorship page. A private package is offered by
  -- proposal only.
  is_public    BOOLEAN NOT NULL DEFAULT true,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sponsorship_package_name_shape CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT sponsorship_package_description_bounded CHECK (description IS NULL OR char_length(description) <= 600),
  CONSTRAINT sponsorship_package_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT sponsorship_package_quantity_positive CHECK (quantity IS NULL OR quantity >= 1),
  CONSTRAINT sponsorship_package_benefits_shape
    CHECK (jsonb_typeof(benefits) = 'array' AND jsonb_array_length(benefits) <= 30 AND pg_column_size(benefits) <= 8000)
);
CREATE INDEX IF NOT EXISTS sponsorship_packages_event_idx ON sponsorship_packages (event_id, sort_order);

-- ── Companies and the people who act for them ─────────────────────────────
-- Shared with the vendor system that follows: a brand that sponsors one event
-- and exhibits at another is one company.
CREATE TABLE IF NOT EXISTS partner_companies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  website          TEXT CHECK (website IS NULL OR (website ~* '^https?://[^[:space:]]+$' AND char_length(website) <= 2000)),
  country          TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  tax_id           TEXT CHECK (tax_id IS NULL OR char_length(tax_id) <= 40),
  billing_email    TEXT CHECK (billing_email IS NULL OR char_length(billing_email) BETWEEN 3 AND 254),
  billing_address  TEXT CHECK (billing_address IS NULL OR char_length(billing_address) <= 500),
  created_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_members (
  company_id  UUID NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS partner_members_user_idx ON partner_members (user_id);

-- ── Deals ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsorship_deals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- A deal may be custom (no package). A package with deals is taken off sale,
  -- never deleted, so what a sponsor signed for keeps its name.
  package_id           UUID REFERENCES sponsorship_packages(id) ON DELETE RESTRICT,
  company_id           UUID REFERENCES partner_companies(id) ON DELETE SET NULL,
  stage                TEXT NOT NULL DEFAULT 'lead'
                         CHECK (stage IN ('lead', 'proposal', 'signed', 'lost', 'cancelled')),
  source               TEXT NOT NULL DEFAULT 'organizer' CHECK (source IN ('inquiry', 'organizer')),

  -- Who the sponsor is. The contact's address is also the key to the sponsor
  -- portal: whoever signs in with it (addresses are verified at sign-in) can
  -- see, sign and pay this deal.
  company_name         TEXT NOT NULL CHECK (char_length(btrim(company_name)) BETWEEN 1 AND 120),
  contact_name         TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  contact_email        TEXT NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254),
  contact_phone        TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 30),
  website              TEXT CHECK (website IS NULL OR (website ~* '^https?://[^[:space:]]+$' AND char_length(website) <= 2000)),
  message              TEXT CHECK (message IS NULL OR char_length(message) <= 2000),

  -- The proposal, frozen when signed.
  level                sponsor_level NOT NULL DEFAULT 'partner',
  amount_cents         BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency             TEXT NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  benefits             JSONB NOT NULL DEFAULT '[]'::jsonb,
  terms                TEXT CHECK (terms IS NULL OR char_length(terms) <= 20000),
  proposal_sent_at     TIMESTAMPTZ,
  proposal_expires_at  TIMESTAMPTZ,

  -- The signature (signatureService renders the SVG from checked points).
  signed_at            TIMESTAMPTZ,
  signed_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  signer_name          TEXT CHECK (signer_name IS NULL OR char_length(signer_name) <= 120),
  signer_email         TEXT,
  signature_method     TEXT CHECK (signature_method IS NULL OR signature_method IN ('drawn', 'typed')),
  signature_svg        TEXT,
  signature_sha256     TEXT,
  signed_ip_hash       TEXT,

  -- How the sponsor appears on the event page, supplied by the sponsor.
  display_name         TEXT CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 120),
  logo_url             TEXT,
  logo_path            TEXT,
  link_url             TEXT CHECK (link_url IS NULL OR (link_url ~* '^https?://[^[:space:]]+$' AND char_length(link_url) <= 2000)),

  paid_cents           BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  paid_at              TIMESTAMPTZ,
  event_sponsor_id     UUID REFERENCES event_sponsors(id) ON DELETE SET NULL,

  closed_at            TIMESTAMPTZ,
  close_reason         TEXT CHECK (close_reason IS NULL OR char_length(close_reason) <= 500),
  -- The organizer's own notes; never shown to the sponsor.
  notes                TEXT CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sponsorship_deal_logo_together CHECK ((logo_url IS NULL) = (logo_path IS NULL)),
  CONSTRAINT sponsorship_deal_benefits_shape
    CHECK (jsonb_typeof(benefits) = 'array' AND jsonb_array_length(benefits) <= 30 AND pg_column_size(benefits) <= 8000),
  CONSTRAINT sponsorship_deal_signed_complete
    CHECK (signed_at IS NULL OR (signature_sha256 IS NOT NULL AND signature_svg IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sponsorship_deals_event_idx ON sponsorship_deals (event_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS sponsorship_deals_email_idx ON sponsorship_deals (lower(contact_email));
CREATE INDEX IF NOT EXISTS sponsorship_deals_company_idx ON sponsorship_deals (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sponsorship_deals_package_idx ON sponsorship_deals (package_id) WHERE package_id IS NOT NULL;

-- ── Instalments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsorship_installments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                   UUID NOT NULL REFERENCES sponsorship_deals(id) ON DELETE CASCADE,
  seq                       INT NOT NULL CHECK (seq BETWEEN 1 AND 12),
  label                     TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  amount_cents              BIGINT NOT NULL CHECK (amount_cents > 0),
  due_at                    TIMESTAMPTZ NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  paid_at                   TIMESTAMPTZ,
  method                    TEXT CHECK (method IS NULL OR method IN ('card', 'bank_transfer', 'cash', 'cheque', 'other')),
  reference                 TEXT CHECK (reference IS NULL OR char_length(reference) <= 120),
  -- The card checkout we opened for it, and the account it was opened on.
  -- Only a payment for THIS session on THIS account settles it.
  pending_session_id        TEXT,
  pending_account_id        TEXT,
  stripe_session_id         TEXT,
  stripe_account_id         TEXT,
  stripe_payment_intent_id  TEXT,
  platform_fee_cents        BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  recorded_by               UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reminder_sent_at          TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sponsorship_installment_seq_once UNIQUE (deal_id, seq),
  CONSTRAINT sponsorship_installment_paid_complete
    CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND method IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS sponsorship_installments_session_once
  ON sponsorship_installments (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sponsorship_installments_due_idx
  ON sponsorship_installments (due_at) WHERE status = 'open';

-- ── History ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsorship_deal_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES sponsorship_deals(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 40),
  actor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sponsorship_deal_events_deal_idx ON sponsorship_deal_events (deal_id, created_at);

-- ── The API reads and writes all of this with the service role only ───────
ALTER TABLE sponsorship_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsorship_deal_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sponsorship_programs, sponsorship_packages, partner_companies, partner_members,
  sponsorship_deals, sponsorship_installments, sponsorship_deal_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sponsorship_programs, sponsorship_packages, partner_companies,
  partner_members, sponsorship_deals, sponsorship_installments, sponsorship_deal_events TO service_role;


-- ═══ FUNCTIONS ═════════════════════════════════════════════════════════════
-- Each raises a short code ('SPONSORSHIP_SOLD_OUT', …) as its message; the
-- API maps the code to a status and the sentence the person reads.

-- ── Put a fully paid deal on the event page ───────────────────────────────
-- Called inside the payment (or the signing of a free deal), so "paid" and
-- "shown" cannot disagree. Idempotent: a deal already shown is left alone.
CREATE OR REPLACE FUNCTION sponsorship_publish(p_deal_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d sponsorship_deals%ROWTYPE;
  v_id UUID;
  v_order INT;
BEGIN
  SELECT * INTO d FROM sponsorship_deals WHERE id = p_deal_id;
  IF d.id IS NULL OR d.stage <> 'signed' OR d.paid_cents < d.amount_cents THEN
    RETURN NULL;
  END IF;
  IF d.event_sponsor_id IS NOT NULL THEN
    RETURN d.event_sponsor_id;
  END IF;
  SELECT COALESCE(max(sort_order), -1) + 1 INTO v_order FROM event_sponsors WHERE event_id = d.event_id;
  INSERT INTO event_sponsors (event_id, name, logo_url, logo_path, link_url, level, sort_order)
  VALUES (d.event_id, left(COALESCE(NULLIF(btrim(d.display_name), ''), d.company_name), 120),
          d.logo_url, d.logo_path, COALESCE(d.link_url, d.website), d.level, v_order)
  RETURNING id INTO v_id;
  UPDATE sponsorship_deals SET event_sponsor_id = v_id, updated_at = now() WHERE id = d.id;
  INSERT INTO sponsorship_deal_events (deal_id, kind, detail)
  VALUES (d.id, 'published', jsonb_build_object('eventSponsorId', v_id));
  RETURN v_id;
END;
$$;

-- ── Send (or revise) the proposal ─────────────────────────────────────────
-- p_installments: [{ "label": "Deposit", "amount_cents": 50000, "due_at": "…" }, …]
-- They must add up to the amount exactly. A free (in-kind) deal has none.
CREATE OR REPLACE FUNCTION sponsorship_send_proposal(
  p_deal_id UUID, p_actor UUID, p_package_id UUID, p_level sponsor_level,
  p_amount_cents BIGINT, p_currency TEXT, p_benefits JSONB, p_terms TEXT,
  p_expires_at TIMESTAMPTZ, p_installments JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d sponsorship_deals%ROWTYPE;
  v_sum BIGINT := 0;
  v_count INT := COALESCE(jsonb_array_length(p_installments), 0);
  v_item JSONB;
  v_seq INT := 0;
BEGIN
  SELECT * INTO d FROM sponsorship_deals WHERE id = p_deal_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'SPONSORSHIP_NOT_FOUND'; END IF;
  IF d.stage NOT IN ('lead', 'proposal') THEN RAISE EXCEPTION 'SPONSORSHIP_WRONG_STAGE'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RAISE EXCEPTION 'SPONSORSHIP_BAD_AMOUNT'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN RAISE EXCEPTION 'SPONSORSHIP_BAD_EXPIRY'; END IF;
  IF p_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sponsorship_packages WHERE id = p_package_id AND event_id = d.event_id
  ) THEN RAISE EXCEPTION 'SPONSORSHIP_PACKAGE_NOT_FOUND'; END IF;

  IF p_amount_cents = 0 AND v_count > 0 THEN RAISE EXCEPTION 'SPONSORSHIP_SCHEDULE_MISMATCH'; END IF;
  IF p_amount_cents > 0 AND (v_count < 1 OR v_count > 12) THEN RAISE EXCEPTION 'SPONSORSHIP_SCHEDULE_MISMATCH'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_installments, '[]'::jsonb)) LOOP
    IF (v_item->>'amount_cents')::bigint IS NULL OR (v_item->>'amount_cents')::bigint <= 0 THEN
      RAISE EXCEPTION 'SPONSORSHIP_SCHEDULE_MISMATCH';
    END IF;
    v_sum := v_sum + (v_item->>'amount_cents')::bigint;
  END LOOP;
  IF v_sum <> p_amount_cents THEN RAISE EXCEPTION 'SPONSORSHIP_SCHEDULE_MISMATCH'; END IF;

  -- Unsigned, so nothing is paid: the old schedule is simply replaced.
  DELETE FROM sponsorship_installments WHERE deal_id = d.id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_installments, '[]'::jsonb)) LOOP
    v_seq := v_seq + 1;
    INSERT INTO sponsorship_installments (deal_id, seq, label, amount_cents, due_at)
    VALUES (d.id, v_seq, left(COALESCE(NULLIF(btrim(v_item->>'label'), ''), 'Payment ' || v_seq), 80),
            (v_item->>'amount_cents')::bigint, (v_item->>'due_at')::timestamptz);
  END LOOP;

  UPDATE sponsorship_deals
     SET stage = 'proposal', package_id = p_package_id, level = p_level,
         amount_cents = p_amount_cents, currency = upper(p_currency),
         benefits = COALESCE(p_benefits, '[]'::jsonb), terms = p_terms,
         proposal_sent_at = now(), proposal_expires_at = p_expires_at, updated_at = now()
   WHERE id = d.id;

  INSERT INTO sponsorship_deal_events (deal_id, kind, actor_id, detail)
  VALUES (d.id, CASE WHEN d.stage = 'proposal' THEN 'proposal_revised' ELSE 'proposal_sent' END, p_actor,
          jsonb_build_object('amountCents', p_amount_cents, 'currency', upper(p_currency), 'installments', v_count));
END;
$$;

-- ── The sponsor signs ─────────────────────────────────────────────────────
-- The package's quantity is enforced HERE, under a lock on the package row:
-- two brands signing for the last headline slot get one deal and one refusal.
CREATE OR REPLACE FUNCTION sponsorship_sign(
  p_deal_id UUID, p_user_id UUID, p_email TEXT, p_signer_name TEXT,
  p_method TEXT, p_svg TEXT, p_sha256 TEXT, p_ip_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d sponsorship_deals%ROWTYPE;
  v_quantity INT;
  v_taken INT;
  v_company UUID;
BEGIN
  SELECT * INTO d FROM sponsorship_deals WHERE id = p_deal_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'SPONSORSHIP_NOT_FOUND'; END IF;
  -- The same rule the API applies, again where it cannot be skipped.
  IF lower(d.contact_email) <> lower(COALESCE(p_email, ''))
     AND NOT EXISTS (SELECT 1 FROM partner_members WHERE company_id = d.company_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'SPONSORSHIP_NOT_FOUND';
  END IF;
  IF d.stage = 'signed' THEN RAISE EXCEPTION 'SPONSORSHIP_ALREADY_SIGNED'; END IF;
  IF d.stage <> 'proposal' THEN RAISE EXCEPTION 'SPONSORSHIP_WRONG_STAGE'; END IF;
  IF d.proposal_expires_at IS NOT NULL AND d.proposal_expires_at <= now() THEN
    RAISE EXCEPTION 'SPONSORSHIP_PROPOSAL_EXPIRED';
  END IF;

  IF d.package_id IS NOT NULL THEN
    SELECT quantity INTO v_quantity FROM sponsorship_packages WHERE id = d.package_id FOR UPDATE;
    IF v_quantity IS NOT NULL THEN
      SELECT count(*) INTO v_taken FROM sponsorship_deals
       WHERE package_id = d.package_id AND stage = 'signed' AND id <> d.id;
      IF v_taken >= v_quantity THEN RAISE EXCEPTION 'SPONSORSHIP_SOLD_OUT'; END IF;
    END IF;
  END IF;

  -- The sponsor becomes a company the first time they sign, with the signer
  -- as its owner, so their next deal — and the vendor system — find it.
  v_company := d.company_id;
  IF v_company IS NULL THEN
    INSERT INTO partner_companies (name, website, created_by)
    VALUES (d.company_name, d.website, p_user_id) RETURNING id INTO v_company;
  END IF;
  INSERT INTO partner_members (company_id, user_id, role)
  VALUES (v_company, p_user_id, 'owner') ON CONFLICT (company_id, user_id) DO NOTHING;

  UPDATE sponsorship_deals
     SET stage = 'signed', company_id = v_company, signed_at = now(), signed_by = p_user_id,
         signer_name = left(p_signer_name, 120), signer_email = lower(p_email),
         signature_method = p_method, signature_svg = p_svg, signature_sha256 = p_sha256,
         signed_ip_hash = p_ip_hash, updated_at = now()
   WHERE id = d.id;

  INSERT INTO sponsorship_deal_events (deal_id, kind, actor_id, detail)
  VALUES (d.id, 'signed', p_user_id, jsonb_build_object('sha256', p_sha256, 'method', p_method));

  -- An in-kind deal (nothing to pay) is complete the moment it is signed.
  IF d.amount_cents = 0 THEN
    UPDATE sponsorship_deals SET paid_at = now() WHERE id = d.id;
    PERFORM sponsorship_publish(d.id);
  END IF;

  RETURN jsonb_build_object('companyId', v_company);
END;
$$;

-- ── A payment arrives ─────────────────────────────────────────────────────
-- Card: p_session/p_account are what Stripe reports; they must be the session
-- we opened for this instalment and the event organizer's own account.
-- Offline: the organizer records it, with a reference.
CREATE OR REPLACE FUNCTION sponsorship_record_payment(
  p_installment_id UUID, p_method TEXT, p_amount_cents BIGINT, p_reference TEXT,
  p_actor UUID, p_session TEXT, p_account TEXT, p_payment_intent TEXT, p_fee_cents BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  i sponsorship_installments%ROWTYPE;
  d sponsorship_deals%ROWTYPE;
  v_account TEXT;
  v_published UUID;
BEGIN
  SELECT * INTO i FROM sponsorship_installments WHERE id = p_installment_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'SPONSORSHIP_NOT_FOUND'; END IF;
  SELECT * INTO d FROM sponsorship_deals WHERE id = i.deal_id FOR UPDATE;

  IF i.status = 'paid' THEN
    -- Stripe redelivers: the same session again is the same payment.
    IF p_session IS NOT NULL AND i.stripe_session_id = p_session THEN
      RETURN jsonb_build_object('alreadyPaid', true, 'dealId', d.id, 'published', d.event_sponsor_id);
    END IF;
    RAISE EXCEPTION 'SPONSORSHIP_ALREADY_PAID';
  END IF;
  IF i.status = 'void' THEN RAISE EXCEPTION 'SPONSORSHIP_WRONG_STAGE'; END IF;
  IF d.stage <> 'signed' THEN RAISE EXCEPTION 'SPONSORSHIP_NOT_SIGNED'; END IF;
  IF p_amount_cents IS DISTINCT FROM i.amount_cents THEN RAISE EXCEPTION 'SPONSORSHIP_BAD_AMOUNT'; END IF;
  IF p_method NOT IN ('card', 'bank_transfer', 'cash', 'cheque', 'other') THEN RAISE EXCEPTION 'SPONSORSHIP_BAD_METHOD'; END IF;

  IF p_method = 'card' THEN
    SELECT o.stripe_account_id INTO v_account
      FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = d.event_id;
    IF p_session IS NULL OR i.pending_session_id IS DISTINCT FROM p_session
       OR p_account IS NULL OR i.pending_account_id IS DISTINCT FROM p_account
       OR v_account IS DISTINCT FROM p_account THEN
      RAISE EXCEPTION 'SPONSORSHIP_PAYMENT_MISMATCH';
    END IF;
  END IF;

  UPDATE sponsorship_installments
     SET status = 'paid', paid_at = now(), method = p_method, reference = left(p_reference, 120),
         stripe_session_id = CASE WHEN p_method = 'card' THEN p_session END,
         stripe_account_id = CASE WHEN p_method = 'card' THEN p_account END,
         stripe_payment_intent_id = CASE WHEN p_method = 'card' THEN p_payment_intent END,
         platform_fee_cents = CASE WHEN p_method = 'card' THEN GREATEST(COALESCE(p_fee_cents, 0), 0) ELSE 0 END,
         recorded_by = p_actor
   WHERE id = i.id;

  UPDATE sponsorship_deals
     SET paid_cents = paid_cents + i.amount_cents,
         paid_at = CASE WHEN paid_cents + i.amount_cents >= amount_cents THEN now() ELSE paid_at END,
         updated_at = now()
   WHERE id = d.id;

  INSERT INTO sponsorship_deal_events (deal_id, kind, actor_id, detail)
  VALUES (d.id, 'payment_recorded', p_actor,
          jsonb_build_object('installmentId', i.id, 'amountCents', i.amount_cents, 'method', p_method));

  v_published := sponsorship_publish(d.id);
  RETURN jsonb_build_object('alreadyPaid', false, 'dealId', d.id, 'published', v_published);
END;
$$;

-- ── Close a deal ──────────────────────────────────────────────────────────
-- 'lost'      a lead or proposal that did not happen.
-- 'cancelled' a signed deal called off: unpaid instalments are voided and the
--             sponsor comes off the event page. Money already received is the
--             organizer's to refund, in their own Stripe Dashboard or by hand.
CREATE OR REPLACE FUNCTION sponsorship_close(
  p_deal_id UUID, p_actor UUID, p_outcome TEXT, p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d sponsorship_deals%ROWTYPE;
BEGIN
  SELECT * INTO d FROM sponsorship_deals WHERE id = p_deal_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'SPONSORSHIP_NOT_FOUND'; END IF;
  IF p_outcome = 'lost' AND d.stage NOT IN ('lead', 'proposal') THEN RAISE EXCEPTION 'SPONSORSHIP_WRONG_STAGE'; END IF;
  IF p_outcome = 'cancelled' AND d.stage <> 'signed' THEN RAISE EXCEPTION 'SPONSORSHIP_WRONG_STAGE'; END IF;
  IF p_outcome NOT IN ('lost', 'cancelled') THEN RAISE EXCEPTION 'SPONSORSHIP_WRONG_STAGE'; END IF;

  UPDATE sponsorship_installments SET status = 'void', pending_session_id = NULL, pending_account_id = NULL
   WHERE deal_id = d.id AND status = 'open';
  IF d.event_sponsor_id IS NOT NULL THEN
    DELETE FROM event_sponsors WHERE id = d.event_sponsor_id AND event_id = d.event_id;
  END IF;
  UPDATE sponsorship_deals
     SET stage = p_outcome, closed_at = now(), close_reason = left(p_reason, 500),
         event_sponsor_id = NULL, updated_at = now()
   WHERE id = d.id;
  INSERT INTO sponsorship_deal_events (deal_id, kind, actor_id, detail)
  VALUES (d.id, p_outcome, p_actor, jsonb_build_object('reason', left(p_reason, 500), 'paidCents', d.paid_cents));
END;
$$;

REVOKE EXECUTE ON FUNCTION sponsorship_publish(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sponsorship_send_proposal(UUID, UUID, UUID, sponsor_level, BIGINT, TEXT, JSONB, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sponsorship_sign(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sponsorship_record_payment(UUID, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sponsorship_close(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sponsorship_publish(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION sponsorship_send_proposal(UUID, UUID, UUID, sponsor_level, BIGINT, TEXT, JSONB, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION sponsorship_sign(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sponsorship_record_payment(UUID, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION sponsorship_close(UUID, UUID, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
