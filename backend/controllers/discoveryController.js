const { supabase } = require('../config/supabase');
const eventContent = require('../services/eventContentService');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { safeSearch } = require('../utils/search');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Finding an event before you have its link.
 *
 * `/public/events/:slug/seat-map` has always been the only public read, which
 * means the platform could sell a ticket to anyone who already knew the URL and
 * had no way for anyone else to arrive at all. This is the homepage.
 *
 * THE RULE, and it decides every query in this file: only `published` events
 * are visible, and everything else 404s. Draft, pending_review, rejected,
 * suspended and cancelled all look identical from outside — a distinguishable
 * answer would let anyone enumerate slugs and watch an event move through
 * review, or discover that a named organizer was rejected.
 *
 * `display_only` events (BRD §12) DO appear. They are listings without a seat
 * map, which is the whole point of the type — a poster on the platform. They
 * are flagged so a client renders a link rather than a buy button.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SELECT = `
  id, slug, title, description, venue_name, venue_address, city,
  country, timezone, starts_at, ends_at, currency,
  listing_type, purchase_mode, admission_type, category, cover_url, logo_url,
  highlights, venue_lat, venue_lng, max_tickets_per_order,
  updated_at,
  organizers ( display_name )
`;

// `cover_path` is absent on purpose. It is the storage object key, which is the
// dashboard's business; a public listing needs the URL and nothing else.

// ─── GET /public/events ─────────────────────────────────────────────────────
/**
 * Browse. `?q=` searches title and venue, `?country=`, `?from=`/`?to=` bound
 * the dates.
 *
 * Past events are excluded unless `?includePast=true`. Someone browsing wants
 * something to go to; an archive is a different question and answering both by
 * default answers neither.
 */
async function listEvents(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['starts_at', 'created_at', 'title'], defaultSort: 'starts_at',
    });
    // Soonest first is the sensible default for a listing, and `parsePagination`
    // defaults to descending because everywhere else is a newest-first admin
    // table. Flipped here unless the caller asked for an order explicitly.
    const ascending = req.query.order ? p.order === 'asc' : true;

    let query = supabase
      .from('events')
      .select(SELECT, { count: 'exact' })
      .eq('status', 'published');

    if (req.query.includePast !== 'true') {
      // Measured on the END, not the start: an event that began an hour ago is
      // still happening and should still be findable.
      query = query.gte('ends_at', new Date().toISOString());
    }
    if (req.query.country) query = query.eq('country', String(req.query.country).toUpperCase());
    /**
     * City, case-insensitively and exactly.
     *
     * `ilike` without wildcards rather than `eq`: organizers type the city
     * themselves, so "toronto" and "Toronto" are the same place and an `eq`
     * would show one of them an empty listing. Not a prefix match either —
     * `%<city>%` would make "York" match "New York", which is a different city
     * eight hours away.
     *
     * Escaped through the same helper as `q`, because a comma or a parenthesis
     * reaches PostgREST as filter syntax rather than as text.
     */
    if (req.query.city) {
      const safeCity = safeSearch(req.query.city);
      if (safeCity) query = query.ilike('city', safeCity);
    }
    if (req.query.from) query = query.gte('starts_at', new Date(req.query.from).toISOString());
    if (req.query.to) query = query.lte('starts_at', new Date(req.query.to).toISOString());

    // Validated in publicRoutes against the same list the enum was built from,
    // so an unknown value is a 400 naming the categories rather than a Postgres
    // cast error surfacing as a 500 on a public endpoint.
    if (req.query.category) query = query.eq('category', req.query.category);

    if (p.q) {
      // Escaped: a comma or a parenthesis reaches PostgREST as `or()` syntax
      // rather than as text being searched for. Unescaped, `q` is a filter
      // injection point — and on a PUBLIC endpoint that is one anyone can reach.
      const safe = safeSearch(p.q);
      if (safe) query = query.or(`title.ilike.%${safe}%,venue_name.ilike.%${safe}%`);
    }

    const { data, error, count } = await query
      .order(p.sort, { ascending })
      .range(p.from, p.to);
    if (error) throw new Error(error.message);

    const rows = data || [];
    const fromPrices = await lowestTierPrices(rows.map((e) => e.id));

    return sendOk(
      res,
      rows.map((e) => ({ ...shape(e), fromPriceCents: fromPrices.get(e.id) ?? null })),
      { pagination: buildMeta(p, count) },
    );
  } catch (err) { return next(err); }
}

