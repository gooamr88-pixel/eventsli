const { supabase } = require('../config/supabase');
const { sendFail } = require('../utils/responseEnvelope');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT CAN STILL BE CHANGED (TECH-AUDIT-LOG S-10).
 *
 * `eventController.update` refuses edits to a cancelled or completed event —
 * it is a historical record (BRD §17) — and to an archived one unless an admin
 * is restoring it. The seat map, the ticket types and the table categories
 * live on their own routes, and none of them asked: a cancelled event's prices
 * and room could still be rewritten after the fact, under orders and refunds
 * that describe what it was.
 *
 * Runs AFTER `verifyEventOwner`, which settles whose event it is. This only
 * settles whether it is still open to change, and the answer is the same one
 * the event's own edit gives. A failed read is a fault, not a yes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function requireEditableEvent(req, res, next) {
  try {
    const { data: event, error } = await supabase
      .from('events').select('status').eq('id', req.params.eventId).maybeSingle();
    if (error) throw new Error(`event status lookup failed: ${error.message}`);
    if (!event) {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'That event does not exist.' });
    }
    if (['cancelled', 'completed'].includes(event.status)) {
      return sendFail(res, {
        status: 409, error: 'CONFLICT', message: `A ${event.status} event cannot be changed.`,
      });
    }
    if (event.status === 'archived' && !req.user?.access?.isAdmin) {
      return sendFail(res, {
        status: 409, error: 'EVENT_ARCHIVED',
        message: 'This event is archived. Restore it before changing it.',
      });
    }
    return next();
  } catch (err) { return next(err); }
}

module.exports = { requireEditableEvent };
