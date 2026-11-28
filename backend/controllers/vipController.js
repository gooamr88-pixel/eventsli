const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const { writeAudit } = require('../services/auditService');
const { hashIp } = require('../utils/crypto');
const logger = require('../utils/logger');
const svc = require('../services/vip/vipService');
const admin = require('../services/vip/vipAdmin');
const store = require('../services/vip/vipStore');
const { config: waConfig } = require('../services/whatsapp/config');
const webhook = require('../services/whatsapp/webhook');
const { handleEvents } = require('../services/vip/vipWhatsApp');

/**
 * VIP Services (2026-11-28): the organizer's pages, the console and Meta's
 * WhatsApp webhook. Services answer `{ code, message }` for a refusal.
 */

function refuse(res, { code, message }) {
  return sendFail(res, { status: ERROR_STATUS[code] || 400, error: code, message: message || undefined });
}

const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); } catch (err) { return next(err); }
};

const organizerOf = (req) => req.user?.access?.organizerId || null;

function needOrganizer(req, res) {
  if (organizerOf(req)) return false;
  sendFail(res, { status: 403, error: 'ORGANIZER_SETUP_REQUIRED', message: 'Set up your organization first.' });
  return true;
}

// ── Organizer ────────────────────────────────────────────────────────────

const options = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  return sendOk(res, await svc.options({ organizerId: organizerOf(req), user: req.user }));
});

const create = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  const result = await svc.create({ organizerId: organizerOf(req), user: req.user, input: req.body });
  if (result.code) return refuse(res, result);
  return sendOk(res, result, { status: 201 });
});

const list = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  return sendOk(res, await svc.list({ organizerId: organizerOf(req) }));
});

const get = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  const result = await svc.get({ organizerId: organizerOf(req), id: req.params.id });
  if (result.code) return refuse(res, result);
  return sendOk(res, result);
});

const message = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  const result = await svc.message({ organizerId: organizerOf(req), user: req.user, id: req.params.id, text: req.body.text.trim() });
  if (result.code) return refuse(res, result);
  return sendOk(res, result, { status: 201 });
});

const updateContact = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  const result = await svc.updateContact({ organizerId: organizerOf(req), id: req.params.id, input: req.body });
  if (result.code) return refuse(res, result);
  return sendOk(res, result);
});

const cancel = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  const result = await svc.cancel({ organizerId: organizerOf(req), id: req.params.id, reason: (req.body.reason || '').trim() || null });
  if (result.code) return refuse(res, result);
  return sendOk(res, result);
});

/** A photo or file from the WhatsApp chat. Never rendered as a page. */
function sendMedia(res, file) {
  const inline = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/)/.test(file.mimeType);
  const name = (file.filename || `whatsapp-${file.type || 'file'}`).replace(/[^\w.\- ]/g, '_').slice(0, 120);
  res.set('Content-Type', inline ? file.mimeType : 'application/octet-stream');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.set('Cache-Control', 'private, max-age=600');
  return res.send(file.bytes);
}

const organizerMedia = wrap(async (req, res) => {
  if (needOrganizer(req, res)) return undefined;
  const file = await admin.media(req.params.messageId, { organizerId: organizerOf(req) });
  if (file.code) return refuse(res, file);
  return sendMedia(res, file);
});

// ── Visitors: the public /vip page (2026-11-28) ─────────────────────────
// No account. Their own routes carry the token from their link (t); a
// wrong token is "not found", the same as a wrong id.

const NOT_FOUND_LINK = { code: 'NOT_FOUND', message: 'This request link is not valid.' };

const publicOptions = wrap(async (req, res) => sendOk(res, await svc.publicOptions({ user: req.user || null })));

const publicCreate = wrap(async (req, res) => {
  // The hidden "website" field: people never see it, form-filling bots do.
  // They get a believable answer; nothing is stored or sent.
  if (req.body.website) return sendOk(res, { request: null, chatUrl: null, manageUrl: null }, { status: 201 });
  const result = await svc.create({ organizerId: null, user: req.user || null, input: req.body, ipHash: req.ip ? hashIp(req.ip) : null });
  if (result.code) return refuse(res, result);
  return sendOk(res, result, { status: 201 });
});

const tokenOf = (req) => (typeof req.query.t === 'string' ? req.query.t : req.body?.t);

const publicGet = wrap(async (req, res) => {
  const result = await svc.get({ token: tokenOf(req), id: req.params.id });
  if (result.code) return refuse(res, result.code === 'NOT_FOUND' ? NOT_FOUND_LINK : result);
  return sendOk(res, result);
});

const publicMessage = wrap(async (req, res) => {
  const result = await svc.message({ token: tokenOf(req), user: req.user || null, id: req.params.id, text: req.body.text.trim() });
  if (result.code) return refuse(res, result.code === 'NOT_FOUND' ? NOT_FOUND_LINK : result);
  return sendOk(res, result, { status: 201 });
});

const publicContact = wrap(async (req, res) => {
  const result = await svc.updateContact({ token: tokenOf(req), id: req.params.id, input: req.body });
  if (result.code) return refuse(res, result.code === 'NOT_FOUND' ? NOT_FOUND_LINK : result);
  return sendOk(res, result);
});

const publicCancel = wrap(async (req, res) => {
  const result = await svc.cancel({ token: tokenOf(req), id: req.params.id, reason: (req.body.reason || '').trim() || null });
  if (result.code) return refuse(res, result.code === 'NOT_FOUND' ? NOT_FOUND_LINK : result);
  return sendOk(res, result);
});