/**
 * The cheapest tier of each event, for the "Tickets from …" button on a card.
 *
 * ONE query for the whole page, not one per event: a listing of twenty would
 * otherwise be twenty-one round trips. These are the same prices the event page
 * already publishes tier by tier, so nothing new is exposed.
 *
 * A failure here costs the price and nothing else — the card falls back to
 * "Get tickets" — because a listing that 500s over a label is worse than a
 * listing without one.
 */
async function lowestTierPrices(eventIds) {
  const lowest = new Map();
  if (eventIds.length === 0) return lowest;

  const { data, error } = await supabase
    .from('ticket_tiers')
    .select('event_id, price_cents')
    .in('event_id', eventIds);
  if (error) return lowest;

  for (const tier of data || []) {
    const price = Number(tier.price_cents);
    if (!Number.isFinite(price)) continue;
    const current = lowest.get(tier.event_id);
    if (current === undefined || price < current) lowest.set(tier.event_id, price);
  }
  return lowest;
}

// ─── GET /public/events/:slug ───────────────────────────────────────────────
/**
 * One event's page.
 *
 * Separate from the seat map on purpose: the page is cacheable, mostly static
 * and wanted by crawlers, while the map is per-viewer, changes as seats are
 * held, and must never be cached. Fetching a whole seat map to render a title
 * would also make every share preview an expensive query.
 *
 * The cheapest useful availability signal is included — whether anything is
 * left — without the seat-by-seat detail, so a listing can show "sold out"
 * without the caller having to fetch the map to find out.
 */
async function eventBySlug(req, res, next) {
  try {
    const { data: event, error } = await supabase
      .from('events')
      .select(SELECT)
      .eq('slug', req.params.slug)
      .eq('status', 'published')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!event) {
      return sendFail(res, {
        status: 404, error: 'EVENT_NOT_FOUND', message: 'That event is not available.',
      });
    }

    const [{ data: tiers }, content] = await Promise.all([
      supabase
        .from('ticket_tiers')
        .select('id, name, description, price_cents, quantity, sold_count, kind, '
              + 'sales_start_at, sales_end_at, max_per_order, is_hidden')
        .eq('event_id', event.id)
        .order('sort_order'),
      eventContent.publicBundle(event.id),
    ]);

    /**
     * A HIDDEN TICKET TYPE IS OMITTED FROM THE LIST, NOT REFUSED.
     *
     * That is what makes comp, press and guest-list tickets work: the organizer
     * sends a link carrying `?tier=<id>`, and the person holding it sees and
     * buys that type while nobody browsing the page does. So a hidden type is
     * filtered out here and added back when it is the one being asked for — and
     * the hold functions deliberately do not refuse it, because refusing it
     * would make the link it exists for useless.
     *
     * This is concealment, not access control. Anyone with the id can buy one,
     * which is exactly the intent; a guest list that needed a password would be
     * a different feature.
     */
    const asked = String(req.query.tier || '');
    const visibleTiers = (tiers || []).filter((t) => !t.is_hidden || t.id === asked);

    return sendOk(res, {
      ...shape(event),
      description: event.description,
      venueAddress: event.venue_address,
      tiers: visibleTiers.map(publicTier),
      availability: await availability(event, tiers || []),
      ...content,
    });
  } catch (err) { return next(err); }
}

/**
 * One ticket type, as a buyer sees it.
 *
 * `onSale` and `soldOut` are worked out here rather than left to the page,
 * because they need different sentences and a client that collapsed them into
 * "unavailable" would tell somebody an early-bird type is gone when it has not
 * opened yet. `remaining` is deliberately absent when the allocation is NULL —
 * that means "bounded by the seat map", and rendering it as 0 shows an event as
 * sold out.
 *
 * The window is recomputed here rather than trusted from anywhere: the database
 * enforces it in `tier_sale_window_closed`, and this is what explains it. If the
 * two ever disagree, the database wins and the buyer meets a refusal.
 */
function publicTier(t, now = new Date()) {
  const quantity = t.quantity === null || t.quantity === undefined ? null : Number(t.quantity);
  const sold = Number(t.sold_count || 0);
  const startsAt = t.sales_start_at ? new Date(t.sales_start_at) : null;
  const endsAt = t.sales_end_at ? new Date(t.sales_end_at) : null;

  return {
    id: t.id,
    name: t.name,
    description: t.description,
    priceCents: Number(t.price_cents),
    kind: t.kind || 'standard',
    free: Number(t.price_cents) === 0,
    hidden: Boolean(t.is_hidden),
    maxPerOrder: t.max_per_order === null || t.max_per_order === undefined
      ? null : Number(t.max_per_order),
    salesStartAt: t.sales_start_at || null,
    salesEndAt: t.sales_end_at || null,
    notYetOnSale: Boolean(startsAt && now < startsAt),
    salesEnded: Boolean(endsAt && now >= endsAt),
    onSale: !(startsAt && now < startsAt) && !(endsAt && now >= endsAt),
    remaining: quantity === null ? null : Math.max(0, quantity - sold),
    soldOut: quantity !== null && sold >= quantity,
  };
}

