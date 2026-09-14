const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');

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
    const { data, error } = await supabase.rpc('organizer_dashboard_summary', {
      p_organizer_id: organizerId, p_days: days,
    });
    if (error) throw new Error(error.message);
    return sendOk(res, { ...data, days });
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

module.exports = { organizerDashboard, eventStats, windowDays, WINDOWS };
