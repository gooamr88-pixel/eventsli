const { supabase } = require('../config/supabase');
const venue = require('./venueService');
const addons = require('./addonService');
const ticketDetails = require('./ticketDetails');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Event templates (owner, 2026-11-19): an event's SETUP, saved to start new
 * events from — the organizer's own library, and Eventsli's shared templates
 * that super admins manage (table `event_templates`, migration 20261129090000).
 *
 * WHAT A TEMPLATE HOLDS. The event's details (as suggestions for the new-event
 * form), its ticket types, add-ons, table categories and seating map — never
 * sales, buyers, dates, passwords or images. Images belong to the event they
 * were uploaded for (every upload path is scoped to its event), so a new
 * event gets its own; the map's layout carries its zones, styles and look.
 *
 * HOW ONE IS USED. The new-event form is pre-filled from `data.event` and
 * creates the event through POST /events like any other — so every rule there
 * (organization set up, markets, payments, slug) still applies. Then
 * POST /events/:id/apply-template copies the ticket types, add-ons, categories
 * and map into that fresh draft (`applyToEvent`), and only into a fresh one:
 * applying over an event that already has ticket types would leave duplicates.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_PER_ORGANIZER = 50;
const MAX_DATA_BYTES = 900 * 1024;
const VERSION = 1;

const CARD = 'id, scope, organizer_id, name, description, category, listing_type, status, featured, sort_order, '
  + 'cover_url, summary, source_event_id, copied_from_id, use_count, created_at, updated_at';

class TemplateError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => new TemplateError(code, message);

function missingTable(error) {
  return error && /event_templates|bump_event_template_use/.test(String(error.message || ''))
    && /does not exist|schema cache|not find/i.test(String(error.message || ''));
}
function check(error, what) {
  if (!error) return;
  if (missingTable(error)) throw fail('FEATURE_DISABLED', 'Templates are not switched on yet.');
  throw new Error(`templates: ${what}: ${error.message}`);
}

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function card(row) {
  return {
    id: row.id,
    scope: row.scope,
    organizerId: row.organizer_id,
    name: row.name,
    description: row.description,
    category: row.category,
    listingType: row.listing_type,
    status: row.status,
    featured: row.featured,
    sortOrder: row.sort_order,
    coverUrl: row.cover_url,
    summary: row.summary || {},
    sourceEventId: row.source_event_id,
    copiedFromId: row.copied_from_id,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ── taking a snapshot ──────────────────────────────────────────────────── */

/** "19:30" where the event happens — what the new-event form offers as a time. */
function localTime(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })
      .format(new Date(iso));
  } catch { return null; }
}

/**
 * Everything a template keeps from one event, read fresh. Throws NOT_FOUND
 * when the event is not there (or not the organizer's, when one is given).
 */
