import Link from 'next/link';
import { serverFetch } from './utils/apiClient';
import EventCard from './components/EventCard';
import HeroSeatMap, { SEAT_LEGEND } from './components/marketing/HeroSeatMap';
import { Steps, Points, Faq, FaqJsonLd } from './components/marketing/Blocks';
import NavIcon from './components/shell/NavIcon';
import { categoryLabel } from './lib/categories';
import { PROOF, STEPS, POINTS, ORGANIZER_POINTS, FAQ } from './components/marketing/homeContent';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOMEPAGE — the most important page on the site.
 *
 * It has two readers and used to serve one. A buyer arrives wanting something
 * to go to; an organizer arrives wanting to know whether to sell here. The old
 * page never addressed the second at all, and made two claims about fees and
 * PDFs that the product does not keep (see homeContent.js).
 *
 * ── The band rhythm ──────────────────────────────────────────────────────
 * No two consecutive bands share a tone; the page opens and closes on the
 * emerald field (contrast.js measures that the tones are perceptibly apart):
 *
 *   1  hero            field   the promise, a search box, and the product shown
 *   2  browse          sunken  categories, then what is on sale now
 *   3  how it works    paper   three steps
 *   4  what you get    sunken  four behaviours
 *   5  for organizers  ink     the other reader
 *   6  questions       paper   the five asked most, as FAQ structured data too
 *   7  closing         field   the buttons
 *
 * ── Why there are still no photographs ───────────────────────────────────
 * A stock photo of a crowd is a photo of a crowd that is not this crowd. The
 * hero shows the product instead — a seat map drawn by the module that draws
 * the real one. See HeroSeatMap.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const revalidate = 60;

/**
 * A failure here must not be a 500 — this is what a crawler indexes and what
 * a share link opens. Events and categories fail independently, so a slow
 * category list never costs the listing.
 *
 * `failed` matters: a static prerender caches whatever it produced, and the
 * build talks to no API, so without it a deploy would serve "Nothing is on
 * sale just yet" — a claim about the business rather than about us.
 */
async function load() {
  const [events, categories] = await Promise.all([
    serverFetch('/public/events?limit=6', { tags: ['events:published'], revalidate: 60 })
      .then((rows) => ({ rows: Array.isArray(rows) ? rows : [], failed: false }))
      .catch(() => ({ rows: [], failed: true })),
    serverFetch('/public/event-categories', { tags: ['event-categories'], revalidate: 3600 })
      .then((data) => data?.categories || [])
      .catch(() => []),
  ]);
  return { events: events.rows, failed: events.failed, categories };
}

