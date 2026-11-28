const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const store = require('./vipStore');
const emails = require('./vipEmails');
const { deliver, shapeForEmail } = require('./vipWhatsApp');
const { publicView } = require('./vipSettings');
const { canSend } = require('../whatsapp/config');
const links = require('./vipLinks');
const {
  newReference, normalisePhone, waLink, openingMessage, generalOpening, BUDGETS, STATUS, OPEN_STATUSES,
} = require('./vipText');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services — the organizer's side (2026-11-28).
 *
 * Every function takes the caller's organizer id and reads only that
 * organizer's requests: a request of another organizer is "not found".
 * Refusals come back as `{ code, message }`; only our own failures throw.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const refuse = (code, message) => ({ code, message });
const safely = (label, p) => Promise.resolve(p).catch((err) => logger.error({ err: err.message }, `vip: ${label} failed`));

async function organizerRow(organizerId) {
  const { data } = await supabase.from('organizers').select('id, display_name, country').eq('id', organizerId).maybeSingle();
  return data || null;
}

/** What the "Start a request" page needs: the offer, their events, their details. */
async function options({ organizerId, user }) {
  const settings = await store.getSettings();
  const [{ data: events }, { data: profile }, organizer] = await Promise.all([
    supabase.from('events').select('id, title, starts_at, timezone, status')
      .eq('organizer_id', organizerId).not('status', 'in', '(cancelled,rejected)')
      .order('starts_at', { ascending: false }).limit(100),
    supabase.from('profiles').select('full_name, email, phone').eq('id', user.id).maybeSingle(),
    organizerRow(organizerId),
  ]);
  const view = publicView(settings);
  return {
    settings: view,
    chatUrl: waLink(view.whatsappNumber, generalOpening({ contactName: profile?.full_name, organization: organizer?.display_name })),
    events: (events || []).map((e) => ({ id: e.id, title: e.title, startsAt: store.iso(e.starts_at), timezone: e.timezone, status: e.status })),
    contact: {
      name: profile?.full_name || '',
      email: profile?.email || user.email || '',
      phone: normalisePhone(profile?.phone) || '',
    },
    budgets: Object.entries(BUDGETS).map(([value, label]) => ({ value, label })),
  };
}

/**
 * The public /vip page (2026-11-28): the same offer and form for any visitor.
 * No events to pick (they may have none), empty contact details unless they
 * are signed in, and a WhatsApp link with a general opening line.
 */
async function publicOptions({ user = null } = {}) {
  const settings = await store.getSettings();
  const { data: profile } = user
    ? await supabase.from('profiles').select('full_name, email, phone').eq('id', user.id).maybeSingle()
    : { data: null };
  const view = publicView(settings);
  return {
    settings: view,
    chatUrl: waLink(view.whatsappNumber, generalOpening({ contactName: profile?.full_name || null })),
    events: [],
    contact: {
      name: profile?.full_name || '',
      email: profile?.email || '',
      phone: normalisePhone(profile?.phone) || '',
    },
    // A signed-in organizer is pointed at their dashboard, where the request
    // can name one of their events.
    isOrganizer: Boolean(user?.access?.organizerId),
    budgets: Object.entries(BUDGETS).map(([value, label]) => ({ value, label })),
  };
}

function eventLabelOf(row, event) {
  return event?.title || row.event_name || null;
}

function chatUrlFor(settings, row, event) {
  return waLink(settings.whatsappNumber, openingMessage({
    reference: row.reference,
    contactName: row.contact_name,
    serviceTitles: (row.services || []).map((k) => settings.services.find((s) => s.key === k)?.title || k),
    eventLabel: eventLabelOf(row, event),
    eventDate: row.event_date,
  }));
}

/**
 * A new request. `organizerId` null: a VISITOR's, from the public /vip page
 * (2026-11-28) — no event of theirs to pick, the organization they typed,
 * and a signed link to follow it (`manageUrl`) instead of a dashboard.
 */
