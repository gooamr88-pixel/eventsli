const { supabase } = require('../config/supabase');
const { BUCKET } = require('../services/mediaService');
const { cleanReveal } = require('../services/eventAccess');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /public/events/:slug/locked-cover — A PRIVATE EVENT'S COVER, BLURRED
 * (2026-11-22, the owner: "blur all details and images until it is unlocked").
 *
 * A blur done in the browser is a picture sent in full with a filter on top:
 * one "open image in new tab" undoes it. So the locked page never gets the
 * cover. It gets THIS — the cover shrunk to 24 pixels across, softened, and
 * re-encoded — which the page then stretches and blurs. Twenty-four pixels
 * carry the colours and the mood of the poster and none of its words, faces
 * or details.
 *
 * Served only for a published, private event whose organizer has NOT chosen
 * to show the cover (if they did, the page uses the real one). Read from
 * storage by its path, never by a URL. The image library (`sharp`) is a
 * declared backend dependency; it ships a native binary per platform, so if it
 * ever fails to load on a server this answers 404 and the page draws its own
 * artwork instead of failing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const WIDTH = 24;
const MAX_BYTES = 15 * 1024 * 1024;

async function show(req, res, next) {
  try {
    const notFound = () => res.status(404).set('Cache-Control', 'public, max-age=60').end();
    if (!sharp) return notFound();

    const { data: event, error } = await supabase
      .from('events')
      .select('id, status, is_private, cover_path, locked_reveal')
      .eq('slug', String(req.params.slug))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!event || event.status !== 'published' || !event.is_private || !event.cover_path) return notFound();
    if (cleanReveal(event.locked_reveal).includes('cover')) return notFound();

    const { data: file, error: fileError } = await supabase.storage.from(BUCKET).download(event.cover_path);
    if (fileError || !file) {
      logger.warn({ err: fileError?.message, eventId: event.id }, 'locked cover: the cover could not be read');
      return notFound();
    }
    const input = Buffer.from(await file.arrayBuffer());
    if (input.length > MAX_BYTES) return notFound();

    const out = await sharp(input, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: WIDTH, withoutEnlargement: false })
      .blur(1.2)
      .jpeg({ quality: 45 })
      .toBuffer();

    // The same tiny picture for everyone; it can change when the cover does.
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.end(out);
  } catch (err) { return next(err); }
}

module.exports = { show, WIDTH };
