const crypto = require('crypto');
const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Platform artwork: the hero, section images, sponsor logos, avatars.
 *
 * The same three-step shape as `mediaService` — sign, PUT, confirm — and for
 * the same reason, which is worth restating because it is the whole design:
 * the browser never holds a Supabase key, and the server never accepts a URL
 * somebody else chose. The server invents the object key, signs an upload for
 * exactly that key, and only writes a row once the object is confirmed to
 * exist.
 *
 * WHAT IS DIFFERENT HERE, and why this is not a parameter on the other file:
 *
 *   • A different bucket. `event-media` dies with its event; this outlives
 *     every event on the page. Sharing one bucket would also mean the
 *     organizer's upload path and the platform's are the same path, so a bug
 *     in the organizer's scoping could overwrite the homepage.
 *   • SVG is allowed. A sponsor's logo arrives as an SVG or it arrives as a
 *     blurry PNG. See the migration for what contains that.
 *   • The scope is a FOLDER, not an owner. Every caller here is already an
 *     admin, so `attach` is not an ownership check — it is a check that the
 *     object exists and is the size it claims. The prefix still matters: it
 *     keeps a hero image from being confirmed as a sponsor logo, which is how
 *     the cleanup of one deletes the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BUCKET = 'site-media';

/** Kept in step with the bucket's `allowed_mime_types` in the migration. */
const EXTENSION_FOR = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
});

/** 8 MB, matching the bucket's `file_size_limit`. Hero art is bigger than a
 *  card's cover, which is what the 5 MB on the other bucket was sized for. */
const MAX_BYTES = 8 * 1024 * 1024;

const UPLOAD_TTL_SECONDS = 600;

/**
 * The folders a caller may upload into.
 *
 * A closed list rather than a free string. `scope` arrives from the client, and
 * an unconstrained one is a path traversal waiting to happen — and even
 * sanitised, it would let a caller invent folders nothing ever cleans up.
 */
const SCOPES = Object.freeze(['hero', 'sections', 'sponsors', 'testimonials', 'categories', 'video']);

class SiteMediaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function storageUnavailable(err) {
  const text = String(err?.message || err || '').toLowerCase();
  return text.includes('bucket not found')
      || text.includes('does not exist')
      || text.includes('not found: bucket');
}

/**
 * The public prefix every URL in `site_content` must start with.
 *
 * `landingSchema.validateContent` takes this and refuses any image URL outside
 * it — see the note at the top of that file. Derived from the client rather
 * than assembled from the environment by hand, so it cannot disagree with where
 * the objects actually are.
 */
function publicPrefix() {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl('');
  // getPublicUrl('') returns the folder URL with a trailing slash on some
  // versions and without on others. Normalised, because this is compared with
  // `startsWith` and a missing slash would reject every legitimate URL.
  return String(data?.publicUrl || '').replace(/\/$/, '');
}

// ─── 1. Sign ────────────────────────────────────────────────────────────────
async function signUpload({ scope, contentType }) {
  if (!SCOPES.includes(scope)) {
    throw new SiteMediaError('VALIDATION_ERROR', `Not a place images go: ${scope}.`);
  }

  const ext = EXTENSION_FOR[contentType];
  if (!ext) {
    throw new SiteMediaError('UNSUPPORTED_MEDIA_TYPE', 'Upload a JPEG, PNG, WebP or SVG image.');
  }

  // Random, for the same cache reason as the event covers: reusing
  // `hero/background.jpg` means a replaced hero fights every CDN and browser
  // that already cached the old bytes at that exact URL.
  const path = `${scope}/${crypto.randomBytes(10).toString('hex')}.${ext}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { expiresIn: UPLOAD_TTL_SECONDS });

  if (error) {
    if (storageUnavailable(error)) {
      throw new SiteMediaError('STORAGE_NOT_CONFIGURED', 'Image uploads are not available on this deployment yet.');
    }
    throw new Error(error.message);
  }

  return {
    uploadUrl: data.signedUrl,
    path,
    expiresIn: UPLOAD_TTL_SECONDS,
    maxBytes: MAX_BYTES,
    method: 'PUT',
    contentType,
  };
}

// ─── 2. Confirm ─────────────────────────────────────────────────────────────
/**
 * Verifies the object landed, and returns the URL to save.
 *
 * Without this step a caller who skipped the PUT sets a hero image pointing at
 * a 404 — and the place that shows up is the top of the homepage.
 */
async function confirm({ scope, path }) {
  if (!SCOPES.includes(scope)) {
    throw new SiteMediaError('VALIDATION_ERROR', `Not a place images go: ${scope}.`);
  }
  const prefix = `${scope}/`;
  if (typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..')) {
    throw new SiteMediaError('VALIDATION_ERROR', 'That image was not uploaded here.');
  }

  const name = path.slice(prefix.length);
  const { data: found, error } = await supabase.storage
    .from(BUCKET)
    .list(scope, { search: name, limit: 1 });

  if (error) {
    if (storageUnavailable(error)) {
      throw new SiteMediaError('STORAGE_NOT_CONFIGURED', 'Image uploads are not available on this deployment yet.');
    }
    throw new Error(error.message);
  }

  const object = (found || []).find((o) => o.name === name);
  if (!object) throw new SiteMediaError('NOT_FOUND', 'That image was not uploaded. Try again.');

  const size = Number(object.metadata?.size ?? 0);
  if (size > MAX_BYTES) {
    await remove(path);
    throw new SiteMediaError('VALIDATION_ERROR', `That image is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, path };
}

// ─── 3. Remove ──────────────────────────────────────────────────────────────
/** Best-effort, for the same reason as the event covers: a failed delete leaves
 *  bytes in a bucket, while a delete that throws fails the request that was
 *  only trying to change a picture. */
async function remove(path) {
  if (!path) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

module.exports = {
  BUCKET, MAX_BYTES, SCOPES, EXTENSION_FOR, UPLOAD_TTL_SECONDS,
  SiteMediaError, signUpload, confirm, remove, publicPrefix,
};
