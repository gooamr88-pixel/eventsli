const { supabase } = require('../config/supabase');
const { hashIp } = require('../utils/crypto');

/**
 * Versioned terms, and a record of who accepted which version when.
 *
 * BRD §21 requires an organizer to see and accept the commission, tax, fees,
 * refund policy, transfer policy and their own responsibilities before an event
 * can be published — and the buyer to see the same before paying.
 *
 * Acceptance is recorded against a VERSION, not a boolean. The difference
 * matters the first time the terms change: a boolean would either silently
 * re-bind everyone to text they never read, or force every live event offline
 * until its organizer re-accepted. Versioning gives the decided answer —
 * a NEW event requires the current version, an already-published one keeps
 * running under the version its organizer agreed to.
 */

async function currentVersion(audience) {
  const { data, error } = await supabase
    .from('terms_versions')
    .select('id, version, audience, body_md, published_at')
    .eq('audience', audience)
    .eq('is_current', true)
    .maybeSingle();

  if (error) throw new Error(`could not load terms: ${error.message}`);
  if (!data) {
    throw Object.assign(
      new Error(`No ${audience} terms have been published yet.`),
      { code: 'CONFLICT' },
    );
  }
  return data;
}

/**
 * Records an acceptance. Idempotent on (user, version, event) so a double-click
 * on "I agree" does not create two rows, and a retry after a network blip lands
 * on the same one.
 */
async function accept({ userId, termsId, eventId = null, req }) {
  const { data, error } = await supabase
    .from('terms_acceptances')
    .upsert(
      {
        user_id: userId,
        terms_id: termsId,
        event_id: eventId,
        accepted_at: new Date().toISOString(),
        ip_hash: req ? hashIp(req.ip) : null,
      },
      { onConflict: 'user_id,terms_id,event_id' },
    )
    .select('id, accepted_at')
    .single();

  if (error) throw new Error(`could not record acceptance: ${error.message}`);
  return data;
}

/** Has this user accepted the CURRENT terms for this audience, for this event? */
async function hasAcceptedCurrent({ userId, audience, eventId = null }) {
  const current = await currentVersion(audience);
  const { data } = await supabase
    .from('terms_acceptances')
    .select('id')
    .eq('user_id', userId)
    .eq('terms_id', current.id)
    .eq('event_id', eventId)
    .maybeSingle();

  return { accepted: !!data, termsId: current.id, version: current.version };
}

/**
 * Publishes a new version and demotes the previous one.
 *
 * Two writes, and the order is deliberate: clear the old flag first, then set
 * the new one. A partial unique index allows only one current version per
 * audience, so doing it the other way round fails on the index instead of
 * leaving two current versions — but leaving NONE current for a moment is the
 * safer of the two failure modes, because publishing then refuses loudly rather
 * than an event silently binding to the wrong text.
 */
async function publishVersion({ audience, bodyMd, version }) {
  await supabase
    .from('terms_versions')
    .update({ is_current: false })
    .eq('audience', audience)
    .eq('is_current', true);

  const { data, error } = await supabase
    .from('terms_versions')
    .insert({ audience, body_md: bodyMd, version, is_current: true })
    .select('id, version, audience, published_at')
    .single();

  if (error) throw new Error(`could not publish terms: ${error.message}`);
  return data;
}

module.exports = { currentVersion, accept, hasAcceptedCurrent, publishVersion };
