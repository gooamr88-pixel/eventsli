const { supabase } = require('../config/supabase');
const { addressFields } = require('../utils/venueAddress');
const eventContent = require('../services/eventContentService');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { safeSearch, textFilter } = require('../utils/search');
const logger = require('../utils/logger');
const categoryService = require('../services/categoryService');
const ticketDetails = require('../services/ticketDetails');
const purchasability = require('../services/purchasability');
const eventAccess = require('../services/eventAccess');

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
  venue_address_line2, venue_region, venue_postal_code, venue_directions,
  country, timezone, starts_at, ends_at, currency,
  listing_type, purchase_mode, admission_type, category, cover_url, logo_url,
  highlights, venue_lat, venue_lng, max_tickets_per_order,
  accepts_stripe, accepts_manual, coming_soon, organizer_id,
  is_private, access_password_set_at, access_password_min, access_password_max,
  locked_preview, locked_reveal,
  updated_at,
  organizers ( display_name, country ),
  event_categories ( label )
`;
// `country` is read only to decide whether card checkout is on for the event
// (services/purchasability.js). `shape` never returns it.
// `event_categories ( label )`: the label the admin gave the category, so every
// card names it the way the homepage tabs and /events filters do. It was named
// from a hard-coded map in the browser, which disagreed with the database for
// three of thirteen categories and never learned a renamed or added one.

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
async function listEvents(req, res, next, { phraseSearch = false } = {}) {
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

    /**
     * PRIVATE EVENTS ON THE LISTINGS, BLURRED (owner, 2026-11-23): "the point
     * of the blurry image is to list it on the main events page, but nobody
     * can see the details — only the organizer name, the date and the event
     * name". At first only the blurred page (`locked_preview = 'blur'`) was
     * listed. EVERY PRIVATE EVENT IS LISTED since 2026-11-24 (owner: "also
     * with the password only, make it appear"): one behind the plain
     * password box ('card') shows the same locked card — name, organizer,
     * date, the cover blurred unless they chose to show it — and nothing
     * more (`lockedListing`).
     *
     * Only when the caller asks (`?withPrivate=true`: the homepage and
     * /events) and only on a listing no hidden fact could have matched. A
     * private event under "?city=Toronto", a category, a price or a text
     * search (which reads the venue and description) would tell anyone its
     * city, its kind, its price or its words. A date range is fine: the date
     * is shown. Saved slugs never: a saved private event is reopened by link.
     */
    const withPrivate = req.query.withPrivate === 'true'
      && !PRIVATE_REVEALING_FILTERS.some((key) => req.query[key] !== undefined && req.query[key] !== '');
    // Asked for, and safe to: public and private alike. Otherwise public only.
    if (!withPrivate) query = query.eq('is_private', false);

    if (req.query.includePast !== 'true') {
      // Measured on the END, not the start: an event that began an hour ago is
      // still happening and should still be findable.
      query = query.gte('ends_at', new Date().toISOString());
    }
    /**
     * SAVED EVENTS — the slugs a browser is holding, resolved in one request.
     *
     * The alternative was a request per saved event from the client, which on
     * a list of twenty is twenty round trips on a phone to draw one page.
     *
     * Three things this deliberately does NOT do:
     *
     *   · It does not report which slugs were missing. An event that was
     *     unpublished, cancelled or renamed simply does not come back, and the
     *     saved page drops it — that is the correct outcome and saying more
     *     would turn this into a way to test whether a given slug is live.
     *   · It does not bypass `status = 'published'` above. A saved draft is not
     *     a back door into an unpublished event.
     *   · It does not widen the date filter. A caller that wants past saved
     *     events asks for `includePast=true` like any other caller.
     *
     * Capped at 200, matching the client's own MAX_SAVED, and de-duplicated so
     * a repeated slug cannot multiply the filter.
     */
    if (req.query.slugs) {
      const slugs = [...new Set(
        String(req.query.slugs).split(',').map((s) => s.trim()).filter(Boolean),
      )].slice(0, 200);

      // An empty list must match NOTHING, not everything. Without this a
      // `?slugs=,,,` returns the whole catalogue as "your saved events".
      // `buildMeta` rather than a hand-written object, so an empty answer has
      // the same envelope as a full one and no client needs a special case.
      if (slugs.length === 0) return sendOk(res, [], { pagination: buildMeta(p, 0) });
      query = query.in('slug', slugs);
    }

    /**
     * "TICKETS ON SALE" — only events whose tickets are sold here (owner,
     * 2026-11-15). A display-only listing (BRD §12) is information about an
     * event, not a place to buy for it, so this filter leaves it out. Sold-out
     * events stay in: excluding them needs availability per event, and the
     * card already says "Sold out" on its own.
     */
    // A "coming soon" teaser is not on sale yet either (owner, 2026-11-17).
    if (req.query.onSale === 'true') query = query.eq('listing_type', 'ticketed').eq('coming_soon', false);

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
      // "City and address" (owner, 2026-11-19): the same exact city match, OR
      // a street address containing the words, so "Polson St" finds the venue.
      // A teaser's address is not public yet, so it matches by city only.
      if (safeCity) query = query.or(`city.ilike.${safeCity},and(coming_soon.eq.false,venue_address.ilike.%${safeCity}%)`);
    }
    if (req.query.from) query = query.gte('starts_at', new Date(req.query.from).toISOString());
    if (req.query.to) query = query.lte('starts_at', new Date(req.query.to).toISOString());

    // Validated in publicRoutes against the same list the enum was built from,
    // so an unknown value is a 400 naming the categories rather than a Postgres
    // cast error surfacing as a 500 on a public endpoint.
    if (req.query.category) query = query.eq('category', req.query.category);

    /**
     * `?maxPrice=` (cents): events with at least one ticket type a buyer can
     * see at or under that price — "under $40", and `0` for "free" (smart
     * search). Hidden types are excluded for the same reason they are excluded
     * from "From $…" (see `lowestTierPrices`): a price nobody browsing can pay
     * is not an answer to "how much". A listing that sells nothing has no price
     * and does not match a price filter.
     */
    if (req.query.maxPrice !== undefined) {
      const { data: cheap, error: priceError } = await supabase
        .from('ticket_tiers')
        .select('event_id')
        .eq('is_hidden', false)
        .lte('price_cents', Number(req.query.maxPrice))
        .limit(2000);
      if (priceError) throw new Error(priceError.message);
      const ids = [...new Set((cheap || []).map((t) => t.event_id))];
      if (ids.length === 0) return sendOk(res, [], { pagination: buildMeta(p, 0) });
      // A teaser has no announced price, so it answers no price question.
      query = query.in('id', ids).eq('coming_soon', false);
    }

    if (p.q) {
      // Escaped: a comma or a parenthesis reaches PostgREST as `or()` syntax
      // rather than as text being searched for. Unescaped, `q` is a filter
      // injection point — and on a PUBLIC endpoint that is one anyone can reach.
      const safe = safeSearch(p.q);
      if (safe) {
        // A search for "comedy" finds the comedy events, not only the ones that
        // say "comedy" in their title. Matched against the admin's own labels
        // and slugs, so it follows a renamed or added category.
        const term = String(p.q).trim().toLowerCase();
        const matched = term.length >= 3
          ? (await categoryService.list({ enabledOnly: true }))
            .filter((c) => c.slug.includes(term.replace(/\s+/g, '_')) || c.label.toLowerCase().includes(term))
            .map((c) => c.slug)
          : [];
        const byCategory = matched.length ? `,category.in.(${matched.join(',')})` : '';
        const filter = phraseSearch
          ? `title.ilike.%${safe}%,venue_name.ilike.%${safe}%${byCategory}`
          : textFilter(safe, matched);
        if (filter) query = query.or(filter);
      }
    }

    /**
     * TICKETED FIRST (owner, 2026-11-17): the homepage's Popular events showed
     * the eight soonest, so an event that sells tickets here but starts later
     * than eight display-only posters never appeared. Events on sale here lead,
     * a teaser next, then the listings — each group soonest first.
     * 'ticketed' sorts after 'display_only', hence descending.
     */
    if (req.query.ticketedFirst === 'true') {
      query = query.order('listing_type', { ascending: false }).order('coming_soon', { ascending: true });
    }

    const { data, error, count } = await query
      .order(p.sort, { ascending })
      .range(p.from, p.to);
    if (error && p.q && !phraseSearch) {
      // The word-by-word filter nests and/or; should the database API ever
      // refuse that form, search falls back to the old whole-phrase match
      // rather than failing the public listing. Logged so it is seen.
      logger.warn({ err: error.message }, 'search: word filter refused, falling back to phrase search');
      return listEvents(req, res, next, { phraseSearch: true });
    }
    if (error) throw new Error(error.message);

    const rows = data || [];
    // A private row's prices and seats are details behind its password.
    const open = rows.filter((e) => e.is_private !== true);
    const [fromPrices, avail] = await Promise.all([lowestTierPrices(open), listingAvailability(open)]);

    return sendOk(
      res,
      rows.map((e) => (e.is_private === true
        ? lockedListing(e)
        : { ...shape(e), fromPriceCents: fromPrices.get(e.id) ?? null, availability: avail.get(e.id) ?? null })),
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HIDDEN TIERS ARE EXCLUDED, and leaving them in was a lie on the busiest
 * screen in the product.
 *
 * `eventBySlug` filters `is_hidden` out of the tiers it publishes — a hidden
 * tier is one only somebody with its direct link may buy, which is the whole
 * point of the flag. This function did not, so a card could advertise "From
 * $100" for a price that is not on the event page, is not offered at checkout,
 * and that nobody arriving from that card can pay. It was found in production:
 * an event whose only tier was hidden read "From $100" on the homepage and
 * charged $0.00 at the till.
 *
 * The honest answer when every tier is hidden is NO PRICE — the card falls back
 * to "Get tickets" — not the cheapest thing a buyer cannot have.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function lowestTierPrices(events) {
  const lowest = new Map();
  /**
   * Rows or bare ids. Given rows, a "coming soon" teaser is left out: its
   * ticket types are still being prepared, so "From $40" on its card would be
   * a price nobody can pay yet and the organizer has not announced.
   */
  const eventIds = (events || [])
    .filter((e) => typeof e === 'string' || e?.coming_soon !== true)
    .map((e) => (typeof e === 'string' ? e : e.id));
  if (eventIds.length === 0) return lowest;

  // The cheapest thing a buyer can actually take — see `event_from_prices`
  // (TECH-AUDIT-LOG S-11). It was the cheapest visible ticket type, used by a
  // seat or not, on sale or not, sold out or not: the listing that advertised
  // "From $100" over seats priced at nothing read exactly this.
  const { data, error } = await supabase.rpc('event_from_prices', { p_event_ids: eventIds });
  // A listing without a price beats a listing that fails; the card says
  // "price on the event page".
  if (error) return lowest;

  for (const row of data || []) {
    const price = Number(row.from_cents);
    if (Number.isFinite(price)) lowest.set(row.event_id, price);
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

    /**
     * A PRIVATE EVENT ASKS FOR ITS PASSWORD FIRST (2026-11-22). Locked, the
     * answer is the title, cover and organizer only (eventAccess.lockedTeaser).
     * Unlocked, it is the full page — per viewer, so never cached by anyone.
     */
    if (event.is_private) {
      res.set('Cache-Control', 'private, no-store');
      if (!(await eventAccess.allowed(req, event))) return eventAccess.sendLocked(req, res, event);
    }

    /**
     * A "COMING SOON" TEASER SHOWS WHAT IT WAS PUBLISHED WITH, and nothing the
     * organizer is still preparing: no ticket types, no prices, no venue, no
     * availability. Those are drafts until sales open, and showing a half-set
     * price list on a public page would be showing a promise nobody made.
     */
    if (event.coming_soon) {
      const content = await eventContent.publicBundle(event.id);
      return sendOk(res, {
        ...shape(event),
        payments: { card: false, manual: false },
        purchasable: false,
        description: event.description,
        venueAddress: null,
        venueAddressLine2: null, venueRegion: null, venuePostalCode: null, venueDirections: null, venueAddressFull: null,
        tiers: [],
        availability: null,
        organizerProfile: await require('../services/organizerProfileService').linkFor(event.organizer_id),
        ...content,
      });
    }

    const [{ data: tiers }, content, organizerProfile, addons] = await Promise.all([
      supabase
        .from('ticket_tiers')
        .select('id, name, description, price_cents, quantity, sold_count, kind, '
              + 'sales_start_at, sales_end_at, max_per_order, is_hidden, details')
        .eq('event_id', event.id)
        .order('sort_order'),
      eventContent.publicBundle(event.id),
      // The organizer's public page (2026-11-18); null if it cannot be read.
      require('../services/organizerProfileService').linkFor(event.organizer_id),
      // The add-ons, shown with the tickets BEFORE checkout (owner, 2026-11-22).
      // Never fatal: a database without the add-ons table still shows the event.
      require('../services/addonService').listForBuyer(event.id).catch((err) => {
        logger.warn({ err: err.message, eventId: event.id }, 'public event: add-ons unreadable');
        return [];
      }),
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

    // Whether a buyer can get tickets here online at all (global launch). The
    // page hides Buy when not, rather than letting someone into a checkout that
    // ends in "this event does not take card payments".
    const ways = await purchasability.forEvent(event, { tiers: tiers || [] });
    const shaped = shape(event);

    return sendOk(res, {
      ...shaped,
      // `manual` means a buyer can reserve and pay the organizer online — phase 2.
      // Accepting door payments is not that, so it no longer shows a badge.
      payments: { card: ways.card, manual: ways.offline },
      purchasable: ways.online,
      description: event.description,
      venueAddress: event.venue_address,
      tiers: visibleTiers.map((t) => ({ ...publicTier(t), details: ticketDetails.present(event.id, t.details) })),
      availability: await availability(event, tiers || []),
      organizerProfile,
      addons,
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
    return withPace({
      seatsTotal: total,
      seatsAvailable: Math.max(0, total - sold),
      soldOut: total > 0 && sold >= total,
    });
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

  return withPace({
    seatsTotal: Number(total) || 0,
    seatsAvailable: Number(free) || 0,
    soldOut: (Number(total) || 0) > 0 && (Number(free) || 0) === 0,
  });
}

/**
 * "SELLING FAST" (owner, 2026-11-18): four in five gone and not yet sold out.
 * Only where the count is real — an uncapped event has no total, and a claim
 * of scarcity there would be invented.
 */
const SELLING_FAST_SHARE = 0.2;
function withPace(a) {
  const total = Number(a.seatsTotal) || 0;
  return {
    ...a,
    sellingFast: !a.soldOut && total > 0 && Number(a.seatsAvailable) / total <= SELLING_FAST_SHARE,
  };
}

/**
 * Availability for a page of cards (2026-11-18) — the same answer the event
 * page gives, so a card can say "Sold out" or "Selling fast".
 *
 * Batched: ONE tier query for every general-admission event; seated events
 * count their map (two head counts each, in parallel). Left out: display-only
 * listings, coming-soon teasers and past events — none has anything to sell.
 * A failure costs the tags, never the listing.
 */
async function listingAvailability(rows) {
  const out = new Map();
  const live = (rows || []).filter((e) => e.listing_type !== 'display_only' && e.coming_soon !== true && !isPastRow(e));
  if (live.length === 0) return out;
  try {
    const general = live.filter((e) => e.admission_type === 'general');
    const tiersBy = new Map();
    if (general.length) {
      const { data, error } = await supabase.from('ticket_tiers')
        .select('event_id, quantity, sold_count').in('event_id', general.map((e) => e.id));
      if (error) throw new Error(error.message);
      for (const t of data || []) tiersBy.set(t.event_id, [...(tiersBy.get(t.event_id) || []), t]);
    }
    const answers = await Promise.all(live.map((e) => availability(e, tiersBy.get(e.id) || []).catch(() => null)));
    live.forEach((e, i) => { if (answers[i]) out.set(e.id, answers[i]); });
  } catch (err) {
    logger.warn({ err: err.message }, 'listing availability failed; cards go without sold-out tags');
  }
  return out;
}

/** Over: its end has passed — or its start, when it has no end. */
function isPastRow(e) {
  const end = e.ends_at || e.starts_at;
  if (!end) return false;
  const t = new Date(end).getTime();
  return Number.isFinite(t) && t < Date.now();
}

/** The query parameters that would match a private event on a fact it hides. */
const PRIVATE_REVEALING_FILTERS = Object.freeze(['q', 'city', 'country', 'category', 'maxPrice', 'onSale', 'slugs']);

/**
 * A private event as a LISTING shows it (owner, 2026-11-23): its name, its
 * organizer and its date, over a blurred cover — and nothing else is sent.
 * Not the venue, the city, the price, the category or the description, so
 * there is nothing for a browser's inspector to find under the blur.
 *
 * The cover follows the event page: blurred from the 24-pixel copy
 * (`/locked-cover`) unless the organizer chose to show it.
 */
function lockedListing(e) {
  const organizer = Array.isArray(e.organizers) ? e.organizers[0] : e.organizers;
  const coverShown = eventAccess.cleanReveal(e.locked_reveal).includes('cover');
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    isPrivate: true,
    // How the card is drawn (2026-11-24): 'blur' blurred, 'card' — the
    // password box only — plain, its shown cover sharp.
    lockedPreview: e.locked_preview === 'card' ? 'card' : 'blur',
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    timezone: e.timezone,
    isPast: isPastRow(e),
    organizer: organizer ? { name: organizer.display_name } : null,
    coverUrl: coverShown ? e.cover_url || null : null,
    blurredCover: !coverShown && Boolean(e.cover_url),
    comingSoon: false,
    displayOnly: false,
    venue: null,
    city: null,
    venueAddress: null,
    category: null,
    categoryLabel: null,
    fromPriceCents: null,
    availability: null,
  };
}

function shape(e) {
  const organizer = Array.isArray(e.organizers) ? e.organizers[0] : e.organizers;
  const category = Array.isArray(e.event_categories) ? e.event_categories[0] : e.event_categories;
  // A "coming soon" teaser (20261124090000) is announced with a city and a
  // month. Its venue and exact times may already be typed in while the
  // organizer prepares, but they are not public until sales open.
  const teaser = e.coming_soon === true;
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    comingSoon: teaser,
    venue: teaser ? null : e.venue_name,
    city: e.city || null,
    // The street address, for the /events card (2026-11-19). Hidden on a teaser.
    venueAddress: teaser ? null : (e.venue_address || null),
    // The rest of the address (2026-11-22, all optional). Hidden on a teaser.
    ...(teaser
      ? { venueAddressLine2: null, venueRegion: null, venuePostalCode: null, venueDirections: null, venueAddressFull: null }
      : addressFields(e)),
    country: e.country,
    timezone: e.timezone,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    // Over (2026-11-18): the card says "Past event" instead of selling it.
    isPast: isPastRow(e),
    // Only ever true on a page the viewer unlocked (2026-11-22) — a listing
    // sends a private event as `lockedListing` instead, never through here.
    // The page uses it to keep itself unindexed.
    isPrivate: e.is_private === true,
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
    categoryLabel: category?.label || null,
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
    venueLocation: teaser || e.venue_lat === null || e.venue_lat === undefined
      ? null : { lat: Number(e.venue_lat), lng: Number(e.venue_lng) },
    maxTicketsPerOrder: e.max_tickets_per_order,
    // How a buyer can pay, for the seat page's payment badges (2026-11-10).
    // Card follows checkoutController: refused only when accepts_stripe is
    // false. Manual is the organizer's own e-Transfer, bank or cash methods.
    payments: teaser
      ? { card: false, manual: false }
      : { card: e.accepts_stripe !== false, manual: e.accepts_manual === true },
    // The name only. An organizer's email, country of registration and Stripe
    // state are theirs, and none of it belongs on a public page.
    organizer: organizer ? { name: organizer.display_name } : null,
  };
}

// SELECT, shape and lowestTierPrices are shared with "near you"
// (landingController.eventsNear), so a nearby card is the same card as a listed one.
module.exports = { listEvents, eventBySlug, SELECT, shape, lockedListing, lowestTierPrices, listingAvailability };
