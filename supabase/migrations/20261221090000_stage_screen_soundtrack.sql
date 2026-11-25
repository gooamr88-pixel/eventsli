-- ─────────────────────────────────────────────────────────────────────────────
-- THE STAGE SCREEN'S SOUNDTRACK AND VIDEOS (2026-11-25).
--
-- The 3D seat map's stage screen is now a show, and its "Showtime" plays
-- music: Eventsli's own loops (generated in the browser, nothing stored) or a
-- track the organizer uploads. That track is the first audio file the
-- platform keeps, and it goes where every other event file goes — the
-- `event-media` bucket, under `events/<event id>/soundtrack-<hex>.mp3|m4a`,
-- signed and confirmed by services/mediaService.js like any image.
--
-- The screen also plays VIDEO slides: a clip the organizer uploads, under
-- `events/<event id>/clip-<hex>.mp4|webm`, played muted on the screen.
--
-- The bucket refused both: it allowed three image types and 5 MB. This adds
-- the two audio types every browser plays (MP3 as audio/mpeg, M4A as
-- audio/mp4) and the two video types (video/mp4, video/webm), and raises the
-- bucket's ceiling to 40 MB for a clip. EACH KIND KEEPS ITS OWN LIMIT:
-- mediaService.attach checks images at 5 MB, tracks at 8 MB and clips at
-- 40 MB, and deletes a file over its kind's limit; the bucket's number is
-- only the outer bound.
--
-- Nothing else changes, and nothing in the database depends on it: before
-- this runs, an organizer's track or video upload fails ("did not upload"),
-- Showtime plays Eventsli's own music, and photo slides work as before.
-- Safe to re-run: it sets the same two values every time.
--
-- Note for whoever re-runs 20260905090000 by hand: that file writes the
-- bucket's original three image types back. Run this one after it.
--
-- Guarded on the table, as 20260905090000 explains (CI runs without storage).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
       SET file_size_limit    = 41943040,                  -- 40 MB
           allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp',
                                      'audio/mpeg', 'audio/mp4', 'video/mp4', 'video/webm']
     WHERE id = 'event-media';
  END IF;
END $$;
