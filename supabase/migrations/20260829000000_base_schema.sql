-- ═══════════════════════════════════════════════════════════════════════════
-- Eventsli — base schema
--
-- ONE baseline, then timestamped migrations only. The predecessor accumulated
-- 84 loose .sql files in a single folder, redefining reserve_seats eight times
-- with no way to tell which version production was running. That is the
-- specific failure this file exists to avoid repeating.
--
-- Business rules are enforced HERE, as constraints and triggers, not in
-- application code. A price freeze that lives in a controller is one forgotten
-- code path away from being no rule at all.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ─── Enums ─────────────────────────────────────────────────────────────────
CREATE TYPE user_role        AS ENUM ('attendee', 'organizer', 'admin', 'super_admin');
CREATE TYPE event_status     AS ENUM ('draft', 'pending_review', 'rejected', 'published',
                                      'cancelled', 'suspended', 'completed');
CREATE TYPE listing_type     AS ENUM ('display_only', 'ticketed');           -- BRD §12
CREATE TYPE purchase_mode    AS ENUM ('seat_only', 'table_only', 'seat_and_table'); -- BRD §25
CREATE TYPE fee_bearer       AS ENUM ('buyer', 'organizer');                 -- BRD §04
CREATE TYPE payment_channel  AS ENUM ('stripe', 'manual');                   -- BRD §03
CREATE TYPE seat_status      AS ENUM ('available', 'held', 'sold', 'blocked');
CREATE TYPE table_status     AS ENUM ('available', 'partial', 'held', 'sold', 'blocked');
CREATE TYPE reservation_state AS ENUM ('active', 'expired', 'converted', 'released');
CREATE TYPE order_status     AS ENUM ('pending', 'paid', 'failed', 'cancelled');
CREATE TYPE ticket_status    AS ENUM ('valid', 'scanned', 'void');
CREATE TYPE invoice_status   AS ENUM ('open', 'submitted', 'paid', 'overdue', 'waived');
CREATE TYPE ledger_type      AS ENUM ('sale', 'commission', 'commission_tax', 'payment_fee',
                                      'event_tax', 'transfer', 'refund', 'adjustment');
CREATE TYPE ledger_direction AS ENUM ('credit', 'debit');

-- ─── profiles ──────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         CITEXT NOT NULL UNIQUE,
  full_name     TEXT,
  phone         TEXT,
  role          user_role NOT NULL DEFAULT 'attendee',
  is_blocked    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── organizers ────────────────────────────────────────────────────────────
-- BRD §15: one account = one organizer, many events. Teams are deliberately
-- out of scope for v1; `owner_user_id` is unique so adding them later means
-- adding a members table, not reshaping this one.
CREATE TABLE organizers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id             UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  display_name              TEXT NOT NULL,
  country                   CHAR(2) NOT NULL,              -- ISO-3166-1 alpha-2
  stripe_account_id         TEXT UNIQUE,
  stripe_onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  stripe_payouts_enabled    BOOLEAN NOT NULL DEFAULT false,
  is_banned                 BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── platform_settings ─────────────────────────────────────────────────────
CREATE TABLE platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES profiles(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── terms_versions ────────────────────────────────────────────────────────
-- BRD §21. Acceptance is versioned: a new event requires the CURRENT version,
-- while an already-published event keeps running under the version its
-- organizer accepted. Without the version column, changing the terms would
-- either silently re-bind everyone or require blocking live events.
CREATE TABLE terms_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version      INT NOT NULL UNIQUE,
  audience     TEXT NOT NULL CHECK (audience IN ('organizer', 'buyer')),
  body_md      TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current   BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX terms_one_current_per_audience
  ON terms_versions (audience) WHERE is_current;

CREATE TABLE terms_acceptances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_id    UUID NOT NULL REFERENCES terms_versions(id),
  event_id    UUID,                       -- FK added after events exists
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash     TEXT,
  UNIQUE (user_id, terms_id, event_id)
);

