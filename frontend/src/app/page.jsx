import Link from 'next/link';
import { serverFetch } from './utils/apiClient';
import EventCard from './components/EventCard';
import HeroSeatMap, { SEAT_LEGEND } from './components/marketing/HeroSeatMap';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOMEPAGE.
 *
 * ── What was wrong with the last version ─────────────────────────────────
 * It already had five bands and a header comment describing their
 * alternation. The alternation was real in the source and invisible on the
 * screen: `--es-bg` and `--es-bg-sunken` measured 1.8 apart in perceptual
 * lightness, and anything under about 3 is the same colour to the eye. So the
 * page was five identical sheets of near-white with a rule between them, and
 * every claim about rhythm in this comment was describing something nobody
 * could see. scripts/contrast.js now measures that directly and fails the
 * build under 3.0 — see the tone-separation block there.
 *
 * ── The band rhythm, now that tone can carry it ──────────────────────────
 * Five bands. No two consecutive bands share a tone, and the page OPENS and
 * CLOSES on the emerald field:
 *
 *   1  hero          field   the brand, and the product, shown
 *   2  on soon       sunken  what can I buy right now
 *   3  how it works  paper   what would I actually do
 *   4  what you get  sunken  why this rather than the other one
 *   5  closing       field   the button
 *
 * ── Overturning the old note about the closing band ──────────────────────
 * The previous version made its closing call to action a dark BLOCK contained
 * inside a light band, and argued that a full-bleed dark band at the bottom of
 * a light page "reads as a theme switch — as though a different site started".
 * That was correct WHEN THE PAGE OPENED ON WHITE. It is not correct now: the
 * hero is a field band, so a field band at the end is the other half of a
 * bookend and reads as the page closing where it opened. The argument did not
 * become wrong; its premise moved.
 *
 * ── Why there are still no photographs ───────────────────────────────────
 * Unchanged, and it survives the redesign. `public/` holds six files and none
 * of them is a picture of an event; a stock photo of a crowd is a photo of a
 * crowd that is not this crowd. The hero shows the product instead — a seat
 * map drawn by the module that draws the real one. See HeroSeatMap.
 * ─────────────────────────────────────────────────────────────────────────────
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

/** Three steps, in the order they happen. */
const STEPS = [
  {
    title: 'Find it',
    body: 'Browse what is on across Canada and the United States, or open a link a friend sent you.',
  },
  {
    title: 'Pick the seat',
    body: 'Not a tier, not a zone — the seat. Taken ones are greyed out on the map before you commit to anything.',
  },
  {
    title: 'Walk in',
    body: 'Pay once. The ticket lands on your phone and the door scans it, with or without a signal in the room.',
  },
];

/** Four claims. Each maps to behaviour that exists, or it does not go here. */
const POINTS = [
  {
    title: 'The seat is the seat',
    body: 'You choose the exact chair on the venue map. It is held for you while you pay and released if you do not.',
  },
  {
    title: 'One price, at the start',
    body: 'The number on the seat is the number you pay. Fees are in it, not added on the last screen.',
  },
  {
    title: 'The ticket is on your phone',
    body: 'No app to install and no PDF to find in your email at the door.',
  },
  {
    title: 'The door still works offline',
    body: 'Scanning is queued on the device and reconciled after. A venue basement with no bars is the normal case, not an edge case.',
  },
];

