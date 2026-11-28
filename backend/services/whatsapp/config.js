/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp Business Platform (Meta's Cloud API) — configuration (2026-11-28).
 *
 * Four values make it live, all from the Meta app that owns the WhatsApp
 * Business number (docs/WHATSAPP.md walks through where each one is):
 *
 *   WHATSAPP_ACCESS_TOKEN      a SYSTEM USER token with whatsapp_business_messaging
 *                              (a temporary 24-hour token works for a test, then stops)
 *   WHATSAPP_PHONE_NUMBER_ID   the id of the business number, NOT the number itself
 *   WHATSAPP_APP_SECRET        signs every webhook; without it nothing inbound is believed
 *   WHATSAPP_VERIFY_TOKEN      any long random string, typed again in Meta's webhook form
 *
 * Optional: WHATSAPP_GRAPH_VERSION (v23.0), WHATSAPP_TEMPLATE_UPDATE
 * (vip_request_update), WHATSAPP_TEMPLATE_LANGUAGE (en), and WHATSAPP_DRY_RUN
 * — "true" logs what would be sent and sends nothing.
 *
 * Without them the integration still works as click-to-chat (wa.me links with
 * the request's reference), the dashboard thread and email. Nothing pretends
 * to have sent a WhatsApp message it did not send.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const env = (k) => String(process.env[k] || '').trim();

function config() {
  return {
    token: env('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    appSecret: env('WHATSAPP_APP_SECRET'),
    verifyToken: env('WHATSAPP_VERIFY_TOKEN'),
    graphVersion: /^v\d{1,2}\.\d$/.test(env('WHATSAPP_GRAPH_VERSION')) ? env('WHATSAPP_GRAPH_VERSION') : 'v23.0',
    updateTemplate: env('WHATSAPP_TEMPLATE_UPDATE') || 'vip_request_update',
    templateLanguage: env('WHATSAPP_TEMPLATE_LANGUAGE') || 'en',
    dryRun: env('WHATSAPP_DRY_RUN') === 'true',
  };
}

/** Can we SEND through the API? (Click-to-chat needs none of this.) */
function canSend(c = config()) {
  return Boolean(c.token && c.phoneNumberId);
}

/** Can we RECEIVE? An unsigned webhook is never believed. */
function canReceive(c = config()) {
  return Boolean(c.appSecret && c.verifyToken);
}

/** For the console: what is set, never the values. */
function status(c = config()) {
  const missing = [];
  if (!c.token) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!c.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!c.appSecret) missing.push('WHATSAPP_APP_SECRET');
  if (!c.verifyToken) missing.push('WHATSAPP_VERIFY_TOKEN');
  const base = String(process.env.BACKEND_URL || '').replace(/\/+$/, '');
  return {
    sending: canSend(c),
    receiving: canReceive(c),
    dryRun: c.dryRun,
    missing,
    phoneNumberId: c.phoneNumberId || null,
    graphVersion: c.graphVersion,
    updateTemplate: c.updateTemplate,
    templateLanguage: c.templateLanguage,
    webhookUrl: base ? `${base}/api/v1/webhooks/whatsapp` : null,
  };
}

/** Boot-time warnings: half a configuration is worse than none. */
function bootWarnings(c = config()) {
  const out = [];
  const any = c.token || c.phoneNumberId || c.appSecret || c.verifyToken;
  if (!any) return out;
  if (!canSend(c)) out.push('WhatsApp: WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are both needed to send.');
  if (!canReceive(c)) out.push('WhatsApp: WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are both needed to receive; incoming messages are refused until then.');
  if (c.dryRun) out.push('WhatsApp: WHATSAPP_DRY_RUN is on; nothing is sent.');
  return out;
}

module.exports = { config, canSend, canReceive, status, bootWarnings };