-- ─── events ────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id    UUID NOT NULL REFERENCES organizers(id) ON DELETE RESTRICT,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT,
  venue_name      TEXT,
  venue_address   TEXT,
  country         CHAR(2) NOT NULL,
  timezone        TEXT NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,

  status          event_status  NOT NULL DEFAULT 'draft',
  listing_type    listing_type  NOT NULL DEFAULT 'ticketed',
  purchase_mode   purchase_mode NOT NULL DEFAULT 'seat_only',

  -- BRD §07. Set from the event's country/market, then frozen once money moves.
  currency        CHAR(3) NOT NULL,

  -- BRD §04/§05/§06 — three INDEPENDENT money settings, all admin-controlled
  -- except fee_bearer, which is the organizer's choice.
  commission_pct         NUMERIC(5,2) NOT NULL DEFAULT 1.50,
  commission_tax_pct     NUMERIC(5,2) NOT NULL DEFAULT 0,
  payment_fee_pct        NUMERIC(5,2) NOT NULL DEFAULT 2.90,
  payment_fee_fixed_cents INT         NOT NULL DEFAULT 30,
  fee_bearer             fee_bearer   NOT NULL DEFAULT 'buyer',
  event_tax_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,

  max_tickets_per_order  INT NOT NULL DEFAULT 10,          -- BRD §11
  allow_ticket_transfer  BOOLEAN NOT NULL DEFAULT true,    -- BRD §10

  -- BRD §16 — review pipeline
  rejection_reason  TEXT,
  reviewed_by       UUID REFERENCES profiles(id),
  reviewed_at       TIMESTAMPTZ,

  -- BRD §17 — cancellation is the organizer's act; suspension is the admin's.
  cancelled_at      TIMESTAMPTZ,
  cancelled_reason  TEXT,
  suspended_at      TIMESTAMPTZ,
  suspended_reason  TEXT,

  -- BRD §21 — cannot publish without an accepted terms version on record.
  terms_accepted_id UUID REFERENCES terms_versions(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ends_after_start   CHECK (ends_at > starts_at),
  CONSTRAINT pct_ranges         CHECK (
    commission_pct     BETWEEN 0 AND 100 AND
    commission_tax_pct BETWEEN 0 AND 100 AND
    payment_fee_pct    BETWEEN 0 AND 100 AND
    event_tax_pct      BETWEEN 0 AND 100
  ),
  CONSTRAINT fee_fixed_non_negative CHECK (payment_fee_fixed_cents >= 0),
  CONSTRAINT order_limit_sane       CHECK (max_tickets_per_order BETWEEN 1 AND 100),
  -- BRD §21: publishing requires accepted terms. Enforced as a constraint so no
  -- code path can publish around it.
  CONSTRAINT published_requires_terms CHECK (
    status <> 'published' OR terms_accepted_id IS NOT NULL
  )
);
CREATE INDEX events_organizer_idx ON events (organizer_id, created_at DESC);
CREATE INDEX events_public_idx    ON events (status, starts_at) WHERE status = 'published';

ALTER TABLE terms_acceptances
  ADD CONSTRAINT terms_acceptances_event_fk
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

-- ─── ticket_tiers ──────────────────────────────────────────────────────────
CREATE TABLE ticket_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  price_cents   BIGINT NOT NULL CHECK (price_cents >= 0),
  quantity      INT,                          -- NULL = unlimited (seat-map bound)
  sold_count    INT NOT NULL DEFAULT 0,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sold_within_quantity CHECK (quantity IS NULL OR sold_count <= quantity)
);
CREATE INDEX ticket_tiers_event_idx ON ticket_tiers (event_id, sort_order);

-- ─── venue_maps / table_categories / tables / seats ────────────────────────
CREATE TABLE venue_maps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  layout_json JSONB NOT NULL DEFAULT '{}',
  version     INT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BRD §24 — tables are categorised the way tickets are.
CREATE TABLE table_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  UNIQUE (event_id, name)
);

-- BRD §26 — a table is a sellable unit, not a drawing.
CREATE TABLE tables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_map_id  UUID NOT NULL REFERENCES venue_maps(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES table_categories(id) ON DELETE SET NULL,
  label         TEXT NOT NULL,
  seat_count    INT NOT NULL CHECK (seat_count BETWEEN 1 AND 60),

  -- BRD §25: the full-table price is INDEPENDENT, not the sum of its seats.
  -- 10 × $50 seats may sell as a $450 or a $550 table; the organizer decides.
  price_cents   BIGINT CHECK (price_cents IS NULL OR price_cents >= 0),

  -- BRD §27. bcrypt hash — never the password itself. A protected table is
  -- omitted from the public seat-map payload entirely until the password
  -- verifies server-side; returning it with a flag would put it in DevTools.
  is_private     BOOLEAN NOT NULL DEFAULT false,
  password_hash  TEXT,

  status        table_status NOT NULL DEFAULT 'available',
  position_x    NUMERIC(6,3) NOT NULL DEFAULT 0,   -- % of the logical world
  position_y    NUMERIC(6,3) NOT NULL DEFAULT 0,
  rotation      NUMERIC(6,2) NOT NULL DEFAULT 0,
  shape         TEXT NOT NULL DEFAULT 'round',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT private_needs_password CHECK (NOT is_private OR password_hash IS NOT NULL)
);
CREATE INDEX tables_map_idx ON tables (venue_map_id);