async function snapshotEvent(eventId, { organizerId = null } = {}) {
  let q = supabase.from('events').select(
    'id, organizer_id, title, description, category, listing_type, admission_type, purchase_mode, '
    + 'max_tickets_per_order, allow_ticket_transfer, fee_bearer, venue_name, venue_address, city, country, '
    + 'timezone, venue_place_id, venue_lat, venue_lng, starts_at, ends_at, currency, cover_url',
  ).eq('id', eventId);
  if (organizerId) q = q.eq('organizer_id', organizerId);
  const { data: e, error } = await q.maybeSingle();
  if (error) throw new Error(`templates: event read failed: ${error.message}`);
  if (!e) throw fail('NOT_FOUND', 'That event does not exist.');

  const [{ data: tiers, error: tierErr }, { data: cats, error: catErr }, addonList, map] = await Promise.all([
    supabase.from('ticket_tiers')
      .select('id, name, description, price_cents, quantity, sort_order, kind, max_per_order, is_hidden, details')
      .eq('event_id', eventId).order('sort_order').order('created_at'),
    supabase.from('table_categories').select('id, name, color, sort_order').eq('event_id', eventId).order('sort_order'),
    addons.listForOrganizer(eventId),
    venue.getMapForOrganizer(eventId),
  ]);
  if (tierErr) throw new Error(`templates: tier read failed: ${tierErr.message}`);
  if (catErr) throw new Error(`templates: category read failed: ${catErr.message}`);

  // Ids become keys: a template's ticket types are new rows on every use.
  const tierKey = new Map((tiers || []).map((t, i) => [t.id, `t${i + 1}`]));
  const catKey = new Map((cats || []).map((c, i) => [c.id, `c${i + 1}`]));

  const duration = Math.round((new Date(e.ends_at) - new Date(e.starts_at)) / 60000);
  const tables = (map?.tables || []).map((t) => ({
    label: t.label,
    seatCount: t.seatCount,
    priceCents: t.priceCents ?? null,
    position: t.position,
    shape: t.shape,
    tierKey: t.tierId ? tierKey.get(t.tierId) || null : null,
    categoryKey: t.categoryId ? catKey.get(t.categoryId) || null : null,
    seatPriceCents: t.seatPriceCents ?? null,
    ...(t.section ? { section: t.section, row: t.row } : {}),
  }));
  // 360° photos and the venue photo belong to the source event's storage.
  const layout = map?.layout && typeof map.layout === 'object' ? { ...map.layout } : null;
  if (layout) delete layout.views;

  const data = {
    version: VERSION,
    currency: e.currency,
    event: {
      title: e.title,
      description: e.description,
      category: e.category,
      listingType: e.listing_type,
      admissionType: e.admission_type,
      purchaseMode: e.purchase_mode,
      maxTicketsPerOrder: e.max_tickets_per_order,
      allowTicketTransfer: e.allow_ticket_transfer,
      feeBearer: e.fee_bearer,
      venueName: e.venue_name,
      venueAddress: e.venue_address,
      city: e.city,
      country: e.country,
      timezone: e.timezone,
      venuePlaceId: e.venue_place_id,
      venueLat: e.venue_lat,
      venueLng: e.venue_lng,
      startTime: localTime(e.starts_at, e.timezone),
      durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 180,
    },
    tiers: (tiers || []).map((t) => ({
      key: tierKey.get(t.id),
      name: t.name,
      description: t.description,
      priceCents: t.price_cents,
      quantity: t.quantity,
      sortOrder: t.sort_order,
      kind: t.kind,
      maxPerOrder: t.max_per_order,
      isHidden: t.is_hidden,
      details: t.details || null,
    })),
    addons: (addonList || []).map((a) => ({
      name: a.name, description: a.description, priceCents: a.priceCents, quantity: a.quantity,
      sortOrder: a.sortOrder, isActive: a.isActive,
    })),
    categories: (cats || []).map((c) => ({ key: catKey.get(c.id), name: c.name, color: c.color, sortOrder: c.sort_order })),
    map: tables.length || layout ? { layout: layout || {}, tables } : null,
  };

  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DATA_BYTES) {
    throw fail('VALIDATION_ERROR', 'This event is too large to save as a template.');
  }
  return { event: e, data, summary: summarize(data) };
}

/** The counts a template card shows. */
function summarize(data) {
  const tables = data.map?.tables || [];
  const zones = Array.isArray(data.map?.layout?.zones) ? data.map.layout.zones : [];
  return {
    tiers: data.tiers.length,
    addons: data.addons.length,
    tables: tables.length,
    seats: tables.reduce((n, t) => n + (Number(t.seatCount) || 0), 0),
    areas: zones.length,
    hasMap: tables.length > 0,
    currency: data.currency,
    admissionType: data.event.admissionType,
    lowestPriceCents: data.tiers.length ? Math.min(...data.tiers.map((t) => Number(t.priceCents) || 0)) : null,
  };
}

/* ── reading ────────────────────────────────────────────────────────────── */

/** The organizer's library and Eventsli's published templates. */
async function listForOrganizer(organizerId) {
  const [mine, shared] = await Promise.all([
    supabase.from('event_templates').select(CARD).eq('scope', 'organizer').eq('organizer_id', organizerId)
      .order('updated_at', { ascending: false }),
    supabase.from('event_templates').select(CARD).eq('scope', 'platform').eq('status', 'published')
      .order('featured', { ascending: false }).order('sort_order').order('name'),
  ]);
  if (missingTable(mine.error) || missingTable(shared.error)) return { mine: [], eventsli: [], enabled: false };
  check(mine.error, 'list');
  check(shared.error, 'list');
  return { mine: (mine.data || []).map(card), eventsli: (shared.data || []).map(card), enabled: true };
}

