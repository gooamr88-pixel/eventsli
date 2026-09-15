const { supabase } = require('../../config/supabase');
const { parsePagination, applyPagination, buildMeta } = require('../../middleware/pagination');
const { sendOk } = require('../../utils/responseEnvelope');
const { safeSearch } = require('../../utils/search');
const { one } = require('../../utils/embed');
const { canReceivePayouts } = require('../../utils/payouts');
const { windowDays } = require('../statsController');

/**
 * BRD §19–§20 — what an admin sees before deciding anything: the platform at a
 * glance, and every organizer with their standing.
 */

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
               profiles!organizers_owner_user_id_fkey ( id, email, full_name, role, is_blocked )`,
      { count: 'exact' });

    const safe = safeSearch(p.q);
    if (safe) query = query.ilike('display_name', `%${safe}%`);
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

    // One aggregate for the whole page, summed in the database. This used to
    // pull every paid order of every organizer on the page and add them up
    // here — silently low once past PostgREST's row cap.
    let summary = {};
    if (ids.length) {
      const { data: agg, error: aggError } = await supabase.rpc('admin_organizer_sales', { p_organizer_ids: ids });
      if (aggError) throw new Error(aggError.message);
      summary = agg || {};
    }

    return sendOk(res, rows.map((o) => {
      const owner = one(o.profiles);
      return {
        id: o.id,
        displayName: o.display_name,
        country: o.country,
        isBanned: !!o.is_banned,
        stripeConnected: !!o.stripe_account_id,
        canReceivePayouts: canReceivePayouts(o),
        createdAt: o.created_at,
        owner: owner && {
          id: owner.id, email: owner.email, name: owner.full_name, isBlocked: !!owner.is_blocked,
          // So the console can apply the same ladder the API does (BRD §19,
          // utils/roleLadder.js).
          role: owner.role,
        },
        events: summary[o.id]?.events || { total: 0, published: 0, pendingReview: 0 },
        sales: summary[o.id]?.sales || {},
      };
    }), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
}

module.exports = { overview, organizers };
