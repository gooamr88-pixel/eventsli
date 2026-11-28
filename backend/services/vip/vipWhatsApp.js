const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const wa = require('../whatsapp/cloudApi');
const { canSend } = require('../whatsapp/config');
const store = require('./vipStore');
const emails = require('./vipEmails');
const { decideChannel, templateParams, referencesIn, OPEN_STATUSES } = require('./vipText');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services over WhatsApp (2026-11-28): sending to an organizer, and
 * everything that arrives on the webhook.
 *
 * OUTBOUND. `deliver` picks the channel (vipText.decideChannel), sends, and
 * records ONE message row saying how it went. A WhatsApp failure — at once,
 * or later on a "failed" receipt — falls back to email, once, and the row
 * says so. Nothing is recorded as sent on WhatsApp that Meta did not accept.
 *
 * INBOUND. A message is tied to a request by, in order:
 *   1. a reference it quotes ("VIP-7KQ2MX"), when the sender's number is the
 *      request's, or the request has no number yet (it is adopted);
 *   2. the sender's number: their most recent open request, else their most
 *      recent one closed in the last 60 days.
 * Anything else waits in the console's Unmatched inbox, where the team links
 * it. A reference quoted from a DIFFERENT number is not trusted on its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RECENT_CLOSED_MS = 60 * 86_400_000;
const TEAM_PING_GAP_MS = 30 * 60 * 1000;

/**
 * Send `text` to the organizer behind `row` (a request row). `kind`:
 *   'reply'    a team member wrote (author_id set) — one team message row
 *   'notice'   a status change or confirmation — stored on the system row
 *              `systemRowId` when given, else as its own system message
 * Resolves `{ via, ok, reason }`.
 */
async function deliver(row, text, {
  kind = 'reply', authorId = null, authorName = null, settings, emailFallback = null,
  // false: the caller has already emailed it (a status email), so an
  // email-only decision records nothing more. A WhatsApp REFUSAL is still
  // recorded, so the console shows why it did not arrive there.
  recordEmail = true,
} = {}) {
  const win = await store.windowFor(row.whatsapp_e164);
  const decision = decideChannel({
    canSend: canSend(),
    e164: row.whatsapp_e164,
    optIn: row.whatsapp_opt_in,
    preferred: row.preferred_channel,
    lastInboundAt: win.lastInboundAt,
  });
  const base = {
    request_id: row.id,
    direction: 'out',
    author_kind: kind === 'reply' ? 'team' : 'system',
    author_id: kind === 'reply' ? authorId : null,
    body: text,
  };

  let sent = null;
  if (decision.via !== 'email') {
    sent = decision.via === 'whatsapp_text'
      ? await wa.sendText(row.whatsapp_e164, text)
      : await wa.sendTemplate(row.whatsapp_e164, templateParams({ contactName: row.contact_name, reference: row.reference, text }));
  }

  const emailIt = () => (emailFallback
    ? emailFallback()
    : emails.sendTeamMessage({ request: shapeForEmail(row), settings, text, author: authorName }));

  if (sent?.ok) {
    await store.insertMessage({
      ...base,
      channel: 'whatsapp',
      wa_message_id: sent.id,
      wa_contact: row.whatsapp_e164,
      wa_status: 'queued',
      wa_template: decision.via === 'whatsapp_template' ? 'update' : null,
    });
    return { via: decision.via, ok: true, reason: decision.reason };
  }

  // Email: by decision, or because WhatsApp refused it just now.
  await emailIt();
  if (!sent && !recordEmail) return { via: 'email', ok: true, reason: decision.reason };
  await store.insertMessage({
    ...base,
    channel: 'email',
    wa_contact: sent ? row.whatsapp_e164 : null,
    wa_status: sent ? 'failed' : null,
    wa_error: sent ? `WhatsApp refused it (${sent.code}): ${sent.error}`.slice(0, 500) : null,
  });
  return {
    via: 'email',
    ok: true,
    reason: sent ? `WhatsApp refused it, so it was emailed instead: ${sent.error}` : decision.reason,
  };
}

