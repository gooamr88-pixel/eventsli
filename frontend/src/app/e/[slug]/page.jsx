import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
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

export default async function EventPage({ params }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) notFound();

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

      {event.coverUrl && (
        <div className="relative aspect-[21/9] w-full overflow-hidden bg-bg-sunken sm:aspect-[3/1]">
          <Image
            src={event.coverUrl}
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-cover"
          />
        </div>
      )}

      <section className="fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="fx-grid fx-grid--2">
            <div className="fx-stack">
              <p className="es-eyebrow">
                {fmt(starts, { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <h1 className="text-4xl">{event.title}</h1>

              <dl className="fx-stack fx-stack--sm text-sm">
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

              {event.description && (
                <div className="fx-break max-w-[62ch] whitespace-pre-line text-md text-muted">
                  {event.description}
                </div>
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
            <aside className="fx-stack lg:sticky lg:top-20 lg:self-start">
              <div className="es-card fx-stack p-5">
                {cheapest.length > 0 && (
                  <p className="es-nums text-xl">
                    {formatPrice(Math.min(...cheapest), event.currency)}
                    {cheapest.length > 1 && <span className="text-sm text-subtle"> and up</span>}
                  </p>
                )}

                {event.tiers?.length > 0 && (
                  <ul className="fx-stack fx-stack--sm">
                    {event.tiers.map((tier) => (
                      <li key={tier.id} className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
                        <span className="fx-min0">
                          <span className="block text-sm text-ink">{tier.name}</span>
                          {tier.description && (
                            <span className="block text-xs text-subtle">{tier.description}</span>
                          )}
                        </span>
                        <span className="es-nums text-sm text-ink">
                          {formatPrice(tier.priceCents, event.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <CallToAction event={event} soldOut={soldOut} />

                {event.availability && !soldOut && (
                  <p className="text-center text-xs text-subtle">
                    {event.availability.seatsAvailable} of {event.availability.seatsTotal} seats left
                  </p>
                )}
              </div>

              <p className="text-center text-xs text-subtle">
                Up to {event.maxTicketsPerOrder} tickets per order · seats held for 35 minutes
              </p>
            </aside>
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
function CallToAction({ event, soldOut }) {
  if (event.displayOnly) {
    return (
      <p className="rounded-[--es-radius-md] bg-bg-sunken px-4 py-3 text-center text-sm text-muted" role="status">
        This event is listed for information. Tickets are not sold here.
      </p>
    );
  }

  if (soldOut) {
    return (
      <p className="rounded-[--es-radius-md] bg-bg-sunken px-4 py-3 text-center text-sm text-muted" role="status">
        Sold out
      </p>
    );
  }

  return (
    <Link
      href={`/e/${event.slug}/seats`}
      className="es-btn es-btn--primary es-btn--block es-btn--lg"
    >
      Choose your seats
    </Link>
  );
}

function Row({ term, children }) {
  return (
    <div className="fx-row items-start">
      {/* `.es-eyebrow` in the subtle colour rather than the accent: these are
          five labels stacked down the left of the facts list, and five accent
          runs down one column reads as five links. The accent is reserved for
          the one eyebrow above the title, which is the page's first note. */}
      <dt className="es-eyebrow w-20 flex-none text-subtle">
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