CREATE TABLE seats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_map_id  UUID NOT NULL REFERENCES venue_maps(id) ON DELETE CASCADE,
  table_id      UUID REFERENCES tables(id) ON DELETE CASCADE,
  tier_id       UUID REFERENCES ticket_tiers(id) ON DELETE SET NULL,
  section_key   TEXT NOT NULL DEFAULT 'main',
  row_label     TEXT NOT NULL,
  seat_number   TEXT NOT NULL,
  -- Per-seat override. Resolution order is seat → table → tier.
  price_override_cents BIGINT CHECK (price_override_cents IS NULL OR price_override_cents >= 0),
  status        seat_status NOT NULL DEFAULT 'available',
  position_x    NUMERIC(6,3) NOT NULL DEFAULT 0,
  position_y    NUMERIC(6,3) NOT NULL DEFAULT 0,
  UNIQUE (venue_map_id, section_key, row_label, seat_number)
);
CREATE INDEX seats_map_status_idx ON seats (venue_map_id, status);
CREATE INDEX seats_table_idx      ON seats (table_id) WHERE table_id IS NOT NULL;

-- ─── reservations ──────────────────────────────────────────────────────────
CREATE TABLE reservations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL = guest
  state         reservation_state NOT NULL DEFAULT 'active',
  expires_at    TIMESTAMPTZ NOT NULL,
  attendee_data JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reservations_sweep_idx ON reservations (expires_at) WHERE state = 'active';

CREATE TABLE reservation_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  seat_id        UUID REFERENCES seats(id) ON DELETE CASCADE,
  table_id       UUID REFERENCES tables(id) ON DELETE CASCADE,
  tier_id        UUID REFERENCES ticket_tiers(id),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  -- Exactly one of seat/table: an item is either a single seat or a whole table.
  CONSTRAINT item_is_seat_xor_table CHECK ((seat_id IS NULL) <> (table_id IS NULL))
);
CREATE UNIQUE INDEX reservation_items_seat_uniq  ON reservation_items (seat_id)  WHERE seat_id  IS NOT NULL;
CREATE UNIQUE INDEX reservation_items_table_uniq ON reservation_items (table_id) WHERE table_id IS NOT NULL;

-- ─── orders / tickets ──────────────────────────────────────────────────────
CREATE TABLE orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  organizer_id   UUID NOT NULL REFERENCES organizers(id) ON DELETE RESTRICT,
  user_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,

  channel        payment_channel NOT NULL,
  status         order_status NOT NULL DEFAULT 'pending',
  currency       CHAR(3) NOT NULL,

  -- The full breakdown, snapshotted. Rates change; a historical order must keep
  -- reporting the numbers it was actually sold at.
  quantity            INT    NOT NULL CHECK (quantity >= 1),
  subtotal_cents      BIGINT NOT NULL CHECK (subtotal_cents      >= 0),
  discount_cents      BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  event_tax_cents     BIGINT NOT NULL DEFAULT 0 CHECK (event_tax_cents >= 0),
  commission_cents    BIGINT NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  commission_tax_cents BIGINT NOT NULL DEFAULT 0 CHECK (commission_tax_cents >= 0),
  payment_fee_cents   BIGINT NOT NULL DEFAULT 0 CHECK (payment_fee_cents >= 0),
  fee_bearer          fee_bearer NOT NULL,
  buyer_total_cents   BIGINT NOT NULL CHECK (buyer_total_cents   >= 0),
  organizer_net_cents BIGINT NOT NULL CHECK (organizer_net_cents >= 0),

  guest_name   TEXT,
  guest_email  CITEXT,
  guest_phone  TEXT,

  stripe_session_id        TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at     TIMESTAMPTZ,

  -- An anonymous order must still be reachable by its buyer.
  CONSTRAINT buyer_identified CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);
CREATE INDEX orders_event_idx     ON orders (event_id, created_at DESC);
CREATE INDEX orders_organizer_idx ON orders (organizer_id, status);

