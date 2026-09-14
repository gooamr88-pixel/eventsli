const QRCode = require('qrcode');
const { supabase } = require('../config/supabase');
const links = require('./shareLinks');

/**
 * Share & QR for one event: the event page, and a deep link per ticket type.
 *
 * Every URL is built from the event's own slug and a tier id this module has
 * confirmed belongs to that event. See shareLinks.js for why nothing a browser
 * sends is ever encoded.
 */

// Screen preview, and a size that survives being printed on a poster.
const SIZES = Object.freeze({ sm: 360, lg: 1200 });

async function loadEvent(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, title, status, listing_type, currency')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function shareInfo(eventId) {
  const event = await loadEvent(eventId);
  if (!event) return null;

  const { data: tiers, error } = await supabase
    .from('ticket_tiers')
    .select('id, name, description, price_cents, quantity, sort_order')
    .eq('event_id', eventId)
    .order('sort_order')
    .order('created_at');
  if (error) throw new Error(error.message);

  const origin = links.siteOrigin();
  return {
    currency: event.currency,
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
      status: event.status,
      // Only a published event answers at its URL; every other state is a 404
      // to the public. Said, so a poster is not printed for a page nobody sees.
      live: event.status === 'published',
      url: links.eventUrl(event.slug, origin),
    },
    // A ticket-type link means nothing on a listing that sells no tickets.
    tiers: event.listing_type === 'display_only' ? [] : (tiers || []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      priceCents: Number(t.price_cents),
      quantity: t.quantity,
      url: links.tierUrl(event.slug, t.id, origin),
    })),
  };
}

/**
 * What a QR request encodes, or null when the tier is not this event's.
 *
 * Null for a foreign tier rather than a fallback to the event link: silently
 * encoding something other than what was asked for is how a poster ends up
 * pointing at the wrong thing.
 */
async function resolveTarget(eventId, tierId = null) {
  const event = await loadEvent(eventId);
  if (!event) return null;
  const origin = links.siteOrigin();

  if (!tierId) {
    return { url: links.eventUrl(event.slug, origin), filename: links.qrFilename(event.slug) };
  }
  if (event.listing_type === 'display_only') return null;

  const { data: tier, error } = await supabase
    .from('ticket_tiers')
    .select('id, name')
    .eq('id', tierId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!tier) return null;

  return {
    url: links.tierUrl(event.slug, tier.id, origin),
    filename: links.qrFilename(event.slug, tier.name),
  };
}

function renderPng(url, size = 'sm') {
  return QRCode.toBuffer(url, {
    type: 'png',
    // M, not L: a poster gets folded, taped over and photographed at an angle.
    errorCorrectionLevel: 'M',
    margin: 2,
    width: SIZES[size] || SIZES.sm,
    color: { dark: '#0E1613', light: '#FFFFFF' },
  });
}

module.exports = { shareInfo, resolveTarget, renderPng, SIZES };
