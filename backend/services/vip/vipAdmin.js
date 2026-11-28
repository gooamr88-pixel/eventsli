const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const wa = require('../whatsapp/cloudApi');
const waConfig = require('../whatsapp/config');
const store = require('./vipStore');
const links = require('./vipLinks');
const emails = require('./vipEmails');
const { deliver, shapeForEmail } = require('./vipWhatsApp');
const { decideChannel, waLink, STATUS, OPEN_STATUSES, normalisePhone } = require('./vipText');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services — the console (2026-11-28). Every admin runs requests (status,
 * assignee, notes, replies, the Unmatched inbox); the settings are a super
 * admin's (routes/admin/vipRoutes.js).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const VIEWS = ['open', 'new', 'closed', 'all'];
const PAGE = 25;
const refuse = (code, message) => ({ code, message });

function escapeLike(s) {
  return String(s).replace(/[\\%_,()]/g, (c) => `\\${c}`);
}

async function list({ view = 'open', q = '', page = 1 }) {
  const settings = await store.getSettings();
  let query = supabase.from('vip_service_requests').select(store.REQUEST_COLS, { count: 'exact' });
  if (view === 'open') query = query.in('status', OPEN_STATUSES);
  else if (view === 'new') query = query.eq('status', 'new');
  else if (view === 'closed') query = query.in('status', ['completed', 'cancelled']);
  const term = q.trim();
  if (term) {
    const t = escapeLike(term);
    query = query.or(`reference.ilike.%${t}%,contact_name.ilike.%${t}%,contact_email.ilike.%${t}%,event_name.ilike.%${t}%,company.ilike.%${t}%`);
  }
  const from = (page - 1) * PAGE;
  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, from + PAGE - 1);
  if (error) throw new Error(`vip admin list failed: ${error.message}`);

  const orgIds = [...new Set((data || []).map((r) => r.organizer_id).filter(Boolean))];
  const eventIds = [...new Set((data || []).map((r) => r.event_id).filter(Boolean))];
  const [{ data: orgs }, { data: events }, counts] = await Promise.all([
    orgIds.length ? supabase.from('organizers').select('id, display_name, country').in('id', orgIds) : { data: [] },
    eventIds.length ? supabase.from('events').select('id, title, slug, starts_at, timezone, status').in('id', eventIds) : { data: [] },
    countsNow(),
  ]);
  const org = new Map((orgs || []).map((o) => [o.id, o]));
  const ev = new Map((events || []).map((e) => [e.id, e]));
  return {
    requests: (data || []).map((r) => store.shapeRequest(r, { forTeam: true, settings, organizer: org.get(r.organizer_id), event: ev.get(r.event_id) })),
    counts,
    pagination: { page, pageSize: PAGE, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / PAGE)) },
  };
}

async function countsNow() {
  const head = (q) => q.then(({ count }) => count || 0);
  const base = () => supabase.from('vip_service_requests').select('id', { count: 'exact', head: true });
  const [fresh, open, inProgress, unmatched, waiting] = await Promise.all([
    head(base().eq('status', 'new')),
    head(base().in('status', OPEN_STATUSES)),
    head(base().in('status', ['confirmed', 'in_progress'])),
    supabase.from('vip_service_messages').select('wa_contact').is('request_id', null).eq('direction', 'in').limit(500)
      .then(({ data }) => new Set((data || []).map((m) => m.wa_contact)).size),
    // Open requests where the organizer wrote after the team last looked.
    supabase.from('vip_service_requests').select('last_organizer_message_at, team_seen_at').in('status', OPEN_STATUSES).limit(1000)
      .then(({ data }) => (data || []).filter((r) => r.last_organizer_message_at
        && (!r.team_seen_at || Date.parse(r.last_organizer_message_at) > Date.parse(r.team_seen_at))).length),
  ]);
  return { new: fresh, open, inProgress, unmatched, waiting };
}

async function hosts() {
  const { data } = await supabase.from('profiles').select('id, full_name, email')
    .in('role', ['admin', 'super_admin']).eq('is_blocked', false).order('full_name');
  return (data || []).map((p) => ({ id: p.id, name: p.full_name || p.email }));
}