export default async function HomePage() {
  const { events, failed } = await loadEvents();

  return (
    <main>
      {/* ── 1 · Hero — the field ───────────────────────────────────── */}
      <section className="es-band--field fx-section fx-section--lg relative overflow-hidden">
        {/* Atmosphere, and the only decorative element on the page. It is a
            positioned child rather than a gradient on the band because the
            band's `background` is the property contrast.js reads to know what
            ground the text sits on. */}
        <div
          aria-hidden
          className="es-bloom -top-44 -right-28 size-[38rem]"
        />

        <div className="fx-container fx-container--xl relative">
          <div className="grid items-center gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)]">
            <div className="fx-stack es-rise">
              <p className="es-eyebrow text-accent">Canada &amp; the United States</p>

              {/* `.es-display`, which is `--es-text-5xl` — 56px on a phone and
                  96px on a desktop. The old h1 was `text-4xl` at the top of a
                  scale that stopped at 56px, so the headline and the section
                  headings below it were one step apart and the page had no
                  first note. */}
              <h1 className="es-display">Find something to go to.</h1>

              <p className="max-w-[42ch] text-lg text-muted">
                Pick your seat on the map, pay once, and arrive with the ticket on
                your phone.
              </p>

              <div className="fx-row fx-row--gap pt-2">
                <Link href="/events" className="es-btn es-btn--primary es-btn--lg">
                  Browse events
                </Link>
                <Link href="/how-it-works" className="es-btn es-btn--secondary es-btn--lg">
                  How it works
                </Link>
              </div>
            </div>

            {/* The picture. `--es-rise-delay` staggers it a beat behind the
                headline so the two do not arrive as one block — the whole
                effect of a stagger is that the eye is led rather than shown. */}
            <div
              className="es-rise fx-stack fx-stack--sm"
              style={{ '--es-rise-delay': '120ms' }}
            >
              <div className="es-plate">
                <HeroSeatMap />
              </div>

              {/* The legend earns its place: it is what turns the picture from
                  decoration into a claim the reader can check. Without it the
                  grey seats are a colour choice rather than "somebody already
                  took those". */}
              <ul className="fx-row fx-row--center fx-row--gap">
                {SEAT_LEGEND.map((entry) => (
                  <li key={entry.state} className="fx-row items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 rounded-full"
                      style={{ background: `var(--es-seat-${entry.state})` }}
                    />
                    <span className="text-sm text-muted">{entry.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · On soon — sunken, so the cards lift off it ──────────── */}
      <section className="es-band--sunken fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
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
                {failed ? 'Please try again in a moment.' : 'Check back soon.'}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── 3 · How it works — a marquee, NOT a third card grid ─────── */}
      <section className="es-band fx-section">
        <div className="fx-container fx-container--xl">
          <div className="es-marquee">
            <div className="fx-stack fx-stack--sm">
              <p className="es-eyebrow">Three steps</p>
              <h2 className="text-2xl">From a link to a seat in about a minute.</h2>
            </div>

            {/* An ordered list, because the order IS the meaning. A div with a
                styled number in it says "1" to a sighted reader and nothing at
                all to a screen reader; the number here is real content. */}
            <ol className="min-w-0">
              {STEPS.map((step, i) => (
                <li key={step.title} className="es-marquee__row">
                  <span className="es-marquee__index" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="fx-stack fx-stack--sm">
                    <h3 className="text-lg">{step.title}</h3>
                    <p className="text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
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

          {/* No cards. Four bordered rectangles here and three in the band
              above is what made every section read as the same object; a short
              accent rule does the same separating job without drawing a box
              around a sentence. */}
          <ul className="fx-grid fx-grid--2 fx-grid--gap-lg">
            {POINTS.map((point) => (
              <li key={point.title} className="fx-stack fx-stack--sm">
                <span aria-hidden className="block h-[3px] w-8 rounded-full bg-accent" />
                <h3 className="text-lg">{point.title}</h3>
                <p className="text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 5 · Closing — the field returns ────────────────────────── */}
      <section className="es-band--field fx-section relative overflow-hidden">
        <div
          aria-hidden
          className="es-bloom -bottom-60 left-1/2 size-[44rem] -translate-x-1/2"
        />
        <div className="fx-container fx-container--md relative">
          <div className="fx-stack items-center text-center">
            <h2 className="es-display es-display--wide">
              There is something on this week.
            </h2>
            <p className="max-w-[44ch] text-lg text-muted">
              Browse what is selling now, or find a ticket you already bought.
            </p>
            <div className="fx-row fx-row--center fx-row--gap pt-2">
              <Link href="/events" className="es-btn es-btn--primary es-btn--lg">
                Browse events
              </Link>
              <Link href="/tickets/find" className="es-btn es-btn--secondary es-btn--lg">
                Find my tickets
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
