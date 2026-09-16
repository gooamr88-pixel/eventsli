-- ═══════════════════════════════════════════════════════════════════════════
-- THE STOREFRONT, AS DATA.
--
-- The homepage was written as a source file: its headline, its three steps, its
-- four claims and its five questions all lived in `homeContent.js`, and the one
-- person who could change a word was whoever could open a pull request. That is
-- defensible for a page of prose about behaviour. It is not defensible for the
-- things a storefront actually needs to move — the hero image before a season,
-- a sponsor who signed on Tuesday, a testimonial, the rail of categories.
--
-- So the landing page gains a content layer, and this file is it. Five tables
-- and a bucket, each one built so the page degrades to a real empty state
-- rather than to a lie:
--
--   event_categories   the browse rail, promoted from an enum to a lookup
--   sponsors           logos, links, order, on/off
--   testimonials       a quote, an author, a rating, published or not
--   site_content       the singleton blocks (hero, video, stats) as JSONB
--   site_visits        the only honest way to answer "how many visits"
--
-- WHAT IS NOT HERE, deliberately: no `homepage_sections` table, no block
-- builder, no ordering of the sections themselves. The page's SHAPE is a design
-- decision made in JSX where it can be reviewed; its CONTENT is data. A CMS
-- that lets an operator reorder bands is a CMS that lets an operator break the
-- band rhythm the design system exists to protect.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── event_categories ──────────────────────────────────────────────────────
-- The enum becomes a table, and this is the only genuinely risky statement in
-- the file, so here is why it is worth it.
--
-- `event_category` was an enum because a TEXT column means "Music", "music" and
-- "MUSIC" are three categories. A lookup table with a foreign key keeps that
-- guarantee — an unknown value is refused by Postgres exactly as the enum
-- refused it — and buys the two things the enum could never give:
--
--   • An admin can CREATE one. `ALTER TYPE ... ADD VALUE` cannot run in the
--     same transaction that uses it, so with an enum a new category was always
--     two migrations and a deploy. It was never going to happen, which is the
--     same as saying the set was frozen.
--   • A category can carry a LABEL, a blurb, an image and an order. The
--     frontend was deriving "Food & drink" from `food_drink` with a lookup map
--     in `lib/categories.js`; that map is a copy of this table that no test
--     could compare against anything.
--
-- Safe here and now: one event exists, zero orders, and nothing else in the
-- schema references the type (checked against the live database, 2026-09-16).
CREATE TABLE event_categories (
  slug        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  blurb       TEXT,

  -- Same two-column rule as `events.cover_*`: the URL is what a client
  -- renders, the path is the object key kept so the old file can be deleted
  -- when a new one replaces it. Parsing the key back out of the URL works
  -- until the public prefix changes, and then every delete silently targets
  -- nothing.
  image_url   TEXT,
  image_path  TEXT,

  sort_order  INT     NOT NULL DEFAULT 0,
  is_enabled  BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The slug reaches the browse page as `/events?category=<slug>` and comes
  -- back as a filter value. Constrained to the shape the enum's labels had, so
  -- a category created through the admin console can never need escaping.
  CONSTRAINT category_slug_shape CHECK (slug ~ '^[a-z][a-z0-9_]{1,38}$'),
  CONSTRAINT category_label_present CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  CONSTRAINT category_image_url_and_path_together
    CHECK ((image_url IS NULL) = (image_path IS NULL))
);

-- Seeded from the enum, in the order the browse rail should read: what people
-- look for most, first. The order is spelled out rather than taken from the
-- array's position, because a display order is a decision and should be
-- visible as one.
INSERT INTO event_categories (slug, label, sort_order) VALUES
  ('music',      'Music',           10),
  ('festival',   'Festivals',       20),
  ('nightlife',  'Nightlife',       30),
  ('arts',       'Arts & theatre',  40),
  ('comedy',     'Comedy',          50),
  ('sports',     'Sports',          60),
  ('food_drink', 'Food & drink',    70),
  ('film',       'Film',            80),
  ('business',   'Business',        90),
  ('education',  'Workshops',      100),
  ('community',  'Community',      110),
  ('family',     'Family',         120),
  ('other',      'Everything else', 130);

