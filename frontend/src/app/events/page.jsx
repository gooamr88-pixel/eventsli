import Link from 'next/link';
import { serverFetch } from '../utils/apiClient';
import EventCard from '../components/EventCard';
import QuickFilters from './QuickFilters';
import { categoryLabel } from '../lib/categories';
import NavIcon from '../components/shell/NavIcon';
import EventsSearch from './EventsSearch';

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
  description: 'Concerts, festivals, conferences and sports across Canada and the United States.',
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
  query.set('limit', '24');

  try {
    const [events, categories] = await Promise.all([
      serverFetch(`/public/events?${query}`, { tags: ['events:published'], revalidate: 60 }),
      serverFetch('/public/event-categories', { tags: ['event-categories'], revalidate: 3600 }),
    ]);
    return {
      events: Array.isArray(events) ? events : [],
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
    return { events: [], categories: [], failed: true };
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
  const from = typeof params.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.from)
    ? params.from
    : '';

  const { events, categories, failed } = await load({
    q, category: active, country: params.country, city, from,
  });

  /** Every link on this page keeps the filters already applied. */
  const href = (category) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (city) next.set('city', city);
    if (from) next.set('from', from);
    if (category) next.set('category', category);
    const s = next.toString();
    return s ? `/events?${s}` : '/events';
  };

  /** What the reader filtered by, in words, so it can be shown and undone. */
  const applied = [
    q && { label: `“${q}”`, key: 'q' },
    city && { label: `in ${city}`, key: 'city' },
    from && { label: `from ${from}`, key: 'from' },
  ].filter(Boolean);

  /** This page's URL with one filter removed. */
  const without = (key) => {
    const next = new URLSearchParams();
    if (q && key !== 'q') next.set('q', q);
    if (active) next.set('category', active);
    if (city && key !== 'city') next.set('city', city);
    if (from && key !== 'from') next.set('from', from);
    const s = next.toString();
    return s ? `/events?${s}` : '/events';
  };

  const filtered = Boolean(q || active || city || from);
  // The API pages at 24, so a full page may not be everything.
  const count = events.length >= 24 ? '24+' : String(events.length);

  return (
    <main>
      {/* ── The controls ───────────────────────────────────────────────── */}
      <section className="es-ev-hero fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="es-ev-hero__head">
            <p className="es-lp-kicker">Canada &amp; the United States</p>
            <h1 className="es-ev-title">
              Find your next <span className="es-lp-accent">event</span>
            </h1>
            <p className="es-lp-lede">
              Concerts, galas, comedy, film and more — pick your seat and get your ticket in minutes.
            </p>
          </div>

          <EventsSearch q={q} city={city} from={from} category={active} />

          {/* The two answers most people actually want, above the category
              list — "somewhere I can get to" and "something to do on
              Saturday" are the questions; a category is how you narrow one. */}
          <QuickFilters city={city} />

          {/* Links, not buttons: every category is a URL, so a filtered view
              is shareable and the back button walks the filters. Scrolls
              sideways rather than wrapping into three lines of chrome above
              the first event on a phone. */}
          <nav className="es-lp-tabs es-ev-tabs" aria-label="Categories">
            <Link href={href(null)} aria-current={!active ? 'page' : undefined} className="es-lp-tabs__tab">
              All events
            </Link>
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={href(c.slug)}
                aria-current={active === c.slug ? 'page' : undefined}
                className="es-lp-tabs__tab"
              >
                {c.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* ── The answer ─────────────────────────────────────────────────── */}
      <section className="es-band fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="es-ev-toolbar">
            {/* `aria-live` so the count is announced after a filter changes
                the page, not only seen. */}
            <p className="es-ev-count" aria-live="polite">
              <b>{count}</b> {events.length === 1 ? 'event' : 'events'}
              {active ? <> in <b>{label(active)}</b></> : ''}
            </p>

            {/* The filters the URL is carrying, each one removable. Without
                this a reader who arrived from the homepage's search sees a
                short listing and no reason for it. */}
            {applied.length > 0 && (
              <ul className="es-ev-applied">
                {applied.map((filter) => (
                  <li key={filter.key}>
                    <Link href={without(filter.key)} className="es-ev-applied__chip">
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
            <ul className="es-ev-results">
              {events.map((event, i) => (
                <li key={event.id}>
                  {/* h2: these cards are the first level under this page's
                      <h1>. The homepage puts them under a section h2. */}
                  <EventCard event={event} priority={i < 3} headingLevel={2} adaptive />
                </li>
              ))}
            </ul>
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
                    : 'Every event is reviewed before it goes on sale. Check back soon.'}
              </p>
              {filtered && !failed && (
                <Link href="/events" className="es-lp-btn es-lp-btn--outline mt-2">Clear filters</Link>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