/**
 * Available / total, counted across both seats and whole tables.
 *
 * Private tables are counted but not described. Excluding them entirely would
 * make an event with protected tables read as more sold out than it is; naming
 * them would leak exactly what `tableAccessService` exists to hide.
 */
async function availability(event, tiers = []) {
  if (event.listing_type === 'display_only') return null;

  /**
   * GENERAL ADMISSION COUNTS TICKET TYPES, not seats — there is no map.
   *
   * A type with a NULL allocation is uncapped, and one uncapped type makes the
   * whole event uncapped: there is always another ticket, so a total would be a
   * number with no meaning and "sold out" can never be true. Reported as nulls
   * rather than as zero, because zero reads as "none left".
   */
  if (event.admission_type === 'general') {
    if (tiers.length === 0) return null;
    const uncapped = tiers.some((t) => t.quantity === null || t.quantity === undefined);
    if (uncapped) return { seatsTotal: null, seatsAvailable: null, soldOut: false };

    const total = tiers.reduce((n, t) => n + Number(t.quantity), 0);
    const sold = tiers.reduce((n, t) => n + Number(t.sold_count || 0), 0);
    return {
      seatsTotal: total,
      seatsAvailable: Math.max(0, total - sold),
      soldOut: total > 0 && sold >= total,
    };
  }

  const { data: map } = await supabase
    .from('venue_maps').select('id').eq('event_id', event.id).maybeSingle();
  if (!map) return null;

  const [{ count: total }, { count: free }] = await Promise.all([
    supabase.from('seats').select('id', { count: 'exact', head: true })
      .eq('venue_map_id', map.id),
    supabase.from('seats').select('id', { count: 'exact', head: true })
      .eq('venue_map_id', map.id).eq('status', 'available'),
  ]);

  return {
    seatsTotal: Number(total) || 0,
    seatsAvailable: Number(free) || 0,
    soldOut: (Number(total) || 0) > 0 && (Number(free) || 0) === 0,
  };
}

function shape(e) {
  const organizer = Array.isArray(e.organizers) ? e.organizers[0] : e.organizers;
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    venue: e.venue_name,
    city: e.city || null,
    country: e.country,
    timezone: e.timezone,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    /**
     * When the listing itself last changed, for `<lastmod>` in the sitemap.
     *
     * A sitemap without it asks a crawler to re-fetch every event on every pass
     * to find out whether anything moved — which on a catalogue of a few
     * thousand is most of the crawl budget spent on pages that did not change,
     * and the ones that did are found late.
     *
     * Nothing private is exposed by it: an event's edit time is visible on the
     * page anyway the moment the date or the price is different.
     */
    updatedAt: e.updated_at,
    currency: e.currency,
    category: e.category,
    // Null is a normal answer — an event may publish without artwork. The
    // listing renders a typographic placeholder from the title rather than a
    // broken image or a stock photo of a crowd that is not this crowd.
    coverUrl: e.cover_url,
    // BRD §12 — a listing with no tickets behind it. Flagged rather than
    // omitted, so a client renders a link instead of a dead buy button.
    displayOnly: e.listing_type === 'display_only',
    purchaseMode: e.purchase_mode,
    // Whether this event has a seat map at all. A buyer's page branches on it
    // to choose between a seat picker and a quantity picker.
    admissionType: e.admission_type || 'reserved',
    logoUrl: e.logo_url || null,
    highlights: Array.isArray(e.highlights) ? e.highlights : [],
    venueLocation: e.venue_lat === null || e.venue_lat === undefined
      ? null : { lat: Number(e.venue_lat), lng: Number(e.venue_lng) },
    maxTicketsPerOrder: e.max_tickets_per_order,
    // The name only. An organizer's email, country of registration and Stripe
    // state are theirs, and none of it belongs on a public page.
    organizer: organizer ? { name: organizer.display_name } : null,
  };
}

module.exports = { listEvents, eventBySlug };
