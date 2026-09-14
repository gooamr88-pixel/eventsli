const { supabase } = require('../../config/supabase');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const eventCtrl = require('../eventController');
const scanSvc = require('../../services/scanService');

/**
 * BRD §19 — every event on the platform, and everything an admin controls about
 * one. The ACTIONS (approve, reject, suspend, cancel, fees, scanner override)
 * stay where they already live in approvalRoutes; this is the read side that
 * gives an admin somewhere to take them from.
 */

const one = (x) => (Array.isArray(x) ? x[0] : x) || null;
const safeSearch = (q) => q.replace(/[,()\\%*]/g, ' ').trim();

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
    if (req.query.when === 'past') query = query.lt('ends_at', now);
    if (p.q) {
      const safe = safeSearch(p.q);
      if (safe) query = query.ilike('title', `%${safe}%`);
    }

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);
    const rows = data || [];

    // Sales for THIS PAGE's events, in one query — not one per row.
    const sales = new Map();
    if (rows.length) {
      const { data: orders, error: salesError } = await supabase
        .from('orders')
        .select('event_id, quantity, buyer_total_cents')
        .eq('status', 'paid')
        .in('event_id', rows.map((r) => r.id));
      if (salesError) throw new Error(salesError.message);
      for (const o of orders || []) {
        const s = sales.get(o.event_id) || { orders: 0, tickets: 0, grossCents: 0 };
        s.orders += 1;
        s.tickets += Number(o.quantity);
        s.grossCents += Number(o.buyer_total_cents);
        sales.set(o.event_id, s);
      }
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
        sales: sales.get(e.id) || { orders: 0, tickets: 0, grossCents: 0 },
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

    const [organizer, stats, gate, invoices, staff, devices, access] = await Promise.all([
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
    ]);

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
        proofSubmittedAt: i.proof_submitted_at,
      })),
      door: { staff: Number(staff.count) || 0, devices: Number(devices.count) || 0 },
    });
  } catch (err) { return next(err); }
}

module.exports = { list, detail };
