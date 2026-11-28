const { supabase } = require('../../config/supabase');
const { clean } = require('./vipSettings');
const { windowOpenUntil, BUDGETS, STATUS } = require('./vipText');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services — reads, shapes and the small writes everything else shares
 * (2026-11-28). The service-role client bypasses RLS, so every read that an
 * ORGANIZER triggers is scoped by organizer_id here or by the caller.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEY = 'vip_services';
const REQUEST_COLS = 'id, reference, organizer_id, source, company, requested_by, event_id, services, event_name, event_date, guest_count, budget, details, '
  + 'contact_name, contact_email, whatsapp_e164, whatsapp_opt_in, whatsapp_opt_in_at, preferred_channel, status, assigned_to, team_notes, '
  + 'cancel_reason, last_organizer_message_at, last_team_message_at, organizer_seen_at, team_seen_at, closed_at, created_at, updated_at';
const MESSAGE_COLS = 'id, request_id, direction, channel, author_kind, author_id, body, media, wa_message_id, wa_contact, wa_contact_name, '
  + 'wa_status, wa_error, wa_template, created_at';

const iso = (v) => (v ? new Date(v).toISOString() : null);
const after = (a, b) => Boolean(a) && (!b || Date.parse(a) > Date.parse(b));

async function getSettings() {
  const { data, error } = await supabase.from('platform_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) throw new Error(`vip settings read failed: ${error.message}`);
  return clean(data?.value);
}

async function saveSettings(input, userId = null) {
  const value = clean(input);
  const { error } = await supabase.from('platform_settings')
    .upsert({ key: KEY, value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`vip settings save failed: ${error.message}`);
  return value;
}

/** The request, as either side sees it. `forTeam` adds notes and the assignee. */
function shapeRequest(row, { forTeam = false, settings = null, event = null, organizer = null } = {}) {
  if (!row) return null;
  const titles = new Map((settings?.services || []).map((s) => [s.key, s.title]));
  const out = {
    id: row.id,
    reference: row.reference,
    status: row.status,
    // 'visitor': from the public /vip page, no account (2026-11-28).
    source: row.source || 'organizer',
    company: row.company || null,
    statusLabel: STATUS[row.status]?.label || row.status,
    services: row.services || [],
    serviceTitles: (row.services || []).map((k) => titles.get(k) || k),
    eventId: row.event_id,
    event: event ? { id: event.id, title: event.title, slug: event.slug, startsAt: iso(event.starts_at), timezone: event.timezone, status: event.status } : null,
    eventName: row.event_name,
    eventDate: row.event_date,
    guestCount: row.guest_count,
    budget: row.budget,
    budgetLabel: row.budget ? BUDGETS[row.budget] || row.budget : null,
    details: row.details,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    whatsappNumber: row.whatsapp_e164,
    whatsappOptIn: Boolean(row.whatsapp_opt_in),
    preferredChannel: row.preferred_channel,
    cancelReason: row.cancel_reason,
    lastOrganizerMessageAt: iso(row.last_organizer_message_at),
    lastTeamMessageAt: iso(row.last_team_message_at),
    closedAt: iso(row.closed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (forTeam) {
    out.unread = after(row.last_organizer_message_at, row.team_seen_at);
    out.assignedTo = row.assigned_to;
    out.teamNotes = row.team_notes;
    out.organizer = organizer ? { id: organizer.id, name: organizer.display_name, country: organizer.country } : null;
  } else {
    out.unread = after(row.last_team_message_at, row.organizer_seen_at);
  }
  return out;
}

/** One message. The organizer sees a team member's first name, never notes. */
function shapeMessage(row, { names = new Map(), forTeam = false } = {}) {
  const name = row.author_id ? names.get(row.author_id) : null;
  const out = {
    id: row.id,
    direction: row.direction,
    channel: row.channel,
    author: row.author_kind,
    authorName: row.author_kind === 'team'
      ? (name ? (forTeam ? name : name.split(/\s+/)[0]) : (row.channel === 'whatsapp' ? 'Eventsli team (WhatsApp app)' : 'Eventsli team'))
      : row.author_kind === 'organizer' ? (row.wa_contact_name || null) : null,
    body: row.body,
    media: row.media ? { type: row.media.type, mimeType: row.media.mimeType || null, filename: row.media.filename || null, available: Boolean(row.media.id) } : null,
    status: row.wa_status,
    template: Boolean(row.wa_template),
    createdAt: iso(row.created_at),
  };
  if (forTeam) {
    out.error = row.wa_error;
    out.contact = row.wa_contact;
  } else if (row.wa_status === 'failed') {
    out.error = 'Not delivered on WhatsApp; it was sent by email.';
  }
  return out;
}

async function authorNames(rows) {
  const ids = [...new Set(rows.map((r) => r.author_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
  return new Map((data || []).map((p) => [p.id, p.full_name || p.email]));
}

async function messagesFor(requestId) {
  const { data, error } = await supabase.from('vip_service_messages').select(MESSAGE_COLS)
    .eq('request_id', requestId).order('created_at', { ascending: true }).limit(1000);
  if (error) throw new Error(`vip messages read failed: ${error.message}`);
  return data || [];
}

async function requestRow(id) {
  const { data, error } = await supabase.from('vip_service_requests').select(REQUEST_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(`vip request read failed: ${error.message}`);
  return data;
}

async function eventRow(id) {
  if (!id) return null;
  const { data } = await supabase.from('events').select('id, title, slug, starts_at, timezone, status, organizer_id').eq('id', id).maybeSingle();
  return data || null;
}

/** When did this number last write to us on WhatsApp? (Any request, or none.) */
async function lastInboundAt(e164) {
  if (!e164) return null;
  const { data } = await supabase.from('vip_service_messages').select('created_at')
    .eq('wa_contact', e164).eq('direction', 'in').eq('channel', 'whatsapp')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.created_at || null;
}

async function windowFor(e164) {
  const last = await lastInboundAt(e164);
  const until = windowOpenUntil(last);
  return { lastInboundAt: iso(last), openUntil: until && Date.parse(until) > Date.now() ? until : null };
}

async function insertMessage(row) {
  const { data, error } = await supabase.from('vip_service_messages').insert(row).select(MESSAGE_COLS).single();
  if (error) {
    // The same WhatsApp message delivered twice by Meta: already stored.
    if (error.code === '23505') return null;
    throw new Error(`vip message insert failed: ${error.message}`);
  }
  return data;
}

async function touchRequest(id, patch) {
  const { error } = await supabase.from('vip_service_requests')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(`vip request update failed: ${error.message}`);
}

/** Who is emailed about requests: the settings' list, plus every admin when asked. */
async function teamRecipients(settings) {
  const extra = settings.notifyEmails || [];
  if (!settings.notifyAdmins) return extra;
  const { adminRecipients } = require('../eventPublishing');
  const admins = await adminRecipients().catch(() => []);
  return [...new Set([...admins, ...extra])];
}

module.exports = {
  KEY, REQUEST_COLS, MESSAGE_COLS, iso,
  getSettings, saveSettings, shapeRequest, shapeMessage, authorNames, messagesFor, requestRow, eventRow,
  lastInboundAt, windowFor, insertMessage, touchRequest, teamRecipients,
};
