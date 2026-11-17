const { supabase } = require('../config/supabase');
const markets = require('./marketsService');
const { cardEnabledFor } = require('../utils/markets');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CAN A BUYER GET TICKETS FOR THIS EVENT ONLINE, RIGHT NOW? (global launch, phase 1)
 *
 * The event page's Buy button and the seat-hold endpoint both ask this, so a
 * buyer is never let into a checkout that ends in "this event does not take
 * card payments". One answer, from:
 *
 *   card     the event takes cards AND card checkout is switched on for the
 *            organizer's country (utils/markets.js — CA and US by default)
 *   offline  a buyer can reserve and pay the organizer (phase 2; off until
 *            `offline_checkout.enabled` and the event accepts manual payment)
 *   free     every ticket is free, so there is nothing to pay
 *
 * `online` is any of the three. A display-only listing is never bought here.
 *
 * Whether the organizer's Stripe account is fully set up is NOT asked here: it
 * is private, it is checked on every checkout (stripeService.organizerCanReceive)
 * and that refusal has existed in CA and US all along. This is about whether the
 * platform offers a way to pay at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The organizer's country, from an embedded `organizers` row or a lookup. */
async function organizerCountry(event) {
  const embedded = Array.isArray(event.organizers) ? event.organizers[0] : event.organizers;
  if (embedded?.country) return embedded.country;
  if (!event.organizer_id) return null;
  const { data } = await supabase.from('organizers').select('country').eq('id', event.organizer_id).maybeSingle();
  return data?.country || null;
}

/** Is every ticket free? Tiers may be passed in when the caller already has them. */
async function isFree(event, tiers) {
  const prices = tiers
    ? tiers.map((t) => ({ priceCents: Number(t.price_cents ?? t.priceCents) }))
    : ((await supabase.from('ticket_tiers').select('price_cents').eq('event_id', event.id)).data || [])
      .map((t) => ({ priceCents: Number(t.price_cents) }));
  if (prices.length === 0 || prices.some((t) => t.priceCents > 0)) return false;
  const { data: map } = await supabase.from('venue_maps').select('id').eq('event_id', event.id).maybeSingle();
  if (!map) return true;
  const { data: tables } = await supabase.from('tables').select('price_cents').eq('venue_map_id', map.id);
  return !(tables || []).some((t) => t.price_cents !== null && Number(t.price_cents) > 0);
}

/** Does the event's organizer have an active payment method buyers can use? */
async function hasActiveMethod(event) {
  let organizerId = event.organizer_id;
  if (!organizerId) {
    const { data } = await supabase.from('events').select('organizer_id').eq('id', event.id).maybeSingle();
    organizerId = data?.organizer_id;
  }
  if (!organizerId) return false;
  const { count } = await supabase.from('organizer_payment_methods')
    .select('id', { count: 'exact', head: true }).eq('organizer_id', organizerId).eq('is_active', true);
  return (count || 0) > 0;
}

/** Is the phase 2 offline checkout switched on for the platform? */
async function offlineCheckoutOn() {
  const { data } = await supabase
    .from('platform_settings').select('value').eq('key', 'offline_checkout').maybeSingle();
  return data?.value?.enabled === true;
}

/**
 * @param {object} event  needs id, listing_type, accepts_stripe, accepts_manual,
 *                        and organizer_id or an embedded organizers(country)
 * @param {object} [opts]
 * @param {object[]} [opts.tiers]  the event's tiers, if already loaded
 * @returns {Promise<{ card: boolean, offline: boolean, free: boolean, online: boolean }>}
 */
async function forEvent(event, { tiers } = {}) {
  if (!event || event.listing_type === 'display_only') {
    return { card: false, offline: false, free: false, online: false };
  }
  const [country, setting, offlineOn] = await Promise.all([
    organizerCountry(event),
    markets.currencySetting(),
    event.accepts_manual === true ? offlineCheckoutOn() : Promise.resolve(false),
  ]);
  const card = event.accepts_stripe !== false && cardEnabledFor(country, setting);
  // Offline needs somewhere to send the money: at least one active method.
  const offline = offlineOn && event.accepts_manual === true && (await hasActiveMethod(event));
  const free = card || offline ? false : await isFree(event, tiers);
  return { card, offline, free, online: card || offline || free };
}

module.exports = { forEvent, isFree, offlineCheckoutOn };