/** One template in full, if this organizer may see it. */
async function getForOrganizer(organizerId, id) {
  const { data, error } = await supabase.from('event_templates').select(`${CARD}, data`).eq('id', id).maybeSingle();
  check(error, 'read');
  const visible = data && (
    (data.scope === 'organizer' && data.organizer_id === organizerId)
    || (data.scope === 'platform' && data.status === 'published'));
  if (!visible) throw fail('NOT_FOUND', 'That template does not exist.');
  return { ...card(data), data: data.data };
}

async function getAny(id) {
  const { data, error } = await supabase.from('event_templates').select(`${CARD}, data`).eq('id', id).maybeSingle();
  check(error, 'read');
  if (!data) throw fail('NOT_FOUND', 'That template does not exist.');
  return { ...card(data), data: data.data };
}

/* ── writing ────────────────────────────────────────────────────────────── */

async function countFor(organizerId) {
  const { count, error } = await supabase.from('event_templates')
    .select('id', { count: 'exact', head: true }).eq('scope', 'organizer').eq('organizer_id', organizerId);
  check(error, 'count');
  return count || 0;
}

async function insert(row) {
  const { data, error } = await supabase.from('event_templates').insert(row).select(CARD).single();
  check(error, 'save');
  return card(data);
}

/**
 * A template from an event. `scope` 'organizer' saves to that organizer's
 * library (their own events only); 'platform' is a super admin's, from any
 * event, and starts as a draft nobody else sees.
 */
async function createFromEvent({ scope, organizerId = null, eventId, name, description, category, createdBy }) {
  if (scope === 'organizer' && (await countFor(organizerId)) >= MAX_PER_ORGANIZER) {
    throw fail('VALIDATION_ERROR', `You can keep up to ${MAX_PER_ORGANIZER} templates. Delete one to save another.`);
  }
  const snap = await snapshotEvent(eventId, { organizerId: scope === 'organizer' ? organizerId : null });
  return insert({
    scope,
    organizer_id: scope === 'organizer' ? organizerId : null,
    name: text(name, 80) || snap.event.title.slice(0, 80),
    description: text(description, 500),
    category: text(category, 60) || snap.event.category || null,
    listing_type: snap.event.listing_type,
    status: scope === 'platform' ? 'draft' : 'published',
    cover_url: snap.event.cover_url || null,
    data: snap.data,
    summary: snap.summary,
    source_event_id: eventId,
    created_by: createdBy || null,
  });
}

/** Re-takes the snapshot from the template's source event (admin "Refresh"). */
async function refreshFromSource(id) {
  const t = await getAny(id);
  if (!t.sourceEventId) throw fail('VALIDATION_ERROR', 'The event this template came from no longer exists.');
  const snap = await snapshotEvent(t.sourceEventId);
  const { data, error } = await supabase.from('event_templates')
    .update({ data: snap.data, summary: snap.summary, updated_at: new Date().toISOString() })
    .eq('id', id).select(CARD).single();
  check(error, 'refresh');
  return card(data);
}

/** A copy of a template into an organizer's library (Eventsli's or their own). */
async function copyToOrganizer(organizerId, id, name, createdBy) {
  const source = await getForOrganizer(organizerId, id);
  if ((await countFor(organizerId)) >= MAX_PER_ORGANIZER) {
    throw fail('VALIDATION_ERROR', `You can keep up to ${MAX_PER_ORGANIZER} templates. Delete one to save another.`);
  }
  return insert({
    scope: 'organizer',
    organizer_id: organizerId,
    name: text(name, 80) || `${source.name}`.slice(0, 74) + (source.scope === 'organizer' ? ' (copy)' : ''),
    description: source.description,
    category: source.category,
    listing_type: source.listingType,
    status: 'published',
    cover_url: source.coverUrl,
    data: source.data,
    summary: source.summary,
    copied_from_id: source.id,
    created_by: createdBy || null,
  });
}

/** An organizer's template copied into Eventsli's library, as a draft. */
async function promoteToPlatform(id, createdBy) {
  const source = await getAny(id);
  return insert({
    scope: 'platform',
    organizer_id: null,
    name: source.name,
    description: source.description,
    category: source.category,
    listing_type: source.listingType,
    status: 'draft',
    cover_url: source.coverUrl,
    data: source.data,
    summary: source.summary,
    copied_from_id: source.id,
    created_by: createdBy || null,
  });
}

/**
 * Renames and the like. An organizer may change their own template's name and
 * description; a super admin changes Eventsli's, including who sees it.
 */