const publicMedia = wrap(async (req, res) => {
  const row = await svc.rowFor({ token: tokenOf(req), id: req.params.id });
  if (!row) return refuse(res, NOT_FOUND_LINK);
  const file = await admin.media(req.params.messageId, { requestId: row.id });
  if (file.code) return refuse(res, file);
  return sendMedia(res, file);
});

// ── Console ──────────────────────────────────────────────────────────────

const adminSettings = wrap(async (req, res) => sendOk(res, { settings: await store.getSettings() }));

const adminSaveSettings = wrap(async (req, res) => {
  const before = await store.getSettings();
  const settings = await store.saveSettings(req.body.settings, req.user.id);
  const changed = Object.keys(settings).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(before[k]));
  await writeAudit(req, { action: 'vip.settings_updated', targetType: 'platform_setting', targetId: null, payload: { changed } });
  return sendOk(res, { settings });
});

const adminConnection = wrap(async (req, res) => sendOk(res, await admin.connection()));

const adminList = wrap(async (req, res) => sendOk(res, await admin.list({
  view: admin.VIEWS.includes(req.query.view) ? req.query.view : 'open',
  q: req.query.q || '',
  page: Number(req.query.page) || 1,
})));

const adminHosts = wrap(async (req, res) => sendOk(res, { hosts: await admin.hosts() }));

const adminGet = wrap(async (req, res) => {
  const result = await admin.get(req.params.id);
  if (!result) return refuse(res, { code: 'NOT_FOUND', message: 'That request does not exist.' });
  return sendOk(res, result);
});

const adminUpdate = wrap(async (req, res) => {
  const { status, assignedTo, teamNotes, note, notify } = req.body;
  const result = await admin.update(req.params.id, { status, assignedTo, teamNotes, note: note?.trim() || null, notify: notify !== false }, { user: req.user });
  if (result.code) return refuse(res, result);
  await writeAudit(req, {
    action: 'vip.request_updated', targetType: 'vip_service_request', targetId: req.params.id,
    payload: {
      fields: Object.keys(req.body).filter((k) => !['notify', 'note'].includes(k)),
      ...(status !== undefined && status !== result.before.status ? { from: result.before.status, to: status } : {}),
    },
  });
  return sendOk(res, { request: result.request, delivery: result.delivery });
});

const adminReply = wrap(async (req, res) => {
  const result = await admin.reply(req.params.id, req.body.text.trim(), { user: req.user });
  if (result.code) return refuse(res, result);
  return sendOk(res, result, { status: 201 });
});

const adminUnmatched = wrap(async (req, res) => sendOk(res, await admin.unmatched()));

const adminLink = wrap(async (req, res) => {
  const result = await admin.link({ contact: req.body.contact, requestId: req.body.requestId, adopt: req.body.adopt === true });
  if (result.code) return refuse(res, result);
  await writeAudit(req, {
    action: 'vip.whatsapp_linked', targetType: 'vip_service_request', targetId: req.body.requestId,
    payload: { moved: result.moved, adopted: req.body.adopt === true },
  });
  return sendOk(res, result);
});

const adminReplyContact = wrap(async (req, res) => {
  const result = await admin.replyToContact({ contact: req.body.contact, text: req.body.text.trim() }, { user: req.user });
  if (result.code) return refuse(res, result);
  return sendOk(res, result, { status: 201 });
});

const adminDismiss = wrap(async (req, res) => {
  const result = await admin.dismiss({ contact: req.body.contact });
  if (result.code) return refuse(res, result);
  await writeAudit(req, { action: 'vip.whatsapp_dismissed', targetType: 'whatsapp_contact', targetId: null, payload: { removed: result.removed } });
  return sendOk(res, result);
});

const adminMedia = wrap(async (req, res) => {
  const file = await admin.media(req.params.messageId);
  if (file.code) return refuse(res, file);
  return sendMedia(res, file);
});

// ── Meta's webhook ───────────────────────────────────────────────────────

/** Meta's one-time check when the webhook URL is saved in the app dashboard. */
function webhookVerify(req, res) {
  const c = waConfig();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && c.verifyToken && typeof token === 'string' && token === c.verifyToken && typeof challenge === 'string') {
    return res.status(200).type('text/plain').send(challenge.slice(0, 200));
  }
  return res.sendStatus(403);
}

const webhookReceive = wrap(async (req, res) => {
  const c = waConfig();
  if (!c.appSecret) {
    logger.warn('WhatsApp webhook called but WHATSAPP_APP_SECRET is not set: refused.');
    return res.sendStatus(503);
  }
  if (!webhook.verifySignature(req.rawBody, req.get('x-hub-signature-256'), c.appSecret)) {
    logger.warn('WhatsApp webhook with a bad signature: refused.');
    return res.sendStatus(401);
  }
  const events = webhook.parse(req.body, { phoneNumberId: c.phoneNumberId || null });
  await handleEvents(events);
  return res.sendStatus(200);
});

module.exports = {
  options, create, list, get, message, updateContact, cancel, organizerMedia,
  publicOptions, publicCreate, publicGet, publicMessage, publicContact, publicCancel, publicMedia,
  adminSettings, adminSaveSettings, adminConnection, adminList, adminHosts, adminGet, adminUpdate, adminReply,
  adminUnmatched, adminLink, adminReplyContact, adminDismiss, adminMedia,
  webhookVerify, webhookReceive,
};
