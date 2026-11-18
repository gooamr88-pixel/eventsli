const templates = require('../services/eventTemplateService');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const { writeAudit } = require('../services/auditService');

/**
 * Event templates (2026-11-19) — see services/eventTemplateService.js.
 * Organizer routes are under /organizer/templates, the apply step under
 * /events/:eventId/apply-template, and the console under /admin/templates.
 */
const answer = (res, err, next) => (err.code
  ? sendFail(res, { status: ERROR_STATUS[err.code] || 400, error: err.code, message: err.message })
  : next(err));
const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); } catch (err) { return answer(res, err, next); }
};
const org = (req) => req.user.access.organizerId;

/* ── organizer ──────────────────────────────────────────────────────────── */

// GET /organizer/templates
const list = wrap(async (req, res) => sendOk(res, await templates.listForOrganizer(org(req))));

// GET /organizer/templates/:id
const get = wrap(async (req, res) => sendOk(res, await templates.getForOrganizer(org(req), req.params.id)));

// POST /organizer/templates  { eventId, name, description }
const create = wrap(async (req, res) => sendOk(res, await templates.createFromEvent({
  scope: 'organizer', organizerId: org(req), eventId: req.body.eventId,
  name: req.body.name, description: req.body.description, createdBy: req.user.id,
}), { status: 201 }));

// PATCH /organizer/templates/:id  { name, description }
const update = wrap(async (req, res) => sendOk(res, await templates.update(
  req.params.id, { name: req.body.name, description: req.body.description }, { organizerId: org(req) },
)));

// DELETE /organizer/templates/:id
const remove = wrap(async (req, res) => sendOk(res, await templates.remove(req.params.id, { organizerId: org(req) })));

// POST /organizer/templates/:id/copy  { name } — into the organizer's library
const copy = wrap(async (req, res) => sendOk(
  res, await templates.copyToOrganizer(org(req), req.params.id, req.body.name, req.user.id), { status: 201 },
));

// POST /events/:eventId/apply-template  { templateId }
const apply = wrap(async (req, res) => sendOk(res, await templates.applyToEvent({
  organizerId: org(req), eventId: req.params.eventId, templateId: req.body.templateId,
})));

/* ── admin console ──────────────────────────────────────────────────────── */

// GET /admin/templates?scope=platform|organizer&q=
const adminList = wrap(async (req, res) => sendOk(res, await templates.listForAdmin({
  scope: req.query.scope === 'organizer' ? 'organizer' : 'platform', q: req.query.q || '',
})));

// GET /admin/templates/:id
const adminGet = wrap(async (req, res) => sendOk(res, await templates.getAny(req.params.id)));

// POST /admin/templates  { eventId, name, description, category }
const adminCreate = wrap(async (req, res) => {
  const t = await templates.createFromEvent({
    scope: 'platform', eventId: req.body.eventId, name: req.body.name, description: req.body.description,
    category: req.body.category, createdBy: req.user.id,
  });
  await writeAudit(req, { action: 'template.created', targetType: 'event_template', targetId: t.id, payload: { eventId: req.body.eventId, name: t.name } });
  return sendOk(res, t, { status: 201 });
});

// POST /admin/templates/:id/promote — an organizer's template into Eventsli's library
const adminPromote = wrap(async (req, res) => {
  const t = await templates.promoteToPlatform(req.params.id, req.user.id);
  await writeAudit(req, { action: 'template.promoted', targetType: 'event_template', targetId: t.id, payload: { from: req.params.id } });
  return sendOk(res, t, { status: 201 });
});

// POST /admin/templates/:id/refresh — re-read from the event it came from
const adminRefresh = wrap(async (req, res) => {
  const t = await templates.refreshFromSource(req.params.id);
  await writeAudit(req, { action: 'template.refreshed', targetType: 'event_template', targetId: t.id });
  return sendOk(res, t);
});

// PATCH /admin/templates/:id
const adminUpdate = wrap(async (req, res) => {
  const t = await templates.update(req.params.id, req.body, { admin: true });
  await writeAudit(req, { action: 'template.updated', targetType: 'event_template', targetId: t.id, payload: req.body });
  return sendOk(res, t);
});

// DELETE /admin/templates/:id — Eventsli's, or an organizer's (moderation)
const adminRemove = wrap(async (req, res) => {
  const out = await templates.remove(req.params.id, { admin: true });
  await writeAudit(req, { action: 'template.deleted', targetType: 'event_template', targetId: req.params.id });
  return sendOk(res, out);
});

module.exports = {
  list, get, create, update, remove, copy, apply,
  adminList, adminGet, adminCreate, adminPromote, adminRefresh, adminUpdate, adminRemove,
};