/** The camelCase shape the email helpers read. */
function shapeForEmail(row) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    source: row.source || 'organizer',
    company: row.company || null,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    whatsappNumber: row.whatsapp_e164,
    whatsappOptIn: row.whatsapp_opt_in,
    preferredChannel: row.preferred_channel,
    details: row.details,
    eventDate: row.event_date,
    guestCount: row.guest_count,
    budget: row.budget,
  };
}

// ── Inbound ──────────────────────────────────────────────────────────────

async function requestByReference(reference) {
  const { data } = await supabase.from('vip_service_requests').select(store.REQUEST_COLS).eq('reference', reference).maybeSingle();
  return data || null;
}

/** → `{ row, adopt }` or `{ row: null, suggested }`. */
async function matchRequest(e164, text) {
  let suggested = null;
  for (const ref of referencesIn(text)) {
    const r = await requestByReference(ref);
    if (!r) continue;
    if (r.whatsapp_e164 === e164) return { row: r, adopt: false };
    if (!r.whatsapp_e164) return { row: r, adopt: true };
    suggested = suggested || r.id;
  }
  const { data: open } = await supabase.from('vip_service_requests').select(store.REQUEST_COLS)
    .eq('whatsapp_e164', e164).in('status', OPEN_STATUSES)
    .order('updated_at', { ascending: false }).limit(1);
  if (open?.[0]) return { row: open[0], adopt: false };
  const { data: closed } = await supabase.from('vip_service_requests').select(store.REQUEST_COLS)
    .eq('whatsapp_e164', e164).gte('updated_at', new Date(Date.now() - RECENT_CLOSED_MS).toISOString())
    .order('updated_at', { ascending: false }).limit(1);
  if (closed?.[0]) return { row: closed[0], adopt: false };
  return { row: null, suggested };
}

const STOP = /^\s*(stop|unsubscribe|stop all|opt out)\s*[.!]?\s*$/i;
const START = /^\s*(start|unstop|subscribe)\s*[.!]?\s*$/i;

/**
 * "STOP": no more updates on WhatsApp for this number, on every request,
 * answered once (they just wrote, so a reply is allowed). "START" undoes it.
 * Their message is still kept on the request like any other.
 */
async function optOutOrIn(ev) {
  const stop = STOP.test(ev.text || '');
  const start = !stop && START.test(ev.text || '');
  if (!stop && !start) return;
  await supabase.from('vip_service_requests')
    .update({ whatsapp_opt_in: start, whatsapp_opt_in_at: start ? new Date().toISOString() : null, preferred_channel: start ? 'whatsapp' : 'email' })
    .eq('whatsapp_e164', ev.from);
  const text = stop
    ? 'Done: Eventsli will not send you updates on WhatsApp any more. We will email you instead. Reply START to turn them back on.'
    : 'Done: Eventsli will send your request updates here on WhatsApp again. Reply STOP to turn them off.';
  const sent = await wa.sendText(ev.from, text);
  if (sent.ok) {
    await store.insertMessage({
      request_id: (await matchRequest(ev.from, '')).row?.id || null,
      direction: 'out', channel: 'whatsapp', author_kind: 'system', body: text,
      wa_message_id: sent.id, wa_contact: ev.from, wa_status: 'queued',
    }).catch(() => {});
  }
}