export default async function HomePage() {
  const { events, failed, categories } = await load();

  return (
    <main>
      <FaqJsonLd items={FAQ} />

      {/* ── 1 · Hero — the field ───────────────────────────────────── */}
      <section className="es-band--field fx-section fx-section--lg relative overflow-hidden">
        {/* The only decorative element. A positioned child rather than a
            gradient on the band, because the band's background is what
            contrast.js reads to know which ground the text sits on. */}
        <div aria-hidden className="es-bloom -top-44 -right-28 size-[38rem]" />

        <div className="fx-container fx-container--xl relative">
          <div className="grid items-center gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)]">
            <div className="fx-stack es-rise">
              <p className="es-eyebrow text-accent">Tickets across Canada &amp; the United States</p>

              <h1 className="es-display">Find something to go to.</h1>

              <p className="max-w-[42ch] text-lg text-muted">
                Pick your exact seat on the map, see every line before you pay, and
                arrive with the ticket on your phone.
              </p>

              {/* A plain GET form: /events reads `q` from the URL, so search
                  works with no JavaScript and the result is shareable. */}
              <form action="/events" method="get" role="search" className="fx-row max-w-[34rem] pt-1">
                <label htmlFor="home-search" className="sr-only">Search events</label>
                <input
                  id="home-search"
                  name="q"
                  type="search"
                  placeholder="Search events, artists, venues"
                  className="es-input fx-min0 flex-1"
                />
                <button type="submit" className="es-btn es-btn--primary">Search</button>
              </form>

              <div className="fx-row fx-row--gap">
                <Link href="/events" className="es-btn es-btn--secondary">Browse everything</Link>
                <Link href="/tickets/find" className="es-btn es-btn--ghost">Find my tickets</Link>
              </div>

              <ul className="fx-row fx-row--gap pt-2">
                {PROOF.map((fact) => (
                  <li key={fact} className="fx-row items-center gap-1.5 text-sm text-muted">
                    <span className="text-accent"><NavIcon name="check" size={16} /></span>
                    {fact}
                  </li>
                ))}
              </ul>
            </div>

            {/* The picture, a beat behind the headline so the eye is led. */}
            <div className="es-rise es-rise--late fx-stack fx-stack--sm">
              <div className="es-plate">
                <HeroSeatMap />
              </div>

              {/* The legend turns the picture from decoration into a claim the
                  reader can check: grey means somebody already took it. */}
              <ul className="fx-row fx-row--center fx-row--gap">
                {SEAT_LEGEND.map((entry) => (
                  <li key={entry.state} className="fx-row items-center gap-2">
                    <span aria-hidden className={`es-legend-dot es-legend-dot--${entry.state}`} />
                    <span className="text-sm text-muted">{entry.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · Browse — sunken, so the cards lift off it ───────────── */}
      <section className="es-band--sunken fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
          {categories.length > 0 && (
            <nav aria-label="Browse by category" className="fx-stack fx-stack--sm">
              <p className="es-eyebrow">Browse by category</p>
              <ul className="fx-row fx-row--scroll">
                {categories.map((c) => (
                  <li key={c}>
                    <Link href={`/events?category=${encodeURIComponent(c)}`} className="es-btn es-btn--secondary es-btn--sm whitespace-nowrap">
                      {categoryLabel(c)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="fx-row fx-row--between items-end">
            <div className="fx-stack fx-stack--sm">
              <p className="es-eyebrow">On sale now</p>
              <h2 className="text-2xl">On soon</h2>
            </div>
            <Link href="/events" className="es-btn es-btn--ghost es-btn--sm">
              Browse all <span aria-hidden>→</span>
            </Link>
          </div>

          {events.length > 0 ? (
            <div className="fx-grid fx-grid--3">
              {events.map((event, i) => (
                <EventCard key={event.id} event={event} priority={i < 3} />
              ))}
            </div>
          ) : (
            <div className="es-empty">
              <p className="text-muted">
                {failed ? 'We could not load events just now.' : 'Nothing is on sale just yet.'}
              </p>
              <p className="mt-1 text-sm text-subtle">
                {failed ? 'Please try again in a moment.' : 'New events are reviewed and published every week — check back soon.'}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── 3 · How it works — a marquee, not a third card grid ─────── */}
      <section className="es-band fx-section">
        <div className="fx-container fx-container--xl">
          <div className="es-marquee">
            <div className="fx-stack fx-stack--sm">
              <p className="es-eyebrow">Three steps</p>
              <h2 className="text-2xl">From a link to a seat in a few minutes.</h2>
              <Link href="/how-it-works" className="text-sm text-accent hover:text-accent-hover">
                The whole process, in detail →
              </Link>
            </div>
            <Steps steps={STEPS} />
          </div>
        </div>
      </section>

      {/* ── 4 · What you get — sunken, claims rather than boxes ─────── */}
      <section className="es-band--sunken fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
          <div className="fx-stack fx-stack--sm">
            <p className="es-eyebrow">What you get</p>
            <h2 className="max-w-[24ch] text-2xl">Four things, and each one is a behaviour.</h2>
          </div>
          <Points points={POINTS} columns="fx-grid--2" />
        </div>
      </section>

      {/* ── 5 · For organizers — the ink band, the other reader ─────── */}
      <section id="organizers" className="es-band--ink fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
          <div className="grid items-end gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="fx-stack fx-stack--sm">
              <p className="es-eyebrow">For organizers</p>
              <h2 className="max-w-[22ch] text-2xl">Sell seats, not a spreadsheet of them.</h2>
              <p className="max-w-[52ch] text-muted">
                A seat map you draw, money that lands in your own Stripe account, a door that
                keeps scanning offline — and every event reviewed before it goes on sale.
              </p>
            </div>
            <div className="fx-row lg:justify-end">
              <Link href="/register" className="es-btn es-btn--primary es-btn--lg">Start selling</Link>
              <Link href="/why-us" className="es-btn es-btn--secondary es-btn--lg">Why Eventsli</Link>
            </div>
          </div>
          <Points points={ORGANIZER_POINTS} columns="fx-grid--4" />
        </div>
      </section>

      {/* ── 6 · Questions ──────────────────────────────────────────── */}
      <section className="es-band fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="es-marquee">
            <div className="fx-stack fx-stack--sm">
              <p className="es-eyebrow">Questions</p>
              <h2 className="text-2xl">What people ask first.</h2>
              <Link href="/contact" className="text-sm text-accent hover:text-accent-hover">
                Something else? Get in touch →
              </Link>
            </div>
            <Faq items={FAQ} />
          </div>
        </div>
      </section>

      {/* ── 7 · Closing — the field returns ────────────────────────── */}
      <section className="es-band--field fx-section relative overflow-hidden">
        <div aria-hidden className="es-bloom -bottom-60 left-1/2 size-[44rem] -translate-x-1/2" />
        <div className="fx-container fx-container--md relative">
          <div className="fx-stack items-center text-center">
            <h2 className="es-display es-display--wide">There is something on this week.</h2>
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
