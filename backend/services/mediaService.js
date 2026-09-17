const crypto = require('crypto');
const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Event cover art.
 *
 * The whole design turns on one constraint from README: the browser never talks
 * to Supabase. That rules out the obvious upload — hand the client an anon key
 * and let it call `storage.upload()` — and it also rules out the lazy
 * alternative, letting the organizer PATCH a `coverUrl` of their choosing. A
 * client-supplied URL ends up inside an Open Graph tag on a public page, which
 * makes it a link the platform vouches for pointing anywhere at all.
 *
 * So the server owns the path and never accepts one:
 *
 *   1. `signUpload()` invents the object key, signs a one-time upload URL for
 *      exactly that key, and returns it. Nothing is written to the database.
 *   2. The browser PUTs the bytes straight to that URL. No Supabase client, no
 *      key, and the signature scopes it to the single path we chose.
 *   3. `attach()` confirms the object actually landed, then writes the row and
 *      deletes whatever the previous cover was.
 *
 * Step 3 is not ceremony. Without it a caller who skipped step 2 sets a
 * `cover_url` pointing at a 404, and the event page renders a broken image on
 * the most-shared URL on the platform.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BUCKET = 'event-media';

/** Kept in step with the bucket's `allowed_mime_types` in the migration. */
const EXTENSION_FOR = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

/** 5 MB, matching the bucket's `file_size_limit`. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The images an event can hold, and the only values that may reach a storage
 * key. All four share this module's bucket, prefix and ownership check rather
 * than growing a second upload path each — the prefix check in `attach` is the
 * thing that stops one organizer confirming another's object, and it is worth
 * having exactly one of.
 */
const KINDS = Object.freeze(['cover', 'logo', 'gallery', 'sponsor']);

/** The signed URL's lifetime. Long enough for a slow phone on hotel wifi. */
const UPLOAD_TTL_SECONDS = 600;

class MediaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Storage failures are one of two things and they need different answers: the
 * bucket is missing because nobody provisioned it (an operator problem, 503),
 * or the request was wrong (a caller problem, 4xx). Guessing wrong here means
 * an organizer is told to fix their file when the deployment is what is broken.
 */
function storageUnavailable(err) {
  const text = String(err?.message || err || '').toLowerCase();
  return text.includes('bucket not found')
      || text.includes('does not exist')
      || text.includes('not found: bucket');
}

// ─── 1. Sign ────────────────────────────────────────────────────────────────
/**
 * Mints an upload URL for one object key that this function chooses.
 *
 * The random suffix is not a security measure — the bucket is public — it is a
 * cache measure. Reusing `events/<id>/cover.jpg` means every replacement fights
 * whatever CDN, browser and social-network scraper has already cached the old
 * bytes under that exact URL, and an organizer who fixes a typo in their poster
 * watches the wrong one keep appearing in shares for days.
 */
async function signUpload({ eventId, contentType, kind = 'cover' }) {
  const ext = EXTENSION_FOR[contentType];
  if (!ext) {
    throw new MediaError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Upload a JPEG, PNG or WebP image.',
    );
  }

  /**
   * `kind` names the image, and is checked against a fixed list.
   *
   * It is interpolated into a storage key, so an unchecked value is a path the
   * caller writes — `../` out of the event's prefix, and the ownership check in
   * `attach` is built entirely on that prefix. The list is short because every
   * entry is a place in the product, not a parameter.
   */
  if (!KINDS.includes(kind)) {
    throw new MediaError('VALIDATION_ERROR', 'Unknown image type.');
  }

  const path = `events/${eventId}/${kind}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { expiresIn: UPLOAD_TTL_SECONDS });

  if (error) {
    if (storageUnavailable(error)) {
      throw new MediaError(
        'STORAGE_NOT_CONFIGURED',
        'Image uploads are not available on this deployment yet.',
      );
    }
    throw new Error(error.message);
  }

  return {
    uploadUrl: data.signedUrl,
    path,
    expiresIn: UPLOAD_TTL_SECONDS,
    maxBytes: MAX_BYTES,
    // PUT the file to `uploadUrl` with this Content-Type and no other headers.
    // The token is already inside the URL.
    method: 'PUT',
    contentType,
  };
}

// ─── 2. Confirm and attach ──────────────────────────────────────────────────
/**
 * Verifies the object exists under this event's prefix, then makes it current.
 *
 * The prefix check is the one that matters. `path` arrives from the client, and
 * without it a caller could confirm an object belonging to somebody else's
 * event — pointing their own listing at a competitor's artwork, or at a file
 * they had uploaded under an event they own and then deleted.
 */
async function attach({ eventId, path, previousPath }) {
  const prefix = `events/${eventId}/`;
  if (typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..')) {
    throw new MediaError('VALIDATION_ERROR', 'That image does not belong to this event.');
  }

  const name = path.slice(prefix.length);
  const { data: found, error } = await supabase.storage
    .from(BUCKET)
    .list(`events/${eventId}`, { search: name, limit: 1 });

  if (error) {
    if (storageUnavailable(error)) {
      throw new MediaError(
        'STORAGE_NOT_CONFIGURED',
        'Image uploads are not available on this deployment yet.',
      );
    }
    throw new Error(error.message);
  }

  const object = (found || []).find((o) => o.name === name);
  if (!object) {
    throw new MediaError(
      'NOT_FOUND',
      'That image was not uploaded. Try again.',
    );
  }

  // The bucket enforces its own size limit, so this is a second reading rather
  // than the only one — but the bucket's refusal happens during the PUT, which
  // this endpoint never sees. Checking here is what turns "the upload silently
  // did nothing" into a sentence.
  const size = Number(object.metadata?.size ?? 0);
  if (size > MAX_BYTES) {
    await remove(path);
    throw new MediaError(
      'VALIDATION_ERROR',
      `That image is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`,
    );
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // Deleted after the new one is confirmed, never before. The other order means
  // a failure between the two leaves the event with no cover at all — worse
  // than the orphan it avoids, and harder to notice.
  if (previousPath && previousPath !== path) await remove(previousPath);

  // `url`/`path`, not `coverUrl`/`coverPath`: four kinds of image go through
  // here now and only one of them is a cover. The cover's own caller maps these
  // onto its columns, which is where that naming belongs.
  return { url: pub.publicUrl, path };
}

// ─── 3. Remove ──────────────────────────────────────────────────────────────
/**
 * Best-effort. A failed delete leaves bytes in a bucket; a delete that throws
 * would fail the request that was only trying to change a cover, which is a
 * worse trade. Storage bills for the bytes and nothing else breaks.
 */
async function remove(path) {
  if (!path) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

module.exports = {
  BUCKET,
  MAX_BYTES,
  EXTENSION_FOR,
  KINDS,
  UPLOAD_TTL_SECONDS,
  MediaError,
  signUpload,
  attach,
  remove,
};
