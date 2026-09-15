const { supabase } = require('../../config/supabase');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const eventCtrl = require('../eventController');
const scanSvc = require('../../services/scanService');
const { isInvoiceOverdue } = require('../../utils/invoices');

/**
 * BRD §19 — every event on the platform, and everything an admin controls about
 * one. The ACTIONS (approve, reject, suspend, cancel, fees, scanner override)
 * stay where they already live in approvalRoutes; this is the read side that
 * gives an admin somewhere to take them from.
 */

const { one } = require('../../utils/embed');
const { safeSearch } = require('../../utils/search');
const { canReceivePayouts } = require('../../utils/payouts');

// ─── GET /admin/events ──────────────────────────────────────────────────────
async function list(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['created_at', 'starts_at', 'updated_at', 'title'], defaultSort: 'created_at',
    });

    let query = supabase
      .from('events')
      .select(`id, slug, title, status, country, currency, timezone, starts_at, ends_at,
               listing_type, category, created_at, updated_at,
               organizers ( id, display_name, is_banned )`, { count: 'exact' });

    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.organizerId) query = query.eq('organizer_id', req.query.organizerId);
    const now = new Date().toISOString();
    if (req.query.when === 'upcoming') query = query.gt('starts_at', now);
    if (req.query.when === 'now') query = query.lte('starts_at', now).gte('ends_at', now);
    if (req.query.when === 'past') query = query.lt('ends_at', now);
    if (p.q) {
      const safe = safeSearch(p.q);
      if (safe) query = query.ilike('title', `%${safe}%`);
    }

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);
    const rows = data || [];

    // Sales for THIS PAGE's events, summed in the database — not every paid
    // order pulled across the wire and added up here.
    let sales = {};
    if (rows.length) {
      const { data: agg, error: salesError } = await supabase
        .rpc('admin_event_sales', { p_event_ids: rows.map((r) => r.id) });
      if (salesError) throw new Error(salesError.message);
      sales = agg || {};
    }

    return sendOk(res, rows.map((e) => {
      const org = one(e.organizers);
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        status: e.status,
        country: e.country,
        currency: e.currency,
        timezone: e.timezone,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        listingType: e.listing_type,
        category: e.category,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
        organizer: org && { id: org.id, name: org.display_name, isBanned: !!org.is_banned },
        sales: sales[e.id] || { orders: 0, tickets: 0, grossCents: 0 },
      };
    }), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

// ─── GET /admin/events/:eventId ─────────────────────────────────────────────
async function detail(req, res, next) {
  try {
    const eventId = req.params.eventId;
    const { data: event, error } = await supabase
      .from('events').select(`${eventCtrl.SELECT}, organizer_id`).eq('id', eventId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }

    const [organizer, stats, gate, invoices, staff, devices, access, tiers, map] = await Promise.all([
      supabase.from('organizers')
        .select(`id, display_name, country, is_banned, stripe_onboarding_complete, stripe_payouts_enabled,
                 profiles!organizers_owner_user_id_fkey ( id, email, full_name )`)
        .eq('id', event.organizer_id).maybeSingle(),
      supabase.rpc('event_sales_summary', { p_event_id: eventId, p_days: 30 }),
      scanSvc.gateStatus(eventId),
      supabase.from('invoices')
        .select('id, number, currency, amount_cents, status, issued_at, due_at, proof_submitted_at')
        .eq('event_id', eventId).order('issued_at', { ascending: false }).limit(20),
      supabase.from('event_staff').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).is('revoked_at', null),
      supabase.from('scan_devices').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).eq('is_active', true).is('staff_id', null),
      supabase.from('scanner_access').select('override_until, locked_reason')
        .eq('event_id', eventId).maybeSingle(),
      // What is about to go on sale (BRD §16). The review queue's only preview
      // was the public page, which 404s for anything not yet published — so an
      // admin approved prices and a seat map they had no way to see.
      supabase.from('ticket_tiers')
        .select('id, name, description, price_cents, quantity, sold_count')
        .eq('event_id', eventId).order('sort_order').order('created_at'),
      supabase.from('venue_maps').select('id').eq('event_id', eventId).maybeSingle(),
    ]);

    let seating = null;
    if (map.data) {
      // Counted in the database, not by fetching every seat: a large room is
      // more rows than one PostgREST response returns.
      const freeTierIds = (tiers.data || []).filter((t) => Number(t.price_cents) === 0).map((t) => t.id);
      const [tables, privateTables, seats, noPrice, freeTier] = await Promise.all([
        supabase.from('tables').select('id', { count: 'exact', head: true }).eq('venue_map_id', map.data.id),
        supabase.from('tables').select('id', { count: 'exact', head: true })
          .eq('venue_map_id', map.data.id).eq('is_private', true),
        supabase.from('seats').select('id', { count: 'exact', head: true }).eq('venue_map_id', map.data.id),
        supabase.from('seats').select('id', { count: 'exact', head: true })
          .eq('venue_map_id', map.data.id).is('price_override_cents', null).is('tier_id', null),
        freeTierIds.length
          ? supabase.from('seats').select('id', { count: 'exact', head: true })
            .eq('venue_map_id', map.data.id).is('price_override_cents', null).in('tier_id', freeTierIds)
          : Promise.resolve({ count: 0 }),
      ]);
      seating = {
        tables: Number(tables.count) || 0,
        privateTables: Number(privateTables.count) || 0,
        seats: Number(seats.count) || 0,
        // A seat with no override resolves through its ticket type and ends in
        // COALESCE(…, 0). These are the seats that would sell for nothing.
        unpricedSeats: (Number(noPrice.count) || 0) + (Number(freeTier.count) || 0),
      };
    }

    const org = organizer.data;
    const owner = one(org?.profiles);
    return sendOk(res, {
      event: eventCtrl.shape(event),
      organizer: org && {
        id: org.id,
        name: org.display_name,
        country: org.country,
        isBanned: !!org.is_banned,
        canReceivePayouts: !!(org.stripe_onboarding_complete && org.stripe_payouts_enabled),
        owner: owner && { id: owner.id, email: owner.email, name: owner.full_name },
      },
      stats: stats.data || null,
      gate,
      scannerOverrideUntil: access.data?.override_until || null,
      invoices: (invoices.data || []).map((i) => ({
        id: i.id,
        number: i.number,
        currency: i.currency,
        amountCents: Number(i.amount_cents),
        status: i.status,
        issuedAt: i.issued_at,
        dueAt: i.due_at,
        isOverdue: isInvoiceOverdue(i),
        proofSubmittedAt: i.proof_submitted_at,
      })),
      door: { staff: Number(staff.count) || 0, devices: Number(devices.count) || 0 },
      tiers: (tiers.data || []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        priceCents: Number(t.price_cents),
        quantity: t.quantity === null ? null : Number(t.quantity),
        soldCount: Number(t.sold_count),
      })),
      seating,
    });
  } catch (err) { return next(err); }
}

module.exports = { list, detail };
