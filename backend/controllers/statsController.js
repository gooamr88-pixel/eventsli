const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * The dashboard's numbers. Each is ONE database round trip — the aggregation
 * lives in SQL functions (see migration 20260914110000) rather than in a loop
 * here, so the busiest page on the dashboard does not grow a query per event.
 */

const WINDOWS = [7, 30, 90];
const windowDays = (value) => (WINDOWS.includes(Number(value)) ? Number(value) : 30);

// GET /organizer/dashboard
async function organizerDashboard(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    if (!organizerId) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND', message: 'You do not have an organizer profile yet.',
      });
    }
    const days = windowDays(req.query.days);
    const args = { p_organizer_id: organizerId, p_days: days };
    // Two independent questions, asked together. The trends are the badges on
    // the stat cards; a database without migration 20261103120000 answers the
    // page without them rather than not at all.
    // The insights (events list, performance, type and city breakdowns) the
    // same way, from migration 20261103130000.
    const [summary, trend, insight] = await Promise.all([
      supabase.rpc('organizer_dashboard_summary', args),
      supabase.rpc('organizer_dashboard_trends', args),
      supabase.rpc('organizer_dashboard_insights', args),
    ]);
    if (summary.error) throw new Error(summary.error.message);
    if (trend.error) logger.warn({ err: trend.error.message }, 'dashboard: trends unavailable — apply the latest supabase migration');
    if (insight.error) logger.warn({ err: insight.error.message }, 'dashboard: insights unavailable — apply the latest supabase migration');
    return sendOk(res, {
      ...summary.data,
      trends: trend.error ? null : trend.data,
      insights: insight.error ? null : insight.data,
      days,
    });
  } catch (err) { return next(err); }
}

// GET /organizer/event-figures — sold, capacity and gross per event, keyed by
// id, for the cards on "Your events". A database without migration
// 20261103140000 answers an empty map: the cards show "—", not an error page.
async function organizerEventFigures(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    if (!organizerId) return sendOk(res, {});
    const { data, error } = await supabase.rpc('organizer_event_figures', { p_organizer_id: organizerId });
    if (error) {
      logger.warn({ err: error.message }, 'event figures unavailable — apply the latest supabase migration');
      return sendOk(res, {});
    }
    return sendOk(res, data || {});
  } catch (err) { return next(err); }
}

// GET /events/:eventId/stats
async function eventStats(req, res, next) {
  try {
    const days = windowDays(req.query.days);
    const { data, error } = await supabase.rpc('event_sales_summary', {
      p_event_id: req.params.eventId, p_days: days,
    });
    if (error) throw new Error(error.message);
    if (!data) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    return sendOk(res, { ...data, days });
  } catch (err) { return next(err); }
}

module.exports = { organizerDashboard, organizerEventFigures, eventStats, windowDays, WINDOWS };