async function update(id, patch, { organizerId = null, admin = false } = {}) {
  const row = {};
  if (patch.name !== undefined) {
    const name = text(patch.name, 80);
    if (!name || name.length < 2) throw fail('VALIDATION_ERROR', 'Give the template a name of at least two characters.');
    row.name = name;
  }
  if (patch.description !== undefined) row.description = text(patch.description, 500);
  if (admin) {
    if (patch.category !== undefined) row.category = text(patch.category, 60);
    if (patch.status !== undefined) {
      if (!['draft', 'published', 'hidden'].includes(patch.status)) throw fail('VALIDATION_ERROR', 'Unknown status.');
      row.status = patch.status;
    }
    if (patch.featured !== undefined) row.featured = patch.featured === true;
    if (patch.sortOrder !== undefined) row.sort_order = Math.max(0, Math.min(9999, Math.round(Number(patch.sortOrder) || 0)));
    if (patch.coverUrl !== undefined) {
      const url = text(patch.coverUrl, 1000);
      if (url && !/^https:\/\//i.test(url)) throw fail('VALIDATION_ERROR', 'A cover must be an https:// image address.');
      row.cover_url = url;
    }
  }
  if (Object.keys(row).length === 0) throw fail('VALIDATION_ERROR', 'Nothing to change.');
  row.updated_at = new Date().toISOString();

  let q = supabase.from('event_templates').update(row).eq('id', id);
  q = admin ? q.eq('scope', 'platform') : q.eq('scope', 'organizer').eq('organizer_id', organizerId);
  const { data, error } = await q.select(CARD).maybeSingle();
  check(error, 'update');
  if (!data) throw fail('NOT_FOUND', 'That template does not exist.');
  return card(data);
}

async function remove(id, { organizerId = null, admin = false } = {}) {
  let q = supabase.from('event_templates').delete().eq('id', id);
  if (!admin) q = q.eq('scope', 'organizer').eq('organizer_id', organizerId);
  const { data, error } = await q.select('id');
  check(error, 'delete');
  if (!data || data.length === 0) throw fail('NOT_FOUND', 'That template does not exist.');
  return { deleted: true };
}

/** Every template, for the admin console. */
async function listForAdmin({ scope = 'platform', q = '' } = {}) {
  let query = supabase.from('event_templates').select(`${CARD}, organizers ( display_name )`).eq('scope', scope);
  if (q) query = query.ilike('name', `%${String(q).replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  query = scope === 'platform'
    ? query.order('featured', { ascending: false }).order('sort_order').order('name')
    : query.order('updated_at', { ascending: false }).limit(200);
  const { data, error } = await query;
  if (missingTable(error)) return { templates: [], enabled: false };
  check(error, 'admin list');
  return {
    enabled: true,
    templates: (data || []).map((r) => ({ ...card(r), organizerName: r.organizers?.display_name || null })),
  };
}

/* ── using one ──────────────────────────────────────────────────────────── */

/**
 * Copies a template's ticket types, add-ons, categories and map into a fresh
 * draft event of this organizer. Returns what was added and anything to check.
 */
async function applyToEvent({ organizerId, eventId, templateId }) {
  const template = await getForOrganizer(organizerId, templateId);
  const data = template.data || {};

  const { data: event, error } = await supabase.from('events')
    .select('id, organizer_id, status, listing_type, admission_type, currency')
    .eq('id', eventId).eq('organizer_id', organizerId).maybeSingle();
  if (error) throw new Error(`templates: event read failed: ${error.message}`);
  if (!event) throw fail('NOT_FOUND', 'That event does not exist.');
  if (event.status !== 'draft') throw fail('CONFLICT', 'A template can only be applied to a draft event.');

  const [{ count: tierCount }, existingMap] = await Promise.all([
    supabase.from('ticket_tiers').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    venue.getMapForOrganizer(eventId),
  ]);
  if ((tierCount || 0) > 0 || (existingMap?.tables || []).length > 0) {
    throw fail('CONFLICT', 'This event already has ticket types or a seating map, so a template cannot be applied to it.');
  }

  const result = { tiers: 0, addons: 0, categories: 0, tables: 0, warnings: [] };
  if (event.listing_type === 'display_only') {
    await bump(templateId);
    return result;
  }
  if (data.currency && event.currency && data.currency !== event.currency) {
    result.warnings.push(`The template's prices are in ${data.currency} and this event sells in ${event.currency}. The amounts were copied as they are — check them on Ticket types.`);
  }

  // Table categories, then ticket types: the map points at both.
  const catIds = new Map();
  const cats = (data.categories || []).filter((c) => text(c.name, 60));
  if (cats.length) {
    const { data: rows, error: e } = await supabase.from('table_categories').insert(cats.map((c) => ({
      event_id: eventId, name: text(c.name, 60), color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : null,
      sort_order: Number(c.sortOrder) || 0,
    }))).select('id, name');
    if (e) throw new Error(`templates: categories failed: ${e.message}`);
    for (const c of cats) catIds.set(c.key, rows.find((r) => r.name === text(c.name, 60))?.id || null);
    result.categories = rows.length;
  }

  const tierIds = new Map();
  const seen = new Set();
  const tiers = (data.tiers || []).filter((t) => {
    const n = text(t.name, 120);
    if (!n || seen.has(n.toLowerCase())) return false;
    seen.add(n.toLowerCase());
    return true;
  });
  if (tiers.length) {
    const { data: rows, error: e } = await supabase.from('ticket_tiers').insert(tiers.map((t) => ({
      event_id: eventId,
      name: text(t.name, 120),
      description: text(t.description, 2000),
      price_cents: Math.max(0, Math.round(Number(t.priceCents) || 0)),
      quantity: t.quantity === null || t.quantity === undefined ? null : Math.max(1, Math.round(Number(t.quantity))),
      sort_order: Number(t.sortOrder) || 0,
      kind: t.kind || 'standard',
      max_per_order: t.maxPerOrder ? Math.round(Number(t.maxPerOrder)) : null,
      is_hidden: t.isHidden === true,
      // The card's text and lists; its pictures belong to the source event.
      ...(t.details ? { details: ticketDetails.clean(eventId, t.details) } : {}),
    }))).select('id, name');
    if (e) throw new Error(`templates: ticket types failed: ${e.message}`);
    for (const t of tiers) tierIds.set(t.key, rows.find((r) => r.name === text(t.name, 120))?.id || null);
    result.tiers = rows.length;
  }

  for (const a of data.addons || []) {
    try {
      await addons.create(eventId, {
        name: text(a.name, 80) || 'Add-on', description: text(a.description, 300), priceCents: Math.max(0, Number(a.priceCents) || 0),
        quantity: a.quantity ?? null, sortOrder: Number(a.sortOrder) || 0, isActive: a.isActive !== false,
      });
      result.addons += 1;
    } catch {
      result.warnings.push(`The add-on "${text(a.name, 80) || 'Add-on'}" could not be copied. Add it again on Add-ons.`);
    }
  }

  const tables = data.map?.tables || [];
  if (data.map && event.admission_type === 'reserved') {
    try {
      await venue.saveMap(eventId, {
        layout: data.map.layout || {},
        tables: tables.map((t) => ({
          label: t.label,
          seatCount: t.seatCount,
          priceCents: t.priceCents ?? null,
          isPrivate: false,
          position: t.position,
          shape: t.shape,
          tierId: t.tierKey ? tierIds.get(t.tierKey) || null : null,
          categoryId: t.categoryKey ? catIds.get(t.categoryKey) || null : null,
          seatPriceCents: t.seatPriceCents ?? null,
          ...(t.section ? { section: t.section, row: t.row } : {}),
        })),
      });
      result.tables = tables.length;
    } catch (err) {
      result.warnings.push(`The seating map could not be copied (${err.message}). Open the Venue Builder to draw it, or apply the template's map there.`);
    }
  } else if (tables.length) {
    result.warnings.push('This event uses general admission, so the template\'s seating map was not added.');
  }

  await bump(templateId);
  return result;
}

async function bump(id) {
  const { error } = await supabase.rpc('bump_event_template_use', { p_id: id });
  if (error && !missingTable(error)) throw new Error(`templates: use count failed: ${error.message}`);
}

module.exports = {
  snapshotEvent, summarize, listForOrganizer, getForOrganizer, getAny, createFromEvent, refreshFromSource,
  copyToOrganizer, promoteToPlatform, update, remove, listForAdmin, applyToEvent,
  TemplateError, MAX_PER_ORGANIZER,
};
