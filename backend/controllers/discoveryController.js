const { supabase } = require('../config/supabase');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail } = require('../utils/responseEnvelope');

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
  id, slug, title, description, venue_name, venue_address,
  country, timezone, starts_at, ends_at, currency,
  listing_type, purchase_mode, category, cover_url, max_tickets_per_order,
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
      const safe = p.q.replace(/[,()\\]/g, ' ').trim();
      if (safe) query = query.or(`title.ilike.%${safe}%,venue_name.ilike.%${safe}%`);
    }

    const { data, error, count } = await query
      .order(p.sort, { ascending })
      .range(p.from, p.to);
    if (error) throw new Error(error.message);

    return sendOk(res, (data || []).map(shape), { pagination: buildMeta(p, count) });
  } catch (err) { return next(err); }
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

    const { data: tiers } = await supabase
      .from('ticket_tiers')
      .select('id, name, description, price_cents')
      .eq('event_id', event.id)
      .order('sort_order');

    return sendOk(res, {
      ...shape(event),
      description: event.description,
      venueAddress: event.venue_address,
      tiers: (tiers || []).map((t) => ({
        id: t.id, name: t.name, description: t.description, priceCents: Number(t.price_cents),
      })),
      availability: await availability(event),
    });
  } catch (err) { return next(err); }
}

/**
 * Available / total, counted across both seats and whole tables.
 *
 * Private tables are counted but not described. Excluding them entirely would
 * make an event with protected tables read as more sold out than it is; naming
 * them would leak exactly what `tableAccessService` exists to hide.
 */
async function availability(event) {
  if (event.listing_type === 'display_only') return null;

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
    maxTicketsPerOrder: e.max_tickets_per_order,
    // The name only. An organizer's email, country of registration and Stripe
    // state are theirs, and none of it belongs on a public page.
    organizer: organizer ? { name: organizer.display_name } : null,
  };
}

module.exports = { listEvents, eventBySlug };
