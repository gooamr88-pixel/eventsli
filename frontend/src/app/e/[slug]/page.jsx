import { notFound } from 'next/navigation';
import { jsonLdScript } from '../../utils/jsonLd';
import NavIcon from '../../components/shell/NavIcon';
import EventGallery from './EventGallery';
import EventTabs from './EventTabs';
import EventHero from './EventHero';
import EventSponsorsSection from './EventSponsorsSection';
import EventTickets, { EventMarks } from './EventTickets';
import EventTicketCard from './EventTicketCard';
import EventBlocks from './EventBlocks';
import EventFaq from './EventFaq';
import { EventBuyBar, EventPurchaseNotice } from './EventPurchasePanel';
import {
  EventSchedule, VenueMap,
} from './EventSections';
import { serverFetch } from '../../utils/apiClient';
import {
  seoTitle, seoDescription, seoKeywords, eventJsonLd, breadcrumbJsonLd, eventUrl,
} from '../../lib/eventSeo';
import { EventBreadcrumbs, RelatedEvents } from './EventDiscovery';
import { isDateOnly, formatDateOnly } from '../../lib/dateOnly';
import { isComingSoon, comingSoonLabel } from '../../lib/comingSoon';
import EventNotifyCard from './EventNotifyCard';
import VisitBeacon from '../../components/landing/VisitBeacon';

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

  /**
   * SEARCH-SHAPED, FROM THE SAME FIELDS THE PAGE RENDERS — see lib/eventSeo.js
   * for why the title says "Tickets", the city and the date, and why the
   * description leads with when, where and how much.
   *
   * `title.absolute`: the title already ends in "| Eventsli" when there is room,
   * so the layout's " · Eventsli" template must not add a second one.
   */
  const title = seoTitle(event);
  const description = seoDescription(event);
  const canonical = eventUrl(event.slug);
  // The generated, branded share card for this event (opengraph-image.jsx).
  // `updatedAt` in the query, so a changed title or cover is a new image URL
  // and chat apps that cache previews by URL fetch it again.
  const shareCard = `${canonical}/opengraph-image${event.updatedAt ? `?v=${encodeURIComponent(Date.parse(event.updatedAt) || '')}` : ''}`;

  return {
    title: { absolute: title },
    description,
    keywords: seoKeywords(event, event.categoryLabel),
    // Absolute, and never carrying `?tier=`: every deep link an organizer shares
    // is the same page, and its ranking belongs to one URL.
    alternates: { canonical },
    // Large image previews and full snippets: an event page is exactly the
    // result a big poster thumbnail helps someone recognise.
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
    },
    // The branded card, large, for every event — with or without a cover it
    // is a full 1200×630 image (twitter-image.jsx).
    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description,
      images: [shareCard],
    },
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
      description,
      type: 'website',
      url: canonical,
      siteName: 'Eventsli',
      locale: 'en_US',
      // THE BRANDED SHARE CARD (2026-11-17), generated beside this page
      // (opengraph-image.jsx): the poster shown whole with the title, the
      // date, the city and the Eventsli logo. Named here explicitly rather than
      // left to file-based metadata, which this Next version did not apply
      // over `generateMetadata` when checked. Ours, so exactly 1200×630, and
      // it draws its own fallback when an event has no usable cover.
      images: [{ url: shareCard, width: 1200, height: 630, alt: `${event.title} on Eventsli` }],
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
  // The header (owner's reference, 2026-11-15): the description's own heading
  // line becomes the headline in the accent; the rest is the clamped text.
  const about = [aboutLead, aboutRest].filter(Boolean).join('\n\n');
  // A date-only listing (lib/dateOnly.js) states its day(s) and no time — it
  // never had one, and "12:00 AM – 11:59 PM" is not one.
  // A "coming soon" teaser has a month, not a time (lib/comingSoon.js).
  const teaser = isComingSoon(event);
  const when = teaser ? { date: comingSoonLabel(event) } : isDateOnly(event) ? { date: formatDateOnly(event) } : {
    date: fmt(starts, { dateStyle: 'medium' }),
    start: fmt(starts, { timeStyle: 'short' }),
    end: sameDay(starts, ends, event.timezone)
      ? fmt(ends, { timeStyle: 'short' })
      : fmt(ends, { dateStyle: 'medium', timeStyle: 'short' }),
  };
  const seated = !event.displayOnly && event.admissionType !== 'general';

  return (
    <main className="fx-section fx-section--xs">
      {/* Counts this view for the organizer's "Event views". Renders nothing. */}
      <VisitBeacon path={`/e/${event.slug || slug}`} />
      {/* JSON-LD so the event is eligible for a rich result. Built from the
          same values rendered below — a second, hand-written copy is one that
          goes stale the first time a date changes.

          `jsonLdScript`, not `JSON.stringify`. The values are typed by the
          organizer, and JSON escaping has no opinion about `</script>` — which
          ends this block before any JavaScript is parsed. See utils/jsonLd.js. */}
      {/* Not for a teaser: an Event needs a start date, and a teaser has only
          a month — stating "the 1st at midnight" to a search engine would be
          publishing a time nobody chose. */}
      {!teaser && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(eventJsonLd(event)) }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(event)) }}
      />

      <div className="fx-gutter">
        <div className="es-ev-page fx-stack">
          <EventBreadcrumbs event={event} />

          {/* ── 1. The header: poster | title, headline, description | facts ── */}
          <EventHero event={event} tagline={aboutTitle} about={about} when={when} />

          {teaser ? (
            /* ── 2. Coming soon: "Notify me" where the tickets will be. ── */
            <EventNotifyCard event={event} />
          ) : (
            <>
              {/* ── 2. Tickets: the ticket-shaped call to buy ────────────── */}
              <EventTicketCard event={event} cheapest={cheapest} soldOut={soldOut} />

              {/* ── 3. Seated: blocks and prices, and the door to the map.
                    General admission: the ticket types, as before. ─────── */}
              {seated
                ? <EventBlocks event={event} />
                : <EventTickets event={event} cheapest={cheapest} soldOut={soldOut} />}

              {/* The reasons a buyer might not be able to buy, said in full. */}
              <EventPurchaseNotice event={event} soldOut={soldOut} focusTier={focusTier} />
            </>
          )}

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
                label: 'Highlights',
                content: ((event.gallery || []).length > 0 || (event.highlights || []).length > 0) && (
                  <div className="fx-stack">
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
                  </section>
                ),
              },
            ]}
          />

          {/* ── 5. The event's sponsors, and the questions guests ask ───────── */}
          <EventSponsorsSection sponsors={event.sponsors} />
          <EventFaq event={event} />

          {/* ── 6. Somewhere else to go ──────────────────────────────────── */}
          <RelatedEvents event={event} />

          {/* Eventsli's OWN partners are not shown here (owner, 2026-11-15): an
              event page shows that event's sponsors only — see
              EventSponsorsSection above. They stay on the homepage. */}

        </div>
      </div>

      {/* Fixed to the bottom at every width — the sticky side panel it replaced
          only ever existed on a desktop, and this page is now one column. */}
      {!teaser && (
        <EventBuyBar
          event={event}
          soldOut={soldOut}
          tierId={focusTier?.id}
          cheapest={cheapest}
        />
      )}
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
