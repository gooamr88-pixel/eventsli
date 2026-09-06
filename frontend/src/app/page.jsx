import Link from 'next/link';
import { serverFetch } from './utils/apiClient';
import EventCard from './components/EventCard';
import HeroSeatMap, { SEAT_LEGEND } from './components/marketing/HeroSeatMap';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOMEPAGE.
 *
 * ── What this was ────────────────────────────────────────────────────────
 * Ninety-four lines and two bands: a paragraph, a heading, a button, and a row
 * of event cards. Everything on it was the same tone on the same ground, there
 * was no image anywhere, and the product's one distinguishing feature — that
 * you pick the seat yourself, on a map, before you pay — was asserted in a
 * subordinate clause and never shown.
 *
 * That is what "looks cheap" is, mechanically. Not bad colours and not bad
 * type: the palette below is unchanged and so is the type scale. A page reads
 * as cheap when it makes a claim it does not illustrate and when every band on
 * it has the same weight, so the eye has nowhere to land and nothing to do but
 * read.
 *
 * ── The band rhythm ──────────────────────────────────────────────────────
 * Five bands, and the ONLY structural rule is that no two consecutive bands
 * share a tone. Declared here so the alternation can be checked by reading
 * this file rather than by scrolling the rendered page:
 *
 *   1  hero          light   what is this, and what does it look like
 *   2  on soon       sunken  what can I buy right now
 *   3  how it works  light   what would I actually do
 *   4  what you get  sunken  why this rather than the other one
 *   5  closing       light band, INK block — the button
 *
 * The closing call to action is a dark BLOCK inside a light band rather than a
 * dark full-bleed band. A full-bleed dark band at the bottom of a light page
 * reads as a theme switch — as though a different site started. Contained, the
 * same colour reads as punctuation, which is what a final call to action is.
 * There is exactly one on the page for that reason; a second would make
 * neither of them the end.
 *
 * ── Why there are no photographs ─────────────────────────────────────────
 * `public/` holds six files and none of them is a picture of an event, and a
 * stock photo of a crowd is a photo of a crowd that is not this crowd — the
 * same reason EventCard draws a typographic placeholder instead of one. So the
 * hero shows the product: a seat map, drawn by the module that draws the real
 * seat map. See HeroSeatMap.
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
      {/* ── 1 · Hero ───────────────────────────────────────────────── */}
      <section className="es-band fx-section fx-section--lg">
        <div className="fx-container fx-container--xl">
          <div className="grid items-center gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="fx-stack es-rise">
              <p className="es-eyebrow">Canada &amp; the United States</p>

              {/* `text-4xl`, which is the top of the scale and tops out at
                  3.5rem. The old h1 sat two steps down at `text-3xl` for no
                  reason — a homepage headline that is the same size as a
                  section heading gives the page no first note. */}
              <h1 className="max-w-[16ch] text-4xl">
                Find something to go to.
              </h1>

              <p className="max-w-[46ch] text-lg text-muted">
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
                    <span className="text-xs text-subtle">{entry.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · On soon ────────────────────────────────────────────── */}
      <section className="es-band--sunken fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
          <div className="fx-row fx-row--between">
            <h2 className="text-2xl">On soon</h2>
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

      {/* ── 3 · How it works ───────────────────────────────────────── */}
      <section className="es-band fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
          <p className="es-eyebrow">Three steps</p>
          <h2 className="max-w-[20ch] text-2xl">From a link to a seat in about a minute.</h2>

          {/* An ordered list, because the order IS the meaning. A div with a
              styled number in it says "1" to a sighted reader and nothing at
              all to a screen reader; the number here is real content. */}
          <ol className="fx-grid fx-grid--3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="es-card fx-stack fx-stack--sm p-5">
                <p className="es-eyebrow">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="text-lg">{step.title}</h3>
                <p className="text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 4 · What you get ───────────────────────────────────────── */}
      <section className="es-band--sunken fx-section fx-section--sm">
        <div className="fx-container fx-container--xl fx-stack">
          <p className="es-eyebrow">What you get</p>
          <h2 className="max-w-[24ch] text-2xl">Four things, and each one is a behaviour.</h2>

          <ul className="fx-grid fx-grid--2">
            {POINTS.map((point) => (
              <li key={point.title} className="es-card fx-stack fx-stack--sm p-5">
                <h3 className="text-lg">{point.title}</h3>
                <p className="text-sm text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 5 · Closing ────────────────────────────────────────────── */}
      <section className="es-band fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="es-band--ink fx-stack rounded-[--es-radius-xl] p-8 text-center sm:p-12">
            <h2 className="mx-auto max-w-[20ch] text-3xl">
              There is something on this week.
            </h2>
            <p className="mx-auto max-w-[44ch] text-muted">
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
