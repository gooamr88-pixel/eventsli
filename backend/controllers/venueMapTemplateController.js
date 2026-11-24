const maps = require('../services/venueMapTemplateService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const { writeAudit } = require('../services/auditService');

/**
 * The venue map library (2026-11-24) — see services/venueMapTemplateService.js.
 * Organizer routes are under /organizer/venue-maps, the console under
 * /admin/venue-maps (reads for every admin, writes for a super admin).
 */
const answer = (res, err, next) => (err.code
  ? sendFail(res, { status: ERROR_STATUS[err.code] || 400, error: err.code, message: err.message })
  : next(err));
const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); } catch (err) { return answer(res, err, next); }
};
const org = (req) => req.user.access.organizerId;

/* ── organizer ──────────────────────────────────────────────────────────── */

// GET /organizer/venue-maps?eventId=
const list = wrap(async (req, res) => sendOk(res, await maps.listForOrganizer(org(req), { eventId: req.query.eventId || null })));

// GET /organizer/venue-maps/:id
const get = wrap(async (req, res) => sendOk(res, await maps.getForOrganizer(org(req), req.params.id)));

// POST /organizer/venue-maps  { eventId, name, description, venueKind }
const create = wrap(async (req, res) => sendOk(res, await maps.saveFromEvent({
  organizerId: org(req), eventId: req.body.eventId, name: req.body.name, description: req.body.description,
  venueKind: req.body.venueKind, createdBy: req.user.id,
}), { status: 201 }));

// PATCH /organizer/venue-maps/:id  { name, description, venueKind }
const update = wrap(async (req, res) => sendOk(res, await maps.update(
  req.params.id,
  { name: req.body.name, description: req.body.description, venueKind: req.body.venueKind },
  { organizerId: org(req) },
)));

// DELETE /organizer/venue-maps/:id
const remove = wrap(async (req, res) => sendOk(res, await maps.remove(req.params.id, { organizerId: org(req) })));

// POST /organizer/venue-maps/:id/copy  { name }
const copy = wrap(async (req, res) => sendOk(
  res, await maps.copyToOrganizer(org(req), req.params.id, req.body.name, req.user.id), { status: 201 },
));

// POST /organizer/venue-maps/:id/used — put into a Venue Builder
const used = wrap(async (req, res) => sendOk(res, await maps.markUsed(org(req), req.params.id)));

/* ── admin console ──────────────────────────────────────────────────────── */

// GET /admin/venue-maps?scope=&q=&status=&kind=
const adminList = wrap(async (req, res) => sendOk(res, await maps.listForAdmin({
  scope: req.query.scope === 'organizer' ? 'organizer' : 'platform',
  q: req.query.q || '', status: req.query.status || null, kind: req.query.kind || null,
})));

// GET /admin/venue-maps/venue-events?placeId=&name=&city=
const adminVenueEvents = wrap(async (req, res) => sendOk(res, await maps.eventsAtVenue({
  placeId: req.query.placeId || null, name: req.query.name || null, city: req.query.city || null,
})));

// GET /admin/venue-maps/:id
const adminGet = wrap(async (req, res) => sendOk(res, await maps.getAny(req.params.id)));

// POST /admin/venue-maps  { venue, name, description, sourceNote, verified, eventId | data }
const adminCreate = wrap(async (req, res) => {
  const t = await maps.createPlatform({
    eventId: req.body.eventId || null, data: req.body.eventId ? null : req.body.data, venue: req.body.venue || {},
    name: req.body.name, description: req.body.description, sourceNote: req.body.sourceNote,
    verified: req.body.verified, createdBy: req.user.id,
  });
  await writeAudit(req, {
    action: 'venue_map.created', targetType: 'venue_map_template', targetId: t.id,
    payload: { venue: t.venue.name, name: t.name, source: t.source, eventId: req.body.eventId || null },
  });
  return sendOk(res, t, { status: 201 });
});

// PUT /admin/venue-maps/:id/map  { eventId | data }
const adminReplaceMap = wrap(async (req, res) => {
  const t = await maps.replaceMap(req.params.id, {
    eventId: req.body.eventId || null, data: req.body.eventId ? null : req.body.data, edited: req.body.edited === true,
  });
  await writeAudit(req, {
    action: 'venue_map.map_replaced', targetType: 'venue_map_template', targetId: t.id,
    payload: { source: t.source, eventId: req.body.eventId || null, edited: req.body.edited === true },
  });
  return sendOk(res, t);
});

// POST /admin/venue-maps/:id/promote — an organizer's map into Eventsli's library
const adminPromote = wrap(async (req, res) => {
  const t = await maps.promoteToPlatform(req.params.id, req.user.id);
  await writeAudit(req, { action: 'venue_map.promoted', targetType: 'venue_map_template', targetId: t.id, payload: { from: req.params.id } });
  return sendOk(res, t, { status: 201 });
});

// PATCH /admin/venue-maps/:id
const adminUpdate = wrap(async (req, res) => {
  const t = await maps.update(req.params.id, req.body, { admin: true });
  await writeAudit(req, { action: 'venue_map.updated', targetType: 'venue_map_template', targetId: t.id, payload: req.body });
  return sendOk(res, t);
});

// DELETE /admin/venue-maps/:id — Eventsli's, or an organizer's (moderation)
const adminRemove = wrap(async (req, res) => {
  const out = await maps.remove(req.params.id, { admin: true });
  await writeAudit(req, { action: 'venue_map.deleted', targetType: 'venue_map_template', targetId: req.params.id });
  return sendOk(res, out);
});

module.exports = {
  list, get, create, update, remove, copy, used,
  adminList, adminVenueEvents, adminGet, adminCreate, adminReplaceMap, adminPromote, adminUpdate, adminRemove,
};
