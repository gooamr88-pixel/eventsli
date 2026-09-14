const { supabase } = require('../../config/supabase');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk } = require('../../utils/responseEnvelope');
const { windowDays } = require('../statsController');

/**
 * BRD §19–§20 — what an admin sees before deciding anything: the platform at a
 * glance, and every organizer with their standing.
 */

const one = (x) => (Array.isArray(x) ? x[0] : x) || null;

// ─── GET /admin/overview ────────────────────────────────────────────────────
async function overview(req, res, next) {
  try {
    const days = windowDays(req.query.days);
    const { data, error } = await supabase.rpc('platform_overview', { p_days: days });
    if (error) throw new Error(error.message);
    return sendOk(res, { ...data, days });
  } catch (err) { return next(err); }
}

// ─── GET /admin/organizers ──────────────────────────────────────────────────
/**
 * `stripe_account_id` is read to say whether one is connected and never
 * returned: it identifies a connected account, and nothing on an admin screen
 * needs the identifier itself.
 */
async function organizers(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['created_at', 'display_name'], defaultSort: 'created_at',
    });

    let query = supabase
      .from('organizers')
      .select(`id, display_name, country, is_banned, stripe_account_id,
               stripe_onboarding_complete, stripe_payouts_enabled, created_at,
               profiles!organizers_owner_user_id_fkey ( id, email, full_name, is_blocked )`,
      { count: 'exact' });

    if (p.q) {
      const safe = p.q.replace(/[,()\\%*]/g, ' ').trim();
      if (safe) query = query.ilike('display_name', `%${safe}%`);
    }
    if (req.query.banned === 'true') query = query.eq('is_banned', true);
    if (req.query.banned === 'false') query = query.eq('is_banned', false);
    if (req.query.payouts === 'ready') {
      query = query.eq('stripe_onboarding_complete', true).eq('stripe_payouts_enabled', true);
    }
    if (req.query.payouts === 'missing') {
      query = query.or('stripe_onboarding_complete.eq.false,stripe_payouts_enabled.eq.false');
    }

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);
    const rows = data || [];
    const ids = rows.map((r) => r.id);

    // Two queries for the whole page, whatever its length.
    const [events, orders] = ids.length ? await Promise.all([
      supabase.from('events').select('organizer_id, status').in('organizer_id', ids),
      supabase.from('orders').select('organizer_id, currency, buyer_total_cents')
        .eq('status', 'paid').in('organizer_id', ids),
    ]) : [{ data: [] }, { data: [] }];
    if (events.error) throw new Error(events.error.message);
    if (orders.error) throw new Error(orders.error.message);

    const eventCounts = new Map();
    for (const e of events.data || []) {
      const c = eventCounts.get(e.organizer_id) || { total: 0, published: 0, pendingReview: 0 };
      c.total += 1;
      if (e.status === 'published') c.published += 1;
      if (e.status === 'pending_review') c.pendingReview += 1;
      eventCounts.set(e.organizer_id, c);
    }
    const sales = new Map();
    for (const o of orders.data || []) {
      const byCurrency = sales.get(o.organizer_id) || {};
      const s = (byCurrency[o.currency] ||= { orders: 0, grossCents: 0 });
      s.orders += 1;
      s.grossCents += Number(o.buyer_total_cents);
      sales.set(o.organizer_id, byCurrency);
    }

    return sendOk(res, rows.map((o) => {
      const owner = one(o.profiles);
      return {
        id: o.id,
        displayName: o.display_name,
        country: o.country,
        isBanned: !!o.is_banned,
        stripeConnected: !!o.stripe_account_id,
        canReceivePayouts: !!(o.stripe_onboarding_complete && o.stripe_payouts_enabled),
        createdAt: o.created_at,
        owner: owner && {
          id: owner.id, email: owner.email, name: owner.full_name, isBlocked: !!owner.is_blocked,
        },
        events: eventCounts.get(o.id) || { total: 0, published: 0, pendingReview: 0 },
        sales: sales.get(o.id) || {},
      };
    }), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

module.exports = { overview, organizers };
