-- ═══════════════════════════════════════════════════════════════════════════
-- SMS, part 2: two kinds of consent, organizer campaigns, stored credentials.
-- Requires 20261116090000_sms_platform.
--
-- ─── 1. TRANSACTIONAL AND MARKETING CONSENT ARE DIFFERENT ANSWERS ──────────
-- A buyer may want their ticket confirmation by text and no offers, or the
-- reverse. `sms_consents.kind` makes them two rows, never one flag. Transactional
-- consent is always platform-wide (it is about the person's own orders);
-- marketing consent is per sender: 'platform' (Eventsli) or one organizer.
--
-- The two transactional categories now REQUIRE transactional consent by
-- default: a buyer who did not tick "text me about my tickets" is not texted.
-- A super admin can relax that per category where the law allows.
--
-- ─── 2. ORGANIZER CAMPAIGNS ────────────────────────────────────────────────
-- An organizer may text people who opted in to THAT organizer's marketing, once
-- Eventsli has granted access (`sms_organizer_access`), within a monthly cap,
-- and only after an Eventsli admin approves each campaign. The organizer is the
-- author, the admin the approver: four eyes by construction.
--
-- ─── 3. PROVIDER CREDENTIALS, ENCRYPTED AT REST ────────────────────────────
-- Optional alternative to environment variables. Ciphertext only (AES-256-GCM,
-- key in SMS_CREDENTIALS_KEY on the server); the database never sees a secret
-- in clear, and the API never returns one. Environment variables still win.
--
-- ─── 4. "VERIFIED" IS ITS OWN STATE ────────────────────────────────────────
-- A verified country that is switched off is 'disabled', not 'unverified', so
-- the word on the screen matches what was checked.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.sms_consents') IS NULL THEN
    RAISE EXCEPTION 'apply 20261116090000_sms_platform.sql first';
  END IF;
END $$;

-- ─── 1. Consent kinds ──────────────────────────────────────────────────────
ALTER TABLE sms_consents ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'marketing';
ALTER TABLE sms_consent_log ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'marketing';

DO $$ BEGIN
  ALTER TABLE sms_consents ADD CONSTRAINT sms_consent_kind CHECK (kind IN ('transactional', 'marketing'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE sms_consents ADD CONSTRAINT sms_consent_transactional_is_platform CHECK (kind = 'marketing' OR scope = 'platform');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The key gains `kind`: one person, one sender, two answers.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_consents_pkey'
              AND pg_get_constraintdef(oid) NOT LIKE '%kind%') THEN
    ALTER TABLE sms_consents DROP CONSTRAINT sms_consents_pkey;
    ALTER TABLE sms_consents ADD CONSTRAINT sms_consents_pkey PRIMARY KEY (phone_e164, scope, kind);
  END IF;
END $$;

ALTER TABLE sms_consents DROP CONSTRAINT IF EXISTS sms_consents_source_check;
ALTER TABLE sms_consents ADD CONSTRAINT sms_consents_source_check
  CHECK (source IN ('checkout', 'registration', 'account', 'keyword', 'link', 'admin', 'import'));

CREATE INDEX IF NOT EXISTS sms_consents_user_idx ON sms_consents (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_consents_scope_idx ON sms_consents (scope, kind, status);

CREATE OR REPLACE FUNCTION sms_consent_history() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO sms_consent_log (phone_e164, scope, kind, status, source, evidence, actor_id)
  VALUES (NEW.phone_e164, NEW.scope, NEW.kind, NEW.status, NEW.source, NEW.evidence,
          NULLIF(NEW.evidence->>'actorId', '')::uuid);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS consent_kind TEXT;
DO $$ BEGIN
  ALTER TABLE sms_messages ADD CONSTRAINT sms_message_consent_kind CHECK (consent_kind IS NULL OR consent_kind IN ('transactional', 'marketing'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Messages queued before this migration: marketing ones carried a scope.
UPDATE sms_messages SET consent_kind = 'marketing' WHERE consent_kind IS NULL AND consent_scope IS NOT NULL;

-- Transactional categories require transactional consent, unless an admin
-- has already configured the category.
UPDATE sms_categories SET requires_consent = true
 WHERE key IN ('participant', 'event_notification') AND updated_by IS NULL;

-- ─── 2. Organizer campaigns ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_organizer_access (
  organizer_id         UUID PRIMARY KEY REFERENCES organizers(id) ON DELETE CASCADE,
  enabled              BOOLEAN NOT NULL DEFAULT false,
  monthly_message_cap  INT NOT NULL DEFAULT 1000 CHECK (monthly_message_cap BETWEEN 0 AND 10000000),
  categories           sms_category[] NOT NULL DEFAULT '{marketing,segmentation}',
  note                 TEXT CHECK (char_length(note) <= 500),
  updated_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_organizer_categories CHECK (categories <@ ARRAY['marketing', 'segmentation']::sms_category[])
);

ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS organizer_id UUID REFERENCES organizers(id) ON DELETE CASCADE;
ALTER TABLE sms_segments ADD COLUMN IF NOT EXISTS organizer_id UUID REFERENCES organizers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS sms_campaigns_organizer_idx ON sms_campaigns (organizer_id, created_at DESC) WHERE organizer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_segments_organizer_idx ON sms_segments (organizer_id) WHERE organizer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_organizer_month_idx ON sms_messages (campaign_id, created_at) WHERE campaign_id IS NOT NULL;

-- An organizer's campaign relies on consent given TO that organizer, nothing else.
DO $$ BEGIN
  ALTER TABLE sms_campaigns ADD CONSTRAINT sms_campaign_organizer_scope
    CHECK (organizer_id IS NULL OR consent_scope = organizer_id::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Messages an organizer's campaigns queued this calendar month (UTC), for the cap.
CREATE OR REPLACE FUNCTION sms_organizer_month_usage(p_organizer UUID)
RETURNS INT AS $$
  SELECT count(*)::int FROM sms_messages m JOIN sms_campaigns c ON c.id = m.campaign_id
   WHERE c.organizer_id = p_organizer
     AND m.created_at >= date_trunc('month', now())
     AND m.status NOT IN ('cancelled', 'blocked');
$$ LANGUAGE sql STABLE;

-- How many of an organizer's buyers can be reached, by consent state.
CREATE OR REPLACE FUNCTION sms_organizer_consent_summary(p_organizer UUID)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'optedIn', count(*) FILTER (WHERE status = 'opted_in'),
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'optedOut', count(*) FILTER (WHERE status = 'opted_out'))
    FROM sms_consents WHERE scope = p_organizer::text AND kind = 'marketing';
$$ LANGUAGE sql STABLE;

-- ─── 3. Stored provider credentials (ciphertext only) ──────────────────────
CREATE TABLE IF NOT EXISTS sms_provider_credentials (
  provider_id   TEXT PRIMARY KEY REFERENCES sms_providers(id) ON DELETE CASCADE,
  ciphertext    TEXT NOT NULL,
  iv            TEXT NOT NULL,
  tag           TEXT NOT NULL,
  key_id        TEXT NOT NULL,
  fields        TEXT[] NOT NULL DEFAULT '{}',
  hints         JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_test     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Operational settings ──────────────────────────────────────────────────
-- Retention: message bodies and raw provider payloads are redacted after this
-- many days (NULL = keep; the owner decides). Rows, numbers and statuses stay
-- for analytics; consent evidence is never touched.
ALTER TABLE sms_settings ADD COLUMN IF NOT EXISTS message_retention_days INT;
DO $$ BEGIN
  ALTER TABLE sms_settings ADD CONSTRAINT sms_settings_retention CHECK (message_retention_days IS NULL OR message_retention_days BETWEEN 30 AND 3650);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- STOP confirmation, for providers that do not send one themselves (Twilio's
-- Advanced Opt-Out does; check each account). Empty = we send none.
ALTER TABLE sms_settings ADD COLUMN IF NOT EXISTS stop_confirmation_providers TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE sms_settings ADD COLUMN IF NOT EXISTS stop_confirmation_text TEXT NOT NULL
  DEFAULT 'Eventsli: You are unsubscribed and will receive no more texts. Reply START to resubscribe.';
DO $$ BEGIN
  ALTER TABLE sms_settings ADD CONSTRAINT sms_settings_stop_text CHECK (char_length(stop_confirmation_text) BETWEEN 10 AND 160);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 4. Verified-but-off is 'disabled' ─────────────────────────────────────
UPDATE sms_countries SET status = 'disabled' WHERE status = 'unverified' AND verified_at IS NOT NULL;

-- ─── Lock down ─────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sms_organizer_access', 'sms_provider_credentials'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION sms_organizer_month_usage(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sms_organizer_consent_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sms_organizer_month_usage(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION sms_organizer_consent_summary(UUID) TO service_role;
