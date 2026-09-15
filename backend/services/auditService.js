const { supabase } = require('../config/supabase');
const { hashIp } = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The admin audit trail (BRD §19), written from one place.
 *
 * Six controllers used to insert into `admin_audit` themselves, and not one of
 * them looked at the result. supabase-js does not throw on a refused insert — it
 * returns `{ error }` — so a row that never landed was indistinguishable from
 * one that did, and "who suspended this organizer, and why" could come back
 * empty with nothing anywhere to say the trail had a hole in it.
 *
 * By the time this runs the action has already been applied. Refusing now would
 * tell the admin their change failed when it did not, so a failed write is
 * logged at ERROR level with the whole row — enough to write it by hand — and
 * the caller carries on. The return value says whether it landed, for callers
 * that want to tell the admin.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function writeAudit(req, { action, targetType, targetId = null, payload = {} }) {
  const row = {
    actor_id: req?.user?.id || null,
    action,
    target_type: targetType,
    target_id: targetId,
    payload,
    ip_hash: req?.ip ? hashIp(req.ip) : null,
  };

  try {
    const { error } = await supabase.from('admin_audit').insert(row);
    if (!error) return true;
    logger.error({ err: error.message, audit: row },
      'AUDIT WRITE FAILED — the action was applied but is missing from the trail');
  } catch (err) {
    logger.error({ err: err.message, audit: row },
      'AUDIT WRITE FAILED — the action was applied but is missing from the trail');
  }
  return false;
}

module.exports = { writeAudit };
