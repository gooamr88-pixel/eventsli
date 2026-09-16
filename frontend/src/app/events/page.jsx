import Link from 'next/link';
import { serverFetch } from '../utils/apiClient';
import EventCard from '../components/EventCard';
import { categoryLabel } from '../lib/categories';

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
    city && { label: `in ${city}`, key: 'city' },
    from && { label: `from ${from}`, key: 'from' },
  ].filter(Boolean);

  return (
    <main>
      {/* The masthead sits on the sunken tone and the results on the page
          tone, which is what separates "the controls" from "the answer"
          without drawing a rule between them. */}
      <section className="es-band--field fx-section fx-section--sm relative overflow-hidden">
        <div className="fx-container fx-container--xl fx-stack relative">
          <div className="fx-stack fx-stack--sm">
            <p className="es-eyebrow text-accent">Canada &amp; the United States</p>
            <h1 className="text-4xl">Events</h1>
          </div>

          {/* GET, so the query lands in the URL and the result is shareable. */}
          <form action="/events" method="get" className="fx-row">
            {active && <input type="hidden" name="category" value={active} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search events or venues"
              aria-label="Search events"
              className="es-input fx-min0 flex-1"
            />
            <input
              type="text"
              name="city"
              defaultValue={city}
              placeholder="Any city"
              aria-label="City"
              className="es-input fx-min0 flex-1"
            />
            <button type="submit" className="es-btn es-btn--primary">
              Search
            </button>
          </form>

          {/* The filters the URL is carrying, each one removable.
              Without this a reader who arrived from the homepage's search sees
              a short listing and no reason for it — the date they picked is in
              the address bar and nowhere on the page. */}
          {applied.length > 0 && (
            <ul className="fx-row fx-row--gap items-center">
              <li className="text-sm text-muted">Filtered</li>
              {applied.map((filter) => {
                const next = new URLSearchParams();
                if (q) next.set('q', q);
                if (active) next.set('category', active);
                if (city && filter.key !== 'city') next.set('city', city);
                if (from && filter.key !== 'from') next.set('from', from);
                const s = next.toString();
                return (
                  <li key={filter.key}>
                    <Link href={s ? `/events?${s}` : '/events'} className="es-chip">
                      {filter.label}
                      <span aria-hidden>&times;</span>
                      <span className="sr-only">— remove this filter</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Scrolls rather than wraps BELOW md: a wrapping row of thirteen
              pills is three lines of chrome above the first event on a phone.
              From md up there is room for the second line and no scrollbar to
              hint with, so it wraps instead of slicing the last pill. */}
          <div className="fx-row fx-row--scroll fx-row--scroll-sm -mx-1 px-1 pb-1">
            <Pill href={href(null)} active={!active}>All</Pill>
            {categories.map((c) => (
              <Pill key={c.slug} href={href(c.slug)} active={active === c.slug}>{c.label}</Pill>
            ))}
          </div>
        </div>
      </section>

      {/* SUNKEN, not the page tone, and this follows from EventCard being a
          `--flush` card now: it has no border and separates from its ground by
          tone alone. Against `bg` that is 2.4 in perceptual lightness — the
          card would be a shadow with nothing under it. Against `bg-sunken` it
          is 7.5. Card grids live on the sunken band throughout the storefront
          for this reason; the homepage's "On soon" does the same. */}
      <section className="es-band--sunken fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">

          {/* A count, which the page did not have. "24 events" tells a reader
              whether the filter did anything; a grid that silently went from
              twenty cards to twelve does not. `aria-live` so it is announced
              after a filter changes the page rather than only being visible. */}
          {events.length > 0 && (
            <p className="text-muted" aria-live="polite">
              {events.length} {events.length === 1 ? 'event' : 'events'}
              {active ? ` in ${label(active)}` : ''}
              {q ? ` matching “${q}”` : ''}
            </p>
          )}

          {events.length > 0 ? (
            <div className="fx-grid fx-grid--3 fx-grid--fill">
              {events.map((event, i) => (
                // h2: these cards are the first level under this page's <h1>.
                // The homepage puts them under "On soon", where they are h3.
                <EventCard key={event.id} event={event} priority={i < 3} headingLevel={2} />
              ))}
            </div>
          ) : (
            <div className="es-empty">
              <p className="text-lg text-muted">
                {failed
                  ? 'We could not load events just now.'
                  : q || active
                    ? 'Nothing matches those filters.'
                    : 'Nothing is on sale just yet.'}
              </p>
              {(q || active) && !failed && (
                <Link href="/events" className="es-btn es-btn--secondary es-btn--sm">
                  Clear filters
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Pill({ href, active, children }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      /* `.es-pill` gives it the shape; the two states give it the colour.
         Not `.es-pill--accent`, which is the low-contrast wash used for a
         status badge — an ACTIVE FILTER is a control and has to read as
         pressed, so it takes the solid fill. `min-height` from --fx-touch
         because these are the page's most-tapped targets on a phone. */
      className={`es-pill min-h-[var(--fx-touch)] border px-3 text-sm normal-case tracking-normal transition-colors ${
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-border-strong bg-transparent text-muted hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
