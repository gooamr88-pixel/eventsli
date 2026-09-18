import { notFound } from 'next/navigation';
import { jsonLdScript } from '../../utils/jsonLd';
import NavIcon from '../../components/shell/NavIcon';
import EventGallery from './EventGallery';
import EventTabs from './EventTabs';
import EventHero, { EventFacts, EventPresentedBy } from './EventHero';
import EventTickets, { EventMarks } from './EventTickets';
import { EventBuyBar, EventPurchaseNotice } from './EventPurchasePanel';
import {
  EventSchedule, EventSponsors, EventPolicies, VenueMap,
} from './EventSections';
import { serverFetch } from '../../utils/apiClient';

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

  /**
   * THE DESCRIPTION, SPLIT INTO WHAT IS SHOWN AND WHAT IS BEHIND "Show more".
   *
   * The mockup opens the About panel with a serif heading and a short
   * paragraph. The API has no separate heading field — there is one
   * `description` an organizer typed — so the shape is derived from it rather
   * than demanding a field the organizer would have to fill twice.
   *
   * The FIRST LINE becomes the heading, but only when it reads like one: short
   * enough to be a title and followed by more text. A description written as
   * one long paragraph has no heading to take, and inventing one by cutting it
   * at the first full stop would put half a sentence in display type.
   */
  const { aboutTitle, aboutLead, aboutRest } = splitDescription(event.description);

  /**
   * The kicker over the title, from the organizer's own highlights — the
   * mockup's "NETWORK • RELAX • GROW". Three at most: it is one line over a
   * large title, and a fourth pushes it onto two.
   */
  const kicker = (event.highlights || []).slice(0, 3).join(' • ') || null;

  // Under the title in the hero. The first sentence of the description says
  // what this is; the heading above already says what it is called.
  const lede = firstSentence(aboutLead || event.description, 120);

  return (
    <main className="fx-section fx-section--xs">
      {/* JSON-LD so the event is eligible for a rich result. Built from the
          same values rendered below — a second, hand-written copy is one that
          goes stale the first time a date changes.

          `jsonLdScript`, not `JSON.stringify`. The values are typed by the
          organizer, and JSON escaping has no opinion about `</script>` — which
          ends this block before any JavaScript is parsed. See utils/jsonLd.js. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd(event)) }}
      />

      <div className="fx-gutter">
        <div className="es-ev-page fx-stack">
          {/* ── 1. The picture, on its own ───────────────────────────────── */}
          <EventHero event={event} kicker={kicker} lede={lede} />

          {/* ── 2. The three facts ───────────────────────────────────────── */}
          <EventFacts
            event={event}
            when={{
              date: fmt(starts, { dateStyle: 'medium' }),
              time: `${fmt(starts, { timeStyle: 'short' })} – ${
                sameDay(starts, ends, event.timezone)
                  ? fmt(ends, { timeStyle: 'short' })
                  : fmt(ends, { dateStyle: 'medium', timeStyle: 'short' })
              }`,
            }}
            organizerHref={event.organizer?.name ? '#event-organizer' : null}
          />

          {/* ── 3. Who is presenting ─────────────────────────────────────── */}
          <EventPresentedBy sponsors={event.sponsors} />

          {/* ── 4. The sections ──────────────────────────────────────────────
              Every panel is in the page whether or not its tab is open —
              `EventTabs` argues why, and the short version is that this is the
              page the whole platform exists to get people to, so its content
              cannot be behind a click a crawler has to simulate.

              A tab appears only when it has something in it, so a small event
              with a description and nothing else gets no tab bar at all. */}
          <EventTabs
            panels={[
              {
                key: 'about',
                label: 'About',
                content: (event.description || (event.gallery || []).length > 0
                  || (event.highlights || []).length > 0) && (
                  <div className="fx-stack">
                    <p className="es-ev-about__eyebrow">About the event</p>
                    {aboutTitle && <h2 className="es-ev-about__title fx-break">{aboutTitle}</h2>}

                    {aboutRest ? (
                      <>
                        <p className="fx-break max-w-[62ch] whitespace-pre-line text-md leading-relaxed text-muted">
                          {aboutLead}
                        </p>
                        {/* `<details>`, so the long half costs no JavaScript and
                            is still in the HTML for a crawler. */}
                        <details className="es-ev-more">
                          <summary>
                            <span className="es-ev-more__show">Show more</span>
                            <span className="es-ev-more__less">Show less</span>
                            <span aria-hidden className="es-ev-more__caret">
                              <NavIcon name="arrow" size={16} />
                            </span>
                          </summary>
                          <p className="fx-break mt-2 max-w-[62ch] whitespace-pre-line text-md leading-relaxed text-muted">
                            {aboutRest}
                          </p>
                        </details>
                      </>
                    ) : aboutLead ? (
                      <p className="fx-break max-w-[62ch] whitespace-pre-line text-md leading-relaxed text-muted">
                        {aboutLead}
                      </p>
                    ) : null}

                    <EventMarks items={event.highlights} />
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
                // anybody checks, and on a well-known venue there is no pin to
                // add to it.
                content: (event.venue || event.venueLocation) && (
                  <VenueMap
                    venue={event.venue}
                    address={event.venueAddress}
                    location={event.venueLocation}
                  />
                ),
              },
              {
                key: 'organizer',
                label: 'Organizer',
                content: event.organizer?.name && (
                  <section className="fx-stack fx-stack--sm" aria-labelledby="event-organizer">
                    <h2 id="event-organizer" className="text-lg">Organised by</h2>
                    <p className="text-md text-muted">{event.organizer.name}</p>
                    {/* The full list lives here rather than in a section of its
                        own at the foot of the page. The headline sponsor is
                        already up top; these are the rest. */}
                    <EventSponsors items={event.sponsors} />
                  </section>
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

          {/* ── 5. What it costs ─────────────────────────────────────────── */}
          <EventTickets event={event} cheapest={cheapest} soldOut={soldOut} />

          {/* The reasons a buyer might not be able to buy, said in full. The
              bar below has room for a label and a button and nothing else. */}
          <EventPurchaseNotice event={event} soldOut={soldOut} focusTier={focusTier} />
        </div>
      </div>

      {/* Fixed to the bottom at every width — the sticky side panel it replaced
          only ever existed on a desktop, and this page is now one column. */}
      <EventBuyBar
        event={event}
        soldOut={soldOut}
        tierId={focusTier?.id}
        cheapest={cheapest}
      />
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

/**
 * An organizer's description → a heading, an opening paragraph, and the rest.
 *
 * The heading is taken only when the first line genuinely looks like one: on
 * its own line, short, and with something after it. Everything else falls back
 * to "no heading, all of it is body", which is the honest answer for a
 * description written as prose — a title cut out of a running sentence reads as
 * a bug, not as design.
 *
 * The fold is by PARAGRAPH, never mid-sentence. `Show more` that opens on the
 * back half of a sentence is worse than no fold at all.
 */
const HEADING_MAX = 70;

export function splitDescription(description) {
  const text = String(description || '').trim();
  if (!text) return { aboutTitle: null, aboutLead: '', aboutRest: '' };

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const firstLine = paragraphs[0]?.split('\n')[0]?.trim() || '';

  // A heading has no full stop at the end, is short, and is not the whole
  // description — one line of text is a description, not a title with nothing
  // under it.
  const looksLikeHeading = paragraphs.length > 1
    && firstLine.length > 0
    && firstLine.length <= HEADING_MAX
    && firstLine === paragraphs[0]
    && !/[.!?]$/.test(firstLine);

  const rest = looksLikeHeading ? paragraphs.slice(1) : paragraphs;
  return {
    aboutTitle: looksLikeHeading ? firstLine : null,
    aboutLead: rest[0] || '',
    aboutRest: rest.slice(1).join('\n\n'),
  };
}

/** The opening sentence, for the line under the title in the hero. Truncated
 *  on a word boundary rather than mid-word, and only when it is genuinely long. */
export function firstSentence(text, max) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return null;

  const stop = clean.search(/[.!?](\s|$)/);
  const sentence = stop > 0 ? clean.slice(0, stop + 1) : clean;
  if (sentence.length <= max) return sentence;

  const cut = sentence.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`;
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
