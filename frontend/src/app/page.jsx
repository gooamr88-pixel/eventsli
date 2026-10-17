import Hero from './components/landing/Hero';
import PopularEvents from './components/landing/PopularEvents';
import { SearchBand, Roles, Steps } from './components/landing/Sections';
import { Testimonials, Closing, PartnersBand } from './components/landing/Social';
import VideoBand from './components/landing/VideoBand';
import ChatBubble from './components/landing/ChatBubble';
import VisitBeacon from './components/landing/VisitBeacon';
import NearbyEvents from './components/landing/NearbyEvents';
import { serverFetch } from './utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOMEPAGE.
 *
 * REBUILT 2026-09-17 from the mockup the owner approved (version 3 of the blue
 * storefront review): a white page with one calm medium blue.
 *
 *   1  hero            headline, search bar, photograph, partner logos
 *   2  search          find an event by name; the first four categories
 *   3  popular events  category tabs and the cards
 *   4  roles           who the product is for, and where each starts
 *   5  three steps     how an organizer goes on sale
 *   6  highlights      only if there is a film
 *   7  testimonials    only if any are published
 *   8  closing         the one teal panel
 *   9  partners        the logos as tiles, above the footer; only if any
 *
 * ── Where the words come from ────────────────────────────────────────────
 * The hero, the event-list heading, the statistics labels, the film and the
 * testimonials heading are rows in `site_content`. A phrase between asterisks
 * is painted blue; a section heading with none gets its last word painted
 * instead (see Accent.jsx). The search band, the roles and the three steps are
 * in source: they are claims about what the product does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const revalidate = 60;

/**
 * Three independent fetches, and a failure in any one costs that section and
 * nothing else.
 *
 * The city list was dropped once, when the hero's datalist of places became the
 * "events near me" button and nothing rendered it. It is back because "Near
 * you" renders it — and decides from it whether to appear at all.
 *
 * `failed` on the events call matters for the same reason it did before: a
 * static prerender caches whatever it produced, and CI builds against an
 * unreachable API on purpose — so without it a deploy would ship "Nothing is on
 * sale just yet", which is a claim about the business rather than about us.
 *
 * The landing payload falls back to `null` and every consumer handles that,
 * because the page must still render its headline when the CMS is unreachable.
 */
async function load() {
  const [events, landing, cities] = await Promise.all([
    serverFetch('/public/events?limit=8', { tags: ['events:published'], revalidate: 60 })
      .then((rows) => ({ rows: Array.isArray(rows) ? rows : [], failed: false }))
      .catch(() => ({ rows: [], failed: true })),

    // One call for six admin-owned blocks — see landingController for why they
    // are not six. Tagged so an admin's save drops it immediately instead of
    // waiting out the minute.
    serverFetch('/public/landing', { tags: ['landing'], revalidate: 60 })
      .catch(() => null),

    // Back, for "Near you": its city picker, and whether to show it at all.
    // `null` on failure means "unknown" — the section then loads its own list
    // rather than vanishing because one request did.
    serverFetch('/public/cities', { tags: ['events:published'], revalidate: 60 })
      .then((d) => (Array.isArray(d?.cities) ? d.cities : null))
      .catch(() => null),
  ]);

  return { events: events.rows, failed: events.failed, landing, cities };
}

export default async function HomePage() {
  const { events, failed, landing, cities } = await load();

  const content = landing?.content || {};
  const copy = content.sections || {};
  const categories = landing?.categories || [];
  const sponsors = landing?.sponsors || [];
  const testimonials = landing?.testimonials || [];

  return (
    <main>
      {/* Counts this view. Renders nothing — see VisitBeacon. */}
      <VisitBeacon path="/" />

      <Hero content={content} events={events} sponsors={sponsors} />
      {/* Nearby events by default, when this browser already allows location;
          otherwise a location bar. LEFT OUT while no city has an upcoming event:
          it could only show controls that find nothing, above a "Nothing is on
          sale just yet" that already says so (owner's review, 2026-10-16). */}
      {(cities === null || cities.length > 0) && <NearbyEvents initialCities={cities} />}
      <SearchBand categories={categories} />
      <PopularEvents copy={copy} categories={categories} events={events} failed={failed} />
      <Roles />
      <Steps />
      <VideoBand block={content.video} />
      <Testimonials copy={copy} testimonials={testimonials} />
      <Closing />
      <PartnersBand copy={copy} sponsors={sponsors} />

      <ChatBubble />
    </main>
  );
}
