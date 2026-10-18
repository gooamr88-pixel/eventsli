/**
 * The daily allowance, as the database counts it. Thin on purpose: every rule
 * — the limit, the rolling window, the stale reservation, the duplicate
 * request — lives in the three functions of migration 20261018090000, where a
 * row lock makes them true under concurrency. Nothing here re-derives them.
 */
const { supabase } = require('../../config/supabase');

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

/** → { ok, id, remaining } or { ok: false, reason, next_available_at?, id? } */
function reserve({ organizerId, userId, feature, requestId, cfg }) {
  return rpc('ai_reserve_generation', {
    p_organizer: organizerId,
    p_user: userId,
    p_feature: feature,
    p_request: requestId,
    p_limit: cfg.limit,
    p_window: cfg.window,
    p_stale: cfg.stale,
    p_global_cap: cfg.globalCap,
  });
}

/** Mark a reservation counted (`succeeded`) or given back (`released`). */
function finish(id, status, meta = {}) {
  return rpc('ai_finish_generation', { p_id: id, p_status: status, p_meta: meta });
}

/** → { used, in_flight, remaining, next_available_at } */
function status({ organizerId, cfg }) {
  return rpc('ai_generation_status', {
    p_organizer: organizerId, p_limit: cfg.limit, p_window: cfg.window, p_stale: cfg.stale,
  });
}

/**
 * Tie a succeeded Smart Event Creator generation to the event it became, so a
 * reviewer can see the event was drafted with AI. Only the organizer's own,
 * only a success, only once. Best effort: an event is never refused because
 * this link could not be written.
 */
async function attachEvent({ generationId, organizerId, eventId }) {
  const { error } = await supabase
    .from('ai_generations')
    .update({ event_id: eventId })
    .eq('id', generationId)
    .eq('organizer_id', organizerId)
    .eq('feature', 'event_creator')
    .eq('status', 'succeeded')
    .is('event_id', null);
  if (error) throw new Error(error.message);
}

/** Which of these events were drafted with AI — for the review screens. */
async function aiAssistedEventIds(eventIds) {
  if (!eventIds.length) return new Set();
  const { data, error } = await supabase
    .from('ai_generations').select('event_id').in('event_id', eventIds);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.event_id));
}

module.exports = { reserve, finish, status, attachEvent, aiAssistedEventIds };
