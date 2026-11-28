const logger = require('../../utils/logger');
const { config, canSend } = require('./config');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The WhatsApp Cloud API, the few calls we make (2026-11-28).
 *
 * Every send resolves `{ ok: true, id }` or `{ ok: false, code, error }` and
 * never throws: a message that could not go out is recorded as such and the
 * caller falls back to email. Codes worth knowing:
 *
 *   131047   more than 24 hours since they last wrote: only a template may go
 *   131026   the number cannot receive it (not on WhatsApp, old app…)
 *   132000+  the template's parameters do not match what Meta approved
 *   190      the access token has expired (a temporary token, most often)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TIMEOUT_MS = 15_000;
const base = (c) => `https://graph.facebook.com/${c.graphVersion}`;
const digits = (e164) => String(e164 || '').replace(/[^0-9]/g, '');

/** Template parameters may hold no newline, no tab and no run of 4+ spaces. */
function templateText(s, max = 900) {
  const flat = String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat || '-';
}

async function call(path, { method = 'POST', body } = {}) {
  const c = config();
  if (!canSend(c)) return { ok: false, code: 'NOT_CONFIGURED', error: 'WhatsApp is not connected.' };
  let res;
  try {
    res = await fetch(`${base(c)}/${path}`, {
      method,
      headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: `WhatsApp could not be reached (${err.name === 'TimeoutError' ? 'timed out' : err.message}).` };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    const details = e.error_data?.details ? ` — ${e.error_data.details}` : '';
    return { ok: false, code: e.code ?? res.status, error: `${e.message || `HTTP ${res.status}`}${details}`.slice(0, 480) };
  }
  return { ok: true, json };
}

async function send(to, message) {
  const c = config();
  const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(to), ...message };
  if (c.dryRun) {
    logger.info({ to: `…${digits(to).slice(-4)}`, type: message.type }, 'WhatsApp dry run: not sent');
    return { ok: true, id: `dryrun.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`, dryRun: true };
  }
  const r = await call(`${encodeURIComponent(c.phoneNumberId)}/messages`, { body });
  if (!r.ok) {
    logger.warn({ code: r.code, to: `…${digits(to).slice(-4)}` }, `WhatsApp send failed: ${r.error}`);
    return r;
  }
  const id = r.json.messages?.[0]?.id;
  return id ? { ok: true, id: String(id) } : { ok: false, code: 'NO_ID', error: 'WhatsApp accepted the request but returned no message id.' };
}

function sendText(to, text) {
  return send(to, { type: 'text', text: { preview_url: true, body: String(text).slice(0, 4096) } });
}

/** The approved template, its body parameters in order. */
function sendTemplate(to, params, { name, language } = {}) {
  const c = config();
  return send(to, {
    type: 'template',
    template: {
      name: name || c.updateTemplate,
      language: { code: language || c.templateLanguage },
      components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: templateText(p) })) }],
    },
  });
}

/** Blue ticks on their message: the team has read it. Best effort. */
async function markRead(waId) {
  const c = config();
  if (!canSend(c) || c.dryRun || !waId || String(waId).startsWith('dryrun.')) return { ok: false };
  return call(`${encodeURIComponent(c.phoneNumberId)}/messages`, {
    body: { messaging_product: 'whatsapp', status: 'read', message_id: String(waId) },
  });
}

/** The business number as Meta has it: for the console's "Test the connection". */
async function testConnection() {
  const c = config();
  const r = await call(`${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status`, { method: 'GET' });
  if (!r.ok) return r;
  return {
    ok: true,
    number: r.json.display_phone_number || null,
    name: r.json.verified_name || null,
    quality: r.json.quality_rating || null,
    nameStatus: r.json.name_status || null,
  };
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * A received file, fetched from Meta (its URL lasts minutes and needs our
 * token, so the browser can never be sent there). Resolves
 * `{ ok, mimeType, bytes }` — at most 25 MB.
 */
async function downloadMedia(mediaId) {
  const c = config();
  if (!canSend(c)) return { ok: false, code: 'NOT_CONFIGURED', error: 'WhatsApp is not connected.' };
  const info = await call(encodeURIComponent(String(mediaId)), { method: 'GET' });
  if (!info.ok) return info;
  if (Number(info.json.file_size) > MAX_MEDIA_BYTES) return { ok: false, code: 'TOO_LARGE', error: 'That file is too large to show here. Open it in WhatsApp.' };
  let url;
  try { url = new URL(info.json.url); } catch { return { ok: false, code: 'BAD_URL', error: 'WhatsApp returned no file address.' }; }
  // Meta's media host only: the token goes nowhere else.
  if (url.protocol !== 'https:' || !/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net)$/i.test(url.hostname)) {
    return { ok: false, code: 'BAD_URL', error: 'WhatsApp returned an unexpected file address.' };
  }
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!res.ok) return { ok: false, code: res.status, error: `The file could not be fetched (HTTP ${res.status}).` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_MEDIA_BYTES) return { ok: false, code: 'TOO_LARGE', error: 'That file is too large to show here.' };
    return { ok: true, mimeType: info.json.mime_type || res.headers.get('content-type') || 'application/octet-stream', bytes };
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: `The file could not be fetched (${err.message}).` };
  }
}

module.exports = { sendText, sendTemplate, markRead, testConnection, downloadMedia, templateText };
