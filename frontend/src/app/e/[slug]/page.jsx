import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import EventGallery from './EventGallery';
import EventTabs from './EventTabs';
import EventShare from './EventShare';
import EventPurchasePanel from './EventPurchasePanel';
import {
  EventHighlights, EventSchedule, EventSponsors, EventPolicies, VenueMap,
} from './EventSections';
import { serverFetch } from '../../utils/apiClient';
import { formatPrice } from '../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event page. The most-shared URL on the platform, and the one a crawler
 * indexes.
 *
 * Fully server-rendered, and it must stay that way: everything a buyer needs to
 * decide — title, date, venue, description, prices — is in the HTML before a
 * byte of JavaScript runs. That single property is most of the reason this app
 * is Next rather than the static bundle it replaces, where every page fetched
 * its own content after load and a crawler saw a skeleton.
 *
 * Cached for a minute, and tagged. The tag is what the backend drops when an
 * event is approved, suspended, cancelled or repriced — without it a cached
 * 404 outlives the approval by a full minute, and the person refreshing is the
 * organizer who just got the email.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const revalidate = 60;

async function loadEvent(slug) {
  try {
    return await serverFetch(`/public/events/${encodeURIComponent(slug)}`, {
      tags: [`event:${slug}`],
      revalidate: 60,
    });
  } catch (err) {
    // Every unpublished state — draft, pending, rejected, suspended, cancelled
    // — returns a byte-identical 404 from the API, so that a distinguishable
    // answer cannot be used to enumerate slugs or watch an event move through
    // review. This page keeps that property by not asking why.
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return { title: 'Event not found' };

  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full', timeZone: event.timezone,
  }).format(new Date(event.startsAt));

  return {
    title: event.title,
    description: (event.description || `${event.title} — ${when}`).slice(0, 300),
    alternates: { canonical: `/e/${event.slug}` },
    /**
     * A PAGE'S `openGraph` REPLACES THE LAYOUT'S. It does not merge into it.
     *
     * That is why `siteName` and `locale` are repeated here, and it is why this
     * block used to ship an event with no `og:image` at all: an event without
     * cover art set `images: undefined`, which did not fall back to the root
     * layout's default card — it deleted it. Every share of every coverless
     * event was a blank rectangle with a line of text beside it, on the most
     * shared URL the platform has. Found by reading the rendered <head>, which
     * is the only place it is visible; nothing errors and nothing logs.
     */
    openGraph: {
      title: event.title,
      description: (event.description || when).slice(0, 300),
      type: 'website',
      url: `/e/${event.slug}`,
      siteName: 'Eventsli',
      locale: 'en_US',
      // The cover doubles as the share card. There is no separate og_image
      // column on purpose — one image to keep current beats two that disagree.
      //
      // Its dimensions are not declared, deliberately: the file is whatever the
      // organizer uploaded and a wrong width is worse than none, because a
      // crawler believes it. The default card below is ours and is exactly
      // 1200×630, so there its dimensions are stated.
      images: event.coverUrl
        ? [{ url: event.coverUrl, alt: event.title }]
        : [{
          url: '/og-default.png',
          width: 1200,
          height: 630,
          alt: 'Eventsli — find something to go to',
        }],
    },
  };
}