async function get(id) {
  const row = await store.requestRow(id);
  if (!row) return null;
  const settings = await store.getSettings();
  const [event, rows, win, { data: organizer }] = await Promise.all([
    store.eventRow(row.event_id),
    store.messagesFor(row.id),
    store.windowFor(row.whatsapp_e164),
    row.organizer_id ? supabase.from('organizers').select('id, display_name, country').eq('id', row.organizer_id).maybeSingle() : { data: null },
  ]);
  const names = await store.authorNames(rows);
  const now = new Date().toISOString();
  await store.touchRequest(row.id, { team_seen_at: now }).catch(() => {});
  // Blue ticks: the newest WhatsApp message from them is read.
  const lastIn = [...rows].reverse().find((m) => m.direction === 'in' && m.channel === 'whatsapp' && m.wa_message_id);
  if (lastIn) wa.markRead(lastIn.wa_message_id).catch(() => {});

  const next = decideChannel({
    canSend: waConfig.canSend(),
    e164: row.whatsapp_e164,
    optIn: row.whatsapp_opt_in,
    preferred: row.preferred_channel,
    lastInboundAt: win.lastInboundAt,
  });
  return {
    request: store.shapeRequest(row, { forTeam: true, settings, event, organizer }),
    messages: rows.map((m) => store.shapeMessage(m, { names, forTeam: true })),
    delivery: { ...next, windowOpenUntil: win.openUntil, template: waConfig.config().updateTemplate },
    links: {
      chat: row.whatsapp_e164 ? waLink(row.whatsapp_e164) : null,
      organizerPage: row.source === 'visitor' ? null : `/organizer/vip/${row.id}`,
      // A visitor's private page, to copy for them if they lost the email.
      visitorPage: row.source === 'visitor' ? links.manageUrl(row.id) : null,
    },
  };
}

async function update(id, { status, assignedTo, teamNotes, note, notify = true }, { user }) {
  const row = await store.requestRow(id);
  if (!row) return refuse('NOT_FOUND', 'That request does not exist.');
  const patch = {};
  if (assignedTo !== undefined) patch.assigned_to = assignedTo || null;
  if (teamNotes !== undefined) patch.team_notes = teamNotes || null;
  const statusChanged = status !== undefined && status !== row.status;
  if (statusChanged) {
    patch.status = status;
    patch.closed_at = ['completed', 'cancelled'].includes(status) ? new Date().toISOString() : null;
    if (status === 'cancelled' && note) patch.cancel_reason = note.slice(0, 500);
  }
  if (Object.keys(patch).length) await store.touchRequest(row.id, patch);

  let delivery = null;
  if (statusChanged) {
    const s = STATUS[status];
    const text = `${s.notice}${note ? `\n\n${note}` : ''}`;
    await store.insertMessage({
      request_id: row.id, direction: 'out', channel: 'system', author_kind: 'system', author_id: user?.id || null,
      body: `Status: ${s.label}${note ? ` — ${note}` : ''}`,
    });
    if (notify) {
      const fresh = await store.requestRow(row.id);
      const settings = await store.getSettings();
      // The status email always goes (it is the record); WhatsApp as well
      // when that is how they are reached.
      await emails.sendStatus({ request: shapeForEmail(fresh), settings, note }).catch(() => {});
      delivery = await deliver(fresh, `${row.reference}: ${text}`, {
        kind: 'notice', settings, emailFallback: async () => {}, recordEmail: false,
      }).catch((err) => { logger.error({ err: err.message }, 'vip status delivery failed'); return null; });
      await store.touchRequest(row.id, { last_team_message_at: new Date().toISOString() });
    }
  }
  return { request: shapeAfter(await store.requestRow(row.id)), before: row, delivery };
}

const shapeAfter = (r) => store.shapeRequest(r, { forTeam: true });

async function reply(id, text, { user }) {
  const row = await store.requestRow(id);
  if (!row) return refuse('NOT_FOUND', 'That request does not exist.');
  const settings = await store.getSettings();
  const { data: me } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const result = await deliver(row, text, {
    kind: 'reply', authorId: user.id, authorName: (me?.full_name || '').split(/\s+/)[0] || null, settings,
  });
  const now = new Date().toISOString();
  await store.touchRequest(row.id, {
    last_team_message_at: now, team_seen_at: now,
    // Answering a new request moves it on: the team has picked it up.
    ...(row.status === 'new' ? { status: 'in_review' } : {}),
  });
  return { delivery: result };
}

// ── Unmatched WhatsApp inbox ─────────────────────────────────────────────