async function create({ organizerId = null, user = null, input, ipHash = null }) {
  const visitor = !organizerId;
  const settings = await store.getSettings();
  if (!settings.enabled) return refuse('FEATURE_DISABLED', 'VIP Services are not taking new requests just now. Email us instead.');

  const offered = new Set(settings.services.filter((s) => s.enabled).map((s) => s.key));
  const services = [...new Set(input.services || [])].filter((k) => offered.has(k));
  if (!services.length) return refuse('VALIDATION_ERROR', 'Choose at least one service.');

  let event = null;
  if (input.eventId && !visitor) {
    event = await store.eventRow(input.eventId);
    if (!event || event.organizer_id !== organizerId) return refuse('EVENT_NOT_FOUND', 'That event does not exist.');
  }
  const whatsapp = input.whatsappNumber ? normalisePhone(input.whatsappNumber) : null;
  if (input.whatsappNumber && !whatsapp) return refuse('VALIDATION_ERROR', 'Enter your WhatsApp number with its country code, like +1 619 555 0100.');
  const preferred = input.preferredChannel === 'email' || !whatsapp ? 'email' : 'whatsapp';
  const optIn = Boolean(whatsapp && input.whatsappOptIn === true);

  const now = new Date().toISOString();
  const base = {
    organizer_id: organizerId,
    source: visitor ? 'visitor' : 'organizer',
    requested_by: user?.id || null,
    company: visitor ? (input.company || '').trim().slice(0, 160) || null : null,
    ip_hash: ipHash,
    event_id: event?.id || null,
    services,
    event_name: event ? null : (input.eventName || '').trim() || null,
    event_date: input.eventDate || (event ? String(event.starts_at).slice(0, 10) : null),
    guest_count: input.guestCount ? Number(input.guestCount) : null,
    budget: input.budget && BUDGETS[input.budget] ? input.budget : null,
    details: String(input.details).trim(),
    contact_name: String(input.contactName).trim(),
    contact_email: String(input.contactEmail).trim().toLowerCase(),
    whatsapp_e164: whatsapp,
    whatsapp_opt_in: optIn,
    whatsapp_opt_in_at: optIn ? now : null,
    preferred_channel: preferred,
    last_organizer_message_at: now,
  };

  // A reference clash is one in ~900 million; try again rather than fail.
  let row = null;
  for (let i = 0; i < 5 && !row; i += 1) {
    const { data, error } = await supabase.from('vip_service_requests')
      .insert({ ...base, reference: newReference() }).select(store.REQUEST_COLS).single();
    if (!error) row = data;
    else if (error.code !== '23505') throw new Error(`vip request insert failed: ${error.message}`);
  }
  if (!row) throw new Error('vip request insert failed: no free reference');

  await store.insertMessage({
    request_id: row.id, direction: 'in', channel: 'system', author_kind: 'system',
    body: `Request sent: ${(row.services || []).map((k) => settings.services.find((s) => s.key === k)?.title || k).join(', ')}.`,
  });

  const organizer = visitor ? null : await organizerRow(organizerId);
  const serviceTitles = (row.services || []).map((k) => settings.services.find((s) => s.key === k)?.title || k);
  const eventLabel = eventLabelOf(row, event);
  const email = shapeForEmail(row);
  await safely('received email', emails.sendReceived({ request: email, settings, serviceTitles, eventLabel }));
  await safely('team email', store.teamRecipients(settings).then((to) => emails.sendToTeam({
    to, kind: 'new', request: email, serviceTitles, eventLabel,
    organization: organizer?.display_name || (row.company ? `${row.company} (visitor)` : 'Visitor, no account'),
  })));
  // They said yes to WhatsApp: the confirmation goes there too, as the
  // approved template (nobody has written yet, so the window is closed).
  if (optIn && preferred === 'whatsapp' && canSend()) {
    await safely('whatsapp confirmation', deliver(row, `${STATUS.new.notice} ${settings.responseTime || ''}`.trim(), {
      kind: 'notice', settings, emailFallback: async () => {}, recordEmail: false,
    }));
  }

  return {
    request: store.shapeRequest(row, { settings, event }),
    chatUrl: chatUrlFor(settings, row, event),
    ...(visitor ? { manageUrl: links.manageUrl(row.id), token: links.tokenFor(row.id) } : {}),
  };
}

async function list({ organizerId }) {
  const settings = await store.getSettings();
  const { data, error } = await supabase.from('vip_service_requests').select(store.REQUEST_COLS)
    .eq('organizer_id', organizerId).order('updated_at', { ascending: false }).limit(200);
  if (error) throw new Error(`vip list failed: ${error.message}`);
  const eventIds = [...new Set((data || []).map((r) => r.event_id).filter(Boolean))];
  const { data: events } = eventIds.length
    ? await supabase.from('events').select('id, title, slug, starts_at, timezone, status').in('id', eventIds)
    : { data: [] };
  const byId = new Map((events || []).map((e) => [e.id, e]));
  return { requests: (data || []).map((r) => store.shapeRequest(r, { settings, event: byId.get(r.event_id) })) };
}

async function ownRow(organizerId, id) {
  const row = await store.requestRow(id);
  return row && row.organizer_id === organizerId ? row : null;
}

/**
 * The request behind a call: an organizer's own (by organizer id), or a
 * visitor's (by the signed token in their link). Anything else is "not
 * found", the same answer whether or not the id exists.
 */
