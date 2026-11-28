const crypto = require('node:crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Meta's WhatsApp webhooks: proving they are Meta's, and reading them (pure).
 *
 * SIGNATURE. Every POST carries `X-Hub-Signature-256: sha256=<hex>`, an
 * HMAC-SHA256 of the RAW body keyed with the app secret. It is checked
 * against the bytes as received (app.js keeps them for this path), never a
 * re-serialised copy, and in constant time.
 *
 * WHAT ARRIVES, flattened to one list of plain events:
 *
 *   message   someone wrote to the business number
 *   echo      the TEAM wrote from the WhatsApp Business app on the business
 *             phone (coexistence: field `smb_message_echoes`)
 *   status    sent / delivered / read / failed, for something we sent
 *
 * Only changes for OUR phone number id are read: one WhatsApp Business
 * account can hold several numbers, and another's traffic is not ours.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !rawBody || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Meta sends numbers as digits ("16195550100"); everything here keeps E.164. */
function toE164(digits) {
  const d = String(digits || '').replace(/[^0-9]/g, '');
  return d.length >= 7 && d.length <= 15 && d[0] !== '0' ? `+${d}` : null;
}

const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video', 'sticker']);

/** One WhatsApp message (inbound or echo) → `{ text, media }`. Never throws. */
function contentOf(msg) {
  const type = msg?.type;
  if (type === 'text') return { text: msg.text?.body || '', media: null };
  if (MEDIA_TYPES.has(type)) {
    const m = msg[type] || {};
    return {
      text: m.caption || null,
      media: {
        type,
        id: m.id ? String(m.id) : null,
        mimeType: m.mime_type || null,
        filename: m.filename ? String(m.filename).slice(0, 200) : null,
        voice: type === 'audio' ? Boolean(m.voice) : undefined,
      },
    };
  }
  if (type === 'location') {
    const l = msg.location || {};
    const where = [l.name, l.address].filter(Boolean).join(', ');
    const pin = Number.isFinite(l.latitude) && Number.isFinite(l.longitude)
      ? `https://maps.google.com/?q=${l.latitude},${l.longitude}` : '';
    return { text: [`📍 Location${where ? `: ${where}` : ''}`, pin].filter(Boolean).join('\n'), media: null };
  }
  if (type === 'contacts') {
    const names = (msg.contacts || []).map((c) => c?.name?.formatted_name).filter(Boolean);
    return { text: `👤 Contact card${names.length ? `: ${names.join(', ')}` : ''}`, media: null };
  }
  if (type === 'button') return { text: msg.button?.text || msg.button?.payload || '', media: null };
  if (type === 'interactive') {
    const r = msg.interactive?.button_reply || msg.interactive?.list_reply;
    return { text: r?.title || '', media: null };
  }
  if (type === 'reaction') {
    const emoji = msg.reaction?.emoji;
    return { text: emoji ? `Reacted ${emoji}` : null, media: null, reaction: true };
  }
  return { text: '(A message type WhatsApp could not show here. Open it in WhatsApp.)', media: null };
}

/**
 * The webhook body → `[{ kind, … }]`. `phoneNumberId`: ours; changes for any
 * other number are skipped. Malformed parts are skipped, not thrown on —
 * Meta retries a non-200 for days, and a body we cannot read never improves.
 */
function parse(payload, { phoneNumberId } = {}) {
  const out = [];
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = change?.value || {};
      const pid = v.metadata?.phone_number_id ? String(v.metadata.phone_number_id) : null;
      if (phoneNumberId && pid && pid !== String(phoneNumberId)) continue;

      if (change.field === 'messages') {
        const names = new Map((v.contacts || []).map((c) => [String(c?.wa_id || ''), c?.profile?.name || null]));
        for (const msg of Array.isArray(v.messages) ? v.messages : []) {
          const from = toE164(msg?.from);
          if (!from || !msg?.id) continue;
          const c = contentOf(msg);
          if (c.reaction && !c.text) continue;
          out.push({
            kind: 'message',
            waId: String(msg.id),
            from,
            name: names.get(String(msg.from)) || null,
            at: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
            type: msg.type,
            text: c.text ? String(c.text).slice(0, 4096) : null,
            media: c.media,
            replyTo: msg.context?.id ? String(msg.context.id) : null,
          });
        }
        for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
          if (!s?.id || !s?.status) continue;
          const err = Array.isArray(s.errors) && s.errors[0] ? s.errors[0] : null;
          out.push({
            kind: 'status',
            waId: String(s.id),
            status: String(s.status),
            to: toE164(s.recipient_id),
            error: err ? `${err.code || ''} ${err.title || err.message || ''}${err.error_data?.details ? ` — ${err.error_data.details}` : ''}`.trim().slice(0, 500) : null,
            errorCode: err?.code ?? null,
          });
        }
      } else if (change.field === 'smb_message_echoes') {
        for (const msg of Array.isArray(v.message_echoes) ? v.message_echoes : []) {
          const to = toE164(msg?.to);
          if (!to || !msg?.id) continue;
          const c = contentOf(msg);
          if (c.reaction && !c.text) continue;
          out.push({
            kind: 'echo',
            waId: String(msg.id),
            to,
            at: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
            type: msg.type,
            text: c.text ? String(c.text).slice(0, 4096) : null,
            media: c.media,
          });
        }
      }
    }
  }
  return out;
}

module.exports = { verifySignature, parse, toE164, contentOf };
