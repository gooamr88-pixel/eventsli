import Link from 'next/link';
import { serverFetch } from '../utils/apiClient';
import EventCard from '../components/EventCard';

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

/** Labels for the API's enum. The VALUES come from the API — this map only
 *  gives each one a display name, so a category added server-side still
 *  appears here (titlecased) instead of vanishing from the filter. */
const LABELS = {
  music: 'Music', festival: 'Festivals', nightlife: 'Nightlife', sports: 'Sports',
  arts: 'Arts', comedy: 'Comedy', film: 'Film', food_drink: 'Food & drink',
  business: 'Business', community: 'Community', education: 'Learning',
  family: 'Family', other: 'Other',
};

const label = (c) => LABELS[c] || c.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());

async function load(params) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.category) query.set('category', params.category);
  if (params.country) query.set('country', params.country);
  query.set('limit', '24');

  try {
    const [events, categories] = await Promise.all([
      serverFetch(`/public/events?${query}`, { tags: ['events:published'], revalidate: 60 }),
      serverFetch('/public/event-categories', { tags: ['event-categories'], revalidate: 3600 }),
    ]);
    return {
      events: Array.isArray(events) ? events : [],
      categories: categories?.categories || [],
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
  const { events, categories, failed } = await load({ q, category: active, country: params.country });

  const href = (category) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (category) next.set('category', category);
    const s = next.toString();
    return s ? `/events?${s}` : '/events';
  };

  return (
    <main>
      {/* The masthead sits on the sunken tone and the results on the page
          tone, which is what separates "the controls" from "the answer"
          without drawing a rule between them. */}
      <section className="es-band--field fx-section fx-section--sm relative overflow-hidden">
        <div aria-hidden className="es-bloom -top-40 -right-24 size-[30rem]" />
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
            <button type="submit" className="es-btn es-btn--primary">
              Search
            </button>
          </form>

          {/* Scrolls rather than wraps: a wrapping row of thirteen pills is
              three lines of chrome above the first event on a phone. */}
          <div className="fx-row fx-row--scroll -mx-1 px-1 pb-1">
            <Pill href={href(null)} active={!active}>All</Pill>
            {categories.map((c) => (
              <Pill key={c} href={href(c)} active={active === c}>{label(c)}</Pill>
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
            <div className="fx-grid fx-grid--3">
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
