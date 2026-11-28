import { Suspense } from 'react';
import Link from 'next/link';
import { serverFetch } from '../utils/apiClient';
import EventGridCard from './EventGridCard';
import QuickFilters from './QuickFilters';
import { categoryLabel } from '../lib/categories';
import NavIcon from '../components/shell/NavIcon';
import EventsSearch from './EventsSearch';
import { parseSearch, withoutPhrase, safeTimeZone } from '../lib/smartSearch';

/**
 * Browse.
 *
 * Filters live in the URL, not in component state, and every control is a
 * `<Link>` rather than a button with an onChange. Three things follow from
 * that, all of which a client-side filter would cost: a filtered view is
 * shareable, the back button walks the filters, and this page renders on the
 * server with no JavaScript at all.
 */
export const revalidate = 60;

export const metadata = {
  title: 'Events',
  description: 'Concerts, festivals, conferences and sports, near you and around the world.',
};

/** Display names for the API's enum — see lib/categories.js. */
const label = categoryLabel;

async function load(params) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.category) query.set('category', params.category);
  if (params.country) query.set('country', params.country);
  // `city` and `from` arrive from the homepage's search bar. Forwarded rather
  // than dropped: a filter the URL carries and the page ignores is worse than
  // no filter, because the reader believes it applied.
  if (params.city) query.set('city', params.city);
  if (params.from) query.set('from', params.from);
  // `to` was dropped here, so "This weekend" (from + to) listed everything
  // from Friday onwards. Forwarded now, like every other filter.
  if (params.to) query.set('to', params.to);
  if (Number.isInteger(params.maxPrice)) query.set('maxPrice', String(params.maxPrice));
  // "Tickets on sale" (2026-11-15): only events sold here.
  if (params.onSale) query.set('onSale', 'true');
  query.set('limit', String(PAGE_SIZE));
  /**
   * PAGES (2026-11-24, "new events not appearing"). The listing asked for
   * the first 24 soonest events and offered no way past them, so once more
   * than 24 were on, every event dated after the 24th — which is where a
   * newly created one usually lands — was on no page of /events at all.
   */
  if (params.page > 1) query.set('page', String(params.page));
  // Blurred private events (owner, 2026-11-23). The API lists them only when
  // no filter could match a detail they hide (city, category, price, search).
  query.set('withPrivate', 'true');
  // Completed events stay listed, after the upcoming ones (owner, 2026-11-28),
  // and every card carries its sponsors and vendors.
  query.set('withPast', 'true');
  query.set('withPartners', 'true');

  try {
    const [body, categories] = await Promise.all([
      serverFetch(`/public/events?${query}`, { tags: ['events:published'], revalidate: 60, raw: true }),
      serverFetch('/public/event-categories', { tags: ['event-categories'], revalidate: 3600 }),
    ]);
    const events = body?.data;
    return {
      events: Array.isArray(events) ? events : [],
      // { page, limit, total, totalPages } — absent from an older API, when
      // a full page is taken to mean there may be another.
      pagination: body?.pagination || null,
      // `labelled` carries the name an admin gave the category. The bare
      // `categories` array of slugs is still returned by the API and is the
      // fallback — a deployment where the two disagree renders titlecased
      // slugs rather than nothing.
      categories: categories?.labelled
        || (categories?.categories || []).map((slug) => ({ slug, label: label(slug) })),
      failed: false,
    };
  } catch {
    // An API hiccup costs the listing, not the page. The filters still render,
    // so the visitor has something to do other than reload.
    return { events: [], categories: [], pagination: null, failed: true };
  }
}

/** Events per page, and the API's page size for this listing. */
const PAGE_SIZE = 24;

/** A calendar date, or an instant (what "This weekend" and smart search send). */
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const dateParam = (v) => (typeof v === 'string' && DATE_PARAM.test(v) && !Number.isNaN(Date.parse(v)) ? v : '');

