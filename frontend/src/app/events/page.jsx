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
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--xl fx-stack">
        <div className="fx-stack fx-stack--sm">
          <h1 className="text-2xl">Events</h1>
          <p className="text-muted">Canada and the United States.</p>
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
            className="fx-min0 flex-1 rounded-[--es-radius-md] border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle"
          />
          <button
            type="submit"
            className="rounded-[--es-radius-md] bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            Search
          </button>
        </form>

        {/* Scrolls rather than wraps: a wrapping row of thirteen pills is three
            lines of chrome above the first event on a phone. */}
        <div className="fx-row fx-row--scroll -mx-1 px-1 pb-1">
          <Pill href={href(null)} active={!active}>All</Pill>
          {categories.map((c) => (
            <Pill key={c} href={href(c)} active={active === c}>{label(c)}</Pill>
          ))}
        </div>

        {events.length > 0 ? (
          <div className="fx-grid fx-grid--3">
            {events.map((event, i) => (
              // h2: these cards are the first level under this page's <h1>.
              // The homepage puts them under "On soon", where they are h3.
              <EventCard key={event.id} event={event} priority={i < 3} headingLevel={2} />
            ))}
          </div>
        ) : (
          <div className="rounded-[--es-radius-lg] border border-dashed border-border-strong p-10 text-center">
            <p className="text-muted">
              {failed
                ? 'We could not load events just now.'
                : q || active
                  ? 'Nothing matches those filters.'
                  : 'Nothing is on sale just yet.'}
            </p>
            {(q || active) && !failed && (
              <Link href="/events" className="mt-2 inline-block text-sm text-accent">
                Clear filters
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Pill({ href, active, children }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-border-strong text-muted hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