CREATE TABLE tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  seat_id       UUID REFERENCES seats(id) ON DELETE SET NULL,
  table_id      UUID REFERENCES tables(id) ON DELETE SET NULL,
  tier_id       UUID REFERENCES ticket_tiers(id) ON DELETE SET NULL,

  attendee_name  TEXT,
  attendee_email CITEXT,
  status         ticket_status NOT NULL DEFAULT 'valid',

  -- BRD §10 — one transfer, ever. A counter rather than a boolean so the
  -- constraint reads as the rule it enforces.
  transfer_count      INT NOT NULL DEFAULT 0,
  transferred_at      TIMESTAMPTZ,
  transferred_from    CITEXT,
  CONSTRAINT single_transfer CHECK (transfer_count <= 1),

  scanned_at    TIMESTAMPTZ,
  scanned_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tickets_order_idx ON tickets (order_id);
CREATE INDEX tickets_event_idx ON tickets (event_id, status);

-- ─── ledger_entries ────────────────────────────────────────────────────────
-- Append-only. A balance is a SUM over rows, never a mutable column, so two
-- writers can never disagree about it and a correction is a new reversing row
-- that leaves the original audit trail intact.
CREATE TABLE ledger_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  organizer_id     UUID NOT NULL REFERENCES organizers(id) ON DELETE RESTRICT,
  order_id         UUID REFERENCES orders(id) ON DELETE RESTRICT,
  invoice_id       UUID,                        -- FK added after invoices exists
  channel          payment_channel NOT NULL,
  entry_type       ledger_type      NOT NULL,
  direction        ledger_direction NOT NULL,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents >= 0),
  currency         CHAR(3) NOT NULL,
  external_ref     TEXT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  metadata         JSONB NOT NULL DEFAULT '{}',
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_event_idx     ON ledger_entries (event_id, occurred_at);
CREATE INDEX ledger_organizer_idx ON ledger_entries (organizer_id, channel, entry_type);

CREATE RULE ledger_no_update AS ON UPDATE TO ledger_entries DO INSTEAD NOTHING;
CREATE RULE ledger_no_delete AS ON DELETE TO ledger_entries DO INSTEAD NOTHING;

-- ─── invoices ──────────────────────────────────────────────────────────────
-- BRD §03/§18 — manual sales only. Stripe commission is taken at the charge, so
-- it never becomes a receivable. The two channels stay separate in accounting,
-- which is why `channel` is on the ledger and manual debt is its own table.
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id    UUID NOT NULL REFERENCES organizers(id) ON DELETE RESTRICT,
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  number          TEXT NOT NULL UNIQUE,
  currency        CHAR(3) NOT NULL,
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  status          invoice_status NOT NULL DEFAULT 'open',

  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- MIN(issued_at + 7 days, event.starts_at - 24h). Computed on insert because
  -- the event date can move, and the due date that was communicated must not.
  due_at          TIMESTAMPTZ NOT NULL,

  -- The organizer uploads proof; an admin confirms receipt. Two fields, because
  -- "they said they paid" and "we saw the money" are different facts.
  proof_url       TEXT,
  proof_submitted_at TIMESTAMPTZ,
  confirmed_by    UUID REFERENCES profiles(id),
  confirmed_at    TIMESTAMPTZ,
  notes           TEXT,

  CONSTRAINT paid_needs_confirmation CHECK (status <> 'paid' OR confirmed_at IS NOT NULL)
);
CREATE INDEX invoices_organizer_idx ON invoices (organizer_id, status);
CREATE INDEX invoices_overdue_idx   ON invoices (due_at) WHERE status IN ('open', 'submitted');

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id);

-- ─── scanner gating ────────────────────────────────────────────────────────
-- BRD §18: unpaid commission disables the SCANNER for that event only — never
-- the organizer's whole account.
CREATE TABLE scanner_access (
  event_id        UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  is_locked       BOOLEAN NOT NULL DEFAULT false,
  locked_reason   TEXT,
  locked_at       TIMESTAMPTZ,
  -- Super-admin override for exceptional cases; survives the automatic locker.
  override_by     UUID REFERENCES profiles(id),
  override_until  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scan_devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  pin_hash    TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  device_id   UUID REFERENCES scan_devices(id) ON DELETE SET NULL,
  result      TEXT NOT NULL,
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The offline app replays queued scans; this makes the replay idempotent.
  client_scan_id TEXT UNIQUE
);