/**
 * SMART SEARCH (lib/smartSearch.js): "jazz this weekend in Toronto under $40"
 * becomes a category, a date range, a city and a price, and only "jazz" is
 * searched as text. Read against the cities that have events and the live
 * categories, both cached for an hour, so half-typed words are not filters.
 * Outside the component because it reads the clock.
 */
async function understand(q, tz, categories) {
  if (!q) return null;
  let cities = [];
  try {
    const data = await serverFetch('/public/cities', { tags: ['events:published'], revalidate: 3600 });
    cities = (data?.cities || []).map((c) => c.city);
  } catch { /* no cities: the rest of the query is still read */ }
  return parseSearch(q, { now: new Date(), timeZone: tz, cities, categories });
}

async function liveCategories() {
  try {
    const data = await serverFetch('/public/event-categories', { tags: ['event-categories'], revalidate: 3600 });
    return data?.labelled || [];
  } catch {
    return [];
  }
}

export default async function EventsPage({ searchParams }) {
  const params = await searchParams;
  const active = typeof params.category === 'string' ? params.category : null;
  const q = typeof params.q === 'string' ? params.q : '';
  const city = typeof params.city === 'string' ? params.city : '';
  // Only a `yyyy-mm-dd` gets through. The value arrives from a URL anyone can
  // edit and is forwarded to an API that validates it — but a malformed one
  // would come back as a 400 for the whole listing, so the page drops it and
  // shows everything rather than showing an error about a date.
  // Instants are allowed too: "This weekend" sends them, and dropping them
  // made that chip filter nothing on this page.
  const from = dateParam(params.from);
  const to = dateParam(params.to);
  const tz = safeTimeZone(params.tz);
  const onSale = params.onSale === 'true';
  const page = Math.min(Math.max(Number.parseInt(params.page, 10) || 1, 1), 500);

  const smart = await understand(q, tz, await liveCategories());
  const effective = {
    q: smart ? smart.keywords : q,
    category: active || smart?.category || null,
    city: city || smart?.city || '',
    from: from || smart?.from || '',
    to: to || smart?.to || '',
    maxPrice: smart?.maxPriceCents ?? null,
    onSale,
  };

  let { events, categories, failed, pagination } = await load({ ...effective, country: params.country, page });

  /**
   * NEVER WORSE THAN A PLAIN SEARCH. When what smart search understood finds
   * nothing — "gala" read as the Galas category, for an evening filed under
   * Arts — the words are searched exactly as typed, with only the filters the
   * reader set explicitly, and the page says that is what it did.
   */
  let relaxed = false;
  if (smart?.understood.length && events.length === 0 && !failed) {
    const plain = await load({ q, category: active, city, from, to, onSale, country: params.country, page });
    if (plain.events.length > 0) ({ events, categories, failed, pagination } = { ...plain, categories: plain.categories.length ? plain.categories : categories });
    relaxed = plain.events.length > 0;
  }

  /** Every link on this page keeps the filters already applied. */
  const href = (category) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (city) next.set('city', city);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (params.tz) next.set('tz', tz);
    if (category) next.set('category', category);
    if (onSale) next.set('onSale', 'true');
    const s = next.toString();
    return s ? `/events?${s}` : '/events';
  };

  /** What the reader filtered by, in words, so it can be shown and undone. */
  const applied = smart && !relaxed ? [
    // What smart search understood, each removable on its own: the chip's
    // link is the same query with that phrase taken out.
    // Removing the words keeps the filters they came with \u2014 except a genre
    // ("jazz"), which is both the words and the category, and goes with them.
    smart.keywords && {
      label: `\u201c${smart.keywords}\u201d`,
      key: 'q',
      href: without('q', smart.understood
        .filter((u) => !smart.keywords.split(' ').includes(u.phrase))
        .map((u) => u.phrase).join(' ')),
    },
    ...smart.understood.map((u) => ({ label: u.label, key: `smart-${u.key}`, href: without('q', withoutPhrase(q, u.phrase)) })),
    city && { label: `in ${city}`, key: 'city' },
    from && { label: `from ${from.slice(0, 10)}`, key: 'from' },
    onSale && { label: 'Tickets on sale', key: 'onSale' },
  ].filter(Boolean) : [
    q && { label: `\u201c${q}\u201d`, key: 'q' },
    city && { label: `in ${city}`, key: 'city' },
    from && { label: `from ${from.slice(0, 10)}`, key: 'from' },
    onSale && { label: 'Tickets on sale', key: 'onSale' },
  ].filter(Boolean);

  /** This page's URL with one filter removed. */
  function without(key, replacement = null) {
    const next = new URLSearchParams();
    const keptQ = key === 'q' ? replacement : q;
    if (keptQ) next.set('q', keptQ);
    if (active) next.set('category', active);
    if (city && key !== 'city') next.set('city', city);
    if (from && key !== 'from') next.set('from', from);
    if (to && key !== 'from') next.set('to', to);
    if (params.tz && keptQ) next.set('tz', tz);
    if (onSale && key !== 'onSale') next.set('onSale', 'true');
    const s = next.toString();
    return s ? `/events?${s}` : '/events';
  }

  const filtered = Boolean(q || active || city || from || onSale);
  // The API's own flag decides "completed" (its end has passed).
  const upcoming = events.filter((e) => !e.isPast);
  const completed = events.filter((e) => e.isPast);
  // The whole count when the API says it; a full page otherwise may not be everything.
  const total = Number.isFinite(pagination?.total) ? pagination.total : null;
  const count = total !== null ? String(total) : events.length >= PAGE_SIZE ? `${PAGE_SIZE}+` : String(events.length);
  const totalPages = Number.isFinite(pagination?.totalPages) ? pagination.totalPages : null;
  const hasNext = totalPages !== null ? page < totalPages : events.length >= PAGE_SIZE;
  /** This page's URL, every filter kept, on page `n`. */
  const pageHref = (n) => {
    const base = href(active);
    if (n <= 1) return base;
    return `${base}${base.includes('?') ? '&' : '?'}page=${n}`;
  };

  /** The category radios: "All" first, each one a URL that keeps the other filters. */
  const categoryOptions = [
    { slug: null, label: 'All', href: href(null), active: !active },
    ...categories.map((c) => ({ slug: c.slug, label: c.label, href: href(c.slug), active: active === c.slug })),
  ];

  /**
   * LAID OUT TO THE OWNER'S REFERENCE (2026-11-19): a filter sidebar on the
   * left — search, city and address, categories as radios — and a grid of
   * poster cards on the right, three across on a wide screen. No hero band:
   * the page opens straight onto the events.
   */
  return (
    <main className="es-evx">
      <h1 className="sr-only">Events</h1>
      <div className="es-evx__layout">
        <EventsSearch q={q} city={city} from={from} category={active} categories={categoryOptions}>
          {/* UNDER SUSPENSE, because `QuickFilters` calls `useSearchParams`;
              without a boundary that opts the whole route out of static
              rendering the moment `force-dynamic` is reconsidered. */}
          <Suspense fallback={null}>
            <QuickFilters city={city} />
          </Suspense>
        </EventsSearch>

        <section className="es-evx__results" aria-label="Results">
          {/* The count is announced after a filter changes the page, and shown
              only when something is filtered: an unfiltered listing opens
              straight onto the cards, as in the reference. */}
          <div className={filtered || relaxed ? 'es-ev-toolbar es-evx__toolbar' : 'sr-only'}>
            <p className="es-ev-count" aria-live="polite">
              <b>{count}</b> {events.length === 1 ? 'event' : 'events'}
              {effective.category && !relaxed ? <> in <b>{categories.find((c) => c.slug === effective.category)?.label || label(effective.category)}</b></> : ''}
            </p>
            {relaxed && (
              <p className="text-sm text-muted">
                Nothing matched {smart.understood.map((u) => u.label).join(' · ')} exactly, so these are results for the words you typed.
              </p>
            )}

            {/* The filters the URL is carrying, each one removable. */}
            {applied.length > 0 && (
              <ul className="es-ev-applied">
                {applied.map((filter) => (
                  <li key={filter.key}>
                    <Link href={filter.href || without(filter.key)} className="es-ev-applied__chip">
                      {filter.label}
                      <NavIcon name="close" size={13} />
                      <span className="sr-only">— remove this filter</span>
                    </Link>
                  </li>
                ))}
                <li><Link href="/events" className="es-lp-link">Clear all</Link></li>
              </ul>
            )}
          </div>

          {events.length > 0 ? (
            <>
              {/* Upcoming first, then COMPLETED under their own heading (owner,
                  2026-11-28): finished events stay on the page, after the
                  ones a visitor can still go to. The API orders them so; a
                  page may hold only one of the two. */}
              {upcoming.length > 0 ? (
                <ul className="es-evx__grid">
                  {upcoming.map((event, i) => (
                    <li key={event.id}>
                      <EventGridCard event={event} priority={page === 1 && i < 3} />
                    </li>
                  ))}
                </ul>
              ) : page === 1 && (
                <p className="es-evx__none-upcoming">
                  <NavIcon name="calendar" size={18} />
                  {filtered ? 'No upcoming events match those filters.' : 'No upcoming events just now.'} Here is what already took place.
                </p>
              )}
              {completed.length > 0 && (
                <section className="es-evx__done" aria-labelledby="evx-done-title">
                  <div className="es-evx__done-head">
                    <h2 id="evx-done-title" className="es-evx__done-title">
                      <span className="es-evx__done-mark" aria-hidden="true"><NavIcon name="tick" size={14} /></span>
                      Completed events
                    </h2>
                    <p className="es-evx__done-lede">They already took place, with the sponsors and vendors who made them happen.</p>
                  </div>
                  <ul className="es-evx__grid">
                    {completed.map((event, i) => (
                      <li key={event.id}>
                        <EventGridCard event={event} priority={page === 1 && upcoming.length === 0 && i < 3} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {(page > 1 || hasNext) && (
                <nav className="es-evx__pager" aria-label="More events">
                  {page > 1 ? (
                    <Link href={pageHref(page - 1)} className="es-lp-btn es-lp-btn--outline" rel="prev">Previous</Link>
                  ) : <span />}
                  <span className="text-sm text-muted">
                    Page {page}{totalPages ? ` of ${totalPages}` : ''}
                  </span>
                  {hasNext ? (
                    <Link href={pageHref(page + 1)} className="es-lp-btn es-lp-btn--outline" rel="next">More events</Link>
                  ) : <span />}
                </nav>
              )}
            </>
          ) : page > 1 && !failed ? (
            <div className="es-empty es-empty--rich">
              <p className="text-md font-medium text-ink">No more events on this page.</p>
              <Link href={pageHref(1)} className="es-lp-btn es-lp-btn--outline mt-2">Back to the first page</Link>
            </div>
          ) : (
            <div className="es-empty es-empty--rich">
              <span aria-hidden className="es-empty__mark">
                <NavIcon name={failed ? 'alert' : 'search'} size={22} />
              </span>
              <p className="text-md font-medium text-ink">
                {failed
                  ? 'We could not load events just now.'
                  : filtered
                    ? 'Nothing matches those filters.'
                    : 'Nothing is on sale just yet.'}
              </p>
              <p className="max-w-[44ch] text-center text-sm text-muted">
                {failed
                  ? 'This one is on us — please try again in a moment.'
                  : filtered
                    ? 'Try another city or date, or browse every category.'
                    : 'New events appear here as soon as organizers publish them. Check back soon.'}
              </p>
              {filtered && !failed && (
                <Link href="/events" className="es-lp-btn es-lp-btn--outline mt-2">Clear filters</Link>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
