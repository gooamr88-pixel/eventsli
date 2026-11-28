-- ═══════════════════════════════════════════════════════════════════════════
-- VIP Services, with WhatsApp (owner, 2026-11-28).
--
-- An organizer asks the Eventsli team to run part of their event for them
-- (full setup, the seat map, marketing, the door team, VIP hospitality,
-- sponsors and vendors). The request, and every word said about it, lives
-- here, whichever channel it was said on:
--
--   dashboard   typed on the organizer's request page or in the console
--   whatsapp    sent or received through the WhatsApp Business Cloud API,
--               including what the team types in the WhatsApp Business app
--               on the business phone (Meta's "coexistence" echoes)
--   email       a notice sent by email when WhatsApp could not carry it
--   system      "Status changed to Confirmed" and the like
--
-- A WhatsApp message that cannot be tied to a request (an unknown number, no
-- reference) is kept with request_id NULL. It shows in the console's
-- "Unmatched" inbox, where the team links it to the right request.
--
-- The SETTINGS are not here: one JSON document in platform_settings under the
-- key 'vip_services' (backend/services/vip/vipSettings.js supplies every
-- default, so the feature works before anyone has saved anything).
--
-- SAFE TO RUN BEFORE OR AFTER THE CODE: nothing else reads these tables.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vip_service_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- "VIP-7KQ2MX": what the organizer quotes on WhatsApp, and what ties their
  -- first WhatsApp message to this request.
  reference             TEXT NOT NULL UNIQUE CHECK (reference ~ '^VIP-[0-9A-Z]{6}$'),
  -- NULL for a VISITOR's request from the public /vip page (2026-11-28,
  -- owner: "make this available for all visitors"): no account behind it;
  -- they follow it through a signed link (backend/services/vip/vipLinks.js).
  organizer_id          UUID REFERENCES organizers(id) ON DELETE CASCADE,
  source                TEXT NOT NULL DEFAULT 'organizer' CHECK (source IN ('organizer', 'visitor')),
  -- The organization a visitor names (an organizer's is their profile).
  company               TEXT CHECK (company IS NULL OR char_length(company) <= 160),
  -- Hashed, for rate limits and abuse review; never the address itself.
  ip_hash               TEXT CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 128),
  requested_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_id              UUID REFERENCES events(id) ON DELETE SET NULL,
  services              TEXT[] NOT NULL CHECK (cardinality(services) BETWEEN 1 AND 12),
  -- For an event not on Eventsli yet (or as the organizer calls it).
  event_name            TEXT CHECK (event_name IS NULL OR char_length(event_name) <= 160),
  event_date            DATE,
  guest_count           INT CHECK (guest_count IS NULL OR guest_count BETWEEN 1 AND 1000000),
  budget                TEXT CHECK (budget IS NULL OR char_length(budget) <= 40),
  details               TEXT NOT NULL CHECK (char_length(details) BETWEEN 1 AND 4000),
  contact_name          TEXT NOT NULL CHECK (char_length(contact_name) BETWEEN 1 AND 120),
  contact_email         TEXT NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254),
  -- E.164, "+16196666620". The number the team writes to on WhatsApp.
  whatsapp_e164         TEXT CHECK (whatsapp_e164 IS NULL OR whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- WhatsApp's rule: a business may START a conversation (a template message)
  -- only with someone who agreed to hear from it there. Replies inside the 24
  -- hours after they wrote need no opt-in.
  whatsapp_opt_in       BOOLEAN NOT NULL DEFAULT false,
  whatsapp_opt_in_at    TIMESTAMPTZ,
  preferred_channel     TEXT NOT NULL DEFAULT 'whatsapp' CHECK (preferred_channel IN ('whatsapp', 'email')),
  status                TEXT NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new', 'in_review', 'quoted', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  assigned_to           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  team_notes            TEXT CHECK (team_notes IS NULL OR char_length(team_notes) <= 8000),
  cancel_reason         TEXT CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 500),
  -- Who has seen what: a badge for each side while the other has written since.
  last_organizer_message_at TIMESTAMPTZ,
  last_team_message_at  TIMESTAMPTZ,
  organizer_seen_at     TIMESTAMPTZ,
  team_seen_at          TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vip_request_owner CHECK ((source = 'organizer') = (organizer_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS vip_requests_organizer_idx ON vip_service_requests (organizer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vip_requests_status_idx ON vip_service_requests (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS vip_requests_whatsapp_idx ON vip_service_requests (whatsapp_e164) WHERE whatsapp_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS vip_service_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID REFERENCES vip_service_requests(id) ON DELETE CASCADE,
  direction             TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  channel               TEXT NOT NULL CHECK (channel IN ('dashboard', 'whatsapp', 'email', 'system')),
  author_kind           TEXT NOT NULL CHECK (author_kind IN ('organizer', 'team', 'system')),
  author_id             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  body                  TEXT CHECK (body IS NULL OR char_length(body) <= 4096),
  -- A WhatsApp photo, document, voice note…: { type, id, mimeType, caption, filename }.
  -- The file stays with Meta; the console fetches it through the API.
  media                 JSONB CHECK (media IS NULL OR (jsonb_typeof(media) = 'object' AND pg_column_size(media) <= 4000)),
  -- The WhatsApp message id ("wamid.…"): one row per message however often
  -- Meta delivers the webhook, and the key its delivery receipts arrive under.
  wa_message_id         TEXT UNIQUE,
  -- The other party's number on WhatsApp (theirs, never ours), E.164.
  wa_contact            TEXT CHECK (wa_contact IS NULL OR wa_contact ~ '^\+[1-9][0-9]{6,14}$'),
  wa_contact_name       TEXT CHECK (wa_contact_name IS NULL OR char_length(wa_contact_name) <= 200),
  -- For what we send: queued → sent → delivered → read, or failed.
  wa_status             TEXT CHECK (wa_status IS NULL OR wa_status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  wa_error              TEXT CHECK (wa_error IS NULL OR char_length(wa_error) <= 500),
  -- Sent as the approved template because the 24-hour window was closed.
  wa_template           TEXT CHECK (wa_template IS NULL OR char_length(wa_template) <= 120),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vip_message_has_content CHECK (body IS NOT NULL OR media IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS vip_messages_request_idx ON vip_service_messages (request_id, created_at);
CREATE INDEX IF NOT EXISTS vip_messages_unmatched_idx ON vip_service_messages (created_at DESC) WHERE request_id IS NULL;
-- "When did this number last write to us?" — the 24-hour window.
CREATE INDEX IF NOT EXISTS vip_messages_contact_in_idx ON vip_service_messages (wa_contact, created_at DESC)
  WHERE direction = 'in' AND channel = 'whatsapp';

-- The API reads and writes these with the service role only.
ALTER TABLE vip_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vip_service_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vip_service_requests FROM anon, authenticated;
REVOKE ALL ON vip_service_messages FROM anon, authenticated;
