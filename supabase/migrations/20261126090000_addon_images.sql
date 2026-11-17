-- ═══════════════════════════════════════════════════════════════════════════
-- A picture for each ticket add-on (owner request 2026-11-17): the star the
-- photo is with, the poster that is signed — shown to the buyer at checkout.
--
-- The storage KEY is kept, not the URL: the URL is derived from it by the API
-- (mediaService.publicUrl), the same as an event cover, so a change of storage
-- host never leaves stale links in rows. The key must be this event's own
-- `addon-<16 hex>.<ext>` object; the API checks that before saving it.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE event_addons ADD COLUMN IF NOT EXISTS image_path TEXT;

ALTER TABLE event_addons DROP CONSTRAINT IF EXISTS event_addon_image_path_bounded;
ALTER TABLE event_addons ADD CONSTRAINT event_addon_image_path_bounded
  CHECK (image_path IS NULL OR length(image_path) <= 300);
