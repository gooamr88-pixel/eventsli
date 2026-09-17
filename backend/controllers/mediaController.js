const { supabase } = require('../config/supabase');
const media = require('../services/mediaService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const { shape } = require('./eventController');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The cover image, in three routes.
 *
 * Ownership is already settled — `verifyEventOwner` runs on every path under
 * `/events/:eventId` — so nothing here re-checks it. What these do check is
 * that the event is in a state where its artwork may change at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A MediaError carries a code; anything else is a real fault and goes to next(). */
function fail(res, err, next) {
  if (!err?.code || !(err.code in ERROR_STATUS)) return next(err);
  return sendFail(res, {
    status: ERROR_STATUS[err.code], error: err.code, message: err.message,
  });
}

/**
 * A cancelled event is a historical record and a completed one is over. Neither
 * is a draft, and the same rule already guards PATCH /events/:id — repeated here
 * because these routes write to the row without going through it.
 */
async function editableEvent(eventId) {
  const { data, error } = await supabase
    .from('events').select('id, status, cover_path, logo_path').eq('id', eventId).single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The two branded images an event carries, and the columns behind each.
 *
 * A table rather than two near-identical pairs of handlers. The cover and the
 * logo differ in exactly one thing — which pair of columns they write — and
 * everything else about them is the same three steps, the same state guard and
 * the same delete-after-write ordering. Two copies of that is two places to fix
 * the next time the ordering argument below turns out to matter.
 */
const IMAGE_SLOTS = Object.freeze({
  cover: { kind: 'cover', url: 'cover_url', path: 'cover_path', label: 'cover image' },
  logo: { kind: 'logo', url: 'logo_url', path: 'logo_path', label: 'logo' },
});

// ─── POST /events/:eventId/cover-upload ─────────────────────────────────────
/**
 * Step one: get a URL to PUT the bytes to.
 *
 * Returns no database change at all. An organizer who asks for an upload URL
 * and then closes the tab has changed nothing, which is the point of splitting
 * this from the write.
 */
async function requestUpload(req, res, next) {
  try {
    const event = await editableEvent(req.params.eventId);
    if (['cancelled', 'completed'].includes(event.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `A ${event.status} event cannot change its image.`,
      });
    }

    const signed = await media.signUpload({
      eventId: event.id,
      contentType: String(req.body.contentType || '').toLowerCase(),
      // The cover unless the caller says otherwise, so the existing
      // `/cover-upload` route keeps behaving exactly as it did.
      kind: IMAGE_SLOTS[req.body.slot]?.kind || 'cover',
    });
    return sendOk(res, signed);
  } catch (err) { return fail(res, err, next); }
}

// ─── PUT /events/:eventId/cover ─────────────────────────────────────────────
/**
 * Step two: confirm the bytes arrived, and make them the event's cover.
 *
 * The client sends back the `path` it was given, not a URL. A URL from a client
 * is a URL the platform would then serve inside an Open Graph tag on a public
 * page — a link we vouch for, pointing anywhere.
 */
async function setCover(req, res, next) {
  try {
    const event = await editableEvent(req.params.eventId);
    if (['cancelled', 'completed'].includes(event.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `A ${event.status} event cannot change its image.`,
      });
    }

    const { url, path } = await media.attach({
      eventId: event.id,
      path: req.body.path,
      previousPath: event.cover_path,
    });

    const { data, error } = await supabase
      .from('events')
      .update({ cover_url: url, cover_path: path, updated_at: new Date().toISOString() })
      .eq('id', event.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return sendOk(res, shape(data));
  } catch (err) { return fail(res, err, next); }
}

// ─── DELETE /events/:eventId/cover ──────────────────────────────────────────
/**
 * Both columns are cleared in one update. The CHECK constraint
 * `cover_url_and_path_together` refuses a row where one is set and the other is
 * not, so a partial clear is a constraint violation rather than a half-state
 * nobody notices until a delete finds nothing to delete.
 */
async function clearCover(req, res, next) {
  try {
    const event = await editableEvent(req.params.eventId);

    const { data, error } = await supabase
      .from('events')
      .update({ cover_url: null, cover_path: null, updated_at: new Date().toISOString() })
      .eq('id', event.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    // After the row, so a storage failure cannot leave the event pointing at an
    // image that is no longer there.
    if (event.cover_path) await media.remove(event.cover_path);

    return sendOk(res, shape(data));
  } catch (err) { return fail(res, err, next); }
}

/* ── The logo ─────────────────────────────────────────────────────────────
 *
 * Same three steps as the cover, against the other pair of columns. The two are
 * NOT interchangeable to a reader of the event page: the cover is the
 * photograph at the top, the logo is the mark that identifies whose event this
 * is — so an organizer setting one has not set the other, and neither stands in
 * for the missing one.
 */

async function setLogo(req, res, next) {
  try {
    const event = await editableEvent(req.params.eventId);
    if (['cancelled', 'completed'].includes(event.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT',
        message: `A ${event.status} event cannot change its image.`,
      });
    }

    const { url, path } = await media.attach({
      eventId: event.id,
      path: req.body.path,
      previousPath: event.logo_path,
    });

    const { data, error } = await supabase
      .from('events')
      .update({ logo_url: url, logo_path: path, updated_at: new Date().toISOString() })
      .eq('id', event.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return sendOk(res, shape(data));
  } catch (err) { return fail(res, err, next); }
}

async function clearLogo(req, res, next) {
  try {
    const event = await editableEvent(req.params.eventId);

    const { data, error } = await supabase
      .from('events')
      .update({ logo_url: null, logo_path: null, updated_at: new Date().toISOString() })
      .eq('id', event.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    // After the row, so a storage failure cannot leave the event pointing at an
    // image that is no longer there.
    if (event.logo_path) await media.remove(event.logo_path);

    return sendOk(res, shape(data));
  } catch (err) { return fail(res, err, next); }
}

module.exports = { requestUpload, setCover, clearCover, setLogo, clearLogo, IMAGE_SLOTS };
