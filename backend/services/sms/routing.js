/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Which provider, and which sender, for one message.
 *
 * A ROUTE is a (country, provider) pair an admin has VERIFIED. Unverified
 * routes are never used, however cheap — that is the whole meaning of
 * "verified". Among usable routes the lowest route priority wins, then the
 * provider's own priority; a provider whose circuit breaker is open, that is
 * disabled, that lacks credentials, or that does not carry this traffic class
 * is skipped.
 *
 * FALLBACK is driven by `exclude` (providers that DEFINITELY did not send this
 * message) and `avoid` (a provider that just throttled us: tried last, not
 * never). A provider whose outcome was UNCERTAIN is never in either list —
 * the message stops instead of going out twice.
 *
 * Pure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KIND_ORDER = ['messaging_service', 'short_code', 'toll_free', 'long_code', 'alphanumeric'];

function candidates({ routes, providers, adapters, country, trafficClass, exclude = [], avoid = null, now = new Date() }) {
  const usable = (routes || []).filter((r) => {
    if (r.country !== country || !r.active || !r.verified) return false;
    if (exclude.includes(r.provider_id)) return false;
    const p = providers.get(r.provider_id);
    if (!p || !p.enabled) return false;
    if (!(p.traffic_classes || []).includes(trafficClass)) return false;
    if (p.circuit_open_until && new Date(p.circuit_open_until) > now) return false;
    const adapter = adapters[r.provider_id];
    return Boolean(adapter && adapter.configured());
  });
  usable.sort((a, b) => (a.provider_id === avoid) - (b.provider_id === avoid)
    || a.priority - b.priority
    || (providers.get(a.provider_id).priority - providers.get(b.provider_id).priority));
  return usable;
}

function senderAllowed(s, { country, trafficClass, now }) {
  if (!s.active) return false;
  if (!(s.traffic_classes || []).includes(trafficClass)) return false;
  if (s.expires_at && new Date(s.expires_at) <= now) return false;
  if (['pending', 'rejected', 'expired'].includes(s.registration_status)) return false;
  const listed = (s.countries || []).includes(country.iso2);
  if (country.requires_sender_registration && !(listed && s.registration_status === 'approved')) return false;
  if (!country.requires_sender_registration && s.countries?.length && !listed) return false;
  if (s.kind === 'alphanumeric') {
    if (['unknown', 'not_supported'].includes(country.sender_id_support)) return false;
    if (country.sender_id_support === 'registration_required' && !(listed && s.registration_status === 'approved')) return false;
  }
  return true;
}

/** @returns {{ sender } | { error: 'no_sender' | 'route_sender_unusable' }} */
function pickSender({ route, senders, country, trafficClass, now = new Date() }) {
  const own = (senders || []).filter((s) => s.provider_id === route.provider_id);
  if (route.sender_id) {
    const pinned = own.find((s) => s.id === route.sender_id);
    return pinned && senderAllowed(pinned, { country, trafficClass, now })
      ? { sender: pinned } : { error: 'route_sender_unusable' };
  }
  const ok = own.filter((s) => senderAllowed(s, { country, trafficClass, now }));
  if (ok.length === 0) return { error: 'no_sender' };
  ok.sort((a, b) => Number((b.countries || []).includes(country.iso2)) - Number((a.countries || []).includes(country.iso2))
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return { sender: ok[0] };
}

/** An alphanumeric sender cannot receive replies, so "Reply STOP" would be a lie. */
const canReceiveReplies = (sender) => sender && sender.kind !== 'alphanumeric';

module.exports = { candidates, pickSender, senderAllowed, canReceiveReplies, KIND_ORDER };