-- The swap. USING is a plain cast: every existing value is one of the thirteen
-- above, so the foreign key added next validates without a single failure.
ALTER TABLE events ALTER COLUMN category DROP DEFAULT;
ALTER TABLE events ALTER COLUMN category TYPE TEXT USING category::text;
ALTER TABLE events ALTER COLUMN category SET DEFAULT 'other';

-- ON DELETE RESTRICT, not CASCADE and not SET DEFAULT.
--
-- Deleting a category that events are filed under is not a thing an operator
-- should be able to do by accident from a list with a bin icon on every row.
-- RESTRICT makes the database refuse it and the admin console explain why —
-- "14 events are in this category" — which is the answer the operator needed
-- before they clicked. Disabling is the reversible action, and it is one
-- checkbox away.
--
-- ON UPDATE CASCADE so a slug can be corrected without orphaning events.
ALTER TABLE events
  ADD CONSTRAINT events_category_fk
  FOREIGN KEY (category) REFERENCES event_categories(slug)
  ON UPDATE CASCADE ON DELETE RESTRICT;

DROP TYPE event_category;

-- ─── events.city ───────────────────────────────────────────────────────────
-- "Events near me" had nothing to stand on. The table carried `venue_name`,
-- `venue_address` and a two-letter `country`, so the finest location filter the
-- platform could offer was a country — which in a country the size of Canada
-- is not a filter at all.
--
-- A TEXT city rather than coordinates and PostGIS. The question a buyer asks on
-- a landing page is "what is on in Toronto", not "what is within 12km of me",
-- and a city name is a thing an organizer can type correctly while coordinates
-- are a thing they cannot. Geocoding can be added later against this column;
-- it cannot be added later against nothing.
--
-- Nullable: every event that exists today has no city, and a NOT NULL here
-- would mean inventing one for them.
ALTER TABLE events ADD COLUMN city TEXT;

ALTER TABLE events
  ADD CONSTRAINT event_city_shape
  CHECK (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 120);

-- Partial, on the only slice a public query ever reads, and ordered to match
-- the listing's sort so `?city=Toronto` is an index scan rather than a filter.
CREATE INDEX events_published_city ON events (city, starts_at) WHERE status = 'published';

-- ─── sponsors ──────────────────────────────────────────────────────────────
-- Empty on purpose, and it must stay empty until somebody with a signed
-- agreement fills it. A seeded row here would be a claim on the homepage that
-- a company endorses this platform, and a seed is exactly how such a claim
-- survives to production — nobody deletes placeholder data they did not notice.
CREATE TABLE sponsors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  logo_url    TEXT,
  logo_path   TEXT,
  link_url    TEXT,
  blurb       TEXT,
  sort_order  INT     NOT NULL DEFAULT 0,
  is_enabled  BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sponsor_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT sponsor_logo_url_and_path_together
    CHECK ((logo_url IS NULL) = (logo_path IS NULL)),
  -- The logo is an outbound link on the homepage: whatever is here, this site
  -- is vouching for. `javascript:` and `data:` are refused at the door rather
  -- than in a controller, because a rule in a controller is one code path away
  -- from not existing.
  CONSTRAINT sponsor_link_is_http
    CHECK (link_url IS NULL OR link_url ~* '^https?://[^[:space:]]{3,2000}$')
);

CREATE INDEX sponsors_display_idx ON sponsors (sort_order, created_at) WHERE is_enabled;

