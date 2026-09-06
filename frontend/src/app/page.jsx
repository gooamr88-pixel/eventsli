import Link from 'next/link';
import { serverFetch } from './utils/apiClient';
import EventCard from './components/EventCard';

/**
 * The homepage.
 *
 * Server-rendered and cached for a minute, with a tag the backend drops the
 * moment an event is published, approved, suspended or cancelled — see
 * api/internal/revalidate. Without the tag a newly approved event is missing
 * from this page for up to a minute after going live, and the person refreshing
 * is the organizer who just got the approval email.
 */
export const revalidate = 60;

/**
 * A failure here must not be a 500.
 *
 * This is what a crawler indexes and what a share link opens. An API hiccup
 * should cost the listing, not the page — so the fetch resolves to an empty
 * list and the hero and empty state still render.
 */
async function loadEvents() {
  try {
    const events = await serverFetch('/public/events?limit=6', {
      tags: ['events:published'],
      revalidate: 60,
    });
    return { events: Array.isArray(events) ? events : [], failed: false };
  } catch {
    // The distinction matters and it is cheap. A static prerender caches
    // whatever it produced, including a failure — the build talks to no API, so
    // without this flag a deploy serves "Nothing is on sale just yet" for up to
    // a minute, which is a claim about the business rather than about us.
    return { events: [], failed: true };
  }
}

export default async function HomePage() {
  const { events, failed } = await loadEvents();

  return (
    <main>
      <section className="fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">
            Canada &amp; the United States
          </p>
          <h1 className="max-w-[18ch] text-3xl">
            Find something to go to.
          </h1>
          <p className="max-w-[52ch] text-md text-muted">
            Pick your seat on the map, pay once, and arrive with the ticket on your
            phone.
          </p>
          <Link
            href="/events"
            className="self-start rounded-[--es-radius-md] bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            Browse events
          </Link>
        </div>
      </section>

      <section className="fx-section fx-section--sm fx-section--flush-top">
        <div className="fx-container fx-container--xl fx-stack">
          <div className="fx-row fx-row--between">
            <h2 className="text-xl">On soon</h2>
            <Link href="/events" className="text-sm text-accent hover:text-accent-hover">
              Browse all →
            </Link>
          </div>

          {events.length > 0 ? (
            <div className="fx-grid fx-grid--3">
              {events.map((event, i) => (
                <EventCard key={event.id} event={event} priority={i < 3} />
              ))}
            </div>
          ) : (
            <div className="rounded-[--es-radius-lg] border border-dashed border-border-strong p-8 text-center">
              <p className="text-muted">
                {failed ? 'We could not load events just now.' : 'Nothing is on sale just yet.'}
              </p>
              <p className="mt-1 text-sm text-subtle">
                {failed ? 'Please try again in a moment.' : 'Check back soon.'}
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