-- ─── infrastructure ────────────────────────────────────────────────────────
CREATE TABLE sessions (
  jti         UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  ip_hash     TEXT,
  user_agent  TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Stripe retries. The unique event id is what makes fulfilment exactly-once.
CREATE TABLE webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  processed_at    TIMESTAMPTZ,
  error           TEXT,
  payload         JSONB,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID REFERENCES profiles(id),
  action     TEXT NOT NULL,
  target_type TEXT,
  target_id  UUID,
  payload    JSONB,
  ip_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_actor_idx ON admin_audit (actor_id, created_at DESC);

CREATE TABLE promo_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID REFERENCES events(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value  NUMERIC(10,2) NOT NULL CHECK (discount_value >= 0),
  max_uses        INT,
  used_count      INT NOT NULL DEFAULT 0,
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (event_id, code)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- BUSINESS RULES AS TRIGGERS
--
-- These live in the database because they are invariants, not workflow. Any
-- future code path — a controller, a migration, a manual psql session, an
-- admin script — is bound by them without having to remember to be.
-- ═══════════════════════════════════════════════════════════════════════════

-- BRD §13 — once a ticket has sold, its price is frozen forever.
CREATE OR REPLACE FUNCTION lock_tier_price_after_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN
    IF EXISTS (
      SELECT 1 FROM tickets t
      JOIN orders o ON o.id = t.order_id
      WHERE t.tier_id = OLD.id AND o.status = 'paid'
    ) THEN
      RAISE EXCEPTION 'PRICE_LOCKED_AFTER_SALE: tier % has sold tickets; its price cannot change', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lock_tier_price
  BEFORE UPDATE OF price_cents ON ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION lock_tier_price_after_sale();

-- BRD §07 — currency is frozen once money has moved, in either channel.
-- Changing it afterwards would silently reinterpret every historical amount.
CREATE OR REPLACE FUNCTION lock_event_currency_after_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    IF EXISTS (SELECT 1 FROM orders WHERE event_id = OLD.id AND status = 'paid') THEN
      RAISE EXCEPTION 'CURRENCY_LOCKED_AFTER_SALE: event % has paid orders', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lock_event_currency
  BEFORE UPDATE OF currency ON events
  FOR EACH ROW EXECUTE FUNCTION lock_event_currency_after_sale();

-- BRD §25 — the moment one seat of a table sells individually, the full-table
-- option closes for that table. Derived from seat state on every seat write, so
-- the two can never disagree; a cached flag maintained by application code is
-- exactly how a table gets sold twice.
CREATE OR REPLACE FUNCTION sync_table_status_from_seats()
RETURNS TRIGGER AS $$
DECLARE
  v_table_id UUID := COALESCE(NEW.table_id, OLD.table_id);
  v_total    INT;
  v_free     INT;
BEGIN
  IF v_table_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'available')
  INTO v_total, v_free
  FROM seats WHERE table_id = v_table_id;

  UPDATE tables SET status = CASE
    WHEN status = 'blocked' THEN 'blocked'          -- an admin block outranks stock
    WHEN v_free = 0         THEN 'sold'
    WHEN v_free = v_total   THEN 'available'        -- untouched: sellable whole
    ELSE 'partial'                                  -- full-table option is closed
  END
  WHERE id = v_table_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_table_status
  AFTER INSERT OR UPDATE OF status OR DELETE ON seats
  FOR EACH ROW EXECUTE FUNCTION sync_table_status_from_seats();

-- Organizer balance for one event and channel. The ONLY way a balance is read.
CREATE OR REPLACE FUNCTION ledger_balance_cents(
  p_event_id UUID,
  p_currency CHAR(3),
  p_channel  payment_channel DEFAULT NULL
) RETURNS BIGINT AS $$
  SELECT COALESCE(SUM(
    CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END
  ), 0)::BIGINT
  FROM ledger_entries
  WHERE event_id = p_event_id
    AND currency = p_currency
    AND (p_channel IS NULL OR channel = p_channel);
$$ LANGUAGE sql STABLE;

-- ─── seed ──────────────────────────────────────────────────────────────────
INSERT INTO platform_settings (key, value) VALUES
  ('commission', '{"default_pct": 1.50, "default_tax_pct": 0}'),
  ('payment_fee', '{"default_pct": 2.90, "default_fixed_cents": 30}'),
  ('stripe_cost', '{"pct": 2.90, "fixed_cents": 30}'),
  ('currencies',  '{"allowed": ["USD", "CAD"], "by_country": {"US": "USD", "CA": "CAD"}}'),
  ('manual_invoice', '{"due_days": 7, "min_hours_before_event": 24}')
ON CONFLICT (key) DO NOTHING;
