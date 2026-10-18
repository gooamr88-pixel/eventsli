import { post, patch } from '../../../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Saves a reviewed AI draft through the endpoints every manual screen uses.
 *
 * NOT ATOMIC, AND HONEST ABOUT IT (I-022). There is no bulk endpoint for ticket
 * types or schedule rows, so this is one request for the event and one for
 * each thing hanging off it. The event comes first and is the only request
 * that can fail the save: once it exists, the organizer HAS a private draft,
 * and anything after it that fails is reported by name and can be retried on
 * its own — never re-sent, never duplicated.
 *
 *   saveAiDraft(plan)                    → { eventId, failed: [] }
 *   saveAiDraft(plan, { eventId, only }) → retries just the `only` keys
 *
 * `failed` entries are `{ kind: 'tier' | 'schedule' | 'highlights', key, label, error }`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function saveAiDraft(plan, { eventId: existing = null, only = null } = {}) {
  const wanted = (k) => !only || only.includes(k);
  let eventId = existing;
  if (!eventId) {
    const event = await post('/events', plan.event, { noRedirect: true });
    eventId = event.id;
  }

  const failed = [];
  if (plan.highlights.length && wanted('highlights')) {
    try {
      await patch(`/events/${eventId}`, { highlights: plan.highlights }, { noRedirect: true });
    } catch (error) {
      failed.push({ kind: 'highlights', key: 'highlights', label: 'Highlights', error });
    }
  }
  // In order, one at a time: the sort order is the order the organizer chose,
  // and a burst of parallel writes is how two land with the same position.
  for (const t of plan.tiers) {
    if (!wanted(t.key)) continue;
    try {
      await post(`/events/${eventId}/tiers`, t.body, { noRedirect: true });
    } catch (error) {
      failed.push({ kind: 'tier', key: t.key, label: t.label, error });
    }
  }
  for (const s of plan.schedule) {
    if (!wanted(s.key)) continue;
    try {
      await post(`/events/${eventId}/schedule`, s.body, { noRedirect: true });
    } catch (error) {
      failed.push({ kind: 'schedule', key: s.key, label: s.label, error });
    }
  }
  return { eventId, failed };
}
