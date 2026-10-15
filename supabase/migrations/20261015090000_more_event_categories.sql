-- ═══════════════════════════════════════════════════════════════════════════
-- More event categories — added, never changed.
--
-- The thirteen seeded on 2026-09-16 left out kinds of event people come to
-- Eventsli for: galas and banquets (the tables, cake table and gift table on the
-- map editor exist for them), dance, conferences, charity, culture, faith,
-- wellness, the outdoors, the holidays, fashion and tech. An organizer running
-- one had to file it under "Everything else", where nobody browsing will look.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   · rename or re-order an existing category — those are the admin's, edited
--     at /admin/content, and a migration that overwrote them would undo work;
--   · add anything that duplicates one that exists ("Theatre" is inside
--     "Arts & theatre", "Kids" inside "Family", "Networking" inside "Business");
--   · touch an event. Every new row is ON CONFLICT DO NOTHING, so this can run
--     twice, or after an admin has created one of these by hand, and change
--     nothing that is already there.
--
-- sort_order slots each in beside its neighbours and keeps "Everything else"
-- (130) last. Rollback: DELETE FROM event_categories WHERE slug IN (...) —
-- refused by the foreign key for any category an event already uses, which is
-- the correct refusal.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO event_categories (slug, label, blurb, sort_order) VALUES
  ('holiday',    'Holidays & seasonal',   'New Year, Eid, Diwali, Christmas, Halloween and every season''s parties.', 25),
  ('gala',       'Galas & banquets',      'Dinners, award nights and formal evenings, table by table.',                32),
  ('dance',      'Dance',                 'Dance nights, socials and performances.',                                   42),
  ('outdoors',   'Outdoors',              'Walks, tours, races and events in the open air.',                           65),
  ('wellness',   'Health & wellness',     'Yoga, fitness, mindfulness and health talks.',                              75),
  ('fashion',    'Fashion & beauty',      'Shows, pop-ups and beauty events.',                                         85),
  ('conference', 'Conferences',           'Conferences, summits and trade shows.',                                     92),
  ('tech',       'Tech & gaming',         'Meetups, hackathons, launches and gaming tournaments.',                     95),
  ('charity',    'Charity & fundraisers', 'Fundraisers, benefits and good causes.',                                   112),
  ('culture',    'Culture & heritage',    'Cultural celebrations, heritage and community traditions.',               114),
  ('faith',      'Faith & spirituality',  'Services, retreats and spiritual gatherings.',                              116)
ON CONFLICT (slug) DO NOTHING;