async function rowFor({ organizerId = null, token = null, id }) {
  if (organizerId) return ownRow(organizerId, id);
  if (!token || !links.tokenMatches(id, token)) return null;
  const row = await store.requestRow(id);
  return row && row.source === 'visitor' ? row : null;
}

async function get({ organizerId = null, token = null, id }) {
  const row = await rowFor({ organizerId, token, id });
  if (!row) return refuse('NOT_FOUND', 'That request does not exist.');
  const settings = await store.getSettings();
  const [event, rows, win] = await Promise.all([store.eventRow(row.event_id), store.messagesFor(row.id), store.windowFor(row.whatsapp_e164)]);
  const names = await store.authorNames(rows);
  await store.touchRequest(row.id, { organizer_seen_at: new Date().toISOString() }).catch(() => {});
  return {
    request: store.shapeRequest(row, { settings, event }),
    messages: rows.map((m) => store.shapeMessage(m, { names })),
    whatsapp: {
      teamNumber: settings.whatsappNumber,
      chatUrl: chatUrlFor(settings, row, event),
      replyUrl: waLink(settings.whatsappNumber, `About ${row.reference}: `),
      // They are chatting with us on WhatsApp now: replies land there.
      activeUntil: win.openUntil,
    },
    teamEmail: settings.email,
  };
}

async function message({ organizerId = null, token = null, user = null, id, text }) {
  const row = await rowFor({ organizerId, token, id });
  if (!row) return refuse('NOT_FOUND', 'That request does not exist.');
  if (row.status === 'cancelled') return refuse('VALIDATION_ERROR', 'This request is cancelled. Start a new one, or message us on WhatsApp.');
  const now = new Date().toISOString();
  const stored = await store.insertMessage({
    request_id: row.id, direction: 'in', channel: 'dashboard', author_kind: 'organizer', author_id: user?.id || null, body: text,
  });
  await store.touchRequest(row.id, { last_organizer_message_at: now, organizer_seen_at: now });
  const settings = await store.getSettings();
  await safely('team message email', store.teamRecipients(settings).then((to) => emails.sendToTeam({
    to, kind: 'message', request: shapeForEmail(row), text,
  })));
  return { message: store.shapeMessage(stored) };
}

async function updateContact({ organizerId = null, token = null, id, input }) {
  const row = await rowFor({ organizerId, token, id });
  if (!row) return refuse('NOT_FOUND', 'That request does not exist.');
  const patch = {};
  if (input.whatsappNumber !== undefined) {
    const e = input.whatsappNumber ? normalisePhone(input.whatsappNumber) : null;
    if (input.whatsappNumber && !e) return refuse('VALIDATION_ERROR', 'Enter your WhatsApp number with its country code, like +1 619 555 0100.');
    patch.whatsapp_e164 = e;
    if (!e) { patch.whatsapp_opt_in = false; patch.preferred_channel = 'email'; }
  }
  const number = patch.whatsapp_e164 !== undefined ? patch.whatsapp_e164 : row.whatsapp_e164;
  if (input.whatsappOptIn !== undefined && number) {
    patch.whatsapp_opt_in = input.whatsappOptIn === true;
    patch.whatsapp_opt_in_at = input.whatsappOptIn === true ? new Date().toISOString() : null;
  }
  if (input.preferredChannel !== undefined) patch.preferred_channel = input.preferredChannel === 'whatsapp' && number ? 'whatsapp' : 'email';
  await store.touchRequest(row.id, patch);
  return get({ organizerId, token, id });
}

async function cancel({ organizerId = null, token = null, id, reason }) {
  const row = await rowFor({ organizerId, token, id });
  if (!row) return refuse('NOT_FOUND', 'That request does not exist.');
  if (!OPEN_STATUSES.includes(row.status)) return refuse('VALIDATION_ERROR', 'This request is already closed.');
  const now = new Date().toISOString();
  await store.touchRequest(row.id, { status: 'cancelled', cancel_reason: reason || null, closed_at: now, last_organizer_message_at: now });
  await store.insertMessage({
    request_id: row.id, direction: 'in', channel: 'system', author_kind: 'system',
    body: `Cancelled by ${row.source === 'visitor' ? 'them' : 'the organizer'}${reason ? `: ${reason}` : '.'}`,
  });
  const settings = await store.getSettings();
  await safely('team cancel email', store.teamRecipients(settings).then((to) => emails.sendToTeam({
    to, kind: 'cancelled', request: shapeForEmail(row), text: reason || null,
  })));
  return get({ organizerId, token, id });
}

module.exports = { options, publicOptions, create, list, get, message, updateContact, cancel, ownRow, rowFor };
