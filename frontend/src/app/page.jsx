import Link from 'next/link';
import { serverFetch } from './utils/apiClient';
import Hero from './components/landing/Hero';
import { FeaturedEvents, Categories, Sponsors, OrganizerBand, GuestBand } from './components/landing/Sections';
import { Testimonials } from './components/landing/Proof';
import VideoBand from './components/landing/VideoBand';
import VisitBeacon from './components/landing/VisitBeacon';
import HeroSeatMap, { SEAT_LEGEND } from './components/marketing/HeroSeatMap';
import TicketPreview from './components/landing/TicketPreview';
import { Faq, FaqJsonLd } from './components/marketing/Blocks';
import { FAQ } from './components/marketing/homeContent';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOMEPAGE.
 *
 * REBUILT 2026-09-16 as a storefront. What changed, and why, because the file
 * this replaced argued the opposite case and argued it well.
 *
 * The old page was seven bands of typography with no photography anywhere, on a
 * stated principle: "a stock photo of a crowd is a photo of a crowd that is not
 * this crowd". That was the right call for a page that had no photography to
 * use. It stopped being the right call when the brand supplied its own artwork:
 * a ticketing storefront whose front page is a diagram is asking a buyer to
 * want a diagram.
 *
 * The seat map did not get deleted. It moved into the organizer band, where it
 * illustrates a claim being made beside it rather than opening a page that has
 * not made one yet.
 *
 * ── The band rhythm ──────────────────────────────────────────────────────
 * The rule the old page established still holds: no two consecutive bands share
 * a tone, and `scripts/contrast.js` measures that they are perceptibly apart.
 *
 *   1  hero            field   photograph, promise, search
 *   2  featured        sunken  what is actually on sale
 *   3  categories      paper   how to narrow it
 *   4  sponsors        paper   only if there are any
 *   5  organizers      field   the second reader, and the product shown
 *   6  guests          paper   the buying experience
 *   7  video           paper   only if there is a film
 *   8  testimonials    sunken  words, and the counted numbers
 *   9  questions       paper   the five asked most, as FAQ structured data
 *  10  closing         field   the buttons
 *
 * Bands 4 and 7 return null when empty, so the rhythm holds either way: 3 and 5
 * are paper and field, and 6 and 8 are paper and sunken, with or without them.
 *
 * ── Where the words come from ────────────────────────────────────────────
 * Headings, the hero, the two section blocks and the statistics strip are rows
 * in `site_content`, edited at /admin/content. The FAQ and the four product
 * claims in each band are still in source — they are statements about what the
 * software does, and if the door scanner stopped working offline that sentence
 * would have to change in the same commit that broke it. A database row cannot
 * be part of a commit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const revalidate = 60;

/**
 * Four independent fetches, and a failure in any one of them costs that section
 * and nothing else.
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

    serverFetch('/public/cities', { tags: ['landing'], revalidate: 300 })
      .then((data) => data?.cities || [])
      .catch(() => []),
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
  const stats = landing?.stats || null;

  return (
    <main>
      <FaqJsonLd items={FAQ} />
      {/* Counts this view. Renders nothing — see VisitBeacon. */}
      <VisitBeacon path="/" />

      {/* ── 1 · Hero ─────────────────────────────────────────────── */}
      <Hero content={content} cities={cities} categories={categories} />

      {/* ── 2 · What is on ───────────────────────────────────────── */}
      <FeaturedEvents copy={copy} events={events} failed={failed} />

      {/* ── 3 · How to narrow it ─────────────────────────────────── */}
      <Categories copy={copy} categories={categories} />

      {/* ── 4 · Sponsors — nothing at all until there are some ────── */}
      <Sponsors copy={copy} sponsors={sponsors} />

      {/* ── 5 · For organizers, with the product in it ───────────── */}
      <OrganizerBand block={content.organizer_block || {}}>
        {/* The seat map, drawn by the module that draws the real one. It is
            here rather than in the hero because this is where the page claims
            an organizer can draw a room — the picture is the evidence. */}
        <div className="fx-stack fx-stack--sm p-4">
          <HeroSeatMap />
          <ul className="fx-row fx-row--center fx-row--gap">
            {SEAT_LEGEND.map((entry) => (
              <li key={entry.state} className="fx-row items-center gap-2">
                <span aria-hidden className={`es-legend-dot es-legend-dot--${entry.state}`} />
                <span className="text-sm text-muted">{entry.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </OrganizerBand>

      {/* ── 6 · For guests ───────────────────────────────────────── */}
      <GuestBand block={content.guest_block || {}}>
        {/* A drawn ticket, not the real component. `TicketStub` needs an order
            and a QR endpoint, and putting it here would mean fabricating both —
            see TicketPreview for why that line is worth not crossing. */}
        <TicketPreview />
      </GuestBand>

      {/* ── 7 · The film — nothing until one is uploaded ─────────── */}
      <VideoBand block={content.video} />

      {/* ── 8 · What people say, and what is countable ───────────── */}
      <Testimonials
        copy={copy}
        testimonials={testimonials}
        stats={stats}
        statsBlock={content.stats || {}}
      />

      {/* ── 9 · Questions ────────────────────────────────────────── */}
      <section className="es-band fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="es-marquee">
            <div className="fx-stack fx-stack--sm">
              <p className="es-eyebrow">Questions</p>
              <h2 className="font-serif text-2xl">What people ask first.</h2>
              <Link href="/contact" className="text-sm text-accent hover:text-accent-hover">
                Something else? Get in touch →
              </Link>
            </div>
            <Faq items={FAQ} />
          </div>
        </div>
      </section>

      {/* ── 10 · Closing ─────────────────────────────────────────── */}
      <section className="es-band--field fx-section relative overflow-hidden">
        <div aria-hidden className="es-bloom -bottom-60 left-1/2 size-[44rem] -translate-x-1/2" />
        <div className="fx-container fx-container--md relative">
          <div className="fx-stack items-center text-center">
            <h2 className="es-display es-display--wide font-serif">There is something on this week.</h2>
            <p className="max-w-[44ch] text-lg text-muted">
              Browse what is selling now, or find a ticket you already bought.
            </p>
            <div className="fx-row fx-row--center fx-row--gap pt-2">
              <Link href="/events" className="es-btn es-btn--primary es-btn--lg">Browse events</Link>
              <Link href="/tickets/find" className="es-btn es-btn--secondary es-btn--lg">Find my tickets</Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