-- ─── testimonials ──────────────────────────────────────────────────────────
-- `is_published` defaults to FALSE, which is the opposite of every other
-- "enabled" flag in this file and is deliberate. A category or a sponsor is
-- created by the operator from nothing. A testimonial is a quotation ATTRIBUTED
-- TO A NAMED PERSON, and the failure mode — a half-typed draft appearing under
-- somebody's real name on the front page — is one the default should prevent
-- rather than one the operator should have to remember to prevent.
CREATE TABLE testimonials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name  TEXT NOT NULL,
  author_role  TEXT,
  body         TEXT NOT NULL,
  avatar_url   TEXT,
  avatar_path  TEXT,
  rating       INT,
  sort_order   INT     NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT testimonial_author_present CHECK (length(btrim(author_name)) BETWEEN 1 AND 120),
  CONSTRAINT testimonial_body_present   CHECK (length(btrim(body)) BETWEEN 1 AND 1200),
  -- Nullable rather than defaulted to 5. A testimonial with no rating renders
  -- without stars; one defaulted to 5 puts a five-star rating under a name that
  -- never gave one.
  CONSTRAINT testimonial_rating_range   CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT testimonial_avatar_url_and_path_together
    CHECK ((avatar_url IS NULL) = (avatar_path IS NULL))
);

CREATE INDEX testimonials_display_idx ON testimonials (sort_order, created_at) WHERE is_published;

-- ─── site_content ──────────────────────────────────────────────────────────
-- The blocks there is exactly one of: the hero, the video, the stats strip.
--
-- Key/JSONB rather than a column per field, and the reason is the same one that
-- shaped `platform_settings`: the alternative is a migration every time the
-- hero gains a second call to action. The shape of each key is validated in
-- `utils/landingSchema.js` — one place, testable without a database, refusing
-- unknown fields rather than storing them. A JSONB column with no schema beside
-- it is a bag of typos.
--
-- No rows are seeded. A missing key means "the code's default", which is what
-- `landingSchema.js` holds, so a fresh database renders the same page as a
-- configured one until somebody deliberately changes something.
CREATE TABLE site_content (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id),

  CONSTRAINT site_content_key_shape CHECK (key ~ '^[a-z][a-z0-9_]{1,38}$'),
  -- An array or a bare string here would pass `JSONB NOT NULL` and then break
  -- every reader that expects to spread an object.
  CONSTRAINT site_content_is_object CHECK (jsonb_typeof(value) = 'object')
);

-- ─── site_visits ───────────────────────────────────────────────────────────
-- "No fake hardcoded statistics" is a requirement the rest of this schema can
-- already meet — events, organizers and tickets are all countable. Visits were
-- the one number on the brief that nothing in the database could answer, and
-- the choice was to invent one or to start counting. This counts.
--
-- Two tables because views and visitors are different questions. `site_visits`
-- is a day/path counter, which is all a public number needs. `site_visit_marks`
-- is what makes "visitors" mean anything: one row per unique viewer per day,
-- inserted with ON CONFLICT DO NOTHING, so the second page view of a session
-- adds a view and not a visitor.
--
-- PRIVACY. `visitor_hash` is sha256(ip + user-agent + IP_HASH_SALT + the day).
-- It is not reversible to an address, it cannot be joined to any account, and
-- because the day is inside the hash the same visitor is a different value
-- tomorrow — so nothing here can be assembled into a history of one person.
-- The salt is already in the environment for the audit trail, which is the
-- same guarantee this reuses rather than a second scheme.
CREATE TABLE site_visits (
  day        DATE NOT NULL,
  path       TEXT NOT NULL,
  views      BIGINT NOT NULL DEFAULT 0,
  visitors   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path),
  CONSTRAINT site_visit_path_shape CHECK (length(path) BETWEEN 1 AND 200)
);

CREATE TABLE site_visit_marks (
  day          DATE NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);

