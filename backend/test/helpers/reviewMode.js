/**
 * Puts the platform in REVIEW-FIRST mode for suites that test the admin review
 * loop (submit → pending_review → approve / reject).
 *
 * WHY THIS EXISTS. Commit 015a35a (2026-11-03) made "publish first, review
 * after" the default: `event_publishing.require_approval` is false unless an
 * admin turns it on (services/eventPublishing.js, utils/settingsSchema.js). The
 * review loop still exists behind that switch, but the suites that test it were
 * never told, so six of them failed on every run — submit went straight to
 * `published` (docs/TECH-AUDIT-LOG.md T-071).
 *
 * WHY IT IS NOT RESTORED AFTERWARDS. Integration files run two at a time
 * against one database. Both suites that call this want the SAME value, so
 * setting it can never race; restoring it could, because one suite finishing
 * would flip the platform back to direct publishing under the other one
 * mid-run. The local stack and CI's are thrown away after the run, and
 * testEnv.js refuses any remote database that was not named explicitly — a
 * suite that needs direct publishing must set `false` itself.
 */
const { supabase } = require('../../config/supabase');

async function requireReview() {
  const { error } = await supabase
    .from('platform_settings')
    .upsert({ key: 'event_publishing', value: { require_approval: true } }, { onConflict: 'key' });
  if (error) throw new Error(`could not switch on review-first publishing: ${error.message}`);
}

module.exports = { requireReview };