export default async function EventPage({ params, searchParams }) {
  const { slug } = await params;
  const { tier: tierParam } = (await searchParams) || {};
  const event = await loadEvent(slug);
  if (!event) notFound();

  /**
   * `?tier=` — the deep link an organizer shares from Share & QR.
   *
   * Honoured only when it names one of THIS event's tiers, as returned by the
   * API; anything else is ignored rather than echoed. The server built the link
   * and checked the tier belongs to the event before it ever became a QR code,
   * and this is the same check on the way back in.
   */
  const focusTier = typeof tierParam === 'string'
    ? (event.tiers || []).find((t) => t.id === tierParam) || null
    : null;

  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt);

  // Formatted in the EVENT's timezone, not the reader's. A show at 8pm in
  // Toronto is at 8pm on the poster, on the ticket and at the door; rendering
  // it as 5pm because the reader is in Vancouver is how people miss events.
  const fmt = (d, opts) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: event.timezone }).format(d);

  const soldOut = event.availability?.soldOut;
  const cheapest = (event.tiers || [])
    .map((t) => t.priceCents)
    .filter((n) => Number.isFinite(n));

  return (
    <main>
      {/* JSON-LD so the event is eligible for a rich result. Built from the
          same values rendered below — a second, hand-written copy is one that
          goes stale the first time a date changes. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(event)) }}
      />

      {/* ── The masthead ──────────────────────────────────────────────
          The title used to sit in the left column of the body, under a bare
          `aspect-[21/9]` strip of cover art. Two things were wrong with that:
          the art was PLACED rather than presented — a full-bleed band with a
          hard bottom edge and nothing on it — and the title, the one thing
          that tells you whether you are on the right page, opened below the
          fold on a phone once the strip had taken its share.

          One band now carries both. With cover art it is the art plus a
          scrim; without it, the field tone. Either way the band is
          `.es-band--photo`, so the text roles inside it are already inverted
          and measured — a scrim over an unknown photograph is the classic
          place white text quietly fails, and here `text-muted` is
          `#b7d8cc` against a dark ground rather than slate-600. */}
      <section className="es-band--photo relative flex min-h-[clamp(17rem,30vw,24rem)] items-end overflow-hidden">
        {event.coverUrl ? (
          <>
            <Image
              src={event.coverUrl}
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover"
            />
            {/* The scrim is what makes the title legible over art nobody has
                seen. Bottom-weighted, because that is where the text is. */}
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-bg-deep via-bg-deep/70 to-bg-deep/10"
            />
          </>
        ) : null}

        <div className="fx-gutter relative w-full pb-10 pt-16">
          <div className="fx-container fx-container--xl fx-stack fx-stack--sm">
            <p className="es-eyebrow text-accent">
              {fmt(starts, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="max-w-[20ch] text-3xl">{event.title}</h1>
          </div>

        </div>

        {/* Top-right of the band, over the artwork — where a reader's thumb
            already is on a phone, and clear of the title block below. */}
        <div className="fx-gutter absolute inset-x-0 top-4 z-10">
          <div className="fx-container fx-container--xl fx-row justify-end">
            <EventShare title={event.title} slug={event.slug} />
          </div>
        </div>
      </section>

      <section className="fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="grid gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="fx-stack">
              {/* Was `text-sm` on the whole list — 12.6px on a phone for the
                  when and the where, which are the two facts a person opens
                  this page to check. Now the list inherits body size and each
                  row is a ruled pair, so the labels scan down one edge. */}
              <dl className="fx-stack fx-stack--sm">
                <Row term="When">
                  {fmt(starts, { dateStyle: 'medium', timeStyle: 'short' })}
                  {' – '}
                  {sameDay(starts, ends, event.timezone)
                    ? fmt(ends, { timeStyle: 'short' })
                    : fmt(ends, { dateStyle: 'medium', timeStyle: 'short' })}
                  {' '}
                  <span className="text-subtle">({event.timezone})</span>
                </Row>
                {event.venue && (
                  <Row term="Where">
                    {event.venue}
                    {event.venueAddress && <span className="text-muted">, {event.venueAddress}</span>}
                  </Row>
                )}
                {event.organizer?.name && <Row term="Organizer">{event.organizer.name}</Row>}
              </dl>

              <EventHighlights items={event.highlights} />

              {/* ── WHAT THE ORGANIZER BUILT, behind four tabs ─────────────
                  Every panel is in the page whether or not its tab is open —
                  `EventTabs` argues why at length, and the short version is
                  that this is the page the whole platform exists to get people
                  to, so its content cannot be behind a click a crawler has to
                  simulate.

                  A tab appears only when it has something in it, so a small
                  event with a description and nothing else gets no tab bar at
                  all — just its description, which is the right shape for it. */}
              <EventTabs
                panels={[
                  {
                    key: 'about',
                    label: 'About',
                    content: (event.description || (event.gallery || []).length > 0) && (
                      <div className="fx-stack">
                        {event.description && (
                          <div className="fx-break max-w-[62ch] whitespace-pre-line text-md leading-relaxed text-muted">
                            {event.description}
                          </div>
                        )}
                        <EventGallery items={event.gallery} />
                      </div>
                    ),
                  },
                  {
                    key: 'lineup',
                    label: 'Lineup',
                    content: (event.schedule || []).length > 0 && (
                      <EventSchedule items={event.schedule} timezone={event.timezone} />
                    ),
                  },
                  {
                    key: 'venue',
                    label: 'Venue',
                    // The address alone earns this tab: it is the second thing
                    // anybody checks, and on a well-known venue there is no pin
                    // to add to it.
                    content: (event.venue || event.venueLocation) && (
                      <VenueMap
                        venue={event.venue}
                        address={event.venueAddress}
                        location={event.venueLocation}
                      />
                    ),
                  },
                  {
                    key: 'faqs',
                    label: 'FAQs',
                    content: (event.policies || []).length > 0 && (
                      <EventPolicies items={event.policies} />
                    ),
                  },
                ]}
              />

              {/* OUTSIDE THE TABS, deliberately. Sponsors are an obligation the
                  organizer has to the people who paid for the banner, and a
                  tab nobody opens does not discharge it. The organizer's own
                  name is provenance and belongs on the page, not in a section. */}
              <EventSponsors items={event.sponsors} />

              {event.organizer?.name && (
                <section className="fx-stack fx-stack--sm" aria-labelledby="event-organizer">
                  <h2 id="event-organizer" className="text-lg">Organised by</h2>
                  <p className="text-md text-muted">{event.organizer.name}</p>
                </section>
              )}
            </div>

            {/* STICKY, from `lg` up.

                The description on a well-filled event page runs past the fold,
                and when it does, the price and the buy button scroll off with
                the top of the page — so the reader finishes the part that
                convinced them and has to scroll back up to act on it. Sticking
                the box means the decision is reachable from wherever the answer
                was found.

                `top-20` clears the 4rem masthead, which is itself sticky: at
                `top-0` the box would slide under it and lose its first line.
                `self-start` is what makes it work at all — a grid item defaults
                to `stretch`, which makes this column as tall as the description
                beside it, and a sticky element the full height of its scroll
                container never has anywhere to stick to. */}
            {/* `lg:-mt-28` lifts the box over the masthead band above it.
                That overlap is the one piece of deliberate asymmetry on the
                page and it does real work: it puts the price physically on
                top of the art, which is the pairing the reader is deciding
                about, and it stops the right column starting on the same
                horizontal line as the left — which is what made the old
                layout read as two lists side by side.

                The sticky note below still applies. `self-start` is what
                makes sticky work at all: a grid item defaults to `stretch`,
                which makes this column as tall as the description beside it,
                and a sticky element the full height of its scroll container
                never has anywhere to stick to. */}
            <EventPurchasePanel
              event={event}
              focusTier={focusTier}
              soldOut={soldOut}
              cheapest={cheapest}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * BRD §12 — a `display_only` event is a listing with no tickets behind it. It
 * gets no buy button at all rather than a disabled one, because a dead control
 * is a question ("why can't I click this?") the page then has to answer.
 */

function Row({ term, children }) {
  return (
    /* A ruled row rather than a bare flex pair. Three facts stacked with no
       separation read as one paragraph that happens to have bold words in it;
       a hairline above each makes them three answers to three questions.

       Grid rather than flex so the label column is one shared track: with
       `w-20` on a flex child the values still started at slightly different
       places once a label wrapped on a narrow phone. */
    <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-x-4 border-t border-border-base pt-3 first:border-0 first:pt-0">
      {/* `.es-eyebrow` in the subtle colour rather than the accent: these are
          labels stacked down the left of the facts list, and several accent
          runs down one column reads as several links. The accent is reserved
          for the one eyebrow above the title, which is the page's first
          note. */}
      <dt className="es-eyebrow w-20 text-subtle">
        {term}
      </dt>
      <dd className="fx-min0 fx-break text-ink">{children}</dd>
    </div>
  );
}

function sameDay(a, b, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone });
  return f.format(a) === f.format(b);
}

function jsonLd(event) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(event.description ? { description: event.description.slice(0, 500) } : {}),
    ...(event.coverUrl ? { image: [event.coverUrl] } : {}),
    ...(event.venue
      ? {
        location: {
          '@type': 'Place',
          name: event.venue,
          ...(event.venueAddress ? { address: event.venueAddress } : {}),
        },
      }
      : {}),
    ...(event.organizer?.name
      ? { organizer: { '@type': 'Organization', name: event.organizer.name } }
      : {}),
    // Offers are omitted entirely for a display-only listing rather than
    // written as zero — a structured price of 0 tells Google the event is free,
    // which is a different and wrong claim.
    ...(!event.displayOnly && event.tiers?.length
      ? {
        offers: event.tiers.map((t) => ({
          '@type': 'Offer',
          name: t.name,
          price: (t.priceCents / 100).toFixed(2),
          priceCurrency: event.currency,
          availability: event.availability?.soldOut
            ? 'https://schema.org/SoldOut'
            : 'https://schema.org/InStock',
        })),
      }
      : {}),
  };
}