async function onMessage(ev) {
  const { row, adopt } = await matchRequest(ev.from, ev.text);
  const stored = await store.insertMessage({
    request_id: row?.id || null,
    direction: 'in',
    channel: 'whatsapp',
    author_kind: 'organizer',
    body: ev.text,
    media: ev.media,
    wa_message_id: ev.waId,
    wa_contact: ev.from,
    wa_contact_name: ev.name ? String(ev.name).slice(0, 200) : null,
    created_at: ev.at,
  });
  if (!stored) return;
  await optOutOrIn(ev);
  if (!row) return;

  // Writing to us on WhatsApp is consent to hear back THERE (the reply
  // window); it is not the template opt-in, which stays theirs to give.
  const previous = row.last_organizer_message_at;
  await store.touchRequest(row.id, {
    last_organizer_message_at: ev.at,
    ...(adopt ? { whatsapp_e164: ev.from } : {}),
  });

  // The team sees WhatsApp on the business phone; an email is only for the
  // first message after a quiet half hour, so a chat is not fifty emails.
  if (!previous || Date.now() - Date.parse(previous) > TEAM_PING_GAP_MS) {
    const settings = await store.getSettings();
    const to = await store.teamRecipients(settings);
    await emails.sendToTeam({
      to, kind: 'message', request: shapeForEmail({ ...row, whatsapp_e164: adopt ? ev.from : row.whatsapp_e164 }),
      text: ev.text || (ev.media ? `(${ev.media.type})` : ''),
    }).catch(() => {});
  }
}

/** The team wrote from the WhatsApp Business app on the business phone. */
async function onEcho(ev) {
  const { row } = await matchRequest(ev.to, '');
  const stored = await store.insertMessage({
    request_id: row?.id || null,
    direction: 'out',
    channel: 'whatsapp',
    author_kind: 'team',
    body: ev.text,
    media: ev.media,
    wa_message_id: ev.waId,
    wa_contact: ev.to,
    wa_status: 'sent',
    created_at: ev.at,
  });
  if (stored && row) await store.touchRequest(row.id, { last_team_message_at: ev.at });
}

const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };

async function onStatus(ev, { retry = true } = {}) {
  const { data: msg } = await supabase.from('vip_service_messages')
    .select(store.MESSAGE_COLS).eq('wa_message_id', ev.waId).maybeSingle();
  if (!msg) {
    // A receipt can beat our own insert by a moment; look once more.
    if (retry) {
      await new Promise((r) => { setTimeout(r, 1500); });
      return onStatus(ev, { retry: false });
    }
    return;
  }
  if (ev.status === 'failed') {
    if (msg.wa_status === 'failed') return;
    await supabase.from('vip_service_messages')
      .update({ wa_status: 'failed', wa_error: ev.error || 'WhatsApp could not deliver it.' }).eq('id', msg.id);
    // Undelivered on WhatsApp → the same words by email, once.
    if (msg.request_id && msg.direction === 'out' && msg.body) {
      const row = await store.requestRow(msg.request_id);
      if (row) {
        const settings = await store.getSettings();
        await emails.sendTeamMessage({ request: shapeForEmail(row), settings, text: msg.body }).catch(() => {});
        await supabase.from('vip_service_messages')
          .update({ wa_error: `${ev.error || 'WhatsApp could not deliver it.'} — sent by email instead.`.slice(0, 500) }).eq('id', msg.id);
      }
    }
    return;
  }
  if (!(ev.status in RANK)) return;
  // Receipts arrive out of order: never step back from "read" to "delivered".
  if (msg.wa_status === 'failed' || (RANK[msg.wa_status] ?? -1) >= RANK[ev.status]) return;
  await supabase.from('vip_service_messages').update({ wa_status: ev.status }).eq('id', msg.id);
}

/** Every event from one webhook body. One bad event never sinks the rest. */
async function handleEvents(events) {
  for (const ev of events) {
    try {
      if (ev.kind === 'message') await onMessage(ev);
      else if (ev.kind === 'echo') await onEcho(ev);
      else if (ev.kind === 'status') await onStatus(ev);
    } catch (err) {
      logger.error({ err: err.message, kind: ev.kind }, 'WhatsApp webhook event failed');
    }
  }
}

module.exports = { deliver, handleEvents, matchRequest, shapeForEmail };