-- One round trip, and atomic.
--
-- The obvious implementation — SELECT to see whether this visitor is known,
-- then UPDATE — is a read-modify-write across two tables on the hottest path on
-- the site, and it double-counts under concurrency. The insert's own row count
-- answers "is this a new visitor today" without a read.
--
-- Retention is here rather than in the scheduler. The delete is a range scan on
-- the primary key's leading column that matches nothing on almost every call,
-- and it only runs for a visitor seen for the first time today — so the cost is
-- an index probe on a fraction of requests. A table that only ever grows is a
-- table somebody ends up deleting by hand at 2am.
CREATE OR REPLACE FUNCTION record_site_visit(p_path TEXT, p_visitor_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_day    DATE := current_date;
  v_rows   INT;
  v_is_new BOOLEAN;
BEGIN
  INSERT INTO site_visit_marks (day, visitor_hash)
  VALUES (v_day, p_visitor_hash)
  ON CONFLICT (day, visitor_hash) DO NOTHING;

  -- GET DIAGNOSTICS yields an INTEGER. Assigning it straight to a BOOLEAN is a
  -- type error at runtime, not at creation, so it would have surfaced as a
  -- broken counter in production rather than as a failed migration.
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_is_new := v_rows > 0;

  INSERT INTO site_visits (day, path, views, visitors)
  VALUES (v_day, p_path, 1, CASE WHEN v_is_new THEN 1 ELSE 0 END)
  ON CONFLICT (day, path) DO UPDATE
    SET views    = site_visits.views + 1,
        visitors = site_visits.visitors + CASE WHEN v_is_new THEN 1 ELSE 0 END;

  IF v_is_new THEN
    DELETE FROM site_visit_marks WHERE day < v_day - 90;
  END IF;
END
$fn$;

-- ─── updated_at ────────────────────────────────────────────────────────────
-- Set by a trigger rather than by each UPDATE in the controllers. Four tables
-- times every write path is four places to forget, and a stale `updated_at` is
-- worse than none: it is a timestamp that looks authoritative and is wrong.
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

CREATE TRIGGER event_categories_touch BEFORE UPDATE ON event_categories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER sponsors_touch BEFORE UPDATE ON sponsors
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER testimonials_touch BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER site_content_touch BEFORE UPDATE ON site_content
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─── Privileges ────────────────────────────────────────────────────────────
-- Matching 20260914090000_lock_down_api_roles.sql, which closed the Data API to
-- `anon` and `authenticated` for every table that existed then. A table created
-- after it inherits nothing from it — so a new table is open again unless this
-- block is written, which is the whole reason that migration ended by warning
-- about exactly this.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'event_categories', 'sponsors', 'testimonials',
    'site_content', 'site_visits', 'site_visit_marks'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', r);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION record_site_visit(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_site_visit(TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION touch_updated_at() FROM PUBLIC, anon, authenticated;

-- ─── The bucket ────────────────────────────────────────────────────────────
-- Separate from `event-media`, not a folder inside it. Two reasons that both
-- bite later: the lifecycle is different (an event cover dies with its event, a
-- hero image outlives every event on the page), and a single bucket means the
-- signed-upload path for organizer content and the one for platform content are
-- the same path — so a bug in the organizer's upload scoping could overwrite
-- the homepage.
--
-- SVG is admitted here and nowhere else, because a sponsor's logo arrives as an
-- SVG or it arrives as a blurry PNG. That admits a real risk: an SVG can carry
-- script, and this bucket is public. It is contained by the frontend rendering
-- every sponsor logo through <img>, where SVG script does not execute — never
-- through <object>, <embed> or inline.
--
-- Guarded on the schema existing, because CI runs `supabase start` with storage
-- disabled and an unguarded INSERT fails the migration check there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'site-media',
      'site-media',
      true,
      8388608,                                   -- 8 MB: hero art is larger
                                                 -- than a card's cover
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
    )
    ON CONFLICT (id) DO UPDATE
      SET public             = EXCLUDED.public,
          file_size_limit    = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
