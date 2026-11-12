const logger = require('../utils/logger');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const providers = require('../services/sms/providers');
const receipts = require('../services/sms/receipts');
const consent = require('../services/sms/consent');
const auth = require('../services/sms/webhookAuth');
const { hashIp } = require('../utils/crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider webhooks and the public unsubscribe endpoint.
 *
 * AUTHENTICATED OR IGNORED. A status callback must carry our per-message token
 * (`?mid&t`, minted in webhookAuth) or a valid provider signature; an inbound
 * message must carry the provider signature (Twilio) or our inbound token plus
 * the signature when one is configured (Vonage). Anything else is answered 403
 * and changes nothing — a forged "STOP" must not unsubscribe a stranger, and
 * a forged "delivered" must not hide a failure.
 *
 * Answered fast and with 200 once authenticated, even when the work fails:
 * providers retry non-2xx for hours, and a receipt we cannot apply will not
 * apply better on the fortieth attempt. The failure is logged instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const paramsOf = (req) => ({ ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) });

/** The URL the provider signed: our public base + the path and query it called. */
function signedUrl(req) {
  const base = auth.webhookBase();
  return base ? `${base}${req.originalUrl}` : `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/** Twilio signs the POST body params only; the query string is part of the URL. */
const signedParams = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

function adapterFor(req, res) {
  const adapter = providers.ADAPTERS[req.params.provider];
  if (!adapter) {
    sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'Unknown provider.' });
    return null;
  }
  return adapter;
}

/** Credentials stored from the console are loaded with the SMS config; make sure they are before verifying. */
const ready = () => require('../services/sms/config').load().catch(() => null);

async function status(req, res) {
  const adapter = adapterFor(req, res);
  if (!adapter) return undefined;
  await ready();
  const all = paramsOf(req);
  const mid = typeof req.query.mid === 'string' ? req.query.mid : null;
  const tokenOk = mid && auth.verify(`status:${mid}`, req.query.t);
  // A provider signature counts only where the provider actually signs (Vonage:
  // when a signature secret is configured, in the environment or stored).
  const signatureOk = Boolean(adapter.signsWebhooks?.())
    && adapter.verifyWebhook({ url: signedUrl(req), params: signedParams(req), headers: req.headers, query: req.query });
  if (!tokenOk && !signatureOk) {
    logger.warn({ provider: adapter.id, ip: hashIp(req.ip) }, 'SMS status webhook refused: not authenticated');
    return sendFail(res, { status: 403, error: 'FORBIDDEN', message: 'Not authenticated.' });
  }
  // Twilio: the signature is checked too when present, so a leaked token alone is not enough.
  if (adapter.id === 'twilio' && req.headers['x-twilio-signature'] && !signatureOk) {
    return sendFail(res, { status: 403, error: 'FORBIDDEN', message: 'Bad signature.' });
  }
  try {
    await receipts.applyReceipt(adapter.id, adapter.parseStatus(all), { messageId: tokenOk ? mid : null, payload: all });
  } catch (err) {
    logger.error({ err: err.message, provider: adapter.id }, 'SMS receipt could not be applied');
  }
  return res.status(204).end();
}

async function inbound(req, res) {
  const adapter = adapterFor(req, res);
  if (!adapter) return undefined;
  await ready();
  const all = paramsOf(req);
  let ok;
  if (adapter.id === 'twilio') {
    ok = adapter.verifyWebhook({ url: signedUrl(req), params: signedParams(req), headers: req.headers });
  } else {
    ok = auth.verify(`inbound:${adapter.id}`, req.query.t) && adapter.verifyWebhook({ params: all, headers: req.headers });
  }
  if (!ok) {
    logger.warn({ provider: adapter.id, ip: hashIp(req.ip) }, 'SMS inbound webhook refused: not authenticated');
    return sendFail(res, { status: 403, error: 'FORBIDDEN', message: 'Not authenticated.' });
  }
  let reply = null;
  try {
    const handled = await receipts.handleInbound(adapter.id, adapter.parseInbound(all));
    reply = handled.reply;
    // Providers that cannot answer in the webhook response (Vonage) get the
    // reply as an ordinary message, keyed by the inbound so a retried webhook
    // does not answer twice.
    if (reply && !adapter.repliesInline && handled.from) {
      await require('../services/sms/queue').enqueue({
        category: 'participant', to: handled.from, body: reply,
        idempotencyKey: `reply:${adapter.id}:${handled.inboundId || Date.now()}`,
        metadata: { purpose: 'keyword_reply', consentExempt: 'keyword_reply' },
      });
      reply = null;
    }
  } catch (err) {
    logger.error({ err: err.message, provider: adapter.id }, 'SMS inbound could not be handled');
  }
  const out = adapter.inboundReply(reply);
  return res.status(200).type(out.contentType).send(out.body);
}

async function unsubscribe(req, res, next) {
  try {
    const result = await consent.unsubscribeByToken(String(req.body?.token || ''), { ipHash: hashIp(req.ip) });
    if (!result.ok) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'This unsubscribe link is not valid.' });
    }
    return sendOk(res, { unsubscribed: true, phone: result.masked });
  } catch (err) {
    return next(err);
  }
}

async function getPreferences(req, res, next) {
  try {
    return sendOk(res, await consent.preferencesFor(req.user.id));
  } catch (err) {
    return next(err);
  }
}

async function putPreferences(req, res, next) {
  try {
    const result = await consent.updatePreferences({
      userId: req.user.id,
      rawPhone: req.body.phone,
      transactional: req.body.transactional,
      marketing: req.body.marketing,
      organizers: Array.isArray(req.body.organizers) ? req.body.organizers : [],
      ipHash: req.ip ? hashIp(req.ip) : null,
    });
    if (result.error) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: result.error, meta: { details: [{ field: 'phone', message: result.error }] } });
    }
    return sendOk(res, { ...(await consent.preferencesFor(req.user.id)), confirmationSent: Boolean(result.confirmationSent) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { status, inbound, unsubscribe, getPreferences, putPreferences };