async function unmatched() {
  const { data, error } = await supabase.from('vip_service_messages').select(store.MESSAGE_COLS)
    .is('request_id', null).order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error(`vip unmatched read failed: ${error.message}`);
  const names = await store.authorNames(data || []);
  const groups = new Map();
  for (const m of data || []) {
    if (!m.wa_contact) continue;
    const g = groups.get(m.wa_contact) || { contact: m.wa_contact, name: null, lastAt: null, count: 0, messages: [] };
    if (!g.name && m.wa_contact_name) g.name = m.wa_contact_name;
    if (!g.lastAt) g.lastAt = store.iso(m.created_at);
    g.count += 1;
    g.messages.unshift(store.shapeMessage(m, { names, forTeam: true }));
    groups.set(m.wa_contact, g);
  }
  const contacts = [...groups.values()];
  await Promise.all(contacts.map(async (g) => {
    const win = await store.windowFor(g.contact);
    g.windowOpenUntil = win.openUntil;
    g.chat = waLink(g.contact);
  }));
  return { contacts, sending: waConfig.canSend() };
}

async function link({ contact, requestId, adopt }) {
  const e164 = normalisePhone(contact);
  const row = await store.requestRow(requestId);
  if (!e164 || !row) return refuse('NOT_FOUND', 'That request does not exist.');
  const { data, error } = await supabase.from('vip_service_messages').update({ request_id: row.id })
    .is('request_id', null).eq('wa_contact', e164).select('created_at, direction');
  if (error) throw new Error(`vip link failed: ${error.message}`);
  const lastIn = (data || []).filter((m) => m.direction === 'in').map((m) => m.created_at).sort().pop();
  await store.touchRequest(row.id, {
    ...(adopt ? { whatsapp_e164: e164 } : {}),
    ...(lastIn && (!row.last_organizer_message_at || lastIn > row.last_organizer_message_at) ? { last_organizer_message_at: lastIn } : {}),
  });
  return { moved: (data || []).length };
}

async function replyToContact({ contact, text }, { user }) {
  const e164 = normalisePhone(contact);
  if (!e164) return refuse('VALIDATION_ERROR', 'That number is not valid.');
  if (!waConfig.canSend()) return refuse('FEATURE_DISABLED', 'WhatsApp is not connected yet. Reply from the WhatsApp app on the business phone.');
  const win = await store.windowFor(e164);
  if (!win.openUntil) return refuse('VALIDATION_ERROR', 'More than 24 hours since they wrote: WhatsApp only lets a business reply inside that window. Link the chat to a request so the update template can be used.');
  const sent = await wa.sendText(e164, text);
  if (!sent.ok) return refuse('VALIDATION_ERROR', `WhatsApp refused it: ${sent.error}`);
  await store.insertMessage({
    request_id: null, direction: 'out', channel: 'whatsapp', author_kind: 'team', author_id: user.id,
    body: text, wa_message_id: sent.id, wa_contact: e164, wa_status: 'queued',
  });
  return { ok: true };
}

async function dismiss({ contact }) {
  const e164 = normalisePhone(contact);
  if (!e164) return refuse('VALIDATION_ERROR', 'That number is not valid.');
  const { data, error } = await supabase.from('vip_service_messages').delete()
    .is('request_id', null).eq('wa_contact', e164).select('id');
  if (error) throw new Error(`vip dismiss failed: ${error.message}`);
  return { removed: (data || []).length };
}

// ── Media ────────────────────────────────────────────────────────────────

/**
 * A WhatsApp photo or file, fetched from Meta for the page that shows it.
 * `organizerId`: an organizer may open files on their own requests only.
 */
async function media(messageId, { organizerId = null, requestId = null } = {}) {
  const { data: m } = await supabase.from('vip_service_messages').select('id, request_id, media').eq('id', messageId).maybeSingle();
  if (!m?.media?.id) return refuse('NOT_FOUND', 'That file does not exist.');
  // A visitor's link: files on that one request only.
  if (requestId && m.request_id !== requestId) return refuse('NOT_FOUND', 'That file does not exist.');
  if (organizerId) {
    if (!m.request_id) return refuse('NOT_FOUND', 'That file does not exist.');
    const row = await store.requestRow(m.request_id);
    if (!row || row.organizer_id !== organizerId) return refuse('NOT_FOUND', 'That file does not exist.');
  }
  const file = await wa.downloadMedia(m.media.id);
  if (!file.ok) return refuse('FEATURE_DISABLED', file.error);
  return { ...file, filename: m.media.filename || null, type: m.media.type };
}

async function connection() {
  const status = waConfig.status();
  if (!status.sending) return { ...status, check: null };
  const check = await wa.testConnection();
  return { ...status, check };
}

module.exports = {
  VIEWS, list, hosts, get, update, reply, unmatched, link, replyToContact, dismiss, media, connection,
};
