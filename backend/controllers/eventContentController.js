const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const content = require('../services/eventContentService');
const media = require('../services/mediaService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's content sections — gallery, sponsors, policies, schedule.
 *
 * Thin by design. Every handler below translates the API's camelCase into
 * columns, hands off to `eventContentService`, and translates back. The rules
 * live in the service; the route decided who is allowed in.
 *
 * WHAT THIS FILE IS CAREFUL ABOUT is exactly one thing: which fields a client
 * may write. Each section has an explicit mapping, so adding a column to one of
 * those tables does not silently become settable from the internet — the same
 * reasoning as `eventRules.ORGANIZER_EDITABLE`, applied to the four tables that
 * are not `events`.
 *
 * `logoUrl` and `url` are NOT in any of those mappings for gallery images or
 * sponsor logos, and that is the important omission. An image URL a client
 * chooses is an address this platform then renders on a public page and vouches
 * for. Hosted images arrive only through `mediaService`, which signs an upload
 * for a key the SERVER picked and confirms the object exists before any row
 * points at it. A video is the one exception and is handled where it is set.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function fail(res, err, next) {
  if (err instanceof content.ContentError || err instanceof media.MediaError) {
    return sendFail(res, {
      status: err.status || 400,
      error: err.code,
      message: err.message,
    });
  }
  return next(err);
}

/* ── Gallery and video ───────────────────────────────────────────────────── */

async function listMedia(req, res, next) {
  try {
    return sendOk(res, await content.list('media', req.params.eventId));
  } catch (err) { return fail(res, err, next); }
}

/**
 * Adds a gallery image that has already been uploaded, or a video link.
 *
 * TWO SHAPES, ONE ENDPOINT, because to the organizer it is one list. An image
 * arrives as the `path` the upload step returned and is confirmed to exist
 * before a row points at it; a video arrives as a `url`, because the file is on
 * somebody else's player and there is nothing of ours to confirm.
 *
 * The video URL is checked at the database (`media_url_is_http`) rather than
 * trusted here — `javascript:` and `data:` are refused by a constraint, which is
 * one code path away from being the only enforcement rather than one code path
 * away from not existing.
 */
async function addMedia(req, res, next) {
  try {
    const { eventId } = req.params;
    const kind = req.body.kind === 'video' ? 'video' : 'image';

    let row;
    if (kind === 'video') {
      row = { kind, url: String(req.body.url).trim(), path: null };
    } else {
      const { url, path } = await media.attach({ eventId, path: req.body.path });
      row = { kind, url, path };
    }

    if (req.body.caption) row.caption = String(req.body.caption).trim().slice(0, 200);

    return sendOk(res, await content.add('media', eventId, row));
  } catch (err) { return fail(res, err, next); }
}

async function updateMedia(req, res, next) {
  try {
    const patch = {};
    // `null` clears the caption; absent leaves it. Two different instructions,
    // and collapsing them means a caption can be set but never removed.
    if ('caption' in req.body) {
      patch.caption = req.body.caption === null ? null : String(req.body.caption).trim().slice(0, 200);
    }
    return sendOk(res, await content.update('media', req.params.eventId, req.params.itemId, patch));
  } catch (err) { return fail(res, err, next); }
}

async function removeMedia(req, res, next) {
  try {
    return sendOk(res, await content.remove('media', req.params.eventId, req.params.itemId));
  } catch (err) { return fail(res, err, next); }
}

/* ── Sponsors ────────────────────────────────────────────────────────────── */

async function listSponsors(req, res, next) {
  try {
    return sendOk(res, await content.list('sponsors', req.params.eventId));
  } catch (err) { return fail(res, err, next); }
}

async function addSponsor(req, res, next) {
  try {
    const { eventId } = req.params;
    const row = {
      name: String(req.body.name).trim(),
      level: req.body.level || 'partner',
      link_url: req.body.linkUrl ? String(req.body.linkUrl).trim() : null,
    };

    // A sponsor without a logo is a normal row — a name and a link is a
    // perfectly good listing, and demanding artwork would block the organizer
    // who has not been sent any yet.
    if (req.body.path) {
      const { url, path } = await media.attach({ eventId, path: req.body.path });
      row.logo_url = url;
      row.logo_path = path;
    }

    return sendOk(res, await content.add('sponsors', eventId, row));
  } catch (err) { return fail(res, err, next); }
}

async function updateSponsor(req, res, next) {
  try {
    const { eventId, itemId } = req.params;
    const patch = {};
    if ('name' in req.body) patch.name = String(req.body.name).trim();
    if ('level' in req.body) patch.level = req.body.level;
    if ('linkUrl' in req.body) {
      patch.link_url = req.body.linkUrl ? String(req.body.linkUrl).trim() : null;
    }

    if (req.body.path) {
      const { url, path } = await media.attach({ eventId, path: req.body.path });
      patch.logo_url = url;
      patch.logo_path = path;
    }

    return sendOk(res, await content.update('sponsors', eventId, itemId, patch));
  } catch (err) { return fail(res, err, next); }
}

async function removeSponsor(req, res, next) {
  try {
    return sendOk(res, await content.remove('sponsors', req.params.eventId, req.params.itemId));
  } catch (err) { return fail(res, err, next); }
}

/* ── Policies ────────────────────────────────────────────────────────────── */

async function listPolicies(req, res, next) {
  try {
    return sendOk(res, await content.list('policies', req.params.eventId));
  } catch (err) { return fail(res, err, next); }
}

async function addPolicy(req, res, next) {
  try {
    return sendOk(res, await content.add('policies', req.params.eventId, {
      kind: req.body.kind || 'other',
      title: String(req.body.title).trim(),
      body: String(req.body.body).trim(),
      show_at_checkout: Boolean(req.body.showAtCheckout),
    }));
  } catch (err) { return fail(res, err, next); }
}

async function updatePolicy(req, res, next) {
  try {
    const patch = {};
    if ('kind' in req.body) patch.kind = req.body.kind;
    if ('title' in req.body) patch.title = String(req.body.title).trim();
    if ('body' in req.body) patch.body = String(req.body.body).trim();
    if ('showAtCheckout' in req.body) patch.show_at_checkout = Boolean(req.body.showAtCheckout);
    return sendOk(res, await content.update('policies', req.params.eventId, req.params.itemId, patch));
  } catch (err) { return fail(res, err, next); }
}

async function removePolicy(req, res, next) {
  try {
    return sendOk(res, await content.remove('policies', req.params.eventId, req.params.itemId));
  } catch (err) { return fail(res, err, next); }
}

/* ── Schedule ────────────────────────────────────────────────────────────── */

async function listSchedule(req, res, next) {
  try {
    return sendOk(res, await content.list('schedule', req.params.eventId));
  } catch (err) { return fail(res, err, next); }
}

async function addScheduleItem(req, res, next) {
  try {
    return sendOk(res, await content.add('schedule', req.params.eventId, scheduleRow(req.body)));
  } catch (err) { return fail(res, err, next); }
}

async function updateScheduleItem(req, res, next) {
  try {
    const patch = scheduleRow(req.body, { partial: true });
    return sendOk(res, await content.update('schedule', req.params.eventId, req.params.itemId, patch));
  } catch (err) { return fail(res, err, next); }
}

async function removeScheduleItem(req, res, next) {
  try {
    return sendOk(res, await content.remove('schedule', req.params.eventId, req.params.itemId));
  } catch (err) { return fail(res, err, next); }
}

/**
 * A schedule row from the API's shape.
 *
 * Times are nullable on purpose. An organizer sketching a running order knows
 * the ORDER before they know the clock — "doors, support, headliner" — and a
 * form that demands a timestamp for each turns a two-minute draft into a
 * guess they then have to remember to correct.
 */
const SCHEDULE_FIELDS = Object.freeze({
  title: ['title', (v) => String(v).trim()],
  description: ['description', (v) => (v ? String(v).trim() : null)],
  location: ['location', (v) => (v ? String(v).trim() : null)],
  startsAt: ['starts_at', (v) => v || null],
  endsAt: ['ends_at', (v) => v || null],
});

function scheduleRow(body, { partial = false } = {}) {
  const row = {};
  for (const [field, [column, clean]] of Object.entries(SCHEDULE_FIELDS)) {
    // On a PATCH only what was sent is touched, so clearing a field and leaving
    // it alone stay two different instructions. On a create, an absent optional
    // field becomes its explicit null rather than being left off the insert.
    if (partial && !(field in body)) continue;
    if (!partial && body[field] === undefined && field === 'title') continue;
    row[column] = clean(body[field]);
  }
  return row;
}

/* ── Reordering, shared by all four ──────────────────────────────────────── */

/**
 * One endpoint per section rather than one generic one taking the section name
 * in the body: the section is part of the route, so it is already validated by
 * the route, and a body-driven version would put an untrusted string into a
 * table lookup.
 */
function reorderFor(section) {
  return async function reorder(req, res, next) {
    try {
      return sendOk(res, await content.reorder(section, req.params.eventId, req.body.ids));
    } catch (err) { return fail(res, err, next); }
  };
}

/* ── Image uploads for gallery and sponsor logos ─────────────────────────── */

/**
 * Signs an upload, exactly as the cover's own endpoint does, for one of the
 * other image kinds. Shares `mediaService` rather than reimplementing it — the
 * prefix that scopes an object to this event is the ownership check, and it is
 * worth having exactly one of.
 */
async function requestUpload(req, res, next) {
  try {
    const { data: event, error } = await supabase
      .from('events').select('id, status').eq('id', req.params.eventId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'That event no longer exists.' });
    }

    return sendOk(res, await media.signUpload({
      eventId: event.id,
      contentType: req.body.contentType,
      kind: req.body.kind === 'sponsor' ? 'sponsor' : 'gallery',
    }));
  } catch (err) { return fail(res, err, next); }
}

/* ── The organizer's whole content bundle, for the editor ────────────────── */

async function bundle(req, res, next) {
  try {
    return sendOk(res, await content.publicBundle(req.params.eventId));
  } catch (err) { return fail(res, err, next); }
}

module.exports = {
  listMedia, addMedia, updateMedia, removeMedia, reorderMedia: reorderFor('media'),
  listSponsors, addSponsor, updateSponsor, removeSponsor, reorderSponsors: reorderFor('sponsors'),
  listPolicies, addPolicy, updatePolicy, removePolicy, reorderPolicies: reorderFor('policies'),
  listSchedule, addScheduleItem, updateScheduleItem, removeScheduleItem,
  reorderSchedule: reorderFor('schedule'),
  requestUpload,
  bundle,
};
