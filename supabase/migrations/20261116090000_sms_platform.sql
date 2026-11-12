-- ═══════════════════════════════════════════════════════════════════════════
-- GLOBAL SMS: countries, providers, senders, a durable queue, compliance.
--
-- Before this migration Eventsli sent no SMS at all — no tables, no provider
-- code. Everything SMS lives here and in backend/services/sms/.
--
-- ─── THE RULES THIS SCHEMA HOLDS, NOT THE APPLICATION ──────────────────────
--
--   1. NO COUNTRY IS SUPPORTED UNTIL SOMEONE VERIFIED IT. Every country is
--      seeded 'unverified'. `sms_country_enable_guard` refuses 'enabled'
--      unless the country carries a verification record, a known sender-ID
--      rule, and at least one verified, active route through an enabled
--      provider. "We have a Twilio account" is not "we can text Egypt".
--
--   2. ONE MESSAGE IS SENT AT MOST ONCE. `idempotency_key` is UNIQUE: the
--      same ticket confirmation enqueued twice is one row. The claim is
--      `FOR UPDATE SKIP LOCKED`, so two workers never hold the same row. An
--      attempt row is written BEFORE the provider is called; a worker that
--      dies mid-call leaves that row 'pending', and `sms_release_stale`
--      turns the message 'unknown' instead of sending it again.
--
--   3. A CAMPAIGN NEEDS TWO PEOPLE. `approved_by <> created_by` is a CHECK,
--      so no code path can approve its own campaign.
--
--   4. NOTHING HERE IS READABLE WITH THE ANON KEY. Default privileges already
--      revoke it (20260914090000); every table also says so explicitly.
--
-- Provider CREDENTIALS are never stored here. They are environment variables
-- read by the backend only (services/sms/providers/*). `sms_providers.settings`
-- holds non-secret routing configuration.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE sms_country_status AS ENUM ('unverified', 'enabled', 'disabled', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sms_sender_support AS ENUM ('unknown', 'supported', 'registration_required', 'not_supported');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sms_traffic_class AS ENUM ('transactional', 'marketing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sms_category AS ENUM ('participant', 'event_notification', 'marketing', 'segmentation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sms_sender_kind AS ENUM ('messaging_service', 'short_code', 'toll_free', 'long_code', 'alphanumeric');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sms_registration_status AS ENUM ('not_required', 'pending', 'approved', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sms_message_status AS ENUM
    ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'unknown', 'blocked', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sms_campaign_status AS ENUM
    ('draft', 'pending_approval', 'approved', 'sending', 'completed', 'cancelled', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Settings (one row) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_settings (
  id                         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- The global kill switch. Off on deploy: nothing is sent until an admin
  -- turns it on, after verifying at least one country.
  sending_enabled            BOOLEAN NOT NULL DEFAULT false,
  brand_name                 TEXT NOT NULL DEFAULT 'Eventsli' CHECK (char_length(brand_name) BETWEEN 1 AND 30),
  opt_out_text               TEXT NOT NULL DEFAULT 'Reply STOP to opt out' CHECK (char_length(opt_out_text) BETWEEN 4 AND 60),
  help_text                  TEXT NOT NULL DEFAULT 'Eventsli event alerts. Reply STOP to opt out. Help: eventsli.com/contact'
                               CHECK (char_length(help_text) BETWEEN 10 AND 160),
  reply_to_help              BOOLEAN NOT NULL DEFAULT false,
  default_quiet_start        SMALLINT NOT NULL DEFAULT 21 CHECK (default_quiet_start BETWEEN 0 AND 23),
  default_quiet_end          SMALLINT NOT NULL DEFAULT 8  CHECK (default_quiet_end BETWEEN 0 AND 23),
  -- Fraud: a country whose non-campaign traffic exceeds this in an hour is
  -- paused automatically (SMS pumping looks exactly like this).
  country_hourly_limit       INT NOT NULL DEFAULT 300 CHECK (country_hourly_limit BETWEEN 1 AND 1000000),
  -- Marketing stops for the day once estimated spend reaches this (in
  -- spend_currency micros). Transactional messages are tied to paid orders and
  -- keep flowing. NULL = no cap.
  daily_marketing_cap_micros BIGINT CHECK (daily_marketing_cap_micros IS NULL OR daily_marketing_cap_micros >= 0),
  spend_currency             CHAR(3) NOT NULL DEFAULT 'USD',
  reminder_hours_before      SMALLINT NOT NULL DEFAULT 24 CHECK (reminder_hours_before BETWEEN 1 AND 168),
  max_campaign_recipients    INT NOT NULL DEFAULT 50000 CHECK (max_campaign_recipients BETWEEN 1 AND 5000000),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                 UUID REFERENCES profiles(id) ON DELETE SET NULL
);
INSERT INTO sms_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Providers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_providers (
  id                    TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  display_name          TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT false,
  priority              INT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
  max_tps               INT NOT NULL DEFAULT 10 CHECK (max_tps BETWEEN 1 AND 1000),
  traffic_classes       sms_traffic_class[] NOT NULL DEFAULT '{transactional,marketing}',
  settings              JSONB NOT NULL DEFAULT '{}'::jsonb,
  consecutive_failures  INT NOT NULL DEFAULT 0,
  circuit_open_until    TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  last_error            TEXT,
  pricing_sync          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO sms_providers (id, display_name, priority) VALUES
  ('twilio', 'Twilio', 10),
  ('vonage', 'Vonage', 20)
ON CONFLICT (id) DO NOTHING;

-- ─── Countries ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_countries (
  iso2                          CHAR(2) PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  name                          TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  dial_code                     TEXT NOT NULL CHECK (dial_code ~ '^[1-9][0-9]{0,3}$'),
  -- Full international prefixes that identify this country inside a SHARED
  -- calling code (+1 Canada vs US, +7 Kazakhstan vs Russia, +44 Jersey vs UK).
  -- Empty: the country owns its dial code (when dial_primary).
  prefixes                      TEXT[] NOT NULL DEFAULT '{}',
  dial_primary                  BOOLEAN NOT NULL DEFAULT true,
  region                        TEXT NOT NULL DEFAULT 'Other',
  timezone                      TEXT NOT NULL DEFAULT 'UTC',
  status                        sms_country_status NOT NULL DEFAULT 'unverified',
  sender_id_support             sms_sender_support NOT NULL DEFAULT 'unknown',
  requires_sender_registration  BOOLEAN NOT NULL DEFAULT false,
  marketing_allowed             BOOLEAN NOT NULL DEFAULT false,
  double_opt_in_required        BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start             SMALLINT CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end               SMALLINT CHECK (quiet_hours_end BETWEEN 0 AND 23),
  restrictions                  TEXT CHECK (char_length(restrictions) <= 2000),
  notes                         TEXT CHECK (char_length(notes) <= 2000),
  max_daily_messages            INT CHECK (max_daily_messages IS NULL OR max_daily_messages > 0),
  paused_until                  TIMESTAMPTZ,
  paused_reason                 TEXT,
  verified_at                   TIMESTAMPTZ,
  verified_by                   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  verification_source           TEXT CHECK (char_length(verification_source) <= 500),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_country_enabled_is_verified CHECK (
    status <> 'enabled' OR (verified_at IS NOT NULL AND sender_id_support <> 'unknown')
  ),
  CONSTRAINT sms_country_quiet_pair CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
);
CREATE INDEX IF NOT EXISTS sms_countries_status_idx ON sms_countries (status);
CREATE INDEX IF NOT EXISTS sms_countries_dial_idx   ON sms_countries (dial_code);

-- ─── Senders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_senders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id             TEXT NOT NULL REFERENCES sms_providers(id) ON DELETE CASCADE,
  kind                    sms_sender_kind NOT NULL,
  value                   TEXT NOT NULL,
  label                   TEXT CHECK (char_length(label) <= 80),
  traffic_classes         sms_traffic_class[] NOT NULL DEFAULT '{transactional,marketing}',
  -- Countries this sender may be used for. Empty = any country that does not
  -- require registration. A registration-required country must be listed.
  countries               CHAR(2)[] NOT NULL DEFAULT '{}',
  registration_status     sms_registration_status NOT NULL DEFAULT 'not_required',
  registration_reference  TEXT CHECK (char_length(registration_reference) <= 200),
  approved_at             TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ,
  active                  BOOLEAN NOT NULL DEFAULT true,
  notes                   TEXT CHECK (char_length(notes) <= 1000),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, value),
  CONSTRAINT sms_sender_value_shape CHECK (
    (kind = 'alphanumeric'      AND value ~ '^[A-Za-z0-9 ]{1,11}$' AND value ~ '[A-Za-z]')
 OR (kind IN ('long_code', 'toll_free') AND value ~ '^\+[1-9][0-9]{6,14}$')
 OR (kind = 'short_code'        AND value ~ '^[0-9]{3,8}$')
 OR (kind = 'messaging_service' AND value ~ '^[A-Za-z0-9_-]{4,64}$')
  ),
  CONSTRAINT sms_sender_approved_has_date CHECK (registration_status <> 'approved' OR approved_at IS NOT NULL)
);

-- ─── Routes: which provider reaches which country, at what cost ────────────
CREATE TABLE IF NOT EXISTS sms_routes (
  country         CHAR(2) NOT NULL REFERENCES sms_countries(iso2) ON DELETE CASCADE,
  provider_id     TEXT NOT NULL REFERENCES sms_providers(id) ON DELETE CASCADE,
  priority        INT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
  sender_id       UUID REFERENCES sms_senders(id) ON DELETE SET NULL,
  cost_micros     BIGINT CHECK (cost_micros IS NULL OR cost_micros >= 0),
  currency        CHAR(3),
  cost_source     TEXT CHECK (cost_source IN ('manual', 'provider_api')),
  cost_synced_at  TIMESTAMPTZ,
  -- What the provider's pricing API said: true = it prices this country.
  -- Availability is evidence for verification, not verification itself.
  available       BOOLEAN,
  verified        BOOLEAN NOT NULL DEFAULT false,
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT CHECK (char_length(notes) <= 1000),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country, provider_id),
  CONSTRAINT sms_route_verified_has_date CHECK (NOT verified OR verified_at IS NOT NULL)
);

-- ─── Categories ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_categories (
  key                         sms_category PRIMARY KEY,
  label                       TEXT NOT NULL,
  description                 TEXT NOT NULL,
  enabled                     BOOLEAN NOT NULL DEFAULT false,
  traffic_class               sms_traffic_class NOT NULL,
  requires_consent            BOOLEAN NOT NULL,
  requires_approval           BOOLEAN NOT NULL DEFAULT false,
  -- Who may start a manual send in this category from the console.
  min_role                    user_role NOT NULL DEFAULT 'admin',
  per_recipient_daily_limit   INT NOT NULL DEFAULT 5 CHECK (per_recipient_daily_limit BETWEEN 1 AND 100),
  respect_quiet_hours         BOOLEAN NOT NULL DEFAULT false,
  append_opt_out              BOOLEAN NOT NULL DEFAULT false,
  max_segments                SMALLINT NOT NULL DEFAULT 4 CHECK (max_segments BETWEEN 1 AND 10),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Marketing traffic always needs consent and an opt-out line. A toggle that
  -- could switch either off would be one click from a regulator's letter.
  CONSTRAINT sms_marketing_needs_consent CHECK (
    traffic_class <> 'marketing' OR (requires_consent AND append_opt_out)
  )
);
INSERT INTO sms_categories
  (key, label, description, enabled, traffic_class, requires_consent, requires_approval,
   min_role, per_recipient_daily_limit, respect_quiet_hours, append_opt_out, max_segments)
VALUES
  ('participant', 'Participant SMS', 'Ticket confirmations and participant updates',
     true, 'transactional', false, false, 'admin', 10, false, false, 4),
  ('event_notification', 'Event notifications', 'Reminders, schedule changes and cancellations',
     true, 'transactional', false, false, 'admin', 6, false, false, 4),
  ('marketing', 'Marketing campaigns', 'Promotions, offers and event announcements',
     false, 'marketing', true, true, 'admin', 1, true, true, 2),
  ('segmentation', 'Audience segmentation', 'Targeted messages to an audience segment',
     false, 'marketing', true, true, 'admin', 1, true, true, 2)
ON CONFLICT (key) DO NOTHING;

-- ─── Segments and campaigns ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_segments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description      TEXT CHECK (char_length(description) <= 500),
  definition       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_count       INT,
  last_counted_at  TIMESTAMPTZ,
  created_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  category            sms_category NOT NULL CHECK (category IN ('marketing', 'segmentation')),
  body                TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  segment_id          UUID REFERENCES sms_segments(id) ON DELETE RESTRICT,
  -- Whose consent this campaign relies on: 'platform' or an organizer id.
  consent_scope       TEXT NOT NULL DEFAULT 'platform',
  status              sms_campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at        TIMESTAMPTZ,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  submitted_at        TIMESTAMPTZ,
  approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  decision_note       TEXT CHECK (char_length(decision_note) <= 1000),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  expansion_cursor    TEXT,
  expansion_done      BOOLEAN NOT NULL DEFAULT false,
  recipients_queued   INT NOT NULL DEFAULT 0,
  recipients_skipped  INT NOT NULL DEFAULT 0,
  skipped_reasons     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_campaign_four_eyes CHECK (approved_by IS NULL OR approved_by <> created_by),
  CONSTRAINT sms_campaign_needs_segment CHECK (status IN ('draft', 'cancelled', 'rejected') OR segment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sms_campaigns_status_idx ON sms_campaigns (status, scheduled_at);

-- ─── The queue ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key      TEXT NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 3 AND 200),
  category             sms_category NOT NULL,
  traffic_class        sms_traffic_class NOT NULL,
  to_e164              TEXT NOT NULL CHECK (to_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  country              CHAR(2),
  body                 TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1600),
  encoding             TEXT NOT NULL DEFAULT 'GSM-7' CHECK (encoding IN ('GSM-7', 'UCS-2')),
  segments             SMALLINT NOT NULL DEFAULT 1 CHECK (segments BETWEEN 1 AND 20),
  status               sms_message_status NOT NULL DEFAULT 'queued',
  priority             SMALLINT NOT NULL DEFAULT 50,
  consent_scope        TEXT,
  campaign_id          UUID REFERENCES sms_campaigns(id) ON DELETE SET NULL,
  event_id             UUID REFERENCES events(id) ON DELETE SET NULL,
  order_id             UUID REFERENCES orders(id) ON DELETE SET NULL,
  user_id              UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  provider_id          TEXT REFERENCES sms_providers(id) ON DELETE SET NULL,
  sender_value         TEXT,
  provider_message_id  TEXT,
  attempts             SMALLINT NOT NULL DEFAULT 0,
  max_attempts         SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  tried_providers      TEXT[] NOT NULL DEFAULT '{}',
  next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until          TIMESTAMPTZ,
  lease_holder         TEXT,
  block_reason         TEXT,
  last_error_code      TEXT,
  last_error           TEXT,
  est_cost_micros      BIGINT,
  cost_micros          BIGINT,
  currency             CHAR(3),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_due_idx
  ON sms_messages (priority, next_attempt_at) WHERE status = 'queued';
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_provider_ref_idx
  ON sms_messages (provider_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_recipient_idx ON sms_messages (to_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_campaign_idx  ON sms_messages (campaign_id, status) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_created_idx   ON sms_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_country_idx   ON sms_messages (country, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_open_idx
  ON sms_messages (status, lease_until) WHERE status IN ('sending', 'unknown');

-- One row per provider call, written BEFORE the call.
CREATE TABLE IF NOT EXISTS sms_attempts (
  id                   BIGSERIAL PRIMARY KEY,
  message_id           UUID NOT NULL REFERENCES sms_messages(id) ON DELETE CASCADE,
  attempt_no           SMALLINT NOT NULL,
  provider_id          TEXT NOT NULL,
  sender_value         TEXT,
  outcome              TEXT NOT NULL DEFAULT 'pending'
                         CHECK (outcome IN ('pending', 'accepted', 'rejected', 'retryable', 'uncertain')),
  provider_message_id  TEXT,
  http_status          INT,
  error_code           TEXT,
  error_message        TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ,
  UNIQUE (message_id, attempt_no)
);

-- Delivery receipts, raw, deduplicated (providers retry webhooks).
CREATE TABLE IF NOT EXISTS sms_receipts (
  id                   BIGSERIAL PRIMARY KEY,
  provider_id          TEXT NOT NULL,
  provider_message_id  TEXT,
  message_id           UUID REFERENCES sms_messages(id) ON DELETE CASCADE,
  status_raw           TEXT,
  status               sms_message_status,
  error_code           TEXT,
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key           TEXT NOT NULL UNIQUE,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_receipts_message_idx ON sms_receipts (message_id);

-- Inbound messages (STOP, START, HELP and anything else people reply).
CREATE TABLE IF NOT EXISTS sms_inbound (
  id                   BIGSERIAL PRIMARY KEY,
  provider_id          TEXT NOT NULL,
  provider_message_id  TEXT,
  from_e164            TEXT NOT NULL,
  to_value             TEXT,
  body                 TEXT,
  keyword              TEXT,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_message_id)
);

-- ─── Compliance ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_consents (
  phone_e164   TEXT NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  scope        TEXT NOT NULL CHECK (scope = 'platform' OR scope ~ '^[0-9a-f-]{36}$'),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'opted_in', 'opted_out')),
  source       TEXT NOT NULL CHECK (source IN ('checkout', 'account', 'keyword', 'link', 'admin', 'import')),
  evidence     JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (phone_e164, scope)
);

-- Append-only history: what consent someone had, when, and on what evidence.
CREATE TABLE IF NOT EXISTS sms_consent_log (
  id           BIGSERIAL PRIMARY KEY,
  phone_e164   TEXT NOT NULL,
  scope        TEXT NOT NULL,
  status       TEXT NOT NULL,
  source       TEXT NOT NULL,
  evidence     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id     UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_consent_log_phone_idx ON sms_consent_log (phone_e164, created_at DESC);

CREATE OR REPLACE FUNCTION sms_consent_history() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO sms_consent_log (phone_e164, scope, status, source, evidence, actor_id)
  VALUES (NEW.phone_e164, NEW.scope, NEW.status, NEW.source, NEW.evidence,
          NULLIF(NEW.evidence->>'actorId', '')::uuid);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sms_consent_history_trg ON sms_consents;
CREATE TRIGGER sms_consent_history_trg AFTER INSERT OR UPDATE ON sms_consents
  FOR EACH ROW EXECUTE FUNCTION sms_consent_history();

CREATE TABLE IF NOT EXISTS sms_suppressions (
  phone_e164   TEXT PRIMARY KEY CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- 'all': nothing at all. 'marketing': transactional still allowed.
  scope        TEXT NOT NULL CHECK (scope IN ('all', 'marketing')),
  reason       TEXT NOT NULL CHECK (reason IN
                 ('stop_keyword', 'opt_out_link', 'admin', 'carrier_opt_out', 'invalid_number', 'fraud')),
  note         TEXT CHECK (char_length(note) <= 500),
  provider_id  TEXT,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Guards ────────────────────────────────────────────────────────────────
-- A country is enabled only with a verified, active route through an enabled
-- provider. The CHECK above covers the country's own record; this covers the
-- route, which lives in another table.
CREATE OR REPLACE FUNCTION sms_country_enable_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'enabled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'enabled') THEN
    IF NOT EXISTS (
      SELECT 1 FROM sms_routes r JOIN sms_providers p ON p.id = r.provider_id
       WHERE r.country = NEW.iso2 AND r.verified AND r.active AND p.enabled
    ) THEN
      RAISE EXCEPTION 'SMS_COUNTRY_UNVERIFIED: % has no verified, active route through an enabled provider', NEW.iso2
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sms_country_enable_guard_trg ON sms_countries;
CREATE TRIGGER sms_country_enable_guard_trg BEFORE INSERT OR UPDATE ON sms_countries
  FOR EACH ROW EXECUTE FUNCTION sms_country_enable_guard();

-- ─── Queue functions ───────────────────────────────────────────────────────
-- Claims due messages. SKIP LOCKED: any number of workers can call this at
-- once and never receive the same row.
CREATE OR REPLACE FUNCTION sms_claim_batch(p_holder TEXT, p_limit INT DEFAULT 50, p_lease_seconds INT DEFAULT 120)
RETURNS SETOF sms_messages AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM sms_messages
     WHERE status = 'queued' AND next_attempt_at <= now()
     ORDER BY priority, next_attempt_at
     LIMIT LEAST(GREATEST(p_limit, 1), 500)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE sms_messages m
     SET status = 'sending',
         lease_holder = p_holder,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
    FROM picked
   WHERE m.id = picked.id
  RETURNING m.*;
END $$ LANGUAGE plpgsql;

-- Messages a dead worker was holding. If it had already called a provider (an
-- attempt row exists and never finished), the message may have gone out:
-- 'unknown', never resent automatically. If it had not, it goes back in line.
CREATE OR REPLACE FUNCTION sms_release_stale()
RETURNS TABLE (requeued INT, uncertain INT) AS $$
DECLARE v_requeued INT; v_uncertain INT;
BEGIN
  WITH stale AS (
    SELECT m.id,
           EXISTS (SELECT 1 FROM sms_attempts a
                    WHERE a.message_id = m.id AND a.attempt_no = m.attempts
                      AND a.outcome IN ('pending', 'uncertain')) AS maybe_sent
      FROM sms_messages m
     WHERE m.status = 'sending' AND m.lease_until < now()
     FOR UPDATE OF m SKIP LOCKED
  ), upd AS (
    UPDATE sms_messages m
       SET status = CASE WHEN s.maybe_sent THEN 'unknown'::sms_message_status ELSE 'queued'::sms_message_status END,
           next_attempt_at = now(),
           lease_until = NULL, lease_holder = NULL,
           last_error = CASE WHEN s.maybe_sent THEN 'Worker stopped during the provider call; outcome unknown' ELSE m.last_error END,
           updated_at = now()
      FROM stale s WHERE m.id = s.id
    RETURNING s.maybe_sent
  )
  SELECT count(*) FILTER (WHERE NOT maybe_sent), count(*) FILTER (WHERE maybe_sent)
    INTO v_requeued, v_uncertain FROM upd;

  UPDATE sms_attempts a SET outcome = 'uncertain', finished_at = now(),
         error_message = COALESCE(a.error_message, 'Worker stopped during the call')
   WHERE a.outcome = 'pending' AND a.started_at < now() - interval '10 minutes';

  RETURN QUERY SELECT COALESCE(v_requeued, 0), COALESCE(v_uncertain, 0);
END $$ LANGUAGE plpgsql;

-- Everything the dispatcher needs about one batch, in one round trip:
-- per-recipient counts in the last 24h, per-country counts this hour and
-- today, and today's estimated marketing spend.
CREATE OR REPLACE FUNCTION sms_dispatch_context(p_phones TEXT[], p_countries TEXT[], p_currency TEXT, p_holder TEXT DEFAULT NULL)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'recipients', COALESCE((
      SELECT jsonb_object_agg(k, n) FROM (
        SELECT to_e164 || '|' || category::text AS k, count(*) AS n
          FROM sms_messages
         WHERE to_e164 = ANY(p_phones)
           AND created_at > now() - interval '24 hours'
           AND (status IN ('sent', 'delivered', 'undelivered', 'unknown') OR (status = 'sending' AND lease_holder IS DISTINCT FROM p_holder))
         GROUP BY 1) r), '{}'::jsonb),
    'countryHour', COALESCE((
      SELECT jsonb_object_agg(country, n) FROM (
        SELECT country, count(*) AS n FROM sms_messages
         WHERE country = ANY(p_countries) AND campaign_id IS NULL
           AND created_at > now() - interval '1 hour'
           AND (status IN ('sent', 'delivered', 'undelivered', 'unknown') OR (status = 'sending' AND lease_holder IS DISTINCT FROM p_holder))
         GROUP BY 1) c), '{}'::jsonb),
    'countryDay', COALESCE((
      SELECT jsonb_object_agg(country, n) FROM (
        SELECT country, count(*) AS n FROM sms_messages
         WHERE country = ANY(p_countries)
           AND created_at > date_trunc('day', now())
           AND (status IN ('sent', 'delivered', 'undelivered', 'unknown') OR (status = 'sending' AND lease_holder IS DISTINCT FROM p_holder))
         GROUP BY 1) d), '{}'::jsonb),
    'marketingSpendToday', COALESCE((
      SELECT sum(COALESCE(cost_micros, est_cost_micros)) FROM sms_messages
       WHERE traffic_class = 'marketing' AND currency = p_currency
         AND created_at > date_trunc('day', now())
         AND (status IN ('sent', 'delivered', 'undelivered', 'unknown') OR (status = 'sending' AND lease_holder IS DISTINCT FROM p_holder))), 0)
  );
$$ LANGUAGE sql STABLE;

-- A provider call's result, counted atomically for the circuit breaker.
CREATE OR REPLACE FUNCTION sms_provider_result(p_id TEXT, p_ok BOOLEAN, p_error TEXT DEFAULT NULL,
                                               p_threshold INT DEFAULT 5, p_open_seconds INT DEFAULT 300)
RETURNS VOID AS $$
BEGIN
  IF p_ok THEN
    UPDATE sms_providers SET consecutive_failures = 0, last_success_at = now(), circuit_open_until = NULL
     WHERE id = p_id AND (consecutive_failures <> 0 OR last_success_at IS NULL OR last_success_at < now() - interval '1 minute');
  ELSE
    UPDATE sms_providers
       SET consecutive_failures = consecutive_failures + 1,
           last_failure_at = now(),
           last_error = left(p_error, 300),
           circuit_open_until = CASE WHEN consecutive_failures + 1 >= p_threshold
                                     THEN now() + make_interval(secs => p_open_seconds)
                                     ELSE circuit_open_until END
     WHERE id = p_id;
  END IF;
END $$ LANGUAGE plpgsql;

-- The audience of a segment, one page at a time (keyset on the raw phone).
-- Phones are returned as typed by buyers; the backend normalises them to E.164
-- with the event's country as the default region.
CREATE OR REPLACE FUNCTION sms_segment_audience(p_definition JSONB, p_after TEXT DEFAULT '', p_limit INT DEFAULT 1000)
RETURNS TABLE (phone TEXT, default_country CHAR(2), user_id UUID, orders BIGINT, last_order_at TIMESTAMPTZ) AS $$
  WITH base AS (
    SELECT COALESCE(NULLIF(btrim(o.guest_phone), ''), NULLIF(btrim(p.phone), '')) AS phone,
           e.country, o.user_id, o.id AS order_id, o.paid_at, o.created_at
      FROM orders o
      JOIN events e ON e.id = o.event_id
      LEFT JOIN profiles p ON p.id = o.user_id
     WHERE o.status = 'paid'
       AND (NOT (p_definition ? 'eventIds') OR o.event_id::text IN (SELECT jsonb_array_elements_text(p_definition->'eventIds')))
       AND (NOT (p_definition ? 'organizerIds') OR e.organizer_id::text IN (SELECT jsonb_array_elements_text(p_definition->'organizerIds')))
       AND (NOT (p_definition ? 'eventCountries') OR e.country IN (SELECT jsonb_array_elements_text(p_definition->'eventCountries')))
       AND (NOT (p_definition ? 'purchasedWithinDays')
            OR COALESCE(o.paid_at, o.created_at) > now() - make_interval(days => (p_definition->>'purchasedWithinDays')::int))
       AND (COALESCE((p_definition->>'attendedOnly')::boolean, false) = false
            OR EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.status = 'scanned'))
  )
  SELECT phone, (array_agg(country ORDER BY COALESCE(paid_at, created_at) DESC))[1]::char(2),
         (array_agg(user_id ORDER BY COALESCE(paid_at, created_at) DESC) FILTER (WHERE user_id IS NOT NULL))[1],
         count(DISTINCT order_id), max(COALESCE(paid_at, created_at))
    FROM base
   WHERE phone IS NOT NULL AND phone > COALESCE(p_after, '')
   GROUP BY phone
  HAVING count(DISTINCT order_id) >= COALESCE((p_definition->>'minOrders')::int, 1)
   ORDER BY phone
   LIMIT LEAST(GREATEST(p_limit, 1), 5000);
$$ LANGUAGE sql STABLE;

-- Analytics, aggregated in the database rather than shipped row by row.
CREATE OR REPLACE FUNCTION sms_analytics(p_since TIMESTAMPTZ, p_until TIMESTAMPTZ DEFAULT now())
RETURNS JSONB AS $$
  WITH m AS (
    SELECT * FROM sms_messages WHERE created_at >= p_since AND created_at < p_until
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
        'messages', count(*),
        'sent', count(*) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered')),
        'delivered', count(*) FILTER (WHERE status = 'delivered'),
        'failed', count(*) FILTER (WHERE status IN ('failed', 'undelivered')),
        'blocked', count(*) FILTER (WHERE status = 'blocked'),
        'unknown', count(*) FILTER (WHERE status = 'unknown'),
        'queued', count(*) FILTER (WHERE status IN ('queued', 'sending')),
        'segments', COALESCE(sum(segments) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered')), 0)
      ) FROM m),
    'cost', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'micros', micros)) FROM (
        SELECT currency, sum(COALESCE(cost_micros, est_cost_micros)) AS micros FROM m
         WHERE currency IS NOT NULL AND status IN ('sent', 'delivered', 'undelivered', 'unknown')
         GROUP BY currency ORDER BY 2 DESC) c), '[]'::jsonb),
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'sent', sent, 'delivered', delivered, 'failed', failed, 'micros', micros) ORDER BY day) FROM (
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered')) AS sent,
               count(*) FILTER (WHERE status = 'delivered') AS delivered,
               count(*) FILTER (WHERE status IN ('failed', 'undelivered')) AS failed,
               COALESCE(sum(COALESCE(cost_micros, est_cost_micros)) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered', 'unknown')), 0) AS micros
          FROM m GROUP BY 1) d), '[]'::jsonb),
    'byCountry', COALESCE((SELECT jsonb_agg(row_to_json(c) ORDER BY c.sent DESC) FROM (
        SELECT country, count(*) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered')) AS sent,
               count(*) FILTER (WHERE status = 'delivered') AS delivered,
               count(*) FILTER (WHERE status IN ('failed', 'undelivered')) AS failed,
               count(*) FILTER (WHERE status = 'blocked') AS blocked,
               max(currency) AS currency,
               COALESCE(sum(COALESCE(cost_micros, est_cost_micros)) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered', 'unknown')), 0) AS micros
          FROM m GROUP BY country LIMIT 250) c), '[]'::jsonb),
    'byProvider', COALESCE((SELECT jsonb_agg(row_to_json(p)) FROM (
        SELECT provider_id, count(*) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered')) AS sent,
               count(*) FILTER (WHERE status = 'delivered') AS delivered,
               count(*) FILTER (WHERE status IN ('failed', 'undelivered')) AS failed,
               count(*) FILTER (WHERE status = 'unknown') AS unknown,
               COALESCE(sum(COALESCE(cost_micros, est_cost_micros)) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered', 'unknown')), 0) AS micros
          FROM m WHERE provider_id IS NOT NULL GROUP BY provider_id) p), '[]'::jsonb),
    'byCategory', COALESCE((SELECT jsonb_agg(row_to_json(k)) FROM (
        SELECT category, count(*) AS messages,
               count(*) FILTER (WHERE status IN ('sent', 'delivered', 'undelivered')) AS sent,
               count(*) FILTER (WHERE status = 'delivered') AS delivered
          FROM m GROUP BY category) k), '[]'::jsonb),
    'blockReasons', COALESCE((SELECT jsonb_agg(row_to_json(b) ORDER BY b.n DESC) FROM (
        SELECT block_reason AS reason, count(*) AS n FROM m
         WHERE status = 'blocked' AND block_reason IS NOT NULL GROUP BY 1 LIMIT 20) b), '[]'::jsonb),
    'errors', COALESCE((SELECT jsonb_agg(row_to_json(e) ORDER BY e.n DESC) FROM (
        SELECT provider_id, last_error_code AS code, count(*) AS n FROM m
         WHERE status IN ('failed', 'undelivered') AND last_error_code IS NOT NULL
         GROUP BY 1, 2 LIMIT 20) e), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE;

-- ─── Lock down ─────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sms_settings', 'sms_providers', 'sms_countries', 'sms_senders', 'sms_routes',
                           'sms_categories', 'sms_segments', 'sms_campaigns', 'sms_messages', 'sms_attempts',
                           'sms_receipts', 'sms_inbound', 'sms_consents', 'sms_consent_log', 'sms_suppressions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

REVOKE ALL ON FUNCTION sms_claim_batch(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sms_release_stale() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sms_dispatch_context(TEXT[], TEXT[], TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sms_provider_result(TEXT, BOOLEAN, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sms_segment_audience(JSONB, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sms_analytics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sms_claim_batch(TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION sms_release_stale() TO service_role;
GRANT EXECUTE ON FUNCTION sms_dispatch_context(TEXT[], TEXT[], TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sms_provider_result(TEXT, BOOLEAN, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION sms_segment_audience(JSONB, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION sms_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ─── The country catalogue ─────────────────────────────────────────────────
-- Numbering facts only: name, calling code, the prefixes that tell apart
-- countries sharing a code, a region and a representative time zone (used for
-- quiet hours). NOTHING about deliverability is seeded: every row starts
-- 'unverified' with sender rules 'unknown', and stays that way until an admin
-- records what the provider's country guidelines say.
INSERT INTO sms_countries (iso2, name, dial_code, prefixes, dial_primary, region, timezone) VALUES
  ('AF','Afghanistan','93','{}',true,'Asia','Asia/Kabul'),
  ('AX','Åland Islands','358','{35818}',false,'Europe','Europe/Mariehamn'),
  ('AL','Albania','355','{}',true,'Europe','Europe/Tirane'),
  ('DZ','Algeria','213','{}',true,'Africa','Africa/Algiers'),
  ('AS','American Samoa','1','{1684}',false,'Oceania','Pacific/Pago_Pago'),
  ('AD','Andorra','376','{}',true,'Europe','Europe/Andorra'),
  ('AO','Angola','244','{}',true,'Africa','Africa/Luanda'),
  ('AI','Anguilla','1','{1264}',false,'Americas','America/Anguilla'),
  ('AG','Antigua and Barbuda','1','{1268}',false,'Americas','America/Antigua'),
  ('AR','Argentina','54','{}',true,'Americas','America/Argentina/Buenos_Aires'),
  ('AM','Armenia','374','{}',true,'Asia','Asia/Yerevan'),
  ('AW','Aruba','297','{}',true,'Americas','America/Aruba'),
  ('AU','Australia','61','{}',true,'Oceania','Australia/Sydney'),
  ('AT','Austria','43','{}',true,'Europe','Europe/Vienna'),
  ('AZ','Azerbaijan','994','{}',true,'Asia','Asia/Baku'),
  ('BS','Bahamas','1','{1242}',false,'Americas','America/Nassau'),
  ('BH','Bahrain','973','{}',true,'Middle East','Asia/Bahrain'),
  ('BD','Bangladesh','880','{}',true,'Asia','Asia/Dhaka'),
  ('BB','Barbados','1','{1246}',false,'Americas','America/Barbados'),
  ('BY','Belarus','375','{}',true,'Europe','Europe/Minsk'),
  ('BE','Belgium','32','{}',true,'Europe','Europe/Brussels'),
  ('BZ','Belize','501','{}',true,'Americas','America/Belize'),
  ('BJ','Benin','229','{}',true,'Africa','Africa/Porto-Novo'),
  ('BM','Bermuda','1','{1441}',false,'Americas','Atlantic/Bermuda'),
  ('BT','Bhutan','975','{}',true,'Asia','Asia/Thimphu'),
  ('BO','Bolivia','591','{}',true,'Americas','America/La_Paz'),
  ('BQ','Caribbean Netherlands','599','{5997}',false,'Americas','America/Kralendijk'),
  ('BA','Bosnia and Herzegovina','387','{}',true,'Europe','Europe/Sarajevo'),
  ('BW','Botswana','267','{}',true,'Africa','Africa/Gaborone'),
  ('BR','Brazil','55','{}',true,'Americas','America/Sao_Paulo'),
  ('IO','British Indian Ocean Territory','246','{}',true,'Africa','Indian/Chagos'),
  ('VG','British Virgin Islands','1','{1284}',false,'Americas','America/Tortola'),
  ('BN','Brunei','673','{}',true,'Asia','Asia/Brunei'),
  ('BG','Bulgaria','359','{}',true,'Europe','Europe/Sofia'),
  ('BF','Burkina Faso','226','{}',true,'Africa','Africa/Ouagadougou'),
  ('BI','Burundi','257','{}',true,'Africa','Africa/Bujumbura'),
  ('CV','Cabo Verde','238','{}',true,'Africa','Atlantic/Cape_Verde'),
  ('KH','Cambodia','855','{}',true,'Asia','Asia/Phnom_Penh'),
  ('CM','Cameroon','237','{}',true,'Africa','Africa/Douala'),
  ('CA','Canada','1','{1204,1226,1236,1249,1250,1257,1263,1289,1306,1343,1354,1365,1367,1368,1382,1387,1403,1416,1418,1428,1431,1437,1438,1450,1460,1468,1474,1506,1514,1519,1537,1548,1579,1581,1584,1587,1604,1613,1639,1647,1672,1683,1705,1709,1742,1753,1778,1780,1782,1807,1819,1825,1867,1873,1879,1902,1905,1942}',false,'Americas','America/Toronto'),
  ('KY','Cayman Islands','1','{1345}',false,'Americas','America/Cayman'),
  ('CF','Central African Republic','236','{}',true,'Africa','Africa/Bangui'),
  ('TD','Chad','235','{}',true,'Africa','Africa/Ndjamena'),
  ('CL','Chile','56','{}',true,'Americas','America/Santiago'),
  ('CN','China','86','{}',true,'Asia','Asia/Shanghai'),
  ('CX','Christmas Island','61','{6189164}',false,'Oceania','Indian/Christmas'),
  ('CC','Cocos (Keeling) Islands','61','{6189162}',false,'Oceania','Indian/Cocos'),
  ('CO','Colombia','57','{}',true,'Americas','America/Bogota'),
  ('KM','Comoros','269','{}',true,'Africa','Indian/Comoro'),
  ('CG','Congo','242','{}',true,'Africa','Africa/Brazzaville'),
  ('CD','Congo (DRC)','243','{}',true,'Africa','Africa/Kinshasa'),
  ('CK','Cook Islands','682','{}',true,'Oceania','Pacific/Rarotonga'),
  ('CR','Costa Rica','506','{}',true,'Americas','America/Costa_Rica'),
  ('CI','Côte d''Ivoire','225','{}',true,'Africa','Africa/Abidjan'),
  ('HR','Croatia','385','{}',true,'Europe','Europe/Zagreb'),
  ('CU','Cuba','53','{}',true,'Americas','America/Havana'),
  ('CW','Curaçao','599','{}',true,'Americas','America/Curacao'),
  ('CY','Cyprus','357','{}',true,'Europe','Asia/Nicosia'),
  ('CZ','Czechia','420','{}',true,'Europe','Europe/Prague'),
  ('DK','Denmark','45','{}',true,'Europe','Europe/Copenhagen'),
  ('DJ','Djibouti','253','{}',true,'Africa','Africa/Djibouti'),
  ('DM','Dominica','1','{1767}',false,'Americas','America/Dominica'),
  ('DO','Dominican Republic','1','{1809,1829,1849}',false,'Americas','America/Santo_Domingo'),
  ('EC','Ecuador','593','{}',true,'Americas','America/Guayaquil'),
  ('EG','Egypt','20','{}',true,'Africa','Africa/Cairo'),
  ('SV','El Salvador','503','{}',true,'Americas','America/El_Salvador'),
  ('GQ','Equatorial Guinea','240','{}',true,'Africa','Africa/Malabo'),
  ('ER','Eritrea','291','{}',true,'Africa','Africa/Asmara'),
  ('EE','Estonia','372','{}',true,'Europe','Europe/Tallinn'),
  ('SZ','Eswatini','268','{}',true,'Africa','Africa/Mbabane'),
  ('ET','Ethiopia','251','{}',true,'Africa','Africa/Addis_Ababa'),
  ('FK','Falkland Islands','500','{}',true,'Americas','Atlantic/Stanley'),
  ('FO','Faroe Islands','298','{}',true,'Europe','Atlantic/Faroe'),
  ('FJ','Fiji','679','{}',true,'Oceania','Pacific/Fiji'),
  ('FI','Finland','358','{}',true,'Europe','Europe/Helsinki'),
  ('FR','France','33','{}',true,'Europe','Europe/Paris'),
  ('GF','French Guiana','594','{}',true,'Americas','America/Cayenne'),
  ('PF','French Polynesia','689','{}',true,'Oceania','Pacific/Tahiti'),
  ('GA','Gabon','241','{}',true,'Africa','Africa/Libreville'),
  ('GM','Gambia','220','{}',true,'Africa','Africa/Banjul'),
  ('GE','Georgia','995','{}',true,'Asia','Asia/Tbilisi'),
  ('DE','Germany','49','{}',true,'Europe','Europe/Berlin'),
  ('GH','Ghana','233','{}',true,'Africa','Africa/Accra'),
  ('GI','Gibraltar','350','{}',true,'Europe','Europe/Gibraltar'),
  ('GR','Greece','30','{}',true,'Europe','Europe/Athens'),
  ('GL','Greenland','299','{}',true,'Americas','America/Nuuk'),
  ('GD','Grenada','1','{1473}',false,'Americas','America/Grenada'),
  ('GP','Guadeloupe','590','{}',true,'Americas','America/Guadeloupe'),
  ('GU','Guam','1','{1671}',false,'Oceania','Pacific/Guam'),
  ('GT','Guatemala','502','{}',true,'Americas','America/Guatemala'),
  ('GG','Guernsey','44','{441481,447781,447839,447911}',false,'Europe','Europe/Guernsey'),
  ('GN','Guinea','224','{}',true,'Africa','Africa/Conakry'),
  ('GW','Guinea-Bissau','245','{}',true,'Africa','Africa/Bissau'),
  ('GY','Guyana','592','{}',true,'Americas','America/Guyana'),
  ('HT','Haiti','509','{}',true,'Americas','America/Port-au-Prince'),
  ('HN','Honduras','504','{}',true,'Americas','America/Tegucigalpa'),
  ('HK','Hong Kong','852','{}',true,'Asia','Asia/Hong_Kong'),
  ('HU','Hungary','36','{}',true,'Europe','Europe/Budapest'),
  ('IS','Iceland','354','{}',true,'Europe','Atlantic/Reykjavik'),
  ('IN','India','91','{}',true,'Asia','Asia/Kolkata'),
  ('ID','Indonesia','62','{}',true,'Asia','Asia/Jakarta'),
  ('IR','Iran','98','{}',true,'Middle East','Asia/Tehran'),
  ('IQ','Iraq','964','{}',true,'Middle East','Asia/Baghdad'),
  ('IE','Ireland','353','{}',true,'Europe','Europe/Dublin'),
  ('IM','Isle of Man','44','{441624,447524,447624,447924}',false,'Europe','Europe/Isle_of_Man'),
  ('IL','Israel','972','{}',true,'Middle East','Asia/Jerusalem'),
  ('IT','Italy','39','{}',true,'Europe','Europe/Rome'),
  ('JM','Jamaica','1','{1876,1658}',false,'Americas','America/Jamaica'),
  ('JP','Japan','81','{}',true,'Asia','Asia/Tokyo'),
  ('JE','Jersey','44','{441534,447509,447700,447797,447829,447937}',false,'Europe','Europe/Jersey'),
  ('JO','Jordan','962','{}',true,'Middle East','Asia/Amman'),
  ('KZ','Kazakhstan','7','{76,77}',false,'Asia','Asia/Almaty'),
  ('KE','Kenya','254','{}',true,'Africa','Africa/Nairobi'),
  ('KI','Kiribati','686','{}',true,'Oceania','Pacific/Tarawa'),
  ('XK','Kosovo','383','{}',true,'Europe','Europe/Belgrade'),
  ('KW','Kuwait','965','{}',true,'Middle East','Asia/Kuwait'),
  ('KG','Kyrgyzstan','996','{}',true,'Asia','Asia/Bishkek'),
  ('LA','Laos','856','{}',true,'Asia','Asia/Vientiane'),
  ('LV','Latvia','371','{}',true,'Europe','Europe/Riga'),
  ('LB','Lebanon','961','{}',true,'Middle East','Asia/Beirut'),
  ('LS','Lesotho','266','{}',true,'Africa','Africa/Maseru'),
  ('LR','Liberia','231','{}',true,'Africa','Africa/Monrovia'),
  ('LY','Libya','218','{}',true,'Africa','Africa/Tripoli'),
  ('LI','Liechtenstein','423','{}',true,'Europe','Europe/Vaduz'),
  ('LT','Lithuania','370','{}',true,'Europe','Europe/Vilnius'),
  ('LU','Luxembourg','352','{}',true,'Europe','Europe/Luxembourg'),
  ('MO','Macao','853','{}',true,'Asia','Asia/Macau'),
  ('MG','Madagascar','261','{}',true,'Africa','Indian/Antananarivo'),
  ('MW','Malawi','265','{}',true,'Africa','Africa/Blantyre'),
  ('MY','Malaysia','60','{}',true,'Asia','Asia/Kuala_Lumpur'),
  ('MV','Maldives','960','{}',true,'Asia','Indian/Maldives'),
  ('ML','Mali','223','{}',true,'Africa','Africa/Bamako'),
  ('MT','Malta','356','{}',true,'Europe','Europe/Malta'),
  ('MH','Marshall Islands','692','{}',true,'Oceania','Pacific/Majuro'),
  ('MQ','Martinique','596','{}',true,'Americas','America/Martinique'),
  ('MR','Mauritania','222','{}',true,'Africa','Africa/Nouakchott'),
  ('MU','Mauritius','230','{}',true,'Africa','Indian/Mauritius'),
  ('YT','Mayotte','262','{262269,262639}',false,'Africa','Indian/Mayotte'),
  ('MX','Mexico','52','{}',true,'Americas','America/Mexico_City'),
  ('FM','Micronesia','691','{}',true,'Oceania','Pacific/Pohnpei'),
  ('MD','Moldova','373','{}',true,'Europe','Europe/Chisinau'),
  ('MC','Monaco','377','{}',true,'Europe','Europe/Monaco'),
  ('MN','Mongolia','976','{}',true,'Asia','Asia/Ulaanbaatar'),
  ('ME','Montenegro','382','{}',true,'Europe','Europe/Podgorica'),
  ('MS','Montserrat','1','{1664}',false,'Americas','America/Montserrat'),
  ('MA','Morocco','212','{}',true,'Africa','Africa/Casablanca'),
  ('MZ','Mozambique','258','{}',true,'Africa','Africa/Maputo'),
  ('MM','Myanmar','95','{}',true,'Asia','Asia/Yangon'),
  ('NA','Namibia','264','{}',true,'Africa','Africa/Windhoek'),
  ('NR','Nauru','674','{}',true,'Oceania','Pacific/Nauru'),
  ('NP','Nepal','977','{}',true,'Asia','Asia/Kathmandu'),
  ('NL','Netherlands','31','{}',true,'Europe','Europe/Amsterdam'),
  ('NC','New Caledonia','687','{}',true,'Oceania','Pacific/Noumea'),
  ('NZ','New Zealand','64','{}',true,'Oceania','Pacific/Auckland'),
  ('NI','Nicaragua','505','{}',true,'Americas','America/Managua'),
  ('NE','Niger','227','{}',true,'Africa','Africa/Niamey'),
  ('NG','Nigeria','234','{}',true,'Africa','Africa/Lagos'),
  ('NU','Niue','683','{}',true,'Oceania','Pacific/Niue'),
  ('NF','Norfolk Island','672','{}',true,'Oceania','Pacific/Norfolk'),
  ('KP','North Korea','850','{}',true,'Asia','Asia/Pyongyang'),
  ('MK','North Macedonia','389','{}',true,'Europe','Europe/Skopje'),
  ('MP','Northern Mariana Islands','1','{1670}',false,'Oceania','Pacific/Saipan'),
  ('NO','Norway','47','{}',true,'Europe','Europe/Oslo'),
  ('OM','Oman','968','{}',true,'Middle East','Asia/Muscat'),
  ('PK','Pakistan','92','{}',true,'Asia','Asia/Karachi'),
  ('PW','Palau','680','{}',true,'Oceania','Pacific/Palau'),
  ('PS','Palestine','970','{}',true,'Middle East','Asia/Gaza'),
  ('PA','Panama','507','{}',true,'Americas','America/Panama'),
  ('PG','Papua New Guinea','675','{}',true,'Oceania','Pacific/Port_Moresby'),
  ('PY','Paraguay','595','{}',true,'Americas','America/Asuncion'),
  ('PE','Peru','51','{}',true,'Americas','America/Lima'),
  ('PH','Philippines','63','{}',true,'Asia','Asia/Manila'),
  ('PL','Poland','48','{}',true,'Europe','Europe/Warsaw'),
  ('PT','Portugal','351','{}',true,'Europe','Europe/Lisbon'),
  ('PR','Puerto Rico','1','{1787,1939}',false,'Americas','America/Puerto_Rico'),
  ('QA','Qatar','974','{}',true,'Middle East','Asia/Qatar'),
  ('RE','Réunion','262','{}',true,'Africa','Indian/Reunion'),
  ('RO','Romania','40','{}',true,'Europe','Europe/Bucharest'),
  ('RU','Russia','7','{}',true,'Europe','Europe/Moscow'),
  ('RW','Rwanda','250','{}',true,'Africa','Africa/Kigali'),
  ('BL','Saint Barthélemy','590','{}',false,'Americas','America/St_Barthelemy'),
  ('SH','Saint Helena','290','{}',true,'Africa','Atlantic/St_Helena'),
  ('KN','Saint Kitts and Nevis','1','{1869}',false,'Americas','America/St_Kitts'),
  ('LC','Saint Lucia','1','{1758}',false,'Americas','America/St_Lucia'),
  ('MF','Saint Martin','590','{}',false,'Americas','America/Marigot'),
  ('PM','Saint Pierre and Miquelon','508','{}',true,'Americas','America/Miquelon'),
  ('VC','Saint Vincent and the Grenadines','1','{1784}',false,'Americas','America/St_Vincent'),
  ('WS','Samoa','685','{}',true,'Oceania','Pacific/Apia'),
  ('SM','San Marino','378','{}',true,'Europe','Europe/San_Marino'),
  ('ST','São Tomé and Príncipe','239','{}',true,'Africa','Africa/Sao_Tome'),
  ('SA','Saudi Arabia','966','{}',true,'Middle East','Asia/Riyadh'),
  ('SN','Senegal','221','{}',true,'Africa','Africa/Dakar'),
  ('RS','Serbia','381','{}',true,'Europe','Europe/Belgrade'),
  ('SC','Seychelles','248','{}',true,'Africa','Indian/Mahe'),
  ('SL','Sierra Leone','232','{}',true,'Africa','Africa/Freetown'),
  ('SG','Singapore','65','{}',true,'Asia','Asia/Singapore'),
  ('SX','Sint Maarten','1','{1721}',false,'Americas','America/Lower_Princes'),
  ('SK','Slovakia','421','{}',true,'Europe','Europe/Bratislava'),
  ('SI','Slovenia','386','{}',true,'Europe','Europe/Ljubljana'),
  ('SB','Solomon Islands','677','{}',true,'Oceania','Pacific/Guadalcanal'),
  ('SO','Somalia','252','{}',true,'Africa','Africa/Mogadishu'),
  ('ZA','South Africa','27','{}',true,'Africa','Africa/Johannesburg'),
  ('KR','South Korea','82','{}',true,'Asia','Asia/Seoul'),
  ('SS','South Sudan','211','{}',true,'Africa','Africa/Juba'),
  ('ES','Spain','34','{}',true,'Europe','Europe/Madrid'),
  ('LK','Sri Lanka','94','{}',true,'Asia','Asia/Colombo'),
  ('SD','Sudan','249','{}',true,'Africa','Africa/Khartoum'),
  ('SR','Suriname','597','{}',true,'Americas','America/Paramaribo'),
  ('SJ','Svalbard and Jan Mayen','47','{4779}',false,'Europe','Arctic/Longyearbyen'),
  ('SE','Sweden','46','{}',true,'Europe','Europe/Stockholm'),
  ('CH','Switzerland','41','{}',true,'Europe','Europe/Zurich'),
  ('SY','Syria','963','{}',true,'Middle East','Asia/Damascus'),
  ('TW','Taiwan','886','{}',true,'Asia','Asia/Taipei'),
  ('TJ','Tajikistan','992','{}',true,'Asia','Asia/Dushanbe'),
  ('TZ','Tanzania','255','{}',true,'Africa','Africa/Dar_es_Salaam'),
  ('TH','Thailand','66','{}',true,'Asia','Asia/Bangkok'),
  ('TL','Timor-Leste','670','{}',true,'Asia','Asia/Dili'),
  ('TG','Togo','228','{}',true,'Africa','Africa/Lome'),
  ('TK','Tokelau','690','{}',true,'Oceania','Pacific/Fakaofo'),
  ('TO','Tonga','676','{}',true,'Oceania','Pacific/Tongatapu'),
  ('TT','Trinidad and Tobago','1','{1868}',false,'Americas','America/Port_of_Spain'),
  ('TN','Tunisia','216','{}',true,'Africa','Africa/Tunis'),
  ('TR','Türkiye','90','{}',true,'Europe','Europe/Istanbul'),
  ('TM','Turkmenistan','993','{}',true,'Asia','Asia/Ashgabat'),
  ('TC','Turks and Caicos Islands','1','{1649}',false,'Americas','America/Grand_Turk'),
  ('TV','Tuvalu','688','{}',true,'Oceania','Pacific/Funafuti'),
  ('UG','Uganda','256','{}',true,'Africa','Africa/Kampala'),
  ('UA','Ukraine','380','{}',true,'Europe','Europe/Kyiv'),
  ('AE','United Arab Emirates','971','{}',true,'Middle East','Asia/Dubai'),
  ('GB','United Kingdom','44','{}',true,'Europe','Europe/London'),
  ('US','United States','1','{}',true,'Americas','America/New_York'),
  ('VI','U.S. Virgin Islands','1','{1340}',false,'Americas','America/St_Thomas'),
  ('UY','Uruguay','598','{}',true,'Americas','America/Montevideo'),
  ('UZ','Uzbekistan','998','{}',true,'Asia','Asia/Tashkent'),
  ('VU','Vanuatu','678','{}',true,'Oceania','Pacific/Efate'),
  ('VA','Vatican City','39','{3906698,379}',false,'Europe','Europe/Vatican'),
  ('VE','Venezuela','58','{}',true,'Americas','America/Caracas'),
  ('VN','Vietnam','84','{}',true,'Asia','Asia/Ho_Chi_Minh'),
  ('WF','Wallis and Futuna','681','{}',true,'Oceania','Pacific/Wallis'),
  ('EH','Western Sahara','212','{2125288,2125289}',false,'Africa','Africa/El_Aaiun'),
  ('YE','Yemen','967','{}',true,'Middle East','Asia/Aden'),
  ('ZM','Zambia','260','{}',true,'Africa','Africa/Lusaka'),
  ('ZW','Zimbabwe','263','{}',true,'Africa','Africa/Harare')
ON CONFLICT (iso2) DO NOTHING;
